import {request} from '../operations/operations-types';
import type {BatchPort,CommandTemplate} from './batch-model';
import type {Ask} from '../forwards/forward-service';
export function createCommandTemplates(port:BatchPort,paint:()=>void){
  const model={items:[] as CommandTemplate[],loading:false,issue:null as unknown,get error(){return this.issue?port.error(this.issue,port.tr('terminal:batch.operation_failed')):'';}};let sequence=0;
  let loading=false;
  async function load({silent=false}={}){
    if(silent&&loading)return model.items;
    const serial=++sequence;
    loading=true;
    if(!silent){model.loading=true;model.issue=null;paint();}
    try{
      const value=await request<CommandTemplate[]>(port.api,'/api/command-templates');
      if(serial===sequence)model.items=Array.isArray(value)?value.filter(v=>v&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.command==='string').map(v=>({...v,description:v.description||''})):[];
    }catch(e){if(serial===sequence&&!silent)model.issue=e;}
    finally{if(serial===sequence){loading=false;model.loading=false;paint();}}
    return model.items;
  }
  const pending=new Set<string>();
  async function remove(id:string,ask:Ask,alive:()=>boolean){
    if(pending.has(id))return;pending.add(id);
    try {const item=model.items.find(v=>v.id===id);if(!item)return;const expected=JSON.stringify(item);
      const answer=await ask({title:()=>port.tr('terminal:batch.delete_template_title'),message:()=>port.tr('terminal:batch.delete_template_confirm',{name:item.name}),choices:[{value:'yes',label:()=>port.tr('common:actions.delete'),danger:true},{value:'',label:()=>port.tr('common:actions.cancel')}]});
      if(answer!=='yes'||!alive()||!model.items.some(v=>v.id===id&&JSON.stringify(v)===expected))return;
      await port.api(`/api/command-templates/${encodeURIComponent(id)}`,{method:'DELETE'});port.notify(port.tr('terminal:batch.template_deleted'),'success');await load();
    }catch(e){model.issue=e;paint();}finally{pending.delete(id);}
  }
  function editor(item:CommandTemplate|undefined,alive:()=>boolean,changed:()=>void){
    const state={id:item?.id||'',name:item?.name||'',command:item?.command||'',description:item?.description||'',busy:false,issue:null as unknown,errorKey:'',get error(){return this.errorKey?port.tr(this.errorKey):this.issue?port.error(this.issue,port.tr('terminal:batch.operation_failed')):'';}},original=item?JSON.stringify(item):'';
    return {state,async save(done:()=>void){if(!alive()||state.busy)return false;if(!state.name.trim()||!state.command.trim()){state.errorKey=!state.name.trim()?'terminal:batch.template_name_required':'terminal:batch.enter_command_error';changed();return false;}if(state.command.includes('\0')){state.errorKey='terminal:batch.invalid_input';changed();return false;}
      if(state.id&&!model.items.some(v=>v.id===state.id&&JSON.stringify(v)===original)){state.errorKey='terminal:batch.targets_changed';changed();return false;}
      state.busy=true;state.errorKey='';state.issue=null;changed();try{await port.api(state.id?`/api/command-templates/${encodeURIComponent(state.id)}`:'/api/command-templates',{method:state.id?'PUT':'POST',body:JSON.stringify({name:state.name.trim(),command:state.command,description:state.description.trim()})});port.notify(port.tr(state.id?'terminal:batch.template_saved':'terminal:batch.template_added'),'success');if(alive())done();await load();return true;}catch(e){if(alive())state.issue=e;return false;}finally{state.busy=false;if(alive())changed();}}};
  }
  return {model,load,remove,editor};
}
