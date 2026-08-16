const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("passwordToggle");
const passwordShowIcon = document.getElementById("passwordShowIcon");
const passwordHideIcon = document.getElementById("passwordHideIcon");
const loginButton = document.getElementById("loginButton");
const languageToggle = document.getElementById("languageToggle");
const errorBox = document.getElementById("err");
const loginResources = new Map();
let loginLanguage = normalizeLoginLanguage(localStorage.getItem("termaLoginLanguage") || suggestedLoginLanguage());
let lastLoginError = null;

function normalizeLoginLanguage(value) {
  return String(value || "") === "zh-CN" ? "zh-CN" : "en-US";
}

function suggestedLoginLanguage(locales=navigator.languages?.length ? navigator.languages : [navigator.language]) {
  const source = Array.isArray(locales) ? locales : [locales];
  const region = source.map(value => {
    try { return String(new Intl.Locale(String(value || "").replace(/_/g, "-")).maximize().region || "").toUpperCase(); }
    catch { return ""; }
  }).find(Boolean);
  return region === "CN" ? "zh-CN" : "en-US";
}

function loginTr(key, values={}, fallback="") {
  const source = loginResources.get(loginLanguage)?.[key] || fallback || key;
  return String(source).replace(/{{\s*([a-z0-9_.-]+)\s*}}/gi, (_, name) => String(values[name] ?? ""));
}

function syncPasswordToggleLabel() {
  const visible = passwordInput.type === "text";
  const actionLabel = loginTr(visible ? "hide_password" : "show_password", {}, visible ? "隐藏密码" : "显示密码");
  passwordToggle.title = actionLabel;
  passwordToggle.setAttribute("aria-label", actionLabel);
  passwordToggle.setAttribute("aria-pressed", String(visible));
}

function localizedLoginError(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const source = String(data.error || value || "");
  const code = String(data.error_code || "").trim().toLowerCase();
  const seconds = Math.max(1, Number(data.error_params?.seconds || data.retry_after_seconds || 0) || 1);
  if (code === "auth_login_rate_limited") return loginTr("too_many_attempts", {seconds}, source);
  if (code === "auth_login_temporarily_locked") return loginTr("temporarily_locked", {seconds}, source);
  if (code === "auth_login_not_configured") return loginTr("not_configured", {}, source);
  if (code === "auth_login_invalid") return loginTr("invalid", {}, source);
  if (code === "auth_login_failed") return loginTr("failed", {}, source);
  let match = source.match(/登录尝试过多，请在\s*(\d+)\s*秒后重试/);
  if (match) return loginTr("too_many_attempts", {seconds:match[1]}, source);
  match = source.match(/密码或 Token 不正确，登录已暂时锁定\s*(\d+)\s*秒/);
  if (match) return loginTr("temporarily_locked", {seconds:match[1]}, source);
  if (source === "尚未设置 Web 密码或访问 Token") return loginTr("not_configured", {}, source);
  if (source === "密码或 Token 不正确") return loginTr("invalid", {}, source);
  if (source && (loginLanguage !== "en-US" || !/[\u3400-\u9fff]/.test(source))) return source;
  return loginTr("failed", {}, "登录失败");
}

async function loginErrorFromResponse(response) {
  const text = await response.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = {error:text}; }
  if (!data.error_params && response.headers.get("Retry-After")) {
    data.error_params = {seconds:Number(response.headers.get("Retry-After") || 0)};
  }
  return {data, message:localizedLoginError(data), status:Number(response.status || 0)};
}

function applyLoginLanguage() {
  document.documentElement.lang = loginLanguage;
  document.querySelectorAll("[data-login-i18n]").forEach(element => {
    const key = element.dataset.loginI18n;
    element.textContent = loginTr(key, {}, element.textContent);
  });
  const switchLabel = loginTr("switch_language", {}, loginLanguage === "zh-CN" ? "切换到 English" : "Switch to Simplified Chinese");
  languageToggle.title = switchLabel;
  languageToggle.setAttribute("aria-label", switchLabel);
  syncPasswordToggleLabel();
  if (lastLoginError) errorBox.textContent = localizedLoginError(lastLoginError);
}

async function loadLoginLanguage(language) {
  const normalized = normalizeLoginLanguage(language);
  if (!loginResources.has(normalized)) {
    const response = await fetch(`/locales/${encodeURIComponent(normalized)}/login.json`, {cache:"no-store"});
    if (!response.ok) throw new Error(`Unable to load ${normalized} login resources`);
    loginResources.set(normalized, await response.json());
  }
  loginLanguage = normalized;
  localStorage.setItem("termaLoginLanguage", loginLanguage);
  applyLoginLanguage();
}

function setPasswordVisible(visible) {
  const selectionStart = passwordInput.selectionStart;
  const selectionEnd = passwordInput.selectionEnd;
  passwordInput.type = visible ? "text" : "password";
  syncPasswordToggleLabel();
  passwordShowIcon.hidden = visible;
  passwordHideIcon.hidden = !visible;
  passwordInput.focus({preventScroll:true});
  if (selectionStart !== null && selectionEnd !== null) {
    try { passwordInput.setSelectionRange(selectionStart, selectionEnd); } catch {}
  }
}

async function login() {
  loginButton.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password:passwordInput.value})
    });
    if (response.ok) {
      location.href = "/";
      return;
    }
    const failure = await loginErrorFromResponse(response);
    lastLoginError = failure.data;
    errorBox.textContent = failure.message;
  } finally {
    loginButton.disabled = false;
  }
}

passwordToggle.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));
languageToggle.addEventListener("click", () => {
  const target = loginLanguage === "zh-CN" ? "en-US" : "zh-CN";
  void loadLoginLanguage(target).catch(() => {});
});
loginButton.addEventListener("click", login);
passwordInput.addEventListener("keydown", event => {
  if (event.key === "Enter") void login();
});

void loadLoginLanguage(loginLanguage).catch(() => applyLoginLanguage());
