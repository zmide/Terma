async function api(path, opts = {}) {
  const {
    skipSftpConnect = false,
    skipHostTrustPrompt = false,
    hostTrustAttempt = 0,
    ...fetchOptions
  } = opts;
  const sftpMatch = String(path || "").match(/^\/api\/connections\/(\d+)\/sftp(?:[/?]|$)/);
  if (sftpMatch && !String(path).includes("/sftp/session") && !skipSftpConnect && typeof ensureSftpConnection === "function") {
    await ensureSftpConnection(Number(sftpMatch[1]));
  }
  const res = await fetch(path, {
    ...fetchOptions,
    headers: { "Content-Type": "application/json", ...(fetchOptions.headers || {}) }
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
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.code = data.code || "";
    error.status = res.status;
    error.details = data;
    throw error;
  }
  return data;
}
