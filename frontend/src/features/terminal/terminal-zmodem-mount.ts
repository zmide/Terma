import {terminalServices} from '@/features/terminal/installed-services';
import { h, reactive, render } from 'vue';
import { TerminalZmodemView, type TerminalZmodemViewModel } from './TerminalZmodemView';

type ZmodemSession = { panel?: HTMLElement | null };
type ZmodemMount = { target: HTMLElement; model: TerminalZmodemViewModel };



const mounts = new WeakMap<object, ZmodemMount>();

function syncTheme(target: HTMLElement) {
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function renderZmodem(session: ZmodemSession, view: TerminalZmodemViewModel) {
  const target = session.panel;
  if (!target) return false;
  const existing = mounts.get(session as object);
  if (!existing || existing.target !== target) {
    if (existing) render(null, existing.target);
    target.classList.add('terma-vue-root', 'terma-zmodem-root');
    target.setAttribute('data-i18n-skip', '');
    syncTheme(target);
    const model = reactive({ ...view });
    const entry = { target, model };
    mounts.set(session as object, entry);
    render(h(TerminalZmodemView, { view: model }), target);
  } else {
    for (const key of Object.keys(existing.model)) delete existing.model[key as keyof TerminalZmodemViewModel];
    Object.assign(existing.model, view);
    syncTheme(target);
  }
  target.hidden = Boolean(view.hidden);
  return true;
}

function releaseZmodem(session: ZmodemSession) {
  const entry = mounts.get(session as object);
  if (!entry) return;
  render(null, entry.target);
  entry.target.classList.remove('terma-vue-root', 'terma-zmodem-root');
  entry.target.removeAttribute('data-i18n-skip');
  delete entry.target.dataset.theme;
  mounts.delete(session as object);
}

export function installTerminalZmodemView() {
  terminalServices.termaTerminalZmodemView = { render: renderZmodem, release: releaseZmodem };
  window.addEventListener('terma:language-changed', () => {
    document.querySelectorAll<HTMLElement>('.terminal-zmodem-panel').forEach(target => {
      const session = (target as HTMLElement & { __termaZmodemSession?: ZmodemSession }).__termaZmodemSession;
      const view = (session as ZmodemSession & { zmodemState?: { view?: TerminalZmodemViewModel } })?.zmodemState?.view;
      if (session && view) renderZmodem(session, view);
    });
  });
}

export interface InstalledFeaturesTerminalTerminalZmodemMountServices {
  termaTerminalZmodemView?: {
      render: (session: ZmodemSession, view: TerminalZmodemViewModel) => boolean;
      release: (session: ZmodemSession) => void;
    };
}
