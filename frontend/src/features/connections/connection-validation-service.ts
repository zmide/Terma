import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
export type ConnectionValidationIssue = {
  code?: unknown;
  line?: unknown;
  start?: unknown;
  end?: unknown;
  option?: unknown;
  token?: unknown;
  message?: unknown;
  suggestion?: unknown;
  severity?: unknown;
};

export type ConnectionValidationValues = {
  extraArgs?: unknown;
  connectTimeoutSeconds?: unknown;
  keepaliveIntervalSeconds?: unknown;
  keepaliveCountMax?: unknown;
  tcpKeepalive?: unknown;
};

export type ConnectionValidationTranslator = (key: string, options?: Record<string, unknown>) => string;

export type ConnectionValidationLocalization = {
  tr: ConnectionValidationTranslator;
  localizedPhrase?: (value: string) => string;
};

function numberOr(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function buildConnectionExtraArgsValidationPayload(values: ConnectionValidationValues) {
  return {
    extra_args: String(values.extraArgs || ''),
    connect_timeout_seconds: numberOr(values.connectTimeoutSeconds || 10, 10),
    keepalive_interval_seconds: numberOr(values.keepaliveIntervalSeconds ?? 60, 60),
    keepalive_count_max: numberOr(values.keepaliveCountMax || 3, 3),
    tcp_keepalive: numberOr(values.tcpKeepalive ?? 1, 1)
  };
}

export function localizeConnectionExtraArgsIssue(
  item: ConnectionValidationIssue = {},
  localization: ConnectionValidationLocalization
) {
  const {tr, localizedPhrase} = localization;
  const code = String(item.code || '');
  const optionSource = item.option || item.token || tr('connections:validation.additional_args', {defaultValue: '附加参数'});
  const option = localizedPhrase ? localizedPhrase(String(optionSource)) : String(optionSource);
  const token = String(item.token || item.option || '');
  const quote = String(item.message || '').match(/(["']) 引号/)?.[1] || '"';
  const currentValue = String(item.message || '').match(/（当前：(.+?)）/)?.[1] || '';
  const current = currentValue
    ? tr('connections:validation.current_suffix', {value: currentValue, defaultValue: `（当前：${currentValue}）`})
    : '';
  const values = {option, token, quote, current};
  const defaultMessage = String(item.message || tr('connections:validation.invalid_parameter', {defaultValue: '参数无效'}));
  const handlers: Record<string, () => {message: string; suggestion: string}> = {
    SSH_EXTRA_ARGS_UNCLOSED_QUOTE: () => ({
      message: tr('connections:validation.messages.unclosed_quote', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.unclosed_quote', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_DUPLICATES_STRUCTURED_FIELD: () => ({
      message: tr('connections:validation.messages.duplicate_structured', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.duplicate_structured', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_MISSING_OPTION_VALUE: () => ({
      message: tr('connections:validation.messages.missing_option_value', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.missing_option_value', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_HOST_TRUST_MANAGED: () => ({
      message: tr('connections:validation.messages.host_trust_managed', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.host_trust_managed', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_OPTION_NOT_ALLOWED: () => ({
      message: tr('connections:validation.messages.option_not_allowed', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.option_not_allowed', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_POSITIONAL_TOKEN: () => ({
      message: tr('connections:validation.messages.positional_token', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.positional_token', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_MISSING_ARGUMENT: () => ({
      message: tr('connections:validation.messages.missing_argument', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.missing_argument', {...values, defaultValue: String(item.suggestion || '')})
    }),
    SSH_EXTRA_ARGS_SHORT_OPTION_NOT_ALLOWED: () => ({
      message: tr('connections:validation.messages.short_option_not_allowed', {...values, defaultValue: defaultMessage}),
      suggestion: tr('connections:validation.suggestions.short_option_not_allowed', {...values, defaultValue: String(item.suggestion || '')})
    })
  };
  const localized = handlers[code]?.();
  const message = localized?.message || (localizedPhrase ? localizedPhrase(defaultMessage) : defaultMessage);
  const suggestion = localized?.suggestion || (localizedPhrase ? localizedPhrase(String(item.suggestion || '')) : String(item.suggestion || ''));
  return {option, message, suggestion};
}

export function localizeConnectionExtraArgsError(
  details: {issues?: ConnectionValidationIssue[]} | ConnectionValidationIssue[] = {},
  localization: ConnectionValidationLocalization
) {
  const {tr} = localization;
  const issues = Array.isArray(details) ? details : Array.isArray(details.issues) ? details.issues : [];
  if (!issues.length) return '';
  const heading = tr('connections:validation.invalid_summary', {
    count: issues.length,
    defaultValue: `SSH 附加参数有 ${issues.length} 处需要修正：`
  });
  const rows = issues.map(item => {
    const localized = localizeConnectionExtraArgsIssue(item, localization);
    const lineNumber = Number(item.line || 1);
    const line = tr('connections:validation.line_label', {
      line: lineNumber,
      option: localized.option,
      defaultValue: `第 ${lineNumber} 行 · ${localized.option}`
    });
    const severity = item.severity === 'warning'
      ? tr('connections:validation.reminder', {defaultValue: '提醒'})
      : tr('connections:validation.problem', {defaultValue: '问题'});
    const suggestion = localized.suggestion
      ? tr('connections:validation.suggestion_suffix', {suggestion: localized.suggestion, defaultValue: `；建议：${localized.suggestion}`})
      : '';
    return tr('connections:validation.issue_row', {
      line,
      severity,
      message: localized.message,
      suggestion,
      defaultValue: `${line}（${severity}）：${localized.message}${suggestion}`
    });
  });
  return [heading, ...rows].join('\n');
}

export type ConnectionValidationService = {
  buildPayload: (values: ConnectionValidationValues) => ReturnType<typeof buildConnectionExtraArgsValidationPayload>;
  localizeIssue: typeof localizeConnectionExtraArgsIssue;
  localizeError: typeof localizeConnectionExtraArgsError;
  formatError(details: unknown): string;
};

export function createConnectionValidationService(): ConnectionValidationService {
  return {
    buildPayload: buildConnectionExtraArgsValidationPayload,
    localizeIssue: localizeConnectionExtraArgsIssue,
    localizeError: localizeConnectionExtraArgsError,
    formatError(details) {
      const values = Array.isArray(details) ? details : (details as {issues?: unknown} | null)?.issues;
      const issues = Array.isArray(values) ? values.filter(item => item && typeof item === 'object') : [];
      return localizeConnectionExtraArgsError(issues, {tr, localizedPhrase: localizedTermaUiPhrase});
    }
  };
}

export function installConnectionValidationService() {
  if (!connectionsServices.termaConnectionValidationService) connectionsServices.termaConnectionValidationService = createConnectionValidationService();
}



export interface InstalledFeaturesConnectionsConnectionValidationServiceServices {
  termaConnectionValidationService?: ConnectionValidationService;
}
