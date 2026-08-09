function cacheManagementPanelHtml() {
  const data = programCacheSettings || {};
  const categories = data.categories || {};
  const downloads = categories.sftp_downloads || {};
  const uploads = categories.sftp_uploads || {};
  const drag = categories.sftp_drag || {};
  const updates = categories.updates || {};
  const retainedBytes = Number(data.retained_bytes || 0);
  return `<section id="cacheManagementPanel">
    <h3>缓存管理</h3>
    <div class="settings-kv"><span>当前缓存</span><strong>${esc(formatBytes(Number(data.bytes || 0)))}</strong></div>
    <div class="muted">SFTP 下载 ${formatBytes(Number(downloads.bytes || 0))} · SFTP 上传 ${formatBytes(Number(uploads.bytes || 0))} · SFTP 拖出 ${formatBytes(Number(drag.bytes || 0))} · 更新文件 ${formatBytes(Number(updates.bytes || 0))}</div>
    <div class="muted">可清理 ${formatBytes(Number(data.reclaimable_bytes || 0))}${retainedBytes > 0 ? ` · 暂时保留 ${formatBytes(retainedBytes)}` : ""}。正在生成、传输、暂停或失败待续传的文件会保留。</div>
    <div class="actions"><button type="button" onclick="refreshProgramCacheSettings()">${icon("refresh-cw")}<span>刷新占用</span></button><button id="clearProgramCacheButton" class="danger" type="button" onclick="clearProgramCache()" ${Number(data.reclaimable_bytes || 0) > 0 ? "" : "disabled"}>${icon("trash-2")}<span>清理缓存</span></button></div>
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

async function clearProgramCache() {
  const inPane = captureSettingsPane();
  if (!await confirmModal("清理可重新生成的程序缓存？正在传输、暂停或失败待续传的文件不会删除。", "清理程序缓存", "清理缓存", "取消", true)) return;
  const button = $("clearProgramCacheButton");
  try {
    setButtonBusy(button, true, "清理中");
    programCacheSettings = await api("/api/cache", {method:"DELETE"});
    if (typeof sftpDirectoryViewCache !== "undefined") sftpDirectoryViewCache.clear();
    if (typeof sftpDirectorySizeCache !== "undefined") sftpDirectorySizeCache.clear();
    if (typeof sftpNativeDragCache !== "undefined") sftpNativeDragCache.clear();
    inPane(renderCacheManagementPanel);
    notify("程序缓存已清理", "success");
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || "缓存清理失败", "error");
  }
}

async function saveSftpGlobalSettings() {
  const recycle = $("sftpRecycleBinEnabled");
  const sizeInput = $("sftpMaxOpenFileSizeMb");
  const button = $("sftpGlobalSettingsSave");
  if (!recycle || !sizeInput || !button) return;
  const maximumSize = Number(sizeInput.value);
  if (!Number.isInteger(maximumSize) || maximumSize < 1 || maximumSize > 100) return notify("SFTP 文件打开上限必须是 1-100 MB 的整数", "error");
  setButtonBusy(button, true, "保存中");
  try {
    if (window.termaDesktop && $("sftpExternalEditorMode")) {
      localStorage.setItem("sftpExternalEditorMode", $("sftpExternalEditorMode").value);
      localStorage.setItem("sftpExternalEditorPath", $("sftpExternalEditorPath")?.value.trim() || "");
      localStorage.setItem("sftpExternalEditorArgs", $("sftpExternalEditorArgs")?.value.trim() || "");
    }
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({
        sftp_recycle_bin_enabled:recycle.checked,
        sftp_max_open_file_size_mb:maximumSize,
        ...(sftpDownloadSettings?.delivery_mode === "desktop" ? {sftp_download_directory:$('sftpDownloadDirectory')?.value.trim() || ""} : {})
      })
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    recycle.checked = runtimeSettings.saved.sftp_recycle_bin_enabled;
    sizeInput.value = runtimeSettings.saved.sftp_max_open_file_size_mb;
    if (sftpDownloadSettings?.delivery_mode === "desktop") {
      sftpDownloadSettings = await api("/api/sftp/download-settings");
      if ($('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = sftpDownloadSettings.configured_directory || "";
      if ($('sftpDownloadDirectoryEffective')) $('sftpDownloadDirectoryEffective').textContent = `当前保存到：${sftpDownloadSettings.effective_directory || "系统下载目录"}`;
    }
    notify("SFTP 全局设置已保存", "success");
  } catch (error) {
    recycle.checked = runtimeSettings?.saved?.sftp_recycle_bin_enabled === true;
    sizeInput.value = runtimeSettings?.saved?.sftp_max_open_file_size_mb || 5;
    notify(error.message || "SFTP 全局设置保存失败", "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function showSftpGlobalSettings() {
  if (!runtimeSettings) await loadRuntimeSettings();
  sftpDownloadSettings = await api("/api/sftp/download-settings").catch(() => ({delivery_mode:"browser"}));
  const saved = runtimeSettings?.saved || {};
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card sftp-global-settings-modal" role="dialog" aria-modal="true" aria-labelledby="sftpGlobalSettingsTitle">
    <div class="sftp-modal-head"><div><h2 id="sftpGlobalSettingsTitle">SFTP 全局设置</h2><span>应用到所有 SFTP 标签和连接</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeSftpGlobalSettings()">${icon("x")}</button></div>
    <label class="check-row"><input id="sftpRecycleBinEnabled" type="checkbox" ${saved.sftp_recycle_bin_enabled ? "checked" : ""}> 删除远程文件时先移入回收站</label>
    <div class="muted">默认关闭。开启后，每台远端服务器会在当前 SSH 用户主目录创建 Terma 专用隐藏目录；关闭只影响之后的删除，不会自动清空已有内容。</div>
    <label>可在程序中打开的最大文件（MB）</label>
    <input id="sftpMaxOpenFileSizeMb" type="number" min="1" max="100" step="1" value="${Number(saved.sftp_max_open_file_size_mb || 5)}">
    <div class="muted">适用于在线文本编辑和图片预览，范围 1-100 MB。更大的文件仍可正常下载。</div>
    ${sftpDownloadSettings.delivery_mode === "desktop" ? `<label>SFTP 自动保存目录</label>
    <div class="upload-line"><input id="sftpDownloadDirectory" value="${escAttr(sftpDownloadSettings.configured_directory || "")}" placeholder="留空时使用系统下载目录"><button type="button" onclick="chooseSftpDownloadDirectory()">${icon("folder-open")}<span>选择目录</span></button></div>
    <div id="sftpDownloadDirectoryEffective" class="muted">当前保存到：${esc(sftpDownloadSettings.effective_directory || sftpDownloadSettings.default_directory || "系统下载目录")}</div>
    <div class="actions compact"><button type="button" onclick="useDefaultSftpDownloadDirectory()">恢复系统默认</button><button type="button" onclick="openSftpDownloadDirectory()">${icon("folder-open")}<span>打开目录</span></button></div>
    <label>外部编辑器</label><select id="sftpExternalEditorMode" onchange="toggleSftpExternalEditorFields()"><option value="system" ${localStorage.getItem("sftpExternalEditorMode") !== "vscode" && localStorage.getItem("sftpExternalEditorMode") !== "custom" ? "selected" : ""}>系统关联程序</option><option value="vscode" ${localStorage.getItem("sftpExternalEditorMode") === "vscode" ? "selected" : ""}>VS Code</option><option value="custom" ${localStorage.getItem("sftpExternalEditorMode") === "custom" ? "selected" : ""}>自定义程序</option></select>
    <div id="sftpExternalEditorCustom"><label>程序路径</label><input id="sftpExternalEditorPath" value="${escAttr(localStorage.getItem("sftpExternalEditorPath") || "")}" placeholder="编辑器可执行文件绝对路径"><label>启动参数</label><input id="sftpExternalEditorArgs" value="${escAttr(localStorage.getItem("sftpExternalEditorArgs") || "")}" placeholder="可选；用 ${"${file}"} 表示临时文件"></div>` : `<label>下载位置</label>
    <div class="muted">通过局域网或浏览器访问时，文件会直接下载到当前设备的浏览器下载目录，不会保存到运行 Terma 的服务器目录。具体位置由当前设备的浏览器设置决定。</div>`}
    <div class="warning">回收站仍占用远端磁盘空间。永久删除和清空回收站无法撤销。</div>
    <div class="actions"><button type="button" onclick="closeSftpGlobalSettings()">取消</button><button id="sftpGlobalSettingsSave" class="primary" type="button" onclick="saveSftpGlobalSettings()">${icon("save")}<span>保存 SFTP 设置</span></button></div>
  </div>`;
  modal.hidden = false;
  modal.onkeydown = event => {
    if (event.key === "Escape") closeSftpGlobalSettings();
  };
  $("sftpRecycleBinEnabled")?.focus();
  toggleSftpExternalEditorFields();
}

function toggleSftpExternalEditorFields() {
  const custom = $("sftpExternalEditorCustom");
  if (custom) custom.hidden = $("sftpExternalEditorMode")?.value !== "custom";
}

async function chooseSftpDownloadDirectory() {
  try {
    const result = await api("/api/sftp/download-settings/choose", {method:"POST", body:"{}"});
    if (result.path && $('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = result.path;
  } catch (error) { notify(error.message || "目录选择失败", "error"); }
}

function useDefaultSftpDownloadDirectory() {
  if ($('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = "";
  if ($('sftpDownloadDirectoryEffective')) $('sftpDownloadDirectoryEffective').textContent = `当前保存到：${sftpDownloadSettings?.default_directory || "系统下载目录"}`;
}

async function openSftpDownloadDirectory() {
  try { await api("/api/sftp/download-settings/open", {method:"POST", body:"{}"}); }
  catch (error) { notify(error.message || "打开下载目录失败", "error"); }
}

function closeSftpGlobalSettings() {
  const modal = $("modal");
  modal.onkeydown = null;
  closeModal();
}
