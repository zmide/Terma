import type { createVncClipboardModel } from './vnc-clipboard-model';
import type { VncSession } from './vnc-types';

export function createVncClipboardToolbar(model: ReturnType<typeof createVncClipboardModel>, document: Document,
  active: (workspace: HTMLElement, key: string) => boolean) {
  const timers = new WeakMap<VncSession, ReturnType<typeof setTimeout>>();

  function controls(session: VncSession) {
    const workspace = session.workspace?.isConnected ? session.workspace
      : Array.from(document.querySelectorAll<HTMLElement>('.vnc-workspace')).find(node => node.dataset.vncKey === session.key);
    if (!workspace) return;
    session.workspace = workspace;
    const state = model.presentation(session);
    const status = workspace.querySelector<HTMLElement>('#vncClipboardStatus');
    const button = (suffix: string) => workspace.querySelector<HTMLButtonElement>(`[data-vnc-clipboard-${suffix}]`);
    const label = (node: HTMLElement, text: string) => {
      node.title = text;
      node.setAttribute('aria-label', text);
    };
    if (status) {
      status.textContent = state.status;
      status.className = `vnc-clipboard-status clickable${state.state ? ` ${state.state}` : ''}`;
      label(status, state.hint);
    }
    const sync = button('sync');
    if (sync) {
      sync.classList.toggle('active', state.sync);
      sync.setAttribute('aria-pressed', String(state.sync));
      label(sync, state.syncLabel);
    }
    const helper = button('helper');
    if (helper) {
      helper.classList.toggle('active', state.helper);
      helper.classList.toggle('attention', Boolean(state.problem));
      label(helper, state.helperLabel);
    }
    const receive = button('receive');
    if (receive) {
      receive.disabled = !state.receive;
      receive.classList.toggle('attention', state.receivePending);
      label(receive, state.receiveLabel);
    }
    for (const [suffix, title] of [['send-image', state.sendImageLabel], ['receive-image', state.receiveImageLabel]] as const) {
      const image = button(suffix);
      if (!image) continue;
      image.disabled = !state.images;
      image.classList.toggle('attention', Boolean(state.problem));
      label(image, title);
    }
  }

  function release(session: VncSession) {
    clearTimeout(timers.get(session));
    timers.delete(session);
  }

  function status(session: VncSession, text = '', state = '', duration = 0) {
    release(session);
    session.clipboardStatusText = text;
    session.clipboardStatusState = state;
    controls(session);
    if (duration > 0) timers.set(session, setTimeout(() => status(session), duration));
  }

  function visible(session: VncSession) {
    return document.visibilityState !== 'hidden' && document.hasFocus()
      && session.viewport?.isConnected !== false && !session.viewport?.closest('[hidden]');
  }

  function focus(session: VncSession) {
    if (!session.workspace?.isConnected || !session.viewport?.isConnected || !active(session.workspace, session.key)) return false;
    try {
      session.rfb?.focus?.({preventScroll: true});
      return true;
    } catch {
      return false;
    }
  }

  return { controls, status, release, visible, focus };
}
