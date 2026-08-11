"use strict";

const assert = require("node:assert/strict");
const {
  DETECT_SCRIPT,
  buildConfigurationScript,
  configureXdmcpServer,
  detectXdmcpServer,
  lightdmUninstallPlan,
  parseDetectionOutput,
  resolveManagementConnection,
  validateXdmcpState,
  waitForXdmcpState
} = require("../dist/xdmcp-manager");
const {__xdmcpTaskResourceKey} = require("../dist/server");
const legacyPrefix = ["T", "D"].join("");

function unwrapRootScript(command) {
  const match = /td_payload='([^']+)'/.exec(command);
  assert.ok(match, "managed script must use a fixed base64 payload");
  return Buffer.from(match[1], "base64").toString("utf8");
}

function unwrapRemotePosixCommand(command) {
  const match = /^\/bin\/sh -c 'terma_payload=([A-Za-z0-9+/=]+);/.exec(String(command || ""));
  assert.ok(match, "remote XDMCP command must use the login-shell-safe POSIX wrapper");
  return Buffer.from(match[1], "base64").toString("utf8");
}

assert.equal(__xdmcpTaskResourceKey({id:31}, {action:"install-rdp-local-offline"}), "rdp-server:31");
assert.equal(__xdmcpTaskResourceKey({id:31}, {action:"repair-xrdp"}), "rdp-server:31");
assert.equal(__xdmcpTaskResourceKey({id:31}, {action:"enable"}), "xdmcp-server:31");

assert.match(DETECT_SCRIPT, /PATH="\/usr\/local\/sbin:[^"]*\/usr\/sbin:[^"]*\/sbin/, "LightDM detection must restore standard sbin paths for unprivileged SSH accounts");
assert.match(DETECT_SCRIPT, /xdmcp-lightdm-owner/);
assert.match(DETECT_SCRIPT, /90-terma-xdmcp\.conf/);
assert.match(DETECT_SCRIPT, /90-tunneldesk-xdmcp\.conf/);
assert.match(DETECT_SCRIPT, /\/var\/lib\/terma\/xdmcp-firewall-owner/);
assert.match(DETECT_SCRIPT, /\/var\/lib\/tunneldesk\/xdmcp-firewall-owner/);
assert.match(DETECT_SCRIPT, /LIGHTDM_PREVIOUS_SERVICE/);
assert.ok(DETECT_SCRIPT.includes("TERMA_"));
const managedLightdm = parseDetectionOutput([
  "TERMA_OS_ID=debian",
  "TERMA_MANAGER=lightdm",
  "TERMA_SERVICE=lightdm",
  "TERMA_PACKAGE_MANAGER=apt",
  "TERMA_PRIVILEGED=1",
  "TERMA_LIGHTDM_MANAGED=1",
  "TERMA_LIGHTDM_PREVIOUS_SERVICE=sddm",
  "TERMA_LIGHTDM_BACKUP=/etc/X11/default-display-manager.tunneldesk-backup-123",
  "TERMA_ENABLED=1",
  "TERMA_LISTENING=1",
  "TERMA_SESSION=xfce|Xfce Session"
].join("\n"));
assert.equal(managedLightdm.uninstall_plan.available, true);
assert.equal(managedLightdm.graphics_rendering.state, "remote-x11");
assert.equal(managedLightdm.graphics_rendering.java_gui_risk, true);
assert.match(managedLightdm.graphics_rendering.detail, /JavaFX/);
const uninstallLightdmScript = unwrapRootScript(lightdmUninstallPlan(managedLightdm).command);
assert.match(uninstallLightdmScript, /apt-get purge -y/);
assert.match(uninstallLightdmScript, /systemctl enable --force 'sddm\.service'/);
assert.match(uninstallLightdmScript, /xdmcp-lightdm-owner/);
assert.match(uninstallLightdmScript, /90-terma-xdmcp\.conf/);
assert.match(uninstallLightdmScript, /90-tunneldesk-xdmcp\.conf/);

const legacyManagedLightdm = parseDetectionOutput([
  `${legacyPrefix}_OS_ID=debian`,
  `${legacyPrefix}_MANAGER=lightdm`,
  `${legacyPrefix}_SERVICE=lightdm`,
  `${legacyPrefix}_PACKAGE_MANAGER=apt`,
  `${legacyPrefix}_PRIVILEGED=1`,
  `${legacyPrefix}_ENABLED=1`,
  `${legacyPrefix}_LISTENING=1`,
  `${legacyPrefix}_SESSION=xfce|Xfce Session`
].join("\n"));
assert.equal(legacyManagedLightdm.manager, "lightdm");
assert.equal(legacyManagedLightdm.enabled, true);

const sddm = parseDetectionOutput([
  "TERMA_OS_ID=debian",
  "TERMA_MANAGER=sddm",
  "TERMA_SERVICE=sddm",
  "TERMA_PACKAGE_MANAGER=apt",
  "TERMA_PRIVILEGED=1",
  "TERMA_ENABLED=0",
  "TERMA_LISTENING=0",
  "TERMA_FIREWALL=none",
  "TERMA_SESSION=plasma|Plasma (X11)"
].join("\n"));
assert.equal(sddm.supported, false);
assert.equal(sddm.replacement_available, true);
assert.equal(sddm.action, "install-lightdm");
assert.deepEqual(sddm.sessions, [{id:"plasma", name:"Plasma (X11)"}]);
assert.equal(sddm.graphics_rendering.visible, false);

const installScript = unwrapRootScript(buildConfigurationScript(sddm, "install-lightdm", true));
assert.match(installScript, /apt-get install -y lightdm lightdm-gtk-greeter/);
assert.match(installScript, /\[XDMCPServer\][\s\S]*enabled=true[\s\S]*port=177/);
assert.match(installScript, /\[Seat:\*\][\s\S]*user-session=plasma/);
assert.match(installScript, /Session=%s\\n' 'plasma'/);
assert.match(installScript, /readlink -f \/usr\/bin\/x-session-manager/);
assert.match(installScript, /\[ "\$td_saved_valid" = 0 \]/);
assert.match(installScript, /td_file=\$td_dir\/90-terma-xdmcp\.conf/);
assert.match(installScript, /td_legacy_file=\$td_dir\/90-tunneldesk-xdmcp\.conf/);
assert.match(installScript, /if \[ -f "\$td_legacy_file" \]; then[\s\S]*rm -f "\$td_legacy_file"[\s\S]*install -m 644 "\$td_config_tmp" "\$td_file"/, "LightDM 迁移不能留下两个生效的 XDMCP 配置文件");
assert.match(installScript, /td_dm_backup="\$td_default_manager\.terma-backup-/);
assert.match(installScript, /\/var\/lib\/terma\/xdmcp-lightdm-owner/);
assert.match(installScript, /rm -f "\$td_legacy_owner"/);
assert.match(installScript, /systemctl stop sddm\.service/);
assert.match(installScript, /systemctl restart lightdm\.service/);
assert.match(installScript, /td_snapshot_file "\$td_file" terma-config/);
assert.match(installScript, /td_snapshot_file "\$td_legacy_file" legacy-config/);
assert.match(installScript, /td_snapshot_file "\$td_terma_owner" terma-owner/);
assert.match(installScript, /td_snapshot_file "\$td_legacy_owner" legacy-owner/);
assert.match(installScript, /td_snapshot_file "\$td_default_manager" default-manager/);
assert.match(installScript, /td_snapshot_file "\$td_dmrc" user-dmrc/);
assert.match(installScript, /td_restore_file "\$td_file" terma-config/);
assert.match(installScript, /td_restore_file "\$td_legacy_file" legacy-config/);
assert.match(installScript, /td_restore_file "\$td_terma_owner" terma-owner/);
assert.match(installScript, /td_restore_file "\$td_legacy_owner" legacy-owner/);
assert.match(installScript, /td_restore_file "\$td_default_manager" default-manager/);
assert.match(installScript, /td_restore_file "\$td_dmrc" user-dmrc/);
assert.match(installScript, /systemctl restart sddm\.service[^\n]*\|\| true/);
assert.match(installScript, /LightDM XDMCP 配置验证失败，已恢复修改前的新旧配置和状态并重新启动显示管理器/);
assert.match(installScript, /lightdm --show-config 2>&1/);
assert.match(installScript, /systemctl is-active lightdm\.service/);
assert.match(installScript, /for td_listener_attempt in 1 2 3 4 5 6 7 8 9/);
assert.match(installScript, /if td_udp_177_listening; then/);
assert.ok(installScript.indexOf('td_snapshot_file "$td_legacy_file" legacy-config') < installScript.indexOf('rm -f "$td_legacy_file"'), "旧配置必须在移除前进入事务快照");
assert.ok(installScript.indexOf("lightdm --show-config 2>&1") < installScript.lastIndexOf("systemctl restart lightdm.service"), "重启前必须先校验 LightDM 配置");
assert.ok(installScript.indexOf("td_listener_ready=0") < installScript.lastIndexOf("trap - EXIT HUP INT TERM"), "UDP 177 验证通过前不得提交事务");
assert.doesNotMatch(installScript, /rm -[^\n]*(?:terma|tunneldesk)-backup-/, "事务清理不得删除用户已有备份");

const disableLightdmScript = unwrapRootScript(buildConfigurationScript({...managedLightdm,preferred_session:{id:"xfce",name:"Xfce Session"}}, "disable", true));
assert.match(disableLightdmScript, /if td_lightdm_enabled_in_config; then/);
assert.match(disableLightdmScript, /if ! td_udp_177_listening; then/);
assert.match(disableLightdmScript, /UDP 177 仍在监听，将恢复修改前配置/);
assert.match(disableLightdmScript, /td_restore_file "\$td_legacy_file" legacy-config/);
assert.match(disableLightdmScript, /systemctl restart lightdm\.service[^\n]*\|\| true/);

const gdm = parseDetectionOutput([
  "TERMA_OS_ID=fedora",
  "TERMA_MANAGER=gdm",
  "TERMA_MANAGER_VERSION=49.2",
  "TERMA_GDM_XDMCP_CAPABLE=1",
  "TERMA_SERVICE=gdm",
  "TERMA_PACKAGE_MANAGER=dnf",
  "TERMA_PRIVILEGED=1",
  "TERMA_CONFIG=/etc/gdm/custom.conf",
  "TERMA_ENABLED=0",
  "TERMA_LISTENING=0",
  "TERMA_FIREWALL=firewalld-active",
  "TERMA_SESSION=gnome-xorg|GNOME on Xorg"
].join("\n"));
assert.equal(gdm.supported, true);
assert.equal(gdm.manager_version, "49.2");
assert.equal(gdm.gdm_xdmcp_capable, true);
assert.equal(gdm.action, "enable");
const gdmScript = unwrapRootScript(buildConfigurationScript(gdm, "enable", true));
const editorPayload = /printf '%s' '([^']+)' \| base64 -d >/.exec(gdmScript);
assert.ok(editorPayload);
const editor = Buffer.from(editorPayload[1], "base64").toString("utf8");
assert.match(editor, /set_key\(text, "xdmcp", "Enable"/);
assert.match(editor, /set_key\(text, "daemon", "WaylandEnable", "false"\)/);
assert.match(gdmScript, /systemctl restart gdm\.service/);
assert.match(gdmScript, /firewall-cmd --permanent --add-port=177\/udp/);
assert.match(gdmScript, /xdmcp-firewall-owner/);
const gdmDisableScript = unwrapRootScript(buildConfigurationScript({...gdm,firewall_managed:true}, "disable", true));
assert.match(gdmDisableScript, /firewall-cmd --permanent --remove-port=177\/udp/);
assert.match(gdmDisableScript, /rm -f "\$td_firewall_marker"/);

const currentGdm = parseDetectionOutput([
  "TERMA_OS_ID=ubuntu",
  "TERMA_MANAGER=gdm",
  "TERMA_MANAGER_VERSION=50.0",
  "TERMA_GDM_XDMCP_CAPABLE=0",
  "TERMA_SERVICE=gdm3",
  "TERMA_PACKAGE_MANAGER=apt",
  "TERMA_PRIVILEGED=1",
  "TERMA_CONFIG=/etc/gdm3/custom.conf",
  "TERMA_ENABLED=1",
  "TERMA_LISTENING=0",
  "TERMA_FIREWALL=none",
  "TERMA_SESSION=gnome-xorg|GNOME on Xorg"
].join("\n"));
assert.equal(currentGdm.supported, false);
assert.equal(currentGdm.replacement_available, true);
assert.equal(currentGdm.action, "install-lightdm");
assert.match(currentGdm.warning, /GDM 50/);
const currentGdmInstallScript = unwrapRootScript(buildConfigurationScript(currentGdm, "install-lightdm", true));
assert.match(currentGdmInstallScript, /systemctl disable gdm3\.service/);
assert.match(currentGdmInstallScript, /systemctl stop gdm3\.service/);

const rows = [{id:1,name:"Linux",ssh_host:"192.0.2.10",ssh_user:"root",ssh_port:22,favorite:1}];
const dependencies = {
  listConnections:() => rows,
  getConnection:id => ({...rows.find(item => item.id === Number(id)), identity_file:"fixture"}),
  runSshCommandForConnection:async () => ({status:0,stdout:[
    "TERMA_OS_ID=debian",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_CONFIG=/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_FIREWALL=none",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"),stderr:""})
};
const profile = {host:"192.0.2.10",options:{ssh_connection_id:0}};
assert.equal(resolveManagementConnection(profile, dependencies).id, 1);
const detectedPromise = detectXdmcpServer(profile, dependencies);

Promise.resolve(detectedPromise).then(async detected => {
  assert.equal(detected.listening, true);
  assert.equal(detected.desktop_selection, "login-screen");
  assert.equal(detected.ssh_connection.id, 1);
  assert.equal(detected.graphics_rendering.state, "remote-x11");
  assert.equal(detected.legacy_config, true, "旧 TunnelDesk LightDM 配置仍需被被动识别");

  assert.throws(() => resolveManagementConnection(profile, {...dependencies,listConnections:() => [...rows,{...rows[0],id:2,name:"Linux 2"}]}), /多个同主机/);
  assert.match(DETECT_SCRIPT, /\/usr\/share\/xsessions/);
  assert.match(DETECT_SCRIPT, /lightdm --show-config 2>&1/);
  assert.match(DETECT_SCRIPT, /\(\[\[:upper:\]\]\[\[:space:\]\]\+\)\?enabled/);
  assert.match(DETECT_SCRIPT, /ss -H -lun/);
  assert.match(DETECT_SCRIPT, /\$4 ~ \/:177\$\//);
  assert.match(DETECT_SCRIPT, /terma_emit FIREWALL_MANAGED/);
  assert.match(DETECT_SCRIPT, /terma_emit MANAGER_VERSION/);
  assert.match(DETECT_SCRIPT, /terma_emit GDM_XDMCP_CAPABLE/);
  assert.match(DETECT_SCRIPT, /terma_emit CONFIGURED_SESSION/);
  assert.match(DETECT_SCRIPT, /terma_emit SAVED_SESSION/);
  assert.match(DETECT_SCRIPT, /readlink -f \/usr\/bin\/x-session-manager/);
  assert.match(DETECT_SCRIPT, /terma_emit SESSION_MANAGER_TARGET/);
  assert.match(DETECT_SCRIPT, /terma_emit XRDP_INSTALLED/);
  assert.match(DETECT_SCRIPT, /dbus-run-session/);
  assert.match(DETECT_SCRIPT, /loginctl show-session/);
  assert.match(DETECT_SCRIPT, /terma_emit GRAPHICAL_SESSION/);
  assert.match(DETECT_SCRIPT, /terma_emit PLASMA_DISPLAY/);
  assert.match(DETECT_SCRIPT, /find \/usr\/share\/xsessions -maxdepth 1 -type f -name '\*\.desktop'/);
  assert.doesNotMatch(DETECT_SCRIPT, /set -f/);

  const macos = parseDetectionOutput([
    "TERMA_OS_ID=macos",
    "TERMA_OS_LIKE=darwin",
    "TERMA_MANAGER=unknown",
    "TERMA_PACKAGE_MANAGER=none",
    "TERMA_PRIVILEGED=0",
    "TERMA_ENABLED=0",
    "TERMA_LISTENING=0"
  ].join("\n"));
  assert.equal(macos.platform_unsupported, true);
  assert.equal(macos.action, "unsupported");
  assert.equal(macos.ready_for_login, false);
  assert.match(macos.warning, /macOS/);

  const unprivileged = parseDetectionOutput([
    "TERMA_OS_ID=linx",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=0",
    "TERMA_ENABLED=0",
    "TERMA_LISTENING=0",
    "TERMA_SESSION=mate|MATE"
  ].join("\n"));
  assert.equal(unprivileged.action, "manual");
  assert.equal(unprivileged.required_action, "enable");
  assert.equal(unprivileged.ready_for_login, false);
  assert.match(unprivileged.warning, /root 或免密 sudo/);

const noDesktopSession = parseDetectionOutput([
    "TERMA_OS_ID=debian",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1"
  ].join("\n"));
  assert.equal(noDesktopSession.has_x11_session, false);
  assert.equal(noDesktopSession.needs_desktop_install, true);
  assert.equal(noDesktopSession.can_install_xfce, true);
  assert.equal(noDesktopSession.action, "install-xfce");
  assert.equal(noDesktopSession.ready_for_login, false);
  assert.match(noDesktopSession.warning, /UDP 177 正在监听/);
  const xfceScript = unwrapRootScript(buildConfigurationScript(noDesktopSession, "install-xfce", false));
  assert.match(xfceScript, /apt-get install -y xfce4 dbus-x11/);
  assert.match(xfceScript, /user-session=xfce/);
  assert.match(xfceScript, /unset DBUS_SESSION_BUS_ADDRESS/);
  assert.match(xfceScript, /dbus-run-session -- startxfce4/);
  assert.match(xfceScript, /systemctl restart xrdp\.service/);

  const noDesktopOrXdmcp = parseDetectionOutput([
    "TERMA_OS_ID=debian",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=0",
    "TERMA_LISTENING=0"
  ].join("\n"));
  assert.match(noDesktopOrXdmcp.warning, /XDMCP 尚未启用、UDP 177 未监听/);
  assert.doesNotMatch(noDesktopOrXdmcp.warning, /服务已监听/);

  const rootPlasma = parseDetectionOutput([
    "TERMA_OS_ID=debian",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_LOGIN_USER=root",
    "TERMA_SAVED_SESSION=plasma",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(rootPlasma.root_plasma_risk, true);
  assert.equal(rootPlasma.action, "install-xfce");
  assert.equal(rootPlasma.ready_for_login, false);

  const xrdpRepair = parseDetectionOutput([
    "TERMA_OS_ID=debian",
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_LOGIN_USER=root",
    "TERMA_XRDP_INSTALLED=1",
    "TERMA_XRDP_XFCE_CONFIGURED=0",
    "TERMA_SESSION=xfce|Xfce Session"
  ].join("\n"));
  assert.equal(xrdpRepair.xrdp_needs_repair, true);
  assert.equal(xrdpRepair.action, "repair-xrdp");
  const xrdpRepairScript = unwrapRootScript(buildConfigurationScript(xrdpRepair, "repair-xrdp", false));
  assert.match(xrdpRepairScript, /dbus-run-session -- startxfce4/);
  assert.match(xrdpRepairScript, /systemctl restart xrdp\.service/);

  const brokenSession = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_CONFIGURED_SESSION=kde-plasma-kf5",
    "TERMA_SAVED_SESSION=lightdm-xsession",
    "TERMA_SESSION=lightdm-xsession|Default XSession",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(brokenSession.session_needs_repair, true);
  assert.equal(brokenSession.action, "repair-session");
  assert.match(brokenSession.warning, /Plasma/);
  const repairScript = unwrapRootScript(buildConfigurationScript(brokenSession, "repair-session", false));
  assert.match(repairScript, /Session=%s\\n' 'plasma'/);

  const resolvedDefaultSession = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_CONFIGURED_SESSION=kde-plasma-kf5",
    "TERMA_SAVED_SESSION=lightdm-xsession",
    "TERMA_SESSION_MANAGER_TARGET=/usr/bin/startplasma-x11",
    "TERMA_SESSION=lightdm-xsession|Default XSession",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(resolvedDefaultSession.session_needs_repair, false);
  assert.deepEqual(resolvedDefaultSession.resolved_saved_session, {id:"plasma", name:"Plasma (X11)"});
  assert.equal(resolvedDefaultSession.resolved_saved_session_label, "lightdm-xsession -> Plasma (X11)");
  assert.equal(resolvedDefaultSession.session_manager_target, "/usr/bin/startplasma-x11");
  assert.equal(resolvedDefaultSession.action, "ready");
  const resolvedDefaultAlias = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_SAVED_SESSION=default",
    "TERMA_SESSION_MANAGER_TARGET=/usr/bin/startxfce4",
    "TERMA_SESSION=xfce|Xfce Session"
  ].join("\n"));
  assert.equal(resolvedDefaultAlias.session_needs_repair, false);
  assert.deepEqual(resolvedDefaultAlias.resolved_saved_session, {id:"xfce", name:"Xfce Session"});
  assert.equal(resolvedDefaultAlias.resolved_saved_session_label, "default -> Xfce Session");

  const conflictingSession = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_SERVICE=lightdm",
    "TERMA_PACKAGE_MANAGER=apt",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_LOGIN_USER=root",
    "TERMA_PLASMA_DISPLAY=:10.0",
    "TERMA_GRAPHICAL_SESSION=c9|xrdp-sesman|:10||plasma|active",
    "TERMA_GRAPHICAL_SESSION=348|lightdm|192.0.2.20:3||lightdm-xsession|active",
    "TERMA_GRAPHICAL_SESSION=349|lightdm|:10||lightdm-xsession|closing",
    "TERMA_GRAPHICAL_SESSION=350|lightdm|:10||lightdm-xsession|dead",
    "TERMA_GRAPHICAL_SESSION=12|lightdm|:0|seat0|plasma|active",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(conflictingSession.session_conflict, true);
  assert.equal(conflictingSession.can_cleanup_remote_sessions, true);
  assert.equal(conflictingSession.remote_graphical_sessions.length, 2);
  assert.equal(conflictingSession.local_graphical_sessions.length, 1);
  assert.deepEqual(conflictingSession.matching_remote_graphical_sessions.map(item => item.id), ["c9"]);
  assert.equal(conflictingSession.matching_local_graphical_sessions.length, 0);
  assert.deepEqual(conflictingSession.active_graphical_sessions.map(item => item.id), ["c9", "348", "12"]);
  assert.equal(conflictingSession.action, "cleanup-sessions");
  assert.match(conflictingSession.warning, /Plasma.*:10\.0/);
  const cleanupScript = unwrapRootScript(buildConfigurationScript(conflictingSession, "cleanup-sessions", false));
  assert.match(cleanupScript, /loginctl terminate-session/);
  assert.match(cleanupScript, /td_target_display=':10\.0'/);
  assert.match(cleanupScript, /td_expected_sessions='c9'/);
  assert.doesNotMatch(cleanupScript, /td_expected_sessions='[^']*348/);
  assert.match(cleanupScript, /State --value/);
  assert.match(cleanupScript, /closing\|dead/);
  assert.match(cleanupScript, /td_normalize_display/);
  assert.match(cleanupScript, /\/proc\/\$td_process_pid\/environ/);
  assert.doesNotMatch(cleanupScript, /systemctl --user stop/);
  assert.doesNotMatch(cleanupScript, /pkill -TERM/);

  const localConflict = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_LOGIN_USER=root",
    "TERMA_PLASMA_DISPLAY=:0",
    "TERMA_GRAPHICAL_SESSION=12|lightdm|:0|seat0|plasma|active",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(localConflict.session_conflict, true);
  assert.equal(localConflict.can_cleanup_remote_sessions, false);
  assert.match(localConflict.warning, /本地桌面/);
  assert.throws(() => buildConfigurationScript(localConflict, "cleanup-sessions", false), /安全结束/);

  const unrelatedOrClosingSessions = parseDetectionOutput([
    "TERMA_MANAGER=lightdm",
    "TERMA_PRIVILEGED=1",
    "TERMA_ENABLED=1",
    "TERMA_LISTENING=1",
    "TERMA_LOGIN_USER=root",
    "TERMA_PLASMA_DISPLAY=:10.0",
    "TERMA_GRAPHICAL_SESSION=12|lightdm|:0|seat0|plasma|active",
    "TERMA_GRAPHICAL_SESSION=348|lightdm|:11||plasma|active",
    "TERMA_GRAPHICAL_SESSION=349|lightdm|:10||plasma|closing",
    "TERMA_GRAPHICAL_SESSION=350|lightdm|:10||plasma|dead",
    "TERMA_SESSION=plasma|Plasma (X11)"
  ].join("\n"));
  assert.equal(unrelatedOrClosingSessions.session_conflict, false);
  assert.equal(unrelatedOrClosingSessions.can_cleanup_remote_sessions, false);
  assert.equal(unrelatedOrClosingSessions.action, "ready");
  assert.equal(unrelatedOrClosingSessions.matching_graphical_sessions.length, 0);

  assert.equal(validateXdmcpState("enable", {enabled:true,listening:true}, true), true);
  assert.match(validateXdmcpState("enable", {enabled:false,listening:true}, true), /配置仍未启用/);
  assert.match(validateXdmcpState("enable", {enabled:true,listening:false}, true), /UDP 177 仍未监听/);
  assert.equal(validateXdmcpState("enable", {enabled:true,listening:false}, false), true);

  let retryCalls = 0;
  const retried = await waitForXdmcpState(profile, {
    ...dependencies,
    waitForXdmcpRetry:async () => {},
    runSshCommandForConnection:async () => {
      retryCalls += 1;
      const ready = retryCalls >= 3;
      return {status:0,stdout:[
        "TERMA_OS_ID=debian","TERMA_MANAGER=lightdm","TERMA_SERVICE=lightdm","TERMA_PACKAGE_MANAGER=apt","TERMA_PRIVILEGED=1",
        `TERMA_ENABLED=${retryCalls >= 2 ? 1 : 0}`,`TERMA_LISTENING=${ready ? 1 : 0}`,"TERMA_FIREWALL=none","TERMA_SESSION=plasma|Plasma (X11)"
      ].join("\n"),stderr:""};
    }
  }, "enable", true);
  assert.equal(retryCalls, 3);
  assert.equal(retried.listening, true);

  let taskOptions = null;
  let taskDetectCalls = 0;
  const queued = await configureXdmcpServer(profile, {action:"enable",restart:true,confirmation:"XDMCP_TRUSTED_LAN"}, {
    ...dependencies,
    waitForXdmcpRetry:async () => {},
    startRemoteCommandTask:options => {
      taskOptions = options;
      return {id:"xdmcp-task-fixture"};
    },
    runSshCommandForConnection:async () => {
      taskDetectCalls += 1;
      const enabled = taskDetectCalls >= 3;
      const listening = taskDetectCalls >= 4;
      return {status:0,stdout:[
        "TERMA_OS_ID=debian","TERMA_MANAGER=lightdm","TERMA_SERVICE=lightdm","TERMA_PACKAGE_MANAGER=apt","TERMA_PRIVILEGED=1",
        `TERMA_ENABLED=${enabled ? 1 : 0}`,`TERMA_LISTENING=${listening ? 1 : 0}`,"TERMA_FIREWALL=none","TERMA_SESSION=plasma|Plasma (X11)"
      ].join("\n"),stderr:""};
    }
  });
  assert.equal(queued.task.id, "xdmcp-task-fixture");
  assert.ok(taskOptions);
  const taskAfter = await taskOptions.verify();
  assert.equal(taskAfter.enabled, true);
  assert.equal(taskAfter.listening, true);
  assert.equal(taskOptions.validate(taskAfter), true);
  assert.equal(taskDetectCalls, 4);

  let calls = 0;
  const configureDependencies = {
    ...dependencies,
    runSshCommandForConnection:async (_connection, command) => {
      calls += 1;
      const script = unwrapRemotePosixCommand(command);
      if (script === DETECT_SCRIPT) return {status:0,stdout:calls < 3 ? [
        "TERMA_OS_ID=debian","TERMA_MANAGER=lightdm","TERMA_SERVICE=lightdm","TERMA_PACKAGE_MANAGER=apt","TERMA_PRIVILEGED=1","TERMA_ENABLED=0","TERMA_LISTENING=0","TERMA_FIREWALL=none","TERMA_SESSION=plasma|Plasma (X11)"
      ].join("\n") : [
        "TERMA_OS_ID=debian","TERMA_MANAGER=lightdm","TERMA_SERVICE=lightdm","TERMA_PACKAGE_MANAGER=apt","TERMA_PRIVILEGED=1","TERMA_ENABLED=1","TERMA_LISTENING=1","TERMA_FIREWALL=none","TERMA_SESSION=plasma|Plasma (X11)"
      ].join("\n"),stderr:""};
      assert.match(unwrapRootScript(script), /enabled=true/);
      return {status:0,stdout:"TERMA_CONFIGURED=lightdm\nTERMA_ENABLED=1\n",stderr:""};
    }
  };
  const configured = await configureXdmcpServer(profile, {action:"enable",restart:true,confirmation:"XDMCP_TRUSTED_LAN"}, configureDependencies);
  assert.equal(configured.after.listening, true);
  assert.equal(calls, 3);
  await assert.rejects(() => configureXdmcpServer(profile, {action:"enable",confirmation:"wrong"}, configureDependencies), /可信局域网/);
  await assert.rejects(() => configureXdmcpServer(profile, {action:"cleanup-sessions",confirmation:"wrong"}, configureDependencies), /结束同账号/);
  console.log("XDMCP 管理检查通过：自动探测、SSH 绑定、会话冲突清理、SDDM 替换、LightDM/GDM 安全配置与确认边界");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
