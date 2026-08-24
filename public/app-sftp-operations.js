function isArchiveName(name) {
  return /\.(zip|tar|tar\.gz|tgz)$/i.test(String(name || ""));
}

function sftpOperationInlineArgument(value) {
  return `'${escAttr(String(value ?? ""))}'`;
}

function applySftpRangeSelection(event, path, tabKey, options={}) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const inputs = sftpElements(".sftp-check", tabKey);
  const currentIndex = inputs.findIndex(input => input.value === path);
  if (!runtime || currentIndex < 0) return;
  const anchorPath = String(runtime.state.selectionAnchorPath || "");
  if (event?.shiftKey && anchorPath) {
    const anchorIndex = inputs.findIndex(input => input.value === anchorPath);
    if (anchorIndex >= 0) {
      if (!event.ctrlKey && !event.metaKey) inputs.forEach(input => { input.checked = false; });
      const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) inputs[index].checked = true;
      updateSftpSelection(tabKey);
      return;
    }
  }
  const input = inputs[currentIndex];
  if (options.checkbox) {
    // The browser has already toggled the checkbox before the click handler runs.
  } else if (event?.ctrlKey || event?.metaKey) {
    input.checked = !input.checked;
  } else if (!options.forceSingle && inputs.filter(item => item.checked).length >= 2) {
    input.checked = !input.checked;
  } else {
    inputs.forEach(item => { item.checked = item === input; });
  }
  runtime.state.selectionAnchorPath = path;
  updateSftpSelection(tabKey);
}

function handleSftpCheckboxSelection(event, path, tabKey=activeTabKey) {
  event.stopPropagation();
  applySftpRangeSelection(event, path, tabKey, {checkbox:true});
}

function selectSftpEntry(event, id, path, name, type, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  runtime.state.selected = { id, path, name, type };
  if (sftpActiveRuntimeKey === tabKey) sftpState = runtime.state;
  sftpElements(".sftp-row", tabKey).forEach(row => row.classList.remove("active"));
  const input = sftpElements(".sftp-check", tabKey).find(item => item.value === path);
  if (input) input.closest(".sftp-row")?.classList.add("active");
  if (!event?.preserveSelection) applySftpRangeSelection(event, path, tabKey, {forceSingle:Boolean(event?.forceSingle)});
}

function activateSftpEntry(event, id, path, name, type, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (event?.target?.closest(".sftp-check, .sftp-row-actions")) return;
  event?.preventDefault();
  event?.stopPropagation();
  selectSftpEntry(event, id, path, name, type, tabKey);
  if (type === "dir") return navigateSftpPath(path, tabKey);
  const saved = runtimeSettings?.saved || runtimeSettings || {};
  if (saved.sftp_double_click_file_action === "external" && window.termaDesktop && typeof openSftpExternalEdit === "function") return openSftpExternalEdit(id, path);
  return isSftpImageName(name) ? previewSftpImage(id, path) : previewSftpText(id, path);
}

function sftpRowActionsHtml(id, path, name, type, tabKey=activeTabKey) {
  const isDir = type === "dir";
  const archive = !isDir && isArchiveName(name);
  const openDirectory = tr("sftp:auto.open_directory", {defaultValue:"打开目录"});
  const open = tr("sftp:auto.open", {defaultValue:"打开"});
  const previewImage = tr("sftp:menu.preview_image", {defaultValue:"预览图片"});
  const preview = tr("sftp:auto.preview", {defaultValue:"预览"});
  const openAsText = tr("sftp:menu.open_as_text", {defaultValue:"以文本打开"});
  const download = tr("sftp:menu.download", {defaultValue:"下载"});
  const extract = tr("sftp:menu.extract", {defaultValue:"解压"});
  const compress = tr("sftp:menu.compress", {defaultValue:"压缩"});
  const copy = tr("sftp:menu.copy", {defaultValue:"复制"});
  const move = tr("sftp:menu.move", {defaultValue:"移动"});
  const rename = tr("sftp:menu.rename", {defaultValue:"重命名"});
  const permissions = tr("sftp:menu.permissions", {defaultValue:"设置权限"});
  const permissionShort = tr("sftp:auto.permissions", {defaultValue:"权限"});
  const remove = tr("sftp:menu.delete", {defaultValue:"删除"});
  const moreActions = tr("sftp:auto.more_actions", {defaultValue:"更多操作"});
  const more = tr("sftp:auto.more", {defaultValue:"更多"});
  const entryMoreActions = tr("sftp:auto.entry_more_actions", {name, defaultValue:`${name}的更多操作`});
  const connectionId = Number(id);
  const pathArg = sftpOperationInlineArgument(path);
  const tabKeyArg = sftpOperationInlineArgument(tabKey);
  const nameArg = sftpOperationInlineArgument(name);
  const typeArg = sftpOperationInlineArgument(type);
  return [
    isDir
      ? `<button class="sftp-row-action sftp-row-action-core" title="${escAttr(openDirectory)}" aria-label="${escAttr(openDirectory)}" onclick="event.stopPropagation();navigateSftpPath(${pathArg},${tabKeyArg})">${icon("folder-open")}<span>${esc(open)}</span></button>`
      : isSftpImageName(name)
        ? `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${connectionId}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="image" title="${escAttr(previewImage)}" aria-label="${escAttr(previewImage)}" onclick="event.stopPropagation();previewSftpImage(${connectionId},${pathArg})">${icon("image")}<span>${esc(preview)}</span></button>`
        : `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${connectionId}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="text" title="${escAttr(openAsText)}" aria-label="${escAttr(openAsText)}" onclick="event.stopPropagation();previewSftpText(${connectionId},${pathArg})">${icon("file-text")}<span>${esc(open)}</span></button>`,
    !isDir ? `<button class="sftp-row-action sftp-row-action-medium" title="${escAttr(download)}" aria-label="${escAttr(download)}" onclick="event.stopPropagation();downloadSftp(${connectionId},${pathArg})">${icon("download")}<span>${esc(download)}</span></button>` : "",
    archive ? `<button class="sftp-row-action sftp-row-action-medium" title="${escAttr(extract)}" aria-label="${escAttr(extract)}" onclick="event.stopPropagation();extractSingleSftp(${connectionId},${pathArg},${tabKeyArg})">${icon("archive-restore")}<span>${esc(extract)}</span></button>` : "",
    `<button class="sftp-row-action sftp-row-action-medium" title="${escAttr(compress)}" aria-label="${escAttr(compress)}" onclick="event.stopPropagation();compressSingleSftp(${connectionId},${pathArg},${tabKeyArg})">${icon("archive")}<span>${esc(compress)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="${escAttr(copy)}" aria-label="${escAttr(copy)}" onclick="event.stopPropagation();copySingleSftp(${pathArg},'copy',${tabKeyArg})">${icon("copy")}<span>${esc(copy)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="${escAttr(move)}" aria-label="${escAttr(move)}" onclick="event.stopPropagation();copySingleSftp(${pathArg},'move',${tabKeyArg})">${icon("folder-input")}<span>${esc(move)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-medium" title="${escAttr(rename)}" aria-label="${escAttr(rename)}" onclick="event.stopPropagation();renameSftp(${connectionId},${pathArg},${nameArg},${tabKeyArg})">${icon("pencil")}<span>${esc(rename)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="${escAttr(permissions)}" aria-label="${escAttr(permissions)}" onclick="event.stopPropagation();openSftpPermissionsForSelection([${pathArg}],${tabKeyArg})">${icon("key-round")}<span>${esc(permissionShort)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide danger" title="${escAttr(remove)}" aria-label="${escAttr(remove)}" onclick="event.stopPropagation();deleteSftp(${connectionId},${pathArg},${tabKeyArg})">${icon("trash-2")}<span>${esc(remove)}</span></button>`,
    `<button class="sftp-row-action sftp-row-action-more" title="${escAttr(moreActions)}" aria-label="${escAttr(entryMoreActions)}" onclick="showSftpEntryMenu(event,${connectionId},${pathArg},${nameArg},${typeArg},${tabKeyArg})">${icon("ellipsis")}<span>${esc(more)}</span></button>`
  ].filter(Boolean).join("");
}

function refreshSftp(options={}) {
  const tabKey = String(options.tabKey || activeTabKey || "");
  const runtime = sftpTabRuntimes.get(tabKey);
  const tab = tabs.find(item => item.key === tabKey);
  if (runtime) clearTimeout(runtime.searchTimer);
  if (tab?.kind === "sftp") return loadSftpPage({connectionId:tab.id, path:runtime?.state.path || tab.path || ".", page:runtime?.state.page || 1, refresh:true, preserveView:true, ...options, tabKey});
}

async function mkdirSftp(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const name = await inputModal(tr("sftp:operations.new_directory", {defaultValue:"新建目录"}), tr("sftp:operations.directory_name", {defaultValue:"目录名称"}), "");
  if (!tab || !runtime || !name || !sftpTabRuntimes.has(tabKey)) return;
  if (!isValidSftpChildName(name, tr("sftp:operations.directory_label", {defaultValue:"目录名"}))) return;
  try {
    await api(`/api/connections/${tab.id}/sftp/mkdir`, {method:"POST", body:JSON.stringify({path:joinRemotePath(runtime.state.path || ".", name)})});
    notify(tr("sftp:operations.directory_created", {defaultValue:"目录已创建"}), "success");
    refreshSftp({tabKey});
  } catch (error) {
    notify(error.message || tr("sftp:operations.create_directory_failed", {defaultValue:"新建目录失败"}), "error");
  }
}

function isValidSftpChildName(value, label = tr("sftp:operations.name_label", {defaultValue:"名称"})) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.includes("\0")) {
    notify(tr("sftp:operations.invalid_child_name", {label, defaultValue:`${label}不能包含路径分隔符或特殊目录名`}), "error");
    return false;
  }
  return true;
}

async function createSftpFile(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const name = await inputModal(tr("sftp:operations.new_file", {defaultValue:"新建文件"}), tr("sftp:operations.file_name", {defaultValue:"文件名"}), "");
  if (!tab || !runtime || !name || !sftpTabRuntimes.has(tabKey) || !isValidSftpChildName(name, tr("sftp:operations.file_label", {defaultValue:"文件名"}))) return;
  const remotePath = joinRemotePath(runtime.state.path || ".", name);
  try {
    await api(`/api/connections/${tab.id}/sftp/create-file`, {method:"POST", body:JSON.stringify({path:remotePath})});
    notify(tr("sftp:operations.file_created", {defaultValue:"文件已创建"}), "success");
    await refreshSftp({tabKey});
  } catch (error) {
    notify(error.message || tr("sftp:operations.create_file_failed", {defaultValue:"新建文件失败"}), "error");
  }
}

async function renameSftp(id, from, oldName, tabKey=activeTabKey) {
  const name = await inputModal(tr("sftp:menu.rename", {defaultValue:"重命名"}), tr("sftp:dialogs.new_name", {defaultValue:"新名称"}), oldName);
  if (!name) return;
  await api(`/api/connections/${id}/sftp/rename`, {method:"POST", body:JSON.stringify({from, to:joinRemotePath(parentRemotePath(from), name)})});
  refreshSftp({tabKey});
}

async function currentSftpRecycleBinEnabled() {
  if (runtimeSettings?.saved && typeof runtimeSettings.saved.sftp_recycle_bin_enabled === "boolean") {
    return runtimeSettings.saved.sftp_recycle_bin_enabled;
  }
  try {
    runtimeSettings = normalizeRuntimeSettingsResponse(await api("/api/runtime-settings"));
    return runtimeSettings.saved.sftp_recycle_bin_enabled;
  } catch {
    return null;
  }
}

function sftpDeleteConfirmation(enabled, count, remotePath="") {
  const pathSuffix = remotePath ? `\n${remotePath}` : "";
  if (enabled === true) return {
    title:tr("sftp:operations.recycle_title", {defaultValue:"移入回收站"}),
    message:tr("sftp:operations.recycle_message", {count, path:pathSuffix, defaultValue:`将${count === 1 ? "该远程项目" : `选中的 ${count} 个远程项目`}移入回收站？${pathSuffix}`}),
    confirm:tr("sftp:operations.recycle_confirm", {defaultValue:"移入回收站"}),
    danger:false
  };
  if (enabled === false) return {
    title:tr("sftp:operations.permanent_delete_title", {defaultValue:"永久删除远程项目"}),
    message:tr("sftp:operations.permanent_delete_message", {count, path:pathSuffix, defaultValue:`回收站未开启，将永久删除${count === 1 ? "该远程项目" : `选中的 ${count} 个远程项目`}且无法恢复。${pathSuffix}`}),
    confirm:tr("sftp:operations.permanent_delete_confirm", {defaultValue:"永久删除"}),
    danger:true
  };
  return {
    title:tr("sftp:operations.delete_title", {defaultValue:"删除远程项目"}),
    message:tr("sftp:operations.delete_message", {count, path:pathSuffix, defaultValue:`删除${count === 1 ? "该远程项目" : `选中的 ${count} 个远程项目`}？系统将按当前回收站设置处理。${pathSuffix}`}),
    confirm:tr("sftp:operations.continue", {defaultValue:"继续"}),
    danger:true
  };
}

async function deleteSftp(id, path, tabKey=activeTabKey) {
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), 1, path);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, tr("common:actions.cancel", {defaultValue:"取消"}), confirmation.danger)) return;
  const job = await api(`/api/connections/${id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths:[path]})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function deleteSftpSelection(tabKey=activeTabKey) {
  const tab = tabs.find(item => item.key === tabKey);
  const paths = selectedSftpPaths(tabKey);
  if (!tab || !paths.length) return notify(tr("sftp:operations.select_items", {defaultValue:"请选择文件或目录"}), "info");
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), paths.length);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, tr("common:actions.cancel", {defaultValue:"取消"}), confirmation.danger)) return;
  const job = await api(`/api/connections/${tab.id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function copySftpSelection(mode, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const entries = selectedSftpEntries(tabKey);
  if (!entries.length) return notify(tr("sftp:operations.select_items", {defaultValue:"请选择文件或目录"}), "info");
  const tab = tabs.find(item => item.key === tabKey);
  sftpClipboard = {mode, paths:entries.map(item => item.path), entries, connectionId:Number(runtime?.state.connectionId || tab?.id || 0), connectionName:tab?.title || tab?.name || ""};
  for (const item of sftpTabRuntimes.values()) refreshSftpDirectoryActions(item.tabKey);
  const action = tr(mode === "move" ? "sftp:clipboard.move" : "sftp:clipboard.copy", {defaultValue:mode === "move" ? "移动" : "复制"});
  notify(tr("sftp:operations.clipboard_saved", {action, defaultValue:`${action}队列已保存，进入目标目录后点击粘贴`}), "success");
}

function copySingleSftp(path, mode, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const state = runtime?.state;
  const tab = tabs.find(item => item.key === tabKey);
  const listed = (state?.entries || []).find(item => joinRemotePath(state.path, item.name) === path);
  const entries = [{
    path,
    name:listed?.name || sftpPathName(path),
    type:listed?.type || "file",
    size:Math.max(0, Number(listed?.size || 0)),
    mtime:Math.max(0, Number(listed?.mtime || 0)),
    metadataKnown:Boolean(listed)
  }];
  sftpClipboard = { mode, paths:[path], entries, connectionId:Number(state?.connectionId || tab?.id || 0), connectionName:tab?.title || tab?.name || "" };
  for (const item of sftpTabRuntimes.values()) refreshSftpDirectoryActions(item.tabKey);
  const action = tr(mode === "move" ? "sftp:clipboard.move" : "sftp:clipboard.copy", {defaultValue:mode === "move" ? "移动" : "复制"});
  notify(tr("sftp:operations.clipboard_saved", {action, defaultValue:`${action}队列已保存，进入目标目录后点击粘贴`}), "success");
}

async function pasteSftpClipboard(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  if (!tab || !sftpClipboard?.paths?.length) return notify(tr("sftp:operations.clipboard_empty", {defaultValue:"剪贴板为空"}), "info");
  const sameConnection = sftpClipboardMatchesConnection(tabKey);
  if (!sameConnection && sftpClipboard.mode !== "copy") return notify(tr("sftp:clipboard.cross_copy_only", {defaultValue:"跨主机只支持复制，不能移动"}), "error");
  const endpoint = sftpClipboard.mode === "move" ? "move" : "copy";
  try {
    const sourceConnectionId = Number(sftpClipboard.connectionId);
    const target = runtime?.state.path || tab.path || ".";
    let conflict = "error";
    if (!sameConnection) {
      const entries = sftpClipboard.paths.map(path => ({path, name:sftpPathName(path)}));
      conflict = await sftpConflictChoice(Number(tab.id), target, entries, {title:tr("sftp:operations.target_same_name", {defaultValue:"目标 SFTP 存在同名项目"})});
      if (conflict === "cancel") return;
    }
    const requestUrl = sameConnection
      ? `/api/connections/${tab.id}/sftp/${endpoint}`
      : `/api/connections/${sourceConnectionId}/sftp/cross-copy`;
    const requestBody = sameConnection
      ? {paths:sftpClipboard.paths, target, background:true}
      : {paths:sftpClipboard.paths, entries:sftpClipboard.entries || [], target_connection_id:Number(tab.id), target, conflict};
    const job = await api(requestUrl, {method:"POST", body:JSON.stringify(requestBody)});
    trackSftpMutationJob(job);
    sftpClipboard = null;
    for (const item of sftpTabRuntimes.values()) refreshSftpDirectoryActions(item.tabKey);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:operations.paste_failed", {defaultValue:"粘贴失败"}), "error");
  }
}

async function extractSftpSelection(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const paths = selectedSftpPaths(tabKey);
  if (!tab || paths.length !== 1) return notify(tr("sftp:operations.select_archive", {defaultValue:"请选择一个压缩包"}), "info");
  const archive = await sftpArchiveOptionsModal({mode:"extract", connectionId:tab.id, path:paths[0], target:runtime?.state.path || "."});
  if (!archive) return;
  const job = await api(`/api/connections/${tab.id}/sftp/extract`, {method:"POST", body:JSON.stringify({path:paths[0], target:archive.target, encoding:archive.encoding, overwrite:archive.overwrite, background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function sftpPathName(remotePath) {
  return String(remotePath || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "archive";
}

function sftpArchiveBaseName(remotePath) {
  return sftpPathName(remotePath).replace(/\.(?:tar\.gz|tgz|zip|tar)$/i, "") || "archive";
}

function sftpArchiveEncodingOptionsHtml(selected="utf8") {
  const options = [["default", tr("sftp:archive.default_encoding", {defaultValue:"默认"})], ...sftpFilenameEncodingOptions];
  return options.map(([value, label]) => `<option value="${escAttr(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function sftpArchiveOptionsModal(options={}) {
  return new Promise(resolve => {
    const mode = String(options.mode || "compress");
    const extracting = mode === "extract";
    const modal = $("modal");
    const connection = connections.find(item => Number(item.id) === Number(options.connectionId));
    const initialEncoding = String(options.encoding || connection?.sftp_filename_encoding || "utf8").toLowerCase();
    const initialTarget = String(options.target || ".");
    const archiveFolderName = sftpArchiveBaseName(options.path || options.filename || "archive");
    const title = options.title || tr(extracting ? "sftp:archive.extract_title" : mode === "download" ? "sftp:archive.download_title" : "sftp:archive.compress_title", {
      defaultValue:extracting ? "解压缩文件" : mode === "download" ? "打包下载" : "压缩文件"
    });
    const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
    const confirmLabel = tr(extracting ? "sftp:menu.extract" : mode === "download" ? "sftp:transfer.download_archive" : "sftp:menu.compress", {
      defaultValue:extracting ? "解压" : mode === "download" ? "打包下载" : "压缩"
    });
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card sftp-archive-options-modal" role="dialog" aria-modal="true"><div class="sftp-modal-head"><div><h2>${esc(title)}</h2><span>${esc(options.path || "")}</span></div><button id="sftpArchiveCloseTop" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div><div class="sftp-archive-form">${extracting ? `<label>${esc(tr("sftp:archive.target_directory", {defaultValue:"解压到"}))}</label><div class="upload-line"><input id="sftpArchiveTarget" value="${escAttr(initialTarget)}"><button id="sftpArchiveBrowse" type="button" title="${escAttr(tr("sftp:archive.choose_remote_directory", {defaultValue:"选择远端目录"}))}" aria-label="${escAttr(tr("sftp:archive.choose_remote_directory", {defaultValue:"选择远端目录"}))}">${icon("folder-open")}<span>${esc(tr("sftp:archive.choose_directory", {defaultValue:"选择目录"}))}</span></button></div><div id="sftpArchiveBrowser" class="sftp-archive-browser" hidden><div class="sftp-archive-browser-head"><button id="sftpArchiveBrowserParent" class="icon-button" type="button" title="${escAttr(tr("sftp:auto.parent_directory", {defaultValue:"上一级"}))}" aria-label="${escAttr(tr("sftp:auto.parent_directory", {defaultValue:"上一级"}))}">${icon("corner-left-up")}</button><code id="sftpArchiveBrowserPath"></code><button id="sftpArchiveBrowserSelect" type="button">${icon("folder-check")}<span>${esc(tr("sftp:archive.select_current_directory", {defaultValue:"选择当前目录"}))}</span></button></div><div id="sftpArchiveBrowserList" class="sftp-archive-browser-list"></div></div><label>${esc(tr("sftp:archive.filename_encoding", {defaultValue:"文件名编码"}))}</label><select id="sftpArchiveEncoding">${sftpArchiveEncodingOptionsHtml(initialEncoding)}</select><label class="check-row"><input id="sftpArchiveOverwrite" type="checkbox" checked> ${esc(tr("sftp:archive.overwrite_existing", {defaultValue:"覆盖已存在的文件"}))}</label><label class="check-row"><input id="sftpArchiveNamedFolder" type="checkbox"> ${esc(tr("sftp:archive.extract_named_folder", {defaultValue:"解压到同名文件夹"}))}</label>` : `<label>${esc(tr("sftp:dialogs.archive_name", {defaultValue:"压缩包名称"}))}</label><input id="sftpArchiveFilename" value="${escAttr(options.filename || "archive.tar.gz")}"><label>${esc(tr("sftp:archive.filename_encoding", {defaultValue:"文件名编码"}))}</label><select id="sftpArchiveEncoding">${sftpArchiveEncodingOptionsHtml(initialEncoding)}</select>`}</div><div class="actions"><button id="sftpArchiveCancel" type="button">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="sftpArchiveConfirm" class="primary" type="button">${extracting ? icon("archive-restore") : icon("archive")}<span>${esc(confirmLabel)}</span></button></div></div>`;
    modal.hidden = false;
    let settled = false;
    let baseTarget = initialTarget;
    let browserPath = initialTarget;
    const close = value => {
      if (settled) return;
      settled = true;
      modal.hidden = true;
      modal.innerHTML = "";
      resolve(value);
    };
    const normalizedTarget = value => String(value || ".").replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    const joinTarget = (directory, name) => directory === "/" ? `/${name}` : `${directory.replace(/\/$/, "")}/${name}`;
    const syncTarget = () => {
      const target = $("sftpArchiveTarget");
      if (!target) return;
      target.value = $("sftpArchiveNamedFolder")?.checked ? joinTarget(normalizedTarget(baseTarget), archiveFolderName) : normalizedTarget(baseTarget);
    };
    const loadBrowser = async nextPath => {
      const list = $("sftpArchiveBrowserList");
      const pathLabel = $("sftpArchiveBrowserPath");
      browserPath = normalizedTarget(nextPath);
      pathLabel.textContent = browserPath;
      list.innerHTML = stateView("loading", tr("sftp:auto.loading_directory", {defaultValue:"正在读取目录"}), browserPath);
      try {
        const params = new URLSearchParams({path:browserPath, page:"1", page_size:"200", sort:"name", dir:"asc"});
        const data = await api(`/api/connections/${Number(options.connectionId)}/sftp?${params.toString()}`);
        browserPath = String(data.path || browserPath);
        pathLabel.textContent = browserPath;
        const directories = (data.entries || []).filter(item => ["dir", "directory"].includes(String(item.type || "")));
        list.innerHTML = directories.length
          ? directories.map(item => `<button type="button" data-sftp-archive-directory="${escAttr(item.name)}">${icon("folder")}<span>${esc(item.name)}</span>${icon("chevron-right")}</button>`).join("")
          : `<div class="muted">${esc(tr("sftp:archive.no_subdirectories", {defaultValue:"当前目录没有子目录"}))}</div>`;
        list.querySelectorAll("[data-sftp-archive-directory]").forEach(button => {
          button.onclick = () => loadBrowser(joinRemotePath(browserPath, button.dataset.sftpArchiveDirectory));
        });
        refreshIcons();
      } catch (error) {
        list.innerHTML = `<div class="error-text">${esc(error.message || tr("sftp:archive.directory_read_failed", {defaultValue:"目录读取失败"}))}</div>`;
      }
    };
    $("sftpArchiveCloseTop").onclick = () => close(null);
    $("sftpArchiveCancel").onclick = () => close(null);
    if (extracting) {
      $("sftpArchiveTarget").addEventListener("input", event => {
        const value = normalizedTarget(event.target.value);
        baseTarget = $("sftpArchiveNamedFolder").checked && value.endsWith(`/${archiveFolderName}`)
          ? value.slice(0, -archiveFolderName.length - 1) || "/"
          : value;
      });
      $("sftpArchiveNamedFolder").onchange = syncTarget;
      $("sftpArchiveBrowse").onclick = () => {
        const browser = $("sftpArchiveBrowser");
        browser.hidden = !browser.hidden;
        if (!browser.hidden) void loadBrowser(baseTarget);
      };
      $("sftpArchiveBrowserParent").onclick = () => loadBrowser(parentRemotePath(browserPath));
      $("sftpArchiveBrowserSelect").onclick = () => {
        baseTarget = browserPath;
        syncTarget();
        $("sftpArchiveBrowser").hidden = true;
      };
    }
    $("sftpArchiveConfirm").onclick = () => {
      const encoding = $("sftpArchiveEncoding").value || "default";
      if (extracting) {
        const target = normalizedTarget($("sftpArchiveTarget").value);
        if (!target) return notify(tr("sftp:archive.target_required", {defaultValue:"请输入解压目录"}), "error");
        close({target, encoding, overwrite:$("sftpArchiveOverwrite").checked, namedFolder:$("sftpArchiveNamedFolder").checked});
        return;
      }
      const filename = String($("sftpArchiveFilename").value || "").trim();
      if (!filename) return notify(tr("sftp:archive.filename_required", {defaultValue:"请输入压缩包名称"}), "error");
      close({filename, encoding});
    };
    modal.onkeydown = event => {
      if (event.key === "Escape") close(null);
      if (event.key === "Enter" && event.target?.tagName !== "BUTTON") {
        event.preventDefault();
        $("sftpArchiveConfirm").click();
      }
    };
    $(extracting ? "sftpArchiveTarget" : "sftpArchiveFilename")?.focus();
    refreshIcons();
  });
}

function defaultSftpArchiveName(entries) {
  if (entries.length === 1) return `${sftpPathName(entries[0].path)}.tar.gz`;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `archive-${stamp}.tar.gz`;
}

async function compressSftpSelection(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const entries = selectedSftpEntries(tabKey);
  if (!tab || !entries.length) return notify(tr("sftp:operations.select_compress_items", {defaultValue:"请选择要压缩的文件或目录"}), "info");
  const archive = await sftpArchiveOptionsModal({mode:"compress", connectionId:tab.id, title:tr("sftp:dialogs.compress_selected", {defaultValue:"压缩选中项目"}), filename:defaultSftpArchiveName(entries)});
  if (!archive) return;
  try {
    const job = await api(`/api/connections/${tab.id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), target:runtime?.state.path || ".", filename:archive.filename, encoding:archive.encoding})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:operations.compress_failed", {defaultValue:"压缩任务创建失败"}), "error");
  }
}

function normalizePermissionMode(value) {
  const mode = String(value ?? "").trim();
  return /^[0-7]{3}$/.test(mode) ? mode : "";
}

function permissionModeToChecks(value) {
  const mode = normalizePermissionMode(value);
  const digits = mode ? mode.split("").map(Number) : [0, 0, 0];
  return {
    ownerRead: Boolean(digits[0] & 4), ownerWrite: Boolean(digits[0] & 2), ownerExecute: Boolean(digits[0] & 1),
    groupRead: Boolean(digits[1] & 4), groupWrite: Boolean(digits[1] & 2), groupExecute: Boolean(digits[1] & 1),
    publicRead: Boolean(digits[2] & 4), publicWrite: Boolean(digits[2] & 2), publicExecute: Boolean(digits[2] & 1)
  };
}

function permissionChecksToMode(checks) {
  const digit = (read, write, execute) => (read ? 4 : 0) + (write ? 2 : 0) + (execute ? 1 : 0);
  return `${digit(checks.ownerRead, checks.ownerWrite, checks.ownerExecute)}${digit(checks.groupRead, checks.groupWrite, checks.groupExecute)}${digit(checks.publicRead, checks.publicWrite, checks.publicExecute)}`;
}

function selectedSftpPermissionMetadata(entries) {
  const modes = entries.map(item => normalizePermissionMode(item.mode)).filter(Boolean);
  const owners = entries.map(item => item.owner).filter(Boolean);
  const groups = entries.map(item => item.group).filter(Boolean);
  return {
    mode: modes.length === entries.length && modes.every(item => item === modes[0]) ? modes[0] : "",
    owner: owners.length === entries.length && owners.every(item => item === owners[0]) ? owners[0] : "",
    group: groups.length === entries.length && groups.every(item => item === groups[0]) ? groups[0] : "",
    mixedMode: modes.length > 1 && new Set(modes).size > 1,
    hasDirectory: entries.some(item => item.type === "dir")
  };
}

function permissionFieldsetHtml(title, prefix, checks) {
  return `<fieldset class="sftp-permission-group"><legend>${esc(title)}</legend><label><input type="checkbox" data-permission="${prefix}Read" ${checks[`${prefix}Read`] ? "checked" : ""}>${esc(tr("sftp:auto.read", {defaultValue:"读取"}))}</label><label><input type="checkbox" data-permission="${prefix}Write" ${checks[`${prefix}Write`] ? "checked" : ""}>${esc(tr("sftp:auto.write", {defaultValue:"写入"}))}</label><label><input type="checkbox" data-permission="${prefix}Execute" ${checks[`${prefix}Execute`] ? "checked" : ""}>${esc(tr("sftp:auto.execute", {defaultValue:"执行"}))}</label></fieldset>`;
}

function openSftpPermissionsForSelection(paths = null, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const state = runtime?.state;
  const selected = paths ? paths.map(path => ({path, name:sftpPathName(path)})) : selectedSftpEntries(tabKey);
  if (!selected.length) return notify(tr("sftp:permissions_editor.select_items", {defaultValue:"请选择要设置权限的文件或目录"}), "info");
  const entries = selected.map(item => {
    const known = (state?.entries || []).find(entry => joinRemotePath(state.path, entry.name) === item.path);
    return {...item, mode:item.mode || known?.mode || "", owner:item.owner || known?.owner || "", group:item.group || known?.group || "", type:item.type || known?.type || "file"};
  });
  const metadata = selectedSftpPermissionMetadata(entries);
  const modal = $("modal");
  modal.onclick = null;
  const mode = metadata.mode;
  const checks = permissionModeToChecks(mode);
  const itemSummary = tr("sftp:permissions_editor.item_count", {count:entries.length, defaultValue:`${entries.length} 个项目`});
  const mixedSummary = metadata.mixedMode ? tr("sftp:permissions_editor.mixed_suffix", {defaultValue:" · 当前权限不一致，请输入新的权限值"}) : "";
  const closeText = tr("common:actions.close", {defaultValue:"关闭"});
  modal.innerHTML = `<div class="modal-card wide sftp-permission-modal" role="dialog" aria-modal="true" aria-labelledby="sftpPermissionTitle"><div class="sftp-permission-head"><div><h2 id="sftpPermissionTitle">${esc(tr("sftp:menu.permissions", {defaultValue:"设置权限"}))}</h2><span>${esc(itemSummary + mixedSummary)}</span></div><button class="icon-button" type="button" title="${escAttr(closeText)}" aria-label="${escAttr(closeText)}" id="sftpPermissionClose">${icon("x")}</button></div><div class="sftp-permission-groups">${permissionFieldsetHtml(tr("sftp:permissions_editor.owner", {defaultValue:"所有者"}), "owner", checks)}${permissionFieldsetHtml(tr("sftp:permissions_editor.group", {defaultValue:"用户组"}), "group", checks)}${permissionFieldsetHtml(tr("sftp:permissions_editor.public", {defaultValue:"公共"}), "public", checks)}</div><div class="sftp-permission-fields"><label>${esc(tr("sftp:permissions_editor.mode", {defaultValue:"权限值"}))}<input id="sftpPermissionMode" inputmode="numeric" maxlength="3" value="${escAttr(mode)}" placeholder="${escAttr(tr("sftp:permissions_editor.mode_example", {defaultValue:"例如 755"}))}"><span>${esc(tr("sftp:permissions_editor.octal_hint", {defaultValue:"三位八进制数字"}))}</span></label><label>${esc(tr("sftp:permissions_editor.owner", {defaultValue:"所有者"}))}<input id="sftpPermissionOwner" value="${escAttr(metadata.owner)}" placeholder="${escAttr(tr("sftp:permissions_editor.multiple_unchanged", {defaultValue:"多个值，留空不修改"}))}" autocomplete="off"><span>${esc(tr("sftp:permissions_editor.blank_unchanged", {defaultValue:"留空表示不修改"}))}</span></label><label>${esc(tr("sftp:permissions_editor.group", {defaultValue:"用户组"}))}<input id="sftpPermissionGroup" value="${escAttr(metadata.group)}" placeholder="${escAttr(tr("sftp:permissions_editor.multiple_unchanged", {defaultValue:"多个值，留空不修改"}))}" autocomplete="off"><span>${esc(tr("sftp:permissions_editor.blank_unchanged", {defaultValue:"留空表示不修改"}))}</span></label></div>${metadata.hasDirectory ? `<label class="check-row sftp-permission-recursive"><input id="sftpPermissionRecursive" type="checkbox">${esc(tr("sftp:permissions_editor.recursive", {defaultValue:"应用到目录内的子目录和文件"}))}</label>` : ""}<p class="sftp-permission-note">${esc(tr("sftp:permissions_editor.note", {defaultValue:"修改所有者或用户组需要远端账号具备相应权限；不会自动使用 sudo。只修改权限值时可将这两个字段留空。"}))}</p><div id="sftpPermissionStatus" class="sftp-permission-status" role="status" aria-live="polite">${esc(tr("sftp:permissions_editor.waiting", {defaultValue:"等待应用"}))}</div><div class="actions"><button id="sftpPermissionCancel">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button class="primary" id="sftpPermissionApply">${esc(tr("common:actions.apply", {defaultValue:"应用"}))}</button></div></div>`;
  modal.hidden = false;
  const modeInput = $("sftpPermissionMode");
  const apply = $("sftpPermissionApply");
  const syncChecks = () => {
    const next = normalizePermissionMode(modeInput.value);
    apply.disabled = !next;
    if (!next) return;
    const nextChecks = permissionModeToChecks(next);
    modal.querySelectorAll("[data-permission]").forEach(input => { input.checked = Boolean(nextChecks[input.dataset.permission]); });
  };
  const syncMode = () => {
    const next = {};
    modal.querySelectorAll("[data-permission]").forEach(input => { next[input.dataset.permission] = input.checked; });
    modeInput.value = permissionChecksToMode(next);
    apply.disabled = false;
  };
  modal.querySelectorAll("[data-permission]").forEach(input => input.addEventListener("change", syncMode));
  modeInput.addEventListener("input", syncChecks);
  syncChecks();
  let busy = false;
  const applyIdleHtml = apply.innerHTML;
  const status = $("sftpPermissionStatus");
  const setBusy = (value, message = "") => {
    busy = value;
    modal.querySelectorAll("input, button").forEach(control => { control.disabled = value; });
    apply.setAttribute("aria-busy", value ? "true" : "false");
    apply.innerHTML = value ? `${icon("loader-circle")}<span>${esc(tr("sftp:permissions_editor.applying", {defaultValue:"正在应用"}))}</span>` : applyIdleHtml;
    apply.classList.toggle("is-loading", value);
    status.className = `sftp-permission-status${value ? " busy" : ""}`;
    status.textContent = message || tr(value ? "sftp:permissions_editor.connecting" : "sftp:permissions_editor.waiting", {defaultValue:value ? "正在连接远程服务器并修改权限…" : "等待应用"});
    if (!value) syncChecks();
  };
  const close = (force = false) => {
    if (busy && !force) return;
    modal.hidden = true;
    modal.onclick = null;
    modal.innerHTML = "";
  };
  $("sftpPermissionClose").onclick = () => close();
  $("sftpPermissionCancel").onclick = () => close();
  apply.onclick = async () => {
    if (busy) return;
    const nextMode = normalizePermissionMode(modeInput.value);
    if (!nextMode) return notify(tr("sftp:permissions_editor.invalid_mode", {defaultValue:"权限值必须是三位八进制数字，例如 755"}), "error");
    try {
      const ownerInput = $("sftpPermissionOwner");
      const groupInput = $("sftpPermissionGroup");
      const owner = ownerInput.value.trim() && ownerInput.value.trim() !== metadata.owner ? ownerInput.value.trim() : "";
      const group = groupInput.value.trim() && groupInput.value.trim() !== metadata.group ? groupInput.value.trim() : "";
      setBusy(true);
      await api(`/api/connections/${state?.connectionId}/sftp/permissions`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), mode:nextMode, owner, group, recursive:Boolean($("sftpPermissionRecursive")?.checked)})});
      close(true);
      notify(tr("sftp:permissions_editor.updated", {defaultValue:"权限修改完成"}), "success");
      refreshSftp({tabKey});
    } catch (error) {
      const message = error.message || tr("sftp:permissions_editor.update_failed", {defaultValue:"权限修改失败"});
      setBusy(false, tr("sftp:permissions_editor.update_failed_detail", {error:message, defaultValue:`修改失败：${message}`}));
      status.classList.add("error");
      notify(message, "error");
    }
  };
  if (!mode) modeInput.focus();
}
