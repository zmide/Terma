async function saveSftpGlobalSettings() {
  const recycle = $("sftpRecycleBinEnabled");
  const sizeInput = $("sftpMaxOpenFileSizeMb");
  const editorMode = $("sftpTextEditorMode");
  const editorThreshold = $("sftpLightEditorThresholdMb");
  const downloadConcurrencyInput = $("sftpDownloadConcurrency");
  const uploadConcurrencyInput = $("sftpUploadConcurrency");
  const button = $("sftpGlobalSettingsSave");
  if (!recycle || !sizeInput || !editorMode || !editorThreshold || !downloadConcurrencyInput || !uploadConcurrencyInput || !button) return;
  const maximumSize = Number(sizeInput.value);
  const lightEditorThreshold = Number(editorThreshold.value);
  const downloadConcurrency = Number(downloadConcurrencyInput.value);
  const uploadConcurrency = Number(uploadConcurrencyInput.value);
  if (!Number.isInteger(maximumSize) || maximumSize < 1 || maximumSize > 100) return notify("SFTP 文件打开上限必须是 1-100 MB 的整数", "error");
  if (!Number.isInteger(lightEditorThreshold) || lightEditorThreshold < 1 || lightEditorThreshold > 100) return notify("轻量编辑器阈值必须是 1-100 MB 的整数", "error");
  if (!Number.isInteger(downloadConcurrency) || downloadConcurrency < 1 || downloadConcurrency > 8) return notify("下载并发数必须是 1-8 的整数", "error");
  if (!Number.isInteger(uploadConcurrency) || uploadConcurrency < 1 || uploadConcurrency > 8) return notify("上传并发数必须是 1-8 的整数", "error");
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
        sftp_text_editor_mode:editorMode.value,
        sftp_light_editor_threshold_mb:lightEditorThreshold,
        sftp_download_concurrency:downloadConcurrency,
        sftp_upload_concurrency:uploadConcurrency,
        ...($("sftpExternalEditSaveRule") ? {
          sftp_external_edit_save_rule:$("sftpExternalEditSaveRule").value || "prompt",
          sftp_external_edit_backup_enabled:$("sftpExternalEditBackupEnabled")?.checked !== false
        } : {}),
        ...(sftpDownloadSettings?.delivery_mode === "desktop" ? {sftp_download_directory:$('sftpDownloadDirectory')?.value.trim() || ""} : {})
      })
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    recycle.checked = runtimeSettings.saved.sftp_recycle_bin_enabled;
    sizeInput.value = runtimeSettings.saved.sftp_max_open_file_size_mb;
    editorMode.value = runtimeSettings.saved.sftp_text_editor_mode;
    editorThreshold.value = runtimeSettings.saved.sftp_light_editor_threshold_mb;
    downloadConcurrencyInput.value = runtimeSettings.saved.sftp_download_concurrency;
    uploadConcurrencyInput.value = runtimeSettings.saved.sftp_upload_concurrency;
    if (sftpDownloadSettings?.delivery_mode === "desktop") {
      sftpDownloadSettings = await api("/api/sftp/download-settings");
      if ($('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = sftpDownloadSettings.configured_directory || "";
      if ($('sftpDownloadDirectoryEffective')) $('sftpDownloadDirectoryEffective').textContent = `当前保存到：${sftpDownloadSettings.effective_directory || "系统下载目录"}`;
    }
    notify("SFTP 全局设置已保存", "success");
  } catch (error) {
    recycle.checked = runtimeSettings?.saved?.sftp_recycle_bin_enabled === true;
    sizeInput.value = runtimeSettings?.saved?.sftp_max_open_file_size_mb || 50;
    editorMode.value = runtimeSettings?.saved?.sftp_text_editor_mode || "ace";
    editorThreshold.value = runtimeSettings?.saved?.sftp_light_editor_threshold_mb || 10;
    downloadConcurrencyInput.value = runtimeSettings?.saved?.sftp_download_concurrency || 3;
    uploadConcurrencyInput.value = runtimeSettings?.saved?.sftp_upload_concurrency || 3;
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
  modal.innerHTML = `<div class="modal-card terminal-settings-modal sftp-global-settings-modal" role="dialog" aria-modal="true" aria-labelledby="sftpGlobalSettingsTitle">
    <div class="terminal-settings-head"><div><h2 id="sftpGlobalSettingsTitle">SFTP 全局设置</h2><span>应用到所有 SFTP 标签和连接</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeSftpGlobalSettings()">${icon("x")}</button></div>
    <div class="terminal-settings-tabs" role="tablist" aria-label="SFTP 设置分类">
      <button id="sftpSettingsTabGeneral" class="active" type="button" role="tab" aria-selected="true" aria-controls="sftpSettingsPanelGeneral" onclick="selectSftpSettingsTab('general')">${icon("settings-2")}<span>常规</span></button>
      <button id="sftpSettingsTabEditor" type="button" role="tab" aria-selected="false" aria-controls="sftpSettingsPanelEditor" onclick="selectSftpSettingsTab('editor')">${icon("file-pen-line")}<span>编辑器</span></button>
      <button id="sftpSettingsTabTransfer" type="button" role="tab" aria-selected="false" aria-controls="sftpSettingsPanelTransfer" onclick="selectSftpSettingsTab('transfer')">${icon("arrow-left-right")}<span>传输</span></button>
    </div>
    <div class="terminal-settings-panels">
      <section id="sftpSettingsPanelGeneral" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabGeneral">
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("trash-2")}远端删除</h3><label class="check-row"><input id="sftpRecycleBinEnabled" type="checkbox" ${saved.sftp_recycle_bin_enabled ? "checked" : ""}> 删除远程文件时先移入回收站</label><div class="muted">默认关闭。开启后会在远端 SSH 用户主目录创建 Terma 专用隐藏目录。</div></div><div class="terminal-settings-section"><h3>${icon("file-search")}文件打开</h3><label>程序内打开上限（MB）</label><input id="sftpMaxOpenFileSizeMb" type="number" min="1" max="100" step="1" value="${Number(saved.sftp_max_open_file_size_mb || 50)}"><div class="muted">适用于在线文本编辑和图片预览；更大的文件仍可下载。</div></div></div>
        <div class="warning">回收站仍占用远端磁盘空间。永久删除和清空回收站无法撤销。</div>
      </section>
      <section id="sftpSettingsPanelEditor" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabEditor" hidden>
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("file-code-2")}内置编辑器</h3><label>文本编辑器</label><select id="sftpTextEditorMode" onchange="toggleSftpLightEditorFields()"><option value="ace" ${saved.sftp_text_editor_mode !== "auto" && saved.sftp_text_editor_mode !== "light" ? "selected" : ""}>始终使用 Ace 编辑器（默认）</option><option value="auto" ${saved.sftp_text_editor_mode === "auto" ? "selected" : ""}>大文件自动使用轻量编辑器</option><option value="light" ${saved.sftp_text_editor_mode === "light" ? "selected" : ""}>始终使用轻量编辑器</option></select><div id="sftpLightEditorThresholdFields"><label>超过此大小时使用轻量编辑器（MB）</label><input id="sftpLightEditorThresholdMb" type="number" min="1" max="100" step="1" value="${Number(saved.sftp_light_editor_threshold_mb || 10)}"></div><div class="muted">轻量编辑器按 256 KB 分段显示，不加载语法高亮和全文差异，避免大文件占满内存。</div></div>
        <div class="terminal-settings-section"><h3>${icon("external-link")}外部编辑器</h3>${sftpDownloadSettings.delivery_mode === "desktop" ? `<label>外部编辑器</label><select id="sftpExternalEditorMode" onchange="toggleSftpExternalEditorFields()"><option value="system" ${localStorage.getItem("sftpExternalEditorMode") !== "vscode" && localStorage.getItem("sftpExternalEditorMode") !== "custom" ? "selected" : ""}>系统关联程序</option><option value="vscode" ${localStorage.getItem("sftpExternalEditorMode") === "vscode" ? "selected" : ""}>VS Code</option><option value="custom" ${localStorage.getItem("sftpExternalEditorMode") === "custom" ? "selected" : ""}>自定义程序</option></select><div id="sftpExternalEditorCustom"><label>程序路径</label><input id="sftpExternalEditorPath" value="${escAttr(localStorage.getItem("sftpExternalEditorPath") || "")}" placeholder="编辑器可执行文件绝对路径"><label>启动参数</label><input id="sftpExternalEditorArgs" value="${escAttr(localStorage.getItem("sftpExternalEditorArgs") || "")}" placeholder="可选；用 ${"${file}"} 表示临时文件"></div><label>外部编辑器保存规则</label><select id="sftpExternalEditSaveRule" onchange="toggleSftpExternalSaveFields()"><option value="prompt" ${saved.sftp_external_edit_save_rule !== "overwrite" ? "selected" : ""}>弹出保存提示</option><option value="overwrite" ${saved.sftp_external_edit_save_rule === "overwrite" ? "selected" : ""}>不提示，直接覆盖远端</option></select><label id="sftpExternalEditBackupFields" class="check-row"><input id="sftpExternalEditBackupEnabled" type="checkbox" ${saved.sftp_external_edit_backup_enabled !== false ? "checked" : ""}> 自动覆盖前备份远端源文件</label>` : `<div class="muted">外部编辑器仅在桌面版中可用。</div>`}</div></div>
      </section>
      <section id="sftpSettingsPanelTransfer" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabTransfer" hidden>
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("gauge")}并发任务</h3><div class="terminal-settings-field-grid"><div><label>同时下载</label><input id="sftpDownloadConcurrency" type="number" min="1" max="8" step="1" value="${Number(saved.sftp_download_concurrency || 3)}"></div><div><label>同时上传</label><input id="sftpUploadConcurrency" type="number" min="1" max="8" step="1" value="${Number(saved.sftp_upload_concurrency || 3)}"></div></div><div class="muted">范围 1-8。普通下载、打包下载、拖到本地文件标签和拖出到桌面共享下载额度；其余任务在任务中心排队。</div></div><div class="terminal-settings-section"><h3>${icon("folder-down")}下载位置</h3>${sftpDownloadSettings.delivery_mode === "desktop" ? `<label>SFTP 自动保存目录</label>
    <div class="upload-line"><input id="sftpDownloadDirectory" value="${escAttr(sftpDownloadSettings.configured_directory || "")}" placeholder="留空时使用系统下载目录"><button type="button" onclick="chooseSftpDownloadDirectory()">${icon("folder-open")}<span>选择目录</span></button></div>
    <div id="sftpDownloadDirectoryEffective" class="muted">当前保存到：${esc(sftpDownloadSettings.effective_directory || sftpDownloadSettings.default_directory || "系统下载目录")}</div>
    <div class="actions compact"><button type="button" onclick="useDefaultSftpDownloadDirectory()">恢复系统默认</button><button type="button" onclick="openSftpDownloadDirectory()">${icon("folder-open")}<span>打开目录</span></button></div>` : `<div class="muted">通过局域网或浏览器访问时，文件会下载到当前设备的浏览器下载目录。</div>`}</div></div>
      </section>
    </div>
    <div class="actions terminal-settings-actions"><button type="button" onclick="closeSftpGlobalSettings()">取消</button><button id="sftpGlobalSettingsSave" class="primary" type="button" onclick="saveSftpGlobalSettings()">${icon("save")}<span>保存 SFTP 设置</span></button></div>
  </div>`;
  modal.hidden = false;
  modal.onkeydown = event => {
    if (event.key === "Escape") closeSftpGlobalSettings();
  };
  $("sftpRecycleBinEnabled")?.focus();
  toggleSftpExternalEditorFields();
  toggleSftpLightEditorFields();
  toggleSftpExternalSaveFields();
}

function selectSftpSettingsTab(name) {
  const selected = ["general", "editor", "transfer"].includes(name) ? name : "general";
  const mapping = {
    general:["sftpSettingsTabGeneral", "sftpSettingsPanelGeneral"],
    editor:["sftpSettingsTabEditor", "sftpSettingsPanelEditor"],
    transfer:["sftpSettingsTabTransfer", "sftpSettingsPanelTransfer"]
  };
  Object.entries(mapping).forEach(([key, [tabId, panelId]]) => {
    const active = key === selected;
    $(tabId)?.classList.toggle("active", active);
    $(tabId)?.setAttribute("aria-selected", String(active));
    if ($(panelId)) $(panelId).hidden = !active;
  });
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

async function openSftpDownloadDirectory(button=null, jobId="") {
  try { await api("/api/sftp/download-settings/open", {method:"POST", body:JSON.stringify({job_id:jobId})}); }
  catch (error) { notify(error.message || "打开下载目录失败", "error"); }
}

function toggleSftpLightEditorFields() {
  const fields = $("sftpLightEditorThresholdFields");
  if (fields) fields.hidden = $("sftpTextEditorMode")?.value !== "auto";
}

function toggleSftpExternalSaveFields() {
  const fields = $("sftpExternalEditBackupFields");
  if (fields) fields.hidden = $("sftpExternalEditSaveRule")?.value !== "overwrite";
}

async function openSftpDownloadedFile(jobId, button=null) {
  const actionKey = `sftp-task:open-file:${String(jobId || "")}`;
  if (!beginUiAction(actionKey, button)) return;
  try {
    await api("/api/sftp/download-settings/open-file", {method:"POST", body:JSON.stringify({job_id:jobId})});
  } catch (error) {
    notify(error.message || "打开下载文件失败", "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

function closeSftpGlobalSettings() {
  const modal = $("modal");
  modal.onkeydown = null;
  closeModal();
}
