export const DEFAULT_PUBLIC_ERROR_CODE = "request_failed";

const PUBLIC_ERROR_CODE_MAX_LENGTH = 80;
const PUBLIC_ERROR_PARAM_MAX_ENTRIES = 16;
const PUBLIC_ERROR_PARAM_MAX_STRING_LENGTH = 256;
const PUBLIC_ERROR_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const PUBLIC_ERROR_PARAM_KEY = /^[a-z][a-z0-9_]{0,47}$/;
const BLOCKED_PUBLIC_ERROR_PARAM_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SENSITIVE_PUBLIC_ERROR_PARAM_KEY = /(?:^|_)(?:auth|authorization|cookie|credential|hash|key|pass|passphrase|password|salt|secret|session|token)(?:_|$)/i;

export type PublicErrorParam = string | number | boolean | null;
export type PublicErrorParams = Record<string, PublicErrorParam>;

export interface TermaPublicError extends Error {
  code: string;
  publicCode: string;
  publicParams?: PublicErrorParams;
  preserveMessage?: boolean;
  statusCode?: number;
}

export interface PublicErrorDetails {
  code: string;
  params: PublicErrorParams;
  preserveMessage: boolean;
}

export interface PublicErrorBody {
  error: string;
  code: string;
  error_code: string;
  error_params?: PublicErrorParams;
}

function publicErrorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizedPublicErrorCode(value: unknown): string {
  const source = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!source || source.length > PUBLIC_ERROR_CODE_MAX_LENGTH) return "";
  if (!/^[a-z][a-z0-9_.-]*$/i.test(source)) return "";
  const normalized = source
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!normalized || normalized.length > PUBLIC_ERROR_CODE_MAX_LENGTH) return "";
  if (!PUBLIC_ERROR_CODE.test(normalized)) return "";
  if (BLOCKED_PUBLIC_ERROR_PARAM_KEYS.has(normalized)) return "";
  return normalized;
}

export function normalizePublicErrorCode(value: unknown, fallback: unknown = DEFAULT_PUBLIC_ERROR_CODE): string {
  return normalizedPublicErrorCode(value)
    || normalizedPublicErrorCode(fallback)
    || DEFAULT_PUBLIC_ERROR_CODE;
}

function sanitizedPublicErrorString(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized.slice(0, PUBLIC_ERROR_PARAM_MAX_STRING_LENGTH);
}

export function sanitizePublicErrorParams(value: unknown): PublicErrorParams {
  const source = publicErrorRecord(value);
  const result: PublicErrorParams = {};
  if (!source) return result;
  for (const [key, item] of Object.entries(source)) {
    if (Object.keys(result).length >= PUBLIC_ERROR_PARAM_MAX_ENTRIES) break;
    if (!PUBLIC_ERROR_PARAM_KEY.test(key)) continue;
    if (BLOCKED_PUBLIC_ERROR_PARAM_KEYS.has(key) || SENSITIVE_PUBLIC_ERROR_PARAM_KEY.test(key)) continue;
    if (typeof item === "string") {
      result[key] = sanitizedPublicErrorString(item);
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
      continue;
    }
    if (typeof item === "boolean") {
      result[key] = item;
      continue;
    }
    if (item === null) result[key] = null;
  }
  return result;
}

export function publicErrorDetails(error: unknown, fallbackCode?: unknown): PublicErrorDetails {
  const source = publicErrorRecord(error);
  const explicitCode = normalizedPublicErrorCode(source?.publicCode ?? source?.public_code ?? source?.errorCode ?? source?.error_code);
  const fallback = normalizedPublicErrorCode(fallbackCode);
  const legacyCode = normalizedPublicErrorCode(source?.code);
  const params = sanitizePublicErrorParams(
    source?.publicParams ?? source?.public_params ?? source?.errorParams ?? source?.error_params
  );
  return {
    code: explicitCode || fallback || legacyCode || DEFAULT_PUBLIC_ERROR_CODE,
    params,
    preserveMessage:source?.preserveMessage === true || source?.preserve_message === true
  };
}

export function publicError(code: unknown, message: unknown, params?: unknown, statusCode?: unknown): TermaPublicError {
  const normalizedCode = normalizePublicErrorCode(code);
  const error = new Error(String(message || "请求失败")) as TermaPublicError;
  error.name = "TermaPublicError";
  error.code = normalizedCode.toUpperCase();
  error.publicCode = normalizedCode;
  const sanitizedParams = sanitizePublicErrorParams(params);
  if (Object.keys(sanitizedParams).length) error.publicParams = sanitizedParams;
  const normalizedStatus = Number(statusCode);
  if (Number.isInteger(normalizedStatus) && normalizedStatus >= 400 && normalizedStatus <= 599) {
    error.statusCode = normalizedStatus;
  }
  return error;
}

export function publicErrorBody(code: unknown, message: unknown, params?: unknown): PublicErrorBody {
  const normalizedCode = normalizePublicErrorCode(code);
  const body: PublicErrorBody = {
    error:String(message || "请求失败"),
    code:normalizedCode.toUpperCase(),
    error_code:normalizedCode
  };
  const sanitizedParams = sanitizePublicErrorParams(params);
  if (Object.keys(sanitizedParams).length) body.error_params = sanitizedParams;
  return body;
}

export function remoteOutputError(message: unknown): TermaPublicError {
  const error = publicError("REMOTE_OUTPUT", message || "远端命令执行失败");
  error.preserveMessage = true;
  return error;
}

export const createPublicError = publicError;
