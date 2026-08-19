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
let licenseModalTrigger = null;
let updateDownloadPollingTimer = null;
let updateStatusRefreshSequence = 0;
let updateStatusAbortController = null;
let updateStatusChecking = false;
const SETTINGS_SECTION_META = {
  "settings-general": "settings:sections.general",
  "settings-basic": "settings:sections.security",
  "settings-notifications": "settings:sections.notifications",
  "settings-runtime": "settings:sections.runtime",
  "settings-cache": "settings:sections.cache",
  "settings-about": "settings:sections.about"
};

function settingsSectionLabel(id) {
  return tr(SETTINGS_SECTION_META[id] || SETTINGS_SECTION_META["settings-general"]);
}
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
  const version = String(updateSettings?.latest_version || "").trim().replace(/^v/i, "");
  if (!version) return "";
  return updateSettings?.republished_available
    ? `${version}:r${Math.max(0, Number(updateSettings?.release_revision || 0))}`
    : version;
}

function shouldShowUpdateNotice() {
  const latestVersion = currentUpdateNoticeVersion();
  return Boolean((updateSettings?.update_available || updateSettings?.republished_available) && !updateSettings?.update_ignored && latestVersion && latestVersion !== updateNoticeReadVersion);
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
  if (!latestVersion || !(updateSettings?.update_available || updateSettings?.republished_available)) return;
  updateNoticeReadVersion = latestVersion;
  try { sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, latestVersion); } catch {}
  syncUpdateNoticeDots();
}

function syncUpdateNoticeForCurrentSection() {
  if (activeView === "settings" && activeSettingsSection === "settings-about" && (updateSettings?.update_available || updateSettings?.republished_available)) {
    markUpdateNoticeRead();
  } else {
    syncUpdateNoticeDots();
  }
}

async function loadCachedUpdateStatus() {
  const inPane = captureSettingsPane();
  const refreshSequence = updateStatusRefreshSequence;
  if (updateStatusChecking || updateStatusAbortController) return;
  try {
    const [status, download] = await Promise.all([
      api("/api/updates/status"),
      api("/api/updates/download/status").catch(()=>null)
    ]);
    if (refreshSequence !== updateStatusRefreshSequence || updateStatusChecking || updateStatusAbortController) return;
    if (status && typeof status === "object") updateSettings = status;
    if (updateSettings && download) updateSettings.download_status = download;
    inPane(() => {
      renderUpdateStatus({deferNotes:true});
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
  const removeLabel = tr("settings:trust.remove_record");
  const previousLabel = tr("settings:trust.previous_page");
  const nextLabel = tr("settings:trust.next_page");
  const rows = sshTrustedHosts.map(item => `<div class="ssh-trust-record">
    <div class="ssh-trust-record-main"><strong>${esc(item.host_label || `${item.host}:${item.port}`)}</strong><span>${esc(item.key_type || tr("settings:trust.unknown_algorithm"))}</span><code>${esc(item.fingerprint || "")}</code></div>
    <div class="ssh-trust-record-side"><span>${item.updated_at ? esc(new Date(item.updated_at).toLocaleString(document.documentElement.lang || undefined, {hour12:false})) : ""}</span><button class="icon-button danger" type="button" title="${escAttr(removeLabel)}" aria-label="${escAttr(removeLabel)}" onclick="removeTrustedSshHost('${escAttr(item.id)}')">${icon("trash-2")}</button></div>
  </div>`).join("");
  const pager = sshTrustedHostsTotalPages > 1 ? `<div class="ssh-trust-pager" aria-label="${escAttr(tr("settings:trust.pagination"))}">
      <button class="icon-button" type="button" title="${escAttr(previousLabel)}" aria-label="${escAttr(previousLabel)}" ${sshTrustedHostsPage <= 1 ? "disabled" : ""} onclick="changeTrustedSshHostsPage(${sshTrustedHostsPage - 1})">${icon("chevron-left")}</button>
      <span>${esc(tr("settings:trust.page_summary", {page:sshTrustedHostsPage, pages:sshTrustedHostsTotalPages, total:sshTrustedHostsTotal}))}</span>
      <button class="icon-button" type="button" title="${escAttr(nextLabel)}" aria-label="${escAttr(nextLabel)}" ${sshTrustedHostsPage >= sshTrustedHostsTotalPages ? "disabled" : ""} onclick="changeTrustedSshHostsPage(${sshTrustedHostsPage + 1})">${icon("chevron-right")}</button>
    </div>` : (sshTrustedHostsTotal ? `<div class="ssh-trust-pager"><span>${esc(tr("settings:trust.total", {total:sshTrustedHostsTotal}))}</span></div>` : "");
  return `<section id="sshHostTrustPanel" class="ssh-trust-settings-section">
    <h3>${esc(tr("settings:auto.ssh_host_trust"))}</h3>
    <div class="muted">${esc(tr("settings:auto.ssh_host_trust_hint"))}</div>
    <div class="ssh-trust-records">${rows || `<div class="ui-state empty compact"><span class="ui-state-icon" aria-hidden="true"></span><strong>${esc(tr("settings:auto.no_trusted_hosts"))}</strong><span>${esc(tr("settings:auto.trusted_hosts_hint"))}</span></div>`}</div>
    ${pager}
  </section>`;
}

async function removeTrustedSshHost(id) {
  const record = sshTrustedHosts.find(item => item.id === id);
  if (!record) return;
  const confirmed = await confirmModal(
    tr("settings:trust.delete_confirm", {host:record.host_label || record.host, type:record.key_type || tr("settings:trust.unknown_algorithm")}),
    tr("settings:trust.delete_title"),
    tr("common:actions.delete"),
    tr("common:actions.cancel"),
    true
  );
  if (!confirmed) return;
  try {
    await api("/api/ssh/trusted-hosts", {method:"DELETE", body:JSON.stringify({id}), skipHostTrustPrompt:true});
    await loadTrustedSshHosts();
    notify(tr("settings:trust.deleted"), "success");
  } catch (error) {
    notify(error.message || tr("settings:trust.delete_failed"), "error");
  }
}
