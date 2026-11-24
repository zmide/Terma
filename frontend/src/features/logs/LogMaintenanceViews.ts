import {logsServices} from '@/features/logs/installed-services';
import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {action,forwardDialog} from '../forwards/ForwardForms';
import {createLogMaintenance,type MaintenancePort} from './log-maintenance-service';
import {logBytes} from './log-list-service';
import '@/styles/log-maintenance.css';
export function createLogMaintenanceViews(port:MaintenancePort){
 const t=port.tr;let current:ReturnType<typeof forwardDialog>|null=null,controller:ReturnType<typeof createLogMaintenance>|null=null;
 function show(){current?.close();let dialog:ReturnType<typeof forwardDialog>|null=null;const service=createLogMaintenance(port,()=>!!dialog?.alive(),()=>dialog?.paint(),q=>dialog!.ask(q)),m=service.model;controller=service;
  const field=(key:'retention_days'|'max_file_size_mb'|'max_total_size_mb',id:string,label:string,min:number,max:number)=>h('label',{class:'log-maintenance-field'},[h('span',null,t('common:log_maintenance.'+label)),h('input',{id,type:'number',min,max,step:1,value:m.settings[key],disabled:m.busy||m.loading,onInput:(e:Event)=>m.settings[key]=Number((e.target as HTMLInputElement).value)})]);
  dialog=forwardDialog(port,()=>h('section',{class:'log-maintenance',role:'dialog','aria-modal':'true','aria-labelledby':'logSettingsTitle'},[
   h('header',null,[h('h2',{id:'logSettingsTitle'},t('common:log_maintenance.title')),action(t('common:actions.close'),()=>dialog?.close(),'x','icon-button')]),
   m.loading?h('p',{role:'status'},t('common:log_maintenance.loading')):null,
   h('form',{onSubmit:(e:Event)=>{e.preventDefault();void service.save(()=>dialog?.close());}},[
    h('div',{class:'log-maintenance-fields'},[field('retention_days','logSettingDays','retention_days',0,3650),field('max_file_size_mb','logSettingFileMb','file_limit_mb',1,2048),field('max_total_size_mb','logSettingTotalMb','total_limit_mb',0,102400)]),
    h('div',{class:'log-maintenance-stats'},[h('span',null,[t('common:log_maintenance.current_usage'),h('strong',null,service.bytes())]),h('span',null,[t('common:log_maintenance.file_count_label'),h('strong',null,m.files)])]),
    h('section',{class:'log-maintenance-history'},[h('label',{class:'log-maintenance-field'},[h('span',null,t('common:log_maintenance.cleanup_days')),h('input',{id:'logRetentionDays',type:'number',min:1,max:3650,value:m.days,disabled:m.busy||m.loading,onInput:(e:Event)=>{m.days=(e.target as HTMLInputElement).value;service.preview();}})]),action(t('common:log_maintenance.cleanup_selected'),()=>service.cleanup(Number(m.days),()=>dialog?.close()),'trash-2','danger',m.busy||m.loading||!/^\d+$/.test(m.days)||Number(m.days)<1||Number(m.days)>3650),h('p',{id:'logCleanupPreview','aria-live':'polite'},m.previewing?t('common:log_maintenance.cleanup_loading'):m.preview?t('common:log_maintenance.cleanup_preview_result',{files:m.preview.files,bytes:logBytes(m.preview.bytes)}):'')]),
    h('p',{class:'log-maintenance-description'},t('common:log_maintenance.description')),
    service.error()?h('p',{role:'alert',class:'log-maintenance-error'},[service.error(),action(t('common:actions.retry'),()=>service.load(),'refresh-cw','',m.busy)]):null,
    h('footer',null,[action(t('common:actions.cancel'),()=>dialog?.close()),h(TermaButton,{type:'submit',class:'primary',disabled:m.busy||m.loading||!m.loaded},()=>t(m.busy?'common:auto.saving':'common:actions.save'))])
   ])
  ]),()=>service.cancel());current=dialog;void service.load();return service;
 }
 async function standalone(kind:'cleanup'|'remove',value:number|string[]){current?.close();let dialog:ReturnType<typeof forwardDialog>|null=null;const service=createLogMaintenance(port,()=>!!dialog?.alive(),()=>dialog?.paint(),q=>dialog!.ask(q));controller=service;dialog=forwardDialog(port,()=>h('section',{class:'log-maintenance'},[h('h2',null,t('common:log_maintenance.history_title')),service.error()?h('p',{role:'alert'},service.error()):h('p',{role:'status'},t('common:log_maintenance.cleanup_loading')),action(t('common:actions.close'),()=>dialog?.close(),'x')]),()=>service.cancel());current=dialog;
  if(kind==='cleanup')await service.cleanup(value as number);else await service.remove(value as string[],true);if(dialog.alive()&&!service.error())dialog.close();
 }
 return {show,standalone,controller:()=>controller,close(){current?.close();}};
}
let feature:ReturnType<typeof createLogMaintenanceViews>|null=null;
export function installLogMaintenance(port:MaintenancePort){const current=()=>feature||(feature=createLogMaintenanceViews(port));logsServices.termaLogMaintenance={settings:()=>current().show(),cleanup:days=>current().standalone('cleanup',days),remove:paths=>current().standalone('remove',paths),current:()=>current().controller(),close:()=>feature?.close()};}


export interface InstalledFeaturesLogsLogMaintenanceViewsServices {
  termaLogMaintenance:{settings():ReturnType<typeof createLogMaintenance>;cleanup(days:number):Promise<void>;remove(paths:string[]):Promise<void>;current():ReturnType<typeof createLogMaintenance>|null;close():void}
}
