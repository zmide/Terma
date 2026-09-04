const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const remoteSource = readFrontendDomain(root, "remote");
const cssSource = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");

assert.match(remoteSource, /rfb\.addEventListener\("clipboard"/);
assert.match(remoteSource, /event\.detail\?\.text/);
assert.match(remoteSource, /requestVncClipboardText/);
assert.match(remoteSource, /data-vnc-clipboard-sync/);
assert.match(remoteSource, /data-vnc-clipboard-receive/);
assert.match(remoteSource, /data-vnc-clipboard-send-image/);
assert.match(remoteSource, /data-vnc-clipboard-receive-image/);
assert.match(remoteSource, /sendVncClipboardImage/);
assert.match(remoteSource, /receiveVncClipboardImage/);
assert.match(remoteSource, /readVncLocalClipboardSnapshot/);
assert.match(remoteSource, /pollVncRemoteClipboardImageBridge/);
assert.match(remoteSource, /auto_sync_images/);
assert.match(remoteSource, /data-vnc-clipboard-helper/);
assert.match(remoteSource, /configureVncClipboardSsh/);
assert.match(remoteSource, /vncClipboardMatchingConnections/);
assert.match(remoteSource, /自动匹配同主机/);
assert.match(remoteSource, /保存并检测/);
assert.match(remoteSource, /session\.rfb !== rfb/);
assert.match(cssSource, /\.vnc-clipboard-status/);
assert.match(cssSource, /\.vnc-toolbar-actions \.icon-button\.active/);
assert.match(mainSource, /ipcMain\.handle\("terma:clipboard-read"/);
assert.match(mainSource, /ipcMain\.handle\("terma:clipboard-write"/);
assert.match(mainSource, /function desktopWindowForSender[\s\S]*?auxiliaryDesktopWindows/);
assert.match(mainSource, /function assertDesktopClipboardSender[\s\S]*?!desktopWindowForSender\(event\)/);
assert.match(mainSource, /!rendererBelongsToDesktop\(event\)/);
assert.match(mainSource, /renderer\.on\?\.\("will-navigate"/);
assert.match(preloadSource, /ipcRenderer\.invoke\("terma:clipboard-read"/);
assert.match(preloadSource, /ipcRenderer\.invoke\("terma:clipboard-write"/);
assert.match(mainSource, /ipcMain\.handle\("terma:clipboard-read-snapshot"/);
assert.match(preloadSource, /ipcRenderer\.invoke\("terma:clipboard-read-snapshot"/);
assert.match(mainSource, /async function readDesktopClipboardSnapshot\(options=\{\}\)/);
assert.match(mainSource, /clipboard\.read\(\)/);
assert.match(mainSource, /clipboardFormatNames\(items\)/);
assert.match(mainSource, /async function writeDesktopClipboardImageAsync\(value\)/);
assert.match(mainSource, /new ClipboardItem\(\{"image\/png"/);
assert.match(mainSource, /typeof clipboard\.availableFormats === "function"/);
assert.match(mainSource, /readClipboardPng:async \(\) =>/);
assert.match(mainSource, /readClipboardFormats:async \(\) =>/);
assert.match(mainSource, /async function readDesktopClipboardFormatsAsync\(\)/);
assert.match(remoteSource, /session\.clipboardLastSeenLocal = undefined/);
assert.match(remoteSource, /vnc-clipboard/);
assert.match(remoteSource, /responseType:"arrayBuffer"/);
assert.match(remoteSource, /已发送（服务端未确认）/);

const clipboard = {read:"", browserWrites:[], desktopWrites:[], imageWrites:[]};
const imagePng = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
const remoteImagePng = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,5,6,7,8]);
let desktopSnapshot = {text_available:true, text:"desktop clipboard", image_available:false};
const notifications = [];
const intervals = new Set();
const bridgeCalls = [];
let bridgeRemoteText = "macOS 初始剪贴板";
let bridgeTransport = "ssh-macos";
let bridgeApiOverride = null;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
};
const context = vm.createContext({
  console,
  Map,
  Set,
  Promise,
  String,
  Number,
  Boolean,
  Error,
  RegExp,
  Object,
  Array,
  Math,
  JSON,
  Date,
  setTimeout:callback => ({callback}),
  clearTimeout:() => {},
  setInterval:callback => {
    const handle = {callback};
    intervals.add(handle);
    return handle;
  },
  clearInterval:handle => intervals.delete(handle),
  navigator:{
    clipboard:{
      readText:async () => clipboard.read,
      writeText:async text => clipboard.browserWrites.push(String(text))
    }
  },
  window:{termaDesktop:null},
  crypto:nodeCrypto.webcrypto,
  document:{
    visibilityState:"visible",
    hasFocus:() => true,
    addEventListener:() => {},
    removeEventListener:() => {}
  },
  api:async (requestPath, options={}) => {
    bridgeCalls.push({path:String(requestPath), method:String(options.method || "GET"), body:options.body || ""});
    if (bridgeApiOverride) return bridgeApiOverride(requestPath, options);
    if (String(options.method || "GET") === "POST") {
      bridgeRemoteText = String(JSON.parse(options.body || "{}").text ?? "");
      return {ok:true, available:true, transport:bridgeTransport};
    }
    return {available:true, transport:bridgeTransport, text:bridgeRemoteText, truncated:false, max_bytes:32768};
  },
  tr:(key, options={}) => options.defaultValue || key,
  notify:(message, state) => notifications.push({message:String(message), state:String(state || "")}),
  writeClipboardText:async text => clipboard.browserWrites.push(String(text))
});

vm.runInContext(remoteSource, context, {filename:"public/app-remote.js"});
vm.runInContext(`globalThis.__vncClipboard = {
  readVncLocalClipboard,
  writeVncLocalClipboard,
  sendVncClipboardText,
  syncVncClipboardFromLocal,
  handleVncClipboardEvent,
  handleVncRemoteClipboard,
  ensureVncClipboardTransport,
  pollVncRemoteClipboardBridge,
  readVncLocalClipboardSnapshot,
  sendVncClipboardImageBytes,
  syncVncClipboardImageFromLocal,
  pollVncRemoteClipboardImageBridge,
  normalizeVncClipboardText,
  startVncClipboardPolling,
  stopVncClipboardPolling
};`, context);

const api = context.__vncClipboard;
const makeRfb = () => ({
  viewOnly:false,
  sent:[],
  focusCalls:0,
  clipboardPasteFrom(text) { this.sent.push(String(text)); },
  focus() { this.focusCalls += 1; }
});
const makeSession = rfb => ({
  key:"vnc-test",
  profile:{name:"VNC test", options:{view_only:false}},
  rfb,
  connected:true,
  clipboardAutoSync:true,
  remoteClipboardAvailable:false,
  remoteClipboardPending:false,
  viewport:{isConnected:true, closest:() => null}
});

(async () => {
  const rfb = makeRfb();
  const session = makeSession(rfb);

  assert.equal(api.normalizeVncClipboardText(String.raw`\u554a\u554a\u554a`), "啊啊啊");
  assert.equal(api.normalizeVncClipboardText(String.raw`\U0000554a\U0000554a`), "啊啊");
  assert.equal(api.normalizeVncClipboardText(String.raw`const value = "\u554a";`), `const value = "啊";`);
  assert.equal(api.normalizeVncClipboardText(String.raw`前缀 \u554a / \U0001F600 后缀`), "前缀 啊 / 😀 后缀");
  assert.equal(api.normalizeVncClipboardText(String.raw`const value = "\\u554a";`), String.raw`const value = "\\u554a";`);
  assert.equal(api.normalizeVncClipboardText(String.raw`\u554a\n`), "啊\\n");
  assert.equal(api.normalizeVncClipboardText(String.raw`C:\users\test`), String.raw`C:\users\test`);

  await api.handleVncRemoteClipboard(session, rfb, "远端\nclipboard");
  assert.deepEqual(clipboard.browserWrites, ["远端\nclipboard"]);
  assert.equal(session.remoteClipboardAvailable, true);
  assert.equal(session.remoteClipboardPending, false);
  assert.equal(session.clipboardLastSeenLocal, "远端\nclipboard");

  clipboard.read = "远端\nclipboard";
  assert.equal(await api.syncVncClipboardFromLocal(session), false);
  assert.deepEqual(rfb.sent, []);

  clipboard.read = "local-new-content";
  assert.equal(await api.syncVncClipboardFromLocal(session), true);
  assert.deepEqual(rfb.sent, ["local-new-content"]);
  assert.equal(await api.syncVncClipboardFromLocal(session), false);
  assert.deepEqual(rfb.sent, ["local-new-content"]);

  const unicodeWithoutBridge = makeSession(makeRfb());
  assert.equal(await api.sendVncClipboardText(unicodeWithoutBridge, "中文不会变问号", true), false);
  assert.deepEqual(unicodeWithoutBridge.rfb.sent, [], "没有 Unicode 辅助通道时不得把中文交给旧 RFB 剪贴板");

  const extendedClipboard = makeSession(makeRfb());
  extendedClipboard.rfb._clipboardServerCapabilitiesFormats = {1:true};
  extendedClipboard.rfb._clipboardServerCapabilitiesActions = {[0x08000000]:true};
  assert.equal(await api.sendVncClipboardText(extendedClipboard, "扩展剪贴板中文", false), true);
  assert.deepEqual(extendedClipboard.rfb.sent, ["扩展剪贴板中文"], "服务端支持 noVNC 扩展剪贴板时不应强制要求 SSH");

  const staleRfb = makeRfb();
  await api.handleVncRemoteClipboard(session, staleRfb, "旧连接内容");
  assert.deepEqual(clipboard.browserWrites, ["远端\nclipboard"]);

  await api.handleVncRemoteClipboard(session, rfb, "");
  assert.equal(session.remoteClipboardAvailable, true);
  assert.equal(session.remoteClipboardText, "");
  assert.deepEqual(clipboard.browserWrites, ["远端\nclipboard", ""]);

  await api.handleVncClipboardEvent(session, rfb, String.raw`\u4e2d\u6587`);
  assert.equal(session.remoteClipboardText, "中文");
  assert.equal(clipboard.browserWrites.at(-1), "中文");

  const manualRemote = makeSession(makeRfb());
  manualRemote.clipboardAutoSync = false;
  await api.handleVncRemoteClipboard(manualRemote, manualRemote.rfb, "手动读取内容");
  assert.equal(manualRemote.remoteClipboardPending, true);
  assert.equal(manualRemote.remoteClipboardText, "手动读取内容");
  assert.deepEqual(clipboard.browserWrites, ["远端\nclipboard", "", "中文"]);

  const backgroundRemote = makeSession(makeRfb());
  context.document.hasFocus = () => false;
  await api.handleVncRemoteClipboard(backgroundRemote, backgroundRemote.rfb, "后台内容");
  assert.equal(backgroundRemote.remoteClipboardPending, true);
  assert.deepEqual(clipboard.browserWrites, ["远端\nclipboard", "", "中文"]);
  context.document.hasFocus = () => true;

  const disconnected = makeSession(makeRfb());
  disconnected.connected = false;
  assert.equal(await api.sendVncClipboardText(disconnected, "blocked", true), false);
  assert.deepEqual(disconnected.rfb.sent, []);

  const viewOnly = makeSession(makeRfb());
  viewOnly.profile.options.view_only = true;
  viewOnly.rfb.viewOnly = true;
  assert.equal(await api.sendVncClipboardText(viewOnly, "blocked", true), false);
  assert.deepEqual(viewOnly.rfb.sent, []);

  const denied = makeSession(makeRfb());
  context.navigator.clipboard.readText = async () => { throw new Error("NotAllowedError: permission denied"); };
  assert.equal(await api.syncVncClipboardFromLocal(denied), false);
  assert.equal(denied.clipboardAutoSync, false);
  assert.equal(denied.clipboardPermissionBlocked, true);

  context.window.termaDesktop = {
    readClipboardText:async () => "desktop clipboard",
    writeClipboardText:async text => clipboard.desktopWrites.push(String(text)),
    readClipboardSnapshot:async () => ({...desktopSnapshot, image:desktopSnapshot.image_available ? {ok:true, data:desktopSnapshot.image} : undefined}),
    writeClipboardImage:async data => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      clipboard.imageWrites.push(bytes);
      desktopSnapshot = {text_available:false, text:"", image_available:true, image:bytes};
    }
  };
  assert.equal(await api.readVncLocalClipboard(), "desktop clipboard");
  await api.writeVncLocalClipboard("桌面写入", false);
  assert.deepEqual(clipboard.desktopWrites, ["桌面写入"]);

  desktopSnapshot = {text_available:true, text:"�PNG", image_available:true, image:imagePng};
  const imageSession = makeSession(makeRfb());
  imageSession.profile = {id:88, name:"Linux image VNC", options:{view_only:false, source_ssh_connection_id:74, auto_sync_images:true}};
  imageSession.clipboardTransport = "ssh-linux-x11";
  imageSession.clipboardTransportChecked = true;
  imageSession.clipboardBridgeTool = "xclip";
  imageSession.clipboardAutoSyncImages = true;
  let remoteImage = imagePng;
  bridgeApiOverride = async (requestPath, options={}) => {
    const pathValue = String(requestPath);
    if (pathValue.endsWith("/vnc-clipboard/image") && String(options.method || "GET") === "POST") {
      return {ok:true, available:true, transport:"ssh-linux-x11", sha256:await api.readHash(imagePng)};
    }
    if (pathValue.endsWith("/vnc-clipboard/image/metadata")) {
      return {available:true, sha256:await api.readHash(remoteImage), bytes:remoteImage.byteLength, too_large:false};
    }
    if (pathValue.endsWith("/vnc-clipboard/image")) return {data:Array.from(remoteImage)};
    return {available:true, transport:"ssh-linux-x11", text:"", text_available:false, truncated:false, max_bytes:32768};
  };
  api.readHash = async bytes => {
    const digest = new Uint8Array(await nodeCrypto.webcrypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, item => item.toString(16).padStart(2, "0")).join("");
  };
  assert.equal(await api.syncVncClipboardImageFromLocal(imageSession), true, "本机图片变化应自动发送到远端");
  assert.equal(await api.syncVncClipboardImageFromLocal(imageSession), false, "相同本机图片不得重复发送");
  assert.equal(await api.syncVncClipboardFromLocal(imageSession), false, "图片剪贴板不得被 PNG 二进制误读为文本");
  remoteImage = remoteImagePng;
  assert.equal(await api.pollVncRemoteClipboardImageBridge(imageSession, true), true, "远端图片变化应自动写入本机");
  assert.equal(clipboard.imageWrites.length, 1);
  assert.deepEqual(Array.from(clipboard.imageWrites[0]), Array.from(remoteImagePng));
  bridgeApiOverride = null;

  const macBridge = makeSession(makeRfb());
  macBridge.profile = {id:7, name:"macOS VNC", options:{view_only:false, source_ssh_connection_id:73}};
  macBridge.remotePlatform = "macos";
  assert.equal(await api.ensureVncClipboardTransport(macBridge), "ssh-macos");
  assert.equal(macBridge.remoteClipboardText, "macOS 初始剪贴板");
  await api.sendVncClipboardText(macBridge, "本机经 SSH 写入", false);
  assert.equal(bridgeRemoteText, "本机经 SSH 写入");
  assert.deepEqual(macBridge.rfb.sent, []);

  const staleRead = deferred();
  const delayedWrite = deferred();
  bridgeApiOverride = async (_requestPath, options={}) => {
    if (String(options.method || "GET") === "POST") return delayedWrite.promise;
    return staleRead.promise;
  };
  const desktopWritesBeforeRace = clipboard.desktopWrites.length;
  const stalePoll = api.pollVncRemoteClipboardBridge(macBridge, true);
  await Promise.resolve();
  const racedWrite = api.sendVncClipboardText(macBridge, "竞态中文 😀", false);
  await Promise.resolve();
  delayedWrite.resolve({ok:true, available:true, transport:"ssh-macos"});
  assert.equal(await racedWrite, true);
  staleRead.resolve({available:true, transport:"ssh-macos", text:"本机经 SSH 写入", truncated:false, max_bytes:32768});
  assert.equal(await stalePoll, false, "写入开始前发出的旧 GET 即使最后返回也必须丢弃");
  assert.equal(macBridge.remoteClipboardText, "竞态中文 😀");
  assert.deepEqual(clipboard.desktopWrites.slice(desktopWritesBeforeRace), []);
  bridgeApiOverride = null;

  bridgeRemoteText = "本机经 SSH 写入";
  assert.equal(await api.pollVncRemoteClipboardBridge(macBridge, true), false, "写入后的短期旧回声不得覆盖本机刚发送的内容");
  assert.equal(macBridge.remoteClipboardText, "竞态中文 😀");

  bridgeRemoteText = "真正的远端新内容";
  assert.equal(await api.pollVncRemoteClipboardBridge(macBridge, true), true, "保护期内出现第三个值时应立即视为真正的远端复制");
  assert.equal(macBridge.remoteClipboardText, "真正的远端新内容");
  assert.equal(clipboard.desktopWrites.at(-1), "真正的远端新内容");

  await api.sendVncClipboardText(macBridge, "第二次本机写入", false);
  macBridge.clipboardBridgeEchoGuard.expiresAt = Date.now() - 1;
  bridgeRemoteText = "真正的远端新内容";
  assert.equal(await api.pollVncRemoteClipboardBridge(macBridge, true), true, "保护期结束后远端再次复制旧值应允许同步");
  assert.equal(macBridge.remoteClipboardText, "真正的远端新内容");

  bridgeRemoteText = "macOS 新剪贴板";
  await api.pollVncRemoteClipboardBridge(macBridge, true);
  assert.equal(macBridge.remoteClipboardText, "macOS 新剪贴板");
  assert.equal(clipboard.desktopWrites.at(-1), "macOS 新剪贴板");
  assert.ok(bridgeCalls.some(item => item.method === "POST" && item.path.endsWith("/vnc-clipboard")));

  bridgeTransport = "ssh-linux-x11";
  bridgeRemoteText = "Linux 初始剪贴板";
  const linuxBridge = makeSession(makeRfb());
  linuxBridge.profile = {id:8, name:"Linux VNC", options:{view_only:false, source_ssh_connection_id:74}};
  linuxBridge.remotePlatform = "linux";
  assert.equal(await api.ensureVncClipboardTransport(linuxBridge), "ssh-linux-x11");
  await api.sendVncClipboardText(linuxBridge, "Linux 中文剪贴板", false);
  assert.equal(bridgeRemoteText, "Linux 中文剪贴板");
  assert.deepEqual(linuxBridge.rfb.sent, [], "Linux 中文剪贴板必须通过 SSH 辅助通道而不是旧 RFB");

  bridgeRemoteText = "Linux 远端中文更新";
  const desktopWritesBeforeLossyEvent = clipboard.desktopWrites.length;
  assert.equal(await api.handleVncClipboardEvent(linuxBridge, linuxBridge.rfb, "????"), true);
  assert.equal(linuxBridge.remoteClipboardText, "Linux 远端中文更新");
  assert.equal(clipboard.desktopWrites.at(-1), "Linux 远端中文更新");
  assert.deepEqual(
    clipboard.desktopWrites.slice(desktopWritesBeforeLossyEvent),
    ["Linux 远端中文更新"],
    "SSH Unicode 辅助通道启用后，旧 RFB 的问号事件不得覆盖中文剪贴板"
  );

  bridgeRemoteText = "Linux 正确 UTF-8 内容";
  assert.equal(await api.handleVncClipboardEvent(linuxBridge, linuxBridge.rfb, "ä¸­æ–‡"), true);
  assert.equal(linuxBridge.remoteClipboardText, "Linux 正确 UTF-8 内容", "SSH 辅助启用后 Latin-1 乱码事件也不得直接覆盖 UTF-8 内容");

  bridgeRemoteText = String.raw`\u554a\u554a\u554a`;
  await api.pollVncRemoteClipboardBridge(linuxBridge, true);
  assert.equal(linuxBridge.remoteClipboardText, "啊啊啊", "SSH 辅助返回的 Unicode 转义文本必须在写入本机剪贴板前解码");

  const polling = makeSession(makeRfb());
  api.startVncClipboardPolling(polling);
  assert.equal(intervals.size, 1);
  api.stopVncClipboardPolling(polling);
  assert.equal(intervals.size, 0);

  assert.ok(notifications.some(item => item.message.includes("尚未连接完成")));
  assert.ok(notifications.some(item => item.message.includes("仅查看模式")));
  console.log("VNC 剪贴板检查通过：双向同步、权限降级、循环抑制、旧会话隔离和 Electron 桥均有效");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
