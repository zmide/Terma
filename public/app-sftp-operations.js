function isArchiveName(name) {
  return /\.(zip|tar|tar\.gz|tgz)$/i.test(String(name || ""));
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
  if (event?.shiftKey || event?.ctrlKey || event?.metaKey) applySftpRangeSelection(event, path, tabKey);
}

function activateSftpEntry(event, id, path, name, type, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (event?.target?.closest(".sftp-check, .sftp-row-actions")) return;
  event?.preventDefault();
  event?.stopPropagation();
  selectSftpEntry(event, id, path, name, type, tabKey);
  if (type === "dir") return navigateSftpPath(path, tabKey);
  return isSftpImageName(name) ? previewSftpImage(id, path) : previewSftpText(id, path);
}

function sftpRowActionsHtml(id, path, name, type, tabKey=activeTabKey) {
  const isDir = type === "dir";
  const archive = !isDir && isArchiveName(name);
  return [
    isDir
      ? `<button class="sftp-row-action sftp-row-action-core" title="打开目录" onclick="event.stopPropagation();navigateSftpPath('${escAttr(path)}','${escAttr(tabKey)}')">${icon("folder-open")}<span>打开</span></button>`
      : isSftpImageName(name)
        ? `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${id}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="image" title="预览图片" onclick="event.stopPropagation();previewSftpImage(${id},'${escAttr(path)}')">${icon("image")}<span>预览</span></button>`
        : `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${id}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="text" title="以文本打开" onclick="event.stopPropagation();previewSftpText(${id},'${escAttr(path)}')">${icon("file-text")}<span>打开</span></button>`,
    !isDir ? `<button class="sftp-row-action sftp-row-action-medium" title="下载" onclick="event.stopPropagation();downloadSftp(${id},'${escAttr(path)}')">${icon("download")}<span>下载</span></button>` : "",
    archive ? `<button class="sftp-row-action sftp-row-action-medium" title="解压" onclick="event.stopPropagation();extractSingleSftp(${id},'${escAttr(path)}','${escAttr(tabKey)}')">${icon("archive-restore")}<span>解压</span></button>` : "",
    `<button class="sftp-row-action sftp-row-action-medium" title="压缩" onclick="event.stopPropagation();compressSingleSftp(${id},'${escAttr(path)}','${escAttr(tabKey)}')">${icon("archive")}<span>压缩</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="复制" onclick="event.stopPropagation();copySingleSftp('${escAttr(path)}','copy','${escAttr(tabKey)}')">${icon("copy")}<span>复制</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="移动" onclick="event.stopPropagation();copySingleSftp('${escAttr(path)}','move','${escAttr(tabKey)}')">${icon("folder-input")}<span>移动</span></button>`,
    `<button class="sftp-row-action sftp-row-action-medium" title="重命名" onclick="event.stopPropagation();renameSftp(${id},'${escAttr(path)}','${escAttr(name)}','${escAttr(tabKey)}')">${icon("pencil")}<span>重命名</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="设置权限" onclick="event.stopPropagation();openSftpPermissionsForSelection(['${escAttr(path)}'],'${escAttr(tabKey)}')">${icon("key-round")}<span>权限</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide danger" title="删除" onclick="event.stopPropagation();deleteSftp(${id},'${escAttr(path)}','${escAttr(tabKey)}')">${icon("trash-2")}<span>删除</span></button>`,
    `<button class="sftp-row-action sftp-row-action-more" title="更多操作" aria-label="${esc(name)}的更多操作" onclick="showSftpEntryMenu(event, ${id},'${escAttr(path)}','${escAttr(name)}','${escAttr(type)}','${escAttr(tabKey)}')">${icon("ellipsis")}<span>更多</span></button>`
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
  const name = await inputModal("新建目录", "目录名称", "");
  if (!tab || !runtime || !name || !sftpTabRuntimes.has(tabKey)) return;
  if (!isValidSftpChildName(name, "目录名")) return;
  try {
    await api(`/api/connections/${tab.id}/sftp/mkdir`, {method:"POST", body:JSON.stringify({path:joinRemotePath(runtime.state.path || ".", name)})});
    notify("目录已创建", "success");
    refreshSftp({tabKey});
  } catch (error) {
    notify(error.message || "新建目录失败", "error");
  }
}

function isValidSftpChildName(value, label = "名称") {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.includes("\0")) {
    notify(`${label}不能包含路径分隔符或特殊目录名`, "error");
    return false;
  }
  return true;
}

async function createSftpFile(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const name = await inputModal("新建文件", "文件名", "");
  if (!tab || !runtime || !name || !sftpTabRuntimes.has(tabKey) || !isValidSftpChildName(name, "文件名")) return;
  const remotePath = joinRemotePath(runtime.state.path || ".", name);
  try {
    await api(`/api/connections/${tab.id}/sftp/create-file`, {method:"POST", body:JSON.stringify({path:remotePath})});
    notify("文件已创建", "success");
    await refreshSftp({tabKey});
  } catch (error) {
    notify(error.message || "新建文件失败", "error");
  }
}

async function renameSftp(id, from, oldName, tabKey=activeTabKey) {
  const name = await inputModal("重命名", "新名称", oldName);
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
  const itemText = count === 1 ? "该远程项目" : `选中的 ${count} 个远程项目`;
  if (enabled === true) return {
    title:"移入回收站",
    message:`将${itemText}移入回收站？${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"移入回收站",
    danger:false
  };
  if (enabled === false) return {
    title:"永久删除远程项目",
    message:`回收站未开启，将永久删除${itemText}且无法恢复。${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"永久删除",
    danger:true
  };
  return {
    title:"删除远程项目",
    message:`删除${itemText}？系统将按当前回收站设置处理。${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"继续",
    danger:true
  };
}

async function deleteSftp(id, path, tabKey=activeTabKey) {
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), 1, path);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, "取消", confirmation.danger)) return;
  const job = await api(`/api/connections/${id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths:[path]})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function deleteSftpSelection(tabKey=activeTabKey) {
  const tab = tabs.find(item => item.key === tabKey);
  const paths = selectedSftpPaths(tabKey);
  if (!tab || !paths.length) return notify("请选择文件或目录", "info");
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), paths.length);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, "取消", confirmation.danger)) return;
  const job = await api(`/api/connections/${tab.id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function copySftpSelection(mode, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const entries = selectedSftpEntries(tabKey);
  if (!entries.length) return notify("请选择文件或目录", "info");
  const tab = tabs.find(item => item.key === tabKey);
  sftpClipboard = {mode, paths:entries.map(item => item.path), entries, connectionId:Number(runtime?.state.connectionId || tab?.id || 0), connectionName:tab?.title || tab?.name || ""};
  for (const item of sftpTabRuntimes.values()) refreshSftpDirectoryActions(item.tabKey);
  notify(`${mode === "move" ? "移动" : "复制"}队列已保存，进入目标目录后点击粘贴`, "success");
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
  notify(`${mode === "move" ? "移动" : "复制"}队列已保存，进入目标目录后点击粘贴`, "success");
}

async function pasteSftpClipboard(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  if (!tab || !sftpClipboard?.paths?.length) return notify("剪贴板为空", "info");
  const sameConnection = sftpClipboardMatchesConnection(tabKey);
  if (!sameConnection && sftpClipboard.mode !== "copy") return notify("跨主机只支持复制，不能移动", "error");
  const endpoint = sftpClipboard.mode === "move" ? "move" : "copy";
  try {
    const sourceConnectionId = Number(sftpClipboard.connectionId);
    const target = runtime?.state.path || tab.path || ".";
    let conflict = "error";
    if (!sameConnection) {
      const entries = sftpClipboard.paths.map(path => ({path, name:sftpPathName(path)}));
      conflict = await sftpConflictChoice(Number(tab.id), target, entries, {title:"目标 SFTP 存在同名项目"});
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
    notify(error.message || "粘贴失败", "error");
  }
}

async function extractSftpSelection(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const paths = selectedSftpPaths(tabKey);
  if (!tab || paths.length !== 1) return notify("请选择一个压缩包", "info");
  const job = await api(`/api/connections/${tab.id}/sftp/extract`, {method:"POST", body:JSON.stringify({path:paths[0], target:runtime?.state.path || ".", background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function sftpPathName(remotePath) {
  return String(remotePath || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "archive";
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
  if (!tab || !entries.length) return notify("请选择要压缩的文件或目录", "info");
  const name = await inputModal("压缩选中项目", "压缩包名称（自动使用 tar.gz）", defaultSftpArchiveName(entries));
  if (!name) return;
  try {
    const job = await api(`/api/connections/${tab.id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), target:runtime?.state.path || ".", filename:name})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "压缩任务创建失败", "error");
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
  return `<fieldset class="sftp-permission-group"><legend>${title}</legend><label><input type="checkbox" data-permission="${prefix}Read" ${checks[`${prefix}Read`] ? "checked" : ""}>读取</label><label><input type="checkbox" data-permission="${prefix}Write" ${checks[`${prefix}Write`] ? "checked" : ""}>写入</label><label><input type="checkbox" data-permission="${prefix}Execute" ${checks[`${prefix}Execute`] ? "checked" : ""}>执行</label></fieldset>`;
}

function openSftpPermissionsForSelection(paths = null, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const state = runtime?.state;
  const selected = paths ? paths.map(path => ({path, name:sftpPathName(path)})) : selectedSftpEntries(tabKey);
  if (!selected.length) return notify("请选择要设置权限的文件或目录", "info");
  const entries = selected.map(item => {
    const known = (state?.entries || []).find(entry => joinRemotePath(state.path, entry.name) === item.path);
    return {...item, mode:item.mode || known?.mode || "", owner:item.owner || known?.owner || "", group:item.group || known?.group || "", type:item.type || known?.type || "file"};
  });
  const metadata = selectedSftpPermissionMetadata(entries);
  const modal = $("modal");
  modal.onclick = null;
  const mode = metadata.mode;
  const checks = permissionModeToChecks(mode);
  modal.innerHTML = `<div class="modal-card wide sftp-permission-modal" role="dialog" aria-modal="true" aria-labelledby="sftpPermissionTitle"><div class="sftp-permission-head"><div><h2 id="sftpPermissionTitle">设置权限</h2><span>${entries.length} 个项目${metadata.mixedMode ? " · 当前权限不一致，请输入新的权限值" : ""}</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" id="sftpPermissionClose">${icon("x")}</button></div><div class="sftp-permission-groups">${permissionFieldsetHtml("所有者", "owner", checks)}${permissionFieldsetHtml("用户组", "group", checks)}${permissionFieldsetHtml("公共", "public", checks)}</div><div class="sftp-permission-fields"><label>权限值<input id="sftpPermissionMode" inputmode="numeric" maxlength="3" value="${esc(mode)}" placeholder="例如 755"><span>三位八进制数字</span></label><label>所有者<input id="sftpPermissionOwner" value="${esc(metadata.owner)}" placeholder="多个值，留空不修改" autocomplete="off"><span>留空表示不修改</span></label><label>用户组<input id="sftpPermissionGroup" value="${esc(metadata.group)}" placeholder="多个值，留空不修改" autocomplete="off"><span>留空表示不修改</span></label></div>${metadata.hasDirectory ? `<label class="check-row sftp-permission-recursive"><input id="sftpPermissionRecursive" type="checkbox">应用到目录内的子目录和文件</label>` : ""}<p class="sftp-permission-note">修改所有者或用户组需要远端账号具备相应权限；不会自动使用 sudo。只修改权限值时可将这两个字段留空。</p><div id="sftpPermissionStatus" class="sftp-permission-status" role="status" aria-live="polite">等待应用</div><div class="actions"><button id="sftpPermissionCancel">取消</button><button class="primary" id="sftpPermissionApply">应用</button></div></div>`;
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
    apply.innerHTML = value ? `${icon("loader-circle")}<span>正在应用</span>` : applyIdleHtml;
    apply.classList.toggle("is-loading", value);
    status.className = `sftp-permission-status${value ? " busy" : ""}`;
    status.textContent = message || (value ? "正在连接远程服务器并修改权限…" : "等待应用");
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
    if (!nextMode) return notify("权限值必须是三位八进制数字，例如 755", "error");
    try {
      const ownerInput = $("sftpPermissionOwner");
      const groupInput = $("sftpPermissionGroup");
      const owner = ownerInput.value.trim() && ownerInput.value.trim() !== metadata.owner ? ownerInput.value.trim() : "";
      const group = groupInput.value.trim() && groupInput.value.trim() !== metadata.group ? groupInput.value.trim() : "";
      setBusy(true);
      await api(`/api/connections/${state?.connectionId}/sftp/permissions`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), mode:nextMode, owner, group, recursive:Boolean($("sftpPermissionRecursive")?.checked)})});
      close(true);
      notify("权限修改完成", "success");
      refreshSftp({tabKey});
    } catch (error) {
      const message = error.message || "权限修改失败";
      setBusy(false, `修改失败：${message}`);
      status.classList.add("error");
      notify(message, "error");
    }
  };
  if (!mode) modeInput.focus();
}
