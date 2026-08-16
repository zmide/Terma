const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const imagePasteSource = fs.readFileSync(path.join(root, "public", "app-terminal-image-paste.js"), "utf8");
const terminalSettingsSource = fs.readFileSync(path.join(root, "public", "app-terminal-settings.js"), "utf8");
const terminalSource = fs.readFileSync(path.join(root, "public", "app-terminal.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "public", "app-api.js"), "utf8");
const desktopSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");
const uploadSource = fs.readFileSync(path.join(root, "src", "sftp-upload-jobs.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src", "routes", "sftp-transfer-routes.ts"), "utf8");
const terminalRouteSource = fs.readFileSync(path.join(root, "src", "routes", "terminal-routes.ts"), "utf8");
const clipboardServiceSource = fs.readFileSync(path.join(root, "src", "terminal-clipboard.ts"), "utf8");
const sshSource = fs.readFileSync(path.join(root, "src", "ssh.ts"), "utf8");
const ssh2Source = fs.readFileSync(path.join(root, "src", "ssh2-client.ts"), "utf8");
const transferSource = fs.readFileSync(path.join(root, "public", "app-sftp-transfer.js"), "utf8");

assert.match(desktopSource, /ipcMain\.handle\("terma:clipboard-read-image"/);
assert.match(desktopSource, /assertDesktopClipboardSender\(event\)/);
assert.match(desktopSource, /DESKTOP_CLIPBOARD_IMAGE_MAX_BYTES = 25 \* 1024 \* 1024/);
assert.match(desktopSource, /DESKTOP_CLIPBOARD_IMAGE_MAX_PIXELS = 64 \* 1024 \* 1024/);
assert.match(preloadSource, /readClipboardImage\(\)/);
assert.match(preloadSource, /ipcRenderer\.invoke\("terma:clipboard-read-image"\)/);
assert.match(terminalSettingsSource, /terminalClipboardImageFromPasteEvent\(event\)/);
assert.match(terminalSettingsSource, /handleTerminalClipboardImagePaste\(key, connectionId, imageFile\)/);
assert.match(terminalSource, /handleTerminalClipboardImagePaste\(key\)/);
assert.match(terminalSource, /session\.effectiveX11Mode = effectiveX11Mode/);
assert.match(terminalSource, /interceptTerminalClipboardCtrlVInput\(key, c\.id, preparedData\)/);
assert.match(apiSource, /terminal-clipboard/);
assert.match(routeSource, /privateMode:data\.private === true/);
assert.match(uploadSource, /private_mode:options\.privateMode === true/);
assert.match(uploadSource, /job\.private_mode \? "umask 077; " : ""/);
assert.match(transferSource, /private:options\.private === true/);
assert.match(terminalRouteSource, /contentType !== "image\/png"/);
assert.match(terminalRouteSource, /\["off", "trusted", "untrusted"\]\.includes\(requestedX11Mode\)/);
assert.match(terminalRouteSource, /isDesktopCapabilityRequest\(request, "xserver"\)/);
assert.match(clipboardServiceSource, /umask 077/);
assert.match(clipboardServiceSource, /xclip -selection clipboard -target image\/png -quiet -i/);
assert.match(clipboardServiceSource, /rm -f \\"\$terma_clip_file\\" \\"\$terma_clip_error\\"/);
assert.match(clipboardServiceSource, /input:image/);
assert.match(sshSource, /stdio: \["pipe", "pipe", "pipe"\]/);
assert.match(sshSource, /x11Mode === "trusted"\) args\.push\("-Y"\)/);
assert.match(sshSource, /x11Mode === "untrusted"\) args\.push\("-X"\)/);
assert.match(ssh2Source, /channelOptions = \{x11:\{screen:authorization\.screen\}\}/);

function bytesFromPart(part) {
  if (part instanceof Uint8Array) return new Uint8Array(part);
  if (part instanceof ArrayBuffer) return new Uint8Array(part.slice(0));
  if (part?._bytes instanceof Uint8Array) return new Uint8Array(part._bytes);
  return new Uint8Array(Number(part?.size || part?.length || 0));
}

class MockFile {
  constructor(parts, name, options = {}) {
    this.name = name;
    this.type = options.type || "";
    this.lastModified = options.lastModified || 0;
    const arrays = parts.map(bytesFromPart);
    this.size = arrays.reduce((total, part) => total + part.byteLength, 0);
    this._bytes = new Uint8Array(this.size);
    let offset = 0;
    for (const part of arrays) {
      this._bytes.set(part, offset);
      offset += part.byteLength;
    }
  }

  async arrayBuffer() {
    return this._bytes.buffer.slice(this._bytes.byteOffset, this._bytes.byteOffset + this._bytes.byteLength);
  }
}

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const uploads = [];
const pasted = [];
const terminalData = [];
const notifications = [];
const apiCalls = [];
const directResults = [];
let focusCount = 0;
let clipboardPayload = {ok:true, mime_type:"image/png", byte_length:pngBytes.byteLength, data:pngBytes};
const connection = {id:7, name:"Linux", x11_mode:"trusted"};
const context = vm.createContext({
  ArrayBuffer,
  Date,
  File:MockFile,
  Map,
  Uint8Array,
  api:async (url, options) => {
    apiCalls.push({url, options});
    return directResults.shift() || {ready:false, available:false};
  },
  console,
  crypto:{getRandomValues(array) { array.set([0x12, 0x34, 0x56, 0x78]); return array; }},
  currentConnection:() => connection,
  focusTerminalSession:() => { focusCount += 1; },
  initializeTerminalDirectory:async () => { throw new Error("不应重新探测已知目录"); },
  joinRemotePath:(base, name) => `${String(base).replace(/\/$/, "")}/${name}`,
  notify:(message, type) => notifications.push({message, type}),
  sendTerminalData:(_key, value) => { terminalData.push(value); return true; },
  sendTerminalPasteText:async (_key, value) => { pasted.push(value); return true; },
  terminalSessions:new Map([["terminal-7", {
    connected:true,
    connection,
    currentDirectoryKnown:true,
    currentDirectory:"/home/demo/project",
    effectiveX11Mode:"trusted"
  }]]),
  tr:(_key, options={}) => options.defaultValue || _key,
  uploadSftpFilesToDirectory:async (files, connectionId, directory, options) => uploads.push({files, connectionId, directory, options}),
  window:{termaDesktop:{readClipboardImage:async () => clipboardPayload}}
});
vm.runInContext(imagePasteSource, context, {filename:"public/app-terminal-image-paste.js"});

async function checkFrontendPaths() {
  directResults.push({ready:true, available:true, transport:"x11", tool:"xclip"});
  const intercepted = vm.runInContext('interceptTerminalClipboardCtrlVInput("terminal-7", 7, "\\x16")', context);
  assert.equal(intercepted, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(apiCalls.length, 1);
  assert.match(apiCalls[0].url, /\/api\/connections\/7\/terminal-clipboard\/image$/);
  assert.equal(apiCalls[0].options.headers["Content-Type"], "image/png");
  assert.equal(apiCalls[0].options.headers["X-Terma-Terminal-X11-Mode"], "trusted");
  assert.equal(apiCalls[0].options.body.byteLength, pngBytes.byteLength);
  assert.deepEqual(terminalData, ["\x16"]);
  assert.equal(uploads.length, 0);
  assert.equal(pasted.length, 0);
  assert.match(notifications.at(-1).message, /图形剪贴板/);

  directResults.push({ready:false, available:false, reason:"xclip"});
  const fallbackPaste = await vm.runInContext('handleTerminalClipboardImagePaste("terminal-7", 7)', context);
  assert.equal(fallbackPaste, true);
  assert.equal(apiCalls.length, 2);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].connectionId, 7);
  assert.equal(uploads[0].directory, "/tmp");
  assert.equal(JSON.stringify(uploads[0].options), JSON.stringify({conflict:"error", private:true}));
  assert.match(uploads[0].files[0].file.name, /^terma-clipboard-\d{8}-\d{6}Z-12345678\.png$/);
  assert.equal(uploads[0].files[0].file.size, pngBytes.byteLength);
  assert.equal(pasted[0], `/tmp/${uploads[0].files[0].file.name}`);
  assert.equal(notifications.at(-1).type, "success");
  assert.equal(notifications.some(item => item.type === "error"), false);

  context.pasteEvent = {
    clipboardData:{
      items:[{kind:"file", type:"image/jpeg", getAsFile:() => new MockFile([Uint8Array.from([1, 2])], "source.jpg", {type:"image/jpeg"})}],
      types:["Files", "image/jpeg"]
    }
  };
  assert.equal(vm.runInContext("terminalClipboardImageFromPasteEvent(pasteEvent).type", context), "image/jpeg");
  assert.equal(vm.runInContext("terminalClipboardPasteMayContainImage(pasteEvent)", context), true);

  context.window.termaDesktop.readClipboardImage = async () => ({ok:false, reason:"empty"});
  const emptyResult = await vm.runInContext('handleTerminalClipboardImagePaste("terminal-7", 7)', context);
  assert.equal(emptyResult, false);
  assert.equal(uploads.length, 1);
  assert.equal(notifications.at(-1).type, "info");
  assert.equal(vm.runInContext('interceptTerminalClipboardCtrlVInput("terminal-7", 7, "\\x16")', context), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(terminalData, ["\x16", "\x16"]);

  context.largeImage = {size:25 * 1024 * 1024 + 1, type:"image/png"};
  const largeResult = await vm.runInContext('handleTerminalClipboardImagePaste("terminal-7", 7, largeImage)', context);
  assert.equal(largeResult, false);
  assert.equal(uploads.length, 1);
  assert.match(notifications.at(-1).message, /25 MB/);
  assert.equal(focusCount, 4);
}

async function checkBackendPaths() {
  const clipboard = require(path.join(root, "dist", "terminal-clipboard.js"));
  const { handleTerminalRoutes } = require(path.join(root, "dist", "routes", "terminal-routes.js"));
  const validPng = Buffer.from(pngBytes);
  const captured = {};
  let unhandled = null;
  const onUnhandled = error => { unhandled = error; };
  process.on("unhandledRejection", onUnhandled);
  const direct = await clipboard.writeTerminalClipboardImage({id:7}, validPng, {
    x11Mode:"trusted",
    runCommand:async (remoteConnection, command, timeoutMs, onChunk, options) => {
      Object.assign(captured, {remoteConnection, command, timeoutMs, options});
      onChunk(Buffer.from(`${clipboard.TERMINAL_CLIPBOARD_READY_MARKER}\n`), "stdout");
      await Promise.resolve();
      throw new Error("selection owner closed after HTTP response");
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(unhandled, null);
  assert.deepEqual(direct, {ready:true, available:true, transport:"x11", tool:"xclip", bytes:validPng.length});
  assert.equal(captured.remoteConnection.id, 7);
  assert.equal(captured.options.x11Mode, "trusted");
  assert.deepEqual(captured.options.input, validPng);
  assert.equal(captured.command.includes(validPng.subarray(8).toString("hex")), false);

  for (const reason of ["display", "xclip", "xclip-failed"]) {
    const unavailable = await clipboard.writeTerminalClipboardImage({id:7}, validPng, {
      x11Mode:"untrusted",
      runCommand:async (_connection, _command, _timeout, onChunk) => {
        onChunk(Buffer.from(`${clipboard.TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX}${reason}\n`), "stdout");
        return {status:reason === "xclip-failed" ? 1 : 20, stdout:"", stderr:""};
      }
    });
    assert.deepEqual(unavailable, {ready:false, available:false, reason});
  }

  let offCalled = false;
  const disabled = await clipboard.writeTerminalClipboardImage({id:7}, validPng, {
    x11Mode:"off",
    runCommand:async () => { offCalled = true; return {status:0}; }
  });
  assert.deepEqual(disabled, {ready:false, available:false, reason:"x11-disabled"});
  assert.equal(offCalled, false);
  assert.throws(() => clipboard.validateTerminalClipboardImage(Buffer.from("not a png")), /有效的 PNG/);
  assert.throws(() => clipboard.validateTerminalClipboardImage(Buffer.alloc(25 * 1024 * 1024 + 1)), /25 MB/);

  const routeConnection = {id:7, name:"Linux"};
  const routeCalls = [];
  let sent = null;
  const handled = await handleTerminalRoutes({
    method:"POST",
    headers:{"content-type":"image/png", "x-terma-terminal-x11-mode":"trusted"}
  }, {}, "/api/connections/7/terminal-clipboard/image", {
    authorizeConnection(_request, id) { assert.equal(id, 7); return routeConnection; },
    isDesktopCapabilityRequest(_request, scope) { assert.equal(scope, "xserver"); return true; },
    async readBody(_request, maxBytes) { assert.equal(maxBytes, clipboard.TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES + 1); return validPng; },
    sendJson(_response, data, status) { sent = {data, status}; },
    terminalClipboardImageMaxBytes:clipboard.TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES,
    async writeTerminalClipboardImage(remoteConnection, image, options) {
      routeCalls.push({remoteConnection, image, options});
      return {ready:true, available:true};
    }
  });
  assert.equal(handled, true);
  assert.equal(routeCalls.length, 1);
  assert.equal(routeCalls[0].remoteConnection, routeConnection);
  assert.deepEqual(routeCalls[0].image, validPng);
  assert.deepEqual(routeCalls[0].options, {x11Mode:"trusted"});
  assert.deepEqual(sent, {data:{ready:true, available:true}, status:undefined});

  sent = null;
  await handleTerminalRoutes({
    method:"POST",
    headers:{"content-type":"image/png", "x-terma-terminal-x11-mode":"invalid"}
  }, {}, "/api/connections/7/terminal-clipboard/image", {
    authorizeConnection() { return routeConnection; },
    sendJson(_response, data, status) { sent = {data, status}; }
  });
  assert.equal(sent.status, 400);
  assert.match(sent.data.error, /X11 模式/);

  sent = null;
  await handleTerminalRoutes({
    method:"POST",
    headers:{"content-type":"image/jpeg", "x-terma-terminal-x11-mode":"trusted"}
  }, {}, "/api/connections/7/terminal-clipboard/image", {
    authorizeConnection() { return routeConnection; },
    sendJson(_response, data, status) { sent = {data, status}; }
  });
  assert.equal(sent.status, 415);
}

(async () => {
  await checkFrontendPaths();
  await checkBackendPaths();
  console.log("终端剪贴板图片检查通过：X11 直写、Ctrl+V、自动回退、PNG/权限/输入边界和后台清理");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
