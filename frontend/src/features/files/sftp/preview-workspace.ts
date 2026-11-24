import {filesServices} from '@/features/files/installed-services';
import {icon,refreshIcons} from '@/shared/ui/icon-service';
import {esc} from '@/shared/html-escape';
import {$} from '@/shared/workspace-dom';
import { createEditorRuntime } from './editor-runtime';
import type { EditorRuntimePort } from './editor-runtime-types';
import { createFilePreviewService, triggerGeneratedDownload } from './file-preview-service';
import type { createFileOpenService } from './file-open-service';
import { createImagePreview, type PreviewOptions } from './image-preview';
import { createSvgExportService, type SvgExportPort } from './svg-export';
import type { createSftpViewState } from './view-state';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import { confirmModal } from '@/shared/workspace-prompts';

type FilePreviewPort = Parameters<typeof createFilePreviewService>[0];
interface PreviewWorkspacePort {
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  text: EditorRuntimePort['tr'];
  bytes: EditorRuntimePort['bytes'];
  notify: FilePreviewPort['notify'];
  connection: FilePreviewPort['connection'];
  openFile: ReturnType<typeof createFileOpenService>;
  opening: ReturnType<typeof createSftpViewState>['opening'];
  refresh: FilePreviewPort['refresh'];
  generated: FilePreviewPort['generated'];
  download: FilePreviewPort['download'];
}

type SvgVendors = ReturnType<SvgExportPort['vendors']>;

export function installSftpPreviewWorkspace(port: PreviewWorkspacePort) {
  const editor = createEditorRuntime({
    tr: port.text, bytes: port.bytes, icon, refreshIcons, escape: esc,
    notify: (message, level = 'info') => port.notify(message, level),
    confirm: confirmModal,
    ace: () => window.ace || null,
    localizeAce: () => filesServices.termaAceLocalization.sync(),
    diffLines: (...args) => window.Diff?.diffLines?.(...args),
    mount: (modal, model, snapshot) => filesServices.termaSftpEditorViews!.mount(modal, model, snapshot),
    release: modal => filesServices.termaSftpEditorViews?.release(modal)
  });
  const svg = createSvgExportService({
    tr: port.text,
    vendors: () => ({JsPDF: window.jspdf?.jsPDF, convertSvg: window.svg2pdf?.svg2pdf})
  });
  const files = createFilePreviewService({
    tr: port.text, bytes: port.bytes, notify: port.notify, connection: port.connection,
    readText: (id, path, encoding) => port.opening(id, path, () => port.openFile.text(id, path, encoding)),
    image: (id, path) => port.opening(id, path, () => port.openFile.image(id, path)),
    previewImage: (id, path, options) => runtime.image(id, path, options),
    openKey: editor.sftpTextEditorOpenKey, activate: editor.activateSftpTextEditor, editor: editor.sftpTextModal,
    write: (id, path, next) => port.api(`/api/connections/${id}/sftp/write`, {method:'POST', body:JSON.stringify({
      path, content:next.content, backup:next.backup, encoding:next.encoding, line_ending:next.line_ending, persist_default:next.persist_default
    })}),
    versions: (id, path) => port.api(`/api/connections/${id}/sftp/versions?path=${encodeURIComponent(path)}&limit=10`),
    refresh: port.refresh, encodingLabel: editor.sftpTextEncodingLabel, lineEndingLabel: editor.sftpTextLineEndingLabel,
    svg, generated: port.generated, download: port.download
  });
  const image = createImagePreview({
    host: () => $('modal'), image: (id, path, onRead) => port.openFile.image(id, path, onRead),
    bytes: port.bytes, release: owner => filesServices.termaSftpPreviewViews?.release(owner),
    text: (id, path, options) => files.text(id, path, options), download: port.download,
    pdf: files.pdf, svgDownload: files.svg, svg, tr: port.text, icon, refreshIcons,
    error: message => { if (message) port.notify(message, 'error'); }
  });
  const runtime = Object.assign(files, {
    async image(id: number, path: string, options: PreviewOptions = {}) {
      const preview = () => image.preview(id, path, options);
      if (Object.hasOwn(options, 'content')) await preview();
      else await port.opening(id, path, preview);
    },
    editor, svgExport: svg, download: triggerGeneratedDownload
  });
  filesServices.termaSftpPreviewRuntime = runtime;
  return runtime;
}

declare global {
  interface Window {
    ace?: NonNullable<ReturnType<EditorRuntimePort['ace']>>;
    Diff?: { diffLines?: EditorRuntimePort['diffLines'] };
    jspdf?: { jsPDF?: SvgVendors['JsPDF'] };
    svg2pdf?: { svg2pdf?: SvgVendors['convertSvg'] };
  }
}

export interface InstalledFeaturesFilesSftpPreviewWorkspaceServices {
  termaSftpPreviewRuntime: ReturnType<typeof installSftpPreviewWorkspace>;
}
