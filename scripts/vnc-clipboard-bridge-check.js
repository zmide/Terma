const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_CLIPBOARD_BYTES,
  buildClipboardDetectionScript,
  clearVncClipboardCapabilityCache,
  detectVncClipboardBridge,
  inspectVncClipboardHelper,
  parseClipboardDetection,
  readVncRemoteClipboard,
  vncClipboardHelperGuideResult,
  vncClipboardHelperInstallPlan,
  writeVncRemoteClipboard
} = require("../dist/vnc-clipboard");
const root = path.resolve(__dirname, "..");
const englishRemote = JSON.parse(fs.readFileSync(path.join(root, "public", "locales", "en-US", "remote.json"), "utf8"));
const chineseRemote = JSON.parse(fs.readFileSync(path.join(root, "public", "locales", "zh-CN", "remote.json"), "utf8"));
const legacyPrefix = ["T", "D"].join("");

const detectionScript = buildClipboardDetectionScript(5900);
assert.match(detectionScript, /td_is_local_display/);
assert.match(detectionScript, /SSH X11-forwarded processes/);
assert.match(detectionScript, /td_is_local_display "\$td_candidate_display" \|\| td_candidate_display=""/);
assert.ok(detectionScript.includes("TERMA_VNC_CLIPBOARD_"));
assert.equal(detectionScript.includes(`${legacyPrefix}_VNC_CLIPBOARD_`), false);
assert.equal(parseClipboardDetection(`${legacyPrefix}_VNC_CLIPBOARD_MODE=macos\n${legacyPrefix}_VNC_CLIPBOARD_OS=Darwin`, 73).available, true);

function decodeRemotePosixPayload(command) {
  const encoded = /terma_payload=([A-Za-z0-9+/=]+);/.exec(String(command || ""))?.[1] || "";
  return Buffer.from(encoded, "base64").toString("utf8");
}

async function main() {
  const profile = {id:7, protocol:"vnc", host:"mac.test", options:{source_ssh_connection_id:73}};
  const connection = {id:73, ssh_host:"mac.test", ssh_port:22, ssh_user:"tester"};
  const commands = [];
  const text = "Terma macOS VNC clipboard 中文\n第二行 😀";
  const encoded = Buffer.from(text, "utf8").toString("base64");
  let step = 0;
  const dependencies = {
    listConnections:() => [connection],
    getConnection(id) {
      assert.equal(id, 73);
      return connection;
    },
    async runSshCommandForConnection(receivedConnection, command) {
      assert.equal(receivedConnection, connection);
      commands.push(command);
      step += 1;
      if (step === 1) return {status:0, stdout:"TERMA_VNC_CLIPBOARD_MODE=macos\nTERMA_VNC_CLIPBOARD_TOOL=pbcopy\nTERMA_VNC_CLIPBOARD_OS=Darwin\n", stderr:""};
      if (step === 2) return {status:0, stdout:`TERMA_SIZE=${Buffer.byteLength(text)}\nTERMA_DATA=${encoded}\n`, stderr:""};
      return {status:0, stdout:"", stderr:""};
    }
  };

  clearVncClipboardCapabilityCache();
  const capability = await detectVncClipboardBridge(profile, dependencies);
  assert.equal(capability.available, true);
  assert.equal(capability.transport, "ssh-macos");
  assert.equal(capability.platform, "macos");

  const macPlan = vncClipboardHelperInstallPlan(capability);
  assert.equal(macPlan.online.available, false);
  assert.equal(macPlan.local_offline.available, false);
  assert.equal(macPlan.manual.available, true);
  assert.equal(macPlan.uninstall.available, false, "macOS 不应提供剪贴板辅助卸载");
  assert.match(macPlan.uninstall.reason, /pbcopy\/pbpaste/);

  const read = await readVncRemoteClipboard(profile, dependencies);
  assert.equal(read.text, text);
  assert.deepEqual(Buffer.from(read.text, "utf8"), Buffer.from(text, "utf8"));
  assert.equal(read.truncated, false);

  const written = await writeVncRemoteClipboard(profile, text, dependencies);
  assert.equal(written.ok, true);
  assert.equal(written.bytes, Buffer.byteLength(text));
  assert.equal(commands.some(command => command.includes(text)), false, "远端命令不得包含明文剪贴板内容");
  const remoteScripts = commands.map(decodeRemotePosixPayload);
  const readScript = remoteScripts.find(script => script.includes("/usr/bin/pbpaste -Prefer txt")) || "";
  const writeScript = remoteScripts.find(script => script.includes("/usr/bin/base64 -D") && script.includes("/usr/bin/pbcopy")) || "";
  assert.match(readScript, /\/usr\/bin\/pbpaste -Prefer txt/);
  assert.match(readScript, /\/usr\/bin\/base64/);
  assert.match(writeScript, /\/usr\/bin\/base64 -D \| (?:env )?LANG=en_US\.UTF-8 LC_CTYPE=UTF-8 \/usr\/bin\/pbcopy/);
  assert.ok(writeScript.includes(encoded), "macOS 写入脚本必须只携带 UTF-8 Base64 数据");
  assert.equal(writeScript.includes(text), false, "解码后的远端脚本也不得包含剪贴板明文");
  assert.ok(readScript.includes("LANG=en_US.UTF-8 LC_CTYPE=UTF-8 /usr/bin/pbpaste"), "macOS 读取剪贴板必须显式使用 UTF-8 locale");
  assert.ok(writeScript.includes("LANG=en_US.UTF-8 LC_CTYPE=UTF-8 /usr/bin/pbcopy"), "macOS 写入剪贴板必须显式使用 UTF-8 locale");

  await assert.rejects(
    () => writeVncRemoteClipboard(profile, "x".repeat(MAX_CLIPBOARD_BYTES + 1), dependencies),
    /超过 32 KiB/
  );

  clearVncClipboardCapabilityCache();
  let automaticallyMatchedId = 0;
  const autoProfile = {id:9, protocol:"vnc", host:"MAC.TEST", username:"tester", options:{}};
  const autoCapability = await detectVncClipboardBridge(autoProfile, {
    getConnection:id => {
      automaticallyMatchedId = Number(id);
      return connection;
    },
    listConnections:() => [
      {id:91, name:"Other host", ssh_host:"other.test", ssh_port:22, ssh_user:"tester"},
      connection
    ],
    runSshCommandForConnection:async () => ({status:0, stdout:"TERMA_VNC_CLIPBOARD_MODE=macos\nTERMA_VNC_CLIPBOARD_TOOL=pbcopy\nTERMA_VNC_CLIPBOARD_OS=Darwin\n", stderr:""})
  });
  assert.equal(automaticallyMatchedId, 73, "按主机唯一匹配后应读取完整 SSH 凭据");
  assert.equal(autoCapability.available, true);
  assert.equal(autoCapability.connection_id, 73);
  assert.equal(autoCapability.resolved_by, "host");

  clearVncClipboardCapabilityCache();
  const noMatch = await detectVncClipboardBridge({id:10, protocol:"vnc", host:"missing.test", options:{}}, {
    getConnection:() => null,
    listConnections:() => [connection],
    runSshCommandForConnection:async () => ({status:1, stderr:"must not run"})
  });
  assert.equal(noMatch.available, false);
  assert.match(noMatch.reason, /没有找到同主机的 SSH 管理连接/);

  clearVncClipboardCapabilityCache();
  const ambiguous = await detectVncClipboardBridge(autoProfile, {
    getConnection:() => connection,
    listConnections:() => [connection, {...connection,id:74,name:"Duplicate"}],
    runSshCommandForConnection:async () => ({status:1, stderr:"must not run"})
  });
  assert.equal(ambiguous.available, false);
  assert.match(ambiguous.reason, /多个同主机 SSH 连接/);

  clearVncClipboardCapabilityCache();
  const linuxProfile = {id:8, protocol:"vnc", host:"linux.test", options:{source_ssh_connection_id:74}};
  const linuxConnection = {id:74, ssh_host:"linux.test", ssh_port:22, ssh_user:"operator"};
  const linuxText = "Linux VNC 中文双向剪贴板";
  const linuxEncoded = Buffer.from(linuxText, "utf8").toString("base64");
  let linuxStep = 0;
  const linuxCommands = [];
  const linuxDependencies = {
    listConnections:() => [linuxConnection],
    getConnection:id => Number(id) === 74 ? linuxConnection : null,
    async runSshCommandForConnection(receivedConnection, command) {
      assert.equal(receivedConnection, linuxConnection);
      linuxCommands.push(String(command));
      linuxStep += 1;
      if (linuxStep === 1) return {status:0, stdout:[
        "TERMA_VNC_CLIPBOARD_MODE=linux-x11",
        "TERMA_VNC_CLIPBOARD_TOOL=xclip",
        "TERMA_VNC_CLIPBOARD_OS=Linux",
        "TERMA_VNC_CLIPBOARD_DISPLAY=:0",
        "TERMA_VNC_CLIPBOARD_XAUTHORITY=/home/operator/.Xauthority",
        "TERMA_VNC_CLIPBOARD_SESSION_USER=operator",
        "TERMA_VNC_CLIPBOARD_SESSION_UID=1000",
        "TERMA_VNC_CLIPBOARD_PACKAGE_MANAGER=apt",
        "TERMA_VNC_CLIPBOARD_ROOT=false"
      ].join("\n") + "\n", stderr:""};
      if (linuxStep === 2) return {status:0, stdout:`TERMA_SIZE=${Buffer.byteLength(linuxText)}\nTERMA_DATA=${linuxEncoded}\n`, stderr:""};
      return {status:0, stdout:"", stderr:""};
    }
  };
  const linuxCapability = await detectVncClipboardBridge(linuxProfile, linuxDependencies);
  assert.equal(linuxCapability.available, true);
  assert.equal(linuxCapability.transport, "ssh-linux-x11");
  assert.equal(linuxCapability.tool, "xclip");
  const linuxPlan = vncClipboardHelperInstallPlan(linuxCapability);
  assert.equal(linuxPlan.uninstall.available, true);
  assert.deepEqual(linuxPlan.uninstall.package_names, ["xclip"]);
  assert.match(linuxPlan.uninstall.command, /dpkg-query/);
  assert.match(linuxPlan.uninstall.command, /apt-get purge -y/);
  assert.equal((await readVncRemoteClipboard(linuxProfile, linuxDependencies)).text, linuxText);
  assert.equal((await writeVncRemoteClipboard(linuxProfile, linuxText, linuxDependencies)).transport, "ssh-linux-x11");
  assert.equal(linuxCommands.some(command => command.includes(linuxText)), false, "Linux 中文剪贴板不得以明文写入命令");
  const linuxScripts = linuxCommands.map(decodeRemotePosixPayload);
  assert.match(linuxScripts[0], /\[x\]11vnc/);
  assert.match(linuxScripts[0], /-rfbport/);
  const linuxReadScript = linuxScripts.find(script => script.includes("xclip -selection clipboard -target TARGETS -o")) || "";
  assert.match(linuxReadScript, /timeout 2/);
  assert.match(linuxReadScript, /UTF8_STRING/);
  assert.match(linuxReadScript, /text\/plain;charset=utf-8/);
  assert.match(linuxReadScript, /TERMA_TEXT_AVAILABLE/);
  assert.doesNotMatch(linuxReadScript, /xclip -selection clipboard -o(?:\s|$)/, "X11 文本读取不得使用无类型的 xclip 默认输出");
  const linuxWriteScript = linuxScripts.find(script => script.includes("xclip -selection clipboard -i")) || "";
  assert.match(linuxWriteScript, /td_clip_error=\$\(mktemp\)/);
  assert.match(linuxWriteScript, />\/dev\/null 2>"\$td_clip_error"/);

  clearVncClipboardCapabilityCache();
  let noTextStep = 0;
  const noText = await readVncRemoteClipboard(linuxProfile, {
    listConnections:() => [linuxConnection],
    getConnection:id => Number(id) === 74 ? linuxConnection : null,
    async runSshCommandForConnection() {
      noTextStep += 1;
      if (noTextStep === 1) return {status:0, stdout:[
        "TERMA_VNC_CLIPBOARD_MODE=linux-x11",
        "TERMA_VNC_CLIPBOARD_TOOL=xclip",
        "TERMA_VNC_CLIPBOARD_OS=Linux"
      ].join("\n") + "\n", stderr:""};
      return {status:0, stdout:"TERMA_TEXT_AVAILABLE=0\nTERMA_SIZE=0\nTERMA_DATA=\n", stderr:""};
    }
  });
  assert.equal(noText.text_available, false, "图片等非文本 selection 必须明确返回文本不可用");
  assert.equal(noText.text, "", "非文本 selection 不得把 PNG 字节解码为文本");

  clearVncClipboardCapabilityCache();
  let mislabeledStep = 0;
  const mislabeledPng = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
  const mislabeled = await readVncRemoteClipboard(linuxProfile, {
    listConnections:() => [linuxConnection],
    getConnection:id => Number(id) === 74 ? linuxConnection : null,
    async runSshCommandForConnection() {
      mislabeledStep += 1;
      if (mislabeledStep === 1) return {status:0, stdout:"TERMA_VNC_CLIPBOARD_MODE=linux-x11\nTERMA_VNC_CLIPBOARD_TOOL=xsel\nTERMA_VNC_CLIPBOARD_OS=Linux\n", stderr:""};
      return {status:0, stdout:`TERMA_TEXT_AVAILABLE=1\nTERMA_SIZE=${mislabeledPng.length}\nTERMA_DATA=${mislabeledPng.toString("base64")}\n`, stderr:""};
    }
  });
  assert.equal(mislabeled.text_available, false, "错误标记为文本的 PNG 仍必须被二次签名校验拒绝");
  assert.equal(mislabeled.text, "");

  clearVncClipboardCapabilityCache();
  const missingLinuxHelper = await inspectVncClipboardHelper(linuxProfile, {
    listConnections:() => [linuxConnection],
    getConnection:id => Number(id) === 74 ? linuxConnection : null,
    async runSshCommandForConnection() {
      return {status:0, stdout:[
        "TERMA_VNC_CLIPBOARD_MODE=unsupported",
        "TERMA_VNC_CLIPBOARD_OS=Linux",
        "TERMA_VNC_CLIPBOARD_SESSION_TYPE=x11",
        "TERMA_VNC_CLIPBOARD_PACKAGE_MANAGER=apt",
        "TERMA_VNC_CLIPBOARD_ROOT=false"
      ].join("\n") + "\n", stderr:""};
    }
  });
  assert.equal(missingLinuxHelper.platform, "linux");
  assert.equal(missingLinuxHelper.install_plan.online.available, true);
  assert.equal(missingLinuxHelper.install_plan.offline.available, true);
  assert.equal(missingLinuxHelper.install_plan.local_offline.available, true);
  assert.deepEqual(missingLinuxHelper.install_plan.local_offline.package_names, ["xclip"]);
  assert.equal(missingLinuxHelper.uninstall_plan.available, false);
  assert.equal(missingLinuxHelper.guide.summary.i18n_key, "remote:clipboard_guide.linux_summary");
  assert.equal(missingLinuxHelper.guide.summary.params.session, "x11");
  assert.match(englishRemote.clipboard_guide.linux_summary, /session/i);
  assert.match(chineseRemote.clipboard_guide.linux_summary, /图形会话/);

  const guideResult = vncClipboardHelperGuideResult(missingLinuxHelper);
  assert.equal(guideResult.ok, true);
  assert.equal(guideResult.action, "guide");
  assert.equal(guideResult.platform, "linux", "guide 接口必须在顶层保留系统识别结果");
  assert.equal(guideResult.session_type, "x11", "guide 接口必须在顶层保留图形会话类型");
  assert.equal(guideResult.connection_id, 74, "guide 接口必须在顶层保留 SSH 辅助连接");
  assert.equal(guideResult.before.platform, "linux");
  assert.equal(guideResult.after.platform, "linux");
  assert.equal(guideResult.install_plan.online.available, true);
  assert.equal(guideResult.uninstall_plan.available, false);
  assert.equal(guideResult.guide.summary.i18n_key, "remote:clipboard_guide.linux_summary");

  const waylandPlan = vncClipboardHelperInstallPlan({
    available:true,
    platform:"linux",
    tool:"wl-clipboard",
    session_type:"wayland",
    package_manager:"pacman"
  });
  assert.equal(waylandPlan.uninstall.available, true);
  assert.deepEqual(waylandPlan.uninstall.package_names, ["wl-clipboard"]);
  assert.match(waylandPlan.uninstall.command, /pacman -R --noconfirm/);

  clearVncClipboardCapabilityCache();
  const unsupported = await detectVncClipboardBridge(profile, {
    listConnections:() => [connection],
    getConnection:() => connection,
    runSshCommandForConnection:async () => ({status:0, stdout:"TERMA_VNC_CLIPBOARD_MODE=unsupported\n", stderr:""})
  });
  assert.equal(unsupported.available, false);
  assert.equal(unsupported.transport, "rfb");

  console.log("VNC 剪贴板辅助通道检查通过：macOS/Linux Unicode 探测、双向读写、大小限制和明文隔离均有效");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
