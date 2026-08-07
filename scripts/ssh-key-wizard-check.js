const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { utils } = require("ssh2");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-key-check-"));
process.env.TERMA_DATA_DIR = root;
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");

try {
  const { cleanKeyName, generateSshKey } = require("../dist/ssh-key-wizard");
  assert.throws(() => cleanKeyName("../bad"), /只能包含/);
  const first = generateSshKey({name:"id_ed25519_check", comment:"Terma regression", passphrase:"test-passphrase"});
  const second = generateSshKey({name:"id_ed25519_check", comment:"Terma regression"});
  assert.notEqual(first.private_path, second.private_path);
  assert.equal(first.has_passphrase, true);
  assert.match(first.public_key, /^ssh-ed25519\s+/);
  assert.ok(!(utils.parseKey(fs.readFileSync(first.private_path), "test-passphrase") instanceof Error));
  assert.ok(!(utils.parseKey(fs.readFileSync(second.private_path)) instanceof Error));
  for (let index = 0; index < 32; index += 1) {
    const generated = generateSshKey({name:"id_ed25519_stress", comment:`Terma stress ${index}`, passphrase:"test-passphrase"});
    assert.ok(!(utils.parseKey(fs.readFileSync(generated.private_path), "test-passphrase") instanceof Error));
  }
  if (process.platform !== "win32") assert.equal(fs.statSync(first.private_path).mode & 0o777, 0o600);
  console.log("SSH 密钥向导检查通过：Ed25519、口令、唯一命名与私钥权限正常");
} finally {
  try { require("../dist/db").closeDatabase(); } catch {}
  fs.rmSync(root, {recursive:true, force:true});
}
