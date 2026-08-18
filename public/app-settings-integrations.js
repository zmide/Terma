async function saveSftpGlobalSettings() {
  const recycle = $("sftpRecycleBinEnabled");
  const sizeInput = $("sftpMaxOpenFileSizeMb");
  const editorMode = $("sftpTextEditorMode");
  const doubleClickAction = $("sftpDoubleClickFileAction");
  const editorThreshold = $("sftpLightEditorThresholdMb");
  const downloadConcurrencyInput = $("sftpDownloadConcurrency");
  const uploadConcurrencyInput = $("sftpUploadConcurrency");
  const button = $("sftpGlobalSettingsSave");
  if (!recycle || !sizeInput || !editorMode || !doubleClickAction || !editorThreshold || !downloadConcurrencyInput || !uploadConcurrencyInput || !button) return;
  const maximumSize = Number(sizeInput.value);
  const lightEditorThreshold = Number(editorThreshold.value);
  const downloadConcurrency = Number(downloadConcurrencyInput.value);
  const uploadConcurrency = Number(uploadConcurrencyInput.value);
  if (!Number.isInteger(maximumSize) || maximumSize < 1 || maximumSize > 100) return notify(tr("sftp:settings.open_limit_invalid"), "error");
  if (!Number.isInteger(lightEditorThreshold) || lightEditorThreshold < 1 || lightEditorThreshold > 100) return notify(tr("sftp:settings.light_threshold_invalid"), "error");
  if (!Number.isInteger(downloadConcurrency) || downloadConcurrency < 1 || downloadConcurrency > 8) return notify(tr("sftp:settings.download_concurrency_invalid"), "error");
  if (!Number.isInteger(uploadConcurrency) || uploadConcurrency < 1 || uploadConcurrency > 8) return notify(tr("sftp:settings.upload_concurrency_invalid"), "error");
  setButtonBusy(button, true, tr("common:auto.saving"));
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
        sftp_double_click_file_action:doubleClickAction.value,
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
    doubleClickAction.value = runtimeSettings.saved.sftp_double_click_file_action;
    editorThreshold.value = runtimeSettings.saved.sftp_light_editor_threshold_mb;
    downloadConcurrencyInput.value = runtimeSettings.saved.sftp_download_concurrency;
    uploadConcurrencyInput.value = runtimeSettings.saved.sftp_upload_concurrency;
    if (sftpDownloadSettings?.delivery_mode === "desktop") {
      sftpDownloadSettings = await api("/api/sftp/download-settings");
      if ($('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = sftpDownloadSettings.configured_directory || "";
      if ($('sftpDownloadDirectoryEffective')) $('sftpDownloadDirectoryEffective').textContent = tr("sftp:settings.current_save_directory", {
        path:sftpDownloadSettings.effective_directory || tr("sftp:settings.system_download_directory")
      });
    }
    notify(tr("settings:auto.sftp_saved"), "success");
  } catch (error) {
    recycle.checked = runtimeSettings?.saved?.sftp_recycle_bin_enabled === true;
    sizeInput.value = runtimeSettings?.saved?.sftp_max_open_file_size_mb || 50;
    editorMode.value = runtimeSettings?.saved?.sftp_text_editor_mode || "ace";
    doubleClickAction.value = runtimeSettings?.saved?.sftp_double_click_file_action || "internal";
    editorThreshold.value = runtimeSettings?.saved?.sftp_light_editor_threshold_mb || 10;
    downloadConcurrencyInput.value = runtimeSettings?.saved?.sftp_download_concurrency || 3;
    uploadConcurrencyInput.value = runtimeSettings?.saved?.sftp_upload_concurrency || 3;
    notify(error.message ? localizedTermaUiPhrase(error.message, tr("settings:auto.sftp_save_failed")) : tr("settings:auto.sftp_save_failed"), "error");
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
  const closeLabel = tr("common:actions.close");
  modal.innerHTML = `<div class="modal-card terminal-settings-modal sftp-global-settings-modal" role="dialog" aria-modal="true" aria-labelledby="sftpGlobalSettingsTitle">
    <div class="terminal-settings-head"><div><h2 id="sftpGlobalSettingsTitle">${esc(tr("sftp:settings.title"))}</h2><span>${esc(tr("sftp:settings.scope"))}</span></div><button class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}" onclick="closeSftpGlobalSettings()">${icon("x")}</button></div>
    <div class="terminal-settings-tabs" role="tablist" aria-label="${escAttr(tr("sftp:settings.categories"))}">
      <button id="sftpSettingsTabGeneral" class="active" type="button" role="tab" aria-selected="true" aria-controls="sftpSettingsPanelGeneral" onclick="selectSftpSettingsTab('general')">${icon("settings-2")}<span>${esc(tr("sftp:settings.general"))}</span></button>
      <button id="sftpSettingsTabEditor" type="button" role="tab" aria-selected="false" aria-controls="sftpSettingsPanelEditor" onclick="selectSftpSettingsTab('editor')">${icon("file-pen-line")}<span>${esc(tr("sftp:settings.editor"))}</span></button>
      <button id="sftpSettingsTabTransfer" type="button" role="tab" aria-selected="false" aria-controls="sftpSettingsPanelTransfer" onclick="selectSftpSettingsTab('transfer')">${icon("arrow-left-right")}<span>${esc(tr("sftp:settings.transfer"))}</span></button>
    </div>
    <div class="terminal-settings-panels">
      <section id="sftpSettingsPanelGeneral" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabGeneral">
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("trash-2")}${esc(tr("sftp:settings.remote_delete"))}</h3><label class="check-row"><input id="sftpRecycleBinEnabled" type="checkbox" ${saved.sftp_recycle_bin_enabled ? "checked" : ""}> ${esc(tr("sftp:settings.recycle_first"))}</label><div class="muted">${esc(tr("sftp:settings.recycle_hint"))}</div></div><div class="terminal-settings-section"><h3>${icon("file-search")}${esc(tr("sftp:settings.file_open"))}</h3><label>${esc(tr("sftp:settings.open_limit"))}</label><input id="sftpMaxOpenFileSizeMb" type="number" min="1" max="100" step="1" value="${Number(saved.sftp_max_open_file_size_mb || 50)}"><div class="muted">${esc(tr("sftp:settings.open_limit_hint"))}</div></div></div>
        <div class="warning">${esc(tr("sftp:settings.recycle_warning"))}</div>
      </section>
      <section id="sftpSettingsPanelEditor" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabEditor" hidden>
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("file-code-2")}${esc(tr("sftp:settings.builtin_editor"))}</h3><label>${esc(tr("sftp:settings.double_click_action", {defaultValue:"双击文件"}))}</label><select id="sftpDoubleClickFileAction"><option value="internal" ${saved.sftp_double_click_file_action !== "external" ? "selected" : ""}>${esc(tr("sftp:settings.double_click_internal", {defaultValue:"使用内部编辑器"}))}</option><option value="external" ${saved.sftp_double_click_file_action === "external" ? "selected" : ""}>${esc(tr("sftp:settings.double_click_external", {defaultValue:"使用外部编辑器"}))}</option></select><div class="muted">${esc(tr("sftp:settings.double_click_hint", {defaultValue:"外部编辑器仅在桌面版可用；Web 版会回退到内部编辑器或预览。"}))}</div><label>${esc(tr("sftp:settings.text_editor"))}</label><select id="sftpTextEditorMode" onchange="toggleSftpLightEditorFields()"><option value="ace" ${saved.sftp_text_editor_mode !== "auto" && saved.sftp_text_editor_mode !== "light" ? "selected" : ""}>${esc(tr("sftp:settings.ace_always"))}</option><option value="auto" ${saved.sftp_text_editor_mode === "auto" ? "selected" : ""}>${esc(tr("sftp:settings.light_auto"))}</option><option value="light" ${saved.sftp_text_editor_mode === "light" ? "selected" : ""}>${esc(tr("sftp:settings.light_always"))}</option></select><div id="sftpLightEditorThresholdFields"><label>${esc(tr("sftp:settings.light_threshold"))}</label><input id="sftpLightEditorThresholdMb" type="number" min="1" max="100" step="1" value="${Number(saved.sftp_light_editor_threshold_mb || 10)}"></div><div class="muted">${esc(tr("sftp:settings.light_hint"))}</div></div>
        <div class="terminal-settings-section"><h3>${icon("external-link")}${esc(tr("sftp:settings.external_editor"))}</h3>${sftpDownloadSettings.delivery_mode === "desktop" ? `<label>${esc(tr("sftp:settings.external_editor"))}</label><select id="sftpExternalEditorMode" onchange="toggleSftpExternalEditorFields()"><option value="system" ${localStorage.getItem("sftpExternalEditorMode") !== "vscode" && localStorage.getItem("sftpExternalEditorMode") !== "custom" ? "selected" : ""}>${esc(tr("sftp:settings.system_program"))}</option><option value="vscode" ${localStorage.getItem("sftpExternalEditorMode") === "vscode" ? "selected" : ""}>${esc(tr("sftp:settings.vscode"))}</option><option value="custom" ${localStorage.getItem("sftpExternalEditorMode") === "custom" ? "selected" : ""}>${esc(tr("sftp:settings.custom_program"))}</option></select><div id="sftpExternalEditorCustom"><label>${esc(tr("sftp:settings.program_path"))}</label><input id="sftpExternalEditorPath" value="${escAttr(localStorage.getItem("sftpExternalEditorPath") || "")}" placeholder="${escAttr(tr("sftp:settings.program_path_placeholder"))}"><label>${esc(tr("sftp:settings.launch_args"))}</label><input id="sftpExternalEditorArgs" value="${escAttr(localStorage.getItem("sftpExternalEditorArgs") || "")}" placeholder="${escAttr(tr("sftp:settings.launch_args_placeholder"))}"></div><label>${esc(tr("sftp:settings.save_rule"))}</label><select id="sftpExternalEditSaveRule" onchange="toggleSftpExternalSaveFields()"><option value="prompt" ${saved.sftp_external_edit_save_rule !== "overwrite" ? "selected" : ""}>${esc(tr("sftp:settings.save_prompt"))}</option><option value="overwrite" ${saved.sftp_external_edit_save_rule === "overwrite" ? "selected" : ""}>${esc(tr("sftp:settings.overwrite_remote"))}</option></select><label id="sftpExternalEditBackupFields" class="check-row"><input id="sftpExternalEditBackupEnabled" type="checkbox" ${saved.sftp_external_edit_backup_enabled !== false ? "checked" : ""}> ${esc(tr("sftp:settings.backup_before_overwrite"))}</label>` : `<div class="muted">${esc(tr("sftp:settings.desktop_only"))}</div>`}</div></div>
      </section>
      <section id="sftpSettingsPanelTransfer" class="terminal-settings-panel" role="tabpanel" aria-labelledby="sftpSettingsTabTransfer" hidden>
        <div class="terminal-settings-grid"><div class="terminal-settings-section"><h3>${icon("gauge")}${esc(tr("sftp:settings.concurrent_tasks"))}</h3><div class="terminal-settings-field-grid"><div><label>${esc(tr("sftp:settings.simultaneous_downloads"))}</label><input id="sftpDownloadConcurrency" type="number" min="1" max="8" step="1" value="${Number(saved.sftp_download_concurrency || 3)}"></div><div><label>${esc(tr("sftp:settings.simultaneous_uploads"))}</label><input id="sftpUploadConcurrency" type="number" min="1" max="8" step="1" value="${Number(saved.sftp_upload_concurrency || 3)}"></div></div><div class="muted">${esc(tr("sftp:settings.concurrency_hint"))}</div></div><div class="terminal-settings-section"><h3>${icon("folder-down")}${esc(tr("sftp:settings.download_location"))}</h3>${sftpDownloadSettings.delivery_mode === "desktop" ? `<label>${esc(tr("sftp:settings.auto_save_directory"))}</label>
    <div class="upload-line"><input id="sftpDownloadDirectory" value="${escAttr(sftpDownloadSettings.configured_directory || "")}" placeholder="${escAttr(tr("sftp:settings.system_download_placeholder"))}"><button type="button" onclick="chooseSftpDownloadDirectory()">${icon("folder-open")}<span>${esc(tr("sftp:settings.choose_directory"))}</span></button></div>
    <div id="sftpDownloadDirectoryEffective" class="muted">${esc(tr("sftp:settings.current_save_directory", {path:sftpDownloadSettings.effective_directory || sftpDownloadSettings.default_directory || tr("sftp:settings.system_download_directory")}))}</div>
    <div class="actions compact"><button type="button" onclick="useDefaultSftpDownloadDirectory()">${esc(tr("sftp:settings.restore_default"))}</button><button type="button" onclick="openSftpDownloadDirectory()">${icon("folder-open")}<span>${esc(tr("sftp:settings.open_directory"))}</span></button></div>` : `<div class="muted">${esc(tr("sftp:settings.browser_download_hint"))}</div>`}</div></div>
      </section>
    </div>
    <div class="actions terminal-settings-actions"><button type="button" onclick="closeSftpGlobalSettings()">${esc(tr("common:actions.cancel"))}</button><button id="sftpGlobalSettingsSave" class="primary" type="button" onclick="saveSftpGlobalSettings()">${icon("save")}<span>${esc(tr("sftp:settings.save"))}</span></button></div>
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
  } catch (error) { notify(error.message ? localizedTermaUiPhrase(error.message, tr("settings:auto.directory_choose_failed")) : tr("settings:auto.directory_choose_failed"), "error"); }
}

function useDefaultSftpDownloadDirectory() {
  if ($('sftpDownloadDirectory')) $('sftpDownloadDirectory').value = "";
  if ($('sftpDownloadDirectoryEffective')) $('sftpDownloadDirectoryEffective').textContent = tr("sftp:settings.current_save_directory", {
    path:sftpDownloadSettings?.default_directory || tr("sftp:settings.system_download_directory")
  });
}

async function openSftpDownloadDirectory(button=null, jobId="") {
  try { await api("/api/sftp/download-settings/open", {method:"POST", body:JSON.stringify({job_id:jobId})}); }
  catch (error) { notify(error.message ? localizedTermaUiPhrase(error.message, tr("sftp:settings.open_directory_failed")) : tr("sftp:settings.open_directory_failed"), "error"); }
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
    notify(error.message ? localizedTermaUiPhrase(error.message, tr("sftp:settings.open_file_failed")) : tr("sftp:settings.open_file_failed"), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function deleteSftpDownloadedFile(jobId, button=null) {
  const actionKey = `sftp-task:delete-file:${String(jobId || "")}`;
  if (!beginUiAction(actionKey, button)) return;
  try {
    await api("/api/sftp/download-settings/delete-file", {method:"POST", body:JSON.stringify({job_id:jobId})});
    notify(tr("sftp:menu.downloaded_file_deleted", {defaultValue:"已删除下载文件"}), "success");
  } catch (error) {
    notify(error.message ? localizedTermaUiPhrase(error.message, tr("sftp:menu.downloaded_file_delete_failed", {defaultValue:"删除下载文件失败"})) : tr("sftp:menu.downloaded_file_delete_failed", {defaultValue:"删除下载文件失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

function closeSftpGlobalSettings() {
  const modal = $("modal");
  modal.onkeydown = null;
  closeModal();
}
