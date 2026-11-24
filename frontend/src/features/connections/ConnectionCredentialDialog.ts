import { h, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '../settings/settings-icon';
import type { SshCredentialConnection } from './connection-credential-service';

export type ConnectionCredentialIdentity = {
  path?: unknown;
  [key: string]: unknown;
};

export type ConnectionCredentialDialogState = {
  user: string;
  port: string;
  authType: 'password' | 'key';
  password: string;
  identityFile: string;
  passphrase: string;
  save: boolean;
  busy: boolean;
  phase: 'idle' | 'uploading' | 'verifying' | 'saving' | 'temporary' | 'error';
  error: string;
  fileName: string;
  identities: ConnectionCredentialIdentity[];
};

export type ConnectionCredentialDialogLabels = {
  title: string;
  close: string;
  cancel: string;
  hostHint: string;
  username: string;
  port: string;
  loginMethod: string;
  passwordLogin: string;
  keyLogin: string;
  password: string;
  identity: string;
  selectIdentity: string;
  uploadKey: string;
  passphrase: string;
  save: string;
  verifyFirst: string;
  temporaryHint: string;
  saveRequiredHint: string;
  uploadHint: string;
  verifyConnect: string;
  verifying: string;
  uploading: string;
  saving: string;
  temporary: string;
  fileNotSelected: string;
};

export type ConnectionCredentialDialogActions = {
  change(field: 'user' | 'port' | 'authType' | 'password' | 'identityFile' | 'passphrase' | 'save', value: string | boolean): void;
  upload(file: File | undefined): void;
  submit(): void;
  cancel(): void;
};

export type ConnectionCredentialDialogOptions = {
  connection: SshCredentialConnection;
  context: string;
  temporaryAllowed: boolean;
  state: ConnectionCredentialDialogState;
  labels: ConnectionCredentialDialogLabels;
  identityLabel(identity: ConnectionCredentialIdentity): string;
  actions: ConnectionCredentialDialogActions;
};

function input(
  id: string,
  label: string,
  value: string,
  onInput: (value: string) => void,
  options: Record<string, unknown> = {}
): VNodeChild {
  return h('div', null, [
    h('label', {for: id}, label),
    h('input', {
      id,
      value,
      onInput: (event: Event) => onInput((event.target as HTMLInputElement).value),
      ...options
    })
  ]);
}

export function connectionCredentialView(options: ConnectionCredentialDialogOptions) {
  const {state, labels, actions, connection} = options;
  const keyAuth = state.authType === 'key';
  const status = state.phase === 'error'
    ? state.error
    : state.phase === 'uploading'
      ? labels.uploading
      : state.phase === 'saving'
        ? labels.saving
        : state.phase === 'temporary'
          ? labels.temporary
          : state.phase === 'verifying'
            ? labels.verifying
            : labels.verifyFirst + (options.temporaryAllowed ? labels.temporaryHint : labels.saveRequiredHint);
  return h('form', {
    class: 'modal-card ssh-credential-repair-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'sshCredentialRepairTitle',
    'aria-busy': state.busy,
    onSubmit: (event: Event) => { event.preventDefault(); actions.submit(); },
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !state.busy) {
        event.preventDefault();
        actions.cancel();
      }
    }
  }, [
    h('div', {class: 'modal-title-row'}, [
      h('div', null, [
        h('h2', {id: 'sshCredentialRepairTitle'}, labels.title),
        h('span', {class: 'muted'}, `${options.context} · ${String(connection.name || connection.ssh_host || '')}`)
      ]),
      h(TermaButton, {
        class: 'icon-button',
        type: 'button',
        'data-credential-close': '',
        disabled: state.busy,
        title: labels.close,
        'aria-label': labels.close,
        onClick: actions.cancel
      }, () => icon('x'))
    ]),
    h('div', {class: 'ssh-credential-target'}, [
      h('span', null, [icon('server')]),
      h('div', null, [
        h('strong', null, String(connection.ssh_host || '')),
        h('small', null, labels.hostHint)
      ])
    ]),
    h('div', {class: 'grid'}, [
      input('sshCredentialUser', labels.username, state.user, value => actions.change('user', value), {
        required: true,
        disabled: state.busy,
        autocomplete: 'username'
      }),
      input('sshCredentialPort', labels.port, state.port, value => actions.change('port', value), {
        type: 'number',
        min: 1,
        max: 65535,
        required: true,
        disabled: state.busy
      })
    ]),
    h('fieldset', {class: 'quick-ssh-auth-choice'}, [
      h('legend', null, labels.loginMethod),
      h('label', null, [
        h('input', {
          type: 'radio',
          name: 'sshCredentialAuthType',
          value: 'password',
          checked: !keyAuth,
          disabled: state.busy,
          onChange: () => actions.change('authType', 'password')
        }),
        h('span', null, [icon('key-round'), labels.passwordLogin])
      ]),
      h('label', null, [
        h('input', {
          type: 'radio',
          name: 'sshCredentialAuthType',
          value: 'key',
          checked: keyAuth,
          disabled: state.busy,
          onChange: () => actions.change('authType', 'key')
        }),
        h('span', null, [icon('file-key'), labels.keyLogin])
      ])
    ]),
    h('div', {id: 'sshCredentialPasswordPanel', hidden: keyAuth}, [
      input('sshCredentialPassword', labels.password, state.password, value => actions.change('password', value), {
        type: 'password',
        required: !keyAuth,
        disabled: state.busy,
        autocomplete: 'current-password'
      })
    ]),
    h('div', {id: 'sshCredentialKeyPanel', hidden: !keyAuth}, [
      h('label', {for: 'sshCredentialIdentity'}, labels.identity),
      h('select', {
        id: 'sshCredentialIdentity',
        value: state.identityFile,
        required: keyAuth,
        disabled: state.busy,
        onChange: (event: Event) => actions.change('identityFile', (event.target as HTMLSelectElement).value)
      }, [
        h('option', {value: ''}, labels.selectIdentity),
        ...state.identities.map(identity => h('option', {value: String(identity.path || '')}, options.identityLabel(identity)))
      ]),
      h('div', {class: 'ssh-credential-upload'}, [
        h('label', {class: 'file-picker'}, [
          h('input', {
            id: 'sshCredentialKeyUpload',
            type: 'file',
            accept: '*/*',
            disabled: state.busy,
            onChange: (event: Event) => actions.upload((event.target as HTMLInputElement).files?.[0])
          }),
          h('span', {class: 'file-picker-button'}, labels.uploadKey),
          h('span', {class: 'file-picker-name'}, state.fileName || labels.fileNotSelected)
        ])
      ]),
      input('sshCredentialPassphrase', labels.passphrase, state.passphrase, value => actions.change('passphrase', value), {
        type: 'password',
        disabled: state.busy,
        autocomplete: 'off'
      })
    ]),
    h('label', {class: 'checkline ssh-credential-save'}, [
      h('input', {
        id: 'sshCredentialSave',
        type: 'checkbox',
        checked: state.save,
        disabled: state.busy || !options.temporaryAllowed,
        onChange: (event: Event) => actions.change('save', (event.target as HTMLInputElement).checked)
      }),
      h('span', null, labels.save)
    ]),
    h('div', {id: 'sshCredentialStatus', class: ['connection-test-status', state.busy ? 'busy' : state.phase === 'error' ? 'error' : ''], 'aria-live': 'polite'}, status),
    h('div', {class: 'field-help'}, labels.uploadHint),
    h('div', {class: 'actions'}, [
      h(TermaButton, {type: 'button', 'data-credential-close': '', disabled: state.busy, onClick: actions.cancel}, () => labels.cancel),
      h(TermaButton, {id: 'sshCredentialConnect', class: 'primary', type: 'submit', disabled: state.busy}, () => [
        icon('link-2'),
        h('span', null, state.busy ? labels.verifying : labels.verifyConnect)
      ])
    ])
  ]);
}
