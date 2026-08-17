const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readFrontendDomain } = require("./frontend-source");
const {
  DEFAULT_NOTIFICATION_DISPLAY,
  DEFAULT_TERMINAL_SETTINGS,
  DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeRuntimeSettings,
  readRuntimeSettings,
  normalizeTerminalSettings,
  normalizeWorkspaceToolbarPlacement
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

async function bindableLoopbackHosts() {
  const hosts = ["127.0.0.1"];
  try {
    const { server } = await listen("127.0.0.2");
    await closeServer(server);
    hosts.push("127.0.0.2");
  } catch (error) {
    if (error?.code !== "EADDRNOTAVAIL") throw error;
  }
  return hosts;
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
  const settingsFrontend = readFrontendDomain(root, "settings");
  for (const controlId of [
    "toolbarPlacementUnsplitTerminal",
    "toolbarPlacementUnsplitSftp",
    "toolbarPlacementSplitTerminal",
    "toolbarPlacementSplitSftp",
    "generalRemoteDesktopQuickOpen",
    "generalVncQuickOpenNewWindow"
  ]) assert.equal(settingsFrontend.includes(`id=\"${controlId}\"`), true, `${controlId} setting is missing`);
  assert.equal(settingsFrontend.includes("syncWorkspaceToolbarPlacements()"), true);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.url_links_enabled, true);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.auto_copy_selection, false);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.copy_include_trailing_newline, false);
  assert.equal(DEFAULT_TERMINAL_SETTINGS.background_mode, "theme");
  assert.equal(DEFAULT_TERMINAL_SETTINGS.background_color, "#0f1720");
  assert.equal(DEFAULT_TERMINAL_SETTINGS.font_size, 13);
  assert.match(DEFAULT_TERMINAL_SETTINGS.font_family, /monospace/);
  assert.deepEqual(normalizeListenHosts(["127.0.0.1", "0.0.0.0", "127.0.0.1"]), ["0.0.0.0"]);
  assert.deepEqual(normalizeRuntimeSettings({ listen_hosts: "127.0.0.1,127.0.0.2", listen_port: "8123" }), {
    schema_version: 16,
    language: "zh-CN",
    language_onboarding_version: 0,
    vnc_fullscreen_toolbar: "always",
    listen_hosts: ["127.0.0.1", "127.0.0.2"],
    listen_port: 8123,
    sftp_recycle_bin_enabled: false,
    sftp_floating_progress_enabled: true,
    notification_display: {
      info:{...DEFAULT_NOTIFICATION_DISPLAY.info},
      success:{...DEFAULT_NOTIFICATION_DISPLAY.success},
      error:{...DEFAULT_NOTIFICATION_DISPLAY.error},
      progress:{...DEFAULT_NOTIFICATION_DISPLAY.progress}
    },
    sftp_max_open_file_size_mb: 50,
    sftp_text_editor_mode: "ace",
    sftp_light_editor_threshold_mb: 10,
    sftp_external_edit_save_rule: "prompt",
    sftp_external_edit_backup_enabled: true,
    sftp_download_concurrency: 3,
    sftp_upload_concurrency: 3,
    sftp_download_directory: "",
    restore_workspace_tabs: true,
    remote_desktop_quick_open_enabled: false,
    vnc_quick_open_new_window: true,
    workspace_toolbar_placement: {
      unsplit: {terminal:"header", sftp:"header"},
      split: {terminal:"header", sftp:"header"}
    },
    terminal: {...DEFAULT_TERMINAL_SETTINGS, url_prefixes:[...DEFAULT_TERMINAL_SETTINGS.url_prefixes]}
  });
  assert.equal(normalizeRuntimeSettings({ sftp_recycle_bin_enabled: true }).sftp_recycle_bin_enabled, true);
  assert.equal(normalizeRuntimeSettings({}, { sftp_recycle_bin_enabled: true }).sftp_recycle_bin_enabled, true);
  assert.equal(normalizeRuntimeSettings({ sftp_floating_progress_enabled: false }).sftp_floating_progress_enabled, false);
  assert.equal(normalizeRuntimeSettings({}, { sftp_floating_progress_enabled: false }).sftp_floating_progress_enabled, false);
  assert.deepEqual(normalizeRuntimeSettings({ notification_display:{
    info:{enabled:false, duration_ms:1200},
    progress:{enabled:false, success_duration_ms:5000, error_duration_ms:9000}
  }}).notification_display, {
    info:{enabled:false, duration_ms:1200},
    success:{enabled:true, duration_ms:3500},
    error:{enabled:true, duration_ms:8000},
    progress:{enabled:false, success_duration_ms:5000, error_duration_ms:9000}
  });
  assert.equal(normalizeRuntimeSettings({language:"en-US"}).language, "en-US");
  assert.equal(normalizeRuntimeSettings({language:"invalid"}).language, "zh-CN");
  assert.equal(normalizeRuntimeSettings({vnc_fullscreen_toolbar:"edge"}).vnc_fullscreen_toolbar, "edge");
  assert.equal(normalizeRuntimeSettings({vnc_fullscreen_toolbar:"invalid"}).vnc_fullscreen_toolbar, "always");
  assert.equal(normalizeRuntimeSettings(
    {notification_display:{progress:{success_duration_ms:null}}},
    {notification_display:{progress:{enabled:true, success_duration_ms:5000, error_duration_ms:8000}}}
  ).notification_display.progress.success_duration_ms, null);
  assert.throws(() => normalizeRuntimeSettings({notification_display:{error:{duration_ms:200}}}), /通知显示时长/);
  assert.equal(normalizeRuntimeSettings({ sftp_max_open_file_size_mb: 12 }).sftp_max_open_file_size_mb, 12);
  assert.equal(normalizeRuntimeSettings({ sftp_text_editor_mode: "light" }).sftp_text_editor_mode, "light");
  assert.equal(normalizeRuntimeSettings({ sftp_light_editor_threshold_mb: 24 }).sftp_light_editor_threshold_mb, 24);
  assert.equal(normalizeRuntimeSettings({ sftp_external_edit_save_rule: "overwrite" }).sftp_external_edit_save_rule, "overwrite");
  assert.equal(normalizeRuntimeSettings({ sftp_external_edit_backup_enabled: false }).sftp_external_edit_backup_enabled, false);
  assert.equal(normalizeRuntimeSettings({ sftp_download_concurrency: 6 }).sftp_download_concurrency, 6);
  assert.equal(normalizeRuntimeSettings({ sftp_upload_concurrency: 2 }).sftp_upload_concurrency, 2);
  assert.throws(() => normalizeRuntimeSettings({sftp_download_concurrency:9}), /并发数/);
  assert.equal(normalizeRuntimeSettings({ restore_workspace_tabs: false }).restore_workspace_tabs, false);
  assert.deepEqual(normalizeRuntimeSettings({}).workspace_toolbar_placement, DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT);
  assert.deepEqual(normalizeWorkspaceToolbarPlacement({
    unsplit:{terminal:"tab", sftp:"invalid"},
    split:{sftp:"tab"}
  }), {
    unsplit:{terminal:"tab", sftp:"header"},
    split:{terminal:"header", sftp:"tab"}
  });
  assert.deepEqual(normalizeTerminalSettings({
    background_mode: "custom",
    background_color: "#ABCDEF",
    middle_mouse_action: "send_enter",
    right_mouse_action: "invalid",
    url_prefixes: "https:// | ssh:// | javascript://",
    multiline_paste_mode: "single_line"
  }), {
    ...DEFAULT_TERMINAL_SETTINGS,
    background_mode: "custom",
    background_color: "#abcdef",
    middle_mouse_action: "send_enter",
    right_mouse_action: "context_menu",
    url_prefixes: ["https://", "ssh://"],
    multiline_paste_mode: "single_line"
  });
  assert.deepEqual(normalizeTerminalSettings({background_mode:"invalid", background_color:"not-a-color"}), DEFAULT_TERMINAL_SETTINGS);
  assert.equal(normalizeTerminalSettings({font_family:"Cascadia Mono", font_size:16}).font_family, "Cascadia Mono");
  assert.equal(normalizeTerminalSettings({font_family:"Cascadia Mono", font_size:16}).font_size, 16);
  assert.throws(() => normalizeTerminalSettings({font_family:"bad\nfont"}), /终端字体/);
  assert.throws(() => normalizeTerminalSettings({font_size:33}), /10-32/);
  const invalidCustomBackground = normalizeTerminalSettings({background_mode:"custom", background_color:"not-a-color"});
  assert.equal(invalidCustomBackground.background_mode, "custom");
  assert.equal(invalidCustomBackground.background_color, DEFAULT_TERMINAL_SETTINGS.background_color);
  assert.throws(() => normalizeListenPort(0), /1-65535/);
  assert.throws(() => normalizeListenHosts(["not-an-ip"]), /IPv4/);
  assert.throws(() => normalizeRuntimeSettings({sftp_download_directory:"bad\0path"}), /下载目录无效/);
  console.log("PASS runtime listener normalization");

  const startupHosts = await bindableLoopbackHosts();

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-runtime-settings-check-"));
  temporaryRoots.push(temporaryRoot);
  const dataDir = path.join(temporaryRoot, "data");
  const sshDir = path.join(temporaryRoot, ".ssh");
  const runtimeFile = path.join(dataDir, "runtime-settings.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sshDir, { recursive: true });

  const legacyRuntimeFile = path.join(temporaryRoot, "runtime-settings-v7.json");
  fs.writeFileSync(legacyRuntimeFile, JSON.stringify({schema_version:7, sftp_max_open_file_size_mb:5}), "utf8");
  assert.equal(readRuntimeSettings(legacyRuntimeFile).sftp_max_open_file_size_mb, 50);
  fs.writeFileSync(legacyRuntimeFile, JSON.stringify({schema_version:8, sftp_max_open_file_size_mb:5}), "utf8");
  assert.equal(readRuntimeSettings(legacyRuntimeFile).sftp_max_open_file_size_mb, 5);
  console.log("PASS legacy default SFTP open limit migrates to 50 MB without overriding v8 choices");

  let child = null;
  let startupBlocker = null;
  let checkBlocker = null;
  try {
    const occupied = await listen("127.0.0.1");
    startupBlocker = occupied.server;
    fs.writeFileSync(runtimeFile, JSON.stringify({
      listen_hosts: startupHosts,
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
        TERMA_DATA_DIR: dataDir,
        TERMA_SSH_DIR: sshDir,
        TERMA_DISABLE_UPDATE_CHECK: "1"
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
    assert.deepEqual(info.actual_hosts, startupHosts);
    assert.equal(info.urls.includes(info.local_url), true);
    const persistedAfterFallback = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
    assert.equal(persistedAfterFallback.language, "zh-CN");
    assert.equal(persistedAfterFallback.listen_port, info.actual_port);
    assert.equal(persistedAfterFallback.sftp_recycle_bin_enabled, true);
    assert.equal(persistedAfterFallback.sftp_floating_progress_enabled, true);
    assert.deepEqual(persistedAfterFallback.notification_display, {
      info:{...DEFAULT_NOTIFICATION_DISPLAY.info},
      success:{...DEFAULT_NOTIFICATION_DISPLAY.success},
      error:{...DEFAULT_NOTIFICATION_DISPLAY.error},
      progress:{...DEFAULT_NOTIFICATION_DISPLAY.progress}
    });
    assert.equal(persistedAfterFallback.sftp_max_open_file_size_mb, 50);
    assert.equal(persistedAfterFallback.sftp_text_editor_mode, "ace");
    assert.equal(persistedAfterFallback.sftp_light_editor_threshold_mb, 10);
    assert.equal(persistedAfterFallback.sftp_external_edit_save_rule, "prompt");
    assert.equal(persistedAfterFallback.sftp_external_edit_backup_enabled, true);
    assert.equal(persistedAfterFallback.sftp_download_concurrency, 3);
    assert.equal(persistedAfterFallback.sftp_upload_concurrency, 3);
    assert.equal(persistedAfterFallback.sftp_download_directory, "");
    assert.equal(persistedAfterFallback.restore_workspace_tabs, true);
    assert.deepEqual(persistedAfterFallback.workspace_toolbar_placement, DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT);
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
    assert.deepEqual(settings.body.saved.listen_hosts, startupHosts);
    assert.equal(settings.body.saved.listen_port, info.actual_port);
    assert.equal(settings.body.saved.language, "zh-CN");
    assert.equal(settings.body.saved.sftp_recycle_bin_enabled, true);
    assert.equal(settings.body.saved.sftp_floating_progress_enabled, true);
    assert.deepEqual(settings.body.saved.notification_display, persistedAfterFallback.notification_display);
    assert.equal(settings.body.saved.sftp_max_open_file_size_mb, 50);
    assert.equal(settings.body.saved.sftp_text_editor_mode, "ace");
    assert.equal(settings.body.saved.sftp_light_editor_threshold_mb, 10);
    assert.equal(settings.body.saved.sftp_external_edit_save_rule, "prompt");
    assert.equal(settings.body.saved.sftp_external_edit_backup_enabled, true);
    assert.equal(settings.body.saved.sftp_download_concurrency, 3);
    assert.equal(settings.body.saved.sftp_upload_concurrency, 3);
    assert.equal(settings.body.saved.sftp_download_directory, "");
    assert.equal(settings.body.saved.restore_workspace_tabs, true);
    assert.deepEqual(settings.body.saved.workspace_toolbar_placement, DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT);
    assert.equal(settings.body.saved.terminal.right_mouse_action, "paste_clipboard");
    assert.equal(settings.body.saved.terminal.url_links_enabled, true);
    assert.equal(settings.body.effective.listen_port, info.actual_port);
    assert.equal(settings.body.local_url, base);
    assert.deepEqual(settings.body.actual_hosts, startupHosts);
    console.log("PASS runtime settings API reports saved and actual listener state");

    const languageSaved = await request(base, "/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({language:"en-US"})
    });
    assert.equal(languageSaved.response.ok, true);
    assert.equal(languageSaved.body.saved.language, "en-US");
    assert.equal(JSON.parse(fs.readFileSync(runtimeFile, "utf8")).language, "en-US");
    console.log("PASS interface language persists independently");

    const terminalSaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ terminal: {
        background_mode: "custom",
        background_color: "#34ABCD",
        middle_mouse_action: "open_settings",
        right_mouse_action: "context_menu",
        ctrl_left_click_moves_cursor: false,
        url_links_enabled: true,
        url_prefixes: ["https://", "ssh://"],
        multiline_paste_mode: "single_line"
      } })
    });
    assert.equal(terminalSaved.response.ok, true);
    assert.equal(terminalSaved.body.saved.terminal.background_mode, "custom");
    assert.equal(terminalSaved.body.saved.terminal.background_color, "#34abcd");
    assert.equal(terminalSaved.body.saved.terminal.middle_mouse_action, "open_settings");
    assert.equal(terminalSaved.body.saved.terminal.ctrl_left_click_moves_cursor, false);
    assert.deepEqual(terminalSaved.body.saved.terminal.url_prefixes, ["https://", "ssh://"]);
    assert.equal(terminalSaved.body.saved.terminal.multiline_paste_mode, "single_line");
    assert.deepEqual(terminalSaved.body.saved.listen_hosts, startupHosts);
    const persistedTerminalSettings = JSON.parse(fs.readFileSync(runtimeFile, "utf8")).terminal;
    assert.equal(persistedTerminalSettings.background_mode, "custom");
    assert.equal(persistedTerminalSettings.background_color, "#34abcd");
    console.log("PASS global terminal settings save independently and are normalized");

    const recycleDisabled = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ sftp_recycle_bin_enabled: false })
    });
    assert.equal(recycleDisabled.response.ok, true);
    assert.equal(recycleDisabled.body.saved.sftp_recycle_bin_enabled, false);
    assert.deepEqual(recycleDisabled.body.saved.listen_hosts, startupHosts);
    assert.equal(recycleDisabled.body.saved.listen_port, info.actual_port);
    assert.equal(recycleDisabled.body.saved.terminal.background_mode, "custom");
    assert.equal(recycleDisabled.body.saved.terminal.background_color, "#34abcd");
    assert.equal(recycleDisabled.body.saved.terminal.middle_mouse_action, "open_settings");
    console.log("PASS SFTP recycle setting saves independently without listener validation");

    const floatingProgressDisabled = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ sftp_floating_progress_enabled: false })
    });
    assert.equal(floatingProgressDisabled.response.ok, true);
    assert.equal(floatingProgressDisabled.body.saved.sftp_floating_progress_enabled, false);
    assert.equal(floatingProgressDisabled.body.saved.sftp_recycle_bin_enabled, false);
    assert.equal(floatingProgressDisabled.body.saved.terminal.background_mode, "custom");
    console.log("PASS SFTP floating progress preference saves independently and defaults on");

    const notificationDisplaySaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ notification_display:{
        info:{enabled:false, duration_ms:1500},
        success:{enabled:true, duration_ms:4200},
        error:{enabled:true, duration_ms:12000},
        progress:{enabled:false, success_duration_ms:null, error_duration_ms:10000}
      } })
    });
    assert.equal(notificationDisplaySaved.response.ok, true);
    assert.deepEqual(notificationDisplaySaved.body.saved.notification_display, {
      info:{enabled:false, duration_ms:1500},
      success:{enabled:true, duration_ms:4200},
      error:{enabled:true, duration_ms:12000},
      progress:{enabled:false, success_duration_ms:null, error_duration_ms:10000}
    });
    assert.equal(notificationDisplaySaved.body.saved.sftp_floating_progress_enabled, false);
    console.log("PASS notification category visibility and durations persist independently");

    const editorPolicySaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({
        sftp_text_editor_mode: "auto",
        sftp_light_editor_threshold_mb: 18,
        sftp_external_edit_save_rule: "overwrite",
        sftp_external_edit_backup_enabled: false,
        sftp_download_concurrency: 5,
        sftp_upload_concurrency: 2
      })
    });
    assert.equal(editorPolicySaved.response.ok, true);
    assert.equal(editorPolicySaved.body.saved.sftp_text_editor_mode, "auto");
    assert.equal(editorPolicySaved.body.saved.sftp_light_editor_threshold_mb, 18);
    assert.equal(editorPolicySaved.body.saved.sftp_external_edit_save_rule, "overwrite");
    assert.equal(editorPolicySaved.body.saved.sftp_external_edit_backup_enabled, false);
    assert.equal(editorPolicySaved.body.saved.sftp_download_concurrency, 5);
    assert.equal(editorPolicySaved.body.saved.sftp_upload_concurrency, 2);
    assert.equal(editorPolicySaved.body.saved.sftp_floating_progress_enabled, false);
    console.log("PASS SFTP editor and external-save policies persist independently");

    const generalSaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({ sftp_max_open_file_size_mb: 12, sftp_download_directory:path.join(temporaryRoot, "downloads"), restore_workspace_tabs: false })
    });
    assert.equal(generalSaved.response.ok, true);
    assert.equal(generalSaved.body.saved.sftp_max_open_file_size_mb, 12);
    assert.equal(generalSaved.body.saved.sftp_download_directory, path.join(temporaryRoot, "downloads"));
    assert.equal(generalSaved.body.saved.restore_workspace_tabs, false);
    assert.equal(generalSaved.body.saved.sftp_recycle_bin_enabled, false);
    assert.equal(generalSaved.body.saved.sftp_floating_progress_enabled, false);
    console.log("PASS workspace restore and SFTP open limit save independently");

    const workspaceSaved = await request(base, "/api/runtime-settings", {
      method: "PUT",
      body: JSON.stringify({
        remote_desktop_quick_open_enabled: true,
        vnc_quick_open_new_window: false,
        workspace_toolbar_placement: {
          unsplit:{terminal:"tab", sftp:"header"},
          split:{terminal:"header", sftp:"tab"}
        }
      })
    });
    assert.equal(workspaceSaved.response.ok, true);
    assert.equal(workspaceSaved.body.saved.remote_desktop_quick_open_enabled, true);
    assert.equal(workspaceSaved.body.saved.vnc_quick_open_new_window, false);
    assert.deepEqual(workspaceSaved.body.saved.workspace_toolbar_placement, {
      unsplit:{terminal:"tab", sftp:"header"},
      split:{terminal:"header", sftp:"tab"}
    });
    assert.equal(workspaceSaved.body.saved.restore_workspace_tabs, false);
    assert.equal(workspaceSaved.body.saved.sftp_max_open_file_size_mb, 12);
    assert.equal(workspaceSaved.body.saved.sftp_floating_progress_enabled, false);
    console.log("PASS four workspace toolbar placements persist independently");

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
    assert.equal(saved.body.saved.language, "en-US");
    assert.equal(saved.body.saved.sftp_recycle_bin_enabled, false);
    assert.equal(saved.body.saved.sftp_floating_progress_enabled, false);
    assert.equal(saved.body.saved.sftp_max_open_file_size_mb, 12);
    assert.equal(saved.body.saved.sftp_text_editor_mode, "auto");
    assert.equal(saved.body.saved.sftp_light_editor_threshold_mb, 18);
    assert.equal(saved.body.saved.sftp_external_edit_save_rule, "overwrite");
    assert.equal(saved.body.saved.sftp_external_edit_backup_enabled, false);
    assert.equal(saved.body.saved.sftp_download_concurrency, 5);
    assert.equal(saved.body.saved.sftp_upload_concurrency, 2);
    assert.equal(saved.body.saved.sftp_download_directory, path.join(temporaryRoot, "downloads"));
    assert.equal(saved.body.saved.restore_workspace_tabs, false);
    assert.deepEqual(saved.body.saved.workspace_toolbar_placement, {
      unsplit:{terminal:"tab", sftp:"header"},
      split:{terminal:"header", sftp:"tab"}
    });
    assert.equal(saved.body.saved.terminal.middle_mouse_action, "open_settings");
    assert.equal(saved.body.saved.terminal.background_mode, "custom");
    assert.equal(saved.body.saved.terminal.background_color, "#34abcd");
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
