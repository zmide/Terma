export interface FileNavigationPort {
  tab(key: string): { kind: string } | undefined;
  navigate(kind: 'sftp' | 'local-files', direction: number, key: string): unknown;
  error(error: unknown): void;
}

/** Each tab owns at most one mouse-history request, including adapters without abort. */
export function createFileNavigation(port: FileNavigationPort) {
  const requests = new Map<string, Promise<unknown>>();
  function context(event: MouseEvent): {tabKey: string; kind: 'sftp' | 'local-files'; direction: number} | null {
    if (![3, 4].includes(event.button) || event.defaultPrevented || !document.getElementById('modal')?.hidden) return null;
    if (!(event.target instanceof Element) || event.target.closest('.sftp-editor-floating-root, .modal, [role="dialog"]')) return null;
    const owner = event.target.closest<HTMLElement>('.sftp-shell[data-sftp-tab-key], .sftp-toolbar[data-workspace-tab-key], .local-files-shell[data-tab-key]');
    const key = owner?.dataset.sftpTabKey || owner?.dataset.workspaceTabKey || owner?.dataset.tabKey;
    if (!key) return null;
    const kind = port.tab(key)?.kind;
    return kind === 'sftp' || kind === 'local-files' ? { tabKey: key, kind, direction: event.button === 3 ? -1 : 1 } : null;
  }
  function handle(event: MouseEvent) {
    const target = context(event);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    if (event.type !== 'mouseup' || requests.has(target.tabKey)) return;
    const request = Promise.resolve().then(() => port.navigate(target.kind, target.direction, target.tabKey))
      .catch(port.error).finally(() => requests.delete(target.tabKey));
    requests.set(target.tabKey, request);
  }
  const events = ['mousedown', 'mouseup', 'auxclick'] as const;
  return {
    context, handle,
    bind() { events.forEach(type => document.addEventListener(type, handle, true)); },
    dispose() { events.forEach(type => document.removeEventListener(type, handle, true)); }
  };
}

export function installFileNavigation(port: FileNavigationPort) {
  const navigation = createFileNavigation(port);
  navigation.bind();
  window.addEventListener('beforeunload', () => navigation.dispose(), {once:true});
}
