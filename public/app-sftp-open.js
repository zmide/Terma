function sftpOpenFilename(remotePath) {
  return String(remotePath || "").split(/[\\/]/).pop() || "远程文件";
}

function sftpOpenResponseError(response) {
  return response.text().then(text => {
    try { return JSON.parse(text).error || text || "远程文件读取失败"; }
    catch { return text || "远程文件读取失败"; }
  });
}

function waitForSftpOpenResume(state) {
  if (!state.paused || state.cancelled) return Promise.resolve();
  return new Promise(resolve => state.resume = resolve);
}

async function readSftpOpenBytes(connectionId, remotePath) {
  const state = {paused:false, cancelled:false, resume:null};
  const controller = new AbortController();
  let received = 0;
  let total = 0;
  let limit = 50 * 1024 * 1024;
  let lastProgressAt = 0;
  const progress = createProgressToast({
    title:`正在打开 ${sftpOpenFilename(remotePath)}`,
    detail:"正在准备远程文件...",
    icon:"file-down",
    onPauseChange:paused => {
      state.paused = paused;
      if (!paused) {
        const resume = state.resume;
        state.resume = null;
        resume?.();
      }
      progress.update({
        paused,
        detail:paused ? `已暂停 · ${formatBytes(received)} / ${formatBytes(total || limit)}` : `正在读取 · ${formatBytes(received)} / ${formatBytes(total || limit)}`
      });
    },
    onCancel:() => {
      state.cancelled = true;
      state.resume?.();
      controller.abort();
    }
  });
  try {
    await ensureSftpConnection(connectionId);
    if (state.cancelled) return null;
    const response = await fetch(`/api/connections/${connectionId}/sftp/open?path=${encodeURIComponent(remotePath)}`, {
      signal:controller.signal,
      cache:"no-store"
    });
    if (!response.ok) throw new Error(await sftpOpenResponseError(response));
    total = Number(response.headers.get("X-Terma-File-Size") || response.headers.get("Content-Length") || 0);
    limit = Number(response.headers.get("X-Terma-File-Limit") || limit);
    if (!Number.isSafeInteger(total) || total < 0 || total > limit) throw new Error("远程文件大小响应无效");
    if (!response.body) throw new Error("当前浏览器不支持流式读取远程文件");
    const bytes = new Uint8Array(total);
    const reader = response.body.getReader();
    while (true) {
      await waitForSftpOpenResume(state);
      if (state.cancelled) {
        await reader.cancel();
        return null;
      }
      const {done, value} = await reader.read();
      if (done) break;
      if (received + value.byteLength > total) throw new Error("远程文件内容超过声明大小");
      bytes.set(value, received);
      received += value.byteLength;
      const now = performance.now();
      if (now - lastProgressAt >= 80 || received === total) {
        lastProgressAt = now;
        progress.update({
          progress:total ? received / total * 100 : 100,
          detail:`正在读取 · ${formatBytes(received)} / ${formatBytes(total)}`
        });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (received !== total) throw new Error(`远程文件读取不完整：${formatBytes(received)} / ${formatBytes(total)}`);
    progress.update({progress:100, detail:`读取完成 · ${formatBytes(total)}`});
    return {bytes, size:total, limit, progress};
  } catch (error) {
    if (state.cancelled || error?.name === "AbortError") return null;
    progress.fail(error?.message || "远程文件读取失败");
    throw error;
  }
}

function decodeSftpOpenText(bytes, requestedEncoding, progress) {
  progress.update({progress:Number.NaN, detail:"正在解析文本编码...", pausable:false});
  return new Promise((resolve, reject) => {
    const worker = new Worker("/sftp-open-worker.js");
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("文本解析超时"));
    }, 120000);
    worker.addEventListener("message", event => {
      clearTimeout(timer);
      worker.terminate();
      if (!event.data?.ok) reject(new Error(event.data?.error || "文本解析失败"));
      else resolve(event.data);
    }, {once:true});
    worker.addEventListener("error", event => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || "文本解析失败"));
    }, {once:true});
    worker.postMessage({buffer:bytes.buffer, encoding:requestedEncoding}, [bytes.buffer]);
  });
}

async function readSftpTextWithProgress(connectionId, remotePath, requestedEncoding="") {
  const opened = await readSftpOpenBytes(connectionId, remotePath);
  if (!opened) return null;
  const connection = currentConnection(connectionId) || connections.find(item => Number(item.id) === Number(connectionId));
  const preferred = connection?.sftp_text_encoding || "auto";
  try {
    const decoded = await decodeSftpOpenText(opened.bytes, requestedEncoding || preferred, opened.progress);
    opened.progress.finish(`已打开 · ${formatBytes(opened.size)}`);
    return {...decoded, preferred_encoding:preferred, size:opened.size, limit:opened.limit};
  } catch (error) {
    opened.progress.fail(error.message || "文本解析失败");
    throw error;
  }
}

async function readSftpImageWithProgress(connectionId, remotePath) {
  const opened = await readSftpOpenBytes(connectionId, remotePath);
  if (!opened) return null;
  opened.progress.finish(`已打开 · ${formatBytes(opened.size)}`);
  return new Blob([opened.bytes], {type:sftpPreviewImageType(remotePath)});
}

function sftpPreviewImageType(remotePath) {
  const extension = String(remotePath || "").split(".").pop()?.toLowerCase();
  return ({png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", bmp:"image/bmp", ico:"image/x-icon", svg:"image/svg+xml"})[extension] || "application/octet-stream";
}
