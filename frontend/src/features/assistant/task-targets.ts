import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {terminalSessionConnectionStatus} from '@/features/terminal/terminal-connection-runtime';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import type {WorkspaceTab} from '../workspace/workspace-tab-runtime';
import type {CommandSession} from './terminal-command-service';
import type {TerminalTarget} from './task-workflow';

type TargetConnection={ssh_host?:string;ssh_user?:string};
type TargetSession=CommandSession&{connection?:TargetConnection};



// Read the same workspace/session objects as the terminal owner; no copied list is retained.
export function assistantTerminalTargets():TerminalTarget[] {
  return applicationState.tabs.filter(tab=>tab.kind==='terminal').slice(0,32).map(tab=>{
    const key=String(tab.key||''),session=terminalSessions.get(key);
    const connection=session?.connection||currentConnection(Number(tab.id||0));
    return {key,title:String(tab.title||key),host:String(connection?.ssh_host||''),user:String(connection?.ssh_user||''),status:terminalSessionConnectionStatus(session)};
  });
}
