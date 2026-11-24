import {h,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '@/features/settings/settings-icon';
import {showOperationsModal} from './operations-modal';
import {errorMessage,identifier,request,type Api,type ExternalSession,type SyncModel,type Translate} from './operations-types';
import type {createExternalEditService} from './external-edit-service';
import type {SyncActions} from './directory-sync-service';

const button=(text:string,run:()=>unknown,glyph='',className='',disabled=false,id='')=>h(TermaButton,{id:id||undefined,type:'button',title:text,'aria-label':text,class:className,disabled,onClick:run},()=>[glyph?icon(glyph):null,className.includes('icon-button')?null:h('span',null,text)]);
const heading=(title:string,subtitle:string,close:()=>void,t:Translate)=>h('header',{class:'operations-head'},[h('div',null,[h('h2',null,title),h('span',null,subtitle)]),button(t('common:actions.close'),close,'x','icon-button')]);
const errorView=(error:string)=>error?h('p',{class:'operations-error',role:'alert'},error):null;
export function externalStatus(t:Translate,status:string){return ['watching','modified','conflict','synced','error'].includes(status)?t(`sftp:external_edit.status_${status}`):status;}
export function syncAction(t:Translate,action:string){return ['upload','download','conflict'].includes(action)?t(`sftp:sync.action_${action}`):action;}
const reasonKeys:Record<string,string>={'两端内容不同':'reason_different','本地与远程不同':'reason_local_remote_different','远程缺少文件':'reason_remote_missing','本地缺少文件':'reason_local_missing','本地文件较新':'reason_local_newer','远程文件较新':'reason_remote_newer','冲突：已选择上传本地文件':'reason_conflict_upload','冲突：已选择下载远程文件':'reason_conflict_download'};
export const syncReason=(t:Translate,reason:string)=>reasonKeys[reason]?t(`sftp:sync.${reasonKeys[reason]}`):reason;
export function showExternalManager(port:{api:Api;tr:Translate;service:ReturnType<typeof createExternalEditService>;notify(message:string,kind:'error'):void}){
  const state={sessions:[] as ExternalSession[],loading:false,error:'',busy:new Set<string>()};let generation=0;
  const t=port.tr;
  const binding=showOperationsModal(()=>h('section',{class:'modal-card wide operations-manager',role:'dialog','aria-modal':'true','aria-label':t('sftp:external_edit.manager_title')},[
    heading(t('sftp:external_edit.manager_title'),t('sftp:external_edit.count',{count:state.sessions.length}),()=>binding.close(),t),
    h('div',{class:'operations-toolbar'},[button(t('common:actions.refresh'),load,'refresh-cw','',state.loading)]),errorView(state.error),
    h('div',{class:'operations-list','aria-busy':state.loading},state.sessions.length?state.sessions.map(session=>h('div',{key:session.id,class:'operations-session'},[
      h('span',{class:'operations-session-icon'},icon(session.status==='conflict'?'triangle-alert':'file-pen-line')),
      h('div',{class:'operations-copy'},[h('strong',null,session.remote_path),h('small',null,`${session.connection_name} · ${externalStatus(t,session.status)}`),h('code',null,session.local_path)]),
      h('div',{class:'actions'},[...(['modified','conflict'].includes(session.status)?[button(t('sftp:external_edit.handle_changes'),()=>handle(session.id),'file-pen-line','primary',state.busy.has(session.id))]:[]),button(t('sftp:external_edit.stop_cleanup'),()=>stop(session.id),'trash-2','danger',state.busy.has(session.id))])
    ])):h('div',{class:'ui-state'},[icon(state.loading?'loader-circle':'file-pen-line'),h('strong',null,t(state.loading?'sftp:external_edit.loading':'sftp:external_edit.empty_title')),h('p',null,t('sftp:external_edit.empty_hint'))])),
    h('footer',{class:'actions'},[button(t('common:actions.close'),()=>binding.close())])
  ]),()=>generation++);
  async function load(){if(!binding.alive())return;const ticket=++generation;state.loading=true;state.error='';binding.paint();
    try{const sessions=await request<ExternalSession[]>(port.api,'/api/sftp/external-edits');if(binding.alive()&&ticket===generation)state.sessions=Array.isArray(sessions)?sessions.filter(item=>identifier(item?.id)&&typeof item.remote_path==='string'):[];}
    catch(error){if(binding.alive()&&ticket===generation)state.error=errorMessage(error,t('sftp:external_edit.load_failed'));}
    finally{if(binding.alive()&&ticket===generation){state.loading=false;binding.paint();}}
  }
  async function stop(id:string){if(state.busy.has(id))return;state.busy.add(id);state.error='';binding.paint();try{await port.service.stop(id);if(binding.alive())await load();}catch(error){if(binding.alive())state.error=errorMessage(error,t('sftp:external_edit.stop_failed'));}finally{state.busy.delete(id);if(binding.alive())binding.paint();}}
  async function handle(id:string){binding.close();try{await port.service.byId(id);}catch(error){port.notify(errorMessage(error,t('sftp:external_edit.load_failed')),'error');}}
  return Object.assign(binding,{ready:load()});
}
export function showDirectorySync(model:SyncModel,actions:SyncActions,closed:()=>void,t:Translate,bytes:(size:number)=>string){
  const input=(id:string,value:string,label:string)=>h('label',{for:id},[label,h('input',{id,value,readonly:true})]);
  const options=()=>[
    h('div',{class:'operations-paths'},[input('sftpSyncLocalPath',model.localPath,t('sftp:sync.local_directory')),input('sftpSyncRemotePath',model.remotePath,t('sftp:sync.remote_directory'))]),
    h('div',{class:'operations-options'},[
      h('label',{for:'sftpSyncMode'},[t('sftp:sync.mode'),h('select',{id:'sftpSyncMode',value:model.mode,disabled:model.busy,onChange:(event:Event)=>actions.change('mode',(event.target as HTMLSelectElement).value)},[['bidirectional','bidirectional'],['upload','upload_only'],['download','download_only']].map(([value,key])=>h('option',{value},t(`sftp:sync.${key}`))))]),
      h('label',{class:'operations-check'},[h('input',{id:'sftpSyncUseHash',type:'checkbox',checked:model.useHash,disabled:model.busy,onChange:(event:Event)=>actions.change('useHash',(event.target as HTMLInputElement).checked)}),t('sftp:sync.use_hash')])
    ]),
    h('label',{for:'sftpSyncExcludes'},[t('sftp:sync.excludes'),h('textarea',{id:'sftpSyncExcludes',value:model.excludes,rows:3,placeholder:t('sftp:sync.excludes_placeholder'),disabled:model.busy,onInput:(event:Event)=>actions.change('excludes',(event.target as HTMLTextAreaElement).value)})]),
    h('p',{class:'operations-safety'},[icon('shield-check'),h('span',null,t('sftp:sync.safety'))])
  ];
  const plan=():VNodeChild=>{
    const value=model.plan;if(!value)return null;
    const selectable=value.actions.filter(item=>item.action!=='conflict'||model.overrides.has(item.index));
    return [h('div',{class:'operations-plan-head'},[h('label',{class:'operations-check'},[h('input',{id:'sftpSyncSelectAll',type:'checkbox',checked:selectable.length>0&&selectable.every(item=>model.selected.has(item.index)),disabled:model.busy,onChange:(event:Event)=>actions.selectAll((event.target as HTMLInputElement).checked)}),t('sftp:sync.select_non_conflicts')]),h('code',null,`${value.local_path} ⇄ ${value.remote_path}`)]),
      h('div',{class:'operations-plan-list'},value.actions.length?value.actions.map(item=>h('div',{key:item.index,class:['operations-plan-row',item.action]},[
        h('input',{class:'sftp-sync-plan-check',type:'checkbox',value:item.index,checked:model.selected.has(item.index),disabled:model.busy||item.action==='conflict'&&!model.overrides.has(item.index),'aria-label':item.relative,onChange:(event:Event)=>actions.select(item.index,(event.target as HTMLInputElement).checked)}),
        h('span',{class:'operations-direction'},[icon(item.action==='upload'?'upload':item.action==='download'?'download':'triangle-alert'),syncAction(t,item.action)]),
        h('div',{class:'operations-copy'},[h('strong',{title:item.relative},item.relative),h('small',null,syncReason(t,item.reason||''))]),
        item.action==='conflict'?h('select',{class:'sftp-sync-conflict-direction','data-index':item.index,'aria-label':t('sftp:sync.action_conflict'),value:model.overrides.get(item.index)||'',disabled:model.busy,onChange:(event:Event)=>actions.direction(item.index,(event.target as HTMLSelectElement).value)},[['','conflict_skip'],['upload','conflict_upload'],['download','conflict_download']].map(([value,key])=>h('option',{value},t(`sftp:sync.${key}`)))):
          h('span',{class:'operations-size'},`${item.local_size===null?'-':bytes(item.local_size)} / ${item.remote_size===null?'-':bytes(item.remote_size)}`)
      ])):h('div',{class:'ui-state'},[h('strong',null,t('sftp:sync.empty_title')),h('p',null,t('sftp:sync.empty_hint'))]))];
  };
  return showOperationsModal(()=>h('section',{class:'modal-card operations-sync',role:'dialog','aria-modal':'true','aria-label':t('sftp:sync.title')},[
    heading(t(model.phase==='plan'?'sftp:sync.plan_title':model.phase==='scanning'?'sftp:sync.comparing_title':'sftp:sync.title'),model.phase==='plan'?t('sftp:sync.totals',{upload:model.plan?.totals?.upload||0,download:model.plan?.totals?.download||0,conflict:model.plan?.totals?.conflict||0}):model.connectionName,actions.close,t),
    h('div',{class:'operations-body'},[errorView(model.error),model.phase==='scanning'?h('div',{class:'ui-state',role:'status'},[icon('loader-circle'),h('strong',null,t('sftp:sync.scanning')),h('p',null,t('sftp:sync.progress_hint'))]):model.phase==='plan'?plan():options()]),
    h('footer',{class:'actions'},[button(t('common:actions.close'),actions.close),model.phase==='plan'?button(t(model.busy?'sftp:sync.starting':'sftp:sync.execute_selected'),actions.execute,model.busy?'loader-circle':'play','primary',model.busy||!model.selected.size||!model.plan?.actions.length,'sftpSyncExecute'):model.phase!=='scanning'?button(t(model.phase==='error'?'common:actions.retry':'sftp:sync.generate_plan'),actions.compare,'scan-search','primary',model.busy,'sftpSyncCompare'):null])
  ]),closed);
}
