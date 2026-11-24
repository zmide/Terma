import { IncomingMessage } from 'node:http';
import { publicError } from '../public-error';
const security = require('../security');

export function assertServerFilesAccess(request: IncomingMessage): void {
  const local = process.env.TERMA_DISTRIBUTION !== 'fnos' && security.isDirectLoopbackRequest(request) && !security.authRequired(request);
  if (!local && !security.hasAuthenticatedWebSession(request) && !security.isDesktopRequest(request)) {
    throw publicError('SERVER_FILES_LOGIN_REQUIRED', '请先登录 Terma，再访问设备目录', {}, 403);
  }
}
