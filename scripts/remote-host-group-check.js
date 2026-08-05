"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const utilsSource = fs.readFileSync(path.join(root, "public", "app-utils.js"), "utf8");
const connectionsSource = fs.readFileSync(path.join(root, "public", "app-connections.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");

function occurrenceCount(value, pattern) {
  return (String(value).match(pattern) || []).length;
}

function createRemoteHostModel() {
  const storage = new Map();
  let renderCount = 0;
  const localStorage = {
    getItem:key => storage.has(key) ? storage.get(key) : null,
    setItem:(key, value) => storage.set(key, String(value)),
    removeItem:key => storage.delete(key)
  };
  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    CSS:{escape:value => String(value)},
    window:{lucide:null, innerWidth:1280, matchMedia:() => ({matches:false})},
    document:{
      querySelector:() => null,
      querySelectorAll:() => [],
      getElementById:() => null,
      body:{appendChild() {}, insertBefore() {}}
    },
    localStorage,
    remoteHostOpen:new Set(),
    remoteGroupOpen:new Set(),
    remoteConnectionSearch:"",
    renderRemoteProfileRow:profile => `<article class="remote-profile-stub" data-profile-id="${profile.id}"></article>`,
    esc:value => String(value ?? ""),
    escAttr:value => String(value ?? ""),
    $:() => null,
    connections:[],
    remoteProfiles:[],
    selectedId:null,
    selectedConnectionIds:new Set(),
    healthResults:new Map(),
    connectionBulkMode:false,
    connectionVirtual:{rowHeight:118, buffer:8, scrollTop:0},
    primaryView:"remote",
    addingGroup:false
  };
  sandbox.globalThis = sandbox;
  const source = `${utilsSource}\n${connectionsSource}\n;globalThis.__remoteHostModel = {
    loadRemoteHostState,
    saveRemoteHostState,
    remoteHostKey,
    remoteHostLabel,
    renderRemoteHostGroups,
    toggleRemoteHostOpen,
    revealRemoteProfile,
    setSearch:value => { remoteConnectionSearch = String(value || ""); },
    setRenderHook:hook => { renderConnections = hook; }
  };`;
  vm.runInNewContext(source, sandbox, {filename:"remote-host-group-model.js", timeout:5000});
  sandbox.remoteHostOpen = sandbox.__remoteHostModel.loadRemoteHostState();
  sandbox.__remoteHostModel.setRenderHook(() => { renderCount += 1; });
  return {model:sandbox.__remoteHostModel, sandbox, storage, getRenderCount:() => renderCount};
}

const profiles = [
  {id:1, name:"Server RDP", group_name:"生产", protocol:"rdp", host:"Server.EXAMPLE", port:3389},
  {id:2, name:"Server VNC", group_name:"生产", protocol:"vnc", host:"[server.example]", port:5900},
  {id:3, name:"Server FTP", group_name:"生产", protocol:"ftp", host:"server.example", port:21},
  {id:4, name:"Backup VNC", group_name:"生产", protocol:"vnc", host:"backup.example", port:5901},
  {id:5, name:"Local Serial", group_name:"生产", protocol:"serial", host:"", port:0, options:{path:"COM3"}}
];

const state = createRemoteHostModel();
const {model, sandbox, storage} = state;
sandbox.connections.push(
  {id:8, name:"生产主机", ssh_host:"server.example"},
  {id:9, name:"备用主机", ssh_host:"backup.example"}
);
const serverKey = JSON.stringify(["host", "生产", "server.example"]);
const backupKey = JSON.stringify(["host", "生产", "backup.example"]);
const serialKey = JSON.stringify(["serial", "生产", "com3"]);

assert.equal(model.remoteHostKey(profiles[0]), serverKey);
assert.equal(model.remoteHostKey(profiles[1]), serverKey, "IPv6 风格方括号和主机名大小写不得拆成不同服务器");
assert.equal(model.remoteHostKey(profiles[2]), serverKey, "同主机不同协议端口必须共用服务器子菜单");
assert.equal(model.remoteHostKey({...profiles[2], group_name:"测试"}), JSON.stringify(["host", "测试", "server.example"]), "不同外层分组的同名主机必须独立保存展开状态");
assert.equal(model.remoteHostKey(profiles[4]), serialKey);
assert.equal(model.remoteHostLabel(profiles[4]), "COM3");
assert.equal(model.remoteHostLabel(profiles[0]), "生产主机", "服务器标题应优先显示同 IP/主机地址的 SSH 名称");
assert.equal(model.remoteHostLabel({...profiles[0], host:"unmatched.example"}), "unmatched.example", "未匹配 SSH 时应回退显示远端地址");

let html = model.renderRemoteHostGroups(profiles);
assert.equal(occurrenceCount(html, /class="remote-host-group"/g), 3, "五个连接应收纳为三个服务器子菜单");
assert.ok(html.includes(`data-remote-host-key="${encodeURIComponent(serverKey)}"`));
assert.match(html, /<span class="remote-host-label" title="生产主机">生产主机<\/span><span class="count">3<\/span>/);
assert.equal(occurrenceCount(html, /class="remote-profile-stub"/g), 0, "服务器子菜单初次进入应保持折叠");
assert.equal(storage.has("openRemoteHostsV2"), false, "仅渲染折叠列表不应制造无意义的持久化状态");

model.toggleRemoteHostOpen(serverKey);
assert.equal(state.getRenderCount(), 1);
assert.deepEqual(JSON.parse(storage.get("openRemoteHostsV2")), [serverKey]);
html = model.renderRemoteHostGroups(profiles);
assert.equal(occurrenceCount(html, /class="remote-profile-stub"/g), 3, "展开一个服务器后只渲染该主机的协议连接");
assert.ok(html.includes(`data-remote-host-key="${encodeURIComponent(serverKey)}"`));
assert.match(html, /aria-expanded="true"/);

const restored = model.loadRemoteHostState();
assert.equal(restored.has(serverKey), true, "重新加载时必须恢复服务器展开状态");

model.toggleRemoteHostOpen(serverKey);
assert.deepEqual(JSON.parse(storage.get("openRemoteHostsV2")), []);
html = model.renderRemoteHostGroups(profiles);
assert.equal(occurrenceCount(html, /class="remote-profile-stub"/g), 0);

model.setSearch("vnc");
html = model.renderRemoteHostGroups(profiles.filter(profile => profile.protocol === "vnc"));
assert.equal(occurrenceCount(html, /class="remote-profile-stub"/g), 2, "搜索结果中的服务器必须临时展开以显示命中连接");
assert.deepEqual(JSON.parse(storage.get("openRemoteHostsV2")), [], "搜索临时展开不得污染用户保存的展开状态");
model.setSearch("");

model.revealRemoteProfile(profiles[3]);
assert.equal(sandbox.remoteGroupOpen.has("生产"), true, "主动定位连接时必须展开外层连接分组");
assert.equal(sandbox.remoteHostOpen.has(backupKey), true, "主动定位连接时必须展开对应服务器子菜单");
assert.deepEqual(JSON.parse(storage.get("openRemoteHostsV2")), [backupKey]);

assert.match(appSource, /const remoteHostOpen = loadRemoteHostState\(\)/);
assert.match(connectionsSource, /renderRemoteConnections\([\s\S]*?renderRemoteHostGroups\(groups\[name\] \|\| \[\]\)/);
assert.doesNotMatch(connectionsSource, /remoteProfiles\.forEach\(profile => remoteHostOpen\.add\(remoteHostKey\(profile\)\)\)/, "首次进入其他连接时服务器子菜单必须保持折叠");
assert.match(connectionsSource, /function revealRemoteProfile\(profile\)[\s\S]*?remoteHostOpen\.add\(remoteHostKey\(profile\)\)[\s\S]*?saveRemoteHostState\(\)/);
assert.match(css, /\.remote-host-head \{[^}]*display:flex;[^}]*text-align:left;/);
assert.match(css, /\.remote-host-label \{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/);
assert.match(css, /\.remote-host-group \.remote-profile-row \{[^}]*padding-left:24px;/);
assert.match(css, /#connectionGroups \{[^}]*--connection-group-sticky-height:34px;/, "其他连接列表必须定义双层悬浮标题的稳定高度");
assert.match(css, /\.group-head-row\.connection-group-head-row \{[^}]*position:sticky;[^}]*top:0;[^}]*min-height:var\(--connection-group-sticky-height\)/, "外层自定义分组标题必须固定在列表顶部");
assert.match(css, /\.remote-host-head-row \{[^}]*position:sticky;[^}]*top:var\(--connection-group-sticky-height\);[^}]*background:[^;}]+;[^}]*box-shadow:/, "服务器子标题必须吸附在外层分组标题下方并使用不透底背景");

console.log("其他连接服务器子菜单检查通过：按主机归并、SSH 名称显示与地址回退、默认折叠、搜索展开、主动定位、双层悬浮和展开状态持久化正常");
