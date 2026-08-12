const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

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
  async listRemoteDir(_connectionId, _parent, options={}) {
    const name = String(options.query || "fixture.txt");
    return {entries:[{name, type:"file", size:remoteContent.length, mtime:remoteMtime}]};
  },
  async readRemoteBinaryFile() {
    return {content:Buffer.from(remoteContent)};
  },
  async writeRemoteFile(_connectionId, _remotePath, content) {
    writes += 1;
    remoteContent = Buffer.from(content);
    remoteMtime += 1;
    return {ok:true, backup_path:`/tmp/fixture.txt.bak-${writes}`};
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
  console.log("SFTP external edit confirmation check passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
  try { fs.rmSync(root, {recursive:true, force:true}); } catch {}
});
