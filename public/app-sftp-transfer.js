async function getSftpDownloadSettings() {
  return api("/api/sftp/download-settings").catch(() => ({delivery_mode:"browser"}));
}

async function confirmSftpDownloadNotice(downloadSettings) {
  const desktop = downloadSettings?.delivery_mode === "desktop";
  const noticeKey = desktop ? "sftpDesktopDownloadNoticeV1" : "sftpBrowserDownloadNoticeV1";
  if (localStorage.getItem(noticeKey) === "1") return true;
  if (sftpDownloadNoticeRequests.has(noticeKey)) return sftpDownloadNoticeRequests.get(noticeKey);
  const request = (async () => {
    const message = desktop
      ? tr("sftp:transfer.desktop_download_notice", {path:downloadSettings.effective_directory || tr("sftp:settings.system_download_directory")})
      : tr("sftp:transfer.browser_download_notice", {device:tr(isMobileLayout() ? "sftp:transfer.phone" : "sftp:transfer.device")});
    const accepted = await confirmModal(message, tr("sftp:transfer.first_download_title"), tr("sftp:transfer.continue_download"), tr("common:actions.cancel"));
    if (accepted) localStorage.setItem(noticeKey, "1");
    return accepted;
  })();
  sftpDownloadNoticeRequests.set(noticeKey, request);
  try {
    return await request;
  } finally {
    sftpDownloadNoticeRequests.delete(noticeKey);
  }
}

function trackSftpBrowserDownload(result) {
  if (result?.delivery_mode === "browser" && result.id) sftpPendingBrowserDownloads.add(result.id);
  return result;
}

function queueSftpDownload(id, path, type="file") {
  if (type === "dir") {
    return api(`/api/connections/${id}/sftp/download-batch`, {
      method:"POST",
      body:JSON.stringify({paths:[path], mode:"archive"})
    }).then(trackSftpBrowserDownload);
  }
  return api(`/api/connections/${id}/sftp/download`, {
    method:"POST",
    body:JSON.stringify({path})
  }).then(trackSftpBrowserDownload);
}

async function downloadSftp(id, path, type="file") {
  try {
    const downloadSettings = await getSftpDownloadSettings();
    if (!await confirmSftpDownloadNotice(downloadSettings)) return false;
    await queueSftpDownload(id, path, type);
    await refreshSftpJobs();
    startSftpJobsTimer();
    return true;
  } catch (error) {
    notify(error.message || tr("sftp:transfer.download_failed"), "error");
    return false;
  }
}

async function retryCompletedSftpDownload(jobId, button=null) {
  const job = sftpLatestJobs.find(item => String(item.id) === String(jobId));
  if (!job || job.type !== "download") return notify(tr("sftp:transfer.download_job_missing"), "error");
  const actionKey = `sftp-task:download-again:${jobId}`;
  if (!beginUiAction(actionKey, button, tr("sftp:transfer.preparing"))) return false;
  try {
    const settings = await getSftpDownloadSettings();
    if (!await confirmSftpDownloadNotice(settings)) return false;
    let result;
    if (job.archive_download && Array.isArray(job.archive_source_paths) && job.archive_source_paths.length) {
      result = await api(`/api/connections/${Number(job.connection_id)}/sftp/download-batch`, {
        method:"POST",
        body:JSON.stringify({paths:job.archive_source_paths, mode:"archive"})
      });
    } else {
      result = await queueSftpDownload(Number(job.connection_id), String(job.remote_path || ""), "file");
    }
    trackSftpBrowserDownload(result);
    await refreshSftpJobs();
    startSftpJobsTimer();
    return true;
  } catch (error) {
    notify(error.message || tr("sftp:transfer.redownload_failed"), "error");
    return false;
  } finally {
    endUiAction(actionKey, button);
  }
}

function downloadWithProgress(url, onProgress, fallbackName="download") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)), event.loaded);
      else onProgress(-1, event.loaded || 0);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const reader = new FileReader();
        reader.onload = () => {
          try { reject(new Error(JSON.parse(String(reader.result || "")).error || xhr.statusText || tr("sftp:transfer.download_failed"))); }
          catch { reject(new Error(xhr.statusText || tr("sftp:transfer.download_failed"))); }
        };
        reader.onerror = () => reject(new Error(xhr.statusText || tr("sftp:transfer.download_failed")));
        reader.readAsText(xhr.response);
        return;
      }
      const link = document.createElement("a");
      const disposition = xhr.getResponseHeader("Content-Disposition") || "";
      const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
      link.download = match ? decodeURIComponent(match[1]) : fallbackName;
      link.href = URL.createObjectURL(xhr.response);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 1000);
      resolve();
    };
    xhr.onerror = () => reject(new Error(tr("sftp:transfer.download_connection_failed")));
    xhr.send();
  });
}

function normalizeDroppedRelativePath(value, fallback="upload") {
  const parts = String(value || fallback).replace(/\\/g, "/").split("/")
    .map(part => part.trim()).filter(part => part && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

async function downloadSftpSelection(tabKey=activeTabKey) {
  const tab = tabs.find(item => item.key === tabKey && item.kind === "sftp");
  const entries = selectedSftpEntries(tabKey);
  if (!tab || !entries.length) return notify(tr("sftp:transfer.select_download_items"), "info");
  try {
    const settings = await getSftpDownloadSettings();
    const browser = settings.delivery_mode !== "desktop";
    const mode = await chooseModal(tr("sftp:transfer.batch_download_title"), browser
      ? tr("sftp:transfer.batch_download_browser", {count:entries.length})
      : tr("sftp:transfer.batch_download_desktop", {count:entries.length}), [
      {label:tr("sftp:transfer.download_separately"), value:"separate", className:"primary"},
      {label:tr("sftp:transfer.download_archive"), value:"archive"},
      {label:tr("common:actions.cancel"), value:""}
    ]);
    if (!mode || !await confirmSftpDownloadNotice(settings)) return;
    notify(tr(mode === "separate" ? "sftp:transfer.downloading_selected" : "sftp:transfer.creating_archive"), "info");
    if (mode === "separate" && browser) {
      for (const entry of entries) await queueSftpDownload(tab.id, entry.path, entry.type);
    } else {
      const result = await api(`/api/connections/${tab.id}/sftp/download-batch`, {
        method:"POST",
        body:JSON.stringify({paths:entries.map(item => item.path), mode})
      });
      if (mode === "separate") {
        trackSftpMutationJob(result);
        notify(tr(entries.length === 1 ? "common:notifications.background_transfer_downloads_one" : "common:notifications.background_transfer_downloads_other", {count:entries.length, defaultValue:`后台传输已开始：${entries.length} 个项目到下载目录`}), "info");
      } else {
        trackSftpBrowserDownload(result);
      }
    }
    clearSftpSelection(tabKey);
    await refreshSftpJobs();
    startSftpJobsTimer();
  } catch (error) {
    notify(error.message || tr("sftp:transfer.batch_download_failed"), "error");
  }
}

async function sendSftpSelectionToDesktop(tabKey=activeTabKey) {
  const tab = tabs.find(item => item.key === tabKey && item.kind === "sftp");
  const paths = selectedSftpPaths(tabKey);
  if (!tab || !paths.length || typeof sendSftpPathsToDesktop !== "function") return;
  try {
    await sendSftpPathsToDesktop(tab.id, paths);
    clearSftpSelection(tabKey);
  } catch (error) {
    notify(error.message || tr("sftp:transfer.send_desktop_failed"), "error");
  }
}

function readDroppedFileEntry(entry, prefix="") {
  return new Promise((resolve, reject) => {
    entry.file(file => resolve([{file, relativePath:normalizeDroppedRelativePath(`${prefix}${file.name}`, file.name)}]), reject);
  });
}

async function readDroppedDirectoryEntry(entry, prefix="") {
  const directoryPrefix = `${prefix}${entry.name}/`;
  const reader = entry.createReader();
  const entries = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const nested = [];
  for (const child of entries) nested.push(...await readDroppedEntry(child, directoryPrefix));
  return nested;
}

function readDroppedEntry(entry, prefix="") {
  if (entry?.isFile) return readDroppedFileEntry(entry, prefix);
  if (entry?.isDirectory) return readDroppedDirectoryEntry(entry, prefix);
  return Promise.resolve([]);
}

async function collectDroppedFiles(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) {
    const files = [];
    for (const entry of entries) files.push(...await readDroppedEntry(entry));
    return files;
  }
  return [...(dataTransfer?.files || [])].map(file => ({file, relativePath:normalizeDroppedRelativePath(file.webkitRelativePath || file.name, file.name)}));
}

function focusSftpDragFeedbackTarget(kind, key="", targetSession=null) {
  const targetKind = kind === "terminal" ? "terminal" : "sftp";
  const targetKey = String(key || "");
  cancelSftpDropLeaveClear();
  if (targetKind === "terminal") sftpDropDepth = 0;
  for (const tabKey of sftpTabRuntimes.keys()) {
    if (targetKind === "sftp" && tabKey === targetKey) continue;
    const shell = sftpRuntimeRoot(tabKey)?.querySelector(".sftp-shell");
    const overlay = sftpElement("sftpDropOverlay", tabKey);
    shell?.classList.remove("is-drag-over");
    if (overlay) {
      overlay.hidden = true;
      overlay.removeAttribute("style");
      overlay.dataset.mode = "upload";
    }
  }
  if (typeof terminalSessions !== "undefined") {
    for (const session of terminalSessions.values()) {
      if (targetKind === "terminal" && (session === targetSession || (targetKey && String(session?.key || "") === targetKey))) continue;
      session.terminalDropDepth = 0;
      const overlay = session?.mount?.querySelector?.(".terminal-drop-overlay");
      if (overlay) overlay.hidden = true;
    }
  }
  if (targetKind === "terminal") $("sftpDragHint")?.remove();
  sftpDragFeedbackTargetKind = targetKind;
  sftpDragFeedbackTargetKey = targetKey;
  sftpDragFeedbackTargetSession = targetSession;
}

function releaseSftpDragFeedbackTarget(kind, key="", targetSession=null) {
  const targetKind = kind === "terminal" ? "terminal" : "sftp";
  const targetKey = String(key || "");
  const matches = sftpDragFeedbackTargetKind === targetKind && (
    targetKind === "terminal"
      ? sftpDragFeedbackTargetSession === targetSession || (targetKey && sftpDragFeedbackTargetKey === targetKey)
      : sftpDragFeedbackTargetKey === targetKey
  );
  if (!matches) return false;
  sftpDragFeedbackTargetKind = "";
  sftpDragFeedbackTargetKey = "";
  sftpDragFeedbackTargetSession = null;
  return true;
}

function setSftpExternalDropState(active, options={}) {
  const tabKey = String(options.tabKey || activeTabKey || "");
  if (active) {
    cancelSftpDropLeaveClear();
    noteSftpDragFeedbackActivity();
    focusSftpDragFeedbackTarget("sftp", tabKey);
  }
  if (!active) {
    const clearsCurrentTarget = options.tabKey
      ? releaseSftpDragFeedbackTarget("sftp", String(options.tabKey))
      : true;
    if (!options.tabKey) {
      sftpDragFeedbackTargetKind = "";
      sftpDragFeedbackTargetKey = "";
      sftpDragFeedbackTargetSession = null;
    }
    const keys = options.tabKey ? [String(options.tabKey)] : [...sftpTabRuntimes.keys()];
    for (const key of keys) {
      const shell = sftpRuntimeRoot(key)?.querySelector(".sftp-shell");
      const overlay = sftpElement("sftpDropOverlay", key);
      shell?.classList.remove("is-drag-over");
      if (!overlay) continue;
      overlay.hidden = true;
      overlay.removeAttribute("style");
      overlay.dataset.mode = "upload";
    }
    if (!options.keepHint && clearsCurrentTarget) $("sftpDragHint")?.remove();
    return;
  }
  const runtime = sftpTabRuntimes.get(tabKey);
  const shell = sftpRuntimeRoot(tabKey)?.querySelector(".sftp-shell");
  const overlay = sftpElement("sftpDropOverlay", tabKey);
  shell?.classList.add("is-drag-over");
  if (!overlay) return;
  overlay.hidden = false;
  const crossHost = sftpOwnDragActive();
  overlay.dataset.mode = crossHost ? "copy" : "upload";
  const path = options.path || runtime?.state.path || ".";
  const message = crossHost
    ? options.title || tr("sftp:transfer.drop_copy_to", {target:path})
    : options.title || tr("sftp:transfer.drop_upload_to", {target:path});
  showSftpDragHint(message, true, crossHost ? "copy" : "upload", tabKey);
  const visibleHost = sftpElement("sftpList", tabKey) || shell;
  const rect = visibleHost?.getBoundingClientRect?.();
  if (!rect) return;
  const stickyTopRect = shell?.querySelector?.(".sftp-top")?.getBoundingClientRect?.();
  const unobscuredTop = Math.max(0, Number(stickyTopRect?.bottom || 0) + 4);
  const left = Math.max(0, rect.left);
  const top = Math.max(unobscuredTop, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) {
    overlay.hidden = true;
    return;
  }
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${Math.max(0, right - left)}px`;
  overlay.style.height = `${Math.max(0, bottom - top)}px`;
}

function cancelSftpDropLeaveClear() {
  if (!sftpDropLeaveTimer) return;
  clearTimeout(sftpDropLeaveTimer);
  sftpDropLeaveTimer = 0;
}

function scheduleSftpDropLeaveClear(options={}) {
  cancelSftpDropLeaveClear();
  sftpDropLeaveTimer = setTimeout(() => {
    sftpDropLeaveTimer = 0;
    if (sftpDropDepth > 0) return;
    setSftpExternalDropState(false, options);
  }, SFTP_DROP_LEAVE_GRACE_MS);
}

function sftpDragTransitionStaysInside(event) {
  const shell = event?.currentTarget;
  const related = event?.relatedTarget;
  if (!shell?.contains || !related) return false;
  try {
    return shell.contains(related);
  } catch {
    return false;
  }
}

function restoreSftpDropFeedbackAfterRender(tabKey) {
  const drag = activeSftpDragPayload();
  const target = activeSftpCrossDropTarget(drag, tabKey);
  if (!drag || !target || target.key !== tabKey) return;
  const state = sftpTabRuntimes.get(tabKey)?.state;
  const directory = Number(state?.connectionId) === Number(target.id) ? state.path : target.path || ".";
  setSftpExternalDropState(true, {title:tr("sftp:transfer.drop_copy_to", {target:target.title}), path:directory, tabKey});
}

function sftpDataTransferHasFiles(dataTransfer) {
  const types = sftpDataTransferTypes(dataTransfer);
  if (types.includes("files")) return true;
  if (Number(dataTransfer?.files?.length || 0) > 0) return true;
  if (Array.from(dataTransfer?.items || []).some(item => item.kind === "file")) return true;
  const desktopPlatform = String(window.termaDesktop?.capabilities?.platform || "");
  return Boolean(desktopPlatform && types.includes("text/uri-list"));
}

function sftpOwnDragActive(dataTransfer=null) {
  const internalActive = Boolean(
    sftpInternalDrag
    && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))
  );
  const handoffActive = Boolean(
    currentSftpInternalDragHandoff()
    && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))
  );
  const nativeActive = [...sftpNativeDragRequests.values()].some(request => sftpNativeDragRequestIsActive(request));
  return internalActive || handoffActive || nativeActive;
}

function clearStaleSftpInternalDragForExternalDrop(dataTransfer) {
  if (sftpDataTransferHasInternalPayload(dataTransfer) || !sftpDataTransferHasFiles(dataTransfer)) return;
  clearSftpInternalDragHandoff();
  if (!sftpInternalDrag) return;
  if ([...sftpNativeDragRequests.values()].some(request => sftpNativeDragRequestIsActive(request))) return;
  resetSftpItemDrag(sftpInternalDrag.row);
}

function suppressSftpOwnDrop(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (!sftpOwnDragActive(event?.dataTransfer)) return false;
  cancelSftpDropLeaveClear();
  event.preventDefault();
  event.stopPropagation?.();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  sftpDropDepth = 0;
  setSftpExternalDropState(false, {tabKey});
  return true;
}

function handleSftpOwnDragOver(event, enter=false, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  const drag = activeSftpDragPayload(event?.dataTransfer);
  if (!drag) return false;
  markSftpDragInsideWindow();
  event.preventDefault();
  event.stopPropagation?.();
  const target = activeSftpCrossDropTarget(drag, tabKey);
  if (event.dataTransfer) event.dataTransfer.dropEffect = target ? "copy" : "none";
  if (target) {
    if (enter) sftpDropDepth = 1;
    const state = sftpTabRuntimes.get(tabKey)?.state;
    const directory = Number(state?.connectionId) === Number(target.id) ? state.path : target.path || ".";
    setSftpExternalDropState(true, {title:tr("sftp:transfer.drop_copy_to", {target:target.title}), path:directory, tabKey});
  } else {
    sftpDropDepth = 0;
    setSftpExternalDropState(false, {keepHint:true, tabKey});
    showSftpDragHint(sftpDragSourceHint(), false, "", tabKey);
  }
  return true;
}

function handleLocalFileDragOverSftp(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  const payload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event?.dataTransfer) : null;
  const target = typeof workspaceTabByKey === "function"
    ? workspaceTabByKey(tabKey)
    : tabs.find(tab => tab.key === tabKey);
  if (!payload || target?.kind !== "sftp") return false;
  event.preventDefault();
  event.stopPropagation?.();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  setSftpExternalDropState(true, {title:tr("sftp:transfer.drop_upload_to", {target:target.title}), path:runtime?.state.path || target.path || ".", tabKey});
  return true;
}

function handleSftpDragEnter(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  noteSftpDragFeedbackActivity();
  if (handleLocalFileDragOverSftp(event, tabKey)) return;
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  const insideTransition = sftpDragTransitionStaysInside(event);
  if (handleSftpOwnDragOver(event, !insideTransition, tabKey)) return;
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event, tabKey);
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  if (!insideTransition) sftpDropDepth = 1;
  setSftpExternalDropState(true, {tabKey});
}

function handleSftpDragOver(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  noteSftpDragFeedbackActivity();
  if (handleLocalFileDragOverSftp(event, tabKey)) return;
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  if (handleSftpOwnDragOver(event, false, tabKey)) return;
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event, tabKey);
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setSftpExternalDropState(true, {tabKey});
}

function handleSftpDragLeave(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (sftpDragTransitionStaysInside(event)) return;
  if (activeSftpDragPayload(event.dataTransfer)) {
    sftpDropDepth = 0;
    scheduleSftpDropLeaveClear({keepHint:true, tabKey});
    return;
  }
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event, tabKey);
  const shell = event.currentTarget;
  const overlay = sftpElement("sftpDropOverlay", tabKey);
  if (!sftpDataTransferHasFiles(event.dataTransfer) && !shell?.classList?.contains("is-drag-over") && overlay?.hidden !== false) return;
  sftpDropDepth = 0;
  scheduleSftpDropLeaveClear({tabKey});
}

async function handleSftpDrop(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event?.dataTransfer) : null;
  if (localPayload) {
    event.preventDefault();
    event.stopPropagation?.();
    setSftpExternalDropState(false, {tabKey});
    const target = typeof workspaceTabByKey === "function"
      ? workspaceTabByKey(tabKey)
      : tabs.find(tab => tab.key === tabKey);
    try {
      if (target?.kind === "sftp" && typeof uploadLocalFilesToSftp === "function") await uploadLocalFilesToSftp(localPayload, target, tabKey);
    } catch (error) {
      notify(error.message || tr("sftp:transfer.upload_local_failed"), "error");
    }
    return;
  }
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  const drag = activeSftpDragPayload(event.dataTransfer);
  if (drag) {
    event.preventDefault();
    event.stopPropagation?.();
    const target = activeSftpCrossDropTarget(drag, tabKey);
    cancelSftpDropLeaveClear();
    sftpDropDepth = 0;
    setSftpExternalDropState(false, {tabKey});
    if (target) await copySftpDraggedItemsToTarget(drag, target);
    else finishSftpDragPayload(drag);
    return;
  }
  if (suppressSftpOwnDrop(event, tabKey)) return;
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  cancelSftpDropLeaveClear();
  sftpDropDepth = 0;
  setSftpExternalDropState(false, {tabKey});
  try {
    const files = await collectDroppedFiles(event.dataTransfer);
    if (!files.length) throw new Error(tr("sftp:transfer.no_upload_files"));
    await uploadSftpFiles(files, tabKey);
  } catch (error) {
    notify(error.message || tr("sftp:transfer.read_drop_failed"), "error");
  }
}

async function createRemoteUploadDirectories(connectionId, root, files) {
  const directories = new Set();
  for (const item of files) {
    const parts = normalizeDroppedRelativePath(item.relativePath, item.file.name).split("/");
    parts.pop();
    let current = String(root || ".");
    for (const part of parts) {
      current = joinRemotePath(current, part);
      directories.add(current);
    }
  }
  for (const directory of directories) {
    await api(`/api/connections/${connectionId}/sftp/mkdir`, {method:"POST", body:JSON.stringify({path:directory})}).catch(error => {
      if (!/exist|存在/i.test(String(error?.message || ""))) throw error;
    });
  }
}

async function chooseSftpUploadConflict(collisions) {
  if (!collisions.length) return "error";
  const preview = collisions.slice(0, 6).map(item => item.name || item.filename || tr("sftp:transfer.unnamed_item")).join("\n");
  const extra = collisions.length > 6 ? `\n${tr("sftp:transfer.same_name_extra", {count:collisions.length})}` : "";
  return chooseModal(tr("sftp:transfer.same_name_title"), `${preview}${extra}\n\n${tr("sftp:transfer.choose_upload_behavior")}`, [
    {label:tr("sftp:transfer.overwrite_same_name"), value:"overwrite", className:"danger"},
    {label:tr("sftp:transfer.auto_rename"), value:"rename"},
    {label:tr("sftp:transfer.cancel_upload"), value:""}
  ]);
}

async function uploadSftpFilesToDirectory(inputFiles, connectionId, root=".", options={}) {
  const tabKey = String(options.tabKey || "");
  const files = inputFiles.map(item => item?.file ? item : ({file:item, relativePath:item?.webkitRelativePath || item?.name}))
    .filter(item => item.file).map(item => ({...item, relativePath:normalizeDroppedRelativePath(item.relativePath, item.file.name)}));
  if (!files.length) return;
  const directory = String(root || ".");
  await createRemoteUploadDirectories(Number(connectionId), directory, files);
  const groups = new Map();
  for (const item of files) {
    const parts = item.relativePath.split("/");
    const filename = parts.pop() || item.file.name;
    const targetDirectory = parts.length ? joinRemotePath(directory, parts.join("/")) : directory;
    if (!groups.has(targetDirectory)) groups.set(targetDirectory, []);
    groups.get(targetDirectory).push({...item, filename, directory:targetDirectory});
  }
  const collisions = [];
  for (const [targetDirectory, items] of groups) {
    for (let offset = 0; offset < items.length; offset += 200) {
      const plan = await api(`/api/connections/${Number(connectionId)}/sftp/upload-plan`, {
        method:"POST",
        body:JSON.stringify({path:targetDirectory, filenames:items.slice(offset, offset + 200).map(item => item.filename)})
      });
      for (const item of plan.items || []) if (item.exists) collisions.push(item);
    }
  }
  const conflict = options.conflict || await chooseSftpUploadConflict(collisions);
  if (collisions.length && !conflict) return;
  try {
    let nextIndex = 0;
    let firstError = null;
    const uploadOne = async item => {
      const parts = item.relativePath.split("/");
      const filename = parts.pop() || item.file.name;
      const targetDirectory = parts.length ? joinRemotePath(directory, parts.join("/")) : directory;
      const started = await api(`/api/connections/${Number(connectionId)}/sftp/upload-job`, {
        method:"POST",
        body:JSON.stringify({
          path:targetDirectory,
          filename,
          conflict:conflict || "error",
          size:Number(item.file.size || 0),
          private:options.private === true
        })
      });
      trackSftpMutationJob(started);
      await refreshSftpJobs();
      startSftpJobsTimer();
      try {
        const job = await uploadWithProgress(`/api/sftp/jobs/${encodeURIComponent(started.id)}/content`, item.file, started);
        trackSftpMutationJob(job);
      } catch (error) {
        const latest = await refreshSftpJobs();
        const state = latest.find(job => String(job.id) === String(started.id));
        if (error?.cancelled || state?.status === "cancelled") return;
        throw error;
      }
    };
    const concurrency = Math.max(1, Math.min(8, Number(runtimeSettings?.saved?.sftp_upload_concurrency || 3)));
    const workers = Array.from({length:Math.min(concurrency, files.length)}, async () => {
      while (!firstError) {
        const index = nextIndex++;
        if (index >= files.length) return;
        try { await uploadOne(files[index]); }
        catch (error) { firstError = error; }
      }
    });
    await Promise.all(workers);
    if (firstError) throw firstError;
  } finally {
    const input = sftpElement("sftpUpload", tabKey);
    if (input) input.value = "";
    refreshSftpJobs();
  }
}

async function uploadSftpFiles(inputFiles, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey && item.kind === "sftp");
  if (!tab) return;
  const root = runtime?.state.path || tab.path || ".";
  return uploadSftpFilesToDirectory(inputFiles, tab.id, root, {tabKey});
}

async function uploadSftpFile(tabKey=activeTabKey) {
  const input = sftpElement("sftpUpload", tabKey);
  const files = [...(input?.files || [])].map(file => ({file, relativePath:file.webkitRelativePath || file.name}));
  if (!files.length) return;
  try {
    await uploadSftpFiles(files, tabKey);
  } catch (error) {
    notify(error.message || tr("sftp:transfer.upload_failed"), "error");
  }
}

function uploadCancelledError() {
  const error = new Error(tr("sftp:transfer.upload_cancelled"));
  error.cancelled = true;
  return error;
}

function updateUploadReceiveProgress(job, loaded, total) {
  const id = String(job?.id || "");
  if (!id) return;
  const existing = sftpLatestJobs.find(item => String(item.id) === id);
  if (!existing || existing.status !== "running" || existing.phase !== "receiving") return;
  existing.size = Math.max(0, Number(total || existing.size || 0));
  existing.transferred = Math.max(0, Number(loaded || 0));
  existing.received_bytes = existing.transferred;
  existing.size_known = true;
  existing.progress_known = true;
  existing.two_stage_upload = true;
  existing.progress = existing.size ? Math.min(50, Math.round(existing.transferred / existing.size * 50)) : 50;
  updateSftpTaskCenter(sftpLatestJobs);
}

function uploadWithProgress(url, body, job) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const id = String(job?.id || "");
    const request = {xhr, cancelled:false};
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (sftpUploadRequests.get(id) === request) sftpUploadRequests.delete(id);
      callback();
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    sftpUploadRequests.set(id, request);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) updateUploadReceiveProgress(job, event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return finish(() => resolve(JSON.parse(xhr.responseText || "{}")));
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (data.status === "cancelled") return finish(() => reject(uploadCancelledError()));
        finish(() => reject(new Error(data.error || xhr.statusText || tr("sftp:transfer.upload_failed"))));
      } catch {
        finish(() => reject(new Error(xhr.responseText || xhr.statusText || tr("sftp:transfer.upload_failed"))));
      }
    };
    xhr.onerror = () => finish(() => reject(request.cancelled ? uploadCancelledError() : new Error(tr("sftp:transfer.upload_connection_failed"))));
    xhr.onabort = () => finish(() => reject(uploadCancelledError()));
    xhr.ontimeout = () => finish(() => reject(new Error(tr("sftp:transfer.upload_timeout"))));
    xhr.send(body);
  });
}

function formatBytes(size) {
  const n = Number(size || 0);
  if (n >= 1024 ** 5) return `${(n / 1024 ** 5).toFixed(1)} PB`;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
