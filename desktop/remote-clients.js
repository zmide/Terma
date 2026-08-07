const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const MAC_WINDOWS_APP_URL = "macappstore://itunes.apple.com/app/id1295203466";
const MAC_WINDOWS_APP_PACKAGE_URL = "https://go.microsoft.com/fwlink/?linkid=868963";

function rdpDisplayMode(options = {}) {
  const mode = String(options.display_mode || "");
  if (["dynamic", "fullscreen", "fixed"].includes(mode)) return mode;
  if (Object.prototype.hasOwnProperty.call(options, "fullscreen")) return options.fullscreen === false ? "fixed" : "fullscreen";
  return "dynamic";
}

function remoteDesktopSize(options = {}) {
  return {
    width:Math.max(640, Math.min(8192, Math.round(Number(options.width || 1440)))),
    height:Math.max(480, Math.min(8192, Math.round(Number(options.height || 900))))
  };
}

function createRemoteClientAdapter(options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const runtimeSpawn = options.spawn || spawn;
  const runtimeSpawnSync = options.spawnSync || spawnSync;
  const runtimeFetch = options.fetch || globalThis.fetch;
  const runtimeShell = options.shell;
  const existsSync = options.existsSync || fs.existsSync;
  const getDataDir = options.getDataDir || (() => options.dataDir || process.cwd());
  const getXServerDiagnostics = options.getXServerDiagnostics || (() => null);
  const startupProbeMs = Math.max(0, Number(options.startupProbeMs ?? 1400));
  const clientPath = platform === "win32" ? path.win32 : path.posix;

  function command(command, args) {
    try {
      return runtimeSpawnSync(command, args, {encoding:"utf8", windowsHide:true, timeout:3000});
    } catch {
      return {status:1, stdout:"", stderr:""};
    }
  }

  function findExecutable(names) {
    for (const name of names) {
      if (!name) continue;
      if (clientPath.isAbsolute(name) && existsSync(name)) return name;
      const lookup = platform === "win32" ? "where.exe" : "which";
      const result = command(lookup, [name]);
      const found = String(result.stdout || "").split(/\r?\n/).map(value => value.trim()).find(Boolean);
      if (result.status === 0 && found) return found;
    }
    return "";
  }

  function windowsVncUriHandler() {
    if (platform !== "win32") return false;
    const keys = ["HKCU\\Software\\Classes\\vnc\\shell\\open\\command", "HKCR\\vnc\\shell\\open\\command"];
    return keys.some(key => command("reg.exe", ["query", key, "/ve"]).status === 0);
  }

  function macApplication(names) {
    const home = environment.HOME || "";
    const candidates = names.flatMap(name => [clientPath.join("/Applications", name), home ? clientPath.join(home, "Applications", name) : ""]);
    return candidates.find(file => file && existsSync(file)) || "";
  }

  function diagnostics() {
    let rdp = {available:false, client:"", executable:"", mode:"", application:""};
    let vnc = {available:false, client:"", executable:"", mode:"", application:""};
    if (platform === "win32") {
      const mstsc = findExecutable([clientPath.join(environment.SystemRoot || "C:\\Windows", "System32", "mstsc.exe")]);
      const vncViewer = findExecutable([
        "vncviewer.exe",
        clientPath.join(environment.ProgramFiles || "", "TigerVNC", "vncviewer.exe"),
        clientPath.join(environment.ProgramFiles || "", "RealVNC", "VNC Viewer", "vncviewer.exe"),
        clientPath.join(environment.ProgramFiles || "", "TightVNC", "tvnviewer.exe")
      ]);
      const uri = windowsVncUriHandler();
      rdp = {available:Boolean(mstsc), client:mstsc ? "远程桌面连接" : "", executable:mstsc, mode:"rdp-file", application:""};
      vnc = {available:Boolean(vncViewer || uri), client:vncViewer ? clientPath.basename(vncViewer) : uri ? "系统 VNC 客户端" : "", executable:vncViewer, mode:vncViewer ? "executable" : uri ? "uri" : "", application:""};
    } else if (platform === "darwin") {
      const rdpApp = macApplication(["Windows App.app", "Microsoft Remote Desktop.app"]);
      const freeRdp = findExecutable(["xfreerdp3", "xfreerdp"]);
      let xServer = null;
      try { xServer = getXServerDiagnostics(); } catch {}
      const freeRdpDisplayReady = Boolean(environment.DISPLAY);
      const freeRdpNeedsXServer = Boolean(freeRdp && !freeRdpDisplayReady);
      const freeRdpCanStartXServer = Boolean(freeRdpNeedsXServer && xServer?.installed);
      const screenSharing = ["/System/Applications/Utilities/Screen Sharing.app", "/Applications/Utilities/Screen Sharing.app"].find(file => existsSync(file)) || "";
      rdp = {
        available:Boolean(rdpApp || (freeRdp && freeRdpDisplayReady)),
        launchable:Boolean(rdpApp || (freeRdp && (freeRdpDisplayReady || freeRdpCanStartXServer))),
        client:rdpApp ? clientPath.basename(rdpApp, ".app") : freeRdp ? clientPath.basename(freeRdp) : "",
        executable:rdpApp ? "/usr/bin/open" : freeRdp,
        mode:rdpApp ? "rdp-file" : freeRdp ? "freerdp" : "",
        application:rdpApp,
        requires_xserver:freeRdpNeedsXServer,
        xserver_installed:Boolean(xServer?.installed),
        can_install:!rdpApp && (!freeRdp || !freeRdpCanStartXServer),
        install_label:"安装 Windows App",
        install_kind:"app-store",
        reason:rdpApp || (freeRdp && freeRdpDisplayReady)
          ? ""
          : freeRdpCanStartXServer
            ? "已检测到 FreeRDP；连接时 Terma 会自动启动 XQuartz"
            : freeRdp
              ? "已检测到 FreeRDP，但尚未安装可用的 XQuartz；可安装 XQuartz，或改用 Windows App"
            : "macOS 未检测到 RDP 客户端；可安装 Windows App 后重试"
      };
      vnc = {available:Boolean(screenSharing), client:screenSharing ? "屏幕共享" : "", executable:screenSharing ? "/usr/bin/open" : "", mode:"uri", application:screenSharing};
    } else {
      const rdpClient = findExecutable(["xfreerdp3", "xfreerdp", "wlfreerdp", "remmina"]);
      const vncClient = findExecutable(["vncviewer", "gvncviewer", "remmina"]);
      const rdpName = clientPath.basename(rdpClient || "");
      const vncName = clientPath.basename(vncClient || "");
      const rdpDisplayReady = /^wlfreerdp/i.test(rdpName)
        ? Boolean(environment.WAYLAND_DISPLAY || environment.DISPLAY)
        : Boolean(environment.DISPLAY);
      const vncDisplayReady = Boolean(environment.DISPLAY || environment.WAYLAND_DISPLAY);
      rdp = {
        available:Boolean(rdpClient && rdpDisplayReady),
        client:rdpName,
        executable:rdpClient,
        mode:/remmina$/i.test(rdpClient) ? "remmina" : "freerdp",
        application:"",
        reason:!rdpClient ? "未找到 FreeRDP 或 Remmina" : rdpDisplayReady ? "" : "当前 Terma 没有可用的图形桌面 DISPLAY",
        can_install:!rdpClient,
        install_label:"安装 FreeRDP"
      };
      vnc = {
        available:Boolean(vncClient && vncDisplayReady),
        client:vncName,
        executable:vncClient,
        mode:/remmina$/i.test(vncClient) ? "remmina" : /gvncviewer$/i.test(vncClient) ? "gvncviewer" : "vncviewer",
        application:"",
        reason:!vncClient ? "未找到系统 VNC 客户端" : vncDisplayReady ? "" : "当前 Terma 没有可用的图形桌面 DISPLAY"
      };
    }
    return {
      platform,
      rdp,
      vnc,
      password_policy:"系统客户端自行请求或管理凭据，Terma 不会把密码放入命令行"
    };
  }

  function spawnDetached(executable, args) {
    return new Promise((resolve, reject) => {
      // GUI clients such as mstsc inherit STARTF_USESHOWWINDOW on Windows. Passing
      // windowsHide here leaves the client running without a visible window.
      const child = runtimeSpawn(executable, args, {detached:true, stdio:"ignore"});
      child.once("spawn", () => { child.unref?.(); resolve(null); });
      child.once("error", reject);
    });
  }

  function readableLaunchError(stderr, executable, code) {
    const text = String(stderr || "").replace(/\x1b\[[0-9;]*m/g, "");
    if (/failed to open display|cannot open display/i.test(text)) {
      return "FreeRDP 无法连接当前 Linux 图形桌面（DISPLAY 不可用），请从桌面会话启动 Terma";
    }
    if (/certificate name mismatch/i.test(text)) {
      return "RDP 证书名称与连接地址不一致，请在 FreeRDP 证书提示中确认后重试";
    }
    if (/authentication failure|logon failure|ERRCONNECT_LOGON_FAILURE/i.test(text)) {
      return "RDP 登录失败，请检查桌面账号、密码和域";
    }
    const useful = text.split(/\r?\n/)
      .map(line => line.replace(/^\[[^\]]+\]\s*(?:\[[^\]]+\]\s*)*/, "").trim())
      .filter(line => line && !/^\d+:\s/.test(line) && !/Caught signal|winpr_log_backtrace|lib(?:winpr|freerdp)|__libc_start_main|\(_start\+/i.test(line));
    return useful.slice(-4).join("；") || `${clientPath.basename(executable)} 启动后立即退出（代码 ${code ?? "未知"}）`;
  }

  function spawnObserved(executable, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stderr = "";
      let timer = null;
      const child = runtimeSpawn(executable, args, {
        detached:true,
        stdio:["ignore", "ignore", "pipe"],
        env:environment
      });
      const finish = (error=null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else {
          child.unref?.();
          resolve({pid:child.pid || 0});
        }
      };
      child.stderr?.on?.("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      child.once("spawn", () => {
        timer = setTimeout(() => finish(), startupProbeMs);
      });
      child.once("error", error => finish(error));
      child.once("close", code => {
        if (!settled) finish(code === 0 ? null : new Error(readableLaunchError(stderr, executable, code)));
      });
    });
  }

  function temporaryDirectory() {
    const directory = path.join(getDataDir(), "remote-client");
    fs.mkdirSync(directory, {recursive:true});
    return directory;
  }

  function verifyMacWindowsAppPackage(file) {
    if (platform !== "darwin" || !file || !existsSync(file)) throw new Error("Windows App 安装包不存在");
    const bytes = fs.statSync(file).size;
    if (bytes < 1024 * 1024) throw new Error("Windows App 安装包内容不完整");
    const signature = runtimeSpawnSync("/usr/sbin/pkgutil", ["--check-signature", file], {
      encoding:"utf8",
      timeout:15000,
      windowsHide:true
    });
    const text = `${signature.stdout || ""}\n${signature.stderr || ""}`;
    if (signature.status !== 0 || !/Microsoft Corporation/i.test(text) || !/Notarization:\s*trusted/i.test(text)) {
      throw new Error("Windows App 安装包不是受信任的 Microsoft 签名包");
    }
    return {bytes};
  }

  function localMacWindowsAppPackages() {
    const home = environment.HOME || "";
    const downloads = home ? clientPath.join(home, "Downloads") : "";
    return [
      clientPath.join(temporaryDirectory(), "WindowsApp.pkg"),
      downloads ? clientPath.join(downloads, "WindowsApp.pkg") : "",
      downloads ? clientPath.join(downloads, "Windows App.pkg") : ""
    ].filter(Boolean);
  }

  function findVerifiedMacWindowsAppPackage() {
    for (const file of localMacWindowsAppPackages()) {
      try {
        verifyMacWindowsAppPackage(file);
        return file;
      } catch {}
    }
    return "";
  }

  async function downloadMacWindowsAppPackage() {
    if (typeof runtimeFetch !== "function") throw new Error("当前运行环境不能下载 Windows App 安装包");
    const file = localMacWindowsAppPackages()[0];
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      const response = await runtimeFetch(MAC_WINDOWS_APP_PACKAGE_URL, {
        headers:{"User-Agent":"Terma-Windows-App-Installer"},
        redirect:"follow"
      });
      if (!response?.ok || !response.body) throw new Error(`Windows App 下载失败：HTTP ${response?.status || "未知"}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, {flags:"wx"}));
      verifyMacWindowsAppPackage(temporary);
      fs.renameSync(temporary, file);
      return file;
    } finally {
      try { fs.rmSync(temporary, {force:true}); } catch {}
    }
  }

  async function installMacWindowsAppPackage(file) {
    verifyMacWindowsAppPackage(file);
    const command = `/usr/sbin/installer -pkg ${JSON.stringify(file)} -target /`;
    await new Promise((resolve, reject) => {
      const child = runtimeSpawn("/usr/bin/osascript", ["-e", `do shell script ${JSON.stringify(command)} with administrator privileges`], {
        stdio:["ignore", "pipe", "pipe"],
        windowsHide:true
      });
      let stderr = "";
      child.stderr?.on?.("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve(null) : reject(new Error(stderr.trim() || "Windows App 安装被取消或失败")));
    });
  }

  function writeRdpFile(profile, fileOptions = {}) {
    const value = profile.options || {};
    const displayMode = rdpDisplayMode(value);
    const {width, height} = remoteDesktopSize(value);
    const audioMode = value.audio === "remote" ? 1 : value.audio === "off" ? 2 : 0;
    const lines = [
      `full address:s:${profile.host}:${Number(profile.port || 3389)}`,
      ...(fileOptions.omitUsername ? [] : [`username:s:${String(profile.username || "")}`]),
      `domain:s:${String(value.domain || "")}`,
      `screen mode id:i:${displayMode === "fullscreen" ? 2 : 1}`,
      `desktopwidth:i:${width}`,
      `desktopheight:i:${height}`,
      `dynamic resolution:i:${displayMode === "dynamic" ? 1 : 0}`,
      `smart sizing:i:${displayMode === "dynamic" ? 1 : 0}`,
      `administrative session:i:${value.admin_session ? 1 : 0}`,
      `redirectclipboard:i:${value.clipboard === false ? 0 : 1}`,
      `audiomode:i:${audioMode}`,
      "prompt for credentials:i:1",
      "authentication level:i:2"
    ];
    const file = path.join(temporaryDirectory(), `terma-${Number(profile.id)}-${Date.now()}.rdp`);
    fs.writeFileSync(file, `\uFEFF${lines.join("\r\n")}\r\n`, "utf16le");
    setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 10 * 60 * 1000).unref?.();
    return file;
  }

  async function openRdp(profile, item) {
    if (!item.available) throw new Error(item.reason || (platform === "darwin" ? "未找到 Windows App 或 Microsoft Remote Desktop" : "未找到可用的 RDP 客户端"));
    const value = profile.options || {};
    const displayMode = rdpDisplayMode(value);
    const {width, height} = remoteDesktopSize(value);
    if (platform === "win32" && Number(value.source_ssh_connection_id || 0) > 0) {
      // SSH-derived RDP entries should behave like typing the host into mstsc.
      // Reusing an SSH username here can select the wrong desktop account, but
      // the generated RDP file is still required for the selected display mode.
      await spawnDetached(item.executable, [writeRdpFile(profile, {omitUsername:true})]);
    } else if (platform === "win32") await spawnDetached(item.executable, [writeRdpFile(profile)]);
    else if (platform === "darwin" && item.mode === "rdp-file") await spawnDetached("/usr/bin/open", ["-a", item.application, writeRdpFile(profile)]);
    else if (item.mode === "remmina") {
      const user = profile.username ? `${encodeURIComponent(profile.username)}@` : "";
      await spawnObserved(item.executable, ["-c", `rdp://${user}${profile.host}:${Number(profile.port || 3389)}`]);
    } else {
      const args = [`/v:${profile.host}:${Number(profile.port || 3389)}`];
      if (profile.username) args.push(`/u:${profile.username}`);
      if (value.domain) args.push(`/d:${value.domain}`);
      if (displayMode === "fullscreen") args.push("/f");
      else {
        args.push(`/size:${width}x${height}`);
        if (displayMode === "dynamic") args.push("/dynamic-resolution");
      }
      if (value.clipboard !== false) args.push("+clipboard");
      if (value.admin_session) args.push("/admin");
      args.push(`/audio-mode:${value.audio === "remote" ? 1 : value.audio === "off" ? 2 : 0}`);
      args.push("/cert:tofu");
      await spawnObserved(item.executable, args);
    }
    return {ok:true, protocol:"rdp", client:item.client, credentials:"prompt", startup_checked:platform !== "win32" && item.mode !== "rdp-file"};
  }

  async function openVnc(profile, item) {
    if (!item.available) throw new Error("未找到可用的 VNC 客户端");
    const value = profile.options || {};
    const port = Number(profile.port || 5900);
    const uri = `vnc://${profile.host}:${port}`;
    if (item.mode === "uri") {
      if (!runtimeShell?.openExternal) throw new Error("当前桌面环境不能打开 VNC 链接");
      await runtimeShell.openExternal(uri);
    } else if (item.mode === "remmina") await spawnDetached(item.executable, ["-c", uri]);
    else if (item.mode === "gvncviewer") await spawnDetached(item.executable, [`${profile.host}:${port}`]);
    else if (/tvnviewer(?:\.exe)?$/i.test(item.executable)) await spawnDetached(item.executable, [`-host=${profile.host}`, `-port=${port}`]);
    else {
      const args = [`${profile.host}::${port}`, `-QualityLevel=${Number(value.quality ?? 8)}`];
      if (value.shared) args.push("-Shared");
      if (value.view_only) args.push("-ViewOnly");
      await spawnDetached(item.executable, args);
    }
    return {ok:true, protocol:"vnc", client:item.client, credentials:"prompt"};
  }

  async function open(profile = {}) {
    if (!["rdp", "vnc"].includes(String(profile.protocol || ""))) throw new Error("仅 RDP/VNC 使用系统远程桌面客户端");
    const host = String(profile.host || "").trim();
    const port = Number(profile.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("远程桌面目标无效");
    const state = diagnostics();
    return profile.protocol === "rdp" ? openRdp(profile, state.rdp) : openVnc(profile, state.vnc);
  }

  async function install(protocol) {
    if (protocol !== "rdp") throw new Error("当前只支持安装 RDP 客户端");
    if (platform !== "darwin") throw new Error("当前平台没有可由此入口安装的 RDP 客户端");
    const current = diagnostics();
    if (current.rdp.application) return {ok:true, protocol, already_installed:true, client:current.rdp.client};
    let installer = findVerifiedMacWindowsAppPackage();
    let downloaded = false;
    if (!installer) {
      try {
        installer = await downloadMacWindowsAppPackage();
        downloaded = true;
      } catch (error) {
        if (!runtimeShell?.openExternal) throw error;
        await runtimeShell.openExternal(MAC_WINDOWS_APP_URL);
        return {ok:true, protocol, opened:true, target:"Mac App Store", fallback:true, message:error.message, restart_required:false};
      }
    }
    await installMacWindowsAppPackage(installer);
    const installed = diagnostics();
    if (!installed.rdp.application) throw new Error("安装命令已完成，但没有检测到 Windows App");
    return {ok:true, protocol, client:installed.rdp.client, offline:!downloaded, cached_package:true, restart_required:false};
  }

  return {diagnostics, findExecutable, install, open, writeRdpFile};
}

module.exports = {MAC_WINDOWS_APP_PACKAGE_URL, MAC_WINDOWS_APP_URL, createRemoteClientAdapter};
