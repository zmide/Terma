const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-identity-compatibility-"));
const dataRoot = path.join(root, "data");
const sshRoot = path.join(root, ".ssh");
const nestedRoot = path.join(sshRoot, "nested");
const outsideRoot = path.join(root, "outside");
const expectedWarning = "私钥已不在安全目录，请编辑连接并导入 Terma 密钥目录或用户 ~/.ssh 顶层。";

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function connection(name, identityFile) {
  return {
    name,
    group_name:"compatibility-test",
    ssh_host:"example.test",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:identityFile
  };
}

function loadIdentityUi() {
  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    selectedId:null,
    healthResults:new Map(),
    connectionBulkMode:false,
    selectedConnectionIds:new Set(),
    icon:name => `<svg data-icon="${name}"></svg>`,
    esc:value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character])),
    escAttr:value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character])),
    api:async pathname => pathname === "/api/identity-files" ? [] : Promise.reject(new Error(`Unexpected API request: ${pathname}`))
  };
  sandbox.globalThis = sandbox;
  const filename = path.resolve(__dirname, "../public/app-connections.js");
  const source = `${fs.readFileSync(filename, "utf8")}
    ;globalThis.__identityUi = {
      connectionLegacyIdentityOption,
      loadKeys,
      renderConnectionRow,
      renderKeyStatus
    };`;
  vm.runInNewContext(source, sandbox, {filename, timeout:5000});
  return sandbox.__identityUi;
}

async function main() {
  fs.mkdirSync(nestedRoot, {recursive:true});
  fs.mkdirSync(outsideRoot, {recursive:true});
  const keyBody = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-only-placeholder\n-----END OPENSSH PRIVATE KEY-----\n";
  const readyKey = path.join(sshRoot, "id_ready");
  const nestedKey = path.join(nestedRoot, "id_nested");
  const outsideKey = path.join(outsideRoot, "id_outside");
  fs.writeFileSync(readyKey, keyBody, {mode:0o600});
  fs.writeFileSync(nestedKey, keyBody, {mode:0o600});
  fs.writeFileSync(outsideKey, keyBody, {mode:0o600});

  process.env.TERMA_DATA_DIR = dataRoot;
  process.env.TERMA_SSH_DIR = sshRoot;
  const db = require("../dist/db");
  const { encryptText } = require("../dist/crypto-store");
  const readyId = db.insertConnection(connection("ready", readyKey), "");
  const noneId = db.insertConnection(connection("none", ""), "");
  const timestamp = db.now();
  const insertLegacy = (name, identityFile) => Number(db.run(
    "INSERT INTO connections(name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [name, "compatibility-test", "example.test", 22, "tester", "key", encryptText(identityFile), timestamp, timestamp]
  ).lastInsertRowid);
  const nestedId = insertLegacy("nested", nestedKey);
  const outsideId = insertLegacy("outside", outsideKey);

  let started = null;
  try {
    const port = await availablePort();
    const { startServer } = require("../dist/server");
    started = startServer({
      listen_hosts:["127.0.0.1"],
      listen_port:port,
      pidFile:path.join(dataRoot, "identity-compatibility.pid")
    }, {exitOnShutdown:false});
    await started.ready;

    const response = await fetch(`http://127.0.0.1:${port}/api/connections`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    const byId = id => rows.find(item => Number(item.id) === Number(id));
    assert.equal(byId(readyId).identity_file_status, "ready");
    assert.equal(byId(readyId).identity_file_message, "");
    assert.equal(byId(noneId).identity_file_status, "none");
    assert.equal(byId(noneId).identity_file_message, "");
    for (const id of [nestedId, outsideId]) {
      assert.equal(byId(id).identity_file_status, "unsafe");
      assert.equal(byId(id).identity_file_message, expectedWarning);
    }

    const ui = loadIdentityUi();
    const unsafeRow = ui.renderConnectionRow({...byId(outsideId), forwards:[]});
    assert.match(unsafeRow, /私钥需重新导入/);
    assert.ok(unsafeRow.includes(expectedWarning));
    const form = {dataset:{identityFileStatus:"unsafe", identityFileMessage:expectedWarning}};
    assert.match(ui.connectionLegacyIdentityOption(form), /当前私钥已失效，请重新导入/);
    const statusBox = {textContent:"", className:""};
    const select = {
      form,
      isConnected:true,
      value:"",
      selectedOptions:[{dataset:{}}],
      closest:selector => selector === "#view-edit" ? {querySelector:() => statusBox} : null,
      set innerHTML(value) {
        this.renderedHtml = value;
        this.value = "";
        this.selectedOptions = [{dataset:value.includes("data-legacy-unsafe") ? {legacyUnsafe:"1"} : {}}];
      },
      get innerHTML() { return this.renderedHtml || ""; }
    };
    await ui.loadKeys(outsideKey, select);
    assert.match(select.innerHTML, /当前私钥已失效，请重新导入/);
    assert.equal(statusBox.textContent, expectedWarning);
    assert.equal(statusBox.className, "key-status warning");
  } finally {
    try { await started?.shutdown(); } catch {}
    try { db.closeDatabase(); } catch {}
  }

  console.log("Identity compatibility check passed: ready/none/unsafe API state and legacy-key UI guidance");
}

main().finally(() => fs.rmSync(root, {recursive:true, force:true})).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
