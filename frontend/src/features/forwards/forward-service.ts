import {captureBulk,operateBulk,needsStop} from './forward-bulk';
import {errorMessage,request} from '../operations/operations-types';
import {active,draft,payload,rows,signature,validId,type Draft,type ForwardPort,type Payload,type Row} from './forward-model';
import {resolveForwardConflict} from './forward-conflict';
export interface Question {title:()=>string;message?:()=>string;input?:string;choices:{value:string;label:()=>string;danger?:boolean}[]}
export type Ask=(question:Question)=>Promise<string>;
export function createForwardService(port:ForwardPort,alive:()=>boolean,paint:()=>void,ask:Ask){
  const state={busy:new Set<string>(),error:'',draft:draft(0),editing:0,templateId:'',templatesOpen:false};
  const t=port.tr,find=(id:number)=>rows(port).find(r=>r.forward.id===id);
  const snapshot=(row:Row|undefined)=>row?{...row,connection:{...row.connection},forward:{...row.forward}}:undefined;
  const current=(r:Row)=>{const now=find(r.forward.id);return now&&signature(now.connection,now.forward)===signature(r.connection,r.forward);};
  async function reload(){try{await port.reload();}catch{if(alive())state.error=t('connections:forward_manager.status_refresh_failed');}}
  async function run(key:string,work:()=>Promise<unknown>){if(!alive()||state.busy.size)return false;state.busy.add(key);state.error='';paint();try{await work();return true;}catch(e){if(alive())state.error=errorMessage(e,t('common:notifications.exact.forward_operation_failed'));port.notify(errorMessage(e,t('common:notifications.exact.forward_operation_failed')),'error');return false;}finally{state.busy.delete(key);if(alive())paint();}}
  async function checked(value:Payload,id:number,skip=false){
    if(skip||value.mode==='remote')return value;
    const result=await request<{configured?:{connection_name:string};usage?:{occupied:boolean;processes?:{name:string;pid:number}[]};recommended?:{recommended_port:number}}>(port.api,'/api/ports/check-forward',{method:'POST',body:JSON.stringify({host:value.bind_host,port:value.bind_port,exclude_id:id})});
    if(!alive())return null;if(!result.configured&&!result.usage?.occupied)return value;
    const recommended=result.recommended?.recommended_port;
    const choice=await ask({title:()=>t('connections:forwards.port_conflict_title'),message:()=>[
      result.configured?t('connections:forwards.port_configured',{name:result.configured.connection_name}):'',
      result.usage?.occupied?t('connections:forwards.port_occupied',{owners:(result.usage.processes||[]).map(p=>`${p.name} (PID: ${p.pid})`).join(', ')}):'',t('connections:forwards.port_conflict_message')].filter(Boolean).join('\n'),choices:[{value:'save',label:()=>t('navigation:menus.forward_save_anyway'),danger:true},...(recommended&&recommended>0&&recommended<=65535?[{value:'recommend',label:()=>t('navigation:menus.forward_save_recommended',{port:recommended})}]:[]),{value:'',label:()=>t('common:actions.cancel')}]});
    if(!alive())return null;if(choice==='save')return value;if(choice==='recommend'&&recommended){state.draft.bind_port=String(recommended);paint();return {...value,bind_port:recommended};}return null;
  }
  function edit(id:number,connectionId:number){if(!alive()||state.busy.size)return;const row=id?find(id):null;if(id&&!row)return;state.editing=id;state.draft=draft(row?.connection.id||connectionId,row?.forward);state.templateId='';state.error='';paint();}
  function apply(id:string){if(state.busy.size)return;const value=port.templates().find(v=>String(v.id)===String(id));if(value){state.draft=draft(state.draft.connection_id,value);paint();}}
  async function save(onSaved:()=>void){return run('save',async()=>{
    const id=state.editing,connectionId=state.draft.connection_id,original=id?snapshot(find(id)):null;
    if(!port.connections().some(c=>c.id===connectionId)||id&&(!original||original.connection.id!==connectionId))throw Error(t('connections:forwards.not_found'));
    const value=await checked(payload({...state.draft},t),id,!!original&&active(original.forward));
    if(!value||!alive()||original&&!current(original))return;
    const result=await request<{restarted?:boolean}>(port.api,id?`/api/forwards/${id}`:`/api/connections/${connectionId}/forwards`,{method:id?'PUT':'POST',body:JSON.stringify(id?{...value,restart_if_running:true}:value)});
    port.notify(t(id?(result.restarted?'connections:forwards.saved_restarted':'connections:forwards.saved'):'common:notifications.forward_added'),'success');
    if(alive()){state.editing=0;state.draft=draft(connectionId);onSaved();}await reload();
  });}
  async function remove(ids:number[]){return run('delete',async()=>{
    const originals=ids.map(id=>snapshot(find(id)));if(!ids.length||originals.some(r=>!r)||new Set(ids).size!==ids.length)return;
    const name=originals.map(r=>r!.title).join(', ');
    const answer=await ask({title:()=>t('connections:forward_manager.delete_title'),message:()=>t('connections:forward_manager.delete_confirm',{name}),choices:[{value:'delete',label:()=>t('common:actions.delete'),danger:true},{value:'',label:()=>t('common:actions.cancel')}]});
    if(answer!=='delete'||!alive()||originals.some(r=>!current(r!)))return;
    if(ids.length===1)await port.api(`/api/forwards/${ids[0]}`,{method:'DELETE'});else await port.api('/api/forwards/bulk-delete',{method:'POST',body:JSON.stringify({ids})});
    port.notify(t('common:notifications.forward_deleted'),'success');await reload();
  });}
  async function toggle(id:number){return run('toggle:'+id,async()=>{
    const original=snapshot(find(id));if(!original)return;
    if(!active(original.forward)&&original.forward.mode!=='remote'){
      if(!await resolveForwardConflict(port,original,alive,()=>find(id),ask))return;
    }
    if(!alive()||!find(id)||find(id)!.connection.id!==original.connection.id)return;
    try{await port.api(`/api/forwards/${id}/${active(original.forward)?'stop':'start'}`,{method:'POST'});}catch(e){await reload();if(alive()&&!active(original.forward))await port.repair(original.connection.id,e);throw e;}
    port.notify(t(active(original.forward)?'common:notifications.forward_stopped_action':'common:notifications.forward_started_action'),'success');await reload();
  });}
  async function templateSave(){return run('template-save',async()=>{
    const value=payload({...state.draft},t),id=state.templateId,existing=port.templates().find(v=>String(v.id)===id);
    const name=await ask({title:()=>t(id?'connections:forwards.template_save_edit_title':'connections:forwards.template_save_title'),input:existing?.name||value.service_name||t('connections:auto.forward_template'),choices:[{value:'input',label:()=>t('common:actions.save')},{value:'',label:()=>t('common:actions.cancel')}]});
    if(!name.trim()||!alive()||id&&!port.templates().some(v=>String(v.id)===id))return;
    await port.api(id?`/api/forward-templates/${encodeURIComponent(id)}`:'/api/forward-templates',{method:id?'PUT':'POST',body:JSON.stringify({name:name.trim(),...value})});
    if(alive()){state.templateId='';state.templatesOpen=true;}await port.reloadTemplates();port.notify(t('common:notifications.forward_template_saved',{name:name.trim()}),'success');
  });}
  async function templateAction(id:string,action:'delete'|'batch'){return run('template-'+action,async()=>{
    const original=port.templates().find(v=>String(v.id)===id);if(!original)return;const expected=JSON.stringify(original);
    const source=port.connections().find(c=>c.id===state.draft.connection_id),connection=source?{id:source.id,group_name:source.group_name}:null,snapshot=port.connections().map(c=>({id:c.id,group:c.group_name}));
    const choice=await ask(action==='delete'?{title:()=>t('connections:forwards.template_delete_title'),message:()=>t('connections:forwards.template_delete_confirm',{name:original.name}),choices:[{value:'delete',label:()=>t('common:actions.delete'),danger:true},{value:'',label:()=>t('common:actions.cancel')}]}:{title:()=>t('connections:forwards.template_apply_batch_title'),message:()=>t('connections:forwards.template_apply_batch_message'),choices:[...(connection?[{value:'current',label:()=>t('navigation:menus.current_connection')},{value:'group',label:()=>t('navigation:menus.current_group')}]:[]),{value:'all',label:()=>t('navigation:menus.all_connections')},{value:'',label:()=>t('common:actions.cancel')}]});
    if(!choice||!alive()||!port.templates().some(v=>String(v.id)===id&&JSON.stringify(v)===expected))return;
    if(action==='delete'){await port.api(`/api/forward-templates/${encodeURIComponent(id)}`,{method:'DELETE'});if(state.templateId===id)state.templateId='';await port.reloadTemplates();port.notify(t('common:notifications.forward_template_deleted'),'success');}
    else{const ids=snapshot.filter(c=>choice==='all'||choice==='current'&&c.id===connection?.id||choice==='group'&&c.group===connection?.group_name).map(c=>c.id);if(!ids.length)return;
      if(ids.some(id=>!port.connections().some(c=>c.id===id)))return;
      const result=await request<{created?:unknown[]}>(port.api,`/api/forward-templates/${encodeURIComponent(id)}/apply`,{method:'POST',body:JSON.stringify({connection_ids:ids})});await reload();port.notify(t('common:notifications.exact.forward_template_applied',{count:result.created?.length||0}),'success');}
  });}
  async function bulk(kind:'start'|'stop',group?:string){
    const items=rows(port).filter(r=>(group===undefined||(r.forward.group_name||'')===group)&&(kind==='start'?!active(r.forward):needsStop(r.forward))),targets=captureBulk(port,items.map(r=>r.forward.id));
    return run('bulk-'+kind,async()=>{const result=await operateBulk(port,targets,kind,alive,async id=>{const row=snapshot(find(id));return !!row&&(row.forward.mode==='remote'||await resolveForwardConflict(port,row,alive,()=>find(id),ask));});await reload();port.notify(t('connections:forward_manager.bulk_result',result),result.failed||result.skipped?'error':'success');});
  }
  return {state,edit,apply,save,remove,toggle,templateSave,templateAction,run,bulk,
    recommend:()=>run('recommend',async()=>{const value={...state.draft},id=state.editing;const result=await request<{recommended_port:number}>(port.api,'/api/ports/recommend',{method:'POST',body:JSON.stringify({host:value.bind_host.trim()||'127.0.0.1',port:Number(value.bind_port)||6000,exclude_id:id})});if(alive()&&state.editing===id&&state.draft.bind_host===value.bind_host&&state.draft.bind_port===value.bind_port&&validId(result.recommended_port)&&result.recommended_port<=65535)state.draft.bind_port=String(result.recommended_port);}),
    toolbar:(kind:'restore'|'start'|'stop',connectionId=0)=>run(kind,async()=>{if(kind==='restore'){const result=await request<{ok:number;failed:number}>(port.api,'/api/forwards/restore',{method:'POST'});port.notify(t('common:notifications.restore_forwards_result',{success:result.ok,failed:result.failed}),result.failed?'error':'success');}else{
      const connection=port.connections().find(c=>c.id===connectionId);if(!connection)return;
      const ids=connection.forwards.map(f=>f.id),checked=new Map(connection.forwards.map(f=>[f.id,signature(connection,f)]));
      if(kind==='start')for(const f of connection.forwards.filter(f=>!active(f)&&f.mode!=='remote')){const row=snapshot(find(f.id));if(!row||!await resolveForwardConflict(port,row,alive,()=>find(f.id),ask))return;const next=find(f.id);if(!next)return;checked.set(f.id,signature(next.connection,next.forward));}
      const now=port.connections().find(c=>c.id===connectionId);if(!now||now.forwards.length!==ids.length||now.forwards.some(f=>checked.get(f.id)!==signature(now,f)))return;
      if(!alive())return;await port.api(`/api/connections/${connectionId}/${kind}-forwards`,{method:'POST'});
    }await reload();})};
}
