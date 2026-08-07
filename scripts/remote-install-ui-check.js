const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const remote = fs.readFileSync(path.join(root, "public", "app-remote.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "public", "app-workspace.js"), "utf8");
const taskCenter = fs.readFileSync(path.join(root, "public", "app-sftp-tasks.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server.ts"), "utf8");
const xdmcp = fs.readFileSync(path.join(root, "src", "xdmcp-manager.ts"), "utf8");
const desktop = fs.readFileSync(path.join(root, "src", "linux-desktop-manager.ts"), "utf8");

for (const label of ["在线安装", "使用远端缓存", "本机下载后离线安装", "手动安装/配置说明"]) {
  assert.ok(remote.includes(label), `frontend must expose ${label}`);
}
assert.match(remote, /REMOTE_INSTALL_MODE_ORDER\s*=\s*\["online",\s*"local-offline",\s*"offline",\s*"manual"\]/);
assert.match(remote, /mode\.available/);
assert.match(remote, /remoteInstallPlanMode\(plan, modeId\)/);
assert.match(remote, /本机下载后离线安装仅支持 Debian\/Ubuntu 及兼容 APT\/\.deb 系统/);
assert.doesNotMatch(remote, /请选择在线,?本机离线,?远端缓存或手动方式安装 RDP 服务端/);

assert.match(remote, /x11-applications\/install-plan/);
assert.match(remote, /action = normalizedMode === "local-offline" \? "install-local-offline" : normalizedMode === "offline" \? "install-offline" : "install"/);
assert.match(remote, /diagnostics\.desktop_install_plans\?\.\[desktopId\]/);
assert.match(remote, /desktop_id:desktopId, mode:normalizedMode/);
for (const id of ["xfce", "gnome", "plasma", "mate", "cinnamon", "lxqt"]) {
  assert.ok(remote.includes(`${id}:\"`) || remote.includes(`${id}:"`), `Linux desktop ${id} must use the shared install entry`);
}
assert.match(remote, /package_plans\?\.\[key\]/);
assert.match(remote, /\["install-lightdm", "install-xfce", "install-rdp"\]/);
assert.match(remote, /const requestAction = packageInstall[\s\S]*?`\$\{action\}-local-offline`[\s\S]*?`\$\{action\}-offline`/);
assert.match(remote, /if \(result\.task\)/);
assert.match(remote, /refreshSftpJobs\(\)/);
assert.match(remote, /renderXdmcpServerState\(result\.after \|\| result\.before\)/);
assert.match(remote, /显示管理器：/);
assert.match(remote, /账号桌面映射：/);
assert.match(remote, /XDMCP 配置已经写入，但 UDP 177 尚未监听/);
assert.match(remote, /本机也无法联网时/);

assert.match(remote, /\/api\/remote-profiles\/\$\{Number\(profileId\)\}\/rdp\/server/);
assert.match(remote, /installRdpServer\(/);
for (const action of ["install", "install-offline", "install-local-offline"]) {
  assert.ok(remote.includes(`"${action}"`), `RDP action ${action} must be mapped in the UI`);
}
assert.match(remote, /rdp_install_plan/);
assert.match(remote, /async function launchRemoteDesktop[\s\S]*?profile\?\.protocol === "rdp"[\s\S]*?await inspectRdpServer\(id\)/, "RDP must recheck the remote service immediately before launch");
assert.match(remote, /远端 xrdp 服务未运行/);
assert.match(remote, /远端 TCP 3389 未监听/);
assert.match(remote, /remoteDesktopProtocolGuideMarkup\("rdp", diagnostics, profile\)/, "RDP status must explain the desktop login account and preferred backend");
assert.match(remote, /xrdp 使用 Xorg\/xorgxrdp/);
assert.match(remote, /临时管理员授权(?:的 root )?密码、VNC 密码(?:或|和) Windows 当前账号/);
assert.match(app, /remoteDesktopQuickOpen = localStorage\.getItem\("remoteDesktopQuickOpen"\) === "1"/, "remote desktop quick open must default to off");
assert.match(workspace, /function toggleRemoteDesktopQuickOpen\(\)[\s\S]*?localStorage\.setItem\("remoteDesktopQuickOpen"/, "quick open preference must persist");
assert.match(workspace, /quickOpenButton[\s\S]*?aria-pressed[\s\S]*?icon\("zap"\)/, "Other Connections toolbar must expose a stateful quick-open button");
assert.match(remote, /updateTab && remoteDesktopQuickOpen && clientLaunchable/, "automatic launch must be gated by the quick-open preference");
assert.match(remote, /async function openRemoteDesktop[\s\S]*?captureRemoteDesktopRenderScope\(profile\.id, key, view\)[\s\S]*?await withRemoteDesktopRenderScope\(renderScope,[\s\S]*?catch \(error\) \{[\s\S]*?withRemoteDesktopRenderScope\(renderScope,/, "remote desktop diagnostics must ignore stale async results instead of touching a missing status element");
assert.match(workspace, /tab\.kind === "linux-desktop"[\s\S]{0,220}openLinuxDesktopManager\(connectionId, false\)/, "legacy workspace restoration must render Linux desktop manager tabs");
assert.match(remote, /id="vncServerState"[\s\S]*?正在探测远端 VNC 服务/, "VNC must enter the shared detection workspace before connecting");
assert.match(remote, /function openEmbeddedVncDesktop/, "embedded VNC launch must be a separate confirmed action");
assert.match(remote, /allowNoPassword:startPlanSupportsNoPassword/, "VNC start must expose an explicit no-password choice");
assert.match(remote, /id="vncCredentialNoPassword"/, "VNC credential dialog must expose no-password opt-in");
assert.match(remote, /allow_no_password:allowNoPassword/, "VNC start request must carry the explicit no-password choice");

assert.match(remote, /remoteInstallModesMarkup\(installPlan,[\s\S]{0,240}installVncServer/, "VNC must reuse the shared install mode selector");
for (const mode of ["online", "offline", "local-offline"]) {
  assert.ok(remote.includes(`mode === "${mode}"`) || remote.includes(`mode === '${mode}'`), `VNC install mode ${mode} must be normalized`);
}
assert.match(remote, /openVncSetupGuide/);
assert.match(remote, /vnc-clipboard\/helper/);
assert.match(remote, /installVncClipboardHelper/);
assert.match(remote, /function uninstallVncClipboardHelper\(/, "Linux 剪贴板辅助必须提供卸载入口");
assert.match(remote, /const uninstallAction = platform === "linux" && uninstallPlan\.available/, "macOS 剪贴板辅助不得显示卸载按钮");
assert.match(remote, /function watchVncClipboardHelperTask\(/, "剪贴板辅助安装和卸载必须复用任务状态轮询");
assert.match(remote, /const activeAction = String\(result\.task\.action \|\| action\)[\s\S]{0,520}watchVncClipboardHelperTask\(session, result\.task\.id, activeAction\)/, "clipboard install conflicts must observe the action that is actually running");
assert.match(remote, /const activeAction = String\(result\.task\.action \|\| "uninstall"\)[\s\S]{0,520}watchVncClipboardHelperTask\(session, result\.task\.id, activeAction\)/, "clipboard uninstall conflicts must observe the action that is actually running");
assert.match(remote, /macOS 已自带 pbcopy\/pbpaste/);
assert.match(remote, /remoteInstallModesMarkup\(diagnostics\.install_plan/);
assert.match(server, /configureVncClipboardHelperForProfile/);
assert.match(server, /allow_no_password === true/);
assert.match(server, /buildVncStartCommand\(before, savedPassword, \{allow_no_password:allowNoPassword\}\)/);
assert.match(server, /vnc\.clipboard-helper\.install-local-offline/);
assert.match(server, /install-local-offline", "uninstall"/);
assert.match(server, /component:"vnc-clipboard-helper"[\s\S]*?startRemoteComponentCommandTask/);
assert.match(server, /validate:after => uninstalling[\s\S]*?重新探测后仍可用/);
assert.match(server, /clearVncClipboardCapabilityCache\(\);[\s\S]{0,160}return inspectVncClipboardHelperForProfile/);
assert.doesNotMatch(server, /离线缓存包,?请改用[^\n]*本机下载后离线安装/);

for (const action of ["start", "stop", "uninstall"]) {
  assert.match(remote, new RegExp(`runRdpServerAction\\([^\\n]+['\"]${action}['\"]`), `RDP UI must expose ${action}`);
  assert.match(remote, new RegExp(`runVncServerAction\\([^\\n]+['\"]${action}['\"]`), `VNC UI must expose ${action}`);
}
assert.match(remote, /configureXdmcpHost\([^\n]+['\"]uninstall-lightdm['\"]/, "XDMCP UI must expose safe LightDM removal when a backup is available");
assert.match(remote, /uninstallRemoteX11Components/, "X11 component management must expose uninstall");
assert.match(remote, /remote-service-state vnc-connection-help-panel/, "VNC diagnostics must use the shared in-workspace service state card");
assert.match(remote, /共享来源用 x11vnc，独立来源用 TigerVNC/);
assert.match(remote, /Xtigervnc\/Xvnc 是底层进程名/);
assert.match(remote, /diagnostics\?\.running_component \|\| diagnostics\?\.selected_component/, "VNC status must prefer the component which owns the listener over the aggregate service unit");
assert.match(remote, /监听进程：/);
assert.doesNotMatch(remote, /独立虚拟桌面（TigerVNC\/Xvnc）/);
assert.match(remote, /运行 Terma 的设备必须有可用的本机 X Server/);
assert.match(remote, /remote-service-head rdp-server-head/);
assert.match(remote, /remote-service-head xdmcp-server-head/);
assert.match(remote, /function watchRemoteComponentTask/);
assert.match(remote, /function captureRemoteComponentTaskScope/);
assert.match(remote, /function remoteComponentTaskScopeMatches/);
assert.match(remote, /const currentOptions = subscriberOptions\(subscriber\);[\s\S]*?remoteComponentTaskContainer\(currentOptions\.scope, container\)/, "each remote task subscriber must resolve its own scoped container");
assert.match(remote, /container:taskContainer,\s*scope:taskScope/);
assert.match(remote, /onDone:\(_, activeContainer\)[^\n]+inspectRdpServer\(profileId, null, activeContainer\)/);
assert.match(remote, /onDone:\(_, activeContainer\)[^\n]+inspectXdmcpServer\(id, null, activeContainer\)/);
assert.match(remote, /modalTaskHost\?\.isConnected[\s\S]{0,260}taskFallbackContainer/);
assert.match(remote, /workspaceContainer = remoteComponentTaskContainer\(taskScope, taskStateContainer\)/);
assert.match(remote, /function setRemoteComponentTaskHost/);
assert.match(remote, /setRemoteComponentTaskHost\(container, true\)/);
assert.match(remote, /setRemoteComponentTaskHost\(container, false\)/);

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
assert.match(css, /\.operation-pane-narrow \.connection-action-strip\s*\{[^}]*display:flex[^}]*flex-wrap:wrap/s, "narrow connection actions must wrap instead of clipping");
assert.match(css, /\.operation-pane-narrow \.connection-action-strip \.explorer-main-action\s*\{[^}]*flex:1 0 100%[^}]*overflow:visible/s, "narrow add-connection action must keep its label visible");
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

const remoteContext = vm.createContext({console, Map, Set, Date, setInterval, clearInterval, setTimeout, clearTimeout});
remoteContext.currentLog = null;
remoteContext.$ = id => id === "linuxDesktopTaskLog" ? remoteContext.currentLog : null;
vm.runInContext(remote, remoteContext);
const linuxDesktopWorkspaceCalls = [];
remoteContext.showPrimary = () => {};
remoteContext.setWorkspace = (...args) => linuxDesktopWorkspaceCalls.push(args);
remoteContext.renderLinuxDesktopManager = () => {};
remoteContext.loadLinuxDesktopManager = () => {};
remoteContext.openLinuxDesktopManager(23, false);
assert.equal(linuxDesktopWorkspaceCalls.length, 1, "restoring Linux desktop manager must render through its normal workspace entry");
assert.equal(linuxDesktopWorkspaceCalls[0][4], false, "restoring Linux desktop manager must not create a duplicate tab");
assert.equal(linuxDesktopWorkspaceCalls[0][6].kind, "linux-desktop");
assert.equal(linuxDesktopWorkspaceCalls[0][6].id, 23, "Linux desktop manager tabs must persist their SSH connection id");
remoteContext.tabs = [{key:"linux-desktop-select", kind:"linux-desktop", id:0}];
remoteContext.activeTabKey = "linux-desktop-select";
let linuxDesktopTabsSaved = 0;
remoteContext.saveTabsState = () => { linuxDesktopTabsSaved += 1; };
remoteContext.selectLinuxDesktopManagerConnection("31");
assert.equal(remoteContext.tabs[0].id, 31, "choosing an SSH host must update the persisted Linux desktop manager tab");
assert.equal(linuxDesktopTabsSaved, 1, "choosing an SSH host must save the restored selection");
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
const originalTaskContainer = fakeTaskContainer("rdpServerState", "pane-task");
const taskScope = remoteContext.captureRemoteComponentTaskScope(7, "remote-desktop-7", originalTaskContainer);
assert.equal(remoteContext.remoteComponentTaskScopeMatches(taskScope), true, "task scope should match its originating pane and profile");
const wrongPaneContainer = fakeTaskContainer("rdpServerState", "pane-other");
assert.equal(remoteContext.remoteComponentTaskContainer(taskScope, wrongPaneContainer), originalTaskContainer, "task rendering must not switch to another pane's matching element");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-8";
assert.equal(remoteContext.remoteComponentTaskContainer(taskScope, originalTaskContainer), null, "inactive task tabs must not receive background task rendering");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-7";
originalTaskContainer.isConnected = false;
const remountedTaskContainer = fakeTaskContainer("rdpServerState", "pane-task");
remoteContext.workspaceElementForTab = (key, selector) => key === "remote-desktop-7" && selector === "#rdpServerState" ? remountedTaskContainer : null;
const detachedModalHost = {id:"vncSetupTaskState", isConnected:false, closest:() => null};
assert.equal(remoteContext.remoteComponentTaskContainer(taskScope, detachedModalHost), remountedTaskContainer, "detached modal task hosts must fall back to the originating workspace container");
const renderView = {...fakeTaskContainer("view-remote-desktop", "pane-task"), dataset:{}};
const firstRenderScope = remoteContext.captureRemoteDesktopRenderScope(7, "remote-desktop-7", renderView);
assert.equal(remoteContext.remoteDesktopRenderView(firstRenderScope), renderView, "remote desktop results should resolve inside their originating active pane");
const secondRenderScope = remoteContext.captureRemoteDesktopRenderScope(7, "remote-desktop-7", renderView);
assert.equal(remoteContext.remoteDesktopRenderView(firstRenderScope), null, "an older remote desktop request must not overwrite a newer render of the same tab");
assert.equal(remoteContext.remoteDesktopRenderView(secondRenderScope), renderView, "the newest remote desktop request should remain current");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-8";
assert.equal(remoteContext.remoteDesktopRenderView(secondRenderScope), null, "remote desktop results must be ignored after the user switches tabs");
taskPanes.get("pane-task").activeTabKey = "remote-desktop-7";
renderView.isConnected = false;
assert.equal(remoteContext.remoteDesktopRenderView(secondRenderScope), null, "detached remote desktop views must not receive async status updates");
remoteContext.resetLinuxDesktopTaskLogView("desktop-1");
remoteContext.currentLog = fakeScrollLog({scrollHeight:100, clientHeight:20, scrollTop:80, taskId:"desktop-1", expanded:true});
remoteContext.captureLinuxDesktopTaskLogView();
const refreshedDesktopLog = fakeScrollLog({scrollHeight:160, clientHeight:20, taskId:"desktop-1"});
remoteContext.restoreLinuxDesktopTaskLogView(refreshedDesktopLog, {id:"desktop-1"});
assert.equal(refreshedDesktopLog.scrollTop, 140, "Linux desktop log should follow new output while it was at the bottom");
assert.equal(refreshedDesktopLog.classList.contains("expanded"), true, "Linux desktop log should preserve its expanded state");
refreshedDesktopLog.scrollTop = 36;
refreshedDesktopLog.listeners.scroll();
const reviewedDesktopLog = fakeScrollLog({scrollHeight:220, clientHeight:20, taskId:"desktop-1"});
remoteContext.restoreLinuxDesktopTaskLogView(reviewedDesktopLog, {id:"desktop-1"});
assert.equal(reviewedDesktopLog.scrollTop, 36, "Linux desktop log should preserve the user's history position");
assert.match(remote, /renderLinuxDesktopTask[\s\S]*?captureLinuxDesktopTaskLogView\(\)[\s\S]*?restoreLinuxDesktopTaskLogView/);

const taskContext = vm.createContext({console, Map, Set, Date, setInterval, clearInterval, document:{getElementById:() => null}});
vm.runInContext(taskCenter, taskContext);
const currentTaskLog = fakeScrollLog({scrollHeight:120, clientHeight:20, scrollTop:100});
const currentTaskDetails = fakeTaskDetails("desktop:1", currentTaskLog, true);
taskContext.captureSftpTaskLogViewStates(fakeTaskRoot([currentTaskDetails]));
const refreshedTaskLog = fakeScrollLog({scrollHeight:200, clientHeight:20});
const refreshedTaskDetails = fakeTaskDetails("desktop:1", refreshedTaskLog);
taskContext.bindSftpTaskLogViewStates(fakeTaskRoot([refreshedTaskDetails]));
assert.equal(refreshedTaskDetails.open, true, "task center log should remain expanded after polling");
assert.equal(refreshedTaskLog.scrollTop, 180, "task center log should follow new output while it was at the bottom");
refreshedTaskLog.scrollTop = 44;
refreshedTaskLog.listeners.scroll();
taskContext.captureSftpTaskLogViewStates(fakeTaskRoot([refreshedTaskDetails]));
const reviewedTaskLog = fakeScrollLog({scrollHeight:260, clientHeight:20});
const reviewedTaskDetails = fakeTaskDetails("desktop:1", reviewedTaskLog);
taskContext.bindSftpTaskLogViewStates(fakeTaskRoot([reviewedTaskDetails]));
assert.equal(reviewedTaskDetails.open, true, "task center log should stay expanded while reviewing history");
assert.equal(reviewedTaskLog.scrollTop, 44, "task center log should preserve the user's history position");
const firstOpenLog = fakeScrollLog({scrollHeight:150, clientHeight:20});
const firstOpenDetails = fakeTaskDetails("component:2", firstOpenLog);
taskContext.bindSftpTaskLogViewStates(fakeTaskRoot([firstOpenDetails]));
firstOpenDetails.open = true;
firstOpenDetails.listeners.toggle();
assert.equal(firstOpenLog.scrollTop, 130, "task center log should start at the latest output on first open");
assert.match(taskCenter, /renderSftpTaskCenterDrawer[\s\S]*?captureSftpTaskLogViewStates\(list\)[\s\S]*?bindSftpTaskLogViewStates\(list\)/);

console.log("remote install UI checks passed");
