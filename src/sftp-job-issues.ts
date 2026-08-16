const { normalizePublicErrorCode, sanitizePublicErrorParams } = require("./public-error");

const SFTP_JOB_ISSUE_FIELDS = new Set(["error", "warning", "delivery_error"]);

function sftpJobIssueField(value: unknown) {
  const field = String(value || "");
  if (!SFTP_JOB_ISSUE_FIELDS.has(field)) throw new Error(`Unsupported SFTP job issue field: ${field}`);
  return field;
}

function clearSftpJobIssue(job: any, issueField: unknown) {
  if (!job || typeof job !== "object") return job;
  const field = sftpJobIssueField(issueField);
  job[field] = "";
  delete job[`${field}_code`];
  delete job[`${field}_params`];
  return job;
}

function setSftpJobIssue(job: any, issueField: unknown, message: unknown, code: unknown = "", params: unknown = {}) {
  if (!job || typeof job !== "object") return job;
  const field = sftpJobIssueField(issueField);
  const source = String(message || "");
  if (!source) return clearSftpJobIssue(job, field);
  job[field] = source;
  if (!code) {
    delete job[`${field}_code`];
    delete job[`${field}_params`];
    return job;
  }
  job[`${field}_code`] = normalizePublicErrorCode(code);
  const sanitizedParams = sanitizePublicErrorParams(params);
  if (Object.keys(sanitizedParams).length) job[`${field}_params`] = sanitizedParams;
  else delete job[`${field}_params`];
  return job;
}

module.exports = { clearSftpJobIssue, setSftpJobIssue };
