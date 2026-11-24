import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { quickX11PanelHost } from '@/features/quick/quick-host';
import { renderSshX11ForwardingPanel } from '@/features/quick/quick-views';
import type { ManagementAction } from './RemoteManagementView';

export interface LinuxDesktopOptions {
  title: string; subtitle: string; selected: number; loading: boolean; connectionLabel: string;
  connections: { value: number; label: string }[]; detectLabel: string;
  select(value: string): void; detect(): void;
  diagnostic?: { title: string; detail: string; status: string; ready: boolean };
  summary: [string, string, string][];
  cards: { id: string; label: string; icon: string; status: string; installed: boolean; badges: { kind: string; label: string; title: string }[]; action: ManagementAction }[];
  x11?: { connection: unknown; diagnostics: unknown };
  hint: string; empty: string; error: string; repair?: ManagementAction; task: boolean;
}
export interface LinuxTaskOptions { title: string; detail: string; progress: number; label: string; taskId: string; expanded: boolean; logs: string; toggle(): void }
const action = (a: ManagementAction) => h(TermaButton, { type: 'button', class: a.className, disabled: a.disabled, 'data-management-action': a.id, 'data-ui-action-key': a.actionKey, onClick: (event: MouseEvent) => a.run(event.currentTarget as HTMLElement) }, () => [icon(a.icon || 'package-plus'), h('span', null, a.label)]);

export function renderLinuxDesktop(target: HTMLElement, m: LinuxDesktopOptions) {
  render(h('div', { class: 'linux-desktop-manager remote-desktop-launch', 'data-linux-desktop-owned': '' }, [
    h('div', { class: 'remote-desktop-icon', 'aria-hidden': 'true' }, [icon('monitor-cog')]), h('h2', null, m.title), h('div', { class: 'muted' }, m.subtitle),
    h('div', { class: 'linux-desktop-manager-toolbar' }, [h('label', { for: 'linuxDesktopConnection' }, [m.connectionLabel, h('select', { id: 'linuxDesktopConnection', value: String(m.selected), disabled: m.loading, onChange: (event: Event) => m.select((event.currentTarget as HTMLSelectElement).value) }, m.connections.map(item => h('option', { key: item.value, value: String(item.value) }, item.label)))]), h(TermaButton, { type: 'button', disabled: !m.selected || m.loading, 'data-linux-detect': '', onClick: m.detect }, () => [icon(m.loading ? 'loader-circle' : 'refresh-cw'), h('span', null, m.detectLabel)])]),
    m.diagnostic ? h('div', { class: ['linux-desktop-diagnostics', m.diagnostic.ready ? 'ready' : 'warning'] }, [h('div', null, [h('strong', null, m.diagnostic.title), h('span', null, m.diagnostic.detail)]), h('span', { class: 'status-pill' }, m.diagnostic.status)]) : h('div', { class: ['connection-test-status', m.error ? 'error' : m.loading ? 'busy remote-probe-loading' : ''], role: m.error ? 'alert' : 'status' }, [m.loading ? icon('loader-circle') : null, h('span', null, m.error || m.empty), m.repair ? action(m.repair) : null]),
    m.summary.length ? h('div', { class: 'linux-desktop-selection-summary' }, m.summary.map(([symbol, label, value]) => h('div', { key: label }, [h('span', null, [icon(symbol), label]), h('strong', null, value)]))) : null,
    m.cards.length ? h('div', { class: 'linux-desktop-grid' }, m.cards.map(card => h('article', { key: card.id, 'data-desktop-id': card.id, class: ['linux-desktop-card', card.installed ? 'installed' : ''] }, [h('div', { class: 'linux-desktop-card-icon' }, [icon(card.icon)]), h('div', null, [h('strong', null, card.label), h('span', null, card.status), card.badges.length ? h('div', { class: 'linux-desktop-usage-badges' }, card.badges.map(badge => h('span', { key: badge.label, class: `linux-desktop-usage-badge ${badge.kind}`, title: badge.title }, badge.label))) : null]), action(card.action)]))) : null,
    m.x11 ? renderSshX11ForwardingPanel(quickX11PanelHost, m.x11.connection, m.x11.diagnostics, 'linux-desktop') : null,
    m.diagnostic ? h('div', { class: 'linux-desktop-hint' }, m.hint) : null,
    m.task ? h('div', { id: 'linuxDesktopInstallTask', class: 'linux-desktop-install-task' }) : null
  ]), target);
}

export function renderLinuxTask(target: HTMLElement, m: LinuxTaskOptions) {
  render(h('div', { 'data-linux-task-owned': '' }, [h('div', { class: 'linux-desktop-task-head' }, [h('div', null, [h('strong', null, m.title), h('span', null, m.detail)]), h(TermaButton, { type: 'button', class: 'icon-button', title: m.label, 'aria-label': m.label, onClick: m.toggle }, () => icon('scroll-text'))]), h('div', { class: 'linux-desktop-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': m.progress }, [h('i', { style: { width: `${m.progress}%` } })]), h('pre', { id: 'linuxDesktopTaskLog', 'data-task-id': m.taskId, class: ['linux-desktop-task-log', m.expanded ? 'expanded' : ''] }, m.logs)]), target);
}
