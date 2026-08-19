function localizedUpdateStatusError(value) {
  const message = String(value || "").trim();
  if (!message) return tr("settings:updates.check_unavailable");
  if (!String(document.documentElement.lang || "zh-CN").toLowerCase().startsWith("en")) return message;
  if (/正式版本数据无效|返回的数据无法解析/.test(message)) return tr("settings:updates.invalid_release_data");
  if (/超时/.test(message)) return tr("settings:updates.check_timeout");
  if (/尚未发布正式版本/.test(message)) return tr("settings:updates.no_formal_release");
  if (/[\u3400-\u9fff]/.test(message)) return tr("settings:updates.github_connection_failed");
  return message;
}

const UPDATE_RELEASE_MARKUP_CACHE_LIMIT = 32;
const UPDATE_RELEASE_NOTES_TEXT_LIMIT = 12000;
const updateReleaseMarkupCache = new Map();
const updateReleaseItemRenderCache = new WeakMap();

function updateReleaseHistory(update) {
  return Array.isArray(update?.release_notes) && update.release_notes.length
    ? update.release_notes.slice(0, 10)
    : update?.notes
      ? [{version:update.latest_version, published_at:update.published_at, notes:update.notes}]
      : [];
}

function updateReleaseNotesKey(update) {
  const language = String(document.documentElement.lang || "zh-CN").toLowerCase();
  const history = updateReleaseHistory(update);
  if (!history.length) return "";
  return JSON.stringify([language, history.map(item => [
    String(item?.version || ""),
    String(item?.published_at || ""),
    updateReleaseRenderData(item).fingerprint
  ])]);
}

function updateReleaseTextFingerprint(value) {
  const source = String(value || "");
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ code) >>> 0;
  }
  return `${source.length}:${first.toString(36)}:${second.toString(36)}`;
}

function updateReleaseRenderData(item) {
  const language = String(document.documentElement.lang || "zh-CN").toLowerCase();
  const source = String(item?.notes || "");
  if (item && typeof item === "object") {
    const cached = updateReleaseItemRenderCache.get(item);
    if (cached?.language === language && cached.source === source) return cached;
  }
  const notes = localizedUpdateReleaseMarkdown(source).slice(0, UPDATE_RELEASE_NOTES_TEXT_LIMIT);
  const rendered = {language, source, notes, fingerprint:updateReleaseTextFingerprint(notes)};
  if (item && typeof item === "object") updateReleaseItemRenderCache.set(item, rendered);
  return rendered;
}

function cachedUpdateReleaseMarkup(key, render) {
  if (updateReleaseMarkupCache.has(key)) {
    const cached = updateReleaseMarkupCache.get(key);
    updateReleaseMarkupCache.delete(key);
    updateReleaseMarkupCache.set(key, cached);
    return cached;
  }
  const markup = render();
  updateReleaseMarkupCache.set(key, markup);
  while (updateReleaseMarkupCache.size > UPDATE_RELEASE_MARKUP_CACHE_LIMIT) {
    updateReleaseMarkupCache.delete(updateReleaseMarkupCache.keys().next().value);
  }
  return markup;
}

function yieldBeforeUpdateRender() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function nextUpdateNotesFrame() {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, 50);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        finish();
      });
    }
  });
}

function updateStatusHtml(options={}) {
  const update = updateSettings;
  const checking = Boolean(options.checking ?? updateStatusChecking);
  const checkButtonState = checking ? ` disabled aria-busy="true"` : "";
  const downloadButtonState = checking ? ` disabled aria-busy="true"` : "";
  if (!update) {
    return `<div class="update-card"><div class="update-card-head"><strong>${esc(tr("settings:auto.github_release_updates"))}</strong><span>${esc(tr("settings:updates.reading_version"))}</span></div><div class="update-status checking"><div><strong>${esc(tr("settings:updates.checking"))}</strong><span>${esc(tr("settings:updates.reading_releases"))}</span></div><span class="status-pill">${esc(tr("settings:updates.checking_short"))}</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)"${checkButtonState}>${icon("refresh-cw")}<span>${esc(tr(checking ? "settings:updates.checking_short" : "settings:updates.check_again"))}</span></button></div></div>`;
  }
  if (update.error) {
    return `<div class="update-card"><div class="update-card-head"><strong>${esc(tr("settings:auto.github_release_updates"))}</strong><span>${esc(tr("settings:updates.check_failed"))}</span></div><div class="update-status failed"><div><strong>${esc(tr("settings:updates.check_unavailable"))}</strong><span>${esc(localizedUpdateStatusError(update.error))}</span></div><span class="status-pill failed">${esc(tr("settings:updates.failed"))}</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)"${checkButtonState}>${icon("refresh-cw")}<span>${esc(tr(checking ? "settings:updates.checking_short" : "common:actions.retry"))}</span></button></div></div>`;
  }
  const currentVersion = update.current_version ? `v${String(update.current_version).replace(/^v/i, "")}` : tr("settings:updates.current_unknown");
  if (!update.latest_version) {
    return `<div class="update-card"><div class="update-card-head"><strong>${esc(tr("settings:auto.github_release_updates"))}</strong><span>${esc(currentVersion)}</span></div><div class="update-status"><div><strong>${esc(tr("settings:auto.update_not_checked"))}</strong><span>${esc(tr("settings:updates.auto_refresh_hint"))}</span></div><span class="status-pill">${esc(tr("settings:updates.pending_check"))}</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)"${checkButtonState}>${icon("refresh-cw")}<span>${esc(tr(checking ? "settings:updates.checking_short" : "settings:updates.check_now"))}</span></button></div></div>`;
  }
  const latestVersion = update.latest_version ? `v${String(update.latest_version).replace(/^v/i, "")}` : tr("settings:auto.update_no_release");
  const republished = Boolean(update.republished_available);
  const releaseAvailable = Boolean(update.update_available || republished);
  const locale = document.documentElement.lang || "zh-CN";
  const checkedAt = update.checked_at ? new Date(update.checked_at).toLocaleString(locale, {hour12:false}) : tr("settings:auto.update_not_checked");
  const publishedAt = update.published_at ? new Date(update.published_at).toLocaleDateString(locale) : "";
  // A completed manual update makes any persisted download result irrelevant.
  const download = releaseAvailable ? (update.download_status || {}) : {};
  const progress = Math.max(0, Math.min(100, Number(download.progress_percent || 0)));
  const statusLabel = download.state === "downloading"
    ? download.phase === "probing"
      ? tr("settings:auto.update_speed_test")
      : download.phase === "verifying"
        ? tr("settings:auto.update_verify")
        : tr("settings:auto.update_download")
    : download.state === "downloaded"
      ? tr("settings:auto.update_downloaded")
      : download.state === "failed"
        ? tr("settings:auto.update_failed")
        : tr(republished ? "settings:auto.update_republished" : update.update_available ? "settings:auto.update_available" : "settings:auto.update_latest");
  const resourceName = releaseAvailable
    ? download.selected_asset_name || download.asset_name || tr("settings:auto.update_no_asset")
    : tr("settings:auto.update_no_download", {defaultValue:"当前无需下载"});
  const platformLabels = {win32:"Windows", darwin:"macOS", linux:"Linux"};
  const packageLabels = {portable:tr("settings:auto.update_portable", {defaultValue:"便携版"}), installer:tr("settings:auto.update_installer", {defaultValue:"安装版"}), dmg:"DMG", zip:"ZIP", appimage:"AppImage", deb:"DEB", rpm:"RPM"};
  const target = [platformLabels[download.platform] || download.platform, download.arch, packageLabels[download.package_type] || download.package_type].filter(Boolean).join(" · ");
  const progressText = download.state === "downloading"
    ? download.phase === "probing"
      ? tr("settings:updates.testing_routes")
      : download.phase === "verifying"
        ? tr("settings:updates.verifying_sha", {progress:100})
        : `${Math.round(progress)}% · ${formatUpdateBytes(download.bytes_downloaded)} / ${formatUpdateBytes(download.size || download.selected_asset_size)}`
    : download.state === "downloaded"
      ? `100% · ${formatUpdateBytes(download.size)}`
      : `${Math.round(progress)}%`;
  const sourceSpeed = formatUpdateSpeed(download.source_speed_bytes_per_second);
  const sourceLabel = download.source_id === "direct" ? tr("settings:updates.direct_route") : download.source_label;
  const sourceText = download.phase === "probing"
    ? tr("settings:auto.update_parallel_speed")
    : sourceLabel
      ? `${sourceLabel}${sourceSpeed ? tr("settings:updates.speed_suffix", {speed:sourceSpeed}) : ""}`
      : releaseAvailable
        ? tr("settings:auto.select_fastest_route")
        : "";
  const notes = options.preserveNotes || options.deferNotes
    ? `<div data-update-notes-slot hidden></div>`
    : updateReleaseNotesHtml(update);
  const checkError = update.check_error
    ? `<div class="warning">${esc(localizedUpdateStatusError(update.check_error))}</div>`
    : "";
  const releaseUrl = safeGitHubReleaseUrl(update.release_url);
  const releaseLink = releaseUrl ? `<a class="button-link" href="${escAttr(releaseUrl)}" target="_blank" rel="noopener">${icon("external-link")}<span>${esc(tr("settings:updates.view_release"))}</span></a>` : "";
  const selectedAsset = Array.isArray(update.assets) ? update.assets.find(asset => asset?.name === (download.selected_asset_name || download.asset_name)) : null;
  const downloadedDigestMatches = !republished || !selectedAsset?.digest || !download.digest || selectedAsset.digest === download.digest;
  const downloadedCurrent = download.state === "downloaded"
    && String(download.version || "").replace(/^v/i, "") === String(update.latest_version || "").replace(/^v/i, "")
    && Boolean(download.asset_name)
    && download.asset_name === download.selected_asset_name
    && downloadedDigestMatches;
  const openDirectoryAction = download.can_open_directory
    ? `<button onclick="openDownloadedUpdateDirectory()">${icon("folder-open")}<span>${esc(tr("settings:updates.open_download_directory"))}</span></button>`
    : "";
  const redownloadAction = downloadedCurrent
    ? `<button id="downloadUpdateBtn" onclick="downloadUpdatePackage(true)"${downloadButtonState}>${icon("download")}<span>${esc(tr("settings:auto.update_redownload"))}</span></button>`
    : "";
  const downloadAction = releaseAvailable
    ? downloadedCurrent
      ? download.package_type === "portable"
        ? `${openDirectoryAction || `<span class="muted">${esc(tr("settings:updates.portable_ready_hint"))}</span>`}${redownloadAction}`
        : `${download.can_open ? `<button class="primary" onclick="openDownloadedUpdate()">${icon("package-open")}<span>${esc(tr("settings:updates.open_verified_package"))}</span></button>` : ""}${openDirectoryAction || (!download.can_open ? `<span class="muted">${esc(tr("settings:updates.installer_ready_hint"))}</span>` : "")}${redownloadAction}`
      : download.state === "downloading"
        ? `<button id="downloadUpdateBtn" disabled>${icon("download")}<span>${esc(tr(download.phase === "probing" ? "settings:auto.update_speed_test" : download.phase === "verifying" ? "settings:auto.update_verify" : "settings:auto.update_download"))}</span></button>`
        : `<button id="downloadUpdateBtn" class="primary" onclick="downloadUpdatePackage()"${downloadButtonState}>${icon("download")}<span>${esc(tr(download.state === "failed" ? "settings:updates.redownload_verify" : "settings:auto.update_download_verify"))}</span></button>`
    : "";
  const downloadError = download.state === "failed" && download.error ? `<div class="warning">${esc(tr("settings:updates.download_failed_detail", {error:download.error}))}</div>` : "";
  const republishedNotice = republished ? `<div class="warning">${esc(tr("settings:updates.republished_hint", {version:latestVersion}))}</div>` : "";
  const ignoreControl = update.update_available
    ? `<label class="check-row update-ignore-row"><input id="updateIgnoreCurrentVersion" type="checkbox" ${update.update_ignored ? "checked" : ""}${checking ? " disabled" : ""} onchange="setUpdateVersionIgnored(this)"> ${esc(tr("settings:auto.ignore_version", {version:latestVersion}))}</label><div class="muted update-ignore-help">${esc(tr("settings:auto.ignore_version_hint"))}</div>`
    : "";
  return `<div class="update-card">
    <div class="update-card-head"><strong>${esc(tr("settings:auto.github_release_updates"))}</strong><span>${esc(tr("settings:auto.current_version", {version:currentVersion}))}</span></div>
    <dl class="update-details">
      <div><dt>${esc(tr("settings:updates.status"))}</dt><dd><span class="status-pill ${download.state === "failed" ? "failed" : releaseAvailable ? "reconnecting" : "running"}">${esc(statusLabel)}</span><small>${esc(tr("settings:auto.last_checked", {status:checkedAt}))}</small></dd></div>
      <div><dt>${esc(tr("settings:auto.latest_version"))}</dt><dd><strong>${esc(latestVersion)}</strong>${publishedAt ? `<small>${esc(tr("settings:auto.published_at", {date:publishedAt}))}</small>` : ""}</dd></div>
      <div><dt>${esc(tr("settings:auto.asset"))}</dt><dd><strong title="${escAttr(resourceName)}">${esc(resourceName)}</strong>${target ? `<small>${esc(target)}</small>` : ""}</dd></div>
      ${sourceText ? `<div><dt>${esc(tr("settings:auto.route"))}</dt><dd><strong>${esc(sourceText)}</strong><small>${esc(tr("settings:auto.route_fallback"))}</small></dd></div>` : ""}
      <div><dt>${esc(tr("settings:auto.progress"))}</dt><dd><strong>${esc(progressText)}</strong><div class="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div></dd></div>
    </dl>
    ${republishedNotice}${checkError}${notes}${downloadError}
    <div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)"${checkButtonState}>${icon("refresh-cw")}<span>${esc(tr(checking ? "settings:updates.checking_short" : "settings:auto.check_updates"))}</span></button>${downloadAction}${releaseLink}</div>
    ${ignoreControl}
    <div class="muted">${esc(tr("settings:auto.update_security_hint"))}</div>
  </div>`;
}

function safeUpdateMarkdownUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    const fragment = String(value || "").trim();
    return /^#[\p{L}\p{N}_-]+$/u.test(fragment) ? fragment : "";
  }
}

function updateMarkdownInlineHtml(value) {
  const tokens = [];
  const placeholder = html => {
    const index = tokens.push(html) - 1;
    return `\uE000${index}\uE001`;
  };
  let source = String(value || "");
  source = source.replace(/`([^`\n]+)`/g, (_, code) => placeholder(`<code>${esc(code)}</code>`));
  source = source.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safe = safeUpdateMarkdownUrl(href);
    return safe ? placeholder(`<a href="${escAttr(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`) : match;
  });
  let html = esc(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return html.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
}

function updateMarkdownHtml(value, displayedVersion = "") {
  const lines = String(value || tr("settings:updates.no_release_notes")).slice(0, 12000).replace(/\r\n?/g, "\n").split("\n");
  const normalizedVersion = String(displayedVersion || "").trim().replace(/^v/i, "").toLowerCase();
  if (normalizedVersion) {
    const firstContentIndex = lines.findIndex(line => line.trim());
    const firstHeading = firstContentIndex >= 0 ? /^#{1,6}\s+(.+?)\s*$/.exec(lines[firstContentIndex].trim()) : null;
    const headingVersion = String(firstHeading?.[1] || "").trim().replace(/^\[|\]$/g, "").replace(/^v/i, "").toLowerCase();
    if (firstHeading && headingVersion === normalizedVersion) lines.splice(firstContentIndex, 1);
  }
  const result = [];
  let paragraph = [];
  let list = "";
  const closeList = () => {
    if (!list) return;
    result.push(`</${list}>`);
    list = "";
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    result.push(`<p>${updateMarkdownInlineHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    closeList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*<!--(?:[\s\S]*?)-->\s*$/.test(line)) continue;
    if (/^\s*<a\b[^>]*\bid\s*=\s*["'][^"']+["'][^>]*>\s*<\/a>\s*$/i.test(line)) continue;
    if (/^```/.test(line.trim())) {
      flushBlocks();
      const code = [];
      for (index += 1; index < lines.length && !/^```/.test(lines[index].trim()); index += 1) code.push(lines[index]);
      result.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flushBlocks();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushBlocks();
      const level = Math.min(6, heading[1].length + 3);
      result.push(`<h${level}>${updateMarkdownInlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushBlocks();
      result.push("<hr>");
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const nextList = unordered ? "ul" : "ol";
      if (list && list !== nextList) closeList();
      if (!list) {
        list = nextList;
        result.push(`<${list}>`);
      }
      result.push(`<li>${updateMarkdownInlineHtml((unordered || ordered)[1])}</li>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushBlocks();
      result.push(`<blockquote>${updateMarkdownInlineHtml(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushBlocks();
  return result.join("");
}

function localizedUpdateReleaseMarkdown(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  const requestedLanguage = String(document.documentElement.lang || "zh-CN").toLowerCase().startsWith("en") ? "en" : "zh";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const languageHeadings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[index].trim());
    if (!heading) continue;
    const label = heading[1].replace(/<[^>]+>/g, "").trim().toLowerCase();
    const language = /^(?:english|en(?:-us)?)(?:\s+version)?$/.test(label)
      ? "en"
      : /^(?:简体中文|中文|zh(?:-cn)?|chinese)(?:\s+version)?$/.test(label)
        ? "zh"
        : "";
    if (language) languageHeadings.push({index, language});
  }
  const selected = languageHeadings.find(item => item.language === requestedLanguage);
  if (selected) {
    const next = languageHeadings.find(item => item.index > selected.index);
    const localized = lines.slice(selected.index + 1, next?.index ?? lines.length).join("\n").trim();
    if (localized) return localized;
  }
  if (requestedLanguage === "en" && /[\u3400-\u9fff]/.test(source)) {
    return tr("settings:updates.notes_language_unavailable", {defaultValue:"English release notes are not available for this older version. Open its GitHub release page to view the original notes."});
  }
  return source;
}

function updateReleaseNotesHtml(update) {
  const history = updateReleaseHistory(update);
  if (!history.length) return "";
  return `${updateReleaseNotesShellHtml()}${history.map(updateReleaseEntryHtml).join("")}</div></div>`;
}

function updateReleaseNotesShellHtml() {
  return `<div class="update-notes"><strong>${esc(tr("settings:auto.recent_release_notes", {defaultValue:"最近版本更新内容"}))}</strong><div class="update-release-list">`;
}

function updateReleaseEntryHtml(item, index) {
  const version = String(item?.version || "").replace(/^v/i, "");
  const published = item?.published_at ? new Date(item.published_at).toLocaleDateString(document.documentElement.lang || "zh-CN") : "";
  const releaseLabel = version ? `v${esc(version)}` : esc(tr(`settings:auto.${index === 0 ? "latest_release" : "previous_release"}`, {defaultValue:index === 0 ? "最新版本" : "上一版本"}));
  const renderData = updateReleaseRenderData(item);
  const cacheKey = JSON.stringify([
    renderData.language,
    String(index),
    String(item?.version || ""),
    String(item?.published_at || ""),
    renderData.fingerprint
  ]);
  return cachedUpdateReleaseMarkup(cacheKey, () => `<section class="update-release-entry"><div class="update-release-head"><b>${releaseLabel}</b>${index === 0 ? `<span class="status-pill running">${esc(tr("settings:auto.latest_badge", {defaultValue:"最新"}))}</span>` : ""}${published ? `<small>${esc(published)}</small>` : ""}</div><div class="update-release-markdown">${updateMarkdownHtml(renderData.notes, version)}</div></section>`);
}

let updateNotesScrollTop = 0;
let updateNotesRenderSequence = 0;

async function renderDeferredUpdateReleaseNotes(area, notesKey, history, renderSequence) {
  const slot = area.querySelector("[data-update-notes-slot]");
  if (!slot || !history.length) return;
  const notes = document.createElement("div");
  notes.className = "update-notes";
  notes._updateNotesKey = notesKey;
  notes._updateNotesRenderSequence = renderSequence;
  notes.innerHTML = `<strong>${esc(tr("settings:auto.recent_release_notes", {defaultValue:"最近版本更新内容"}))}</strong><div class="update-release-list"></div>`;
  slot.replaceWith(notes);
  const list = notes.querySelector(".update-release-list");
  for (let index = 0; index < history.length; index += 1) {
    await nextUpdateNotesFrame();
    if (renderSequence !== updateNotesRenderSequence || !notes.isConnected || notes._updateNotesKey !== notesKey) return;
    list.insertAdjacentHTML("beforeend", updateReleaseEntryHtml(history[index], index));
  }
  notes.scrollTop = Math.min(updateNotesScrollTop, Math.max(0, notes.scrollHeight - notes.clientHeight));
}

function renderUpdateStatus(options={}) {
  const area = $("updateCheckArea");
  if (!area) return;
  const currentNotes = area.querySelector(".update-notes");
  if (currentNotes) updateNotesScrollTop = Math.max(0, currentNotes.scrollTop);
  const nextNotesKey = updateReleaseNotesKey(updateSettings);
  const preservedNotes = currentNotes && nextNotesKey && currentNotes._updateNotesKey === nextNotesKey
    ? currentNotes
    : null;
  const deferredHistory = !preservedNotes && options.deferNotes ? updateReleaseHistory(updateSettings) : [];
  const deferNotes = Boolean(nextNotesKey && deferredHistory.length);
  const notesRenderSequence = preservedNotes
    ? Number(preservedNotes._updateNotesRenderSequence || updateNotesRenderSequence)
    : ++updateNotesRenderSequence;
  preservedNotes?.remove();
  area.innerHTML = updateStatusHtml({
    preserveNotes:Boolean(preservedNotes),
    deferNotes,
    checking:options.checking ?? updateStatusChecking
  });
  if (preservedNotes) {
    const slot = area.querySelector("[data-update-notes-slot]");
    if (slot) slot.replaceWith(preservedNotes);
  } else if (deferNotes) {
    void renderDeferredUpdateReleaseNotes(area, nextNotesKey, deferredHistory, notesRenderSequence);
  }
  const nextNotes = area.querySelector(".update-notes");
  if (nextNotes) {
    nextNotes._updateNotesKey = nextNotesKey;
    nextNotes.scrollTop = Math.min(updateNotesScrollTop, Math.max(0, nextNotes.scrollHeight - nextNotes.clientHeight));
  } else {
    updateNotesScrollTop = 0;
  }
  if (options.icons) refreshIcons();
}

function formatUpdateBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function safeGitHubReleaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.includes("/releases/") ? url.href : "";
  } catch {
    return "";
  }
}

async function refreshUpdateStatus(force=false) {
  const requestSequence = ++updateStatusRefreshSequence;
  updateStatusAbortController?.abort();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  updateStatusAbortController = controller;
  updateStatusChecking = true;
  const inPane = captureSettingsPane();
  const button = $("checkUpdateBtn");
  const previousUpdateStatus = updateSettings && typeof updateSettings === "object" ? updateSettings : null;
  setButtonBusy(button, true, tr("settings:updates.checking_short"));
  inPane(() => renderUpdateStatus({deferNotes:true, checking:true}));
  const previousDownloadStatus = updateSettings?.download_status && typeof updateSettings.download_status === "object"
    ? updateSettings.download_status
    : null;
  try {
    const requestOptions = controller ? {signal:controller.signal} : {};
    const status = await api(`/api/updates/check${force ? "?force=1" : ""}`, requestOptions);
    if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted) return;
    updateSettings = status && typeof status === "object"
      ? {...status, ...(previousDownloadStatus ? {download_status:previousDownloadStatus} : {})}
      : status;
    await yieldBeforeUpdateRender();
    if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted) return;
    inPane(() => {
      renderUpdateStatus({deferNotes:true, checking:true});
      syncUpdateNoticeForCurrentSection();
    });
    if (force && !updateSettings.update_ignored) notify(updateSettings.republished_available
      ? tr("settings:updates.republished_found", {version:`v${String(updateSettings.latest_version || "").replace(/^v/i, "")}`})
      : updateSettings.update_available
        ? tr("settings:updates.new_version_found", {version:`v${String(updateSettings.latest_version || "").replace(/^v/i, "")}`})
        : tr("settings:updates.already_latest"), updateSettings.update_available || updateSettings.republished_available ? "info" : "success");
    const download = await api("/api/updates/download/status", requestOptions).catch(() => null);
    if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted) return;
    if (download && updateSettings && typeof updateSettings === "object") {
      updateSettings.download_status = download;
      await yieldBeforeUpdateRender();
      if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted) return;
      inPane(() => renderUpdateStatus({deferNotes:true, checking:true}));
    }
  } catch (error) {
    if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted || error?.name === "AbortError") return;
    const message = error.message || tr("settings:updates.github_connection_failed");
    updateSettings = previousUpdateStatus?.latest_version
      ? {...previousUpdateStatus, check_error:message}
      : {error:message, ...(previousDownloadStatus ? {download_status:previousDownloadStatus} : {})};
    await yieldBeforeUpdateRender();
    if (requestSequence !== updateStatusRefreshSequence || controller?.signal.aborted) return;
    inPane(() => {
      renderUpdateStatus({checking:true});
      syncUpdateNoticeForCurrentSection();
    });
    if (force) notify(localizedUpdateStatusError(message), "error");
  } finally {
    if (requestSequence === updateStatusRefreshSequence) {
      if (updateStatusAbortController === controller) updateStatusAbortController = null;
      updateStatusChecking = false;
      inPane(() => {
        renderUpdateStatus({deferNotes:true, checking:false});
        syncUpdateNoticeForCurrentSection();
      });
      if (updateSettings?.download_status?.state === "downloading") startUpdateDownloadPolling(inPane);
    }
  }
}

async function setUpdateVersionIgnored(input) {
  const inPane = captureSettingsPane();
  const enabled = Boolean(input?.checked);
  if (input) input.disabled = true;
  try {
    const status = await api(`/api/updates/ignore?enabled=${enabled ? "1" : "0"}`, {method:"POST", body:"{}"});
    const downloadStatus = updateSettings?.download_status;
    updateSettings = status;
    if (downloadStatus) updateSettings.download_status = downloadStatus;
    if (!enabled && updateNoticeReadVersion === currentUpdateNoticeVersion()) {
      updateNoticeReadVersion = "";
      try {
        sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
        sessionStorage.removeItem(LEGACY_UPDATE_NOTICE_SESSION_KEY);
      } catch {}
    }
    inPane(() => {
      renderUpdateStatus({icons:true});
    });
    syncUpdateNoticeDots();
    notify(tr(enabled ? "settings:updates.ignore_enabled" : "settings:updates.ignore_disabled", {version:`v${currentUpdateNoticeVersion()}`}), "success");
  } catch (error) {
    if (input) input.checked = !enabled;
    notify(error.message || tr("settings:updates.ignore_save_failed"), "error");
  } finally {
    inPane(() => {
      const current = $("updateIgnoreCurrentVersion");
      if (current) current.disabled = false;
    });
  }
}

function stopUpdateDownloadPolling() {
  if (updateDownloadPollingTimer) clearInterval(updateDownloadPollingTimer);
  updateDownloadPollingTimer = null;
}

async function refreshUpdateDownloadProgress(inPane=captureSettingsPane()) {
  try {
    const download = await api("/api/updates/download/status");
    if (!updateSettings) return;
    updateSettings.download_status = download;
    inPane(() => {
      renderUpdateStatus({icons:true});
    });
    if (download.state !== "downloading") stopUpdateDownloadPolling();
  } catch {}
}

function startUpdateDownloadPolling(inPane=captureSettingsPane()) {
  if (updateDownloadPollingTimer) return;
  updateDownloadPollingTimer = setInterval(() => refreshUpdateDownloadProgress(inPane), 500);
}

function formatUpdateSpeed(value) {
  const bytesPerSecond = Number(value || 0);
  return Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? `${formatUpdateBytes(bytesPerSecond)}/s` : "";
}

async function downloadUpdatePackage(redownload=false) {
  const inPane = captureSettingsPane();
  const republished = Boolean(updateSettings?.republished_available);
  if (!await confirmModal(
    tr(redownload ? "settings:updates.redownload_confirm" : republished ? "settings:updates.republished_confirm" : "settings:updates.download_confirm"),
    tr(redownload ? "settings:auto.update_redownload_action" : "settings:auto.update_download_verify"),
    tr(redownload ? "settings:auto.update_redownload" : "settings:auto.update_start"),
    tr("common:actions.cancel")
  )) return;
  const button = $("downloadUpdateBtn");
  setButtonBusy(button, true, tr("settings:auto.update_speed_testing"));
  try {
    const request = api("/api/updates/download", {method:"POST", body:"{}"});
    startUpdateDownloadPolling(inPane);
    const result = await request;
    updateSettings.download_status = result;
    inPane(() => {
      renderUpdateStatus({icons:true});
    });
    notify(tr("settings:updates.package_verified"), "success");
  } catch (error) {
    const failedStatus = await api("/api/updates/download/status").catch(() => null);
    updateSettings.download_status = failedStatus || {
      ...(updateSettings.download_status || {}),
      state:"failed",
      error:error.message
    };
    inPane(() => {
      renderUpdateStatus({icons:true});
    });
    notify(error.message, "error");
  } finally {
    stopUpdateDownloadPolling();
    inPane(() => setButtonBusy(button, false));
  }
}

async function openDownloadedUpdate() {
  if (updateSettings?.download_status?.package_type === "portable") {
    return openDownloadedUpdateDirectory();
  }
  if (!await confirmModal(
    tr("settings:updates.open_package_confirm"),
    tr("settings:auto.update_open_package"),
    tr("settings:updates.open_package"),
    tr("common:actions.cancel")
  )) return;
  await api("/api/updates/open", {method:"POST", body:"{}"});
  notify(tr("settings:updates.package_opened"), "success");
}

async function openDownloadedUpdateDirectory() {
  const portable = updateSettings?.download_status?.package_type === "portable";
  const message = tr(portable ? "settings:updates.open_portable_directory_confirm" : "settings:updates.open_installer_directory_confirm");
  if (!await confirmModal(
    message,
    tr("settings:auto.update_open_download"),
    tr("settings:updates.open_directory"),
    tr("common:actions.cancel")
  )) return;
  await api("/api/updates/open-directory", {method:"POST", body:"{}"});
  notify(tr(portable ? "settings:updates.portable_directory_opened" : "settings:updates.directory_opened"), "success");
}
