import {terminalServices} from '@/features/terminal/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {showTerminalSessionText} from './terminal-text-dialogs';
import {isMobileLayout,stateView} from '@/shared/browser-ui';
import {esc,escAttr} from '@/shared/html-escape';
import {showActionMenu} from '@/shared/action-menu';
import {$} from '@/shared/workspace-dom';
import {noteConnectionUsage} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {terminalSessions,terminalSurfaceCache,terminalCounts,type TerminalSession} from './terminal-session-state';
import {quickTerminalConnections,quickConnectionsById} from './terminal-quick-registry';
import {createTerminalLogId} from './terminal-identity';
import {terminalViewForKey} from './terminal-engine-view';
import {terminalSessionConnectionStatus,updateTerminalConnectionStatus,reconnectTerminal,toggleTerminalConnection} from './terminal-connection-runtime';
import {workspaceTabByKey,workspaceFindPaneForTab,workspaceCssEscape} from '../workspace/workspace-dock-state';
import {setWorkspace} from '../workspace/workspace-dock-runtime';
import {workspacePaneElement} from '../workspace/workspace-pane-scope';
import {translate as tr} from '../../shared/i18n/runtime';
import type {WorkspaceTab} from '../workspace/workspace-tab-runtime';
import {cleanTab,type SessionTab,type RecoverableRecord} from '../session-efficiency/session-model';
import type {PreparedRecord,createPersistentSessionService} from '../session-efficiency/persistent-session-service';
import type {TerminalDisplayMenuAction} from './TerminalDisplayMenuView';
type Connection=TerminalSession['connection'];
type SessionService=ReturnType<typeof createPersistentSessionService>;
export function updateTerminalStatusForLayout(key=applicationState.activeTabKey) {
  terminalServices.termaTerminalToolbar?.refresh(key);
}

export function syncTerminalToolbarPlacement(tabKey=applicationState.activeTabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : applicationState.tabs.find(item => item.key === key);
  if (!tab || !["terminal", "quick-terminal"].includes(tab.kind||'')) return;
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const view = pane && workspaceServices.termaWorkspacePaneScope
    ? workspacePaneElement(pane.id)?.querySelector<HTMLElement>("#view-terminal")
    : $("view-terminal");
  if (!view) return;
  const mount = view.querySelector<HTMLElement>("#terminalToolbarMount");
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(key);
  const toolbar = mount?.querySelector<HTMLElement>(":scope > .terminal-toolbar")
    || document.querySelector<HTMLElement>(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`);
  if (!mount || !toolbar) return;
  toolbar.dataset.workspaceTabKey = key;
  toolbar.dataset.terminalTabKey = key;
  view.dataset.workspaceTabKey = key;
  view.dataset.terminalTabKey = key;
  terminalServices.termaTerminalToolbar?.mount(key);
  if (workspaceServices.termaWorkspaceToolbar) workspaceServices.termaWorkspaceToolbar!.place("terminal", key, toolbar, mount);
  else {
    mount.replaceChildren(toolbar);
    toolbar.hidden = false;
    toolbar.classList.remove("terminal-toolbar-header");
  }
  workspaceServices.termaWorkspaceToolbar?.visibility();
  window.dispatchEvent(new CustomEvent("terma:terminal-toolbar-ready", {detail:{key}}));
  updateTerminalStatusForLayout(key);
  terminalServices.termaTerminalViewport!.schedule();
}

export function updateTerminalConnectionToggle(key:string) {
  terminalServices.termaTerminalToolbar?.refresh(key);
}

export function nextTerminalTabIndex(connectionId:number) {
  const id = Number(connectionId);
  const siblings = applicationState.tabs.filter(tab => tab.kind === "terminal" && Number(tab.id) === id);
  let current = siblings.length ? Number(terminalCounts.get(id) || 0) : 0;
  for (const tab of siblings) {
    current = Math.max(current, Number(String(tab.key).match(new RegExp(`^terminal-${id}-(\\d+)$`))?.[1] || 0));
  }
  let next = current + 1;
  while (applicationState.tabs.some(tab => tab.key === `terminal-${id}-${next}`) || terminalSessions.has(`terminal-${id}-${next}`)) next += 1;
  terminalCounts.set(id, next);
  return next;
}

export function openTerminal(id:number|undefined, updateTab=true, existingKey="", existingTitle="") {
  const selected = connectionsServices.termaConnectionController?.select(id, {render:false, reveal:updateTab}) as Connection|undefined;
  if (!selected) return;
  const savedTab = existingKey && typeof workspaceTabByKey === "function" ? workspaceTabByKey(existingKey) : applicationState.tabs.find(tab => tab.key === existingKey);
  const c = savedTab?.kind === "terminal"
    ? {...selected,
      terminal_session_mode:savedTab.sessionMode || "none",
      terminal_session_backend:savedTab.sessionBackend || "auto",
      terminal_session_id:savedTab.persistentSessionId || ""
    }
    : selected;
  if (!c.quick_connection && updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(c.id, "terminal");
  return openTerminalConnection(c, updateTab, existingKey, existingTitle);
}

export function openQuickTerminal(value:unknown, quickToken:string, updateTab=true, existingKey="", existingTitle="") {
  const connection=value as Connection;
  const c = {
    ...connection,
    id:Number(connection?.id || 0),
    quick_connection:true,
    quick_token:String(quickToken || ""),
    terminal_encoding:connection?.terminal_encoding || "utf8",
    terminal_font_family_inherit:1,
    terminal_font_size_inherit:1,
    terminal_mobile_font_size_inherit:1,
    terminal_line_height:1,
    terminal_font_weight:"normal",
    x11_mode:["trusted", "untrusted"].includes(String(connection?.x11_mode || "")) ? connection.x11_mode : "off"
  };
  if (!Number.isSafeInteger(c.id) || c.id >= 0) throw new Error(tr("terminal:errors.invalid_quick_connection_id", {defaultValue:"临时连接标识无效"}));
  const key = existingKey || `quick-terminal-${createTerminalLogId()}`;
  quickTerminalConnections.set(key, c);
  if (!quickConnectionsById.has(c.id)) quickConnectionsById.set(c.id, c);
  return openTerminalConnection(c, updateTab, key, existingTitle || tr("terminal:tabs.quick", {name:c.name, defaultValue:`${c.name} · 快速终端`}));
}

export function restoreQuickTerminalTab(tab:WorkspaceTab) {
  const connection = quickTerminalConnections.get(tab?.key) || terminalSessions.get(tab?.key)?.connection;
  if (!connection) return connectionsServices.termaConnectionViews?.renderWelcome();
  return openTerminalConnection(connection, false, tab.key, tab.title || tr("terminal:tabs.quick_generic", {defaultValue:"快速终端"}));
}

export function openTerminalConnection(value:unknown, updateTab=true, existingKey="", existingTitle="") {
  let c=value as Connection;
  const quick = Boolean(c.quick_connection);
  let key = existingKey;
  let title = existingTitle;
  if (!key) {
    const next = nextTerminalTabIndex(c.id);
    key = `terminal-${c.id}-${next}`;
    const suffix = next > 1 ? ` #${next}` : "";
    title = tr("terminal:tabs.session", {name:c.name, suffix, defaultValue:`${c.name} · 终端${suffix}`});
  } else {
    const restoredIndex = Number(String(key).match(new RegExp(`^terminal-${c.id}-(\\d+)$`))?.[1] || 0);
    if (restoredIndex > 0) {
      terminalCounts.set(c.id, Math.max(terminalCounts.get(c.id) || 0, restoredIndex));
    }
  }
  if (!quick) {
    const existingTab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : applicationState.tabs.find(item => item.key === key);
    const startupBackend = terminalServices.termaTerminalStartup!.backend(terminalServices.termaTerminalStartupState!.effective(c, key));
    const automaticSessionDisabled = existingTab?.resumePolicy === "never"
      && String(existingTab.sessionMode || "none") !== "persistent";
    if (startupBackend && !automaticSessionDisabled) {
      c = {
        ...c,
        terminal_session_mode:"persistent",
        terminal_session_backend:startupBackend,
        terminal_session_id:String(existingTab?.persistentSessionId || c.terminal_session_id || createTerminalLogId()).slice(0, 64)
      };
    }
  }
  const terminalView = terminalViewForKey(key);
  if(!terminalView)return;
  const cachedSurface = terminalSurfaceCache.get(key);
  if (cachedSurface && terminalView && terminalSessions.has(key)) {
    if (terminalView.firstElementChild !== cachedSurface) {
      terminalServices.termaTerminalSurface!.park(terminalView);
      terminalView.replaceChildren(cachedSurface);
    }
    terminalView.dataset.workspaceTabKey = key;
    terminalView.dataset.terminalTabKey = key;
    const session = terminalSessions.get(key)!;
    terminalServices.termaTerminalToolbarService?.status.set(key, terminalSessionConnectionStatus(session));
    session.connection = c;
    session.mount = cachedSurface.querySelector<HTMLElement>("#terminalMount");
    const preservedResumePolicy = (typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : applicationState.tabs.find(item => item.key === key))?.resumePolicy || "auto";
    setWorkspace(title, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "terminal", key, updateTab, true, {
      kind:quick ? "quick-terminal" : "terminal",
      id:c.id,
      connectionStatus:terminalSessionConnectionStatus(session),
      transient:quick,
      quick_connection:quick,
      sessionMode:c.terminal_session_mode || "none",
      sessionBackend:c.terminal_session_backend || "auto",
      persistentSessionId:c.terminal_session_id || "",
      resumePolicy:preservedResumePolicy,
      skipToolbarSync:true
    });
    syncTerminalToolbarPlacement(key);
    updateTerminalSessionToolbar(key, c);
    if (!quick) terminalServices.termaTerminalToolbar?.refresh(key);
    updateTerminalConnectionStatus(c, key, terminalSessionConnectionStatus(session));
    focusTerminalSession(key);
    return key;
  }
  const quickCommandBar = `<section class="terminal-quick-command-bar" data-terminal-quick-command-bar data-terminal-key="${escAttr(key)}"></section>`;
  terminalServices.termaTerminalSurface!.park(terminalView);
  const terminalSurface = terminalServices.termaTerminalSurface!.build(terminalView, key, {
    assistant:assistantServices.termaAssistant!.placeholder(key),
    quick:quickCommandBar
  });
  efficiencyServices.termaEfficiency!.quick.mount(key, terminalSurface);
  terminalServices.termaTerminalToolbarService?.status.set(key, "connecting");
  const persistedResumePolicy = (typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : applicationState.tabs.find(item => item.key === key))?.resumePolicy || "auto";
  setWorkspace(title, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "terminal", key, updateTab, true, {kind:quick ? "quick-terminal" : "terminal", id:c.id, connectionStatus:"connecting", transient:quick, quick_connection:quick, sessionMode:c.terminal_session_mode || "none", sessionBackend:c.terminal_session_backend || "auto", persistentSessionId:c.terminal_session_id || "", resumePolicy:persistedResumePolicy});
  syncTerminalToolbarPlacement(key);
  if (!quick) terminalServices.termaTerminalToolbar?.refresh(key);
  const terminalMount = terminalSurface.querySelector<HTMLElement>("#terminalMount");
  attachTerminal(c, key, terminalMount).catch(error => {
    if(terminalSurfaceCache.get(key)!==terminalSurface)return;
    const mount=terminalSurface.querySelector<HTMLElement>('#terminalMount');
    if(!mount)return;
    mount.innerHTML=stateView('error',tr('terminal:components.load_failed'),
      error instanceof Error?error.message:String(error),'');
    const retry=document.createElement('button');
    retry.type='button';retry.textContent=tr('terminal:toolbar.reconnect');
    retry.addEventListener('click',()=>reconnectTerminal(c.id,key));
    mount.appendChild(retry);
  });
  return key;
}

export function toggleTerminalPersistence(key:string){return sessionEfficiencyServices.termaSessionEfficiency!.service.enable(key);}

export function handleTerminalSessionButton(event:MouseEvent,key:string){return sessionEfficiencyServices.termaSessionEfficiency!.handle(event,key);}

export function openTerminalSessionMenu(event:MouseEvent,key:string){return sessionEfficiencyServices.termaSessionEfficiency!.menu(event,key);}

export function terminateTerminalPersistenceRecord(tab:SessionTab|RecoverableRecord|PreparedRecord|null|undefined){return tab?sessionEfficiencyServices.termaSessionEfficiency!.service.terminateRecord(tab):Promise.resolve(false);}

export function terminateTerminalPersistence(key:string,options:Parameters<SessionService["terminate"]>[1]={}){const tab=sessionEfficiencyServices.termaSessionEfficiency!.service.prepare(cleanTab(workspaceTabByKey(key)));return tab?sessionEfficiencyServices.termaSessionEfficiency!.service.terminate(tab,options):Promise.resolve(false);}

export function updateTerminalSessionToolbar(key:string, _connection?:unknown) {
  terminalServices.termaTerminalToolbar?.refresh(key);
}

export async function attachTerminal(c:Connection, key:string, mount=terminalServices.termaTerminalSurface?.element(key, "#terminalMount")) {
  return terminalServices.termaTerminalSurface!.attach(c, key, mount);
}

export function enableTerminalFontWheel(session:TerminalSession,key:string) {
  return terminalServices.termaTerminalInteraction!.enableFontWheel(session, key);
}

export function observeTerminalBox(session:TerminalSession) {
  return terminalServices.termaTerminalSurface!.observe(session);
}

export function syncTerminalResponsiveFontSizes() {
  return terminalServices.termaTerminalSurface!.syncFonts();
}

export function changeTerminalFont(key:string,delta:number) {
  return terminalServices.termaTerminalSurface!.changeFont(key, delta);
}

export function focusTerminalSession(key:string) {
  return terminalServices.termaTerminalSurface!.focus(key);
}

export async function copyTerminalText(key:string) {
  return terminalServices.termaTerminalClipboard!.copy(key);
}

export async function pasteTerminalText(key:string) {
  return terminalServices.termaTerminalClipboard!.paste(key);
}

export function showTerminalContextMenu(event:MouseEvent,key:string,connectionId:number) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const mobile = isMobileLayout();
  const quick = Boolean(session.connection?.quick_connection);
  showActionMenu(event, [
    ...(!mobile ? [{label:tr("terminal:context_menu.copy_selection", {defaultValue:"复制选中"}), icon:"copy", run:()=>copyTerminalText(key)}] : []),
    {label:tr("terminal:context_menu.cursor_copy", {defaultValue:"光标复制"}), icon:"mouse-pointer-2", run:()=>terminalServices.termaTerminalCursorCopy!.start(key)},
    {label:tr("terminal:context_menu.session_copy", {defaultValue:"会话复制"}), icon:"copy-check", run:()=>showTerminalSessionText(key)},
    {label:tr("terminal:context_menu.paste", {defaultValue:"粘贴"}), icon:"clipboard-paste", run:()=>pasteTerminalText(key)},
    {separator:true},
    {label:tr("terminal:context_menu.clear", {defaultValue:"清屏"}), icon:"eraser", run:()=>{ session.term.clear(); session.term.focus(); }},
    {label:tr("terminal:context_menu.scroll_bottom", {defaultValue:"滚动到底部"}), icon:"arrow-down-to-line", run:()=>session.term.scrollToBottom()},
    {label:tr(session.term.getSelection?.().trim() ? "terminal:context_menu.open_selected_sftp" : "terminal:context_menu.open_current_sftp", {defaultValue:session.term.getSelection?.().trim() ? "在 SFTP 打开选中路径" : "在 SFTP 打开当前目录"}), icon:"folder-open", run:()=>terminalServices.termaTerminalSurface!.openSelectedSftp(connectionId, key)},
    ...(!quick ? [{separator:true}, {label:tr("terminal:context_menu.startup", {defaultValue:"终端配置"}), icon:"command", run:()=>terminalServices.termaTerminalStartup!.open(key, connectionId)}] : [{separator:true}]),
    {label:tr(session.connected ? "terminal:context_menu.disconnect" : "terminal:context_menu.reconnect", {defaultValue:session.connected ? "断开连接" : "重新连接"}), icon:session.connected ? "link-2-off" : "link-2", run:()=>toggleTerminalConnection(connectionId, key)},
    ...(!mobile ? [{separator:true}, {label:tr("terminal:context_menu.global_settings", {defaultValue:"全局终端设置"}), icon:"settings", run:()=>terminalServices.termaTerminalSettings!.open(key)}] : [])
  ]);
}


