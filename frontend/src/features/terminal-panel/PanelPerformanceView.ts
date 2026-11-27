import {h, render} from 'vue';
import type {PerformanceSampleState} from './performance-sampler';

export interface PanelPerformanceState {
  connected: boolean; savedTarget: boolean; sort: 'cpu' | 'memoryBytes'; sample: PerformanceSampleState;
}
export function paintPanelPerformance(host: HTMLElement, state: PanelPerformanceState,
  text: (key: string) => string, sort: (column: 'cpu' | 'memoryBytes') => void) {
  const snapshot = state.sample.snapshot;
  const number = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toFixed(1);
  const memory = (value: number | undefined) => value === undefined ? '—' : `${(value / 1048576).toFixed(0)} MB`;
  const processes = snapshot?.processes.slice().sort((a, b) => b[state.sort] - a[state.sort] || a.pid - b.pid) || [];
  render(h('div', {class: 'panel-performance'}, [
    h('div', {class: 'panel-performance-toolbar'}, [
      h('span', {role: 'status', 'data-panel-performance-status': ''}, text(!state.savedTarget ? 'performance_saved_target' : !state.connected ? 'performance_disconnected'
        : snapshot?.supported === false ? 'sampling_unavailable' : state.sample.error ? 'performance_failed'
        : state.sample.loading ? 'sampling' : 'sampling_live')),
      snapshot ? h('time', {datetime: new Date(snapshot.sampledAt).toISOString(), title: text('last_sample')},
        new Date(snapshot.sampledAt).toLocaleTimeString(document.documentElement.lang)) : null
    ]),
    snapshot && !snapshot.supported ? h('p', {class: 'terminal-panel-empty'}, text('performance_unsupported')) : [
      h('dl', {class: 'panel-performance-metrics'}, [
        h('div', null, [h('dt', null, text('cpu')), h('dd', null, `${number(snapshot?.cpuPercent)}${snapshot?.cpuPercent == null ? '' : ' %'}`)]),
        h('div', null, [h('dt', null, text('memory')), h('dd', null, `${memory(snapshot?.memory.usedBytes)} / ${memory(snapshot?.memory.totalBytes)}`)]),
        h('div', null, [h('dt', null, text('load')), h('dd', null, snapshot?.load.map(value => number(value)).join(' · ') || '—')])
      ]),
      h('div', {class: 'panel-performance-processes'}, h('table', null, [
        h('thead', null, h('tr', null, [
          h('th', {scope: 'col'}, 'PID'), h('th', {scope: 'col'}, text('process_name')),
          ...(['cpu', 'memoryBytes'] as const).map(column => h('th', {scope: 'col'}, h('button',
            {type: 'button', 'data-panel-process-sort': column, onClick: () => sort(column)},
            `${text(column === 'cpu' ? 'cpu' : 'memory')}${state.sort === column ? ' ↓' : ''}`)))
        ])),
        h('tbody', null, processes.map(process => h('tr', {key: process.pid, 'data-panel-process': process.pid}, [
          h('td', null, process.pid), h('td', {title: process.name, 'data-i18n-skip': ''}, process.name),
          h('td', null, `${number(process.cpu)} %`), h('td', null, memory(process.memoryBytes))
        ])))
      ]))
    ]
  ]), host);
}
export const releasePanelPerformance = (host: HTMLElement) => render(null, host);
