import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {h,render} from 'vue';
import {action,forwardDialog} from '../forwards/ForwardForms';
import {settingsIcon as icon} from '../settings/settings-icon';
import {createExchangeService} from './exchange-service';
import {openBindingDialog} from './BindingViews';
import {section,sectionKey,identityName,type ExchangePort,type Section} from './exchange-model';
import {exchangeWorkspace} from './exchange-workspace';
import type {Question} from '../forwards/forward-service';
import '@/styles/data-exchange.css';
export function createExchangeViews(port:ExchangePort){
 type Service=ReturnType<typeof createExchangeService>;
 const entries=new Map<string,{service:Service;host:HTMLElement|null;target:HTMLElement|null;paint():void;unmount():void}>(),t=port.tr;
 function ensure(key?:string){const scope=key?port.scope(key):port.current();if(!scope)return null;let entry=entries.get(scope.key);if(entry?.service.scope.owner!==scope.owner){entry?.service.dispose();entry?.unmount();entries.delete(scope.key);entry=undefined;}if(!entry){const ask=async(q:Question)=>{const dialog=forwardDialog(port),cancel=()=>dialog.close();entry!.service.signal.addEventListener('abort',cancel,{once:true});try{return await dialog.ask(q);}finally{entry!.service.signal.removeEventListener('abort',cancel);dialog.close();}};const service=createExchangeService(port,scope,()=>entry?.paint(),ask,(items,mode,options,signal)=>openBindingDialog(port,items,mode,options,signal));entry={service,host:null,target:null,unmount(){if(entry?.host){render(null,entry.host);entry.host.remove();entry.host=null;entry.target=null;}},paint(){mount(scope.key);}};entries.set(scope.key,entry);}return entry;}
 function picker(service:Service,id:string,file:File|null,change:(file:File|null)=>void,busy:boolean,version=0,accept='*/*'){return h('label',{class:'exchange-picker'},[h('input',{id,key:id+version,type:'file',accept,disabled:busy,onChange:(e:Event)=>{if(!service.alive())return;change((e.target as HTMLInputElement).files?.[0]||null);entries.get(service.scope.key)?.paint();}}),h('span',null,t('common:auto.choose_file')),h('small',null,file?.name||t('common:auto.not_selected'))]);}
 function view(service:Service){const s=service.state,busy=s.busy;const field=(label:string,node:ReturnType<typeof h>)=>h('label',{class:'exchange-field'},[h('span',null,t(label)),node]);const button=(key:string,run:()=>unknown,glyph='',cls='')=>action(t(key),run,glyph,cls,busy);return h('div',{class:'exchange-page'},[
  h('header',{class:'exchange-page-head'},[h('h2',null,t('navigation:auto.import_export')),h('p',null,t('settings:auto.import_migration'))]),
  service.error()?h('p',{role:'alert',class:'exchange-error'},service.error()):null,
  h('div',{id:'importMainPanel',hidden:s.section==='configSnapshots'},[
   h('section',{id:'import-source',hidden:s.section!=='import-source',class:'exchange-section'},[
    h('h3',null,t('settings:auto.ssh_config_import_export')),
    h('div',{class:'exchange-field'},[h('span',null,t('settings:auto.upload_config')),h('div',{class:'exchange-actions'},[picker(service,'config_upload',s.config,f=>s.config=f,busy,s.fileVersion),button('settings:auto.upload_parse',()=>service.parse(true),'file-input')])]),
    field('settings:auto.paste_config',h('textarea',{id:'config_text',value:s.text,disabled:busy,spellcheck:false,placeholder:'Host demo\n  HostName example.com\n  User root\n  LocalForward 6010 127.0.0.1:6868',onInput:(e:Event)=>s.text=(e.target as HTMLTextAreaElement).value})),
    h('div',{class:'exchange-actions'},[button('settings:auto.paste_parse',()=>service.parse(),'clipboard-paste')]),
    h('div',{id:'import-results',class:'exchange-results'},[
     h('div',{class:'exchange-results-head'},[h('h3',null,t('settings:auto.import_results')),h('div',{class:'exchange-actions'},[s.parsed.tunnels.some(r=>r.identity_name)?action(t(s.parsed.tunnels.some(r=>r.missing_identity)?'settings:import.bind_optional':'settings:import.adjust_binding'),()=>service.bind(),'key-round','',busy):null,button('settings:auto.batch_test',()=>service.test(),'plug'),button('settings:auto.batch_save',()=>service.save(),'save','primary')])]),
     h('div',{id:'importResults'},s.parsed.tunnels.map((r,i)=>h('article',{key:i,class:'exchange-import-row'},[
      h('div',{class:'exchange-results-head'},[h('strong',null,r.name||''),field('settings:import.sort_label',h('input',{type:'number',min:1,max:2147483647,value:r.sort_order||1,disabled:busy,onChange:(e:Event)=>service.order(i,(e.target as HTMLInputElement).value)}))]),
      h('code',null,`${r.ssh_user||''}@${r.ssh_host||''}:${r.ssh_port||22}`),h('p',null,(r.forwards||[]).map(f=>`${f.bind_host}:${f.bind_port} → ${f.target_host}:${f.target_port}`).join(t('settings:import.item_separator'))),
      r.identity_name?h('p',null,[t('settings:import.original_key',{name:r.identity_name}),' · ',t(r.missing_identity?'settings:import.unbound_importable':'settings:import.bound_key',{name:identityName(r.identity_file)})]):null,
      h('p',{class:'exchange-muted'},s.testing?t('settings:import.test_in_progress'):s.results?port.phrase(s.results[i]?.output||t('settings:import.test_ok')):t(r.missing_identity?'settings:import.no_identity_hint':'settings:import.pending_test'))
     ])))
    ]),
    h('div',{class:'exchange-block'},[h('h3',null,t('settings:auto.export_config')),h('textarea',{id:'export_text',readonly:true,value:s.exportText}),h('div',{class:'exchange-actions'},[button('settings:auto.generate_export',()=>service.exportConfig(),'file-output'),button('common:auto.copy',()=>service.copy(),'copy')])])
   ]),
   h('section',{id:'import-export',hidden:s.section!=='import-export',class:'exchange-section'},[
    h('h3',null,t('settings:auto.database_import_export')),
    h('div',{class:'exchange-actions'},[button('settings:auto.download_database',()=>service.database(),'database-backup'),s.security.encryption_enabled?action(t('settings:auto.download_bundle'),()=>service.bundle(),'lock-keyhole','',busy||!s.security.encryption_ready):null]),
    s.securityIssue?h('p',{class:'exchange-error',role:'alert'},[service.error(s.securityIssue),action(t('common:actions.retry'),()=>service.security(),'refresh-cw','',busy)]):null,
    h('p',{id:'backupBundleNote',class:'exchange-muted'},t(s.security.encryption_enabled?'settings:import.backup_encrypted_hint':'settings:import.backup_plain_hint')),
    h('div',{class:'exchange-field'},[h('span',null,t('settings:auto.restore_database')),h('div',{class:'exchange-actions'},[picker(service,'db_restore_upload',s.restoreFile,f=>s.restoreFile=f,busy,s.fileVersion,'.db,.json,.termabackup,.tdbackup,.tdbackup.json'),button('settings:auto.upload_restore',()=>service.restore(),'upload','danger')])]),
    h('div',{class:'exchange-block'},[h('h3',null,t('settings:auto.config_selection_title')),h('p',{class:'exchange-muted'},t('settings:auto.config_selection_hint')),
     h('div',{class:'exchange-checks'},(['connections','remote_profiles','forwards','command_snippets','passwords'] as const).map(key=>h('label',null,[h('input',{type:'checkbox',checked:s.selection[key],disabled:busy,'data-selection':key,onChange:(e:Event)=>s.selection[key]=(e.target as HTMLInputElement).checked}),h('span',null,t('settings:auto.config_selection_'+key))]))),
     h('div',{class:'exchange-actions'},[button('settings:auto.config_selection_export',()=>service.exportSelection(),'download'),picker(service,'config_selection_upload',s.selectionFile,f=>s.selectionFile=f,busy,s.fileVersion,'.json,.terma-config.json'),button('settings:auto.config_selection_import',()=>service.importSelection(),'upload','primary')])
    ])
   ])
  ]),
  h('section',{id:'configSnapshots',hidden:s.section!=='configSnapshots',class:'exchange-section'},[
   h('div',{class:'exchange-results-head'},[h('h3',null,t('settings:auto.config_snapshots')),h('div',{class:'exchange-actions'},[button('common:auto.refresh',()=>service.snapshotList(),'refresh-cw'),button('settings:auto.create_now',()=>service.createSnapshot(),'plus','primary')])]),h('p',{class:'exchange-muted'},t('settings:auto.config_snapshots_hint')),
   s.snapshotsLoading?h('p',{role:'status'},t('settings:import.snapshots_loading')):null,
   s.snapshotIssue?h('p',{class:'exchange-error',role:'alert'},[service.error(s.snapshotIssue),button('common:actions.retry',()=>service.snapshotList(),'refresh-cw')]):null,
   !s.snapshotsLoading&&!s.snapshotIssue&&!s.snapshots.length?h('p',null,[t('settings:import.snapshots_empty'),' · ',t('settings:auto.config_snapshots_empty_hint')]):null,
   h('div',{class:'exchange-snapshots'},s.snapshots.map(item=>h('article',{key:item.id,'data-snapshot-id':item.id},[h('div',null,[h('strong',null,port.reason(item.reason)),h('p',{class:'exchange-muted'},new Date(item.created_at).toLocaleString(document.documentElement.lang||'zh-CN',{hour12:false})),h('p',{class:'exchange-muted'},['connections','forwards','templates'].map(key=>t('settings:auto.snapshot_'+key,{count:item.counts?.[key as keyof NonNullable<typeof item.counts>]||0})).join(' · '))]),h('div',{class:'exchange-actions'},[button('settings:auto.snapshot_restore',()=>service.snapshot(item.id,true),'history'),button('common:actions.delete',()=>service.snapshot(item.id),'trash-2','danger')])])) )
  ])
 ]);}
 function mount(key:string){const entry=entries.get(key);if(!entry||!entry.service.alive())return;const target=entry.service.scope.element();if(!target)return;if(entry.target!==target||entry.host?.parentElement!==target){entry.unmount();for(const other of entries.values())if(other!==entry&&other.target===target)other.unmount();entry.host=document.createElement('div');entry.host.className='terma-vue-root terma-exchange-root';entry.host.setAttribute('data-i18n-skip','');entry.target=target;target.replaceChildren(entry.host);}
  const host=entry.host!,active=document.activeElement,input=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement?active:null,selection=input?[input.selectionStart,input.selectionEnd,input.selectionDirection] as const:null;host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(view(entry.service),host);if(active instanceof HTMLElement&&host.contains(active)&&active.isConnected){active.focus({preventScroll:true});if(input&&selection?.[0]!=null&&selection[1]!=null)try{input.setSelectionRange(selection[0],selection[1],selection[2]||undefined);}catch{/* Numeric and file fields have no caret. */}}
 }
 const paintAll=()=>{for(const entry of entries.values()){entry.paint();port.heading(entry.service.scope.key,entry.service.state.section,false);}},prune=()=>{for(const [key,entry]of entries){if(!entry.service.scope.valid()){entry.service.dispose();entry.unmount();entries.delete(key);}else if(entry.host&&entry.host.parentElement!==entry.target)entry.unmount();}};
 const observer=new MutationObserver(prune);observer.observe(document.getElementById('workspaceDock')||document.body,{childList:true,subtree:true});const theme=new MutationObserver(paintAll);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('terma:language-changed',paintAll);
 const current=()=>ensure()?.service||null;
 const activeSection=()=>current()?.state.section??section('');
 function open(update=true,value?:Section){const scope=port.open(update);if(!scope)return;const entry=ensure(scope.key);if(!entry)return;entry.service.select(value??entry.service.state.section,false);void entry.service.security();return entry.service;}
 return {
  current, open,
  activeSection,
  label:()=>t(sectionKey(activeSection())),
  syncNavigation(){const service=current();if(service)port.heading(service.scope.key,service.state.section,false);},
  navigate(value:string){(current()??open())?.select(value);},
  async previewConfig(text:string){return await open(true,'import-source')?.previewConfig(text)??false;},
  release(){for(const entry of entries.values()){entry.service.dispose();entry.unmount();}entries.clear();}
 };
}
let feature:ReturnType<typeof createExchangeViews>|null=null;
export function installExchangeViews(upload: Parameters<typeof exchangeWorkspace>[0]){dataExchangeServices.termaExchange={feature:()=>feature??=createExchangeViews(exchangeWorkspace(upload))};}



export interface InstalledFeaturesDataExchangeExchangeViewsServices {
  termaExchange:{feature():ReturnType<typeof createExchangeViews>}
}
