import { xdmcpInstallAction } from './management-diagnostics';

export type ManagedProtocol='rdp'|'xdmcp';
export type InstallMode='online'|'offline'|'local-offline';
type Translate=(key:string,params?:Record<string,unknown>)=>string;
export function protocolOperation(protocol:ManagedProtocol,action:string,mode:string,t:Translate){
 if(!['rdp','xdmcp'].includes(protocol))return null;
 if(!['online','offline','local-offline'].includes(mode))return null;
 const install=protocol==='rdp'?action==='install':xdmcpInstallAction(action);
 const allowed=protocol==='rdp'?['install','start','stop','restart','uninstall']:['install-lightdm','install-xfce','install-rdp','enable','disable','repair-session','repair-xrdp','cleanup-sessions','uninstall-lightdm'];
 if(!allowed.includes(action))return null;
 const requestAction=install&&mode!=='online'?`${action}-${mode}`:action;
 const modeLabel=()=>t(`remote:${protocol==='rdp'?'rdp_status':'vnc_ui'}.${mode==='local-offline'?'mode_local_offline':mode==='offline'?'mode_remote_cache':'mode_online'}`);
 if(protocol==='rdp'){
  const title=()=>install?t('remote:rdp_status.install_action_title',{mode:modeLabel()}):t('remote:rdp_status.action_'+action);
  return {requestAction,scope:`rdp.server.${requestAction}`,title,
   message:()=>t('remote:rdp_status.'+(install?mode==='local-offline'?'confirm_local_offline_install':mode==='offline'?'confirm_remote_cache_install':'confirm_online_install':'confirm_'+action)),
   confirm:()=>t(install?'common:actions.install':action==='uninstall'?'common:actions.remove':action==='restart'?'remote:rdp_status.restart':'common:auto.'+action),
   danger:install||['stop','uninstall'].includes(action),busy:()=>t(install?'common:auto.installing':action==='uninstall'?'common:auto.uninstalling':action==='stop'?'common:auto.stopping':action==='restart'?'remote:rdp_status.restarting':'common:auto.starting'),
   success:()=>t(install?'remote:rdp_status.install_complete_redetected':'remote:rdp_status.action_complete_redetected',{action:title()}),
   failure:()=>t(install?'remote:rdp_status.install_failed':'remote:rdp_status.action_failed',{mode:modeLabel(),action:title()}),body:{action:requestAction}};
 }
 const cleanup=action==='cleanup-sessions',uninstall=action==='uninstall-lightdm',disable=action==='disable',repair=['repair-session','repair-xrdp'].includes(action);
 const title=()=>install?t('remote:xdmcp_setup.mode_install_action',{mode:modeLabel(),action:t('remote:xdmcp_setup.'+(action==='install-lightdm'?'install_lightdm':action==='install-xfce'?'install_desktop':'install_rdp'))}):t(cleanup?'remote:xdmcp_setup.end_conflicts':uninstall?'remote:xdmcp_status.uninstall_restore_manager':disable?'remote:xdmcp_status.close_xdmcp':action==='repair-session'?'remote:xdmcp_status.repair_default_desktop':action==='repair-xrdp'?'remote:xdmcp_status.repair_rdp_session':'remote:xdmcp_setup.enable_xdmcp');
 return {requestAction,scope:mode==='local-offline'&&install?`xdmcp.${requestAction}`:'xdmcp.configure',title,
  message:()=>t('remote:xdmcp_setup.confirm_'+action.replaceAll('-','_'),{mode:modeLabel(),suffix:mode==='local-offline'?t('remote:xdmcp_setup.local_offline_suffix'):''}),
  confirm:()=>t('remote:xdmcp_setup.'+(cleanup?'end_continue':uninstall?'uninstall_restore':disable?'close_restart':repair?'repair_restart':install?'install':'enable_restart')),
  danger:true,busy:()=>t('remote:xdmcp_setup.'+(disable?'closing':uninstall?'uninstalling':install?'installing':'processing')),
  success:()=>t('remote:xdmcp_setup.'+(cleanup?'conflicts_ended':disable?'closed':install?'install_complete_redetected':'configured_redetected'),{mode:modeLabel()}),
  failure:()=>t('remote:xdmcp_setup.configure_failed'),
  body:{action:requestAction,restart:!cleanup,confirmation:cleanup?'XDMCP_END_REMOTE_SESSIONS':'XDMCP_TRUSTED_LAN'}};
}
