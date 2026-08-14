const iconv = require("iconv-lite");
const { buildRemotePosixCommand } = require("./remote-posix");
const { spawnSftpSessionCommand } = require("./sftp-session");

const FILENAME_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function shellQuote(value: unknown) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function filenameEncoding(connection: any) {
  const encoding = String(connection?.sftp_filename_encoding || "utf8").toLowerCase();
  return FILENAME_ENCODINGS.has(encoding) ? encoding : "utf8";
}

function remotePathOperand(connection: any, value: unknown) {
  const text = String(value || "");
  const encoding = filenameEncoding(connection);
  if (encoding === "utf8") return shellQuote(text);
  const bytes = iconv.encode(text, encoding);
  if (iconv.decode(bytes, encoding) !== text) throw new Error(`文件名包含 ${encoding} 无法表示的字符`);
  const octal = [...bytes].map((byte) => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
  return `"$(printf '%b' ${shellQuote(octal)})"`;
}

function spawnRemote(connection: any, command: string) {
  return spawnSftpSessionCommand(connection, buildRemotePosixCommand(command));
}

module.exports = { filenameEncoding, remotePathOperand, shellQuote, spawnRemote };
