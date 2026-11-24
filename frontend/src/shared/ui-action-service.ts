import {sharedServices} from '@/shared/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
export type BusyLabel = string | (() => string);
type ActionControl = HTMLElement & { disabled?: boolean };

interface UiActionPort {
  document: Document;
  processingText(): string;
}

export function createUiActionService(port: UiActionPort) {
  const locks = new Set<string>();
  const originals = new WeakMap<ActionControl, { children: Node[]; disabled: boolean }>();
  const actionKey = (key: unknown) => String(key || '').trim();

  function setButtonBusy(button: ActionControl | null | undefined, busy: boolean, text?: BusyLabel) {
    if (!button) return;
    if (button.hasAttribute('data-terma-button')) {
      button.dispatchEvent(new CustomEvent('terma-button-busy', { detail: { busy: Boolean(busy), text } }));
      return;
    }
    if (busy) {
      if (!originals.has(button)) originals.set(button, {
        children: [...button.childNodes],
        disabled: button.dataset.uiActionLockDisabled === 'true'
          ? button.dataset.uiActionLockWasDisabled === 'true' : Boolean(button.disabled)
      });
      button.textContent = typeof text === 'function' ? text() : text || '';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      return;
    }
    const original = originals.get(button);
    if (original) {
      button.replaceChildren(...original.children);
      originals.delete(button);
    }
    button.disabled = Boolean(original?.disabled || button.dataset.uiActionLockDisabled === 'true');
    if (button.dataset.uiActionLockDisabled !== 'true') button.removeAttribute('aria-busy');
  }

  function syncControls(key: unknown, busy: boolean) {
    const normalized = actionKey(key);
    if (!normalized) return;
    for (const control of port.document.querySelectorAll<ActionControl>('[data-ui-action-key]')) {
      if (control.dataset.uiActionKey !== normalized) continue;
      if (busy) {
        if (control.dataset.uiActionLockDisabled !== 'true') {
          control.dataset.uiActionLockDisabled = 'true';
          control.dataset.uiActionLockWasDisabled = (originals.get(control)?.disabled ?? control.disabled) ? 'true' : 'false';
        }
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
      } else {
        if (control.dataset.uiActionLockDisabled !== 'true') continue;
        control.disabled = control.dataset.uiActionLockWasDisabled === 'true'
          || control.dataset.uiActionBusy === 'true' || originals.has(control);
        delete control.dataset.uiActionLockDisabled;
        delete control.dataset.uiActionLockWasDisabled;
        if (control.dataset.uiActionBusy !== 'true' && !originals.has(control)) control.removeAttribute('aria-busy');
      }
      if (control.hasAttribute('data-terma-button')) {
        control.dispatchEvent(new CustomEvent('terma-button-action-lock', { detail: { busy } }));
      }
    }
  }

  function begin(key: unknown, button: ActionControl | null = null, text: BusyLabel = '') {
    const normalized = actionKey(key);
    if ((normalized && locks.has(normalized)) || button?.dataset.uiActionBusy === 'true') return false;
    if (normalized) {
      locks.add(normalized);
      syncControls(normalized, true);
    }
    if (button) {
      button.dataset.uiActionBusy = 'true';
      setButtonBusy(button, true, text || (() => port.processingText()));
    }
    return true;
  }

  function end(key: unknown, button: ActionControl | null = null) {
    const normalized = actionKey(key);
    if (normalized) locks.delete(normalized);
    if (button?.dataset.uiActionBusy === 'true') {
      delete button.dataset.uiActionBusy;
      setButtonBusy(button, false);
    }
    if (normalized) syncControls(normalized, false);
  }

  return { setButtonBusy, syncControls, begin, end, isInFlight: (key: unknown) => locks.has(actionKey(key)) };
}

export function installUiActionService() {
  sharedServices.termaUiActions ??= createUiActionService({
    document,
    processingText: () => tr!('common:auto.processing', { defaultValue: '处理中...' })
  });
}




export const setButtonBusy=(...args:Parameters<(typeof sharedServices)['termaUiActions']['setButtonBusy']>)=>sharedServices.termaUiActions.setButtonBusy(...args);
export const syncUiActionControls=(...args:Parameters<(typeof sharedServices)['termaUiActions']['syncControls']>)=>sharedServices.termaUiActions.syncControls(...args);
export const beginUiAction=(...args:Parameters<(typeof sharedServices)['termaUiActions']['begin']>)=>sharedServices.termaUiActions.begin(...args);
export const endUiAction=(...args:Parameters<(typeof sharedServices)['termaUiActions']['end']>)=>sharedServices.termaUiActions.end(...args);
export const isUiActionInFlight=(...args:Parameters<(typeof sharedServices)['termaUiActions']['isInFlight']>)=>sharedServices.termaUiActions.isInFlight(...args);

export interface InstalledSharedUiActionServiceServices {
  termaUiActions: ReturnType<typeof createUiActionService>;
}
