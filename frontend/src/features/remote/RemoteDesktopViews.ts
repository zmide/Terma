import { Fragment, defineComponent, h, render, shallowRef, type PropType, type ShallowRef } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import {desktopAuthorizationView, type AuthorizationViewPort} from '@/shared/ui/DesktopAuthorization';
import type {DesktopIntegrationStatus} from '@/shared/desktop-integration-service';

export function detachedVncRoot(doc: Document = document): HTMLElement {
  doc.documentElement.classList.add('vnc-detached-window');
  doc.body.classList.add('vnc-detached-window-body');
  let root = doc.getElementById('vncDetachedRoot');
  if (!root) {
    root = doc.createElement('main');
    root.id = 'vncDetachedRoot';
    root.className = 'vnc-detached-root';
    doc.body.appendChild(root);
  }
  return root;
}

export interface RemoteDesktopAction {
  id?: string;
  icon: string;
  label: string;
  kind?: 'primary' | 'danger';
  hidden?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  className?: string;
  onClick(event: MouseEvent): void;
}

export interface RemoteWorkspaceJumpActions {
  label: string;
  actions: RemoteDesktopAction[];
}

export interface RemoteDesktopActionState {
  hidden?: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
}

export interface RemoteDesktopAuthorization {
  status: DesktopIntegrationStatus;
  scopes: string[];
  refreshTarget?: string;
  remoteProfileId?: number;
}

export interface RemoteDesktopLaunchState {
  statusClass?: '' | 'success' | 'warning' | 'error';
  statusText?: string;
  authorization?: RemoteDesktopAuthorization | null;
  clientAvailable?: boolean;
  retainedVnc?: boolean;
  actions?: Record<string, RemoteDesktopActionState>;
}

export interface RemoteDesktopLaunchOptions {
  profileId: number;
  protocol: 'rdp' | 'vnc' | 'xdmcp';
  name: string;
  endpoint: string;
  icon: string;
  actions: RemoteDesktopAction[];
  jumpActions: RemoteWorkspaceJumpActions | null;
  help: string;
  authorizationPort: AuthorizationViewPort;
  showDiagnostics?: boolean;
  state?: RemoteDesktopLaunchState;
}

export interface RemoteVncWorkspaceOptions {
  profileId: number;
  key: string;
  detached: boolean;
  statusLabel: string;
  clipboardLabel: string;
  clipboardHelperEnabled: boolean;
  clipboardSyncEnabled: boolean;
  clipboardReceiveEnabled: boolean;
  clipboardImageEnabled: boolean;
  jumpActions: RemoteWorkspaceJumpActions | null;
  labels: {
    back: string; ctrlAltDelete: string; clipboardHelper: string; clipboardHelperShort: string;
    clipboardSync: string; clipboardSend: string; clipboardSendImage: string; clipboardReceive: string;
    clipboardReceiveImage: string; cursorMode: string; fullscreen: string; newWindow: string;
    closeWindow: string; serviceManagement: string; reconnect: string; systemClient: string; settings: string;
  };
  actions: {
    back(): void; ctrlAltDelete(): void; clipboardHelper(): void; clipboardSync(): void;
    clipboardSend(): void; clipboardSendImage(): void; clipboardReceive(): void;
    clipboardReceiveImage(): void; cursorMode(event: MouseEvent): void; fullscreen(): void;
    newWindow(): void; closeWindow(): void; serviceManagement(): void; reconnect(): void;
    systemClient(event: MouseEvent): void; settings(): void;
  };
}

export interface VncCredentialDialogOptions {
  title: string | (() => string);
  failureReason: string;
  username: string | null;
  target: string | null;
  password: string;
  allowNoPassword: boolean;
  noPasswordAvailable: boolean;
  savePassword: boolean;
  busy: boolean;
  labels: {
    username: string; target: string; password: string; allowNoPassword: string; noPasswordWarning: string;
    savePassword: string; updatePassword: string; passwordStorageHint: string; cancel: string; connect: string;
  };
  change(field: 'username' | 'target' | 'password', value: string): void;
  toggleNoPassword(value: boolean): void;
  toggleSavePassword(value: boolean): void;
  invalidPassword(): void;
  submit(): void;
  cancel(): void;
}

export type VncCredentialLabels = VncCredentialDialogOptions['labels'];

const launchStates = new WeakMap<HTMLElement, RemoteDesktopLaunchState>();
const launchAuthorizations = new WeakMap<HTMLElement, ShallowRef<RemoteDesktopAuthorization | null>>();
const LaunchAuthorization = defineComponent({
  props: {
    model: {type: Object as PropType<ShallowRef<RemoteDesktopAuthorization | null>>, required: true},
    port: {type: Object as PropType<AuthorizationViewPort>, required: true},
    language: String
  },
  setup: props => () => {
    const value = props.model.value;
    return value ? desktopAuthorizationView(props.port, value.status, value.scopes, {
      refreshTarget: value.refreshTarget, remoteProfileId: value.remoteProfileId
    }) : null;
  }
});

function mergeLaunchState(target: HTMLElement, patch: RemoteDesktopLaunchState): RemoteDesktopLaunchState {
  const previous = launchStates.get(target) || {};
  const state = {
    ...previous,
    ...patch,
    actions: {...previous.actions, ...patch.actions}
  };
  launchStates.set(target, state);
  return state;
}

function applyLaunchState(target: HTMLElement, state: RemoteDesktopLaunchState) {
  const status = target.querySelector<HTMLElement>('#remoteDesktopStatus');
  if (status) {
    if (state.statusClass !== undefined) status.className = `connection-test-status ${state.statusClass}`.trim();
    if (state.statusText !== undefined) status.textContent = state.statusText;
  }
  const authorization = launchAuthorizations.get(target);
  if (authorization && state.authorization !== undefined) authorization.value = state.authorization;
  if (state.clientAvailable !== undefined) target.dataset.remoteClientAvailable = state.clientAvailable ? '1' : '0';
  target.toggleAttribute('data-retained-vnc', state.retainedVnc === true);
  for (const [id, actionState] of Object.entries(state.actions || {})) {
    const button = target.querySelector<HTMLButtonElement>(`#${id}`);
    if (!button) continue;
    if (actionState.hidden !== undefined) button.hidden = actionState.hidden;
    if (actionState.disabled !== undefined) button.disabled = actionState.disabled;
    if (actionState.title !== undefined) {
      button.title = actionState.title;
      button.setAttribute('aria-label', actionState.title);
    }
    if (actionState.label !== undefined) {
      const label = button.querySelector('span');
      if (label) label.textContent = actionState.label;
    }
  }
}

function remoteActionButton(action: RemoteDesktopAction, state?: RemoteDesktopActionState) {
  const label = state?.label ?? action.label;
  const title = state?.title ?? label;
  return h(TermaButton, {
    id: action.id,
    class: [action.kind, action.className, action.iconOnly ? 'icon-button' : ''],
    type: 'button',
    title,
    'aria-label': title,
    hidden: state?.hidden ?? action.hidden,
    disabled: state?.disabled ?? action.disabled,
    onClick: action.onClick
  }, () => [icon(action.icon), action.iconOnly ? null : h('span', null, label)]);
}

function workspaceJumpActions(options: RemoteWorkspaceJumpActions | null) {
  return options ? h('span', {class: 'workspace-jump-actions', 'aria-label': options.label},
    options.actions.map(action => remoteActionButton(action))) : null;
}

export function renderRemoteDesktopLaunch(target: HTMLElement, options: RemoteDesktopLaunchOptions) {
  const state = options.state || {};
  launchStates.set(target, state);
  let authorization = launchAuthorizations.get(target);
  if (!authorization) {
    authorization = shallowRef<RemoteDesktopAuthorization | null>(state.authorization || null);
    launchAuthorizations.set(target, authorization);
  } else authorization.value = state.authorization || null;
  render(h('div', {
    class: 'remote-desktop-launch terma-remote-desktop-launch',
    'data-remote-profile-id': String(options.profileId),
    'data-remote-protocol': options.protocol
  }, [
    h('div', { class: 'remote-desktop-icon', 'aria-hidden': 'true' }, [icon(options.icon)]),
    h('h2', null, options.name),
    h('div', { class: 'cmd' }, options.endpoint),
    h('div', { id: 'remoteDesktopStatus', class: `connection-test-status ${state.statusClass || ''}`.trim(), role: 'status', 'aria-live': 'polite' }, state.statusText || ''),
    h('div', { id: 'remoteDesktopAuthorization' }, [
      h(LaunchAuthorization, {model: authorization, port: options.authorizationPort, language: document.documentElement.lang})
    ]),
    options.showDiagnostics !== false && h('div', { id: options.protocol === 'rdp' ? 'rdpServerState' : options.protocol === 'xdmcp' ? 'xdmcpServerState' : 'vncServerState', class: `${options.protocol}-server-state`, innerHTML: '' }),
    h('div', { class: 'actions remote-desktop-actions' }, [
      h('div', { class: 'remote-desktop-jump-actions' }, [workspaceJumpActions(options.jumpActions)]),
      ...options.actions.map(action => remoteActionButton(action, action.id ? state.actions?.[action.id] : undefined))
    ]),
    h('div', { class: 'muted' }, options.help)
  ]), target);
  applyLaunchState(target, state);
}

export function updateRemoteDesktopLaunch(target: HTMLElement, patch: RemoteDesktopLaunchState) {
  applyLaunchState(target, mergeLaunchState(target, patch));
}

type VncFullscreenControl = {active: boolean; label: string};
const vncFullscreenControls = new WeakMap<HTMLElement, ShallowRef<VncFullscreenControl>>();
const VncFullscreenButton = defineComponent({
  props: {
    model: {type: Object as PropType<ShallowRef<VncFullscreenControl>>, required: true},
    toggle: {type: Function as PropType<() => void>, required: true}
  },
  setup(props) {
    return () => {
      const {active, label} = props.model.value;
      return h(TermaButton, {
        class: 'icon-button', type: 'button', title: label, 'aria-label': label,
        'aria-pressed': String(active), 'data-vnc-fullscreen-toggle': '', onClick: props.toggle
      }, () => icon(active ? 'minimize-2' : 'maximize-2'));
    };
  }
});

export function updateRemoteVncFullscreenControl(workspace: HTMLElement | null | undefined, active: boolean, label: string) {
  const model = workspace && vncFullscreenControls.get(workspace);
  if (model && (model.value.active !== active || model.value.label !== label)) model.value = {active, label};
}

export function renderRemoteVncWorkspace(target: HTMLElement, options: RemoteVncWorkspaceOptions) {
  const previous = target.querySelector<HTMLElement>('.vnc-workspace');
  const fullscreen = (previous?.dataset.vncKey === options.key ? vncFullscreenControls.get(previous) : undefined)
    ?? shallowRef<VncFullscreenControl>({active: false, label: options.labels.fullscreen});
  if (!fullscreen.value.active && fullscreen.value.label !== options.labels.fullscreen) {
    fullscreen.value = {active: false, label: options.labels.fullscreen};
  }
  const button = (name: string, label: string, action: (event: MouseEvent) => void, attrs: Record<string, unknown> = {}) => h(TermaButton, {
    class: 'icon-button',
    type: 'button',
    title: label,
    'aria-label': label,
    onClick: action,
    ...attrs
  }, () => icon(name));

  const actions = [
    options.detached ? null : button('arrow-left', options.labels.back, options.actions.back),
    button('keyboard', options.labels.ctrlAltDelete, options.actions.ctrlAltDelete),
    h(TermaButton, {
      class: 'vnc-clipboard-helper-button', type: 'button', title: options.labels.clipboardHelper,
      'aria-label': options.labels.clipboardHelper, disabled: !options.clipboardHelperEnabled,
      'data-vnc-clipboard-helper': '', onClick: options.actions.clipboardHelper
    }, () => [icon('link-2'), h('span', null, options.labels.clipboardHelperShort)]),
    button('clipboard-check', options.labels.clipboardSync, options.actions.clipboardSync, {
      'data-vnc-clipboard-sync': '', 'aria-pressed': options.clipboardSyncEnabled ? 'true' : 'false'
    }),
    button('clipboard-paste', options.labels.clipboardSend, options.actions.clipboardSend),
    button('image-up', options.labels.clipboardSendImage, options.actions.clipboardSendImage, { 'data-vnc-clipboard-send-image': '', disabled: !options.clipboardImageEnabled }),
    button('clipboard-copy', options.labels.clipboardReceive, options.actions.clipboardReceive, {
      'data-vnc-clipboard-receive': '', disabled: !options.clipboardReceiveEnabled
    }),
    button('image-down', options.labels.clipboardReceiveImage, options.actions.clipboardReceiveImage, { 'data-vnc-clipboard-receive-image': '', disabled: !options.clipboardImageEnabled }),
    button('mouse-pointer-2', options.labels.cursorMode, options.actions.cursorMode, { 'data-vnc-cursor-mode': '' }),
    h(VncFullscreenButton, {model: fullscreen, toggle: options.actions.fullscreen}),
    options.detached ? null : button('panel-top-open', options.labels.newWindow, options.actions.newWindow),
    options.detached ? null : button('server-cog', options.labels.serviceManagement, options.actions.serviceManagement),
    button('refresh-cw', options.labels.reconnect, options.actions.reconnect),
    options.detached ? null : button('external-link', options.labels.systemClient, options.actions.systemClient),
    button('settings-2', options.labels.settings, options.actions.settings),
    options.detached ? button('x', options.labels.closeWindow, options.actions.closeWindow) : null
  ].filter(Boolean);

  render(h('div', {
    class: 'vnc-workspace terma-vnc-workspace',
    'data-vnc-key': options.key
  }, [
    h('div', { class: 'vnc-fullscreen-toolbar-edge-zone', 'aria-hidden': 'true' }),
    h('div', { class: 'vnc-toolbar' }, [
      h('div', { class: 'vnc-toolbar-status' }, [
        h('span', { class: 'terminal-connection-dot connecting', 'aria-hidden': 'true' }),
        h('span', { id: 'vncStatus', class: 'vnc-status connecting', role: 'status', 'aria-live': 'polite', innerHTML: '' }),
        h(TermaButton, {
          id: 'vncClipboardStatus', class: 'vnc-clipboard-status clickable', type: 'button',
          title: options.clipboardLabel, 'aria-label': options.clipboardLabel, role: 'status', 'aria-live': 'polite',
          onClick: options.actions.clipboardHelper
        })
      ]),
      h('div', { class: 'vnc-toolbar-actions' }, [
        h('div', { class: 'vnc-workspace-jump-actions' }, [workspaceJumpActions(options.jumpActions)]),
        ...actions
      ])
    ]),
    h('div', { id: 'vncViewport', class: 'vnc-viewport', tabindex: 0 }, [
      h('div', { id: 'vncConnectionHelp', class: 'vnc-connection-help', hidden: true, innerHTML: '' })
    ])
  ]), target);
  const workspace = target.querySelector<HTMLElement>('.vnc-workspace');
  if (workspace) vncFullscreenControls.set(workspace, fullscreen);
}

export function renderVncCredentialDialog(target: HTMLElement, options: VncCredentialDialogOptions) {
  const field = (id: string, label: string, value: string, type = 'text', autocomplete = 'off', change?: (value: string) => void, disabled = options.busy) => h('div', { class: 'vnc-credential-field' }, [
    h('label', { for: id }, label),
    h('input', {
      id, type, autocomplete, value, disabled,
      required: id === 'vncCredentialPassword' && !options.allowNoPassword,
      onInput: (event: Event) => change?.((event.currentTarget as HTMLInputElement).value)
    })
  ]);
  render(h('form', {
    class: 'modal-card vnc-credentials-modal terma-vnc-credentials',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vncCredentialsTitle', 'aria-busy': options.busy, novalidate: true,
    onSubmit: (event: Event) => { event.preventDefault(); if (!options.busy) options.submit(); },
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!options.busy) options.cancel(); }
      if (event.key === 'Tab') {
        const fields = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
        if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
      }
    }
  }, [
    h('h2', { id: 'vncCredentialsTitle' }, typeof options.title === 'function' ? options.title() : options.title),
    options.failureReason ? h('div', { class: 'connection-test-status error', role: 'alert' }, options.failureReason) : null,
    options.username !== null ? field('vncCredentialUsername', options.labels.username, options.username, 'text', 'username', value => options.change('username', value)) : null,
    options.target !== null ? field('vncCredentialTarget', options.labels.target, options.target, 'text', 'off', value => options.change('target', value)) : null,
    field('vncCredentialPassword', options.labels.password, options.password, 'password', 'current-password', value => options.change('password', value), options.busy || options.allowNoPassword),
    options.noPasswordAvailable ? h(Fragment, null, [
      h('label', { class: 'checkline' }, [h('input', { id: 'vncCredentialNoPassword', type: 'checkbox', checked: options.allowNoPassword, disabled: options.busy, onChange: (event: Event) => options.toggleNoPassword((event.currentTarget as HTMLInputElement).checked) }), h('span', null, options.labels.allowNoPassword)]),
      h('div', { class: 'muted vnc-no-password-warning' }, options.labels.noPasswordWarning)
    ]) : null,
    h('label', { class: 'checkline' }, [h('input', { id: 'vncCredentialSave', type: 'checkbox', checked: options.savePassword, disabled: options.busy || options.allowNoPassword, onChange: (event: Event) => options.toggleSavePassword((event.currentTarget as HTMLInputElement).checked) }), h('span', null, options.labels.savePassword)]),
    h('div', { class: 'muted' }, options.labels.passwordStorageHint),
    h('div', { class: 'actions' }, [
      h(TermaButton, { type: 'button', disabled: options.busy, onClick: options.cancel }, () => options.labels.cancel),
      h(TermaButton, { class: 'primary', type: 'submit', disabled: options.busy }, () => [icon('monitor-play'), h('span', null, options.labels.connect)])
    ])
  ]), target);
}
