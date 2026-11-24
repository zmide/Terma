import {sharedServices} from '@/shared/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import { installSharedApiBridge } from '../../shared/api/bridge';
import type { ApiRequestOptions } from '../../shared/api/client';

export interface TrustedHost {
  id: string;
  host?: string;
  port?: number;
  host_label?: string;
  key_type?: string;
  fingerprint?: string;
  updated_at?: number | string;
}

export interface SettingsTrustedHostsResponse {
  hosts?: TrustedHost[];
  page?: number;
  page_size?: number;
  total?: number;
  total_pages?: number;
  [key: string]: unknown;
}

interface CacheUsage { bytes?: number; reclaimable_bytes?: number; busy?: boolean }
export interface ProgramCacheUsage extends CacheUsage {
  retained_bytes?: number;
  categories?: Record<string, CacheUsage>;
}

export interface SettingsSnapshot {
  security: any;
  trustedHosts: SettingsTrustedHostsResponse;
  about: any;
  runtime: any;
  desktop: any;
  cache: ProgramCacheUsage;
}

export interface SettingsService {
  request<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
  loadSnapshot(options?: { trustedPage?: number; trustedPageSize?: number; trustedQuery?: string }): Promise<SettingsSnapshot>;
  loadSecurity(): Promise<any>;
  loadTrustedHosts(page?: number, pageSize?: number, query?: string): Promise<SettingsTrustedHostsResponse>;
  loadAbout(): Promise<any>;
  loadRuntime(): Promise<any>;
  loadDesktop(): Promise<any>;
  loadCache(): Promise<ProgramCacheUsage>;
  saveSecurity(payload: Record<string, unknown>): Promise<any>;
  saveRuntime(payload: Record<string, unknown>): Promise<any>;
  saveDesktop(payload: Record<string, unknown>): Promise<any>;
  clearCache(category?: string): Promise<ProgramCacheUsage>;
}



export const trustedHostsPath = '/api/ssh/trusted-hosts';
export const programCachePath = (category = '') => `/api/cache${category ? `?category=${encodeURIComponent(category)}` : ''}`;

export function queryTrustedHosts(page: number, pageSize: number, query: string) {
  return `${trustedHostsPath}?page=${Math.max(1, Number(page) || 1)}&page_size=${Math.max(1, Number(pageSize) || 5)}&q=${encodeURIComponent(String(query || '').trim())}`;
}

export function createSettingsService(): SettingsService {
  installSharedApiBridge();
  const request = <T = unknown>(path: string, options: ApiRequestOptions = {}) => {
    const bridge = sharedServices.termaSharedApi;
    if (!bridge) throw new Error('Terma shared API is not ready');
    return bridge.request<T>(path, options);
  };
  const service: SettingsService = {
    request,
    loadSecurity: () => request('/api/security'),
    loadTrustedHosts: (page = 1, pageSize = 5, query = '') => request(queryTrustedHosts(page, pageSize, query), { headers: { 'X-Terma-Host-Trust-Skip': '1' } }),
    loadAbout: () => request('/api/about'),
    loadRuntime: () => request('/api/runtime-settings'),
    loadDesktop: async () => {
      try { return await request('/api/desktop-settings'); }
      catch { return { available: false }; }
    },
    loadCache: () => request(programCachePath()),
    saveSecurity: payload => request('/api/security', { method: 'PUT', body: payload }),
    saveRuntime: payload => request('/api/runtime-settings', { method: 'PUT', body: payload }),
    saveDesktop: payload => request('/api/desktop-settings', { method: 'PUT', body: payload }),
    clearCache: category => request(programCachePath(category), { method: 'DELETE' }),
    async loadSnapshot(options = {}) {
      const page = Math.max(1, Number(options.trustedPage) || 1);
      const pageSize = Math.max(1, Number(options.trustedPageSize) || 5);
      const query = String(options.trustedQuery || '').trim();
      const [security, trustedHosts, about, runtime, desktop, cache] = await Promise.all([
        this.loadSecurity(),
        this.loadTrustedHosts(page, pageSize, query),
        this.loadAbout(),
        this.loadRuntime(),
        this.loadDesktop(),
        this.loadCache()
      ]);
      return { security, trustedHosts, about, runtime, desktop, cache };
    }
  };
  return service;
}

export function installSettingsService() {
  if (typeof window === 'undefined') return;
  if (!settingsServices.termaSettingsService) {
    settingsServices.termaSettingsService = createSettingsService();
    window.dispatchEvent(new Event('terma-settings-service-ready'));
  }
}

export interface InstalledFeaturesSettingsSettingsServiceServices {
  termaSettingsService?: SettingsService;
}
