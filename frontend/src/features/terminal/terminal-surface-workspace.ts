import {terminalServices} from '@/features/terminal/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {terminalLibraries} from './terminal-libraries';
import {terminalDrop} from './terminal-drop-workspace';
import * as terminalMetadata from './terminal-metadata';
import {isMobileLayout} from '@/shared/browser-ui';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {terminalSessions,terminalSurfaceCache,type TerminalSession} from './terminal-session-state';
import type {TerminalSurfacePort} from './terminal-surface-service';
import {bindTerminalInterruptKey} from './terminal-engine-view';
import {connectTerminal,terminalSessionNeedsAutomaticConnection,terminalSessionConnectionStatus,updateTerminalConnectionStatus} from './terminal-connection-runtime';
import {createTerminalLogId} from './terminal-identity';
type Connection=TerminalSession['connection'];
export const terminalSurfacePort:TerminalSurfacePort = {
  get sessions() { return terminalSessions; },
  get surfaces() { return terminalSurfaceCache; },
  ensureSettings:() => terminalServices.termaTerminalSettings!.ensure(),
  ensureLibraries:() => terminalLibraries.ensure(),
  ensureZmodem:() => terminalServices.termaTerminalZmodem!.ensureLibrary(),
  settings:() => terminalServices.termaTerminalSettings!.current(),
  term:options => terminalLibraries.terminal(options),
  fit:term => terminalServices.termaTerminalViewport!.adaptFitAddon(term,terminalLibraries.fit()),
  token:(key, enabled) => terminalServices.termaTerminalSessionCore!.tokenForKey(key, enabled),
  logId:() => createTerminalLogId(),
  mobile:() => isMobileLayout(),
  active:() => applicationState.activeTabKey,
  modalOpen:() => $("modal")?.hidden === false,
  workspaceElement: (key, selector) => workspaceServices.termaWorkspacePaneScope!.workspaceElementForTab(key, selector),
  mount:key => terminalServices.termaTerminalSurface?.element(key, "#terminalMount"),
  retained:mount => Boolean(workspaceServices.termaWorkspaceViews?.retains(mount)),
  connection:id => connectionsServices.termaConnectionController?.current(id) as Connection|null,
  fontFamily:connection => terminalMetadata.terminalFontFamilyForConnection(connection),
  fontSize:connection => terminalMetadata.terminalFontSizeForCurrentLayout(connection),
  wordSeparator:() => terminalServices.termaTerminalSettingsModel!.wordSeparator(terminalServices.termaTerminalSettings!.current()),
  theme:() => terminalServices.termaTerminalSettingsModel!.theme(terminalServices.termaTerminalSettings!.current()),
  interrupt:(term, key) => bindTerminalInterruptKey(term, key),
  directory:session => terminalServices.termaTerminalDirectory!.register(session),
  apply:session => terminalServices.termaTerminalSettings!.apply(session),
  bind:(session, connection, key, mount) => {
    terminalDrop.bind(session,mount);
    terminalServices.termaTerminalInteraction!.bind(session, key, connection.id, mount);
    terminalServices.termaTerminalInteraction!.enableFontWheel(session,key);
    terminalServices.termaTerminalInteraction!.enablePersistentWheel(session, connection);
  },
  scheduleFit:() => terminalServices.termaTerminalViewport!.schedule(),
  connect:(_connection, key) => { const session=terminalSessions.get(key);if(session)void connectTerminal(session.connection, key, {initial:true}); },
  needsConnection:session => terminalSessionNeedsAutomaticConnection(session),
  status:session => terminalSessionConnectionStatus(session),
  updateStatus:(connection, key, state) => updateTerminalConnectionStatus(connection, key, state),
  capture:session => terminalServices.termaTerminalViewport!.captureSession(session),
  preserveFit:(session, anchor) => terminalServices.termaTerminalViewport!.fitSession(session, anchor),
  saveFont:(connection, size) => {
    connection[terminalMetadata.terminalFontSizeField()] = size;
    connection[terminalMetadata.terminalFontSizeInheritField()] = 0;
    terminalServices.termaTerminalPreferences!.schedule(connection);
  },
  toolbar:key => terminalServices.termaTerminalToolbar?.refresh(key),
  error:() => console.warn("Terminal surface lifecycle failed")
};

