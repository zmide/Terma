function runtimeHostValues(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.flatMap(item => String(item ?? "").split(/[\s,]+/)).map(item => item.trim()).filter(Boolean))];
}

function runtimePortValue(value, fallback=8088) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function normalizeWorkspaceToolbarPlacement(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const placement = candidate => ["tab", "header"].includes(candidate) ? candidate : "header";
  return {
    unsplit: {
      terminal:placement(source.unsplit?.terminal),
      sftp:placement(source.unsplit?.sftp)
    },
    split: {
      terminal:placement(source.split?.terminal),
      sftp:placement(source.split?.sftp)
    }
  };
}

function normalizeRuntimeSettingsResponse(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const savedSource = source.saved && typeof source.saved === "object" ? source.saved : source;
  const effectiveSource = source.effective && typeof source.effective === "object"
    ? source.effective
    : {
        ...savedSource,
        listen_hosts:source.actual_hosts || source.effective_hosts || source.requested_hosts || savedSource.listen_hosts,
        listen_port:source.actual_port || source.effective_port || source.requested_port || savedSource.listen_port
      };
  const savedHosts = runtimeHostValues(savedSource.listen_hosts || savedSource.hosts || savedSource.host || "127.0.0.1");
  const effectiveHosts = runtimeHostValues(effectiveSource.listen_hosts || effectiveSource.hosts || effectiveSource.host || savedHosts);
  const available = [
    {address:"127.0.0.1", label:"仅本机", interface:"loopback", internal:true},
    {address:"0.0.0.0", label:"所有 IPv4 网卡", interface:"all", wildcard:true}
  ];
  const known = new Set(available.map(item => item.address));
  const candidates = Array.isArray(source.available_hosts) ? source.available_hosts : [];
  for (const item of candidates) {
    const entry = typeof item === "string" ? {address:item, label:item} : (item || {});
    const address = String(entry.address || "").trim();
    if (!address || known.has(address)) continue;
    known.add(address);
    available.push({...entry, address, label:String(entry.label || `${entry.interface ? `${entry.interface} · ` : ""}${address}`)});
  }
  for (const address of [...savedHosts, ...effectiveHosts]) {
    if (!address || known.has(address)) continue;
    known.add(address);
    available.push({address, label:`当前配置 · ${address}`, interface:"saved"});
  }
  const effectivePort = runtimePortValue(effectiveSource.listen_port ?? effectiveSource.port, runtimePortValue(savedSource.listen_port ?? savedSource.port));
  const fallbackLocalHost = effectiveHosts.find(address => address.startsWith("127.")) || (effectiveHosts.includes("0.0.0.0") ? "127.0.0.1" : effectiveHosts[0]);
  const computedLocalUrl = fallbackLocalHost ? `http://${fallbackLocalHost}:${effectivePort}` : "";
  const computedLanHosts = effectiveHosts.includes("0.0.0.0")
    ? available.filter(entry => !entry.internal && !entry.wildcard && entry.address !== "0.0.0.0").map(entry => entry.address)
    : effectiveHosts.filter(address => address !== "0.0.0.0" && !address.startsWith("127."));
  const reportedLanUrls = Array.isArray(source.lan_urls)
    ? source.lan_urls
    : Array.isArray(effectiveSource.lan_urls)
      ? effectiveSource.lan_urls
      : computedLanHosts.map(address => `http://${address}:${effectivePort}`);
  const hasRuntimeData = Boolean(source.local_url || source.actual_hosts || source.effective || source.listen_hosts || source.saved);
  return {
    ...source,
    sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
    sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
    restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(savedSource.workspace_toolbar_placement),
    saved: {
      ...savedSource,
      listen_hosts: savedHosts.length ? savedHosts : ["127.0.0.1"],
      listen_port: runtimePortValue(savedSource.listen_port ?? savedSource.port),
      sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
      sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
      sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
      sftp_download_directory: String(savedSource.sftp_download_directory || ""),
      restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
      workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(savedSource.workspace_toolbar_placement)
    },
    effective: {
      ...effectiveSource,
      listen_hosts: effectiveHosts.length ? effectiveHosts : ["127.0.0.1"],
      listen_port: effectivePort
    },
    available_hosts: available,
    local_url: String(source.local_url || effectiveSource.local_url || (hasRuntimeData ? computedLocalUrl : "")),
    lan_urls: hasRuntimeData ? reportedLanUrls.map(String).filter(Boolean) : [],
    restart_required: source.restart_required === true,
    error: String(source.error || "")
  };
}

async function loadRuntimeSettings(refreshUi=false) {
  const inPane = captureSettingsPane();
  runtimeSettingsMessage = null;
  runtimeSettingsCheck = null;
  try {
    runtimeSettings = normalizeRuntimeSettingsResponse(await api("/api/runtime-settings"));
  } catch (error) {
    runtimeSettings = normalizeRuntimeSettingsResponse({error:error.message || "监听配置加载失败"});
  }
  if (typeof updateSftpTaskFloat === "function") updateSftpTaskFloat(typeof sftpLatestJobs === "undefined" ? [] : sftpLatestJobs);
  if (refreshUi) inPane(renderRuntimeSettingsPanel);
  return runtimeSettings;
}

function safeRuntimeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function runtimeUrlListHtml(data=runtimeSettings) {
  const localUrl = safeRuntimeUrl(data?.local_url);
  const lanUrls = [...new Set((data?.lan_urls || []).map(safeRuntimeUrl).filter(Boolean))];
  const rows = [];
  if (localUrl) rows.push({label:"本机访问", url:localUrl, icon:"monitor"});
  lanUrls.forEach((url, index) => rows.push({label:lanUrls.length > 1 ? `局域网 ${index + 1}` : "局域网访问", url, icon:"network"}));
  if (!rows.length) return `<div class="runtime-empty muted">当前进程尚未报告可用访问地址，请刷新运行诊断。</div>`;
  return `<div class="runtime-url-list">${rows.map(row => `<a class="runtime-url-row" href="${escAttr(row.url)}" target="_blank" rel="noopener"><span class="runtime-url-icon">${icon(row.icon)}</span><span><strong>${esc(row.label)}</strong><small>${esc(row.url)}</small></span>${icon("external-link")}</a>`).join("")}</div>`;
}

function runtimeHostOptionsHtml(data=runtimeSettings) {
  const selected = new Set(data?.saved?.listen_hosts || ["127.0.0.1"]);
  return (data?.available_hosts || []).map(entry => {
    const address = String(entry.address || "");
    const wildcard = address === "0.0.0.0";
    const detail = wildcard
      ? "包含当前及以后出现的所有 IPv4 网卡"
      : address === "127.0.0.1"
        ? "仅本机可访问（只能从运行 Terma 的本机访问）"
        : `${entry.interface && entry.interface !== "saved" ? `${entry.interface} · ` : ""}仅绑定此网卡地址`;
    return `<label class="runtime-host-option ${wildcard ? "wildcard" : ""}" data-runtime-host-option="${escAttr(address)}">
      <input type="checkbox" name="runtimeListenHost" value="${escAttr(address)}" ${selected.has(address) ? "checked" : ""} onchange="syncRuntimeHostOptions(this)">
      <span><strong>${esc(entry.label || address)}</strong><small>${esc(detail)}</small></span>
      <code>${esc(address)}</code>
    </label>`;
  }).join("");
}

function runtimeFeedbackHtml() {
  if (runtimeSettingsMessage) {
    const type = runtimeSettingsMessage.type || "info";
    const symbol = type === "success" ? "check-circle-2" : type === "error" ? "circle-alert" : "info";
    return `<div class="runtime-feedback ${escAttr(type)}">${icon(symbol)}<span>${esc(runtimeSettingsMessage.text)}</span></div>`;
  }
  const result = runtimeSettingsCheck;
  if (!result) return "";
  const requestedPort = result.requested_port || result.listen_port || $("runtimeListenPort")?.value || "";
  if (result.error && result.available !== false) return `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(result.error)}</span></div>`;
  if (result.available && (result.occupied_by_current || result.current)) {
    return `<div class="runtime-feedback info">${icon("info")}<span>端口 ${esc(requestedPort)} 正由当前 Terma 使用；保存后仍需重启才能应用新的监听地址。</span></div>`;
  }
  if (result.available) return `<div class="runtime-feedback success">${icon("check-circle-2")}<span>端口 ${esc(requestedPort)} 可用，可以保存此监听配置。</span></div>`;
  const suggestion = runtimePortValue(result.suggested_port, 0);
  const reason = result.code === "EADDRINUSE" || /address already in use|eaddrinuse/i.test(result.error || "")
    ? "该端口已被其他程序占用。"
    : result.code === "EACCES" || /permission denied|eacces/i.test(result.error || "")
      ? "当前账号无权绑定该端口。"
      : result.error ? `检查失败：${result.error}` : "该端口无法绑定。";
  return `<div class="runtime-feedback error">${icon("circle-alert")}<span>端口 ${esc(requestedPort)} 不可用。${esc(reason)}${suggestion ? ` 可尝试端口 ${suggestion}。` : " 请换一个端口后重试。"}</span>${suggestion ? `<button type="button" onclick="useRuntimeSuggestedPort(${suggestion})">使用 ${suggestion}</button>` : ""}</div>`;
}

function runtimeSettingsPanelHtml(data=runtimeSettings) {
  const saved = data?.saved || {listen_hosts:["127.0.0.1"], listen_port:8088};
  const effective = data?.effective || saved;
  const savedText = `${(saved.listen_hosts || []).join("、")}:${saved.listen_port}`;
  const effectiveText = `${(effective.listen_hosts || []).join("、")}:${effective.listen_port}`;
  const overridden = data?.sources?.listen_hosts === "env" || data?.sources?.listen_port === "env" || effective.sources?.listen_hosts === "env" || effective.sources?.listen_port === "env";
  return `<div class="runtime-settings-panel">
    ${data?.error ? `<div class="runtime-feedback error">${icon("circle-alert")}<span>监听配置加载失败：${esc(data.error)}。其他设置不受影响，可以稍后重新加载。</span><button type="button" onclick="loadRuntimeSettings(true)">重新加载</button></div>` : ""}
    <div class="runtime-config-summary">
      <div><span>当前实际监听</span><strong>${esc(effectiveText)}</strong></div>
      <div><span>已保存配置</span><strong>${esc(savedText)}</strong></div>
      ${data?.restart_required ? `<span class="status-pill reconnecting">等待重启</span>` : `<span class="status-pill running">已生效</span>`}
    </div>
    ${overridden ? `<div class="warning">当前进程使用环境变量或启动参数覆盖监听配置。保存仍会写入配置文件，但重启时若继续传入覆盖项，将优先使用覆盖值。</div>` : ""}
    <fieldset class="runtime-host-fieldset">
      <legend>监听地址（可多选）</legend>
      <div class="runtime-host-options">${runtimeHostOptionsHtml(data)}</div>
      <div id="runtimeWildcardHint" class="muted" hidden>已选择所有 IPv4 网卡；其他地址已折叠，取消勾选后可按网卡选择。</div>
    </fieldset>
    <div class="runtime-port-field">
      <label for="runtimeListenPort">监听端口</label>
      <input id="runtimeListenPort" type="number" inputmode="numeric" min="1" max="65535" step="1" value="${escAttr(saved.listen_port)}" oninput="clearRuntimeSettingsFeedback()">
      <span>允许填写 1-65535。保存不会中断当前连接，重启 Terma 后生效。</span>
    </div>
    <div class="runtime-security-note">${icon("shield-alert")}<div><strong>局域网访问前先确认认证策略</strong><span>选择指定网卡 IP 或 0.0.0.0 后，同一网络中的设备可能访问 Terma。建议保留 Web 密码并使用“仅非本机访问时校验密码”或“所有浏览器访问都校验密码”。0.0.0.0 表示所有 IPv4 网卡，不只代表某一个局域网地址。</span></div></div>
    <div class="actions runtime-config-actions"><button id="runtimeCheckBtn" type="button" onclick="checkRuntimeSettings()">${icon("scan-search")}<span>检查占用</span></button><button id="runtimeSaveBtn" class="primary" type="button" onclick="saveRuntimeSettings()">${icon("save")}<span>保存监听配置</span></button></div>
    <div id="runtimeSettingsFeedback">${runtimeFeedbackHtml()}</div>
  </div>`;
}

function renderRuntimeSettingsPanel() {
  const panel = $("runtimeSettingsPanel");
  if (panel) panel.innerHTML = runtimeSettingsPanelHtml();
  const urls = $("runtimeCurrentUrls");
  if (urls) urls.innerHTML = runtimeUrlListHtml();
  syncRuntimeHostOptions();
}

function renderRuntimeSettingsFeedback() {
  const area = $("runtimeSettingsFeedback");
  if (area) area.innerHTML = runtimeFeedbackHtml();
}

function clearRuntimeSettingsFeedback() {
  runtimeSettingsCheck = null;
  runtimeSettingsMessage = null;
  renderRuntimeSettingsFeedback();
}

function syncRuntimeHostOptions(source=null) {
  const options = [...settingsQueryAll('[name="runtimeListenHost"]')];
  if (!options.length) return;
  const wildcard = options.find(input => input.value === "0.0.0.0");
  if (source?.value === "0.0.0.0" && source.checked) {
    options.filter(input => input !== wildcard).forEach(input => { input.checked = false; });
  } else if (source?.value !== "0.0.0.0" && source?.checked && wildcard) {
    wildcard.checked = false;
  }
  const collapseOthers = Boolean(wildcard?.checked);
  options.filter(input => input !== wildcard).forEach(input => {
    const row = input.closest(".runtime-host-option");
    if (row) row.hidden = collapseOthers;
  });
  const hint = $("runtimeWildcardHint");
  if (hint) hint.hidden = !collapseOthers;
  if (source) clearRuntimeSettingsFeedback();
}

function runtimeSettingsFormValue() {
  const listen_hosts = [...settingsQueryAll('[name="runtimeListenHost"]:checked')].map(input => input.value);
  const listen_port = Number($("runtimeListenPort")?.value);
  if (!listen_hosts.length) throw new Error("请至少选择一个监听地址");
  if (!Number.isInteger(listen_port) || listen_port < 1 || listen_port > 65535) throw new Error("监听端口必须是 1-65535 的整数");
  return {listen_hosts, listen_port};
}

async function checkRuntimeSettings() {
  const inPane = captureSettingsPane();
  let payload;
  try {
    payload = runtimeSettingsFormValue();
  } catch (error) {
    runtimeSettingsCheck = {error:error.message};
    renderRuntimeSettingsFeedback();
    return;
  }
  const button = $("runtimeCheckBtn");
  setButtonBusy(button, true, "检查中");
  runtimeSettingsMessage = null;
  try {
    runtimeSettingsCheck = await api("/api/runtime-settings/check", {method:"POST", body:JSON.stringify(payload)});
  } catch (error) {
    runtimeSettingsCheck = {error:error.message || "端口占用检查失败"};
  } finally {
    inPane(() => {
      setButtonBusy(button, false);
      renderRuntimeSettingsFeedback();
    });
  }
}

function useRuntimeSuggestedPort(port) {
  const input = $("runtimeListenPort");
  if (input) input.value = runtimePortValue(port);
  clearRuntimeSettingsFeedback();
  input?.focus();
}

async function saveRuntimeSettings() {
  const inPane = captureSettingsPane();
  let payload;
  try {
    payload = runtimeSettingsFormValue();
  } catch (error) {
    runtimeSettingsMessage = {type:"error", text:error.message};
    renderRuntimeSettingsFeedback();
    return;
  }
  const button = $("runtimeSaveBtn");
  setButtonBusy(button, true, "保存中");
  try {
    const result = await api("/api/runtime-settings", {method:"PUT", body:JSON.stringify(payload)});
    runtimeSettings = normalizeRuntimeSettingsResponse({
      ...runtimeSettings,
      ...result,
      available_hosts:result.available_hosts || runtimeSettings?.available_hosts,
      saved:result.saved || payload,
      effective:result.effective || runtimeSettings?.effective,
      restart_required:result.restart_required !== false
    });
    runtimeSettingsCheck = null;
    runtimeSettingsMessage = {type:"success", text:"监听配置已保存。当前服务不会立即断开，请重启 Terma 后应用新的地址和端口。"};
    inPane(renderRuntimeSettingsPanel);
    notify("监听配置已保存，重启 Terma 后生效", "success");
  } catch (error) {
    runtimeSettingsMessage = {type:"error", text:error.message || "监听配置保存失败"};
    inPane(renderRuntimeSettingsFeedback);
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

function workspaceToolbarPlacementFormValue() {
  return {
    unsplit: {
      terminal:$('toolbarPlacementUnsplitTerminal')?.value || "header",
      sftp:$('toolbarPlacementUnsplitSftp')?.value || "header"
    },
    split: {
      terminal:$('toolbarPlacementSplitTerminal')?.value || "header",
      sftp:$('toolbarPlacementSplitSftp')?.value || "header"
    }
  };
}

function syncWorkspaceToolbarPlacementInputs(value) {
  const normalized = normalizeWorkspaceToolbarPlacement(value);
  const fields = {
    toolbarPlacementUnsplitTerminal:normalized.unsplit.terminal,
    toolbarPlacementUnsplitSftp:normalized.unsplit.sftp,
    toolbarPlacementSplitTerminal:normalized.split.terminal,
    toolbarPlacementSplitSftp:normalized.split.sftp
  };
  for (const [id, placement] of Object.entries(fields)) {
    const input = $(id);
    if (input) input.value = placement;
  }
}

async function saveWorkspaceSettings() {
  const inPane = captureSettingsPane();
  const input = $("restoreWorkspaceTabs");
  const floatingProgress = $("taskCenterFloatingProgressEnabled");
  const button = $("restoreWorkspaceTabsSave");
  if (!input || !floatingProgress || !button) return;
  setButtonBusy(button, true, "保存中");
  try {
    const workspace_toolbar_placement = workspaceToolbarPlacementFormValue();
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({
        restore_workspace_tabs:input.checked,
        sftp_floating_progress_enabled:floatingProgress.checked,
        workspace_toolbar_placement
      })
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    inPane(() => {
      input.checked = runtimeSettings.saved.restore_workspace_tabs;
      floatingProgress.checked = runtimeSettings.saved.sftp_floating_progress_enabled;
      syncWorkspaceToolbarPlacementInputs(runtimeSettings.saved.workspace_toolbar_placement);
      if (typeof syncWorkspaceToolbarPlacements === "function") syncWorkspaceToolbarPlacements();
      if (typeof updateSftpTaskFloat === "function") updateSftpTaskFloat(typeof sftpLatestJobs === "undefined" ? [] : sftpLatestJobs);
    });
    notify("工作区设置已保存", "success");
  } catch (error) {
    inPane(() => {
      input.checked = runtimeSettings?.saved?.restore_workspace_tabs !== false;
      floatingProgress.checked = runtimeSettings?.saved?.sftp_floating_progress_enabled !== false;
      syncWorkspaceToolbarPlacementInputs(runtimeSettings?.saved?.workspace_toolbar_placement);
    });
    notify(error.message || "工作区设置保存失败", "error");
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

async function saveWorkspaceRestoreSetting() {
  return saveWorkspaceSettings();
}
