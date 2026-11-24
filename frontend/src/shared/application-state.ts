import type {WorkspaceTab} from '../features/workspace/workspace-tab-runtime';
import type {TerminalSession} from '../features/terminal/terminal-session-state';
import type {Connection,Template} from '../features/forwards/forward-model';
import type {RemoteProfile} from '../features/remote/profile-model';
import type {LogData} from '../features/logs/log-list-service';
import type {TerminalSettingsValues} from '../features/terminal/terminal-settings-port';
import type {HealthResult} from '../features/connections/connection-health-service';
import type {SftpPageConnection} from '../features/files/sftp/page-lifecycle';

export type ApplicationConnection=TerminalSession['connection'] & Connection & SftpPageConnection;
type SavedRemoteProfile=RemoteProfile & {id:number;name:string;group_name:string};
export interface ApplicationSecurity {
  token_set?:boolean;encryption_enabled?:boolean;encryption_ready?:boolean;
  encryption_transition_pending?:boolean;notification_mode?:string;
  manage_user_ssh_keys_enabled?:boolean;local_direct_desktop_integration_enabled?:boolean;
  trusted_proxy_enabled?:boolean;
  local_direct_desktop_integration?:{actual_listen_hosts?:string[];listen_loopback_only?:boolean;
    direct_loopback_request?:boolean;web_access_authorized?:boolean};
}

function savedSet(key:string,fallback:string[]=[]):Set<string> {
  try {
    const value:unknown=JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));
    return new Set(Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):fallback);
  }catch{return new Set(fallback);}
}
const stored=(key:string)=>typeof localStorage==='undefined'?null:localStorage.getItem(key);

export function createApplicationState() {
  if(typeof localStorage!=='undefined'&&!stored('terminalKeysDefaultCollapsedV2')){
    localStorage.setItem('terminalKeysVisible','0');
    localStorage.setItem('terminalKeysDefaultCollapsedV2','1');
  }
  return {
    connections:[] as ApplicationConnection[],selectedId:null as number|null,
    activeView:'welcome',primaryView:'connections',restoringTabs:false,workspaceRestorePending:false,
    tabs:[] as WorkspaceTab[],activeTabKey:'',
    remoteProfiles:[] as SavedRemoteProfile[],selectedRemoteProfileId:null as number|null,
    groupOpen:savedSet('openGroups'),remoteGroupOpen:savedSet('openRemoteGroups'),
    runningOpen:savedSet('openRunningGroups'),logOpen:savedSet('openLogs',['system','batch']),
    logsData:{system:[],batch:[],connections:[]} as LogData,pendingGroup:'',
    terminalFontSize:Number(stored('terminalFontSize')||13),
    terminalGlobalSettings:null as TerminalSettingsValues|null,
    terminalKeysVisible:stored('terminalKeysVisible')==='1',
    terminalCtrlArmed:false,terminalCtrlLocked:false,
    connectionSearch:stored('connectionSearch')||'',connectionBulkMode:false,
    selectedConnectionIds:new Set<number>(),logSearch:'',healthResults:new Map<number,HealthResult>(),
    connectionVirtual:{rowHeight:118,buffer:8,scrollTop:0},
    forwardTemplates:[] as Template[],runningGroupMode:stored('runningGroupMode')||'server',
    sftpDisconnectedTabs:new Set<string>(),securitySettings:null as ApplicationSecurity|null,
    sftpJobsTimer:null as unknown
  };
}
export const applicationState=createApplicationState();
