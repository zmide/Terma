import {filesServices} from '@/features/files/installed-services';
export function createPreviewModel(port:{tr(key:string,values?:Record<string,unknown>):string;bytes(size:number):string}){const tr=port.tr,formatBytes=port.bytes;
function mountSftpImagePreviewView(modal:HTMLElement, path:string, blob:Blob, isSvg:boolean) {
    const closeLabel = tr("sftp:editor.close", {defaultValue:"关闭"});
    const searchLabel = tr("sftp:editor.svg_search", {defaultValue:"搜索 SVG 属性或文本"});
    const searchPreviousLabel = tr("sftp:editor.search_previous", {defaultValue:"上一个匹配"});
    const searchNextLabel = tr("sftp:editor.search_next", {defaultValue:"下一个匹配"});
    const zoomOutLabel = tr("sftp:editor.zoom_out", {defaultValue:"缩小"});
    const zoomInLabel = tr("sftp:editor.zoom_in", {defaultValue:"放大"});
    const zoomResetLabel = tr("sftp:editor.zoom_reset", {defaultValue:"适应窗口"});
    const svgModeLabel = tr("sftp:editor.svg_mode", {defaultValue:"SVG 模式"});
    const svgPreviewLabel = tr("sftp:editor.svg_mode_preview", {defaultValue:"仅预览"});
    const svgEditLabel = tr("sftp:editor.svg_mode_edit", {defaultValue:"仅编辑"});
    const svgSplitLabel = tr("sftp:editor.svg_mode_split", {defaultValue:"分栏预览"});
    const invertLabel = tr("sftp:editor.invert_colors", {defaultValue:"反色"});
    const originalColorsLabel = tr("sftp:editor.color_mode_original", {defaultValue:"正色"});
    const monochromeInvertLabel = tr("sftp:editor.color_mode_invert_mono", {defaultValue:"黑白反转"});
    const blackWhiteModeLabel = tr("sftp:editor.color_mode_invert_bw", {defaultValue:"黑白模式"});
    const colorInvertLabel = tr("sftp:editor.color_mode_invert_color", {defaultValue:"全局反转"});
    
    
    filesServices.termaSftpPreviewViews!.mountImage(modal, {
      title: path.split(/[\\/]/).pop() || path,
      size: formatBytes(blob.size),
      isSvg,
      labels: {
        close: closeLabel,
        zoomOut: zoomOutLabel,
        zoomReset: zoomResetLabel,
        zoomIn: zoomInLabel,
        invert: invertLabel,
        originalColors: originalColorsLabel,
        monochromeInvert: monochromeInvertLabel,
        blackWhiteMode: blackWhiteModeLabel,
        colorInvert: colorInvertLabel,
        svgMode: svgModeLabel,
        svgPreview: svgPreviewLabel,
        svgEdit: svgEditLabel,
        svgSplit: svgSplitLabel,
        search: searchLabel,
        searchPrevious: searchPreviousLabel,
        searchNext: searchNextLabel,
        exportPdf: tr("sftp:editor.export_pdf", {defaultValue:"导出 PDF"}),
        download: tr("sftp:menu.download", {defaultValue:"下载"})
      }
    });
}

return {mount:mountSftpImagePreviewView};}
export function installPreviewModel(){filesServices.termaPreviewModel={create:createPreviewModel};}


export interface InstalledFeaturesFilesSftpPreviewModelServices {
  termaPreviewModel:{create:typeof createPreviewModel}
}
