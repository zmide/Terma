import {efficiencyServices} from '@/features/efficiency/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import {applicationState} from '@/shared/application-state';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import { renderTabs } from '@/features/workspace/workspace-dock-tabs';
import { Fragment, h, render } from 'vue';
import { confirmModal } from '@/shared/workspace-prompts';
import { TermaButton } from '@/shared/ui/TermaButton';
import { createTerminalBroadcastInputService } from '../efficiency/terminal-broadcast-input-service';
import { settingsIcon } from '../settings/settings-icon';
import type { TerminalSurfaceSession } from '../terminal/terminal-surface-service';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';

export function terminalBroadcastKeys() {
  const openKeys = applicationState.tabs.filter(tab => tab.kind === 'terminal').map(tab => tab.key);
  return efficiencyServices.termaTerminalBroadcast?.openTargets(openKeys) ?? [];
}

export function renderTabsPreservingTerminalFocus() {
  const focusedKey = applicationState.activeView === 'terminal' && document.activeElement?.closest('.xterm') ? applicationState.activeTabKey : '';
  renderTabs();
  if (focusedKey) focusTerminalSession(focusedKey);
}

export function stopTerminalBroadcast() {
  efficiencyServices.termaTerminalBroadcast?.clear();
  repaintTerminalBroadcast();
  renderTabsPreservingTerminalFocus();
}

export function repaintTerminalBroadcast(message = '') {
  let bar = document.getElementById('terminalBroadcastBar');
  const keys = terminalBroadcastKeys();
  if (keys.length < 2) {
    efficiencyServices.termaTerminalBroadcast?.clear();
    if (bar) { render(null, bar); bar.remove(); }
    document.body.classList.remove('terminal-broadcast-active');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'terminalBroadcastBar';
    bar.className = 'terminal-broadcast-bar';
    const quick = document.getElementById('workspaceQuickActions');
    if (quick) quick.before(bar);
    else document.querySelector('.topbar')?.appendChild(bar);
  }
  const title = tr('terminal:broadcast.status_title', {defaultValue: '终端同步'});
  const detail = message || tr('terminal:broadcast.status_message', {count: keys.length, defaultValue: `${keys.length} 个终端 · 可在任意选中终端输入`});
  const exit = tr('terminal:broadcast.exit', {defaultValue: '退出终端同步'});
  const status = `${title} · ${detail}`;
  render(h(Fragment, null, [
    settingsIcon('radio'),
    h('div', {class: 'terminal-broadcast-copy', role: 'status', 'aria-live': 'polite', 'aria-label': status, title: status}, [h('strong', title), h('span', detail)]),
    h(TermaButton, {class: 'icon-button terminal-broadcast-exit', title: exit, 'aria-label': exit, onClick: stopTerminalBroadcast}, {default: () => settingsIcon('x')})
  ]), bar);
  document.body.classList.add('terminal-broadcast-active');
}

export function installTerminalBroadcastWorkspace() {
  const state = efficiencyServices.termaTerminalBroadcast;
  if (!state) return;
  const socketFor = (key: string) => terminalSessions.get(key)?.socket;
  const writable = (socket: WebSocket | null | undefined): socket is WebSocket => socket?.readyState === WebSocket.OPEN;
  const send = (key: string, payload: unknown) => {
    const socket = socketFor(key);
    if (writable(socket)) socket.send(payload as Parameters<WebSocket['send']>[0]);
  };
  const input = createTerminalBroadcastInputService({
    targets: terminalBroadcastKeys,
    isTarget: state.isTarget,
    sensitive: key => terminalSessions.get(key)?.sensitiveInput === true,
    send,
    sendAll: (keys, payload) => keys.forEach(key => send(key, payload)),
    captureTargets(keys) {
      const targetSet = state.state.targets;
      const leased = keys.map(key => {
        const socket = socketFor(key);
        return {key, socket, writable: writable(socket)};
      });
      return () => state.state.targets === targetSet &&
        leased.every(item => socketFor(item.key) === item.socket && writable(item.socket) === item.writable);
    },
    dangerous: value => batchServices.termaBatch.dangerous(value),
    paused: () => state.state.paused,
    setPaused: state.setPaused
  });
  function handle(sourceKey: string, outgoing: unknown, raw: string) {
    const result = input.handle(sourceKey, outgoing, raw);
    if (!result.handled) {
      if (result.stop) stopTerminalBroadcast();
      return false;
    }
    if (result.pause) repaintTerminalBroadcast(tr('terminal:broadcast.paused_hidden_input'));
    if (result.resume) repaintTerminalBroadcast();
    if (result.confirm) {
      void confirmModal(tr('terminal:broadcast.confirm_message', {count: result.keys.length, value: result.raw}),
        tr('terminal:broadcast.confirm_title'), tr('terminal:broadcast.send'), tr('common:actions.cancel'), true).then(accepted => {
        if (accepted && !result.commit()) notify(tr('terminal:session.target_changed'), 'info');
        focusTerminalSession(result.source);
      });
    }
    return true;
  }
  sessionEfficiencyServices.termaTerminalBroadcastWorkspace = {handle, keys: terminalBroadcastKeys, stop: stopTerminalBroadcast, paint: repaintTerminalBroadcast, renderTabsPreservingFocus: renderTabsPreservingTerminalFocus};
}



export interface InstalledFeaturesSessionEfficiencyTerminalBroadcastWorkspaceServices {
  termaTerminalBroadcastWorkspace?: {
      handle(sourceKey: string, outgoing: unknown, raw: string): boolean;
      keys: typeof terminalBroadcastKeys;
      stop: typeof stopTerminalBroadcast;
      paint: typeof repaintTerminalBroadcast;
      renderTabsPreservingFocus: typeof renderTabsPreservingTerminalFocus;
    };
}
