async function api(path, opts = {}) {
  const {
    skipSftpConnect = false,
    skipHostTrustPrompt = false,
    hostTrustAttempt = 0,
    ...fetchOptions
  } = opts;
  const connectionResourceMatch = String(path || "").match(/^\/api\/connections\/(-?\d+)\/(sftp|x11-forwarding|x11-applications)(?:[/?]|$)/);
  const connectionResourceId = Number(connectionResourceMatch?.[1] || 0);
  const connectionResource = String(connectionResourceMatch?.[2] || "");
  const quickHeaders = connectionResourceId < 0 && typeof quickConnectionRequestHeaders === "function"
    ? quickConnectionRequestHeaders(connectionResourceId, fetchOptions.headers || {})
    : (fetchOptions.headers || {});
  if (connectionResourceId < 0 && !quickHeaders["X-Terma-Quick-Connection"]) {
    throw new Error("临时连接凭据已失效，请重新建立快速连接");
  }
  if (connectionResource === "sftp" && !String(path).includes("/sftp/session") && !skipSftpConnect && typeof ensureSftpConnection === "function") {
    await ensureSftpConnection(connectionResourceId);
  }
  const res = await fetch(path, {
    ...fetchOptions,
    headers: { "Content-Type": "application/json", ...quickHeaders }
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text || res.statusText }; }
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("请先登录");
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
      const error = new Error("已取消 SSH 连接");
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
    const conflictMessage = data.error || "已有任务正在执行";
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
    const error = new Error(data.error || res.statusText);
    error.code = data.code || "";
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
