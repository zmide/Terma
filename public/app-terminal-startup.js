function syncTerminalStartupForm() {
  const select = $("terminalStartupProfile");
  const details = $("terminalStartupProgramFields");
  if (!select || !details) return;
  details.hidden = select.value === "default";
}

function fillTerminalStartupForm(config) {
  const value = normalizeTerminalStartupConfig(config);
  $("terminalStartupProfile").value = value.terminal_startup_mode === "default" ? "default" : "custom";
  $("terminalStartupProfileName").value = value.terminal_profile_name;
  $("terminalStartupKind").value = value.terminal_profile_kind;
  $("terminalStartupPath").value = value.terminal_program_path;
  $("terminalStartupArgs").value = value.terminal_program_args;
  $("terminalStartupCwd").value = value.terminal_working_directory;
  $("terminalStartupPlatform").value = value.terminal_program_platform;
  syncTerminalStartupForm();
}

function terminalStartupFormValue() {
  const mode = $("terminalStartupProfile").value === "default" ? "default" : "program";
  const fields = [
    ["terminalStartupProfileName", () => tr("terminal:startup.profile_name"), 120],
    ["terminalStartupPath", () => tr("terminal:startup.program_path"), 2048],
    ["terminalStartupArgs", () => tr("terminal:startup.startup_args"), 4096],
    ["terminalStartupCwd", () => tr("terminal:startup.working_directory_short"), 2048]
  ];
  const values = {};
  for (const [id, getLabel, maximum] of fields) {
    const value = String($(id)?.value || "").trim();
    if (/[\r\n\0]/.test(value)) throw new Error(tr("terminal:startup.single_line_only", {field:getLabel()}));
    if (value.length > maximum) throw new Error(tr("terminal:startup.maximum_characters", {field:getLabel(), maximum}));
    values[id] = value;
  }
  if (mode === "program" && !values.terminalStartupPath) throw new Error(tr("terminal:startup.path_required"));
  return normalizeTerminalStartupConfig({
    terminal_startup_mode:mode,
    terminal_profile_name:values.terminalStartupProfileName,
    terminal_profile_kind:$("terminalStartupKind")?.value || "custom",
    terminal_program_path:values.terminalStartupPath,
    terminal_program_args:values.terminalStartupArgs,
    terminal_working_directory:values.terminalStartupCwd,
    terminal_program_platform:$("terminalStartupPlatform")?.value || "auto"
  });
}

function terminalStartupFormDraft() {
  return normalizeTerminalStartupConfig({
    terminal_startup_mode:$("terminalStartupProfile")?.value === "default" ? "default" : "program",
    terminal_profile_name:$("terminalStartupProfileName")?.value || "",
    terminal_profile_kind:$("terminalStartupKind")?.value || "custom",
    terminal_program_path:$("terminalStartupPath")?.value || "",
    terminal_program_args:$("terminalStartupArgs")?.value || "",
    terminal_working_directory:$("terminalStartupCwd")?.value || "",
    terminal_program_platform:$("terminalStartupPlatform")?.value || "auto"
  });
}

function chooseTerminalStartupProfile() {
  const select = $("terminalStartupProfile");
  const modal = $("modal");
  if (!select || !modal) return;
  const profiles = modal._terminalStartupProfiles || [];
  if (select.value.startsWith("profile:")) {
    const profile = profiles[Number(select.value.slice(8))];
    if (profile) {
      $("terminalStartupProfileName").value = profile.label || profile.name || "";
      $("terminalStartupKind").value = terminalStartupKinds.has(profile.kind) ? profile.kind : "custom";
      $("terminalStartupPath").value = profile.path || "";
      $("terminalStartupArgs").value = profile.args || "";
      $("terminalStartupCwd").value = profile.working_directory || "";
      $("terminalStartupPlatform").value = terminalStartupPlatforms.has(profile.platform) ? profile.platform : "auto";
    }
  }
  syncTerminalStartupForm();
}

function markTerminalStartupCustom() {
  const select = $("terminalStartupProfile");
  if (select && select.value !== "default") select.value = "custom";
}

function populateTerminalStartupCapabilities(capabilities, currentConfig) {
  const select = $("terminalStartupProfile");
  const modal = $("modal");
  if (!select || !modal) return;
  const profiles = Array.isArray(capabilities?.profiles) ? capabilities.profiles : [];
  modal._terminalStartupProfiles = profiles;
  const defaultShell = capabilities?.default_shell?.label || capabilities?.default_shell?.name || "";
  const options = [
    `<option value="default">${esc(defaultShell
      ? tr("terminal:startup.default_detected", {shell:defaultShell, defaultValue:`自动（服务器默认：${defaultShell}）`})
      : tr("terminal:startup.default_login_shell", {defaultValue:"自动（服务器默认登录 Shell）"}))}</option>`
  ];
  const groups = [
    ["shell", tr("terminal:startup.detected_shells", {defaultValue:"检测到的 Shell"})],
    ["repl", tr("terminal:startup.interactive_programs", {defaultValue:"交互式程序"})],
    ["session", tr("terminal:startup.session_tools", {defaultValue:"会话工具"})],
    ["tool", tr("terminal:startup.other_tools", {defaultValue:"其他可启动工具"})]
  ];
  for (const [kind, label] of groups) {
    const indexes = profiles.map((profile, index) => ({profile,index})).filter(item => item.profile.kind === kind);
    if (!indexes.length) continue;
    options.push(`<optgroup label="${escAttr(label)}">${indexes.map(({profile,index}) => `<option value="profile:${index}">${esc(profile.label || profile.name || profile.path)}${profile.is_default ? esc(tr("terminal:startup.default_suffix", {defaultValue:"（默认）"})) : ""}</option>`).join("")}</optgroup>`);
  }
  options.push(`<option value="custom">${esc(tr("terminal:startup.custom_option", {defaultValue:"自定义程序、Shell 或命令行工具"}))}</option>`);
  select.innerHTML = options.join("");
  const matchingIndex = profiles.findIndex(profile => terminalStartupProfileMatches(currentConfig, profile));
  select.value = currentConfig.terminal_startup_mode === "default"
    ? "default"
    : matchingIndex >= 0 ? `profile:${matchingIndex}` : "custom";
  const tools = Array.isArray(capabilities?.tools) ? capabilities.tools : [];
  const summary = $("terminalStartupCapabilitySummary");
  if (summary) {
    const platform = capabilities?.platform_label || capabilities?.platform || tr("terminal:startup.remote_system", {defaultValue:"远端系统"});
    const detected = tools.map(tool => `${tool.label || tool.name}${tool.version ? ` ${tool.version}` : ""}`);
    const warnings = Array.isArray(capabilities?.warnings) ? capabilities.warnings.filter(Boolean) : [];
    summary.className = `terminal-startup-capability ${warnings.length ? "warning" : "success"}`;
    const headline = defaultShell
      ? tr("terminal:startup.default_summary", {platform, shell:defaultShell, defaultValue:`${platform} · 默认 ${defaultShell}`})
      : platform;
    const detectedText = tr("terminal:startup.detected_tools", {tools:detected.join(", "), defaultValue:`已检测工具：${detected.join("、")}`});
    summary.innerHTML = `<strong>${esc(headline)}</strong>${detected.length ? `<span>${esc(detectedText)}</span>` : ""}${warnings.length ? `<span>${warnings.map(esc).join("；")}</span>` : ""}`;
  }
  syncTerminalStartupForm();
}

function terminalStartupModalRequestIsCurrent(modal, context, requestId) {
  return $("modal") === modal
    && !modal.hidden
    && modal._terminalStartupContext === context
    && modal._terminalStartupRequestId === requestId;
}

async function refreshTerminalStartupCapabilities(connectionId, key, button=null) {
  const modal = $("modal");
  const context = modal?._terminalStartupContext;
  if (!context || modal._terminalStartupKey !== key || modal._terminalStartupConnectionId !== connectionId) return;
  const requestId = Number(modal._terminalStartupRequestId || 0) + 1;
  modal._terminalStartupRequestId = requestId;
  const status = $("terminalStartupCapabilitySummary");
  if (status) {
    status.className = "terminal-startup-capability loading";
    status.textContent = tr("terminal:startup.detecting", {defaultValue:"正在只读检测远端 Shell、Python、Node 和会话工具…"});
  }
  setButtonBusy(button, true, tr("terminal:startup.detecting_short"));
  try {
    const response = await api(`/api/connections/${connectionId}/terminal-capabilities`, {method:"POST", body:"{}"});
    if (!terminalStartupModalRequestIsCurrent(modal, context, requestId)) return;
    const connection = connections.find(item => item.id === connectionId);
    const current = terminalStartupFormDraft();
    populateTerminalStartupCapabilities(response.capabilities || response, current);
    if (connection && response.capabilities) connection.terminal_capabilities = response.capabilities;
  } catch (error) {
    if (!terminalStartupModalRequestIsCurrent(modal, context, requestId)) return;
    if (status) {
      status.className = "terminal-startup-capability warning";
      status.textContent = tr("terminal:startup.detect_failed", {error:error.message, defaultValue:`暂时无法识别远端环境：${error.message}。仍可使用服务器默认 Shell 或手动填写。`});
    }
  } finally {
    if (terminalStartupModalRequestIsCurrent(modal, context, requestId)) setButtonBusy(button, false);
  }
}

function closeTerminalStartupSettings(key=activeTabKey, focus=true, force=false) {
  const modal = $("modal");
  if (modal._terminalStartupApplying && !force) return false;
  modal._terminalStartupRequestId = Number(modal._terminalStartupRequestId || 0) + 1;
  modal._terminalStartupContext = null;
  modal._terminalStartupKey = "";
  modal._terminalStartupConnectionId = 0;
  modal._terminalStartupApplying = false;
  modal.onkeydown = null;
  closeModal();
  if (focus) focusTerminalSession(key);
  return true;
}

function updateTerminalStartupButton(key, connection) {
  const button = terminalElementForKey(key, ".terminal-startup-button");
  if (!button) return;
  const temporary = terminalStartupOverrides.has(key);
  const label = terminalStartupConfigLabel(effectiveTerminalStartupConfig(connection, key));
  const temporarySuffix = temporary ? tr("terminal:startup.temporary_suffix", {defaultValue:"（仅当前标签）"}) : "";
  button.title = tr("terminal:startup.button_title", {profile:label, temporary:temporarySuffix, defaultValue:`终端配置：${label}${temporarySuffix}`});
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("has-temporary-startup", temporary);
}

function updateTerminalStartupButtonsForConnection(connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  for (const tab of tabs) {
    if (tab.kind === "terminal" && Number(tab.id) === Number(connectionId)) {
      updateTerminalStartupButton(tab.key, connection);
    }
  }
}

async function saveTerminalStartupDefault(connectionId, startup) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) throw new Error(tr("terminal:startup.connection_missing"));
  const response = await api(`/api/connections/${connectionId}/terminal-startup`, {
    method:"POST",
    body:JSON.stringify(startup)
  });
  Object.assign(connection, normalizeTerminalStartupConfig(response.startup || response));
  updateTerminalStartupButtonsForConnection(connectionId);
  return connection;
}

function setTerminalStartupModalBusy(modal, busy) {
  const card = modal?.querySelector(".terminal-startup-modal");
  if (!card) return;
  modal.setAttribute("aria-busy", busy ? "true" : "false");
  for (const control of card.querySelectorAll("button,input,select")) {
    if (busy) {
      if (!control.hasAttribute("data-terminal-startup-disabled")) {
        control.dataset.terminalStartupDisabled = control.disabled ? "1" : "0";
      }
      control.disabled = true;
    } else {
      control.disabled = control.dataset.terminalStartupDisabled === "1";
      delete control.dataset.terminalStartupDisabled;
    }
  }
  card.classList.toggle("is-busy", busy);
}

async function applyTerminalStartupSettings(key, connectionId, target, button=null, splitZone="") {
  let connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const modal = $("modal");
  const modalContext = modal?._terminalStartupContext;
  if (!modalContext || modal._terminalStartupApplying) return;
  modal._terminalStartupApplying = true;
  setTerminalStartupModalBusy(modal, true);
  setButtonBusy(button, true, tr(target === "current" ? "terminal:startup.opening" : "terminal:startup.creating"));
  let defaultSaved = false;
  try {
    const startup = terminalStartupFormValue();
    const saveDefault = Boolean($("terminalStartupSaveDefault")?.checked);
    if (saveDefault) {
      connection = await saveTerminalStartupDefault(connectionId, startup);
      defaultSaved = true;
    }
    if (target === "current") {
      if (saveDefault) terminalStartupOverrides.delete(key);
      else terminalStartupOverrides.set(key, startup);
      if (modal._terminalStartupContext === modalContext) closeTerminalStartupSettings(key, true, true);
      updateTerminalStartupButton(key, connection);
      reconnectTerminal(connectionId, key);
      notify(tr(saveDefault ? "terminal:startup.saved_reconnecting" : "terminal:startup.temporary_reconnecting"), "success");
      return;
    }
    const sourceTab = tabs.find(item => item.key === key && item.kind === "terminal");
    if (!sourceTab || typeof duplicateWorkspaceTab !== "function") throw new Error(tr("terminal:startup.tab_closed"));
    const requestedSplit = target === "split" && !isMobileLayout();
    const duplicateResult = {};
    const duplicateKey = duplicateWorkspaceTab(key, {
      splitZone:requestedSplit ? splitZone : "",
      result:duplicateResult,
      beforeOpen:newKey => {
        if (saveDefault) terminalStartupOverrides.delete(newKey);
        else terminalStartupOverrides.set(newKey, startup);
      }
    });
    if (!duplicateKey) throw new Error(tr("terminal:startup.new_tab_failed"));
    const openedInSplit = duplicateResult.split === true;
    if (modal._terminalStartupContext === modalContext) closeTerminalStartupSettings(key, false, true);
    const destination = tr(openedInSplit ? "terminal:startup.new_split" : "terminal:startup.new_tab");
    notify(tr(saveDefault ? "terminal:startup.saved_opened" : "terminal:startup.temporary_opened", {destination}), "success");
  } catch (error) {
    notify(defaultSaved
      ? tr("terminal:startup.saved_open_failed", {error:error.message || tr("terminal:startup.unknown_error")})
      : error.message || tr("terminal:startup.apply_failed"), "error");
  } finally {
    setButtonBusy(button, false);
    if (modal._terminalStartupContext === modalContext) {
      modal._terminalStartupApplying = false;
      setTerminalStartupModalBusy(modal, false);
    }
  }
}

function restoreSavedTerminalStartup(key, connectionId) {
  if ($("modal")?._terminalStartupApplying) return;
  const connection = connections.find(item => item.id === connectionId);
  terminalStartupOverrides.delete(key);
  closeTerminalStartupSettings(key);
  updateTerminalStartupButton(key, connection);
  reconnectTerminal(connectionId, key);
  notify(tr("terminal:startup.restored_saved"), "success");
}

function showTerminalStartupSettings(key, connectionId) {
  if (!requireConfigEncryptionUnlocked(tr("terminal:startup.modify_title"))) return;
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = effectiveTerminalStartupConfig(connection, key);
  const saved = terminalStartupConfigForConnection(connection);
  const temporary = terminalStartupOverrides.has(key);
  const modal = $("modal");
  const modalContext = ++terminalStartupModalSerial;
  modal.onclick = null;
  modal._terminalStartupContext = modalContext;
  modal._terminalStartupKey = key;
  modal._terminalStartupConnectionId = connectionId;
  modal._terminalStartupRequestId = 0;
  modal._terminalStartupApplying = false;
  modal.innerHTML = `<div class="modal-card wide terminal-startup-modal" role="dialog" aria-modal="true" aria-labelledby="terminalStartupTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalStartupTitle">${esc(tr("terminal:startup.title", {defaultValue:"终端配置"}))}</h2><span>${esc(tr(temporary ? "terminal:startup.temporary_subtitle" : "terminal:startup.saved_subtitle", {defaultValue:temporary ? "当前标签正在使用临时配置" : "当前使用 SSH 连接中保存的默认配置"}))}</span></div><button class="icon-button" type="button" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" id="terminalStartupClose">${icon("x")}</button></div>
    <div class="terminal-startup-scroll">
    <div class="terminal-startup-saved-row">
      <div class="terminal-startup-saved">${esc(tr("terminal:startup.saved_value", {profile:terminalStartupConfigLabel(saved), defaultValue:`SSH 连接保存值：${terminalStartupConfigLabel(saved)}。已打开的终端不会自动变化。`}))}</div>
      ${temporary ? `<button id="terminalStartupRestore" type="button">${icon("rotate-ccw")}<span>${esc(tr("terminal:startup.restore_saved", {defaultValue:"恢复连接保存值"}))}</span></button>` : ""}
    </div>
    <label>${esc(tr("terminal:startup.profile", {defaultValue:"启动配置"}))}<select id="terminalStartupProfile"></select></label>
    <div class="terminal-startup-capability-control">
      <div id="terminalStartupCapabilitySummary" class="terminal-startup-capability loading">${esc(tr("terminal:startup.waiting_detection", {defaultValue:"等待检测远端环境"}))}</div>
      <button id="terminalStartupDetect" type="button">${icon("scan-search")}<span>${esc(tr("terminal:startup.detect_again", {defaultValue:"重新检测"}))}</span></button>
    </div>
    <div id="terminalStartupProgramFields" class="terminal-startup-fields">
      <input id="terminalStartupKind" type="hidden" value="custom">
      <div class="grid">
        <label>${esc(tr("terminal:startup.profile_name", {defaultValue:"配置名称"}))}<input id="terminalStartupProfileName" maxlength="120" placeholder="${escAttr(tr("terminal:startup.profile_example", {defaultValue:"例如：Bash（登录模式）"}))}"></label>
        <label>${esc(tr("terminal:startup.remote_type", {defaultValue:"远端类型"}))}<select id="terminalStartupPlatform"><option value="auto">${esc(tr("terminal:startup.auto_detect", {defaultValue:"自动识别"}))}</option><option value="posix">Linux / macOS / Unix</option><option value="windows">Windows OpenSSH</option></select></label>
      </div>
      <label>${esc(tr("terminal:startup.program_path", {defaultValue:"程序完整路径"}))}<input id="terminalStartupPath" maxlength="2048" spellcheck="false" placeholder="/bin/bash, /usr/bin/python3, or C:\\Program Files\\PowerShell\\7\\pwsh.exe"></label>
      <label>${esc(tr("terminal:startup.startup_args", {defaultValue:"启动参数"}))}<input id="terminalStartupArgs" maxlength="4096" spellcheck="false" placeholder="${escAttr(tr("terminal:startup.startup_args_hint", {defaultValue:"-l、-i 等；路径和参数请分开填写"}))}"></label>
      <label>${esc(tr("terminal:startup.working_directory", {defaultValue:"启动工作目录（可选）"}))}<input id="terminalStartupCwd" maxlength="2048" spellcheck="false" placeholder="/srv/app or C:\\work"></label>
      <div class="muted">${esc(tr("terminal:startup.secret_warning", {defaultValue:"参数支持引号分组。请勿在启动参数中填写密码、令牌或私钥。"}))}</div>
    </div>
    <label class="terminal-startup-save-default">
      <input id="terminalStartupSaveDefault" type="checkbox">
      <span><strong>${esc(tr("terminal:startup.save_default", {defaultValue:"同时保存为该 SSH 连接的默认配置"}))}</strong><small>${esc(tr("terminal:startup.save_default_hint", {defaultValue:"默认不勾选；未勾选时只对这次打开的目标标签临时生效。"}))}</small></span>
    </label>
    </div>
    <div class="actions terminal-startup-actions">
      <button id="terminalStartupCancel" type="button">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button>
      <button id="terminalStartupCurrent" class="primary" type="button">${icon("refresh-cw")}<span>${esc(tr("terminal:startup.open_current", {defaultValue:"本终端打开"}))}</span></button>
      <button id="terminalStartupNewTab" type="button">${icon("copy-plus")}<span>${esc(tr("terminal:startup.open_new_tab", {defaultValue:"新标签打开"}))}</span></button>
      ${!isMobileLayout() ? `<div class="terminal-startup-split-picker">
        <button id="terminalStartupSplit" type="button" aria-haspopup="menu" title="${escAttr(tr("terminal:startup.split_picker", {defaultValue:"悬浮后选择上、下、左、右分屏"}))}">${icon("panels-top-left")}<span>${esc(tr("terminal:startup.open_split", {defaultValue:"新标签分屏打开"}))}</span>${icon("chevron-up")}</button>
        <div class="terminal-startup-split-options" role="menu" aria-label="${escAttr(tr("terminal:startup.split_direction", {defaultValue:"选择新标签分屏方向"}))}">
          <span class="terminal-startup-split-center" aria-hidden="true">${icon("panels-top-left")}</span>
          <button data-split-zone="top" type="button" role="menuitem" title="${escAttr(tr("terminal:startup.split_top", {defaultValue:"在上方分屏打开"}))}" aria-label="${escAttr(tr("terminal:startup.split_top", {defaultValue:"在上方分屏打开"}))}" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'top')">${icon("arrow-up")}</button>
          <button data-split-zone="bottom" type="button" role="menuitem" title="${escAttr(tr("terminal:startup.split_bottom", {defaultValue:"在下方分屏打开"}))}" aria-label="${escAttr(tr("terminal:startup.split_bottom", {defaultValue:"在下方分屏打开"}))}" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'bottom')">${icon("arrow-down")}</button>
          <button data-split-zone="left" type="button" role="menuitem" title="${escAttr(tr("terminal:startup.split_left", {defaultValue:"在左侧分屏打开"}))}" aria-label="${escAttr(tr("terminal:startup.split_left", {defaultValue:"在左侧分屏打开"}))}" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'left')">${icon("arrow-left")}</button>
          <button data-split-zone="right" type="button" role="menuitem" title="${escAttr(tr("terminal:startup.split_right", {defaultValue:"在右侧分屏打开"}))}" aria-label="${escAttr(tr("terminal:startup.split_right", {defaultValue:"在右侧分屏打开"}))}" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'right')">${icon("arrow-right")}</button>
        </div>
      </div>` : ""}
    </div>
  </div>`;
  modal.hidden = false;
  modal._terminalStartupProfiles = [];
  fillTerminalStartupForm(current);
  $("terminalStartupProfile").innerHTML = `<option value="default">${esc(tr("terminal:startup.default_option", {defaultValue:"自动（使用服务器默认登录 Shell）"}))}</option><option value="custom">${esc(tr("terminal:startup.custom_option", {defaultValue:"自定义程序、Shell 或命令行工具"}))}</option>`;
  $("terminalStartupProfile").value = current.terminal_startup_mode === "default" ? "default" : "custom";
  syncTerminalStartupForm();
  $("terminalStartupProfile").onchange = chooseTerminalStartupProfile;
  for (const id of ["terminalStartupProfileName", "terminalStartupPath", "terminalStartupArgs", "terminalStartupCwd", "terminalStartupPlatform"]) {
    $(id).addEventListener("input", markTerminalStartupCustom);
    $(id).addEventListener("change", markTerminalStartupCustom);
  }
  $("terminalStartupClose").onclick = () => closeTerminalStartupSettings(key);
  $("terminalStartupCancel").onclick = () => closeTerminalStartupSettings(key);
  $("terminalStartupDetect").onclick = event => refreshTerminalStartupCapabilities(connectionId, key, event.currentTarget);
  $("terminalStartupCurrent").onclick = event => applyTerminalStartupSettings(key, connectionId, "current", event.currentTarget);
  $("terminalStartupNewTab").onclick = event => applyTerminalStartupSettings(key, connectionId, "new", event.currentTarget);
  if ($("terminalStartupRestore")) $("terminalStartupRestore").onclick = () => restoreSavedTerminalStartup(key, connectionId);
  modal.onkeydown = event => {
    if (event.key === "Escape") closeTerminalStartupSettings(key);
  };
  refreshIcons();
  refreshTerminalStartupCapabilities(connectionId, key, $("terminalStartupDetect"));
  requestAnimationFrame(() => $("terminalStartupProfile")?.focus({preventScroll:true}));
}
