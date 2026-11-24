import {batchServices} from '@/features/batch/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {copyText} from '@/shared/clipboard-service';
import {notify} from '@/features/efficiency/notification-actions';
import {localizedBackendPublicError} from '@/shared/api/public-errors';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {saveLogState} from '@/shared/expanded-groups';
import {currentPageHostForForward,isLoopbackHost} from '@/shared/browser-ui';
import {esc} from '@/shared/html-escape';
import {showActionMenu} from '@/shared/action-menu';
import {setButtonBusy} from '@/shared/ui-action-service';
import {selectConnection} from '@/features/connections/connection-selection';
import {noteConnectionUsage} from '@/features/connections/connection-selection';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {openTerminal,focusTerminalSession} from '@/features/terminal/terminal-page';
import {repairSshCredentials} from '@/features/connections/ssh-credential-runtime';
import {sshAuthenticationFailure} from '@/features/connections/connection-credential-model';
import { renderTabs } from '@/features/workspace/workspace-dock-tabs';
import { setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import { workspaceAllTabs, workspaceTabByKey, workspaceLeaves } from '@/features/workspace/workspace-dock-state';
import { workspaceElementForTab, runInWorkspacePane, captureWorkspacePane, captureWorkspaceTab } from '@/features/workspace/workspace-pane-scope';
import { downloadBlob } from '@/shared/ui/browser-download';
import { DEFAULT_CONNECTION_GROUP, connectionGroupDisplayName } from '@/shared/connection-group';
import type { BatchConnection, BatchPort, BatchSocket } from '../batch/batch-model';
import type { Connection as ForwardConnection, Template as ForwardTemplate } from '../forwards/forward-model';
import type { ForwardWorkspaceHost } from '../forwards/forward-workspace';
import type { LogData, LogListPort } from '../logs/log-list-service';
import type { MaintenancePort } from '../logs/log-maintenance-service';
import type { ReaderPort } from '../logs/log-reader-model';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import { parseExternalEditorArguments } from './external-edit-service';
import { request, errorMessage, type Api, type Translate } from './operations-types';

type LogTab = WorkspaceTab;
type CapturePane = (action: () => void) => void;

const commonPort: Pick<BatchPort, 'api' | 'tr' | 'notify' | 'error'> = {
  api: (url, options) => api(url, options),
  tr: (key, values) => tr(key, values),
  notify: (message: string, kind: 'info' | 'error' | 'success') => notify(message, kind),
  error: (value: unknown, fallback: string) => localizedBackendPublicError(value, errorMessage(value, fallback)),
};
const locale = () => document.documentElement.lang || 'zh-CN';
const tabByKey = (key: string) => workspaceTabByKey(key) ?? applicationState.tabs.find(tab => tab.key === key);
const tabIsOwned = (tab: WorkspaceTab) => workspaceAllTabs().includes(tab);

function batchSocket(): BatchSocket {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws/batch-command`);
  return {
    send: value => socket.send(value), close: () => socket.close(),
    on(type, listener) {
      const handler = (event: Event) => listener(type === 'message' ? { data: (event as MessageEvent).data } : {});
      socket.addEventListener(type, handler);
      return () => socket.removeEventListener(type, handler);
    },
  };
}

export function openBatchCommand(update = true) {
  const key = update ? 'command' : applicationState.activeTabKey;
  setWorkspace(tr('terminal:batch.title'), tr('terminal:batch.workspace_subtitle'), 'command', key, update, true, { kind:'command' });
  const target = $('view-command');
  if (target) batchServices.termaBatch.mountPage(target);
  const templates = batchServices.termaBatch.templates();
  if (!templates.model.items.length) void templates.load();
}

export async function renderBatchExplorer({ reload = true } = {}) {
  if (applicationState.primaryView === 'command') {
    const target = $('connectionGroups');
    if (target) {
      connectionsServices.termaConnectionViews?.release(target);
      batchServices.termaBatch.mountList(target);
    }
  }
  const templates = batchServices.termaBatch.templates();
  if (reload || !templates.model.items.length) return templates.load();
}

function openLog(path = '', title = '', update = true, key = '', query?: string, line = 0) {
  return logsServices.termaLogReader.feature().service.open(path, title || tr('common:log_viewer.default_title'), update, key, query, Number(line) || 0);
}

export async function renderLogs() {
  if (applicationState.primaryView !== 'logs') return;
  const target = $('connectionGroups');
  if (!target) return;
  connectionsServices.termaConnectionViews?.release(target);
  logsServices.termaLogList.list(target);
  return logsServices.termaLogList.service().load();
}

function removeDeletedLogTabs(paths: string[]) {
  const deleted = new Set(paths);
  const matches = (tab: LogTab) => tab.kind === 'log' && deleted.has(tab.path || '');
  const reader = logsServices.termaLogReader.feature();
  for (const tab of workspaceAllTabs().filter(matches)) reader.release(tab.key);
  for (const pane of workspaceLeaves()) runInWorkspacePane(pane.id, () => {
    applicationState.tabs = applicationState.tabs.filter(tab => !matches(tab));
    renderTabs();
  });
  workspaceServices.termaWorkspacePersistence?.save();
}

async function clearAllLogs() {
  const data = await request<LogData>(api, '/api/logs');
  const paths = [...(data.system || []), ...(data.batch || []), ...(data.connections || []).flatMap(group => group.logs || [])].map(file => file.path);
  return logsServices.termaLogMaintenance.remove(paths);
}

function showLogCleanupMenu(event: MouseEvent) {
  showActionMenu(event, [
    ...[7, 30, 90].map(days => ({ label:tr('navigation:menus.clear_logs_older_than', { days }), icon:'calendar-minus', run:() => logsServices.termaLogMaintenance.cleanup(days) })),
    { separator:true },
    { label:tr('navigation:menus.clear_all_logs'), icon:'trash-2', danger:true, run:clearAllLogs }
  ]);
}

export const batchWorkspacePort: BatchPort = {
  ...commonPort,
  connections: () => applicationState.connections, visibleConnections: () => connectionsServices.termaConnectionList?.filteredConnections() ?? [],
  primary: () => applicationState.primaryView, selected: () => Number(applicationState.selectedId) || 0,
  scope(key = applicationState.activeTabKey) {
    const tab = tabByKey(key);
    if (tab?.kind !== 'command') return null;
    const valid = () => tabIsOwned(tab);
    return { owner: tab, key: tab.key, valid, active: () => valid() && Boolean(workspaceElementForTab(tab.key, '#view-command')?.isConnected) };
  },
  socket: batchSocket, copy: async text => copyText(text), paste: () => navigator.clipboard.readText(),
  download(text, format) {
    const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
    downloadBlob(blob, `terma-batch-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`);
  },
  openLog: (path, label) => openLog(path, label), groupName: name => connectionGroupDisplayName(name), open: () => openBatchCommand(),
};

export const logListWorkspacePort: LogListPort = {
  ...commonPort,
  locale, visible: () => applicationState.primaryView === 'logs',
  initial: () => ({ query: applicationState.logSearch, open: [...applicationState.logOpen] }),
  save(query, open) {
    applicationState.logSearch = query;
    applicationState.logOpen.clear();
    for (const key of open) applicationState.logOpen.add(key);
    saveLogState();
  },
  publish: data => { applicationState.logsData = data; },
  open: (file, query, line) => openLog(file.path, file.label, true, '', query, line),
  searchContext() {
    const key = applicationState.activeTabKey, tab = tabByKey(key), reader = logsServices.termaLogReader.feature().service;
    const state = reader.get(key), inPane = captureWorkspacePane();
    return (query, hits) => {
      if (!state?.path || applicationState.activeView !== 'log' || applicationState.activeTabKey !== key || tabByKey(key) !== tab || reader.get(key) !== state) return;
      const line = Number(hits.find(hit => hit.path === state.path)?.matches?.[0]?.line || 0);
      inPane(() => openLog(state.path, state.sourceTitle || state.title, false, key, query, line));
    };
  },
  deleted: paths => removeDeletedLogTabs(paths), cleanup: event => showLogCleanupMenu(event),
  settings: () => Promise.resolve().then(() => logsServices.termaLogMaintenance.settings()).catch(e => notify(errorMessage(e, tr('common:log_maintenance.operation_failed')), 'error')),
  today: () => logsServices.termaLogReader.feature().service.date().catch(e => notify(errorMessage(e, tr('common:log_maintenance.operation_failed')), 'error')),
};

export const logMaintenanceWorkspacePort: MaintenancePort = {
  ...commonPort, reload: () => renderLogs(), deleted: paths => removeDeletedLogTabs(paths),
};

function logScope(key: string) {
  const tab = tabByKey(key);
  if (tab?.kind !== 'log') return null;
  return { owner: tab, key, valid: () => tabIsOwned(tab), element: () => workspaceElementForTab(key, '#view-log') };
}

function logEditorOptions() {
  const mode = localStorage.getItem('sftpExternalEditorMode') || 'system';
  if (mode !== 'custom') return { mode };
  const path = localStorage.getItem('sftpExternalEditorPath') || '';
  const raw = localStorage.getItem('sftpExternalEditorArgs') || '';
  if (raw.trimStart().startsWith('[')) {
    try {
      const args: unknown = JSON.parse(raw);
      if (Array.isArray(args) && args.every(value => typeof value === 'string')) return { mode, path, args };
    } catch { /* Legacy custom arguments can also be plain text. */ }
  }
  return { mode, path, args: parseExternalEditorArguments(raw) };
}

export const logReaderWorkspacePort: ReaderPort = {
  ...commonPort,
  locale, defaultQuery: () => applicationState.logSearch,
  label: value => logsServices.termaLogList.label(value || tr('common:auto.logs')),
  phrase: value => localizedTermaUiPhrase(value),
  current: () => ({ key: applicationState.activeTabKey, kind: tabByKey(applicationState.activeTabKey)?.kind || '' }),
  workspace(path, title, key, update) {
    setWorkspace(title, tr('common:log_viewer.workspace_title'), 'log', key, update, true, { kind: 'log', path, logTitleSource: title });
    return logScope(key);
  },
  scope: logScope, active: key => applicationState.activeTabKey === key, externalAvailable: () => Boolean(window.termaDesktop),
  external: path => api('/api/logs/open-external', { method: 'POST', body: JSON.stringify({ path, editor: logEditorOptions() }) }),
  ai: key => assistantServices.termaAssistant.openLog(key),
  dateContext() {
    const inPane = captureWorkspacePane(), key = applicationState.activeTabKey, tab = tabByKey(key);
    const matches = () => applicationState.activeTabKey === key && tabByKey(key) === tab;
    return {
      valid() { let valid = false; inPane(() => { valid = matches(); }); return valid; },
      open: (path, title) => inPane(() => { if (matches()) openLog(path, title); }),
    };
  },
  title(key, title, source) {
    const tab = tabByKey(key);
    if (!tab) return;
    tab.title = title;
    tab.logTitleSource = source;
    renderTabs();
    workspaceServices.termaWorkspacePersistence?.save();
  },
};

export const forwardWorkspacePort: ForwardWorkspaceHost = {
  ...commonPort,
  connections: () => applicationState.connections,
  templates: () => applicationState.forwardTemplates,
  setTemplates: value => { applicationState.forwardTemplates = value; },
  groupSources: () => [...applicationState.connections, ...applicationState.remoteProfiles],
  defaultGroup: DEFAULT_CONNECTION_GROUP,
  groupName: name => connectionGroupDisplayName(name),
  reload: () => sharedServices.termaWorkspaceRefresh.load(),
  copy: async value => copyText(value), logs: time => logsServices.termaLogReader.feature().service.date(Number(time) || undefined),
  pageHost: host => currentPageHostForForward(host), isLoopback: host => isLoopbackHost(host), escape: text => esc(text),
  activeTab: () => tabByKey(applicationState.activeTabKey), tabs: () => workspaceAllTabs(), captureTab: key => captureWorkspaceTab(key),
  selectedId: () => applicationState.selectedId??0, select: (id, opts) => selectConnection(id, opts), used: id => noteConnectionUsage(id, 'forwards'),
  show: (title, subtitle, view, key, update, meta) => setWorkspace(title, subtitle, view, key, update, true, meta),
  view: id => $(id), openTerminal: (id, key, title) => openTerminal(id, false, key, title), focusTerminal: key => focusTerminalSession(key),
  runningVisible: () => applicationState.primaryView === 'running', releaseConnectionList: root => connectionsServices.termaConnectionViews?.release(root),
  authenticationFailed: error => sshAuthenticationFailure(error), repairCredentials: (id, opts) => repairSshCredentials(id, opts),
  setBusy: (button, busy, text) => setButtonBusy(button as Parameters<typeof setButtonBusy>[0], busy, text),
};
