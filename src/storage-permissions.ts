const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securedWindowsPaths = new Set();

function windowsAccount() {
  const username = String(process.env.USERNAME || "").trim();
  const domain = String(process.env.USERDOMAIN || "").trim();
  if (username) return domain ? `${domain}\\${username}` : username;
  try {
    return String(spawnSync("whoami", [], {encoding:"utf8", windowsHide:true}).stdout || "").trim();
  } catch {
    return "";
  }
}

function windowsAclPrincipals(output, target) {
  const resolved = path.resolve(target);
  return String(output || "").split(/\r?\n/).map((line) => {
    let acl = line.trim();
    if (!acl) return "";
    if (acl.toLowerCase().startsWith(resolved.toLowerCase())) acl = acl.slice(resolved.length).trim();
    return acl.match(/^(.+?):(?:\([^)]+\))+/)?.[1]?.trim() || "";
  }).filter(Boolean);
}

function ensurePrivateWindowsPath(target, directory) {
  const resolved = path.resolve(target);
  const cacheKey = `${directory ? "d" : "f"}:${resolved.toLowerCase()}`;
  if (securedWindowsPaths.has(cacheKey)) return;
  const account = windowsAccount();
  if (!account) return;
  const rights = directory ? "(OI)(CI)F" : "F";
  const allowed = new Set([
    account,
    String(process.env.USERNAME || ""),
    "nt authority\\system",
    "builtin\\administrators",
    "s-1-5-18",
    "s-1-5-32-544",
    "*s-1-5-18",
    "*s-1-5-32-544"
  ].map(item => item.toLowerCase()).filter(Boolean));
  const run = args => spawnSync("icacls", [resolved, ...args], {encoding:"utf8", windowsHide:true});
  try {
    if (run(["/inheritance:r"]).status !== 0) return;
    if (run(["/grant:r", `${account}:${rights}`, `*S-1-5-18:${rights}`, `*S-1-5-32-544:${rights}`]).status !== 0) return;
    const listed = run([]);
    if (listed.status !== 0) return;
    const listing = listed.stdout || "";
    for (const principal of windowsAclPrincipals(listing, resolved)) {
      if (!allowed.has(principal.toLowerCase())) run(["/remove:g", principal]);
    }
    run(["/remove:g", "*S-1-5-11", "*S-1-5-32-545", "*S-1-1-0"]);
    securedWindowsPaths.add(cacheKey);
  } catch {}
}

function ensurePrivateDirectory(directory) {
  const target = String(directory || "");
  if (!target) return;
  fs.mkdirSync(target, { recursive:true, mode:0o700 });
  if (process.platform === "win32") ensurePrivateWindowsPath(target, true);
  else {
    try { fs.chmodSync(target, 0o700); } catch {}
  }
}

function ensurePrivateFile(file) {
  const target = String(file || "");
  if (!target || !fs.existsSync(target)) return;
  if (process.platform === "win32") ensurePrivateWindowsPath(target, false);
  else try { fs.chmodSync(target, 0o600); } catch {}
}

module.exports = { ensurePrivateDirectory, ensurePrivateFile };
