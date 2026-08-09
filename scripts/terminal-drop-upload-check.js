const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const terminal = readFrontendDomain(root, "terminal");
const sftp = readFrontendDomain(root, "sftp");
const backend = fs.readFileSync(path.join(root, "src", "sftp.ts"), "utf8");
const jobs = fs.readFileSync(path.join(root, "src", "sftp-jobs.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server.ts"), "utf8");
const desktop = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");

function frontendFunction(name) {
  let start = terminal.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `未找到前端函数 ${name}`);
  if (terminal.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const next = [
    terminal.indexOf("\nfunction ", start + 1),
    terminal.indexOf("\nasync function ", start + 1)
  ].filter(index => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  return terminal.slice(start, next < 0 ? terminal.length : next).trim();
}

const trackedDirectoryCommands = [];
const terminalCommandHarness = new Function(
  "saveRecentTerminalCommand",
  "currentConnection",
  "trackTerminalDirectoryCommand",
  "activeTabKey",
  `"use strict";
${frontendFunction("cleanTerminalCommandText")}
${frontendFunction("currentTerminalPromptCommand")}
${frontendFunction("trackTerminalCommand")}
return {currentTerminalPromptCommand, trackTerminalCommand};`
)(
  () => {},
  id => ({id}),
  (_session, _connection, _key, command) => trackedDirectoryCommands.push(command),
  "terminal-active"
);

function promptSession(line) {
  return {
    id:1,
    key:"terminal-1",
    term:{
      buffer:{
        active:{
          baseY:0,
          cursorY:0,
          getLine:() => ({translateToString:() => line})
        }
      }
    }
  };
}

for (const line of [
  "root@linux:/tmp# cd Downloads",
  "user@linux:~$ cd Downloads",
  "tester@fixture-mac ~ % cd Downloads",
  "PS C:\\\\Users\\\\tester> cd Downloads"
]) {
  assert.equal(terminalCommandHarness.currentTerminalPromptCommand(promptSession(line)), "cd Downloads");
}

const zshTabCompletionSession = promptSession("tester@fixture-mac ~ % cd Downloads");
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "cd Down");
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "\t");
assert.equal(zshTabCompletionSession.commandBuffer, "", "Tab 补全后命令缓冲应清空并改从当前终端行读取");
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "\r");
assert.deepEqual(trackedDirectoryCommands, ["cd Downloads"]);

const probedDirectories = [];
const directoryTrackingHarness = new Function(
  "probeTerminalDirectory",
  `"use strict";
${frontendFunction("normalizeTerminalDirectoryPath")}
${frontendFunction("joinTerminalDirectoryPath")}
${frontendFunction("cleanTerminalCommandText")}
${frontendFunction("parseTerminalDirectoryCommand")}
${frontendFunction("trackTerminalDirectoryCommand")}
return {trackTerminalDirectoryCommand};`
)(
  (_session, _connection, directory) => probedDirectories.push(directory)
);
directoryTrackingHarness.trackTerminalDirectoryCommand(
  {currentDirectory:"/Users/tester", homeDirectory:"/Users/tester"},
  {id:1},
  "terminal-1",
  trackedDirectoryCommands[0]
);
assert.deepEqual(probedDirectories, ["/Users/tester/Downloads"]);

assert.match(terminal, /registerOscHandler\(7/);
assert.match(terminal, /initializeTerminalDirectory/);
assert.match(terminal, /trackTerminalDirectoryCommand/);
assert.match(terminal, /const markers = \[[^\]]*"% "/);
assert.match(terminal, /bindTerminalDropUpload/);
assert.match(terminal, /collectDroppedFiles/);
assert.match(terminal, /uploadSftpFilesToDirectory\(files, connection\.id, directory\)/);
assert.match(terminal, /terminalSftpDragPayload/);
assert.match(terminal, /copySftpDraggedItemsToDirectory\(drag, connection\.id, directory/);
assert.match(terminal, /setTerminalDropState\(session, true, drag \? "copy" : "upload"\)/);
assert.match(terminal, /focusSftpDragFeedbackTarget\("terminal", session\?\.key, session\)/);
assert.match(terminal, /releaseSftpDragFeedbackTarget\("terminal", session\?\.key, session\)/);
assert.match(terminal, /session\.terminalDropDepth = 1/);
assert.doesNotMatch(terminal, /已上传 \$\{files\.length\} 项到/);
assert.match(terminal, /terminal-drop-overlay/);
assert.match(sftp, /async function uploadSftpFilesToDirectory/);
assert.match(sftp, /async function copySftpDraggedItemsToDirectory/);
assert.match(sftp, /target_connection_id:Number\(targetConnectionId\)/);
assert.match(sftp, /target\.kind === "terminal"/);
assert.match(sftp, /sourceTabKey:request\.sourceTabKey/);
assert.match(sftp, /function focusSftpDragFeedbackTarget/);
assert.match(sftp, /function releaseSftpDragFeedbackTarget/);
assert.match(sftp, /focusSftpDragFeedbackTarget\("sftp", tabKey\)/);
assert.match(sftp, /item\.name \|\| item\.filename \|\| "未命名项目"/);
assert.match(sftp, /createRemoteUploadDirectories\(Number\(connectionId\), directory, files\)/);
assert.match(sftp, /conflict:conflict \|\| "error"/);
assert.match(backend, /conflict !== "rename"/);
assert.match(backend, /return `\$\{base\} \(\$\{index\}\)\$\{extension\}`/);
assert.match(server, /\["overwrite", "rename"\]/);
assert.match(jobs, /const sameConnection = Number\(sourceConnectionId\) === Number\(targetConnectionId\)/);
assert.match(jobs, /不能把远端项目复制到自身或其子目录/);
assert.doesNotMatch(jobs, /跨主机复制必须选择不同的源连接和目标连接/);
assert.match(preload, /sourceTabKey:String\(payload\?\.sourceTabKey/);
assert.match(desktop, /const kind = value\.kind === "terminal"/);
assert.match(desktop, /sourceTabKey:String\(payload\?\.sourceTabKey/);
assert.match(css, /\.terminal-drop-overlay/);
assert.match(css, /\.terminal-drop-hint/);

console.log("终端拖入上传检查通过：目录跟踪、递归上传、SFTP 内部复制、重名策略和拖入反馈");
