const TERMINAL_ZMODEM_DETECT_TIMEOUT_MS = 15000;
const TERMINAL_ZMODEM_MAX_FILE_BYTES = 512 * 1024 * 1024;
let terminalZmodemLibraryPromise = null;

function terminalZmodemFormatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function terminalZmodemSafeFilename(value) {
  const basename = String(value || "").split(/[\\/]/).at(-1) || "download.bin";
  const cleaned = basename
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 240);
  return cleaned && ![".", ".."].includes(cleaned) && /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "download.bin";
}

function terminalZmodemCommandRole(value) {
  return terminalZmodemCommandInfo(value).role;
}

function terminalZmodemCommandInfo(value) {
  const command = typeof cleanTerminalCommandText === "function"
    ? cleanTerminalCommandText(value)
    : String(value || "").trim();
  const match = command.match(/^(?:(?:sudo|command)\s+)*(?:\/?(?:[^\s/]+\/)*)(l?sz|l?rz)(?:\s+(.*))?$/i);
  if (!match) return {role:"", command, arguments:"", executable:"", canStart:false};
  const role = /rz$/i.test(match[1]) ? "send" : "receive";
  const argumentsText = String(match[2] || "").trim();
  const helpOnly = /^(?:-h|--help|--version)(?:\s|$)/i.test(argumentsText);
  const canStart = role === "receive"
    ? Boolean(argumentsText) && !helpOnly
    : (!argumentsText || (argumentsText.startsWith("-") && !helpOnly));
  return {role, command, arguments:argumentsText, executable:String(match[1] || ""), canStart};
}

function terminalZmodemRzNeedsOverwrite(commandInfo) {
  if (commandInfo?.role !== "send") return false;
  const args = String(commandInfo.arguments || "");
  return !/(?:^|\s)(?:--overwrite|-[A-Za-z]*y[A-Za-z]*)(?=\s|$)/.test(args);
}

function terminalZmodemRzInputWithOverwrite(data) {
  const value = String(data || "");
  const lineBreak = value.search(/[\r\n]/);
  if (lineBreak < 0) return value;
  const before = value.slice(0, lineBreak);
  const after = value.slice(lineBreak);
  return before.trim() ? `${before} -y${after}` : ` -y${after}`;
}

function terminalZmodemTakePreparedInput(session, fallback) {
  const state = terminalZmodemState(session);
  const value = typeof state.preparedInput === "string" ? state.preparedInput : fallback;
  state.preparedInput = null;
  return value;
}

function ensureTerminalZmodemLibrary() {
  if (window.Zmodem?.Sentry) return Promise.resolve(window.Zmodem);
  if (!terminalZmodemLibraryPromise) {
    terminalZmodemLibraryPromise = loadScriptOnce("/vendor/zmodem.js")
      .then(() => {
        if (!window.Zmodem?.Sentry) throw new Error("ZMODEM 组件未正确加载");
        return window.Zmodem;
      })
      .catch(error => {
        terminalZmodemLibraryPromise = null;
        throw error;
      });
  }
  return terminalZmodemLibraryPromise;
}

function terminalZmodemState(session) {
  if (!session.zmodemState) {
    session.zmodemState = {
      active:false,
      armed:false,
      cancelled:false,
      role:"",
      sentry:null,
      zsession:null,
      offer:null,
      acceptBatch:false,
      cancelDraining:false,
      discardUntil:0,
      transferred:0,
      batchTransferred:0,
      total:0,
      armedOutputTail:"",
      timer:null,
      panel:null,
      renderAt:0,
      preparedInput:null
    };
  }
  return session.zmodemState;
}

function terminalZmodemFocus(session) {
  if (session?.key && typeof focusTerminalSession === "function") focusTerminalSession(session.key);
  else setTimeout(() => {
    try { session?.term?.focus?.(); } catch {}
  }, 0);
}

function terminalZmodemPanel(session) {
  const state = terminalZmodemState(session);
  const mount = session.mount || session.term?.element?.closest?.(".terminal-box");
  if (!mount) return null;
  if (state.panel?.isConnected && state.panel.parentElement === mount) return state.panel;
  state.panel?.remove();
  const panel = document.createElement("section");
  panel.className = "terminal-zmodem-panel";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  panel.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-zmodem-action]");
    if (!button) return;
    const action = button.dataset.zmodemAction;
    if (action === "cancel") terminalZmodemCancel(session, "用户取消");
    else if (action === "receive") void terminalZmodemAcceptOffer(session, true);
    else if (action === "send") void terminalZmodemChooseFiles(session);
  });
  mount.appendChild(panel);
  state.panel = panel;
  return panel;
}

function terminalZmodemRender(session, view={}) {
  const panel = terminalZmodemPanel(session);
  if (!panel) return;
  if (view.hidden) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const progress = Math.max(0, Math.min(100, Number(view.progress || 0)));
  const progressHtml = view.showProgress
    ? `<div class="terminal-zmodem-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>`
    : "";
  const primary = view.primaryAction
    ? `<button type="button" class="primary" data-zmodem-action="${escAttr(view.primaryAction)}">${icon(view.primaryIcon || "folder-open")}<span>${esc(view.primaryLabel || "继续")}</span></button>`
    : "";
  panel.innerHTML = `<div class="terminal-zmodem-icon">${icon(view.icon || "arrow-left-right")}</div><div class="terminal-zmodem-copy"><strong>${esc(view.title || "ZMODEM 文件传输")}</strong><span>${esc(view.detail || "")}</span>${progressHtml}</div><div class="terminal-zmodem-actions">${primary}<button type="button" class="icon-button" data-zmodem-action="cancel" title="取消本次 ZMODEM 传输（Ctrl+C）" aria-label="取消本次 ZMODEM 传输">${icon("x")}</button></div>`;
  panel.hidden = false;
  refreshIcons();
}

function terminalZmodemSendBinaryMode(session, enabled) {
  const socket = session.socket;
  session.zmodemBinaryMode = Boolean(enabled);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({type:"terminal-binary-mode", enabled:Boolean(enabled)}));
  }
}

function terminalZmodemClearTimer(state) {
  clearTimeout(state.timer);
  state.timer = null;
}

function terminalZmodemArm(session, role) {
  const state = terminalZmodemState(session);
  terminalZmodemClearTimer(state);
  state.armed = true;
  state.cancelled = false;
  state.role = role;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, true);
  terminalZmodemRender(session, {
    icon:role === "send" ? "upload" : "download",
    title:role === "send" ? "等待远端 rz 响应" : "等待远端 sz 响应",
    detail:"已启用二进制传输模式；按 Ctrl+C 可取消"
  });
  state.timer = setTimeout(() => {
    if (!state.armed || state.active) return;
    state.armed = false;
    terminalZmodemSendBinaryMode(session, false);
    terminalZmodemRender(session, {hidden:true});
    queueTerminalOutput(session, "\r\n[未检测到 ZMODEM 响应，已恢复普通终端模式]\r\n");
    terminalZmodemFocus(session);
  }, TERMINAL_ZMODEM_DETECT_TIMEOUT_MS);
}

function terminalZmodemInputCommand(session, data) {
  const raw = String(data || "");
  if (!/[\r\n]/.test(raw)) return "";
  const inline = raw.split(/[\r\n]/, 1)[0];
  const prompt = typeof currentTerminalPromptCommand === "function" ? currentTerminalPromptCommand(session) : "";
  return inline.trim() || prompt || String(session.commandBuffer || "");
}

function terminalZmodemPrepareInput(session, data) {
  const state = terminalZmodemState(session);
  state.preparedInput = null;
  if (state.cancelDraining) {
    if (String(data || "").includes("\x03")) terminalZmodemSendAbort(session);
    return true;
  }
  if (state.active || state.armed) {
    if (String(data || "").includes("\x03")) terminalZmodemCancel(session, "Ctrl+C");
    return true;
  }
  const commandInfo = terminalZmodemCommandInfo(terminalZmodemInputCommand(session, data));
  if (!commandInfo.role || !commandInfo.canStart) return false;
  const broadcastCount = typeof terminalBroadcastKeys === "function" ? terminalBroadcastKeys().length : 0;
  if (broadcastCount > 1) {
    notify("终端同步期间不能启动 ZMODEM，请先退出终端同步", "error");
    return true;
  }
  if (!state.sentry) {
    notify("ZMODEM 组件尚未就绪，请稍后重试", "error");
    return true;
  }
  if (terminalZmodemRzNeedsOverwrite(commandInfo)) state.preparedInput = terminalZmodemRzInputWithOverwrite(data);
  terminalZmodemArm(session, commandInfo.role);
  return false;
}

function terminalZmodemSendAbort(session) {
  const socket = session.socket;
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(new Uint8Array([...Array(8).fill(24), ...Array(10).fill(8)]));
}

function terminalZmodemFinish(session, message="") {
  const state = terminalZmodemState(session);
  terminalZmodemClearTimer(state);
  state.active = false;
  state.armed = false;
  state.offer = null;
  state.zsession = null;
  state.acceptBatch = false;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, false);
  terminalZmodemRender(session, {hidden:true});
  if (message) queueTerminalOutput(session, `\r\n[ZMODEM] ${message}\r\n`);
  terminalZmodemFocus(session);
}

function terminalZmodemCancel(session, reason="已取消") {
  const state = terminalZmodemState(session);
  if (!state.active && !state.armed) return false;
  state.cancelled = true;
  terminalZmodemClearTimer(state);
  terminalZmodemSendAbort(session);
  try {
    if (state.zsession && !state.zsession.aborted?.()) state.zsession.abort();
  } catch {}
  state.active = false;
  state.armed = false;
  state.offer = null;
  state.zsession = null;
  state.acceptBatch = false;
  state.sentry = null;
  state.cancelDraining = true;
  state.discardUntil = Date.now() + 500;
  state.armedOutputTail = "";
  terminalZmodemRender(session, {hidden:true});
  queueTerminalOutput(session, `\r\n[ZMODEM] 传输已取消（${reason}）\r\n`);
  terminalZmodemFocus(session);
  state.timer = setTimeout(() => {
    state.cancelDraining = false;
    state.discardUntil = 0;
    terminalZmodemSendBinaryMode(session, false);
    initializeTerminalZmodem(session);
    terminalZmodemFocus(session);
  }, 500);
  return true;
}

function terminalZmodemObserveArmedOutput(session, value) {
  const state = terminalZmodemState(session);
  if (!state.armed || !(value instanceof ArrayBuffer)) return;
  const bytes = new Uint8Array(value);
  const start = Math.max(0, bytes.length - 1200);
  let text = "";
  for (let index = start; index < bytes.length; index += 1) {
    const byte = bytes[index];
    text += byte === 10 || byte === 13 || byte === 9 || (byte >= 32 && byte <= 126)
      ? String.fromCharCode(byte)
      : " ";
  }
  state.armedOutputTail = `${state.armedOutputTail}${text}`.slice(-1200);
  const error = state.armedOutputTail.match(/(?:^|[\r\n])(?:l?sz|l?rz):\s*([^\r\n]+)/i);
  if (!error) return;
  const detail = String(error[1] || "").trim();
  const message = /need at least one file/i.test(detail)
    ? "sz 需要指定远端文件，例如 sz filename"
    : /garbage on commandline/i.test(detail)
      ? "rz 用于接收本机文件，请直接运行 rz，不要附加远端文件名"
      : /cannot open/i.test(detail)
        ? "远端 sz 未启动：文件不存在或无法读取"
        : `远端 ${state.role === "send" ? "rz" : "sz"} 未启动：${detail}`;
  terminalZmodemClearTimer(state);
  state.armed = false;
  state.active = false;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, false);
  terminalZmodemRender(session, {hidden:true});
  notify(message, "info");
  terminalZmodemFocus(session);
}

function terminalZmodemSaveFile(chunks, remoteName) {
  const name = terminalZmodemSafeFilename(remoteName);
  const blob = new Blob(chunks, {type:"application/octet-stream"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.hidden = true;
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return {name, size:blob.size};
}

function terminalZmodemReceiveProgress(session, name, received, total) {
  const state = terminalZmodemState(session);
  const now = performance.now();
  if (received < total && now - state.renderAt < 80) return;
  state.renderAt = now;
  terminalZmodemRender(session, {
    icon:"download",
    title:`正在接收 ${name}`,
    detail:`${terminalZmodemFormatBytes(received)} / ${terminalZmodemFormatBytes(total || received)}`,
    showProgress:Boolean(total),
    progress:total ? received / total * 100 : 0
  });
}

async function terminalZmodemAcceptOffer(session, acceptBatch=false) {
  const state = terminalZmodemState(session);
  const offer = state.offer;
  if (!offer || state.cancelled) return;
  const details = offer.get_details();
  const expected = Math.max(0, Number(details.size || 0));
  if (expected > TERMINAL_ZMODEM_MAX_FILE_BYTES) {
    terminalZmodemRender(session, {
      icon:"circle-alert",
      title:"文件超过终端传输上限",
      detail:`${terminalZmodemSafeFilename(details.name)} 为 ${terminalZmodemFormatBytes(expected)}；超过 512 MB 请改用 SFTP`
    });
    return;
  }
  state.acceptBatch = Boolean(acceptBatch);
  state.offer = null;
  state.transferred = 0;
  if (state.batchTransferred + expected > TERMINAL_ZMODEM_MAX_FILE_BYTES) {
    terminalZmodemRender(session, {
      icon:"circle-alert",
      title:"本次传输总量超过上限",
      detail:`累计文件超过 512 MB，请取消后改用 SFTP`
    });
    return;
  }
  state.total = expected;
  const chunks = [];
  const name = terminalZmodemSafeFilename(details.name);
  try {
    await offer.accept({on_input:octets => {
      const chunk = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
      state.transferred += chunk.byteLength;
      state.batchTransferred += chunk.byteLength;
      if (state.transferred > TERMINAL_ZMODEM_MAX_FILE_BYTES || state.batchTransferred > TERMINAL_ZMODEM_MAX_FILE_BYTES) {
        throw new Error("本次接收数据超过 512 MB，请改用 SFTP");
      }
      chunks.push(chunk);
      terminalZmodemReceiveProgress(session, name, state.transferred, expected);
    }});
    if (state.cancelled) return;
    const saved = terminalZmodemSaveFile(chunks, name);
    notify(`已通过 sz 接收 ${saved.name}（${terminalZmodemFormatBytes(saved.size)}）`, "success");
    queueTerminalOutput(session, `\r\n[ZMODEM] 已接收 ${saved.name}（${terminalZmodemFormatBytes(saved.size)}）\r\n`);
  } catch (error) {
    if (state.cancelled) return;
    terminalZmodemCancel(session, error.message || "接收失败");
    notify(error.message || "ZMODEM 接收失败", "error");
  }
}

function terminalZmodemOffer(session, offer) {
  const state = terminalZmodemState(session);
  if (state.cancelled) return;
  state.offer = offer;
  const details = offer.get_details();
  const name = terminalZmodemSafeFilename(details.name);
  const size = Math.max(0, Number(details.size || 0));
  if (state.acceptBatch) {
    void terminalZmodemAcceptOffer(session, true);
    return;
  }
  const remaining = Math.max(1, Number(details.files_remaining || 1));
  const batchSize = Math.max(size, Number(details.bytes_remaining || size));
  terminalZmodemRender(session, {
    icon:"download",
    title:`远端准备发送 ${name}`,
    detail:remaining > 1
      ? `本批 ${remaining} 个文件，共 ${terminalZmodemFormatBytes(batchSize)}；文件只会下载，不会自动打开`
      : `${terminalZmodemFormatBytes(size)}；文件只会下载，不会自动打开`,
    primaryAction:"receive",
    primaryIcon:"download",
    primaryLabel:remaining > 1 ? "接收本批文件" : "接收文件"
  });
}

function terminalZmodemRenamedFile(file, name) {
  if (!name || name === file.name) return file;
  return new File([file], name, {type:file.type || "application/octet-stream", lastModified:file.lastModified || Date.now()});
}

async function terminalZmodemPrepareSendFiles(session, files) {
  const directory = session.currentDirectoryKnown ? String(session.currentDirectory || ".") : ".";
  let plan;
  try {
    plan = await api(`/api/connections/${Number(session.id)}/sftp/upload-plan`, {
      method:"POST",
      body:JSON.stringify({path:directory, filenames:files.map(file => file.name)})
    });
  } catch (error) {
    const choice = await chooseModal(
      "无法检查同名文件",
      `${error.message || "SFTP 检查不可用"}\n\n继续后远端 rz 可能覆盖同名文件。`,
      [
        {label:"继续并允许覆盖", value:"continue", className:"danger"},
        {label:"取消上传", value:""}
      ]
    );
    return choice === "continue" ? files : null;
  }
  const collisions = (plan.items || []).filter(item => item.exists);
  if (!collisions.length) return files;
  const conflict = await chooseSftpUploadConflict(collisions);
  if (!conflict) return null;
  if (conflict === "overwrite") return files;
  const targets = new Map((plan.items || []).map(item => [String(item.name), String(item.suggested_name || item.name)]));
  return files.map(file => terminalZmodemRenamedFile(file, targets.get(file.name) || file.name));
}

function terminalZmodemSentFileSummary(files) {
  const names = files.map(file => String(file.name || "未命名文件"));
  const visible = names.slice(0, 4).join("、");
  return names.length > 4 ? `${visible} 等 ${names.length} 个文件` : visible;
}

function terminalZmodemChooseFiles(session) {
  const state = terminalZmodemState(session);
  if (!state.zsession || state.role !== "send") return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    input.remove();
    if (!files.length) return terminalZmodemCancel(session, "未选择文件");
    const unsafe = files.find(file => /[\x00-\x1f\x7f]/.test(file.name));
    const oversized = files.find(file => file.size > TERMINAL_ZMODEM_MAX_FILE_BYTES);
    if (unsafe || oversized) {
      const message = unsafe
        ? `文件名包含控制字符：${terminalZmodemSafeFilename(unsafe.name)}`
        : `${oversized.name} 超过 512 MB，请改用 SFTP`;
      terminalZmodemCancel(session, message);
      notify(message, "error");
      return;
    }
    const preparedFiles = await terminalZmodemPrepareSendFiles(session, files);
    if (!preparedFiles?.length) return terminalZmodemCancel(session, "已取消同名文件处理");
    const total = preparedFiles.reduce((sum, file) => sum + file.size, 0);
    if (total > TERMINAL_ZMODEM_MAX_FILE_BYTES) {
      const message = `所选文件合计 ${terminalZmodemFormatBytes(total)}，超过 512 MB，请改用 SFTP`;
      terminalZmodemCancel(session, message);
      notify(message, "error");
      return;
    }
    let completed = 0;
    const sentFiles = [];
    try {
      terminalZmodemRender(session, {icon:"upload", title:"正在通过 rz 上传", detail:`0 B / ${terminalZmodemFormatBytes(total)}`, showProgress:true, progress:0});
      await window.Zmodem.Browser.send_files(state.zsession, preparedFiles, {
        on_progress:(file, transfer) => {
          const sent = Math.min(file.size, Number(transfer.get_offset?.() || 0));
          terminalZmodemRender(session, {
            icon:"upload",
            title:`正在发送 ${file.name}`,
            detail:`${terminalZmodemFormatBytes(completed + sent)} / ${terminalZmodemFormatBytes(total)}`,
            showProgress:true,
            progress:total ? (completed + sent) / total * 100 : 100
          });
        },
        on_file_complete:file => { completed += file.size; sentFiles.push(file); }
      });
      if (state.cancelled) return;
      await state.zsession.close();
      if (!state.cancelled) {
        const summary = terminalZmodemSentFileSummary(sentFiles);
        if (sentFiles.length) {
          notify(`已通过 rz 发送：${summary}`, "success");
          queueTerminalOutput(session, `\r\n[ZMODEM] 已发送：${summary}（${terminalZmodemFormatBytes(completed)}）\r\n`);
        } else {
          notify("远端 rz 没有接收所选文件", "info");
          queueTerminalOutput(session, "\r\n[ZMODEM] 远端未接收所选文件；请检查同名文件策略和 rz 参数\r\n");
        }
      }
    } catch (error) {
      if (state.cancelled) return;
      terminalZmodemCancel(session, error.message || "发送失败");
      notify(error.message || "ZMODEM 发送失败", "error");
    }
  }, {once:true});
  input.addEventListener("cancel", () => {
    input.remove();
    terminalZmodemCancel(session, "未选择文件");
  }, {once:true});
  input.click();
}

function terminalZmodemDetected(session, detection) {
  const state = terminalZmodemState(session);
  try {
    const zsession = detection.confirm();
    terminalZmodemClearTimer(state);
    state.active = true;
    state.armed = false;
    state.cancelled = false;
    state.role = detection.get_session_role();
    state.batchTransferred = 0;
    state.zsession = zsession;
    terminalZmodemSendBinaryMode(session, true);
    zsession.on("session_end", () => {
      if (state.cancelled) return;
      terminalZmodemFinish(session, state.role === "receive" ? "接收会话已结束" : "发送会话已结束");
    });
    if (state.role === "receive") {
      zsession.on("offer", offer => terminalZmodemOffer(session, offer));
      terminalZmodemRender(session, {icon:"download", title:"已检测到 sz", detail:"正在读取远端文件信息；按 Ctrl+C 可取消"});
      Promise.resolve(zsession.start()).catch(error => {
        if (!state.cancelled) terminalZmodemCancel(session, error.message || "接收启动失败");
      });
    } else {
      terminalZmodemRender(session, {
        icon:"upload",
        title:"已检测到 rz",
        detail:"选择本机文件后开始上传；文件不会离开当前 SSH 会话",
        primaryAction:"send",
        primaryIcon:"files",
        primaryLabel:"选择文件"
      });
    }
  } catch (error) {
    terminalZmodemCancel(session, error.message || String(error));
  }
}

function initializeTerminalZmodem(session) {
  const state = terminalZmodemState(session);
  terminalZmodemClearTimer(state);
  state.active = false;
  state.armed = false;
  state.cancelled = false;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.batchTransferred = 0;
  state.zsession = null;
  state.offer = null;
  terminalZmodemRender(session, {hidden:true});
  if (!window.Zmodem?.Sentry) {
    state.sentry = null;
    return false;
  }
  state.sentry = new window.Zmodem.Sentry({
    to_terminal:octets => queueTerminalOutput(session, new Uint8Array(octets)),
    sender:octets => {
      if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(new Uint8Array(octets));
    },
    on_detect:detection => terminalZmodemDetected(session, detection),
    on_retract:() => {}
  });
  return true;
}

function consumeTerminalZmodemOutput(session, value) {
  const state = terminalZmodemState(session);
  if (state.cancelDraining && value instanceof ArrayBuffer && Date.now() <= state.discardUntil) return true;
  if (!state.sentry || !(value instanceof ArrayBuffer)) return false;
  try {
    terminalZmodemObserveArmedOutput(session, value);
    state.sentry.consume(value);
  } catch (error) {
    if (!state.cancelled) {
      terminalZmodemCancel(session, error.message || String(error));
      notify(error.message || "ZMODEM 协议错误", "error");
    }
  }
  return true;
}

function closeTerminalZmodem(session) {
  if (!session?.zmodemState) return;
  const state = session.zmodemState;
  terminalZmodemClearTimer(state);
  if ((state.active || state.armed) && session.socket?.readyState === WebSocket.OPEN) {
    try { terminalZmodemCancel(session, "终端已关闭"); } catch {}
  }
  state.panel?.remove();
  state.panel = null;
  state.sentry = null;
  state.zsession = null;
  state.active = false;
  state.armed = false;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.armedOutputTail = "";
}
