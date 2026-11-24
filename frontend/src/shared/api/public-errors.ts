import {sharedServices} from '@/shared/installed-services';
export interface PublicErrorPayload {
  error?: unknown;
  error_code?: unknown;
  error_params?: unknown;
  preserve_error_message?: unknown;
  code?: unknown;
  connection_id?: unknown;
  connection_name?: unknown;
  remote_profile_id?: unknown;
  remote_profile_name?: unknown;
}

export interface PublicErrorPort {
  language(): string;
  hasTranslation(key: string, language: string): boolean;
  translate(key: string, options: Record<string, unknown>): string;
  preserve(source: string): string;
  legacyMessage(value: unknown): string;
}

export interface PublicApiError extends Error {
  code: unknown;
  publicCode: string;
  preserveMessage: boolean;
  status: number;
  details: unknown;
  connectionId: number;
  connectionName: string;
  remoteProfileId: number;
  remoteProfileName: string;
}

const MAX_CODE_LENGTH = 80;
const MAX_PARAM_ENTRIES = 16;
const MAX_PARAM_STRING_LENGTH = 256;
const PARAM_KEY = /^[a-z][a-z0-9_]{0,47}$/;
const SENSITIVE_PARAM_KEY = /(?:^|_)(?:auth|authorization|cookie|credential|hash|key|pass|passphrase|password|salt|secret|session|token)(?:_|$)/i;

export function normalizeBackendPublicErrorCode(value: unknown): string {
  const source = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!source || source.length > MAX_CODE_LENGTH || !/^[a-z][a-z0-9_.-]*$/i.test(source)) return '';
  const normalized = source
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalized) && !['constructor', 'prototype'].includes(normalized)
    ? normalized
    : '';
}

export function backendPublicErrorParams(value: unknown): Record<string, string | number | boolean | null> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(source)) {
    if (Object.keys(result).length >= MAX_PARAM_ENTRIES) break;
    if (!PARAM_KEY.test(key) || ['constructor', 'prototype'].includes(key) || SENSITIVE_PARAM_KEY.test(key)) continue;
    if (typeof item === 'string') {
      result[key] = item.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_PARAM_STRING_LENGTH);
    } else if (typeof item === 'number' && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === 'boolean' || item === null) {
      result[key] = item;
    }
  }
  return result;
}

export function createPublicErrors(port: PublicErrorPort) {
  function message(value: unknown, rawMessage: unknown): string {
    const data = (value || {}) as PublicErrorPayload;
    if (data.preserve_error_message === true && rawMessage) return port.preserve(String(rawMessage));
    const code = normalizeBackendPublicErrorCode(data.error_code);
    const params = backendPublicErrorParams(data.error_params);
    const key = code ? `errors:backend.${code}` : '';
    const language = port.language();
    if (key && port.hasTranslation(key, language)) {
      return port.translate(key, {...params, lng: language, fallbackLng: false, defaultValue: ''});
    }
    const legacyMessage = port.legacyMessage(rawMessage);
    if (language !== 'en-US') return legacyMessage || String(rawMessage || '');
    if (!code && legacyMessage && !/[\u3400-\u9fff]/.test(legacyMessage)) return legacyMessage;
    return port.translate('errors:backend.request_failed', {
      lng: 'en-US', fallbackLng: false, defaultValue: 'The request failed. Try again.'
    });
  }

  function create(value: unknown, text: string, status: number, connectionId = 0): PublicApiError {
    const data = (value || {}) as PublicErrorPayload;
    return Object.assign(new Error(text), {
      code: data.code || '',
      publicCode: normalizeBackendPublicErrorCode(data.error_code),
      preserveMessage: data.preserve_error_message === true,
      status: Number(status || 0),
      details: value,
      connectionId: Number(data.connection_id || connectionId || 0),
      connectionName: String(data.connection_name || ''),
      remoteProfileId: Number(data.remote_profile_id || 0),
      remoteProfileName: String(data.remote_profile_name || '')
    });
  }

  async function fromResponse(response: Response, fallbackMessage = ''): Promise<PublicApiError> {
    const text = await response.text().catch(() => '');
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = {error: text}; }
    const rawMessage = (data as PublicErrorPayload | null)?.error || text || fallbackMessage || response.statusText;
    return create(data, message(data, rawMessage), response.status);
  }

  return {message, create, fromResponse, normalizeCode: normalizeBackendPublicErrorCode, params: backendPublicErrorParams};
}

export function installPublicErrors(port:PublicErrorPort) {
  if (!sharedServices.termaPublicErrors) {
    sharedServices.termaPublicErrors = createPublicErrors(port);
  }
}




export const localizedBackendPublicError=(...args:Parameters<ReturnType<typeof createPublicErrors>['message']>)=>sharedServices.termaPublicErrors.message(...args);
export const apiErrorFromResponse=(...args:Parameters<ReturnType<typeof createPublicErrors>['fromResponse']>)=>sharedServices.termaPublicErrors.fromResponse(...args);

export interface InstalledSharedApiPublicErrorsServices {
  termaPublicErrors: ReturnType<typeof createPublicErrors>;
}
