import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { managementContent, type ManagementModel } from './RemoteManagementView';

export type ClipboardResult = number | { installing: true } | null;
export interface ClipboardHelperOptions {
  model(): { title: string; endpoint: string; close: string; cancel: string; save: string; explanation: string; match: string; matched: boolean; label: string; hint: string; selected: number; connections: { value: number; label: string }[]; diagnostic: ManagementModel };
  select(value: number): void;
  dismissed(): void;
}
export interface ClipboardTextOptions { model(): { title: string; reason: string; label: string; placeholder: string; notice: string; cancel: string; send: string }; value: string }

export function installVncClipboardDialog() {
  const target = document.getElementById('modal');
  type Current = { trigger: HTMLElement | null } & (
    { kind: 'helper'; options: ClipboardHelperOptions; resolve(value: ClipboardResult): void } |
    { kind: 'text'; options: ClipboardTextOptions; resolve(value: string | null): void });
  let current: Current | null = null;
  const release = (value: ClipboardResult | string = null) => {
    if (!target || !current) return;
    const old = current; current = null;
    if (old.kind === 'helper') old.options.dismissed();
    else old.options.value = '';
    render(null, target); target.hidden = true;
    target.classList.remove('terma-vue-root', 'terma-remote-root');
    target.removeAttribute('data-theme'); target.removeAttribute('data-i18n-skip');
    if (old.trigger?.isConnected) old.trigger.focus({ preventScroll: true });
    if (old.kind === 'helper') old.resolve(value as ClipboardResult);
    else old.resolve(value as string | null);
  };
  const paint = () => {
    if (!target || !current) return;
    const owner = current, card = target.querySelector<HTMLElement>('.modal-card'), scroll = card?.scrollTop || 0;
    const focused = target.contains(document.activeElement) ? document.activeElement as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement : null;
    const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const : null;
    const manualOpen = target.querySelector<HTMLDetailsElement>('.remote-install-manual')?.open || false;
    if (owner.kind === 'text') {
      const textarea = target.querySelector<HTMLTextAreaElement>('#vncClipboardManualText');
      if (textarea) owner.options.value = textarea.value;
    }
    const button = (label: string, run: () => void, attrs: Record<string, unknown> = {}) => h(TermaButton, { type: 'button', onClick: run, ...attrs }, () => label);
    const helper = owner.kind === 'helper' ? owner.options.model() : null;
    const text = owner.kind === 'text' ? owner.options.model() : null;
    if (helper?.diagnostic.manual && manualOpen) helper.diagnostic.manual.open = true;
    render(h('form', {
      class: ['modal-card vnc-clipboard-modal', helper ? 'vnc-clipboard-helper-modal' : 'vnc-clipboard-text-modal'],
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vncClipboardDialogTitle',
      onSubmit: (event: Event) => { event.preventDefault(); release(owner.kind === 'helper' ? owner.options.model().selected : owner.options.value); },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); release(); }
        if (event.key !== 'Tab') return;
        const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(node => node.checkVisibility());
        if (event.shiftKey && (document.activeElement === fields[0] || !target.contains(document.activeElement))) { event.preventDefault(); fields.at(-1)?.focus(); }
        else if (!event.shiftKey && (document.activeElement === fields.at(-1) || !target.contains(document.activeElement))) { event.preventDefault(); fields[0]?.focus(); }
      }
    }, [
      h('div', { class: 'modal-title-row' }, [h('div', null, [h('h2', { id: 'vncClipboardDialogTitle' }, helper?.title ?? text?.title ?? ''), helper ? h('span', { class: 'muted' }, helper.endpoint) : null]),
        helper ? h(TermaButton, { class: 'icon-button', type: 'button', title: helper.close, 'aria-label': helper.close, 'data-vnc-clipboard-helper-cancel': '', onClick: () => release() }, () => icon('x')) : null]),
      helper ? h('div', { class: 'connection-test-status' }, helper.explanation) : null,
      helper ? h('div', { class: ['connection-test-status', helper.matched ? 'success' : 'warning'] }, helper.match) : null,
      helper ? h('label', { for: 'vncClipboardSshConnection' }, helper.label) : null,
      helper ? h('select', { id: 'vncClipboardSshConnection', value: helper.selected, onChange: (event: Event) => { if (owner.kind === 'helper') owner.options.select(Number((event.target as HTMLSelectElement).value)); } }, helper.connections.map(item => h('option', { key: item.value, value: item.value }, item.label))) : null,
      helper ? h('div', { class: 'muted' }, helper.hint) : null,
      helper ? h('div', { id: 'vncClipboardHelperState', class: 'vnc-clipboard-helper-state remote-management-view', 'aria-live': 'polite' }, managementContent(helper.diagnostic)) : null,
      text?.reason ? h('div', { class: 'connection-test-status warning' }, text.reason) : null,
      text ? h('label', { for: 'vncClipboardManualText' }, text.label) : null,
      text && owner.kind === 'text' ? h('textarea', { id: 'vncClipboardManualText', rows: 8, value: owner.options.value, placeholder: text.placeholder, onInput: (event: Event) => { owner.options.value = (event.target as HTMLTextAreaElement).value; } }) : null,
      text ? h('div', { class: 'muted' }, text.notice) : null,
      h('div', { class: 'actions' }, [button(helper?.cancel ?? text?.cancel ?? '', () => release(), helper ? { 'data-vnc-clipboard-helper-cancel': '' } : { 'data-vnc-clipboard-cancel': '' }), h(TermaButton, { type: 'submit', class: 'primary' }, () => helper?.save ?? text?.send ?? '')])
    ]), target);
    const updatedCard = target.querySelector<HTMLElement>('.modal-card');
    if (updatedCard) updatedCard.scrollTop = scroll;
    if (focused?.id) {
      const updated = target.querySelector<HTMLElement>(`#${CSS.escape(focused.id)}`);
      updated?.focus({ preventScroll: true });
      if (updated && selection && 'setSelectionRange' in updated) {
        try { (updated as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(selection[0], selection[1], selection[2] || undefined); } catch {}
      }
    }
  };
  const prepare = () => {
    if (!target) return;
    terminalServices.termaTerminalViews?.releaseDialog(); remoteServices.termaRemoteViews?.releaseDialog(); quickServices.termaQuickViews?.release(target); connectionsServices.termaConnectionViews?.release(target);
    unmountSettingsDialog(); workspaceServices.termaWorkspaceViews?.unmountDialog();
    target.replaceChildren();
    target.classList.add('terma-vue-root', 'terma-remote-root'); target.setAttribute('data-i18n-skip', '');
    target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    target.hidden = false; target.onclick = null; target.onkeydown = null;
  };
  const focus = (selector: string) => { const owner = current; queueMicrotask(() => { if (current === owner) target?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }); }); };
  window.addEventListener('terma:language-changed', paint);
  new MutationObserver(() => { if (target && current) target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (target) new MutationObserver(() => { if (target.hidden && current) release(); }).observe(target, { attributes: true, attributeFilter: ['hidden'] });
  return {
    release,
    refresh(options: ClipboardHelperOptions) { if (current?.kind === 'helper' && current.options === options) paint(); },
    finish(options: ClipboardHelperOptions, value: ClipboardResult) { if (current?.kind === 'helper' && current.options === options) release(value); },
    prompt(options: ClipboardHelperOptions): Promise<ClipboardResult> {
      if (!target) return Promise.resolve(null);
      prepare();
      return new Promise(resolve => { current = { kind: 'helper', options, resolve, trigger: document.activeElement as HTMLElement }; paint(); focus('#vncClipboardSshConnection'); });
    },
    text(options: ClipboardTextOptions): Promise<string | null> {
      if (!target) return Promise.resolve(null);
      prepare();
      return new Promise(resolve => { current = { kind: 'text', options, resolve, trigger: document.activeElement as HTMLElement }; paint(); focus('#vncClipboardManualText'); });
    }
  };
}
