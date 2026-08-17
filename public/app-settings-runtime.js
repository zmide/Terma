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

function notificationDurationMs(value, fallback, nullable=false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 500 && duration <= 60000 ? duration : fallback;
}

function normalizeNotificationDisplay(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const entry = (name, fallbackDuration) => {
    const current = source[name] && typeof source[name] === "object" ? source[name] : {};
    return {
      enabled:current.enabled !== false,
      duration_ms:notificationDurationMs(current.duration_ms, fallbackDuration)
    };
  };
  const progress = source.progress && typeof source.progress === "object" ? source.progress : {};
  return {
    info:entry("info", 3500),
    success:entry("success", 3500),
    error:entry("error", 8000),
    progress:{
      enabled:progress.enabled !== false,
      success_duration_ms:notificationDurationMs(progress.success_duration_ms, null, true),
      error_duration_ms:notificationDurationMs(progress.error_duration_ms, 8000)
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
    {address:"127.0.0.1", kind:"loopback", interface:"loopback", internal:true},
    {address:"0.0.0.0", kind:"all", interface:"all", wildcard:true}
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
    available.push({address, kind:"saved", interface:"saved"});
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
    language:normalizeTermaLanguage(savedSource.language),
    language_onboarding_version:Math.max(0, Number(savedSource.language_onboarding_version || 0)),
    vnc_fullscreen_toolbar:["always", "never", "edge"].includes(savedSource.vnc_fullscreen_toolbar) ? savedSource.vnc_fullscreen_toolbar : "always",
    settings_persisted:source.settings_persisted === true,
    sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
    notification_display: normalizeNotificationDisplay(savedSource.notification_display),
    sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
    sftp_text_editor_mode: ["ace", "auto", "light"].includes(savedSource.sftp_text_editor_mode) ? savedSource.sftp_text_editor_mode : "ace",
    sftp_light_editor_threshold_mb: Number(savedSource.sftp_light_editor_threshold_mb) || 10,
    sftp_external_edit_save_rule: savedSource.sftp_external_edit_save_rule === "overwrite" ? "overwrite" : "prompt",
    sftp_external_edit_backup_enabled: savedSource.sftp_external_edit_backup_enabled !== false,
    sftp_download_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_download_concurrency) || 3)),
    sftp_upload_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_upload_concurrency) || 3)),
    restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
    remote_desktop_quick_open_enabled: savedSource.remote_desktop_quick_open_enabled === true,
    vnc_quick_open_new_window: savedSource.vnc_quick_open_new_window !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(savedSource.workspace_toolbar_placement),
    saved: {
      ...savedSource,
      language:normalizeTermaLanguage(savedSource.language),
      language_onboarding_version:Math.max(0, Number(savedSource.language_onboarding_version || 0)),
      vnc_fullscreen_toolbar:["always", "never", "edge"].includes(savedSource.vnc_fullscreen_toolbar) ? savedSource.vnc_fullscreen_toolbar : "always",
      listen_hosts: savedHosts.length ? savedHosts : ["127.0.0.1"],
      listen_port: runtimePortValue(savedSource.listen_port ?? savedSource.port),
      sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
      sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
      notification_display: normalizeNotificationDisplay(savedSource.notification_display),
      sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
      sftp_text_editor_mode: ["ace", "auto", "light"].includes(savedSource.sftp_text_editor_mode) ? savedSource.sftp_text_editor_mode : "ace",
      sftp_light_editor_threshold_mb: Number(savedSource.sftp_light_editor_threshold_mb) || 10,
      sftp_external_edit_save_rule: savedSource.sftp_external_edit_save_rule === "overwrite" ? "overwrite" : "prompt",
      sftp_external_edit_backup_enabled: savedSource.sftp_external_edit_backup_enabled !== false,
      sftp_download_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_download_concurrency) || 3)),
      sftp_upload_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_upload_concurrency) || 3)),
      sftp_download_directory: String(savedSource.sftp_download_directory || ""),
      restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
      remote_desktop_quick_open_enabled: savedSource.remote_desktop_quick_open_enabled === true,
      vnc_quick_open_new_window: savedSource.vnc_quick_open_new_window !== false,
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
    const legacyQuickOpen = localStorage.getItem("remoteDesktopQuickOpen");
    remoteDesktopQuickOpen = legacyQuickOpen === null
      ? runtimeSettings.saved.remote_desktop_quick_open_enabled === true
      : legacyQuickOpen === "1";
    await setTermaLanguage(runtimeSettings.saved.language, {render:false, emit:false});
  } catch (error) {
    runtimeSettings = normalizeRuntimeSettingsResponse({error:error.message || tr("settings:auto.runtime_load_failed", {defaultValue:"监听配置加载失败"})});
  }
  if (typeof updateSftpTaskFloat === "function") updateSftpTaskFloat(typeof sftpLatestJobs === "undefined" ? [] : sftpLatestJobs);
  if (refreshUi) inPane(renderRuntimeSettingsPanel);
  return runtimeSettings;
}

async function toggleTermaLanguage() {
  const current = normalizeTermaLanguage(runtimeSettings?.saved?.language || document.documentElement.lang);
  const language = current === "zh-CN" ? "en-US" : "zh-CN";
  const buttons = [...document.querySelectorAll(".language-toggle")];
  buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({language})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    await setTermaLanguage(runtimeSettings.saved.language);
  } catch (error) {
    notify(error.message || tr("errors:language_switch", {defaultValue:"界面语言切换失败"}), "error");
    syncTermaLanguageControls(current);
  } finally {
    buttons.forEach(button => { button.disabled = false; button.removeAttribute("aria-busy"); });
  }
}

const TERMA_LANGUAGE_ONBOARDING_VERSION = 1;

function termaRegionFromLocale(value) {
  const locale = String(value || "").trim().replace(/_/g, "-");
  if (!locale) return "";
  try {
    return String(new Intl.Locale(locale).maximize().region || "").toUpperCase();
  } catch {
    const parts = locale.split("-");
    return String(parts.find((part, index) => index > 0 && /^[a-z]{2}$/i.test(part)) || "").toUpperCase();
  }
}

function suggestedTermaLanguage(locales=navigator.languages?.length ? navigator.languages : [navigator.language]) {
  const region = (Array.isArray(locales) ? locales : [locales]).map(termaRegionFromLocale).find(Boolean);
  return region === "CN" ? "zh-CN" : "en-US";
}

function closeTermaLanguageOnboarding() {
  const modal = $("modal");
  if (!modal) return;
  modal.hidden = true;
  modal.innerHTML = "";
}

async function confirmTermaLanguageOnboarding(button=null) {
  const selected = $("modal")?.querySelector('input[name="terma-onboarding-language"]:checked')?.value;
  const language = normalizeTermaLanguage(selected || runtimeSettings?.saved?.language);
  if (button) setButtonBusy(button, true, tr("settings:language_onboarding.saving", {
    lng:language,
    defaultValue:language === "zh-CN" ? "正在保存..." : "Saving..."
  }));
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({language, language_onboarding_version:TERMA_LANGUAGE_ONBOARDING_VERSION})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    await setTermaLanguage(runtimeSettings.saved.language);
    closeTermaLanguageOnboarding();
    return true;
  } catch (error) {
    notify(error.message || tr("settings:language_onboarding.save_failed", {
      lng:language,
      defaultValue:language === "zh-CN" ? "语言设置保存失败" : "Failed to save language"
    }), "error");
    return false;
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function termaLanguageOnboardingCopy(language, isNew) {
  const selectedLanguage = normalizeTermaLanguage(language);
  const chinese = selectedLanguage === "zh-CN";
  return {
    title:tr("settings:language_onboarding.title", {
      lng:selectedLanguage,
      defaultValue:chinese ? "选择界面语言" : "Choose your language"
    }),
    message:tr(isNew ? "settings:language_onboarding.new_user_message" : "settings:language_onboarding.existing_user_message", {
      lng:selectedLanguage,
      defaultValue:chinese
        ? (isNew ? "Terma 已按当前设备地区预选语言，进入前可以修改。" : "请选择要继续使用的 Terma 界面语言。")
        : (isNew ? "Terma selected a default from this device's region. You can change it before entering." : "Choose the Terma interface language to continue.")
    }),
    switchHint:tr("settings:language_onboarding.switch_hint", {
      lng:selectedLanguage,
      defaultValue:chinese ? "之后可随时通过语言按钮切换。" : "You can switch languages at any time from the language button."
    }),
    continueLabel:tr("settings:language_onboarding.continue", {
      lng:selectedLanguage,
      defaultValue:chinese ? "继续" : "Continue"
    })
  };
}

function updateTermaLanguageOnboarding(language) {
  const form = $("modal")?.querySelector(".language-onboarding");
  if (!form) return false;
  const selectedLanguage = normalizeTermaLanguage(language);
  const selectedInput = form.querySelector(`input[name="terma-onboarding-language"][value="${selectedLanguage}"]`);
  if (selectedInput) selectedInput.checked = true;
  form.querySelectorAll(".language-onboarding-option").forEach(item => {
    item.classList.toggle("selected", item.contains(selectedInput));
  });
  const copy = termaLanguageOnboardingCopy(selectedLanguage, form.dataset.newUser === "true");
  const title = form.querySelector("#languageOnboardingTitle");
  const message = form.querySelector(".language-onboarding-message");
  const switchHint = form.querySelector(".language-onboarding-note");
  const continueButton = form.querySelector('button[type="submit"]');
  if (title) title.textContent = copy.title;
  if (message) message.textContent = copy.message;
  if (switchHint) switchHint.textContent = copy.switchHint;
  if (continueButton) continueButton.textContent = copy.continueLabel;
  form.lang = selectedLanguage;
  return true;
}

async function ensureTermaLanguageOnboarding() {
  if (Number(runtimeSettings?.saved?.language_onboarding_version || 0) >= TERMA_LANGUAGE_ONBOARDING_VERSION) return false;
  const existingLanguage = normalizeTermaLanguage(runtimeSettings?.saved?.language);
  const suggestedLanguage = runtimeSettings?.settings_persisted ? existingLanguage : suggestedTermaLanguage();
  if (!runtimeSettings?.settings_persisted && suggestedLanguage !== existingLanguage) {
    await setTermaLanguage(suggestedLanguage, {emit:false});
  }
  // The two choices are self-identifying: English stays English and the
  // Simplified Chinese choice stays Chinese, even on a fresh English startup.
  await ensureTermaI18nResourceBundles(["en-US", "zh-CN"], ["common", "settings"]);
  const modal = $("modal");
  if (!modal) return false;
  const isNew = runtimeSettings?.settings_persisted !== true;
  const englishDetail = tr("settings:language_onboarding.english_detail", {lng:"en-US", defaultValue:"Default outside mainland China"});
  const chineseName = tr("common:languages.zh-CN", {lng:"zh-CN", defaultValue:"简体中文"});
  const chineseDetail = tr("settings:language_onboarding.chinese_detail", {lng:"zh-CN", defaultValue:"中国大陆默认"});
  modal.innerHTML = `<form class="modal-card language-onboarding" data-i18n-skip data-new-user="${isNew}" role="dialog" aria-modal="true" aria-labelledby="languageOnboardingTitle" onsubmit="event.preventDefault();confirmTermaLanguageOnboarding(this.querySelector('button[type=submit]'))">
    <div class="language-onboarding-mark">T</div>
    <div class="language-onboarding-copy">
      <h2 id="languageOnboardingTitle"></h2>
      <p class="language-onboarding-message"></p>
    </div>
    <div class="language-onboarding-options">
      <label class="language-onboarding-option"><input type="radio" name="terma-onboarding-language" value="en-US" onchange="updateTermaLanguageOnboarding(this.value)"><span><strong>English</strong><small>${esc(englishDetail)}</small></span></label>
      <label class="language-onboarding-option"><input type="radio" name="terma-onboarding-language" value="zh-CN" onchange="updateTermaLanguageOnboarding(this.value)"><span><strong>${esc(chineseName)}</strong><small>${esc(chineseDetail)}</small></span></label>
    </div>
    <div class="language-onboarding-note"></div>
    <div class="actions"><button class="primary" type="submit"></button></div>
  </form>`;
  updateTermaLanguageOnboarding(suggestedLanguage);
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();
  return true;
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
  if (localUrl) rows.push({label:tr("settings:auto.local_access", {defaultValue:"本机访问"}), url:localUrl, icon:"monitor"});
  lanUrls.forEach((url, index) => rows.push({
    label:lanUrls.length > 1
      ? tr("settings:auto.lan_access_numbered", {index:index + 1, defaultValue:`局域网 ${index + 1}`})
      : tr("settings:auto.lan_access", {defaultValue:"局域网访问"}),
    url,
    icon:"network"
  }));
  if (!rows.length) return `<div class="runtime-empty muted">${esc(tr("settings:auto.no_access_urls", {defaultValue:"当前进程尚未报告可用访问地址，请刷新运行诊断。"}))}</div>`;
  return `<div class="runtime-url-list">${rows.map(row => `<a class="runtime-url-row" href="${escAttr(row.url)}" target="_blank" rel="noopener"><span class="runtime-url-icon">${icon(row.icon)}</span><span><strong>${esc(row.label)}</strong><small>${esc(row.url)}</small></span>${icon("external-link")}</a>`).join("")}</div>`;
}

function runtimeInterfaceLabel(value) {
  const source = String(value || "").trim();
  if (/^(?:以太网|ethernet)$/i.test(source)) return tr("settings:auto.ethernet", {defaultValue:"以太网"});
  if (/^(?:无线网络连接|无线局域网|wi-?fi|wlan)$/i.test(source)) return tr("settings:auto.wifi", {defaultValue:"Wi-Fi"});
  return source;
}

function runtimeHostEntryLabel(entry, address) {
  if (address === "127.0.0.1" || entry.kind === "loopback" || entry.interface === "loopback") return tr("settings:auto.local_only", {defaultValue:"仅本机"});
  if (address === "0.0.0.0" || entry.kind === "all" || entry.interface === "all") return tr("settings:auto.all_ipv4", {defaultValue:"所有 IPv4 网卡"});
  if (entry.kind === "saved" || entry.interface === "saved") return tr("settings:auto.current_config_address", {address, defaultValue:`当前配置 · ${address}`});
  const interfaceLabel = runtimeInterfaceLabel(entry.interface);
  return interfaceLabel ? `${interfaceLabel} · ${address}` : String(entry.label || address);
}

function runtimeHostOptionsHtml(data=runtimeSettings) {
  const selected = new Set(data?.saved?.listen_hosts || ["127.0.0.1"]);
  return (data?.available_hosts || []).map(entry => {
    const address = String(entry.address || "");
    const wildcard = address === "0.0.0.0";
    const detail = wildcard
      ? tr("settings:auto.all_ipv4_hint", {defaultValue:"包含当前及以后出现的所有 IPv4 网卡"})
      : address === "127.0.0.1"
        ? tr("settings:auto.local_only_hint", {defaultValue:"仅本机可访问（只能从运行 Terma 的本机访问）"})
        : entry.interface && entry.interface !== "saved"
          ? tr("settings:auto.interface_binding", {interface:runtimeInterfaceLabel(entry.interface), defaultValue:`${runtimeInterfaceLabel(entry.interface)} · 仅绑定此网卡地址`})
          : tr("settings:auto.address_binding", {defaultValue:"仅绑定此网卡地址"});
    return `<label class="runtime-host-option ${wildcard ? "wildcard" : ""}" data-runtime-host-option="${escAttr(address)}">
      <input type="checkbox" name="runtimeListenHost" value="${escAttr(address)}" ${selected.has(address) ? "checked" : ""} onchange="syncRuntimeHostOptions(this)">
      <span><strong>${esc(runtimeHostEntryLabel(entry, address))}</strong><small>${esc(detail)}</small></span>
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
    return `<div class="runtime-feedback info">${icon("info")}<span>${esc(tr("settings:auto.port_current", {port:requestedPort, defaultValue:`端口 ${requestedPort} 正由当前 Terma 使用；保存后仍需重启才能应用新的监听地址。`}))}</span></div>`;
  }
  if (result.available) return `<div class="runtime-feedback success">${icon("check-circle-2")}<span>${esc(tr("settings:auto.port_available", {port:requestedPort, defaultValue:`端口 ${requestedPort} 可用，可以保存此监听配置。`}))}</span></div>`;
  const suggestion = runtimePortValue(result.suggested_port, 0);
  const reason = result.code === "EADDRINUSE" || /address already in use|eaddrinuse/i.test(result.error || "")
    ? tr("settings:auto.port_in_use_reason", {defaultValue:"该端口已被其他程序占用。"})
    : result.code === "EACCES" || /permission denied|eacces/i.test(result.error || "")
      ? tr("settings:auto.port_denied_reason", {defaultValue:"当前账号无权绑定该端口。"})
      : result.error
        ? tr("settings:auto.port_check_reason", {error:result.error, defaultValue:`检查失败：${result.error}`})
        : tr("settings:auto.port_unbindable_reason", {defaultValue:"该端口无法绑定。"});
  const suggestionText = suggestion
    ? tr("settings:auto.port_suggestion", {port:suggestion, defaultValue:` 可尝试端口 ${suggestion}。`})
    : tr("settings:auto.port_try_another", {defaultValue:" 请换一个端口后重试。"});
  const unavailable = tr("settings:auto.port_unavailable", {port:requestedPort, reason, suggestion:suggestionText, defaultValue:`端口 ${requestedPort} 不可用。${reason}${suggestionText}`});
  return `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(unavailable)}</span>${suggestion ? `<button type="button" onclick="useRuntimeSuggestedPort(${suggestion})">${esc(tr("settings:auto.use_port", {port:suggestion, defaultValue:`使用 ${suggestion}`}))}</button>` : ""}</div>`;
}

function runtimeSettingsPanelHtml(data=runtimeSettings) {
  const saved = data?.saved || {listen_hosts:["127.0.0.1"], listen_port:8088};
  const effective = data?.effective || saved;
  const savedText = `${(saved.listen_hosts || []).join("、")}:${saved.listen_port}`;
  const effectiveText = `${(effective.listen_hosts || []).join("、")}:${effective.listen_port}`;
  const overridden = data?.sources?.listen_hosts === "env" || data?.sources?.listen_port === "env" || effective.sources?.listen_hosts === "env" || effective.sources?.listen_port === "env";
  return `<div class="runtime-settings-panel">
    ${data?.error ? `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(tr("settings:auto.listener_load_failed", {error:data.error, defaultValue:`监听配置加载失败：${data.error}。其他设置不受影响，可以稍后重新加载。`}))}</span><button type="button" onclick="loadRuntimeSettings(true)">${esc(tr("settings:auto.reload", {defaultValue:"重新加载"}))}</button></div>` : ""}
    <div class="runtime-config-summary">
      <div><span>${esc(tr("settings:auto.actual_listener", {defaultValue:"当前实际监听"}))}</span><strong>${esc(effectiveText)}</strong></div>
      <div><span>${esc(tr("settings:auto.saved_config", {defaultValue:"已保存配置"}))}</span><strong>${esc(savedText)}</strong></div>
      ${data?.restart_required ? `<span class="status-pill reconnecting">${esc(tr("settings:auto.restart_pending", {defaultValue:"等待重启"}))}</span>` : `<span class="status-pill running">${esc(tr("settings:auto.effective", {defaultValue:"已生效"}))}</span>`}
    </div>
    ${overridden ? `<div class="warning">${esc(tr("settings:auto.runtime_override_warning", {defaultValue:"当前进程使用环境变量或启动参数覆盖监听配置。保存仍会写入配置文件，但重启时若继续传入覆盖项，将优先使用覆盖值。"}))}</div>` : ""}
    <fieldset class="runtime-host-fieldset">
      <legend>${esc(tr("settings:auto.listen_addresses", {defaultValue:"监听地址（可多选）"}))}</legend>
      <div class="runtime-host-options">${runtimeHostOptionsHtml(data)}</div>
      <div id="runtimeWildcardHint" class="muted" hidden>${esc(tr("settings:auto.wildcard_selected_hint", {defaultValue:"已选择所有 IPv4 网卡；其他地址已折叠，取消勾选后可按网卡选择。"}))}</div>
    </fieldset>
    <div class="runtime-port-field">
      <label for="runtimeListenPort">${esc(tr("settings:auto.listen_port", {defaultValue:"监听端口"}))}</label>
      <input id="runtimeListenPort" type="number" inputmode="numeric" min="1" max="65535" step="1" value="${escAttr(saved.listen_port)}" oninput="clearRuntimeSettingsFeedback()">
      <span>${esc(tr("settings:auto.listen_port_hint", {defaultValue:"允许填写 1-65535。保存不会中断当前连接，重启 Terma 后生效。"}))}</span>
    </div>
    <div class="runtime-security-note">${icon("shield-alert")}<div><strong>${esc(tr("settings:auto.lan_auth_warning_title", {defaultValue:"局域网访问前先确认认证策略"}))}</strong><span>${esc(tr("settings:auto.lan_auth_warning", {defaultValue:"选择指定网卡 IP 或 0.0.0.0 后，同一网络中的设备可能访问 Terma。建议保留 Web 密码并使用“仅非本机访问时校验密码”或“所有浏览器访问都校验密码”。0.0.0.0 表示所有 IPv4 网卡，不只代表某一个局域网地址。"}))}</span></div></div>
    <div class="actions runtime-config-actions"><button id="runtimeCheckBtn" type="button" onclick="checkRuntimeSettings()">${icon("scan-search")}<span>${esc(tr("settings:auto.check_port", {defaultValue:"检查占用"}))}</span></button><button id="runtimeSaveBtn" class="primary" type="button" onclick="saveRuntimeSettings()">${icon("save")}<span>${esc(tr("settings:auto.save_listener", {defaultValue:"保存监听配置"}))}</span></button></div>
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
  if (!listen_hosts.length) throw new Error(tr("settings:auto.select_listen_address", {defaultValue:"请至少选择一个监听地址"}));
  if (!Number.isInteger(listen_port) || listen_port < 1 || listen_port > 65535) throw new Error(tr("settings:auto.invalid_listen_port", {defaultValue:"监听端口必须是 1-65535 的整数"}));
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
  setButtonBusy(button, true, tr("settings:auto.checking", {defaultValue:"检查中"}));
  runtimeSettingsMessage = null;
  try {
    runtimeSettingsCheck = await api("/api/runtime-settings/check", {method:"POST", body:JSON.stringify(payload)});
  } catch (error) {
    runtimeSettingsCheck = {error:error.message || tr("settings:auto.port_check_failed", {defaultValue:"端口占用检查失败"})};
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
  setButtonBusy(button, true, tr("settings:auto.saving", {defaultValue:"保存中"}));
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
    runtimeSettingsMessage = {type:"success", text:tr("settings:auto.listener_saved_detail", {defaultValue:"监听配置已保存。当前服务不会立即断开，请重启 Terma 后应用新的地址和端口。"})};
    inPane(renderRuntimeSettingsPanel);
    notify(tr("settings:auto.listener_saved_notice", {defaultValue:"监听配置已保存，重启 Terma 后生效"}), "success");
  } catch (error) {
    runtimeSettingsMessage = {type:"error", text:error.message || tr("settings:auto.listener_save_failed", {defaultValue:"监听配置保存失败"})};
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
  const button = $("restoreWorkspaceTabsSave");
  if (!input || !button) return;
  setButtonBusy(button, true, tr("settings:auto.saving", {defaultValue:"保存中"}));
  try {
    const workspace_toolbar_placement = workspaceToolbarPlacementFormValue();
    const vnc_fullscreen_toolbar = ["always", "never", "edge"].includes($("generalVncFullscreenToolbar")?.value)
      ? $("generalVncFullscreenToolbar").value
      : "always";
    const remote_desktop_quick_open_enabled = $("generalRemoteDesktopQuickOpen")?.checked === true;
    const vnc_quick_open_new_window = $("generalVncQuickOpenNewWindow")?.checked !== false;
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({
        restore_workspace_tabs:input.checked,
        remote_desktop_quick_open_enabled,
        vnc_quick_open_new_window,
        workspace_toolbar_placement,
        vnc_fullscreen_toolbar
      })
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    remoteDesktopQuickOpen = runtimeSettings.saved.remote_desktop_quick_open_enabled === true;
    localStorage.removeItem("remoteDesktopQuickOpen");
    await setTermaLanguage(runtimeSettings.saved.language);
    inPane(() => {
      renderSettings();
      if (typeof syncWorkspaceToolbarPlacements === "function") syncWorkspaceToolbarPlacements();
    });
    notify(tr("settings:auto.workspace_saved", {defaultValue:"工作区设置已保存"}), "success");
  } catch (error) {
    inPane(() => {
      input.checked = runtimeSettings?.saved?.restore_workspace_tabs !== false;
      syncWorkspaceToolbarPlacementInputs(runtimeSettings?.saved?.workspace_toolbar_placement);
      const vncToolbar = $("generalVncFullscreenToolbar");
      if (vncToolbar) vncToolbar.value = runtimeSettings?.saved?.vnc_fullscreen_toolbar || "always";
      const quickOpen = $("generalRemoteDesktopQuickOpen");
      if (quickOpen) quickOpen.checked = remoteDesktopQuickOpen;
      const newWindow = $("generalVncQuickOpenNewWindow");
      if (newWindow) newWindow.checked = runtimeSettings?.saved?.vnc_quick_open_new_window !== false;
    });
    notify(error.message || tr("settings:auto.workspace_save_failed", {defaultValue:"工作区设置保存失败"}), "error");
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

async function saveWorkspaceRestoreSetting() {
  return saveWorkspaceSettings();
}
