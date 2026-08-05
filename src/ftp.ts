const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { Client } = require("basic-ftp");
const { DATA_DIR } = require("./config");
const { getRemoteProfile, updateRemoteProfileUsage } = require("./db");

const FTP_TEMP_DIR = path.join(DATA_DIR, "ftp-temp");

function ftpPath(value, fallback = "/") {
  const raw = String(value || fallback).replace(/\\/g, "/").trim() || fallback;
  const absolute = raw.startsWith("/");
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || "/";
}

function joinFtpPath(base, name) {
  const leaf = ftpName(name);
  return ftpPath(`${ftpPath(base).replace(/\/$/, "")}/${leaf}`);
}

function ftpName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/\0\r\n]/.test(name)) throw new Error("FTP 项目名称无效");
  if (Buffer.byteLength(name, "utf8") > 255) throw new Error("FTP 项目名称过长");
  return name;
}

function ftpProfile(id) {
  const profile = getRemoteProfile(Number(id));
  if (profile.protocol !== "ftp") throw new Error("该连接不是 FTP 配置");
  return profile;
}

async function withFtpClient(profile, callback) {
  const client = new Client(30000);
  client.ftp.verbose = false;
  const secure = profile.options.secure === "implicit" ? "implicit" : profile.options.secure === "explicit";
  try {
    await client.access({
      host:profile.host,
      port:Number(profile.port || (profile.options.secure === "implicit" ? 990 : 21)),
      user:profile.username || "anonymous",
      password:profile.password || "anonymous@",
      secure,
      secureOptions:secure ? {rejectUnauthorized:profile.options.reject_unauthorized !== false} : undefined
    });
    return await callback(client);
  } finally {
    client.close();
  }
}

function ftpEntryView(item) {
  return {
    name:String(item.name || ""),
    type:item.isDirectory ? "directory" : item.isSymbolicLink ? "link" : "file",
    size:Number(item.size || 0),
    modified_at:item.modifiedAt instanceof Date ? item.modifiedAt.toISOString() : "",
    permissions:String(item.rawModifiedAt || "")
  };
}

async function testFtpProfile(id) {
  const profile = ftpProfile(id);
  return withFtpClient(profile, async client => {
    const directory = ftpPath(profile.options.base_path || "/");
    await client.cd(directory);
    const list = await client.list();
    updateRemoteProfileUsage(id);
    return {ok:true, path:await client.pwd(), entries:list.length, secure:profile.options.secure || "none"};
  });
}

async function listFtpDirectory(id, requestedPath = "") {
  const profile = ftpProfile(id);
  const directory = ftpPath(requestedPath || profile.options.base_path || "/");
  return withFtpClient(profile, async client => {
    await client.cd(directory);
    const resolved = ftpPath(await client.pwd());
    const entries = (await client.list()).map(ftpEntryView)
      .filter(item => item.name !== "." && item.name !== "..")
      .sort((a, b) => (a.type === "directory" ? -1 : 1) - (b.type === "directory" ? -1 : 1) || a.name.localeCompare(b.name, "zh-Hans-CN", {numeric:true, sensitivity:"base"}));
    updateRemoteProfileUsage(id);
    return {path:resolved, parent:resolved === "/" ? "" : ftpPath(`${resolved}/..`), entries};
  });
}

async function makeFtpDirectory(id, directory, name) {
  const profile = ftpProfile(id);
  const target = joinFtpPath(directory, name);
  await withFtpClient(profile, client => client.ensureDir(target));
  return {ok:true, path:target};
}

async function renameFtpPath(id, directory, sourceName, targetName) {
  const profile = ftpProfile(id);
  const source = joinFtpPath(directory, sourceName);
  const target = joinFtpPath(directory, targetName);
  await withFtpClient(profile, client => client.rename(source, target));
  return {ok:true, path:target};
}

async function deleteFtpPath(id, directory, name, isDirectory = false) {
  const profile = ftpProfile(id);
  const target = joinFtpPath(directory, name);
  await withFtpClient(profile, client => isDirectory ? client.removeDir(target) : client.remove(target));
  return {ok:true};
}

async function uploadFtpFile(id, directory, name, content) {
  const profile = ftpProfile(id);
  const target = joinFtpPath(directory, name);
  await withFtpClient(profile, client => client.uploadFrom(Readable.from(Buffer.from(content)), target));
  return {ok:true, path:target, size:Buffer.byteLength(content)};
}

async function downloadFtpFile(id, directory, name) {
  const profile = ftpProfile(id);
  const remotePath = joinFtpPath(directory, name);
  fs.mkdirSync(FTP_TEMP_DIR, {recursive:true});
  const remoteName = ftpName(name);
  const safeName = path.basename(remoteName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "download.bin";
  const localPath = path.join(FTP_TEMP_DIR, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`);
  try {
    await withFtpClient(profile, client => client.downloadTo(localPath, remotePath));
    return {
      path:localPath,
      name:safeName,
      size:fs.statSync(localPath).size,
      cleanup() { try { fs.unlinkSync(localPath); } catch {} }
    };
  } catch (error) {
    try { fs.unlinkSync(localPath); } catch {}
    throw error;
  }
}

function cleanupFtpTemp(maximumAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(FTP_TEMP_DIR)) return;
  const cutoff = Date.now() - maximumAgeMs;
  for (const name of fs.readdirSync(FTP_TEMP_DIR)) {
    const file = path.join(FTP_TEMP_DIR, name);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, {force:true}); } catch {}
  }
}

module.exports = {
  cleanupFtpTemp,
  deleteFtpPath,
  downloadFtpFile,
  ftpPath,
  ftpName,
  listFtpDirectory,
  makeFtpDirectory,
  renameFtpPath,
  testFtpProfile,
  uploadFtpFile
};
