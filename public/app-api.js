const BACKEND_PUBLIC_ERROR_CODE_MAX_LENGTH = 80;
const BACKEND_PUBLIC_ERROR_PARAM_MAX_ENTRIES = 16;
const BACKEND_PUBLIC_ERROR_PARAM_MAX_STRING_LENGTH = 256;
const BACKEND_PUBLIC_ERROR_PARAM_KEY = /^[a-z][a-z0-9_]{0,47}$/;
const BACKEND_PUBLIC_ERROR_SENSITIVE_PARAM_KEY = /(?:^|_)(?:auth|authorization|cookie|credential|hash|key|pass|passphrase|password|salt|secret|session|token)(?:_|$)/i;

function normalizeBackendPublicErrorCode(value) {
  const source = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!source || source.length > BACKEND_PUBLIC_ERROR_CODE_MAX_LENGTH) return "";
  if (!/^[a-z][a-z0-9_.-]*$/i.test(source)) return "";
  const normalized = source
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalized) && !["constructor", "prototype"].includes(normalized)
    ? normalized
    : "";
}

function backendPublicErrorParams(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, item] of Object.entries(source)) {
    if (Object.keys(result).length >= BACKEND_PUBLIC_ERROR_PARAM_MAX_ENTRIES) break;
    if (!BACKEND_PUBLIC_ERROR_PARAM_KEY.test(key)
      || ["constructor", "prototype"].includes(key)
      || BACKEND_PUBLIC_ERROR_SENSITIVE_PARAM_KEY.test(key)) continue;
    if (typeof item === "string") {
      result[key] = item.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, BACKEND_PUBLIC_ERROR_PARAM_MAX_STRING_LENGTH);
    } else if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === "boolean" || item === null) {
      result[key] = item;
    }
  }
  return result;
}

function localizedBackendPublicError(data, rawMessage) {
  if (data?.preserve_error_message === true && rawMessage) {
    const source = String(rawMessage);
    return typeof rememberTermaRawUiPhrase === "function" ? rememberTermaRawUiPhrase(source) : source;
  }
  const code = normalizeBackendPublicErrorCode(data?.error_code);
  const params = backendPublicErrorParams(data?.error_params);
  const key = code ? `errors:backend.${code}` : "";
  const activeI18n = globalThis.window?.i18next || globalThis.i18next;
  const documentLanguage = globalThis.document?.documentElement?.lang || "";
  const language = typeof normalizeTermaLanguage === "function"
    ? normalizeTermaLanguage(documentLanguage || activeI18n?.resolvedLanguage || "zh-CN")
    : String(documentLanguage || activeI18n?.resolvedLanguage || "zh-CN");
  if (key && activeI18n?.exists?.(key, {lng:language, fallbackLng:false})) {
    return tr(key, {...params, lng:language, fallbackLng:false, defaultValue:""});
  }
  const legacyMessage = typeof localizedTermaUiPhrase === "function"
    ? localizedTermaUiPhrase(rawMessage)
    : String(rawMessage || "");
  if (language !== "en-US") return legacyMessage || String(rawMessage || "");
  if (!code && legacyMessage && !/[\u3400-\u9fff]/.test(legacyMessage)) return legacyMessage;
  return tr("errors:backend.request_failed", {lng:"en-US", fallbackLng:false, defaultValue:"The request failed. Try again."});
}

async function apiErrorFromResponse(response, fallbackMessage="") {
  const text = await response.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = {error:text}; }
  const rawMessage = data?.error || text || fallbackMessage || response.statusText;
  const error = new Error(localizedBackendPublicError(data, rawMessage));
  error.code = data?.code || "";
  error.publicCode = normalizeBackendPublicErrorCode(data?.error_code);
  error.preserveMessage = data?.preserve_error_message === true;
  error.status = Number(response.status || 0);
  error.details = data;
  error.connectionId = Number(data?.connection_id || 0);
  error.connectionName = String(data?.connection_name || "");
  error.remoteProfileId = Number(data?.remote_profile_id || 0);
  error.remoteProfileName = String(data?.remote_profile_name || "");
  return error;
}

async function api(path, opts = {}) {
  const {
    skipSftpConnect = false,
    skipHostTrustPrompt = false,
    hostTrustAttempt = 0,
    rawBody = false,
    responseType = "json",
    ...fetchOptions
  } = opts;
  const connectionResourceMatch = String(path || "").match(/^\/api\/connections\/(-?\d+)\/(sftp|x11-forwarding|x11-applications|terminal-clipboard)(?:[/?]|$)/);
  const connectionResourceId = Number(connectionResourceMatch?.[1] || 0);
  const connectionResource = String(connectionResourceMatch?.[2] || "");
  const quickHeaders = connectionResourceId < 0 && typeof quickConnectionRequestHeaders === "function"
    ? quickConnectionRequestHeaders(connectionResourceId, fetchOptions.headers || {})
    : (fetchOptions.headers || {});
  if (connectionResourceId < 0 && !quickHeaders["X-Terma-Quick-Connection"]) {
    throw new Error(tr("common:notifications.temporary_credentials_expired", {defaultValue:"临时连接凭据已失效，请先重新连接"}));
  }
  if (connectionResource === "sftp" && !String(path).includes("/sftp/session") && !skipSftpConnect && typeof ensureSftpConnection === "function") {
    await ensureSftpConnection(connectionResourceId);
  }
  const suppliedHeaders = fetchOptions.headers || {};
  const {headers:_ignoredHeaders, ...requestOptions} = fetchOptions;
  const res = await fetch(path, {
    ...requestOptions,
    headers: rawBody
      ? {...quickHeaders, ...suppliedHeaders}
      : { "Content-Type": "application/json", ...quickHeaders, ...suppliedHeaders }
  });
  if (responseType === "arrayBuffer" && res.ok) {
    const data = await res.arrayBuffer();
    return {
      data,
      contentType: String(res.headers.get("content-type") || ""),
      byteLength:data.byteLength
    };
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text || res.statusText }; }
  if (res.status === 401) {
    location.href = "/login";
    throw new Error(tr("common:api.login_required", {defaultValue:"请先登录"}));
  }
  if (
    res.status === 409
    && ["SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED"].includes(data.code)
    && !skipHostTrustPrompt
    && hostTrustAttempt < 4
    && typeof sshHostTrustModal === "function"
  ) {
    const mode = await sshHostTrustModal(data.challenge || {});
    if (!mode) {
      const error = new Error(tr("common:api.ssh_connection_cancelled", {defaultValue:"已取消 SSH 连接"}));
      error.code = "SSH_HOST_TRUST_CANCELLED";
      throw error;
    }
    await api("/api/ssh/host-trust", {
      method: "POST",
      body: JSON.stringify({ token: data.challenge?.token, mode }),
      skipSftpConnect: true,
      skipHostTrustPrompt: true
    });
    const result = await api(path, { ...opts, hostTrustAttempt: hostTrustAttempt + 1 });
    if (mode === "persist" && typeof loadTrustedSshHosts === "function") loadTrustedSshHosts().catch(() => {});
    return result;
  }
  if (res.status === 409 && data.code === "REMOTE_TASK_CONFLICT" && data.task?.id) {
    const rawConflictMessage = data.error || tr("common:api.task_conflict", {defaultValue:"已有任务正在执行"});
    const conflictMessage = localizedBackendPublicError(data, rawConflictMessage);
    const task = {...data.task, resource_conflict:true, resource_conflict_message:conflictMessage};
    if (task.type === "remote-component") {
      let requestedAction = "";
      if (typeof fetchOptions.body === "string") {
        try { requestedAction = String(JSON.parse(fetchOptions.body)?.action || "").trim().toLowerCase(); }
        catch {}
      }
      const runningAction = String(task.action || "").trim().toLowerCase();
      const sameAction = Boolean(requestedAction && runningAction && requestedAction === runningAction);
      return {
        ok:sameAction,
        reused_task:sameAction,
        task_conflict:true,
        conflict_same_action:sameAction,
        requested_action:requestedAction,
        running_action:runningAction,
        error:conflictMessage,
        task
      };
    }
    return task;
  }
  if (!res.ok) {
    const rawMessage = data.error || res.statusText;
    const structuredMessage = data.code === "SSH_EXTRA_ARGS_INVALID" && typeof localizedConnectionExtraArgsError === "function"
      ? localizedConnectionExtraArgsError(data)
      : "";
    const message = structuredMessage || localizedBackendPublicError(data, rawMessage);
    const error = new Error(message);
    error.code = data.code || "";
    error.publicCode = normalizeBackendPublicErrorCode(data.error_code);
    error.preserveMessage = data.preserve_error_message === true;
    error.status = res.status;
    error.details = data;
    error.connectionId = Number(data.connection_id || connectionResourceId || 0);
    error.connectionName = String(data.connection_name || "");
    error.remoteProfileId = Number(data.remote_profile_id || 0);
    error.remoteProfileName = String(data.remote_profile_name || "");
    throw error;
  }
  return data;
}
