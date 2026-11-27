import {efficiencyServices} from '../efficiency/installed-services';
import {createPanelFiles} from './panel-files';
import {createPanelTerminal} from './panel-terminal';
import type {PanelTarget} from './PanelView';
import type {PanelTab} from './panel-model';
import {api} from '@/shared/api/workspace-request';
import {createPerformanceSampler} from './performance-sampler';
import {createPanelPerformance} from './panel-performance';

export function createPanelContents(changed: () => void, text: (key: string) => string) {
  const hosts = new Map<string, HTMLElement>();
  const kinds = new Map<string, PanelTab['kind']>();
  const quick = new Map<string, {host: HTMLElement; target: string}>();
  const files = new Map<string, ReturnType<typeof createPanelFiles>>();
  const terminals = new Map<string, ReturnType<typeof createPanelTerminal>>();
  const performance = new Map<string, ReturnType<typeof createPanelPerformance>>();
  const sampler = createPerformanceSampler({request: (id, signal) => api(`/api/connections/${id}/host-performance`, {signal})});
  function release(key: string, expectedHost?: HTMLElement) {
    const host = hosts.get(key);
    if (expectedHost && host !== expectedHost) return;
    if (host) efficiencyServices.termaEfficiency?.quick.releaseSurface(host);
    hosts.delete(key); quick.delete(key);
    files.get(key)?.unmount(); terminals.get(key)?.sync(null, null);
    performance.get(key)?.unmount();
  }
  function disposeTab(key: string) {
    release(key); files.get(key)?.dispose(); files.delete(key);
    terminals.get(key)?.dispose(); terminals.delete(key);
    performance.get(key)?.dispose(); performance.delete(key);
    kinds.delete(key);
  }
  function mount(tab: PanelTab, host: HTMLElement, target: PanelTarget | null, visible: boolean) {
    if (kinds.has(tab.key) && kinds.get(tab.key) !== tab.kind) disposeTab(tab.key);
    kinds.set(tab.key, tab.kind);
    hosts.set(tab.key, host);
    if (tab.kind === 'performance') {
      if (!performance.has(tab.key)) performance.set(tab.key, createPanelPerformance(tab.key, sampler, text));
      performance.get(tab.key)!.sync(host, target, visible); return;
    }
    if (tab.kind === 'files') {
      if (!files.has(tab.key)) files.set(tab.key, createPanelFiles(tab.key, changed));
      files.get(tab.key)!.sync(host, target, visible); return;
    }
    if (tab.kind === 'terminal') {
      if (!terminals.has(tab.key)) terminals.set(tab.key, createPanelTerminal(tab.key, changed));
      terminals.get(tab.key)!.sync(host, target, visible); return;
    }
    const key = target?.connected ? target.key : '', previous = quick.get(tab.key);
    if (previous?.host === host && previous.target === key) {
      const empty = host.querySelector('[data-panel-empty]'); if (empty) empty.textContent = text('no_session');
      return;
    }
    efficiencyServices.termaEfficiency?.quick.releaseSurface(host);
    quick.set(tab.key, {host, target: key}); host.replaceChildren();
    if (tab.kind === 'commands' && key) {
      const bar = document.createElement('section');
      bar.className = 'terminal-quick-command-bar'; bar.dataset.terminalQuickCommandBar = '';
      bar.dataset.terminalKey = key; host.appendChild(bar);
      efficiencyServices.termaEfficiency.quick.mount(key, host);
    } else {
      const empty = document.createElement('p'); empty.className = 'terminal-panel-empty';
      empty.dataset.panelEmpty = ''; empty.textContent = text('no_session'); host.appendChild(empty);
    }
  }
  return {mount, release, disposeTab, controls: (tab: PanelTab) => terminals.get(tab.key)?.controls() || files.get(tab.key)?.controls() || null,
    reconcile(tabs: PanelTab[]) {
      const keys = new Set(tabs.map(tab => tab.key));
      for (const key of kinds.keys()) if (!keys.has(key) || tabs.find(tab => tab.key === key)?.kind !== kinds.get(key)) disposeTab(key);
    },
    dispose() {for (const key of new Set([...hosts.keys(), ...files.keys(), ...terminals.keys(), ...performance.keys()])) disposeTab(key); sampler.dispose();}
  };
}
