function cacheManagementPanelHtml() {
  const data = programCacheSettings || {};
  const categories = data.categories || {};
  const categoryLabels = {
    sftp_downloads:tr("settings:auto.cache_sftp_download", {defaultValue:"SFTP 下载"}),
    sftp_uploads:tr("settings:auto.cache_sftp_upload", {defaultValue:"SFTP 上传"}),
    sftp_drag:tr("settings:auto.cache_sftp_drag", {defaultValue:"SFTP 拖出"}),
    updates:tr("settings:auto.cache_update_packages", {defaultValue:"更新安装包"}),
    remote_components:tr("settings:auto.cache_component_residue", {defaultValue:"组件安装残留"}),
    local_installers:tr("settings:auto.cache_component_packages", {defaultValue:"本机组件安装包"})
  };
  const retainedBytes = Number(data.retained_bytes || 0);
  const rows = Object.entries(categoryLabels).map(([id, label]) => {
    const item = categories[id] || {};
    const reclaimable = Number(item.reclaimable_bytes || 0);
    const clearLabel = tr("settings:auto.cache_clear_category", {label, defaultValue:`清理${label}`});
    return `<div class="cache-category-row">
      <div><strong>${esc(label)}</strong><span>${formatBytes(Number(item.bytes || 0))}${item.busy ? ` · ${esc(tr("settings:auto.cache_in_use", {defaultValue:"使用中"}))}` : ""}</span></div>
      <button class="icon-button danger" type="button" data-action="cache-clear-category" data-cache-category="${escAttr(id)}" title="${escAttr(clearLabel)}" aria-label="${escAttr(clearLabel)}" ${reclaimable > 0 ? "" : "disabled"}>${icon("trash-2")}</button>
    </div>`;
  }).join("");
  const retained = retainedBytes > 0 ? tr("settings:auto.cache_retained", {bytes:formatBytes(retainedBytes), defaultValue:` · 暂时保留 ${formatBytes(retainedBytes)}`}) : "";
  return `<section id="cacheManagementPanel">
    <div class="settings-kv"><span>${esc(tr("settings:auto.current_cache", {defaultValue:"当前缓存"}))}</span><strong>${esc(formatBytes(Number(data.bytes || 0)))}</strong></div>
    <div class="cache-category-list">${rows}</div>
    <div class="muted">${esc(tr("settings:auto.cache_reclaimable", {bytes:formatBytes(Number(data.reclaimable_bytes || 0)), defaultValue:`可清理 ${formatBytes(Number(data.reclaimable_bytes || 0))}。正在生成、传输、暂停、安装或失败待续传的文件会保留。`}))}${esc(retained)}</div>
    <div class="actions"><button type="button" data-action="cache-refresh">${icon("refresh-cw")}<span>${esc(tr("settings:auto.refresh_usage", {defaultValue:"刷新占用"}))}</span></button><button id="clearProgramCacheButton" class="danger" type="button" data-action="cache-clear-all" ${Number(data.reclaimable_bytes || 0) > 0 ? "" : "disabled"}>${icon("trash-2")}<span>${esc(tr("settings:auto.clear_all", {defaultValue:"清理全部"}))}</span></button></div>
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
  catch (error) { notify(error.message || tr("settings:auto.cache_usage_failed", {defaultValue:"缓存占用读取失败"}), "error"); }
}

async function clearProgramCache(category="", triggerButton=null) {
  const inPane = captureSettingsPane();
  const label = category
    ? triggerButton?.closest?.(".cache-category-row")?.querySelector?.("strong")?.textContent || tr("settings:auto.cache_category", {defaultValue:"此分类"})
    : tr("settings:auto.cache_all", {defaultValue:"全部程序缓存"});
  const message = tr("settings:auto.cache_clear_confirm", {label, defaultValue:`清理${label}？正在生成、传输、暂停、安装或失败待续传的文件不会删除。`});
  if (!await confirmModal(message, tr("settings:auto.cache_cleanup", {defaultValue:"清理程序缓存"}), tr("settings:auto.cache_clear", {defaultValue:"清理缓存"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
  const button = triggerButton || $("clearProgramCacheButton");
  try {
    setButtonBusy(button, true, tr("settings:auto.cache_clearing", {defaultValue:"清理中"}));
    const suffix = category ? `?category=${encodeURIComponent(category)}` : "";
    programCacheSettings = await api(`/api/cache${suffix}`, {method:"DELETE"});
    if (!category || category.startsWith("sftp_")) {
      if (typeof sftpDirectoryViewCache !== "undefined") sftpDirectoryViewCache.clear();
      if (typeof sftpDirectorySizeCache !== "undefined") sftpDirectorySizeCache.clear();
      if (typeof sftpNativeDragCache !== "undefined") sftpNativeDragCache.clear();
    }
    inPane(renderCacheManagementPanel);
    notify(tr("common:notifications.cache_cleared", {name:label, defaultValue:`${label}已清理`}), "success");
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || tr("settings:auto.cache_failed", {defaultValue:"缓存清理失败"}), "error");
  }
}
