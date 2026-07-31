"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-terminal-log-session-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, ".ssh");

const logs = require("../dist/logs");
const database = require("../dist/db");

try {
  const connection = {name:"日志测试机", ssh_user:"root", ssh_host:"example.invalid", ssh_port:22};
  const startedAt = Date.now() - 1000;
  const firstId = `${startedAt}-abcdefgh12345678`;
  const secondId = `${startedAt}-ijklmnop12345678`;
  const first = logs.createTerminalLog(connection, "日志测试机 · 终端", firstId);
  const reconnect = logs.createTerminalLog(connection, "日志测试机 · 终端", firstId);
  const second = logs.createTerminalLog(connection, "日志测试机 · 终端", secondId);

  assert.equal(first.fullPath, reconnect.fullPath);
  assert.notEqual(first.fullPath, second.fullPath);
  const terminalDirectory = path.dirname(first.fullPath);
  assert.equal(fs.readdirSync(terminalDirectory).filter(name => name.endsWith(".log")).length, 2);

  const body = fs.readFileSync(first.fullPath, "utf8");
  assert.equal((body.match(/^# 开始时间：/gm) || []).length, 1);
  assert.equal((body.match(/^# 重新连接时间：/gm) || []).length, 1);

  const listed = logs.listLogs().connections.flatMap(item => item.logs);
  assert.equal(listed.length, 2);
  assert.ok(listed.every(item => !item.label.includes("abcdefgh12345678") && !item.label.includes("ijklmnop12345678")));
  console.log("Terminal log session reuse checks passed.");
} finally {
  try { database.closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
