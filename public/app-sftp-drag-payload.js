function sftpDragEntriesForPath(path, name, type, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const selected = selectedSftpEntries(tabKey);
  if (selected.some(item => item.path === path)) return selected;
  const listed = (runtime?.state.entries || []).find(item => joinRemotePath(runtime.state.path, item.name) === path);
  return [{
    path,
    name,
    type,
    size:Math.max(0, Number(listed?.size || 0)),
    mtime:Math.max(0, Number(listed?.mtime || 0)),
    metadataKnown:Boolean(listed)
  }];
}

function selectSftpDragSource(path, name, type, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const id = Number(runtime?.state.connectionId || 0);
  const selected = selectedSftpEntries(tabKey);
  if (typeof selectSftpEntry === "function") {
    selectSftpEntry(selected.some(item => item.path === path) ? {preserveSelection:true} : {forceSingle:true}, id, path, name, type, tabKey);
  }
  return sftpDragEntriesForPath(path, name, type, tabKey);
}

function sftpNativeDragKey(connectionId, entries) {
  const paths = [...new Set(entries.map(item => String(item.path || "")).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return `${Number(connectionId)}\0${paths.join("\0")}`;
}

function sftpExternalDragMode() {
  const mode = window.termaDesktop?.capabilities?.sftpExternalDrag;
  if ((mode === "staged" || mode === "streaming") && typeof window.termaDesktop?.startSftpDrag === "function") return mode;
  return false;
}

function sftpNativeDragStartTiming() {
  return window.termaDesktop?.capabilities?.sftpNativeDragStart === "pointerdown"
    ? "pointerdown"
    : "leave-window";
}

function sftpNativeDragFallbackInfo() {
  const capabilities = window.termaDesktop?.capabilities;
  if (capabilities?.platform !== "linux" || capabilities?.sftpExternalDrag !== "staged") return null;
  const reason = String(capabilities.sftpNativeDragReason || "").trim();
  const normalizedReason = reason.toLowerCase();
  let reasonText = reason || "系统缺少 FUSE3 运行环境";
  let action = "请检查系统 FUSE3 运行环境后重启 Terma";
  if (normalizedReason.includes("/dev/fuse is unavailable")) {
    reasonText = "系统没有提供 /dev/fuse";
    action = "请安装 FUSE3 并启用 FUSE 内核设备；容器或沙箱中还需向应用开放 /dev/fuse";
  } else if (normalizedReason.includes("cannot access /dev/fuse")) {
    reasonText = "当前用户无权访问 /dev/fuse";
    action = "请按当前发行版的方式授予 FUSE 设备访问权限，重新登录后再启动 Terma";
  } else if (normalizedReason.includes("fusermount3 is unavailable")) {
    reasonText = "系统没有安装 FUSE3（fusermount3）";
    action = "请安装 fuse3 运行包后重启 Terma";
  } else if (normalizedReason.includes("runtime directory cannot be prepared")) {
    reasonText = "当前用户的运行目录不可写";
    action = "请检查 XDG_RUNTIME_DIR 权限后重启 Terma";
  } else if (normalizedReason.includes("辅助程序尚未安装")) {
    reasonText = "安装包中缺少 Linux 拖出组件";
    action = "请重新安装完整的 Terma 桌面版";
  }
  return {
    reason:reasonText,
    action,
    hint:"Linux 当前使用兼容拖出；跨主机可直接拖动，保存到本机需准备完成后再拖一次"
  };
}

function showSftpNativeDragFallbackNotice() {
  const fallback = sftpNativeDragFallbackInfo();
  if (!fallback || sftpNativeDragFallbackNoticeShown) return;
  sftpNativeDragFallbackNoticeShown = true;
  notify(
    `Linux 一次拖出当前不可用\n${fallback.reason}。${fallback.action}。当前仍可使用兼容拖出，准备完成后再拖一次即可。`,
    "info"
  );
}

function sftpDragSourceHint() {
  const mode = sftpExternalDragMode();
  const fallback = sftpNativeDragFallbackInfo();
  if (fallback) return fallback.hint;
  if (mode === "streaming") return "拖到其他 SFTP 标签可跨主机复制；拖出窗口可直接保存到本机";
  if (mode === "staged") return "拖到其他 SFTP 标签可跨主机复制；拖出窗口可准备下载到本机";
  return "Web 版仅支持拖到其他 SFTP 标签跨主机复制；保存到本机请使用“下载”";
}

function cleanupSftpNativeDragCache(now=Date.now()) {
  for (const [key, cached] of sftpNativeDragCache) {
    if (!cached.promise && now - Number(cached.createdAt || 0) > SFTP_NATIVE_DRAG_CACHE_TTL_MS) {
      sftpNativeDragCache.delete(key);
      sftpNativeDragArmed.delete(key);
    }
  }
}

function stageSftpNativeDrag(connectionId, entries) {
  cleanupSftpNativeDragCache();
  const key = sftpNativeDragKey(connectionId, entries);
  const cached = sftpNativeDragCache.get(key);
  if (cached?.files?.length && Date.now() - Number(cached.createdAt || 0) <= SFTP_NATIVE_DRAG_CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }
  if (cached?.promise) return cached.promise;
  const request = api(`/api/connections/${connectionId}/sftp/stage-drag`, {
    method:"POST",
    body:JSON.stringify({paths:entries.map(item => item.path)})
  }).then(staged => {
    const result = {files:Array.isArray(staged.files) ? staged.files : [], createdAt:Date.now(), promise:null};
    if (!result.files.length) throw new Error("没有可拖出的文件");
    sftpNativeDragCache.set(key, result);
    return result;
  }).catch(error => {
    sftpNativeDragCache.delete(key);
    throw error;
  });
  sftpNativeDragCache.set(key, {files:[], createdAt:0, promise:request});
  return request;
}

function cachedSftpNativeDrag(connectionId, entries) {
  cleanupSftpNativeDragCache();
  const key = sftpNativeDragKey(connectionId, entries);
  const cached = sftpNativeDragCache.get(key);
  return cached?.files?.length && Date.now() - Number(cached.createdAt || 0) <= SFTP_NATIVE_DRAG_CACHE_TTL_MS ? cached : null;
}

function sftpNativeDragRequestIsActive(request, now=Date.now()) {
  return Boolean(
    request
    && !request.released
    && (request.activated || request.nativeStarted)
    && now - Number(request.lastActivityAt || request.createdAt || now) <= SFTP_NATIVE_DRAG_ACTIVE_TTL_MS
  );
}

function sftpDataTransferTypes(dataTransfer) {
  return Array.from(dataTransfer?.types || []).map(type => String(type || "").toLowerCase());
}

function sftpDataTransferHasInternalPayload(dataTransfer) {
  return sftpDataTransferTypes(dataTransfer).includes(SFTP_INTERNAL_DRAG_MIME);
}

function normalizeSftpDragPayloadEntry(item, fallbackPath="") {
  const path = String(item?.path || fallbackPath || "");
  if (!path) return null;
  const cleanPath = path.replace(/\/+$/, "");
  const fallbackName = cleanPath.split("/").pop() || path;
  return {
    path,
    name:String(item?.name || fallbackName),
    type:String(item?.type || "file"),
    size:Math.max(0, Number(item?.size || 0)),
    mtime:Math.max(0, Number(item?.mtime || 0)),
    metadataKnown:Boolean(item?.metadataKnown)
  };
}

function serializeSftpDragPayload(connectionId, entries, sourceTabKey="") {
  return JSON.stringify({
    connectionId:Number(connectionId),
    sourceTabKey:String(sourceTabKey || ""),
    entries:(entries || []).map(item => normalizeSftpDragPayloadEntry(item)).filter(Boolean)
  });
}

function readSftpDragPayload(dataTransfer) {
  if (!sftpDataTransferHasInternalPayload(dataTransfer) || typeof dataTransfer?.getData !== "function") return null;
  try {
    const raw = dataTransfer.getData(SFTP_INTERNAL_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const connectionId = Number(parsed?.connectionId);
    const sourceEntries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : (Array.isArray(parsed?.paths) ? parsed.paths.map(path => ({path})) : []);
    const entries = sourceEntries.map(item => normalizeSftpDragPayloadEntry(item, item?.path || item)).filter(Boolean);
    if (!Number.isInteger(connectionId) || connectionId <= 0 || !entries.length) return null;
    return {
      connectionId,
      entries,
      sourceTabKey:String(parsed?.sourceTabKey || ""),
      row:null,
      restoredFromDataTransfer:true
    };
  } catch {
    return null;
  }
}

function currentSftpInternalDragHandoff(now=Date.now()) {
  if (!sftpInternalDragHandoff) return null;
  if (Number(sftpInternalDragHandoff.expiresAt || 0) > now) return sftpInternalDragHandoff;
  sftpInternalDragHandoff = null;
  return null;
}

function rememberSftpInternalDragHandoff(drag) {
  if (!drag || !Array.isArray(drag.entries) || !drag.entries.length) return null;
  const handoff = {
    connectionId:Number(drag.connectionId),
    entries:drag.entries.map(item => normalizeSftpDragPayloadEntry(item)).filter(Boolean),
    sourceTabKey:String(drag.sourceTabKey || ""),
    row:null,
    handedOffAt:Date.now(),
    expiresAt:Date.now() + SFTP_INTERNAL_DRAG_HANDOFF_TTL_MS
  };
  if (!Number.isInteger(handoff.connectionId) || handoff.connectionId <= 0 || !handoff.entries.length) return null;
  sftpInternalDragHandoff = handoff;
  setTimeout(() => {
    if (sftpInternalDragHandoff === handoff && Number(handoff.expiresAt || 0) <= Date.now()) {
      sftpInternalDragHandoff = null;
      setSftpExternalDropState(false);
    }
  }, SFTP_INTERNAL_DRAG_HANDOFF_TTL_MS + 50);
  return handoff;
}

function clearSftpInternalDragHandoff() {
  sftpInternalDragHandoff = null;
}

function activeSftpDragPayload(dataTransfer=null) {
  if (sftpInternalDrag && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))) return sftpInternalDrag;
  const handoff = currentSftpInternalDragHandoff();
  if (handoff && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))) return handoff;
  if (dataTransfer && sftpDataTransferHasInternalPayload(dataTransfer)) {
    const restored = readSftpDragPayload(dataTransfer);
    if (restored) return restored;
  }
  const requests = [...sftpNativeDragRequests.values()];
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (!sftpNativeDragRequestIsActive(request)) continue;
    if (Number.isInteger(Number(request?.connectionId)) && Array.isArray(request?.entries) && request.entries.length) return request;
  }
  return null;
}

function activeSftpCrossDropTarget(drag=activeSftpDragPayload(), tabKey=activeTabKey) {
  const target = tabs.find(tab => tab.key === tabKey);
  if (!drag || target?.kind !== "sftp" || String(target.key || "") === String(drag.sourceTabKey || "")) return null;
  return target;
}
