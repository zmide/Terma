import {sharedServices} from '@/shared/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {reconnectTerminal,resumeQuickTerminalWithTicket} from '@/features/terminal/terminal-connection-runtime';
import {createTerminalAuthenticationService} from './terminal-authentication-service';
import type {TerminalAuthenticationPort} from './terminal-authentication-service';
import {sshAuthenticationFailure} from '../connections/connection-credential-model';
import {repairSshCredentials} from '../connections/ssh-credential-runtime';
import {translate as tr} from '../../shared/i18n/runtime';

export const terminalAuthentication=createTerminalAuthenticationService({
  tr,authenticationFailure:sshAuthenticationFailure,
  isQuickAuthOpen:()=>document.getElementById('modal')?.dataset.quickSshAuth==='1',
  api:(url,options)=>sharedServices.termaWorkspaceRequest(url,options),
  startQuickSshConnection:(target,options)=>quickServices.termaQuickViews!.startQuickSshConnection(target,options),
  repairSshCredentials,
  reconnectTerminal:(id,key)=>reconnectTerminal(id,key),
  resumeQuickTerminalWithTicket:(key,connection,token)=>resumeQuickTerminalWithTicket(key,connection,token)
});
