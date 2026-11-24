import {terminalServices} from '@/features/terminal/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {refreshIcons} from '@/shared/ui/icon-service';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { Fragment, h, render, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';
import '@/styles/remote.css';
import { renderRemoteTerminal, type RemoteTerminalOptions } from './RemoteTerminalView';
import { renderRemoteCredentials, type RemoteCredentialOptions } from './RemoteCredentialDialog';
import { renderRemoteSetupGuide, type RemoteSetupGuideOptions } from './RemoteSetupGuide';
import { renderManagement, type ManagementOptions } from './RemoteManagementView';
import { installRemoteAdminDialog, type RemoteAdminOptions } from './RemoteAdminDialog';
import { installVncClipboardDialog, type ClipboardHelperOptions, type ClipboardTextOptions, type ClipboardResult } from './VncClipboardDialog';
import { renderLinuxDesktop, renderLinuxTask, type LinuxDesktopOptions, type LinuxTaskOptions } from './LinuxDesktopView';
import {
  renderRemoteDesktopLaunch,
  updateRemoteDesktopLaunch,
  renderRemoteVncWorkspace,
  detachedVncRoot,
  renderVncCredentialDialog,
  type RemoteDesktopLaunchOptions,
  type RemoteDesktopLaunchState,
  type RemoteVncWorkspaceOptions,
} from './RemoteDesktopViews';
import type {VncCredentialPromptOptions} from './vnc-credentials';
import type {VncCredentialResult, VncSession} from './vnc-types';

export interface RemoteFtpEntry {
  name: string;
  type: string;
  size?: number;
  modified_at?: string | number | null;
}

export interface RemoteFtpModel {
  key: string;
  path: string;
  pathDraft?: string;
  entries: RemoteFtpEntry[];
  loading: boolean;
  busy?: boolean;
  error?: string;
}

export interface RemoteFtpLabels {
  parent: string;
  path: string;
  refresh: string;
  create: string;
  upload: string;
  retry: string;
  emptyTitle: string;
  emptyDetail: string;
  loadingTitle: string;
  loadingDetail: string;
  name: string;
  size: string;
  modified: string;
  actions: string;
  open: string;
  download: string;
  rename: string;
  remove: string;
  confirm: string;
  cancel: string;
  deleteTitle: string;
  deleteAction: string;
  deleteCancel: string;
  errorTitle: string;
  createTitle: string;
  createLabel: string;
  renameTitle: string;
  renameLabel: string;
  deleteMessage(name: string, suffix: string): string;
}

export interface RemoteFtpActions {
  pathDraft(value: string): void;
  navigate(path: string): void;
  parent(): void;
  refresh(): void;
  create(): void;
  upload(files: FileList | null): void;
  open(entry: RemoteFtpEntry): void;
  download(entry: RemoteFtpEntry): void;
  rename(entry: RemoteFtpEntry): void;
  remove(entry: RemoteFtpEntry): void;
}

export interface RemoteFtpRenderOptions {
  model: RemoteFtpModel;
  labels: RemoteFtpLabels;
  actions: RemoteFtpActions;
  formatBytes(value: number): string;
}



function stateView(kind: string, title: string, detail: string, action?: VNodeChild) {
  return h('div', { class: `ui-state ${kind} ftp-state`, role: kind === 'error' ? 'alert' : 'status' }, [
    h('span', { class: 'ui-state-icon', 'aria-hidden': 'true' }),
    h('strong', null, title),
    detail ? h('span', null, detail) : null,
    action ? h('div', { class: 'actions' }, [action]) : null
  ]);
}

function renderFtpDialog(target: HTMLElement, dialog: { kind: 'input' | 'confirm'; title: string; label?: string; value?: string; message?: string; confirmText: string; cancelText: string; danger?: boolean }, finish: (value: string | boolean) => void) {
  const input = dialog.kind === 'input' ? h('label', { class: 'ftp-dialog-field', for: 'ftpDialogInput' }, [
    h('span', null, dialog.label),
    h('input', { id: 'ftpDialogInput', value: dialog.value ?? '', autofocus: true,
      onInput: (event: Event) => { dialog.value = (event.target as HTMLInputElement).value; },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') { event.preventDefault(); finish((event.currentTarget as HTMLInputElement).value.trim()); }
        if (event.key === 'Escape') { event.preventDefault(); finish(''); }
      }
    })
  ]) : h('div', { class: 'modal-message' }, dialog.message);
  render(h('div', { class: ['modal-card', 'ftp-action-dialog', dialog.danger ? 'danger' : ''].filter(Boolean).join(' '),
    role: dialog.kind === 'confirm' ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ftpDialogTitle',
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(dialog.kind === 'input' ? '' : false); }
      if (event.key === 'Tab') {
        const fields=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));
        if(event.shiftKey && document.activeElement===fields[0]) {event.preventDefault();fields.at(-1)?.focus();}
        else if(!event.shiftKey && document.activeElement===fields.at(-1)) {event.preventDefault();fields[0]?.focus();}
      }
    } }, [
    h('h2', { id: 'ftpDialogTitle' }, dialog.title),
    input,
    h('div', { class: 'actions' }, [
      h(TermaButton, { type: 'button', class: dialog.danger ? 'danger' : 'primary', onClick: () => finish(dialog.kind === 'input' ? (dialog.value || '').trim() : true) }, () => dialog.confirmText),
      h(TermaButton, { type: 'button', onClick: () => finish(dialog.kind === 'input' ? '' : false) }, () => dialog.cancelText)
    ])
  ]), target);
}

function ftpView({ model, labels, actions, formatBytes }: RemoteFtpRenderOptions) {
  const button = (icon: string, label: string, action: () => void, disabled = false) => h(TermaButton, {
    class: 'icon-button', type: 'button', title: label, 'aria-label': label, disabled, onClick: action
  }, () => settingsIcon(icon));

  let content: VNodeChild;
  if (model.loading) {
    content = stateView('loading', labels.loadingTitle, labels.loadingDetail);
  } else if (model.error) {
    content = stateView('error', labels.errorTitle, model.error, h(TermaButton, { class: 'primary', type: 'button', onClick: actions.refresh }, () => labels.retry));
  } else if (!model.entries.length) {
    content = stateView('empty', labels.emptyTitle, labels.emptyDetail, h(TermaButton, { class: 'primary', type: 'button', onClick: actions.create }, () => labels.create));
  } else {
    const rows = model.entries.map(entry => {
      const directory = entry.type === 'directory';
      const open = () => directory ? actions.open(entry) : actions.download(entry);
      const modified = entry.modified_at ? new Date(entry.modified_at).toLocaleString(document.documentElement.lang || undefined) : '—';
      const size = directory ? '—' : formatBytes(Number(entry.size) || 0);
      const rowButton = (icon: string, label: string, action: () => void, danger = false) => h(TermaButton, {
        class: ['icon-button', danger ? 'danger' : ''].filter(Boolean).join(' '), type: 'button',
        disabled: model.busy,
        title: label, 'aria-label': `${label}: ${entry.name}`, onClick: (event: Event) => { event.stopPropagation(); action(); }
      }, () => settingsIcon(icon));
      return h('div', {
        key: `${entry.type}:${entry.name}`, class: 'ftp-row', role: 'row', tabindex: 0,
        onDblclick: (event: Event) => { if (!(event.target as Element).closest('button')) open(); },
        onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter' && event.target === event.currentTarget) open(); }
      }, [
        h('span', { class: 'ftp-name', role: 'cell' }, [settingsIcon(directory ? 'folder' : entry.type === 'link' ? 'file-symlink' : 'file'), h('span', {class:'ftp-entry-copy'}, [h('span',{class:'ftp-entry-name',title:entry.name},entry.name),h('small',{class:'ftp-mobile-meta'},[size,modified!=='—' ? ` · ${modified}` : ''])])]),
        h('span', { role: 'cell' }, size),
        h('span', { role: 'cell', title: modified }, modified),
        h('span', { class: 'ftp-row-actions', role: 'cell' }, [
          rowButton(directory ? 'folder-open' : 'download', directory ? labels.open : labels.download, open),
          rowButton('pencil', labels.rename, () => actions.rename(entry)),
          rowButton('trash-2', labels.remove, () => actions.remove(entry), true)
        ])
      ]);
    });
    content = h('div', { class: 'ftp-table', role: 'table' }, [
      h('div', { class: 'ftp-row ftp-head', role: 'row' }, [labels.name, labels.size, labels.modified, labels.actions].map(label => h('span', { role: 'columnheader' }, label))),
      ...rows
    ]);
  }

  return h(Fragment, null, [
    h('div', { class: 'ftp-toolbar' }, [
      button('corner-left-up', labels.parent, actions.parent, model.loading || model.path === '/'),
      h('label', { class: 'ftp-path-field', title: labels.path }, [
        settingsIcon('folder-open'),
        h('input', {
          type: 'text', 'aria-label': labels.path, 'data-ftp-path': '', value: model.pathDraft ?? model.path,
          onInput: (event: Event) => actions.pathDraft((event.target as HTMLInputElement).value),
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              actions.navigate((event.currentTarget as HTMLInputElement).value);
            }
          }
        })
      ]),
      button('refresh-cw', labels.refresh, actions.refresh, model.loading),
      button('folder-plus', labels.create, actions.create, model.loading || model.busy),
      h('label', { class: 'icon-button ftp-upload-button', title: labels.upload, 'aria-label': labels.upload }, [
        settingsIcon('upload'),
        h('input', { type: 'file', multiple: true, 'aria-label': labels.upload, 'data-ftp-upload': '', disabled: model.loading || model.busy,
          onChange: (event: Event) => actions.upload((event.target as HTMLInputElement).files) })
      ])
    ]),
    h('div', { class: 'ftp-list', 'data-ftp-list': '' }, [content])
  ]);
}

export function installRemoteViews() {
  const admin = installRemoteAdminDialog();
  const clipboard = installVncClipboardDialog();
  const paints = new Map<HTMLElement, () => void>();
  const managementTargets = new Set<HTMLElement>();
  const dialogTarget = document.getElementById('modal');
  let currentOptions: RemoteFtpRenderOptions | null = null;
  let dialog: { kind: 'input' | 'confirm'; intent: 'create' | 'rename' | 'delete'; title: string; label?: string; value?: string; message?: string; name?: string; suffix?: string; confirmText: string; cancelText: string; danger?: boolean } | null = null;
  let dialogResolve: ((value: string | boolean) => void) | null = null;
  let dialogTrigger: HTMLElement | null = null;
  let dialogPaint: (() => void) | null = null;
  let dialogAbortOff: (() => void) | null = null;
  let vncCredentialResolve: ((value: VncCredentialResult | null) => void) | null = null;
  let vncCredentialOptions: VncCredentialPromptOptions | null = null;
  let vncCredentialOwner: VncSession | undefined;
  let vncCredentialPaint: (() => void) | null = null;
  let vncCredentialTrigger: HTMLElement | null = null;
  let setupGuide: RemoteSetupGuideOptions | null = null;
  let setupGuideTrigger: HTMLElement | null = null;
  let management: ManagementOptions | null = null;
  let managementTrigger: HTMLElement | null = null;
  const prepareTarget = (target: HTMLElement) => {
    if(target !== dialogTarget && !paints.has(target))target.replaceChildren();
    target.classList.add('terma-vue-root', 'terma-remote-root');
    target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    target.setAttribute('data-i18n-skip', '');
  };
  const clearTarget = (target: HTMLElement) => {
    target.classList.remove('terma-vue-root', 'terma-remote-root');
    target.removeAttribute('data-i18n-skip');
    target.removeAttribute('data-theme');
  };
  const releaseVncCredentialDialog = (value: VncCredentialResult | null = null) => {
    if (!dialogTarget || !vncCredentialResolve) return;
    const complete = vncCredentialResolve;
    vncCredentialResolve = null;
    if (vncCredentialOptions) vncCredentialOptions.password = '';
    vncCredentialOptions = null;
    vncCredentialOwner = undefined;
    vncCredentialPaint = null;
    render(null, dialogTarget);
    dialogTarget.hidden = true;
    clearTarget(dialogTarget);
    if (vncCredentialTrigger?.isConnected) vncCredentialTrigger.focus({ preventScroll: true });
    vncCredentialTrigger = null;
    complete(value);
  };
  const refreshDialogLabels = () => {
    if (!dialog || !currentOptions) return;
    const labels = currentOptions.labels;
    if (dialog.intent === 'create') { dialog.title = labels.createTitle; dialog.label = labels.createLabel; dialog.confirmText = labels.confirm; dialog.cancelText = labels.cancel; }
    else if (dialog.intent === 'rename') { dialog.title = labels.renameTitle; dialog.label = labels.renameLabel; dialog.confirmText = labels.confirm; dialog.cancelText = labels.cancel; }
    else if (dialog.intent === 'delete') { dialog.title = labels.deleteTitle; dialog.message = labels.deleteMessage(dialog.name || '', dialog.suffix || ''); dialog.confirmText = labels.deleteAction; dialog.cancelText = labels.deleteCancel; }
    dialogPaint?.();
  };
  const releaseDialog = () => {
    dialogAbortOff?.(); dialogAbortOff = null;
    clipboard.release();
    admin.release();
    if (dialogTarget && management) {
      const old = management; management = null;
      render(null, dialogTarget); dialogTarget.hidden = true; clearTarget(dialogTarget);
      if (managementTrigger?.isConnected) managementTrigger.focus({ preventScroll: true });
      managementTrigger = null; old.dismissed?.(); return;
    }
    if (dialogTarget && setupGuide) {
      setupGuide = null;
      render(null, dialogTarget);
      dialogTarget.hidden = true;
      clearTarget(dialogTarget);
      if (setupGuideTrigger?.isConnected) setupGuideTrigger.focus({ preventScroll: true });
      setupGuideTrigger = null;
      return;
    }
    if (vncCredentialResolve) { releaseVncCredentialDialog(); return; }
    if (!dialogTarget || !dialog) return;
    const complete = dialogResolve;
    const cancelled = dialog.kind === 'input' ? '' : false;
    render(null, dialogTarget);
    dialogTarget.hidden = true;
    dialogTarget.classList.remove('terma-vue-root', 'terma-remote-root');
    dialogTarget.removeAttribute('data-theme');
    dialogTarget.removeAttribute('data-i18n-skip');
    dialog = null;
    dialogResolve = null;
    dialogPaint = null;
    if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
    dialogTrigger = null;
    complete?.(cancelled);
  };
  const openDialog = (next: NonNullable<typeof dialog>, signal?: AbortSignal) => new Promise<string | boolean>(resolve => {
    if (signal?.aborted) return resolve(next.kind === 'input' ? '' : false);
    if (!dialogTarget) return resolve(next.kind === 'input' ? '' : false);
    releaseDialog();
    const activeModal = document.getElementById('modal')!;
    terminalServices.termaTerminalViews?.releaseDialog();
    dialogTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    quickServices.termaQuickViews?.release(activeModal);
    connectionsServices.termaConnectionViews?.release(activeModal);
    unmountSettingsDialog();
    workspaceServices.termaWorkspaceViews?.unmountDialog();
    dialog = next;
    const cancelOwned = () => { if (dialog === next) releaseDialog(); };
    signal?.addEventListener('abort', cancelOwned, {once:true});
    dialogAbortOff = () => signal?.removeEventListener('abort', cancelOwned);
    dialogTarget.replaceChildren();
    dialogResolve = resolve;
    dialogTarget.hidden = false;
    dialogTarget.classList.add('terma-vue-root', 'terma-remote-root');
    dialogTarget.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    dialogTarget.setAttribute('data-i18n-skip', '');
    const finish = (value: string | boolean) => {
      const complete = dialogResolve;
      dialogResolve = null;
      releaseDialog();
      complete?.(value);
    };
    dialogPaint = () => { if (dialog) renderFtpDialog(dialogTarget, dialog, finish); };
    refreshDialogLabels();
    queueMicrotask(() => {
      const field = dialogTarget.querySelector<HTMLInputElement>('#ftpDialogInput');
      if (field) { field.focus(); field.select(); }
      else dialogTarget.querySelector<HTMLButtonElement>('.actions button:last-child')?.focus();
    });
  });
  remoteServices.termaRemoteViews = {
    detachedVncRoot,
    promptClipboardHelper: clipboard.prompt,
    refreshClipboardHelper: clipboard.refresh,
    finishClipboardHelper: clipboard.finish,
    promptClipboardText: clipboard.text,
    promptAdmin: admin.prompt,
    renderLinuxDesktop(target, options) { prepareTarget(target); const paint=()=>renderLinuxDesktop(target, options); paints.set(target,paint); paint(); },
    renderLinuxTask(target, options) { prepareTarget(target); const paint=()=>renderLinuxTask(target, options); paints.set(target,paint); paint(); },
    renderFtp(target, options) {
      currentOptions = options;
      target.classList.add('terma-vue-root', 'terma-remote-root');
      target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      target.setAttribute('data-i18n-skip', '');
      const paint = () => render(ftpView(options), target);
      paints.set(target, paint);
      paint();
      refreshDialogLabels();
    },
    renderTerminal(target, options) {
      target.classList.add('terma-vue-root', 'terma-remote-root');
      target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      target.setAttribute('data-i18n-skip', '');
      const paint = () => renderRemoteTerminal(target, options);
      paints.set(target, paint); paint();
    },
    renderCredentials(target, options) {
      target.classList.add('terma-vue-root', 'terma-remote-root');
      target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      target.setAttribute('data-i18n-skip', '');
      const paint = () => renderRemoteCredentials(target, options);
      paints.set(target, paint); paint();
    },
    renderDesktopLaunch(target, options) {
      prepareTarget(target);
      const paint = () => renderRemoteDesktopLaunch(target, options);
      paints.set(target, paint); paint();
    },
    updateDesktopLaunch(target, state) {
      updateRemoteDesktopLaunch(target, state);
    },
    renderVncWorkspace(target, options) {
      prepareTarget(target);
      const paint = () => renderRemoteVncWorkspace(target, options);
      paints.set(target, paint); paint();
    },
    renderManagement(target, options) {
      prepareTarget(target);
      managementTargets.add(target);
      const paint = () => renderManagement(target, options);
      paints.set(target, paint); paint();
    },
    showManagement(options) {
      terminalServices.termaTerminalViews?.releaseDialog();
      if (!dialogTarget) return;
      releaseDialog();
      quickServices.termaQuickViews?.release(dialogTarget);
      connectionsServices.termaConnectionViews?.release(dialogTarget);
      unmountSettingsDialog();
      workspaceServices.termaWorkspaceViews?.unmountDialog();
      managementTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialogTarget.replaceChildren();
      management = options; prepareTarget(dialogTarget);
      dialogTarget.hidden = false; dialogTarget.onclick = null; dialogTarget.onkeydown = null;
      renderManagement(dialogTarget, options, true);
      queueMicrotask(() => { if (management === options) dialogTarget.querySelector<HTMLButtonElement>('button')?.focus(); });
    },
    refreshManagement() { if (dialogTarget && management) renderManagement(dialogTarget, management, true); },
    showSetupGuide(options) {
      terminalServices.termaTerminalViews?.releaseDialog();
      if (!dialogTarget) return;
      releaseDialog();
      quickServices.termaQuickViews?.release(dialogTarget);
      connectionsServices.termaConnectionViews?.release(dialogTarget);
      unmountSettingsDialog();
      workspaceServices.termaWorkspaceViews?.unmountDialog();
      setupGuideTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialogTarget.replaceChildren();
      setupGuide = options;
      prepareTarget(dialogTarget);
      dialogTarget.hidden = false;
      dialogTarget.onclick = null;
      renderRemoteSetupGuide(dialogTarget, options);
      queueMicrotask(() => dialogTarget.querySelector<HTMLButtonElement>('.actions button')?.focus());
    },
    promptVncCredentials(options, owner) {
      terminalServices.termaTerminalViews?.releaseDialog();
      if (!dialogTarget) return Promise.resolve(null);
      releaseDialog();
      const activeModal = document.getElementById('modal')!;
      quickServices.termaQuickViews?.release(activeModal);
      connectionsServices.termaConnectionViews?.release(activeModal);
      unmountSettingsDialog();
      workspaceServices.termaWorkspaceViews?.unmountDialog();
      vncCredentialOptions = options;
      vncCredentialOwner = owner;
      vncCredentialTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialogTarget.replaceChildren();
      dialogTarget.hidden = false;
      prepareTarget(dialogTarget);
      return new Promise(resolve => {
        vncCredentialResolve = resolve;
        const current = () => vncCredentialOptions === options && vncCredentialResolve === resolve;
        const finish = (value: VncCredentialResult | null) => {if (current()) releaseVncCredentialDialog(value);};
        const submit = () => {
          if (!current()) return;
          if (!options.allowNoPassword && !options.password) {
            options.invalidPassword();
            dialogTarget.querySelector<HTMLInputElement>('#vncCredentialPassword')?.focus();
            return;
          }
          finish({
            credentials: {username: options.username || '', target: options.target || '', password: options.password || ''},
            allow_no_password: options.allowNoPassword,
            update_saved_password: Boolean(!options.allowNoPassword && options.savePassword)
          });
        };
        vncCredentialPaint = () => {
          if (!current()) return;
          renderVncCredentialDialog(dialogTarget, {
            ...options, labels: options.labels(), submit, cancel: () => finish(null)
          });
          refreshIcons?.();
        };
        vncCredentialPaint();
        queueMicrotask(() => {if (current()) dialogTarget.querySelector<HTMLInputElement>('#vncCredentialPassword, #vncCredentialUsername, #vncCredentialTarget')?.focus();});
      });
    },
    refreshVncCredentials(options) { if (vncCredentialOptions === options) vncCredentialPaint?.(); },
    cancelVncCredentials(owner) { if (vncCredentialOwner === owner) releaseVncCredentialDialog(); },
    promptInput(options) {
      return openDialog({ kind: 'input', intent: options.intent, title: options.title, label: options.label, value: options.defaultValue || '', confirmText: options.confirmText, cancelText: options.cancelText }, options.ownerSignal) as Promise<string>;
    },
    confirm(options) {
      return openDialog({ kind: 'confirm', intent: options.intent, name: options.name, suffix: options.suffix, title: options.title, message: options.message, confirmText: options.confirmText, cancelText: options.cancelText, danger: options.danger }, options.ownerSignal) as Promise<boolean>;
    },
    release(target) {
      for (const child of [...paints.keys()]) if (child !== target && target.contains(child)) {
        render(null, child); paints.delete(child); managementTargets.delete(child); clearTarget(child);
      }
      if (target === dialogTarget && (setupGuide || dialog || vncCredentialResolve || management)) { releaseDialog(); return; }
      if(!paints.has(target)) return;
      render(null, target);
      paints.delete(target);
      managementTargets.delete(target);
      clearTarget(target);
    },
    releaseDialog
  };
  new MutationObserver(() => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    for (const target of paints.keys()) target.dataset.theme = theme;
    if (dialogTarget && (dialog || vncCredentialResolve || setupGuide || management)) dialogTarget.dataset.theme = theme;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('terma:language-changed', () => {
    vncCredentialPaint?.();
    if (dialogTarget && setupGuide) renderRemoteSetupGuide(dialogTarget, setupGuide);
    for (const target of [...managementTargets]) {
      if (target.isConnected) paints.get(target)?.();
      else { render(null, target); paints.delete(target); managementTargets.delete(target); }
    }
    if (dialogTarget && management) renderManagement(dialogTarget, management, true);
  });
  if (dialogTarget) new MutationObserver(() => { if (dialogTarget.hidden && management) releaseDialog(); }).observe(dialogTarget, { attributes: true, attributeFilter: ['hidden'] });
}

export interface InstalledFeaturesRemoteRemoteFtpViewServices {
  termaRemoteViews?: {
      detachedVncRoot(): HTMLElement;
      renderFtp(target: HTMLElement, options: RemoteFtpRenderOptions): void;
      renderTerminal(target: HTMLElement, options: RemoteTerminalOptions): void;
      renderCredentials(target: HTMLElement, options: RemoteCredentialOptions): void;
      renderDesktopLaunch(target: HTMLElement, options: RemoteDesktopLaunchOptions): void;
      updateDesktopLaunch(target: HTMLElement, state: RemoteDesktopLaunchState): void;
      renderVncWorkspace(target: HTMLElement, options: RemoteVncWorkspaceOptions): void;
      showSetupGuide(options: RemoteSetupGuideOptions): void;
      renderManagement(target: HTMLElement, options: ManagementOptions): void;
      showManagement(options: ManagementOptions): void;
      refreshManagement(): void;
      promptAdmin(options: RemoteAdminOptions): Promise<{ admin_grant_id: string } | null>;
      promptClipboardHelper(options: ClipboardHelperOptions): Promise<ClipboardResult>;
      refreshClipboardHelper(options: ClipboardHelperOptions): void;
      finishClipboardHelper(options: ClipboardHelperOptions, value: ClipboardResult): void;
      promptClipboardText(options: ClipboardTextOptions): Promise<string | null>;
      renderLinuxDesktop(target: HTMLElement, options: LinuxDesktopOptions): void;
      renderLinuxTask(target: HTMLElement, options: LinuxTaskOptions): void;
      promptVncCredentials(options: VncCredentialPromptOptions, owner?: VncSession): Promise<VncCredentialResult | null>;
      refreshVncCredentials(options: VncCredentialPromptOptions): void;
      cancelVncCredentials(owner: VncSession): void;
      promptInput(options: { intent: 'create' | 'rename'; title: string; label: string; defaultValue?: string; confirmText: string; cancelText: string; ownerSignal?:AbortSignal }): Promise<string>;
      confirm(options: { intent: 'delete'; name: string; suffix: string; title: string; message: string; confirmText: string; cancelText: string; danger?: boolean; ownerSignal?:AbortSignal }): Promise<boolean>;
      release(target: HTMLElement): void;
      releaseDialog(): void;
    };
}
