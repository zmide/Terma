const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensurePrivateDirectory, ensurePrivateFile, storagePermissionFailureKind } = require("../dist/storage-permissions");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-storage-permissions-"));
const directory = path.join(root, "data");
const file = path.join(directory, "security.json");
const storagePermissionSource = fs.readFileSync(path.join(__dirname, "..", "src", "storage-permissions.ts"), "utf8");

assert.ok(
  storagePermissionSource.indexOf('const grant = run(["/grant:r"')
    < storagePermissionSource.indexOf('const inheritance = run(["/inheritance:r"]'),
  "Windows storage hardening must establish explicit private access before removing inherited ACLs"
);

function powershell(command) {
  const failures = [];
  for (const executable of ["pwsh", "powershell"]) {
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding:"utf8",
      windowsHide:true
    });
    const output = String(result.stdout || "").trim();
    if (result.status === 0 && output) return output;
    failures.push(String(result.error?.message || result.stderr || `${executable} returned no ACL data`).trim());
  }
  throw new Error(failures.filter(Boolean).join("\n") || "PowerShell ACL check failed");
}

function windowsAclSids(target) {
  const escaped = String(target).replaceAll("'", "''");
  const output = powershell(`$items=@((Get-Acl -LiteralPath '${escaped}').Access | ForEach-Object { try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $_.IdentityReference.Value } }); $items | ConvertTo-Json -Compress`);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

try {
  assert.equal(storagePermissionFailureKind("The file system does not support ACLs.", "win32"), "unsupported-acl");
  assert.equal(storagePermissionFailureKind("Access is denied.", "win32"), "access-denied");
  assert.equal(storagePermissionFailureKind("无法识别当前 Windows 用户", "win32"), "unknown-account");
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
