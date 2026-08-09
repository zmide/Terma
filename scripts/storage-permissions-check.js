const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensurePrivateDirectory, ensurePrivateFile } = require("../dist/storage-permissions");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-storage-permissions-"));
const directory = path.join(root, "data");
const file = path.join(directory, "security.json");

function powershell(command) {
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding:"utf8",
    windowsHide:true
  });
  if (result.status !== 0) throw new Error(result.stderr || "PowerShell ACL check failed");
  return String(result.stdout || "").trim();
}

function windowsAclSids(target) {
  const escaped = String(target).replaceAll("'", "''");
  const output = powershell(`$items=@((Get-Acl -LiteralPath '${escaped}').Access | ForEach-Object { try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $_.IdentityReference.Value } }); $items | ConvertTo-Json -Compress`);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

try {
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(file, "{}\n", "utf8");
  if (process.platform === "win32") {
    assert.equal(spawnSync("icacls", [directory, "/grant", "*S-1-1-0:(OI)(CI)R"], {windowsHide:true}).status, 0);
    assert.equal(spawnSync("icacls", [file, "/grant", "*S-1-1-0:R"], {windowsHide:true}).status, 0);
  }
  ensurePrivateDirectory(directory);
  ensurePrivateFile(file);
  if (process.platform === "win32") {
    const broad = new Set(["S-1-1-0", "S-1-5-11", "S-1-5-32-545"]);
    const directorySids = windowsAclSids(directory);
    const fileSids = windowsAclSids(file);
    assert.equal(directorySids.some(sid => broad.has(String(sid).toUpperCase())), false);
    assert.equal(fileSids.some(sid => broad.has(String(sid).toUpperCase())), false);
    assert.ok(directorySids.includes("S-1-5-18") && directorySids.includes("S-1-5-32-544"));
    assert.ok(fileSids.includes("S-1-5-18") && fileSids.includes("S-1-5-32-544"));
  } else {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  console.log("存储权限检查通过：数据目录和敏感文件仅保留当前用户、SYSTEM/管理员或 Unix 私有权限");
} finally {
  fs.rmSync(root, {recursive:true, force:true});
}
