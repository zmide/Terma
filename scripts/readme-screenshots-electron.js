const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");

const url = process.env.TERMA_README_SCREENSHOT_URL || "http://127.0.0.1:8099";
const outputDirectory = process.env.TERMA_README_SCREENSHOT_DIR || path.join(process.cwd(), ".github", "assets", "screenshots");
const userData = process.env.TERMA_README_SCREENSHOT_USER_DATA || path.join(os.tmpdir(), `terma-readme-screenshots-${process.pid}`);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.setPath("userData", userData);

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function execute(window, callback, ...args) {
  return window.webContents.executeJavaScript(`(${callback.toString()})(${args.map(arg => JSON.stringify(arg)).join(",")})`);
}

async function waitForApp(window) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`Boolean(
      typeof renderConnections === "function"
      && typeof setWorkspace === "function"
      && document.querySelector("#workspaceDock .workspace-pane")
    )`).catch(() => false);
    if (ready) return;
    await delay(50);
  }
  throw new Error("README 截图页面初始化超时");
}

async function loadCleanPage(window, language="zh-CN") {
  try {
    await session.defaultSession.clearStorageData({origins:[url]});
  } catch {}
  await window.loadURL(url);
  await waitForApp(window);
  // Let the page's initial loadAll request settle before replacing it with fixtures.
  // Otherwise the real empty response can arrive after a fixture has rendered.
  await delay(2600);
  await execute(window, prepareBaseFixture, language);
  await delay(100);
}

async function prepareBaseFixture(language="zh-CN") {
  if (typeof setTermaLanguage === "function") await setTermaLanguage(language, {render:false, emit:false});
  const english = language === "en-US";
  window.__readmeScreenshotLanguage = language;
  const text = (zh, en) => english ? en : zh;
  const fixedNow = Math.floor(new Date("2026-08-05T10:00:00+08:00").getTime() / 1000);
  const forwarded = (id, values) => ({
    id,
    connection_id:101,
    restore:1,
    reconnect_count:0,
    updated_at:fixedNow,
    ...values
  });
  if (typeof sftpJobsTimer !== "undefined" && sftpJobsTimer) {
    clearInterval(sftpJobsTimer);
    sftpJobsTimer = null;
  }
  if (typeof notificationPollTimer !== "undefined" && notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
  loadAll = async () => {};
  renderWelcome = () => {};
  const baseApi = async (pathname, options={}) => {
    const value = String(pathname);
    if (value === "/api/connections") return connections;
    if (value === "/api/remote-profiles") return remoteProfiles;
    if (value === "/api/forward-templates") return [];
    if (value === "/api/security") return {};
    if (value === "/api/runtime-settings") return {};
    if (value === "/api/startup-status") return {state:"ready", local_url:location.origin, lan_urls:[]};
    if (value.includes("/api/sftp/jobs")) return [];
    return {};
  };
  window.__readmeBaseApi = baseApi;
  api = async (pathname, options={}) => {
    return window.__readmeBaseApi(pathname, options);
  };
  applyTheme("light");
  localStorage.setItem("theme", "light");
  localStorage.setItem("operationPanePinGuideDismissed", "1");
  remoteDesktopQuickOpen = false;
  connectionSearch = "";
  remoteConnectionSearch = "";
  connectionBulkMode = false;
  connections = [
    {
      id:101,
      name:text("边缘网关", "Edge Gateway"),
      group_name:text("生产环境", "Production"),
      ssh_host:"192.0.2.10",
      ssh_port:22,
      ssh_user:"ops",
      tags:text("Linux 网关", "Linux Gateway"),
      sort_order:1,
      auth_type:"key",
      identity_file:"id_ed25519_ops",
      forwards:[
        forwarded(1001, {mode:"local", service_name:text("运营控制台", "Operations Console"), service_type:"web", service_note:text("仅本机访问", "Local access only"), url_scheme:"http", bind_host:"127.0.0.1", bind_port:18080, target_host:"127.0.0.1", target_port:8080, status:"running", pid:4201, started_at:fixedNow - 7260}),
        forwarded(1002, {mode:"local", service_name:text("数据分析库", "Analytics Database"), service_type:"mysql", service_note:text("只读维护通道", "Read-only maintenance channel"), bind_host:"127.0.0.1", bind_port:13306, target_host:"198.51.100.24", target_port:3306, status:"running", pid:4202, started_at:fixedNow - 3610}),
        forwarded(1003, {mode:"socks", service_name:text("维护代理", "Maintenance Proxy"), service_type:"socks", service_note:text("按需启动", "Start on demand"), bind_host:"127.0.0.1", bind_port:1080, target_host:"127.0.0.1", target_port:0, status:"stopped"})
      ]
    },
    {
      id:102,
      name:text("应用节点", "Application Node"),
      group_name:text("生产环境", "Production"),
      ssh_host:"198.51.100.24",
      ssh_port:22,
      ssh_user:"deploy",
      tags:text("Java 服务", "Java Service"),
      sort_order:2,
      auth_type:"key",
      identity_file:"id_ed25519_deploy",
      forwards:[]
    },
    {
      id:103,
      name:text("macOS 构建机", "macOS Build Host"),
      group_name:text("研发环境", "Development"),
      ssh_host:"203.0.113.18",
      ssh_port:22,
      ssh_user:"demo",
      tags:text("构建 签名", "Build Signing"),
      sort_order:1,
      auth_type:"key",
      identity_file:"id_ed25519_demo",
      forwards:[]
    }
  ];
  remoteProfiles = [
    {id:201, name:text("边缘网关 · RDP", "Edge Gateway · RDP"), group_name:text("生产环境", "Production"), protocol:"rdp", host:"192.0.2.10", port:3389, username:"ops", tags:"Linux", has_password:false, options:{source_ssh_connection_id:101, display_mode:"dynamic"}},
    {id:202, name:text("边缘网关 · VNC", "Edge Gateway · VNC"), group_name:text("生产环境", "Production"), protocol:"vnc", host:"192.0.2.10", port:5900, username:"ops", tags:"Linux", has_password:true, options:{source_ssh_connection_id:101, client_mode:"system", server_session_mode:"shared", server_display:":0"}},
    {id:203, name:text("应用节点 · XDMCP", "Application Node · XDMCP"), group_name:text("生产环境", "Production"), protocol:"xdmcp", host:"198.51.100.24", port:177, username:"", tags:"Linux", has_password:false, options:{source_ssh_connection_id:102, mode:"direct", window_mode:"windowed"}},
    {id:204, name:text("macOS 构建机 · VNC", "macOS Build Host · VNC"), group_name:text("研发环境", "Development"), protocol:"vnc", host:"203.0.113.18", port:5900, username:"demo", tags:"macOS", has_password:true, options:{source_ssh_connection_id:103, client_mode:"system"}}
  ];
  selectedId = 101;
  selectedRemoteProfileId = null;
  primaryView = "connections";
  groupOpen.clear();
  groupOpen.add(text("生产环境", "Production"));
  groupOpen.add(text("研发环境", "Development"));
  remoteGroupOpen.clear();
  remoteGroupOpen.add(text("生产环境", "Production"));
  remoteGroupOpen.add(text("研发环境", "Development"));
  remoteHostOpen.clear();
  remoteProfiles.forEach(profile => remoteHostOpen.add(remoteHostKey(profile)));
  healthResults.clear();
  healthResults.set(101, {id:101, ok:true, status:text("正常", "Healthy")});
  healthResults.set(102, {id:102, ok:true, status:text("正常", "Healthy")});
  healthResults.set(103, {id:103, ok:true, status:text("正常", "Healthy")});
  if (typeof setOperationPanePinned === "function") setOperationPanePinned(true);
  if (typeof setOperationPaneCollapsed === "function") setOperationPaneCollapsed(false);
  if (typeof applyOperationPaneWidth === "function") applyOperationPaneWidth(338, {fit:false});
  if (typeof applyActivityBarWidth === "function") applyActivityBarWidth(48, {fit:false});
  document.querySelector("#operationPanePinGuide")?.setAttribute("hidden", "");
  document.querySelector("#toast")?.replaceChildren();
  const notice = document.querySelector("#notice");
  if (notice) notice.replaceChildren();
  const modal = document.querySelector("#modal");
  if (modal) {
    modal.hidden = true;
    modal.replaceChildren();
  }
  const taskDrawer = document.querySelector("#sftpTaskCenterDrawer");
  if (taskDrawer) taskDrawer.hidden = true;
  const taskFloat = document.querySelector("#sftpTaskFloat");
  if (taskFloat) taskFloat.hidden = true;
  const taskSummary = document.querySelector("#sftpTaskCenterSummary");
  if (taskSummary) taskSummary.textContent = text("暂无进行中的任务", "No active tasks");
  const taskClear = document.querySelector("#sftpTaskCenterClearLabel");
  if (taskClear) taskClear.textContent = text("清空历史", "Clear history");
  const style = document.createElement("style");
  style.id = "readmeScreenshotStyle";
  style.textContent = `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    .notification-stack, #notice, .operation-pane-pin-guide, .sftp-task-float { display: none !important; }
  `;
  document.head.appendChild(style);
  renderExplorerTools();
  renderConnections();
  refreshIcons();
  return {connections:connections.length, remoteProfiles:remoteProfiles.length};
}

async function buildOverviewFixture() {
  api = async (pathname, options={}) => {
    const value = String(pathname);
    if (value === "/api/connections/101/inspect") {
      return {
        ok:true,
        output:[
          "## system",
          "Linux edge-gateway 6.8.0 x86_64",
          "## os",
          "Ubuntu 24.04 LTS",
          "## uptime",
          "12 days · load average 0.18 / 0.22 / 0.20",
          "## memory",
          "7.8 GiB total · 3.1 GiB used · 4.2 GiB available",
          "## disk",
          "/dev/vda1  96G total  34G used  58G available",
          "## ports",
          "22/ssh · 8080/application · 5900/vnc"
        ].join("\n")
      };
    }
    if (value === "/api/startup-status") return {state:"ready", local_url:location.origin, lan_urls:[]};
    return window.__readmeBaseApi(pathname, options);
  };
  primaryView = "connections";
  renderExplorerTools();
  renderConnections();
  await openServerDashboard(101, true);
  refreshIcons();
  return {title:document.querySelector("#workspaceTitle")?.textContent || ""};
}

async function buildTerminalFixture() {
  const readmeText = (zh, en) => window.__readmeScreenshotLanguage === "en-US" ? en : zh;
  primaryView = "connections";
  renderExplorerTools();
  renderConnections();
  connectTerminal = async () => {};
  await ensureTerminalGlobalSettings();
  await ensureTerminalLibs();
  const key = openTerminal(101, true);
  let terminal = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    terminal = terminalSessions.get(key);
    if (terminal?.term) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!terminal?.term) throw new Error("终端组件未创建");
  terminal.connected = true;
  terminal.currentDirectory = "/srv/terma";
  terminal.currentDirectoryKnown = true;
  updateTerminalConnectionStatus(connections[0], key, readmeText("已连接", "Connected"));
  terminal.term.clear();
  const lines = [
    "\u001b[32mops@edge-gateway\u001b[0m:\u001b[34m/srv/terma\u001b[0m$ terma doctor",
    "",
    "  SSH connection       \u001b[32mready\u001b[0m    18 ms",
    "  SFTP subsystem       \u001b[32mready\u001b[0m",
    "  Port forwarding      \u001b[32m2 running\u001b[0m",
    "  Linux desktop        \u001b[32mXFCE detected\u001b[0m",
    "  Remote graphics      RDP / VNC / XDMCP available",
    "",
    "\u001b[32mops@edge-gateway\u001b[0m:\u001b[34m/srv/terma\u001b[0m$ systemctl --user status terma-agent",
    "\u001b[32m●\u001b[0m terma-agent.service - Terma remote helper",
    "     Loaded: loaded",
    "     Active: \u001b[32mactive (running)\u001b[0m",
    "",
    "\u001b[32mops@edge-gateway\u001b[0m:\u001b[34m/srv/terma\u001b[0m$ "
  ];
  lines.forEach(line => terminal.term.writeln(line));
  terminal.term.focus();
  refreshIcons();
  return {key, rows:terminal.term.rows};
}

async function buildSftpFixture() {
  const stamp = value => Math.floor(new Date(value).getTime() / 1000);
  api = async (pathname, options={}) => {
    const value = String(pathname);
    if (value.includes("/sftp/session") && options.method === "POST") return {connected:true, status:"connected"};
    if (value.startsWith("/api/connections/101/sftp?")) {
      return {
        path:"/srv/terma",
        page:1,
        page_size:50,
        total:10,
        total_pages:1,
        unfiltered_total:10,
        entries:[
          {name:"config", type:"dir", size:0, mtime:stamp("2026-08-05T09:12:00+08:00"), mode:"755", owner:"ops", group:"ops"},
          {name:"logs", type:"dir", size:0, mtime:stamp("2026-08-05T09:30:00+08:00"), mode:"755", owner:"ops", group:"ops"},
          {name:"releases", type:"dir", size:0, mtime:stamp("2026-08-05T09:48:00+08:00"), mode:"755", owner:"deploy", group:"ops"},
          {name:"backup", type:"dir", size:0, mtime:stamp("2026-08-04T18:20:00+08:00"), mode:"750", owner:"ops", group:"ops"},
          {name:"terma.yml", type:"file", size:3842, mtime:stamp("2026-08-05T09:43:00+08:00"), mode:"640", owner:"ops", group:"ops"},
          {name:"deploy.sh", type:"file", size:2176, mtime:stamp("2026-08-05T09:44:00+08:00"), mode:"750", owner:"deploy", group:"ops"},
          {name:"README.md", type:"file", size:9214, mtime:stamp("2026-08-05T08:16:00+08:00"), mode:"644", owner:"ops", group:"ops"},
          {name:"terma-1.3.0-linux-x64.tar.gz", type:"file", size:128974336, mtime:stamp("2026-08-05T09:47:00+08:00"), mode:"644", owner:"deploy", group:"ops"},
          {name:"health-check.log", type:"file", size:182144, mtime:stamp("2026-08-05T09:52:00+08:00"), mode:"640", owner:"ops", group:"ops"},
          {name:"inventory.json", type:"file", size:12618, mtime:stamp("2026-08-05T09:26:00+08:00"), mode:"640", owner:"ops", group:"ops"}
        ]
      };
    }
    if (value.includes("/api/sftp/jobs")) return [];
    return window.__readmeBaseApi(pathname, options);
  };
  primaryView = "connections";
  renderExplorerTools();
  renderConnections();
  await openSftp(101, "/srv/terma", true, "sftp-readme");
  await new Promise(resolve => setTimeout(resolve, 160));
  refreshIcons();
  return {rows:document.querySelectorAll("#view-sftp .sftp-row").length};
}

async function buildRemoteFixture() {
  const readmeText = (zh, en) => window.__readmeScreenshotLanguage === "en-US" ? en : zh;
  const rendering = {
    visible:true,
    state:"hardware",
    protocol:"vnc",
    backend:"x11vnc -> Xorg",
    source_display:":0",
    drm_device:"/dev/dri/renderD128",
    drm_device_available:true,
    software_rendering:false,
    java_gui_risk:false,
    summary:readmeText("远程桌面已准备就绪", "Remote desktop is ready"),
    detail:readmeText("当前使用物理桌面会话，图形加速可用。", "The physical desktop session is active with hardware rendering available."),
    compatibility_commands:[
      {id:"java2d", label:"Java2D", command:"java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -jar /srv/terma/demo.jar"},
      {id:"java2d-safe", label:readmeText("Java2D 安全模式", "Java2D safe mode"), command:"NO_J2D_MITSHM=true java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -Dsun.java2d.pmoffscreen=false -jar /srv/terma/demo.jar"},
      {id:"javafx", label:"JavaFX", command:"java -Dprism.order=sw -jar /srv/terma/demo.jar"}
    ]
  };
  const selectedComponent = {
    id:"x11vnc",
    label:readmeText("x11vnc", "x11vnc"),
    installed:true,
    running:true,
    listening:true,
    install_required:false,
    service_unit:"terma-vnc.service",
    service_state:"active",
    listener_process:"/usr/bin/x11vnc -display :0 -rfbport 5900"
  };
  const diagnostics = {
    platform:"linux",
    diagnostics_available:true,
    status:"ready",
    installed:true,
    listening:true,
    port:5900,
    service_unit:"terma-vnc.service",
    service_state:"active",
    listener_process:selectedComponent.listener_process,
    server_session_configurable:true,
    server_mode:"shared-x11",
    source_display:":0",
    source_xrdp:false,
    vnc_process:"x11vnc -display :0 -rfbport 5900",
    server_session_selection:{
      requested_mode:"shared",
      mode:"shared",
      display:":0",
      source:{kind:"physical", display:":0", user:"ops", desktop:"XFCE"},
      source_available:true,
      requires_selection:false,
      component:"x11vnc",
      install_required:false,
      component_state:selectedComponent
    },
    selected_component:selectedComponent,
    running_component:selectedComponent,
    server_session_selection_matches_running:true,
    session_sources:[
      {kind:"physical", display:":0", user:"ops", desktop:"XFCE", state:"active"},
      {kind:"xrdp", display:":10", user:"ops", desktop:"XFCE", state:"active"}
    ],
    xrdp_software_rendering:false,
    start_plan:{kind:"service", command:"systemctl restart terma-vnc.service", persistent:true},
    ssh_connection:{id:101, name:readmeText("边缘网关", "Edge Gateway")},
    graphics_rendering:rendering
  };
  api = async (pathname, options={}) => {
    const value = String(pathname);
    if (value === "/api/remote-clients/diagnostics") return {vnc:{available:true, launchable:true, client:readmeText("系统 VNC 客户端", "System VNC client")}, rdp:{available:true}, xdmcp:{available:true}};
    if (value === "/api/remote-profiles/202/vnc/server") return diagnostics;
    if (value === "/api/connections/101/linux-desktop") return {platform_supported:true, os_id:"ubuntu", has_desktop:true, desktops:[{id:"xfce", name:"XFCE"}]};
    return window.__readmeBaseApi(pathname, options);
  };
  primaryView = "remote";
  renderExplorerTools();
  renderConnections();
  await openRemoteDesktop(202, true, true);
  await new Promise(resolve => setTimeout(resolve, 120));
  refreshIcons();
  return {source:document.querySelector("#vnc_server_session_source_202")?.value || ""};
}

async function buildLinuxManagementFixture() {
  const readmeText = (zh, en) => window.__readmeScreenshotLanguage === "en-US" ? en : zh;
  const diagnostics = {
    platform_supported:true,
    privileged:true,
    os_id:"ubuntu",
    package_manager:"apt",
    display_manager:"lightdm",
    has_desktop:true,
    connection:{id:101, name:readmeText("边缘网关", "Edge Gateway")},
    desktops:[{id:"xfce", name:"XFCE"}, {id:"plasma", name:"KDE Plasma"}],
    installable_desktops:["xfce", "gnome", "plasma", "mate", "cinnamon", "lxqt"],
    desktop_catalog:[
      {id:"xfce", label:"XFCE", icon:"layout-grid"},
      {id:"gnome", label:"GNOME", icon:"panels-top-left"},
      {id:"plasma", label:"KDE Plasma", icon:"monitor"},
      {id:"mate", label:"MATE", icon:"panels-top-left"},
      {id:"cinnamon", label:"Cinnamon", icon:"apple"},
      {id:"lxqt", label:"LXQt", icon:"layout-grid"}
    ],
    desktop_selection:{
      system_default:{session:{desktop_id:"xfce", name:"XFCE"}},
      account_default:{session:{desktop_id:"xfce", name:"XFCE"}},
      xdmcp:{state:"configured", session:{desktop_id:"plasma", name:"KDE Plasma"}},
      rdp:{state:"configured", session:{desktop_id:"xfce", name:"XFCE"}},
      vnc:{state:"configured", session:{desktop_id:"xfce", name:"XFCE"}}
    },
    active_graphical_sessions:[{desktop_id:"xfce", display:":0", user:"ops", local:true}],
    active_vnc_sessions:[{desktop_id:"xfce", display:":0", shared:true, virtual:false}],
    desktop_usage:{
      xfce:{system_default:true, account_default:true, rdp_configured:true, local_active:true, vnc_shared:true},
      plasma:{xdmcp_configured:true}
    }
  };
  const sshX11 = {
    platform:"linux",
    ready:true,
    enabled:true,
    x11_forwarding:"yes",
    xauth_available:true,
    xauth_path:"/usr/bin/xauth",
    xauth_location:"/usr/bin/xauth",
    xauth_location_valid:true,
    x11_display_offset:"10",
    sshd_present:true,
    config_file:"/etc/ssh/sshd_config",
    can_manage:true
  };
  api = async (pathname, options={}) => {
    const value = String(pathname);
    if (value === "/api/connections/101/linux-desktop") return diagnostics;
    if (value === "/api/connections/101/x11-forwarding") return sshX11;
    if (value === "/api/linux-desktop/tasks") return [];
    return window.__readmeBaseApi(pathname, options);
  };
  primaryView = "remote";
  renderExplorerTools();
  renderConnections();
  openLinuxDesktopManager(101, true);
  await new Promise(resolve => setTimeout(resolve, 180));
  refreshIcons();
  return {cards:document.querySelectorAll(".linux-desktop-card").length};
}

async function buildForwardingFixture() {
  primaryView = "running";
  renderExplorerTools();
  renderConnections();
  globalForwardManagerState.groupMode = "ssh";
  globalForwardManagerState.query = "";
  globalForwardManagerState.status = "all";
  globalForwardManagerState.connectionId = 0;
  openGlobalForwardManager(true);
  renderGlobalForwardManager();
  refreshIcons();
  return {cards:document.querySelectorAll(".global-forward-card").length, groups:document.querySelectorAll(".global-forward-group").length};
}

async function capture(window, filename, language) {
  await delay(160);
  const audit = await window.webContents.executeJavaScript(`(() => {
    const pane = document.querySelector(".workspace-pane.focused")
      || document.querySelector(".workspace-pane");
    const visibleView = pane
      ? [...pane.querySelectorAll(":scope > .workspace > .view")].find(view => !view.hidden)
      : null;
    const visibleText = document.body.innerText || "";
    const forbidden = [
      ["legacy brand", /TunnelDesk|\\bTD\\b/i],
      ["private address", /192\\.168\\.31\\./i],
      ["local user path", /[A-Z]:\\\\Users\\\\[^\\\\\\s]+/i],
      ["credential assignment", /(?:password|passphrase|token|secret)\\s*[:=]\\s*\\S+/i],
      ["legacy package", /tunneldesk-[0-9]/i]
    ].filter(([, pattern]) => pattern.test(visibleText)).map(([label]) => label);
    const languageIssues = ${JSON.stringify(language)} === "en-US"
      ? [...document.querySelectorAll("body *")].filter(node => {
          if (node.closest(".xterm-screen")) return false;
          const text = node.textContent || "";
          return text && /[\u3400-\u9fff]/.test(text) && [...node.children].every(child => !child.textContent?.trim());
        }).slice(0, 12).map(node => node.textContent.trim().slice(0, 80))
      : [];
    const chineseLanguageIssues = ${JSON.stringify(language)} === "zh-CN"
      ? [...document.querySelectorAll("body *")].filter(node => {
          if (node.closest(".xterm-screen")) return false;
          const text = (node.textContent || "").trim();
          if (!text || [...node.children].some(child => child.textContent?.trim())) return false;
          return /\b(?:Workspace|Forwarding List|Manage all forwards|Refresh status|Restore tunnels|Add forwarding rule|Running|Reconnecting|Failed to start|Stopped|All statuses|All servers|Group by SSH connection|Search names|Server rules|Linux desktop management|Detect again|Remote desktop is ready|System VNC client|No active tasks|Clear history|Connected|Healthy|Previous|Next|Items per page)\b/i.test(text);
        }).slice(0, 12).map(node => node.textContent.trim().slice(0, 80))
      : [];
    const expected = {
      "desktop-overview.png":visibleView?.id === "view-dashboard" && visibleView.querySelectorAll(".dashboard-card").length >= 6,
      "desktop-terminal.png":visibleView?.id === "view-terminal" && Boolean(visibleView.querySelector(".xterm-screen")),
      "desktop-remote.png":visibleView?.id === "view-remote-desktop" && Boolean(visibleView.querySelector(".vnc-connection-help-panel")),
      "desktop-sftp.png":visibleView?.id === "view-sftp" && visibleView.querySelectorAll(".sftp-row").length >= 5,
      "desktop-linux-management.png":visibleView?.id === "view-linux-desktop" && visibleView.querySelectorAll(".linux-desktop-card").length >= 6,
      "desktop-forwarding.png":visibleView?.id === "view-forward-manager" && visibleView.querySelectorAll(".global-forward-card").length >= 3 && Boolean(visibleView.querySelector(".global-forward-grouped-list"))
    }[${JSON.stringify(filename)}];
    return {
      title:document.title,
      width:innerWidth,
      height:innerHeight,
      bodyWidth:document.body.scrollWidth,
      overflow:document.body.scrollWidth > innerWidth + 1,
      forbidden,
      languageIssues,
      chineseLanguageIssues,
      expected,
      activeTabKey:typeof activeTabKey === "string" ? activeTabKey : "",
      activeView:typeof activeView === "string" ? activeView : "",
      paneActiveTabKey:pane?.querySelector(".tab.active")?.dataset.tabKey || "",
      visibleView:visibleView?.id || "",
      brand:document.querySelector('.brand h1')?.getAttribute('aria-label') || '',
      icon:document.querySelector('.brand-mark')?.getAttribute('src') || ''
    };
  })()`);
  if (!(audit.title === "Terma" || audit.title.endsWith(" · Terma")) || audit.brand !== "Terma" || !audit.icon.includes("terma-icon")) {
    throw new Error(`${filename} 品牌核对失败：${JSON.stringify(audit)}`);
  }
  if (audit.overflow) throw new Error(`${filename} 出现页面横向溢出：${JSON.stringify(audit)}`);
  if (audit.forbidden.length) throw new Error(`${filename} 含不应出现在截图中的内容：${audit.forbidden.join(", ")}`);
  if (audit.languageIssues.length) throw new Error(`${filename} 英文界面含中文残留：${audit.languageIssues.join(" | ")}`);
  if (audit.chineseLanguageIssues.length) throw new Error(`${filename} 中文界面含英文残留：${audit.chineseLanguageIssues.join(" | ")}`);
  if (!audit.expected) throw new Error(`${filename} 未呈现预期功能界面：${JSON.stringify(audit)}`);
  window.webContents.invalidate();
  await delay(100);
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  if (size.width < 1500 || size.height < 900) throw new Error(`${filename} 截图尺寸异常：${size.width}x${size.height}`);
  fs.mkdirSync(outputDirectory, {recursive:true});
  fs.writeFileSync(path.join(outputDirectory, filename), image.toPNG());
  console.log(`[readme-screenshots] ${language}/${filename} ${size.width}x${size.height}`);
}

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  const window = new BrowserWindow({
    show:false,
    width:1600,
    height:1000,
    useContentSize:true,
    backgroundColor:"#ffffff",
    webPreferences:{contextIsolation:true, offscreen:true, backgroundThrottling:false}
  });
  try {
    const language = process.env.TERMA_README_SCREENSHOT_LANGUAGE || "zh-CN";
    const states = [
      ["desktop-overview.png", buildOverviewFixture],
      ["desktop-terminal.png", buildTerminalFixture],
      ["desktop-remote.png", buildRemoteFixture],
      ["desktop-sftp.png", buildSftpFixture],
      ["desktop-linux-management.png", buildLinuxManagementFixture],
      ["desktop-forwarding.png", buildForwardingFixture]
    ];
    for (const [filename, builder] of states) {
      await loadCleanPage(window, language);
      const result = await execute(window, builder);
      console.log(`[readme-screenshots] rendered ${filename}: ${JSON.stringify(result)}`);
      await capture(window, filename, language);
    }
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    window.destroy();
    app.exit(1);
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
