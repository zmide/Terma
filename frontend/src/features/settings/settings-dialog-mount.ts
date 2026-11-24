import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import { Fragment, h, render, type VNode } from 'vue';
import { renderSettingsDialog } from './dialog-views';
import type { SettingsDialogKind, SettingsDialogPort } from './settings-dialog-port';
import { installSettingsRequestLifecycles } from './settings-request-lifecycle';

let closeDialog: (() => void) | undefined;
let current: { target: HTMLElement; kind: SettingsDialogKind; scope: SettingsDialogPort; values: Record<string, any>; trigger: HTMLElement | null; cleanup: () => void } | null = null;


function paint() {
  if (!current) return;
  const { target, kind, scope, values } = current;
  if (values.localize) Object.assign(values, values.localize());
  render(h(Fragment, null, renderSettingsDialog(kind, scope, values) as VNode[]), target);
  const card = target.querySelector<HTMLElement>('.modal-card');
  if (card) {
    card.setAttribute('role', kind === 'choice' || kind === 'host-trust' ? 'alertdialog' : 'dialog');
    card.setAttribute('aria-modal', 'true');
    const title = card.querySelector('h2');
    if (title) { title.id ||= 'settingsDialogTitle'; card.setAttribute('aria-labelledby', title.id); }
  }
}

export function installSettingsDialogs(close: () => void) {
  closeDialog = close;
  installSettingsRequestLifecycles();
  window.addEventListener('terma:language-changed', () => refreshSettingsDialog({}));
}

export function unmountSettingsDialog() {
  if (!current) return;
  const old = current; current = null;
  old.cleanup(); render(null, old.target);
  old.target.classList.remove('terma-vue-root', 'terma-settings-dialog');
  delete old.target.dataset.termaSettingsDialog;
  old.target.removeAttribute('data-i18n-skip');
  if (old.trigger?.isConnected) old.trigger.focus({ preventScroll: true });
  old.values.dismiss?.();
}

export function openSettingsDialog(kind: SettingsDialogKind, values: Record<string, any>) {
  const target = $('modal');
  if (!target || !closeDialog) throw new Error(tr('settings:auto.loading'));
  const scope: SettingsDialogPort = {tr, $: id => target.querySelector<HTMLInputElement>(`#${id}`), closeModal: closeDialog, get connections() { return applicationState.connections; }};
  terminalServices.termaTerminalViews?.releaseDialog();
  remoteServices.termaRemoteViews?.releaseDialog();
  connectionsServices.termaConnectionViews?.release(target);
  quickServices.termaQuickViews?.release(target, { preserveQuickSshSubmission: kind === 'host-trust' });
  workspaceServices.termaWorkspaceViews?.unmountDialog();
  const trigger = current?.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  unmountSettingsDialog();
  target.replaceChildren();
  const dismiss = () => { if (values.finish) values.finish(kind === 'host-trust' ? null : kind === 'input' ? '' : values.actions?.find((action: any) => action.value === false)?.value); else scope.closeModal(); };
  const keydown = (event: KeyboardEvent) => {
    if (target.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!values.escapeDisabled) dismiss(); return; }
    if (event.key !== 'Tab' || quickServices.termaCommandNavigation?.contains(target)) return;
    const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.checkVisibility());
    const first = fields[0], last = fields.at(-1);
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keydown, true);
  const observer = new MutationObserver(() => {
    target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    if (target.hidden) unmountSettingsDialog();
  });
  observer.observe(target, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  current = { target, kind, scope, values, trigger, cleanup: () => { document.removeEventListener('keydown', keydown, true); observer.disconnect(); } };
  target.classList.add('terma-vue-root', 'terma-settings-dialog');
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  target.dataset.termaSettingsDialog = kind;
  target.setAttribute('data-i18n-skip', ''); target.onclick = null; target.onkeydown = null; target.hidden = false;
  paint();
  queueMicrotask(() => {
    if (current?.values !== values) return;
    const cancelIndex = kind === 'choice' ? values.actions?.findIndex((action: any) => action.value === false) : -1;
    const cancel = cancelIndex >= 0 ? target.querySelector<HTMLElement>(`button[data-choice="${cancelIndex}"]`) : null;
    const initial = typeof values.initialFocus === 'string'
      ? target.querySelector<HTMLElement>(values.initialFocus)
      : null;
    (initial || cancel || target.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled)'))?.focus();
  });
}

export function refreshSettingsDialog(values: Record<string, any>) {
  if (!current) return;
  const { target } = current;
  const focused = document.activeElement;
  const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
  const scroll = [...target.querySelectorAll<HTMLElement>('*')].filter(element => element.scrollTop || element.scrollLeft).map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  const fields = [...target.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].filter(field => field.id !== 'sshKeyBits' || !('wizardType' in values)).map(field => ({ field, value: field.value, checked: field instanceof HTMLInputElement ? field.checked : undefined }));
  Object.assign(current.values, values); paint();
  for (const { field, value, checked } of fields) {
    if (!field.isConnected) continue;
    field.value = value; if (checked !== undefined && field instanceof HTMLInputElement) field.checked = checked;
  }
  if (focused instanceof HTMLElement && target.contains(focused)) {
    focused.focus({ preventScroll: true });
    if (selection?.start != null && selection.end != null && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
      try { focused.setSelectionRange(selection.start, selection.end, selection.direction || undefined); } catch { /* Number inputs do not expose a text range. */ }
    }
  }
  for (const item of scroll) if (item.element.isConnected) { item.element.scrollTop = item.top; item.element.scrollLeft = item.left; }
}
