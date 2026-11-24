import {assistantServices} from '@/features/assistant/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {terminalSessions,terminalSurfaceCache} from '@/features/terminal/terminal-session-state';
import {quickTerminalConnections,releaseQuickConnectionIfUnused} from '@/features/terminal/terminal-quick-registry';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { terminalStartupOverrides } from '@/features/terminal/terminal-startup-state';
import { workspaceDockState, workspaceFindPaneForTab } from '@/features/workspace/workspace-dock-state';
import type { TerminalInteractionSession } from './terminal-interaction-service';
import type { TerminalOutputFlowSession } from './terminal-output-flow-service';
import type { TerminalTransportSession } from './terminal-transport-service';
import type { TerminalViewportSession } from './terminal-viewport-service';
import type { ZmodemRuntimeSession } from './terminal-zmodem-types';

type ClosingSession = TerminalInteractionSession & TerminalTransportSession & TerminalViewportSession & ZmodemRuntimeSession & {
  connection?: { id?: number; quick_connection?: unknown } | null;
};

export function terminalOutputSessionIsFocused(session: TerminalOutputFlowSession) {
  const key = String(session?.key || '');
  const pane = key ? workspaceFindPaneForTab(key) : null;
  return !pane || ((!workspaceDockState.focusedPaneId || pane.id === workspaceDockState.focusedPaneId) && pane.activeTabKey === key);
}

export function closeTerminalSession(key: string) {
  assistantServices.termaAssistant?.release(key);
  terminalServices.termaTerminalToolbar?.release(key);
  terminalServices.termaTerminalControls?.release(key);
  terminalServices.termaTerminalToolbarService?.status.release(key);
  terminalServices.termaTerminalSurface?.release(key);
  const surface = terminalSurfaceCache.get(key);
  if (surface) efficiencyServices.termaEfficiency?.quick.releaseSurface(surface);
  const session = terminalSessions.get(key);
  if (!session) {
    surface?.remove();
    terminalSurfaceCache.delete(key);
    return;
  }
  const quickId = session.connection?.quick_connection ? Number(session.connection.id || 0) : 0;
  terminalViewport.cancelSession(session);
  session.connectionAttempt = Number(session.connectionAttempt || 0) + 1;
  terminalServices.termaTerminalCursorCopy?.cancel(session, key);
  terminalServices.termaTerminalInteraction?.release(session);
  terminalServices.termaTerminalZmodem.close(session);
  terminalServices.termaTerminalSessionCore?.prepareClose(session, key, {forgetToken:true});
  terminalServices.termaTerminalTransport?.release(session);
  try { session.resizeDisposable?.dispose(); } catch { /* Resize tracking may already have been released by the transport. */ }
  terminalServices.termaTerminalOutputFlow?.cancel(session);
  try { session.term?.dispose(); } catch { /* An engine already disposed during a failed mount has no remaining DOM ownership. */ }
  surface?.remove();
  terminalSurfaceCache.delete(key);
  terminalSessions.delete(key);
  efficiencyServices.termaTerminalActivity?.clear(key);
  quickTerminalConnections.delete(key);
  terminalStartupOverrides.delete(key);
  if (quickId < 0) queueMicrotask(() => releaseQuickConnectionIfUnused(quickId));
}
