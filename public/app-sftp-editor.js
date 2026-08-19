const sftpTextEncodingOptions = [
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

function sftpTextEncodingLabel(value) {
  return sftpTextEncodingOptions.find(([encoding]) => encoding === value)?.[1] || String(value || "UTF-8");
}

function sftpTextLineEnding(value) {
  return ["lf", "crlf", "cr"].includes(value) ? value : "lf";
}

function isSftpUnixScript(title, content="") {
  const basename = String(title || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  if (/\.(?:sh|bash|zsh|ksh|dash|fish)$/.test(basename)) return true;
  if ([".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile", ".kshrc"].includes(basename)) return true;
  return /^\uFEFF?#!/.test(String(content || ""));
}

function prepareSftpEditorSave(title, content, encoding="utf8", lineEnding="lf") {
  const originalContent = String(content || "");
  const originalEncoding = String(encoding || "utf8");
  const unixScript = isSftpUnixScript(title, originalContent);
  const selectedLineEnding = unixScript ? "lf" : sftpTextLineEnding(lineEnding);
  let value = (unixScript ? originalContent.replace(/^\uFEFF/, "") : originalContent).replace(/\r\n|\r|\n/g, "\n");
  if (selectedLineEnding === "crlf") value = value.replace(/\n/g, "\r\n");
  else if (selectedLineEnding === "cr") value = value.replace(/\n/g, "\r");
  if (unixScript && value && !value.endsWith("\n")) value += "\n";
  const selectedEncoding = unixScript && originalEncoding === "utf8bom" ? "utf8" : originalEncoding;
  return {
    content:value,
    encoding:selectedEncoding,
    lineEnding:selectedLineEnding,
    unixScript,
    changed:value !== originalContent || selectedEncoding !== originalEncoding || selectedLineEnding !== sftpTextLineEnding(lineEnding)
  };
}

function sftpEditorByteMeasurement(content, encoding="utf8") {
  const selectedEncoding = String(encoding || "utf8").toLowerCase();
  const exact = selectedEncoding === "utf8" || selectedEncoding === "utf8bom";
  const bytes = new Blob([String(content || "")]).size + (selectedEncoding === "utf8bom" ? 3 : 0);
  return {bytes, exact};
}

const sftpEditorLanguageOptions = [
  ["plain_text","纯文本"], ["yaml","YAML"], ["json","JSON"], ["xml","XML"], ["ini","INI / 配置"],
  ["properties","Properties"], ["toml","TOML"], ["sh","Shell"], ["batchfile","BAT / CMD"], ["powershell","PowerShell"],
  ["javascript","JavaScript"], ["typescript","TypeScript"], ["html","HTML"], ["css","CSS"], ["java","Java"],
  ["c_cpp","C / C++"], ["csharp","C#"], ["python","Python"], ["golang","Go"], ["rust","Rust"],
  ["sql","SQL"], ["markdown","Markdown"], ["dockerfile","Dockerfile"], ["nginx","Nginx"]
];

function sftpEditorLanguageForFile(filename) {
  const basename = String(filename || "").split(/[\\/]/).pop().toLowerCase();
  const extension = basename.includes(".") ? basename.split(".").pop() : "";
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

function sftpEditorLanguageLabel(value) {
  if (value === "plain_text") return tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
  if (value === "ini") return tr("sftp:editor.ini_configuration", {defaultValue:"INI / 配置"});
  return sftpEditorLanguageOptions.find(([mode]) => mode === value)?.[1] || tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
}

function isSftpJsonFileName(name) {
  return String(name || "").split(/[\\/]/).pop().toLowerCase().endsWith(".json");
}

function isSftpImageName(name) {
  return ["png","jpg","jpeg","gif","webp","bmp","ico","svg"].includes(String(name || "").toLowerCase().split(".").pop());
}

function termaAceMessages() {
  const messageKeys = {
    "autocomplete.popup.aria-roledescription":"autocomplete_suggestions",
    "autocomplete.popup.aria-label":"autocomplete_suggestions",
    "autocomplete.popup.item.aria-roledescription":"item",
    "autocomplete.loading":"loading",
    "editor.scroller.aria-roledescription":"editor_role",
    "editor.scroller.aria-label":"editor_content",
    "editor.gutter.aria-roledescription":"gutter_role",
    "editor.gutter.aria-label":"gutter",
    "error-marker.good-state":"looks_good",
    "prompt.recently-used":"recently_used",
    "prompt.other-commands":"other_commands",
    "prompt.no-matching-commands":"no_matching_commands",
    "search-box.find.placeholder":"find_placeholder",
    "search-box.find-all.text":"find_all",
    "search-box.replace.placeholder":"replace_placeholder",
    "search-box.replace-next.text":"replace",
    "search-box.replace-all.text":"replace_all",
    "search-box.toggle-replace.title":"toggle_replace",
    "search-box.toggle-regexp.title":"regexp_search",
    "search-box.toggle-case.title":"case_sensitive",
    "search-box.toggle-whole-word.title":"whole_word",
    "search-box.toggle-in-selection.title":"in_selection",
    "search-box.search-counter":"search_counter",
    "text-input.aria-roledescription":"text_input_role",
    "text-input.aria-label":"cursor_row",
    "gutter.code-folding.range.aria-label":"fold_range",
    "gutter.code-folding.closed.aria-label":"fold_range",
    "gutter.code-folding.open.aria-label":"fold_row",
    "gutter.code-folding.closed.title":"unfold",
    "gutter.code-folding.open.title":"fold",
    "gutter.annotation.aria-label.error":"annotation_error",
    "gutter.annotation.aria-label.warning":"annotation_warning",
    "gutter.annotation.aria-label.info":"annotation_info",
    "inline-fold.closed.title":"unfold",
    "gutter-tooltip.aria-label.error.singular":"error_singular",
    "gutter-tooltip.aria-label.error.plural":"error_plural",
    "gutter-tooltip.aria-label.warning.singular":"warning_singular",
    "gutter-tooltip.aria-label.warning.plural":"warning_plural",
    "gutter-tooltip.aria-label.info.singular":"info_singular",
    "gutter-tooltip.aria-label.info.plural":"info_plural",
    "gutter.annotation.aria-label.security":"annotation_security",
    "gutter.annotation.aria-label.hint":"annotation_hint",
    "gutter-tooltip.aria-label.security.singular":"security_singular",
    "gutter-tooltip.aria-label.security.plural":"security_plural",
    "gutter-tooltip.aria-label.hint.singular":"hint_singular",
    "gutter-tooltip.aria-label.hint.plural":"hint_plural",
    "editor.tooltip.disable-editing":"editing_disabled"
  };
  return Object.fromEntries(Object.entries(messageKeys).map(([aceKey, resourceKey]) => [aceKey, tr(`sftp:ace.${resourceKey}`)]));
}

function syncTermaAceEditorChrome(editor, messages) {
  if (!editor) return;
  const renderer = editor.renderer;
  renderer?.updateFull?.(true);
  if (renderer?.enableKeyboardAccessibility) {
    renderer.scroller?.setAttribute("aria-roledescription", messages["editor.scroller.aria-roledescription"]);
    renderer.scroller?.setAttribute("aria-label", messages["editor.scroller.aria-label"]);
    renderer.$gutter?.setAttribute("aria-roledescription", messages["editor.gutter.aria-roledescription"]);
    renderer.$gutter?.setAttribute("aria-label", messages["editor.gutter.aria-label"]);
    editor.textInput?.setAriaOptions?.({setLabel:true});
  }
  editor.searchBox?.updateCounter?.();
}

function syncTermaAceLocalization(root=document) {
  const messages = termaAceMessages();
  window.ace?.config?.setMessages?.(messages, {placeholders:"dollarSigns"});
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(".ace_search").forEach(search => {
    const findInput = search.querySelector(".ace_search_form .ace_search_field");
    const replaceInput = search.querySelector(".ace_replace_form .ace_search_field");
    if (findInput) findInput.placeholder = messages["search-box.find.placeholder"];
    if (replaceInput) replaceInput.placeholder = messages["search-box.replace.placeholder"];
    const values = [
      ["[action='findAll']", "search-box.find-all.text", "textContent"],
      ["[action='replaceAndFindNext']", "search-box.replace-next.text", "textContent"],
      ["[action='replaceAll']", "search-box.replace-all.text", "textContent"],
      ["[action='toggleReplace']", "search-box.toggle-replace.title", "title"],
      ["[action='toggleRegexpMode']", "search-box.toggle-regexp.title", "title"],
      ["[action='toggleCaseSensitive']", "search-box.toggle-case.title", "title"],
      ["[action='toggleWholeWords']", "search-box.toggle-whole-word.title", "title"],
      ["[action='searchInSelection']", "search-box.toggle-in-selection.title", "title"]
    ];
    values.forEach(([selector, key, property]) => {
      const element = search.querySelector(selector);
      if (element) element[property] = messages[key];
    });
  });
  const hosts = [];
  if (scope?.matches?.(".sftp-code-editor")) hosts.push(scope);
  hosts.push(...scope.querySelectorAll(".sftp-code-editor"));
  hosts.forEach(host => syncTermaAceEditorChrome(host.__termaAceEditor, messages));
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => syncTermaAceLocalization());

const sftpFloatingEditorRegistry = new Map();

function sftpTextEditorOpenKey(connectionId, remotePath) {
  const normalizedPath = typeof normalizeSftpDirectoryCachePath === "function"
    ? normalizeSftpDirectoryCachePath(remotePath)
    : String(remotePath || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  return `${Number(connectionId || 0)}\0${normalizedPath}`;
}

function activateSftpTextEditor(editorKey) {
  const record = sftpFloatingEditorRegistry.get(String(editorKey || ""));
  if (!record) return false;
  record.restore?.();
  return true;
}

function sftpFloatingEditorLayer() {
  let layer = document.querySelector(".sftp-editor-floating-root");
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "sftp-editor-floating-root";
  layer.innerHTML = `<div class="sftp-editor-floating-shelf" role="list"></div>`;
  document.body.appendChild(layer);
  return layer;
}

function refreshSftpFloatingEditorShelfLabels(layer=document.querySelector(".sftp-editor-floating-root")) {
  if (!layer) return;
  const windows = [...layer.querySelectorAll(".sftp-editor-floating-window")];
  const duplicateCounts = windows.reduce((counts, item) => {
    const name = String(item.dataset.fileName || "");
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());
  for (const item of layer.querySelectorAll(".sftp-editor-shelf-item")) {
    const name = String(item.dataset.fileName || "");
    const server = String(item.dataset.serverName || "");
    const label = duplicateCounts.get(name) > 1 && server ? `${server} · ${name}` : name;
    item.title = String(item.dataset.sourceLabel || label);
    item.setAttribute("aria-label", item.title);
    const text = item.querySelector("span");
    if (text) text.textContent = label;
  }
}

function sftpFloatingEditorShelfItem(layer, metadata, restore) {
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

function sftpTextModal(title, content, size=0, limit=5*1024*1024, encoding="utf8", preferredEncoding="auto", diffOptions={}) {
  const editorKey = String(diffOptions.editorKey || "");
  if (editorKey && activateSftpTextEditor(editorKey)) return Promise.resolve(null);
  return new Promise((resolve) => {
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
    const scriptNeedsFormatRepair = unixScript && Boolean(
      diffOptions.bom
      || (diffOptions.lineEnding && diffOptions.lineEnding !== "lf")
      || (content && diffOptions.finalNewline === false)
    );
    if (unixScript && encoding === "utf8bom") encoding = "utf8";
    const initialLineEnding = unixScript ? "lf" : sftpTextLineEnding(diffOptions.lineEnding || "lf");
    const wrapEnabled = localStorage.getItem("sftpEditorWordWrap") !== "0";
    let versions = Array.isArray(diffOptions.versions) ? diffOptions.versions.slice(0, 10) : [];
    const historyLoading = typeof diffOptions.loadVersions === "function";
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
    modal.innerHTML = `<div class="modal-card wide sftp-editor-modal floating" role="dialog" aria-modal="false"><div class="sftp-editor-head"><div class="sftp-editor-title"><h2>${esc(fileName)}</h2>${sourceLabel ? `<small class="sftp-editor-source" title="${escAttr(sourceLabel)}">${esc(sourceLabel)}</small>` : ""}<span id="sftpEditorStats">${esc(fileLimit)}</span></div><div class="sftp-editor-head-actions"><div class="sftp-editor-controls"><label>${esc(tr("sftp:editor.text_encoding", {defaultValue:"文本编码"}))}<select id="sftpTextEncoding">${sftpTextEncodingOptions.map(([value,label]) => `<option value="${value}" ${value === encoding ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>${esc(tr("sftp:editor.line_ending", {defaultValue:"换行符"}))}<select id="sftpLineEnding" ${unixScript ? "disabled" : ""}>${sftpTextLineEndingOptions().map(([value,label]) => `<option value="${value}" ${value === initialLineEnding ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label><label>${esc(tr("sftp:editor.language", {defaultValue:"语言"}))}<select id="sftpEditorLanguage"><option value="auto">${esc(tr("sftp:editor.automatic_language", {language:sftpEditorLanguageLabel(detectedLanguage), defaultValue:`自动（${sftpEditorLanguageLabel(detectedLanguage)}）`}))}</option>${sftpEditorLanguageOptions.map(([value]) => `<option value="${value}">${esc(sftpEditorLanguageLabel(value))}</option>`).join("")}</select></label><label class="check-row compact"><input id="sftpEditorWordWrap" type="checkbox" ${wrapEnabled ? "checked" : ""}> ${esc(tr("sftp:editor.word_wrap", {defaultValue:"自动换行"}))}</label></div><div class="sftp-editor-window-controls"><button id="sftpEditorSearchToggle" class="icon-button" type="button" title="${escAttr(searchLabel)}" aria-label="${escAttr(searchLabel)}">${icon("search")}</button><button id="sftpEditorMinimize" class="icon-button" type="button" title="${escAttr(minimizeLabel)}" aria-label="${escAttr(minimizeLabel)}">${icon("minus")}</button><button id="sftpEditorFullscreen" class="icon-button" type="button" title="${escAttr(fullscreenLabel)}" aria-label="${escAttr(fullscreenLabel)}">${icon("maximize")}</button><button id="sftpEditorCloseTop" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div></div></div><div id="sftpEditorWorkspace" class="sftp-editor-workspace"><div id="sftpEditorSearchBar" class="sftp-editor-search-bar" hidden><input id="sftpEditorSearchInput" type="search" placeholder="${escAttr(searchLabel)}" autocomplete="off"><span id="sftpEditorSearchCount" aria-live="polite"></span><button id="sftpEditorSearchPrevious" class="icon-button" type="button" title="${escAttr(previousLabel)}" aria-label="${escAttr(previousLabel)}">${icon("arrow-up")}</button><button id="sftpEditorSearchNext" class="icon-button" type="button" title="${escAttr(nextLabel)}" aria-label="${escAttr(nextLabel)}">${icon("arrow-down")}</button><button id="sftpEditorSearchClose" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div><div id="sftpTextEditor" class="sftp-code-editor" aria-label="${escAttr(tr("sftp:editor.editor_aria", {defaultValue:"SFTP 文本编辑器"}))}"></div><div id="sftpEditorSplit" class="sftp-editor-splitter" role="separator" aria-orientation="horizontal" aria-label="${escAttr(tr("sftp:editor.resize_diff_aria", {defaultValue:"调整编辑与差异区域比例"}))}" tabindex="0" hidden></div><div id="sftpDiffPreview" class="sftp-diff-preview" hidden></div></div><div class="sftp-editor-options"><label class="check-row"><input id="sftpBackupBeforeSave" type="checkbox" checked> ${esc(tr("sftp:editor.backup_before_save", {defaultValue:"保存前备份远程文件"}))}</label><label class="check-row"><input id="sftpPersistEncoding" type="checkbox" ${preferredEncoding === encoding ? "checked" : ""}> ${esc(tr("sftp:editor.persist_encoding", {defaultValue:"设为此连接默认文本编码"}))}</label><label class="sftp-diff-history-control"><span>${esc(tr("sftp:editor.compare_version", {defaultValue:"比较版本"}))}</span><select id="sftpDiffHistory" disabled>${historyOptions}</select><small id="sftpDiffHistoryCount">${esc(historyLoading ? tr("sftp:editor.loading_backups", {defaultValue:"正在读取备份..."}) : tr("sftp:editor.recent_backups", {count:versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`}))}</small></label></div><div class="actions"><button id="sftpTextFormatJson" hidden>${icon("braces")}<span>${esc(tr("sftp:editor.format_json", {defaultValue:"格式化 JSON"}))}</span></button><button id="sftpTextDiff" disabled>${esc(tr("sftp:editor.preview_diff", {defaultValue:"预览差异"}))}</button><button class="primary" id="sftpTextSave">${esc(tr("sftp:editor.save", {defaultValue:"保存"}))} <span class="shortcut-hint">Ctrl+S</span></button><button id="sftpTextClose">${esc(closeLabel)}</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    let finished = false;
    const getEditor = selector => modal.querySelector(selector);
    const titleBox = getEditor(".sftp-editor-title");
    const editorSaveStatus = document.createElement("small");
    editorSaveStatus.className = "sftp-editor-save-status";
    editorSaveStatus.hidden = true;
    titleBox?.appendChild(editorSaveStatus);
    const host = getEditor("#sftpTextEditor");
    const card = modal.querySelector(".sftp-editor-modal");
    let editorShelfItem = null;
    let releaseFloatingEditor = () => {};
    if (card) {
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%,-50%)";
      const minimizeButton = getEditor("#sftpEditorMinimize");
      const fullscreenButton = getEditor("#sftpEditorFullscreen");
      let restoredGeometry = null;
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
      const syncFullscreen = enabled => {
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
      card.addEventListener("pointerdown", nextZIndex);
      nextZIndex();
      const dragHandle = getEditor(".sftp-editor-head");
      dragHandle?.classList.add("sftp-editor-drag-handle");
      let dragState = null;
      const moveFloatingEditor = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        card.style.left = `${dragState.left + event.clientX - dragState.clientX}px`;
        card.style.top = `${dragState.top + event.clientY - dragState.clientY}px`;
        clampCard();
      };
      const stopFloatingEditorDrag = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        dragState = null;
        document.removeEventListener("pointermove", moveFloatingEditor);
        document.removeEventListener("pointerup", stopFloatingEditorDrag);
        document.removeEventListener("pointercancel", stopFloatingEditorDrag);
      };
      dragHandle?.addEventListener("pointerdown", event => {
        if (event.button !== 0 || card.classList.contains("is-fullscreen") || event.target.closest("button,input,select,label,textarea")) return;
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
    let aceEditor = null;
    let fallbackEditor = null;
    const useLightEditor = diffOptions.editorKind === "light";
    const lightPageChars = 256 * 1024;
    let lightSource = "";
    let lightPageOffsets = [0, 0];
    let lightPageIndex = 0;
    const lightPageEdits = new Map();
    let lightPager = null;
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
    const lightOriginalPage = index => lightSource.slice(lightPageOffsets[index], lightPageOffsets[index + 1]);
    const lightPageValue = index => lightPageEdits.has(index) ? lightPageEdits.get(index) : lightOriginalPage(index);
    const commitLightPage = () => {
      if (!useLightEditor || !fallbackEditor) return;
      const value = fallbackEditor.value;
      if (value === lightOriginalPage(lightPageIndex)) lightPageEdits.delete(lightPageIndex);
      else lightPageEdits.set(lightPageIndex, value);
    };
    const renderLightPage = index => {
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
        lightPager.querySelector("input").onchange = event => renderLightPage(Number(event.target.value || 1) - 1);
        fallbackEditor.value = lightOriginalPage(0);
        renderLightPage(0);
      } else {
        fallbackEditor.value = content;
        host.replaceWith(fallbackEditor);
      }
    };
    if (window.ace?.edit && !useLightEditor) {
      syncTermaAceLocalization();
      ace.config.set("basePath", "/vendor/ace");
      ace.config.set("useStrictCSP", true);
      aceEditor = ace.edit(host);
      host.__termaAceEditor = aceEditor;
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
    const setValue = value => {
      if (aceEditor) return aceEditor.setValue(value, -1);
      if (!useLightEditor) return (fallbackEditor.value = value);
      lightSource = String(value || "");
      lightPageEdits.clear();
      lightPageIndex = 0;
      rebuildLightPageOffsets();
      renderLightPage(0);
    };
    const focusEditor = () => aceEditor ? aceEditor.focus() : fallbackEditor.focus();
    const searchBar = getEditor("#sftpEditorSearchBar");
    const searchInput = getEditor("#sftpEditorSearchInput");
    const searchCount = getEditor("#sftpEditorSearchCount");
    let editorSearchQuery = "";
    let editorSearchMatches = [];
    let editorSearchIndex = -1;
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
    const editorSearchSource = () => aceEditor ? aceEditor.getValue() : String(fallbackEditor?.value || "");
    const rebuildEditorSearchMatches = () => {
      const query = String(searchInput.value || "");
      if (query === editorSearchQuery) return;
      editorSearchQuery = query;
      editorSearchMatches = [];
      editorSearchIndex = -1;
      if (!query) return;
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(escapedQuery, "giu");
      for (const match of editorSearchSource().matchAll(expression)) {
        editorSearchMatches.push({start:match.index, length:match[0].length});
        if (editorSearchMatches.length >= 10000) break;
      }
    };
    const selectEditorSearchMatch = index => {
      const query = String(searchInput.value || "");
      if (!query || index < 0) return;
      const match = editorSearchMatches[index];
      const start = match.start;
      const end = start + match.length;
      if (aceEditor) {
        const Range = ace.require("ace/range").Range;
        const aceDocument = aceEditor.session.getDocument();
        const startPosition = aceDocument.indexToPosition(start, 0);
        const endPosition = aceDocument.indexToPosition(end, 0);
        aceEditor.selection.setRange(new Range(startPosition.row, startPosition.column, endPosition.row, endPosition.column), false);
        aceEditor.scrollToLine(startPosition.row, true, true);
        aceEditor.focus();
      } else {
        fallbackEditor.focus();
        fallbackEditor.setSelectionRange(start, end);
        const line = editorSearchSource().slice(0, start).split("\n").length - 1;
        fallbackEditor.scrollTop = Math.max(0, line * 20 - fallbackEditor.clientHeight / 2);
      }
    };
    const stepEditorSearch = direction => {
      rebuildEditorSearchMatches();
      if (!editorSearchMatches.length) {
        editorSearchIndex = -1;
        searchCount.textContent = searchInput.value ? tr("sftp:editor.search_empty", {defaultValue:"无匹配"}) : "";
        return;
      }
      editorSearchIndex = (editorSearchIndex + direction + editorSearchMatches.length) % editorSearchMatches.length;
      searchCount.textContent = `${editorSearchIndex + 1}/${editorSearchMatches.length}`;
      selectEditorSearchMatch(editorSearchIndex);
    };
    let releaseEditorLayout = () => {};
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onModalKeyDown, true);
      releaseEditorLayout();
      releaseFloatingEditor();
      if (editorKey && sftpFloatingEditorRegistry.get(editorKey)?.modal === modal) sftpFloatingEditorRegistry.delete(editorKey);
      try { aceEditor?.destroy(); } catch {}
      lightSource = "";
      lightPageEdits.clear();
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
    let contentModified = false;
    const updateStats = (force=false, providedValue=null, providedEncoding="") => {
      if (useLightEditor && contentModified && !force) {
        getEditor("#sftpEditorStats").textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        getEditor("#sftpEditorStats").classList.remove("limit-exceeded");
        saveButton.disabled = false;
        return true;
      }
      const initial = !contentModified && providedValue === null;
      const value = initial && useLightEditor ? "" : (providedValue === null ? getValue() : providedValue);
      const measurement = initial
        ? {bytes:Number(size || 0), exact:true}
        : sftpEditorByteMeasurement(value, providedEncoding || getEditor("#sftpTextEncoding")?.value || encoding);
      if (!measurement.exact) {
        const stats = getEditor("#sftpEditorStats");
        stats.textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        stats.classList.remove("limit-exceeded");
        saveButton.disabled = false;
        return true;
      }
      const bytes = measurement.bytes;
      const tooLarge = bytes > limit;
      const stats = getEditor("#sftpEditorStats");
      const lines = initial && Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : value.split("\n").length;
      const limitSuffix = tooLarge ? tr("sftp:editor.limit_exceeded_suffix", {defaultValue:" · 已超过上限"}) : "";
      stats.textContent = tr("sftp:editor.statistics", {lines, size:formatBytes(bytes), limit:limitSuffix, defaultValue:`${lines} 行 · ${formatBytes(bytes)}${limitSuffix}`});
      stats.classList.toggle("limit-exceeded", tooLarge);
      saveButton.disabled = tooLarge;
      return !tooLarge;
    };
    updateStats();
    syncFormatButton();
    if (aceEditor) {
      aceEditor.session.on("change", () => { contentModified = true; invalidateEditorSearchMatches(); updateStats(); });
      aceEditor.commands.addCommand({name:"saveSftpFile", bindKey:{win:"Ctrl-S",mac:"Command-S"}, exec:()=>saveButton.click()});
    } else fallbackEditor.addEventListener("input", () => {
      if (useLightEditor) {
        commitLightPage();
        contentModified = lightPageEdits.size > 0;
      } else contentModified = true;
      invalidateEditorSearchMatches();
      updateStats();
    });
    releaseEditorLayout = bindSftpEditorLayout(card, editorWorkspace, diffSplitter, () => aceEditor?.resize(true));
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
      Promise.resolve().then(() => diffOptions.loadVersions()).then(result => {
        if (finished) return;
        versions = Array.isArray(result?.versions) ? result.versions.slice(0, 10) : [];
        syncHistoryControls();
      }).catch(() => {
        if (finished) return;
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
      if (!versions.length) return notify(tr("sftp:editor.no_history", {defaultValue:"没有可比较的历史备份"}), "info");
      const box = diffPreview;
      setSftpEditorDiffVisible(editorWorkspace, diffSplitter, box, true);
      requestAnimationFrame(() => aceEditor?.resize(true));
      const button = getEditor("#sftpTextDiff");
      const selected = Number(getEditor("#sftpDiffHistory")?.value || 0);
      let comparisonContent = "";
      let oldLabel = tr("sftp:editor.previous_backup", {defaultValue:"上一次备份"});
      if (versions[selected] && typeof diffOptions.loadVersion === "function") {
        button.disabled = true;
        button.classList.add("busy");
        box.innerHTML = `<div class="sftp-diff-unavailable">${icon("loader-circle")} ${esc(tr("sftp:editor.reading_history", {defaultValue:"正在读取历史版本..."}))}</div>`;
        refreshIcons();
        try {
          const version = versions[selected];
          const loaded = await diffOptions.loadVersion(version, encoding);
          comparisonContent = loaded?.content || "";
          oldLabel = tr("sftp:editor.backup_label", {time:sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000), defaultValue:`备份 ${sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000)}`});
        } catch (error) {
          box.innerHTML = `<div class="sftp-diff-unavailable error">${esc(error.message || tr("sftp:editor.history_read_failed", {defaultValue:"历史版本读取失败"}))}</div>`;
          return;
        } finally {
          button.disabled = false;
          button.classList.remove("busy");
        }
      }
      box.innerHTML = sftpDiffViewerHtml(comparisonContent, getValue(), {oldLabel, newLabel:tr("sftp:editor.current_content", {defaultValue:"当前编辑内容"})});
    };
    getEditor("#sftpTextEncoding").onchange = event => {
      const nextEncoding = event.target.value;
      if (contentModified) {
        event.target.value = encoding;
        notify(tr("sftp:editor.switch_encoding_blocked", {defaultValue:"请先保存或放弃当前修改，再切换文本编码"}), "info");
        return;
      }
      finish({action:"encoding", encoding:nextEncoding});
    };
    getEditor("#sftpEditorLanguage").onchange = event => {
      const language = event.target.value === "auto" ? detectedLanguage : event.target.value;
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
      } catch (error) {
        notify(tr("sftp:editor.json_error", {error:error.message || error, defaultValue:`JSON 格式错误：${error.message || error}`}), "error");
      }
    };
    getEditor("#sftpEditorWordWrap").onchange = event => {
      localStorage.setItem("sftpEditorWordWrap", event.target.checked ? "1" : "0");
      aceEditor?.session.setUseWrapMode(event.target.checked);
      if (fallbackEditor) fallbackEditor.style.whiteSpace = event.target.checked ? "pre-wrap" : "pre";
      focusEditor();
    };
    getEditor("#sftpEditorSearchToggle").onclick = openEditorSearch;
    getEditor("#sftpEditorSearchPrevious").onclick = () => stepEditorSearch(-1);
    getEditor("#sftpEditorSearchNext").onclick = () => stepEditorSearch(1);
    getEditor("#sftpEditorSearchClose").onclick = closeEditorSearch;
    searchInput.addEventListener("input", () => {
      invalidateEditorSearchMatches();
      stepEditorSearch(1);
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      stepEditorSearch(event.shiftKey ? -1 : 1);
    });
    getEditor("#sftpTextSave").onclick = async () => {
      const value = getValue();
      const prepared = prepareSftpEditorSave(title, value, getEditor("#sftpTextEncoding").value, getEditor("#sftpLineEnding").value);
      if (!updateStats(true, prepared.content, prepared.encoding)) return notify(tr("sftp:editor.content_too_large", {limit:formatBytes(limit), defaultValue:`在线编辑内容不能超过 ${formatBytes(limit)}`}), "error");
      const payload = {action:"save", content:prepared.content, changed:contentModified || prepared.changed || scriptNeedsFormatRepair, backup:getEditor("#sftpBackupBeforeSave").checked, encoding:prepared.encoding, line_ending:prepared.lineEnding, normalized_script:prepared.unixScript, persist_default:getEditor("#sftpPersistEncoding").checked};
      if (typeof diffOptions.onSave !== "function" || (!payload.changed && !(payload.persist_default && preferredEncoding !== payload.encoding))) return finish(payload);
      saveButton.disabled = true;
      saveButton.classList.add("busy");
      editorSaveStatus.hidden = false;
      editorSaveStatus.classList.remove("error", "success");
      editorSaveStatus.textContent = tr("sftp:editor.saving_remote", {defaultValue:"正在保存到远端..."});
      try {
        const savedResult = await diffOptions.onSave(payload);
        contentModified = false;
        editorSaveStatus.classList.add("success");
        editorSaveStatus.textContent = tr("sftp:editor.saved_remote", {defaultValue:"已保存到远端"});
        finish({...payload, savedResult});
      } catch (error) {
        editorSaveStatus.classList.add("error");
        editorSaveStatus.textContent = tr("sftp:editor.save_waiting_reconnect", {defaultValue:"保存失败，内容仍在窗口中；重连后可再次保存"});
        notify(error.message || tr("sftp:editor.remote_save_failed", {defaultValue:"保存到远端失败，编辑内容已保留"}), "error");
      } finally {
        if (!finished) {
          saveButton.disabled = false;
          saveButton.classList.remove("busy");
        }
      }
    };
    getEditor("#sftpTextClose").onclick = async () => {
      if (contentModified && !await confirmModal(
        tr("sftp:editor.unsaved_confirm", {defaultValue:"当前修改尚未保存，确认关闭？"}),
        tr("sftp:editor.discard_title", {defaultValue:"放弃修改"}),
        tr("sftp:editor.discard", {defaultValue:"放弃修改"}),
        tr("sftp:editor.continue_editing", {defaultValue:"继续编辑"}),
        true
      )) return;
      finish(null);
    };
    getEditor("#sftpEditorCloseTop").onclick = () => getEditor("#sftpTextClose").click();
    const onModalKeyDown = event => {
      if (!modal.contains(event.target) && !modal.contains(document.activeElement)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openEditorSearch();
        return;
      }
      if (event.key === "Escape" && !searchBar.hidden) {
        event.preventDefault();
        closeEditorSearch();
      } else if (event.key === "Escape") getEditor("#sftpTextClose").click();
    };
    document.addEventListener("keydown", onModalKeyDown, true);
    setTimeout(focusEditor, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => diffOptions.onReady?.()));
  });
}
