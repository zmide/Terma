import {sharedServices} from '@/shared/installed-services';
import {localizedBackendPublicError} from './public-errors';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import { ApiError, TermaApiClient, type ApiRequestOptions } from './client';

export interface SharedApiBridge {
  request<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
  websocketUrl(path: string): string;
  openWebSocket(path: string, protocols?: string | string[]): WebSocket;
}



function localizedMessage(error: ApiError): string {

  const raw = error.details?.error || error.message;
  return localizedBackendPublicError(error.details,String(raw||'')) || localizedTermaUiPhrase(raw) || error.message;
}

function createClient() {
  return new TermaApiClient({
    onUnauthorized: error => {
      error.message = localizedMessage(error);
      window.dispatchEvent(new CustomEvent('terma-api-unauthorized', { detail: error }));
    }
  });
}

export function installSharedApiBridge() {
  if (typeof window === 'undefined') return;
  if (sharedServices.termaSharedApi && sharedServices.termaSharedApiClient) return;
  const client = sharedServices.termaSharedApiClient || createClient();
  const bridge: SharedApiBridge = {
    request: async <T>(path: string, options: ApiRequestOptions = {}) => {
      try {
        return await client.request<T>(path, options);
      } catch (error) {
        if (error instanceof ApiError) error.message = localizedMessage(error);
        throw error;
      }
    },
    websocketUrl: path => client.websocketUrl(path),
    openWebSocket: (path, protocols) => client.openWebSocket(path, protocols)
  };
  sharedServices.termaSharedApiClient = client;
  sharedServices.termaSharedApi = bridge;
  window.dispatchEvent(new Event('terma-shared-api-ready'));
}

export interface InstalledSharedApiBridgeServices {
  termaSharedApi?: SharedApiBridge;
  termaSharedApiClient?: TermaApiClient;
}
