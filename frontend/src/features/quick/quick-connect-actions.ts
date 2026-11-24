import type { QuickConnectSearchService } from './quick-connect-search-service';
import type { QuickConnectionSearchForward } from './quick-port';
import type { QuickSshService, createQuickSshFlow } from './quick-ssh-service';
import type { EventRegistry } from '@/shared/actions/event-registry';

type ConnectionAction = 'edit' | 'terminal' | 'sftp';

type QuickConnectActionPort = {
  close: () => void;
  connection: (action: ConnectionAction, id: number) => unknown;
  openForwards: (id: number, forwardId: number) => void;
  findForward: (id: number) => QuickConnectionSearchForward | null | undefined;
  isActive: (forward: QuickConnectionSearchForward) => boolean;
  forwardMissing: () => unknown;
  command: (kind: 'start' | 'stop', id: number, button: HTMLElement) => unknown;
  refresh: () => void;
  direct: (query: string) => unknown;
};

function actionId(value: string | number | undefined) {
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : 0;
}

export function createQuickConnectActions(port: QuickConnectActionPort, search: QuickConnectSearchService) {
  function connection(action: ConnectionAction, value: string | number | undefined) {
    const id = actionId(value);
    if (!id) return;
    port.close();
    port.connection(action, id);
  }

  function openForward(connectionValue: string | number | undefined, forwardValue: string | number | undefined) {
    const connectionId = actionId(connectionValue);
    const forwardId = actionId(forwardValue);
    if (!connectionId || !forwardId) return;
    port.close();
    port.openForwards(connectionId, forwardId);
  }

  function submit(query: string) {
    const saved = search.connectionRows(query)[0];
    if (saved) return connection('terminal', saved.id);
    const row = search.forwardRows(query)[0];
    if (row) return openForward(row.connection.id, row.forward.id);
    return port.direct(query);
  }

  async function toggle(button: HTMLElement) {
    const id = actionId(button.dataset.forwardId);
    if (!id) return;
    const forward = port.findForward(id);
    if (!forward) return port.forwardMissing();
    await port.command(port.isActive(forward) ? 'stop' : 'start', id, button);
    port.refresh();
  }

  return { connection, openForward, submit, toggle };
}

export function registerQuickConnectActions(registry: EventRegistry, actions: ReturnType<typeof createQuickConnectActions>,
  ssh: QuickSshService, flow: ReturnType<typeof createQuickSshFlow>, view: {
    openLauncher(): void;
    closeLauncher(): void;
    closeAuth(): void;
    syncAuth(): void;
    openAuth: Parameters<typeof createQuickSshFlow>[2]['openAuth'];
    schedule(query: string): void;
  }) {
  const searchField = () => document.querySelector<HTMLInputElement>('#quickConnectionSearch')?.value || '';
  registry.register('quick-ssh-close', () => view.closeAuth());
  registry.register('quick-ssh-auth-type', () => view.syncAuth());
  registry.register('quick-ssh-submit', ({event, element}) => {
    event.preventDefault();
    if (!(element instanceof HTMLFormElement)) return;
    const trigger = (event as SubmitEvent).submitter || document.getElementById('quickSshConnect');
    return flow.submit(element, trigger instanceof HTMLElement ? trigger : null);
  });
  registry.register('quick-ssh-new', ({element}) => flow.prefill(flow.formTarget(element.closest('form'))));
  registry.register('quick-connect-open', () => view.openLauncher());
  registry.register('quick-connect-close', () => view.closeLauncher());
  registry.register('quick-connect-search', ({element}) => {
    if (element instanceof HTMLInputElement) view.schedule(element.value);
  });
  registry.register('quick-connect-keydown', ({event, element}) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Enter' || !(element instanceof HTMLInputElement)) return;
    event.preventDefault();
    return actions.submit(element.value);
  });
  for (const kind of ['edit', 'terminal', 'sftp'] as const) {
    registry.register(`quick-connect-${kind}`, ({event, dataset}) => {
      event.stopPropagation();
      return actions.connection(kind, dataset.connectionId);
    });
  }
  registry.register('quick-connect-forward', ({event, dataset}) => {
    event.stopPropagation();
    return actions.openForward(dataset.connectionId, dataset.forwardId);
  });
  registry.register('quick-forward-toggle', ({event, element}) => {
    event.stopPropagation();
    if (element instanceof HTMLElement) return actions.toggle(element);
  });
  registry.register('quick-connect-direct', ({event}) => {
    event.stopPropagation();
    const target = ssh.parse(searchField());
    if (target) return view.openAuth(target);
  });
  registry.register('quick-connect-new', ({event}) => {
    event.stopPropagation();
    const target = ssh.parse(searchField());
    if (target) return flow.prefill(target);
  });
}



export interface InstalledFeaturesQuickQuickConnectActionsServices {
  termaQuickConnectActions?: ReturnType<typeof createQuickConnectActions>;
}
