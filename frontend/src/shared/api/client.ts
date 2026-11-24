export interface AuthStatus {
  authenticated?: boolean;
  auth_required?: boolean;
  [key: string]: unknown;
}

export interface ApiErrorPayload {
  error?: string;
  error_code?: string;
  error_params?: Record<string, unknown>;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicCode: string;
  readonly details: ApiErrorPayload;

  constructor(message: string, status: number, details: ApiErrorPayload = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = String(details.code || '');
    this.publicCode = String(details.error_code || '');
    this.details = details;
  }
}

type RequestBody = BodyInit | Record<string, unknown> | unknown[];

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: RequestBody;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: (error: ApiError) => void;
}

function defaultBaseUrl() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function isJsonBody(body: RequestBody | undefined): body is Record<string, unknown> | unknown[] {
  if (!body || typeof body !== 'object') return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return false;
  return !(body instanceof URLSearchParams);
}

function joinUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!baseUrl) return path;
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

export async function readApiPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return {error: text || response.statusText}; }
}

export function sendApiRequest(fetchImpl: typeof fetch, path: string, options: ApiRequestOptions, rawBody = true) {
  const headers = new Headers(options.headers);
  const {body, ...requestOptions} = options;
  const request: RequestInit = {...requestOptions, credentials: options.credentials || 'same-origin', headers};
  if (!rawBody || isJsonBody(body)) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  if (body !== undefined) request.body = isJsonBody(body) ? JSON.stringify(body) : body;
  return fetchImpl(path, request);
}

export class TermaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthorized?: (error: ApiError) => void;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = String(options.baseUrl || defaultBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const response = await sendApiRequest(this.fetchImpl, joinUrl(this.baseUrl, path), options);
    const data = await readApiPayload(response);
    if (!response.ok) {
      const details = (data && typeof data === 'object' ? data : {}) as ApiErrorPayload;
      const error = new ApiError(String(details.error || response.statusText || 'Request failed'), response.status, details);
      if (response.status === 401) this.onUnauthorized?.(error);
      throw error;
    }
    return data as T;
  }

  authStatus() {
    return this.request<AuthStatus>('/api/auth/status');
  }

  login(password: string) {
    return this.request<{ok: boolean}>('/api/auth/login', { method: 'POST', body: { password } });
  }

  logout() {
    return this.request<{ok: boolean}>('/api/auth/logout', { method: 'POST', body: {} });
  }

  websocketUrl(path: string) {
    const base = this.baseUrl || (typeof window === 'undefined' ? '' : window.location.origin);
    if (!base) throw new Error('WebSocket URL requires a browser origin or API base URL');
    const url = new URL(joinUrl(base, path));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  openWebSocket(path: string, protocols?: string | string[]) {
    if (typeof WebSocket === 'undefined') throw new Error('WebSocket is unavailable in this runtime');
    return new WebSocket(this.websocketUrl(path), protocols);
  }
}

export const termaApi = new TermaApiClient();
