async function api(path, opts = {}) {
  const { skipSftpConnect = false, ...fetchOptions } = opts;
  const sftpMatch = String(path || "").match(/^\/api\/connections\/(\d+)\/sftp(?:[/?]|$)/);
  if (sftpMatch && !String(path).includes("/sftp/session") && !skipSftpConnect && typeof ensureSftpConnection === "function") {
    await ensureSftpConnection(Number(sftpMatch[1]));
  }
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...fetchOptions });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("请先登录");
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
