export interface SessionTab {
 key:string;kind:string;title:string;subtitle:string;viewName:string;closable:boolean;id?:number;path?:string;protocol?:string;fileSource?:string;
 pinned?:boolean;sessionMode?:string;sessionBackend?:string;persistentSessionId?:string;resumePolicy?:string;lastKnownCwd?:string;connectionStatus?:string;closed_at?:number;
}
export interface RecoverableRecord {tab:SessionTab;open:boolean;identity:string}
const kinds=new Set(['terminal','sftp','forwards','forward-manager','edit','import','log','command','dashboard','remote-edit','remote-desktop','linux-desktop','remote-terminal','ftp','settings']);
const text=(value:unknown,max=4096)=>typeof value==='string'?value.slice(0,max):'';
// Only restoration metadata belongs in browser history; credentials and engine objects never do.
export function cleanTab(value:unknown):SessionTab|null {
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>,kind=text(v.kind,40),key=text(v.key,256);
 if(!kinds.has(kind)||!key||v.transient)return null;
 if(['terminal','sftp','forwards','dashboard','linux-desktop','remote-terminal','remote-desktop','ftp'].includes(kind)&&(!Number.isSafeInteger(v.id)||Number(v.id)<=0))return null;
 const tab:SessionTab={key,kind,title:text(v.title,1024),subtitle:text(v.subtitle,2048),viewName:text(v.viewName,80),closable:v.closable!==false};
 if(Number.isSafeInteger(v.id)&&Number(v.id)>0)tab.id=Number(v.id);
 for(const field of ['path','protocol','fileSource','lastKnownCwd'] as const)if(typeof v[field]==='string')tab[field]=text(v[field]);
 if(kind==='terminal'){tab.sessionMode=v.sessionMode==='persistent'?'persistent':'none';tab.sessionBackend=['auto','tmux','screen'].includes(String(v.sessionBackend))?String(v.sessionBackend):'auto';tab.persistentSessionId=/^[A-Za-z0-9_.-]{1,64}$/.test(String(v.persistentSessionId||''))?String(v.persistentSessionId):'';tab.resumePolicy=v.resumePolicy==='never'?'never':'auto';}
 if(typeof v.connectionStatus==='string')tab.connectionStatus=text(v.connectionStatus,30);
 if(typeof v.closed_at==='number'&&Number.isFinite(v.closed_at))tab.closed_at=v.closed_at;
 return tab;
}
export const recoverable=(tab:SessionTab)=>tab.kind==='terminal'&&Number(tab.id)>0&&tab.sessionMode==='persistent'&&!!tab.persistentSessionId;
export const identity=(tab:SessionTab)=>recoverable(tab)?`${tab.id}\u0000${tab.persistentSessionId}`:'';
export const normalSession={sessionMode:'none',sessionBackend:'auto',persistentSessionId:'',resumePolicy:'never'};
export function historyRows(value:unknown){if(!Array.isArray(value))return [];const seen=new Set<string>();return value.map(cleanTab).filter((tab):tab is SessionTab=>!!tab&&!seen.has(tab.key)&&!!seen.add(tab.key)).slice(0,30);}
export function recoverableRecords(open:SessionTab[],closed:SessionTab[]):RecoverableRecord[]{const seen=new Set<string>(),rows:RecoverableRecord[]=[];for(const [tabs,isOpen]of [[open,true],[closed,false]] as const)for(const tab of tabs){const id=identity(tab);if(!id||seen.has(id))continue;seen.add(id);rows.push({tab:{...tab},open:isOpen,identity:id});}return rows;}
