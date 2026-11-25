const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const vm = require("node:vm");
const { loadFrontendService } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const vncRuntime = fs.readFileSync(path.join(root, 'frontend/src/features/remote/vnc-runtime.ts'), 'utf8');
const sessionOwner=fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-session-service.ts'),'utf8');
const cssSource = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");

assert.match(sessionOwner, /on\('clipboard'/);
assert.match(sessionOwner, /event.detail\?\.text/);
const toolbarView = fs.readFileSync(path.join(root,'frontend/src/features/remote/RemoteDesktopViews.ts'),'utf8');
for (const action of ['sync','receive','send-image','receive-image','helper']) assert.ok(toolbarView.includes(`data-vnc-clipboard-${action}`));
assert.match(vncRuntime, /images\.send\(/);
assert.match(vncRuntime, /images\.receive\(/);
assert.match(sessionOwner, /auto_sync_images/);
assert.match(vncRuntime, /helper\.configure/);
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
assert.match(sessionOwner, /session.clipboardLastSeenLocal=undefined/);
assert.match(fs.readFileSync(path.join(root, "frontend/src/features/remote/vnc-clipboard-images.ts"), "utf8"), /responseType: 'arrayBuffer'/);
const clipboardMessages = require("../public/locales/zh-CN/remote.json").clipboard;

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
  window:{termaDesktop:null,termaVncRuntime:{session:{current:session=>{const rfb=session.rfb,revision=session.connectionRevision;return ()=>session.rfb===rfb&&session.connectionRevision===revision&&session.connected;}}}},
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
  tr:(key, options={}) => options.defaultValue || clipboardMessages[key.split(".").at(-1)] || key,
  notify:(message, state) => notifications.push({message:String(message), state:String(state || "")}),
  writeClipboardText:async text => clipboard.browserWrites.push(String(text))
});

const remoteFolder = path.join(root, "frontend/src/features/remote");
const { createVncLocalClipboard } = loadFrontendService(path.join(remoteFolder, "vnc-local-clipboard.ts"));
const { createVncClipboardModel } = loadFrontendService(path.join(remoteFolder, "vnc-clipboard-model.ts"));
const { createVncClipboardImages } = loadFrontendService(path.join(remoteFolder, "vnc-clipboard-images.ts"));
const { createVncClipboardText } = loadFrontendService(path.join(remoteFolder, "vnc-clipboard-text.ts"));
const { createVncClipboardHelper } = loadFrontendService(path.join(remoteFolder, "vnc-clipboard-helper.ts"));
const { createVncClipboardPolling } = loadFrontendService(path.join(remoteFolder, "vnc-clipboard-polling.ts"),
  {setInterval: context.setInterval, clearInterval: context.clearInterval, setTimeout: context.setTimeout, clearTimeout: context.clearTimeout});
const localClipboard = createVncLocalClipboard({
  tr: context.tr, desktop: () => context.window.termaDesktop, browser: () => context.navigator.clipboard,
  writeManualText: context.writeClipboardText
});
const clipboardModel = createVncClipboardModel({tr: context.tr, localize: value => value, bridgeCandidate: () => false});
Object.assign(context.window.termaVncRuntime, {localClipboard, clipboardModel});
const host = {api:context.api, tr:context.tr, notify:context.notify,
  candidate: session => Boolean(session.profile.options?.source_ssh_connection_id),
  controls: () => {}, status: (session, message) => {session.clipboardStatusText = message;},
  visible: session => !!context.document.hasFocus() && session.viewport?.isConnected !== false && !session.viewport?.closest?.('[hidden]')};
const testSessions = new Map();
let now = Date.now();
const current = context.window.termaVncRuntime.session.current;
const text = createVncClipboardText({...host, localize: value => value, current, local: localClipboard, now: () => now,
  observe: (session, snapshot) => images.observe(session, snapshot), stop: session => pollingService.stop(session)});
const images = createVncClipboardImages({...host, local: localClipboard, current, session: key => testSessions.get(key),
  transport: text.transport, unavailable: text.unavailable});
const pollingService = createVncClipboardPolling({text, images, sessions: () => testSessions.values(), interval: (_, fallback) => fallback, now: () => now});
context.window.termaVncRuntime.images = images;
const api = {
  readVncLocalClipboard: localClipboard.readText,
  writeVncLocalClipboard: localClipboard.writeText,
  sendVncClipboardText: text.send,
  syncVncClipboardFromLocal: text.fromLocal,
  handleVncClipboardEvent: text.event,
  handleVncRemoteClipboard: text.fromRemote,
  ensureVncClipboardTransport: text.transport,
  pollVncRemoteClipboardBridge: text.poll,
  sendVncClipboardImageBytes: images.sendBytes,
  syncVncClipboardImageFromLocal: images.fromLocal,
  pollVncRemoteClipboardImageBridge: images.poll,
  normalizeVncClipboardText: clipboardModel.normalizeText,
  startVncClipboardPolling: pollingService.start,
  stopVncClipboardPolling: pollingService.stop
};
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

async function checkHelperTasks() {
  const seed = () => ({
    key:"helper", connected:true, clipboardAutoSync:true,
    profile:{id:7, protocol:"vnc", host:"host.example.test", options:{source_ssh_connection_id:2}}
  });
  let session = seed(), confirm = false, lease = 1, pendingPrompt, guideRequested, finishTask, transportMode;
  let inspectFinished, watching, configured;
  const calls = [], starts = [], events = [];
  const sameHost = {id:2, ssh_host:"host.example.test", ssh_user:"test"};
  const otherHost = {id:3, ssh_host:"elsewhere.example.test", ssh_user:"test"};
  const helper = createVncClipboardHelper({
    current: () => {const opened=lease;return () => opened===lease;},
    session: () => session, profile: () => session.profile, connections: () => [sameHost, otherHost],
    normalizeHost: value => String(value || '').toLowerCase(),
    tr: key => key, notify: (message, kind) => events.push([message,kind]), localize: () => '',
    prompt(options) {
      pendingPrompt=options;
      configured=deferred();
      return configured.promise;
    },
    refresh(options) { if(options.model().diagnostic.head)inspectFinished?.resolve(); },
    finish(options, value) {options.dismissed();configured.resolve(value);}, commands: () => {},
    guides: () => ({install: () => ({modes:[]}),manual: () => ({})}),
    action: (id, label, icon, run) => ({id,label,icon,run}),
    begin: () => true, end: () => {}, focus: () => {}, status: () => {}, revealManual: () => {},
    confirm: async () => confirm, authorize: async () => ({admin_grant_id:'fixture-grant'}),
    taskRequested: () => true, taskError: () => '', reset: () => {}, send: async () => true,
    transport: async () => transportMode,
    stop: () => {}, start: s => starts.push(s),
    watch: async () => {watching.resolve();return finishTask.promise;},
    api: async (_url, request) => {
      const body = JSON.parse(request.body);
      calls.push(body);
      if (body.action === 'guide') {
        guideRequested=body.connection_id;
        return {platform:'linux', available:true, root:false, connection_id:body.connection_id,
          uninstall_plan:{available:true, package_names:['xclip']}};
      }
      if (request.method === 'PUT') return {...session.profile, options:body.options};
      return {task:{id:'fixture', action:'install', status:'pending', connection_id:2}};
    }
  });
  const open = async () => {
    inspectFinished=deferred();
    const operation = helper.configure(session.key);
    await inspectFinished.promise;
    return {operation};
  };
  const cancel = await open();
  assert.equal(guideRequested,2);
  await helper.operate(session.key,'uninstall',{});
  await cancel.operation;
  assert.deepEqual(calls.filter(call=>call.action!=='guide'),[],'cancelling uninstall saves no profile and starts no task');
  const preview = await open();
  inspectFinished=deferred();
  pendingPrompt.select(3);
  await inspectFinished.promise;
  assert.equal(guideRequested,3);
  assert.equal(session.profile.options.source_ssh_connection_id,2,'preview does not change the selected helper');
  helper.release(session);
  await preview.operation;

  confirm=true;transportMode='ssh-linux-x11';finishTask=deferred();watching=deferred();
  const conflict = await open();
  const result=helper.operate(session.key,'uninstall',{});
  await watching.promise;
  assert.equal(calls.at(-1).action,'uninstall');
  assert.equal(calls.at(-1).connection_id,2);
  assert.equal(calls.at(-1).admin_auth.admin_grant_id,'fixture-grant');
  finishTask.resolve({status:'done'});
  await result; await conflict.operation;
  assert.ok(events.some(([message,kind])=>message.endsWith('.install_verified')&&kind==='success'),
    'conflicting install is verified as an install');
  assert.equal(starts.length,1);

  finishTask=deferred();watching=deferred();
  const closing = await open();
  const obsolete = helper.operate(session.key,'uninstall',{});
  await watching.promise;
  lease++;session=seed();
  const previousEvents=events.length;
  finishTask.resolve({status:'done'});
  await obsolete; await closing.operation;
  assert.equal(starts.length,1,'late completion cannot start polling in a replacement session');
  assert.equal(events.length,previousEvents,'late completion cannot repaint or report success in a replacement session');
}

(async () => {
  await checkHelperTasks();
  assert.throws(() => localClipboard.imageBytes(Uint8Array.of(0, 1, 2)), {message:clipboardMessages.image_not_png});
  assert.throws(() => localClipboard.imageBytes(new Uint8Array(25 * 1024 * 1024 + 1)), {message:clipboardMessages.image_too_large});
  assert.equal(await localClipboard.imageHash({data:imagePng}), nodeCrypto.createHash("sha256").update(imagePng).digest("hex"));
  let blobReads = 0;
  context.navigator.clipboard.read = async () => [{
    types: ["image/png"],
    getType: async () => { blobReads++; return new Blob([imagePng]); }
  }];
  assert.equal((await localClipboard.readSnapshot(false)).imageAvailable, true);
  assert.equal(blobReads, 0, "metadata polls must skip PNG reads");
  assert.deepEqual([...(await localClipboard.readSnapshot(true)).image], [...imagePng]);
  delete context.navigator.clipboard.read;

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
  now += 3001;
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

  const retryText = makeSession(makeRfb());
  retryText.profile.id=71;retryText.clipboardTransport='ssh-linux-x11';retryText.clipboardTransportChecked=true;
  desktopSnapshot={text_available:true,text:'retry synthetic text',image_available:false};let retryWrites=0;
  bridgeApiOverride=async (_path,options={})=>{if(options.method==='POST'){retryWrites++;if(retryWrites===1)throw Error('temporary failure');return {ok:true};}return {available:true,transport:'ssh-linux-x11',text_available:false};};
  assert.equal(await api.syncVncClipboardFromLocal(retryText),false);
  assert.equal(await api.syncVncClipboardFromLocal(retryText),true);
  assert.equal(retryWrites,2,'a failed text transfer must not mark the value delivered');
  const retryImage=makeSession(makeRfb());retryImage.profile.id=71;retryImage.clipboardAutoSyncImages=true;retryImage.clipboardTransport='ssh-linux-x11';retryImage.clipboardTransportChecked=true;retryImage.clipboardBridgeTool='xclip';
  const retryPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1b8AAAAASUVORK5CYII=','base64');
  context.window.termaDesktop={readClipboardSnapshot:async ({includeImage})=>({text_available:false,image_available:true,image_revision:'retry-1',image:includeImage?{ok:true,data:retryPng}:undefined})};let imageWrites=0;
  bridgeApiOverride=async (_path,options={})=>{if(options.method==='POST'){imageWrites++;if(imageWrites===1)throw Error('temporary image failure');return {ok:true};}return {available:true,transport:'ssh-linux-x11'};};
  assert.equal(await api.syncVncClipboardImageFromLocal(retryImage),false);
  assert.equal(await api.syncVncClipboardImageFromLocal(retryImage),true);
  assert.equal(imageWrites,2,'a failed image transfer must not mark its revision delivered');
  const stale = makeSession(makeRfb());
  Object.assign(stale.profile, {id:72});
  Object.assign(stale, {key:"stale-image", clipboardTransport:"ssh-linux-x11", clipboardTransportChecked:true, clipboardBridgeTool:"xclip"});
  testSessions.set(stale.key,stale);
  let clipboardWrites = 0;
  context.window.termaDesktop.writeClipboardImage = async () => { clipboardWrites++; };
  const started = deferred(), response = deferred();
  bridgeApiOverride = async () => { started.resolve(); return response.promise; };
  const pending = context.window.termaVncRuntime.images.receive(stale.key,true);
  await started.promise;
  stale.connected = false;
  context.window.termaVncRuntime.images.reset(stale);
  stale.connected = true;
  response.resolve({data:imagePng.buffer});
  assert.equal(await pending,false);
  assert.equal(clipboardWrites,0,"a replaced connection must not write an old PNG into the local clipboard");
  context.window.termaDesktop=null;bridgeApiOverride=null;

  const restarting = makeSession(makeRfb());
  restarting.profile = {id:75, options:{source_ssh_connection_id:73}};
  const startedProbe = deferred(), oldProbe = deferred();
  let probes = 0;
  bridgeApiOverride = async () => {
    if (++probes === 1) {startedProbe.resolve();return oldProbe.promise;}
    return {available:true,transport:"ssh-linux-x11",text:"Current profile"};
  };
  const oldSend = text.send(restarting,"Must never send");
  await startedProbe.promise;
  restarting.rfb = makeRfb();
  text.reset(restarting);
  assert.equal(await text.transport(restarting),"ssh-linux-x11");
  oldProbe.resolve({available:true,transport:"ssh-macos",text:"Stale probe"});
  assert.equal(await oldSend,false);
  assert.equal(probes,2,"retired channel discovery cannot send to the replacement connection");
  assert.equal(restarting.remoteClipboardText,"Current profile");
  assert.equal(restarting.clipboardTransport,"ssh-linux-x11");
  const startedText = deferred(), oldText = deferred();
  bridgeApiOverride = async () => {startedText.resolve();return oldText.promise;};
  const staleTextRead = text.poll(restarting,true);
  await startedText.promise;
  restarting.rfb = makeRfb();
  text.reset(restarting);
  oldText.resolve({available:true,transport:"ssh-macos",text:"Must never write"});
  const writesBefore = clipboard.browserWrites.length;
  assert.equal(await staleTextRead,false);
  assert.equal(clipboard.browserWrites.length,writesBefore,"a retired text poll cannot write to the local clipboard");
  bridgeApiOverride = null;

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
