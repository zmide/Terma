const fs = require("node:fs");

function ensurePrivateDirectory(directory) {
  const target = String(directory || "");
  if (!target) return;
  fs.mkdirSync(target, { recursive:true, mode:0o700 });
  if (process.platform !== "win32") {
    try { fs.chmodSync(target, 0o700); } catch {}
  }
}

function ensurePrivateFile(file) {
  const target = String(file || "");
  if (!target || !fs.existsSync(target) || process.platform === "win32") return;
  try { fs.chmodSync(target, 0o600); } catch {}
}

module.exports = { ensurePrivateDirectory, ensurePrivateFile };
