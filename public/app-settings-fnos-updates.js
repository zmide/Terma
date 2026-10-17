// fnOS shares release metadata and notes; installing stays with Application Center.
function fnosReleaseAsset(update) {
  const arch = update?.download_status?.arch;
  const version = String(update?.latest_version || "").replace(/^v/i, "");
  if (!["x64", "arm64"].includes(arch) || !/^\d+(?:\.\d+)+$/.test(version)) return null;
  const name = `Terma-${version}-fnos-${arch}.fpk`;
  try {
    const release = new URL(String(update.release_url || ""));
    if (release.origin !== "https://github.com" || release.username || release.password || release.search || release.hash
      || ![version, `v${version}`].some(tag => release.pathname === `/zmide/Terma/releases/tag/${tag}`)) return null;
    const expected = `${release.origin}${release.pathname.replace("/tag/", "/download/")}/${encodeURIComponent(name)}`;
    return (Array.isArray(update.assets) ? update.assets : []).find(asset => asset?.name === name && asset.url === expected) || null;
  } catch { return null; }
}

function fnosUpdateStatusHtml(update, options={}) {
  const checking = Boolean(options.checking);
  const available = Boolean(update?.update_available || update?.republished_available);
  const version = update?.current_version ? `v${String(update.current_version).replace(/^v/i, "")}` : tr("settings:updates.current_unknown");
  const latest = update?.latest_version ? `v${String(update.latest_version).replace(/^v/i, "")}` : "";
  const status = checking ? "settings:updates.checking_short"
    : update?.error ? "settings:updates.check_failed"
    : !latest ? "settings:auto.update_not_checked"
    : update.republished_available ? "settings:auto.update_republished"
    : available ? "settings:auto.update_available" : "settings:auto.update_latest";
  const checked = update?.checked_at ? new Date(update.checked_at).toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false}) : tr("settings:auto.update_not_checked");
  const asset = fnosReleaseAsset(update);
  const digest = /^sha256:[a-f0-9]{64}$/i.test(asset?.digest || "") ? asset.digest.slice(7) : "";
  const releaseUrl = safeGitHubReleaseUrl(update?.release_url);
  const notes = options.preserveNotes || options.deferNotes ? '<div data-update-notes-slot hidden></div>' : updateReleaseNotesHtml(update);
  const error = update?.error || update?.check_error;
  return `<div class="update-card fnos-update-card">
    <div class="update-card-head"><strong>${esc(tr("settings:auto.github_release_updates"))}</strong><span>${esc(tr("settings:auto.current_version", {version}))}</span></div>
    <dl class="update-details">
      <div><dt>${esc(tr("settings:updates.status"))}</dt><dd><span class="status-pill ${update?.error ? "failed" : available ? "reconnecting" : "running"}">${esc(tr(status))}</span><small>${esc(tr("settings:auto.last_checked", {status:checked}))}</small></dd></div>
      ${latest ? `<div><dt>${esc(tr("settings:auto.latest_version"))}</dt><dd><strong>${esc(latest)}</strong></dd></div>` : ""}
      ${asset ? `<div><dt>${esc(tr("settings:auto.asset"))}</dt><dd><strong>${esc(asset.name)}</strong><small>fnOS · ${esc(update.download_status.arch)} · FPK</small>${digest ? `<small class="fnos-update-digest">SHA-256: ${esc(digest)}</small>` : ""}</dd></div>` : ""}
    </dl>
    ${error ? `<div class="warning">${esc(localizedUpdateStatusError(error))}</div>` : ""}
    ${notes}
    <div class="actions update-actions">
      <button id="checkUpdateBtn" data-action="fnos-check-updates"${checking ? ' disabled aria-busy="true"' : ""}>${icon("refresh-cw")}<span>${esc(tr(checking ? "settings:updates.checking_short" : "settings:auto.check_updates"))}</span></button>
      ${releaseUrl ? `<a class="button-link" href="${escAttr(releaseUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}<span>${esc(tr("settings:updates.view_release"))}</span></a>` : ""}
    </div>
    ${asset ? updateManualDownloadLinksHtml(update, {delegated:true}) : ""}
    <p class="muted">${esc(tr("settings:updates.fnos_managed"))}</p>
    ${latest && !asset ? `<p class="muted">${esc(tr("settings:updates.fnos_no_asset"))}</p>` : ""}
  </div>`;
}

registerTermaAction("fnos-check-updates", () => refreshUpdateStatus(true));
registerTermaAction("fnos-probe-download-links", () => probeUpdateDownloadLinks());
