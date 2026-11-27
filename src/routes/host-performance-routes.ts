import type {IncomingMessage, ServerResponse} from 'node:http';
import type {createHostPerformanceService} from '../services/host-performance-service';

interface PerformanceRoutePort {
  authorizeConnection(request: IncomingMessage, id: number): {id: number; [key: string]: unknown};
  requireEncryptionUnlocked(): void;
  sample: ReturnType<typeof createHostPerformanceService>['sample'];
  sendJson(response: ServerResponse, value: unknown, status?: number): void;
}
export async function handleHostPerformanceRoutes(request: IncomingMessage, response: ServerResponse,
  pathname: string, port: PerformanceRoutePort) {
  const match = pathname.match(/^\/api\/connections\/([1-9]\d*)\/host-performance$/);
  if (request.method !== 'GET' || !match) return false;
  port.requireEncryptionUnlocked();
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id)) {port.sendJson(response, {code: 'PERFORMANCE_NOT_FOUND'}, 404); return true;}
  const connection = port.authorizeConnection(request, id);
  if (!connection) {port.sendJson(response, {code: 'PERFORMANCE_NOT_FOUND'}, 404); return true;}
  const controller = new AbortController(), abort = () => controller.abort();
  request.once('aborted', abort); response.once('close', abort);
  try {
    const snapshot = await port.sample(connection, controller.signal);
    if (!response.destroyed && !controller.signal.aborted) port.sendJson(response, snapshot);
  } catch (caught) {
    const error = caught as {code?: string};
    if (!response.destroyed && !controller.signal.aborted)
      port.sendJson(response, {code: error.code === 'PERFORMANCE_BUSY' ? error.code : 'PERFORMANCE_UNAVAILABLE'}, error.code === 'PERFORMANCE_BUSY' ? 429 : 502);
  } finally {request.off('aborted', abort); response.off('close', abort);}
  return true;
}
