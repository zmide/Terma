const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", "node_modules", "ssh2", "lib", "protocol", "SFTP.js");
if (!fs.existsSync(target)) throw new Error("缺少 ssh2 SFTP 实现，无法启用原始文件名字节支持");
let source = fs.readFileSync(target, "utf8");
const originalSource = source;
const before = `        const filename = bufferParser.readString(true);\n\n        // \`longname\` only exists in SFTPv3 and since it typically will\n        // contain the filename, we assume it is also UTF-8\n        const longname = bufferParser.readString(true);`;
const after = `        const filenameBytes = bufferParser.readString();\n        const filename = filenameBytes === undefined ? undefined : filenameBytes.toString('utf8');\n\n        // \`longname\` only exists in SFTPv3 and since it typically will\n        // contain the filename, we assume it is also UTF-8\n        const longnameBytes = bufferParser.readString();\n        const longname = longnameBytes === undefined ? undefined : longnameBytes.toString('utf8');`;
if (!source.includes("filename_bytes: filenameBytes")) {
  if (!source.includes(before)) throw new Error("当前 ssh2 版本不支持安全应用 SFTP 原始文件名补丁");
  source = source.replace(before, after).replace(
    "names.push({ filename, longname, attrs });",
    "names.push({ filename, longname, filename_bytes: filenameBytes, longname_bytes: longnameBytes, attrs });"
  );
}
// ssh2 normally forces every path through UTF-8, even when given a Buffer.
// Only path fields change: handles, file contents and protocol fields stay intact.
if (!source.includes("function termaWriteSftpPath(")) {
  const pathWrites = /buf\.utf8Write\((path|filename|oldPath|newPath|targetPath|linkPath), (p \+= 4|p), (pathLen|fnameLen|oldLen|newLen|targetLen|linkLen|len)\)/g;
  let replacements = 0;
  source = source.replace(pathWrites, (_match, value, offset, length) => {
    replacements += 1;
    return `termaWriteSftpPath(buf, ${value}, ${offset}, ${length})`;
  });
  if (replacements !== 24) throw new Error("当前 ssh2 路径序列化实现与预期不符");
  source += `\nfunction termaWriteSftpPath(buffer, value, offset, length) {\n  if (Buffer.isBuffer(value)) return value.copy(buffer, offset, 0, length);\n  return buffer.utf8Write(value, offset, length);\n}\n`;
}
// Keep the existing string result; expose exact bytes as an optional third
// callback argument for per-connection realpath/readlink decoding.
source = source.replaceAll("cb(undefined, names[0].filename);", "cb(undefined, names[0].filename, names[0].filename_bytes);");
if ((source.match(/termaWriteSftpPath\(buf,/g) || []).length !== 24) throw new Error("SFTP 原始路径补丁不完整");
if (source !== originalSource) fs.writeFileSync(target, source);
