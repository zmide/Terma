const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DESKTOP_IDS,
  DETECT_SCRIPT,
  buildInstallScript,
  buildUninstallScript,
  desktopInstallPlan,
  desktopUninstallPlan,
  isLinuxPlatform,
  normalizeDesktopId,
  parseDetectionOutput
} = require("../dist/linux-desktop-manager");

assert.ok(DETECT_SCRIPT.includes("/usr/share/xsessions"));
assert.ok(DETECT_SCRIPT.includes("PACKAGE_MANAGER"));
assert.ok(DETECT_SCRIPT.includes("SYSTEM_SESSION"));
assert.ok(DETECT_SCRIPT.includes("SAVED_SESSION"));
assert.ok(DETECT_SCRIPT.includes("XRDP_SESSION"));
assert.ok(DETECT_SCRIPT.includes("XRDP_ACTIVE"));
assert.ok(DETECT_SCRIPT.includes("XRDP_LISTENING"));
assert.ok(DETECT_SCRIPT.includes("XRDP_ENABLED"));
assert.ok(DETECT_SCRIPT.includes("VNC_CONFIGURED_SESSION"));
assert.ok(DETECT_SCRIPT.includes("loginctl show-session"));
assert.ok(DETECT_SCRIPT.includes("VNC_PROCESS"));
const detected = parseDetectionOutput([
  "TD_KERNEL=Linux",
  "TD_OS_ID=debian",
  "TD_PACKAGE_MANAGER=apt",
  "TD_DISPLAY_MANAGER=lightdm",
  "TD_PRIVILEGED=1",
  "TD_XRDP_INSTALLED=1",
  "TD_XRDP_ACTIVE=1",
  "TD_XRDP_LISTENING=1",
  "TD_XRDP_ENABLED=1",
  "TD_VNC_SERVER=1",
  "TD_LOGIN_USER=ha2",
  "TD_SYSTEM_SESSION=gnome",
  "TD_SYSTEM_SESSION_SOURCE=lightdm",
  "TD_XDMCP_ENABLED=1",
  "TD_XDMCP_SESSION=mate",
  "TD_XDMCP_SESSION_SOURCE=/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf",
  "TD_SAVED_SESSION=mate",
  "TD_SAVED_SESSION_SOURCE=/home/ha2/.dmrc",
  "TD_XRDP_SESSION=exec dbus-run-session -- startxfce4",
  "TD_XRDP_SESSION_SOURCE=/etc/xrdp/startwm.sh",
  "TD_VNC_CONFIGURED_SESSION=xfce",
  "TD_VNC_CONFIGURED_SOURCE=/home/ha2/.vnc/config",
  "TD_SESSION=xfce|Xfce Session",
  "TD_SESSION=gnome|GNOME",
  "TD_SESSION=mate|MATE",
  "TD_GRAPHICAL_SESSION=2|ha2|gdm-password|:0|seat0|GNOME|active",
  "TD_GRAPHICAL_SESSION=7|ha2|xrdp-sesman|:10||XFCE|active",
  "TD_VNC_PROCESS=433|ha2|shared|:0||x11vnc",
  "TD_VNC_PROCESS=811|ha2|virtual|:11||Xtigervnc",
  "TD_SESSION=plasma|Plasma"
].join("\n"));
assert.equal(detected.has_desktop, true);
assert.equal(detected.platform_supported, true);
assert.deepEqual(detected.desktops.map(item => item.id), ["xfce", "gnome", "plasma", "mate"]);
assert.equal(detected.system_default_session.desktop_id, "gnome");
assert.equal(detected.account_default_session.desktop_id, "mate");
assert.equal(detected.xdmcp_configured_session.desktop_id, "mate");
assert.equal(detected.xrdp_configured_session.desktop_id, "xfce");
assert.equal(detected.xrdp_active, true);
assert.equal(detected.xrdp_listening, true);
assert.equal(detected.xrdp_enabled, true);
assert.equal(detected.vnc_configured_session.desktop_id, "xfce");
assert.equal(detected.desktop_usage.gnome.system_default, true);
assert.equal(detected.desktop_usage.gnome.local_active, true);
assert.equal(detected.desktop_usage.mate.account_default, true);
assert.equal(detected.desktop_usage.mate.xdmcp_configured, true);
assert.equal(detected.desktop_usage.xfce.rdp_configured, true);
assert.equal(detected.desktop_usage.xfce.rdp_active, true);
assert.equal(detected.desktop_usage.xfce.remote_active, true);
assert.equal(detected.desktop_usage.gnome.vnc_shared, true);
assert.equal(detected.desktop_usage.xfce.vnc_virtual_active, true);
assert.equal(detected.desktop_selection.vnc.state, "active");
assert.equal(detected.active_vnc_sessions.find(item => item.command === "x11vnc").desktop_id, "gnome");
assert.equal(detected.active_vnc_sessions.find(item => item.command === "Xtigervnc").desktop_id, "xfce");
const inferredRdp = parseDetectionOutput([
  "TD_KERNEL=Linux",
  "TD_OS_ID=debian",
  "TD_XRDP_INSTALLED=1",
  "TD_XRDP_SESSION=exec dbus-run-session -- startxfce4",
  "TD_GRAPHICAL_SESSION=c42|root|xrdp-sesman|:10|||active",
  "TD_DESKTOP=xfce"
].join("\n"));
assert.equal(inferredRdp.active_graphical_sessions[0].desktop_id, "xfce");
assert.equal(inferredRdp.active_graphical_sessions[0].inferred_from, "xrdp-config");
assert.equal(inferredRdp.desktop_usage.xfce.rdp_active, true);
assert.ok(desktopInstallPlan({...detected, requested_desktop:"xfce"}));
assert.ok(desktopUninstallPlan({...detected, requested_desktop:"xfce"}));
assert.equal(isLinuxPlatform("debian", ""), true);
assert.equal(isLinuxPlatform("ubuntu", "debian"), true);
assert.equal(isLinuxPlatform("linx", "", "Linux"), true);
assert.equal(isLinuxPlatform("macos", "darwin"), false);
assert.equal(normalizeDesktopId("gnome-session --session=mate"), "mate");
assert.equal(normalizeDesktopId("/usr/bin/startplasma-x11"), "plasma");
assert.equal(normalizeDesktopId("ubuntu:GNOME"), "gnome");
const linx = parseDetectionOutput("TD_KERNEL=Linux\nTD_OS_ID=linx\nTD_PACKAGE_MANAGER=apt\nTD_DISPLAY_MANAGER=lightdm\nTD_DESKTOP=mate");
assert.equal(linx.platform_supported, true);
assert.deepEqual(linx.desktops.map(item => item.id), ["mate"]);
assert.equal(linx.desktop_selection.system_default.state, "unknown");
assert.equal(linx.desktop_selection.account_default.state, "login-selection");
assert.equal(linx.desktop_selection.xdmcp.state, "disabled");

const unknownVnc = parseDetectionOutput([
  "TD_KERNEL=Linux",
  "TD_OS_ID=ubuntu",
  "TD_VNC_SERVER=1",
  "TD_VNC_PROCESS=900|ha2|virtual|:12||Xtigervnc",
  "TD_DESKTOP=gnome"
].join("\n"));
assert.equal(unknownVnc.desktop_selection.vnc.state, "active-unknown");
assert.equal(unknownVnc.active_vnc_sessions[0].desktop_id, "");
assert.equal(unknownVnc.desktop_usage.gnome.vnc_virtual_active, false);
const otherUserVnc = parseDetectionOutput([
  "TD_KERNEL=Linux",
  "TD_OS_ID=ubuntu",
  "TD_LOGIN_USER=ha2",
  "TD_VNC_SERVER=1",
  "TD_VNC_CONFIGURED_SESSION=xfce",
  "TD_VNC_CONFIGURED_SOURCE=/home/ha2/.vnc/config",
  "TD_VNC_PROCESS=901|other|virtual|:13||Xtigervnc",
  "TD_DESKTOP=xfce"
].join("\n"));
assert.equal(otherUserVnc.active_vnc_sessions[0].desktop_id, "");
assert.ok(DESKTOP_IDS.includes("gnome"));
const script = buildInstallScript({...detected, package_manager:"apt"}, "xfce");
const payload = /td_payload='([^']+)'/.exec(script)?.[1] || "";
const decoded = Buffer.from(payload, "base64").toString("utf8");
assert.match(decoded, /apt-get update/);
assert.match(decoded, /TD_DESKTOP_%s/);
assert.match(decoded, /td_emit STAGE/);
assert.match(decoded, /td_emit LOG/);
const uninstallScript = buildUninstallScript({...detected, package_manager:"apt"}, "xfce");
const uninstallPayload = /td_payload='([^']+)'/.exec(uninstallScript)?.[1] || "";
const decodedUninstall = Buffer.from(uninstallPayload, "base64").toString("utf8");
assert.match(decodedUninstall, /apt-get purge/);
assert.match(decodedUninstall, /dpkg-query/);
assert.doesNotMatch(decodedUninstall, /autoremove/);
assert.match(decodedUninstall, /td_emit STAGE "verify"/);
const remoteUi = fs.readFileSync(path.join(__dirname, "..", "public", "app-remote.js"), "utf8");
assert.match(remoteUi, /系统默认/);
assert.match(remoteUi, /账号默认/);
assert.match(remoteUi, /XDMCP 配置/);
assert.match(remoteUi, /RDP 当前会话/);
assert.match(remoteUi, /VNC 共享当前会话/);
assert.match(remoteUi, /虚拟会话 · 桌面由登录\/启动配置决定/);
assert.match(remoteUi, /远程桌面不要求服务器连接物理显示器/);
console.log("Linux 桌面管理检查通过：Debian/Linux 识别、安装卸载方案、阶段标记和日志标记正常");
