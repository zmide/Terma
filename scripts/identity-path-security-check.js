const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-identity-security-"));
const dataRoot = path.join(root, "data");
const sshRoot = path.join(root, ".ssh");
const outsideRoot = path.join(root, "outside");
const previousData = process.env.TERMA_DATA_DIR;
const previousSsh = process.env.TERMA_SSH_DIR;
process.env.TERMA_DATA_DIR = dataRoot;
process.env.TERMA_SSH_DIR = sshRoot;
fs.mkdirSync(sshRoot, {recursive:true});
fs.mkdirSync(outsideRoot, {recursive:true});

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function connection(name, identityFile) {
  return {
    name,
    group_name:"security-test",
    ssh_host:"example.test",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:identityFile
  };
}

let db;
try {
  const allowedKey = path.join(sshRoot, "id_allowed");
  const publicKey = path.join(sshRoot, "id_allowed.pub");
  const uppercasePublicKey = path.join(sshRoot, "id_upper.PUB");
  const configFile = path.join(sshRoot, "config");
  const ordinaryFile = path.join(sshRoot, "id_not_a_key");
  const nestedRoot = path.join(sshRoot, "nested");
  const nestedKey = path.join(nestedRoot, "id_nested");
  const outsideKey = path.join(outsideRoot, "id_outside");
  const keyBody = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-only-placeholder\n-----END OPENSSH PRIVATE KEY-----\n";
  fs.mkdirSync(nestedRoot, {recursive:true});
  fs.writeFileSync(allowedKey, keyBody, {mode:0o600});
  fs.writeFileSync(publicKey, "ssh-ed25519 test-only-placeholder\n");
  fs.writeFileSync(uppercasePublicKey, "ssh-ed25519 test-only-placeholder\n");
  fs.writeFileSync(configFile, "Host example.test\n");
  fs.writeFileSync(ordinaryFile, "not a private key\n");
  fs.writeFileSync(nestedKey, keyBody, {mode:0o600});
  fs.writeFileSync(outsideKey, keyBody, {mode:0o644});

  const identity = require("../dist/identity-path");
  const ssh = require("../dist/ssh");
  const sshCommand = require("../dist/ssh-command");
  db = require("../dist/db");

  const canonicalAllowed = fs.realpathSync(allowedKey);
  assert.equal(pathKey(identity.allowedIdentityPath(allowedKey)), pathKey(canonicalAllowed));
  assert.equal(pathKey(identity.assertAllowedIdentityPath(allowedKey)), pathKey(canonicalAllowed));
  assert.ok(identity.listAllowedIdentityPaths().some(item => pathKey(item) === pathKey(canonicalAllowed)));
  assert.equal(identity.allowedIdentityPath(publicKey), "");
  assert.equal(identity.allowedIdentityPath(uppercasePublicKey), "");
  assert.equal(identity.allowedIdentityPath(configFile), "");
  assert.equal(identity.allowedIdentityPath(ordinaryFile), "");
  assert.equal(identity.allowedIdentityPath(nestedKey), "");
  assert.equal(identity.allowedIdentityPath(outsideKey), "");
  assert.throws(() => identity.assertAllowedIdentityPath(outsideKey));

  const before = fs.readFileSync(outsideKey, "utf8");
  const beforeMode = fs.statSync(outsideKey).mode;
  assert.throws(() => ssh.repairIdentityFile(outsideKey));
  assert.equal(fs.readFileSync(outsideKey, "utf8"), before);
  assert.equal(fs.statSync(outsideKey).mode, beforeMode);
  assert.deepEqual(ssh.identityPermissionStatus(outsideKey).issues, ["not-allowed"]);

  let windowsAclChecked = false;
  if (process.platform === "win32") {
    const granted = spawnSync("icacls", [allowedKey, "/grant", "*S-1-5-32-546:R"], {encoding:"utf8"});
    if (granted.status === 0) {
      windowsAclChecked = true;
      const unsafeStatus = ssh.identityPermissionStatus(allowedKey);
      assert.equal(unsafeStatus.ok, false);
      assert.ok(unsafeStatus.issues.includes("acl"));
      assert.equal(ssh.repairIdentityFile(allowedKey).ok, true);
    }
  }

  const allowedId = db.insertConnection(connection("allowed", allowedKey), "");
  assert.equal(pathKey(db.getConnection(allowedId).identity_file), pathKey(canonicalAllowed));
  assert.throws(() => db.insertConnection(connection("outside", outsideKey), ""));
  assert.throws(() => db.insertConnection({...connection("extra-identity", allowedKey), extra_args:`-i "${outsideKey}"`}, ""));
  assert.throws(() => sshCommand.assertSafeExtraArgs(`-o IdentityFile="${outsideKey}"`));
  assert.throws(() => sshCommand.assertSafeExtraArgs(`-F "${path.join(outsideRoot, "ssh-config")}"`));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-o ProxyCommand=helper"));
  assert.throws(() => sshCommand.assertSafeExtraArgs(`-vi${outsideKey}`));
  assert.throws(() => sshCommand.assertSafeExtraArgs(`-vF${path.join(outsideRoot, "ssh-config")}`));
  assert.throws(() => sshCommand.assertSafeExtraArgs(`-vI${path.join(outsideRoot, "provider.dll")}`));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-vA"));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-voProxyCommand=helper"));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-voLocalCommand=helper"));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-voKnownHostsCommand=helper"));
  assert.throws(() => sshCommand.assertSafeExtraArgs("-o ForwardAgent=yes"));
  assert.deepEqual(sshCommand.assertSafeExtraArgs("-Jadmin@bastion"), ["-Jadmin@bastion"]);
  assert.deepEqual(sshCommand.assertSafeExtraArgs("-L8080:internal.example:80"), ["-L8080:internal.example:80"]);
  assert.deepEqual(sshCommand.assertSafeExtraArgs("-lbuilduser"), ["-lbuilduser"]);
  assert.deepEqual(sshCommand.assertSafeExtraArgs("-vJ admin@bastion"), ["-vJ", "admin@bastion"]);

  const configBeforeUpload = fs.readFileSync(configFile, "utf8");
  assert.throws(() => ssh.saveUploadedKey("CONFIG", Buffer.from(keyBody)));
  assert.equal(fs.readFileSync(configFile, "utf8"), configBeforeUpload);
  assert.equal(fs.readdirSync(sshRoot).includes("CONFIG"), false);
  assert.throws(() => ssh.saveUploadedKey("uploaded.PUB", Buffer.from(keyBody)));
  assert.equal(fs.existsSync(path.join(sshRoot, "uploaded.PUB")), false);
  const puttyUpload = ssh.saveUploadedKey("uploaded.ppk", Buffer.from("PuTTY-User-Key-File-3: ssh-rsa\nEncryption: none\n"));
  assert.equal(pathKey(identity.allowedIdentityPath(puttyUpload.path)), pathKey(puttyUpload.path));

  const outsideLink = path.join(sshRoot, "id_outside_link");
  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideKey, outsideLink, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "EINVAL", "UNKNOWN"].includes(error.code)) symlinkSupported = false;
    else throw error;
  }
  if (symlinkSupported) {
    assert.equal(identity.allowedIdentityPath(outsideLink), "");
    assert.throws(() => identity.assertAllowedIdentityPath(outsideLink));
    assert.throws(() => db.insertConnection(connection("outside-link", outsideLink), ""));
    const nestedLink = path.join(sshRoot, "id_nested_link");
    fs.symlinkSync(nestedKey, nestedLink, "file");
    assert.equal(identity.allowedIdentityPath(nestedLink), "");
    assert.ok(!identity.listAllowedIdentityPaths().some(item => pathKey(item) === pathKey(nestedLink)));
  }

  const hardLink = path.join(sshRoot, "id_hardlink");
  let hardlinkSupported = true;
  try {
    fs.linkSync(outsideKey, hardLink);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "EINVAL", "EXDEV", "UNKNOWN"].includes(error.code)) hardlinkSupported = false;
    else throw error;
  }
  if (hardlinkSupported) {
    assert.equal(identity.allowedIdentityPath(hardLink), "");
    assert.throws(() => ssh.repairIdentityFile(hardLink));
    assert.equal(fs.readFileSync(outsideKey, "utf8"), before);
    assert.equal(fs.statSync(outsideKey).mode, beforeMode);
  }

  console.log(`Identity path security check passed: strict key content, repair guard, connection validation, sensitive extra-arg rejection${symlinkSupported ? ", symlink rejection" : ""}${hardlinkSupported ? ", hardlink rejection" : ""}${windowsAclChecked ? ", and Windows ACL repair" : ""}`);
} finally {
  try { db?.closeDatabase(); } catch {}
  fs.rmSync(root, {recursive:true, force:true});
  if (previousData === undefined) delete process.env.TERMA_DATA_DIR;
  else process.env.TERMA_DATA_DIR = previousData;
  if (previousSsh === undefined) delete process.env.TERMA_SSH_DIR;
  else process.env.TERMA_SSH_DIR = previousSsh;
}
