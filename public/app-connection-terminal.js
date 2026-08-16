const CONNECTION_TERMINAL_PROFILE_GROUPS = [
  ["shell", "terminal:startup.group_shell", "Shell"],
  ["repl", "terminal:startup.group_repl", "交互式语言"],
  ["session", "terminal:startup.group_session", "会话工具"],
  ["tool", "terminal:startup.group_tool", "交互工具"],
  ["custom", "terminal:startup.group_custom", "其他"]
];

function connectionFormField(form, id) {
  if (form?.querySelector) return form.querySelector(`#${CSS.escape(id)}`);
  return $(id);
}

function normalizeConnectionTerminalKind(value) {
  return ["shell", "repl", "session", "tool", "custom"].includes(String(value || "").toLowerCase())
    ? String(value).toLowerCase()
    : "custom";
}

function normalizeConnectionTerminalPlatform(value) {
  const platform = String(value || "").toLowerCase();
  if (["windows", "win32", "win"].includes(platform)) return "windows";
  if (["posix", "linux", "darwin", "macos", "unix", "freebsd"].includes(platform)) return "posix";
  return "auto";
}

function connectionTerminalArgs(value) {
  if (Array.isArray(value)) return value.map(item => String(item ?? "")).filter(Boolean).join(" ");
  return String(value ?? "");
}

function connectionTerminalProfilePath(profile) {
  return String(profile?.path ?? profile?.program_path ?? profile?.executable ?? profile?.command ?? "");
}

function connectionTerminalFormConfig(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  const mode = field("conn_terminal_startup_mode")?.value === "program" ? "program" : "default";
  return {
    terminal_startup_mode:mode,
    terminal_profile_name:field("conn_terminal_profile_name")?.value.trim() || "",
    terminal_profile_kind:normalizeConnectionTerminalKind(field("conn_terminal_profile_kind")?.value),
    terminal_program_path:field("conn_terminal_program_path")?.value.trim() || "",
    terminal_program_args:field("conn_terminal_program_args")?.value.trim() || "",
    terminal_working_directory:field("conn_terminal_working_directory")?.value.trim() || "",
    terminal_program_platform:normalizeConnectionTerminalPlatform(field("conn_terminal_program_platform")?.value)
  };
}

function toggleConnectionTerminalStartup(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  const program = field("conn_terminal_startup_mode")?.value === "program";
  const box = field("connTerminalProgramFields");
  const path = field("conn_terminal_program_path");
  const profileSelect = field("conn_terminal_profile_select");
  if (box) {
    box.hidden = !program;
    box.setAttribute("aria-hidden", String(!program));
  }
  if (path) path.required = program;
  if (profileSelect) {
    if (program && (profileSelect.value === "" || profileSelect.value === "__default__")) {
      if ([...profileSelect.options].some(option => option.value === "__custom__")) {
        profileSelect.value = "__custom__";
        if (!field("conn_terminal_profile_name")?.value.trim()) field("conn_terminal_profile_name").value = tr("terminal:startup.custom_program", {defaultValue:"自定义程序"});
        if (field("conn_terminal_profile_kind")) field("conn_terminal_profile_kind").value = "custom";
      }
    } else if (!program && [...profileSelect.options].some(option => option.value === "__default__")) {
      profileSelect.value = "__default__";
    }
  }
}

function resetConnectionTerminalProfileSelect(form, saved=false) {
  const select = connectionFormField(form, "conn_terminal_profile_select");
  if (!select) return;
  const config = connectionTerminalFormConfig(form);
  select.replaceChildren();
  if (saved && config.terminal_startup_mode === "program" && config.terminal_program_path) {
    select.add(new Option(tr("terminal:startup.saved_option", {name:config.terminal_profile_name || config.terminal_program_path, defaultValue:`当前已保存：${config.terminal_profile_name || config.terminal_program_path}`}), "__current__", true, true));
  } else {
    select.add(new Option(tr("terminal:startup.test_ssh_hint", {defaultValue:"测试 SSH 后显示可用选项"}), "", true, true));
  }
  select.add(new Option(tr("terminal:startup.custom_program_option", {defaultValue:"自定义程序..."}), "__custom__"));
}

function resetConnectionTerminalStartup(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  if (!field("conn_terminal_startup_mode")) return;
  field("conn_terminal_startup_mode").value = "default";
  field("conn_terminal_profile_name").value = "";
  field("conn_terminal_profile_kind").value = "shell";
  field("conn_terminal_program_path").value = "";
  field("conn_terminal_program_args").value = "";
  field("conn_terminal_working_directory").value = "";
  field("conn_terminal_program_platform").value = "auto";
  resetConnectionTerminalProfileSelect(form);
  const status = field("connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection muted";
    status.textContent = tr("terminal:startup.not_detected", {defaultValue:"尚未检测。填写连接信息后点击“测试 SSH”。"});
  }
  const summary = field("connTerminalCapabilities");
  if (summary) {
    summary.hidden = true;
    summary.className = "terminal-startup-capabilities";
    summary.replaceChildren();
  }
  form._terminalCapabilities = null;
  form._terminalCapabilitiesChecked = false;
  form._terminalProbeStale = false;
  form._terminalCredentialRevision = 0;
  toggleConnectionTerminalStartup(form);
}

function fillConnectionTerminalStartup(form, connection={}) {
  const field = id => connectionFormField(form, id);
  if (!field("conn_terminal_startup_mode")) return;
  const mode = connection.terminal_startup_mode === "program" || connection.terminal_program_path ? "program" : "default";
  field("conn_terminal_startup_mode").value = mode;
  field("conn_terminal_profile_name").value = connection.terminal_profile_name || "";
  field("conn_terminal_profile_kind").value = normalizeConnectionTerminalKind(connection.terminal_profile_kind || (mode === "program" ? "custom" : "shell"));
  field("conn_terminal_program_path").value = connection.terminal_program_path || "";
  field("conn_terminal_program_args").value = connection.terminal_program_args || "";
  field("conn_terminal_working_directory").value = connection.terminal_working_directory || "";
  field("conn_terminal_program_platform").value = normalizeConnectionTerminalPlatform(connection.terminal_program_platform);
  resetConnectionTerminalProfileSelect(form, true);
  const status = field("connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection muted";
    status.textContent = mode === "program"
      ? tr("terminal:startup.saved_detection", {defaultValue:"已加载保存的启动配置。测试 SSH 可刷新这台机器的可用选项。"})
      : tr("terminal:startup.server_default_hint", {defaultValue:"当前使用服务器默认登录 Shell。测试 SSH 可检测更多可用选项。"});
  }
  form._terminalCapabilities = null;
  form._terminalCapabilitiesChecked = false;
  form._terminalProbeStale = false;
  form._terminalCredentialRevision = 0;
  toggleConnectionTerminalStartup(form);
}

function connectionTerminalCapabilityProfiles(raw={}) {
  const direct = Array.isArray(raw.profiles) ? raw.profiles : Array.isArray(raw.terminal_profiles) ? raw.terminal_profiles : [];
  const combined = direct.length ? direct : [
    ...(Array.isArray(raw.shells) ? raw.shells.map(item => typeof item === "object" ? {...item, kind:item.kind || "shell"} : {label:String(item), path:String(item), kind:"shell"}) : []),
    ...(Array.isArray(raw.repls) ? raw.repls.map(item => typeof item === "object" ? {...item, kind:item.kind || "repl"} : {label:String(item), path:String(item), kind:"repl"}) : []),
    ...(Array.isArray(raw.session_tools) ? raw.session_tools.map(item => typeof item === "object" ? {...item, kind:item.kind || "session"} : {label:String(item), path:String(item), kind:"session"}) : []),
    ...(Array.isArray(raw.interactive_tools) ? raw.interactive_tools.map(item => typeof item === "object" ? {...item, kind:item.kind || "tool"} : {label:String(item), path:String(item), kind:"tool"}) : [])
  ];
  return combined
    .map((profile, index) => {
      const item = typeof profile === "object" && profile ? profile : {path:String(profile || "")};
      const path = connectionTerminalProfilePath(item);
      if (!path) return null;
      return {
        ...item,
        _index:index,
        label:String(item.label || item.name || path),
        name:String(item.name || item.label || path),
        path,
        args:connectionTerminalArgs(item.args ?? item.program_args),
        kind:normalizeConnectionTerminalKind(item.kind || item.type),
        platform:normalizeConnectionTerminalPlatform(item.platform || raw.platform),
        working_directory:String(item.working_directory ?? item.cwd ?? "")
      };
    })
    .filter(Boolean);
}

function normalizeConnectionTerminalCapabilities(raw={}) {
  const defaultValue = raw.default_shell ?? raw.login_shell ?? null;
  const defaultShell = typeof defaultValue === "string"
    ? {name:defaultValue.split(/[\\/]/).pop() || defaultValue, label:defaultValue.split(/[\\/]/).pop() || defaultValue, path:defaultValue}
    : defaultValue && typeof defaultValue === "object"
      ? {
          ...defaultValue,
          name:String(defaultValue.name || defaultValue.label || connectionTerminalProfilePath(defaultValue)),
          label:String(defaultValue.label || defaultValue.name || connectionTerminalProfilePath(defaultValue)),
          path:connectionTerminalProfilePath(defaultValue)
        }
      : null;
  const tools = (Array.isArray(raw.tools) ? raw.tools : [])
    .map(item => typeof item === "object" && item
      ? {label:String(item.label || item.name || item.id || item.path || ""), path:String(item.path || ""), version:String(item.version || "")}
      : {label:String(item || ""), path:"", version:""})
    .filter(item => item.label);
  return {
    platform:String(raw.platform || "unknown").toLowerCase(),
    platform_label:String(raw.platform_label || raw.os_label || raw.platform || tr("terminal:startup.unknown_platform", {defaultValue:"未知平台"})),
    default_shell:defaultShell,
    profiles:connectionTerminalCapabilityProfiles(raw),
    tools,
    warnings:(Array.isArray(raw.warnings) ? raw.warnings : raw.warning ? [raw.warning] : []).map(String).filter(Boolean)
  };
}

function appendConnectionTerminalCapabilityChip(parent, text, title="") {
  const chip = document.createElement("span");
  chip.className = "terminal-startup-chip";
  chip.textContent = text;
  if (title) chip.title = title;
  parent.appendChild(chip);
}

function renderConnectionTerminalCapabilitySummary(form, capabilities) {
  const box = connectionFormField(form, "connTerminalCapabilities");
  if (!box) return;
  box.replaceChildren();
  box.hidden = false;
  box.className = "terminal-startup-capabilities";

  const heading = document.createElement("div");
  heading.className = "terminal-startup-capability-heading";
  const defaultShell = capabilities.default_shell;
  const shellText = defaultShell?.path || defaultShell?.label || tr("terminal:startup.not_detected_short", {defaultValue:"未识别"});
  heading.textContent = tr("terminal:startup.capability_summary", {platform:capabilities.platform_label, shell:shellText, defaultValue:`${capabilities.platform_label} · 默认 Shell：${shellText}`});
  box.appendChild(heading);

  if (capabilities.profiles.length) {
    const row = document.createElement("div");
    row.className = "terminal-startup-capability-row";
    const label = document.createElement("strong");
    label.textContent = tr("terminal:startup.launchable", {defaultValue:"可启动"});
    row.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "terminal-startup-chips";
    capabilities.profiles.forEach(profile => appendConnectionTerminalCapabilityChip(chips, profile.label, `${profile.path}${profile.args ? ` ${profile.args}` : ""}`));
    row.appendChild(chips);
    box.appendChild(row);
  }

  if (capabilities.tools.length) {
    const row = document.createElement("div");
    row.className = "terminal-startup-capability-row";
    const label = document.createElement("strong");
    label.textContent = tr("terminal:startup.installed_tools", {defaultValue:"已安装工具"});
    row.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "terminal-startup-chips";
    capabilities.tools.forEach(tool => appendConnectionTerminalCapabilityChip(chips, `${tool.label}${tool.version ? ` ${tool.version}` : ""}`, tool.path));
    row.appendChild(chips);
    box.appendChild(row);
  }

  capabilities.warnings.forEach(text => {
    const warning = document.createElement("div");
    warning.className = "terminal-startup-capability-warning";
    warning.textContent = text;
    box.appendChild(warning);
  });
}

function renderConnectionTerminalProfiles(form, rawCapabilities) {
  const capabilities = normalizeConnectionTerminalCapabilities(rawCapabilities);
  const select = connectionFormField(form, "conn_terminal_profile_select");
  const config = connectionTerminalFormConfig(form);
  form._terminalCapabilities = capabilities;
  form._terminalCapabilitiesChecked = true;
  form._terminalProbeStale = false;
  if (!select) return capabilities;

  select.replaceChildren();
  const defaultShell = capabilities.default_shell;
  const defaultLabel = defaultShell?.label || defaultShell?.name || defaultShell?.path;
  select.add(new Option(defaultLabel
    ? tr("terminal:startup.default_detected_option", {shell:defaultLabel, defaultValue:`自动使用默认 Shell（${defaultLabel}）`})
    : tr("terminal:startup.default_login_shell_option", {defaultValue:"自动使用服务器默认登录 Shell"}), "__default__"));

  const profileIndex = new Map(capabilities.profiles.map((profile,index) => [profile, index]));
  for (const [kind, labelKey, fallbackLabel] of CONNECTION_TERMINAL_PROFILE_GROUPS) {
    const profiles = capabilities.profiles.filter(profile => profile.kind === kind);
    if (!profiles.length) continue;
    const group = document.createElement("optgroup");
    group.label = tr(labelKey, {defaultValue:fallbackLabel});
    profiles.forEach(profile => group.appendChild(new Option(
      `${profile.label}${profile.args ? ` · ${profile.args}` : ""}`,
      `profile:${profileIndex.get(profile)}`
    )));
    select.appendChild(group);
  }
  select.add(new Option(tr("terminal:startup.custom_program_option", {defaultValue:"自定义程序..."}), "__custom__"));

  if (config.terminal_startup_mode === "default") {
    select.value = "__default__";
  } else {
    const matchIndex = capabilities.profiles.findIndex(profile =>
      profile.path === config.terminal_program_path
      && profile.args === config.terminal_program_args
    );
    if (matchIndex >= 0) {
      select.value = `profile:${matchIndex}`;
    } else {
      const current = new Option(tr("terminal:startup.current_option", {name:config.terminal_profile_name || config.terminal_program_path, defaultValue:`当前配置：${config.terminal_profile_name || config.terminal_program_path}`}), "__current__", true, true);
      select.insertBefore(current, select.firstChild);
    }
  }
  renderConnectionTerminalCapabilitySummary(form, capabilities);
  return capabilities;
}

function applyConnectionTerminalProfile(value, select=null) {
  const form = select?.closest?.("form") || $("connectionForm");
  const field = id => connectionFormField(form, id);
  if (!form || !field("conn_terminal_startup_mode") || value === "" || value === "__current__") return;
  if (value === "__default__") {
    field("conn_terminal_startup_mode").value = "default";
    toggleConnectionTerminalStartup(form);
    return;
  }
  if (value === "__custom__") {
    field("conn_terminal_startup_mode").value = "program";
    if (!field("conn_terminal_profile_name").value.trim()) field("conn_terminal_profile_name").value = tr("terminal:startup.custom_program", {defaultValue:"自定义程序"});
    field("conn_terminal_profile_kind").value = "custom";
    toggleConnectionTerminalStartup(form);
    setTimeout(() => field("conn_terminal_program_path")?.focus(), 0);
    return;
  }
  const index = Number(String(value).replace(/^profile:/, ""));
  const profile = form._terminalCapabilities?.profiles?.[index];
  if (!profile) return;
  field("conn_terminal_startup_mode").value = "program";
  field("conn_terminal_profile_name").value = profile.name || profile.label || "";
  field("conn_terminal_profile_kind").value = normalizeConnectionTerminalKind(profile.kind);
  field("conn_terminal_program_path").value = profile.path;
  field("conn_terminal_program_args").value = profile.args || "";
  field("conn_terminal_working_directory").value = profile.working_directory || "";
  field("conn_terminal_program_platform").value = normalizeConnectionTerminalPlatform(profile.platform);
  toggleConnectionTerminalStartup(form);
}

function markConnectionTerminalDetectionStale(form=$("connectionForm")) {
  if (!form?._terminalCapabilitiesChecked || form._terminalProbeStale) return;
  form._terminalProbeStale = true;
  const status = connectionFormField(form, "connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection stale";
    status.textContent = tr("terminal:startup.detection_stale", {defaultValue:"连接信息已变化，下面的检测结果可能已过期。请重新测试 SSH。"});
  }
  connectionFormField(form, "connTerminalCapabilities")?.classList.add("is-stale");
}
