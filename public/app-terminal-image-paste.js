const TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const TERMINAL_CLIPBOARD_IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

function terminalClipboardImageFromPasteEvent(event) {
  const items = [...(event?.clipboardData?.items || [])];
  for (const item of items) {
    if (item?.kind !== "file" || !String(item.type || "").toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile?.();
    if (file) return file;
  }
  return null;
}

function terminalClipboardPasteMayContainImage(event, imageFile=null) {
  if (imageFile) return true;
  const types = [...(event?.clipboardData?.types || [])].map(type => String(type || "").toLowerCase());
  return types.some(type => type.startsWith("image/")) || typeof window.termaDesktop?.readClipboardImage === "function";
}

function terminalClipboardImageBytes(payload) {
  const source = payload?.data;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (Array.isArray(source)) return Uint8Array.from(source);
  if (Array.isArray(source?.data)) return Uint8Array.from(source.data);
  throw new Error(tr("terminal:clipboard.imageInvalid", {defaultValue:"剪贴板图片数据无效"}));
}

function terminalClipboardImageFilename(extension="png") {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = [...random].map(value => value.toString(16).padStart(2, "0")).join("");
  return `terma-clipboard-${stamp}-${suffix}.${extension}`;
}

function normalizeTerminalClipboardImageFile(file) {
  if (!file || !Number.isFinite(Number(file.size)) || Number(file.size) <= 0) {
    throw new Error(tr("terminal:clipboard.imageEmpty", {defaultValue:"剪贴板中的图片为空"}));
  }
  if (Number(file.size) > TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES) {
    throw new Error(tr("terminal:clipboard.imageTooLarge", {defaultValue:"剪贴板图片超过 25 MB，无法粘贴到远端终端"}));
  }
  const mimeType = String(file.type || "").toLowerCase();
  const extension = TERMINAL_CLIPBOARD_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw new Error(tr("terminal:clipboard.imageUnsupported", {defaultValue:"剪贴板图片格式不受支持，请使用 PNG、JPEG、WebP 或 GIF"}));
  }
  return new File([file], terminalClipboardImageFilename(extension), {type:mimeType, lastModified:Date.now()});
}

async function readTerminalClipboardImage(imageFile=null) {
  if (imageFile) return normalizeTerminalClipboardImageFile(imageFile);
  const bridge = window.termaDesktop?.readClipboardImage;
  if (typeof bridge !== "function") return null;
  const payload = await bridge();
  if (!payload?.ok) {
    if (payload?.reason === "empty") return null;
    throw new Error(payload?.error || tr("terminal:clipboard.imageReadFailed", {defaultValue:"无法读取剪贴板图片"}));
  }
  const bytes = terminalClipboardImageBytes(payload);
  if (!bytes.byteLength || bytes.byteLength !== Number(payload.byte_length || bytes.byteLength)) {
    throw new Error(tr("terminal:clipboard.imageInvalid", {defaultValue:"剪贴板图片数据无效"}));
  }
  if (bytes.byteLength > TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES) {
    throw new Error(tr("terminal:clipboard.imageTooLarge", {defaultValue:"剪贴板图片超过 25 MB，无法粘贴到远端终端"}));
  }
  return new File([bytes], terminalClipboardImageFilename("png"), {type:"image/png", lastModified:Date.now()});
}

async function terminalClipboardRemoteDirectory(session, connection, key) {
  const directory = session.currentDirectoryKnown
    ? session.currentDirectory
    : await initializeTerminalDirectory(session, connection, key);
  if (!directory) throw new Error(tr("terminal:clipboard.directoryUnknown", {defaultValue:"无法确认终端当前目录，请先重连终端"}));
  return String(directory).startsWith("/") ? "/tmp" : directory;
}

function terminalClipboardDirectX11Mode(session, connection) {
  const mode = String(session?.effectiveX11Mode || connection?.x11_mode || "off").trim().toLowerCase();
  return ["trusted", "untrusted"].includes(mode) ? mode : "off";
}

async function writeTerminalClipboardImageDirect(key, session, connection, file) {
  if (String(file?.type || "").toLowerCase() !== "image/png") return false;
  const x11Mode = terminalClipboardDirectX11Mode(session, connection);
  if (x11Mode === "off" || typeof file.arrayBuffer !== "function") return false;
  try {
    const result = await api(`/api/connections/${encodeURIComponent(connection.id)}/terminal-clipboard/image`, {
      method:"POST",
      headers:{
        "Content-Type":"image/png",
        "X-Terma-Terminal-X11-Mode":x11Mode
      },
      body:await file.arrayBuffer(),
      skipSftpConnect:true
    });
    if (!result?.ready) return false;
    return sendTerminalData(key, "\x16") !== false;
  } catch {
    return false;
  }
}

async function handleTerminalClipboardCtrlVInput(key, connectionId=0, data="\x16") {
  try {
    const file = await readTerminalClipboardImage();
    if (file) return handleTerminalClipboardImagePaste(key, connectionId, file);
  } catch {}
  return sendTerminalData(key, data);
}

function interceptTerminalClipboardCtrlVInput(key, connectionId=0, data="\x16") {
  if (data !== "\x16" || typeof window.termaDesktop?.readClipboardImage !== "function") return false;
  void handleTerminalClipboardCtrlVInput(key, connectionId, data);
  return true;
}

async function handleTerminalClipboardImagePaste(key, connectionId=0, imageFile=null) {
  const session = terminalSessions.get(String(key || ""));
  const connection = session?.connection || currentConnection(Number(connectionId || 0));
  if (!session?.connected || !connection) {
    notify(tr("terminal:clipboard.notConnected", {defaultValue:"终端尚未连接，无法粘贴图片"}), "error");
    return false;
  }
  try {
    const file = await readTerminalClipboardImage(imageFile);
    if (!file) {
      notify(tr("terminal:clipboard.noImage", {defaultValue:"剪贴板中没有可粘贴的文本或图片"}), "info");
      focusTerminalSession(key);
      return false;
    }
    if (await writeTerminalClipboardImageDirect(key, session, connection, file)) {
      notify(tr("terminal:clipboard.imageClipboardPasted", {defaultValue:"剪贴板图片已写入远端图形剪贴板"}), "success");
      focusTerminalSession(key);
      return true;
    }
    if (typeof uploadSftpFilesToDirectory !== "function") throw new Error(tr("terminal:clipboard.uploadUnavailable", {defaultValue:"当前版本不支持把剪贴板图片上传到远端"}));
    const directory = await terminalClipboardRemoteDirectory(session, connection, key);
    await uploadSftpFilesToDirectory([{file, relativePath:file.name}], Number(connection.id), directory, {conflict:"error", private:true});
    const remotePath = joinRemotePath(directory, file.name);
    await sendTerminalPasteText(key, remotePath);
    notify(tr("terminal:clipboard.imagePasted", {defaultValue:"剪贴板图片已上传并粘贴到终端"}), "success");
    focusTerminalSession(key);
    return true;
  } catch (error) {
    notify(error?.message || tr("terminal:clipboard.imagePasteFailed", {defaultValue:"粘贴剪贴板图片失败"}), "error");
    focusTerminalSession(key);
    return false;
  }
}
