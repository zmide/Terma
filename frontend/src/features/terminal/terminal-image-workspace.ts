import {filesServices} from '@/features/files/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {currentConnection} from '@/features/connections/connection-selection';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from './terminal-session-state';
import {captureTerminalInputTarget} from './terminal-input-target';
import {terminalDirectory} from './terminal-directory-workspace';
import {
  readTerminalImage,imageFromPasteEvent,pasteEventMayContainImage,
  type TerminalImagePastePort
} from './terminal-image-paste-service';
import {translate as tr} from '../../shared/i18n/runtime';


export function createTerminalImagePastePort(key:string,connectionId=0):TerminalImagePastePort {
  key=String(key||'');
  const owner=captureTerminalInputTarget(terminalSessions,key),session=owner.session;
  const connection=session?.connection||currentConnection(Number(connectionId||0));
  const snapshot=connection?{id:Number(connection.id),x11_mode:connection.x11_mode}:undefined;
  const desktop=window.termaDesktop as {readClipboardImage?:Parameters<typeof readTerminalImage>[1]}|undefined;
  return {
    key,session,connection:snapshot,
    isCurrent:()=>Boolean(session?.connected&&owner.isCurrent()
      &&Number((session.connection||connection)?.id)===snapshot?.id),
    readImage:file=>readTerminalImage(file||null,desktop?.readClipboardImage,tr),
    initializeDirectory:()=>session?terminalDirectory.initialize(session,session.connection,key):Promise.resolve(''),
    api:(url,options)=>api(url,options),
    upload:filesServices.termaSftpTransfers?.controller
      ?(files,id,directory,options)=>filesServices.termaSftpTransfers.controller.submit(files,Number(id),directory,options):undefined,
    joinPath:filesServices.termaSftpDirectoryWorkspace.path.joinRemotePath,
    sendData:data=>sendTerminalData(key,data),
    pasteText:text=>terminalServices.termaTerminalClipboard!.send(key,text),
    notify,tr,focus:()=>focusTerminalSession(key),
    imageFromPasteEvent,mayContainImage:pasteEventMayContainImage,
  };
}
