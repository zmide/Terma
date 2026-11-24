interface HistoryStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const key='recentTerminalCommands',limit=30,maxLength=500;
export function createTerminalHistory(storage:HistoryStorage,warn:(error:unknown)=>void){
  let items:string[]=[];
  try {
    const saved:unknown=JSON.parse(storage.getItem(key)||'[]');
    if(Array.isArray(saved))items=[...new Set(saved.filter((value):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=maxLength))].slice(0,limit);
  } catch(error){warn(error);}
  function save(command:string){
    const text=String(command||'').trim();if(!text||text.length>maxLength)return;
    items=[text,...items.filter(item=>item!==text)].slice(0,limit);
    try {storage.setItem(key,JSON.stringify(items));}catch(error){warn(error);}
  }
  function clear(){items=[];try{storage.removeItem(key);}catch(error){warn(error);}}
  return {save,clear,list:()=>items.slice()};
}
export const terminalHistory=createTerminalHistory({
 getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)
},()=>console.warn('Terminal history storage is unavailable'));
