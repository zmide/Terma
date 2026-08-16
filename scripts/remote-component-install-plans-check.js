"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readSources } = require("./backend-source");
const { componentInstallCommand, componentInstallPlan } = require("../dist/remote-component-installer");
const { buildRemoteX11InstallPlan } = require("../dist/x11");
const { desktopInstallPlan } = require("../dist/linux-desktop-manager");
const { packagePlan: rdpPackagePlan } = require("../dist/rdp-server-manager");
const { packagePlan: vncPackagePlan } = require("../dist/vnc-server-manager");
const { vncClipboardHelperGuide, vncClipboardHelperInstallPlan } = require("../dist/vnc-clipboard");
const { configureXdmcpServer, parseDetectionOutput: parseXdmcpDetection, xdmcpPackagePlan } = require("../dist/xdmcp-manager");

function assertRemoteCacheCommand(command, label) {
  assert.match(command, /--no-download/, `${label} must refuse package downloads`);
  assert.doesNotMatch(command, /apt-get\s+update/, `${label} must not refresh package indexes`);
}

function localeValue(language, dottedKey) {
  const resource = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "locales", language, "remote.json"), "utf8"));
  return dottedKey.split(".").reduce((value, key) => value?.[key], resource);
}

function renderStructuredText(value, language) {
  assert.equal(typeof value?.i18n_key, "string", "guide text must use an explicit i18n key");
  const key = value.i18n_key.replace(/^remote:/, "");
  const template = localeValue(language, key);
  assert.equal(typeof template, "string", `${value.i18n_key} must exist in ${language}`);
  return template.replace(/{{\s*([^}\s]+)\s*}}/g, (_match, name) => String(value.params?.[name] ?? ""));
}

const generic = componentInstallPlan({
  component:"fixture",
  local_offline_packages:["fixture-a", "fixture-b"],
  local_offline_command:"apt-get --no-download install -y fixture-a fixture-b"
});
assert.equal(generic.local_offline.available, true);
assert.deepEqual(componentInstallCommand(generic, "install-local-offline").package_names, ["fixture-a", "fixture-b"]);
const genericUnavailable = componentInstallPlan({component:"fixture-unavailable", local_offline_available:false});
assert.equal(genericUnavailable.local_offline.available, false);
assert.match(genericUnavailable.local_offline.description, /Debian\/Ubuntu.*APT\/\.deb/);

const x11 = buildRemoteX11InstallPlan({platform:"Linux", package_manager:"apt", privileged:true});
assert.deepEqual(x11.local_offline.package_names, ["xauth", "x11-apps", "xterm"]);
assert.match(x11.local_offline.command, /apt-get --no-download install/);
assert.equal(x11.local_offline.available, true);
assertRemoteCacheCommand(x11.offline.command, "X11 remote-cache install");
assert.match(x11.uninstall.command, /apt-get purge/);
const x11Dnf = buildRemoteX11InstallPlan({platform:"Linux", package_manager:"dnf", privileged:true});
assert.equal(x11Dnf.local_offline.available, false);
assert.match(x11Dnf.local_offline.description, /当前检测到 dnf/);

const xfce = desktopInstallPlan({os_id:"debian", package_manager:"apt", requested_desktop:"xfce"});
assert.deepEqual(xfce.local_offline.package_names, ["xfce4", "xfce4-goodies", "dbus-x11"]);
assert.match(xfce.local_offline.command, /apt-get --no-download install/);
assertRemoteCacheCommand(xfce.offline.command, "Linux desktop remote-cache install");
const ubuntuGnome = desktopInstallPlan({os_id:"ubuntu", package_manager:"apt", requested_desktop:"gnome"});
assert.deepEqual(ubuntuGnome.local_offline.package_names, ["ubuntu-desktop-minimal"]);
const fedoraXfce = desktopInstallPlan({os_id:"fedora", package_manager:"dnf", requested_desktop:"xfce"});
assert.equal(fedoraXfce.local_offline.available, false);
assert.match(fedoraXfce.local_offline.description, /当前检测到 dnf/);

const rdp = rdpPackagePlan({platform_supported:true, package_manager:"apt"});
assert.deepEqual(rdp.local_offline.package_names, ["xrdp", "xorgxrdp"]);
assert.match(rdp.local_offline.command, /apt-get --no-download install/);
assertRemoteCacheCommand(rdp.offline.command, "RDP remote-cache install");
assert.match(rdp.uninstall.command, /apt-get purge/);
assert.match(rdp.service_actions.enable.command, /enable --now xrdp\.service/);
assert.match(rdp.service_actions.disable.command, /disable --now xrdp\.service/);
const rdpDnf = rdpPackagePlan({platform_supported:true, package_manager:"dnf"});
assert.equal(rdpDnf.local_offline.available, false);
assert.match(rdpDnf.local_offline.description, /当前检测到 dnf/);

const vnc = vncPackagePlan({platform:"linux", package_manager:"apt", session_active:false, display:""});
assert.deepEqual(vnc.local_offline.package_names, ["tigervnc-standalone-server", "tigervnc-tools"]);
assert.equal(vnc.local_offline.available, true);
assertRemoteCacheCommand(vnc.offline.command, "VNC remote-cache install");
assert.doesNotMatch(vnc.online.command, /xclip/, "optional clipboard helpers must not block VNC Server installation");
assert.match(vnc.uninstall.command, /apt-get purge/);
const vncDnf = vncPackagePlan({platform:"linux", package_manager:"dnf", session_active:false, display:""});
assert.equal(vncDnf.local_offline.available, false);
assert.match(vncDnf.local_offline.description, /当前检测到 dnf/);
const clipboardDnf = vncClipboardHelperInstallPlan({platform:"linux", package_manager:"dnf", session_type:"x11"});
assert.equal(clipboardDnf.local_offline.available, false);
assert.match(clipboardDnf.local_offline.description, /当前检测到 dnf/);
const clipboardDnfGuide = vncClipboardHelperGuide({platform:"linux", package_manager:"dnf", session_type:"x11"});
assert.equal(clipboardDnfGuide.steps.at(-1)?.i18n_key, "remote:clipboard_guide.linux_offline_manager");
assert.deepEqual(clipboardDnfGuide.steps.at(-1)?.params, {manager:"dnf"});
assert.match(renderStructuredText(clipboardDnfGuide.steps.at(-1), "zh-CN"), /不支持“本机下载后离线安装”/);
assert.match(renderStructuredText(clipboardDnfGuide.steps.at(-1), "en-US"), /does not support Local offline/);

const xdmcp = parseXdmcpDetection([
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
assert.deepEqual(xdmcp.package_plans.lightdm.local_offline.package_names, ["lightdm", "lightdm-gtk-greeter"]);
assert.deepEqual(xdmcp.package_plans.xfce.local_offline.package_names, ["xfce4", "dbus-x11"]);
assert.deepEqual(xdmcp.rdp_install_plan.local_offline.package_names, ["xrdp", "xorgxrdp"]);
assert.deepEqual(xdmcpPackagePlan(xdmcp, "install-xfce-local-offline").local_offline_packages, ["xfce4", "dbus-x11"]);
assertRemoteCacheCommand(xdmcp.package_plans.lightdm.offline.command, "XDMCP LightDM remote-cache install");
assertRemoteCacheCommand(xdmcp.package_plans.xfce.offline.command, "XDMCP desktop remote-cache install");
const xdmcpDnf = xdmcpPackagePlan({package_manager:"dnf"}, "install-xfce");
assert.equal(xdmcpDnf.local_offline.available, false);
assert.match(xdmcpDnf.local_offline.description, /当前检测到 dnf/);

(async () => {
  const row = {id:7,name:"Linux",ssh_host:"192.0.2.7",ssh_user:"root",ssh_port:22};
  let started = null;
  const result = await configureXdmcpServer(
    {host:row.ssh_host, options:{ssh_connection_id:row.id}},
    {action:"install-lightdm-local-offline", confirmation:"XDMCP_TRUSTED_LAN"},
    {
      listConnections:() => [row],
      getConnection:() => row,
      runSshCommandForConnection:async () => ({status:0, stdout:[
        "TERMA_OS_ID=debian",
        "TERMA_MANAGER=sddm",
        "TERMA_SERVICE=sddm",
        "TERMA_PACKAGE_MANAGER=apt",
        "TERMA_PRIVILEGED=1",
        "TERMA_ENABLED=0",
        "TERMA_LISTENING=0",
        "TERMA_FIREWALL=none",
        "TERMA_SESSION=plasma|Plasma (X11)"
      ].join("\n"), stderr:""}),
      startRemoteOfflineInstall:async options => {
        started = options;
        return {id:"remote-component-fixture", status:"running"};
      }
    }
  );
  assert.equal(result.mode, "local-offline");
  assert.equal(result.defer_grant_release, true);
  assert.deepEqual(started.packages, ["lightdm", "lightdm-gtk-greeter"]);

  const serverSource = readSources(path.join(__dirname, ".."), [
    "src/server.ts",
    "src/routes/remote-task-routes.ts",
    "src/routes/remote-profile-routes.ts",
    "src/services/remote-component-service.ts",
    "src/services/x11-management-service.ts",
    "src/services/vnc-management-service.ts",
    "src/services/linux-desktop-service.ts"
  ]);
  assert.match(serverSource, /x11\.remote-install-local-offline/);
  assert.match(serverSource, /linux-desktop\.install-local-offline/);
  assert.match(serverSource, /parts\[3\] === "rdp-server"/);
  assert.match(serverSource, /parts\[3\] === "rdp" && parts\[4\] === "server"/);
  assert.match(serverSource, /startRemoteOfflineInstall/);
  assert.match(serverSource, /vnc\.server\.install-local-offline/);
  assert.match(serverSource, /startRemoteComponentCommandTask/);
  assert.match(serverSource, /"uninstall", "start", "stop", "restart", "enable", "disable"/);
  console.log("远端组件安装计划检查通过：X11、XDMCP、RDP、VNC 和 Linux 桌面均提供本机离线软件包与后端任务路由");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
