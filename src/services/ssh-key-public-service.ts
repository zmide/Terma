import fs from "node:fs";
const { utils } = require("ssh2");
import { publicError } from "../public-error";

// Public SSH files contain a type and base64-encoded SSH wire data. The SSH2
// parser returns the wire data as a Buffer, not an authorized_keys line.
export function publicKeyText(parsed: any, comment = parsed?.comment || ""): string {
  const wire = parsed?.getPublicSSH?.();
  if (!Buffer.isBuffer(wire)) throw publicError("SSH_KEY_PUBLIC_UNAVAILABLE", "无法读取公钥，请确认私钥格式及对应公钥文件");
  const note = String(comment).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return `${parsed.type} ${wire.toString("base64")}${note ? ` ${note}` : ""}`;
}

export function assertPublicCompanion(privatePath: string): void {
  try {
    const stat = fs.lstatSync(`${privatePath}.pub`);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 1024 * 1024) {
      throw publicError("SSH_KEY_PUBLIC_FILE_UNSAFE", "对应公钥必须是密钥目录中的独立普通文件");
    }
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function writeManagedPublicKey(privatePath: string, text: string): void {
  assertPublicCompanion(privatePath);
  const temporary = `${privatePath}.pub.tmp-${process.pid}-${require("node:crypto").randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${text.trim()}\n`, {mode:0o600, flag:"wx"});
    fs.renameSync(temporary, `${privatePath}.pub`);
  } finally {
    try { fs.rmSync(temporary, {force:true}); } catch {}
  }
}

function singleParsed(value: any): any {
  const parsed = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  return parsed && !(parsed instanceof Error) ? parsed : null;
}

// OpenSSH keeps its public blob outside the encrypted private section. This
// allows displaying an encrypted OpenSSH key without asking for its passphrase.
function openSshPublic(data: Buffer): any {
  const text = data.toString("utf8").trim();
  if (!/^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n/.test(text)) return null;
  try {
    const body = Buffer.from(text.replace(/-----[^\r\n]+-----|\s/g, ""), "base64");
    const magic = Buffer.from("openssh-key-v1\0");
    if (!body.subarray(0, magic.length).equals(magic)) return null;
    let offset = magic.length;
    const field = () => {
      if (offset + 4 > body.length) throw new Error("Truncated key");
      const length = body.readUInt32BE(offset); offset += 4;
      if (length > body.length - offset) throw new Error("Truncated key");
      const value = body.subarray(offset, offset + length); offset += length;
      return value;
    };
    field(); field(); field();
    if (offset + 4 > body.length || body.readUInt32BE(offset) !== 1) return null;
    offset += 4;
    const wire = field();
    if (wire.length < 4 || wire.readUInt32BE(0) > wire.length - 4) return null;
    const type = wire.subarray(4, 4 + wire.readUInt32BE(0)).toString("ascii");
    if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))$/.test(type)) return null;
    return singleParsed(utils.parseKey(`${type} ${wire.toString("base64")}`));
  } catch { return null; }
}

export function readManagedPublicKey(privatePath: string, passphrase?: string): any {
  assertPublicCompanion(privatePath);
  const privateData = fs.readFileSync(privatePath);
  const derived = singleParsed(utils.parseKey(privateData, passphrase || undefined)) || openSshPublic(privateData);
  let companion = null;
  try {
    const text = fs.readFileSync(`${privatePath}.pub`, "utf8").trim();
    if (/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+[A-Za-z0-9+/]+=*(?:\s+[^\r\n]*)?$/.test(text)) {
      companion = singleParsed(utils.parseKey(text));
    }
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if (derived && companion && !derived.getPublicSSH().equals(companion.getPublicSSH())) {
    throw publicError("SSH_KEY_PUBLIC_MISMATCH", "公钥与私钥不匹配，请重新导入正确的密钥");
  }
  return companion || derived;
}
