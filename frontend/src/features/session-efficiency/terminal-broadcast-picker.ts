import {efficiencyServices} from '@/features/efficiency/installed-services';
import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import type {SessionTab} from './session-model';

export interface TerminalBroadcastPickerPort {
  tabs(): SessionTab[];
  tr(key: string): string;
  beforeOpen(): void;
  notify(key: string, type: 'info' | 'error' | 'success', error?: unknown): void;
  broadcastUpdated(keys: string[]): void;
}

export function openTerminalBroadcastPicker(port: TerminalBroadcastPickerPort) {
  const service = efficiencyServices.termaTerminalBroadcast;
  if (!service) return;

  const terminalTabs = port.tabs().filter(tab => tab.kind === 'terminal');
  if (terminalTabs.length < 2) {
    port.notify('common:notifications.terminal_broadcast_minimum', 'info');
    return;
  }

  const {state, setTargets} = service;
  const selected = new Set(state.targets.size ? state.targets : terminalTabs.map(tab => tab.key));
  const t = port.tr;
  function start() {
    if (!binding.alive()) return;
    const targets = port.tabs().filter(tab => tab.kind === 'terminal' && selected.has(tab.key)).map(tab => tab.key);
    if (targets.length < 2) {
      port.notify('common:notifications.terminal_sync_minimum', 'info');
      return;
    }
    const keys = setTargets(targets);
    binding.close();
    port.broadcastUpdated(keys);
  }

  port.beforeOpen();
  const binding: ModalBinding = showOperationsModal(() => h('section', {
    class: 'modal-card terminal-broadcast-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'terminalBroadcastTitle'
  }, [
    h('h2', {id: 'terminalBroadcastTitle'}, t('terminal:broadcast.title')),
    h('div', {id: 'terminalBroadcastTargetLabel'}, t('terminal:broadcast.select_targets')),
    h('div', {
      class: 'snippet-target-grid terminal-broadcast-target-grid',
      role: 'group',
      'aria-labelledby': 'terminalBroadcastTargetLabel'
    }, terminalTabs.map(tab => h('label', {key: tab.key, class: 'checkline snippet-target-option', title: tab.title}, [
      h('input', {
        name: 'broadcastTarget',
        type: 'checkbox',
        value: tab.key,
        checked: selected.has(tab.key),
        onChange: (event: Event) => {
          if ((event.currentTarget as HTMLInputElement).checked) selected.add(tab.key);
          else selected.delete(tab.key);
        }
      }),
      h('span', {class: 'snippet-target-name'}, tab.title)
    ]))),
    h('div', {class: 'actions'}, [
      h(TermaButton, {id: 'terminalBroadcastStart', class: 'primary', onClick: start}, () => t('terminal:broadcast.start')),
      h(TermaButton, {id: 'terminalBroadcastCancel', onClick: () => binding.close()}, () => t('common:actions.cancel'))
    ])
  ]), () => {});
}
