import type {Ace} from 'ace-builds';
import type {EditorRuntimePort,EditorOptions,EditorResult,EditorControl,EditorHost,EditorSave} from './editor-runtime-types';
import {editorLineEnding,editorUnixScript,prepareEditorSave,editorByteMeasurement,editorVersions,createEditorDocumentSession,editorDiff} from './editor-document';
import {directoryPath} from './directory-state';
import {sanitizeSvgDocument,svgExportViewBox,svgNumericDimension} from './svg-engine';
import {scrollSftpFallbackEditorToOffset,createSftpSvgSourceLocator,createSftpSvgEditorScheduler,createSftpSvgAutoFocusController,setSftpSvgPreviewSize} from './svg-source';
import {createEditorLayout} from '../file-layout';
import { renderEditorDiff } from './EditorDiffPanel';
export function createEditorRuntime(port:EditorRuntimePort){
const {tr,icon,notify,refreshIcons}=port,formatBytes=port.bytes,esc=port.escape,escAttr=port.escape,confirmModal=port.confirm;
const syncTermaAceLocalization=port.localizeAce;
const ace=port.ace();
const layout=createEditorLayout({mobile:()=>matchMedia('(max-width:760px)').matches});
const {bindSftpEditorLayout,bindSftpSvgEditorLayout,setSftpEditorDiffVisible}=layout;
const sanitizeSftpSvgDocument=(source:string)=>sanitizeSvgDocument(source,()=>tr('sftp:editor.svg_parse_failed'));
const sftpSvgExportViewBox=svgExportViewBox,sftpSvgNumericDimension=svgNumericDimension;
const sftpDiffDisplayTime=(value:number)=>value?new Date(value).toLocaleString(document.documentElement.lang||'zh-CN',{hour12:false}):tr('sftp:diff.time_unknown');
const sftpTextEncodingOptions: [string,string][] = [
  ["utf8","UTF-8"], ["utf8bom","UTF-8 BOM"], ["gb18030","GB18030"], ["gbk","GBK"],
  ["big5","Big5"], ["shift_jis","Shift_JIS"], ["euc-kr","EUC-KR"], ["latin1","ISO-8859-1"]
];

function sftpTextLineEndingOptions() {
  return [
    ["lf",tr("sftp:editor.line_ending_lf", {defaultValue:"LF (Unix/Linux)"})],
    ["crlf",tr("sftp:editor.line_ending_crlf", {defaultValue:"CRLF (Windows)"})],
    ["cr",tr("sftp:editor.line_ending_cr", {defaultValue:"CR (Classic Mac)"})]
  ];
}

function sftpTextEncodingLabel(value:string) {
  return sftpTextEncodingOptions.find(([encoding]) => encoding === value)?.[1] || String(value || "UTF-8");
}

function sftpTextLineEnding(value:string) {
  return editorLineEnding(value);
}

function sftpTextLineEndingLabel(value:string) {
  return sftpTextLineEndingOptions().find(([lineEnding]) => lineEnding === sftpTextLineEnding(value))?.[1] || String(value || "LF");
}

function isSftpUnixScript(title:string, content="") {
  return editorUnixScript(title, content);
}

function prepareSftpEditorSave(title:string, content:string, encoding="utf8", lineEnding="lf") {
  return prepareEditorSave(title, content, encoding, lineEnding);
}

function sftpEditorByteMeasurement(content:string, encoding="utf8") {
  return editorByteMeasurement(content, encoding);
}

const sftpEditorLanguageOptions: [string,string][] = [
  ["plain_text","纯文本"], ["yaml","YAML"], ["json","JSON"], ["xml","XML"], ["ini","INI / 配置"],
  ["properties","Properties"], ["toml","TOML"], ["sh","Shell"], ["batchfile","BAT / CMD"], ["powershell","PowerShell"],
  ["javascript","JavaScript"], ["typescript","TypeScript"], ["html","HTML"], ["css","CSS"], ["java","Java"],
  ["c_cpp","C / C++"], ["csharp","C#"], ["python","Python"], ["golang","Go"], ["rust","Rust"],
  ["sql","SQL"], ["markdown","Markdown"], ["dockerfile","Dockerfile"], ["nginx","Nginx"]
];

function sftpEditorLanguageForFile(filename:string) {
  const basename = (String(filename || "").split(/[\\/]/).pop() || '').toLowerCase();
  const extension = basename.includes(".") ? basename.split(".").pop() || '' : "";
  if (["dockerfile","containerfile"].includes(basename)) return "dockerfile";
  if (["makefile","gnumakefile"].includes(basename)) return "sh";
  if ([".bashrc",".bash_profile",".profile",".zshrc",".zprofile",".env"].includes(basename)) return basename === ".env" ? "properties" : "sh";
  if (["yaml","yml"].includes(extension)) return "yaml";
  if (["json","json5"].includes(extension)) return "json";
  if (["xml","svg","plist"].includes(extension)) return "xml";
  if (["ini","conf","cfg","cnf","editorconfig"].includes(extension) || basename.endsWith(".conf")) return basename.includes("nginx") ? "nginx" : "ini";
  if (["properties","env"].includes(extension)) return "properties";
  if (extension === "toml") return "toml";
  if (["sh","bash","zsh","fish"].includes(extension)) return "sh";
  if (["bat","cmd"].includes(extension)) return "batchfile";
  if (["ps1","psm1","psd1"].includes(extension)) return "powershell";
  if (["js","jsx","mjs","cjs"].includes(extension)) return "javascript";
  if (["ts","tsx","mts","cts"].includes(extension)) return "typescript";
  if (["html","htm","vue"].includes(extension)) return "html";
  if (["css","scss","less"].includes(extension)) return "css";
  if (["java","gradle"].includes(extension)) return "java";
  if (["c","h","cc","cpp","cxx","hpp"].includes(extension)) return "c_cpp";
  if (extension === "cs") return "csharp";
  if (["py","pyw"].includes(extension)) return "python";
  if (extension === "go") return "golang";
  if (extension === "rs") return "rust";
  if (["sql","mysql","pgsql"].includes(extension)) return "sql";
  if (["md","markdown","mdown"].includes(extension)) return "markdown";
  return "plain_text";
}

function sftpEditorLanguageLabel(value:string) {
  if (value === "plain_text") return tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
  if (value === "ini") return tr("sftp:editor.ini_configuration", {defaultValue:"INI / 配置"});
  return sftpEditorLanguageOptions.find(([mode]) => mode === value)?.[1] || tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
}

function isSftpJsonFileName(name:string) {
  return (String(name || "").split(/[\\/]/).pop() || '').toLowerCase().endsWith(".json");
}

function isSftpImageName(name:string) {
  return ["png","jpg","jpeg","gif","webp","bmp","ico","svg"].includes(String(name || "").toLowerCase().split(".").pop() || '');
}

function isSftpSvgName(name:string) {
  return String(name || "").toLowerCase().split(".").pop() === "svg";
}

const sftpFloatingEditorRegistry = new Map<string,{modal:HTMLElement;restore:()=>void}>();

function sftpTextEditorOpenKey(connectionId:number, remotePath:string) {
  return Number(connectionId || 0)+'\0'+directoryPath(remotePath);
}

function activateSftpTextEditor(editorKey:string) {
  const record = sftpFloatingEditorRegistry.get(String(editorKey || ""));
  if (!record) return false;
  // A mode switch can finish an editor while an async preview callback still
  // holds the registry entry. Never treat a detached window as reusable: doing
  // so would consume the open request and leave the user with no editor.
  if (!record.modal?.isConnected) {
    sftpFloatingEditorRegistry.delete(String(editorKey || ""));
    return false;
  }
  record.restore?.();
  return true;
}

function sftpFloatingEditorLayer() {
  let layer = document.querySelector<HTMLElement>(".sftp-editor-floating-root");
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "sftp-editor-floating-root";
  layer.innerHTML = `<div class="sftp-editor-floating-shelf" role="list"></div>`;
  document.body.appendChild(layer);
  return layer;
}

function refreshSftpFloatingEditorShelfLabels(layer=document.querySelector(".sftp-editor-floating-root")) {
  if (!layer) return;
  const windows = [...layer.querySelectorAll<HTMLElement>(".sftp-editor-floating-window")];
  const duplicateCounts = windows.reduce((counts, item) => {
    const name = String(item.dataset.fileName || "");
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map<string,number>());
  for (const item of layer.querySelectorAll<HTMLElement>(".sftp-editor-shelf-item")) {
    const name = String(item.dataset.fileName || "");
    const server = String(item.dataset.serverName || "");
    const label = (duplicateCounts.get(name) || 0) > 1 && server ? `${server} · ${name}` : name;
    item.title = String(item.dataset.sourceLabel || label);
    item.setAttribute("aria-label", item.title);
    const text = item.querySelector("span");
    if (text) text.textContent = label;
  }
}

function sftpFloatingEditorShelfItem(layer:HTMLElement, metadata:{fileName:string;serverName:string;sourceLabel:string}, restore:()=>void) {
  const shelf = layer.querySelector(".sftp-editor-floating-shelf");
  if (!shelf) return null;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "sftp-editor-shelf-item";
  item.dataset.fileName = metadata.fileName;
  item.dataset.serverName = metadata.serverName;
  item.dataset.sourceLabel = metadata.sourceLabel;
  item.innerHTML = `${icon("file-code-2")}<span>${esc(metadata.fileName)}</span>`;
  item.onclick = restore;
  shelf.appendChild(item);
  refreshSftpFloatingEditorShelfLabels(layer);
  return item;
}

function sftpEditorViewModel({fileName, sourceLabel, fileLimit, encoding, initialLineEnding, detectedLanguage, wrapEnabled, preferredEncoding, versions, historyLoading, isSvgDocument=false, initialSvgMode="edit"}:import('./editor-runtime-types').EditorViewInput) {
  return ({
      title: fileName,
      sourceLabel,
      stats: fileLimit,
      encoding,
      lineEnding: initialLineEnding,
      detectedLanguage: sftpEditorLanguageLabel(detectedLanguage),
      wordWrap: wrapEnabled,
      persistEncoding: preferredEncoding === encoding,
      encodingOptions: sftpTextEncodingOptions.map(([value, label]) => ({value, label: String(label)})),
      lineEndingOptions: sftpTextLineEndingOptions().map(([value, label]) => ({value, label: String(label)})),
      languageOptions: sftpEditorLanguageOptions.map(([value]) => ({value, label: sftpEditorLanguageLabel(value)})),
      historyOptions: versions.map((version, index) => ({
        value: String(index),
        label: `${sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000)} · ${formatBytes(version.size || 0)}`
      })),
      historyDisabled: true,
      historyLoading,
      historyCount: tr("sftp:editor.recent_backups", {count: versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`}),
      svg: isSvgDocument ? {
        mode: initialSvgMode,
        modeOptions: ["preview", "edit", "split"].map(value => ({value, label:tr(`sftp:editor.svg_mode_${value}`)}))
      } : undefined,
      labels: {
        encoding: tr("sftp:editor.text_encoding", {defaultValue:"文本编码"}),
        lineEnding: tr("sftp:editor.line_ending", {defaultValue:"换行符"}),
        language: tr("sftp:editor.language", {defaultValue:"语言"}),
        automaticLanguage: tr("sftp:editor.automatic_language", {language:"{language}", defaultValue:"自动（{language}）"}),
        wordWrap: tr("sftp:editor.word_wrap", {defaultValue:"自动换行"}),
        search: tr("sftp:editor.search_text"),
        searchPrevious: tr("sftp:editor.search_previous"),
        searchNext: tr("sftp:editor.search_next"),
        toggleReplace: tr("sftp:ace.toggle_replace"),
        replaceWith: tr("sftp:ace.replace_placeholder"),
        replace: tr("sftp:ace.replace"),
        replaceAll: tr("sftp:editor.replace_all_matches"),
        close: tr("sftp:editor.close"),
        minimize: tr("sftp:editor.minimize"),
        fullscreen: tr("sftp:editor.fullscreen"),
        editorAria: tr("sftp:editor.editor_aria", {defaultValue:"SFTP 文本编辑器"}),
        resizeDiffAria: tr("sftp:editor.resize_diff_aria", {defaultValue:"调整编辑与差异区域比例"}),
        resizeWindowAria: tr("sftp:editor.resize_window_aria", {defaultValue:"拖动调整编辑器窗口大小"}),
        backupBeforeSave: tr("sftp:editor.backup_before_save", {defaultValue:"保存前备份远程文件"}),
        persistEncoding: tr("sftp:editor.persist_encoding", {defaultValue:"设为此连接默认文本编码"}),
        compareVersion: tr("sftp:editor.compare_version", {defaultValue:"比较版本"}),
        historyCount: tr("sftp:editor.recent_backups", {count: versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`}),
        loadingBackups: tr("sftp:editor.loading_backups", {defaultValue:"正在读取备份..."}),
        noComparableBackups: tr("sftp:editor.no_comparable_backups", {defaultValue:"没有可比较的备份"}),
        formatJson: tr("sftp:editor.format_json", {defaultValue:"格式化 JSON"}),
        previewDiff: tr("sftp:editor.preview_diff", {defaultValue:"预览差异"}),
        save: tr("sftp:editor.save", {defaultValue:"保存"}),
        shortcut: "Ctrl+S",
        svgMode: tr("sftp:editor.svg_mode", {defaultValue:"SVG 模式"}),
        svgAutoFocus: tr("sftp:editor.svg_preview_auto_focus", {defaultValue:"定位时居中并缩放"}),
        zoomOut: tr("sftp:editor.zoom_out", {defaultValue:"缩小"}),
        zoomReset: tr("sftp:editor.zoom_reset", {defaultValue:"适应窗口"}),
        zoomIn: tr("sftp:editor.zoom_in", {defaultValue:"放大"}),
        resizeSvgPreviewAria: tr("sftp:editor.resize_svg_preview_aria", {defaultValue:"调整 SVG 预览与编辑区域比例"})
      }
  });
}

function sftpTextModal(title:string, content:string, size=0, limit=5*1024*1024, encoding="utf8", preferredEncoding="auto", diffOptions:EditorOptions={}):Promise<EditorResult> {
  const editorKey = String(diffOptions.editorKey || "");
  if (editorKey && !diffOptions.forceNewEditor && activateSftpTextEditor(editorKey)) {
    diffOptions.onReady?.();
    return Promise.resolve(null);
  }
  return new Promise<EditorResult>((resolve) => {
    const floatingLayer = sftpFloatingEditorLayer();
    const modal = document.createElement("div");
    const fileName = String(title || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(title || "");
    const serverName = String(diffOptions.serverName || "");
    const sourceLabel = String(diffOptions.sourceLabel || [serverName, title].filter(Boolean).join(" · "));
    modal.className = "sftp-editor-floating-window";
    modal.dataset.editorId = `sftp-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    modal.dataset.editorKey = editorKey;
    modal.dataset.fileName = fileName;
    modal.dataset.serverName = serverName;
    modal.dataset.sourceLabel = sourceLabel;
    floatingLayer.appendChild(modal);
    const editorRecord = editorKey ? {modal, restore:() => {}} : null;
    if (editorRecord) sftpFloatingEditorRegistry.set(editorKey, editorRecord);
    refreshSftpFloatingEditorShelfLabels(floatingLayer);
    const detectedLanguage = sftpEditorLanguageForFile(title);
    const unixScript = isSftpUnixScript(title, content);
    let scriptNeedsFormatRepair = diffOptions.needsFormatRepair === true || (unixScript && Boolean(
      diffOptions.bom
      || (content && diffOptions.finalNewline === false)
    ));
    if (unixScript && encoding === "utf8bom") encoding = "utf8";
    const initialLineEnding = sftpTextLineEnding(diffOptions.lineEnding || "lf");
    const wrapEnabled = localStorage.getItem("sftpEditorWordWrap") !== "0";
    let versions = editorVersions(diffOptions.versions);
    const historyLoading = typeof diffOptions.loadVersions === "function";
    let historyPending = historyLoading;
    const historyOptions = versions.length
      ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
      : `<option value="">${esc(tr(historyLoading ? "sftp:editor.loading_backups" : "sftp:editor.no_comparable_backups", {defaultValue:historyLoading ? "正在读取备份..." : "没有可比较的备份"}))}</option>`;
    const initialLines = Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : Math.max(1, String(content || "").split("\n").length);
    const fileLimit = `${tr("sftp:editor.line_count", {count:initialLines, defaultValue:`${initialLines} 行`})} · ${tr("sftp:editor.file_limit", {size:formatBytes(size), limit:formatBytes(limit), defaultValue:`${formatBytes(size)} · 上限 ${formatBytes(limit)}`})}`;
    const searchLabel = tr("sftp:editor.search_text", {defaultValue:"搜索文本"});
    const previousLabel = tr("sftp:editor.search_previous", {defaultValue:"上一个匹配"});
    const nextLabel = tr("sftp:editor.search_next", {defaultValue:"下一个匹配"});
    const minimizeLabel = tr("sftp:editor.minimize", {defaultValue:"最小化"});
    const fullscreenLabel = tr("sftp:editor.fullscreen", {defaultValue:"全屏"});
    const closeLabel = tr("sftp:editor.close", {defaultValue:"关闭"});
    const isSvgDocument = isSftpSvgName(title);
    const initialSvgMode = isSvgDocument && diffOptions.svgMode === "split" ? "split" : "edit";
    const editorViewModel = () => sftpEditorViewModel({fileName, sourceLabel, fileLimit, encoding, initialLineEnding, detectedLanguage, wrapEnabled, preferredEncoding, versions, historyLoading, isSvgDocument, initialSvgMode});
    port.mount(modal, editorViewModel(), editorViewModel);
    modal.hidden = false;
    modal.onclick = null;
    let finished = false;
    const documentSession = createEditorDocumentSession();
    const getEditor = <S extends string>(selector:S) => modal.querySelector(selector) as EditorControl<S>;
    const titleBox = getEditor(".sftp-editor-title");
    const editorSaveStatus = document.createElement("small");
    editorSaveStatus.className = "sftp-editor-save-status";
    editorSaveStatus.hidden = true;
    let editorSaveStatusKey = "";
    const setEditorSaveStatus = (key:string) => {
      editorSaveStatusKey = key;
      editorSaveStatus.textContent = tr(`sftp:editor.${key}`);
    };
    titleBox?.appendChild(editorSaveStatus);
    const host = getEditor("#sftpTextEditor");
    const card = modal.querySelector<HTMLElement>(".sftp-editor-modal")!;
    let editorShelfItem:HTMLElement|null = null;
    let releaseFloatingEditor = () => {};
    if (card) {
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%,-50%)";
      const minimizeButton = getEditor("#sftpEditorMinimize");
      const fullscreenButton = getEditor("#sftpEditorFullscreen");
      let restoredGeometry:{left:number;top:number;width:number;height:number}|null=null;
      const nextZIndex = () => {
        const next = Math.max(1, Number(floatingLayer.dataset.editorZIndex || 1) + 1);
        floatingLayer.dataset.editorZIndex = String(next);
        card.style.zIndex = String(next);
      };
      const restoreFloatingEditor = () => {
        card.hidden = false;
        editorShelfItem?.remove();
        editorShelfItem = null;
        refreshSftpFloatingEditorShelfLabels(floatingLayer);
        nextZIndex();
        requestAnimationFrame(() => {
          aceEditor?.resize(true);
          focusEditor();
        });
      };
      if (editorRecord) editorRecord.restore = restoreFloatingEditor;
      minimizeButton.onclick = event => {
        event.stopPropagation();
        card.hidden = true;
        editorShelfItem = sftpFloatingEditorShelfItem(floatingLayer, {fileName, serverName, sourceLabel}, restoreFloatingEditor);
        refreshIcons();
      };
      const clampCard = () => {
        if (card.hidden || card.classList.contains("is-fullscreen")) return;
        const rect = card.getBoundingClientRect();
        card.style.transform = "none";
        const left = Math.max(8, Math.min(window.innerWidth - Math.min(rect.width, window.innerWidth - 16) - 8, rect.left));
        const top = Math.max(8, Math.min(window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8, rect.top));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
      };
      const syncFullscreen = (enabled:boolean) => {
        if (enabled && !card.classList.contains("is-fullscreen")) {
          const rect = card.getBoundingClientRect();
          restoredGeometry = {left:rect.left, top:rect.top, width:rect.width, height:rect.height};
        }
        card.classList.toggle("is-fullscreen", enabled);
        if (enabled) {
          card.style.removeProperty("left");
          card.style.removeProperty("top");
          card.style.removeProperty("width");
          card.style.removeProperty("height");
          card.style.removeProperty("transform");
        } else if (restoredGeometry) {
          card.style.left = `${restoredGeometry.left}px`;
          card.style.top = `${restoredGeometry.top}px`;
          card.style.width = `${restoredGeometry.width}px`;
          card.style.height = `${restoredGeometry.height}px`;
          card.style.transform = "none";
        } else {
          card.style.left = "50%";
          card.style.top = "50%";
          card.style.transform = "translate(-50%,-50%)";
        }
        const label = tr(enabled ? "sftp:editor.exit_fullscreen" : "sftp:editor.fullscreen", {defaultValue:enabled ? "退出全屏" : "全屏"});
        fullscreenButton.title = label;
        fullscreenButton.setAttribute("aria-label", label);
        fullscreenButton.innerHTML = icon(enabled ? "minimize-2" : "maximize");
        localStorage.setItem("sftpTextEditorFullscreen", enabled ? "1" : "0");
        requestAnimationFrame(() => {
          if (!enabled) clampCard();
          aceEditor?.resize(true);
        });
      };
      fullscreenButton.onclick = event => {
        event.stopPropagation();
        syncFullscreen(!card.classList.contains("is-fullscreen"));
      };
      const exitFullscreenForResize = () => {
        if (card.classList.contains("is-fullscreen")) syncFullscreen(false);
      };
      card.addEventListener("terma:sftp-editor-resize-start", exitFullscreenForResize);
      card.addEventListener("terma:sftp-editor-resized", clampCard);
      card.addEventListener("pointerdown", nextZIndex);
      nextZIndex();
      const dragHandle = getEditor(".sftp-editor-head");
      dragHandle?.classList.add("sftp-editor-drag-handle");
      let dragState:{pointerId:number;clientX:number;clientY:number;left:number;top:number}|null=null;
      const moveFloatingEditor = (event:PointerEvent) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        card.style.left = `${dragState.left + event.clientX - dragState.clientX}px`;
        card.style.top = `${dragState.top + event.clientY - dragState.clientY}px`;
        clampCard();
      };
      const stopFloatingEditorDrag = (event:PointerEvent) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        dragState = null;
        document.removeEventListener("pointermove", moveFloatingEditor);
        document.removeEventListener("pointerup", stopFloatingEditorDrag);
        document.removeEventListener("pointercancel", stopFloatingEditorDrag);
      };
      dragHandle?.addEventListener("pointerdown", event => {
        if (event.button !== 0 || card.classList.contains("is-fullscreen") || (event.target instanceof Element && event.target.closest("button,input,select,label,textarea"))) return;
        const rect = card.getBoundingClientRect();
        card.style.transform = "none";
        card.style.left = `${rect.left}px`;
        card.style.top = `${rect.top}px`;
        dragState = {pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, left:rect.left, top:rect.top};
        document.addEventListener("pointermove", moveFloatingEditor);
        document.addEventListener("pointerup", stopFloatingEditorDrag);
        document.addEventListener("pointercancel", stopFloatingEditorDrag);
        event.preventDefault();
      });
      window.addEventListener("resize", clampCard);
      releaseFloatingEditor = () => {
        card.removeEventListener("terma:sftp-editor-resize-start", exitFullscreenForResize);
        card.removeEventListener("terma:sftp-editor-resized", clampCard);
        window.removeEventListener("resize", clampCard);
        document.removeEventListener("pointermove", moveFloatingEditor);
        document.removeEventListener("pointerup", stopFloatingEditorDrag);
        document.removeEventListener("pointercancel", stopFloatingEditorDrag);
        editorShelfItem?.remove();
        editorShelfItem = null;
        refreshSftpFloatingEditorShelfLabels(floatingLayer);
      };
      syncFullscreen(localStorage.getItem("sftpTextEditorFullscreen") === "1");
    }
    const editorWorkspace = getEditor("#sftpEditorWorkspace");
    const diffSplitter = getEditor("#sftpEditorSplit");
    const diffPreview = getEditor("#sftpDiffPreview");
    let svgEditorPreview:HTMLElement|null = null;
    let svgEditorPreviewViewport:HTMLElement|null = null;
    let svgEditorPreviewStage:HTMLElement|null = null;
    let svgEditorPreviewSplitter:HTMLElement|null = null;
    if (isSvgDocument && editorWorkspace) {
      svgEditorPreview = getEditor("#sftpSvgEditorPreview");
      svgEditorPreviewViewport = svgEditorPreview?.querySelector<HTMLElement>(".sftp-svg-editor-preview-viewport") || null;
      svgEditorPreviewStage = svgEditorPreview?.querySelector<HTMLElement>(".sftp-svg-editor-preview-stage") || null;
      svgEditorPreviewSplitter = getEditor("#sftpSvgEditorSplit");
    }
    let aceEditor:Ace.Editor|null = null;
    let fallbackEditor!:HTMLTextAreaElement;
    const useLightEditor = diffOptions.editorKind === "light";
    const lightPageChars = 256 * 1024;
    const initialLightSource = useLightEditor ? content : "";
    let lightSource = "";
    let lightPageOffsets = [0, 0];
    let lightPageIndex = 0;
    const lightPageEdits = new Map<number,string>();
    let lightPager:HTMLElement|null = null;
    const rebuildLightPageOffsets = () => {
      lightPageOffsets = [0];
      let offset = 0;
      while (offset < lightSource.length) {
        let next = Math.min(lightSource.length, offset + lightPageChars);
        if (next < lightSource.length && /[\uD800-\uDBFF]/.test(lightSource.charAt(next - 1)) && /[\uDC00-\uDFFF]/.test(lightSource.charAt(next))) next -= 1;
        lightPageOffsets.push(next);
        offset = next;
      }
      if (lightPageOffsets.length === 1) lightPageOffsets.push(0);
    };
    const lightPageCount = () => Math.max(1, lightPageOffsets.length - 1);
    const lightOriginalPage = (index:number) => lightSource.slice(lightPageOffsets[index], lightPageOffsets[index + 1]);
    const lightPageValue = (index:number) => lightPageEdits.has(index) ? lightPageEdits.get(index)! : lightOriginalPage(index);
    const commitLightPage = () => {
      if (!useLightEditor || !fallbackEditor) return;
      const value = fallbackEditor.value;
      if (value === lightOriginalPage(lightPageIndex)) lightPageEdits.delete(lightPageIndex);
      else lightPageEdits.set(lightPageIndex, value);
    };
    const renderLightPage = (index:number) => {
      if (!useLightEditor || !fallbackEditor) return;
      commitLightPage();
      lightPageIndex = Math.max(0, Math.min(lightPageCount() - 1, Number(index || 0)));
      fallbackEditor.value = lightPageValue(lightPageIndex);
      const pageNumber = lightPager?.querySelector("input");
      const pageTotal = lightPager?.querySelector("span");
      const buttons = lightPager?.querySelectorAll("button") || [];
      if (pageNumber) {
        pageNumber.value = String(lightPageIndex + 1);
        pageNumber.max = String(lightPageCount());
      }
      if (pageTotal) pageTotal.textContent = tr("sftp:editor.segment_summary", {count:lightPageCount(), defaultValue:`/ ${lightPageCount()} · 每段最多 256 KB`});
      if (buttons[0]) buttons[0].disabled = lightPageIndex === 0;
      if (buttons[1]) buttons[1].disabled = lightPageIndex >= lightPageCount() - 1;
      fallbackEditor.scrollTop = 0;
      fallbackEditor.scrollLeft = 0;
    };
    const useFallbackEditor = () => {
      fallbackEditor = document.createElement("textarea");
      fallbackEditor.className = "text-editor code-editor";
      fallbackEditor.spellcheck = false;
      if (useLightEditor) {
        lightSource = content;
        rebuildLightPageOffsets();
        const shell = document.createElement("div");
        shell.className = "sftp-light-editor-shell";
        lightPager = document.createElement("div");
        lightPager.className = "sftp-light-editor-pager";
        const previousSegment = tr("sftp:editor.previous_segment", {defaultValue:"上一段"});
        const nextSegment = tr("sftp:editor.next_segment", {defaultValue:"下一段"});
        lightPager.innerHTML = `<button type="button" class="icon-button" title="${escAttr(previousSegment)}" aria-label="${escAttr(previousSegment)}">${icon("chevron-left")}</button><label>${esc(tr("sftp:editor.segment", {defaultValue:"分段"}))} <input type="number" min="1" step="1" aria-label="${escAttr(tr("sftp:editor.current_segment", {defaultValue:"当前分段"}))}"></label><span></span><button type="button" class="icon-button" title="${escAttr(nextSegment)}" aria-label="${escAttr(nextSegment)}">${icon("chevron-right")}</button>`;
        shell.append(fallbackEditor, lightPager);
        host.replaceWith(shell);
        const buttons = lightPager.querySelectorAll("button");
        buttons[0].onclick = () => renderLightPage(lightPageIndex - 1);
        buttons[1].onclick = () => renderLightPage(lightPageIndex + 1);
        lightPager.querySelector<HTMLInputElement>("input")!.onchange = event => renderLightPage(Number((event.currentTarget as HTMLInputElement).value || 1) - 1);
        fallbackEditor.value = lightOriginalPage(0);
        renderLightPage(0);
      } else {
        fallbackEditor.value = content;
        host.replaceWith(fallbackEditor);
      }
    };
    if (ace?.edit && !useLightEditor) {
      syncTermaAceLocalization();
      ace.config.set("basePath", "/vendor/ace");
      ace.config.set("useStrictCSP", true);
      aceEditor = ace.edit(host);
      (host as EditorHost).__termaAceEditor = aceEditor;
      aceEditor.setTheme(document.documentElement.dataset.theme === "dark" ? "ace/theme/tomorrow_night" : "ace/theme/textmate");
      aceEditor.session.setMode(`ace/mode/${detectedLanguage}`);
      aceEditor.session.setUseWrapMode(wrapEnabled);
      aceEditor.setValue(content, -1);
      aceEditor.setOptions({fontSize:"14px", showPrintMargin:false, useSoftTabs:true, tabSize:2, wrapBehavioursEnabled:true});
      const scroller = host.querySelector(".ace_scroller");
      const stylesReady = getComputedStyle(host).position === "relative" && scroller && getComputedStyle(scroller).position === "absolute";
      if (!stylesReady) {
        try { aceEditor.destroy(); } catch {}
        aceEditor = null;
        useFallbackEditor();
      } else requestAnimationFrame(() => aceEditor?.resize(true));
    } else {
      useFallbackEditor();
    }
    content = "";
    const getValue = () => {
      if (aceEditor) return aceEditor.getValue();
      if (!useLightEditor) return fallbackEditor.value;
      commitLightPage();
      if (!lightPageEdits.size) return lightSource;
      const pages = [];
      for (let index = 0; index < lightPageCount(); index += 1) pages.push(lightPageValue(index));
      return pages.join("");
    };
    const setValue = (value:string) => {
      if (aceEditor) return aceEditor.setValue(value, -1);
      if (!useLightEditor) return (fallbackEditor.value = value);
      lightSource = String(value || "");
      lightPageEdits.clear();
      lightPageIndex = 0;
      rebuildLightPageOffsets();
      fallbackEditor.value = lightOriginalPage(0);
      renderLightPage(0);
    };
    const svgModeSelect = getEditor("#sftpSvgEditorMode");
    let svgPreviewScale = 1;
    let svgPreviewFitMode = true;
    let svgPreviewBaseWidth = 1024;
    let svgPreviewBaseHeight = 768;
    let svgPreviewHighlightedId = "";
    let svgPreviewHasRendered = false;
    let svgPreviewFocusLockId = "";
    let svgPreviewFocusLockUntil = 0;
    let centerSvgPreviewTarget:(id:string)=>void = () => {};
    let cancelSvgPreviewAutoFocus = () => {};
    let clearSvgPreviewAutoFocus = () => {};
    const svgPreviewZoomValue = () => svgEditorPreview?.querySelector("[data-svg-preview-zoom-value]");
    const svgPreviewAutoFocusToggle = () => svgEditorPreview?.querySelector<HTMLInputElement>("[data-svg-preview-auto-focus]") || null;
    const svgPreviewTargetInfoFromNode = (node:EventTarget|null) => {
      let current:Element|null = node instanceof Element ? node : null;
      const root = svgEditorPreviewStage?.shadowRoot?.querySelector("svg");
      const shadowRoot = root?.getRootNode?.();
      if (!root || !shadowRoot) return null;
      let href = "";
      while (current) {
        if (current === root) break;
        if (current.getRootNode?.() !== shadowRoot) break;
        const id = current.getAttribute?.("id");
        const nodeName = String(current.localName || current.nodeName || "").toLowerCase();
        const nodeHref = current.getAttribute?.("href") || current.getAttribute?.("xlink:href");
        if (!href && nodeName === "use" && nodeHref && /^#.+/.test(String(nodeHref))) href = String(nodeHref).slice(1);
        if (id) return {id:String(id), href, nodeName, sourceElement:current};
        current = current.parentElement || null;
      }
      return href ? {id:href, href, nodeName:"use", sourceElement:node instanceof Element?node:null} : null;
    };
    const svgPreviewTargetIdFromNode = (node:EventTarget|null) => {
      return svgPreviewTargetInfoFromNode(node)?.id || "";
    };
    const svgPreviewTargetInfoFromEvent = (event:Event) => {
      for (const node of event?.composedPath?.() || []) {
        const targetInfo = svgPreviewTargetInfoFromNode(node);
        if (targetInfo?.id) return targetInfo;
      }
      return svgPreviewTargetInfoFromNode(event?.target);
    };
    const svgPreviewTargetIdFromEvent = (event:Event) => {
      return svgPreviewTargetInfoFromEvent(event)?.id || "";
    };
    const resolveSvgPreviewTarget = (id:string) => {
      const targetId = String(id || "");
      const root = svgEditorPreviewStage?.shadowRoot?.querySelector("svg");
      if (!root || !targetId) return null;
      const isDefinition = (node:Element) => {
        let current:Element|null = node.parentElement;
        while (current && current !== root) {
          const name = String(current.localName || current.nodeName || "").toLowerCase();
          if (name === "defs" || name === "symbol") return true;
          current = current.parentElement;
        }
        return false;
      };
      const nodes = [...root.querySelectorAll("*")];
      const direct = nodes.filter(node => node.getAttribute("id") === targetId);
      const references = nodes.filter(node => [node.getAttribute("href"), node.getAttribute("xlink:href")].includes(`#${targetId}`));
      return direct.find(node => !isDefinition(node))
        || references.find(node => !isDefinition(node))
        || direct[0]
        || references[0]
        || null;
    };
    const updateSvgPreviewMarker = () => {
      const marker = svgEditorPreview?.querySelector<HTMLElement>("[data-svg-preview-marker]");
      if (!marker) return;
      const viewport = svgEditorPreviewViewport;
      const target = svgPreviewHighlightedId ? resolveSvgPreviewTarget(svgPreviewHighlightedId) : null;
      if (!viewport || !target) {
        if (!target || !viewport) marker.hidden = true;
        if (!target) marker.classList.remove("is-edge");
        return;
      }
      const previewRect = svgEditorPreview!.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (!previewRect.width || !previewRect.height || !viewportRect.width || !viewportRect.height) {
        marker.hidden = true;
        return;
      }
      const inset = 15;
      const minX = viewportRect.left - previewRect.left + inset;
      const maxX = viewportRect.right - previewRect.left - inset;
      const minY = viewportRect.top - previewRect.top + inset;
      const maxY = viewportRect.bottom - previewRect.top - inset;
      const targetX = targetRect.left + Math.max(1, targetRect.width) / 2 - previewRect.left;
      const targetY = targetRect.top + Math.max(1, targetRect.height) / 2 - previewRect.top;
      const x = Math.max(minX, Math.min(maxX, targetX));
      const y = Math.max(minY, Math.min(maxY, targetY));
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      marker.classList.toggle("is-edge", Math.abs(x - targetX) > 1 || Math.abs(y - targetY) > 1);
      marker.hidden = false;
    };
    const updateSvgPreviewZoomUi = () => {
      const value = svgPreviewZoomValue();
      if (value) value.textContent = `${Math.round(svgPreviewScale * 100)}%`;
    };
    const setSvgPreviewSize = () => {
      if (!svgEditorPreviewViewport || !svgEditorPreviewStage) return;
      const width = Math.max(1, svgPreviewBaseWidth * svgPreviewScale);
      const height = Math.max(1, svgPreviewBaseHeight * svgPreviewScale);
      // The helper keeps a half-viewport gutter on every side so edge elements
      // can still be centered instead of being clamped against the canvas.
      setSftpSvgPreviewSize(svgEditorPreviewViewport, svgEditorPreviewStage, width, height);
      updateSvgPreviewZoomUi();
      updateSvgPreviewMarker();
    };
    const fitSvgEditorPreview = ({manual=false} = {}) => {
      if (!svgEditorPreviewViewport) return;
      clearSvgPreviewAutoFocus();
      if (manual) {
        cancelSvgPreviewAutoFocus();
      }
      const width = Math.max(120, svgEditorPreviewViewport.clientWidth - 24);
      const height = Math.max(120, svgEditorPreviewViewport.clientHeight - 24);
      svgPreviewScale = Math.max(0.05, Math.min(1, width / svgPreviewBaseWidth, height / svgPreviewBaseHeight));
      svgPreviewFitMode = true;
      setSvgPreviewSize();
      requestAnimationFrame(() => {
        if (!svgEditorPreviewViewport) return;
        svgEditorPreviewViewport.scrollLeft = Math.max(0, (svgEditorPreviewViewport.scrollWidth - svgEditorPreviewViewport.clientWidth) / 2);
        svgEditorPreviewViewport.scrollTop = Math.max(0, (svgEditorPreviewViewport.scrollHeight - svgEditorPreviewViewport.clientHeight) / 2);
      });
    };
    const updateSvgPreviewHighlight = (id:string, options:{locate?:boolean;force?:boolean}={}) => {
      const previousId = svgPreviewHighlightedId;
      svgPreviewHighlightedId = String(id || "");
      const root = svgEditorPreviewStage?.shadowRoot?.querySelector("svg");
      const hint = svgEditorPreview?.querySelector("[data-svg-preview-source]");
      if (hint) hint.textContent = svgPreviewHighlightedId ? tr("sftp:editor.svg_preview_target", {id:svgPreviewHighlightedId, defaultValue:`定位：${svgPreviewHighlightedId}`}) : "";
      if (!root) {
        updateSvgPreviewMarker();
        return;
      }
      root.querySelectorAll(".sftp-svg-editor-cursor-current").forEach(node => node.classList.remove("sftp-svg-editor-cursor-current"));
      if (!svgPreviewHighlightedId) {
        updateSvgPreviewMarker();
        return;
      }
      const target = resolveSvgPreviewTarget(svgPreviewHighlightedId);
      target?.classList.add("sftp-svg-editor-cursor-current");
      updateSvgPreviewMarker();
      if (svgPreviewHighlightedId && options.locate !== false && (options.force || svgPreviewHighlightedId !== previousId)) {
        requestAnimationFrame(() => centerSvgPreviewTarget(svgPreviewHighlightedId));
      }
    };
    const svgSourceLocator = createSftpSvgSourceLocator({
      getText: () => aceEditor ? aceEditor.getValue() : getValue(),
      getAceEditor: () => aceEditor,
      getFallbackEditor: () => fallbackEditor,
      onHighlight: (id, options) => updateSvgPreviewHighlight(id, options)
    });
    const focusSvgSourceId = (target:string|{id?:string;nodeName?:string;sourceElement?:Element|null}, options:{locate?:boolean}={}) => {
      const targetId = target && typeof target === "object" ? target.id : target;
      if (targetId && options.locate !== false) {
        svgPreviewFocusLockId = String(targetId);
        svgPreviewFocusLockUntil = Date.now() + 500;
      }
      svgSourceLocator.focusSourceId(target, {...options, locate:false});
      updateSvgPreviewHighlight(String(targetId || ""), {locate:false, force:true});
      if (targetId && options.locate !== false) {
        centerSvgPreviewTarget(String(targetId));
      }
    };
    const svgIdForCursor = () => svgSourceLocator.idForCursor();
    const syncSvgPreviewFromCursor = () => {
      if (svgPreviewFocusLockId && Date.now() < svgPreviewFocusLockUntil) return;
      svgPreviewFocusLockId = "";
      updateSvgPreviewHighlight(svgIdForCursor(), {locate:true});
    };
    const renderSvgEditorPreview = () => {
      if (!svgEditorPreview || svgModeSelect?.value !== "split") return;
      const stage = svgEditorPreviewStage;
      if (!stage) return;
      const previousScroll = {left:svgEditorPreviewViewport?.scrollLeft || 0, top:svgEditorPreviewViewport?.scrollTop || 0};
      try {
        if (typeof sanitizeSftpSvgDocument !== "function") throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
        const sanitizedRoot = sanitizeSftpSvgDocument(getValue());
        const embeddedStyles = String(sanitizedRoot.__termaEmbeddedStyles || "");
        const viewBox = typeof sftpSvgExportViewBox === "function" ? sftpSvgExportViewBox(sanitizedRoot) : {x:0, y:0, width:1024, height:768};
        svgPreviewBaseWidth = sftpSvgNumericDimension?.(sanitizedRoot.getAttribute("width"), viewBox.width) || viewBox.width;
        svgPreviewBaseHeight = sftpSvgNumericDimension?.(sanitizedRoot.getAttribute("height"), viewBox.height) || viewBox.height;
        if (!sanitizedRoot.getAttribute("height") && sanitizedRoot.getAttribute("width") && viewBox.width > 0) svgPreviewBaseHeight = svgPreviewBaseWidth * viewBox.height / viewBox.width;
        const root = document.importNode(sanitizedRoot, true);
        root.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
        root.setAttribute("preserveAspectRatio", root.getAttribute("preserveAspectRatio") || "xMidYMid meet");
        root.removeAttribute("width");
        root.removeAttribute("height");
        root.style.width = `${Math.max(1, svgPreviewBaseWidth)}px`;
        root.style.height = `${Math.max(1, svgPreviewBaseHeight)}px`;
        root.style.display = "block";
        root.style.overflow = "visible";
        const shadow = stage.shadowRoot || stage.attachShadow({mode:"open"});
        const style = document.createElement("style");
        style.textContent = `${embeddedStyles}\n:host{display:block;width:${Math.max(1, svgPreviewBaseWidth)}px;height:${Math.max(1, svgPreviewBaseHeight)}px}svg{display:block;width:100%;height:100%;max-width:none;max-height:none}.sftp-svg-editor-cursor-current{filter:drop-shadow(0 0 4px #ff3158) drop-shadow(0 0 8px #ffd43b)}`;
        shadow.replaceChildren(style, root);
        setSvgPreviewSize();
        if (!svgPreviewHasRendered) {
          svgPreviewHasRendered = true;
          fitSvgEditorPreview();
        } else requestAnimationFrame(() => { if (svgEditorPreviewViewport) { svgEditorPreviewViewport.scrollLeft = previousScroll.left; svgEditorPreviewViewport.scrollTop = previousScroll.top; } });
        updateSvgPreviewHighlight(svgPreviewHighlightedId || svgIdForCursor(), {locate:false});
        root.addEventListener("click", event => {
          const targetInfo = svgPreviewTargetInfoFromEvent(event);
          if (targetInfo?.id) {
            event.preventDefault();
            event.stopPropagation();
            focusSvgSourceId(targetInfo);
          }
        });
      } catch (caught) { const error=caught instanceof Error?caught:new Error(String(caught));
        const errorHost = stage.shadowRoot || stage;
        errorHost.replaceChildren();
        const errorNode = document.createElement("div");
        errorNode.className = "sftp-svg-editor-preview-error";
        errorNode.innerHTML = icon("triangle-alert");
        const errorText = document.createElement("span");
        errorText.textContent = error.message || tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"});
        errorNode.appendChild(errorText);
        errorHost.appendChild(errorNode);
        refreshIcons();
      }
    };
    const svgScheduler = createSftpSvgEditorScheduler({
      isActive:() => !finished && Boolean(svgEditorPreview) && svgModeSelect?.value === "split",
      renderPreview:renderSvgEditorPreview,
      syncCursor:syncSvgPreviewFromCursor
    });
    const syncSvgEditorMode = (value:string) => {
      if (!svgEditorPreview || !svgModeSelect) return;
      const mode = ["edit", "split"].includes(value) ? value : "edit";
      svgModeSelect.value = mode;
      const showPreview = mode === "split";
      if (!showPreview) svgScheduler.clear();
      editorWorkspace?.classList.toggle("showing-svg-preview", showPreview);
      svgEditorPreview.hidden = !showPreview;
      if (svgEditorPreviewSplitter) svgEditorPreviewSplitter.hidden = !showPreview;
      if (showPreview) {
        renderSvgEditorPreview();
        requestAnimationFrame(() => { if (svgPreviewFitMode) fitSvgEditorPreview(); else setSvgPreviewSize(); });
      }
      requestAnimationFrame(() => aceEditor?.resize(true));
    };
    let releaseSvgPreviewInteractions = () => {};
    let releaseSvgPreviewLayout = () => {};
    if (svgEditorPreviewViewport && svgEditorPreviewStage) {
      let dragState:{pointerId:number;clientX:number;clientY:number;scrollLeft:number;scrollTop:number;targetId:string}|null=null;
      let dragged = false;
      const updateSvgPreviewZoom = (next:number, anchor:{clientX:number;clientY:number}|null=null, {manual=true} = {}) => {
        if (!svgEditorPreviewViewport || !Number.isFinite(next)) return;
        if (manual) {
          cancelSvgPreviewAutoFocus();
        }
        const viewportRect = svgEditorPreviewViewport.getBoundingClientRect();
        const previousScale = svgPreviewScale;
        const anchorX = anchor && Number.isFinite(anchor.clientX) ? anchor.clientX : viewportRect.left + viewportRect.width / 2;
        const anchorY = anchor && Number.isFinite(anchor.clientY) ? anchor.clientY : viewportRect.top + viewportRect.height / 2;
        const gutterX = svgEditorPreviewViewport.clientWidth / 2;
        const gutterY = svgEditorPreviewViewport.clientHeight / 2;
        const logicalX = (svgEditorPreviewViewport.scrollLeft + anchorX - viewportRect.left - gutterX) / Math.max(.05, previousScale);
        const logicalY = (svgEditorPreviewViewport.scrollTop + anchorY - viewportRect.top - gutterY) / Math.max(.05, previousScale);
        svgPreviewScale = Math.max(.05, Math.min(8, next));
        svgPreviewFitMode = false;
        setSvgPreviewSize();
        svgEditorPreviewViewport.scrollLeft = Math.max(0, gutterX + logicalX * svgPreviewScale - (anchorX - viewportRect.left));
        svgEditorPreviewViewport.scrollTop = Math.max(0, gutterY + logicalY * svgPreviewScale - (anchorY - viewportRect.top));
      };
      const svgAutoFocusController = createSftpSvgAutoFocusController({
        getViewport:() => svgEditorPreviewViewport,
        getStage:() => svgEditorPreviewStage,
        getTarget:resolveSvgPreviewTarget,
        getToggle:svgPreviewAutoFocusToggle,
        getScale:() => svgPreviewScale,
        setScale:nextScale => updateSvgPreviewZoom(nextScale, null, {manual:false}),
        updateMarker:updateSvgPreviewMarker
      });
      centerSvgPreviewTarget = svgAutoFocusController.focus;
      cancelSvgPreviewAutoFocus = svgAutoFocusController.cancel;
      clearSvgPreviewAutoFocus = svgAutoFocusController.clear;
      const onPreviewWheel = (event:WheelEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        updateSvgPreviewZoom(svgPreviewScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event, {manual:true});
      };
      const onPreviewScroll = () => updateSvgPreviewMarker();
      const onPreviewPointerMove = (event:PointerEvent) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const dx = event.clientX - dragState.clientX;
        const dy = event.clientY - dragState.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          if (!dragged) cancelSvgPreviewAutoFocus();
          dragged = true;
          try { svgEditorPreviewViewport.setPointerCapture?.(dragState.pointerId); } catch {}
          event.preventDefault();
        }
        svgEditorPreviewViewport.scrollLeft = dragState.scrollLeft - dx;
        svgEditorPreviewViewport.scrollTop = dragState.scrollTop - dy;
      };
      const finishPreviewDrag = (event:PointerEvent|null=null) => {
        if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
        const pointerId = dragState.pointerId;
        const targetId = dragState.targetId;
        const wasDragged = dragged;
        dragState = null;
        svgEditorPreviewViewport.classList.remove("is-panning");
        document.removeEventListener("pointermove", onPreviewPointerMove);
        document.removeEventListener("pointerup", finishPreviewDrag);
        document.removeEventListener("pointercancel", finishPreviewDrag);
        try { svgEditorPreviewViewport.releasePointerCapture?.(pointerId); } catch {}
        if (!wasDragged && targetId) focusSvgSourceId(targetId);
        setTimeout(() => { dragged = false; }, 0);
      };
      const startPreviewDrag = (event:PointerEvent) => {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
        dragState = {pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, scrollLeft:svgEditorPreviewViewport.scrollLeft, scrollTop:svgEditorPreviewViewport.scrollTop, targetId:svgPreviewTargetIdFromEvent(event)};
        dragged = false;
        svgEditorPreviewViewport.classList.add("is-panning");
        document.addEventListener("pointermove", onPreviewPointerMove);
        document.addEventListener("pointerup", finishPreviewDrag);
        document.addEventListener("pointercancel", finishPreviewDrag);
      };
      const onPreviewClick = (event:MouseEvent) => { if (dragged) { event.preventDefault(); event.stopPropagation(); } };
      svgEditorPreviewViewport.addEventListener("wheel", onPreviewWheel, {passive:false});
      svgEditorPreviewViewport.addEventListener("scroll", onPreviewScroll, {passive:true});
      svgEditorPreviewViewport.addEventListener("pointerdown", startPreviewDrag);
      svgEditorPreviewViewport.addEventListener("click", onPreviewClick, true);
      svgEditorPreview!.querySelectorAll<HTMLElement>("[data-svg-preview-zoom]").forEach(button => button.addEventListener("click", () => {
        const mode = button.dataset.svgPreviewZoom;
        if (mode === "fit") fitSvgEditorPreview({manual:true});
        else updateSvgPreviewZoom(svgPreviewScale * (mode === "in" ? 1.25 : 1 / 1.25), null, {manual:true});
      }));
      const autoFocusToggle = svgPreviewAutoFocusToggle();
      const onAutoFocusChange = () => {
        if (autoFocusToggle?.checked && svgPreviewHighlightedId) centerSvgPreviewTarget(svgPreviewHighlightedId);
      };
      autoFocusToggle?.addEventListener("change", onAutoFocusChange);
      const previewResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        if (svgPreviewFitMode) fitSvgEditorPreview();
        else updateSvgPreviewMarker();
      }) : null;
      previewResizeObserver?.observe(svgEditorPreviewViewport);
      releaseSvgPreviewInteractions = () => {
        finishPreviewDrag();
        svgAutoFocusController.clear();
        previewResizeObserver?.disconnect();
        svgEditorPreviewViewport.removeEventListener("wheel", onPreviewWheel);
        svgEditorPreviewViewport.removeEventListener("scroll", onPreviewScroll);
        svgEditorPreviewViewport.removeEventListener("pointerdown", startPreviewDrag);
        svgEditorPreviewViewport.removeEventListener("click", onPreviewClick, true);
        autoFocusToggle?.removeEventListener("change", onAutoFocusChange);
      };
    }
    if (svgModeSelect) syncSvgEditorMode(initialSvgMode);
    const focusEditor = () => aceEditor ? aceEditor.focus() : fallbackEditor.focus();
    const searchBar = getEditor("#sftpEditorSearchBar");
    const searchInput = getEditor("#sftpEditorSearchInput");
    const searchCount = getEditor("#sftpEditorSearchCount");
    const replaceRow = getEditor("#sftpEditorReplaceRow");
    const replaceToggle = getEditor("#sftpEditorReplaceToggle");
    const replaceInput = getEditor("#sftpEditorReplaceInput");
    const replaceOne = getEditor("#sftpEditorReplaceOne");
    const replaceAll = getEditor("#sftpEditorReplaceAll");
    const toggleEditorReplace = (expanded:boolean) => {
      replaceRow.hidden = !expanded;
      replaceToggle.setAttribute("aria-expanded", String(expanded));
    };
    toggleEditorReplace(false);
    let editorSearchQuery = "";
    let editorSearchMatches:{start:number;length:number}[] = [];
    let editorSearchIndex = -1;
    let editorSearchTimer = 0;
    const invalidateEditorSearchMatches = () => {
      editorSearchQuery = "";
      editorSearchMatches = [];
      editorSearchIndex = -1;
    };
    const closeEditorSearch = () => {
      searchBar.hidden = true;
      focusEditor();
    };
    const openEditorSearch = () => {
      searchBar.hidden = false;
      searchInput.focus();
      searchInput.select();
    };
    const editorSearchExpression = (query:string) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const aceRange = (start:number, end:number) => {
      const Range = ace!.require("ace/range").Range;
      const document = aceEditor!.session.getDocument();
      const from = document.indexToPosition(start, 0);
      const to = document.indexToPosition(end, 0);
      return new Range(from.row, from.column, to.row, to.column);
    };
    const rebuildEditorSearchMatches = () => {
      const query = String(searchInput.value || "");
      if (query === editorSearchQuery) return;
      editorSearchQuery = query;
      editorSearchMatches = [];
      editorSearchIndex = -1;
      if (!query) return;
      for (const match of getValue().matchAll(editorSearchExpression(query))) {
        editorSearchMatches.push({start:match.index, length:match[0].length});
        if (editorSearchMatches.length >= 10000) break;
      }
    };
    const selectEditorSearchMatch = (index:number) => {
      const query = String(searchInput.value || "");
      if (!query || index < 0) return;
      const match = editorSearchMatches[index];
      const start = match.start;
      const end = start + match.length;
      if (aceEditor) {
        const range = aceRange(start, end);
        aceEditor.selection.setRange(range, false);
        aceEditor.scrollToLine?.(range.start.row, true, true);
        aceEditor.renderer?.scrollCursorIntoView?.(range.start, 0.45);
      } else {
        let pageStart = 0;
        if (useLightEditor) {
          for (let page = 0; page < lightPageCount(); page += 1) {
            const pageEnd = pageStart + lightPageValue(page).length;
            if (start < pageEnd) {
              if (page !== lightPageIndex) renderLightPage(page);
              break;
            }
            pageStart = pageEnd;
          }
        }
        fallbackEditor.setSelectionRange(start - pageStart, end - pageStart);
        scrollSftpFallbackEditorToOffset(fallbackEditor, fallbackEditor.value, start - pageStart);
      }
    };
    const showEditorMatch = (index:number) => {
      editorSearchIndex = index;
      replaceOne.disabled = index < 0;
      replaceAll.disabled = index < 0;
      searchCount.textContent = index >= 0 ? `${index + 1}/${editorSearchMatches.length}`
        : searchInput.value ? tr("sftp:editor.search_empty") : "";
      if (index >= 0) selectEditorSearchMatch(index);
    };
    const stepEditorSearch = (direction:number) => {
      rebuildEditorSearchMatches();
      const count = editorSearchMatches.length;
      const current = editorSearchIndex < 0 && direction < 0 ? 0 : editorSearchIndex;
      showEditorMatch(count ? (current + direction + count) % count : -1);
    };
    showEditorMatch(-1);

    const applyEditorReplacement = (source:string, start:number, end:number, replacement:string) => {
      if (aceEditor) {
        aceEditor.session.markUndoGroup();
        aceEditor.session.replace(aceRange(start, end), replacement);
        aceEditor.session.markUndoGroup();
      } else {
        if (useLightEditor) {
          setValue(source.slice(0, start) + replacement + source.slice(end));
          documentSession.change();
          contentModified = true;
          scheduleEditorStats();
          svgScheduler.render();
        } else {
          fallbackEditor.setRangeText(replacement, start, end, "end");
          fallbackEditor.dispatchEvent(new Event("input", {bubbles:true}));
        }
      }
      invalidateEditorSearchMatches();
    };
    const replaceEditorMatches = (all:boolean) => {
      clearTimeout(editorSearchTimer);
      editorSearchTimer = 0;
      rebuildEditorSearchMatches();
      if (!editorSearchMatches.length) return showEditorMatch(-1);
      const source = getValue();
      const replacement = replaceInput.value;
      const maxLength = Math.max(source.length, limit);
      let nextOffset = 0;
      if (all) {
        const expression = editorSearchExpression(searchInput.value);
        let length = source.length;
        for (const match of source.matchAll(expression)) {
          length += replacement.length - match[0].length;
          if (length > maxLength) break;
        }
        if (length > maxLength) return port.notify(tr("sftp:editor.replace_too_large"), "error");
        const replaced = source.replace(expression, () => replacement);
        if (replaced !== source) applyEditorReplacement(source, 0, source.length, replaced);
      } else {
        const { start, length } = editorSearchMatches[Math.max(0, editorSearchIndex)];
        if (source.length - length + replacement.length > maxLength) return port.notify(tr("sftp:editor.replace_too_large"), "error");
        if (source.slice(start, start + length) !== replacement) applyEditorReplacement(source, start, start + length, replacement);
        nextOffset = start + replacement.length;
      }
      rebuildEditorSearchMatches();
      const next = editorSearchMatches.findIndex(match => match.start >= nextOffset);
      showEditorMatch(editorSearchMatches.length ? Math.max(0, next) : -1);
    };
    let releaseEditorLayout = () => {};
    let editorStatsTimer = 0;
    const finish = (value:EditorResult) => {
      if (finished) return;
      finished = true;
      documentSession.dispose();
      clearTimeout(editorStatsTimer);
      clearTimeout(editorSearchTimer);
      svgScheduler.clear();
      document.removeEventListener("keydown", onModalKeyDown, true);
      window.removeEventListener("terma:language-changed", onEditorLanguageChange);
      releaseEditorLayout();
      releaseSvgPreviewInteractions();
      releaseSvgPreviewLayout();
      releaseFloatingEditor();
      svgSourceLocator?.clear?.();
      if (editorKey && sftpFloatingEditorRegistry.get(editorKey)?.modal === modal) sftpFloatingEditorRegistry.delete(editorKey);
      try { aceEditor?.destroy(); } catch {}
      lightSource = "";
      lightPageEdits.clear();
      port.release(modal);
      modal.remove();
      if (!floatingLayer.querySelector(".sftp-editor-floating-window")) floatingLayer.remove();
      else refreshSftpFloatingEditorShelfLabels(floatingLayer);
      resolve(value);
    };
    const saveButton = getEditor("#sftpTextSave");
    const selectedLanguage = () => getEditor("#sftpEditorLanguage")?.value === "auto" ? detectedLanguage : getEditor("#sftpEditorLanguage")?.value;
    const syncFormatButton = () => {
      getEditor("#sftpTextFormatJson").hidden = useLightEditor || !isSftpJsonFileName(title) || selectedLanguage() !== "json";
    };
    let contentModified = diffOptions.initialModified === true;
    const updateStats = (force=false, providedValue:string|null=null, providedEncoding="") => {
      if (useLightEditor && contentModified && !force) {
        getEditor("#sftpEditorStats").textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        getEditor("#sftpEditorStats").classList.remove("limit-exceeded");
        saveButton.disabled = documentSession.saving;
        return true;
      }
      const initial = !contentModified && documentSession.revision === 0 && providedValue === null;
      const value = initial && useLightEditor ? "" : (providedValue === null ? getValue() : providedValue);
      const measurement = initial
        ? {bytes:Number(size || 0), exact:true}
        : sftpEditorByteMeasurement(value, providedEncoding || getEditor("#sftpTextEncoding")?.value || encoding);
      if (!measurement.exact) {
        const stats = getEditor("#sftpEditorStats");
        stats.textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        stats.classList.remove("limit-exceeded");
        saveButton.disabled = documentSession.saving;
        return true;
      }
      const bytes = measurement.bytes;
      const tooLarge = bytes > limit;
      const stats = getEditor("#sftpEditorStats");
      const lines = initial && Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : value.split("\n").length;
      const limitSuffix = tooLarge ? tr("sftp:editor.limit_exceeded_suffix", {defaultValue:" · 已超过上限"}) : "";
      stats.textContent = tr("sftp:editor.statistics", {lines, size:formatBytes(bytes), limit:limitSuffix, defaultValue:`${lines} 行 · ${formatBytes(bytes)}${limitSuffix}`});
      stats.classList.toggle("limit-exceeded", tooLarge);
      saveButton.disabled = documentSession.saving || tooLarge;
      return !tooLarge;
    };
    const scheduleEditorStats = () => {
      clearTimeout(editorStatsTimer);
      editorStatsTimer = setTimeout(() => {
        editorStatsTimer = 0;
        if (!finished) updateStats();
      }, 120);
    };
    updateStats();
    syncFormatButton();
    if (aceEditor) {
      aceEditor.session.on("change", () => { documentSession.change(); contentModified = true; invalidateEditorSearchMatches(); scheduleEditorStats(); svgScheduler.render(); });
      aceEditor.commands.addCommand({name:"saveSftpFile", bindKey:{win:"Ctrl-S",mac:"Command-S"}, exec:()=>saveButton.click()});
    } else fallbackEditor.addEventListener("input", () => {
      documentSession.change();
      if (useLightEditor) {
        commitLightPage();
        contentModified = lightPageEdits.size > 0 || lightSource !== initialLightSource;
      } else contentModified = true;
      invalidateEditorSearchMatches();
      scheduleEditorStats();
      svgScheduler.render();
    });
    svgModeSelect?.addEventListener("change", event => {
      const mode = String((event.currentTarget as HTMLSelectElement).value || "edit");
      if (mode === "preview") {
        const currentContent = getValue();
        finish({
          action:"preview",
          content:currentContent,
          size:sftpEditorByteMeasurement(currentContent, getEditor("#sftpTextEncoding")?.value || encoding).bytes,
          limit,
          encoding:getEditor("#sftpTextEncoding")?.value || encoding,
          preferredEncoding,
          lineEnding:getEditor("#sftpLineEnding")?.value || initialLineEnding,
          finalNewline:/\r\n$|\r$|\n$/.test(currentContent),
          needsFormatRepair:scriptNeedsFormatRepair,
          modified:contentModified
        });
        return;
      }
      if (mode === "split" && editorWorkspace?.classList.contains("showing-diff")) closeDiffPreview();
      syncSvgEditorMode(mode);
      focusEditor();
    });
    releaseEditorLayout = bindSftpEditorLayout(card, editorWorkspace, diffSplitter, () => aceEditor?.resize(true));
    if (svgEditorPreviewSplitter && typeof bindSftpSvgEditorLayout === "function") {
      releaseSvgPreviewLayout = bindSftpSvgEditorLayout(editorWorkspace, svgEditorPreviewSplitter, () => aceEditor?.resize(true));
    }
    if (aceEditor && svgEditorPreview) {
      const syncSvgCursor = () => { if (svgModeSelect?.value === "split") svgScheduler.cursor(); };
      aceEditor.selection.on("changeCursor", syncSvgCursor);
      aceEditor.selection.on("changeSelection", syncSvgCursor);
      const previousRelease = releaseSvgPreviewInteractions;
      releaseSvgPreviewInteractions = () => {
        previousRelease();
        aceEditor.selection.off("changeCursor", syncSvgCursor);
        aceEditor.selection.off("changeSelection", syncSvgCursor);
      };
    }
    if (fallbackEditor && svgEditorPreview) {
      const syncSvgSelection = () => { if (svgModeSelect?.value === "split") svgScheduler.cursor(); };
      fallbackEditor.addEventListener("keyup", syncSvgSelection);
      fallbackEditor.addEventListener("click", syncSvgSelection);
      const previousRelease = releaseSvgPreviewInteractions;
      releaseSvgPreviewInteractions = () => {
        previousRelease();
        fallbackEditor.removeEventListener("keyup", syncSvgSelection);
        fallbackEditor.removeEventListener("click", syncSvgSelection);
      };
    }
    let diffRequestSequence = 0;
    const diffPreviewLabel = () => tr("sftp:editor.preview_diff", {defaultValue:"预览差异"});
    const closeDiffLabel = () => tr("sftp:editor.close_diff", {defaultValue:"关闭差异"});
    let lastDiffOptions:{loading?:boolean;error?:string;newText?:string;versionTime?:string;oldText?:string}|null=null;
    const renderDiffPreview = (content:string, options:{loading?:boolean;error?:string;newText?:string;versionTime?:string}={}) => {
      if (!diffPreview) return;
      lastDiffOptions = {...options};
      const heading = options.loading
        ? tr("sftp:editor.reading_history", {defaultValue:"正在读取历史版本..."})
        : tr("sftp:editor.diff_preview_title", {defaultValue:"差异预览"});
      lastDiffOptions.oldText = content;
      renderEditorDiff(diffPreview,{heading,closeLabel:closeDiffLabel(),loading:!!options.loading,error:options.error || '',
        model:options.loading || options.error ? null : editorDiff(content,options.newText??getValue(),{oldLabel:options.versionTime?tr('sftp:editor.backup_label',{time:options.versionTime}):tr('sftp:editor.previous_backup'),newLabel:tr('sftp:editor.current_content')},{tr,bytes:formatBytes,diffLines:port.diffLines}),close:closeDiffPreview});
    };
    const closeDiffPreview = () => {
      diffRequestSequence += 1;
      documentSession.closeComparison();
      setSftpEditorDiffVisible(editorWorkspace, diffSplitter, diffPreview, false);
      renderEditorDiff(diffPreview,null);
      const button = getEditor("#sftpTextDiff");
      if (button) {
        button.textContent = diffPreviewLabel();
        button.classList.remove("busy", "active");
        button.disabled = useLightEditor || !versions.length;
      }
      requestAnimationFrame(() => aceEditor?.resize(true));
    };
    const syncHistoryControls = () => {
      const select = getEditor("#sftpDiffHistory");
      const button = getEditor("#sftpTextDiff");
      if (!select || !button) return;
      select.innerHTML = versions.length
        ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
        : `<option value="">${esc(tr("sftp:editor.no_comparable_backups", {defaultValue:"没有可比较的备份"}))}</option>`;
      select.disabled = useLightEditor || !versions.length;
      button.disabled = useLightEditor || !versions.length;
      const count = getEditor("#sftpDiffHistoryCount");
      if (count) count.textContent = tr("sftp:editor.recent_backups", {count:versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`});
    };
    if (historyLoading) {
      documentSession.history(() => Promise.resolve().then(() => diffOptions.loadVersions!())).then(result => {
        if (finished || !result) return;
        historyPending = false;
        versions = result;
        syncHistoryControls();
      }).catch(() => {
        if (finished) return;
        historyPending = false;
        versions = [];
        syncHistoryControls();
      });
    } else syncHistoryControls();
    if (useLightEditor) {
      getEditor("#sftpEditorLanguage").disabled = true;
      getEditor("#sftpEditorLanguage").title = tr("sftp:editor.light_no_highlight", {defaultValue:"轻量编辑器不加载语法高亮"});
      getEditor("#sftpTextDiff").title = tr("sftp:editor.light_no_diff", {defaultValue:"轻量编辑器为避免占用大量内存，不加载全文差异预览"});
    }
    getEditor("#sftpTextDiff").onclick = async () => {
      if (editorWorkspace?.classList.contains("showing-diff")) {
        closeDiffPreview();
        return;
      }
      if (!versions.length) return notify(tr("sftp:editor.no_history", {defaultValue:"没有可比较的历史备份"}), "info");
      if (svgModeSelect?.value === "split") syncSvgEditorMode("edit");
      const box = diffPreview;
      setSftpEditorDiffVisible(editorWorkspace, diffSplitter, box, true);
      requestAnimationFrame(() => aceEditor?.resize(true));
      const button = getEditor("#sftpTextDiff");
      button.textContent = closeDiffLabel();
      button.classList.add("active");
      const selected = Number(getEditor("#sftpDiffHistory")?.value || 0);
      let comparisonContent = "";
      let versionTime = "";
      const requestSequence = ++diffRequestSequence;
      renderDiffPreview("", {loading:true});
      if (versions[selected] && typeof diffOptions.loadVersion === "function") {
        button.disabled = true;
        button.classList.add("busy");
        try {
          const version = versions[selected];
          const comparison = await documentSession.compare(() => diffOptions.loadVersion!(version, encoding));
          if (!comparison || requestSequence !== diffRequestSequence || finished) return;
          const loaded = comparison.value;
          comparisonContent = loaded?.content || "";
          versionTime = sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000);
        } catch (caught) { const error=caught instanceof Error?caught:new Error(String(caught));
          if (requestSequence !== diffRequestSequence || finished) return;
          renderDiffPreview("", {error:error.message || tr("sftp:editor.history_read_failed", {defaultValue:"历史版本读取失败"})});
          return;
        } finally {
          if (!finished && requestSequence === diffRequestSequence) button.disabled = false;
          button.classList.remove("busy");
        }
      }
      if (requestSequence !== diffRequestSequence || finished) return;
      renderDiffPreview(comparisonContent, {versionTime});
    };
    getEditor("#sftpTextEncoding").onchange = event => {
      const nextEncoding = (event.currentTarget as HTMLSelectElement).value;
      if (contentModified) {
        (event.currentTarget as HTMLSelectElement).value = encoding;
        notify(tr("sftp:editor.switch_encoding_blocked", {defaultValue:"请先保存或放弃当前修改，再切换文本编码"}), "info");
        return;
      }
      finish({action:"encoding", encoding:nextEncoding});
    };
    getEditor("#sftpEditorLanguage").onchange = event => {
      const language = (event.currentTarget as HTMLSelectElement).value === "auto" ? detectedLanguage : (event.currentTarget as HTMLSelectElement).value;
      aceEditor?.session.setMode(`ace/mode/${language}`);
      syncFormatButton();
      focusEditor();
    };
    getEditor("#sftpTextFormatJson").onclick = () => {
      try {
        const parsed = JSON.parse(getValue().replace(/^\uFEFF/, ""));
        setValue(JSON.stringify(parsed, null, 2));
        contentModified = true;
        updateStats();
        focusEditor();
        notify(tr("sftp:editor.json_formatted", {defaultValue:"JSON 已格式化"}), "success");
      } catch (caught) { const error=caught instanceof Error?caught:new Error(String(caught));
        notify(tr("sftp:editor.json_error", {error:error.message || error, defaultValue:`JSON 格式错误：${error.message || error}`}), "error");
      }
    };
    getEditor("#sftpEditorWordWrap").onchange = event => {
      localStorage.setItem("sftpEditorWordWrap", (event.currentTarget as HTMLInputElement).checked ? "1" : "0");
      aceEditor?.session.setUseWrapMode((event.currentTarget as HTMLInputElement).checked);
      if (fallbackEditor) fallbackEditor.style.whiteSpace = (event.currentTarget as HTMLInputElement).checked ? "pre-wrap" : "pre";
      focusEditor();
    };
    getEditor("#sftpLineEnding").onchange = () => { documentSession.change(); contentModified = true; };
    getEditor("#sftpEditorSearchToggle").onclick = openEditorSearch;
    getEditor("#sftpEditorSearchPrevious").onclick = () => stepEditorSearch(-1);
    getEditor("#sftpEditorSearchNext").onclick = () => stepEditorSearch(1);
    getEditor("#sftpEditorSearchClose").onclick = closeEditorSearch;
    replaceToggle.onclick = () => {
      const expanded = Boolean(replaceRow.hidden);
      toggleEditorReplace(expanded);
      if (expanded) replaceInput.focus();
    };
    replaceOne.onclick = () => replaceEditorMatches(false);
    replaceAll.onclick = () => replaceEditorMatches(true);
    replaceInput.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      replaceEditorMatches(false);
    });
    searchInput.addEventListener("input", () => {
      invalidateEditorSearchMatches();
      clearTimeout(editorSearchTimer);
      editorSearchTimer = setTimeout(() => {
        editorSearchTimer = 0;
        if (!finished) stepEditorSearch(1);
      }, 120);
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(editorSearchTimer);
      editorSearchTimer = 0;
      stepEditorSearch(event.shiftKey ? -1 : 1);
    });
    getEditor("#sftpTextSave").onclick = async () => {
      if (finished || documentSession.saving) return;
      const savedRevision = documentSession.revision;
      clearTimeout(editorStatsTimer);
      editorStatsTimer = 0;
      const value = getValue();
      const prepared = prepareSftpEditorSave(title, value, getEditor("#sftpTextEncoding").value, getEditor("#sftpLineEnding").value);
      if (prepared.unsafeScriptLineEnding && !await confirmModal(
        tr("sftp:editor.shell_line_ending_warning", {lineEnding:sftpTextLineEndingLabel(prepared.lineEnding), defaultValue:`当前脚本将使用 ${sftpTextLineEndingLabel(prepared.lineEnding)} 保存，可能在 Unix/Linux 上出现 ^M 或无法执行。仍然保存？`}),
        tr("sftp:editor.shell_line_ending_title", {defaultValue:"脚本换行符兼容性提醒"}),
        tr("sftp:editor.save_anyway", {defaultValue:"仍然保存"}),
        tr("sftp:editor.continue_editing", {defaultValue:"继续编辑"}),
        true
      )) return;
      if (finished || documentSession.saving) return;
      if (!updateStats(true, prepared.content, prepared.encoding)) return notify(tr("sftp:editor.content_too_large", {limit:formatBytes(limit), defaultValue:`在线编辑内容不能超过 ${formatBytes(limit)}`}), "error");
      const payload:EditorSave = {action:"save", content:prepared.content, changed:contentModified || prepared.changed || scriptNeedsFormatRepair, backup:getEditor("#sftpBackupBeforeSave").checked, encoding:prepared.encoding, line_ending:prepared.lineEnding, normalized_script:prepared.unixScript && prepared.lineEnding === "lf", persist_default:getEditor("#sftpPersistEncoding").checked};
      if (typeof diffOptions.onSave !== "function") return finish(payload);
      if (!payload.changed && !(payload.persist_default && preferredEncoding !== payload.encoding)) {
        editorSaveStatus.hidden = false;
        editorSaveStatus.classList.remove("error");
        editorSaveStatus.classList.add("success");
        setEditorSaveStatus("no_changes");
        return;
      }
      saveButton.disabled = true;
      saveButton.classList.add("busy");
      editorSaveStatus.hidden = false;
      editorSaveStatus.classList.remove("error", "success");
      setEditorSaveStatus("saving_remote");
      try {
        const saved = await documentSession.save(payload, savedRevision, async draft => {
          const result = await diffOptions.onSave!(draft);
          if (!finished) {
            try { await diffOptions.onSaved?.(result, {...draft, encoding:result?.encoding || draft.encoding}); } catch {}
          }
          return result;
        });
        if (!saved || finished) return;
        const savedResult = saved.result;
        if (saved.current) { contentModified = false; scriptNeedsFormatRepair = false; }
        const savedEncoding = savedResult?.encoding || payload.encoding;
        encoding = savedEncoding;
        if (payload.persist_default) preferredEncoding = savedEncoding;
        const encodingSelect = getEditor("#sftpTextEncoding");
        if (encodingSelect && [...encodingSelect.options].some(option => option.value === savedEncoding)) encodingSelect.value = savedEncoding;
        editorSaveStatus.classList.add("success");
        setEditorSaveStatus("saved_remote");
        updateStats(true, getValue(), savedEncoding);
        focusEditor();
      } catch (caught) { const error=caught instanceof Error?caught:new Error(String(caught));
        if (finished) return;
        editorSaveStatus.classList.add("error");
        setEditorSaveStatus("save_waiting_reconnect");
        notify(error.message || tr("sftp:editor.remote_save_failed", {defaultValue:"保存到远端失败，编辑内容已保留"}), "error");
      } finally {
        if (!finished) {
          updateStats();
          saveButton.classList.remove("busy");
        }
      }
    };
    getEditor("#sftpTextClose").onclick = async () => {
      if (contentModified && !await confirmModal(
        () => tr("sftp:editor.unsaved_confirm", {defaultValue:"当前修改尚未保存，确认关闭？"}),
        () => tr("sftp:editor.discard_title", {defaultValue:"放弃修改"}),
        () => tr("sftp:editor.discard", {defaultValue:"放弃修改"}),
        () => tr("sftp:editor.continue_editing", {defaultValue:"继续编辑"}),
        true
      )) return;
      finish(null);
    };
    getEditor("#sftpEditorCloseTop").onclick = () => getEditor("#sftpTextClose").click();
    const onModalKeyDown = (event:KeyboardEvent) => {
      if (!modal.contains(event.target instanceof Node?event.target:null) && !modal.contains(document.activeElement)) return;
      const shortcut = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (shortcut === "f" || shortcut === "h")) {
        event.preventDefault();
        event.stopPropagation();
        openEditorSearch();
        if (shortcut === "h") toggleEditorReplace(true);
        return;
      }
      if (event.key === "Escape" && !searchBar.hidden) {
        event.preventDefault();
        closeEditorSearch();
      } else if (event.key === "Escape") getEditor("#sftpTextClose").click();
    };
    document.addEventListener("keydown", onModalKeyDown, true);
    const onEditorLanguageChange = () => {
      if (finished) return;
      const disabled = saveButton.disabled;
      updateStats();
      saveButton.disabled = disabled;
      const history = getEditor("#sftpDiffHistory");
      if (history && !versions.length && history.options[0]) history.options[0].textContent = tr(historyPending ? "sftp:editor.loading_backups" : "sftp:editor.no_comparable_backups");
      const count = getEditor("#sftpDiffHistoryCount");
      if (count) count.textContent = historyPending ? tr("sftp:editor.loading_backups") : tr("sftp:editor.recent_backups", {count:versions.length});
      const fullscreen = getEditor("#sftpEditorFullscreen");
      const fullscreenText = tr(card.classList.contains("is-fullscreen") ? "sftp:editor.exit_fullscreen" : "sftp:editor.fullscreen");
      fullscreen.title = fullscreenText;
      fullscreen.setAttribute("aria-label", fullscreenText);
      getEditor("#sftpTextDiff").textContent = editorWorkspace.classList.contains("showing-diff") ? closeDiffLabel() : diffPreviewLabel();
      if (lastDiffOptions && editorWorkspace.classList.contains("showing-diff")) {
        const heading = diffPreview.querySelector(".sftp-diff-preview-head strong");
        if (heading) heading.textContent = tr(lastDiffOptions.loading ? "sftp:editor.reading_history" : "sftp:editor.diff_preview_title");
        const close = modal.querySelector<HTMLButtonElement>("#sftpDiffClose");
        if (close) close.textContent = closeDiffLabel();
        const columns = diffPreview.querySelectorAll(".sftp-diff-columns strong");
        if (columns[0]) columns[0].textContent = lastDiffOptions.versionTime ? tr("sftp:editor.backup_label", {time:lastDiffOptions.versionTime}) : tr("sftp:editor.previous_backup");
        if (columns[1]) columns[1].textContent = tr("sftp:editor.current_content");
        const status = diffPreview.querySelector(".sftp-diff-unavailable");
        if (status && lastDiffOptions.loading) {
          const textNode = [...status.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
          if (textNode) textNode.textContent = ` ${tr("sftp:editor.reading_history")}`;
        } else if (status && !lastDiffOptions.error) status.textContent = tr("sftp:diff.same_content");
      }
      if (searchInput.value && !editorSearchMatches.length) searchCount.textContent = tr("sftp:editor.search_empty");
      if (editorSaveStatusKey) setEditorSaveStatus(editorSaveStatusKey);
      if (useLightEditor) {
        getEditor("#sftpEditorLanguage").title = tr("sftp:editor.light_no_highlight");
        getEditor("#sftpTextDiff").title = tr("sftp:editor.light_no_diff");
        const segmentLabel = lightPager?.querySelector("label");
        if (segmentLabel?.firstChild?.nodeType === Node.TEXT_NODE) segmentLabel.firstChild.textContent = `${tr("sftp:editor.segment")} `;
        lightPager?.querySelector("input")?.setAttribute("aria-label", tr("sftp:editor.current_segment"));
        const summary = lightPager?.querySelector(":scope > span");
        if (summary) summary.textContent = tr("sftp:editor.segment_summary", {count:lightPageCount()});
        for (const [index, key] of ["previous_segment", "next_segment"].entries()) {
          const button = lightPager?.querySelectorAll("button")[index];
          button?.setAttribute("title", tr(`sftp:editor.${key}`));
          button?.setAttribute("aria-label", tr(`sftp:editor.${key}`));
        }
      }
      if (isSvgDocument) {
        updateSvgPreviewHighlight(svgPreviewHighlightedId, {locate:false});
      }
    };
    window.addEventListener("terma:language-changed", onEditorLanguageChange);
    setTimeout(focusEditor, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => diffOptions.onReady?.()));
  });
}

return {sftpEditorViewModel,sftpTextEncodingOptions,sftpEditorLanguageOptions,sftpTextLineEndingOptions,sftpTextEncodingLabel,sftpTextLineEnding,sftpTextLineEndingLabel,isSftpUnixScript,prepareSftpEditorSave,sftpEditorByteMeasurement,sftpEditorLanguageForFile,sftpEditorLanguageLabel,isSftpJsonFileName,isSftpImageName,isSftpSvgName,sftpTextEditorOpenKey,activateSftpTextEditor,sftpFloatingEditorLayer,refreshSftpFloatingEditorShelfLabels,sftpFloatingEditorShelfItem,sftpTextModal};}
