function updateStatusHtml() {
  const update = updateSettings;
  if (!update) {
    return `<div class="update-card"><div class="update-card-head"><strong>GitHub Release 更新</strong><span>正在读取版本信息</span></div><div class="update-status checking"><div><strong>正在检查更新</strong><span>正在读取 GitHub Releases。</span></div><span class="status-pill">检查中</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)">${icon("refresh-cw")}<span>重新检查</span></button></div></div>`;
  }
  if (update.error) {
    return `<div class="update-card"><div class="update-card-head"><strong>GitHub Release 更新</strong><span>检查失败</span></div><div class="update-status failed"><div><strong>暂时无法检查更新</strong><span>${esc(update.error)}</span></div><span class="status-pill failed">失败</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)">${icon("refresh-cw")}<span>重试</span></button></div></div>`;
  }
  const currentVersion = update.current_version ? `v${String(update.current_version).replace(/^v/i, "")}` : "当前版本未知";
  if (!update.latest_version) {
    return `<div class="update-card"><div class="update-card-head"><strong>GitHub Release 更新</strong><span>${esc(currentVersion)}</span></div><div class="update-status"><div><strong>尚未检查更新</strong><span>启动检查完成后会自动更新此处。</span></div><span class="status-pill">待检查</span></div><div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)">${icon("refresh-cw")}<span>立即检查</span></button></div></div>`;
  }
  const latestVersion = update.latest_version ? `v${String(update.latest_version).replace(/^v/i, "")}` : "尚无正式版本";
  const checkedAt = update.checked_at ? new Date(update.checked_at).toLocaleString("zh-CN", {hour12:false}) : "尚未检查";
  const publishedAt = update.published_at ? new Date(update.published_at).toLocaleDateString("zh-CN") : "";
  // A completed manual update makes any persisted download result irrelevant.
  const download = update.update_available ? (update.download_status || {}) : {};
  const progress = Math.max(0, Math.min(100, Number(download.progress_percent || 0)));
  const statusLabel = download.state === "downloading"
    ? download.phase === "probing"
      ? "正在测速"
      : download.phase === "verifying"
        ? "正在校验"
        : "下载中"
    : download.state === "downloaded"
      ? "已下载并校验"
      : download.state === "failed"
        ? "下载失败"
        : update.update_available ? "可更新" : "已是最新版";
  const resourceName = update.update_available
    ? download.selected_asset_name || download.asset_name || "未找到当前平台资源"
    : "当前无需下载";
  const platformLabels = {win32:"Windows", darwin:"macOS", linux:"Linux"};
  const packageLabels = {portable:"便携版", installer:"安装版", dmg:"DMG", zip:"ZIP", appimage:"AppImage", deb:"DEB", rpm:"RPM"};
  const target = [platformLabels[download.platform] || download.platform, download.arch, packageLabels[download.package_type] || download.package_type].filter(Boolean).join(" · ");
  const progressText = download.state === "downloading"
    ? download.phase === "probing"
      ? "正在测试直连和加速线路"
      : download.phase === "verifying"
        ? `100% · 正在校验 SHA-256`
        : `${Math.round(progress)}% · ${formatUpdateBytes(download.bytes_downloaded)} / ${formatUpdateBytes(download.size || download.selected_asset_size)}`
    : download.state === "downloaded"
      ? `100% · ${formatUpdateBytes(download.size)}`
      : `${Math.round(progress)}%`;
  const sourceSpeed = formatUpdateSpeed(download.source_speed_bytes_per_second);
  const sourceText = download.phase === "probing"
    ? "正在并行测速"
    : download.source_label
      ? `${download.source_label}${sourceSpeed ? ` · 测速 ${sourceSpeed}` : ""}`
      : update.update_available
        ? "下载前自动选择最快线路"
        : "";
  const notes = updateReleaseNotesHtml(update);
  const releaseUrl = safeGitHubReleaseUrl(update.release_url);
  const releaseLink = releaseUrl ? `<a class="button-link" href="${escAttr(releaseUrl)}" target="_blank" rel="noopener">${icon("external-link")}<span>查看 Release</span></a>` : "";
  const downloadedCurrent = download.state === "downloaded"
    && String(download.version || "").replace(/^v/i, "") === String(update.latest_version || "").replace(/^v/i, "")
    && Boolean(download.asset_name)
    && download.asset_name === download.selected_asset_name;
  const openDirectoryAction = download.can_open_directory
    ? `<button onclick="openDownloadedUpdateDirectory()">${icon("folder-open")}<span>打开下载目录</span></button>`
    : "";
  const redownloadAction = downloadedCurrent
    ? `<button id="downloadUpdateBtn" onclick="downloadUpdatePackage(true)">${icon("download")}<span>重新下载</span></button>`
    : "";
  const downloadAction = update.update_available
    ? downloadedCurrent
      ? download.package_type === "portable"
        ? `${openDirectoryAction || `<span class="muted">便携版已下载并通过校验；请在运行设备的 updates 目录中找到文件，关闭旧版本后手动替换。</span>`}${redownloadAction}`
        : `${download.can_open ? `<button class="primary" onclick="openDownloadedUpdate()">${icon("package-open")}<span>打开已校验安装包</span></button>` : ""}${openDirectoryAction || (!download.can_open ? `<span class="muted">安装包已下载并通过校验；请在运行设备的 updates 目录中手动安装。</span>` : "")}${redownloadAction}`
      : download.state === "downloading"
        ? `<button id="downloadUpdateBtn" disabled>${icon("download")}<span>${download.phase === "probing" ? "正在测速" : download.phase === "verifying" ? "正在校验" : "正在下载"}</span></button>`
        : `<button id="downloadUpdateBtn" class="primary" onclick="downloadUpdatePackage()">${icon("download")}<span>${download.state === "failed" ? "重新下载并校验" : "下载并校验"}</span></button>`
    : "";
  const downloadError = download.state === "failed" && download.error ? `<div class="warning">更新下载失败：${esc(download.error)}</div>` : "";
  const ignoreControl = update.update_available
    ? `<label class="check-row update-ignore-row"><input id="updateIgnoreCurrentVersion" type="checkbox" ${update.update_ignored ? "checked" : ""} onchange="setUpdateVersionIgnored(this)"> 忽略 ${esc(latestVersion)} 的更新提醒</label><div class="muted update-ignore-help">只隐藏该版本的提示弹窗和红点，关于页面仍可正常下载；出现更高版本时会自动恢复提醒。</div>`
    : "";
  return `<div class="update-card">
    <div class="update-card-head"><strong>GitHub Release 更新</strong><span>当前版本 ${esc(currentVersion)}</span></div>
    <dl class="update-details">
      <div><dt>状态</dt><dd><span class="status-pill ${download.state === "failed" ? "failed" : update.update_available ? "reconnecting" : "running"}">${esc(statusLabel)}</span><small>最近检查 ${esc(checkedAt)}</small></dd></div>
      <div><dt>最新版本</dt><dd><strong>${esc(latestVersion)}</strong>${publishedAt ? `<small>发布于 ${esc(publishedAt)}</small>` : ""}</dd></div>
      <div><dt>资源</dt><dd><strong title="${escAttr(resourceName)}">${esc(resourceName)}</strong>${target ? `<small>${esc(target)}</small>` : ""}</dd></div>
      ${sourceText ? `<div><dt>线路</dt><dd><strong>${esc(sourceText)}</strong><small>线路不可用时会自动切换</small></dd></div>` : ""}
      <div><dt>进度</dt><dd><strong>${esc(progressText)}</strong><div class="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div></dd></div>
    </dl>
    ${notes}${downloadError}
    <div class="actions update-actions"><button id="checkUpdateBtn" onclick="refreshUpdateStatus(true)">${icon("refresh-cw")}<span>检查更新</span></button>${downloadAction}${releaseLink}</div>
    ${ignoreControl}
    <div class="muted">自动匹配运行 Terma 主机的平台、架构和 Windows 安装类型；下载前会测试直连与加速线路并自动选择最快线路，文件仍按 GitHub 提供的 SHA-256 校验，不会静默安装或自动回滚。</div>
  </div>`;
}

function safeUpdateMarkdownUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
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
  const lines = String(value || "暂无更新说明").slice(0, 12000).replace(/\r\n?/g, "\n").split("\n");
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
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
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

function updateReleaseNotesHtml(update) {
  const history = Array.isArray(update?.release_notes) && update.release_notes.length
    ? update.release_notes.slice(0, 10)
    : update?.notes
      ? [{version:update.latest_version, published_at:update.published_at, notes:update.notes}]
      : [];
  if (!history.length) return "";
  return `<div class="update-notes"><strong>最近版本更新内容</strong><div class="update-release-list">${history.map((item, index) => {
    const version = String(item?.version || "").replace(/^v/i, "");
    const published = item?.published_at ? new Date(item.published_at).toLocaleDateString("zh-CN") : "";
    return `<section class="update-release-entry"><div class="update-release-head"><b>${version ? `v${esc(version)}` : index === 0 ? "最新版本" : "上一版本"}</b>${index === 0 ? `<span class="status-pill running">最新</span>` : ""}${published ? `<small>${esc(published)}</small>` : ""}</div><div class="update-release-markdown">${updateMarkdownHtml(item?.notes, version)}</div></section>`;
  }).join("")}</div></div>`;
}

let updateNotesScrollTop = 0;

function renderUpdateStatus(options={}) {
  const area = $("updateCheckArea");
  if (!area) return;
  const currentNotes = area.querySelector(".update-notes");
  if (currentNotes) updateNotesScrollTop = Math.max(0, currentNotes.scrollTop);
  area.innerHTML = updateStatusHtml();
  const nextNotes = area.querySelector(".update-notes");
  if (nextNotes) {
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
  const inPane = captureSettingsPane();
  const button = $("checkUpdateBtn");
  setButtonBusy(button, true, "检查中");
  try {
    const status = await api(`/api/updates/check${force ? "?force=1" : ""}`);
    const download = await api("/api/updates/download/status").catch(()=>null);
    updateSettings = status;
    if (download) updateSettings.download_status = download;
    inPane(() => {
      renderUpdateStatus();
      syncUpdateNoticeForCurrentSection();
    });
    if (force && !updateSettings.update_ignored) notify(updateSettings.update_available ? `发现新版本 v${String(updateSettings.latest_version || "").replace(/^v/i, "")}` : "当前已经是最新版本", updateSettings.update_available ? "info" : "success");
  } catch (error) {
    updateSettings = { error:error.message || "连接 GitHub 失败" };
    inPane(() => {
      renderUpdateStatus();
      syncUpdateNoticeForCurrentSection();
    });
    if (force) notify(updateSettings.error, "error");
  } finally {
    inPane(() => setButtonBusy(button, false));
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
    notify(enabled ? `已忽略 v${currentUpdateNoticeVersion()} 的更新提示` : `已恢复 v${currentUpdateNoticeVersion()} 的更新提示`, "success");
  } catch (error) {
    if (input) input.checked = !enabled;
    notify(error.message || "更新提醒设置保存失败", "error");
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
  if (!await confirmModal(
    `${redownload ? "将重新下载并覆盖当前已下载的更新文件。" : "将从 GitHub Release 下载当前系统的安装产物。"}下载前会同时测试直连和加速线路，自动选择当前最快线路；某条线路失败时会继续尝试其他线路。下载完成后会严格校验 GitHub 提供的 SHA-256 摘要，不会自动安装，也不会关闭当前程序。继续？`,
    redownload ? "重新下载更新" : "下载并校验更新",
    redownload ? "重新下载" : "开始下载",
    "取消"
  )) return;
  const button = $("downloadUpdateBtn");
  setButtonBusy(button, true, "测速中");
  try {
    const request = api("/api/updates/download", {method:"POST", body:"{}"});
    startUpdateDownloadPolling(inPane);
    const result = await request;
    updateSettings.download_status = result;
    inPane(() => {
      renderUpdateStatus({icons:true});
    });
    notify("更新安装包已下载并通过 SHA-256 校验", "success");
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
    "将交给系统打开已校验的安装包。安装程序会处理正在运行的旧版本；安装完成并启动新版本后，下载的安装包会自动删除。如果需要手动操作，也可以取消后选择“打开下载目录”。继续？",
    "打开更新安装包",
    "打开安装包",
    "取消"
  )) return;
  await api("/api/updates/open", {method:"POST", body:"{}"});
  notify("已交给系统打开安装包", "success");
}

async function openDownloadedUpdateDirectory() {
  const portable = updateSettings?.download_status?.package_type === "portable";
  const message = portable
    ? "将打开便携版所在目录。请先关闭当前 Terma，再用新版本文件替换旧版本并重新启动；运行中的便携版不会自动覆盖自身。"
    : "将打开已校验安装包所在目录，方便手动运行、复制或留存安装包。";
  if (!await confirmModal(
    message,
    "打开更新下载目录",
    "打开目录",
    "取消"
  )) return;
  await api("/api/updates/open-directory", {method:"POST", body:"{}"});
  notify(portable ? "已打开下载目录，请关闭旧版本后手动替换" : "已打开更新下载目录", "success");
}
