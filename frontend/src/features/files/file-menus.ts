import type {LocalEntry,LocalFileState} from './local-file-service';
import type {SftpMenuAction,SftpMenuEvent} from './sftp/SftpMenuViews';
export interface FileMenuContext {state:LocalFileState;valid():boolean}
interface Target {key?:string;kind?:string;id:number;title?:string;name?:string;path?:string}
interface Payload {sourceTabKey:string;paths:string[];entries:LocalEntry[]}
type Action='open'|'system'|'rename'|'delete'|'permissions'|'file'|'dir'|'refresh'|'copy';
interface Port {
  context(key:string):FileMenuContext|null;selected(key:string):LocalEntry[];select(key:string,path:string):void;
  active():Target|undefined;connections():Array<{id:number;name?:string;ssh_host?:string}>;desktop():boolean;
  text(key:string,values?:Record<string,unknown>):string;
  run(action:Action,key:string,paths:string[]):unknown;
  upload(payload:Payload,target:Target):unknown;peers(key:string,entries:LocalEntry[]):SftpMenuAction[];
  show(event:SftpMenuEvent,actions:()=>SftpMenuAction[]):void;notify(message:string):void;
}
/** Menus keep the originating directory/selection and rebuild labels while open. */
export function createFileMenus(port:Port){
  const t=port.text,separator=():SftpMenuAction=>({label:'',separator:true});
  function guard(context:FileMenuContext,actions:SftpMenuAction[]):SftpMenuAction[]{return actions.map(item=>({...item,run:item.run?()=>context.valid()?item.run!():undefined:undefined,children:item.children?guard(context,item.children):undefined}));}
  function uploads(key:string,entries=port.selected(key)):SftpMenuAction[]{
    const context=port.context(key);if(!context||!entries.length)return [];
    const payload:Payload={sourceTabKey:key,paths:entries.map(item=>item.path),entries:entries.map(item=>({...item,type:item.type==='drive'?'dir':item.type}))};
    const active=port.active(),targets:SftpMenuAction[]=[];
    if(active?.kind==='sftp')targets.push({label:t('navigation:transfer.upload_current_sftp',{name:active.title||active.name||active.id}),icon:'folder-up',run:()=>port.upload(payload,active)});
    for(const connection of port.connections()){
      if(active?.kind==='sftp'&&Number(active.id)===Number(connection.id))continue;
      const name=connection.name||connection.ssh_host||'';
      targets.push({label:t('navigation:transfer.sftp_connection',{name}),icon:'server',run:()=>port.upload(payload,{kind:'sftp',id:connection.id,title:name,path:'.'})});
    }
    return guard(context,targets);
  }
  function entry(event:SftpMenuEvent,key:string,path:string){
    event.preventDefault?.();event.stopPropagation?.();
    const context=port.context(key),file=context?.state.entries.find(item=>item.path===path);if(!context||!file)return;
    if(file.type!=='drive'&&!port.selected(key).some(item=>item.path===path))port.select(key,path);
    const selected=port.selected(key),entries=file.type!=='drive'&&selected.some(item=>item.path===path)?selected.map(item=>({...item})):[{...file}];
    const paths=entries.map(item=>item.path),count=paths.length,web=!!context.state.fileSource;
    const writable=file.type!=='drive'&&context.state.location!=='computer'&&(!web||context.state.fileSource!=='browser'||Boolean(context.state.browserDirectory?.writable));
    const action=(name:Action,label:string,icon:string,danger=false):SftpMenuAction=>({label:t(label,{count}),icon,danger,run:()=>port.run(name,key,name==='open'?[path]:paths)});
    port.show(event,()=>{
      if(!context.valid())return [];
      const peers=port.peers(key,entries);
      return guard(context,[
        action('open',file.type==='file'&&!web?'common:local_files.open_edit':'common:auto.open',file.type==='file'?'file-text':'folder-open'),
        ...(!web?[action('system','common:auto.open_in_system_file_manager','external-link')]:[]),
        action('copy',count>1?'common:local_files.copy_paths':'common:auto.copy_path','clipboard'),separator(),
        ...(writable&&count===1?[action('rename','common:auto.rename','pencil')]:[]),
        ...(writable?[action('delete',count>1?'common:local_files.delete_selected':'common:actions.delete','trash-2',true)]:[]),
        ...(file.type!=='drive'&&(web||port.desktop())?[{label:t('common:auto.upload_to_sftp'),icon:'upload',children:uploads(key,entries)}]:[]),
        ...(writable&&peers.length?[{label:t('sftp:menu.send_peer'),icon:'send',children:peers}]:[]),
        ...(!web&&writable&&count===1?[action('permissions','sftp:menu.permissions','key-round')]:[])
      ]);
    });
  }
  function directory(event:SftpMenuEvent,key:string){
    if(event.target instanceof Element&&event.target.closest('.local-files-row,.local-files-head,.sftp-pager,button,input,select'))return;
    event.preventDefault?.();event.stopPropagation?.();const context=port.context(key);if(!context)return;
    port.show(event,()=>{
      if(!context.valid())return [];
      const selected=port.selected(key).map(item=>item.path),writable=context.state.location!=='computer'&&(context.state.fileSource!=='browser'||Boolean(context.state.browserDirectory?.writable));
      const action=(name:Action,label:string,icon:string):SftpMenuAction=>({label:t(label),icon,run:()=>port.run(name,key,selected)});
      return guard(context,[...(writable?[action('file','common:auto.new_file','file-plus-2'),action('dir','common:auto.new_folder','folder-plus')]:[]),
        ...(writable&&selected.length?[separator(),{...action('delete','sftp:local_files.delete_selected_items','trash-2'),danger:true}]:[]),separator(),action('refresh','common:auto.refresh','refresh-cw')]);
    });
  }
  function send(event:SftpMenuEvent,key:string){
    if(!port.selected(key).length){port.notify(t('navigation:transfer.select_upload_items'));return;}
    if(!uploads(key).length){port.notify(t('navigation:transfer.no_sftp_targets'));return;}
    port.show(event,()=>uploads(key));
  }
  return {entry,directory,uploads,send};
}
