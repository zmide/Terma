import type {Api} from '../operations/operations-types';
import type {RunningForward} from '../operations/running-forwards';
export interface BulkConnection {id:number;ssh_host?:string;ssh_port?:number;ssh_user?:string;forwards:RunningForward[]}
interface Port {api:Api;connections():BulkConnection[]}
export interface BulkTarget {connection:number;id:number;signature:string}
const signature=(c:BulkConnection,f:RunningForward)=>JSON.stringify([c.id,c.ssh_host,c.ssh_port,c.ssh_user,f.id,f.mode,f.bind_host,f.bind_port,f.target_host,f.target_port,f.group_name||'']);
export const needsStop=(f:RunningForward)=>f.status!=='stopped'||!!f.pid||!!f.restore;
export function captureBulk(port:Port,ids:number[]):BulkTarget[]{
  const wanted=new Set(ids);if(wanted.size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))return [];
  const result=port.connections().flatMap(c=>c.forwards.filter(f=>wanted.has(f.id)).map(f=>({connection:c.id,id:f.id,signature:signature(c,f)})));
  return result.length===ids.length?result:[];
}
// Capture IDs before awaiting; never replace them with a later page, filter or group selection.
export async function operateBulk(port:Port,targets:BulkTarget[],kind:'start'|'stop',alive:()=>boolean,prepare?:(id:number)=>Promise<boolean>){
  const result={success:0,failed:0,skipped:0};
  for(const target of targets){
    const find=()=>{const c=port.connections().find(c=>c.id===target.connection),f=c?.forwards.find(f=>f.id===target.id);return c&&f?{c,f}:null;};
    let now=find();if(!alive()||!now||signature(now.c,now.f)!==target.signature){result.skipped++;continue;}
    if(kind==='start'&&['running','reconnecting'].includes(now.f.status||''))continue;
    if(kind==='stop'&&!needsStop(now.f))continue;
    try{
      if(kind==='start'&&prepare){if(!await prepare(target.id)){result.skipped++;continue;}now=find();if(!alive()||!now){result.skipped++;continue;}
        // The conflict flow may approve a new bind port, but no other endpoint or membership change.
        const expected=JSON.parse(target.signature) as unknown[];expected[7]=now.f.bind_port;
        if(signature(now.c,now.f)!==JSON.stringify(expected)){result.skipped++;continue;}
      }
      if(!alive()){result.skipped++;continue;}
      await port.api(`/api/forwards/${target.id}/${kind}`,{method:'POST'});result.success++;
    }catch{result.failed++;}
  }
  return result;
}
