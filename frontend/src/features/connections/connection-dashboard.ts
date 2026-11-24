import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {$} from '@/shared/workspace-dom';
import {openTerminal} from '@/features/terminal/terminal-page';
import {sshAuthenticationFailure} from '@/features/connections/connection-credential-model';
import { setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import { workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { captureWorkspaceTab } from '@/features/workspace/workspace-pane-scope';
import {h, render} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {errorMessage} from '../operations/operations-types';
import type {ConnectionHealthActionOptions} from './connection-health-actions-service';

type Connection = {id: number; name?: string; ssh_user?: string; ssh_host?: string; ssh_port?: number};
type Tab = {key: string; kind?: string};
type InPane = <T>(action: () => T) => T | undefined;
type Inspection = {ok: boolean; output: string};
type State = {connection: Connection; pending?: Promise<void>; result?: Inspection; error?: string; authFailed?: boolean};


const pages = new WeakMap<Tab, State>();
const sections = {system: 'system', os: 'os', uptime: 'uptime', memory: 'memory', disk: 'disk', ports: 'listening_ports'};
const label = (key: string, options?: Record<string, unknown>) => tr(`connections:health.${key}`, options);
const title = ({name, id}: Connection) => label('dashboard_title', {name: name || id});

function parseSections(output: string) {
  const blocks = new Map<string, string[]>();
  let lines: string[] | undefined;
  for (const line of output.split(/\r?\n/)) {
    const chapter = /^##\s+(.+)$/.exec(line);
    if (chapter) {
      const key = chapter[1].trim();
      lines = Object.hasOwn(sections, key) ? [] : undefined;
      if (lines) blocks.set(key, lines);
    } else lines?.push(line);
  }
  return blocks;
}

function target(tab: Tab): InPane {
  const inPane = captureWorkspaceTab(tab.key);
  return action => workspaceTabByKey(tab.key) === tab ? inPane(action) : undefined;
}

function paint(tab: Tab, state: State) {
  const into = target(tab);
  into(() => {
    const root = $('view-dashboard');
    if (!root || root.hidden) return;
    const connection = state.connection;
    const pending = Boolean(state.pending);
    const actions = [
      h(TermaButton, {'data-dashboard-action': 'refresh', disabled: pending, onClick: () => into(() => inspect(tab, state))}, () => label('refresh_inspection')),
      h(TermaButton, {'data-dashboard-action': 'terminal', onClick: () => into(() => openTerminal(connection.id))}, () => label('open_terminal'))
    ];
    const blocks = state.result && parseSections(String(state.result.output || ''));
    const cards = pending || (!blocks && !state.error)
      ? [h('div', {class: 'dashboard-card', role: 'status'}, [h('strong', label('inspecting')), h('span', label('inspecting_hint'))])]
      : state.error ? [h('div', {class: 'dashboard-card bad', role: 'alert'}, [
        h('strong', label('inspection_failed')), h('span', state.error),
        state.authFailed && h(TermaButton, {'data-dashboard-action': 'repair', onClick: () => repair(tab, state)}, () => label('repair_credentials'))
      ])] : Object.entries(sections).map(([key, resource]) => h('div', {key, class: ['dashboard-card', {bad: !state.result?.ok}]}, [
        h('strong', label(resource)), h('pre', blocks?.get(key)?.join('\n').trim() || label('no_data'))
      ]));
    render(h('div', {class: 'panel', 'data-i18n-skip': ''}, [
      h('div', {class: 'workspace-head'}, [
        h('div', [h('h2', title(connection)), h('div', {class: 'subtitle'}, `${connection.ssh_user || ''}@${connection.ssh_host || ''}:${connection.ssh_port || 22}`)]),
        h('div', {class: 'actions'}, actions)
      ]), h('div', {class: 'dashboard-grid', 'aria-busy': String(pending)}, cards)
    ]), root);
  });
}

function repair(tab: Tab, state: State) {
  const into = target(tab);
  const options: ConnectionHealthActionOptions = {onSaved: () => into(() => inspect(tab, state, true))};
  return into(() => connectionsServices.termaConnectionHealthActions?.repairDashboardCredentials(state.connection.id, options));
}

function inspect(tab: Tab, state: State, skipRepair = false): Promise<void> {
  if (state.pending) return state.pending;
  state.error = undefined;
  state.authFailed = false;
  let shouldRepair = false;
  state.pending = Promise.resolve().then(async () => {
    try {
      state.result = await api<Inspection>(`/api/connections/${state.connection.id}/inspect`, {method: 'POST'});
    } catch (error) {
      state.result = undefined;
      state.error = errorMessage(error, label('inspection_failed'));
      state.authFailed = sshAuthenticationFailure(error);
      shouldRepair = state.authFailed && !skipRepair;
    } finally {
      state.pending = undefined;
      paint(tab, state);
    }
    if (shouldRepair) await repair(tab, state);
  });
  paint(tab, state);
  return state.pending;
}

export function openConnectionDashboard(id: number | undefined, updateTab = true) {
  if (!id || !Number.isSafeInteger(id) || id < 1) return;
  const connection = connectionsServices.termaConnectionController?.select(id, {render: updateTab, reveal: updateTab}) as Connection | undefined;
  if (!connection) return;
  const key = `dashboard-${id}`;
  setWorkspace(title(connection), label('inspection_subtitle'), 'dashboard', key, updateTab, true, {kind: 'dashboard', id});
  const tab = workspaceTabByKey(key);
  if (tab?.kind !== 'dashboard') return;
  const existing = pages.get(tab);
  const state = existing ?? {connection};
  state.connection = connection;
  pages.set(tab, state);
  if (!existing || updateTab) return inspect(tab, state);
  paint(tab, state);
  return state.pending;
}

export function localizeConnectionDashboard(tab: Tab & {title?: string; subtitle?: string}) {
  const state = pages.get(tab);
  if (!state) return;
  tab.title = title(state.connection);
  tab.subtitle = label('inspection_subtitle');
  paint(tab, state);
}
