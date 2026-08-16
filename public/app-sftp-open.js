function sftpOpenFilename(remotePath) {
  return String(remotePath || "").split(/[\\/]/).pop() || tr("sftp:editor.remote_file", {defaultValue:"远程文件"});
}

async function sftpOpenResponseError(response) {
  return (await apiErrorFromResponse(response, tr("sftp:editor.remote_read_failed", {defaultValue:"远程文件读取失败"}))).message;
}

function waitForSftpOpenResume(state) {
  if (!state.paused || state.cancelled) return Promise.resolve();
  return new Promise(resolve => state.resume = resolve);
}

function sftpOpenTransportInterrupted(error) {
  const message = String(error?.message || error || "").trim();
  return error?.name === "TypeError"
    || /network error|failed to fetch|load failed|terminated|远程文件读取不完整/i.test(message);
}

function sftpOpenTransportError() {
  return new Error(tr("sftp:editor.transfer_interrupted", {defaultValue:"远程文件传输被中断。Terma 已自动重试一次；文件可能正在被改写，或当前浏览器到 Terma 的网络连接不稳定，请稍后重试"}));
}

function sftpTextEditorKind(size=0) {
  const saved = runtimeSettings?.saved || runtimeSettings || {};
  const mode = ["ace", "auto", "light"].includes(saved.sftp_text_editor_mode) ? saved.sftp_text_editor_mode : "ace";
  const threshold = Math.max(1, Number(saved.sftp_light_editor_threshold_mb || 10)) * 1024 * 1024;
  return mode === "light" || (mode === "auto" && Number(size || 0) >= threshold) ? "light" : "ace";
}

async function readSftpOpenBytes(connectionId, remotePath) {
  const state = {paused:false, cancelled:false, resume:null, cancelCurrent:null};
  const controller = new AbortController();
  let received = 0;
  let total = 0;
  let limit = 50 * 1024 * 1024;
  let lastProgressAt = 0;
  const progress = createProgressToast({
    title:tr("sftp:editor.opening_file", {name:sftpOpenFilename(remotePath), defaultValue:`正在打开 ${sftpOpenFilename(remotePath)}`}),
    detail:tr("sftp:editor.preparing_remote_file", {defaultValue:"正在准备远程文件..."}),
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
        detail:tr(paused ? "sftp:editor.paused_progress" : "sftp:editor.reading_progress", {
          received:formatBytes(received),
          total:formatBytes(total || limit),
          defaultValue:paused ? `已暂停 · ${formatBytes(received)} / ${formatBytes(total || limit)}` : `正在读取 · ${formatBytes(received)} / ${formatBytes(total || limit)}`
        })
      });
    },
    onCancel:() => {
      state.cancelled = true;
      state.resume?.();
      controller.abort();
      state.cancelCurrent?.();
    }
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        received = 0;
        total = 0;
        await waitForSftpOpenResume(state);
        await ensureSftpConnection(connectionId);
        if (state.cancelled) return null;
        const response = await fetch(`/api/connections/${connectionId}/sftp/open?path=${encodeURIComponent(remotePath)}`, {
          signal:controller.signal,
          cache:"no-store",
          headers:typeof quickConnectionRequestHeaders === "function"
            ? quickConnectionRequestHeaders(connectionId)
            : {}
        });
        if (!response.ok) throw new Error(await sftpOpenResponseError(response));
        total = Number(response.headers.get("X-Terma-File-Size") || response.headers.get("Content-Length") || 0);
        limit = Number(response.headers.get("X-Terma-File-Limit") || limit);
        if (!Number.isSafeInteger(total) || total < 0 || total > limit) throw new Error(tr("sftp:editor.invalid_size_response", {defaultValue:"远程文件大小响应无效"}));
        if (!response.body) throw new Error(tr("sftp:editor.streaming_unsupported", {defaultValue:"当前浏览器不支持流式读取远程文件"}));
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
          if (received + value.byteLength > total) throw new Error(tr("sftp:editor.content_exceeds_declared_size", {defaultValue:"远程文件内容超过声明大小"}));
          bytes.set(value, received);
          received += value.byteLength;
          const now = performance.now();
          if (now - lastProgressAt >= 80 || received === total) {
            lastProgressAt = now;
            progress.update({
              progress:total ? received / total * 100 : 100,
              detail:tr("sftp:editor.reading_progress", {received:formatBytes(received), total:formatBytes(total), defaultValue:`正在读取 · ${formatBytes(received)} / ${formatBytes(total)}`})
            });
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (received !== total) throw new Error(tr("sftp:editor.read_incomplete", {received:formatBytes(received), total:formatBytes(total), defaultValue:`远程文件读取不完整：${formatBytes(received)} / ${formatBytes(total)}`}));
        progress.update({progress:100, detail:tr("sftp:editor.read_complete", {size:formatBytes(total), defaultValue:`读取完成 · ${formatBytes(total)}`})});
        return {bytes, size:total, limit, progress, state};
      } catch (error) {
        if (state.cancelled || error?.name === "AbortError") return null;
        if (attempt === 0 && sftpOpenTransportInterrupted(error)) {
          progress.update({progress:Number.NaN, detail:tr("sftp:editor.retrying_transfer", {defaultValue:"传输中断，正在自动重试（1/1）..."}), pausable:true});
          await new Promise(resolve => setTimeout(resolve, 350));
          continue;
        }
        throw sftpOpenTransportInterrupted(error) ? sftpOpenTransportError() : error;
      }
    }
    throw sftpOpenTransportError();
  } catch (error) {
    if (state.cancelled || error?.name === "AbortError") return null;
    progress.fail(error?.message || tr("sftp:editor.remote_read_failed", {defaultValue:"远程文件读取失败"}));
    throw error;
  }
}

function decodeSftpOpenText(bytes, requestedEncoding, progress, state) {
  progress.update({progress:Number.NaN, detail:tr("sftp:editor.parsing_encoding", {defaultValue:"正在解析文本编码..."}), pausable:false, cancellable:true});
  return new Promise((resolve, reject) => {
    const worker = new Worker("/sftp-open-worker.js");
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (state) state.cancelCurrent = null;
      worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(tr("sftp:editor.parse_timeout", {defaultValue:"文本解析超时"})));
    }, 120000);
    if (state) state.cancelCurrent = () => {
      const error = new Error(tr("sftp:editor.open_aborted", {defaultValue:"已终止打开文件"}));
      error.name = "AbortError";
      finish(reject, error);
    };
    worker.addEventListener("message", event => {
      if (!event.data?.ok) {
        const errorKey = {
          binary_content:"binary_content",
          unsupported_encoding:"unsupported_encoding",
          decode_failed:"parse_failed"
        }[String(event.data?.error_code || "")] || "parse_failed";
        finish(reject, new Error(tr(`sftp:editor.${errorKey}`)));
      }
      else finish(resolve, event.data);
    }, {once:true});
    worker.addEventListener("error", event => {
      finish(reject, new Error(event.message || tr("sftp:editor.parse_failed", {defaultValue:"文本解析失败"})));
    }, {once:true});
    if (state?.cancelled) return state.cancelCurrent();
    worker.postMessage({buffer:bytes.buffer, encoding:requestedEncoding}, [bytes.buffer]);
  });
}

async function readSftpTextWithProgress(connectionId, remotePath, requestedEncoding="") {
  const opened = await readSftpOpenBytes(connectionId, remotePath);
  if (!opened) return null;
  const connection = currentConnection(connectionId) || connections.find(item => Number(item.id) === Number(connectionId));
  const preferred = connection?.sftp_text_encoding || "auto";
  try {
    const decoded = await decodeSftpOpenText(opened.bytes, requestedEncoding || preferred, opened.progress, opened.state);
    if (opened.state?.cancelled) return null;
    const editorKind = sftpTextEditorKind(opened.size);
    opened.progress.update({
      progress:Number.NaN,
      detail:editorKind === "light"
        ? tr("sftp:editor.parse_light", {defaultValue:"正在使用轻量编辑器解析..."})
        : tr("sftp:editor.parse_ace", {defaultValue:"正在使用 Ace 编辑器解析（可在 SFTP 设置中选择轻量编辑器）..."}),
      pausable:false,
      cancellable:true
    });
    return {...decoded, editor_kind:editorKind, preferred_encoding:preferred, size:opened.size, limit:opened.limit, progress:opened.progress, is_cancelled:() => opened.state?.cancelled === true};
  } catch (error) {
    if (error?.name === "AbortError" || opened.state?.cancelled) return null;
    opened.progress.fail(error.message || tr("sftp:editor.parse_failed", {defaultValue:"文本解析失败"}));
    throw error;
  }
}

async function readSftpImageWithProgress(connectionId, remotePath) {
  const opened = await readSftpOpenBytes(connectionId, remotePath);
  if (!opened) return null;
  opened.progress.finish(tr("sftp:editor.opened", {size:formatBytes(opened.size), defaultValue:`已打开 · ${formatBytes(opened.size)}`}));
  return new Blob([opened.bytes], {type:sftpPreviewImageType(remotePath)});
}

function sftpPreviewImageType(remotePath) {
  const extension = String(remotePath || "").split(".").pop()?.toLowerCase();
  return ({png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", bmp:"image/bmp", ico:"image/x-icon", svg:"image/svg+xml"})[extension] || "application/octet-stream";
}
