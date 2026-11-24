import {errorMessage,remotePath,request} from './operations-types';
import {positive,remoteApi,remoteDisplay,remoteJoin,remoteParent} from './automation-model';
import type {AutomationModel,AutomationPort,DirectoryPicker,DirectoryResult} from './automation-types';
export function createAutomationPicker(port:AutomationPort,model:AutomationModel,alive:()=>boolean,paint:()=>void){
  let native=false;
  const current=(picker:DirectoryPicker)=>alive()&&model.picker===picker&&!!model.draft&&(picker.kind==='server'||model.draft.connectionId===picker.connectionId);
  const directories=(result:DirectoryResult)=>(Array.isArray(result.entries)?result.entries:[]).filter(entry=>entry&&(entry.type==='dir'||entry.type==='directory'||entry.type==='drive'||entry.kind==='directory'||entry.is_dir));
  async function load(path:string,page=1){
    const picker=model.picker;if(!picker||!current(picker))return;const version=++picker.version;picker.loading=true;picker.error='';paint();
    try{
      const result=await request<DirectoryResult>(port.api,picker.kind==='remote'?`/api/connections/${picker.connectionId}/sftp?path=${encodeURIComponent(remoteApi(path))}&page=${page}&page_size=200&refresh=1`:`/api/server-files?path=${encodeURIComponent(path)}&page=${page}&page_size=100&show_hidden=true`);
      if(!current(picker)||picker.version!==version)return;
      const entries=directories(result);picker.path=picker.kind==='remote'?remoteApi(path):result.path||'';picker.display=picker.kind==='remote'?remoteDisplay(picker.path):result.display_path||'';picker.parent=picker.kind==='remote'?remoteParent(picker.path):result.parent||'';picker.entries=entries;picker.page=result.page||page;picker.pages=result.total_pages||1;
      if(picker.kind==='server'&&!picker.path)picker.roots=entries;
      picker.nodes.set(picker.path,entries);picker.expanded.add(picker.path);
    }catch(error){if(current(picker)&&picker.version===version)picker.error=errorMessage(error,port.tr(picker.kind==='remote'?'sftp:automation.remote_picker_failed':'sftp:server_picker.error'));}
    finally{if(current(picker)&&picker.version===version){picker.loading=false;paint();}}
  }
  async function open(kind:'remote'|'server'){
    const value=model.draft;if(!alive()||!value||model.busy.size)return;if(kind==='remote'&&!positive(value.connectionId)){model.error=port.tr('sftp:automation.remote_picker_no_connection');paint();return;}
    const picker:DirectoryPicker={kind,path:kind==='remote'?remoteApi(value.remotePath):'',display:'',parent:'',entries:[],roots:[],nodes:new Map(),expanded:new Set(),page:1,pages:1,loading:false,error:'',create:false,name:'',version:0,connectionId:value.connectionId};model.picker=picker;paint();
    if(kind==='remote'){const path=picker.path;await load('.');if(current(picker)&&path!=='.')await load(path);}
    else{
      await load('');if(!current(picker)||!value.localPath)return;
      try{const resolved=await request<{path:string}>(port.api,'/api/server-files/resolve?path='+encodeURIComponent(value.localPath));if(current(picker)&&model.draft===value)await load(resolved.path);}
      catch{/* Stay at the authorized roots when the entered path cannot be resolved. */}
    }
  }
  async function choose(){
    if(!port.desktop())return open('server');const value=model.draft;if(native||!value||!alive())return;const previous=value.localPath;native=true;model.busy.add('choose');paint();
    try{const path=await port.nativeDirectory();if(alive()&&model.draft===value&&value.localPath===previous&&path&&remotePath(path))value.localPath=path;}
    catch(error){if(alive()&&model.draft===value)model.error=errorMessage(error,port.tr('sftp:automation.choose_failed'));}
    finally{native=false;model.busy.delete('choose');if(alive())paint();}
  }
  async function toggle(path:string){const picker=model.picker;if(!picker||!current(picker)||picker.loading)return;const collapse=picker.expanded.has(path)&&picker.nodes.has(path);if(picker.path!==path||!collapse)await load(path);if(collapse&&current(picker)){picker.expanded.delete(path);paint();}}
  function edit(key:'path'|'name'|'create',value:string|boolean){const picker=model.picker;if(!picker||!current(picker)||picker.loading)return;if(key==='create')picker.create=Boolean(value);else picker[key]=String(value);paint();}
  function close(){if(model.picker)model.picker.version++;model.picker=null;paint();}
  function select(){const picker=model.picker,value=model.draft;if(!picker||!value||!current(picker)||picker.loading||picker.error)return;if(picker.kind==='remote')value.remotePath=remoteDisplay(picker.path);else if(picker.path&&picker.display)value.localPath=picker.display;else return;close();}
  async function mkdir(){
    const picker=model.picker;if(!picker||!current(picker)||picker.loading)return;const name=picker.name.trim();if(!name||name==='.'||name==='..'||/[\\/\0]/.test(name)){picker.error=port.tr('sftp:automation.remote_picker_new_invalid');paint();return;}
      if(picker.kind==='server'&&!picker.path)return;picker.loading=true;picker.error='';paint();
    try{await port.api(picker.kind==='remote'?`/api/connections/${picker.connectionId}/sftp/mkdir`:'/api/server-files/create',{method:'POST',body:JSON.stringify(picker.kind==='remote'?{path:remoteJoin(picker.path,name)}:{directory:picker.path,name,type:'dir'})});
      if(!current(picker))return;picker.name='';picker.create=false;picker.nodes.delete(picker.path);await load(picker.path);
    }catch(error){if(current(picker))picker.error=errorMessage(error,port.tr('sftp:automation.remote_picker_new_failed'));}
    finally{if(current(picker)){picker.loading=false;paint();}}
  }
  return {open,load,choose,toggle,edit,select,close,mkdir};
}
