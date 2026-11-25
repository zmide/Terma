"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const MODIFIERS = ["shift", "lock", "control", "mod1", "mod2", "mod3", "mod4", "mod5"];
const KEYSYM = /^[A-Za-z0-9_]+$/;

function keyboardSnapshot(keycodes, modifiers) {
  const keys = new Map();
  for (const line of String(keycodes || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*keycode\s+(\d+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || Number(match[1]) < 8 || Number(match[1]) > 255) throw new Error("Invalid X11 keycode map");
    const symbols = match[2].trim().split(/\s+/).filter(Boolean);
    if (!symbols.every(symbol => KEYSYM.test(symbol))) throw new Error("Invalid X11 keysym");
    // XKB exposes redundant copies of the same symbol group through Xmodmap.
    // A round trip can add another copy; compare the effective groups.
    if (symbols.length % 2) symbols.push("NoSymbol");
    for (let period = 2; period < symbols.length; period += 2) {
      if (symbols.every((symbol, index) => symbol === symbols[index % period])) {
        symbols.splice(period);
        break;
      }
    }
    while (symbols.at(-1) === "NoSymbol") symbols.pop();
    keys.set(Number(match[1]), symbols);
  }
  if (!keys.size) throw new Error("Empty X11 keycode map");
  const rows = new Map();
  for (const line of String(modifiers || "").split(/\r?\n/)) {
    const match = /^\s*(shift|lock|control|mod[1-5])\s+(.*?)\s*$/.exec(line);
    if (!match) continue;
    const symbols = [...match[2].matchAll(/([A-Za-z0-9_]+)\s+\(0x[0-9a-f]+\)/gi)]
      .map(entry => entry[1]);
    if (match[2].trim() && !symbols.length) throw new Error("Invalid X11 modifier map");
    rows.set(match[1], [...new Set(symbols)].sort());
  }
  if (rows.size !== MODIFIERS.length) throw new Error("Incomplete X11 modifier map");
  return [
    ...MODIFIERS.map(modifier => `clear ${modifier}`),
    ...Array.from({length:248}, (_, index) => {
      const number = index + 8;
      return `keycode ${number} = ${(keys.get(number) || []).join(" ")}`.trimEnd();
    }),
    ...MODIFIERS.flatMap(modifier => rows.get(modifier).length
      ? [`add ${modifier} = ${rows.get(modifier).join(" ")}`]
      : [])
  ].join("\n") + "\n";
}

function authorityCookies(value, display) {
  const number = /:(\d+)(?:\.\d+)?$/.exec(display)?.[1];
  const entries = String(value || "").split(/\r?\n/).flatMap(line => {
    const match = /^(\S+)\s+MIT-MAGIC-COOKIE-1\s+([a-f0-9]{32})\s*$/i.exec(line.trim());
    return match ? [{cookie:match[2], matching:new RegExp(`:${number}(?:\\.\\d+)?$`).test(match[1])}] : [];
  });
  return [...new Set(entries.sort((a, b) => Number(b.matching) - Number(a.matching)).map(entry => entry.cookie))].slice(0, 16);
}

function createMacXdmcpSession(options) {
  const {display, xauth, xwininfo, xmodmap, runtimeDataDir, text} = options;
  // Only local XQuartz endpoints may receive a copy of the host's cookie.
  if (!/^(?::\d+(?:\.\d+)?|\/[^\s\0\r\n]*:\d+(?:\.\d+)?)$/.test(display)) {
    throw new Error(text("XQuartz DISPLAY 无效", "The XQuartz DISPLAY is invalid"));
  }
  if (!xauth || !xwininfo || !xmodmap) {
    throw new Error(text("XQuartz 缺少 xauth、xwininfo 或 xmodmap，请重新安装 XQuartz", "XQuartz is missing xauth, xwininfo, or xmodmap. Reinstall XQuartz"));
  }
  fs.mkdirSync(runtimeDataDir, {recursive:true});
  const directory = fs.mkdtempSync(path.join(runtimeDataDir, "mac-xdmcp-"));
  fs.chmodSync(directory, 0o700);
  const hostAuthority = path.join(directory, "host-authority");
  const nestedAuthority = path.join(directory, "nested-authority");
  const environment = {...options.environment, DISPLAY:display, XAUTHORITY:hostAuthority};
  const run = options.run || spawnSync;
  let disposed = false;

  function command(executable, args, env = environment, input) {
    return run(executable, args, {
      env, input, encoding:"utf8", timeout:2000, maxBuffer:1024 * 1024, windowsHide:true
    });
  }

  function dispose() {
    if (disposed) return;
    fs.rmSync(directory, {recursive:true, force:true});
    disposed = true;
  }

  function writeAuthority(file, endpoint, cookie) {
    fs.writeFileSync(file, "", {mode:0o600});
    // Feed the cookie through stdin so that it never appears in process arguments.
    const result = command(xauth, ["-f", file, "source", "-"], environment,
      `add ${endpoint} MIT-MAGIC-COOKIE-1 ${cookie}\n`);
    if (result.status !== 0) throw new Error(text("无法准备 XQuartz 会话授权", "Could not prepare XQuartz session authorization"));
  }

  function readKeyboard(endpoint, env = environment) {
    const keycodes = command(xmodmap, ["-display", endpoint, "-pke"], env);
    const modifiers = command(xmodmap, ["-display", endpoint, "-pm"], env);
    if (keycodes.status === 0 && modifiers.status === 0) {
      try {
        return keyboardSnapshot(keycodes.stdout, modifiers.stdout);
      } catch {
        // Report a localized failure without exposing subprocess output.
      }
    }
    throw new Error(text("无法读取 X Server 的键盘映射", "Could not read the X Server keyboard map"));
  }

  try {
    const cookies = [];
    for (const file of [...new Set(options.authorityFiles.filter(Boolean))]) {
      try {
        if (!fs.statSync(file).isFile()) continue;
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const result = command(xauth, ["-f", file, "list"]);
      if (result.status === 0) cookies.push(...authorityCookies(result.stdout, display));
    }
    let authenticated = false;
    for (const cookie of [...new Set(cookies)].slice(0, 32)) {
      writeAuthority(hostAuthority, display, cookie);
      if (command(xwininfo, ["-display", display, "-root"]).status === 0) {
        authenticated = true;
        break;
      }
    }
    if (!authenticated) {
      throw new Error(text("无法验证当前 XQuartz 的授权，请重启 XQuartz 后重试", "Could not authenticate with the current XQuartz display. Restart XQuartz and try again"));
    }
    const keyboard = readKeyboard(display);
    return {
      environment,
      nestedAuthority,
      prepareDisplay(number) {
        if (!Number.isInteger(number) || number < 0 || number > 32) throw new Error("Invalid nested display number");
        writeAuthority(nestedAuthority, `:${number}`, crypto.randomBytes(16).toString("hex"));
      },
      displayReady(number) {
        return command(xwininfo, ["-display", `:${number}`, "-root"],
          {...environment, XAUTHORITY:nestedAuthority}).status === 0;
      },
      synchronizeKeyboard(number) {
        const targetEnvironment = {...environment, XAUTHORITY:nestedAuthority};
        const result = command(xmodmap, ["-display", `:${number}`, "-"], targetEnvironment, keyboard);
        if (result.status !== 0) {
          throw new Error(text("无法同步 XQuartz 与 Xephyr 的键盘映射", "Could not synchronize the XQuartz and Xephyr keyboard maps"));
        }
        if (readKeyboard(`:${number}`, targetEnvironment) !== keyboard) {
          throw new Error(text("Xephyr 键盘映射校验失败", "The Xephyr keyboard map did not match XQuartz"));
        }
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

module.exports = {authorityCookies, keyboardSnapshot, createMacXdmcpSession};
