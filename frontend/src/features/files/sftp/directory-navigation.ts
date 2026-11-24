import type {DirectoryRuntime,DirectoryLoadOptions} from './directory-loader';
import {directoryPath} from './directory-state';
export interface DirectoryNavigationPort {
  runtime(key:string):DirectoryRuntime|null;
  tab(key:string):{id:number;kind?:string}|null;
  restore?(key:string):unknown;
  load(options:DirectoryLoadOptions):Promise<unknown>;
  pageSize(value:number):void;
  changed(key:string):void;
  filtersChanged?(key:string):void;
  error?(message:string):void;
}
export interface DirectoryHistory {paths:string[];index:number}
interface HistoryRecord extends DirectoryHistory {revision:number;committedIndex:number}
const PAGE_SIZES=[25,50,100,200];
export function createDirectoryNavigation(port:DirectoryNavigationPort){
  const histories=new Map<string,HistoryRecord>();
  const searches=new Map<string,{runtime:DirectoryRuntime;timer:ReturnType<typeof setTimeout>}>();
  function cancelSearch(key:string){
    const pending=searches.get(key);
    if(pending){clearTimeout(pending.timer);searches.delete(key);}
    const runtime=port.runtime(key);
    if(runtime?.searchTimer!=null){clearTimeout(runtime.searchTimer);runtime.searchTimer=null;}
  }
  function search(key:string,value:string,recursive?:boolean){
    const runtime=port.runtime(key),tab=port.tab(key);
    if(!runtime||!tab||tab.kind&&tab.kind!=='sftp'||runtime.connectionId!==tab.id||typeof value!=='string'||value.includes('\0'))return false;
    const query=value,children=recursive===undefined?runtime.state.recursiveSearch:Boolean(recursive);
    if(runtime.state.query===query&&runtime.state.recursiveSearch===children)return false;
    cancelSearch(key);
    runtime.requestController?.abort();runtime.requestController=null;
    runtime.state.requestSeq++;runtime.state.loading=false;
    runtime.state.query=query;runtime.state.recursiveSearch=children;runtime.state.recursiveSearchTruncated=false;runtime.state.page=1;
    port.filtersChanged?.(key);
    const pending={runtime,timer:0 as ReturnType<typeof setTimeout>};
    pending.timer=setTimeout(()=>{
      if(searches.get(key)!==pending)return;
      searches.delete(key);
      if(port.runtime(key)!==runtime||port.tab(key)?.id!==runtime.connectionId)return;
      void port.load({page:1,tabKey:key}).catch(error=>port.error?.(error instanceof Error?error.message:String(error)));
    },180);
    searches.set(key,pending);
    return true;
  }
  function history(key:string){
    let record=histories.get(key);
    if(!record){record={paths:[],index:-1,revision:0,committedIndex:-1};histories.set(key,record);}
    return record;
  }
  function historyState(key:string):DirectoryHistory {
    const record=histories.get(key);
    return record?{paths:[...record.paths],index:record.index}:{paths:[],index:-1};
  }
  function remember(key:string,path:string,navigating=false){
    const record=history(key),normalized=directoryPath(path);
    if(record.paths[record.index]===normalized){record.committedIndex=record.index;return;}
    record.revision++;
    if(navigating&&record.index>=0)record.paths[record.index]=normalized;
    else {
      record.paths=record.paths.slice(0,record.index+1);
      record.paths.push(normalized);
      if(record.paths.length>80)record.paths.shift();
      record.index=record.paths.length-1;
    }
    record.committedIndex=record.index;
    port.changed(key);
  }
  async function navigateHistory(key:string,direction:number){
    const tab=port.tab(key),record=histories.get(key),step=Math.trunc(Number(direction));
    if(!tab||tab.kind&&tab.kind!=='sftp'||!record||!Number.isFinite(step)||!step)return false;
    const nextIndex=record.index+step;
    if(nextIndex<0||nextIndex>=record.paths.length)return false;
    port.restore?.(key);
    cancelSearch(key);
    const revision=++record.revision;
    record.index=nextIndex;port.changed(key);
    const rollback=()=>{
      if(histories.get(key)===record&&record.revision===revision){record.index=record.committedIndex;port.changed(key);}
    };
    try {
      const loaded=await port.load({connectionId:tab.id,path:record.paths[nextIndex],page:1,tabKey:key,historyNavigation:true});
      if(!loaded)rollback();
      else if(histories.get(key)===record&&record.revision===revision)record.committedIndex=record.index;
      return loaded;
    }catch(error){rollback();throw error;}
  }
  function navigatePath(key:string,path:string,options:DirectoryLoadOptions={}){
    const tab=port.tab(key);if(!tab||tab.kind&&tab.kind!=='sftp')return Promise.resolve(false);
    cancelSearch(key);
    return port.load({...options,connectionId:tab.id,path:String(path||'.'),page:Math.max(1,Number(options.page||1)),tabKey:key});
  }
  function page(key:string,value:number){
    const runtime=port.runtime(key);if(!runtime)return;
    cancelSearch(key);
    const target=Math.max(1,Math.min(Number(value)||1,Number(runtime.state.totalPages||1)));
    if(target===runtime.state.page&&!runtime.state.loading)return;
    return port.load({page:target,tabKey:key});
  }
  function jump(key:string,input:unknown){
    const control=input&&typeof input==='object'&&'value'in input?input as {value:unknown}:null;
    const value=Number(control?.value??input);if(!Number.isFinite(value))return;
    const runtime=port.runtime(key);if(!runtime)return;
    const target=Math.max(1,Math.min(Math.trunc(value),Number(runtime.state.totalPages||1)));
    if(control)control.value=String(target);
    return page(key,target);
  }
  function pageSize(key:string,value:number){
    const runtime=port.runtime(key),size=Number(value);if(!runtime||!PAGE_SIZES.includes(size)||size===runtime.state.pageSize)return;
    cancelSearch(key);
    port.pageSize(size);runtime.state.pageSize=size;runtime.state.page=1;
    return port.load({page:1,tabKey:key});
  }
  function sort(key:string,column:string){
    const runtime=port.runtime(key),tab=port.tab(key);
    if(!runtime||!tab||tab.kind&&tab.kind!=='sftp'||runtime.connectionId!==tab.id||!['name','size','mtime'].includes(column))return;
    cancelSearch(key);
    runtime.state.dir=runtime.state.sort===column&&runtime.state.dir==='asc'?'desc':'asc';
    runtime.state.sort=column;runtime.state.page=1;
    return port.load({page:1,tabKey:key});
  }
  return {page,jump,pageSize,sort,historyState,remember,navigateHistory,navigatePath,search,recursive:(key:string,enabled:boolean)=>{const runtime=port.runtime(key);return runtime?search(key,runtime.state.query,enabled):false;},release:(key:string)=>{cancelSearch(key);histories.delete(key);}};
}
