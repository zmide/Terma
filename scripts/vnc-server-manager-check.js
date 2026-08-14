"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readSources } = require("./backend-source");
const {
  DETECT_SCRIPT,
  buildVncStartCommand,
  buildDetectionScript,
  detectVncServer,
  manualGuide,
  packagePlan,
  parseDetectionOutput,
  vncServerComponentState,
  validateVncServerComponent,
  vncServerStartValidation,
  resolveVncServerSessionSelection,
  applyVncServerSessionSelection,
  componentPlanningDiagnostics,
  startPlan,
  startPlanReason,
  stopPlan,
  uninstallPlan
} = require("../dist/vnc-server-manager");
const legacyPrefix = ["T", "D"].join("");

assert.ok(DETECT_SCRIPT.includes("TERMA_VNC_"));
assert.equal(DETECT_SCRIPT.includes(`${legacyPrefix}_VNC_`), false);

const missing = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_OS_ID=ubuntu",
  "TERMA_VNC_KERNEL=Linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_UID=1000",
  "TERMA_VNC_PRIVILEGED=0",
  "TERMA_VNC_INSTALLED=0",
  "TERMA_VNC_SERVICE_STATE=missing",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_FIREWALL=none",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(missing.status, "not-installed");
assert.equal(missing.can_install, true);
const legacyMissing = parseDetectionOutput([
  `${legacyPrefix}_VNC_PLATFORM=linux`,
  `${legacyPrefix}_VNC_OS_ID=ubuntu`,
  `${legacyPrefix}_VNC_INSTALLED=0`,
  `${legacyPrefix}_VNC_SERVICE_STATE=missing`,
  `${legacyPrefix}_VNC_PORT=5900`
].join("\n"));
assert.equal(legacyMissing.status, "not-installed");
const currentVncPrefixWins = parseDetectionOutput(`${legacyPrefix}_VNC_PLATFORM=macos\nTERMA_VNC_PLATFORM=linux\nTERMA_VNC_PORT=5900`);
assert.equal(currentVncPrefixWins.platform, "linux");
const missingPackages = packagePlan(missing);
assert.match(missingPackages.command, /apt-get install -y tigervnc-standalone-server/);
assert.equal(missingPackages.server_mode, "virtual-session");
assert.equal(missingPackages.component_plan.online.available, true);
assert.equal(missingPackages.component_plan.offline.available, true);
assert.match(missingPackages.component_plan.offline.command, /--no-download/);
assert.match(manualGuide(missing, 5900).commands.join("\n"), /vncserver :1 -rfbport 5900/);
assert.doesNotMatch(manualGuide(missing, 5900).commands.join("\n"), /x11vnc -display/);

const missingSharedSession = packagePlan({...missing, session_active:true, display:":0"});
assert.match(missingSharedSession.command, /apt-get install -y x11vnc/);
assert.equal(missingSharedSession.server_mode, "shared-session");
assert.match(manualGuide({...missing, session_active:true, display:":0"}, 5900).commands.join("\n"), /x11vnc -display/);

const stopped = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_OS_ID=fedora",
  "TERMA_VNC_KERNEL=Linux",
  "TERMA_VNC_PACKAGE_MANAGER=dnf",
  "TERMA_VNC_UID=0",
  "TERMA_VNC_PRIVILEGED=1",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=x11vnc,Xtigervnc",
  "TERMA_VNC_PACKAGES=x11vnc",
  "TERMA_VNC_SERVICE_UNIT=x11vnc.service",
  "TERMA_VNC_SERVICE_STATE=inactive",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_FIREWALL=none",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(stopped.status, "stopped");
assert.equal(stopped.root, true);
assert.deepEqual(stopped.commands, ["x11vnc", "Xtigervnc"]);
assert.equal(startPlan(stopped).unit, "x11vnc.service");
assert.match(startPlan(stopped).command, /systemctl start 'x11vnc\.service'/);
assert.match(stopPlan(stopped, "stop").command, /systemctl stop 'x11vnc\.service'/);
assert.match(stopPlan(stopped, "disable").command, /disable --now 'x11vnc\.service'/);
assert.match(uninstallPlan(stopped).command, /dnf remove/);

const sessionStopped = {
  ...stopped,
  service_unit:"",
  service_state:"manual",
  commands:["x11vnc"],
  display:":0",
  xauthority:"/run/user/1000/gdm/Xauthority",
  session_user:"operator",
  session_home:"/home/operator",
  session_active:true,
  password_file:""
};
const pendingSessionStart = startPlan(sessionStopped);
assert.equal(pendingSessionStart.kind, "x11vnc-session");
assert.equal(pendingSessionStart.requires_vnc_password, false);
assert.equal(pendingSessionStart.supports_no_password, true);
const generatedStart = buildVncStartCommand(sessionStopped, "temporary-vnc-secret");
assert.match(generatedStart, /terma-x11vnc\.service/);
assert.match(generatedStart, /DISPLAY|display :0|-display :0/);
assert.match(generatedStart, /-rfbauth \/home\/operator\/\.vnc\/passwd/);
assert.doesNotMatch(generatedStart, /temporary-vnc-secret/, "VNC 密码不得以明文写入远端脚本");

const passwordlessSessionStart = buildVncStartCommand(sessionStopped, "", {allow_no_password:true});
assert.match(passwordlessSessionStart, /x11vnc .* -nopw .* -rfbport 5900/);
assert.doesNotMatch(passwordlessSessionStart, /-rfbauth/);

const greeterOnly = {
  ...sessionStopped,
  session_active:false,
  commands:["x11vnc", "vncserver", "vncpasswd"],
  desktop_command:"startxfce4",
  password_file:"/home/operator/.vnc/passwd",
  firewall:"none",
  firewall_tool:"none",
  port:5900
};
const headlessPlan = startPlan(greeterOnly);
assert.equal(headlessPlan.kind, "tigervnc-systemd", "greeter :0 不得误判为可共享的用户桌面");
assert.equal(headlessPlan.unit, "terma-tigervnc-1.service");
assert.equal(headlessPlan.persistent, true);
assert.equal(headlessPlan.autostart, true);
assert.equal(headlessPlan.managed, true);
const headlessStart = buildVncStartCommand(greeterOnly, "", {allow_no_password:true});
const savedPasswordFallbackStart = buildVncStartCommand(greeterOnly);
assert.match(savedPasswordFallbackStart, /-SecurityTypes VncAuth -PasswordFile/);
assert.doesNotMatch(savedPasswordFallbackStart, /-SecurityTypes None/);
assert.match(headlessStart, /vncserver :1 -rfbport 5900/, "无活动用户桌面时应创建独立 :1 会话并保持配置端口");
assert.match(headlessStart, /terma-tigervnc-1\.service/);
assert.match(headlessStart, /Type=simple/);
assert.match(headlessStart, /ExecStart=\/usr\/local\/libexec\/terma-tigervnc-1/);
assert.match(headlessStart, /mktemp \/tmp\/terma-tigervnc-unit\.XXXXXX/);
assert.doesNotMatch(headlessStart, /mktemp \/run\/terma-tigervnc-/);
assert.match(headlessStart, /vncserver .* -SecurityTypes None --I-KNOW-THIS-IS-INSECURE/);
assert.match(headlessStart, /vncserver -help .*\[-\]fg/);
assert.match(headlessStart, /terma-tigervnc-tools\.XXXXXX/, "TigerVNC 启动应为缺少 FQDN 的主机提供局部 hostname 回退");
assert.match(headlessStart, /ln -s .*td_vnc_wrapper_bin/, "TigerVNC 包装器应从兼容工具目录启动，以便其内部 hostname 探测使用回退");
assert.match(headlessStart, /hostname -f|--fqdn|terma\.local/, "hostname 回退应覆盖 vncserver 的 FQDN 检查");
assert.doesNotMatch(headlessStart, /PIDFile=/);
assert.match(headlessStart, /User=operator/);
assert.match(headlessStart, /WorkingDirectory=\/home\/operator/);
assert.doesNotMatch(headlessStart, /WorkingDirectory="/);
assert.match(headlessStart, /Environment="HOME=\/home\/operator"/);
assert.match(headlessStart, /chown -R 'operator' '\/home\/operator\/\.vnc'/, "TigerVNC 的 .vnc 目录必须归目标桌面用户所有");
assert.match(headlessStart, /chmod 700 '\/home\/operator\/\.vnc'/, "TigerVNC 的 .vnc 目录必须保持仅用户可访问");
assert.match(headlessStart, /WantedBy=multi-user\.target/);
assert.match(headlessStart, /systemctl enable 'terma-tigervnc-1\.service'/);
assert.match(headlessStart, /systemctl restart 'terma-tigervnc-1\.service'/);
assert.match(headlessStart, /dbus-run-session -- startxfce4/);
assert.doesNotMatch(headlessStart, /runuser -u/);
assert.doesNotMatch(headlessStart, /ufw allow|firewall-cmd/, "disabled firewalls must not add a port-opening command");
assert.doesNotMatch(headlessStart, /temporary-vnc-secret/);
assert.equal(vncServerStartValidation({
  target_component:"tigervnc",
  commands:["vncserver"],
  tiger_wrapper_command:"vncserver",
  packages:["tigervnc-standalone-server"],
  service_unit:"tunneldesk-tigervnc-1.service",
  service_state:"failed",
  service_result:"exit-code",
  service_exec_status:1,
  service_log:"hostname: Name or service not known\nvncserver: Could not acquire fully qualified host name of this machine."
}, "tigervnc"), "TigerVNC 启动失败：远端主机无法解析自身的完整主机名（hostname -f）。已加入不修改 /etc/hosts 的兼容回退；请重新应用并启动 VNC 配置。");
assert.equal(vncServerStartValidation({
  target_component:"tigervnc",
  commands:["vncserver"],
  tiger_wrapper_command:"vncserver",
  packages:["tigervnc-standalone-server"],
  session_user:"root",
  desktop_command:"startplasma-x11",
  service_unit:"tunneldesk-tigervnc-1.service",
  service_state:"failed",
  service_result:"exit-code",
  service_log:"Session startup exited too early"
}, "tigervnc"), "TigerVNC 当前尝试以 root 启动 startplasma-x11，该桌面通常不支持 root 图形会话；请把 VNC 的 SSH 管理连接改为普通 Linux 账号，或安装并选择 XFCE 后重试");
const passwordHeadlessStart = buildVncStartCommand(greeterOnly, "temporary-vnc-secret");
assert.match(passwordHeadlessStart, /-SecurityTypes VncAuth -PasswordFile '\/home\/operator\/\.vnc\/passwd'/);
assert.match(passwordHeadlessStart, /x11vnc -storepasswd/);
assert.doesNotMatch(passwordHeadlessStart, /temporary-vnc-secret/);
assert.equal(buildVncStartCommand(greeterOnly, "", {allow_no_password:true}), headlessStart, "重复生成的 TigerVNC 服务配置应保持幂等");
const taintedTigerWrapper = {
  ...greeterOnly,
  target_component:"tigervnc",
  tiger_wrapper_command:"vncserver; echo TERMA_INJECTED"
};
assert.equal(vncServerComponentState(taintedTigerWrapper, "tigervnc").wrapper_available, false);
assert.equal(startPlan(taintedTigerWrapper), null, "non-whitelisted TigerVNC wrapper names must not create a start plan");
assert.equal(buildVncStartCommand(taintedTigerWrapper, "", {allow_no_password:true}), "", "non-whitelisted TigerVNC wrapper names must not reach the privileged shell command");
const wrapperProbeFixture = [
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_OS_ID=debian",
  "TERMA_VNC_KERNEL=Linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_UID=1000",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=vncserver,vncpasswd,Xtigervnc",
  "TERMA_VNC_PACKAGES=tigervnc-standalone-server,tigervnc-common",
  "TERMA_VNC_SERVICE_STATE=manual",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_DESKTOP_COMMAND=startxfce4",
  "TERMA_VNC_PORT=5900"
];
const parsedTigerWrapper = parseDetectionOutput(wrapperProbeFixture.concat([
  "TERMA_VNC_TIGER_WRAPPER_COMMAND=vncserver",
  "TERMA_VNC_TIGER_WRAPPER_KIND=tigervnc"
]).join("\n"));
assert.equal(parsedTigerWrapper.tiger_wrapper_command, "vncserver");
assert.equal(vncServerComponentState(parsedTigerWrapper, "tigervnc").wrapper_available, true);
const parsedEmptyTigerWrapper = parseDetectionOutput(wrapperProbeFixture.concat([
  "TERMA_VNC_TIGER_WRAPPER_COMMAND=",
  "TERMA_VNC_TIGER_WRAPPER_KIND=unknown"
]).join("\n"));
assert.equal(vncServerComponentState(parsedEmptyTigerWrapper, "tigervnc").wrapper_available, false, "an explicit empty probe result must override the legacy command-list fallback");
const parsedTaintedTigerWrapper = parseDetectionOutput(wrapperProbeFixture.concat([
  "TERMA_VNC_TIGER_WRAPPER_COMMAND=vncserver; echo TERMA_INJECTED",
  "TERMA_VNC_TIGER_WRAPPER_KIND=tigervnc"
]).join("\n"));
assert.equal(parsedTaintedTigerWrapper.tiger_wrapper_command, "");
assert.equal(buildVncStartCommand({...parsedTaintedTigerWrapper, target_component:"tigervnc"}, "", {allow_no_password:true}), "");
assert.doesNotMatch(manualGuide(greeterOnly, 5900).commands.join("\n"), /ufw allow|firewall-cmd/, "防火墙未启用时不得生成开放端口命令");

const restrictedSystemctl = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_OS_ID=linx",
  "TERMA_VNC_KERNEL=Linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_UID=1100",
  "TERMA_VNC_PRIVILEGED=0",
  "TERMA_VNC_INIT_SYSTEM=systemd",
  "TERMA_VNC_SYSTEMD_AVAILABLE=1",
  "TERMA_VNC_SYSTEMCTL_PATH=/bin/systemctl",
  "TERMA_VNC_SYSTEMCTL_USABLE=0",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=vncserver,tigervncserver,vncpasswd,Xtigervnc",
  "TERMA_VNC_PACKAGES=tigervnc-standalone-server,tigervnc-common",
  "TERMA_VNC_SERVICE_STATE=manual",
  "TERMA_VNC_SERVICE_ENABLED=0",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_FIREWALL=none",
  "TERMA_VNC_SESSION_USER=ha2",
  "TERMA_VNC_SESSION_HOME=/home/h-a2/vl/home",
  "TERMA_VNC_SESSION_ACTIVE=0",
  "TERMA_VNC_DISPLAY=:0",
  "TERMA_VNC_PASSWORD_FILE=/home/h-a2/vl/home/.vnc/passwd",
  "TERMA_VNC_DESKTOP_COMMAND=mate-session",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(restrictedSystemctl.systemd_available, true);
assert.equal(restrictedSystemctl.systemctl_path, "/bin/systemctl");
assert.equal(restrictedSystemctl.systemctl_usable, false);
assert.equal(restrictedSystemctl.service_enabled, false);
assert.equal(startPlan(restrictedSystemctl).kind, "tigervnc-systemd", "systemctl only executable by root must remain manageable through temporary authorization");
const restrictedStart = buildVncStartCommand(restrictedSystemctl, "", {allow_no_password:true});
assert.match(restrictedStart, /'\/bin\/systemctl' daemon-reload/);
assert.match(restrictedStart, /terma-tigervnc-1\.service/);

const nonSystemd = {...restrictedSystemctl, init_system:"openrc", systemd_available:false, systemctl_path:""};
assert.equal(startPlan(nonSystemd), null, "non-systemd hosts must not receive a systemd service plan");
assert.equal(buildVncStartCommand(nonSystemd), "");

const managedTigerVnc = {
  ...greeterOnly,
  service_unit:"terma-tigervnc-1.service",
  service_state:"active"
};
const managedPlan = startPlan(managedTigerVnc);
assert.equal(managedPlan.kind, "tigervnc-systemd");
assert.equal(managedPlan.managed, true);
assert.equal(managedPlan.command, "");
const managedStart = buildVncStartCommand(managedTigerVnc, "", {allow_no_password:true});
assert.match(managedStart, /install -m 644 .*terma-tigervnc-1\.service/);
assert.match(managedStart, /systemctl restart 'terma-tigervnc-1\.service'/);
assert.doesNotMatch(managedStart, /^systemctl start /, "再次配置 Terma 管理的单元时必须更新单元文件，而不是只启动旧配置");

assert.match(uninstallPlan({...managedTigerVnc, package_manager:"apt", server_mode:"virtual-session"}).command, /\/usr\/local\/libexec\/terma-tigervnc-1/);

const legacyTigerVnc = {
  ...greeterOnly,
  service_unit:"tunneldesk-tigervnc-1.service",
  service_state:"active",
  service_enabled:true,
  target_component:"tigervnc"
};
const legacyTigerMigration = buildVncStartCommand(legacyTigerVnc, "", {allow_no_password:true});
assert.equal(startPlan(legacyTigerVnc).unit, "terma-tigervnc-1.service", "旧服务重新配置时应写入 Terma unit");
assert.match(stopPlan(legacyTigerVnc, "stop").command, /stop 'tunneldesk-tigervnc-1\.service'/, "停止操作仍须支持旧服务");
assert.match(legacyTigerMigration, /td_legacy_vnc_unit='tunneldesk-tigervnc-1\.service'/);
assert.match(legacyTigerMigration, /systemctl stop "\$td_legacy_vnc_unit"/);
assert.match(legacyTigerMigration, /td_vnc_port_free\(\)/, "迁移旧服务前必须检查端口是否已释放");
assert.match(legacyTigerMigration, /terma-tigervnc-1\.service/);
assert.match(legacyTigerMigration, /td_vnc_port_listening\(\)/, "新服务启动后必须确认目标端口在监听");
assert.match(legacyTigerMigration, /is-active 'terma-tigervnc-1\.service'/, "端口监听还必须来自仍在运行的 Terma 服务");
assert.match(legacyTigerMigration, /正在恢复旧服务/);
assert.match(legacyTigerMigration, /\/etc\/systemd\/system\/tunneldesk-tigervnc-1\.service/);
assert.match(legacyTigerMigration, /\/usr\/local\/libexec\/tunneldesk-tigervnc-1/);
assert.match(legacyTigerMigration, /disable --now 'terma-tigervnc-1\.service'/, "新服务失败时必须先清理 Terma unit");
assert.match(legacyTigerMigration, /restart "\$td_legacy_vnc_unit"/, "迁移失败时必须恢复原本运行的旧服务");
const legacyTigerUninstall = uninstallPlan({
  ...legacyTigerVnc,
  package_manager:"apt",
  server_mode:"virtual-session",
  service_candidates:[{unit:"terma-tigervnc-1.service", state:"inactive", enabled:false}]
});
assert.match(legacyTigerUninstall.command, /\/etc\/systemd\/system\/tunneldesk-tigervnc-1\.service/);
assert.match(legacyTigerUninstall.command, /\/etc\/systemd\/system\/terma-tigervnc-1\.service/);
assert.match(legacyTigerUninstall.command, /\/usr\/local\/libexec\/tunneldesk-tigervnc-1/);
assert.match(legacyTigerUninstall.command, /\/usr\/local\/libexec\/terma-tigervnc-1/);

const managedX11Vnc = {
  ...sessionStopped,
  service_unit:"terma-x11vnc.service",
  service_state:"failed",
  password_file:"/home/operator/.vnc/passwd"
};
const managedX11Plan = startPlan(managedX11Vnc);
assert.equal(managedX11Plan.kind, "x11vnc-session");
assert.equal(managedX11Plan.managed, true);
assert.equal(managedX11Plan.command, "");
const managedX11Start = buildVncStartCommand(managedX11Vnc, "", {allow_no_password:true});
assert.match(managedX11Start, /-display :0 -auth '\/run\/user\/1000\/gdm\/Xauthority' -nopw/);
assert.match(managedX11Start, /enable 'terma-x11vnc\.service'/);
assert.match(managedX11Start, /restart 'terma-x11vnc\.service'/);

const legacyX11Vnc = {
  ...managedX11Vnc,
  service_unit:"tunneldesk-x11vnc.service",
  service_state:"active",
  service_enabled:true,
  target_component:"x11vnc"
};
const legacyX11Migration = buildVncStartCommand(legacyX11Vnc, "", {allow_no_password:true});
assert.equal(startPlan(legacyX11Vnc).unit, "terma-x11vnc.service");
assert.match(legacyX11Migration, /td_legacy_vnc_unit='tunneldesk-x11vnc\.service'/);
assert.match(legacyX11Migration, /cat > \/etc\/systemd\/system\/terma-x11vnc\.service/);
assert.match(legacyX11Migration, /rm -f -- '\/etc\/systemd\/system\/tunneldesk-x11vnc\.service'/);

const managedXrdpVnc = {
  ...managedX11Vnc,
  display:":10",
  source_kind:"xrdp",
  xauthority:"/home/operator/.Xauthority",
  target_component:"x11vnc"
};
const managedXrdpStart = buildVncStartCommand(managedXrdpVnc, "", {allow_no_password:true});
assert.match(managedXrdpStart, /-display :10 -auth '\/home\/operator\/\.Xauthority' -nopw -noshm -forever/, "XRDP x11vnc 必须关闭 MIT-SHM 以避免白屏");

const alternateWrapper = {
  ...greeterOnly,
  commands:["tigervncserver", "vncpasswd"]
};
const alternateStart = buildVncStartCommand(alternateWrapper, "", {allow_no_password:true});
assert.match(alternateStart, /tigervncserver :1 -rfbport 5900/);
assert.match(alternateStart, /ExecStop=-\/usr\/local\/libexec\/terma-tigervnc-1 --stop/);

const nonStandardPortStart = buildVncStartCommand({...greeterOnly, port:6000}, "", {allow_no_password:true});
assert.match(nonStandardPortStart, /tigervnc-1\.service/);
assert.match(nonStandardPortStart, /vncserver :1 -rfbport 6000/);

const blocked = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=dnf",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_FIREWALL=active",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(blocked.status, "not-listening", "本机端口未监听时不能仅凭防火墙启用就误判为阻断");

const ready = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_FIREWALL=allow",
  "TERMA_VNC_PORT=5901"
].join("\n"), 5901);
assert.equal(ready.status, "ready");
assert.equal(ready.port, 5901);
assert.match(packagePlan({...ready, session_active:false, display:""}).uninstall.command, /apt-get purge/);

const sharedXrdp = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_SERVER_MODE=shared-x11",
  "TERMA_VNC_SOURCE_DISPLAY=:10.0",
  "TERMA_VNC_SOURCE_XRDP=1",
  "TERMA_VNC_XRDP_RENDER_DISPLAY=:10",
  "TERMA_VNC_XRDP_DRM_DEVICE=/dev/dri/renderD128",
  "TERMA_VNC_XRDP_DRM_AVAILABLE=0",
  "TERMA_VNC_XRDP_SOFTWARE_RENDERING=1",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(sharedXrdp.server_mode, "shared-x11");
assert.equal(sharedXrdp.source_xrdp, true);
assert.equal(sharedXrdp.graphics_rendering.state, "software");
assert.equal(sharedXrdp.graphics_rendering.java_gui_risk, true);
assert.match(sharedXrdp.graphics_rendering.detail, /继承/);

const multipleDisplays = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=x11vnc,vncserver,vncpasswd",
  "TERMA_VNC_SERVICE_STATE=manual",
  "TERMA_VNC_SESSION_SOURCE=physical|:0|root|XFCE|active|/run/lightdm/root/:0|0|/root|lightdm|c1",
  "TERMA_VNC_SESSION_SOURCE=xrdp|:10|root|XFCE|active|/root/.Xauthority|0|/root|xrdp-sesman|10",
  "TERMA_VNC_XRDP_RENDER_DISPLAY=:10",
  "TERMA_VNC_XRDP_DRM_DEVICE=/dev/dri/renderD128",
  "TERMA_VNC_XRDP_DRM_AVAILABLE=0",
  "TERMA_VNC_XRDP_SOFTWARE_RENDERING=1",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(multipleDisplays.session_sources.length, 2);
const autoSelection = resolveVncServerSessionSelection(multipleDisplays, {});
assert.equal(autoSelection.requires_selection, true, "多个活动桌面时自动模式必须要求用户选择");
const xrdpSelection = resolveVncServerSessionSelection(multipleDisplays, {server_session_mode:"shared", server_display:":10"});
assert.equal(xrdpSelection.mode, "shared");
assert.equal(xrdpSelection.source.kind, "xrdp");
assert.equal(applyVncServerSessionSelection(multipleDisplays, xrdpSelection).display, ":10");
assert.equal(applyVncServerSessionSelection(multipleDisplays, xrdpSelection).graphics_rendering.java_gui_risk, true);
const xrdpGuide = manualGuide(applyVncServerSessionSelection(multipleDisplays, xrdpSelection), 5900);
assert.match(xrdpGuide.commands.join("\n"), /x11vnc -display :10 .* -noshm -forever/, "XRDP 手动启动说明也必须关闭 MIT-SHM");
const virtualSelection = resolveVncServerSessionSelection({...multipleDisplays, commands:["vncserver"], server_mode:"unknown", vnc_process:""}, {server_session_mode:"virtual"});
assert.equal(virtualSelection.mode, "virtual");
assert.equal(applyVncServerSessionSelection(multipleDisplays, virtualSelection).session_active, false);

const x11OnlyRunning = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=x11vnc",
  "TERMA_VNC_PACKAGES=x11vnc",
  "TERMA_VNC_SERVICE_UNIT=tunneldesk-x11vnc.service",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_SERVICE_ENABLED=1",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_SERVER_MODE=shared-x11",
  "TERMA_VNC_SOURCE_DISPLAY=:10.0",
  "TERMA_VNC_VNC_PROCESS=321 operator x11vnc -display :10.0 -rfbport 5900",
  "TERMA_VNC_SESSION_SOURCE=xrdp|:10|operator|XFCE|active|/home/operator/.Xauthority|1000|/home/operator|xrdp-sesman|10",
  "TERMA_VNC_DESKTOP_COMMAND=startxfce4",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(x11OnlyRunning.status, "ready", "聚合连接状态仍应反映正在运行的 x11vnc");
assert.equal(x11OnlyRunning.component_states.x11vnc.installed, true);
assert.equal(x11OnlyRunning.component_states.tigervnc.installed, false, "x11vnc 不得掩盖缺失的 TigerVNC");
const missingTigerSelection = resolveVncServerSessionSelection(x11OnlyRunning, {server_session_mode:"virtual"});
assert.equal(missingTigerSelection.component, "tigervnc");
assert.equal(missingTigerSelection.install_required, true);
assert.match(missingTigerSelection.reason, /vncserver\/tigervncserver/);
const missingTigerPlanning = componentPlanningDiagnostics(applyVncServerSessionSelection(x11OnlyRunning, missingTigerSelection), missingTigerSelection);
assert.equal(startPlan(missingTigerPlanning), null, "缺少 TigerVNC 包装器时不得生成空命令启动方案");
assert.match(startPlanReason(missingTigerPlanning), /vncserver\/tigervncserver/);
const missingTigerPackages = packagePlan(missingTigerPlanning);
assert.equal(missingTigerPackages.package_name, "tigervnc");
assert.equal(missingTigerPackages.uninstall.target_component, "tigervnc");
assert.doesNotMatch(missingTigerPackages.uninstall.command, /x11vnc|tunneldesk-x11vnc/, "卸载 TigerVNC 不得停止或移除正在运行的 x11vnc");
assert.equal(stopPlan({...x11OnlyRunning, target_component:"tigervnc"}, "stop").available, false, "停止 TigerVNC 不得回退到 x11vnc 进程或单元");
assert.match(manualGuide(missingTigerPlanning, 5900).commands.join("\n"), /vncserver :1/);
assert.doesNotMatch(manualGuide(missingTigerPlanning, 5900).commands.join("\n"), /x11vnc -display/);
assert.match(String(validateVncServerComponent(x11OnlyRunning, "tigervnc", true)), /vncserver\/tigervncserver/, "TigerVNC 安装验证不得使用聚合 installed");
assert.equal(validateVncServerComponent(x11OnlyRunning, "tigervnc", false), true, "TigerVNC 卸载验证不得被仍安装的 x11vnc 掩盖");

const x11OccupiesTigerPort = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=x11vnc,vncserver,vncpasswd,Xtigervnc",
  "TERMA_VNC_PACKAGES=x11vnc,tigervnc-standalone-server,tigervnc-common",
  "TERMA_VNC_SERVICE_UNIT=tunneldesk-x11vnc.service",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_SERVICE_ENABLED=1",
  "TERMA_VNC_SERVICE_CANDIDATE=tunneldesk-tigervnc-1.service|active|1|running|success|0",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_LISTENER_COMPONENT=",
  "TERMA_VNC_SERVER_MODE=shared-x11",
  "TERMA_VNC_SOURCE_DISPLAY=:0.0",
  "TERMA_VNC_VNC_PROCESS=321 operator x11vnc -display :0.0 -rfbport 5900",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(x11OccupiesTigerPort.component_states.x11vnc.listening, true);
assert.equal(x11OccupiesTigerPort.component_states.tigervnc.listener_component, "x11vnc", "empty listener ownership must be inferred from the running VNC process");
assert.equal(x11OccupiesTigerPort.component_states.tigervnc.listening, false, "x11vnc on 5900 must not make TigerVNC look ready");
assert.equal(x11OccupiesTigerPort.component_states.tigervnc.listener_mismatch, true);
assert.equal(x11OccupiesTigerPort.component_states.tigervnc.status, "not-listening");

const tigerOwnsTargetPort = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=linux",
  "TERMA_VNC_PACKAGE_MANAGER=apt",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_COMMANDS=x11vnc,vncserver,tigervncserver,vncpasswd,Xtigervnc",
  "TERMA_VNC_PACKAGES=x11vnc,tigervnc-standalone-server,tigervnc-common",
  "TERMA_VNC_SERVICE_UNIT=tunneldesk-tigervnc-1.service",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_SERVICE_ENABLED=1",
  "TERMA_VNC_SERVICE_CANDIDATE=tunneldesk-tigervnc-1.service|active|1|running|success|0",
  "TERMA_VNC_SERVICE_CANDIDATE=tunneldesk-x11vnc.service|inactive|0|||",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_LISTENER_PID=901",
  "TERMA_VNC_LISTENER_PROCESS=/usr/bin/Xtigervnc :1 -rfbport 5900",
  "TERMA_VNC_LISTENER_COMPONENT=tigervnc",
  "TERMA_VNC_SERVER_MODE=virtual",
  "TERMA_VNC_SOURCE_DISPLAY=:1",
  "TERMA_VNC_VNC_PROCESS=901 operator /usr/bin/Xtigervnc :1 -rfbport 5900",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(tigerOwnsTargetPort.current_component.key, "tigervnc");
assert.equal(tigerOwnsTargetPort.component_states.tigervnc.status, "ready");
assert.equal(tigerOwnsTargetPort.component_states.tigervnc.service_unit, "tunneldesk-tigervnc-1.service");
assert.equal(tigerOwnsTargetPort.component_states.tigervnc.service_enabled, true);
assert.equal(tigerOwnsTargetPort.component_states.x11vnc.listening, false, "stale x11vnc units on another port must not own the configured listener");

const rawTigerVnc = {
  ...x11OnlyRunning,
  commands:["Xtigervnc", "vncpasswd"],
  packages:["tigervnc-common"],
  service_unit:"",
  service_state:"manual",
  service_enabled:false,
  listening:false,
  server_mode:"virtual",
  vnc_process:"654 operator Xtigervnc :1 -rfbport 5900"
};
const rawTigerState = vncServerComponentState(rawTigerVnc, "tigervnc");
assert.equal(rawTigerState.installed, true);
assert.equal(rawTigerState.wrapper_available, false);
assert.equal(rawTigerState.raw_server_available, true);
assert.equal(rawTigerState.manual_only, true);
assert.equal(rawTigerState.install_required, true);
const rawTigerSelection = resolveVncServerSessionSelection(rawTigerVnc, {server_session_mode:"virtual"});
const rawTigerPlanning = componentPlanningDiagnostics(applyVncServerSessionSelection(rawTigerVnc, rawTigerSelection), rawTigerSelection);
assert.equal(startPlan(rawTigerPlanning), null);
assert.match(startPlanReason(rawTigerPlanning), /原始 X 服务器|包装器/);
assert.match(manualGuide(rawTigerPlanning, 5900).commands.join("\n"), /Xtigervnc :1/);
assert.doesNotMatch(manualGuide(rawTigerPlanning, 5900).commands.join("\n"), /vncserver :1/);

const tigerWrapperInstalled = {
  ...x11OnlyRunning,
  commands:["x11vnc", "vncserver", "vncpasswd", "Xtigervnc"],
  packages:["x11vnc", "tigervnc-standalone-server", "tigervnc-common"]
};
assert.equal(validateVncServerComponent(tigerWrapperInstalled, "tigervnc", true), true);
const wrapperSelection = resolveVncServerSessionSelection(tigerWrapperInstalled, {server_session_mode:"virtual"});
assert.equal(wrapperSelection.install_required, false);
assert.equal(startPlan(componentPlanningDiagnostics(applyVncServerSessionSelection(tigerWrapperInstalled, wrapperSelection), wrapperSelection)).kind, "tigervnc-systemd");

const macos = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=macos",
  "TERMA_VNC_OS_ID=macos",
  "TERMA_VNC_KERNEL=Darwin",
  "TERMA_VNC_PACKAGE_MANAGER=none",
  "TERMA_VNC_UID=501",
  "TERMA_VNC_PRIVILEGED=0",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_SERVICE_UNIT=com.apple.screensharing",
  "TERMA_VNC_SERVICE_STATE=inactive",
  "TERMA_VNC_LISTENING=0",
  "TERMA_VNC_FIREWALL=system",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(macos.builtin, true);
assert.equal(macos.status, "stopped");
assert.equal(macos.can_install, false);
const reachableMacos = parseDetectionOutput([
  "TERMA_VNC_PLATFORM=macos",
  "TERMA_VNC_OS_ID=macos",
  "TERMA_VNC_KERNEL=Darwin",
  "TERMA_VNC_INSTALLED=1",
  "TERMA_VNC_SERVICE_UNIT=com.apple.screensharing",
  "TERMA_VNC_SERVICE_STATE=active",
  "TERMA_VNC_LISTENING=1",
  "TERMA_VNC_PORT=5900"
].join("\n"));
assert.equal(reachableMacos.status, "ready");
assert.equal(reachableMacos.recommended_action, "connect");
assert.match(manualGuide(macos, 5900).summary, /自带屏幕共享/);
assert.match(manualGuide(macos, 5900).steps.join(" "), /系统设置/);
assert.match(manualGuide({platform:"unknown"}, 5900).summary, /没有可用的 SSH 管理通道/);
assert.equal(manualGuide({platform:"unknown"}, 5900).commands.length, 0);

assert.match(DETECT_SCRIPT, /launchctl print system\/com\.apple\.screensharing/);
assert.match(DETECT_SCRIPT, /nc -z -w 2 127\.0\.0\.1 5900/);
assert.match(DETECT_SCRIPT, /x11vnc vncserver tigervncserver vncpasswd Xtigervnc Xvnc wayvnc/);
assert.match(DETECT_SCRIPT, /td_vncserver_real=\$\(readlink -f "\$td_vncserver_path"/);
assert.match(DETECT_SCRIPT, /td_vncserver_signature=\$\(head -n 120 "\$td_vncserver_real"/);
assert.match(DETECT_SCRIPT, /td_vncserver_probe=.*tr '\[:upper:\]' '\[:lower:\]'/);
assert.match(DETECT_SCRIPT, /timeout 2 vncserver -help <\/dev\/null/);
assert.doesNotMatch(DETECT_SCRIPT, /\*SecurityTypes\*/);
assert.ok(
  DETECT_SCRIPT.indexOf('td_vncserver_signature=$(head -n 120 "$td_vncserver_real"')
    < DETECT_SCRIPT.indexOf('td_vncserver_help=$(timeout 2 vncserver -help'),
  "TigerVNC detection must inspect the wrapper path and script before executing its help command"
);
assert.match(DETECT_SCRIPT, /ps -p 1 -o comm=/);
assert.match(DETECT_SCRIPT, /\/bin\/systemctl \/usr\/bin\/systemctl/);
assert.match(DETECT_SCRIPT, /terma_emit SYSTEMD_AVAILABLE/);
assert.equal((DETECT_SCRIPT.match(/td_listener_pid=""/g) || []).length, 1, "the exact listener PID must not be cleared by a second legacy probe");
assert.ok(DETECT_SCRIPT.indexOf("td_listener_inode=") < DETECT_SCRIPT.indexOf('td_service_unit=""'), "listener ownership must be resolved before systemd units are ranked");
assert.match(DETECT_SCRIPT, /\/proc\/\$td_listener_pid\/cgroup/);
assert.match(DETECT_SCRIPT, /\/run\/systemd\/system\/\*\.target\.wants/);
assert.match(DETECT_SCRIPT, /terma-tigervnc-\$td_vnc_display_number\.service/);
assert.match(DETECT_SCRIPT, /terma-x11vnc\.service/);
assert.match(DETECT_SCRIPT, /tunneldesk-tigervnc-\$td_vnc_display_number\.service/);
assert.match(DETECT_SCRIPT, /tunneldesk-x11vnc\.service/);
assert.match(DETECT_SCRIPT, /td_session_active=1/);
assert.match(DETECT_SCRIPT, /terma_emit SERVER_MODE/);
assert.match(DETECT_SCRIPT, /terma_emit SOURCE_XRDP/);
assert.match(DETECT_SCRIPT, /terma_emit SESSION_SOURCE/);
assert.match(DETECT_SCRIPT, /DRMDevice/);
assert.match(DETECT_SCRIPT, /DRISWRAST|swrast/);
assert.match(DETECT_SCRIPT, /td_display_base=\$\{td_display%%\.\*\}/);
assert.ok(DETECT_SCRIPT.indexOf('$td_session_home/.Xauthority') < DETECT_SCRIPT.indexOf('td_candidate_auth=$(ps -eo args='));
assert.doesNotMatch(DETECT_SCRIPT, /is-active "\$td_unit"[^\n]*\|\| printf inactive/);
assert.match(DETECT_SCRIPT, /list-unit-files/);
assert.match(DETECT_SCRIPT, /ufw status/);
assert.match(DETECT_SCRIPT, /firewall-cmd --query-port=5900\/tcp/);
assert.match(buildDetectionScript(5907), /TERMA_VNC_PORT|terma_emit PORT "5907"/);
assert.match(buildDetectionScript(5907), /-iTCP:5907/);
assert.match(buildDetectionScript(5907), /td_commands="\$\{td_commands\}\$\{td_commands:\+,\}\$td_command"/);
assert.doesNotMatch(buildDetectionScript(5907), /\\\$\{td_commands/);
const serverSource = readSources(path.join(__dirname, ".."), [
  "src/server.ts",
  "src/services/remote-component-service.ts",
  "src/services/vnc-management-service.ts"
]);
assert.match(serverSource, /startRemoteComponentCommandTask/);
assert.match(serverSource, /runSshCommandForConnectionStreaming\(connection, buildRemotePosixCommand\(normalized\), timeoutMs, onChunk\)/);

const connection = {id:77, name:"Linux fixture", ssh_host:"192.0.2.77", ssh_port:22, ssh_user:"root"};
const profile = {id:7, protocol:"vnc", host:"192.0.2.77", port:5900, options:{source_ssh_connection_id:77}};
let receivedProbeCommand = "";
const virtualProfile = {id:8, protocol:"vnc", host:"192.0.2.77", port:5900, options:{source_ssh_connection_id:77, server_session_mode:"virtual"}};
let virtualProbeCommand = "";
const missingProbe = detectVncServer(profile, {
  getConnection:id => Number(id) === 77 ? connection : null,
  runSshCommandForConnection:async (_connection, command) => {
    receivedProbeCommand = String(command || "");
    return {status:0, stdout:[
    "TERMA_VNC_PLATFORM=linux",
    "TERMA_VNC_OS_ID=ubuntu",
    "TERMA_VNC_KERNEL=Linux",
    "TERMA_VNC_PACKAGE_MANAGER=apt",
    "TERMA_VNC_UID=1000",
    "TERMA_VNC_PRIVILEGED=0",
    "TERMA_VNC_INSTALLED=0",
    "TERMA_VNC_SERVICE_STATE=missing",
    "TERMA_VNC_LISTENING=0",
    "TERMA_VNC_FIREWALL=none",
    "TERMA_VNC_PORT=5900"
    ].join("\n"), stderr:""};
  }
});
const virtualProbe = detectVncServer(virtualProfile, {
  getConnection:id => Number(id) === 77 ? connection : null,
  runSshCommandForConnection:async (_connection, command) => {
    virtualProbeCommand = String(command || "");
    return {status:0, stdout:[
      "TERMA_VNC_PLATFORM=linux",
      "TERMA_VNC_OS_ID=ubuntu",
      "TERMA_VNC_KERNEL=Linux",
      "TERMA_VNC_PACKAGE_MANAGER=apt",
      "TERMA_VNC_UID=1000",
      "TERMA_VNC_PRIVILEGED=0",
      "TERMA_VNC_INSTALLED=1",
      "TERMA_VNC_COMMANDS=x11vnc",
      "TERMA_VNC_PACKAGES=x11vnc",
      "TERMA_VNC_SERVICE_UNIT=tunneldesk-x11vnc.service",
      "TERMA_VNC_SERVICE_STATE=active",
      "TERMA_VNC_SERVICE_ENABLED=1",
      "TERMA_VNC_LISTENING=1",
      "TERMA_VNC_SERVER_MODE=shared-x11",
      "TERMA_VNC_SOURCE_DISPLAY=:10.0",
      "TERMA_VNC_VNC_PROCESS=321 operator x11vnc -display :10.0 -rfbport 5900",
      "TERMA_VNC_SESSION_SOURCE=xrdp|:10|operator|XFCE|active|/home/operator/.Xauthority|1000|/home/operator|xrdp-sesman|10",
      "TERMA_VNC_DESKTOP_COMMAND=startxfce4",
      "TERMA_VNC_PORT=5900"
    ].join("\n"), stderr:""};
  }
});
Promise.all([missingProbe, virtualProbe]).then(([result, virtualResult]) => {
  assert.equal(result.status, "not-installed");
  assert.equal(result.ssh_connection.id, 77);
  assert.equal(result.package_plan.package_manager, "apt");
  assert.equal(result.install_plan.online.available, true);
  assert.equal(result.install_plan.offline.available, true);
  assert.match(result.guide.commands.join(" "), /vncserver/);
  assert.equal(virtualResult.status, "ready", "聚合状态应继续显示正在运行的 x11vnc");
  assert.equal(virtualResult.running_component.key, "x11vnc");
  assert.equal(virtualResult.selected_component.key, "tigervnc");
  assert.equal(virtualResult.selected_component.installed, false);
  assert.equal(virtualResult.server_session_selection.install_required, true);
  assert.equal(virtualResult.start_plan, null, "选择独立桌面且缺少 TigerVNC 包装器时 start_plan 必须为空");
  assert.match(virtualResult.start_plan_reason, /vncserver\/tigervncserver/);
  assert.equal(virtualResult.install_plan.package_name, "tigervnc");
  assert.equal(virtualResult.uninstall_plan.target_component, "tigervnc");
  assert.doesNotMatch(virtualResult.uninstall_plan.command, /tunneldesk-x11vnc|x11vnc/);
  assert.doesNotMatch(virtualResult.guide.commands.join(" "), /x11vnc -display/);
  assert.match(receivedProbeCommand, /^\/bin\/sh -c 'terma_payload=[A-Za-z0-9+/=]+;/);
  assert.match(Buffer.from(/^\/bin\/sh -c 'terma_payload=([A-Za-z0-9+/=]+);/.exec(receivedProbeCommand)[1], "base64").toString("utf8"), /terma_emit PLATFORM/);
  assert.match(virtualProbeCommand, /^\/bin\/sh -c 'terma_payload=[A-Za-z0-9+/=]+;/);
  console.log("VNC 服务管理检查通过：Linux/macOS 探测、未安装/停止/防火墙分层、授权安装方案与手动说明有效");
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
