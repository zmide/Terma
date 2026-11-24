import {connectionsServices} from '@/features/connections/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import {notify} from '@/features/efficiency/notification-actions';
import type {createConnectionCredentialService} from './connection-credential-service';
import type {SshCredentialConnection, TemporarySshTicket} from './connection-credential-model';
import {registerTemporarySshCredential} from '../terminal/terminal-quick-registry';
import {translate as tr} from '../../shared/i18n/runtime';

type PromptService = ReturnType<typeof createConnectionCredentialService>;
type PromptPort = Parameters<PromptService['prompt']>[2];
export type CredentialConnection = SshCredentialConnection & {
  id:number; ssh_host:string; ssh_user:string; ssh_port:number; name:string;
  auth_type?:string;
};
export interface CredentialRepairOptions {
  context?:string|(()=>string);
  error?:unknown;
  onSaved?(connection:CredentialConnection):unknown;
  onTemporary?(connection:CredentialConnection,token:string):unknown;
}
interface CredentialRuntimePort {
  service():PromptService;
  prompt:PromptPort;
  current(id:number):SshCredentialConnection|undefined;
  refresh():Promise<unknown>;
  temporary(ticket:TemporarySshTicket):SshCredentialConnection;
}
function connectionRecord(connection:SshCredentialConnection):CredentialConnection {
  return {...connection,id:Number(connection.id),name:String(connection.name||''),
    ssh_host:String(connection.ssh_host||''),ssh_user:String(connection.ssh_user||''),
    ssh_port:Number(connection.ssh_port||22),auth_type:String(connection.auth_type||'')};
}
export function createSshCredentialRuntime(port:CredentialRuntimePort) {
  let prompting=false;
  async function prompt(connection:SshCredentialConnection,options:CredentialRepairOptions={}) {
    if(prompting){
      port.prompt.notify(port.prompt.tr('connections:credentials.repair_active'),'info');
      return null;
    }
    prompting=true;
    try{
      return await port.service().prompt(connection,{
        context:typeof options.context==='function'?options.context():options.context,
        onTemporary:options.onTemporary?()=>undefined:undefined
      },port.prompt);
    }finally{prompting=false;}
  }
  async function repair(id:number,options:CredentialRepairOptions={}) {
    id=Number(id||((options.error as {connectionId?:unknown}|undefined)?.connectionId)||0);
    const source=port.current(id);
    if(!Number.isSafeInteger(id)||id<1||!source||source.quick_connection)return false;
    const outcome=await prompt(source,options);
    if(!outcome)return false;
    if(outcome.saved){
      await port.refresh();
      const connection=connectionRecord(port.current(id)||source);
      port.prompt.notify(port.prompt.tr('connections:credentials.verified_saved'),'success');
      await options.onSaved?.(connection);
      return {saved:true,connection};
    }
    const connection=connectionRecord(port.temporary(outcome.ticket));
    const token=String(outcome.ticket.token||'');
    port.prompt.notify(port.prompt.tr('connections:credentials.temporary_created'),'success');
    await options.onTemporary?.(connection,token);
    return {saved:false,connection,token};
  }
  return {prompt,repair,active:()=>prompting};
}
export const sshCredentialRuntime=createSshCredentialRuntime({
  service:()=>connectionsServices.termaConnectionCredentials!,
  prompt:{
    api:(url,options)=>sharedServices.termaWorkspaceRequest(url,options),
    tr,localize:message=>localizedTermaUiPhrase(message),
    notify:(message,kind)=>notify(message,kind),
    localizedIdentityFileLabel:(identity,options)=>localizedIdentityFileLabel(identity,options)
  },
  current:id=>connectionsServices.termaConnectionController?.current(id),
  refresh:()=>sharedServices.termaWorkspaceRefresh.load(),
  temporary:registerTemporarySshCredential
});
export const promptSshCredentialRepair=sshCredentialRuntime.prompt;
export const repairSshCredentials=sshCredentialRuntime.repair;


