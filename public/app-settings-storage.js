async function loadAboutSettings() {
  aboutSettings = await api("/api/about");
  return aboutSettings;
}

async function loadDesktopSettings() {
  try {
    desktopSettings = await api("/api/desktop-settings");
  } catch {
    desktopSettings = {available:false};
  }
  return desktopSettings;
}

function storageSettingsPanelHtml() {
  const settings = desktopSettings?.settings || {};
  const paths = desktopSettings?.paths || {};
  const storage = desktopSettings?.storage || {};
  const configurable = Boolean(desktopSettings?.available);
  const saveAction = `<button class="primary storage-settings-save" type="button" onclick="${configurable ? "saveDesktopSettings(this)" : "saveWebStorageSettings(this)"}">${icon("save")}<span>${esc(tr("settings:auto.save_data_restart"))}</span></button>`;
  if (desktopSettings?.storage_management_available === false) return `<section class="desktop-settings-section storage-settings-section">
    <h3>${esc(tr("settings:storage.title"))}</h3>
    <div class="warning">${esc(tr("settings:storage.remote_management_warning"))}</div>
  </section>`;
  return `<section class="desktop-settings-section storage-settings-section">
    <h3>${esc(tr("settings:storage.title"))}</h3>
    <div class="storage-settings-layout">
      ${configurable ? `
        <label for="desktopDataMode">${esc(tr("settings:auto.data_path_mode"))}</label>
        <div class="storage-settings-primary-row">
          <select id="desktopDataMode" onchange="syncDesktopCustomDataMode()">
            ${desktopSettings.project_mode_available ? `<option value="project" ${settings.dataMode === "project" ? "selected" : ""}>${esc(tr("settings:storage.project_folder"))}</option>` : ""}
            <option value="user" ${settings.dataMode === "user" ? "selected" : ""}>${esc(tr("settings:storage.user_data_recommended"))}</option>
            <option value="custom" ${settings.dataMode === "custom" ? "selected" : ""}>${esc(tr("settings:storage.custom_path"))}</option>
          </select>
          ${saveAction}
        </div>
        <div id="desktopCustomDataBox" class="desktop-custom-path">
          <label for="desktopCustomDataDir">${esc(tr("settings:storage.custom_data_root"))}</label>
          <div class="upload-line"><input id="desktopCustomDataDir" value="${escAttr(settings.customDataDir || "")}" placeholder="${escAttr(tr("settings:auto.choose_absolute_path"))}"><button type="button" onclick="chooseDesktopDataDirectory()">${icon("folder-open")}<span>${esc(tr("settings:storage.choose"))}</span></button></div>
        </div>
        <div class="muted">${esc(tr("settings:auto.data_path_restart_hint"))}</div>` : `
        <label for="webStorageRoot">${esc(tr("settings:storage.runtime_root"))}</label>
        <div class="storage-settings-primary-row">
          <div class="upload-line"><input id="webStorageRoot" value="${escAttr(storage.root || desktopSettings?.base_dir || "")}" placeholder="${escAttr(tr("settings:auto.choose_absolute_path"))}"><button type="button" onclick="openStorageDirectoryBrowser()">${icon("folder-open")}<span>${esc(tr("settings:storage.browse"))}</span></button></div>
          ${saveAction}
        </div>
        <label class="check-row"><input id="webStorageMigrate" type="checkbox" checked> ${esc(tr("settings:storage.copy_to_new_root"))}</label>
        <div class="muted">${esc(tr("settings:storage.web_root_hint"))}</div>`}
      <div class="desktop-current-paths"><code>${esc(tr("settings:auto.data_path_label", {path:paths.dataDir || "", defaultValue:`数据：${paths.dataDir || ""}`}))}</code><code>${esc(tr("settings:auto.key_path_label", {path:paths.sshDir || "", defaultValue:`密钥：${paths.sshDir || ""}`}))}</code></div>
    </div>
  </section>`;
}

async function openStorageDirectoryBrowser(startPath="") {
  const input = $("webStorageRoot");
  const requested = startPath || input?.value.trim() || desktopSettings?.storage?.root || desktopSettings?.base_dir || "";
  try {
    const listing = await api(`/api/storage/directories?path=${encodeURIComponent(requested)}`);
    const modal = $("modal");
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-card wide storage-directory-modal" role="dialog" aria-modal="true" aria-labelledby="storageDirectoryTitle">
      <h2 id="storageDirectoryTitle">${esc(tr("settings:storage.select_runtime_root"))}</h2>
      <div class="storage-directory-path"><code>${esc(listing.current)}</code></div>
      <div class="storage-directory-roots" aria-label="${escAttr(tr("settings:storage.filesystem_roots"))}">${(listing.roots || []).map((item, index) => `<button type="button" data-storage-root="${index}" class="${item.path === listing.current ? "active" : ""}">${icon("hard-drive")}<span>${esc(item.name)}</span></button>`).join("")}</div>
      <div class="storage-directory-actions"><button id="storageDirectoryUp" type="button" ${listing.parent ? "" : "disabled"}>${icon("corner-left-up")}<span>${esc(tr("settings:storage.parent_directory"))}</span></button><button id="storageDirectorySelect" class="primary" type="button">${icon("folder-check")}<span>${esc(tr("settings:storage.select_current"))}</span></button></div>
      <div class="storage-directory-list">${listing.directories.length ? listing.directories.map((item, index) => `<button type="button" data-storage-directory="${index}">${icon("folder")}<span>${esc(item.name)}</span></button>`).join("") : stateView("empty", tr("settings:storage.no_subdirectories"))}</div>
      <div class="actions"><button type="button" onclick="closeModal()">${esc(tr("common:actions.cancel"))}</button></div>
    </div>`;
    modal.querySelectorAll("[data-storage-directory]").forEach(button => {
      button.onclick = () => openStorageDirectoryBrowser(listing.directories[Number(button.dataset.storageDirectory)].path);
    });
    modal.querySelectorAll("[data-storage-root]").forEach(button => {
      button.onclick = () => openStorageDirectoryBrowser(listing.roots[Number(button.dataset.storageRoot)].path);
    });
    $("storageDirectoryUp").onclick = () => listing.parent && openStorageDirectoryBrowser(listing.parent);
    $("storageDirectorySelect").onclick = () => {
      if (input) input.value = listing.current;
      closeModal();
    };
    refreshIcons();
  } catch (error) {
    notify(error.message || tr("settings:auto.directory_read_failed"), "error");
  }
}

async function saveWebStorageSettings(button) {
  const root = $("webStorageRoot")?.value.trim() || "";
  const migrate = Boolean($("webStorageMigrate")?.checked);
  if (!root) return notify(tr("settings:auto.choose_runtime_root"), "error");
  if (!await confirmModal(tr("settings:storage.web_change_confirm"), tr("settings:auto.change_data_path"), tr("settings:auto.save_restart"), tr("common:actions.cancel"), true)) return;
  try {
    setButtonBusy(button, true, tr("settings:storage.saving"));
    const result = await api("/api/desktop-settings", {method:"PUT", body:JSON.stringify({root, migrate})});
    notify(tr("settings:auto.data_path_saved"), "success");
    await waitForStorageRestart(result.data_dir);
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || tr("settings:auto.data_path_failed"), "error");
  }
}

async function waitForStorageRestart(expectedDataDir) {
  await new Promise(resolve => setTimeout(resolve, 900));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`/api/desktop-settings?restart=${Date.now()}`, {cache:"no-store"});
      if (!response.ok) {
        const responseError = await apiErrorFromResponse(response, tr("settings:auto.restart_timeout"));
        if (response.status >= 400 && response.status < 500 && ![404, 409].includes(response.status)) throw responseError;
      } else {
        const value = await response.json();
        const dataDir = value.storage?.data_dir || value.paths?.dataDir || "";
        if (!expectedDataDir || dataDir === expectedDataDir) {
          location.reload();
          return;
        }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(tr("settings:auto.restart_timeout"));
}

function desktopBehaviorPanelHtml() {
  if (!desktopSettings?.available) return "";
  const settings = desktopSettings.settings || {};
  const xserver = desktopSettings.xserver || {};
  const displaySuffix = xserver.display ? ` · ${xserver.display}` : "";
  const xserverState = xserver.available
    ? tr("settings:auto.xserver_ready", {display:displaySuffix, defaultValue:`已就绪${displaySuffix}`})
    : tr(xserver.installed ? "settings:storage.xserver_startable" : "settings:auto.not_installed");
  return `<section class="desktop-settings-section">
    <h3>${esc(tr("settings:auto.desktop_behavior"))}</h3>
    <div class="muted">${esc(tr("settings:auto.desktop_behavior_hint"))}</div>
    <div class="desktop-settings-grid">
      <div class="desktop-toggle-list">
        <label class="check-row"><input id="desktopOpenAtLogin" type="checkbox" ${settings.openAtLogin ? "checked" : ""}> ${esc(tr("settings:auto.open_at_login"))}</label>
        <label class="check-row"><input id="desktopMinimizeToTray" type="checkbox" ${settings.minimizeToTray ? "checked" : ""}> ${esc(tr("settings:auto.minimize_to_tray"))}</label>
        <label class="check-row"><input id="desktopStartMinimized" type="checkbox" ${settings.startMinimizedToTray ? "checked" : ""}> ${esc(tr("settings:auto.start_minimized"))}</label>
        <label class="check-row"><input id="desktopStartupNotification" type="checkbox" ${settings.showStartupNotification ? "checked" : ""}> ${esc(tr("settings:auto.startup_notification"))}</label>
        <label class="check-row"><input id="desktopXServerAutoStart" type="checkbox" ${settings.xServerAutoStart !== false ? "checked" : ""}> ${esc(tr("settings:auto.prepare_xserver"))}</label>
      </div>
    </div>
    <div class="desktop-runtime-row"><span>${icon(xserver.available ? "circle-check" : xserver.installed ? "circle-pause" : "circle-alert")}<b>X Server</b><small>${esc(xserverState)}</small></span><button type="button" onclick="openXServerManager()">${icon("x11")}<span>${esc(tr("settings:storage.manage"))}</span></button></div>
    <div class="actions"><button id="desktopSettingsSaveBtn" class="primary" type="button" onclick="saveDesktopSettings(this)">${icon("save")}<span>${esc(tr("settings:auto.save_desktop_behavior"))}</span></button></div>
  </section>`;
}

function syncDesktopCustomDataMode() {
  const box = $("desktopCustomDataBox");
  if (box) box.hidden = $("desktopDataMode")?.value !== "custom";
}

async function chooseDesktopDataDirectory() {
  const inPane = captureSettingsPane();
  try {
    const result = await api("/api/desktop-settings/choose-data-dir", {method:"POST", body:"{}"});
    inPane(() => {
      const input = $("desktopCustomDataDir");
      if (result.path && input) input.value = result.path;
    });
  } catch (error) { notify(error.message || tr("settings:auto.directory_choose_failed"), "error"); }
}

function desktopStoragePathChanged() {
  const current = desktopSettings?.settings || {};
  const requestedMode = $("desktopDataMode")?.value || current.dataMode || "user";
  const requestedCustom = $("desktopCustomDataDir")?.value.trim() || "";
  return requestedMode !== String(current.dataMode || "")
    || (requestedMode === "custom" && requestedCustom !== String(current.customDataDir || "").trim());
}

async function chooseDesktopStorageMigration() {
  if (!desktopStoragePathChanged()) return "unchanged";
  return chooseModal(
    tr("settings:auto.change_data_path"),
    tr("settings:storage.migration_question"),
    [
      {label:tr("settings:auto.migrate_restart"), value:"migrate", className:"primary"},
      {label:tr("settings:auto.switch_restart"), value:"switch"},
      {label:tr("common:actions.cancel"), value:"cancel"}
    ]
  );
}

async function saveDesktopSettings(button=$("desktopSettingsSaveBtn")) {
  const migrationChoice = await chooseDesktopStorageMigration();
  if (migrationChoice === "cancel") return;
  try {
    setButtonBusy(button, true, tr("settings:storage.saving"));
    const result = await api("/api/desktop-settings", {method:"PUT", body:JSON.stringify({
      dataMode:$("desktopDataMode").value,
      customDataDir:$("desktopCustomDataDir").value.trim(),
      migrateData:migrationChoice === "migrate",
      openAtLogin:$("desktopOpenAtLogin").checked,
      minimizeToTray:$("desktopMinimizeToTray").checked,
      startMinimizedToTray:$("desktopStartMinimized").checked,
      showStartupNotification:$("desktopStartupNotification").checked,
      xServerAutoStart:$("desktopXServerAutoStart").checked
    })});
    notify(tr(result.migration_requested ? "settings:auto.migrating_data" : "settings:auto.desktop_settings_restarting"), "success");
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || tr("settings:auto.desktop_settings_failed"), "error");
  }
}
