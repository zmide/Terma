const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-connection-health-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");

const { allConnectionsHealth } = require("../dist/ssh");
const { closeDatabase, insertConnection, run } = require("../dist/db");

function connection(name, host, user, port) {
  return {
    name,
    group_name:"健康检查",
    ssh_host:host,
    ssh_port:port,
    ssh_user:user,
    auth_type:"password",
    ssh_password:"test-only-password",
    connect_timeout_seconds:3,
    keepalive_interval_seconds:0,
    keepalive_count_max:3,
    tcp_keepalive:1
  };
}

(async () => {
  try {
    const firstId = insertConnection(connection("生产机 A", "prod-a.test", "root", 22), "");
    const secondId = insertConnection(connection("生产机 B", "prod-b.test", "deploy", 2202), "");
    run("UPDATE connections SET extra_args=? WHERE id IN (?,?)", ["-o ProxyCommand=forbidden", firstId, secondId]);

    const results = await allConnectionsHealth({force:true});
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(item => item.ok), [false, false]);
    assert.deepEqual(results.map(item => item.name), ["生产机 A", "生产机 B"]);
    assert.deepEqual(results.map(item => `${item.ssh_user}@${item.ssh_host}:${item.ssh_port}`), [
      "root@prod-a.test:22",
      "deploy@prod-b.test:2202"
    ]);
    for (const result of results) {
      assert.match(result.ssh.output, /SSH|ProxyCommand|附加参数/);
      assert.ok(Array.isArray(result.ssh.issues));
      assert.ok(result.ssh.issues.length > 0, "参数诊断应保留在对应连接的健康结果中");
    }
    console.log("连接健康检查回归通过：批量参数错误按服务器隔离并返回连接身份");
  } finally {
    closeDatabase();
    fs.rmSync(temporaryRoot, {recursive:true, force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
