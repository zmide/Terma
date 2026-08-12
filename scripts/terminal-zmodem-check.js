"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "public", "vendor", "zmodem.js"), "utf8");
const frontendSource = fs.readFileSync(path.join(root, "public", "app-terminal-zmodem.js"), "utf8");
const terminalSource = fs.readFileSync(path.join(root, "src", "terminal.ts"), "utf8");
const notices = [];
const focused = [];
let uploadPlan = {items:[]};
let conflictChoice = "";
let uploadPlanRequest = null;

assert.doesNotMatch(runtimeSource, /console\.log\(["']consuming/);
assert.doesNotMatch(runtimeSource, /console\.log\(\s*this\.type,\s*["']SENDING HEADER/);

const sandbox = {
  window:{},
  console:{log(){}, debug(){}, warn(){}, error(){}},
  setTimeout,
  clearTimeout,
  Uint8Array,
  ArrayBuffer,
  Blob,
  File,
  URL,
  performance,
  WebSocket:{OPEN:1},
  cleanTerminalCommandText:value => String(value || "").replace(/[\x00-\x1f\x7f]/g, "").trim(),
  currentTerminalPromptCommand:() => "",
  terminalBroadcastKeys:() => [],
  queueTerminalOutput(session, output) { session.outputs.push(output); },
  notify(message, level){ notices.push({message,level}); },
  api:async (pathname, options={}) => { uploadPlanRequest = {pathname, body:JSON.parse(options.body || "{}")}; return uploadPlan; },
  chooseSftpUploadConflict:async () => conflictChoice,
  chooseModal:async () => "",
  focusTerminalSession(key){ focused.push(key); },
  loadScriptOnce:async () => {},
  icon:() => "",
  esc:value => String(value || ""),
  escAttr:value => String(value || ""),
  refreshIcons(){},
  document:{createElement(){ throw new Error("test does not create DOM nodes"); }}
};
vm.createContext(sandbox);
vm.runInContext(runtimeSource, sandbox, {filename:"zmodem.js"});
vm.runInContext(frontendSource, sandbox, {filename:"app-terminal-zmodem.js"});

assert.equal(sandbox.terminalZmodemCommandRole("sz log.log"), "receive");
assert.equal(sandbox.terminalZmodemCommandRole("sudo /usr/bin/lsz -- log.log"), "receive");
assert.equal(sandbox.terminalZmodemCommandRole("command rz"), "send");
assert.equal(sandbox.terminalZmodemCommandRole("echo sz log.log"), "");
assert.equal(sandbox.terminalZmodemCommandInfo("sz").canStart, false);
assert.equal(sandbox.terminalZmodemCommandInfo("rz log.log").canStart, false);
assert.equal(sandbox.terminalZmodemCommandInfo("rz").canStart, true);
assert.equal(sandbox.terminalZmodemRzNeedsOverwrite(sandbox.terminalZmodemCommandInfo("rz")), true);
assert.equal(sandbox.terminalZmodemRzNeedsOverwrite(sandbox.terminalZmodemCommandInfo("rz -y")), false);
assert.equal(sandbox.terminalZmodemSafeFilename("../../folder/remote.txt"), "remote.txt");
assert.equal(sandbox.terminalZmodemSafeFilename("../\x00.."), "download.bin");

const uploadConflictCheck = (async () => {
  const uploadSession = {id:44, currentDirectoryKnown:true, currentDirectory:"/srv/files"};
  const uploadFile = new File(["content"], "existing.txt", {type:"text/plain"});
  uploadPlan = {items:[{name:"existing.txt", exists:true, suggested_name:"existing (2).txt"}]};
  conflictChoice = "";
  assert.equal(await sandbox.terminalZmodemPrepareSendFiles(uploadSession, [uploadFile]), null);
  conflictChoice = "rename";
  const renamedFiles = await sandbox.terminalZmodemPrepareSendFiles(uploadSession, [uploadFile]);
  assert.equal(renamedFiles[0].name, "existing (2).txt");
  assert.equal(uploadPlanRequest.pathname, "/api/connections/44/sftp/upload-plan");
  assert.deepEqual(uploadPlanRequest.body, {path:"/srv/files", filenames:["existing.txt"]});
  conflictChoice = "overwrite";
  const overwrittenFiles = await sandbox.terminalZmodemPrepareSendFiles(uploadSession, [uploadFile]);
  assert.equal(overwrittenFiles[0], uploadFile);
  assert.equal(sandbox.terminalZmodemSentFileSummary([uploadFile, new File(["x"], "second.txt")]), "existing.txt、second.txt");
})();

let detectedRole = "";
const sentry = new sandbox.window.Zmodem.Sentry({
  to_terminal(){},
  sender(){},
  on_detect:detection => { detectedRole = detection.get_session_role(); },
  on_retract(){}
});
// Captured from lrzsz 0.12.21 on the authorized Linux acceptance host.
const zrqinit = Buffer.from("2a2a184230303030303030303030303030300d8a11", "hex");
sentry.consume(zrqinit.buffer.slice(zrqinit.byteOffset, zrqinit.byteOffset + zrqinit.byteLength));
assert.equal(detectedRole, "receive");

const sent = [];
const session = {
  key:"terminal-zmodem-cancel",
  socket:{readyState:1, send:value => sent.push(value)},
  commandBuffer:"sz log.log",
  outputs:[]
};
sandbox.terminalZmodemState(session).sentry = {};
assert.equal(sandbox.terminalZmodemPrepareInput(session, "\r"), false);
assert.equal(JSON.parse(sent[0]).type, "terminal-binary-mode");
assert.equal(JSON.parse(sent[0]).enabled, true);
assert.equal(sandbox.terminalZmodemPrepareInput(session, "\x03"), true);
assert.equal(sent[1] instanceof Uint8Array, true);
assert.deepEqual([...sent[1].slice(0, 8)], [24, 24, 24, 24, 24, 24, 24, 24]);
assert.deepEqual([...sent[1].slice(8)], [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
assert.match(String(session.outputs.at(-1)), /Ctrl\+C/);
assert.equal(focused.includes(session.key), true, "Ctrl+C cancellation must restore terminal focus");
sandbox.closeTerminalZmodem(session);

for (const [input, commandBuffer, expected] of [["\r", "rz", " -y\r"], ["rz\r", "", "rz -y\r"], ["rz -y\r", "", "rz -y\r"]]) {
  const rzSession = {socket:{readyState:1,send(){}},commandBuffer,outputs:[]};
  sandbox.terminalZmodemState(rzSession).sentry = {};
  assert.equal(sandbox.terminalZmodemPrepareInput(rzSession, input), false);
  assert.equal(sandbox.terminalZmodemTakePreparedInput(rzSession, input), expected);
  sandbox.closeTerminalZmodem(rzSession);
}

for (const invalidCommand of ["sz", "rz remote.log"]) {
  const invalidSent = [];
  const invalidSession = {socket:{readyState:1,send:value => invalidSent.push(value)},commandBuffer:invalidCommand,outputs:[]};
  sandbox.terminalZmodemState(invalidSession).sentry = {};
  assert.equal(sandbox.terminalZmodemPrepareInput(invalidSession, "\r"), false);
  assert.equal(invalidSent.length, 0, `${invalidCommand} must stay in ordinary terminal mode`);
  sandbox.closeTerminalZmodem(invalidSession);
}

const missingSent = [];
const missingSession = {
  key:"terminal-zmodem-missing",
  socket:{readyState:1,send:value => missingSent.push(value)},
  commandBuffer:"sz missing.log",
  outputs:[]
};
sandbox.terminalZmodemState(missingSession).sentry = {consume(){}};
assert.equal(sandbox.terminalZmodemPrepareInput(missingSession, "\r"), false);
const missingOutput = Buffer.from("sz: cannot open missing.log\r\n", "ascii");
assert.equal(sandbox.consumeTerminalZmodemOutput(missingSession, missingOutput.buffer.slice(missingOutput.byteOffset, missingOutput.byteOffset + missingOutput.byteLength)), true);
assert.equal(sandbox.terminalZmodemState(missingSession).armed, false);
assert.equal(JSON.parse(missingSent.at(-1)).enabled, false);
assert.equal(notices.some(item => /文件不存在或无法读取/.test(item.message)), true);
assert.equal(focused.includes(missingSession.key), true, "remote command errors must restore terminal focus");
sandbox.closeTerminalZmodem(missingSession);

let oversizedOfferAccepted = false;
const cappedSession = { outputs:[] };
const cappedState = sandbox.terminalZmodemState(cappedSession);
cappedState.active = true;
cappedState.batchTransferred = 512 * 1024 * 1024 - 1;
cappedState.offer = {
  get_details:() => ({name:"next.bin", size:2}),
  accept:() => { oversizedOfferAccepted = true; }
};
void sandbox.terminalZmodemAcceptOffer(cappedSession, true);
assert.equal(oversizedOfferAccepted, false);
assert.equal(cappedState.batchTransferred, 512 * 1024 * 1024 - 1);

for (const token of ["terminal-binary-mode", "setSessionBinaryMode", "!session.binaryMode", "if (!session.binaryMode) appendTerminalLog"]) {
  assert.equal(terminalSource.includes(token), true, `终端后端缺少 ZMODEM 二进制边界：${token}`);
}
for (const token of ["terminalZmodemPrepareInput", "terminalZmodemTakePreparedInput", "terminalZmodemRzNeedsOverwrite", "consumeTerminalZmodemOutput", "TERMINAL_ZMODEM_MAX_FILE_BYTES", "batchTransferred", "Array(8).fill(24)", "terminalZmodemPrepareSendFiles", "/upload-plan", "chooseSftpUploadConflict", "terminalZmodemSentFileSummary"]) {
  assert.equal(frontendSource.includes(token), true, `终端前端缺少 ZMODEM 边界：${token}`);
}

uploadConflictCheck.then(() => {
  console.log("ZMODEM checks passed: sz/rz detection, collision choice, filename summary, binary mode, and Ctrl+C abort.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
