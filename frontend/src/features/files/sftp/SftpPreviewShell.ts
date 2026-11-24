import {filesServices} from '@/features/files/installed-services';
import {tr as translateWorkspace} from '@/shared/i18n/workspace-bootstrap';
import { h, render, type VNode, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';
import '@/styles/sftp.css';

type PreviewLabels = {
  close: string;
  zoomOut: string;
  zoomReset: string;
  zoomIn: string;
  invert: string;
  originalColors: string;
  monochromeInvert: string;
  blackWhiteMode: string;
  colorInvert: string;
  svgMode: string;
  svgPreview: string;
  svgEdit: string;
  svgSplit: string;
  search: string;
  searchPrevious: string;
  searchNext: string;
  exportPdf: string;
  download: string;
};

export type SftpPreviewModel = {
  title: string;
  size: string;
  isSvg: boolean;
  labels: PreviewLabels;
};

type PreviewOwner = { host: HTMLElement; modal: HTMLElement };
let current: PreviewOwner | null = null;

function icon(name: string): VNode {
  return settingsIcon(name);
}

function toolButton(id: string, label: string, iconName: string) {
  return h(TermaButton, {
    id,
    class: 'icon-button',
    type: 'button',
    title: label,
    'aria-label': label
  }, { default: () => icon(iconName) });
}

function selectControl(id: string, className: string, label: string, iconName: string, options: Array<[string, string]>) {
  return h('label', { class: className }, [
    h('span', { class: `${className}-label` }, [icon(iconName), h('span', null, label)]),
    h('select', { id, title: label, 'aria-label': label }, options.map(([value, text]) => h('option', { value }, text)))
  ]);
}

function imagePreviewView(model: SftpPreviewModel) {
  const labels = model.labels;
  const tools: VNodeChild[] = [
    toolButton('sftpImageZoomOut', labels.zoomOut, 'minus'),
    h('span', { id: 'sftpImageZoomValue', class: 'sftp-image-zoom-value' }, '100%'),
    toolButton('sftpImageZoomReset', labels.zoomReset, 'maximize-2'),
    toolButton('sftpImageZoomIn', labels.zoomIn, 'plus')
  ];
  if (model.isSvg) {
    tools.push(selectControl('sftpImageColorMode', 'sftp-svg-color-mode', labels.invert, 'contrast', [
      ['original', labels.originalColors],
      ['invert-mono', labels.monochromeInvert],
      ['invert-bw', labels.blackWhiteMode],
      ['invert-color', labels.colorInvert]
    ]));
    tools.push(selectControl('sftpImageViewMode', 'sftp-svg-view-mode', labels.svgMode, 'panels-top-left', [
      ['preview', labels.svgPreview],
      ['edit', labels.svgEdit],
      ['split', labels.svgSplit]
    ]));
    tools.push(h('div', { class: 'sftp-svg-search' }, [
      h('div', { class: 'sftp-svg-search-controls' }, [
        h('label', null, [h('span', { class: 'sr-only' }, labels.search), h('input', { id: 'sftpSvgSearch', type: 'search', placeholder: labels.search, autocomplete: 'off' })]),
        toolButton('sftpSvgSearchPrevious', labels.searchPrevious, 'arrow-up'),
        toolButton('sftpSvgSearchNext', labels.searchNext, 'arrow-down')
      ]),
      h('span', { id: 'sftpSvgSearchCount', 'aria-live': 'polite' })
    ]));
  }
  tools.push(toolButton('sftpImageFullscreen', translateWorkspace('sftp:editor.fullscreen') || 'Fullscreen', 'maximize'));
  tools.push(toolButton('sftpImageClose', labels.close, 'x'));
  return h('div', { class: 'modal-card wide sftp-image-modal', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'sftp-editor-head' }, [
      h('div', null, [h('h2', null, model.title), h('span', null, model.size)]),
      h('div', { class: 'sftp-image-tools' }, tools)
    ]),
    h('div', { id: 'sftpImageViewport', class: 'sftp-image-preview' }, [
      h('div', { id: 'sftpImageStageShell', class: 'sftp-image-stage-shell' }, [h('div', { id: 'sftpImageStage', class: 'sftp-image-stage' })])
    ]),
    h('div', { class: 'actions' }, [
      model.isSvg ? h(TermaButton, { id: 'sftpImageExportPdf', type: 'button' }, { default: () => [icon('file-code-2'), h('span', null, labels.exportPdf)] }) : null,
      h(TermaButton, { id: 'sftpImageDownload', type: 'button' }, { default: () => [icon('download'), h('span', null, labels.download)] }),
      h(TermaButton, { id: 'sftpImageCloseBottom', type: 'button' }, { default: () => h('span', null, labels.close) })
    ])
  ]);
}

export function installSftpPreviewViews() {
  const theme = () => { if (current) current.host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; };
  window.addEventListener('terma:language-changed', () => {
    if (!current) return;
    const host = current.host, tr = translateWorkspace;
    // Update only owned labels; the SVG shadow tree, current zoom and input stay intact.
    const controls = { sftpImageZoomOut:'sftp:editor.zoom_out', sftpImageZoomReset:'sftp:editor.zoom_reset', sftpImageZoomIn:'sftp:editor.zoom_in', sftpImageClose:'sftp:editor.close', sftpImageCloseBottom:'sftp:editor.close', sftpImageExportPdf:'sftp:editor.export_pdf', sftpImageDownload:'sftp:menu.download', sftpSvgSearchPrevious:'sftp:editor.search_previous', sftpSvgSearchNext:'sftp:editor.search_next' };
    for (const [id, key] of Object.entries(controls)) {
      const node = host.querySelector<HTMLElement>(`#${id}`); if (!node) continue;
      node.title = tr(key); node.setAttribute('aria-label', tr(key));
      const span = node.querySelector('span'); if (span) span.textContent = tr(key);
    }
    for (const [id, key, options] of [
      ['sftpImageColorMode','sftp:editor.invert_colors',{original:'sftp:editor.color_mode_original','invert-mono':'sftp:editor.color_mode_invert_mono','invert-bw':'sftp:editor.color_mode_invert_bw','invert-color':'sftp:editor.color_mode_invert_color'}],
      ['sftpImageViewMode','sftp:editor.svg_mode',{preview:'sftp:editor.svg_mode_preview',edit:'sftp:editor.svg_mode_edit',split:'sftp:editor.svg_mode_split'}]
    ] as const) {
      const select = host.querySelector<HTMLSelectElement>(`#${id}`); if (!select) continue;
      select.title = tr(key); select.setAttribute('aria-label', tr(key));
      const label = select.parentElement?.querySelector('span > span'); if (label) label.textContent = tr(key);
      for (const option of select.options) { const key = (options as Record<string,string>)[option.value]; if (key) option.textContent = tr(key); }
    }
    const search = host.querySelector<HTMLInputElement>('#sftpSvgSearch');
    if (search) { search.placeholder = tr('sftp:editor.svg_search'); const label = search.parentElement?.querySelector('.sr-only'); if (label) label.textContent = search.placeholder; }
    const count = host.querySelector<HTMLElement>('#sftpSvgSearchCount');
    if (count?.textContent && !/^\d+\/\d+$/.test(count.textContent)) count.textContent = tr('sftp:editor.svg_search_empty');
    const fullscreen = host.querySelector<HTMLButtonElement>('#sftpImageFullscreen');
    if (fullscreen) { fullscreen.title = tr(host.querySelector('.sftp-image-modal')?.classList.contains('is-fullscreen') ? 'sftp:editor.exit_fullscreen' : 'sftp:editor.fullscreen'); fullscreen.setAttribute('aria-label', fullscreen.title); }
  });
  new MutationObserver(theme).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  filesServices.termaSftpPreviewViews = {
    mountImage(modal, model) {
      if (current) {
        render(null, current.host);
        current.host.remove();
      }
      const host = document.createElement('div');
      host.className = 'terma-vue-root terma-sftp-root terma-sftp-preview-root';
      host.setAttribute('data-i18n-skip', '');
      modal.replaceChildren(host);
      modal.hidden = false;
      current = { host, modal };
      theme();
      render(imagePreviewView(model), host);
    },
    release(target) {
      if (!current || target && target !== current.modal && !current.host.contains(target)) return;
      const owner = current;
      current = null;
      render(null, owner.host);
      if (owner.host.parentElement === owner.modal) owner.host.remove();
    }
  };
}



export interface InstalledFeaturesFilesSftpSftpPreviewShellServices {
  termaSftpPreviewViews?: {
      mountImage(modal: HTMLElement, model: SftpPreviewModel): void;
      release(target?: HTMLElement): void;
    };
}
