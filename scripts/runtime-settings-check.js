const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  DEFAULT_TERMINAL_SETTINGS,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeRuntimeSettings,
  normalizeTerminalSettings
} = require("../dist/runtime-settings");

const root = path.resolve(__dirname, "..");
const temporaryRoots = [];

function closeServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise(resolve => server.close(() => resolve()));
}

function listen(host, port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port }, () => {
      server.removeListener("error", reject);
      resolve({ server, port: server.address().port });
    });
  });
}

async function freePort() {
  const { server, port } = await listen("127.0.0.1");
  await closeServer(server);
  return port;
}

async function waitForFile(file, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForExit(child, timeoutMs = 8000) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : {} };
}

async function main() {
  assert.equal(DEFAULT_TERMINAL_SETTINGS.url_links_enabled, true);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.auto_copy_selection, false);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.copy_include_trailing_newline, false);
  assert.deepEqual(normalizeListenHosts(["127.0.0.1", "0.0.0.0", "127.0.0.1"]), ["0.0.0.0"]);
  assert.deepEqual(normalizeRuntimeSettings({ listen_hosts: "127.0.0.1,127.0.0.2", listen_port: "8123" }), {
    schema_version: 5,
    listen_hosts: ["127.0.0.1", "127.0.0.2"],
    listen_port: 8123,
    sftp_recycle_bin_enabled: false,
    sftp_max_open_file_size_mb: 5,
    sftp_download_directory: "",
    restore_workspace_tabs: true,
    terminal: {...DEFAULT_TERMINAL_SETTINGS, url_prefixes:[...DEFAULT_TERMINAL_SETTINGS.url_prefixes]}
  });
  assert.equal(normalizeRuntimeSettings({ sftp_recycle_bin_enabled: true }).sftp_recycle_bin_enabled, true);
  assert.equal(normalizeRuntimeSettings({}, { sftp_recycle_bin_enabled: true }).sftp_recycle_bin_enabled, true);
  assert.equal(normalizeRuntimeSettings({ sftp_max_open_file_size_mb: 12 }).sftp_max_open_file_size_mb, 12);
  assert.equal(normalizeRuntimeSettings({ restore_workspace_tabs: false }).restore_workspace_tabs, false);
  assert.deepEqual(normalizeTerminalSettings({
    middle_mouse_action: "send_enter",
    right_mouse_action: "invalid",
    url_prefixes: "https:// | ssh:// | javascript://",
    multiline_paste_mode: "single_line"
  }), {
    ...DEFAULT_TERMINAL_SETTINGS,
    middle_mouse_action: "send_enter",
    right_mouse_action: "context_menu",
    url_prefixes: ["https://", "ssh://"],
    multiline_paste_mode: "single_line"
  });
  assert.throws(() => normalizeListenPort(0), /1-65535/);
  assert.throws(() => normalizeListenHosts(["not-an-ip"]), /IPv4/);
  assert.throws(() => normalizeRuntimeSettings({sftp_download_directory:"bad\0path"}), /下载目录无效/);
  console.log("PASS runtime listener normalization");

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-runtime-settings-check-"));
  temporaryRoots.push(temporaryRoot);
  const dataDir = path.join(temporaryRoot, "data");
  const sshDir = path.join(temporaryRoot, ".ssh");
  const runtimeFile = path.join(dataDir, "runtime-settings.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sshDir, { recursive: true });

  let child = null;
  let startupBlocker = null;
  let checkBlocker = null;
  try {
    const occupied = await listen("127.0.0.1");
    startupBlocker = occupied.server;
    fs.writeFileSync(runtimeFile, JSON.stringify({
      listen_hosts: ["127.0.0.1", "127.0.0.2"],
      listen_port: occupied.port,
      sftp_recycle_bin_enabled: true,
      terminal: {
        ...DEFAULT_TERMINAL_SETTINGS,
        right_mouse_action: "paste_clipboard",
        url_links_enabled: true
      }
    }, null, 2), "utf8");

    child = spawn(process.execPath, [path.join(root, "dist", "server.js")], {
      cwd: root,
      env: {
        ...process.env,
        TUNNELDESK_DATA_DIR: dataDir,
        TUNNELDESK_SSH_DIR: sshDir,
        TUNNELDESK_DISABLE_UPDATE_CHECK: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let childOutput = "";
    child.stdout.on("data", chunk => { childOutput += chunk; });
    child.stderr.on("data", chunk => { childOutput += chunk; });

    const info = await waitForFile(path.join(dataDir, "web.json"));
    assert.equal(info.requested_port, occupied.port);
    assert.equal(info.actual_port, occupied.port + 1);
    assert.equal(info.fallback_count, 1);
    assert.deepEqual(info.actual_hosts, ["127.0.0.1", "127.0.0.2"]);
    assert.equal(info.urls.includes(info.local_url), true);
    const persistedAfterFallback = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
    assert.equal(persistedAfterFallback.listen_port, info.actual_port);
    assert.equal(persistedAfterFallback.sftp_recycle_bin_enabled, true);
    assert.equal(persistedAfterFallback.sftp_max_open_file_size_mb, 5);
    assert.equal(persistedAfterFallback.sftp_download_directory, "");
    assert.equal(persistedAfterFallback.restore_workspace_tabs, true);
    assert.equal(persistedAfterFallback.terminal.right_mouse_action, "paste_clipboard");
    console.log("PASS multi-address startup uses one fallback port and persists it");

    const base = info.local_url;
    const currentCheck = await request(base, "/api/runtime-settings/check", {
      method: "POST",
      body: JSON.stringify({ listen_hosts: info.actual_hosts, listen_port: info.actual_port })
    });
    assert.equal(currentCheck.response.ok, true);
    assert.equal(currentCheck.body.available, true);
    assert.equal(currentCheck.body.occupied_by_current, true);
    assert.equal(currentCheck.body.requested_port, info.actual_port);

    const settings = await request(base, "/api/runtime-settings");
    assert.equal(settings.response.ok, true);
    assert.deepEqual(settings.body.saved.listen_hosts, ["127.0.0.1", "127.0.0.2"]);
    assert.equal(settings.body.saved.listen_port, info.actual_port);
    assert.equal(settings.body.saved.sftp_recycle_bin_enabled, true);
    assert.equal(settings.body.saved.sftp_max_open_file_size_mb, 5);
    assert.equal(settings.body.saved.sftp_download_directory, "");
    assert.equal(settings.body.saved.restore_workspace_tabs, true);
    assert.equal(settings.body.saved.terminal.right_mouse_action, "paste_clipboard");
    assert.equal(settings.body.saved.terminal.url_links_enabled, true);
    assert.equal(settings.body.effective.listen_port, info.actual_port);
    assert.equal(settings.body.local_url, base);
    assert.deepEqual(settings.body.actual_hosts, ["127.0.0.1", "127.0.0.2"]);
    console.log("PASS runtime settings API reports saved and actual listener state");

    const terminalSaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ terminal: {
        middle_mouse_action: "open_settings",
        right_mouse_action: "context_menu",
        ctrl_left_click_moves_cursor: false,
        url_links_enabled: true,
        url_prefixes: ["https://", "ssh://"],
        multiline_paste_mode: "single_line"
      } })
    });
    assert.equal(terminalSaved.response.ok, true);
    assert.equal(terminalSaved.body.saved.terminal.middle_mouse_action, "open_settings");
    assert.equal(terminalSaved.body.saved.terminal.ctrl_left_click_moves_cursor, false);
    assert.deepEqual(terminalSaved.body.saved.terminal.url_prefixes, ["https://", "ssh://"]);
    assert.equal(terminalSaved.body.saved.terminal.multiline_paste_mode, "single_line");
    assert.deepEqual(terminalSaved.body.saved.listen_hosts, ["127.0.0.1", "127.0.0.2"]);
    console.log("PASS global terminal settings save independently and are normalized");

    const recycleDisabled = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ sftp_recycle_bin_enabled: false })
    });
    assert.equal(recycleDisabled.response.ok, true);
    assert.equal(recycleDisabled.body.saved.sftp_recycle_bin_enabled, false);
    assert.deepEqual(recycleDisabled.body.saved.listen_hosts, ["127.0.0.1", "127.0.0.2"]);
    assert.equal(recycleDisabled.body.saved.listen_port, info.actual_port);
    assert.equal(recycleDisabled.body.saved.terminal.middle_mouse_action, "open_settings");
    console.log("PASS SFTP recycle setting saves independently without listener validation");

    const generalSaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ sftp_max_open_file_size_mb: 12, sftp_download_directory:path.join(temporaryRoot, "downloads"), restore_workspace_tabs: false })
    });
    assert.equal(generalSaved.response.ok, true);
    assert.equal(generalSaved.body.saved.sftp_max_open_file_size_mb, 12);
    assert.equal(generalSaved.body.saved.sftp_download_directory, path.join(temporaryRoot, "downloads"));
    assert.equal(generalSaved.body.saved.restore_workspace_tabs, false);
    assert.equal(generalSaved.body.saved.sftp_recycle_bin_enabled, false);
    console.log("PASS workspace restore and SFTP open limit save independently");

    const blocked = await listen("127.0.0.1");
    checkBlocker = blocked.server;
    const unavailable = await request(base, "/api/runtime-settings/check", {
      method: "POST",
      body: JSON.stringify({ listen_hosts: ["127.0.0.1"], listen_port: blocked.port })
    });
    assert.equal(unavailable.response.ok, true);
    assert.equal(unavailable.body.available, false);
    assert.equal(unavailable.body.occupied_by_current, false);
    assert.equal(unavailable.body.requested_port, blocked.port);
    assert.ok(unavailable.body.suggested_port > blocked.port);

    const rejectedSave = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ listen_hosts: ["127.0.0.1"], listen_port: blocked.port })
    });
    assert.equal(rejectedSave.response.status, 409);
    assert.equal(rejectedSave.body.available, false);
    console.log("PASS occupied external port is reported and rejected on save");

    const nextPort = await freePort();
    const saved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ listen_hosts: ["127.0.0.1"], listen_port: nextPort })
    });
    assert.equal(saved.response.ok, true);
    assert.deepEqual(saved.body.saved.listen_hosts, ["127.0.0.1"]);
    assert.equal(saved.body.saved.listen_port, nextPort);
    assert.equal(saved.body.saved.sftp_recycle_bin_enabled, false);
    assert.equal(saved.body.saved.sftp_max_open_file_size_mb, 12);
    assert.equal(saved.body.saved.sftp_download_directory, path.join(temporaryRoot, "downloads"));
    assert.equal(saved.body.saved.restore_workspace_tabs, false);
    assert.equal(saved.body.saved.terminal.middle_mouse_action, "open_settings");
    assert.equal(saved.body.restart_required, true);
    console.log("PASS valid listener configuration saves for the next restart");

    const downloadSettings = await request(base, "/api/sftp/download-settings");
    assert.equal(downloadSettings.response.ok, true);
    assert.equal(downloadSettings.body.delivery_mode, "browser");
    assert.equal(downloadSettings.body.effective_directory, "");
    const cacheBefore = await request(base, "/api/cache");
    assert.equal(cacheBefore.response.ok, true);
    assert.equal(Number.isFinite(cacheBefore.body.bytes), true);
    const cacheCleared = await request(base, "/api/cache", {method:"DELETE", body:"{}"});
    assert.equal(cacheCleared.response.ok, true);
    assert.equal(cacheCleared.body.ok, true);
    console.log("PASS browser download delivery and cache management APIs are available without desktop integration");

    const shutdown = await request(base, "/api/shutdown", { method: "POST", body: "{}" });
    assert.equal(shutdown.response.ok, true);
    await waitForExit(child);
    assert.notEqual(child.exitCode, null, `Server did not exit. Output: ${childOutput}`);
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (child) await waitForExit(child, 2000);
    await closeServer(checkBlocker);
    await closeServer(startupBlocker);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const directory of temporaryRoots) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});
