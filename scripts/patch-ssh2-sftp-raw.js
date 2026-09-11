const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", "node_modules", "ssh2", "lib", "protocol", "SFTP.js");
if (!fs.existsSync(target)) throw new Error("缺少 ssh2 SFTP 实现，无法启用原始文件名字节支持");
let source = fs.readFileSync(target, "utf8");
if (source.includes("const filenameBytes = bufferParser.readString();") && source.includes("filename_bytes: filenameBytes")) process.exit(0);
const before = `        const filename = bufferParser.readString(true);\n\n        // \`longname\` only exists in SFTPv3 and since it typically will\n        // contain the filename, we assume it is also UTF-8\n        const longname = bufferParser.readString(true);`;
const after = `        const filenameBytes = bufferParser.readString();\n        const filename = filenameBytes === undefined ? undefined : filenameBytes.toString('utf8');\n\n        // \`longname\` only exists in SFTPv3 and since it typically will\n        // contain the filename, we assume it is also UTF-8\n        const longnameBytes = bufferParser.readString();\n        const longname = longnameBytes === undefined ? undefined : longnameBytes.toString('utf8');`;
if (!source.includes(before)) throw new Error("当前 ssh2 版本不支持安全应用 SFTP 原始文件名补丁");
source = source.replace(before, after).replace(
  "names.push({ filename, longname, attrs });",
  "names.push({ filename, longname, filename_bytes: filenameBytes, longname_bytes: longnameBytes, attrs });"
);
fs.writeFileSync(target, source);
