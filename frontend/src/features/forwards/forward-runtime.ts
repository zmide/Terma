import type {Forward,ForwardPort} from './forward-model';
import type {RunningForward} from '../operations/running-forwards';
type AccessInput = RunningForward & Pick<Forward,'url_scheme'|'url_path'>;

export interface ForwardRuntimePort {
  tr:ForwardPort['tr'];
  locale:()=>string;
  pageHost:(bindHost:string)=>string;
  isLoopback:(host:string)=>boolean;
  escape:(value:string)=>string;
  lanHost:()=>string;
}

export interface ForwardAccess {url:string;note:string;localOnly?:boolean}
export interface ForwardDiagnosis {occupied?:boolean;host?:string;port?:number}

export function createForwardRuntime(port:ForwardRuntimePort){
  const t=port.tr;
  const endpoint=(host:string|undefined,portNumber:number|undefined)=>{
    const value=String(host||'');
    return `${value.includes(':')&&!value.startsWith('[')?`[${value}]`:value}:${portNumber||''}`;
  };
  function modeText(mode:string){return ({local:t('connections:forwards.local_forward',{defaultValue:'Local forwarding'}),remote:t('connections:forwards.remote_forward',{defaultValue:'Remote forwarding'}),socks:'SOCKS5'} as Record<string,string>)[mode]||port.escape(mode);}
  function statusText(status:string){const key=({running:'running',stopped:'stopped',failed:'failed',reconnecting:'reconnecting'} as Record<string,string>)[status];const fallback=({running:'Running',stopped:'Stopped',failed:'Failed to start',reconnecting:'Reconnecting'} as Record<string,string>)[status];return key?t(`connections:forwards.${key}`,{defaultValue:fallback}):port.escape(status);}
  function serviceTypeText(type:string){return ({web:'Web',mysql:'MySQL',redis:'Redis',ssh:'SSH',socks:'SOCKS5',other:t('common:auto.other',{defaultValue:'Other'})} as Record<string,string>)[type]||port.escape(type||'');}
  function displayName(forward:Forward){return forward.service_name||(forward.service_type&&forward.service_type!=='other'?serviceTypeText(forward.service_type):modeText(forward.mode));}
  function text(forward:Forward){
    if(forward.mode==='socks')return port.escape(endpoint(forward.bind_host,forward.bind_port));
    const bind=port.escape(endpoint(forward.bind_host,forward.bind_port)),target=port.escape(endpoint(forward.target_host,forward.target_port));
    return t(`connections:forwards.${forward.mode==='remote'?'remote_listener':'local_listener'}`,{bind,target,defaultValue:`${forward.mode==='remote'?'Remote listener':'Local listener'} ${bind} → target ${target}`});
  }
  function compactText(forward: Forward) {
    const bind = endpoint(forward.bind_host, forward.bind_port);
    return forward.mode === 'socks' ? bind : `${bind} → ${endpoint(forward.target_host, forward.target_port)}`;
  }
  function accessInfo(forward:AccessInput):ForwardAccess{
    if(forward.mode==='remote')return {url:'',note:''};
    const rawBindHost=String(forward.bind_host||''),wildcard=['0.0.0.0','::',''].includes(rawBindHost),bindHost=wildcard?'0.0.0.0':rawBindHost,host=port.pageHost(bindHost),scheme=forward.url_scheme||(forward.service_type==='web'?'http':'http'),urlHost=String(host).includes(':')&&!String(host).startsWith('[')?`[${host}]`:host,path=String(forward.url_path||'').trim(),url=`${scheme}://${urlHost}:${forward.bind_port}${path}`,lanPage=!port.isLoopback(port.lanHost());
    let note='';
    if(lanPage&&port.isLoopback(bindHost))note=t('connections:forwards.local_only_lan_warning',{defaultValue:'This forwarding rule listens only on this computer and cannot be opened directly from the LAN. Change the bind address to 0.0.0.0 and restart it.'});
    else if(lanPage&&wildcard)note=t('connections:forwards.lan_access',{defaultValue:'Available on the LAN'});
    else if(!lanPage)note=port.isLoopback(bindHost)?t('connections:forwards.local_only',{defaultValue:'Local access only'}):t('connections:forwards.bind_access',{defaultValue:'Available through the listener address'});
    return {url,note,localOnly:lanPage&&port.isLoopback(bindHost)};
  }
  function isActive(forward:Forward){return ['running','reconnecting'].includes(String(forward?.status||''));}
  function openUrl(forward:AccessInput){return accessInfo(forward).url||'';}
  function runningUrl(forward: Forward) {
    return String(forward?.status || '') === 'running' ? openUrl(forward) : '';
  }
  function canAccess(forward:Forward){return Boolean(runningUrl(forward));}
  function accessHtml(access:ForwardAccess){return access?.url?`<div class="service-url">${port.escape(access.url)}</div>${access.note?`<div class="conn-meta ${access.localOnly?'warning-text':''}">${port.escape(access.note)}</div>`:''}`:'';}
  function formatDuration(seconds:number){const s=Math.max(0,Math.floor(seconds||0)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);if(h)return t('connections:forwards.duration_hours_minutes',{hours:h,minutes:m,defaultValue:`${h}h ${m}m`});if(m)return t('connections:forwards.duration_minutes_seconds',{minutes:m,seconds:s%60,defaultValue:`${m}m ${s%60}s`});return t('connections:forwards.duration_seconds',{seconds:s,defaultValue:`${s}s`});}
  function quality(forward:RunningForward){const parts:string[]=[];if(forward.pid)parts.push(`PID ${forward.pid}`);if(forward.started_at)parts.push(t('connections:forwards.runtime',{duration:formatDuration(Date.now()/1000-Number(forward.started_at)),defaultValue:`Running for ${formatDuration(Date.now()/1000-Number(forward.started_at))}`}));if(Number(forward.reconnect_count||0))parts.push(t('connections:forwards.reconnect_count',{count:forward.reconnect_count,defaultValue:`Reconnected ${forward.reconnect_count} times`}));return parts.join(' · ');}
  function eventTimeText(value:number){const timestamp=Number(value||0);if(!Number.isFinite(timestamp)||timestamp<=0)return '';const date=new Date(timestamp>1e12?timestamp:timestamp*1000);return Number.isNaN(date.getTime())?'':date.toLocaleString(port.locale()||'zh-CN',{hour12:false});}
  function diagnosisEndpoint(diagnosis:ForwardDiagnosis={}){const rawHost=String(diagnosis.host||'').trim(),host=rawHost.startsWith('[')&&rawHost.endsWith(']')?rawHost.slice(1,-1):rawHost,displayHost=host.includes(':')?`[${host}]`:host,portNumber=Number(diagnosis.port||0);return portNumber?`${displayHost}:${portNumber}`:displayHost;}
  function diagnosisMessage(diagnosis:ForwardDiagnosis={}){const endpointValue=diagnosisEndpoint(diagnosis);return diagnosis.occupied?t('connections:forwards.diagnosis_port_occupied',{endpoint:endpointValue,defaultValue:`Listening endpoint ${endpointValue} is in use`}):t('connections:forwards.diagnosis_port_available',{endpoint:endpointValue,defaultValue:`Listening endpoint ${endpointValue} is available`});}
  return {endpoint,modeText,statusText,serviceTypeText,displayName,text,compactText,accessInfo,isActive,canAccess,openUrl,runningUrl,accessHtml,formatDuration,quality,eventTimeText,diagnosisEndpoint,diagnosisMessage};
}

