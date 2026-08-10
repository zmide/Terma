function cacheManagementPanelHtml() {
  const data = programCacheSettings || {};
  const categories = data.categories || {};
  const categoryLabels = {
    sftp_downloads:"SFTP 下载",
    sftp_uploads:"SFTP 上传",
    sftp_drag:"SFTP 拖出",
    updates:"更新安装包",
    remote_components:"组件安装残留",
    local_installers:"本机组件安装包"
  };
  const retainedBytes = Number(data.retained_bytes || 0);
  const rows = Object.entries(categoryLabels).map(([id, label]) => {
    const item = categories[id] || {};
    const reclaimable = Number(item.reclaimable_bytes || 0);
    return `<div class="cache-category-row">
      <div><strong>${esc(label)}</strong><span>${formatBytes(Number(item.bytes || 0))}${item.busy ? " · 使用中" : ""}</span></div>
      <button class="icon-button danger" type="button" data-action="cache-clear-category" data-cache-category="${escAttr(id)}" title="清理${escAttr(label)}" aria-label="清理${escAttr(label)}" ${reclaimable > 0 ? "" : "disabled"}>${icon("trash-2")}</button>
    </div>`;
  }).join("");
  return `<section id="cacheManagementPanel">
    <div class="settings-kv"><span>当前缓存</span><strong>${esc(formatBytes(Number(data.bytes || 0)))}</strong></div>
    <div class="cache-category-list">${rows}</div>
    <div class="muted">可清理 ${formatBytes(Number(data.reclaimable_bytes || 0))}${retainedBytes > 0 ? ` · 暂时保留 ${formatBytes(retainedBytes)}` : ""}。正在生成、传输、暂停、安装或失败待续传的文件会保留。</div>
    <div class="actions"><button type="button" data-action="cache-refresh">${icon("refresh-cw")}<span>刷新占用</span></button><button id="clearProgramCacheButton" class="danger" type="button" data-action="cache-clear-all" ${Number(data.reclaimable_bytes || 0) > 0 ? "" : "disabled"}>${icon("trash-2")}<span>清理全部</span></button></div>
  </section>`;
}

async function loadProgramCacheSettings() {
  programCacheSettings = await api("/api/cache");
  return programCacheSettings;
}

function renderCacheManagementPanel() {
  const current = $("cacheManagementPanel");
  if (!current) return;
  const host = document.createElement("div");
  host.innerHTML = cacheManagementPanelHtml();
  current.replaceWith(host.firstElementChild);
}

async function refreshProgramCacheSettings() {
  const inPane = captureSettingsPane();
  try { await loadProgramCacheSettings(); inPane(renderCacheManagementPanel); }
  catch (error) { notify(error.message || "缓存占用读取失败", "error"); }
}

async function clearProgramCache(category="", triggerButton=null) {
  const inPane = captureSettingsPane();
  const label = category
    ? triggerButton?.closest?.(".cache-category-row")?.querySelector?.("strong")?.textContent || "此分类"
    : "全部程序缓存";
  if (!await confirmModal(`清理${label}？正在生成、传输、暂停、安装或失败待续传的文件不会删除。`, "清理程序缓存", "清理缓存", "取消", true)) return;
  const button = triggerButton || $("clearProgramCacheButton");
  try {
    setButtonBusy(button, true, "清理中");
    const suffix = category ? `?category=${encodeURIComponent(category)}` : "";
    programCacheSettings = await api(`/api/cache${suffix}`, {method:"DELETE"});
    if (!category || category.startsWith("sftp_")) {
      if (typeof sftpDirectoryViewCache !== "undefined") sftpDirectoryViewCache.clear();
      if (typeof sftpDirectorySizeCache !== "undefined") sftpDirectorySizeCache.clear();
      if (typeof sftpNativeDragCache !== "undefined") sftpNativeDragCache.clear();
    }
    inPane(renderCacheManagementPanel);
    notify(`${label}已清理`, "success");
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || "缓存清理失败", "error");
  }
}
