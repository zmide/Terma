const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-vnc-clipboard-acceptance-"));
process.env.TUNNELDESK_DATA_DIR = temporaryDataDir;
const { readVncRemoteClipboard, writeVncRemoteClipboard } = require("../dist/vnc-clipboard");
const { runSshCommandForConnection } = require("../dist/ssh");
const { closeDatabase } = require("../dist/db");
const { trustTestHost } = require("./ssh-host-trust-test-helper");

function argument(name, fallback="") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

async function main() {
  if (!process.argv.includes("--confirm-real-vnc-clipboard")) {
    throw new Error("真实 VNC 剪贴板验收需要 --confirm-real-vnc-clipboard");
  }
  const host = argument("--host");
  const user = argument("--user");
  const identity = argument("--identity");
  const port = Number(argument("--port", "22"));
  if (!host || !user || !identity || !Number.isInteger(port)) throw new Error("请提供 --host、--user、--identity 和有效的 --port");

  const profile = { id:1, protocol:"vnc", options:{source_ssh_connection_id:1} };
  const connection = {
    id:1,
    name:"VNC clipboard acceptance",
    ssh_host:host,
    ssh_port:port,
    ssh_user:user,
    auth_type:"key",
    identity_file:path.resolve(identity),
    extra_args:"",
    ssh_agent_mode:"off",
    jump_connection_id:null,
    connect_timeout_seconds:10,
    keepalive_interval_seconds:0,
    keepalive_count_max:3,
    tcp_keepalive:1,
    x11_mode:"off"
  };
  const dependencies = { getConnection:() => connection, runSshCommandForConnection };
  await trustTestHost(connection, "persist");
  const before = await readVncRemoteClipboard(profile, dependencies);
  const marker = `TunnelDesk VNC clipboard acceptance\n中文剪贴板 🙂 ${Date.now()}`;
  let restored = false;
  try {
    const written = await writeVncRemoteClipboard(profile, marker, dependencies);
    const after = await readVncRemoteClipboard(profile, dependencies);
    assert.equal(written.ok, true);
    assert.equal(after.text, marker);
    assert.equal(after.truncated, false);
  } finally {
    if (!before.truncated) {
      await writeVncRemoteClipboard(profile, before.text, dependencies);
      const restoredValue = await readVncRemoteClipboard(profile, dependencies);
      restored = restoredValue.text === before.text;
    }
  }
  assert.equal(restored, true, "验收后未能恢复远端原剪贴板");
  console.log(JSON.stringify({ok:true, transport:"ssh-macos", restored:true}, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(() => {
  try { closeDatabase(); } catch {}
  const resolved = path.resolve(temporaryDataDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolved).startsWith("tunneldesk-vnc-clipboard-acceptance-")) {
    fs.rmSync(resolved, {recursive:true, force:true});
  }
});
