import type {SftpOperationContext} from './file-operations';
type Action='copy'|'move'|'paste'|'cancelClipboard'|'download'|'compress'|'permissions'|'extract'|'delete';
interface Port {
 context(key:string):SftpOperationContext|null;clipboard():{connectionId:number;paths:string[]}|null;
 text(key:string):string;choose(title:string|(()=>string),message:string|(()=>string),actions:Array<{label:()=>string;value:string;className?:string}>):Promise<string>;
 run(action:Action,key:string):unknown;
}
export function createSftpActionSheet(port:Port){
 async function open(key:string){
  const context=port.context(key);if(!context?.valid())return;
  const t=port.text;
  const clipboard=port.clipboard();
  const label=(key:string)=>()=>t(key);
  const value=await port.choose(()=>t('sftp:action_sheet.title'),()=>t('sftp:action_sheet.hint'),[
    {label:label('sftp:action_sheet.copy_selected'),value:'copy'},{label:label('sftp:action_sheet.move_selected'),value:'move'},
    ...(clipboard?.paths.length&&clipboard.connectionId===context.connectionId?[{label:label('sftp:clipboard.paste_current'),value:'paste'}]:[]),
    ...(clipboard?.paths.length?[{label:label('sftp:clipboard.cancel_title'),value:'cancelClipboard'}]:[]),
    ...(['download','compress','permissions','extract','delete'] as const).map(action=>({label:label(action==='permissions'?'sftp:menu.permissions':`sftp:action_sheet.${action}_selected`),value:action,className:action==='delete'?'danger':''})),
    {label:label('common:actions.cancel'),value:''}
  ]);
  if(context.valid()&&['copy','move','paste','cancelClipboard','download','compress','permissions','extract','delete'].includes(value))return port.run(value as Action,key);
 }
 return {open};
}
