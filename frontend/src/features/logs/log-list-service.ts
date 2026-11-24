import {request,type Api,type Translate} from '../operations/operations-types';
import type {Ask} from '../forwards/forward-service';
export interface LogFile {path:string;label:string;size_bytes?:number}
export interface LogGroup {key:string;name:string;files:LogFile[];glyph:string}
export interface LogData {system:LogFile[];batch:LogFile[];connections:{name:string;logs:LogFile[];size_bytes?:number}[]}
export interface LogHit {path:string;matches?:{line:number;text:string}[]}
export interface LogListPort {api:Api;tr:Translate;locale():string;visible():boolean;initial():{query:string;open:string[]};save(query:string,open:string[]):void;publish(data:LogData):void;open(file:LogFile,query:string,line:number):void;searchContext():(query:string,hits:LogHit[])=>void;deleted(paths:string[]):void;notify(text:string,kind:'info'|'success'|'error'):void;settings():void;cleanup(event:MouseEvent):void;today():void;error(value:unknown,fallback:string):string}
export function logBytes(bytes=0){const value=Number(bytes)||0;if(value<1024)return `${value} B`;const index=Math.min(3,Math.floor(Math.log(value)/Math.log(1024))-1),size=value/1024**(index+1);return size.toFixed(size>=10?1:2)+' '+['KB','MB','GB','TB'][index];}
export function logLabel(value:string,t:Translate,locale:string){
  const match=value.match(/^批量执行-(\d{1,2})月(\d{1,2})日 (\d{2}:\d{2}:\d{2})(?:（轮转 (\d+)）)?$/);
  if(match){const date=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric'}).format(new Date(2000,Number(match[1])-1,Number(match[2])));return t('tasks:logs.batch_label',{date,time:match[3]})+(match[4]?t('tasks:logs.rotation_suffix',{count:Number(match[4])}):'');}
  return value.replace(/(\d{4})年(\d+)月(\d+)日/g,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
}
export function createLogListService(port:LogListPort,paint:()=>void,ask:Ask){
  const initial=port.initial(),model={data:{system:[],batch:[],connections:[]} as LogData,query:initial.query,open:new Set(initial.open),pages:new Map<string,number>(),hits:new Map<string,LogHit>(),loading:false,searching:false,busy:false,issue:null as unknown};let listSerial=0,searchSerial=0,timer:ReturnType<typeof setTimeout>|null=null;
  const error=()=>model.issue?port.error(model.issue,port.tr('common:log_maintenance.operation_failed')):'';
  const groups=():LogGroup[]=>[{key:'system',name:port.tr('common:auto.system_logs'),files:model.data.system,glyph:'monitor-cog'},{key:'batch',name:port.tr('common:auto.batch_logs'),files:model.data.batch,glyph:'square-terminal'},...model.data.connections.map(v=>({key:'server:'+v.name,name:v.name,files:v.logs,glyph:'server'}))];
  const filtered=(files:LogFile[])=>{const q=model.query.trim().toLocaleLowerCase();return files.filter(f=>!q||[f.label,logLabel(f.label,port.tr,port.locale())].some(v=>v.toLocaleLowerCase().includes(q))||model.hits.has(f.path));};
  const paths=()=>new Set(groups().flatMap(g=>g.files.map(f=>f.path)));
  const save=()=>port.save(model.query,[...model.open]);
  let loading=false;
  async function load({silent=false}={}){
    if(silent&&(loading||model.busy))return;
    const serial=++listSerial;
    loading=true;
    if(!silent){model.loading=true;model.issue=null;paint();}
    try{
      const data=await request<LogData>(port.api,'/api/logs');
      if(serial!==listSerial||!port.visible())return;
      model.data={system:Array.isArray(data.system)?data.system:[],batch:Array.isArray(data.batch)?data.batch:[],connections:Array.isArray(data.connections)?data.connections:[]};
      port.publish(model.data);
    }catch(e){if(serial===listSerial&&!silent)model.issue=e;}
    finally{if(serial===listSerial){loading=false;model.loading=false;paint();}}
  }
  async function search(query:string){model.query=query;model.hits.clear();model.pages.clear();model.issue=null;save();const serial=++searchSerial,refreshCurrent=port.searchContext();if(timer)clearTimeout(timer);model.searching=!!query.trim();paint();
    if(!query.trim())return;
    timer=setTimeout(async()=>{try{const hits=await request<LogHit[]>(port.api,'/api/logs/search?query='+encodeURIComponent(query.trim()));if(serial!==searchSerial||!port.visible())return;model.hits=new Map((Array.isArray(hits)?hits:[]).filter(h=>paths().has(h.path)).map(h=>[h.path,h]));for(const group of groups())if(filtered(group.files).length)model.open.add(group.key);save();refreshCurrent(query,[...model.hits.values()]);}catch(e){if(serial===searchSerial)model.issue=e;}finally{if(serial===searchSerial){model.searching=false;paint();}}},250);
  }
  async function remove(values:string[],group=false){if(model.busy||!port.visible())return false;const selected=[...new Set(values)],known=paths();if(!selected.length||selected.some(p=>!known.has(p)))return false;model.busy=true;model.issue=null;paint();
    try{const answer=await ask({title:()=>port.tr(group?'common:log_maintenance.delete_group_title':'common:log_maintenance.delete_title'),message:()=>port.tr(group?'common:log_maintenance.delete_group_confirm':'common:log_maintenance.delete_one_confirm',{count:selected.length}),choices:[{value:'yes',label:()=>port.tr('common:actions.delete'),danger:true},{value:'',label:()=>port.tr('common:actions.cancel')}]});
      if(answer!=='yes'||!port.visible()||selected.some(p=>!paths().has(p)))return false;
      const result=await request<{deleted?:string[];errors?:unknown[]}>(port.api,'/api/logs/delete',{method:'POST',body:JSON.stringify({paths:selected})});const accepted=(result.deleted||[]).filter(p=>selected.includes(p));port.deleted(accepted);port.notify(port.tr('common:log_maintenance.delete_result',{count:accepted.length}),result.errors?.length?'error':'success');await load();return true;
    }catch(e){model.issue=e;return false;}finally{model.busy=false;paint();}
  }
  return {model,load,search,error,groups,filtered,remove,toggle(key:string){model.open.has(key)?model.open.delete(key):model.open.add(key);save();paint();},page(key:string,value:number){model.pages.set(key,Math.max(0,value));paint();},open(file:LogFile){if(paths().has(file.path))port.open(file,model.query,model.hits.get(file.path)?.matches?.[0]?.line||0);},suspend(){listSerial++;searchSerial++;if(timer)clearTimeout(timer);loading=false;model.loading=false;model.searching=false;},refresh:paint};
}
