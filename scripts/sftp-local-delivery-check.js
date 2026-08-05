"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-sftp-local-delivery-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, "ssh");

try {
  const session = require(path.join(root, "dist", "sftp-session.js"));
  const targetDirectory = path.join(temporaryRoot, "target");
  fs.mkdirSync(targetDirectory, {recursive:true});
  fs.writeFileSync(path.join(targetDirectory, "same.txt"), "old", "utf8");

  const plan = session.planSftpPathDelivery(["/remote/same.txt", "/remote/new.txt"], targetDirectory);
  assert.deepEqual(plan.items.map(item => [item.name, item.exists]), [["same.txt", true], ["new.txt", false]]);

  const overwriteSource = path.join(temporaryRoot, "overwrite-source.txt");
  fs.writeFileSync(overwriteSource, "new", "utf8");
  session.__replaceLocalEntryFromStage(overwriteSource, path.join(targetDirectory, "same.txt"));
  assert.equal(fs.readFileSync(path.join(targetDirectory, "same.txt"), "utf8"), "new");
  assert.equal(fs.existsSync(overwriteSource), false);
  assert.equal(fs.readdirSync(targetDirectory).some(name => name.startsWith(".tunneldesk-overwrite-")), false);

  const moveSource = path.join(temporaryRoot, "move-source.txt");
  fs.writeFileSync(moveSource, "moved", "utf8");
  session.__moveStagedSftpEntry(moveSource, path.join(targetDirectory, "new.txt"));
  assert.equal(fs.readFileSync(path.join(targetDirectory, "new.txt"), "utf8"), "moved");

  assert.throws(() => session.planSftpPathDelivery([], targetDirectory), /一次最多保存 100 个远程文件或目录/);
  assert.throws(() => session.planSftpPathDelivery(["/remote/a"], "relative"), /本机下载目录无效/);
  console.log("SFTP 本地落盘冲突检查通过：预检、覆盖替换和普通移动正常");
} finally {
  try { require(path.join(root, "dist", "db.js")).closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
