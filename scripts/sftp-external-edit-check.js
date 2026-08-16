const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-external-edit-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");

let remoteContent = Buffer.from("original\n");
let remoteMtime = 100;
let writes = 0;
const connection = {id:88001, name:"external-edit-check"};
const sftpMock = {
  decodeRemoteText(buffer) {
    return {content:Buffer.from(buffer).toString("utf8"), encoding:"UTF-8"};
  },
  invalidateRemoteDirectoryCache() {},
  async listRemoteDir() {
    throw new Error("external edit metadata must not scan the whole remote directory");
  },
  async readRemoteBinaryFile() {
    return {content:Buffer.from(remoteContent)};
  },
  async readRemoteFileMetadata() {
    return {size:remoteContent.length, mtime:remoteMtime};
  },
  async writeRemoteFile(_connectionId, _remotePath, content, options={}) {
    writes += 1;
    remoteContent = Buffer.from(content);
    remoteMtime += 1;
    return {ok:true, backup_path:options.backup ? `/tmp/fixture.txt.bak-${writes}` : null};
  }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename?.endsWith(`${path.sep}sftp-external-edit.js`)) {
    if (request === "./sftp") return sftpMock;
    if (request === "./sftp-session") return {getSftpConnection:() => connection};
  }
  return originalLoad.call(this, request, parent, isMain);
};

function waitForStatus(service, id, expected) {
  const deadline = Date.now() + 5000;
  return new Promise((resolve, reject) => {
    const check = () => {
      const session = service.getExternalEdit(id);
      if (session.status === expected) return resolve(session);
      if (Date.now() >= deadline) return reject(new Error(`external edit did not reach ${expected}: ${session.status}`));
      setTimeout(check, 50);
    };
    check();
  });
}

async function main() {
  const service = require("../dist/sftp-external-edit");
  Module._load = originalLoad;
  const session = await service.startExternalEdit(connection.id, "/tmp/fixture.txt", {open:async () => {}});
  try {
    fs.writeFileSync(session.local_path, "local change\n");
    const modified = await waitForStatus(service, session.id, "modified");
    assert.match(modified.message, /等待确认是否保存/);
    assert.equal(writes, 0, "saving in the external editor must not upload before confirmation");

    const saved = await service.resolveExternalEdit(session.id, "save");
    assert.equal(saved.status, "synced");
    assert.equal(writes, 1);
    assert.equal(remoteContent.toString("utf8"), "local change\n");

    remoteContent = Buffer.from("remote change\n");
    remoteMtime += 1;
    fs.writeFileSync(session.local_path, "second local change\n");
    const conflict = await waitForStatus(service, session.id, "conflict");
    assert.match(conflict.message, /远程文件在编辑期间已变化/);
    assert.equal(writes, 1, "a remote conflict must not be overwritten automatically");
    assert.equal(conflict.can_compare, true);

    const comparison = await service.getExternalEditComparison(session.id);
    assert.equal(comparison.old_text, "remote change\n");
    assert.equal(comparison.new_text, "second local change\n");
    assert.equal(comparison.remote_path, "/tmp/fixture.txt");

    const overwritten = await service.resolveExternalEdit(session.id, "overwrite");
    assert.equal(overwritten.status, "synced");
    assert.equal(overwritten.last_backup_path, "/tmp/fixture.txt.bak-2");
    assert.equal(writes, 2);
    assert.equal(remoteContent.toString("utf8"), "second local change\n");
  } finally {
    service.stopAllExternalEdits();
  }
  remoteContent = Buffer.from("auto original\n");
  remoteMtime += 1;
  const automatic = await service.startExternalEdit(connection.id, "/tmp/automatic.txt", {
    open:async () => {},
    saveRule:"overwrite",
    backupOnAutoSave:false
  });
  try {
    fs.writeFileSync(automatic.local_path, "automatic local change\n");
    const synced = await waitForStatus(service, automatic.id, "synced");
    assert.equal(synced.last_backup_path, "");
    assert.equal(remoteContent.toString("utf8"), "automatic local change\n");
    assert.match(synced.message, /自动覆盖远程文件/);
  } finally {
    service.stopAllExternalEdits();
  }
  await checkFrontendPromptQueue();
  console.log("SFTP external edit confirmation check passed.");
}

async function checkFrontendPromptQueue() {
  const promptMessages = [];
  const promptResolvers = [];
  const resolvedSessionIds = [];
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app-sftp-sync.js"), "utf8");
  const context = {
    api:async url => {
      const match = String(url).match(/\/api\/sftp\/external-edits\/([^/]+)\/resolve$/);
      if (!match) throw new Error(`unexpected frontend queue request: ${url}`);
      resolvedSessionIds.push(match[1]);
      return {id:match[1], status:"synced", message:"fixture saved", connection_id:0, remote_path:`/tmp/${match[1]}.txt`};
    },
    chooseModal:(_title, message) => new Promise(resolve => {
      promptMessages.push(message);
      promptResolvers.push(resolve);
    }),
    tr:(key, options={}) => options.defaultValue || key,
    notify() {},
    inputModal:async () => "",
    queueSftpDirectoryRefresh() {},
    flushPendingSftpDirectoryRefresh() {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    console
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__externalEditQueueTest={productivityState,promptSftpExternalEdit};`, context, {filename:"app-sftp-sync.js"});
  const {productivityState, promptSftpExternalEdit} = context.__externalEditQueueTest;
  const firstPrompt = promptSftpExternalEdit({id:"queue-one", status:"modified", updated_at:1, connection_name:"fixture", remote_path:"/tmp/one.txt", can_compare:false});
  await promptSftpExternalEdit({id:"queue-two", status:"modified", updated_at:2, connection_name:"fixture", remote_path:"/tmp/two.txt", can_compare:false});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(promptMessages.length, 1, "the second external edit must wait for the first prompt");
  assert.equal(productivityState.externalEditPromptQueue.length, 1);
  promptResolvers.shift()("save");
  for (let attempt = 0; attempt < 20 && promptResolvers.length === 0; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(promptMessages.length, 2, "the second prompt must open after the first resolves");
  assert.deepEqual(resolvedSessionIds, ["queue-one"]);
  promptResolvers.shift()("save");
  await firstPrompt;
  assert.match(promptMessages[0], /\/tmp\/one\.txt/);
  assert.match(promptMessages[1], /\/tmp\/two\.txt/);
  assert.deepEqual(resolvedSessionIds, ["queue-one", "queue-two"]);
  assert.equal(productivityState.externalEditPromptQueue.length, 0);
  assert.equal(productivityState.externalEditPrompts.size, 0);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
  try { fs.rmSync(root, {recursive:true, force:true}); } catch {}
});
