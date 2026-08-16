function isLoopbackHost(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(String(host || "").toLowerCase());
}

function configEncryptionLocked() {
  return Boolean(
    securitySettings?.encryption_enabled
    && (securitySettings?.encryption_ready === false || securitySettings?.encryption_transition_pending)
  );
}

function requireConfigEncryptionUnlocked(action="") {
  if (!configEncryptionLocked()) return true;
  const actionLabel = action || tr("common:dialogs.modify_encrypted_config", {defaultValue:"修改加密配置"});
  notify(
    securitySettings?.encryption_transition_pending
      ? tr("common:notifications.encryption_transition_locked_action", {action:actionLabel, defaultValue:`配置加密切换尚未完成，输入主密码继续修复后才能${actionLabel}`})
      : tr("common:notifications.encryption_locked_action", {action:actionLabel, defaultValue:`配置加密已锁定，解锁后才能${actionLabel}`}),
    "error"
  );
  if (typeof openSettingsSection === "function") void openSettingsSection("settings-basic");
  return false;
}

function icon(name, label="") {
  if (name === "x11") return x11Icon(label);
  const key = String(name || "").split("-").map(part => part ? part[0].toUpperCase() + part.slice(1) : "").join("");
  const nodes = window.lucide?.icons?.[key] || window.lucide?.[key];
  if (!Array.isArray(nodes)) return `<span class="icon-fallback" aria-hidden="true"></span>`;
  const children = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([attr,value]) => `${attr}="${esc(String(value))}"`).join(" ")}></${tag}>`).join("");
  const accessibility = label ? `aria-label="${escAttr(label)}"` : `aria-hidden="true"`;
  return `<svg class="lucide lucide-${escAttr(name)}" ${accessibility} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function x11Icon(label="") {
  const accessibility = label ? `aria-label="${escAttr(label)}"` : `aria-hidden="true"`;
  return `<span class="composite-icon x11-icon" ${accessibility}>${icon("monitor")}<b>X11</b></span>`;
}

function syncPasswordVisibilityControl(input) {
  if (!input?.matches?.("input[data-password-visibility-input]")) return;
  const control = input.closest(".password-input-control");
  const button = control?.querySelector(".password-visibility-toggle");
  if (!control || !button) return;
  const visible = input.type === "text";
  const label = visible
    ? tr("common:auto.hide_password", {defaultValue:"隐藏密码"})
    : tr("common:auto.show_password", {defaultValue:"显示密码"});
  button.disabled = Boolean(input.disabled);
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(visible));
  button.innerHTML = icon(visible ? "eye-off" : "eye");
  if (input.hidden) {
    control.hidden = true;
    control.dataset.hiddenByPasswordInput = "true";
  } else if (control.dataset.hiddenByPasswordInput === "true") {
    control.hidden = false;
    delete control.dataset.hiddenByPasswordInput;
  }
}

function enhancePasswordInputs(root=document) {
  if (!root) return;
  const inputs = [];
  if (root.matches?.("input[type='password'], input[data-password-visibility-input]")) inputs.push(root);
  inputs.push(...root.querySelectorAll?.("input[type='password'], input[data-password-visibility-input]") || []);
  for (const input of inputs) {
    if (input?.tagName !== "INPUT") continue;
    if (!input.dataset.passwordVisibilityInput) {
      input.dataset.passwordVisibilityInput = "true";
      const control = document.createElement("div");
      control.className = "password-input-control";
      input.parentNode?.insertBefore(control, input);
      control.appendChild(input);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "password-visibility-toggle";
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", event => {
        event.preventDefault();
        const activeElement = document.activeElement;
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.type = input.type === "password" ? "text" : "password";
        syncPasswordVisibilityControl(input);
        if (activeElement === input) {
          input.focus({preventScroll:true});
          if (selectionStart !== null && selectionEnd !== null) {
            try { input.setSelectionRange(selectionStart, selectionEnd); } catch {}
          }
        }
      });
      control.appendChild(button);
    }
    syncPasswordVisibilityControl(input);
  }
}

function refreshIcons() {
  enhancePasswordInputs(document);
  if (!window.lucide || !document.querySelector("i[data-lucide]")) return;
  window.lucide.createIcons({attrs:{"stroke-width":1.8}});
  document.querySelectorAll("svg[data-lucide]").forEach(svg => svg.removeAttribute("data-lucide"));
}

function hideActionMenu() {
  $("actionMenu")?.remove();
  $("actionSubMenu")?.remove();
  $("actionMenuBackdrop")?.remove();
}

function actionMenuChildren(action) {
  if (!action?.children) return [];
  const children = typeof action.children === "function" ? action.children() : action.children;
  return Array.isArray(children) ? children : [];
}

function localizedTermaUiPhrase(value) {
  const source = String(value ?? "");
  if (!source || typeof translatedTermaPhrase !== "function") return source;
  return translatedTermaPhrase(source) || source;
}

function localizedIdentitySourceLabel(identity={}) {
  const source = String(identity?.source || "").toLowerCase();
  if (source === "project") return tr("connections:identity.source_project", {defaultValue:"当前密钥目录"});
  if (source === "user") return tr("connections:identity.source_user", {defaultValue:"用户 ~/.ssh"});
  return tr("connections:identity.source_unknown", {defaultValue:"已识别私钥"});
}

function localizedIdentityFileLabel(identity={}, options={}) {
  const pathValue = String(identity?.path || "");
  const rawLabel = String(identity?.label || "");
  const sourceLabel = String(identity?.source_label || "");
  const fallbackName = pathValue.split(/[\\/]/).filter(Boolean).pop() || rawLabel || pathValue;
  const name = String(identity?.name || rawLabel.replace(sourceLabel ? new RegExp(`\\s*(?:-|·)\\s*${sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) : /$^/, "") || fallbackName);
  const label = tr("connections:identity.file_label", {
    name,
    source:localizedIdentitySourceLabel(identity),
    defaultValue:`${name} - ${localizedIdentitySourceLabel(identity)}`
  });
  if (options.permission === false || identity?.permission_ok !== false) return label;
  const suffixKey = options.repair ? "connections:identity.permission_repair" : "connections:identity.permission_check";
  return `${label}${tr(suffixKey, {defaultValue:options.repair ? "（权限需修复）" : "（需检查权限）"})}`;
}

function fillActionMenu(menu, actions, options={}) {
  const mobile = Boolean(options.mobile);
  const history = Array.isArray(options.history) ? options.history : [];
  menu.replaceChildren();
  if (mobile && history.length) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "action-menu-back";
    back.innerHTML = `${icon("arrow-left")}<span>${esc(tr("common:auto.back_to_parent_menu", {defaultValue:"返回上一级"}))}</span>`;
    back.onclick = clickEvent => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      const previous = history.at(-1);
      fillActionMenu(menu, previous.actions, {mobile:true, history:history.slice(0, -1)});
    };
    menu.appendChild(back);
    const separator = document.createElement("div");
    separator.className = "menu-separator";
    menu.appendChild(separator);
  }
  for (const action of actions) {
    if (action.separator) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      menu.appendChild(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${action.danger ? "danger" : ""}${action.children ? " has-submenu" : ""}`.trim();
    const label = localizedTermaUiPhrase(action.label);
    button.innerHTML = `${icon(action.icon || "circle")}<span>${esc(label)}</span>${action.children ? icon("chevron-right") : ""}`;
    button.onclick = clickEvent => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      if (action.children) {
        const children = actionMenuChildren(action);
        if (!children.length) return;
        if (mobile) {
          fillActionMenu(menu, children, {mobile:true, history:[...history, {actions}]});
        } else {
          showActionSubMenu(button, children);
        }
        return;
      }
      hideActionMenu();
      Promise.resolve(action.run?.(clickEvent)).catch(error => notify(error?.message || tr("common:auto.operation_failed", {defaultValue:"操作失败"}), "error"));
    };
    menu.appendChild(button);
  }
  if (mobile) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "action-menu-close";
    close.innerHTML = `${icon("x")}<span>${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</span>`;
    close.onclick = hideActionMenu;
    menu.appendChild(close);
  }
}

function showActionSubMenu(anchor, actions) {
  $("actionSubMenu")?.remove();
  const menu = document.createElement("div");
  menu.id = "actionSubMenu";
  menu.className = "context-menu action-menu action-submenu";
  fillActionMenu(menu, actions);
  document.body.appendChild(menu);
  const anchorRect = anchor.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const right = anchorRect.right + 4;
  const left = right + rect.width <= window.innerWidth - 8
    ? right
    : Math.max(8, anchorRect.left - rect.width - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, Math.min(anchorRect.top, window.innerHeight - rect.height - 8))}px`;
}

function showActionMenu(event, actions) {
  event.preventDefault();
  event.stopPropagation();
  hideActionMenu();
  const menu = document.createElement("div");
  menu.id = "actionMenu";
  menu.className = "context-menu action-menu";
  const mobile = isMobileLayout();
  fillActionMenu(menu, actions, {mobile});
  document.body.appendChild(menu);
  if (mobile) {
    const backdrop = document.createElement("button");
    backdrop.id = "actionMenuBackdrop";
    backdrop.className = "action-menu-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", tr("common:auto.close_menu", {defaultValue:"关闭菜单"}));
    backdrop.onclick = hideActionMenu;
    document.body.insertBefore(backdrop, menu);
    menu.classList.add("mobile-action-menu");
    return;
  }
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
}

function updateFilePicker(input) {
  const name = input.closest(".file-picker")?.querySelector(".file-picker-name");
  if (name) {
    const files = Array.from(input.files || []);
    if (files.length > 1) {
      name.removeAttribute("data-i18n");
      name.setAttribute("data-i18n-skip", "true");
      name.dataset.filePickerCount = String(files.length);
      name.textContent = tr("common:local_files.selected_files", {count:files.length, defaultValue:`已选择 ${files.length} 个文件`});
    } else if (files.length === 1) {
      name.removeAttribute("data-i18n");
      name.setAttribute("data-i18n-skip", "true");
      delete name.dataset.filePickerCount;
      name.textContent = files[0].name;
    } else {
      name.removeAttribute("data-i18n-skip");
      delete name.dataset.filePickerCount;
      name.setAttribute("data-i18n", "common:auto.not_selected");
      name.textContent = tr("common:auto.not_selected", {defaultValue:"未选择文件"});
    }
  }
  settleNativeFileDialogViewport();
}

function syncFilePickerLabels(root=document) {
  const scope = root?.querySelectorAll ? root : document;
  for (const name of scope.querySelectorAll(".file-picker-name[data-file-picker-count]")) {
    const count = Number(name.dataset.filePickerCount || 0);
    if (Number.isSafeInteger(count) && count > 1) {
      name.textContent = tr("common:local_files.selected_files", {count, defaultValue:`已选择 ${count} 个文件`});
    }
  }
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => syncFilePickerLabels());

function currentPageHostForForward(bindHost) {
  const currentHost = location.hostname;
  if (isLoopbackHost(currentHost)) return bindHost;
  if (["0.0.0.0", "::", ""].includes(String(bindHost || ""))) return currentHost;
  return bindHost;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches;
}

function preferredTheme() {
  return localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function syncThemeToggleControls(theme=document.documentElement.dataset.theme || preferredTheme()) {
  const text = theme === "dark"
    ? tr("common:auto.switch_to_light", {defaultValue:"切换为亮色"})
    : tr("common:auto.switch_to_dark", {defaultValue:"切换为暗色"});
  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.title = text;
    btn.setAttribute("aria-label", text);
    btn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  syncThemeToggleControls(theme);
  window.termaDesktop?.setTheme?.(theme);
  if (typeof applyTerminalGlobalSettingsToSessions === "function") applyTerminalGlobalSettingsToSessions();
  if (typeof syncTerminalBackgroundForm === "function") syncTerminalBackgroundForm();
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => syncThemeToggleControls());

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function loadGroupState() {
  try {
    return new Set(JSON.parse(localStorage.getItem("openGroups") || "[]"));
  } catch {
    return new Set();
  }
}

function saveGroupState() {
  localStorage.setItem("openGroups", JSON.stringify([...groupOpen]));
}

function loadRemoteGroupState() {
  try {
    return new Set(JSON.parse(localStorage.getItem("openRemoteGroups") || "[]"));
  } catch {
    return new Set();
  }
}

function saveRemoteGroupState() {
  localStorage.setItem("openRemoteGroups", JSON.stringify([...remoteGroupOpen]));
}

function loadRemoteHostState() {
  try {
    return new Set(JSON.parse(localStorage.getItem("openRemoteHostsV2") || "[]"));
  } catch {
    return new Set();
  }
}

function saveRemoteHostState() {
  localStorage.setItem("openRemoteHostsV2", JSON.stringify([...remoteHostOpen]));
}

function loadRunningState() {
  try {
    return new Set(JSON.parse(localStorage.getItem("openRunningGroups") || "[]"));
  } catch {
    return new Set();
  }
}

function saveRunningState() {
  localStorage.setItem("openRunningGroups", JSON.stringify([...runningOpen]));
}

function loadLogState() {
  try {
    return new Set(JSON.parse(localStorage.getItem("openLogs") || "[\"system\",\"batch\"]"));
  } catch {
    return new Set(["system", "batch"]);
  }
}

function saveLogState() {
  localStorage.setItem("openLogs", JSON.stringify([...logOpen]));
}

const toastTimers = new Map();
let toastSequence = 0;
let toastLayoutFrame = 0;

function notificationDisplayPreferences() {
  const saved = typeof runtimeSettings !== "undefined" ? runtimeSettings?.saved?.notification_display : null;
  const source = saved && typeof saved === "object" ? saved : {};
  return {
    info:{enabled:source.info?.enabled !== false, duration_ms:Number(source.info?.duration_ms) || 3500},
    success:{enabled:source.success?.enabled !== false, duration_ms:Number(source.success?.duration_ms) || 3500},
    error:{enabled:source.error?.enabled !== false, duration_ms:Number(source.error?.duration_ms) || 8000},
    progress:{
      enabled:source.progress?.enabled !== false,
      success_duration_ms:Number.isInteger(source.progress?.success_duration_ms) ? source.progress.success_duration_ms : null,
      error_duration_ms:Number(source.progress?.error_duration_ms) || 8000
    }
  };
}

function emptyProgressToastController() {
  return {
    update:() => {},
    finish:() => {},
    fail:() => {},
    dismiss:() => {},
    setPaused:() => {}
  };
}

function prefersReducedToastMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function syncToastStackLayout() {
  cancelAnimationFrame(toastLayoutFrame);
  toastLayoutFrame = requestAnimationFrame(() => {
    const stack = $("toast");
    const topbar = document.querySelector(".topbar");
    let offset = 0;
    if (stack?.childElementCount && topbar) {
      const stackRect = stack.getBoundingClientRect();
      const taskFloatBaseTop = topbar.getBoundingClientRect().bottom + 8;
      offset = Math.max(0, Math.ceil(stackRect.bottom + 8 - taskFloatBaseTop));
    }
    document.documentElement.style.setProperty("--notification-stack-offset", `${offset}px`);
  });
}

function animateToastReflow(stack, previousPositions) {
  if (prefersReducedToastMotion()) return;
  for (const toast of stack.querySelectorAll(".toast")) {
    const previousTop = previousPositions.get(toast);
    if (!Number.isFinite(previousTop)) continue;
    const delta = previousTop - toast.getBoundingClientRect().top;
    if (Math.abs(delta) < 1 || typeof toast.animate !== "function") continue;
    toast.animate(
      [{transform:`translateY(${delta}px)`}, {transform:"translateY(0)"}],
      {duration:260, easing:"cubic-bezier(.2,.8,.2,1)"}
    );
  }
}

function removeToastElement(toast) {
  if (!toast?.isConnected) return;
  const stack = toast.parentElement;
  if (!stack) return toast.remove();
  const previousPositions = new Map(
    [...stack.querySelectorAll(".toast")]
      .filter(item => item !== toast)
      .map(item => [item, item.getBoundingClientRect().top])
  );
  toast.remove();
  animateToastReflow(stack, previousPositions);
  syncToastStackLayout();
}

function dismissToast(target) {
  const stack = $("toast");
  if (!stack) return;
  if (!target) {
    for (const toast of [...stack.querySelectorAll(".toast")]) dismissToast(toast);
    return;
  }
  const toast = target instanceof Element ? target.closest(".toast") : null;
  if (!toast || toast.classList.contains("is-leaving")) return;
  const toastId = toast.dataset.toastId || "";
  clearTimeout(toastTimers.get(toastId));
  toastTimers.delete(toastId);
  toast.classList.add("is-leaving");
  const finish = () => removeToastElement(toast);
  if (prefersReducedToastMotion() || typeof toast.animate !== "function") return finish();
  const animation = toast.animate(
    [
      {opacity:1, transform:"translateX(0) scale(1)"},
      {opacity:0, transform:"translateX(18px) scale(.98)"}
    ],
    {duration:180, easing:"cubic-bezier(.4,0,1,1)", fill:"forwards"}
  );
  const fallback = setTimeout(finish, 240);
  animation.onfinish = () => {
    clearTimeout(fallback);
    finish();
  };
}

function notify(text, type="info") {
  const n = $("notice");
  if (n) {
    n.textContent = "";
    n.className = "notice";
  }
  if (text) {
    const stack = $("toast");
    if (!stack) return;
    const lines = String(text).split("\n").map(localizedTermaUiPhrase);
    const title = lines.shift() || "Terma";
    const detail = lines.join("\n").trim();
    const toastType = ["success", "error", "info"].includes(type) ? type : "info";
    const preference = notificationDisplayPreferences()[toastType];
    if (preference?.enabled === false) return;
    const iconName = toastType === "success" ? "circle-check" : toastType === "error" ? "circle-alert" : "info";
    const toastId = `toast-${Date.now()}-${++toastSequence}`;
    const toast = document.createElement("div");
    toast.className = `toast ${toastType}`;
    toast.dataset.toastId = toastId;
    toast.setAttribute("role", toastType === "error" ? "alert" : "status");
    toast.setAttribute("aria-atomic", "true");
    const closeLabel = tr("common:auto.close_hint", {defaultValue:"关闭提示"});
    toast.innerHTML = `<div class="toast-head"><span class="toast-icon">${icon(iconName)}</span><div class="toast-copy"><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}</div><button type="button" class="icon-button" onclick="dismissToast(this.closest('.toast'))" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>`;
    stack.appendChild(toast);
    if (!prefersReducedToastMotion() && typeof toast.animate === "function") {
      toast.animate(
        [
          {opacity:0, transform:"translateY(-10px) scale(.98)"},
          {opacity:1, transform:"translateY(0) scale(1)"}
        ],
        {duration:240, easing:"cubic-bezier(.2,.8,.2,1)"}
      );
    }
    toastTimers.set(toastId, setTimeout(() => dismissToast(toast), preference.duration_ms));
    syncToastStackLayout();
  }
}

function createProgressToast(options={}) {
  const stack = $("toast");
  const preference = notificationDisplayPreferences().progress;
  if (!stack || preference.enabled === false) return emptyProgressToastController();
  const toastId = `toast-progress-${Date.now()}-${++toastSequence}`;
  const toast = document.createElement("div");
  toast.className = "toast info toast-progress";
  toast.dataset.toastId = toastId;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-atomic", "true");
  const closeLabel = tr("common:auto.close_hint", {defaultValue:"关闭提示"});
  const pauseLabel = tr("common:actions.pause", {defaultValue:"暂停"});
  const stopLabel = tr("common:auto.stop", {defaultValue:"停止"});
  toast.innerHTML = `<div class="toast-head"><span class="toast-icon">${icon(options.icon || "loader-circle")}</span><div class="toast-copy"><strong></strong><span></span></div><button type="button" class="icon-button toast-progress-close" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div><div class="toast-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="toast-progress-actions" hidden><button type="button" class="toast-progress-pause">${icon("pause")}<span>${esc(pauseLabel)}</span></button><button type="button" class="toast-progress-cancel">${icon("square")}<span>${esc(stopLabel)}</span></button></div>`;
  const title = toast.querySelector(".toast-copy strong");
  const detail = toast.querySelector(".toast-copy span");
  const track = toast.querySelector(".toast-progress-track");
  const bar = track.querySelector("i");
  const actions = toast.querySelector(".toast-progress-actions");
  const pauseButton = toast.querySelector(".toast-progress-pause");
  const cancelButton = toast.querySelector(".toast-progress-cancel");
  let settled = false;
  let paused = false;
  let pausable = typeof options.onPauseChange === "function";
  let cancellable = typeof options.onCancel === "function";

  const syncActions = () => {
    pauseButton.hidden = !pausable;
    cancelButton.hidden = !cancellable;
    actions.hidden = !pausable && !cancellable;
  };

  const controller = {
    update(next={}) {
      if (settled) return;
      if (next.title !== undefined) title.textContent = localizedTermaUiPhrase(next.title || "Terma");
      if (next.detail !== undefined) {
        detail.textContent = localizedTermaUiPhrase(next.detail || "");
        detail.hidden = !detail.textContent;
      }
      const progress = Number(next.progress);
      const determinate = Number.isFinite(progress);
      track.classList.toggle("indeterminate", !determinate);
      if (determinate) {
        const percent = Math.max(0, Math.min(100, progress));
        bar.style.width = `${percent}%`;
        track.setAttribute("aria-valuenow", String(Math.round(percent)));
      } else {
        bar.style.width = "";
        track.removeAttribute("aria-valuenow");
      }
      if (next.paused !== undefined) controller.setPaused(Boolean(next.paused));
      if (next.pausable !== undefined) pausable = Boolean(next.pausable) && typeof options.onPauseChange === "function";
      if (next.cancellable !== undefined) cancellable = Boolean(next.cancellable) && typeof options.onCancel === "function";
      syncActions();
    },
    setPaused(value) {
      paused = Boolean(value);
      toast.classList.toggle("paused", paused);
      const label = paused
        ? tr("common:actions.continue", {defaultValue:"继续"})
        : tr("common:actions.pause", {defaultValue:"暂停"});
      pauseButton.innerHTML = `${icon(paused ? "play" : "pause")}<span>${esc(label)}</span>`;
      pauseButton.setAttribute("aria-label", label);
    },
    finish(message="", linger=2200) {
      if (settled) return;
      settled = true;
      toast.classList.remove("info", "error", "paused");
      toast.classList.add("success");
      toast.querySelector(".toast-icon").innerHTML = icon("circle-check");
      detail.textContent = localizedTermaUiPhrase(message || tr("common:auto.done", {defaultValue:"已完成"}));
      detail.hidden = false;
      actions.hidden = true;
      track.classList.remove("indeterminate");
      track.setAttribute("aria-valuenow", "100");
      bar.style.width = "100%";
      const duration = preference.success_duration_ms === null ? linger : preference.success_duration_ms;
      toastTimers.set(toastId, setTimeout(() => dismissToast(toast), duration));
    },
    fail(message="") {
      if (settled) return;
      settled = true;
      toast.classList.remove("info", "success", "paused");
      toast.classList.add("error");
      toast.querySelector(".toast-icon").innerHTML = icon("circle-alert");
      detail.textContent = localizedTermaUiPhrase(message || tr("common:auto.operation_failed", {defaultValue:"操作失败"}));
      detail.hidden = false;
      actions.hidden = true;
      track.hidden = true;
      toastTimers.set(toastId, setTimeout(() => dismissToast(toast), preference.error_duration_ms));
    },
    dismiss() {
      if (!settled && typeof options.onCancel === "function") options.onCancel();
      settled = true;
      dismissToast(toast);
    }
  };

  title.textContent = localizedTermaUiPhrase(options.title || tr("common:auto.processing_now", {defaultValue:"正在处理"}));
  detail.textContent = localizedTermaUiPhrase(options.detail || "");
  detail.hidden = !detail.textContent;
  syncActions();
  pauseButton.addEventListener("click", () => {
    const next = !paused;
    controller.setPaused(next);
    options.onPauseChange?.(next);
  });
  cancelButton.addEventListener("click", () => controller.dismiss());
  toast.querySelector(".toast-progress-close").addEventListener("click", () => controller.dismiss());
  stack.appendChild(toast);
  controller.update({progress:options.progress});
  syncToastStackLayout();
  return controller;
}

function desktopNotificationEnabled() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

async function requestDesktopNotifications() {
  if (typeof Notification === "undefined") return notify(tr("common:notifications.browser_notifications_unsupported", {defaultValue:"当前浏览器不支持系统通知"}), "info");
  const permission = await Notification.requestPermission();
  notify(permission === "granted"
    ? tr("common:notifications.exact.desktop_notifications_enabled", {defaultValue:"桌面通知已开启"})
    : tr("common:notifications.desktop_notifications_denied", {defaultValue:"桌面通知未授权"}), permission === "granted" ? "success" : "info");
}

function showDesktopNotification(event) {
  if (!desktopNotificationEnabled()) return;
  try {
    const n = new Notification(event.title || "Terma", {
      body: event.message || "",
      tag: event.key || String(event.id || Date.now()),
      renotify: false
    });
    n.onclick = () => {
      window.focus();
      handleNotificationAction(event.action);
      n.close();
    };
  } catch {}
}

function handleNotificationAction(action) {
  if (!action) return;
  if (action.type === "tab" && action.key && typeof activateTab === "function") return activateTab(action.key);
  if (action.view === "forwards" && action.connection_id) return openForwards(Number(action.connection_id));
  if (action.view === "sftp" && action.connection_id) return openSftp(Number(action.connection_id));
  if (action.view === "log" && action.path) return openLog(action.path, action.title || tr("common:log_viewer.default_title", {defaultValue:"日志"}));
  if (action.url) {
    try {
      const target = new URL(action.url, location.href);
      if (target.protocol === "https:" && target.hostname === "github.com") window.open(target.href, "_blank", "noopener");
    } catch {}
  }
}

function currentNotificationLanguage() {
  return normalizeTermaLanguage(document.documentElement.lang || runtimeSettings?.saved?.language || "zh-CN");
}

async function handleNotificationEvent(event, options={}) {
  if (!event || typeof event !== "object") return;
  lastNotificationId = Math.max(lastNotificationId, Number(event.id || 0));
  if (event.type === "update" && typeof loadCachedUpdateStatus === "function") await loadCachedUpdateStatus();
  const ignoredUpdate = event.type === "update" && updateSettings?.update_ignored;
  const allowed = !["off", "muted"].includes(securitySettings?.notification_mode);
  if (options.display !== false && !ignoredUpdate && allowed) {
    notify(`${event.title}${event.message ? `\n${event.message}` : ""}`, event.level === "error" ? "error" : event.level === "success" ? "success" : "info");
    if (!options.fromDesktop) showDesktopNotification(event);
  }
  localStorage.setItem("lastNotificationId", String(lastNotificationId));
}

async function pollNotifications() {
  try {
    if (!notificationCursorInitialized) {
      await initializeNotificationCursor();
      return;
    }
    const events = await api(`/api/notifications?since=${encodeURIComponent(lastNotificationId)}&language=${encodeURIComponent(currentNotificationLanguage())}`);
    for (const event of events) await handleNotificationEvent(event);
  } catch {}
}

async function initializeNotificationCursor() {
  if (notificationCursorInitialized) return;
  if (!notificationCursorPromise) {
    notificationCursorPromise = api(`/api/notifications?since=0&language=${encodeURIComponent(currentNotificationLanguage())}`).then(events => {
      const latest = Array.isArray(events)
        ? events.reduce((max, event) => Math.max(max, Number(event.id || 0)), 0)
        : 0;
      lastNotificationId = latest;
      localStorage.setItem("lastNotificationId", String(lastNotificationId));
      notificationCursorInitialized = true;
    }).finally(() => {
      notificationCursorPromise = null;
    });
  }
  return notificationCursorPromise;
}

function setButtonBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    if (!Object.prototype.hasOwnProperty.call(button, "_busyOriginalHtml")) {
      button._busyOriginalHtml = button.innerHTML;
      button._busyOriginalDisabled = button.disabled;
    }
    button.textContent = text;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    if (Object.prototype.hasOwnProperty.call(button, "_busyOriginalHtml")) {
      button.innerHTML = button._busyOriginalHtml;
      button.disabled = Boolean(button._busyOriginalDisabled);
      delete button._busyOriginalHtml;
      delete button._busyOriginalDisabled;
    } else {
      button.disabled = false;
    }
    button.removeAttribute("aria-busy");
  }
}

// Serializes user-triggered actions that can be exposed by more than one button
// (for example, a task row and its floating progress card).
const uiActionLocks = new Map();

function syncUiActionControls(key, busy) {
  const actionKey = String(key || "").trim();
  if (!actionKey || typeof document === "undefined") return;
  document.querySelectorAll("[data-ui-action-key]").forEach(control => {
    if (String(control.dataset?.uiActionKey || "") !== actionKey) return;
    if (busy) {
      if (control.dataset.uiActionLockDisabled !== "true") {
        control.dataset.uiActionLockDisabled = "true";
        control.dataset.uiActionLockWasDisabled = control.disabled ? "true" : "false";
      }
      control.disabled = true;
      control.setAttribute("aria-busy", "true");
      return;
    }
    if (control.dataset.uiActionLockDisabled !== "true") return;
    control.disabled = control.dataset.uiActionLockWasDisabled === "true";
    delete control.dataset.uiActionLockDisabled;
    delete control.dataset.uiActionLockWasDisabled;
    if (control.dataset.uiActionBusy !== "true") control.removeAttribute("aria-busy");
  });
}

function beginUiAction(key, button=null, text="") {
  const actionKey = String(key || "").trim();
  if (actionKey && uiActionLocks.has(actionKey)) return false;
  if (button?.dataset?.uiActionBusy === "true") return false;
  if (actionKey) {
    uiActionLocks.set(actionKey, button || true);
    syncUiActionControls(actionKey, true);
  }
  if (button) {
    button.dataset.uiActionBusy = "true";
    setButtonBusy(button, true, text || tr("common:auto.processing", {defaultValue:"处理中..."}));
  }
  return true;
}

function endUiAction(key, button=null) {
  const actionKey = String(key || "").trim();
  if (actionKey) uiActionLocks.delete(actionKey);
  if (button) {
    delete button.dataset.uiActionBusy;
    if (document.contains(button)) setButtonBusy(button, false);
  }
  if (actionKey) syncUiActionControls(actionKey, false);
}

function isUiActionInFlight(key) {
  const actionKey = String(key || "").trim();
  return Boolean(actionKey && uiActionLocks.has(actionKey));
}

function captureUiState(root=document) {
  const active = document.activeElement;
  const editable = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  const activeName = editable ? active.getAttribute("name") || "" : "";
  const activeValue = editable && "value" in active ? active.value : "";
  return {
    activeId: editable ? active.id : "",
    activeName,
    activeValue,
    selectionStart: editable && typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: editable && typeof active.selectionEnd === "number" ? active.selectionEnd : null,
    treeScrollTop: $("connectionGroups")?.scrollTop || 0,
    workspaceScrollTop: (typeof currentWorkspaceDomScope === "function"
      ? currentWorkspaceDomScope()?.querySelector(".workspace")
      : document.querySelector(".workspace"))?.scrollTop || 0,
    openDetails: [...root.querySelectorAll?.("details[id]") || []].filter(item => item.open).map(item => item.id)
  };
}

function restoreUiState(state) {
  if (!state) return;
  if ($("connectionGroups")) $("connectionGroups").scrollTop = state.treeScrollTop || 0;
  const workspace = typeof currentWorkspaceDomScope === "function"
    ? currentWorkspaceDomScope()?.querySelector(".workspace")
    : document.querySelector(".workspace");
  if (workspace) workspace.scrollTop = state.workspaceScrollTop || 0;
  for (const id of state.openDetails || []) {
    const detail = $(id);
    if (detail) detail.open = true;
  }
  if (state.activeId) {
    let next = $(state.activeId);
    if (!next && state.activeName) next = document.querySelector(`[name="${cssEscape(state.activeName)}"]`);
    if (next) {
      if (state.activeValue !== undefined && "value" in next && next.value !== state.activeValue) next.value = state.activeValue;
      next.focus();
      if (state.selectionStart !== null && typeof next.setSelectionRange === "function") {
        try { next.setSelectionRange(state.selectionStart, state.selectionEnd); } catch {}
      }
    }
  }
}

function keepTerminalKeyboardClosed(event) {
  event?.preventDefault?.();
}

let nativeFileDialogPending = false;
let nativeFileDialogFallbackTimer = null;

function beginNativeFileDialogViewport() {
  nativeFileDialogPending = true;
  clearTimeout(nativeFileDialogFallbackTimer);
  nativeFileDialogFallbackTimer = setTimeout(settleNativeFileDialogViewport, 1400);
}

function resetMobileWorkspaceShellScroll() {
  if (!isMobileLayout()) return;
  const content = document.querySelector("#content.mobile-show");
  if (!content) return;
  const shells = [
    content,
    ...content.querySelectorAll(".workspace-dock, .workspace-split, .workspace-pane")
  ];
  for (const shell of shells) {
    if (shell.scrollTop) shell.scrollTop = 0;
    if (shell.scrollLeft) shell.scrollLeft = 0;
  }
}

function settleNativeFileDialogViewport() {
  nativeFileDialogPending = false;
  clearTimeout(nativeFileDialogFallbackTimer);
  nativeFileDialogFallbackTimer = null;
  [0, 80, 240, 700].forEach(delay => {
    setTimeout(() => {
      syncViewportHeight({force:true, preferLayout:true});
      if (typeof syncResponsivePane === "function") syncResponsivePane();
      resetMobileWorkspaceShellScroll();
    }, delay);
  });
}

function bindNativeFileDialogViewportRecovery() {
  document.addEventListener("click", event => {
    const input = event.target?.matches?.('input[type="file"]')
      ? event.target
      : event.target?.closest?.(".file-picker, .ftp-upload-button, .sftp-upload-button")?.querySelector?.('input[type="file"]');
    if (input) beginNativeFileDialogViewport();
  }, true);
  document.addEventListener("change", event => {
    if (event.target?.matches?.('input[type="file"]')) settleNativeFileDialogViewport();
  }, true);
  window.addEventListener("focus", () => {
    if (nativeFileDialogPending) setTimeout(settleNativeFileDialogViewport, 80);
    else setTimeout(syncViewportHeight, 80);
  });
  window.addEventListener("pageshow", () => settleNativeFileDialogViewport());
}

function syncViewportHeight(options={}) {
  if (nativeFileDialogPending && options.force !== true) return;
  const visualHeight = Number(window.visualViewport?.height || 0);
  const layoutHeight = Number(window.innerHeight || 0);
  const height = options.preferLayout
    ? Math.max(visualHeight, layoutHeight)
    : visualHeight || layoutHeight;
  if (!(height > 0)) return;
  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  scheduleTerminalFit();
}

function scheduleTerminalFit() {
  fitVisibleTerminals();
  clearTimeout(window.terminalViewportFitTimer);
  window.terminalViewportFitTimer = setTimeout(fitVisibleTerminals, 80);
  clearTimeout(window.terminalViewportFitLaterTimer);
  window.terminalViewportFitLaterTimer = setTimeout(fitVisibleTerminals, 240);
  clearTimeout(window.terminalViewportFitFinalTimer);
  window.terminalViewportFitFinalTimer = setTimeout(fitVisibleTerminals, 700);
}

function fitVisibleTerminals() {
  if (typeof terminalSessions === "undefined") return;
  for (const session of terminalSessions.values()) {
    const box = session.term?.element?.closest?.(".terminal-box");
    const viewport = typeof captureTerminalViewport === "function" ? captureTerminalViewport(session) : null;
    if (box) {
      box.style.minHeight = "0px";
      const rect = box.getBoundingClientRect();
      if (rect.height > 0) {
        session.lastBoxHeight = rect.height;
        session.term.element.style.height = `${Math.floor(rect.height)}px`;
      }
    }
    try { session.fit?.fit(); } catch {}
    try { session.term?.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
    if (typeof restoreTerminalViewport === "function") restoreTerminalViewport(session, viewport);
  }
}

function chooseModal(title, message, actions) {
  return new Promise((resolve) => {
    const modal = $("modal");
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card"><h2>${esc(title)}</h2><div class="modal-message">${esc(message)}</div><div class="actions">${actions.map((item, index)=>`<button class="${item.className || ""}" data-choice="${index}">${esc(item.label)}</button>`).join("")}</div></div>`;
    modal.hidden = false;
    modal.querySelectorAll("button[data-choice]").forEach(button => {
      button.addEventListener("click", () => {
        modal.hidden = true;
        resolve(actions[Number(button.dataset.choice)].value);
      });
    });
  });
}

function inputModal(title, label, defaultValue="") {
  return new Promise((resolve) => {
    const modal = $("modal");
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card"><h2>${esc(title)}</h2><label>${esc(label)}</label><input id="modalInputValue" value="${esc(defaultValue)}"><div class="actions"><button class="primary" id="modalConfirmBtn">${esc(tr("common:auto.confirm", {defaultValue:"确定"}))}</button><button id="modalCancelBtn">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button></div></div>`;
    modal.hidden = false;
    const input = $("modalInputValue");
    input.focus();
    input.select();
    const finish = (value) => {
      modal.hidden = true;
      resolve(value);
    };
    $("modalConfirmBtn").onclick = () => finish(input.value.trim());
    $("modalCancelBtn").onclick = () => finish("");
    input.onkeydown = (event) => {
      if (event.key === "Enter") finish(input.value.trim());
      if (event.key === "Escape") finish("");
    };
  });
}

function confirmModal(message, title="", confirmText="", cancelText="", danger=false) {
  return chooseModal(title, message, [
    { label: confirmText || tr("common:auto.confirm", {defaultValue:"确定"}), value: true, className: danger ? "danger" : "primary" },
    { label: cancelText || tr("common:actions.cancel", {defaultValue:"取消"}), value: false }
  ]);
}

function sshHostTrustModal(challenge) {
  return new Promise(resolve => {
    const modal = $("modal");
    const changed = challenge?.state === "changed";
    const permanentLabel = changed
      ? tr("common:dialogs.ssh_host_update_trust", {defaultValue:"更新并永久信任"})
      : tr("common:dialogs.ssh_host_save_trust", {defaultValue:"信任并保存"});
    const title = changed
      ? tr("common:dialogs.ssh_host_changed_title", {defaultValue:"SSH 主机密钥发生变化"})
      : tr("common:dialogs.ssh_host_verify_title", {defaultValue:"确认 SSH 主机指纹"});
    const unknown = tr("common:auto.unknown", {defaultValue:"未知"});
    const finish = value => {
      modal.onclick = null;
      modal.onkeydown = null;
      modal.hidden = true;
      resolve(value);
    };
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card ssh-host-trust-modal ${changed ? "changed" : "unknown"}" role="alertdialog" aria-modal="true" aria-labelledby="sshHostTrustTitle">
      <div class="ssh-host-trust-head">
        <span class="ssh-host-trust-icon" aria-hidden="true">${icon(changed ? "shield-alert" : "shield-question")}</span>
        <div><h2 id="sshHostTrustTitle">${esc(title)}</h2><span>${esc(challenge?.host_label || tr("common:dialogs.ssh_host_unknown", {defaultValue:"未知主机"}))}</span></div>
      </div>
      <div class="ssh-host-trust-notice">${changed
        ? esc(tr("common:dialogs.ssh_host_changed_notice", {defaultValue:"保存过的主机密钥与本次连接不一致。这可能是服务器重装或密钥更新，也可能表示连接被冒充。请先核对新指纹。"}))
        : esc(tr("common:dialogs.ssh_host_first_notice", {defaultValue:"这是 Terma 首次连接这台 SSH 主机。请与服务器管理员或可信渠道核对指纹。"}))}</div>
      <dl class="ssh-host-trust-details">
        <div><dt>${esc(tr("common:dialogs.ssh_host_algorithm", {defaultValue:"算法"}))}</dt><dd>${esc(challenge?.key_type || unknown)}</dd></div>
        ${changed ? `<div class="previous"><dt>${esc(tr("common:dialogs.ssh_host_previous_fingerprint", {defaultValue:"原指纹"}))}</dt><dd><code>${esc(challenge?.previous_fingerprint || unknown)}</code></dd></div>` : ""}
        <div class="current"><dt>${esc(tr(changed ? "common:dialogs.ssh_host_new_fingerprint" : "common:dialogs.ssh_host_fingerprint", {defaultValue:changed ? "新指纹" : "指纹"}))}</dt><dd><code>${esc(challenge?.fingerprint || unknown)}</code></dd></div>
      </dl>
      <div class="ssh-host-trust-hint">${esc(tr("common:dialogs.ssh_host_once_hint", {defaultValue:"“仅本次信任”不会写入信任记录；下次连接仍会重新确认。"}))}</div>
      <div class="actions ssh-host-trust-actions">
        <button id="sshHostTrustOnce" type="button">${esc(tr("common:dialogs.ssh_host_trust_once", {defaultValue:"仅本次信任"}))}</button>
        <button id="sshHostTrustPersist" class="${changed ? "danger" : "primary"}" type="button">${permanentLabel}</button>
        <button id="sshHostTrustCancel" type="button">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button>
      </div>
    </div>`;
    modal.hidden = false;
    $("sshHostTrustOnce").onclick = () => finish("once");
    $("sshHostTrustPersist").onclick = () => finish("persist");
    $("sshHostTrustCancel").onclick = () => finish(null);
    modal.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };
    $("sshHostTrustCancel").focus();
  });
}

function stateView(kind, title, detail="", actionHtml="") {
  const type = ["loading", "error", "empty", "success"].includes(kind) ? kind : "empty";
  return `<div class="ui-state ${type}"><span class="ui-state-icon" aria-hidden="true"></span><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}${actionHtml ? `<div class="actions">${actionHtml}</div>` : ""}</div>`;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const field = document.createElement("textarea");
  field.value = String(text || "");
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, field.value.length);
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    field.remove();
  }
  if (!copied) throw new Error(tr("common:notifications.copy_unsupported", {defaultValue:"当前浏览器不支持直接复制，请使用系统复制"}));
}

async function copyText(text) {
  try {
    await writeClipboardText(text);
    notify(tr("common:notifications.copied", {defaultValue:"已复制"}), "success");
    return true;
  } catch (error) {
    notify(error?.message || tr("common:notifications.copy_fallback", {defaultValue:"复制失败，请使用系统复制"}), "error");
    return false;
  }
}

function toggleCheckGroup(box, cls){ (box?.closest?.(".workspace-pane") || document).querySelectorAll(`.${cls}-check`).forEach(x=>x.checked=box.checked); }

function esc(s){ return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function escAttr(s){
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
