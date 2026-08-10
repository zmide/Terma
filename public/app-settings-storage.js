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
  const saveAction = `<button class="primary storage-settings-save" type="button" onclick="${configurable ? "saveDesktopSettings(this)" : "saveWebStorageSettings(this)"}">${icon("save")}<span>保存数据路径并重启</span></button>`;
  if (desktopSettings?.storage_management_available === false) return `<section class="desktop-settings-section storage-settings-section">
    <h3>数据存储</h3>
    <div class="warning">远程管理数据路径需要启用 Web 密码并登录。关闭局域网密码时，只能在运行 Terma 的本机修改。</div>
  </section>`;
  return `<section class="desktop-settings-section storage-settings-section">
    <h3>数据存储</h3>
    <div class="storage-settings-layout">
      ${configurable ? `
        <label for="desktopDataMode">数据路径模式</label>
        <div class="storage-settings-primary-row">
          <select id="desktopDataMode" onchange="syncDesktopCustomDataMode()">
            ${desktopSettings.project_mode_available ? `<option value="project" ${settings.dataMode === "project" ? "selected" : ""}>${esc(desktopSettings.project_mode_label || "项目所在文件夹")}</option>` : ""}
            <option value="user" ${settings.dataMode === "user" ? "selected" : ""}>用户数据路径（推荐）</option>
            <option value="custom" ${settings.dataMode === "custom" ? "selected" : ""}>自定义路径</option>
          </select>
          ${saveAction}
        </div>
        <div id="desktopCustomDataBox" class="desktop-custom-path">
          <label for="desktopCustomDataDir">自定义数据根目录</label>
          <div class="upload-line"><input id="desktopCustomDataDir" value="${escAttr(settings.customDataDir || "")}" placeholder="选择或输入绝对路径"><button type="button" onclick="chooseDesktopDataDirectory()">${icon("folder-open")}<span>选择</span></button></div>
        </div>
        <div class="muted">保存数据路径后桌面端会重启，当前 SSH 转发会按已有恢复策略重新连接。</div>` : `
        <label for="webStorageRoot">运行根目录</label>
        <div class="storage-settings-primary-row">
          <div class="upload-line"><input id="webStorageRoot" value="${escAttr(storage.root || desktopSettings?.base_dir || "")}" placeholder="选择或输入绝对路径"><button type="button" onclick="openStorageDirectoryBrowser()">${icon("folder-open")}<span>浏览</span></button></div>
          ${saveAction}
        </div>
        <label class="check-row"><input id="webStorageMigrate" type="checkbox" checked> 复制当前数据库、设置和密钥到新目录</label>
        <div class="muted">保存后 Terma 会自动重启。目标已有数据库时不会覆盖；也可在启动前使用 TERMA_DATA_DIR 和 TERMA_SSH_DIR 分别覆盖目录，旧版 TUNNELDESK_* 变量仍可兼容读取。</div>`}
      <div class="desktop-current-paths"><code>数据：${esc(paths.dataDir || "")}</code><code>密钥：${esc(paths.sshDir || "")}</code></div>
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
    modal.innerHTML = `<div class="modal-card wide storage-directory-modal">
      <h2>选择运行根目录</h2>
      <div class="storage-directory-path"><code>${esc(listing.current)}</code></div>
      <div class="storage-directory-roots" aria-label="文件系统根目录">${(listing.roots || []).map((item, index) => `<button type="button" data-storage-root="${index}" class="${item.path === listing.current ? "active" : ""}">${icon("hard-drive")}<span>${esc(item.name)}</span></button>`).join("")}</div>
      <div class="storage-directory-actions"><button id="storageDirectoryUp" type="button" ${listing.parent ? "" : "disabled"}>${icon("corner-left-up")}<span>上一级</span></button><button id="storageDirectorySelect" class="primary" type="button">${icon("folder-check")}<span>选择当前目录</span></button></div>
      <div class="storage-directory-list">${listing.directories.length ? listing.directories.map((item, index) => `<button type="button" data-storage-directory="${index}">${icon("folder")}<span>${esc(item.name)}</span></button>`).join("") : stateView("empty", "当前目录没有子目录")}</div>
      <div class="actions"><button type="button" onclick="closeModal()">取消</button></div>
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
    notify(error.message || "目录读取失败", "error");
  }
}

async function saveWebStorageSettings(button) {
  const root = $("webStorageRoot")?.value.trim() || "";
  const migrate = Boolean($("webStorageMigrate")?.checked);
  if (!root) return notify("请选择运行根目录", "error");
  if (!await confirmModal("保存后会停止当前转发、迁移数据并重启 Terma。继续？", "更改数据路径", "保存并重启", "取消", true)) return;
  try {
    setButtonBusy(button, true, "正在保存");
    const result = await api("/api/desktop-settings", {method:"PUT", body:JSON.stringify({root, migrate})});
    notify("数据路径已保存，正在重启 Terma", "success");
    await waitForStorageRestart(result.data_dir);
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || "数据路径保存失败", "error");
  }
}

async function waitForStorageRestart(expectedDataDir) {
  await new Promise(resolve => setTimeout(resolve, 900));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`/api/desktop-settings?restart=${Date.now()}`, {cache:"no-store"});
      if (response.ok) {
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
  throw new Error("重启等待超时，请手动刷新页面查看状态");
}

function desktopBehaviorPanelHtml() {
  if (!desktopSettings?.available) return "";
  const settings = desktopSettings.settings || {};
  const xserver = desktopSettings.xserver || {};
  const xserverState = xserver.available ? `已就绪${xserver.display ? ` · ${xserver.display}` : ""}` : xserver.installed ? "可启动" : "未安装";
  return `<section class="desktop-settings-section">
    <h3>桌面端行为</h3>
    <div class="muted">这些选项只在本机桌面版显示。</div>
    <div class="desktop-settings-grid">
      <div class="desktop-toggle-list">
        <label class="check-row"><input id="desktopOpenAtLogin" type="checkbox" ${settings.openAtLogin ? "checked" : ""}> 开机后自动启动桌面端</label>
        <label class="check-row"><input id="desktopMinimizeToTray" type="checkbox" ${settings.minimizeToTray ? "checked" : ""}> 关闭窗口时最小化到托盘</label>
        <label class="check-row"><input id="desktopStartMinimized" type="checkbox" ${settings.startMinimizedToTray ? "checked" : ""}> 开机自动启动时静默到托盘</label>
        <label class="check-row"><input id="desktopStartupNotification" type="checkbox" ${settings.showStartupNotification ? "checked" : ""}> 启动完成后显示系统通知</label>
        <label class="check-row"><input id="desktopXServerAutoStart" type="checkbox" ${settings.xServerAutoStart !== false ? "checked" : ""}> 启动 Terma 时自动准备 X Server</label>
      </div>
    </div>
    <div class="desktop-runtime-row"><span>${icon(xserver.available ? "circle-check" : xserver.installed ? "circle-pause" : "circle-alert")}<b>X Server</b><small>${esc(xserverState)}</small></span><button type="button" onclick="openXServerManager()">${icon("x11")}<span>管理</span></button></div>
    <div class="actions"><button id="desktopSettingsSaveBtn" class="primary" type="button" onclick="saveDesktopSettings(this)">${icon("save")}<span>保存桌面行为</span></button></div>
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
  } catch (error) { notify(error.message || "目录选择失败", "error"); }
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
    "更改数据路径",
    "是否立即把当前连接、设置、日志和 Terma 管理的 SSH 密钥复制到新路径？迁移完成后会重启，原目录仍会保留用于回退。仅切换路径不会删除旧数据，但新位置可能显示为空。",
    [
      {label:"迁移并重启", value:"migrate", className:"primary"},
      {label:"仅切换并重启", value:"switch"},
      {label:"取消", value:"cancel"}
    ]
  );
}

async function saveDesktopSettings(button=$("desktopSettingsSaveBtn")) {
  const migrationChoice = await chooseDesktopStorageMigration();
  if (migrationChoice === "cancel") return;
  try {
    setButtonBusy(button, true, "正在保存");
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
    notify(result.migration_requested ? "正在迁移数据，完成后 Terma 会自动重启" : "桌面设置已保存，Terma 正在重启", "success");
  } catch (error) {
    setButtonBusy(button, false);
    notify(error.message || "桌面设置保存失败", "error");
  }
}
