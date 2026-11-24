import { createDirectoryCache } from './directory-cache';
import { createDirectoryLoader } from './directory-loader';
import { createDirectoryNavigation } from './directory-navigation';
import { createDirectoryRequests } from './directory-requests';
import { directoryKey, joinRemotePath, parentRemotePath } from './directory-state';

interface DirectoryWorkspacePort {
  cache: Parameters<typeof createDirectoryCache>[0];
  http: Parameters<typeof createDirectoryRequests>[0];
  loader: Omit<Parameters<typeof createDirectoryLoader>[0], 'request' | 'history'>;
  navigation: Omit<Parameters<typeof createDirectoryNavigation>[0], 'load'>;
}

export function createSftpDirectoryWorkspace(port: DirectoryWorkspacePort) {
  const requests = createDirectoryRequests(port.http);
  const cache = createDirectoryCache(port.cache);
  const loader = createDirectoryLoader({
    ...port.loader,
    request: requests.request,
    history: (...args) => navigation.remember(...args)
  });
  const navigation = createDirectoryNavigation({ ...port.navigation, load: options => loader.load(options) });
  return { cache, navigation, request: requests.request, loader,
    path: { directoryKey, joinRemotePath, parentRemotePath } };
}



export interface InstalledFeaturesFilesSftpDirectoryWorkspaceServices {
  termaSftpDirectoryWorkspace: ReturnType<typeof createSftpDirectoryWorkspace>;
}
