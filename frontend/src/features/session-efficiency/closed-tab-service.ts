import {cleanTab,historyRows,identity,type SessionTab} from './session-model';
export interface HistoryPort {read():string|null;write(value:string):void;tabs():SessionTab[];now():number;exists(tab:SessionTab):boolean;restore(tab:SessionTab):boolean;notify(key:string,type:'info'|'error'|'success',error?:unknown):void;unlocked():boolean}
export function createClosedTabService(port:HistoryPort){let rows:SessionTab[]=[],restoring=false;
 const save=()=>{rows=historyRows(rows);try{port.write(JSON.stringify(rows));}catch{port.notify('terminal:session.history_unavailable','error');}};
 function load(){try{const text=port.read()||'[]';rows=historyRows(text.length<=1024*1024?JSON.parse(text):[]);}catch{rows=[];}return rows;}
 function remember(keys:string[]){load();const closing=keys.map(key=>cleanTab(port.tabs().find(t=>t.key===key))).filter((t):t is SessionTab=>!!t).map(tab=>({...tab,closed_at:port.now()}));if(!closing.length)return;rows=[...closing.reverse(),...rows.filter(row=>!closing.some(tab=>tab.key===row.key))];save();}
 const contains=(tab:SessionTab)=>rows.some(row=>row.key===tab.key&&row.id===tab.id&&row.kind===tab.kind&&row.persistentSessionId===tab.persistentSessionId&&row.closed_at===tab.closed_at);
 function remove(tab:SessionTab){load();rows=rows.filter(row=>!(row.key===tab.key&&row.closed_at===tab.closed_at));save();}
 function removeIdentity(id:string){load();if(id&&rows.some(tab=>identity(tab)===id)){rows=rows.filter(tab=>identity(tab)!==id);save();}}
 function restore(tab?:SessionTab){if(restoring||!port.unlocked())return false;load();const selected=tab?rows.find(row=>contains(tab)&&row.key===tab.key):rows[0];if(!selected){port.notify('terminal:productivity.no_closed_tab','info');return false;}if(!port.exists(selected)){port.notify('terminal:productivity.connection_deleted','error');return false;}restoring=true;try{if(!port.restore({...selected,pinned:false,connectionStatus:'disconnected'}))return false;remove(selected);port.notify('terminal:productivity.tab_restored','success');return true;}catch{port.notify('terminal:session.restore_failed','error');return false;}finally{restoring=false;}}
 return {load,remember,restore,contains,remove,removeIdentity,get rows(){return rows;}};
}
