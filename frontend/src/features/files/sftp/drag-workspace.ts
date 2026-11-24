import {filesServices} from '@/features/files/installed-services';
import {isMobileLayout} from '@/shared/browser-ui';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {setTerminalDropState,uploadLocalFilesToTerminalTab} from '../../terminal/terminal-drop-workspace';
import { terminalDirectory } from '@/features/terminal/terminal-directory-workspace';
import { activateTab } from '@/features/workspace/workspace-dock-runtime';
import { workspaceAllTabs, workspaceDockState, workspaceFindPaneForTab, workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { workspacePaneElement } from '@/features/workspace/workspace-pane-scope';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import type { WorkspaceTab } from '@/features/workspace/workspace-tab-runtime';
import { createBrowserDropRuntime } from './browser-drop-runtime';
import type { BrowserDrag, DragTab, FileDragEvent } from './browser-drag-runtime';
import { createDropFeedback } from './drop-feedback';
import { createSftpDragRuntime } from './drag-runtime';
import { collectDroppedFiles } from './dropped-files';
import { INTERNAL_DRAG_MIME } from './drag-payload';
import type { SftpPageConnection } from './page-lifecycle';
import type { createSftpTabRuntime, SftpTabRuntime } from './tab-runtime';

interface TerminalDropSession {
  id: number; key: string; connected: boolean; mount?: HTMLElement;
  currentDirectory?: string; currentDirectoryKnown?: boolean; terminalDropDepth: number;
}
type DragPort = Parameters<typeof createSftpDragRuntime>[0];
type DropPort = Parameters<typeof createBrowserDropRuntime>[0];
type NativeEvents = {
  onSftpDragResult?: (callback: (result: Parameters<ReturnType<typeof createSftpDragRuntime>['native']['result']>[0]) => void) => void;
  onSftpDragEvent?: (callback: (event: Parameters<ReturnType<typeof createSftpDragRuntime>['native']['event']>[0]) => void) => void;
  capabilities?: { platform?: unknown };
};
interface DragWorkspacePort {
  tabs: ReturnType<typeof createSftpTabRuntime>;
  runtimes: Map<string, SftpTabRuntime>;
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  text: DragPort['text'];
  notify: DragPort['notify'];
}

function tabKeyFromNode(node?: EventTarget | null, fallback = applicationState.activeTabKey) {
  const element = node instanceof Element ? node : null;
  return element?.closest<HTMLElement>('[data-sftp-tab-key]')?.dataset.sftpTabKey || String(fallback || '');
}
function asDragTab(tab: WorkspaceTab | null | undefined): DragTab | undefined {
  if (!tab?.kind) return undefined;
  return { ...tab, kind: tab.kind, id: Number(tab.id || 0) };
}

export function createSftpDragWorkspace({ tabs: tabRuntime, runtimes, api, text, notify }: DragWorkspacePort) {
  const desktop = () => window.termaDesktop as (NonNullable<ReturnType<DragPort['bridge']>> & NativeEvents) | undefined;
  const active = () => applicationState.activeTabKey;
  const state = (key: string) => runtimes.get(key)?.state;
  const path = (tab: DragTab) => state(tab.key)?.path || tab.path || '.';
  const tab = (key: string) => asDragTab(workspaceTabByKey(key));
  const host = (key: string) => {
    const pane = workspaceFindPaneForTab(key), focused = workspacePaneElement(workspaceDockState.focusedPaneId);
    const selector = '#view-sftp:not([hidden]) #sftpList';
    return filesServices.termaSftpView.element('sftpList', key) || (pane && workspacePaneElement(pane.id)?.querySelector<HTMLElement>(selector))
      || focused?.querySelector<HTMLElement>(selector) || document.querySelector<HTMLElement>(selector);
  };
  const external = (...args: Parameters<ReturnType<typeof createDropFeedback>['external']>): void => dropFeedback.external(...args);
  const cancelLeave = (): void => dropFeedback.cancelLeave();
  const drag = createSftpDragRuntime({
    bridge: desktop,
    stage: (id, paths) => api(`/api/connections/${id}/sftp/stage-drag`, { method: 'POST', body: JSON.stringify({ paths }) }),
    sourceKey: tabKeyFromNode, active, tabs: () => applicationState.tabs.flatMap(item => asDragTab(item) || []), tab: key => tab(key), activate: key => activateTab(key),
    sourceState: key => tabRuntime.restore(key)?.state, state,
    selected: key => filesServices.termaSftpViews?.selectedEntries(key) || [],
    select: (key, id, filePath, name, type, preserve) => filesServices.termaSftpViews?.select(key, id,
      preserve ? { preserveSelection: true } : { forceSingle: true }, { path: filePath, name, type }),
    path, mobile: () => isMobileLayout(), text, notify, host,
    view(key) {
      const pane = workspaceFindPaneForTab(key), kind = tab(key)?.kind;
      const selector = kind === 'sftp' ? '#view-sftp' : kind === 'terminal' || kind === 'quick-terminal' ? '#view-terminal' : kind === 'local-files' ? '#view-local-files' : '';
      return pane && selector ? workspacePaneElement(pane.id)?.querySelector<HTMLElement>(selector) || null : null;
    },
    terminalKey: node => [...terminalSessions.values()].find(session => session.mount?.contains(node))?.key || '',
    localState: key => filesServices.termaLocalFileRuntime.files.states.get(key), localRoot: key => filesServices.termaLocalFileRuntime.root(key),
    sessions: () => terminalSessions.values(), session: key => terminalSessions.get(key),
    terminalState(session, enabled) {
      const current = terminalSessions.get(session.key);
      if (current === session) setTerminalDropState(current, enabled, 'copy');
    },
    terminalLabel(session) { return terminalDirectory.label(terminalSessions.get(session.key) ?? { ...session, connected: false }); },
    clearTerminal(key) {
      const session = terminalSessions.get(key);
      if (session) setTerminalDropState(session, false);
    },
    clearTerminals() {
      for (const session of terminalSessions.values()) { session.terminalDropDepth = 0; setTerminalDropState(session, false); }
    },
    external, cancelLeave,
    localPayload: data => filesServices.termaFileTransferRuntime.drag.read(data),
    localUpload: (...args) => filesServices.termaFileTransferRuntime.upload(...args),
    terminalUpload: (...args) => uploadLocalFilesToTerminalTab(...args),
    localCopy: (...args) => filesServices.termaFileTransferRuntime.receive(...args),
    initializeTerminal(tab, session) {
      const current = terminalSessions.get(tab.key);
      return current === session ? terminalDirectory.initialize(current, currentConnection(tab.id), tab.key) : Promise.resolve('');
    },
    target(kind, key) {
      if (kind === 'terminal') {
        const session = terminalSessions.get(key);
        return session?.connected ? { key: session.key, id: Number(session.id), kind, path: session.currentDirectory } : undefined;
      }
      const target = asDragTab(workspaceAllTabs().find(item => item.kind === kind && item.key === key));
      const directory = kind === 'sftp' ? state(key) : filesServices.termaLocalFileRuntime.files.states.get(key);
      return target ? { ...target, path: directory?.path || target.path } : undefined;
    },
    copy: (payload, id, directory, options) => filesServices.termaSftpFileActions.copy.copy(filesServices.termaSftpFileActions.copyPort(options.tabKey || '', id, directory, options.valid),
      payload.connectionId, payload.entries, { title: options.title }),
    refresh: () => filesServices.termaSftpTaskWorkspace.runtime.refresh(), startTimer: () => filesServices.termaSftpTransferLifecycle.polling.start(true)
  });
  const dropFeedback = createDropFeedback({
    active, keys: () => runtimes.keys(), root: key => tabRuntime.root(key), element: (id, key) => filesServices.termaSftpView.element(id, key), path: key => state(key)?.path,
    terminals: () => terminalSessions.values(), depth: () => drag.state.depth, resetDepth: () => { drag.state.depth = 0; }, ownDrag: () => browserDrop.own(),
    activity: drag.feedback.activity, hint: drag.hint, removeHint: () => drag.feedbackView.removeHint(), text
  });
  async function collect(data: Parameters<typeof collectDroppedFiles>[0], signal?: AbortSignal) {
    try { return await collectDroppedFiles(data, signal); }
    catch (error) {
      if (error instanceof Error && ['invalid_upload_path', 'invalid_upload_directory', 'upload_entry_limit'].includes(error.message))
        throw new Error(text(`sftp:transfer.${error.message}`));
      throw error;
    }
  }
  const browserDrop = createBrowserDropRuntime({
    internal: () => drag.state.internal, handoff: drag.source.handoff.read, requests: () => drag.state.requests.values(), nativeActive: drag.nativeRequestIsActive,
    platform: () => String(desktop()?.capabilities?.platform || ''), clearHandoff: drag.source.handoff.clear, reset: drag.browser.reset,
    payload: drag.source.active, localPayload: data => filesServices.termaFileTransferRuntime.drag.read(data), tab, target: (payload, key) => drag.crossTarget(payload, key) ?? undefined,
    path, root: key => tabRuntime.root(key), overlay: key => filesServices.termaSftpView.element('sftpDropOverlay', key),
    depth: value => { drag.state.depth = value; }, external, cancelLeave, leave: dropFeedback.scheduleLeave,
    activity: drag.feedback.activity, inside: drag.browser.inside, sourceHint: drag.sourceHint, hint: drag.hint, text, notify,
    local: (...args) => filesServices.termaFileTransferRuntime.upload(...args), copy: async (payload, target) => drag.destinations.remote(payload, target),
    finish: (payload: BrowserDrag) => drag.browser.finishPayload(payload), current: (...args) => filesServices.termaSftpTransfers.target(...args), collect,
    upload: (...args) => filesServices.termaSftpTransfers.controller.submit(...args)
  });
  const events = {
    over: (event: FileDragEvent, key = tabKeyFromNode(event.currentTarget), enter = false) => browserDrop.over(event, key, enter),
    enter: (event: FileDragEvent, key = tabKeyFromNode(event.currentTarget)) => browserDrop.over(event, key, true),
    leave: (event: FileDragEvent, key = tabKeyFromNode(event.currentTarget)) => browserDrop.leave(event, key),
    drop: (event: FileDragEvent, key = tabKeyFromNode(event.currentTarget)) => browserDrop.drop(event, key)
  };
  return { drag, dropFeedback, browserDrop, events, collect, mime: INTERNAL_DRAG_MIME,
    bind() {
      desktop()?.onSftpDragResult?.(result => { void drag.native.result(result); });
      desktop()?.onSftpDragEvent?.(event => drag.native.event(event));
      if (document.readyState === 'complete') drag.feedback.bind();
      else window.addEventListener('load', drag.feedback.bind, { once: true });
    }
  };
}



export interface InstalledFeaturesFilesSftpDragWorkspaceServices {
  termaSftpDragWorkspace: ReturnType<typeof createSftpDragWorkspace>
}
