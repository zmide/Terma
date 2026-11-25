const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");
const { readSources } = require("./backend-source");

const root = path.resolve(__dirname, "..");
const legacyRemote = readFrontendDomain(root, "remote");
assert.equal(fs.existsSync(path.join(root,'public/app-remote.js')),false,'legacy remote-management host script must be retired');
const quickViews = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "quick-views.ts"), "utf8");
const desktopService=fs.readFileSync(path.join(root,'frontend/src/features/remote/desktop-service.ts'),'utf8');
const remoteDesktopService=fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-desktop-service.ts'),'utf8');
const remoteManagementModelService=fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-management-model-service.ts'),'utf8');
const vncService=fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-management-service.ts'),'utf8');
const vncViews=fs.readFileSync(path.join(root,'frontend/src/features/remote/RemoteDesktopViews.ts'),'utf8');
assert.doesNotMatch(vncViews, /jumpActionsMarkup/, "远程跳转动作不得回退 HTML 拼接");
assert.match(vncViews, /function workspaceJumpActions[\s\S]*options\.actions\.map\(action => remoteActionButton\(action\)\)/, "桌面及 VNC 跳转动作必须复用 Vue 按钮");
assert.doesNotMatch(legacyRemote, /function remote(?:WorkspaceJumpButtons|DesktopSwitchButton)Html/, "删除已迁移跳转按钮的旧 HTML 实现");
const protocolService=fs.readFileSync(path.join(root,'frontend/src/features/remote/protocol-service.ts'),'utf8');
const workspaceOwner=fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-desktop-workspace.ts'),'utf8');
const guideOwner=fs.readFileSync(path.join(root,'frontend/src/features/remote/install-guide-service.ts'),'utf8');
const protocolPolicy=fs.readFileSync(path.join(root,'frontend/src/features/remote/protocol-policy.ts'),'utf8');
const managementVue=fs.readFileSync(path.join(root,'frontend/src/features/remote/RemoteManagementView.ts'),'utf8');
const managementUi=fs.readFileSync(path.join(root,'frontend/src/features/remote/management-ui-runtime.ts'),'utf8');
const managementRuntime=fs.readFileSync(path.join(root,'frontend/src/features/remote/management-runtime.ts'),'utf8');
const x11RemoteService=fs.readFileSync(path.join(root,'frontend/src/features/x11/remote-service.ts'),'utf8');
const remote = [legacyRemote, quickViews,desktopService,protocolService,protocolPolicy,x11RemoteService,fs.readFileSync(path.join(root,'public/locales/zh-CN/remote.json'),'utf8')].join("\n");
const quickOpen = fs.readFileSync(path.join(root, 'frontend/src/features/settings/quick-open-preference.ts'), 'utf8');
const connectionViews = fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-views.ts"), "utf8");
const taskCenter = fs.readFileSync(path.join(root, "frontend/src/features/files/sftp", "task-workspace.ts"), "utf8");
const taskCenterVue = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "TaskCenter.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const server = readSources(root, [
  "src/server.ts",
  "src/routes/remote-profile-routes.ts",
  "src/routes/remote-task-routes.ts",
  "src/services/remote-admin-service.ts",
  "src/services/remote-component-service.ts",
  "src/services/vnc-management-service.ts",
  "src/services/x11-management-service.ts",
  "src/services/linux-desktop-service.ts"
]);
const xdmcp = fs.readFileSync(path.join(root, "src", "xdmcp-manager.ts"), "utf8");
const desktop = fs.readFileSync(path.join(root, "src", "linux-desktop-manager.ts"), "utf8");

for (const label of ["在线安装", "使用远端缓存", "本机下载后离线安装", "手动安装/配置说明"]) {
  assert.ok(remote.includes(label), `frontend must expose ${label}`);
}
assert.doesNotMatch(legacyRemote, /REMOTE_INSTALL_MODE_ORDER|_remoteInstallCommands|_vncCommands/, 'installation plans and reference text must stay with the typed view');
assert.match(quickViews, /managementContent\(\{install, manual\}\)/);
assert.match(remote, /本机下载后离线安装仅支持 Debian\/Ubuntu 及兼容 APT\/\.deb 系统/);
assert.doesNotMatch(remote, /请选择在线,?本机离线,?远端缓存或手动方式安装 RDP 服务端/);

assert.match(remote, /x11-applications\/install-plan/);
assert.match(remote, /diagnostics\.desktop_install_plans\?\.\[desktopId\]/);
assert.match(desktopService,/desktop_id:desktopId[\s\S]{0,90}mode/); // Payload behavior is exercised by m7-management-check.
const managementDiagnostics = fs.readFileSync(path.join(root,'frontend/src/features/remote/management-diagnostics.ts'),'utf8');
assert.match(managementDiagnostics, /package_plans\?\.\[key\]/);
assert.match(managementDiagnostics, /\["install-lightdm", "install-xfce", "install-rdp"\]/);
assert.match(protocolPolicy,/const requestAction=install&&mode!=='online'/);
assert.match(managementUi, /refreshJobs:.*taskCenter\.refresh\(\)/);
assert.match(protocolService,/const after=result.after\|\|result.before;if\(after\)view.render\(after\)/);
assert.match(remote, /显示管理器：/);
assert.match(remote, /账号桌面映射：/);
assert.match(remote, /XDMCP 配置已经写入，但 UDP 177 尚未监听/);
assert.match(remote, /本机也无法联网时/);

assert.match(protocolService,/\/api\/remote-profiles\/\$\{id\}\/\$\{protocol\}\/server/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/management-runtime.ts'),'utf8'), /protocol\.operate\(id, 'rdp', 'install', mode, button, key\)/);
for (const action of ["install", "install-offline", "install-local-offline"]) {
  assert.ok(remote.includes(`"${action}"`), `RDP action ${action} must be mapped in the UI`);
}
assert.match(managementDiagnostics, /rdp_install_plan/);
const launchService = fs.readFileSync(path.join(root, "frontend/src/features/remote/launch-service.ts"), "utf8");
assert.doesNotMatch(launchService, /\.protocol\.inspect\(/, "RDP launch must not rerun optional Linux/SSH diagnostics");
assert.doesNotMatch(legacyRemote, /function legacy(?:LaunchRemoteDesktop|InstallRemoteDesktopClient)/);
const desktopRuntime=fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-desktop-runtime.ts'),'utf8');
assert.match(managementRuntime, /launchDesktop:.*remoteServices\.termaRemoteClients\.launch\(/);
assert.match(desktopRuntime, /install: .*remoteServices\.termaRemoteClients\.install\(/);
assert.match(server, /profile\.protocol === "rdp"[\s\S]*?await dependencies\.probeTcpEndpoint\(profile\.host, profile\.port \|\| 3389\)/, "RDP launch must keep the saved-target TCP preflight");
assert.match(remote, /远端 xrdp 已安装/);
assert.match(remote, /3389 未监听/);
assert.match(remoteManagementModelService, /port\.protocolGuide\('rdp', diagnostics, profile\)/, 'RDP status explains the desktop login account and preferred backend');
assert.match(guideOwner, /xrdp 使用 Xorg\/xorgxrdp/);
assert.match(guideOwner, /临时管理员授权(?:的 root )?密码、VNC 密码(?:或|和) Windows 当前账号/);
assert.match(quickOpen, /storageKey = 'remoteDesktopQuickOpen'[\s\S]*?legacy === null \? value : legacy === '1'/, 'legacy quick-open preference remains available until migration');
assert.match(quickOpen, /saveWorkspacePreferences[\s\S]*?\/api\/runtime-settings/, 'quick-open persists through the shared runtime settings API');
assert.equal(fs.existsSync(path.join(root, "public", "app-workspace.js")),false,'no classic workspace script remains');
assert.match(connectionViews, /id: 'workspace-remote-quick-open'[\s\S]*?'aria-pressed':[\s\S]*?onClick: remoteQuickOpen.toggle/, 'Other Connections renders a Vue toggle with an accessible state');
assert.match(workspaceOwner, /updateTab && \(\(port\.quickOpen\(\) && result\.launchReady\)/, "automatic launch must be gated by the quick-open preference");
assert.match(workspaceOwner, /port\.newWindowOnQuickOpen\(\)\) committed = await port\.detach\(id, key, \{closeDetectionTab: true, browserReservation: reservation\}\)/, "VNC quick open must honor the global new-window preference, reuse its reserved popup and close the detection tab");
assert.match(workspaceOwner, /scope\.begin\(id, key, view\)[\s\S]*?await scope\.paint\(renderScope,[\s\S]*?catch \(error\) \{[\s\S]*?scope\.paint\(renderScope,/, "remote desktop diagnostics must ignore stale async results instead of touching a missing status element");
const tabRuntime = fs.readFileSync(path.join(root, 'frontend/src/features/workspace/workspace-tab-runtime.ts'), 'utf8');
assert.match(tabRuntime, /case 'linux-desktop': return port\.linuxDesktop\(Number\(tab\.id \|\| tab\.key\.match/, "workspace runtime routes and restores Linux desktop manager tabs");
assert.match(fs.readFileSync(path.join(root, 'frontend/src/features/workspace/workspace-host.ts'), 'utf8'), /linuxDesktop:\s*id\s*=>\s*remoteServices\.termaRemoteManagement\.desktop\.open\(id,\s*false\)/, "Linux desktop manager restoration must not add another tab");
assert.match(vncViews, /id: options.protocol[\s\S]*?'vncServerState'/, "VNC must enter the shared Vue detection workspace before connecting");
assert.match(workspaceOwner, /port\.diagnostics\(\)\.loading\(container, protocol\)/, "VNC detection must retain the shared translated loading view");
assert.match(managementRuntime, /vncOpenEmbedded:.*remoteServices\.termaVncRuntime\.session\.open/, "embedded VNC launch must use the owned VNC session");
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/profile-editor-runtime.ts'),'utf8'), /host\.open\(saved, \{forceLaunch: true\}\)/, "saving a remote profile with Save and open must force the launch flow");
assert.match(workspaceOwner, /options\.forceLaunch === true && result\.forceLaunchReady/, "remote desktop opening must accept an explicit force-launch option");
assert.match(vncService, /allowNoPassword:support/, "VNC service actions must expose an explicit no-password choice");
assert.match(vncViews, /id: 'vncCredentialNoPassword'/, "VNC credential dialog must expose no-password opt-in");
assert.match(vncService, /allow_no_password:noPassword/, "VNC start request must carry the explicit no-password choice");
assert.match(vncService,/const d=await read\(id\);[\s\S]*?if\(change\|\|/,'password change refreshes diagnostics');
assert.match(vncService,/port.unlocked\(t\('remote:admin.remote_management'\)\)/,'locked store blocks VNC operations');
assert.match(vncService, /change&&!credentials.update_saved_password&&fixed.profile.has_password===true/, "VNC password changes must clear stale saved credentials when the new password is not saved");
assert.match(remoteDesktopService, /const forceLaunchReady = availability\.launchAllowed[\s\S]*?!vncEndpointBlocked/, "Save and open must not be reduced to probe-only by a stale VNC management snapshot");
assert.match(remoteManagementModelService, /export function createRemoteManagementModelService/, "shared remote management notices must use a typed model service");
assert.doesNotMatch(legacyRemote, /createRemoteManagementModelPort/, "the management model must have no classic runtime port");
const diagnosticsView = fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-diagnostics-view.ts'),'utf8');
assert.match(diagnosticsView, /port\.model\(protocol, data, profile, key, options\)/, 'remote status delegates to the typed model');
assert.match(vncViews, /export function updateRemoteDesktopLaunch/, "remote desktop launch state must be projected by the Vue view module");
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-desktop-runtime.ts'),'utf8'),
  /remoteServices\.termaRemoteViews\?\.updateDesktopLaunch/, "the remote workspace delegates launch state updates to the Vue view runtime");
assert.match(workspaceOwner, /update\(target, \{\.\.\.port\.status\(protocol, prepareOptions, result\), authorization\}\)/, "remote desktop diagnostics must pass authorization and client state through the typed view projection");
assert.doesNotMatch(vncViews, /authorizationMarkup|authorization\.innerHTML/, "authorization must use the shared Vue component");
assert.equal(fs.existsSync(path.join(root,'frontend/legacy/app-desktop-integration.js')),false,"legacy desktop authorization script must be retired");
const profileEditor = fs.readFileSync(path.join(root,'frontend/src/features/remote/profile-editor-runtime.ts'),'utf8');
assert.match(profileEditor, /if \(invalidateVnc\) await host\.closeVnc\(id\)/, 'password changes invalidate the VNC workspace');
const remoteHost=fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-host.ts'),'utf8');
assert.match(remoteHost, /async closeVnc\(id\)[\s\S]*?termaVncRuntime\.close\(key\)[\s\S]*?termaVncRuntime\.windows\.close\(id\)/, 'saved credential mutations close both embedded and detached VNC sessions');

assert.match(remoteManagementModelService, /port\.installModel\(diagnostics.install_plan[\s\S]{0,200}vncInstallServer/, 'VNC reuses the shared install mode selector');
assert.match(managementRuntime, /vncInstallServer:.*remoteServices\.termaVncRuntime\.management\.install\(\.\.\.args\)/, 'VNC install delegates to the typed service');
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-runtime.ts'),'utf8'), /serviceManagement:guard\(\(\) => remoteServices\.termaRemoteManagement\.setupGuide\(id,'vnc'\)\)/);
const clipboardHelper = fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-clipboard-helper.ts'),'utf8');
assert.match(clipboardHelper, /vnc-clipboard\/helper/);
assert.match(clipboardHelper, /result\.task\.action \|\| action/, "clipboard conflicts use the active task action for verification");
assert.match(clipboardHelper, /port\.watch\(result\.task\)/, "clipboard install and removal reuse shared task tracking");
assert.match(server, /macOS 已自带 pbcopy\/pbpaste/);
assert.match(server, /configureVncClipboardHelperForProfile/);
assert.match(server, /allow_no_password === true/);
assert.match(server, /buildVncStartCommand\(before, savedPassword, \{allow_no_password:allowNoPassword\}\)/);
assert.match(server, /buildVncPasswordChangeCommand\(before, password, \{allow_no_password:allowNoPassword\}\)/, "VNC service password changes must use the redacted password-file command builder");
assert.match(server, /\"change-password\"/, "VNC service management must expose a password-change action");
assert.match(remoteManagementModelService, /serviceAction\('change-password'/, 'VNC can change the service password');
assert.match(server, /vnc\.clipboard-helper\.install-local-offline/);
assert.match(server, /install-local-offline", "uninstall"/);
assert.match(server, /component:"vnc-clipboard-helper"[\s\S]*?startRemoteComponentCommandTask/);
assert.match(server, /validate:after => uninstalling[\s\S]*?重新探测后仍可用/);
assert.match(server, /clearVncClipboardCapabilityCache\(\);[\s\S]{0,160}return inspectVncClipboardHelperForProfile/);
assert.doesNotMatch(server, /离线缓存包,?请改用[^\n]*本机下载后离线安装/);

assert.match(remoteManagementModelService, /port\.rdpServerAction\(profileId, key, active \? 'stop' : 'start'/);
assert.match(remoteManagementModelService, /port\.rdpServerAction\(profileId, key, 'uninstall'/);
assert.match(remoteManagementModelService, /serviceAction\('uninstall'/);
assert.match(remoteManagementModelService, /port\.xdmcpConfigure\(profileId, 'uninstall-lightdm'/, 'XDMCP exposes safe LightDM removal when a backup is available');
assert.match(quickViews, /termaX11\.remote\.operate\(id, 'components', 'uninstall', event\.currentTarget, 'install-guide'\)/, "X11 component management must expose uninstall");
assert.match(quickViews, /termaX11\.remote\.operate\(id, 'components', 'uninstall', event\.currentTarget, 'xserver'\)/, "X Server manager must expose direct remote X11 component removal");
assert.match(remote, /const uninstallX11Components(?:\s*:\s*[^=]+)?\s*=\s*!macos && sshX11\?\.xauth_path/, "quick X11 connections must expose component removal when xauth is installed");
assert.match(remote, /tr\("common:x11\.guide_apps_ready",\s*\{\s*count:\s*applicationCount,/, "X11 install dialog must render refreshed installed state with the localized application count");
assert.match(remoteManagementModelService, /probe\.method === 'xdmcp-query'[\s\S]*?remote:endpoint_probe\.xdmcp_title_no_response/, "XDMCP fallback must render protocol-level UDP Query diagnostics");
assert.match(remoteManagementModelService, /remote-service-state vnc-connection-help-panel/, "VNC diagnostics must use the shared in-workspace service state card");
assert.match(remote, /共享来源用 x11vnc，独立来源用 TigerVNC/);
assert.match(remote, /Xtigervnc\/Xvnc 是底层进程名/);
assert.match(remoteManagementModelService, /diagnostics\.running_component \|\| diagnostics\.selected_component/, "VNC status must prefer the component which owns the listener over the aggregate service unit");
assert.match(remote, /监听进程：/);
assert.doesNotMatch(remote, /独立虚拟桌面（TigerVNC\/Xvnc）/);
assert.match(remote, /运行 Terma 的设备必须有可用的本机 X Server/);
assert.match(managementVue, /remote-service-head/);
const protocolView = fs.readFileSync(path.join(root, 'frontend/src/features/remote/remote-protocol-view.ts'), 'utf8');
assert.match(protocolView, /port\.diagnostics\.render\(container, protocol, diagnostics, id, key\)/);
const componentTasks = fs.readFileSync(path.join(root, 'frontend/src/features/remote/component-task-service.ts'), 'utf8');
assert.match(protocolView, /port\.scope\.capture\(id, key, container\)/);
assert.match(componentTasks, /port\.container\(options\.scope,[^\n]+options\.container/, 'each subscriber resolves its own scoped host');
assert.match(protocolView, /tasks\.watch\(result\.task, \{container, scope, title, current: tabExists/);
assert.match(protocolService, /active=>inspect\(id,protocol,null,null,active\)/);
assert.match(protocolView, /onDone: \(_, active\) => active \? done\(capture/);
assert.match(vncService,/view.watch\(result,title\(\),active=>inspect/);
assert.doesNotMatch(legacyRemote, /function setRemoteComponentTaskHost/);
assert.match(managementUi, /setRemoteComponentTaskHost\(container,\s*true\)/);
assert.match(diagnosticsView, /port\.taskHost\(container, false\)/);

assert.match(server, /\["install", "install-offline", "install-local-offline", "online", "offline", "local-offline", "offline-local", "uninstall"\]/);
assert.match(server, /componentInstallCommand\(plan\.component_plan \|\| plan, mode\)/);
assert.match(server, /requestedMode[\s\S]{0,600}\["offline", "install-offline"\]/);
assert.match(server, /buildLinuxDesktopInstallScript\(privilegedDiagnostics, requested, normalizedMode\)/);
assert.match(xdmcp, /install-lightdm-offline/);
assert.match(xdmcp, /install-xfce-offline/);
assert.match(xdmcp, /componentInstallCommand\(packagePlan\?\.component_plan/);
assert.match(desktop, /function buildDesktopTaskScript\(/);
assert.match(desktop, /installMode = "online"/);

assert.match(css, /\.remote-install-modes\s*\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(280px,100%\),1fr\)\)/s, "install mode cards must collapse by their own available width");
assert.match(css, /\.remote-install-mode\s*\{[^}]*min-width:0[^}]*text-align:left[^}]*white-space:normal/s);
assert.match(css, /\.remote-install-mode\[aria-busy="true"\]\s*\{[^}]*display:flex[^}]*justify-content:center[^}]*overflow-wrap:break-word[^}]*word-break:keep-all/s, "busy install labels must use the full card width instead of the icon grid track");
assert.match(css, /\.remote-install-mode-copy strong, \.remote-install-mode-copy small\s*\{[^}]*overflow-wrap:break-word/s);
assert.match(css, /\.remote-install-mode-copy strong\s*\{[^}]*word-break:keep-all/s, "install mode titles must not wrap one CJK character per line");
assert.doesNotMatch(css, /\.remote-install-mode-copy strong, \.remote-install-mode-copy small\s*\{[^}]*overflow-wrap:anywhere/s);
assert.match(css, /\.remote-install-modes\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
assert.match(css, /\.modal-card\s*\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow-y:auto/s);
assert.match(css, /\.remote-service-state\s*\{/);
assert.match(css, /\.remote-service-actions\s*\{/);
assert.match(css, /\.remote-protocol-guide\s*\{[^}]*grid-template-columns:26px minmax\(0,1fr\)[^}]*border-top:1px solid var\(--line\)/s);
assert.match(css, /\.remote-protocol-guide strong, \.remote-protocol-guide small\s*\{[^}]*overflow-wrap:anywhere/s);
assert.match(css, /\.remote-component-progress\s*\{/);
assert.match(css, /\.remote-component-task-host\s*\{[^}]*width:min\(720px,100%\)[^}]*padding:0/s);
assert.match(css, /\.remote-component-task-host\.remote-service-state,[\s\S]*?\.remote-component-task-host\.rdp-server-state\s*\{[^}]*padding:0[^}]*background:transparent[^}]*box-shadow:none/s);
const taskHostOverrideIndex = css.indexOf(".remote-component-task-host.remote-service-state");
assert.ok(taskHostOverrideIndex > css.indexOf(".xdmcp-server-state {"), "task host override must follow the XDMCP state card rule");
assert.ok(taskHostOverrideIndex > css.indexOf(".rdp-server-state {"), "task host override must follow the RDP state card rule");
assert.match(css, /\.linux-desktop-manager\s*\{[^}]*align-self:center[^}]*margin-inline:auto/s);
assert.match(css, /\.linux-desktop-manager-toolbar\s*\{[^}]*display:grid[^}]*grid-template-columns:minmax\(0,1fr\) max-content[^}]*align-items:end/s, "desktop manager probe controls must share one aligned row");
assert.match(css, /\.linux-desktop-manager-toolbar label\s*\{[^}]*margin:0[^}]*display:grid[^}]*gap:5px/s, "desktop manager connection label must not inherit the global bottom margin");
assert.match(css, /\.linux-desktop-manager-toolbar select\s*\{[^}]*height:var\(--control-h\)[^}]*margin:0/s, "desktop manager select must use the shared control height");
assert.match(css, /\.linux-desktop-manager-toolbar button\s*\{[^}]*height:var\(--control-h\)[^}]*align-items:center[^}]*white-space:nowrap/s, "desktop manager probe button must align with the select and keep its label visible");
assert.match(css, /@media \(max-width:700px\)[\s\S]*?\.linux-desktop-manager-toolbar\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*align-items:stretch/s, "desktop manager probe controls must stack cleanly on narrow workspaces");
assert.match(css, /\.vnc-connection-help\s*\{[^}]*background:color-mix\(in srgb,var\(--bg\) 96%,#111\)/s, "VNC diagnostics must not use the old dimmed modal backdrop");
assert.match(css, /\.remote-desktop-launch > \.actions\s*\{[^}]*justify-content:center/s, "remote detection actions must be centered");
const connectionToolbarCss = fs.readFileSync(path.join(root,'frontend/src/styles/connections.css'),'utf8');
assert.match(connectionToolbarCss, /connection-quick-actions[^}]*repeat\(auto-fit,minmax\(32px,1fr\)\)/, 'connection icons adapt to the actual pane width');
assert.match(connectionToolbarCss, /\.connection-toolbar\s*\{grid-template-columns:minmax\(0,1fr\)/, 'the primary action has a full row');
assert.match(css, /\.vnc-clipboard-helper-state\s*\{[^}]*display:grid[^}]*gap:10px[^}]*background:var\(--field\)/s, "clipboard helper state must use the shared readable state layout");

function fakeScrollLog({scrollHeight, clientHeight, scrollTop=0, taskId="", expanded=false}) {
  const listeners = {};
  const classes = new Set(expanded ? ["expanded"] : []);
  let currentScrollTop = 0;
  const log = {
    scrollHeight,
    clientHeight,
    dataset:{taskId},
    listeners,
    classList:{
      contains:name => classes.has(name),
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    },
    addEventListener(type, handler) { listeners[type] = handler; }
  };
  Object.defineProperty(log, "scrollTop", {
    get:() => currentScrollTop,
    set:value => { currentScrollTop = Math.max(0, Math.min(Number(value || 0), Math.max(0, log.scrollHeight - log.clientHeight))); }
  });
  log.scrollTop = scrollTop;
  return log;
}

function fakeTaskDetails(taskId, log, open=false) {
  const listeners = {};
  return {
    open,
    dataset:{taskId},
    listeners,
    querySelector:selector => selector === "pre" ? log : null,
    addEventListener(type, handler) { listeners[type] = handler; }
  };
}

function fakeTaskRoot(details) {
  return {querySelectorAll:() => details};
}

const linuxDesktopWorkspaceCalls = [];
let linuxDesktopTabsSaved = 0;
const tabs = [{key:"linux-desktop-select", kind:"linux-desktop", id:0}];
const connections = [{id:23,ssh_host:"review.test"},{id:31,ssh_host:"other.test"}];
const remoteContext = {currentLog:null, tabs, connections, activeTabKey:tabs[0].key,
  currentConnection:id=>connections.find(item=>item.id===id), tr:(key, options={})=>options.defaultValue||key,
  $:id=>id==='linuxDesktopTaskLog'?remoteContext.currentLog:null,
  setWorkspace:(...args)=>linuxDesktopWorkspaceCalls.push(args),
  window:{termaWorkspacePersistence:{save:()=>{linuxDesktopTabsSaved++;}}}};
const {loadFrontendService}=require('./frontend-service-test-helper');
const {linuxDesktopModel}=loadFrontendService('frontend/src/features/remote/linux-desktop-model.ts');
const calls=[];
const desktopFixture={state:{connectionId:23,loading:false,diagnostics:{installable_desktops:['gnome'],desktops:[{id:'xfce'}]},sshX11:null,task:null,error:null},
  running:()=>false,install:id=>calls.push(['install',id]),uninstall:id=>calls.push(['uninstall',id])};
const desktopModelPort={tr:key=>key,connection:()=>({id:23,ssh_host:'review.test'}),connections:()=>[],localize:text=>text,actionInFlight:()=>false,
  desktopActionKey:()=> 'test',action:(id,label,icon,run)=>({id,label,icon,run}),authenticationFailure:()=>false};
const desktopModel=linuxDesktopModel(desktopModelPort,desktopFixture);
assert.deepEqual(Array.from(desktopModel.cards,card=>card.id),['xfce','gnome','plasma','mate','cinnamon','lxqt']);
assert.deepEqual(Array.from(desktopModel.cards,card=>card.action.disabled),[false,false,true,true,true,true]);
desktopModel.cards[0].action.run(null);desktopModel.cards[1].action.run(null);
assert.deepEqual(calls,[['uninstall','xfce'],['install','gnome']]);
const logOwner=loadFrontendService('frontend/src/features/remote/desktop-log-view.ts').createDesktopLogView();
const {remoteManagementHost:managementPort}=loadFrontendService('frontend/src/features/remote/remote-host.ts',remoteContext,
  new Map([
    [path.resolve('frontend/src/features/workspace/workspace-dock-runtime.ts'), {setWorkspace:remoteContext.setWorkspace}],
    [path.resolve('frontend/src/features/settings/quick-open-preference.ts'), {remoteQuickOpen:{enabled:{value:false}}}],
    [path.resolve('frontend/src/features/workspace/workspace-shell-controller.ts'), {workspaceShell:{}}],
  ]));
const desktopOwner=loadFrontendService('frontend/src/features/remote/desktop-service.ts').createDesktopService({...managementPort,api:async()=>[],probe:async()=>({diagnostics:{},sshX11:{}}),authorize:async()=>null,resetLog:logOwner.reset,paint:()=>{},paintTask:()=>{},label:String,options:()=>{}},async()=> '');
desktopOwner.open(23, false);
assert.equal(linuxDesktopWorkspaceCalls.length, 1, "restoring Linux desktop manager must render through its normal workspace entry");
assert.equal(linuxDesktopWorkspaceCalls[0][4], false, "restoring Linux desktop manager must not create a duplicate tab");
assert.equal(linuxDesktopWorkspaceCalls[0][6].kind, "linux-desktop");
assert.equal(linuxDesktopWorkspaceCalls[0][6].id, 23, "Linux desktop manager tabs must persist their SSH connection id");
desktopOwner.select(31);
assert.equal(remoteContext.tabs[0].id, 31, "choosing an SSH host must update the persisted Linux desktop manager tab");
assert.equal(linuxDesktopTabsSaved, 1, "choosing an SSH host must save the restored selection");
const managementScope=managementPort.scope(), renderLifetime=managementPort.protocol.tabLifetime(tabs[0].key);
assert.equal(managementScope(),true);
assert.equal(renderLifetime(),true);
tabs[0]={...tabs[0]};
assert.equal(managementScope(),false,'replacing a tab with the same key invalidates outstanding management actions');
assert.equal(renderLifetime(),false,'replacing a tab with the same key invalidates outstanding status updates');
const taskPanes = new Map([
  ["pane-task", {id:"pane-task", activeTabKey:"remote-desktop-7"}],
  ["pane-other", {id:"pane-other", activeTabKey:"remote-desktop-8"}]
]);
remoteContext.workspaceFindPane = id => taskPanes.get(id) || null;
remoteContext.workspaceFindPaneForTab = key => [...taskPanes.values()].find(pane => pane.activeTabKey === key) || null;
remoteContext.tabs = [
  {key:"remote-desktop-7", kind:"remote-desktop", id:7},
  {key:"remote-desktop-8", kind:"remote-desktop", id:8}
];
remoteContext.selectedRemoteProfileId = 7;
const fakeTaskContainer = (id, paneId, connected=true) => ({
  id,
  isConnected:connected,
  closest:selector => selector === ".workspace-pane" ? {dataset:{paneId}} : null
});
const {createRemoteWorkspaceScope} = loadFrontendService('frontend/src/features/remote/remote-workspace-scope.ts');
const workspaceScope = createRemoteWorkspaceScope({
  paneForTab: key => remoteContext.workspaceFindPaneForTab(key),
  pane: id => remoteContext.workspaceFindPane(id),
  tab: key => remoteContext.tabs.find(tab => tab.key === key),
  activeKey: () => remoteContext.activeTabKey,
  selectedProfile: () => remoteContext.selectedRemoteProfileId,
  elementForTab: (key, selector) => remoteContext.workspaceElementForTab?.(key, selector),
  element: () => null,
  inPane: (id, run) => {assert.equal(id,'pane-task');return run();}
});
const originalTaskContainer = fakeTaskContainer("rdpServerState", "pane-task");
const taskScope = workspaceScope.capture(7, "remote-desktop-7", originalTaskContainer);
assert.equal(workspaceScope.current(taskScope), true, "task scope should match its originating pane and profile");
const wrongPaneContainer = fakeTaskContainer("rdpServerState", "pane-other");
assert.equal(workspaceScope.resolve(taskScope, wrongPaneContainer), originalTaskContainer, "task rendering must not switch to another pane's matching element");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-8";
assert.equal(workspaceScope.resolve(taskScope, originalTaskContainer), null, "inactive task tabs must not receive background task rendering");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-7";
originalTaskContainer.isConnected = false;
const remountedTaskContainer = fakeTaskContainer("rdpServerState", "pane-task");
remoteContext.workspaceElementForTab = (key, selector) => key === "remote-desktop-7" && selector === "#rdpServerState" ? remountedTaskContainer : null;
const detachedModalHost = {id:"vncSetupTaskState", isConnected:false, closest:() => null};
assert.equal(workspaceScope.resolve(taskScope, detachedModalHost), remountedTaskContainer, "detached modal task hosts must fall back to the originating workspace container");
const renderView = {...fakeTaskContainer("view-remote-desktop", "pane-task"), dataset:{}};
const firstRenderScope = workspaceScope.begin(7, "remote-desktop-7", renderView);
assert.equal(workspaceScope.view(firstRenderScope), renderView, "remote desktop results should resolve inside their originating active pane");
const secondRenderScope = workspaceScope.begin(7, "remote-desktop-7", renderView);
assert.equal(workspaceScope.view(firstRenderScope), null, "an older remote desktop request must not overwrite a newer render of the same tab");
assert.equal(workspaceScope.view(secondRenderScope), renderView, "the newest remote desktop request should remain current");
assert.equal(workspaceScope.paint(secondRenderScope, mount => mount), renderView, "paint enters only the owning pane");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-8";
assert.equal(workspaceScope.view(secondRenderScope), null, "remote desktop results must be ignored after the user switches tabs");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-7";
renderView.isConnected = false;
assert.equal(workspaceScope.view(secondRenderScope), null, "detached remote desktop views must not receive async status updates");
logOwner.reset("desktop-1");
remoteContext.currentLog = fakeScrollLog({scrollHeight:100, clientHeight:20, scrollTop:80, taskId:"desktop-1", expanded:true});
logOwner.capture(remoteContext.currentLog);
const refreshedDesktopLog = fakeScrollLog({scrollHeight:160, clientHeight:20, taskId:"desktop-1"});
logOwner.restore(refreshedDesktopLog, {id:"desktop-1"});
assert.equal(refreshedDesktopLog.scrollTop, 140, "Linux desktop log should follow new output while it was at the bottom");
assert.equal(refreshedDesktopLog.classList.contains("expanded"), true, "Linux desktop log should preserve its expanded state");
refreshedDesktopLog.scrollTop = 36;
refreshedDesktopLog.listeners.scroll();
const reviewedDesktopLog = fakeScrollLog({scrollHeight:220, clientHeight:20, taskId:"desktop-1"});
logOwner.restore(reviewedDesktopLog, {id:"desktop-1"});
assert.equal(reviewedDesktopLog.scrollTop, 36, "Linux desktop log should preserve the user's history position");

const taskLogService=require('./frontend-service-test-helper').loadFrontendService('frontend/src/features/files/sftp/task-log-view.ts');
const taskLogs = taskLogService.createTaskLogView();
const currentTaskLog = fakeScrollLog({scrollHeight:120, clientHeight:20, scrollTop:100});
const currentTaskDetails = fakeTaskDetails("desktop:1", currentTaskLog, true);
taskLogs.capture(fakeTaskRoot([currentTaskDetails]));
const refreshedTaskLog = fakeScrollLog({scrollHeight:200, clientHeight:20});
const refreshedTaskDetails = fakeTaskDetails("desktop:1", refreshedTaskLog);
taskLogs.bind(fakeTaskRoot([refreshedTaskDetails]));
assert.equal(refreshedTaskDetails.open, true, "task center log should remain expanded after polling");
assert.equal(refreshedTaskLog.scrollTop, 180, "task center log should follow new output while it was at the bottom");
refreshedTaskLog.scrollTop = 44;
refreshedTaskLog.listeners.scroll();
taskLogs.capture(fakeTaskRoot([refreshedTaskDetails]));
const reviewedTaskLog = fakeScrollLog({scrollHeight:260, clientHeight:20});
const reviewedTaskDetails = fakeTaskDetails("desktop:1", reviewedTaskLog);
taskLogs.bind(fakeTaskRoot([reviewedTaskDetails]));
assert.equal(reviewedTaskDetails.open, true, "task center log should stay expanded while reviewing history");
assert.equal(reviewedTaskLog.scrollTop, 44, "task center log should preserve the user's history position");
const firstOpenLog = fakeScrollLog({scrollHeight:150, clientHeight:20});
const firstOpenDetails = fakeTaskDetails("component:2", firstOpenLog);
taskLogs.bind(fakeTaskRoot([firstOpenDetails]));
firstOpenDetails.open = true;
firstOpenDetails.listeners.toggle();
assert.equal(firstOpenLog.scrollTop, 130, "task center log should start at the latest output on first open");
assert.match(taskCenter, /paint: \(jobs\?: TaskRecord\[\]\) => quickServices\.termaQuickViews\?\.renderTaskCenter\(jobs\)/);
assert.match(taskCenterVue, /export function renderTaskCenter[\s\S]*?const previousList = document\.getElementById\('sftpTaskCenterList'\)[\s\S]*?captureSftpTaskLogViewStates\(previousList\)[\s\S]*?bindSftpTaskLogViewStates\(document\.getElementById\('sftpTaskCenterList'\)\)/);

console.log("remote install UI checks passed");
