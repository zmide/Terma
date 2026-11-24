import type {TerminalZmodemState} from './terminal-zmodem-service';
import type {TerminalZmodemViewModel} from './TerminalZmodemView';
import type {ZmodemRuntimeSession, ZmodemRuntimePort, ZmodemUtils, ZmodemOffer, ZmodemUploadItem} from './terminal-zmodem-types';
function errorText(error: unknown) {return error instanceof Error ? error.message : String(error || '');}
export function createZmodemTransferService(port: ZmodemRuntimePort, utils: ZmodemUtils, actions: {
  current(session: ZmodemRuntimeSession, state: TerminalZmodemState, generation?: number): boolean;
  render(session: ZmodemRuntimeSession, view: TerminalZmodemViewModel): void;
  cancel(session: ZmodemRuntimeSession, reason?: string): boolean;
  finish(session: ZmodemRuntimeSession, message?: string): void;
}) {
  const tr=port.tr;
  const {createState:terminalZmodemState,safeFilename:terminalZmodemSafeFilename,formatBytes:terminalZmodemFormatBytes}=utils;
  const {current,render:terminalZmodemRender,cancel:terminalZmodemCancel,finish:terminalZmodemFinish}=actions;
  const terminalZmodemMaxFileBytes=()=>utils.maxFileBytes;
  const terminalZmodemSentFileSummary=(files: File[])=>utils.sentFileSummary(files,tr);
function terminalZmodemSaveFile(chunks: Uint8Array<ArrayBuffer>[], remoteName: string) {
  const name = terminalZmodemSafeFilename(remoteName);
  const blob = new Blob(chunks, {type:"application/octet-stream"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.hidden = true;
  anchor.href = `${url}#terma-filename=${encodeURIComponent(name)}`;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return {name, size:blob.size};
}

function terminalZmodemReceiveProgress(session: ZmodemRuntimeSession, name: string, received: number, total: number) {
  const state = terminalZmodemState(session);
  const now = performance.now();
  if (received < total && now - state.renderAt < 80) return;
  state.renderAt = now;
  terminalZmodemRender(session, {
    icon:"download",
    titleKey:"terminal:zmodem.receiving_file",
    titleOptions:{name, defaultValue:`正在接收 ${name}`},
    detail:`${terminalZmodemFormatBytes(received)} / ${terminalZmodemFormatBytes(total || received)}`,
    showProgress:Boolean(total),
    progress:total ? received / total * 100 : 0
  });
}

async function terminalZmodemAcceptOffer(session: ZmodemRuntimeSession, acceptBatch = false) {
  const state = terminalZmodemState(session);
  const offer = state.offer, generation = state.generation;
  const valid = () => actions.current(session, state, generation);
  if (!offer || !valid()) return;
  const details = offer.get_details();
  const expected = Math.max(0, Number(details.size || 0));
  if (expected > terminalZmodemMaxFileBytes()) {
    terminalZmodemRender(session, {
      icon:"circle-alert",
      titleKey:"terminal:zmodem.file_limit_title",
      titleOptions:{defaultValue:"文件超过终端传输上限"},
      detailKey:"terminal:zmodem.file_limit_detail",
      detailOptions:{name:terminalZmodemSafeFilename(details.name), size:terminalZmodemFormatBytes(expected), defaultValue:`${terminalZmodemSafeFilename(details.name)} 为 ${terminalZmodemFormatBytes(expected)}；超过 512 MB 请改用 SFTP`}
    });
    return;
  }
  state.acceptBatch = Boolean(acceptBatch);
  state.offer = null;
  state.transferred = 0;
  if (state.batchTransferred + expected > terminalZmodemMaxFileBytes()) {
    state.acceptBatch = false;
    terminalZmodemRender(session, {
      icon:"circle-alert",
      titleKey:"terminal:zmodem.batch_limit_title",
      titleOptions:{defaultValue:"本次传输总量超过上限"},
      detailKey:"terminal:zmodem.batch_limit_detail",
      detailOptions:{defaultValue:"累计文件超过 512 MB，请取消后改用 SFTP"}
    });
    return;
  }
  state.total = expected;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const name = terminalZmodemSafeFilename(details.name);
  try {
    await offer.accept({on_input:octets => {
      if(!valid()) throw new Error("ZMODEM transfer is no longer current");
      const chunk = new Uint8Array(octets).slice() as Uint8Array<ArrayBuffer>;
      state.transferred += chunk.byteLength;
      state.batchTransferred += chunk.byteLength;
      if (state.transferred > terminalZmodemMaxFileBytes() || state.batchTransferred > terminalZmodemMaxFileBytes()) {
        throw new Error(tr("terminal:zmodem.receive_limit_error", {defaultValue:"本次接收数据超过 512 MB，请改用 SFTP"}));
      }
      chunks.push(chunk);
      terminalZmodemReceiveProgress(session, name, state.transferred, expected);
    }});
    if (!valid()) return;
    const saved = terminalZmodemSaveFile(chunks, name);
    const savedSize = terminalZmodemFormatBytes(saved.size);
    port.notify(tr("terminal:zmodem.received", {name:saved.name, size:savedSize, defaultValue:`已通过 sz 接收 ${saved.name}（${savedSize}）`}), "success");
    port.output(session, `\r\n${tr("terminal:zmodem.received_terminal", {name:saved.name, size:savedSize, defaultValue:`[ZMODEM] 已接收 ${saved.name}（${savedSize}）`})}\r\n`);
  } catch (error) {
    if (!valid()) return;
    terminalZmodemCancel(session, errorText(error) || tr("terminal:zmodem.receive_failed_short", {defaultValue:"接收失败"}));
    port.notify(errorText(error) || tr("terminal:zmodem.receive_failed", {defaultValue:"ZMODEM 接收失败"}), "error");
  }
}

function terminalZmodemOffer(session: ZmodemRuntimeSession, offer: ZmodemOffer) {
  const state = terminalZmodemState(session);
  if (state.cancelled) return;
  state.offeredFiles = Number(state.offeredFiles || 0) + 1;
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
    titleKey:"terminal:zmodem.remote_offer",
    titleOptions:{name, defaultValue:`远端准备发送 ${name}`},
    detailKey:remaining > 1 ? "terminal:zmodem.batch_offer_detail" : "terminal:zmodem.offer_detail",
    detailOptions:remaining > 1
      ? {count:remaining, size:terminalZmodemFormatBytes(batchSize), defaultValue:`本批 ${remaining} 个文件，共 ${terminalZmodemFormatBytes(batchSize)}；文件只会下载，不会自动打开`}
      : {size:terminalZmodemFormatBytes(size), defaultValue:`${terminalZmodemFormatBytes(size)}；文件只会下载，不会自动打开`},
    primaryAction:"receive",
    primaryIcon:"download",
    primaryLabelKey:remaining > 1 ? "terminal:zmodem.receive_batch" : "terminal:zmodem.receive_file",
    primaryLabelOptions:{defaultValue:remaining > 1 ? "接收本批文件" : "接收文件"}
  });
}

function terminalZmodemRenamedFile(file: File, name: string) {
  if (!name || name === file.name) return file;
  return new File([file], name, {type:file.type || "application/octet-stream", lastModified:file.lastModified || Date.now()});
}

async function terminalZmodemPrepareSendFiles(session: ZmodemRuntimeSession, files: File[]) {
  const state=terminalZmodemState(session), generation=state.generation;
  const valid=()=>actions.current(session,state,generation);
  const directory = session.currentDirectoryKnown ? String(session.currentDirectory || ".") : ".";
  let plan: {items?: ZmodemUploadItem[]};
  try {
    plan = await port.uploadPlan(session.id, directory, files.map(file => file.name));
  } catch (error) {
    if (!valid()) return null;
    const choice = await port.choose(
      tr("terminal:zmodem.collision_check_failed_title", {defaultValue:"无法检查同名文件"}),
      tr("terminal:zmodem.collision_check_failed_detail", {error:errorText(error) || tr("terminal:zmodem.sftp_check_unavailable", {defaultValue:"SFTP 检查不可用"}), defaultValue:`${errorText(error) || "SFTP 检查不可用"}\n\n继续后远端 rz 可能覆盖同名文件。`}),
      [
        {label:tr("terminal:zmodem.continue_overwrite", {defaultValue:"继续并允许覆盖"}), value:"continue", className:"danger"},
        {label:tr("terminal:zmodem.cancel_upload", {defaultValue:"取消上传"}), value:""}
      ]
    );
    return valid() && choice === "continue" ? files : null;
  }
  if(!valid()) return null;
  const collisions = (plan.items || []).filter(item => item.exists);
  if (!collisions.length) return files;
  const conflict = await port.conflict(collisions);
  if (!valid() || !conflict) return null;
  if (conflict === "overwrite") return files;
  const targets = new Map((plan.items || []).map(item => [String(item.name), String(item.suggested_name || item.name)]));
  return files.map(file => terminalZmodemRenamedFile(file, targets.get(file.name) || file.name));
}

function terminalZmodemChooseFiles(session: ZmodemRuntimeSession) {
  const state = terminalZmodemState(session);
  if (!state.zsession || state.role !== "send" || state.picker || state.sending || !actions.current(session,state)) return;
  const generation=state.generation;
  const valid=()=>actions.current(session,state,generation);
  const library=port.library(), zsession=state.zsession;
  if (!library || !zsession) return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);
  state.picker=input;
  input.addEventListener("change", async () => {
    if (state.picker !== input || !valid()) return;
    state.picker = null;
    state.sending = true;
    try {
    const files = [...(input.files || [])];
    input.remove();
    if (!files.length) return terminalZmodemCancel(session, tr("terminal:zmodem.no_file_selected", {defaultValue:"未选择文件"}));
    const unsafe = files.find(file => /[\x00-\x1f\x7f]/.test(file.name));
    const oversized = files.find(file => file.size > terminalZmodemMaxFileBytes());
    if (unsafe || oversized) {
      const message = unsafe
        ? tr("terminal:zmodem.unsafe_filename", {name:terminalZmodemSafeFilename(unsafe.name), defaultValue:`文件名包含控制字符：${terminalZmodemSafeFilename(unsafe.name)}`})
        : tr("terminal:zmodem.oversized_file", {name:oversized!.name, defaultValue:`${oversized!.name} 超过 512 MB，请改用 SFTP`});
      terminalZmodemCancel(session, message);
      port.notify(message, "error");
      return;
    }
    const preparedFiles = await terminalZmodemPrepareSendFiles(session, files);
    if(!valid()) return;
    if (!preparedFiles?.length) return terminalZmodemCancel(session, tr("terminal:zmodem.collision_handling_cancelled", {defaultValue:"已取消同名文件处理"}));
    const total = preparedFiles.reduce((sum, file) => sum + file.size, 0);
    if (total > terminalZmodemMaxFileBytes()) {
      const message = tr("terminal:zmodem.selection_limit", {size:terminalZmodemFormatBytes(total), defaultValue:`所选文件合计 ${terminalZmodemFormatBytes(total)}，超过 512 MB，请改用 SFTP`});
      terminalZmodemCancel(session, message);
      port.notify(message, "error");
      return;
    }
    let completed = 0;
    const sentFiles: File[] = [];
    try {
      terminalZmodemRender(session, {
        icon:"upload",
        titleKey:"terminal:zmodem.uploading_via_rz",
        titleOptions:{defaultValue:"正在通过 rz 上传"},
        detail:`0 B / ${terminalZmodemFormatBytes(total)}`,
        showProgress:true,
        progress:0
      });
      await library.Browser.send_files(zsession, preparedFiles, {
        on_progress:(file, transfer) => {
          if(!valid()) return;
          const sent = Math.min(file.size, Number(transfer.get_offset?.() || 0));
          terminalZmodemRender(session, {
            icon:"upload",
            titleKey:"terminal:zmodem.sending_file",
            titleOptions:{name:file.name, defaultValue:`正在发送 ${file.name}`},
            detail:`${terminalZmodemFormatBytes(completed + sent)} / ${terminalZmodemFormatBytes(total)}`,
            showProgress:true,
            progress:total ? (completed + sent) / total * 100 : 100
          });
        },
        on_file_complete:file => { if(valid()){completed += file.size; sentFiles.push(file);} }
      });
      if (!valid()) return;
      await zsession.close();
      const finished = valid() || (port.current(session) && !state.closed && !state.cancelled
        && !state.active && !state.armed && state.finishedZsession === zsession);
      if (finished) {
        const summary = terminalZmodemSentFileSummary(sentFiles);
        if (sentFiles.length) {
          const completedSize = terminalZmodemFormatBytes(completed);
          port.notify(tr("terminal:zmodem.sent", {summary, defaultValue:`已通过 rz 发送：${summary}`}), "success");
          port.output(session, `\r\n${tr("terminal:zmodem.sent_terminal", {summary, size:completedSize, defaultValue:`[ZMODEM] 已发送：${summary}（${completedSize}）`})}\r\n`);
        } else {
          port.notify(tr("terminal:zmodem.remote_rejected_files", {defaultValue:"远端 rz 没有接收所选文件"}), "info");
          port.output(session, `\r\n${tr("terminal:zmodem.remote_rejected_terminal", {defaultValue:"[ZMODEM] 远端未接收所选文件；请检查同名文件策略和 rz 参数"})}\r\n`);
        }
        if (valid()) terminalZmodemFinish(session);
      }
    } catch (error) {
      if (!valid()) return;
      terminalZmodemCancel(session, errorText(error) || tr("terminal:zmodem.send_failed_short", {defaultValue:"发送失败"}));
      port.notify(errorText(error) || tr("terminal:zmodem.send_failed", {defaultValue:"ZMODEM 发送失败"}), "error");
    }
    } finally {
      if (state.generation === generation) state.sending = false;
    }
  }, {once:true});
  input.addEventListener("cancel", () => {
    input.remove();
    if (state.picker !== input || !valid()) return;
    state.picker = null;
    terminalZmodemCancel(session, tr("terminal:zmodem.no_file_selected", {defaultValue:"未选择文件"}));
  }, {once:true});
  input.click();
}
return {saveFile:terminalZmodemSaveFile,receiveProgress:terminalZmodemReceiveProgress,acceptOffer:terminalZmodemAcceptOffer,
 offer:terminalZmodemOffer,renamedFile:terminalZmodemRenamedFile,prepareSendFiles:terminalZmodemPrepareSendFiles,
 chooseFiles:terminalZmodemChooseFiles};
}
