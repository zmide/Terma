const { RUNTIME_SETTINGS_FILE } = require("../config");
const { readRuntimeSettings } = require("../runtime-settings");
const { encodeRemoteText, normalizeTextEncoding } = require("../sftp");

function isUnixScript(remotePath, content) {
  const basename = String(remotePath || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  if (/\.(?:sh|bash|zsh|ksh|dash|fish)$/.test(basename)) return true;
  if ([".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile", ".kshrc"].includes(basename)) return true;
  return /^\uFEFF?#!/.test(String(content || ""));
}

function normalizeLineEndings(content, lineEnding) {
  const normalized = String(content || "").replace(/\r\n|\r|\n/g, "\n");
  if (lineEnding === "crlf") return normalized.replace(/\n/g, "\r\n");
  if (lineEnding === "cr") return normalized.replace(/\n/g, "\r");
  return normalized;
}

function prepareSftpWriteContent(content, encoding = "utf8", remotePath = "", requestedLineEnding = "") {
  const maximumMb = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_max_open_file_size_mb;
  const maximumBytes = maximumMb * 1024 * 1024;
  const unixScript = isUnixScript(remotePath, content);
  const lineEnding = ["lf", "crlf", "cr"].includes(requestedLineEnding) ? requestedLineEnding : (unixScript ? "lf" : "");
  let text = String(content || "");
  let selectedEncoding = normalizeTextEncoding(encoding, "utf8");
  if (unixScript) {
    text = text.replace(/^\uFEFF/, "");
    if (selectedEncoding === "utf8bom") selectedEncoding = "utf8";
  }
  if (lineEnding) text = normalizeLineEndings(text, lineEnding);
  const finalLineEnding = {lf:"\n", crlf:"\r\n", cr:"\r"}[lineEnding] || "\n";
  if (unixScript && text && !text.endsWith(finalLineEnding)) text += finalLineEnding;
  const encoded = encodeRemoteText(text, selectedEncoding);
  if (encoded.length > maximumBytes) throw new Error(`在线编辑内容不能超过 ${maximumMb} MB`);
  return {content:encoded, maximum_bytes:maximumBytes, encoding:selectedEncoding, line_ending:lineEnding || null, normalized_script:unixScript && lineEnding === "lf"};
}

module.exports = { prepareSftpWriteContent };
