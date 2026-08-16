const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceFiles = [
  "src/sftp-jobs.ts",
  "src/sftp-download-jobs.ts",
  "src/sftp-upload-jobs.ts",
  "src/sftp-native-drag-jobs.ts",
  "src/sftp-checkpoint-transfers.ts",
  "src/sftp-transfer-scheduler.ts"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function placeholders(value) {
  return [...String(value || "").matchAll(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi)]
    .map(match => match[1])
    .sort();
}

const sources = sourceFiles.map(read).join("\n");
const zhTasks = json("public/locales/zh-CN/tasks.json");
const enTasks = json("public/locales/en-US/tasks.json");
const zhSftp = json("public/locales/zh-CN/sftp.json");
const enSftp = json("public/locales/en-US/sftp.json");
const issueCodes = new Set([...sources.matchAll(/["'](sftp_[a-z0-9_]+)["']/g)].map(match => match[1]));

for (const code of issueCodes) {
  assert.equal(typeof zhTasks.job_issues?.[code], "string", `Missing zh-CN SFTP job issue: ${code}`);
  assert.equal(typeof enTasks.job_issues?.[code], "string", `Missing en-US SFTP job issue: ${code}`);
  assert.deepEqual(
    placeholders(enTasks.job_issues[code]),
    placeholders(zhTasks.job_issues[code]),
    `SFTP job issue placeholders differ: ${code}`
  );
  assert.doesNotMatch(enTasks.job_issues[code], /[\u3400-\u9fff]/, `English SFTP job issue contains Chinese: ${code}`);
}

const directIssueAssignment = /(?:job|current)\.(?:error|warning|delivery_error)\s*=/g;
assert.doesNotMatch(sources, directIssueAssignment, "SFTP task issues must use the structured issue helper");

const requiredTaskPhrases = [
  "move_items",
  "extract_file",
  "compress_items_as",
  "download_file_local",
  "download_items_local",
  "drag_file_local",
  "drag_items_local",
  "state_preparing_download",
  "state_downloading_local",
  "state_received_items",
  "state_saved_local",
  "state_downloading_archive",
  "state_downloading",
  "state_archive_done",
  "state_download_done",
  "state_generating_archive",
  "state_generating_stable_archive",
  "state_archive_ready",
  "state_resuming_archive",
  "state_regenerating_archive",
  "state_resuming_download",
  "state_uploading",
  "state_receiving_file",
  "state_waiting_upload_slot",
  "state_waiting_download_slot",
  "state_resuming_upload",
  "state_system_saving",
  "state_waiting_scan",
  "state_scanning_source",
  "state_resuming_cross_copy",
  "state_transferring_files",
  "state_committing_target",
  "state_cross_copy_done"
];

for (const key of requiredTaskPhrases) {
  assert.equal(typeof zhSftp.task_ui?.[key], "string", `Missing zh-CN SFTP task phrase: ${key}`);
  assert.equal(typeof enSftp.task_ui?.[key], "string", `Missing en-US SFTP task phrase: ${key}`);
  assert.deepEqual(placeholders(enSftp.task_ui[key]), placeholders(zhSftp.task_ui[key]), `SFTP task phrase placeholders differ: ${key}`);
  assert.doesNotMatch(enSftp.task_ui[key], /[\u3400-\u9fff]/, `English SFTP task phrase contains Chinese: ${key}`);
}

const frontend = read("public/app-sftp-tasks.js");
assert.match(frontend, /function localizedSftpTaskMessage\(/);
assert.match(frontend, /function localizedSftpJobIssue\(/);
assert.match(frontend, /tasks:job_issues\./);
assert.doesNotMatch(frontend, /String\(job\.(?:error|warning|delivery_error)\)/, "SFTP task cards must not render raw fixed-language issue fields directly");

const compiledHelper = path.join(root, "dist", "sftp-job-issues.js");
if (fs.existsSync(compiledHelper)) {
  const { clearSftpJobIssue, setSftpJobIssue } = require(compiledHelper);
  const job = {};
  setSftpJobIssue(job, "error", "fixed message", "SFTP_USER_CANCELLED", {actual:7, password:"secret", nested:{value:1}});
  assert.equal(job.error_code, "sftp_user_cancelled");
  assert.deepEqual(job.error_params, {actual:7});
  setSftpJobIssue(job, "error", "remote stderr");
  assert.equal(job.error, "remote stderr");
  assert.equal(Object.hasOwn(job, "error_code"), false, "Raw remote output must not inherit a stale translation code");
  clearSftpJobIssue(job, "error");
  assert.equal(job.error, "");
  assert.equal(Object.hasOwn(job, "error_params"), false);
}

console.log(`SFTP job i18n check passed: ${issueCodes.size} structured issues and ${requiredTaskPhrases.length} task phrases`);
