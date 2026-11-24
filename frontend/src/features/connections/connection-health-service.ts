export type HealthTranslator = (key: string, options?: Record<string, unknown>) => string;
export type HealthConnection = {id?: unknown; name?: unknown; ssh_user?: unknown; ssh_host?: unknown; ssh_port?: unknown} | null | undefined;
export type HealthResult = {
  id?: unknown;
  name?: unknown;
  ssh_user?: unknown;
  ssh_host?: unknown;
  ssh_port?: unknown;
  ok?: boolean;
  status?: unknown;
  cached?: boolean;
  cache_age_ms?: unknown;
  ssh?: {ok?: boolean; diagnosis?: unknown; preserve_raw_output?: boolean; raw_output?: unknown; output?: unknown; [key: string]: unknown};
  forwards?: Array<Record<string, any>>;
};

export type HealthLocalization = {
  tr: HealthTranslator;
  localizedPhrase?: (value: string) => string;
  structuredExtraArgs?: (details: unknown) => string;
};

function identity(connection: HealthConnection, result: HealthResult = {}, tr: HealthTranslator) {
  const name = connection?.name || result.name || result.id || tr('connections:health.unknown_connection', {defaultValue: '未知连接'});
  const user = connection?.ssh_user || result.ssh_user || '';
  const host = connection?.ssh_host || result.ssh_host || '';
  const port = Number(connection?.ssh_port || result.ssh_port || 22);
  const displayHost = String(host).includes(':') && !String(host).startsWith('[') ? `[${host}]` : host;
  return user && host ? `${name} · ${user}@${displayHost}:${port}` : String(name);
}

function forwardLabel(forward: Record<string, any>, tr: HealthTranslator) {
  const modes: Record<string, string> = {
    local: tr('connections:health.local', {defaultValue: '本地'}),
    remote: tr('connections:health.remote', {defaultValue: '远程'}),
    socks: tr('connections:health.socks', {defaultValue: 'SOCKS5'})
  };
  const mode = modes[forward?.mode] || forward?.mode || tr('connections:health.forward', {defaultValue: '转发'});
  const bind = `${forward?.bind_host || '127.0.0.1'}:${Number(forward?.bind_port || 0)}`;
  if (forward?.mode === 'socks') return `${mode} #${forward.id}（${bind}）`;
  const target = `${forward?.target_host || '127.0.0.1'}:${Number(forward?.target_port || 0)}`;
  return `${mode} #${forward.id}（${bind} → ${target}）`;
}

function status(value: unknown, ok: boolean | null | undefined, localization: HealthLocalization) {
  const text = String(value || '');
  if (ok === true || text === '正常' || text === 'healthy') return localization.tr('connections:health.healthy', {defaultValue: '正常'});
  if (text === '检查失败' || text === 'check_failed') return localization.tr('connections:health.status_failed', {defaultValue: '检查失败'});
  if (ok === false || text === '异常' || text === 'abnormal') return localization.tr('connections:health.abnormal', {defaultValue: '异常'});
  return localization.localizedPhrase ? localization.localizedPhrase(text) : text;
}

function sshDiagnosis(ssh: HealthResult['ssh'], tr: HealthTranslator) {
  const diagnosis = ssh?.diagnosis && typeof ssh.diagnosis === 'object' ? ssh.diagnosis as Record<string, any> : null;
  if (!diagnosis) return '';
  const code = /^[a-z][a-z0-9_]*$/i.test(String(diagnosis.reason_code || '')) ? String(diagnosis.reason_code).toLowerCase() : 'ssh_failed';
  const reason = tr(`errors:${code}`, {defaultValue: tr('errors:ssh_failed')});
  const raw = ssh?.preserve_raw_output === true ? String(ssh.raw_output || diagnosis.message || '').trim() : '';
  return [reason, raw && raw !== reason ? raw : ''].filter(Boolean).join('\n');
}

function failureDetails(result: HealthResult, localization: HealthLocalization, authenticationFailure = false) {
  const {tr} = localization;
  const lines: string[] = [];
  if (!result.ssh?.ok) {
    const structuredIssue = localization.structuredExtraArgs ? localization.structuredExtraArgs(result.ssh) : '';
    const output = structuredIssue || sshDiagnosis(result.ssh, tr) || result.ssh?.output || tr('connections:health.connection_problem', {defaultValue: '连接异常'});
    const repair = authenticationFailure ? tr('connections:health.repair_hint', {defaultValue: '；可单独检查此连接并修复凭据'}) : '';
    lines.push(tr('connections:health.ssh_problem', {output, repair, defaultValue: `SSH：${output}${repair}`}));
  }
  for (const forward of result.forwards || []) {
    const label = forwardLabel(forward, tr);
    if (forward.reachable === false) lines.push(tr('connections:health.listener_not_ready', {label, defaultValue: `${label}：监听端口未就绪`}));
    if (forward.port_usage?.occupied) {
      const unknownProgram = tr('connections:health.unknown_program', {defaultValue: '未知程序'});
      const separator = tr('connections:health.owner_separator', {defaultValue: '、'});
      const owners = (forward.port_usage.processes || []).map((item: any) => `${item.name || unknownProgram}(${item.pid})`).join(separator) || unknownProgram;
      lines.push(tr('connections:health.listener_occupied', {label, owners, defaultValue: `${label}：监听端口被占用，${owners}`}));
    }
    if (!forward.running && forward.last_error && !forward.port_usage?.occupied) lines.push(tr('connections:health.forward_error', {label, error: forward.last_error, defaultValue: `${label}：${forward.last_error}`}));
  }
  return lines;
}

export function createConnectionHealthService() {
  return {
    identity,
    sshDiagnosis,
    forwardLabel,
    status,
    failureDetails,
    formatMessage(connection: HealthConnection, result: HealthResult, localization: HealthLocalization, authenticationFailure = false) {
      const identityText = identity(connection, result, localization.tr);
      const cache = result.cached ? localization.tr('connections:health.cached', {
        seconds: Math.round(Number(result.cache_age_ms || 0) / 1000),
        defaultValue: `（缓存 ${Math.round(Number(result.cache_age_ms || 0) / 1000)} 秒）`
      }) : '';
      const healthStatus = status(result.status, result.ok, localization);
      const lines = [localization.tr('connections:health.result', {identity: identityText, status: healthStatus, cache, defaultValue: `${identityText} 健康检查：${healthStatus}${cache}`})];
      lines.push(...failureDetails(result, localization, authenticationFailure));
      return lines.join('\n');
    },
    formatAll(results: readonly HealthResult[], connections: readonly HealthConnection[], localization: HealthLocalization, authenticationFailure: (result: HealthResult) => boolean = () => false) {
      const failed = results.filter(item => !item.ok);
      const lines = [localization.tr('connections:health.completed', {ok: results.length - failed.length, failed: failed.length, defaultValue: `健康检查完成：正常 ${results.length - failed.length} 个，异常 ${failed.length} 个`})];
      for (const result of failed) {
        const connection = connections.find(item => Number(item?.id) === Number(result.id));
        const details = failureDetails(result, localization, authenticationFailure(result));
        const identityText = identity(connection, result, localization.tr);
        const detail = details[0] || status(result.status, result.ok, localization);
        lines.push(localization.tr('connections:health.failed_item', {identity: identityText, detail, defaultValue: `${identityText}：${detail}`}));
        for (const item of details.slice(1)) lines.push(`  ${item}`);
      }
      return lines.join('\n');
    }
  };
}

const formatter = createConnectionHealthService();

export function bindConnectionHealthFormatting(
  localization: HealthLocalization, authenticationFailure: (value: unknown) => boolean,
) {
  const authenticationResult = (result: HealthResult) => result.ssh?.ok === false && authenticationFailure(result.ssh);
  return {
    identity: (connection: HealthConnection, result: HealthResult) => formatter.identity(connection, result, localization.tr),
    message: (connection: HealthConnection, result: HealthResult) => formatter.formatMessage(connection, result, localization, authenticationResult(result)),
    summary: (results: readonly HealthResult[], connections: readonly HealthConnection[]) => formatter.formatAll(results, connections, localization, authenticationResult),
    authenticationResult,
  };
}
