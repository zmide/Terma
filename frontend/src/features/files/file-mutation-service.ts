import type {LocalEntry} from './local-file-service';
import type {SftpInputOptions,SftpDialogBase,SftpConfirmation} from './sftp/sftp-dialog-types';
export type FileMutation = {action:'create';directory:string;name:string;type:'file'|'dir'}|{action:'rename';path:string;new_name:string}|{action:'delete';paths:string[]}|{action:'chmod';path:string;mode:string};
export interface FileMutationContext {
  path:string;source:'native'|'server'|'browser';writable:boolean;windows:boolean;entries:LocalEntry[];
  valid():boolean;write(operation:FileMutation):Promise<void>;refresh():Promise<void>;clear():void;
}
export interface FileMutationPort {
  context(key:string):FileMutationContext|null;
  text(key:string,params?:Record<string,unknown>):string;
  input(options:SftpInputOptions):Promise<string|null>;
  confirm(options:SftpDialogBase&{content():SftpConfirmation}):Promise<boolean>;
  error(error:unknown):string;
  notify(message:string,kind:'info'|'success'|'error'):void;
}
export function createFileMutationService(port:FileMutationPort){
  const owners=new Map<string,symbol>();
  const text=(key:string,params?:Record<string,unknown>)=>port.text(key,params);
  async function run(key:string,action:'file'|'dir'|'rename'|'delete'|'chmod',paths:string[]=[]){
    const context=port.context(key);if(!context||!context.valid()||owners.has(key))return false;
    if(!context.writable){port.notify(text(context.source==='browser'?'sftp:web_files.readonly_hint':'sftp:local_files.enter_directory_before_create'),'info');return false;}
    const token=Symbol();owners.set(key,token);
    const valid=()=>owners.get(key)===token&&context.valid();
    const items=[...new Set(paths)].map(path=>context.entries.find(item=>item.path===path&&item.type!=='drive'));
    try{
      if(paths.length&&items.some(item=>!item))return false;
      const entries=items.filter((item):item is LocalEntry=>!!item);
      if(['rename','chmod'].includes(action)&&entries.length!==1){port.notify(text(context.source==='native'?'sftp:local_files.rename_one_only':'sftp:web_files.select_one'),'info');return false;}
      if(action==='delete'&&!entries.length)return false;
      if(action==='chmod'&&(context.source!=='native'||context.windows)){port.notify(text('sftp:local_files.windows_posix_unsupported'),'info');return false;}
      if(action==='rename'&&context.source==='browser'&&entries[0]!.type==='dir'){port.notify(text('sftp:web_files.directory_rename_unavailable'),'info');return false;}
      let changed=false;
      const apply=async(operation:FileMutation)=>{if(!valid())return;await context.write(operation);changed=true;};
      if(action==='delete'){
        const confirmed=await port.confirm({tr:port.text,valid,content:()=>({title:text(context.source==='native'?'sftp:local_files.delete_title':'common:actions.delete'),message:text(context.source==='native'?'sftp:local_files.delete_confirm':'sftp:web_files.delete_confirm',{count:entries.length}),confirm:text('common:actions.delete'),danger:true})});
        if(confirmed)await apply({action:'delete',paths:entries.map(item=>item.path)});
      }else{
        const entry=entries[0],titleKey=action==='rename'?'sftp:menu.rename':action==='chmod'?'sftp:menu.permissions':action==='dir'?'common:auto.new_folder':'common:auto.new_file';
        await port.input({tr:port.text,valid,titleKey,labelKey:action==='rename'?'sftp:dialogs.new_name':action==='chmod'?'sftp:local_files.permissions_example':'sftp:operations.name_label',value:action==='rename'?entry!.name:action==='chmod'?entry!.mode||'644':'',errorText:port.error,
          async apply(value){
            if(!valid())return;
            if(action==='chmod'){
              if(!/^[0-7]{3,4}$/.test(value))throw new Error(text('sftp:permissions_editor.invalid_mode'));
              await apply({action:'chmod',path:entry!.path,mode:value});
            }else{
              if(!value||['.','..'].includes(value)||/[\\/\0\r\n]/.test(value))throw new Error(text('sftp:inline_rename.invalid_name'));
              if(action==='rename'){if(value!==entry!.name)await apply({action:'rename',path:entry!.path,new_name:value});}
              else await apply({action:'create',directory:context.path,name:value,type:action});
            }
          }
        });
      }
      if(changed&&valid()){
        await context.refresh();if(!valid())return true;
        if(action==='delete')context.clear();
        if(context.source==='native')port.notify(text('sftp:local_files.'+({file:'file_created',dir:'folder_created',rename:'renamed',delete:'deleted',chmod:'permissions_updated'}[action]),{count:entries.length}),'success');
      }
      return changed;
    }catch(error){if(valid())port.notify(port.error(error),'error');return false;}
    finally{if(owners.get(key)===token)owners.delete(key);}
  }
  return {run};
}
