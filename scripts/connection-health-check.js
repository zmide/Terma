const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-connection-health-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");

const { allConnectionsHealth, diagnoseSshError } = require("../dist/ssh");
const { closeDatabase, insertConnection, run } = require("../dist/db");

const englishErrors = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/locales/en-US/errors.json"), "utf8"));
const healthFrontendContext = vm.createContext({
  tr(key, options={}) {
    const [namespace, resourceKey] = String(key || "").split(":", 2);
    if (namespace === "errors" && typeof englishErrors[resourceKey] === "string") return englishErrors[resourceKey];
    return options.defaultValue || key;
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/app-connection-health.js"), "utf8"), healthFrontendContext, {filename:"public/app-connection-health.js"});
const localizedHealthSshDiagnosis = vm.runInContext("localizedHealthSshDiagnosis", healthFrontendContext);

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
    const handshakeDiagnosis = diagnoseSshError("SSH 握手超时，请检查主机地址、端口和 SSH 服务");
    assert.equal(handshakeDiagnosis.reason_code, "ssh_handshake_timeout");
    const localizedHandshake = localizedHealthSshDiagnosis({
      diagnosis:handshakeDiagnosis,
      raw_output:handshakeDiagnosis.message,
      preserve_raw_output:false
    });
    assert.equal(localizedHandshake, englishErrors.ssh_handshake_timeout);
    assert.doesNotMatch(localizedHandshake, /[\u3400-\u9fff]/, "Terma 固定 SSH 诊断在英文界面不得保留中文");

    const remoteOutput = "远端自定义诊断输出";
    const localizedRemoteFailure = localizedHealthSshDiagnosis({
      diagnosis:diagnoseSshError(remoteOutput),
      raw_output:remoteOutput,
      preserve_raw_output:true
    });
    assert.match(localizedRemoteFailure, /The SSH connection failed/);
    assert.match(localizedRemoteFailure, new RegExp(remoteOutput), "真实 SSH 输出必须保持原文");

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
    console.log("连接健康检查回归通过：固定诊断按错误码翻译，原始输出保留，批量参数错误按服务器隔离");
  } finally {
    closeDatabase();
    fs.rmSync(temporaryRoot, {recursive:true, force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
