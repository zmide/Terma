"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { utils } = require("ssh2");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-managed-keys-"));
process.env.TERMA_DATA_DIR = path.join(temporary, "data");
process.env.TERMA_SSH_DIR = path.join(temporary, "ssh");
const sshRoot = process.env.TERMA_SSH_DIR;
const keys = require("../dist/ssh-key-wizard");
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function main() {
  for (const type of ["ed25519", "rsa", "ecdsa"]) {
    const pair = utils.generateKeyPairSync(type, {comment:"Imported acceptance key", ...(type === "rsa" ? {bits:2048} : type === "ecdsa" ? {bits:256} : {})});
    const imported = keys.importManagedKey(`import_${type}`, Buffer.from(pair.private));
    const file = imported.item.path;
    const original = utils.parseKey(pair.private);
    const publicKey = keys.managedPublicKey(file, "project").public_key;
    const parsed = utils.parseKey(publicKey);
    assert.ok(!(parsed instanceof Error));
    assert.ok(parsed.getPublicSSH().equals(original.getPublicSSH()), `${type}: public data changed`);
    const privateBefore = digest(file);
    fs.unlinkSync(`${file}.pub`);
    assert.ok(utils.parseKey(keys.managedPublicKey(file, "project").public_key).getPublicSSH().equals(original.getPublicSSH()));
    await keys.updateManagedKey(file, "project", false, {comment:"Updated acceptance comment"});
    assert.equal(keys.managedKeyProperties(file, "project").comment, "Updated acceptance comment");
    assert.equal(digest(file), privateBefore, "Comment update changed the private key");
    assert.throws(() => keys.deleteManagedKey(file, "project", false, [file]), error => error.publicCode === "ssh_key_in_use");
    assert.equal(digest(file), privateBefore);
    const duplicate = keys.importManagedKey(`import_${type}`, Buffer.from(pair.private));
    assert.notEqual(duplicate.item.path, file);
    keys.deleteManagedKey(duplicate.item.path, "project");
    keys.deleteManagedKey(file, "project");
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.pub`), false);
  }
  const encrypted = utils.generateKeyPairSync("ed25519", {cipher:"aes256-ctr", passphrase:"Fixture-passphrase-1", comment:"Encrypted import"});
  const importedEncrypted = keys.importManagedKey("encrypted_import", Buffer.from(encrypted.private));
  assert.equal(importedEncrypted.item.type, "Ed25519");
  assert.equal(importedEncrypted.item.has_passphrase, true);
  assert.ok(!(utils.parseKey(keys.managedPublicKey(importedEncrypted.item.path, "project").public_key) instanceof Error));
  const beforeWrongPassphrase = digest(importedEncrypted.item.path);
  await assert.rejects(keys.updateManagedKey(importedEncrypted.item.path, "project", false, {current_passphrase:"invalid\nvalue"}), error => error.publicCode === "ssh_key_passphrase_invalid");
  await assert.rejects(keys.updateManagedKey(importedEncrypted.item.path, "project", false, {current_passphrase:"wrong", new_passphrase:"Fixture-passphrase-2"}), error => error.publicCode === "ssh_key_passphrase_incorrect");
  assert.equal(digest(importedEncrypted.item.path), beforeWrongPassphrase, "Incorrect passphrase changed the key");
  await keys.updateManagedKey(importedEncrypted.item.path, "project", false, {current_passphrase:"Fixture-passphrase-1", new_passphrase:"Fixture-passphrase-2", comment:"Rotated fixture"});
  assert.ok(!(utils.parseKey(fs.readFileSync(importedEncrypted.item.path), "Fixture-passphrase-2") instanceof Error));
  await keys.updateManagedKey(importedEncrypted.item.path, "project", false, {current_passphrase:"Fixture-passphrase-2", new_passphrase:"", change_passphrase:true, comment:"Removed fixture passphrase"});
  assert.ok(!(utils.parseKey(fs.readFileSync(importedEncrypted.item.path)) instanceof Error));
  keys.deleteManagedKey(importedEncrypted.item.path, "project");
  assert.throws(() => keys.importManagedKey("bad", Buffer.from("not a private key")), error => error.publicCode === "ssh_key_import_invalid");
  assert.throws(() => keys.importManagedKey("bad.pub", Buffer.from(encrypted.private)), error => error.publicCode === "ssh_key_name_invalid");
  assert.throws(() => keys.importManagedKey("bad", Buffer.from(encrypted.private), "user"), error => error.publicCode === "ssh_key_user_scope_disabled");
  assert.throws(() => keys.managedKeyProperties(path.join(temporary, "outside"), "project"), error => error.publicCode === "ssh_key_path_invalid");

  const generated = keys.generateSshKey({name:"boundary_key"});
  const outside = path.join(temporary, "outside-public");
  fs.writeFileSync(outside, "retained outside content");
  fs.unlinkSync(generated.public_path);
  let linked = false;
  try { fs.symlinkSync(outside, generated.public_path); linked = true; }
  catch (error) { if (!["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes(error.code)) throw error; }
  if (linked) {
    assert.throws(() => keys.managedPublicKey(generated.private_path, "project"), error => error.publicCode === "ssh_key_public_file_unsafe");
    await assert.rejects(keys.updateManagedKey(generated.private_path, "project", false, {comment:"blocked"}), error => error.publicCode === "ssh_key_public_file_unsafe");
    assert.equal(fs.readFileSync(outside, "utf8"), "retained outside content");
    fs.unlinkSync(generated.public_path);
  }
  let hardLinked = false;
  try { fs.linkSync(outside, generated.public_path); hardLinked = true; }
  catch (error) { if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) throw error; }
  if (hardLinked) {
    assert.throws(() => keys.managedPublicKey(generated.private_path, "project"), error => error.publicCode === "ssh_key_public_file_unsafe");
    await assert.rejects(keys.updateManagedKey(generated.private_path, "project", false, {comment:"blocked"}), error => error.publicCode === "ssh_key_public_file_unsafe");
    assert.equal(fs.readFileSync(outside, "utf8"), "retained outside content");
    fs.unlinkSync(generated.public_path);
  }
  const mismatch = keys.generateSshKey({name:"mismatched_key"});
  fs.copyFileSync(mismatch.public_path, generated.public_path);
  assert.throws(() => keys.managedPublicKey(generated.private_path, "project"), error => error.publicCode === "ssh_key_public_mismatch");
  keys.deleteManagedKey(generated.private_path, "project");
  keys.deleteManagedKey(mismatch.private_path, "project");
  assert.deepEqual(keys.listManagedKeys().items, []);
  console.log("Managed keys passed: Ed25519/RSA/ECDSA import, public format, missing public files, properties, encrypted keys, passphrase changes, deletion, references and path boundaries");
}

main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
  try { require("../dist/db").closeDatabase(); } catch {}
  fs.rmSync(temporary, {recursive:true, force:true});
});
