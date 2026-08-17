const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "terma-vnc-clipboard-acceptance-"));
process.env.TERMA_DATA_DIR = temporaryDataDir;
const {
  inspectVncRemoteClipboardImage,
  readVncRemoteClipboard,
  readVncRemoteClipboardImage,
  writeVncRemoteClipboard,
  writeVncRemoteClipboardImage
} = require("../dist/vnc-clipboard");
const { runSshCommandForConnection, runSshCommandForConnectionStreaming } = require("../dist/ssh");
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

  const profile = { id:1, protocol:"vnc", host, options:{source_ssh_connection_id:1} };
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
  const dependencies = { getConnection:() => connection, listConnections:() => [connection], runSshCommandForConnection, runSshCommandForConnectionStreaming };
  await trustTestHost(connection, "persist");
  const beforeText = await readVncRemoteClipboard(profile, dependencies);
  const beforeImageMetadata = await inspectVncRemoteClipboardImage(profile, dependencies);
  const beforeImage = beforeImageMetadata.available && !beforeImageMetadata.too_large
    ? await readVncRemoteClipboardImage(profile, dependencies)
    : null;
  if (!beforeImage && (!beforeText.text_available || beforeText.truncated)) {
    throw new Error("远端当前剪贴板无法安全备份，已取消真实写入验收");
  }
  const marker = `Terma VNC clipboard acceptance\n中文剪贴板 🙂 ${Date.now()}`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WltyEMAAAAASUVORK5CYII=", "base64");
  let restored = false;
  try {
    const written = await writeVncRemoteClipboard(profile, marker, dependencies);
    const after = await readVncRemoteClipboard(profile, dependencies);
    assert.equal(written.ok, true);
    assert.equal(after.text, marker);
    assert.equal(after.truncated, false);
    const imageWritten = await writeVncRemoteClipboardImage(profile, png, dependencies);
    const imageMetadata = await inspectVncRemoteClipboardImage(profile, dependencies);
    const imageRead = await readVncRemoteClipboardImage(profile, dependencies);
    const textWhileImage = await readVncRemoteClipboard(profile, dependencies);
    assert.equal(imageWritten.ok, true);
    assert.equal(imageMetadata.available, true);
    assert.equal(imageMetadata.sha256, imageWritten.sha256);
    assert.deepEqual(imageRead.data, png);
    assert.equal(textWhileImage.text_available, false, "PNG selection 不得被文本读取链路接受");
    assert.equal(textWhileImage.text, "", "PNG selection 不得出现 �PNG 文本");
  } finally {
    if (beforeImage) {
      await writeVncRemoteClipboardImage(profile, beforeImage.data, dependencies);
      const restoredValue = await inspectVncRemoteClipboardImage(profile, dependencies);
      restored = restoredValue.sha256 === beforeImageMetadata.sha256;
    } else if (!beforeText.truncated && beforeText.text_available) {
      await writeVncRemoteClipboard(profile, beforeText.text, dependencies);
      const restoredValue = await readVncRemoteClipboard(profile, dependencies);
      restored = restoredValue.text_available && restoredValue.text === beforeText.text;
    }
  }
  assert.equal(restored, true, "验收后未能恢复远端原剪贴板");
  console.log(JSON.stringify({ok:true, transport:beforeText.transport, text:true, image:true, binary_text_guard:true, restored:true}, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(() => {
  try { closeDatabase(); } catch {}
  const resolved = path.resolve(temporaryDataDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolved).startsWith("terma-vnc-clipboard-acceptance-")) {
    fs.rmSync(resolved, {recursive:true, force:true});
  }
});
