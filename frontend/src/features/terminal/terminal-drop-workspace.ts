import {connectionsServices} from '@/features/connections/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {createTerminalDropService,type TerminalDropSession} from './terminal-drop-service';
import {terminalDirectory} from './terminal-directory-workspace';
import {workspaceHasTabKey,workspaceTabByKey} from '../workspace/workspace-dock-state';
import {translate} from '../../shared/i18n/runtime';
import type {FileTransferPayload} from '../files/file-transfer-service';
import {connectionStamp} from '../remote/management-types';
export const terminalDrop=createTerminalDropService({
 current:session=>{
  const value=connectionsServices.termaConnectionController!.current(session.id);
  const connection=value&&'ssh_host' in value&&typeof value.ssh_host==='string'?{...value,ssh_host:value.ssh_host}:null;
  return terminalSessions.get(session.key)===session&&workspaceHasTabKey(session.key)&&Number(workspaceTabByKey(session.key)?.id)===session.id&&(!session.connection||!!connection&&connectionStamp(connection)===connectionStamp(session.connection));
 },
 initialize:(session,id)=>terminalDirectory.initialize(session,{id},session.key),
 local:data=>filesServices.termaFileTransferRuntime.drag.read(data),
 remote:data=>filesServices.termaSftpDragWorkspace.drag.source.active(data),
 hasFiles:data=>filesServices.termaSftpDragWorkspace.browserDrop.hasFiles(data),
 collect:(data,signal)=>filesServices.termaSftpDragWorkspace.collect(data||{},signal),
 copy:(drag,id,path,key,valid)=>filesServices.termaSftpDragWorkspace.drag.destinations.directory(drag,id,path,{title:translate('terminal:drop.target_title',{directory:path}),tabKey:key,valid}),
 uploadLocal:(payload,id,path,key,valid)=>filesServices.termaFileTransferRuntime.upload(payload,{kind:'terminal',id,path,key,valid,title:translate('terminal:drop.target_title',{directory:path})},key),
 uploadFiles:(files,id,path,key,valid)=>filesServices.termaSftpTransfers.controller.submit(files,id,path,{tabKey:key,isCurrent:valid}),
 finish:drag=>filesServices.termaSftpDragWorkspace.drag.browser.finishPayload(drag),
 feedback:setTerminalDropState,
 inside:()=>filesServices.termaSftpDragWorkspace.drag.browser.inside(),text:translate,
 notify:(message,kind)=>efficiencyServices.termaNotificationToasts?.notify(message,kind),icon:()=>sharedServices.termaIcons.html('upload-cloud')
});
export function uploadLocalFilesToTerminalTab(payload:FileTransferPayload,tab:{key:string}) {
 const session=terminalSessions.get(String(tab?.key||''));
 if(!session)throw new Error(translate('terminal:drop.not_connected'));
 return terminalDrop.uploadLocal(payload,session);
}
export function setTerminalDropState(session:TerminalDropSession,enabled:boolean,mode:'upload'|'copy'='upload') {
 const overlay=session.mount?.querySelector<HTMLElement>('.terminal-drop-overlay');
 if(!overlay)return;
 overlay.hidden=!enabled;overlay.dataset.mode=mode;
 if(enabled){filesServices.termaSftpDragWorkspace.drag.feedback.activity();filesServices.termaSftpDragWorkspace.dropFeedback.focus('terminal',session.key,session);terminalDirectory.refreshOverlay(session);}
 else filesServices.termaSftpDragWorkspace.dropFeedback.release('terminal',session.key,session);
}


