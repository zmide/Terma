"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
if (process.platform === "linux") process.umask(0o077);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-fnos-check-"));
const password = "FnOS-Regression-Only-2026";
const children = [];
const policy = require("../dist/infrastructure/distribution-policy");
const previousDistribution = process.env.TERMA_DISTRIBUTION;
for (const distribution of [undefined, "standard", "linux", "desktop"]) {
  if (distribution === undefined) delete process.env.TERMA_DISTRIBUTION;
  else process.env.TERMA_DISTRIBUTION = distribution;
  assert.equal(policy.isFnosDistribution(), false);
  assert.deepEqual(policy.distributionPolicy(), {distribution:"standard", listen_locked:false, storage_locked:false, updates_managed_by:""});
  policy.assertDistributionSecurityOptions({auth_mode:"off", local_direct_desktop_integration_enabled:true, manage_user_ssh_keys_enabled:true});
  policy.assertDistributionListenSettings({listen_port:8090, listen_hosts:["127.0.0.1"]}, {listen_port:8088, listen_hosts:["0.0.0.0"]});
}
process.env.TERMA_DISTRIBUTION = "fnos";
assert.deepEqual(policy.distributionPolicy(), {distribution:"fnos", listen_locked:true, storage_locked:true, updates_managed_by:"fnos"});
assert.throws(() => policy.assertDistributionSecurityOptions({auth_mode:"off"}));
assert.throws(() => policy.assertDistributionSecurityOptions({local_direct_desktop_integration_enabled:true}));
assert.throws(() => policy.assertDistributionListenSettings({listen_port:8090}, {listen_port:8088}));
policy.assertDistributionListenSettings({listen_port:8088, listen_hosts:["0.0.0.0"]}, {listen_port:8088, listen_hosts:["0.0.0.0"]});
if (previousDistribution === undefined) delete process.env.TERMA_DISTRIBUTION;
else process.env.TERMA_DISTRIBUTION = previousDistribution;

function environment(name) {
  const variable = path.join(temporary, name);
  fs.mkdirSync(variable, {mode:0o700});
  return {...process.env, TERMA_DISTRIBUTION:"fnos", TERMA_DATA_DIR:path.join(variable, "data"),
    TERMA_SSH_DIR:path.join(variable, "ssh"), TRIM_PKGVAR:variable, TERMA_DISABLE_UPDATE_CHECK:"1",
    TERMA_RESET_WEB_ACCESS:"", TUNNELDESK_RESET_WEB_ACCESS:"", TERMA_AUTH_TOKEN:"", TUNNELDESK_AUTH_TOKEN:""};
}

function initialize(env, action = "install", fields = {}, success = true) {
  const result = spawnSync(process.execPath, ["scripts/fnos-initialize.js", action], {
    cwd:root, env:{...env, wizard_web_password:password, wizard_web_password_confirm:password, ...fields}, encoding:"utf8", timeout:15000
  });
  assert.equal(result.status === 0, success, result.stderr);
}

function configure(env, action, fields = {}, success = true) {
  const result = spawnSync(process.execPath, ["scripts/fnos-config.js", action], {cwd:root,
    env:{...env, ...fields}, encoding:"utf8", timeout:15000});
  assert.equal(result.status === 0, success, result.stderr);
  return result;
}

function start(env, port) {
  const child = spawn(process.execPath, [path.join(root, "dist/server.js"), "--host", "127.0.0.1", "--port", String(port)], {cwd:root, env, stdio:["ignore", "pipe", "pipe"]});
  child.output = "";
  child.stdout.on("data", data => child.output += data);
  child.stderr.on("data", data => child.output += data);
  child.on("error", error => { child.output += error.message; });
  children.push(child);
  return child;
}

function hostRequest(base, pathname, headers) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${base}${pathname}`, {headers}, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({status:response.statusCode, body}));
    });
    request.on("error", reject);
  });
}

async function until(predicate, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function main() {
  await require("./fnos-updates-check").runFnosUpdateChecks();
  if (process.platform === "linux") {
    const stagingCheck = spawnSync("python3", ["scripts/fnos-staging-check.py"], {cwd:root, encoding:"utf8", timeout:15000});
    assert.equal(stagingCheck.status, 0, stagingCheck.stderr);
  }
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const uninitialized = start(environment("uninitialized"), port);
  await until(() => uninitialized.exitCode !== null, "Uninitialized fnOS service did not exit");
  assert.notEqual(uninitialized.exitCode, 0);
  assert.match(uninitialized.output, /must be initialized/);

  const env = environment("primary");
  initialize(env);
  const settingsFile = path.join(env.TERMA_DATA_DIR, "security.json");
  const settings = JSON.parse(fs.readFileSync(settingsFile));
  assert.equal(settings.auth_mode, "always");
  assert.equal(settings.origin_protocol_check_enabled, true);
  assert.equal(fs.readFileSync(settingsFile, "utf8").includes(password), false);
  const runtimeFile = path.join(env.TERMA_DATA_DIR, "runtime-settings.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeFile)).listen_hosts, ["0.0.0.0"]);
  const before = fs.readFileSync(settingsFile, "utf8");
  for (const fields of [
    {wizard_new_web_password:"short", wizard_new_web_password_confirm:"short"},
    {wizard_new_web_password:password, wizard_new_web_password_confirm:"different"},
    {wizard_listen_hosts:"192.0.2.200"}, {wizard_listen_hosts:"192.168.31.0/24"},
    {wizard_allowed_hosts:"https://terma.example.com/path"}, {wizard_allowed_hosts:"*.example.com"},
    {wizard_trusted_proxies:"0.0.0.0"}, {wizard_trusted_proxies:"192.0.2.0/24"}, {wizard_origin_protocol_check:"invalid"}
  ]) configure(env, "apply", fields, false);
  assert.equal(fs.readFileSync(settingsFile, "utf8"), before, "Invalid settings changed authentication");
  configure(env, "apply", {wizard_listen_hosts:"127.0.0.1", wizard_allowed_hosts:"terma.example.com", wizard_trusted_proxies:"127.0.0.1"});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).password_hash, settings.password_hash, "Blank password reset the credential");
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)).allowed_hosts, ["terma.example.com"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeFile)).listen_hosts, ["127.0.0.1"]);
  configure(env, "apply", {}, false);
  configure(env, "rollback");
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)).allowed_hosts, settings.allowed_hosts);
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeFile)).listen_hosts, ["0.0.0.0"]);
  const newPassword = "FnOS-Reset-Regression-Only";
  configure(env, "apply", {wizard_new_web_password:newPassword, wizard_new_web_password_confirm:newPassword});
  assert.notEqual(JSON.parse(fs.readFileSync(settingsFile)).password_hash, settings.password_hash);
  assert.equal(fs.readFileSync(settingsFile, "utf8").includes(newPassword), false);
  configure(env, "rollback");
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).password_hash, settings.password_hash);
  configure(env, "apply", {wizard_reset_network:"true"});
  configure(env, "commit");
  configure(env, "apply", {wizard_origin_protocol_check:"false"});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).trusted_proxy_enabled, false, "Protocol compatibility must not require proxy trust");
  configure(env, "commit");
  configure(env, "apply", {});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, false, "Blank wizard must preserve protocol choice");
  configure(env, "commit");
  initialize(env, "upgrade");
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, false, "Upgrade must preserve protocol choice");
  configure(env, "apply", {wizard_origin_protocol_check:"true"});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, true);
  configure(env, "rollback");
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, false);
  configure(env, "apply", {wizard_reset_network:"true", wizard_origin_protocol_check:"false"});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, false, "Explicit choice takes precedence over reset");
  configure(env, "commit");
  configure(env, "apply", {wizard_reset_network:"true"});
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).origin_protocol_check_enabled, true, "Network reset restores strict protocol checking");
  configure(env, "commit");
  assert.equal(fs.existsSync(path.join(env.TERMA_DATA_DIR, "fnos-config-rollback.json")), false);
  initialize(env, "upgrade");
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).password_hash, settings.password_hash);
  const reinstallEnv = environment("reinstall");
  initialize(reinstallEnv);
  const reinstallSecurity = path.join(reinstallEnv.TERMA_DATA_DIR, "security.json");
  const retainedData = path.join(reinstallEnv.TERMA_DATA_DIR, "retained-data.json");
  fs.writeFileSync(retainedData, '{"keep":"existing application data"}');
  const retainedRuntime = fs.readFileSync(path.join(reinstallEnv.TERMA_DATA_DIR, "runtime-settings.json"), "utf8");
  const reinstallBefore = fs.readFileSync(reinstallSecurity, "utf8");
  for (const fields of [
    {wizard_web_password:"short", wizard_web_password_confirm:"short"},
    {wizard_web_password:newPassword, wizard_web_password_confirm:"different"},
    {wizard_web_password:"", wizard_web_password_confirm:""}
  ]) {
    initialize(reinstallEnv, "install", fields, false);
    assert.equal(fs.readFileSync(reinstallSecurity, "utf8"), reinstallBefore, "Rejected reinstall changed the credential");
  }
  initialize(reinstallEnv, "install", {wizard_web_password:newPassword, wizard_web_password_confirm:newPassword});
  const reinstalled = JSON.parse(fs.readFileSync(reinstallSecurity, "utf8"));
  const { verifySecret } = require("../dist/security");
  assert.equal(verifySecret(newPassword, reinstalled.password_hash, reinstalled.password_salt), true, "Reinstall ignored its wizard password");
  assert.equal(verifySecret(password, reinstalled.password_hash, reinstalled.password_salt), false, "Reinstall retained the previous password");
  assert.equal(fs.readFileSync(reinstallSecurity, "utf8").includes(newPassword), false);
  assert.equal(fs.readFileSync(retainedData, "utf8"), '{"keep":"existing application data"}');
  assert.equal(fs.readFileSync(path.join(reinstallEnv.TERMA_DATA_DIR, "runtime-settings.json"), "utf8"), retainedRuntime);
  initialize(reinstallEnv, "upgrade");
  assert.equal(JSON.parse(fs.readFileSync(reinstallSecurity, "utf8")).password_hash, reinstalled.password_hash, "Upgrade replaced the reinstall password");
  for(const context of [{TRIM_APP_STATUS:"UPGRADE"},{TRIM_APP_STATUS:"START"},{TRIM_APP_STATUS:"",TRIM_OLD_APPVER:"1.7.8"}]) {
    initialize(reinstallEnv,"install",{...context,wizard_web_password:password,wizard_web_password_confirm:password});
    const preserved=JSON.parse(fs.readFileSync(reinstallSecurity,"utf8"));
    assert.equal(preserved.password_hash,reinstalled.password_hash,"Reused install callback changed the upgrade password");
    assert.equal(preserved.password_salt,reinstalled.password_salt,"Upgrade changed the password salt");
  }
  const upgradeConfigurationBefore=fs.readFileSync(reinstallSecurity,"utf8");
  configure(reinstallEnv,"apply",{TRIM_APP_STATUS:"UPGRADE",wizard_new_web_password:password,wizard_new_web_password_confirm:password,wizard_reset_network:"true",wizard_origin_protocol_check:"false"});
  assert.equal(fs.readFileSync(reinstallSecurity,"utf8"),upgradeConfigurationBefore,"Upgrade reused stale configuration wizard values");
  const child = start(env, port);
  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (child.exitCode !== null) throw new Error(child.output);
    try { return (await fetch(`${base}/api/auth/status`)).ok; } catch { return false; }
  }, "fnOS service did not start");
  assert.equal((await fetch(`${base}/api/connections`)).status, 401);
  if (process.platform === "linux") {
    const processAction = (action, pid) => spawnSync(process.execPath, ["scripts/fnos-process.js", action, ...(pid ? [String(pid)] : [])], {cwd:root, env, encoding:"utf8"});
    assert.equal(processAction("record", child.pid).status, 0);
    assert.equal(processAction("verify").status, 0);
    assert.notEqual(processAction("record", process.pid).status, 0, "Accepted a foreign command as the service");
    const identityFile = path.join(env.TERMA_DATA_DIR, "fnos-process.json");
    const identity = fs.readFileSync(identityFile, "utf8");
    fs.writeFileSync(identityFile, JSON.stringify({...JSON.parse(identity), startTime:"0"}));
    assert.notEqual(processAction("verify").status, 0, "Accepted a reused PID");
    fs.writeFileSync(identityFile, identity);
    assert.equal(processAction("verify").status, 0);
    fs.chmodSync(identityFile, 0o644);
    assert.notEqual(processAction("verify").status, 0, "Accepted a public process marker");
    fs.chmodSync(identityFile, 0o600);
  }
  const rejected = await hostRequest(base, "/", {host:"unapproved.example", accept:"text/html", "accept-language":"zh-CN"});
  assert.equal(rejected.status, 421);
  assert.match(rejected.body, /HOST_NOT_ALLOWED/);
  const rejectedApi = await hostRequest(base, "/api/connections", {host:"unapproved.example", "accept-language":"en-US"});
  assert.equal(rejectedApi.status, 421);
  assert.equal(JSON.parse(rejectedApi.body).error_code, "host_not_allowed");
  const loginHtml = await (await fetch(`${base}/login`)).text();
  assert.match(loginHtml, /data-login-i18n="fnos_setup_hint">/);
  assert.match(loginHtml, /data-login-i18n="setup_hint" hidden>/);
  const login = await fetch(`${base}/api/auth/login`, {method:"POST", headers:{"content-type":"application/json", origin:base}, body:JSON.stringify({password})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = (url, method = "GET", body) => fetch(`${base}${url}`, {method, headers:{cookie, origin:base, "content-type":"application/json"}, ...(body ? {body:JSON.stringify(body)} : {})});
  assert.equal((await request("/api/connections")).status, 200);
  const serverRoots = await (await request("/api/server-files")).json();
  assert.ok(serverRoots.entries.length);
  const serverRoot = serverRoots.entries[0].path;
  assert.equal((await request("/api/server-files/create", "POST", {directory:serverRoot,name:"http-check.txt",type:"file"})).status,200);
  const serverFile = serverRoot+"/http-check.txt";
  assert.equal((await request("/api/server-files/text", "POST", {path:serverFile,content:"HTTP 中文"})).status,200);
  assert.equal((await (await request("/api/server-files/text?"+new URLSearchParams({path:serverFile}))).json()).content,"HTTP 中文");
  assert.equal(await (await request("/api/server-files/download?"+new URLSearchParams({path:serverFile}))).text(),"HTTP 中文");
  const incoming = await fetch(base+"/api/server-files/upload-content?"+new URLSearchParams({path:serverRoot,name:"upload.txt"}),{method:"POST",headers:{cookie,origin:base},body:"upload bytes"});
  assert.equal(incoming.status,200);
  assert.equal(await (await request("/api/server-files/download?"+new URLSearchParams({path:serverRoot+"/upload.txt"}))).text(),"upload bytes");
  assert.equal((await request("/api/server-files?"+new URLSearchParams({path:serverRoot+"/../security.json"}))).status,403);
  assert.equal((await request("/api/server-files/delete", "POST", {paths:[serverRoot]})).status,403);
  assert.equal((await request("/api/server-files/rename", "POST", {path:serverFile,new_name:"renamed.txt"})).status,200);
  assert.equal((await request("/api/server-files/delete", "POST", {paths:[serverRoot+"/renamed.txt",serverRoot+"/upload.txt"]})).status,200);
  // Exercise the same authenticated routes used by the browser, including
  // multipart uploads. Pure key-generator checks cannot catch upload headers.
  const generatedResponse = await request("/api/ssh/keys/generate", "POST", {name:"fnos_http_key", comment:"fnOS HTTP acceptance"});
  assert.equal(generatedResponse.status, 201);
  const generated = await generatedResponse.json();
  fs.unlinkSync(generated.public_path);
  const publicResponse = await request(`/api/managed-keys/public?scope=project&path=${encodeURIComponent(generated.private_path)}`);
  assert.equal(publicResponse.status, 200);
  assert.match((await publicResponse.json()).public_key, /^ssh-ed25519 [A-Za-z0-9+/]+=*(?: .*)?$/);
  const editedKey = await request("/api/managed-keys/properties", "PUT", {path:generated.private_path, scope:"project", comment:"Updated HTTP key"});
  assert.equal(editedKey.status, 200);
  assert.equal((await editedKey.json()).item.comment, "Updated HTTP key");
  const form = new FormData();
  form.append("key", new Blob([fs.readFileSync(generated.private_path)]), "fnos_http_import");
  const importResponse = await fetch(`${base}/api/managed-keys/import?scope=project`, {method:"POST", headers:{cookie, origin:base}, body:form});
  assert.equal(importResponse.status, 201);
  const importedKey = (await importResponse.json()).item;
  assert.equal(importedKey.type, "Ed25519");
  const connection = {name:"fnos_http_connection", group_name:"fnOS acceptance", ssh_host:"192.0.2.80", ssh_port:22, ssh_user:"tester", auth_type:"key", identity_file:generated.private_path};
  const createdResponse = await request("/api/connections", "POST", connection);
  assert.equal(createdResponse.status, 201);
  const connectionId = (await createdResponse.json()).id;
  const protectedDelete = await request("/api/managed-keys", "DELETE", {path:generated.private_path, scope:"project"});
  assert.equal(protectedDelete.status, 409);
  assert.equal((await protectedDelete.json()).error_code, "ssh_key_in_use");
  const editedConnection = await request(`/api/connections/${connectionId}`, "PUT", {...connection, name:"fnos_http_connection_edited", identity_file:importedKey.path});
  assert.equal(editedConnection.status, 200);
  const configExport = await request("/api/export/config", "POST", {ids:[connectionId]});
  assert.equal(configExport.status, 200);
  assert.match((await configExport.json()).config, /192\.0\.2\.80/);
  const parsedImport = await request("/api/import/parse-text", "POST", {text:"Host fnos_imported_connection\n  HostName 192.0.2.81\n  User tester\n"});
  assert.equal(parsedImport.status, 200);
  const parsedConnections = (await parsedImport.json()).tunnels;
  assert.equal((await request("/api/import/save", "POST", {tunnels:parsedConnections})).status, 201);
  const allConnections = await (await request("/api/connections")).json();
  assert.ok(allConnections.some(item => item.name === "fnos_http_connection_edited"));
  const importedConnection = allConnections.find(item => item.name === "fnos_imported_connection");
  assert.ok(importedConnection);
  const snapshotResponse = await request("/api/config-snapshots", "POST", {reason:"fnOS HTTP acceptance"});
  assert.equal(snapshotResponse.status, 201);
  const snapshot = await snapshotResponse.json();
  assert.equal((await request(`/api/config-snapshots/${snapshot.id}`, "DELETE")).status, 200);
  const databaseBackup = await request("/api/backup/database");
  assert.equal(databaseBackup.status, 200);
  assert.equal(Buffer.from(await databaseBackup.arrayBuffer()).subarray(0, 16).toString(), "SQLite format 3\0");
  assert.equal((await request(`/api/connections/${connectionId}`, "DELETE")).status, 200);
  assert.equal((await request(`/api/connections/${importedConnection.id}`, "DELETE")).status, 200);
  for (const keyPath of [generated.private_path, importedKey.path]) {
    assert.equal((await request("/api/managed-keys", "DELETE", {path:keyPath, scope:"project"})).status, 200);
    assert.equal(fs.existsSync(keyPath), false);
    assert.equal(fs.existsSync(`${keyPath}.pub`), false);
  }
  assert.equal((await (await request("/api/managed-keys")).json()).items.length, 0);
  console.log("fnOS browser API flow passed: key generation/import/properties/public/deletion, connection CRUD, SSH config import/export, snapshots and database backup");
  const auth = await (await request("/api/security")).json();
  assert.equal(auth.auth_mode, "always");
  assert.equal((await request("/api/security", "PUT", {origin_protocol_check_enabled:false})).status, 200);
  assert.equal((await (await request("/api/security")).json()).origin_protocol_check_enabled, false);
  assert.equal((await request("/api/security", "PUT", {origin_protocol_check_enabled:true})).status, 200);
  assert.equal((await request("/api/security", "PUT", {auth_mode:"off", confirm_unsafe:true})).status, 400);
  assert.equal((await request("/api/desktop-settings", "PUT", {dataMode:"custom", customDataDir:temporary})).status, 403);
  assert.equal((await request("/api/storage/directories")).status, 403);
  const runtime = await (await request("/api/runtime-settings")).json();
  assert.equal(runtime.listen_locked, true);
  assert.equal((await request("/api/runtime-settings", "PUT", {listen_port:port + 1})).status, 400);
  const update = await (await request("/api/updates/download/status")).json();
  assert.equal(update.managed_by, "fnos");
  assert.equal((await request("/api/updates/download", "POST", {})).status, 409);
  assert.equal((await request("/api/sftp/automations")).status, 403);
  assert.equal((await request("/api/local-files")).status, 403);
  const secondEnv = environment("occupied");
  initialize(secondEnv);
  const second = start(secondEnv, port);
  await until(() => second.exitCode !== null, "Occupied fnOS port unexpectedly fell back");
  assert.notEqual(second.exitCode, 0);
  assert.match(second.output, /EADDRINUSE/);
  child.kill("SIGTERM");
  await until(() => child.exitCode !== null || child.signalCode !== null, "fnOS service did not stop");
  if (process.platform === "linux") {
    initialize(env, "backup");
    const backupDirectory = path.join(env.TRIM_PKGVAR, "backups");
    const backup = path.join(backupDirectory, fs.readdirSync(backupDirectory)[0]);
    const listing = spawnSync("tar", ["-tzf", backup], {encoding:"utf8"});
    assert.equal(listing.status, 0);
    assert.match(listing.stdout, /data\/tunnels.db/);
    assert.match(listing.stdout, /ssh\//);
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  }
  console.log("fnOS authentication, configuration, rollback, host rejection, paths, fixed-port and lifecycle checks passed.");
}

main().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 300));
  if (path.dirname(temporary) !== fs.realpathSync(os.tmpdir()) || !path.basename(temporary).startsWith("terma-fnos-check-")) throw new Error("Unsafe test directory");
  fs.rmSync(temporary, {recursive:true, force:true});
});
