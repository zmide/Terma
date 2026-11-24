import {filesServices} from '@/features/files/installed-services';
import { h, render, type VNode } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from '@/features/settings/settings-icon';
import '@/styles/sftp.css';

type EditorOption = { value: string; label: string; disabled?: boolean };

type EditorLabels = {
  encoding: string;
  lineEnding: string;
  language: string;
  automaticLanguage: string;
  wordWrap: string;
  search: string;
  searchPrevious: string;
  searchNext: string;
  toggleReplace: string;
  replaceWith: string;
  replace: string;
  replaceAll: string;
  close: string;
  minimize: string;
  fullscreen: string;
  editorAria: string;
  resizeDiffAria: string;
  resizeWindowAria: string;
  backupBeforeSave: string;
  persistEncoding: string;
  compareVersion: string;
  historyCount: string;
  loadingBackups: string;
  noComparableBackups: string;
  formatJson: string;
  previewDiff: string;
  save: string;
  shortcut: string;
  svgMode: string;
  svgAutoFocus: string;
  zoomOut: string;
  zoomReset: string;
  zoomIn: string;
  resizeSvgPreviewAria: string;
};

export type SftpEditorModel = {
  title: string;
  sourceLabel: string;
  stats: string;
  encoding: string;
  lineEnding: string;
  detectedLanguage: string;
  wordWrap: boolean;
  persistEncoding: boolean;
  encodingOptions: EditorOption[];
  lineEndingOptions: EditorOption[];
  languageOptions: EditorOption[];
  historyOptions: EditorOption[];
  historyDisabled: boolean;
  historyLoading: boolean;
  historyCount: string;
  svg?: { mode: string; modeOptions: EditorOption[] };
  labels: EditorLabels;
};

type EditorOwner = { host: HTMLElement; modal: HTMLElement; snapshot: () => SftpEditorModel; disposeResize: () => void };
const owners = new Map<HTMLElement, EditorOwner>();

function icon(name: string): VNode {
  return settingsIcon(name);
}

function iconButton(id: string, label: string, iconName: string) {
  return h(TermaButton, {
    id,
    class: 'icon-button',
    type: 'button',
    title: label,
    'aria-label': label
  }, { default: () => icon(iconName) });
}

function selectField(id: string, label: string, options: EditorOption[], value: string, className = '') {
  return h('label', { class: className || undefined }, [
    h('span', null, label),
    h('select', {
      id,
      value,
      'aria-label': label
    }, options.map(option => h('option', {
      value: option.value,
      disabled: option.disabled,
      selected: option.value === value
    }, option.label)))
  ]);
}

function editorView(model: SftpEditorModel) {
  const labels = model.labels;
  const languageOptions: EditorOption[] = [
    { value: 'auto', label: labels.automaticLanguage.replace('{language}', model.detectedLanguage) },
    ...model.languageOptions
  ];
  const historyOptions = model.historyOptions.length
    ? model.historyOptions
    : [{
      value: '',
      label: model.historyLoading ? labels.loadingBackups : labels.noComparableBackups,
      disabled: true
    }];
  return h('div', {
    class: 'modal-card wide sftp-editor-modal floating',
    role: 'dialog',
    'aria-modal': 'false'
  }, [
    h('div', { class: 'sftp-editor-head' }, [
      h('div', { class: 'sftp-editor-title' }, [
        h('h2', { title: model.title }, model.title),
        model.sourceLabel ? h('small', { class: 'sftp-editor-source', title: model.sourceLabel }, model.sourceLabel) : null,
        h('span', { id: 'sftpEditorStats' }, model.stats)
      ]),
      h('div', { class: 'sftp-editor-window-controls' }, [
        iconButton('sftpEditorSearchToggle', labels.search, 'search'),
        iconButton('sftpEditorMinimize', labels.minimize, 'minus'),
        iconButton('sftpEditorFullscreen', labels.fullscreen, 'maximize'),
        iconButton('sftpEditorCloseTop', labels.close, 'x')
      ]),
      h('div', { class: 'sftp-editor-controls' }, [
          selectField('sftpTextEncoding', labels.encoding, model.encodingOptions, model.encoding),
          selectField('sftpLineEnding', labels.lineEnding, model.lineEndingOptions, model.lineEnding),
          selectField('sftpEditorLanguage', labels.language, languageOptions, 'auto'),
          model.svg ? selectField('sftpSvgEditorMode', labels.svgMode, model.svg.modeOptions, model.svg.mode, 'sftp-svg-editor-mode') : null,
          h('label', { class: 'check-row compact' }, [
            h('input', { id: 'sftpEditorWordWrap', type: 'checkbox', checked: model.wordWrap }),
            h('span', null, labels.wordWrap)
          ])
      ])
    ]),
    h('div', { id: 'sftpEditorWorkspace', class: 'sftp-editor-workspace' }, [
      h('div', { id: 'sftpEditorSearchBar', class: 'sftp-editor-search-bar', hidden: true }, [
        h('div', { class: 'sftp-editor-search-row' }, [
          iconButton('sftpEditorReplaceToggle', labels.toggleReplace, 'chevron-right'),
          h('input', { id: 'sftpEditorSearchInput', type: 'search', placeholder: labels.search, 'aria-label': labels.search, autocomplete: 'off' }),
          h('span', { id: 'sftpEditorSearchCount', 'aria-live': 'polite' }),
          iconButton('sftpEditorSearchPrevious', labels.searchPrevious, 'arrow-up'),
          iconButton('sftpEditorSearchNext', labels.searchNext, 'arrow-down'),
          iconButton('sftpEditorSearchClose', labels.close, 'x')
        ]),
        h('div', { id: 'sftpEditorReplaceRow', class: 'sftp-editor-search-row', hidden: true }, [
          h('input', { id: 'sftpEditorReplaceInput', type: 'text', placeholder: labels.replaceWith, 'aria-label': labels.replaceWith, autocomplete: 'off' }),
          h(TermaButton, { id: 'sftpEditorReplaceOne', type: 'button' }, () => labels.replace),
          h(TermaButton, { id: 'sftpEditorReplaceAll', type: 'button' }, () => labels.replaceAll)
        ])
      ]),
      model.svg ? h('div', { id: 'sftpSvgEditorPreview', class: 'sftp-svg-editor-preview', hidden: true }, [
        h('div', { class: 'sftp-svg-editor-preview-toolbar' }, [
          h('div', { class: 'sftp-svg-editor-preview-hint', 'data-svg-preview-source': '', 'aria-live': 'polite' }),
          h('label', { class: 'sftp-svg-editor-preview-auto-focus', title: labels.svgAutoFocus }, [
            h('input', { type: 'checkbox', 'data-svg-preview-auto-focus': '', checked: true }),
            h('span', null, labels.svgAutoFocus)
          ]),
          h('div', { class: 'sftp-svg-editor-preview-zoom' }, [
            h(TermaButton, { class: 'icon-button', title: labels.zoomOut, 'aria-label': labels.zoomOut, 'data-svg-preview-zoom': 'out' }, () => icon('minus')),
            h('span', { 'data-svg-preview-zoom-value': '' }, '100%'),
            h(TermaButton, { class: 'icon-button', title: labels.zoomReset, 'aria-label': labels.zoomReset, 'data-svg-preview-zoom': 'fit' }, () => icon('maximize-2')),
            h(TermaButton, { class: 'icon-button', title: labels.zoomIn, 'aria-label': labels.zoomIn, 'data-svg-preview-zoom': 'in' }, () => icon('plus'))
          ])
        ]),
        h('div', { class: 'sftp-svg-editor-preview-viewport' }, [h('div', { class: 'sftp-svg-editor-preview-stage' })]),
        h('div', { class: 'sftp-svg-editor-preview-marker', 'data-svg-preview-marker': '', hidden: true, 'aria-hidden': 'true' })
      ]) : null,
      model.svg ? h('div', { id: 'sftpSvgEditorSplit', class: 'sftp-editor-svg-splitter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': labels.resizeSvgPreviewAria, tabindex: 0, hidden: true }) : null,
      h('div', { id: 'sftpTextEditor', class: 'sftp-code-editor', 'aria-label': labels.editorAria }),
      h('div', {
        id: 'sftpEditorSplit',
        class: 'sftp-editor-splitter',
        role: 'separator',
        'aria-orientation': 'horizontal',
        'aria-label': labels.resizeDiffAria,
        tabindex: 0,
        hidden: true
      }),
      h('div', { id: 'sftpDiffPreview', class: 'sftp-diff-preview', hidden: true })
    ]),
    h('div', { class: 'sftp-editor-options' }, [
      h('label', { class: 'check-row' }, [
        h('input', { id: 'sftpBackupBeforeSave', type: 'checkbox', checked: true }),
        h('span', null, labels.backupBeforeSave)
      ]),
      h('label', { class: 'check-row' }, [
        h('input', { id: 'sftpPersistEncoding', type: 'checkbox', checked: model.persistEncoding }),
        h('span', null, labels.persistEncoding)
      ]),
      h('label', { class: 'sftp-diff-history-control' }, [
        h('span', null, labels.compareVersion),
        h('select', { id: 'sftpDiffHistory', disabled: model.historyDisabled }, historyOptions.map(option => h('option', {
          value: option.value,
          disabled: option.disabled
        }, option.label))),
        h('small', { id: 'sftpDiffHistoryCount' }, model.historyLoading ? labels.loadingBackups : labels.historyCount)
      ])
    ]),
    h('div', { class: 'actions' }, [
      h(TermaButton, { id: 'sftpTextFormatJson', hidden: true }, { default: () => [icon('braces'), h('span', null, labels.formatJson)] }),
      h(TermaButton, { id: 'sftpTextDiff', disabled: true }, { default: () => labels.previewDiff }),
      h(TermaButton, { class: 'primary', id: 'sftpTextSave' }, { default: () => [h('span', { 'data-editor-save-label': '' }, labels.save), h('span', { class: 'shortcut-hint' }, labels.shortcut)] }),
      h(TermaButton, { id: 'sftpTextClose' }, { default: () => labels.close })
    ]),
    h('div', {
      class: 'sftp-editor-resize-handle',
      role: 'separator',
      'aria-orientation': 'both',
      'aria-label': labels.resizeWindowAria,
      tabindex: 0
    })
  ]);
}

function installResizeHandle(owner: EditorOwner) {
  const handle = owner.host.querySelector<HTMLElement>('.sftp-editor-resize-handle');
  const card = owner.host.querySelector<HTMLElement>('.sftp-editor-modal');
  if (!handle || !card) return () => {};
  let drag: { pointerId: number; x: number; y: number; width: number; height: number } | null = null;
  const clamp = (value: number, min: number, max: number) => Math.max(Math.min(min, max), Math.min(max, value));
  const limits = () => ({
    minWidth: Math.min(window.innerWidth <= 760 ? 300 : 760, window.innerWidth - 16),
    minHeight: Math.min(window.innerWidth <= 760 ? 320 : 560, window.innerHeight - 16),
    maxWidth: window.innerWidth - 16,
    maxHeight: window.innerHeight - 16
  });
  const prepareResize = () => {
    const rect = card.getBoundingClientRect();
    // The window runtime owns fullscreen state, its label and preference.
    if (card.classList.contains('is-fullscreen')) {
      card.dispatchEvent(new CustomEvent('terma:sftp-editor-resize-start'));
    }
    const bound = limits();
    card.style.transform = 'none';
    card.style.left = `${Math.max(8, rect.left)}px`;
    card.style.top = `${Math.max(8, rect.top)}px`;
    card.style.width = `${clamp(rect.width, bound.minWidth, bound.maxWidth)}px`;
    card.style.height = `${clamp(rect.height, bound.minHeight, bound.maxHeight)}px`;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = card.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    handle.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add('sftp-editor-resizing');
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.clientX === drag.x && event.clientY === drag.y) return;
    prepareResize();
    const bound = limits();
    card.style.width = `${Math.round(clamp(drag.width + event.clientX - drag.x, bound.minWidth, bound.maxWidth))}px`;
    card.style.height = `${Math.round(clamp(drag.height + event.clientY - drag.y, bound.minHeight, bound.maxHeight))}px`;
    card.dispatchEvent(new Event('terma:sftp-editor-resized'));
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    document.documentElement.classList.remove('sftp-editor-resizing');
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.shiftKey ? 64 : 16;
    const bound = limits();
    const rect = card.getBoundingClientRect();
    const horizontal = event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0;
    const vertical = event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    prepareResize();
    if (horizontal) card.style.width = `${Math.round(clamp(rect.width + horizontal, bound.minWidth, bound.maxWidth))}px`;
    if (vertical) card.style.height = `${Math.round(clamp(rect.height + vertical, bound.minHeight, bound.maxHeight))}px`;
    card.dispatchEvent(new Event('terma:sftp-editor-resized'));
  };
  handle.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', onKeyDown);
  const scroll = () => { handle.style.translate = `${card.scrollLeft}px ${card.scrollTop}px`; };
  card.addEventListener('scroll', scroll);
  return () => {
    drag = null;
    document.documentElement.classList.remove('sftp-editor-resizing');
    handle.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    handle.removeEventListener('keydown', onKeyDown);
    card.removeEventListener('scroll', scroll);
  };
}

// Only the shell's labels are updated here. Ace, search, history and diff nodes
// are owned by the existing editor runtime and must never be rendered again.
function refreshLabels(owner: EditorOwner) {
  const model = owner.snapshot();
  const labels = model.labels;
  const find = (selector: string) => owner.host.querySelector<HTMLElement>(selector);
  const text = (selector: string, value: string) => { const node = find(selector); if (node) node.textContent = value; };
  const fields = { sftpTextEncoding: labels.encoding, sftpLineEnding: labels.lineEnding, sftpEditorLanguage: labels.language, sftpSvgEditorMode: labels.svgMode };
  for (const [id, label] of Object.entries(fields)) {
    const field = find(`#${id}`);
    field?.setAttribute('aria-label', label);
    const caption = field?.parentElement?.querySelector(':scope > span');
    if (caption) caption.textContent = label;
  }
  for (const [id, label] of Object.entries({
    sftpEditorWordWrap: labels.wordWrap, sftpBackupBeforeSave: labels.backupBeforeSave, sftpPersistEncoding: labels.persistEncoding
  })) text(`#${id} + span`, label);
  text('.sftp-diff-history-control > span', labels.compareVersion);
  text('#sftpTextFormatJson span', labels.formatJson);
  text('[data-editor-save-label]', labels.save);
  text('#sftpTextClose', labels.close);
  for (const [id, label] of Object.entries({
    sftpEditorSearchToggle: labels.search, sftpEditorSearchPrevious: labels.searchPrevious, sftpEditorSearchNext: labels.searchNext,
    sftpEditorReplaceToggle: labels.toggleReplace, sftpEditorSearchClose: labels.close, sftpEditorCloseTop: labels.close, sftpEditorMinimize: labels.minimize
  })) {
    const node = find(`#${id}`);
    node?.setAttribute('title', label);
    node?.setAttribute('aria-label', label);
  }
  for (const [selector, label] of [['#sftpEditorSearchInput', labels.search], ['#sftpEditorReplaceInput', labels.replaceWith]]) {
    const input = find(selector);
    input?.setAttribute('placeholder', label);
    input?.setAttribute('aria-label', label);
  }
  for (const [selector, label] of [['#sftpEditorReplaceOne', labels.replace], ['#sftpEditorReplaceAll', labels.replaceAll]]) {
    const button = find(selector);
    if (button) button.textContent = label;
  }
  find('#sftpTextEditor')?.setAttribute('aria-label', labels.editorAria);
  find('#sftpEditorSplit')?.setAttribute('aria-label', labels.resizeDiffAria);
  const svgMode = find('#sftpSvgEditorMode') as HTMLSelectElement | null;
  svgMode?.setAttribute('aria-label', labels.svgMode);
  for (const option of svgMode?.options || []) {
    const item = model.svg?.modeOptions.find(candidate => candidate.value === option.value);
    if (item) option.textContent = item.label;
  }
  const autoFocus = find('.sftp-svg-editor-preview-auto-focus');
  autoFocus?.setAttribute('title', labels.svgAutoFocus);
  const autoFocusText = find('.sftp-svg-editor-preview-auto-focus span');
  if (autoFocusText) autoFocusText.textContent = labels.svgAutoFocus;
  for (const [action, label] of Object.entries({ out: labels.zoomOut, fit: labels.zoomReset, in: labels.zoomIn })) {
    const button = find(`[data-svg-preview-zoom="${action}"]`);
    button?.setAttribute('title', label);
    button?.setAttribute('aria-label', label);
  }
  find('#sftpSvgEditorSplit')?.setAttribute('aria-label', labels.resizeSvgPreviewAria);
  find('.sftp-editor-resize-handle')?.setAttribute('aria-label', labels.resizeWindowAria);
  const options = [
    ['sftpLineEnding', model.lineEndingOptions],
    ['sftpEditorLanguage', [{ value: 'auto', label: labels.automaticLanguage.replace('{language}', model.detectedLanguage) }, ...model.languageOptions]]
  ] as const;
  for (const [id, items] of options) {
    const select = find(`#${id}`) as HTMLSelectElement | null;
    for (const option of select?.options || []) {
      const item = items.find(candidate => candidate.value === option.value);
      if (item) option.textContent = item.label;
    }
  }
}

function syncTheme(owner: EditorOwner) {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  if (owner.host.dataset.theme === theme) return;
  owner.host.dataset.theme = theme;
  const editor = owner.host.querySelector<HTMLElement>('#sftpTextEditor') as (HTMLElement & { __termaAceEditor?: { setTheme(theme: string): void } }) | null;
  editor?.__termaAceEditor?.setTheme(theme === 'dark' ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate');
}

export function installSftpEditorViews() {
  window.addEventListener('terma:language-changed', () => { for (const owner of owners.values()) refreshLabels(owner); });
  new MutationObserver(() => { for (const owner of owners.values()) syncTheme(owner); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  filesServices.termaSftpEditorViews = {
    mount(modal, model, snapshot = () => model) {
      const previous = owners.get(modal);
      if (previous) {
        previous.disposeResize();
        render(null, previous.host);
        previous.host.remove();
      }
      const host = document.createElement('div');
      host.className = 'terma-vue-root terma-sftp-root terma-sftp-editor-root';
      host.setAttribute('data-i18n-skip', '');
      modal.replaceChildren(host);
      modal.hidden = false;
      const owner: EditorOwner = { host, modal, snapshot, disposeResize: () => {} };
      owners.set(modal, owner);
      syncTheme(owner);
      render(editorView(model), host);
      owner.disposeResize = installResizeHandle(owner);
    },
    release(modal) {
      const owner = owners.get(modal);
      if (!owner) return;
      owners.delete(owner.modal);
      owner.disposeResize();
      render(null, owner.host);
      if (owner.host.parentElement === owner.modal) owner.host.remove();
    }
  };
}



export interface InstalledFeaturesFilesSftpSftpEditorShellServices {
  termaSftpEditorViews?: {
      mount(modal: HTMLElement, model: SftpEditorModel, snapshot?: () => SftpEditorModel): void;
      release(modal: HTMLElement): void;
    };
}
