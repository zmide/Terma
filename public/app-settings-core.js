let aboutSettings = null;
let updateSettings = null;
let runtimeSettings = null;
let desktopSettings = null;
let sftpDownloadSettings = null;
let programCacheSettings = null;
let sshTrustedHosts = [];
let sshTrustedHostsPage = 1;
let sshTrustedHostsPageSize = 20;
let sshTrustedHostsTotal = 0;
let sshTrustedHostsTotalPages = 0;
let runtimeSettingsMessage = null;
let runtimeSettingsCheck = null;
let licenseModalKeyHandler = null;
let updateDownloadPollingTimer = null;
const SETTINGS_SECTION_META = {
  "settings-general": "通用设置",
  "settings-basic": "安全设置",
  "settings-notifications": "通知设置",
  "settings-runtime": "启动与运行",
  "settings-cache": "缓存管理",
  "settings-about": "关于"
};
let activeSettingsSection = "settings-general";
const UPDATE_NOTICE_SESSION_KEY = "termaUpdateReadVersion";
const LEGACY_UPDATE_NOTICE_SESSION_KEY = "tunneldeskUpdateReadVersion";
let updateNoticeReadVersion = "";
try {
  updateNoticeReadVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY) || sessionStorage.getItem(LEGACY_UPDATE_NOTICE_SESSION_KEY) || "";
  if (updateNoticeReadVersion) sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, updateNoticeReadVersion);
} catch {}

function captureSettingsPane() {
  return typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
}

function settingsQueryAll(selector) {
  const scope = typeof currentWorkspaceDomScope === "function" ? currentWorkspaceDomScope() : null;
  return (scope || document).querySelectorAll(selector);
}

function normalizeSettingsSection(id) {
  if (id === "settings-advanced") return "settings-basic";
  return Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_META, id) ? id : "settings-general";
}

function currentUpdateNoticeVersion() {
  return String(updateSettings?.latest_version || "").trim().replace(/^v/i, "");
}

function shouldShowUpdateNotice() {
  const latestVersion = currentUpdateNoticeVersion();
  return Boolean(updateSettings?.update_available && !updateSettings?.update_ignored && latestVersion && latestVersion !== updateNoticeReadVersion);
}

function syncUpdateNoticeDots() {
  const visible = shouldShowUpdateNotice();
  for (const id of ["navSettingsUpdateDot", "mobileSettingsUpdateDot", "settingsExplorerUpdateDot"]) {
    const dot = $(id);
    if (dot) dot.hidden = !visible;
  }
}

function markUpdateNoticeRead() {
  const latestVersion = currentUpdateNoticeVersion();
  if (!latestVersion || !updateSettings?.update_available) return;
  updateNoticeReadVersion = latestVersion;
  try { sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, latestVersion); } catch {}
  syncUpdateNoticeDots();
}

function syncUpdateNoticeForCurrentSection() {
  if (activeView === "settings" && activeSettingsSection === "settings-about" && updateSettings?.update_available) {
    markUpdateNoticeRead();
  } else {
    syncUpdateNoticeDots();
  }
}

async function loadCachedUpdateStatus() {
  const inPane = captureSettingsPane();
  try {
    const [status, download] = await Promise.all([
      api("/api/updates/status"),
      api("/api/updates/download/status").catch(()=>null)
    ]);
    if (status && typeof status === "object") updateSettings = status;
    if (updateSettings && download) updateSettings.download_status = download;
    inPane(() => {
      const area = $("updateCheckArea");
      if (area) area.innerHTML = updateStatusHtml();
      syncUpdateNoticeForCurrentSection();
    });
    if (download?.state === "downloading") startUpdateDownloadPolling(inPane);
  } catch {}
}

async function loadSecuritySettings() {
  securitySettings = await api("/api/security");
  return securitySettings;
}

async function loadTrustedSshHosts(page = sshTrustedHostsPage) {
  const requestedPage = Math.max(1, Number(page) || 1);
  const result = await api(`/api/ssh/trusted-hosts?page=${requestedPage}&page_size=${sshTrustedHostsPageSize}`, {skipSftpConnect:true, skipHostTrustPrompt:true});
  sshTrustedHosts = Array.isArray(result.hosts) ? result.hosts : [];
  sshTrustedHostsPage = Number(result.page || requestedPage);
  sshTrustedHostsPageSize = Number(result.page_size || sshTrustedHostsPageSize);
  sshTrustedHostsTotal = Number(result.total || 0);
  sshTrustedHostsTotalPages = Number(result.total_pages || 0);
  const panel = $("sshHostTrustPanel");
  if (panel) panel.outerHTML = sshHostTrustPanelHtml();
  return sshTrustedHosts;
}

async function changeTrustedSshHostsPage(page) {
  const target = Math.max(1, Math.min(sshTrustedHostsTotalPages || 1, Number(page) || 1));
  if (target === sshTrustedHostsPage && sshTrustedHosts.length) return;
  await loadTrustedSshHosts(target);
}

function sshHostTrustPanelHtml() {
  const rows = sshTrustedHosts.map(item => `<div class="ssh-trust-record">
    <div class="ssh-trust-record-main"><strong>${esc(item.host_label || `${item.host}:${item.port}`)}</strong><span>${esc(item.key_type || "未知算法")}</span><code>${esc(item.fingerprint || "")}</code></div>
    <div class="ssh-trust-record-side"><span>${item.updated_at ? esc(new Date(item.updated_at).toLocaleString("zh-CN", {hour12:false})) : ""}</span><button class="icon-button danger" type="button" title="删除信任记录" aria-label="删除信任记录" onclick="removeTrustedSshHost('${escAttr(item.id)}')">${icon("trash-2")}</button></div>
  </div>`).join("");
  const pager = sshTrustedHostsTotalPages > 1 ? `<div class="ssh-trust-pager" aria-label="SSH 主机信任分页">
      <button class="icon-button" type="button" title="上一页" aria-label="上一页" ${sshTrustedHostsPage <= 1 ? "disabled" : ""} onclick="changeTrustedSshHostsPage(${sshTrustedHostsPage - 1})">${icon("chevron-left")}</button>
      <span>第 ${sshTrustedHostsPage} / ${sshTrustedHostsTotalPages} 页，共 ${sshTrustedHostsTotal} 条</span>
      <button class="icon-button" type="button" title="下一页" aria-label="下一页" ${sshTrustedHostsPage >= sshTrustedHostsTotalPages ? "disabled" : ""} onclick="changeTrustedSshHostsPage(${sshTrustedHostsPage + 1})">${icon("chevron-right")}</button>
    </div>` : (sshTrustedHostsTotal ? `<div class="ssh-trust-pager"><span>共 ${sshTrustedHostsTotal} 条</span></div>` : "");
  return `<section id="sshHostTrustPanel" class="ssh-trust-settings-section">
    <h3>SSH 主机信任</h3>
    <div class="muted">首次连接会要求核对主机指纹；已保存的指纹发生变化时会显示红色警告，并由你决定仅本次信任、更新记录或取消。</div>
    <div class="ssh-trust-records">${rows || `<div class="ui-state empty compact"><span class="ui-state-icon" aria-hidden="true"></span><strong>暂无已信任主机</strong><span>首次连接 SSH 主机后会在这里显示。</span></div>`}</div>
    ${pager}
  </section>`;
}

async function removeTrustedSshHost(id) {
  const record = sshTrustedHosts.find(item => item.id === id);
  if (!record) return;
  const confirmed = await confirmModal(
    `删除 ${record.host_label || record.host} 的 ${record.key_type} 指纹后，下次连接会重新要求确认。`,
    "删除 SSH 主机信任",
    "删除",
    "取消",
    true
  );
  if (!confirmed) return;
  try {
    await api("/api/ssh/trusted-hosts", {method:"DELETE", body:JSON.stringify({id}), skipHostTrustPrompt:true});
    await loadTrustedSshHosts();
    notify("SSH 主机信任记录已删除", "success");
  } catch (error) {
    notify(error.message || "删除 SSH 主机信任记录失败", "error");
  }
}
