const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const clipboard = require(path.join(path.resolve(__dirname, ".."), "dist", "vnc-clipboard"));
const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
const profile = {id:8, protocol:"vnc", host:"linux.test", options:{source_ssh_connection_id:74}};
const connection = {id:74, ssh_host:"linux.test", ssh_port:22, ssh_user:"operator"};
let detectionCalls = 0;
const commands = [];
const metadataCommands = [];
const dependencies = {
  listConnections:() => [connection],
  getConnection:id => Number(id) === 74 ? connection : null,
  async runSshCommandForConnection(_connection, command) {
    detectionCalls += 1;
    const encoded = /terma_payload=([A-Za-z0-9+/=]+);/.exec(String(command))?.[1] || "";
    const script = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    if (script.includes("TERMA_IMAGE_SHA256")) {
      metadataCommands.push(script);
      return {status:0, stdout:`TERMA_IMAGE_AVAILABLE=1\nTERMA_IMAGE_TOO_LARGE=0\nTERMA_IMAGE_BYTES=${png.length}\nTERMA_IMAGE_SHA256=${crypto.createHash("sha256").update(png).digest("hex")}\n`, stderr:""};
    }
    return {status:0, stdout:"TERMA_VNC_CLIPBOARD_MODE=linux-x11\nTERMA_VNC_CLIPBOARD_TOOL=xclip\nTERMA_VNC_CLIPBOARD_OS=Linux\nTERMA_VNC_CLIPBOARD_PACKAGE_MANAGER=apt\nTERMA_VNC_CLIPBOARD_ROOT=true\n", stderr:""};
  },
  async runSshCommandForConnectionStreaming(_connection, command, _timeout, onChunk, options) {
    commands.push({command, options});
    const encoded = /terma_payload=([A-Za-z0-9+/=]+);/.exec(String(command))?.[1] || "";
    const script = Buffer.from(encoded, "base64").toString("utf8");
    if (!script.includes("TERMA_VNC_CLIPBOARD_IMAGE_READY")) {
      onChunk(png, "stdout");
      return {status:0, stdout:"", stderr:""};
    }
    onChunk(Buffer.from("TERMA_VNC_CLIPBOARD_IMAGE_READY\n"), "stdout");
    return {status:0, stdout:"", stderr:""};
  }
};

(async () => {
  clipboard.clearVncClipboardCapabilityCache();
  await assert.rejects(
    () => clipboard.writeVncRemoteClipboardImage({...profile, host:"other.test"}, png, dependencies),
    /主机不一致/,
    "VNC 图片剪贴板不得借用其他主机的 SSH 管理连接"
  );
  const written = await clipboard.writeVncRemoteClipboardImage(profile, png, dependencies);
  assert.equal(written.ok, true);
  assert.equal(written.sha256, crypto.createHash("sha256").update(png).digest("hex"));
  assert.deepEqual(commands[0].options.input, png);
  const writeScript = Buffer.from(/terma_payload=([A-Za-z0-9+/=]+);/.exec(commands[0].command)[1], "base64").toString("utf8");
  assert.match(writeScript, /xclip -selection clipboard -target image\/png -silent -i/);
  assert.doesNotMatch(writeScript, /kill \"\$td_clip_pid\"/);

  const read = await clipboard.readVncRemoteClipboardImage(profile, dependencies);
  assert.deepEqual(read.data, png);
  assert.equal(read.bytes, png.length);
  const readScript = Buffer.from(/terma_payload=([A-Za-z0-9+/=]+);/.exec(commands.at(-1).command)[1], "base64").toString("utf8");
  assert.match(readScript, /xclip -selection clipboard -target TARGETS -o/);
  assert.match(readScript, /grep -Fx -- 'image\/png'/);
  assert.match(readScript, /head -c 26214401/, "远端图片读取必须在写入临时文件时限制大小");
  const metadata = await clipboard.inspectVncRemoteClipboardImage(profile, dependencies);
  assert.equal(metadata.available, true);
  assert.equal(metadata.bytes, png.length);
  assert.equal(metadata.sha256, written.sha256);
  assert.match(metadataCommands[0], /sha256sum/);
  assert.match(metadataCommands[0], /TERMA_IMAGE_AVAILABLE=0/);
  assert.match(metadataCommands[0], /head -c 26214401/);
  assert.ok(detectionCalls >= 1);
  assert.throws(() => clipboard.validateVncClipboardImage(Buffer.from("bad")), /有效的 PNG/);
  assert.throws(() => clipboard.validateVncClipboardImage(Buffer.alloc(25 * 1024 * 1024 + 1)), /25 MB/);
  console.log("VNC 图片剪贴板检查通过：PNG 校验、流式上传、远端读取和 xclip 持有脚本均有效");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
