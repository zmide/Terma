"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceFile = path.join(root, "node_modules", "zmodem.js", "dist", "zmodem.devel.js");
const targetFile = path.join(root, "public", "vendor", "zmodem.js");

if (!fs.existsSync(sourceFile)) throw new Error("缺少 zmodem.js 浏览器运行时，请先执行 npm ci");

const source = fs.readFileSync(sourceFile, "utf8");
const noisyStatements = [
  'console.log("consuming", octets);',
  '            console.log( this.type, "SENDING HEADER", bytes_hdr[1] );'
];
let cleaned = source;
let removed = 0;
for (const statement of noisyStatements) {
  const matches = cleaned.split(statement).length - 1;
  removed += matches;
  cleaned = cleaned.split(statement).join("");
}
if (removed !== 3) throw new Error(`zmodem.js 浏览器运行时结构已变化，预期移除 3 处调试输出，实际 ${removed} 处`);

const header = "/* zmodem.js 0.1.10, Apache-2.0; generated from the installed package. */\n";
fs.mkdirSync(path.dirname(targetFile), { recursive:true });
fs.writeFileSync(targetFile, header + cleaned, "utf8");
