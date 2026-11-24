import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { SettingsPasswordField } from '@/features/settings/SettingsPasswordField';

export interface RemoteAdminState { user: string; method: string; password: string; key: string; passphrase: string; sudoMode: string; sudoPassword: string; reuse: string; submitting: boolean }
export interface RemoteAdminOptions {
  state: RemoteAdminState; labels(): Record<string, string>; identities(): { value: string; label: string }[]; quick: boolean;
  submit(): Promise<{ admin_grant_id: string } | null>;
  accept(value: { admin_grant_id: string }): void;
}

export function installRemoteAdminDialog() {
  const target = document.getElementById('modal');
  let current: { options: RemoteAdminOptions; resolve(value: { admin_grant_id: string } | null): void; trigger: HTMLElement | null } | null = null;
  const release = (value: { admin_grant_id: string } | null = null) => {
    if (!current || !target) return;
    const old = current; current = null;
    old.options.state.password = ''; old.options.state.passphrase = ''; old.options.state.sudoPassword = '';
    for (const id of ['remoteAdminPassword', 'remoteAdminPassphrase', 'remoteAdminSudoPassword']) {
      const input = target.querySelector<HTMLInputElement>(`#${id}`);
      if (input) input.value = '';
    }
    render(null, target); target.hidden = true;
    target.classList.remove('terma-vue-root', 'terma-remote-root'); target.removeAttribute('data-theme'); target.removeAttribute('data-i18n-skip');
    if (old.trigger?.isConnected) old.trigger.focus({ preventScroll: true });
    old.resolve(value);
  };
  const paint = () => {
    if (!current || !target) return;
    const { options } = current, s = options.state, l = options.labels();
    const input = (id: string, name: 'user' | 'password' | 'passphrase' | 'sudoPassword', type = 'text', autocomplete?: string, placeholder?: string) => {
      const attrs = { id, autocomplete, placeholder, value: s[name], disabled: s.submitting,
        onInput: (event: Event) => { s[name] = (event.target as HTMLInputElement).value; paint(); }
      };
      return type === 'password'
        ? h(SettingsPasswordField, { ...attrs, showLabel: l.show_password, hideLabel: l.hide_password, 'data-password-visibility-input': 'true' })
        : h('input', { ...attrs, type });
    };
    const field = (label: string, id: string, child: ReturnType<typeof h>) => h('div', null, [h('label', { for: id }, label), child]);
    const select = (id: string, name: 'method' | 'sudoMode' | 'reuse' | 'key', values: { value: string; label: string; disabled?: boolean }[]) => h('select', {
      id, value: s[name], disabled: s.submitting, onChange: (event: Event) => {
        s[name] = (event.target as HTMLSelectElement).value;
        if (s.method !== 'password' && s.sudoMode === 'same') s.sudoMode = 'none';
        paint();
      }
    }, values.map(item => h('option', { key: item.value, value: item.value, disabled: item.disabled }, item.label)));
    const cancel = () => { if (!s.submitting) release(); };
    render(h('form', { class: 'modal-card remote-admin-modal', 'data-remote-admin-owned': '', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'remoteAdminTitle',
      onSubmit: async (event: Event) => {
        event.preventDefault(); if (s.submitting || !current) return;
        const owner = current; s.submitting = true; paint();
        try { const result = await options.submit(); if (current === owner && result) { options.accept(result); release(result); } }
        finally { s.submitting = false; if (current === owner) paint(); }
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key !== 'Tab') return;
        const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled)')].filter(element => element.checkVisibility());
        if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
      }
    }, [
      h('div', { class: 'modal-title-row' }, [h('div', null, [h('h2', { id: 'remoteAdminTitle' }, l.title), h('span', { class: 'muted' }, l.scope)]), h(TermaButton, { class: 'icon-button', type: 'button', disabled: s.submitting, title: l.close, 'aria-label': l.close, 'data-admin-cancel': '', onClick: cancel }, () => icon('x'))]),
      h('div', { class: 'connection-test-status warning' }, l.privacy_notice),
      h('div', { class: 'grid remote-admin-grid' }, [field(l.ssh_user, 'remoteAdminUser', input('remoteAdminUser', 'user', 'text', 'username')), field(l.auth_method, 'remoteAdminMethod', select('remoteAdminMethod', 'method', [{ value: 'password', label: l.password }, { value: 'key', label: l.existing_key }, { value: 'agent', label: 'SSH Agent' }]))]),
      h('div', { id: 'remoteAdminPasswordBox', hidden: s.method !== 'password' }, [field(l.ssh_password, 'remoteAdminPassword', input('remoteAdminPassword', 'password', 'password', 'current-password', l.once_placeholder))]),
      h('div', { id: 'remoteAdminKeyBox', hidden: s.method !== 'key' }, [field(l.private_key, 'remoteAdminKey', select('remoteAdminKey', 'key', [{ value: '', label: l.select_private_key }, ...options.identities()])), field(l.passphrase_optional, 'remoteAdminPassphrase', input('remoteAdminPassphrase', 'passphrase', 'password', 'new-password', l.passphrase_empty))]),
      h('div', { class: 'grid remote-admin-grid' }, [field(l.sudo_password, 'remoteAdminSudoMode', select('remoteAdminSudoMode', 'sudoMode', [{ value: 'none', label: l.sudo_none }, { value: 'same', label: l.sudo_same, disabled: s.method !== 'password' }, { value: 'separate', label: l.sudo_separate }])), h('div', { id: 'remoteAdminSudoPasswordBox', hidden: s.sudoMode !== 'separate' }, [field(l.sudo_password, 'remoteAdminSudoPassword', input('remoteAdminSudoPassword', 'sudoPassword', 'password', 'current-password', l.sudo_empty))])]),
      options.quick ? h('div', { class: 'muted remote-admin-note' }, [l.quick_once, h('input', { id: 'remoteAdminReusePolicy', type: 'hidden', value: 'once' })]) : field(l.reuse_label, 'remoteAdminReusePolicy', select('remoteAdminReusePolicy', 'reuse', [{ value: 'once', label: l.reuse_once }, { value: '10m', label: l.reuse_10m }, { value: '30m', label: l.reuse_30m }, { value: 'session', label: l.reuse_session }])),
      h('div', { class: 'muted remote-admin-note' }, l.validation_notice),
      h('div', { class: 'actions' }, [h(TermaButton, { type: 'button', disabled: s.submitting, 'data-admin-cancel': '', onClick: cancel }, () => l.cancel), h(TermaButton, { class: 'primary', type: 'submit', disabled: s.submitting, 'aria-busy': s.submitting }, () => s.submitting ? l.validating : l.authorize_continue)])
    ]), target);
  };
  window.addEventListener('terma:language-changed', paint);
  new MutationObserver(() => {
    if (target && current) target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (target) new MutationObserver(() => { if (target.hidden && current) release(); }).observe(target, { attributes: true, attributeFilter: ['hidden'] });
  return { release, prompt(options: RemoteAdminOptions) {
    if (!target) return Promise.resolve(null);
    terminalServices.termaTerminalViews?.releaseDialog(); remoteServices.termaRemoteViews?.releaseDialog(); quickServices.termaQuickViews?.release(target); connectionsServices.termaConnectionViews?.release(target); unmountSettingsDialog(); workspaceServices.termaWorkspaceViews?.unmountDialog();
    target.replaceChildren();
    return new Promise<{ admin_grant_id: string } | null>(resolve => {
      current = { options, resolve, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      target.classList.add('terma-vue-root', 'terma-remote-root'); target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; target.setAttribute('data-i18n-skip', '');
      target.onclick = null; target.onkeydown = null; target.hidden = false; paint();
      const owner = current;
      queueMicrotask(() => { if (current === owner) target.querySelector<HTMLInputElement>('#remoteAdminUser')?.focus(); });
    });
  }};
}
