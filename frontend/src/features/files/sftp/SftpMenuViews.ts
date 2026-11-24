import {filesServices} from '@/features/files/installed-services';
import {tr as translateWorkspace} from '@/shared/i18n/workspace-bootstrap';
import { h, render, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import '@/styles/sftp.css';

export interface SftpMenuAction {
  label: string;
  icon?: string;
  danger?: boolean;
  separator?: boolean;
  run?: () => unknown;
  children?: SftpMenuAction[];
}

export type SftpMenuEvent = { clientX?: number; clientY?: number; target?: EventTarget | null; currentTarget?: EventTarget | null; preventDefault?: () => void; stopPropagation?: () => void };
type MenuOwner = { host: HTMLElement; backdrop?: HTMLButtonElement; actions: () => SftpMenuAction[]; x: number; y: number; open: string | null; cleanup: () => void };
let current: MenuOwner | null = null;

function tr(key: string, fallback: string) {
  const value = translateWorkspace(`sftp:${key}`, { defaultValue: fallback });
  return typeof value === 'string' ? value : fallback;
}

function close() {
  const owner = current;
  if (!owner) return;
  current = null;
  owner.cleanup();
  if (owner.backdrop) owner.backdrop.remove();
  render(null, owner.host);
  owner.host.remove();
}

function actionView(owner: MenuOwner, actions: SftpMenuAction[], depth = 0, path: number[] = []): VNodeChild[] {
  const output: VNodeChild[] = [];
  actions.forEach((action, index) => {
    if (action.separator) {
      output.push(h('div', { key: `separator-${depth}-${index}`, class: 'menu-separator', role: 'separator' }));
      return;
    }
    const hasChildren = Array.isArray(action.children) && action.children.length > 0;
    const actionPath = [...path, index];
    const actionKey = actionPath.join('.');
    const isOpen = hasChildren && owner.open === actionKey;
    const children = isOpen ? h('div', { class: 'sftp-vue-menu-submenu', role: 'menu' }, actionView(owner, action.children!, depth + 1, actionPath)) : null;
    output.push(h('div', { key: `action-${actionKey}`, class: ['sftp-vue-menu-entry', isOpen ? 'is-open' : ''] }, [
      h('button', {
        type: 'button', class: [action.danger ? 'danger' : '', hasChildren ? 'has-submenu' : ''], role: 'menuitem', 'data-menu-path': actionKey,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          if (hasChildren) { owner.open = isOpen ? null : actionKey; paint(owner); return; }
          close(); void action.run?.();
        }
      }, [action.icon ? settingsIcon(action.icon) : null, h('span', null, action.label), hasChildren ? settingsIcon('chevron-right') : null]),
      children
    ]));
  });
  return output;
}

function paint(owner: MenuOwner) {
  const focusedPath = owner.host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.menuPath : undefined;
  owner.host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  owner.host.setAttribute('aria-label', tr('menu.actions', 'SFTP 操作'));
  render(h('div', { class: 'sftp-vue-menu-panel', role: 'menu' }, actionView(owner, owner.actions())), owner.host);
  if (focusedPath) requestAnimationFrame(() => owner.host.querySelector<HTMLElement>(`[data-menu-path="${focusedPath}"]`)?.focus({ preventScroll: true }));
}

function position(owner: MenuOwner) {
  const rect = owner.host.getBoundingClientRect();
  const left = Math.max(8, Math.min(owner.x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(owner.y, window.innerHeight - rect.height - 8));
  owner.host.style.left = `${left}px`;
  owner.host.style.top = `${top}px`;
}

export function installSftpMenuViews() {
  filesServices.termaSftpMenus = {
    show(event, actions) {
      event.preventDefault?.(); event.stopPropagation?.(); close();
      const mobile = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;
      const host = document.createElement('div');
      host.id = 'actionMenu'; host.className = `context-menu action-menu sftp-vue-menu-root${mobile ? ' mobile-action-menu' : ''}`;
      host.setAttribute('data-i18n-skip', ''); host.setAttribute('aria-label', 'SFTP actions');
      const backdrop = mobile ? document.createElement('button') : undefined;
      if (backdrop) {
        backdrop.id = 'actionMenuBackdrop'; backdrop.type = 'button'; backdrop.className = 'action-menu-backdrop';
        backdrop.setAttribute('aria-label', tr('menu.close_menu', '关闭菜单')); backdrop.onclick = close; document.body.appendChild(backdrop);
      }
      document.body.appendChild(host);
      const rect = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
      const owner: MenuOwner = { host, backdrop, actions: typeof actions === 'function' ? actions : () => actions, x: Number(event.clientX || rect?.right || 8), y: Number(event.clientY || rect?.bottom || 8), open: null, cleanup: () => {} };
      current = owner;
      const keydown = (value: KeyboardEvent) => { if (value.key === 'Escape') { value.preventDefault(); close(); } };
      const pointerdown = (value: PointerEvent) => { if (current === owner && !host.contains(value.target as Node) && value.target !== backdrop) close(); };
      const language = () => {
        if (current !== owner) return;
        if (owner.backdrop) owner.backdrop.setAttribute('aria-label', tr('menu.close_menu', '关闭菜单'));
        paint(owner);
      };
      document.addEventListener('keydown', keydown, true);
      document.addEventListener('pointerdown', pointerdown, true);
      window.addEventListener('terma:language-changed', language);
      owner.cleanup = () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', pointerdown, true); window.removeEventListener('terma:language-changed', language); };
      paint(owner);
      requestAnimationFrame(() => { if (current !== owner) return; if (!mobile) position(owner); });
    },
    release: close
  };
}



export interface InstalledFeaturesFilesSftpSftpMenuViewsServices {
  termaSftpMenus?: { show(event: SftpMenuEvent, actions: SftpMenuAction[] | (() => SftpMenuAction[])): void; release(): void };
}
