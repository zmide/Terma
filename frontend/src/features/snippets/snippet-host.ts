import {quickServices} from '@/features/quick/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import { downloadBlob } from '@/shared/ui/browser-download';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import type { ManagementConnection } from '../remote/management-types';
import type { SnippetPort, Target } from './snippet-service';

type Connection = ManagementConnection & {identity_file?: string; updated_at?: number | string};
type Session = {id?: number; connection?: Connection; connected?: boolean; connectionRevision?: number; quickToken?: string};
type SnippetKind = Parameters<SnippetPort['navigate']>[0];
type OpenSnippet = (kind: SnippetKind, id?: number, options?: Record<string, unknown>) => void;

function targetStamp(connection: Connection | null | undefined) {
  return JSON.stringify([connection?.id, connection?.ssh_host, connection?.ssh_port, connection?.ssh_user,
    connection?.auth_type, connection?.identity_file, connection?.updated_at, connection?.has_password]);
}

function terminalTargets(): Target[] {
  return applicationState.tabs.filter(tab => tab.kind === 'terminal').map(tab => {
    const session = terminalSessions.get(tab.key);
    const connection = session?.connection || currentConnection(session?.id);
    const stamp = targetStamp(connection), revision = session?.connectionRevision, token = session?.quickToken;
    return {
      kind: 'terminal', key: tab.key, id: Number(connection?.id || 0), name: tab.title || '', active: tab.key === applicationState.activeTabKey,
      connection: {ssh_host: connection?.ssh_host, ssh_user: connection?.ssh_user},
      current() {
        return Boolean(session?.connected && applicationState.tabs.includes(tab) && terminalSessions.get(tab.key) === session
          && session.connectionRevision === revision && session.quickToken === token
          && targetStamp(session.connection || currentConnection(session.id)) === stamp);
      }
    };
  });
}

function savedTargets(): Target[] {
  return applicationState.connections.map(connection => {
    const id = Number(connection.id), stamp = targetStamp(connection);
    return {
      kind: 'connection', key: `connection-${id}`, id, name: connection.name || '', active: false,
      connection: {ssh_host: connection.ssh_host, ssh_user: connection.ssh_user},
      current: () => targetStamp(currentConnection(id)) === stamp
    };
  });
}

function pickSnippetFile(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    document.body.append(input);
    const finish = (value: string | null) => { input.remove(); resolve(value); };
    input.addEventListener('cancel', () => finish(null), {once: true});
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      if (file.size > 5 * 1024 * 1024) return finish('!');
      try { finish(await file.text()); } catch { finish('!'); }
    }, {once: true});
    input.click();
  });
}

export function createSnippetHost(open: OpenSnippet, hasSnippet: (id: number) => boolean): SnippetPort & {beforeOpen(): void} {
  function navigate(kind: SnippetKind, id = 0, options: Record<string, unknown> = {}) {
    const snippetId = Number(id);
    if (kind === 'execute' && !hasSnippet(snippetId)) return;
    const route = kind === 'manager' ? 'snippet-manager' : `snippet-${kind === 'editor' ? 'edit' : 'execute'}-${snippetId}`;
    const show = () => open(kind, snippetId, options);
    if (quickServices.termaCommandNavigation) return quickServices.termaCommandNavigation.page(route, show);
    show();
  }
  return {
    tr: (key, values) => tr(key, values),
    api: (path, options) => api(path, options),
    seed: () => [],
    publish: () => efficiencyServices.termaEfficiency.quick.refresh(),
    unlocked: () => requireConfigEncryptionUnlocked(tr('terminal:snippets.title')),
    scope: () => quickServices.termaCommandNavigation?.active() ? quickServices.termaCommandNavigation.guard() : () => true,
    beforeOpen: () => closeModal(),
    close: () => closeModal(),
    navigate,
    targets: () => [...terminalTargets(), ...savedTargets()],
    send: (key, text) => { sendTerminalData(key, text); },
    dangerous: command => batchServices.termaBatch.dangerous(command),
    notify: (message, kind) => notify(message, kind),
    export: payload => downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), 'terma-command-snippets.json'),
    pick: pickSnippetFile
  };
}
