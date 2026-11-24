import {frequencies,type Automation,type Connection,type Draft,type Frequency,type RunDetail,type RunFilter,type Schedule} from './automation-types';
export const positive=(id:number)=>Number.isSafeInteger(id)&&id>0;
export const bounded=(value:unknown,fallback:number,min=1,max=10080)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):fallback;
export const intervalMaximum=(frequency:string)=>({every_second:86400,every_minute:10080,every_hour:8760,daily:365,weekly:52,monthly:12,yearly:10,half_hour:48} as Record<string,number>)[frequency]||1;
export function remoteApi(value:string){const path=value.trim().replace(/\\/g,'/');return !path||path==='~'||path==='.'?'.':path==='/'?'/':path.replace(/\/$/,'');}
export const remoteDisplay=(value:string)=>remoteApi(value)==='.'?'~':value;
export function remoteJoin(base:string,name:string){const left=remoteApi(base).replace(/\/+$/,'')||'/';return left==='.'?name:left==='/'?'/'+name:left+'/'+name;}
export function remoteParent(value:string){const path=remoteApi(value).replace(/\/$/,'');if(path==='.'||path==='/')return '.';const index=path.lastIndexOf('/');return index<=0?'.':path.slice(0,index);}
export const realtime=(item:Automation)=>item.kind==='sync'&&(item.trigger_mode==='continuous'||item.schedule?.frequency==='realtime');
export function status(item:Pick<Automation,'enabled'|'last_status'>){if(!item.enabled)return 'paused';return ['idle','running','done','failed','needs_attention','paused'].includes(item.last_status||'')?item.last_status!:'idle';}
export function unified(item:Automation):Schedule {const schedule={...item.schedule};if(realtime(item))schedule.frequency='realtime';else if(item.kind==='sync'&&item.trigger_mode==='interval'){schedule.frequency='every_minute';schedule.interval=item.options?.interval_minutes||schedule.interval||15;}else if(item.id&&item.kind==='sync'&&item.trigger_mode==='manual')schedule.frequency='legacy_manual';return schedule;}
export function dateTime(value:number){if(!Number.isFinite(value)||value<=0)return '';const date=new Date(value),pad=(part:number)=>String(part).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;}
export function parseStartTime(value:string){
  if(!value)return 0;
  const parts=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
  if(!parts||Number(parts[1])<1)return NaN;
  const date=new Date(value.replace(' ','T')),time=date.getTime();
  return Number.isFinite(time)&&[date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes()].every((part,index)=>part===Number(parts[index+1]))?time:NaN;
}
export function draft(item:Automation|null,connections:Connection[],defaultPath:string):Draft {
  const schedule=item?unified(item):{frequency:'daily',hour:9,minute:0},options=item?.options||{},seconds=bounded(schedule.countdown_seconds??60,60,1,2678400);
  const frequency=(frequencies.includes(schedule.frequency as Frequency)?schedule.frequency:'daily') as Frequency;
  const direction=item?.direction||'upload',safe=direction==='bidirectional'||frequency==='realtime'||item?.kind==='sync';
  return {id:item?.id||0,existing:item,name:item?.name||'',connectionId:item?.connection_id||connections[0]?.id||0,localPath:item?.local_path||defaultPath,remotePath:remoteDisplay(item?.remote_path||'.'),direction,frequency,interval:bounded(schedule.interval??(frequency==='every_second'?30:1),1,1,intervalMaximum(frequency)),weekdays:schedule.weekdays||[schedule.weekday??1],day:bounded(schedule.day??1,1,1,31),month:bounded(schedule.month??1,1,1,12),countdownHours:Math.floor(seconds/3600),countdownMinutes:Math.floor(seconds%3600/60),countdownSeconds:seconds%60,slots:schedule.half_hour_slots?.length?[...schedule.half_hour_slots]:Array.from({length:48},(_,index)=>index),cron:schedule.cron||'',startAt:dateTime(schedule.start_at_ms||schedule.at_ms||0),enabled:item?.enabled!==false,conflict:options.conflict||'overwrite',excludes:options.excludes||'',notify:options.notify??!safe,notifyAuto:options.notify===undefined,compareContent:options.compare_content!==false,propagateDeletes:options.propagate_deletes===true,missedPolicy:item?.missed_policy||'run_once',cronState:'idle',cronRuns:[],cronError:''};
}
export const safeSync=(value:Draft)=>value.direction==='bidirectional'||value.frequency==='realtime'||value.propagateDeletes||value.existing?.kind==='sync';
export function payload(value:Draft){
  const start=parseStartTime(value.startAt)||0;
  const schedule:Schedule=value.frequency==='legacy_manual'?{...value.existing?.schedule}:{frequency:value.frequency,interval:value.interval,weekdays:[...value.weekdays],weekday:value.weekdays[0]??1,day:value.day,month:value.month,countdown_seconds:value.countdownHours*3600+value.countdownMinutes*60+value.countdownSeconds,half_hour_slots:[...value.slots],cron:value.cron,start_at_ms:start,at_ms:start||value.existing?.schedule?.at_ms||0,hour:start?new Date(start).getHours():value.existing?.schedule?.hour??9,minute:start?new Date(start).getMinutes():value.existing?.schedule?.minute??0};
  return {kind:'auto',name:value.name,connection_id:value.connectionId,local_path:value.localPath,remote_path:remoteApi(value.remotePath),direction:value.direction,trigger_mode:value.frequency==='legacy_manual'?'manual':value.frequency==='realtime'?'continuous':'schedule',enabled:value.enabled,missed_policy:value.missedPolicy,options:{conflict:value.conflict,excludes:value.excludes,interval_minutes:value.frequency==='every_minute'?value.interval:value.existing?.options?.interval_minutes||15,notify:value.notify,compare_content:value.compareContent,propagate_deletes:value.propagateDeletes,history_limit:value.existing?.options?.history_limit||300},schedule};
}
export const detailMatches=(detail:RunDetail,filter:RunFilter)=>filter==='all'||({transferred:['uploaded','downloaded'],deleted:['deleted_local','deleted_remote'],skipped:['skipped'],conflicts:['conflict','delete_conflict'],failed:['failed']}[filter]).includes(detail.action);
