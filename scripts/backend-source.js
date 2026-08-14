const fs = require("node:fs");
const path = require("node:path");

function readBackendSource(root, files = []) {
  const selected = [
    "src/server.ts",
    "src/server-runtime.ts",
    ...files
  ];
  return [...new Set(selected)].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
}

function readSources(root, files) {
  return files.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
}

module.exports = { readBackendSource, readSources };
