"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DETECT_SCRIPT,
  buildVncStartCommand,
  buildDetectionScript,
  detectVncServer,
  manualGuide,
  packagePlan,
  parseDetectionOutput,
  startPlan,
  stopPlan,
  uninstallPlan
} = require("../dist/vnc-server-manager");

const missing = parseDetectionOutput([
  "TD_VNC_PLATFORM=linux",
  "TD_VNC_OS_ID=ubuntu",
  "TD_VNC_KERNEL=Linux",
  "TD_VNC_PACKAGE_MANAGER=apt",
  "TD_VNC_UID=1000",
  "TD_VNC_PRIVILEGED=0",
  "TD_VNC_INSTALLED=0",
  "TD_VNC_SERVICE_STATE=missing",
  "TD_VNC_LISTENING=0",
  "TD_VNC_FIREWALL=none",
  "TD_VNC_PORT=5900"
].join("\n"));
assert.equal(missing.status, "not-installed");
assert.equal(missing.can_install, true);
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
  "TD_VNC_PLATFORM=linux",
  "TD_VNC_OS_ID=fedora",
  "TD_VNC_KERNEL=Linux",
  "TD_VNC_PACKAGE_MANAGER=dnf",
  "TD_VNC_UID=0",
  "TD_VNC_PRIVILEGED=1",
  "TD_VNC_INSTALLED=1",
  "TD_VNC_COMMANDS=x11vnc,Xtigervnc",
  "TD_VNC_PACKAGES=x11vnc",
  "TD_VNC_SERVICE_UNIT=x11vnc.service",
  "TD_VNC_SERVICE_STATE=inactive",
  "TD_VNC_LISTENING=0",
  "TD_VNC_FIREWALL=none",
  "TD_VNC_PORT=5900"
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
assert.match(generatedStart, /tunneldesk-x11vnc\.service/);
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
assert.equal(headlessPlan.unit, "tunneldesk-tigervnc-1.service");
assert.equal(headlessPlan.persistent, true);
assert.equal(headlessPlan.autostart, true);
assert.equal(headlessPlan.managed, true);
const headlessStart = buildVncStartCommand(greeterOnly, "", {allow_no_password:true});
const savedPasswordFallbackStart = buildVncStartCommand(greeterOnly);
assert.match(savedPasswordFallbackStart, /-SecurityTypes VncAuth -PasswordFile/);
assert.doesNotMatch(savedPasswordFallbackStart, /-SecurityTypes None/);
assert.match(headlessStart, /vncserver :1 -rfbport 5900/, "无活动用户桌面时应创建独立 :1 会话并保持配置端口");
assert.match(headlessStart, /tunneldesk-tigervnc-1\.service/);
assert.match(headlessStart, /Type=simple/);
assert.match(headlessStart, /ExecStart=\/usr\/local\/libexec\/tunneldesk-tigervnc-1/);
assert.match(headlessStart, /mktemp \/tmp\/tunneldesk-tigervnc-unit\.XXXXXX/);
assert.doesNotMatch(headlessStart, /mktemp \/run\/tunneldesk-tigervnc-/);
assert.match(headlessStart, /vncserver .* -SecurityTypes None --I-KNOW-THIS-IS-INSECURE/);
assert.match(headlessStart, /vncserver -help .*\[-\]fg/);
assert.doesNotMatch(headlessStart, /PIDFile=/);
assert.match(headlessStart, /User=operator/);
assert.match(headlessStart, /WorkingDirectory=\/home\/operator/);
assert.doesNotMatch(headlessStart, /WorkingDirectory="/);
assert.match(headlessStart, /Environment="HOME=\/home\/operator"/);
assert.match(headlessStart, /WantedBy=multi-user\.target/);
assert.match(headlessStart, /systemctl enable 'tunneldesk-tigervnc-1\.service'/);
assert.match(headlessStart, /systemctl restart 'tunneldesk-tigervnc-1\.service'/);
assert.match(headlessStart, /dbus-run-session -- startxfce4/);
assert.doesNotMatch(headlessStart, /runuser -u/);
assert.doesNotMatch(headlessStart, /ufw allow|firewall-cmd/, "disabled firewalls must not add a port-opening command");
assert.doesNotMatch(headlessStart, /temporary-vnc-secret/);
const passwordHeadlessStart = buildVncStartCommand(greeterOnly, "temporary-vnc-secret");
assert.match(passwordHeadlessStart, /-SecurityTypes VncAuth -PasswordFile '\/home\/operator\/\.vnc\/passwd'/);
assert.match(passwordHeadlessStart, /x11vnc -storepasswd/);
assert.doesNotMatch(passwordHeadlessStart, /temporary-vnc-secret/);
assert.equal(buildVncStartCommand(greeterOnly, "", {allow_no_password:true}), headlessStart, "重复生成的 TigerVNC 服务配置应保持幂等");
assert.doesNotMatch(manualGuide(greeterOnly, 5900).commands.join("\n"), /ufw allow|firewall-cmd/, "防火墙未启用时不得生成开放端口命令");

const restrictedSystemctl = parseDetectionOutput([
  "TD_VNC_PLATFORM=linux",
  "TD_VNC_OS_ID=linx",
  "TD_VNC_KERNEL=Linux",
  "TD_VNC_PACKAGE_MANAGER=apt",
  "TD_VNC_UID=1100",
  "TD_VNC_PRIVILEGED=0",
  "TD_VNC_INIT_SYSTEM=systemd",
  "TD_VNC_SYSTEMD_AVAILABLE=1",
  "TD_VNC_SYSTEMCTL_PATH=/bin/systemctl",
  "TD_VNC_SYSTEMCTL_USABLE=0",
  "TD_VNC_INSTALLED=1",
  "TD_VNC_COMMANDS=vncserver,tigervncserver,vncpasswd,Xtigervnc",
  "TD_VNC_PACKAGES=tigervnc-standalone-server,tigervnc-common",
  "TD_VNC_SERVICE_STATE=manual",
  "TD_VNC_SERVICE_ENABLED=0",
  "TD_VNC_LISTENING=0",
  "TD_VNC_FIREWALL=none",
  "TD_VNC_SESSION_USER=ha2",
  "TD_VNC_SESSION_HOME=/home/h-a2/vl/home",
  "TD_VNC_SESSION_ACTIVE=0",
  "TD_VNC_DISPLAY=:0",
  "TD_VNC_PASSWORD_FILE=/home/h-a2/vl/home/.vnc/passwd",
  "TD_VNC_DESKTOP_COMMAND=mate-session",
  "TD_VNC_PORT=5900"
].join("\n"));
assert.equal(restrictedSystemctl.systemd_available, true);
assert.equal(restrictedSystemctl.systemctl_path, "/bin/systemctl");
assert.equal(restrictedSystemctl.systemctl_usable, false);
assert.equal(restrictedSystemctl.service_enabled, false);
assert.equal(startPlan(restrictedSystemctl).kind, "tigervnc-systemd", "systemctl only executable by root must remain manageable through temporary authorization");
const restrictedStart = buildVncStartCommand(restrictedSystemctl, "", {allow_no_password:true});
assert.match(restrictedStart, /'\/bin\/systemctl' daemon-reload/);
assert.match(restrictedStart, /tunneldesk-tigervnc-1\.service/);

const nonSystemd = {...restrictedSystemctl, init_system:"openrc", systemd_available:false, systemctl_path:""};
assert.equal(startPlan(nonSystemd), null, "non-systemd hosts must not receive a systemd service plan");
assert.equal(buildVncStartCommand(nonSystemd), "");

const managedTigerVnc = {
  ...greeterOnly,
  service_unit:"tunneldesk-tigervnc-1.service",
  service_state:"active"
};
const managedPlan = startPlan(managedTigerVnc);
assert.equal(managedPlan.kind, "tigervnc-systemd");
assert.equal(managedPlan.managed, true);
assert.equal(managedPlan.command, "");
const managedStart = buildVncStartCommand(managedTigerVnc, "", {allow_no_password:true});
assert.match(managedStart, /install -m 644 .*tunneldesk-tigervnc-1\.service/);
assert.match(managedStart, /systemctl restart 'tunneldesk-tigervnc-1\.service'/);
assert.doesNotMatch(managedStart, /^systemctl start /, "再次配置 TunnelDesk 管理的单元时必须更新单元文件，而不是只启动旧配置");

assert.match(uninstallPlan({...managedTigerVnc, package_manager:"apt", server_mode:"virtual-session"}).command, /\/usr\/local\/libexec\/tunneldesk-tigervnc-1/);

const managedX11Vnc = {
  ...sessionStopped,
  service_unit:"tunneldesk-x11vnc.service",
  service_state:"failed",
  password_file:"/home/operator/.vnc/passwd"
};
const managedX11Plan = startPlan(managedX11Vnc);
assert.equal(managedX11Plan.kind, "x11vnc-session");
assert.equal(managedX11Plan.managed, true);
assert.equal(managedX11Plan.command, "");
const managedX11Start = buildVncStartCommand(managedX11Vnc, "", {allow_no_password:true});
assert.match(managedX11Start, /-display :0 -auth '\/run\/user\/1000\/gdm\/Xauthority' -nopw/);
assert.match(managedX11Start, /enable --now tunneldesk-x11vnc\.service/);

const alternateWrapper = {
  ...greeterOnly,
  commands:["tigervncserver", "vncpasswd"]
};
const alternateStart = buildVncStartCommand(alternateWrapper, "", {allow_no_password:true});
assert.match(alternateStart, /tigervncserver :1 -rfbport 5900/);
assert.match(alternateStart, /ExecStop=-\/usr\/bin\/env tigervncserver -kill :1/);

const nonStandardPortStart = buildVncStartCommand({...greeterOnly, port:6000}, "", {allow_no_password:true});
assert.match(nonStandardPortStart, /tigervnc-1\.service/);
assert.match(nonStandardPortStart, /vncserver :1 -rfbport 6000/);

const blocked = parseDetectionOutput([
  "TD_VNC_PLATFORM=linux",
  "TD_VNC_PACKAGE_MANAGER=dnf",
  "TD_VNC_INSTALLED=1",
  "TD_VNC_SERVICE_STATE=active",
  "TD_VNC_LISTENING=0",
  "TD_VNC_FIREWALL=active",
  "TD_VNC_PORT=5900"
].join("\n"));
assert.equal(blocked.status, "not-listening", "本机端口未监听时不能仅凭防火墙启用就误判为阻断");

const ready = parseDetectionOutput([
  "TD_VNC_PLATFORM=linux",
  "TD_VNC_PACKAGE_MANAGER=apt",
  "TD_VNC_INSTALLED=1",
  "TD_VNC_SERVICE_STATE=active",
  "TD_VNC_LISTENING=1",
  "TD_VNC_FIREWALL=allow",
  "TD_VNC_PORT=5901"
].join("\n"), 5901);
assert.equal(ready.status, "ready");
assert.equal(ready.port, 5901);
assert.match(packagePlan({...ready, session_active:false, display:""}).uninstall.command, /apt-get purge/);

const macos = parseDetectionOutput([
  "TD_VNC_PLATFORM=macos",
  "TD_VNC_OS_ID=macos",
  "TD_VNC_KERNEL=Darwin",
  "TD_VNC_PACKAGE_MANAGER=none",
  "TD_VNC_UID=501",
  "TD_VNC_PRIVILEGED=0",
  "TD_VNC_INSTALLED=1",
  "TD_VNC_SERVICE_UNIT=com.apple.screensharing",
  "TD_VNC_SERVICE_STATE=inactive",
  "TD_VNC_LISTENING=0",
  "TD_VNC_FIREWALL=system",
  "TD_VNC_PORT=5900"
].join("\n"));
assert.equal(macos.builtin, true);
assert.equal(macos.status, "stopped");
assert.equal(macos.can_install, false);
assert.match(manualGuide(macos, 5900).summary, /自带屏幕共享/);
assert.match(manualGuide(macos, 5900).steps.join(" "), /系统设置/);
assert.match(manualGuide({platform:"unknown"}, 5900).summary, /没有可用的 SSH 管理通道/);
assert.equal(manualGuide({platform:"unknown"}, 5900).commands.length, 0);

assert.match(DETECT_SCRIPT, /launchctl print system\/com\.apple\.screensharing/);
assert.match(DETECT_SCRIPT, /x11vnc vncserver tigervncserver vncpasswd Xtigervnc Xvnc wayvnc/);
assert.match(DETECT_SCRIPT, /ps -p 1 -o comm=/);
assert.match(DETECT_SCRIPT, /\/bin\/systemctl \/usr\/bin\/systemctl/);
assert.match(DETECT_SCRIPT, /td_emit SYSTEMD_AVAILABLE/);
assert.match(DETECT_SCRIPT, /tunneldesk-tigervnc-\$td_vnc_display_number\.service/);
assert.match(DETECT_SCRIPT, /tunneldesk-x11vnc\.service/);
assert.match(DETECT_SCRIPT, /td_session_active=1/);
assert.match(DETECT_SCRIPT, /td_display_base=\$\{td_display%%\.\*\}/);
assert.ok(DETECT_SCRIPT.indexOf('$td_session_home/.Xauthority') < DETECT_SCRIPT.indexOf('td_candidate_auth=$(ps -eo args='));
assert.doesNotMatch(DETECT_SCRIPT, /is-active "\$td_unit"[^\n]*\|\| printf inactive/);
assert.match(DETECT_SCRIPT, /list-unit-files/);
assert.match(DETECT_SCRIPT, /ufw status/);
assert.match(DETECT_SCRIPT, /firewall-cmd --query-port=5900\/tcp/);
assert.match(buildDetectionScript(5907), /TD_VNC_PORT|td_emit PORT "5907"/);
assert.match(buildDetectionScript(5907), /-iTCP:5907/);
assert.match(buildDetectionScript(5907), /td_commands="\$\{td_commands\}\$\{td_commands:\+,\}\$td_command"/);
assert.doesNotMatch(buildDetectionScript(5907), /\\\$\{td_commands/);
const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf8");
assert.match(serverSource, /startRemoteComponentCommandTask/);
assert.match(serverSource, /runSshCommandForConnectionStreaming\(connection, buildRemotePosixCommand\(normalized\), timeoutMs, onChunk\)/);

const connection = {id:77, name:"Linux fixture", ssh_host:"192.0.2.77", ssh_port:22, ssh_user:"root"};
const profile = {id:7, protocol:"vnc", host:"192.0.2.77", port:5900, options:{source_ssh_connection_id:77}};
let receivedProbeCommand = "";
Promise.resolve(detectVncServer(profile, {
  getConnection:id => Number(id) === 77 ? connection : null,
  runSshCommandForConnection:async (_connection, command) => {
    receivedProbeCommand = String(command || "");
    return {status:0, stdout:[
    "TD_VNC_PLATFORM=linux",
    "TD_VNC_OS_ID=ubuntu",
    "TD_VNC_KERNEL=Linux",
    "TD_VNC_PACKAGE_MANAGER=apt",
    "TD_VNC_UID=1000",
    "TD_VNC_PRIVILEGED=0",
    "TD_VNC_INSTALLED=0",
    "TD_VNC_SERVICE_STATE=missing",
    "TD_VNC_LISTENING=0",
    "TD_VNC_FIREWALL=none",
    "TD_VNC_PORT=5900"
    ].join("\n"), stderr:""};
  }
})).then(result => {
  assert.equal(result.status, "not-installed");
  assert.equal(result.ssh_connection.id, 77);
  assert.equal(result.package_plan.package_manager, "apt");
  assert.equal(result.install_plan.online.available, true);
  assert.equal(result.install_plan.offline.available, true);
  assert.match(result.guide.commands.join(" "), /vncserver/);
  assert.match(receivedProbeCommand, /^\/bin\/sh -lc 'td_payload=[A-Za-z0-9+/=]+;/);
  assert.match(Buffer.from(/^\/bin\/sh -lc 'td_payload=([A-Za-z0-9+/=]+);/.exec(receivedProbeCommand)[1], "base64").toString("utf8"), /td_emit PLATFORM/);
  console.log("VNC 服务管理检查通过：Linux/macOS 探测、未安装/停止/防火墙分层、授权安装方案与手动说明有效");
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
