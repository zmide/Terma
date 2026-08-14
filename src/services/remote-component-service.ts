const path = require("node:path");

const { DATA_DIR } = require("../config");
const { buildRemotePosixCommand } = require("../remote-posix");
const { createRemoteOfflineTaskManager } = require("../remote-offline-tasks");
const {
  runRemotePrivilegeCommandStreaming
} = require("../remote-privilege");
const {
  runSshCommandForConnection,
  runSshCommandForConnectionStreaming
} = require("../ssh");
const { listSftpJobs, startUploadJob } = require("../sftp-jobs");
const { diagnoseSshError } = require("../ssh-diagnostics");
const { releaseRemoteAdminGrant } = require("./remote-admin-service");

const remoteOfflineTasks = createRemoteOfflineTaskManager({
  data_dir:path.join(DATA_DIR, "remote-components"),
  run_ssh_command:runSshCommandForConnection,
  run_ssh_stream:runSshCommandForConnectionStreaming,
  run_privileged_stream:runRemotePrivilegeCommandStreaming,
  start_upload:startUploadJob,
  list_sftp_jobs:listSftpJobs,
  release_grant:releaseRemoteAdminGrant
});

function xdmcpTaskResourceKey(connection: any, request: any = {}, task: any = {}) {
  const hint = [
    request?.action,
    request?.target_action,
    request?.target,
    request?.component,
    task?.action,
    task?.component
  ].map(value => String(value || "").toLowerCase()).join(" ");
  const family = /\bx?rdp\b/.test(hint) ? "rdp-server" : "xdmcp-server";
  return `${family}:${Number(connection?.id || connection || 0)}`;
}

function normalizeVncRemoteCommandResult(result: any = {}) {
  if (result?.status === 0) return result;
  const raw = `${result?.stderr || ""}${result?.stdout || ""}${result?.error ? result.error.message || result.error : ""}`.trim();
  if (!raw) return result;
  const lower = raw.toLowerCase();
  if (/all configured authentication methods failed|no more authentication methods available|permission denied \(publickey|authentication failed/.test(lower)) {
    const diagnosis = diagnoseSshError(raw);
    return {
      ...result,
      stdout:"",
      stderr:`SSH 认证失败：临时管理员 SSH 用户名、密码、私钥或 Agent 不正确。${diagnosis.suggestions?.[0] || "请重新检查认证信息后再试。"}`,
      error:null,
      raw_error:raw
    };
  }
  if (/sudo:\s*(?:incorrect password|a password is required|authentication failure|sorry, try again)/i.test(raw)) {
    return {
      ...result,
      stdout:"",
      stderr:"sudo 认证失败：sudo 密码不正确或当前账号没有免密 sudo 权限，请重新授权后再试。",
      error:null,
      raw_error:raw
    };
  }
  return result;
}

function startRemoteComponentCommandTask({
  connection,
  component,
  componentLabel,
  action,
  actionLabel,
  mode = "online",
  command,
  before = null,
  grant = null,
  scope,
  resourceKey = "",
  timeoutMs = 20 * 60 * 1000,
  directRoot = false,
  normalizeCommand = value => value,
  normalizeResult = value => value,
  verify = null,
  validate = null
}: any) {
  const normalized = String(normalizeCommand(String(command || "")) || "").trim();
  if (!normalized) throw new Error(`${componentLabel || "远端组件"}${actionLabel || "操作"}缺少可执行命令`);
  try {
    return remoteOfflineTasks.startCommand({
      connection,
      component,
      component_label:componentLabel,
      action,
      action_label:actionLabel,
      mode,
      resource_key:resourceKey,
      before,
      run:async onChunk => normalizeResult(await (grant
        ? runRemotePrivilegeCommandStreaming(connection, normalized, {grant_id:grant.id, scope, timeout_ms:timeoutMs}, onChunk)
        : directRoot
          ? runSshCommandForConnectionStreaming(connection, buildRemotePosixCommand(normalized), timeoutMs, onChunk)
          : runRemotePrivilegeCommandStreaming(connection, normalized, {scope, timeout_ms:timeoutMs}, onChunk))),
      verify,
      validate,
      release:() => releaseRemoteAdminGrant(grant)
    });
  } catch (error) {
    releaseRemoteAdminGrant(grant);
    throw error;
  }
}

module.exports = {
  normalizeVncRemoteCommandResult,
  remoteOfflineTasks,
  startRemoteComponentCommandTask,
  xdmcpTaskResourceKey
};
