import {filesServices} from '@/features/files/installed-services';
import {tr as translateWorkspace} from '@/shared/i18n/workspace-bootstrap';
import { formatFileBytes as formatBytes } from '@/shared/format-file-bytes';
import { h, render, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';
import { editorDiff, type EditorDiff } from './editor-document';
import '@/styles/sftp.css';

type ComparisonSession = {status?:string;remote_path?:string};
type Comparison = {old_text:string;new_text:string;remote_path?:string;remote_changed_at?:number;local_changed_at?:number;old_size?:number;new_size?:number};
type Owner = { host: HTMLElement; modal: HTMLElement; session: ComparisonSession; comparison: Comparison; resolve: (value: string) => void; cleanup: () => void };
let current: Owner | null = null;

function tr(key: string, fallback: string, params?: Record<string, unknown>) {
  const value = translateWorkspace(`sftp:${key}`, { ...params, defaultValue: fallback });
  return typeof value === 'string' ? value : fallback;
}

function displayTime(value: unknown) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString(document.documentElement.lang || 'zh-CN', { hour12: false }) : tr('diff.time_unknown', '时间未知');
}

function diffView(model: EditorDiff): VNodeChild {
  if (model.unavailable) return h('div', { class: 'sftp-diff-unavailable' }, model.message);
  if (!model.hasChanges) return h('div', { class: 'sftp-side-diff no-changes' }, [
    h('div', { class: 'sftp-diff-columns' }, [h('strong', null, model.oldLabel), h('strong', null, model.newLabel)]),
    h('div', { class: 'sftp-diff-unavailable' }, tr('diff.same_content', '两个版本内容相同。'))
  ]);
  return h('div', { class: 'sftp-side-diff' }, [
    h('div', { class: 'sftp-diff-columns' }, [h('strong', null, model.oldLabel), h('strong', null, model.newLabel)]),
    ...model.rows.map((row, index) => {
      if ('collapsed' in row) return h('div', { key: `collapsed-${index}`, class: 'sftp-diff-collapsed' }, row.collapsed);
      return h('div', { key: `diff-${index}`, class: ['sftp-diff-row', row.changed ? 'changed' : ''] }, row.cells.map((cell, cellIndex) =>
        h('div', { key: cellIndex, class: ['sftp-diff-cell', cell.kind] }, [h('span', null, cell.number), h('code', null, cell.text || ' ')])
      ));
    })
  ]);
}

function finish(owner: Owner, value = '', hideModal = true) {
  if (current !== owner) return;
  current = null;
  owner.cleanup();
  render(null, owner.host);
  const stillOwnsModal = owner.host.parentElement === owner.modal;
  owner.host.remove();
  if (hideModal && stillOwnsModal) owner.modal.hidden = true;
  owner.resolve(value);
}

function paint(owner: Owner, preserveInteraction = false) {
  const focusedKey = preserveInteraction && owner.host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
  const scrollTop = preserveInteraction ? owner.host.querySelector<HTMLElement>('.sftp-comparison-body')?.scrollTop || 0 : 0;
  const conflict = owner.session.status === 'conflict';
  const comparison = owner.comparison;
  const remoteLabel = tr('diff.remote_current', '远端当前版本');
  const localLabel = tr('diff.external_content', '外部编辑内容');
  const vendor = window as unknown as { Diff?: { diffLines: Parameters<typeof editorDiff>[3]['diffLines'] } };
  const model = editorDiff(comparison.old_text, comparison.new_text, { oldLabel: remoteLabel, newLabel: localLabel }, {
    diffLines: (...args) => vendor.Diff?.diffLines(...args),
    tr: (key, params) => translateWorkspace(key, params),
    bytes: formatBytes
  });
  const remotePath = comparison.remote_path || owner.session.remote_path || '';
  render(h('section', { class: 'modal-card sftp-comparison-modal sftp-vue-comparison-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sftpVueCompareTitle' }, [
    h('header', { class: 'sftp-comparison-head' }, [
      h('div', null, [h('h2', { id: 'sftpVueCompareTitle', title: remotePath }, remotePath), h('span', null, tr('diff.confirm_changes', '覆盖前请确认左右两侧的变化'))]),
      h(TermaButton, { type: 'button', class: 'icon-button', 'data-focus-key': 'close', title: tr('diff.close', '关闭'), 'aria-label': tr('diff.close', '关闭'), onClick: () => finish(owner) }, () => settingsIcon('x'))
    ]),
    h('div', { class: 'sftp-comparison-meta' }, [
      h('span', null, [h('b', null, remoteLabel), `${displayTime(comparison.remote_changed_at)} · ${formatBytes(comparison.old_size ?? 0)}`]),
      h('span', null, [h('b', null, localLabel), `${displayTime(comparison.local_changed_at)} · ${formatBytes(comparison.new_size ?? 0)}`])
    ]),
    h('div', { class: 'sftp-comparison-body' }, [diffView(model)]),
    h('footer', { class: 'actions sftp-comparison-actions' }, [
      h(TermaButton, { type: 'button', class: conflict ? 'danger' : 'primary', 'data-focus-key': 'primary', onClick: () => finish(owner, conflict ? 'overwrite' : 'save') }, () => tr(conflict ? 'diff.overwrite_and_backup' : 'diff.save_remote', conflict ? '覆盖并备份远端' : '保存到远端')),
      h(TermaButton, { type: 'button', 'data-focus-key': 'save-as', onClick: () => finish(owner, 'save_as') }, () => tr('diff.save_as', '另存为')),
      h(TermaButton, { type: 'button', 'data-focus-key': 'cancel', onClick: () => finish(owner, 'cancel') }, () => tr('diff.cancel', '取消'))
    ])
  ]), owner.host);
  if (preserveInteraction) {
    const body = owner.host.querySelector<HTMLElement>('.sftp-comparison-body');
    if (body) body.scrollTop = scrollTop;
    if (focusedKey) requestAnimationFrame(() => owner.host.querySelector<HTMLElement>(`[data-focus-key="${focusedKey}"]`)?.focus({ preventScroll: true }));
  }
}

export function installSftpComparisonViews() {
  filesServices.termaSftpComparisonViews = {
    show(session, comparison) {
      return new Promise(resolve => {
        const modal = document.getElementById('modal');
        if (!modal) { resolve(''); return; }
        if (current) finish(current, '', false);
        const host = document.createElement('div');
        host.className = 'terma-vue-root terma-sftp-root terma-sftp-comparison-root';
        host.setAttribute('data-i18n-skip', '');
        modal.replaceChildren(host);
        modal.hidden = false;
        const owner: Owner = { host, modal, session, comparison, resolve, cleanup: () => {} };
        current = owner;
        const keydown = (event: KeyboardEvent) => {
          if (event.key === 'Escape' && current === owner) { event.preventDefault(); event.stopImmediatePropagation(); finish(owner); }
        };
        const refresh = () => {
          if (current !== owner) return;
          host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
          paint(owner, true);
        };
        const observer = new MutationObserver(() => {
          if (current !== owner) return;
          if (modal.hidden || host.parentElement !== modal) finish(owner, '', false);
          else host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['hidden'], childList: true });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        document.addEventListener('keydown', keydown, true);
        window.addEventListener('terma:language-changed', refresh);
        owner.cleanup = () => {
          observer.disconnect();
          document.removeEventListener('keydown', keydown, true);
          window.removeEventListener('terma:language-changed', refresh);
        };
        refresh();
      });
    },
    release() { if (current) finish(current); }
  };
}



export interface InstalledFeaturesFilesSftpSftpComparisonViewsServices {
  termaSftpComparisonViews?: { show(session: ComparisonSession, comparison: Comparison): Promise<string>; release(): void };
}
