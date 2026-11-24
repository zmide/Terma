import {x11Services} from '@/features/x11/installed-services';
import { h } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { paintQuickView, quickIcon } from './quick-mount';
import type { QuickViewHost } from './quick-port';

export interface QuickHeaderPort extends Pick<QuickViewHost, 'tr'> {
  openQuickPanel: () => void;
  openSftpAutomationManager: () => void;
  openTerminalSessionManager: () => void;
}
let diagnostics: Record<string, any> | null = null;
let failed = false;
export function renderQuickHeader(scope: QuickHeaderPort, snapshot?: Record<string, any> | null, error = false) {
  if (snapshot !== undefined) { diagnostics = snapshot; failed = error; }
  const host = document.getElementById('workspaceQuickActions'); if (!host) return;
  const t = scope.tr, data = diagnostics;
  const unauthorized = data?.authorization_required;
  const status = data?.available && !unauthorized ? 'ready' : data?.running || unauthorized ? 'warning' : 'error';
  const label = failed ? t('remote:xserver.unavailable') : !data ? t('remote:xserver.quick_status') : unauthorized ? t(data.available || data.running ? 'remote:xserver.running_unauthorized' : 'remote:xserver.browser_unauthorized') : t(data.available ? 'remote:xserver.ready' : data.running ? 'remote:xserver.running' : 'remote:xserver.stopped');
  const title = [label, data?.display, data?.authorization_kind === 'local-direct' ? t('remote:xserver.local_direct_authorized') : '', unauthorized ? t('remote:xserver.request_authorization') : ''].filter(Boolean).join(' · ');
  const control = (id: string, name: string, icon: string, action: () => void, cls: string, tooltip = name) => h(TermaButton, { id, class: `icon-button ${cls}`, title: tooltip, 'aria-label': name, onClick: () => action() }, { default: () => icon === 'xserver' ? [h('svg', { class: 'xserver-x-icon', 'aria-hidden': 'true', focusable: 'false', viewBox: '0 0 24 24' }, [h('ellipse', { cx: '12', cy: '12', rx: '8.8', ry: '5.2', transform: 'rotate(-10 12 12)' }), h('path', { d: 'M7.5 5.5 16.5 18.5M16.5 5.5 7.5 18.5' })])] : [quickIcon(icon)] });
  paintQuickView(host, [control('quickPanelButton', t('common:auto.command_window'), 'zap', scope.openQuickPanel, 'quick-panel-button', t('common:auto.command_window_shortcut', { shortcut: 'Ctrl+K' })), control('sftpAutomationQuickButton', t('sftp:automation.open'), 'folder-sync', scope.openSftpAutomationManager, 'sftp-automation-quick-button'), control('terminalSessionManagerButton', t('terminal:session.manager.open_button'), 'history', scope.openTerminalSessionManager, 'terminal-session-manager-quick-button'), control('xServerQuickButton', title, 'xserver', () => x11Services.termaX11.openManager(), `xserver-quick-button ${status}`)]);
}
