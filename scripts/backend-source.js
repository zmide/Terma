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

const SFTP_JOB_SOURCE_FILES = [
  "src/sftp-jobs.ts",
  "src/sftp-download-cache.ts",
  "src/sftp-download-jobs.ts",
  "src/sftp-job-paths.ts",
  "src/sftp-native-drag-jobs.ts",
  "src/sftp-operation-commands.ts",
  "src/sftp-transfer-scheduler.ts",
  "src/sftp-upload-jobs.ts"
];

function readSftpJobSource(root) {
  return readSources(root, SFTP_JOB_SOURCE_FILES);
}

function readVncManagerSource(root) {
  return readSources(root, ["src/vnc-server-manager.ts", "src/vnc-server-core.ts"]);
}

function readXdmcpManagerSource(root) {
  return readSources(root, ["src/xdmcp-manager.ts", "src/xdmcp-server-core.ts"]);
}

module.exports = {
  readBackendSource,
  readSftpJobSource,
  readSources,
  readVncManagerSource,
  readXdmcpManagerSource,
  SFTP_JOB_SOURCE_FILES
};
