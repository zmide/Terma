const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
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
const legacyPrefix = ["T", "D"].join("");

assert.ok(DETECT_SCRIPT.includes("/usr/share/xsessions"));
assert.ok(DETECT_SCRIPT.includes("TERMA_"));
assert.equal(DETECT_SCRIPT.includes(`${legacyPrefix}_`), false);
assert.ok(DETECT_SCRIPT.includes("PACKAGE_MANAGER"));
assert.ok(DETECT_SCRIPT.includes("SYSTEM_SESSION"));
assert.ok(DETECT_SCRIPT.includes("SAVED_SESSION"));
assert.ok(DETECT_SCRIPT.includes("XRDP_SESSION"));
assert.ok(DETECT_SCRIPT.includes("XRDP_ACTIVE"));
assert.ok(DETECT_SCRIPT.includes("XRDP_LISTENING"));
assert.ok(DETECT_SCRIPT.includes("XRDP_ENABLED"));
assert.match(DETECT_SCRIPT, /PATH="\/usr\/local\/sbin:[^"]*\/usr\/sbin:[^"]*\/sbin/, "LightDM desktop detection must restore standard sbin paths for unprivileged SSH accounts");
assert.match(DETECT_SCRIPT, /\[ -x \/usr\/sbin\/xrdp \]/, "xrdp detection must work when /usr/sbin is absent from an unprivileged PATH");
assert.match(DETECT_SCRIPT, /\[ -x \/usr\/sbin\/xrdp-sesman \]/, "xrdp-sesman must count as an installed xrdp package entry point");
assert.match(DETECT_SCRIPT, /dpkg-query -s xrdp[\s\S]*install ok installed/, "Debian package state must supplement executable lookup");
assert.ok(DETECT_SCRIPT.includes("XRDP_DRM_DEVICE"));
assert.ok(DETECT_SCRIPT.includes("XRDP_SOFTWARE_RENDERING"));
assert.ok(DETECT_SCRIPT.includes("DRISWRAST"));
assert.ok(DETECT_SCRIPT.includes("VNC_CONFIGURED_SESSION"));
assert.ok(DETECT_SCRIPT.includes("loginctl show-session"));
assert.ok(DETECT_SCRIPT.includes("VNC_PROCESS"));
const detected = parseDetectionOutput([
  "TERMA_KERNEL=Linux",
  "TERMA_OS_ID=debian",
  "TERMA_PACKAGE_MANAGER=apt",
  "TERMA_DISPLAY_MANAGER=lightdm",
  "TERMA_PRIVILEGED=1",
  "TERMA_XRDP_INSTALLED=1",
  "TERMA_XRDP_ACTIVE=1",
  "TERMA_XRDP_LISTENING=1",
  "TERMA_XRDP_ENABLED=1",
  "TERMA_XRDP_RENDER_DISPLAY=:10",
  "TERMA_XRDP_RENDER_LOG=/home/ha2/.xorgxrdp.10.log",
  "TERMA_XRDP_DRM_DEVICE=/dev/dri/renderD128",
  "TERMA_XRDP_DRM_AVAILABLE=0",
  "TERMA_XRDP_DRI3_CONFIGURED=1",
  "TERMA_XRDP_SOFTWARE_RENDERING=1",
  "TERMA_VNC_SERVER=1",
  "TERMA_LOGIN_USER=ha2",
  "TERMA_SYSTEM_SESSION=gnome",
  "TERMA_SYSTEM_SESSION_SOURCE=lightdm",
  "TERMA_XDMCP_ENABLED=1",
  "TERMA_XDMCP_SESSION=mate",
  "TERMA_XDMCP_SESSION_SOURCE=/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf",
  "TERMA_SAVED_SESSION=mate",
  "TERMA_SAVED_SESSION_SOURCE=/home/ha2/.dmrc",
  "TERMA_XRDP_SESSION=exec dbus-run-session -- startxfce4",
  "TERMA_XRDP_SESSION_SOURCE=/etc/xrdp/startwm.sh",
  "TERMA_VNC_CONFIGURED_SESSION=xfce",
  "TERMA_VNC_CONFIGURED_SOURCE=/home/ha2/.vnc/config",
  "TERMA_SESSION=xfce|Xfce Session",
  "TERMA_SESSION=gnome|GNOME",
  "TERMA_SESSION=mate|MATE",
  "TERMA_GRAPHICAL_SESSION=2|ha2|gdm-password|:0|seat0|GNOME|active",
  "TERMA_GRAPHICAL_SESSION=7|ha2|xrdp-sesman|:10||XFCE|active",
  "TERMA_VNC_PROCESS=433|ha2|shared|:0||x11vnc",
  "TERMA_VNC_PROCESS=811|ha2|virtual|:11||Xtigervnc",
  "TERMA_SESSION=plasma|Plasma"
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
assert.equal(detected.xrdp_dri3_configured, true);
assert.equal(detected.graphics_rendering.state, "software");
assert.equal(detected.graphics_rendering.java_gui_risk, true);
assert.match(detected.graphics_rendering.detail, /可能白屏/);
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
  "TERMA_KERNEL=Linux",
  "TERMA_OS_ID=debian",
  "TERMA_XRDP_INSTALLED=1",
  "TERMA_XRDP_SESSION=exec dbus-run-session -- startxfce4",
  "TERMA_GRAPHICAL_SESSION=c42|root|xrdp-sesman|:10|||active",
  "TERMA_DESKTOP=xfce"
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
const linx = parseDetectionOutput("TERMA_KERNEL=Linux\nTERMA_OS_ID=linx\nTERMA_PACKAGE_MANAGER=apt\nTERMA_DISPLAY_MANAGER=lightdm\nTERMA_DESKTOP=mate");
assert.equal(linx.platform_supported, true);
assert.deepEqual(linx.desktops.map(item => item.id), ["mate"]);
assert.equal(linx.desktop_selection.system_default.state, "unknown");
assert.equal(linx.desktop_selection.account_default.state, "login-selection");
assert.equal(linx.desktop_selection.xdmcp.state, "disabled");
const legacyLinx = parseDetectionOutput(`${legacyPrefix}_KERNEL=Linux\n${legacyPrefix}_OS_ID=linx\n${legacyPrefix}_DESKTOP=mate`);
assert.equal(legacyLinx.platform_supported, true);
assert.deepEqual(legacyLinx.desktops.map(item => item.id), ["mate"]);
const currentPrefixWins = parseDetectionOutput(`${legacyPrefix}_OS_ID=legacy\nTERMA_OS_ID=ubuntu\nTERMA_KERNEL=Linux`);
assert.equal(currentPrefixWins.os_id, "ubuntu");

const unknownVnc = parseDetectionOutput([
  "TERMA_KERNEL=Linux",
  "TERMA_OS_ID=ubuntu",
  "TERMA_VNC_SERVER=1",
  "TERMA_VNC_PROCESS=900|ha2|virtual|:12||Xtigervnc",
  "TERMA_DESKTOP=gnome"
].join("\n"));
assert.equal(unknownVnc.desktop_selection.vnc.state, "active-unknown");
assert.equal(unknownVnc.active_vnc_sessions[0].desktop_id, "");
assert.equal(unknownVnc.desktop_usage.gnome.vnc_virtual_active, false);
const otherUserVnc = parseDetectionOutput([
  "TERMA_KERNEL=Linux",
  "TERMA_OS_ID=ubuntu",
  "TERMA_LOGIN_USER=ha2",
  "TERMA_VNC_SERVER=1",
  "TERMA_VNC_CONFIGURED_SESSION=xfce",
  "TERMA_VNC_CONFIGURED_SOURCE=/home/ha2/.vnc/config",
  "TERMA_VNC_PROCESS=901|other|virtual|:13||Xtigervnc",
  "TERMA_DESKTOP=xfce"
].join("\n"));
assert.equal(otherUserVnc.active_vnc_sessions[0].desktop_id, "");
assert.ok(DESKTOP_IDS.includes("gnome"));
const script = buildInstallScript({...detected, package_manager:"apt"}, "xfce");
const payload = /td_payload='([^']+)'/.exec(script)?.[1] || "";
const decoded = Buffer.from(payload, "base64").toString("utf8");
assert.match(decoded, /apt-get update/);
assert.match(decoded, /TERMA_DESKTOP_%s/);
assert.match(decoded, /terma_emit STAGE/);
assert.match(decoded, /terma_emit LOG/);
const uninstallScript = buildUninstallScript({...detected, package_manager:"apt"}, "xfce");
const uninstallPayload = /td_payload='([^']+)'/.exec(uninstallScript)?.[1] || "";
const decodedUninstall = Buffer.from(uninstallPayload, "base64").toString("utf8");
assert.match(decodedUninstall, /apt-get purge/);
assert.match(decodedUninstall, /dpkg-query/);
assert.doesNotMatch(decodedUninstall, /autoremove/);
assert.match(decodedUninstall, /terma_emit STAGE "verify"/);
const remoteUi = readFrontendDomain(path.join(__dirname, ".."), "remote");
assert.match(remoteUi, /系统默认/);
assert.match(remoteUi, /账号默认/);
assert.match(remoteUi, /XDMCP 配置/);
assert.match(remoteUi, /RDP 当前会话/);
assert.match(remoteUi, /VNC 共享当前会话/);
assert.match(remoteUi, /虚拟会话 · 桌面由登录\/启动配置决定/);
assert.match(remoteUi, /远程桌面不要求服务器连接物理显示器/);
assert.match(remoteUi, /remoteGraphicsRenderingMarkup/);
console.log("Linux 桌面管理检查通过：Debian/Linux 识别、安装卸载方案、阶段标记和日志标记正常");
