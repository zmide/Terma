import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {connectionStamp,type ManagementConnection} from '../remote/management-types';

export interface TerminalInputSession {
  id?:number;key?:string;connectionAttempt?:number;socket?:unknown;
  connection?:Partial<ManagementConnection>|null;
}
function identity(session:TerminalInputSession){
  const connection=session.connection;
  return connectionStamp({...connection,id:Number(connection?.id||session.id||0),ssh_host:String(connection?.ssh_host||'')});
}
export function captureTerminalInputTarget<Session extends TerminalInputSession>(sessions:ReadonlyMap<string,Session>,key:string){
  const session=sessions.get(key),id=session?.id,attempt=session?.connectionAttempt,socket=session?.socket,stamp=session?identity(session):'';
  return {
    session,
    isCurrent:()=>Boolean(session&&sessions.get(key)===session&&session.id===id&&session.connectionAttempt===attempt
      &&session.socket===socket&&identity(session)===stamp)
  };
}
export function captureTerminalSessionInput(key:string){return captureTerminalInputTarget(terminalSessions,key);}


