const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSftpJobSource, readSources } = require("./backend-source");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const terminal = readFrontendDomain(root, "terminal");
const backend = fs.readFileSync(path.join(root, "src", "sftp.ts"), "utf8");
const jobs = readSftpJobSource(root);
const server = readSources(root, ["src/server.ts", "src/routes/sftp-transfer-routes.ts"]);
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
const recordedCommands = [];
const { createTerminalCommandTrackingService } = loadFrontendService(
  "frontend/src/features/terminal/terminal-command-tracking-service.ts"
);
const {terminalPromptStateAtRow,currentTerminalPromptCommand}=loadFrontendService('frontend/src/features/terminal/terminal-prompt.ts');
const tracking=createTerminalCommandTrackingService({
 promptStateAtRow:terminalPromptStateAtRow,
 saveRecentCommand:command=>recordedCommands.push(command),
 connectionForSession:session=>({id:session.id}),
 trackDirectoryCommand:(_session,_connection,_key,command)=>trackedDirectoryCommands.push(command),
 activeTabKey:()=> 'terminal-active'
});
const terminalCommandHarness={currentTerminalPromptCommand,finalizePendingTerminalCommand:tracking.finalizePendingCommand,trackTerminalCommand:tracking.trackCommand};

function promptSession(line, cursorX=String(line).length) {
  const session = {
    id:1,
    key:"terminal-1",
    promptLine:String(line),
    term:{
      buffer:{
        active:{
          baseY:0,
          cursorY:0,
          cursorX,
          getLine:() => ({translateToString:() => session.promptLine})
        }
      }
    }
  };
  return session;
}

for (const line of [
  "root@linux:/tmp# cd Downloads",
  "user@linux:~$ cd Downloads",
  "tester@fixture-mac ~ % cd Downloads",
  "PS C:\\\\Users\\\\tester> cd Downloads",
  "hx1-tcm1{ha2}[3]: cd Downloads"
]) {
  assert.equal(terminalCommandHarness.currentTerminalPromptCommand(promptSession(line)), "cd Downloads");
}

const zshTabCompletionSession = promptSession("tester@fixture-mac ~ % cd Down");
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "cd Down");
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "\t");
zshTabCompletionSession.promptLine = "tester@fixture-mac ~ % cd Downloads";
zshTabCompletionSession.term.buffer.active.cursorX = zshTabCompletionSession.promptLine.length;
terminalCommandHarness.trackTerminalCommand(zshTabCompletionSession, "\r");
assert.equal(zshTabCompletionSession.commandBuffer, "", "Tab 补全提交后命令缓冲应清空");
assert.deepEqual(trackedDirectoryCommands, ["cd Downloads"]);
assert.deepEqual(recordedCommands, ["cd Downloads"]);

const historyEditSession = promptSession("hx1-tcm1{ha2}[3]: ");
terminalCommandHarness.trackTerminalCommand(historyEditSession, "\x1b[A");
historyEditSession.promptLine = "hx1-tcm1{ha2}[3]: tail -F | grep 45-03-37";
historyEditSession.term.buffer.active.cursorX = historyEditSession.promptLine.length;
terminalCommandHarness.trackTerminalCommand(historyEditSession, "\x1b[D");
historyEditSession.term.buffer.active.cursorX = historyEditSession.promptLine.indexOf("| grep");
terminalCommandHarness.trackTerminalCommand(historyEditSession, "cchmsg45 ");
terminalCommandHarness.trackTerminalCommand(historyEditSession, "\r");
assert.equal(recordedCommands.at(-1), "tail -F cchmsg45 | grep 45-03-37", "方向键召回并在中间插入文本后应记录完整命令");

const probedDirectories = [];
const {createTerminalDirectoryService} = loadFrontendService("frontend/src/features/terminal/terminal-directory-service.ts");
const directoryTrackingHarness = createTerminalDirectoryService({
  current: () => true,
  resolve: async (_id, directory) => { probedDirectories.push(directory); return {path:directory}; },
  remember: () => {},
  startup: () => ({}),
  clean: command => command.trim(),
  text: key => key
});
directoryTrackingHarness.track(
  {currentDirectory:"/Users/tester", homeDirectory:"/Users/tester"},
  {id:1},
  "terminal-1",
  trackedDirectoryCommands[0]
);
assert.deepEqual(probedDirectories, ["/Users/tester/Downloads"]);
const shellSession = {socket:{},connectionAttempt:1};
let confirmedNotifications = 0;
const stopConfirmed = directoryTrackingHarness.subscribe(() => confirmedNotifications++);
assert.equal(directoryTrackingHarness.confirmed(shellSession), '');
directoryTrackingHarness.set(shellSession, '/typed-only', 'cd');
assert.equal(directoryTrackingHarness.confirmed(shellSession), '', 'typed cd is not shell confirmation');
directoryTrackingHarness.set(shellSession, '/shell-confirmed', 'osc7');
assert.equal(directoryTrackingHarness.confirmed(shellSession), '/shell-confirmed');
directoryTrackingHarness.set(shellSession, '/another-guess', 'cd');
assert.equal(directoryTrackingHarness.confirmed(shellSession), '/shell-confirmed', 'guesses cannot overwrite last confirmed directory');
shellSession.socket = {};
assert.equal(directoryTrackingHarness.confirmed(shellSession), '', 'new transport invalidates previous confirmation');
directoryTrackingHarness.set(shellSession, '/reconnected', 'osc7');
shellSession.connectionAttempt++;
assert.equal(directoryTrackingHarness.confirmed(shellSession), '', 'new attempt invalidates previous confirmation');
assert.equal(confirmedNotifications, 4);
stopConfirmed();

assert.match(fs.readFileSync("frontend/src/features/terminal/terminal-directory-service.ts", "utf8"), /registerOscHandler\(7/);
const directoryWorkspace = fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-directory-workspace.ts'),'utf8');
const dropWorkspaceSource = fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-drop-workspace.ts'),'utf8');
const imageWorkspaceSource = fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-image-workspace.ts'),'utf8');
assert.match(dropWorkspaceSource, /terminalDirectory\.initialize/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-command-tracking-service.ts'),'utf8'), /terminalDirectory\.track/);
assert.match(imageWorkspaceSource, /terminalDirectory\.initialize/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-prompt.ts'),'utf8'), /const markers = \[[^\]]*"% "/);
const dropWorkspace=fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-drop-workspace.ts'),'utf8');
const dropService=fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-drop-service.ts'),'utf8');
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-surface-workspace.ts'),'utf8'),/terminalDrop\.bind\(session,mount\)/);
assert.match(dropWorkspace,/termaSftpDragWorkspace\.collect/);
assert.match(dropWorkspace,/controller\.submit\(files,id,path,\{tabKey:key,isCurrent:valid\}/);
assert.match(dropWorkspace,/terminalSessions\.get\(session\.key\)===session/);
assert.match(dropWorkspace,/connectionStamp\(connection\)===connectionStamp\(session\.connection\)/);
assert.match(dropService,/terminal:drop\.sftp_login_identity_hint/);
assert.match(dropService,/terminal:drop\.upload_failed_identity_hint/);
assert.match(dropWorkspace,/drag\.source\.active/);
assert.match(dropWorkspace,/destinations\.directory\(drag,id,path/);
assert.match(dropWorkspace,/dropFeedback\.focus\('terminal',session\.key,session\)/);
assert.match(dropWorkspace,/dropFeedback\.release\('terminal',session\.key,session\)/);
assert.match(dropService,/session\.terminalDropDepth=1/);
assert.match(dropService,/terminal-drop-overlay/);
assert.doesNotMatch(dropService,/已上传 \$\{files\.length\} 项到/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/drag-destinations.ts'),'utf8'), /async function directory\(drag:BrowserDrag,id:number,path:string/);
const copyServiceSource = fs.readFileSync(path.join(root, 'frontend/src/features/files/sftp/sftp-copy-service.ts'), 'utf8');
assert.match(copyServiceSource, /target_connection_id: port\.connectionId/);
const dragWorkspace=fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/drag-workspace.ts'),'utf8');
assert.match(dragWorkspace, /termaSftpFileActions\.copy\.copy/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/drag-destinations.ts'),'utf8'), /tab\.kind\s*===\s*['"]terminal['"]/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/native-drag-runtime.ts'),'utf8'), /port\.adapter\(\)\.start\(mode,id,request\.entries,request\.files,request\.sourceTabKey,requestId\)/);
const nativeDragSource = fs.readFileSync(path.join(root, 'frontend/src/features/files/sftp/native-drag-adapter.ts'), 'utf8');
assert.match(nativeDragSource, /bridge\.startSftpDrag\(requested === 'streaming' \? \{ \.\.\.snapshot, sourceTabKey \}/);
assert.match(dragWorkspace, /createDropFeedback\(\{/);
assert.match(dragWorkspace, /createBrowserDropRuntime\(\{/);
assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/drop-feedback.ts'),'utf8'),/focus\('sftp',key\)/);
const conflictPrompts=fs.readFileSync(path.join(root,'frontend/src/features/files/file-conflict-prompts.ts'),'utf8');
assert.match(fs.readFileSync(path.join(root, 'frontend/src/features/terminal/terminal-zmodem-workspace.ts'), 'utf8'),
  /termaSftpTransfers\.conflicts\.upload\(items\)/);
assert.match(conflictPrompts, /item\.name\s*\|\|\s*item\.filename\s*\|\|\s*port\.text\('sftp:transfer\.unnamed_item'\)/);
assert.doesNotMatch(conflictPrompts, /item\.name\s*\|\|\s*item\.filename\s*\|\|\s*['"]未命名项目['"]/);
const transferWorkspace=fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/transfer-workspace.ts'),'utf8');
assert.match(transferWorkspace, /prepareSftpUploadDirectories\(\{/);
const transferControllerSource=fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/transfer-controller.ts'),'utf8');
assert.match(transferControllerSource,/port\.directories\(id, directory, items, directories, current\)/);
assert.match(transferWorkspace, /downloads, uploads,/);
const uploadQueueSource = fs.readFileSync(path.join(root, 'frontend/src/features/files/sftp/sftp-upload-service.ts'), 'utf8');
assert.match(uploadQueueSource, /uploads\.push\(\{ item, started \}\)/);
assert.ok(uploadQueueSource.indexOf('/sftp/upload-job') < uploadQueueSource.indexOf('sending = true'), '所有拖入文件先创建任务再上传内容');
assert.match(uploadQueueSource, /Promise\.allSettled\(uploads\.map/);
assert.match(uploadQueueSource, /!sending\) await cancelCreated\(\)/, '创建失败回收尚未发送的任务');
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

console.log("终端拖入上传检查通过：目录跟踪、SFTP 登录身份提示、递归上传、内部复制、重名策略和拖入反馈");
