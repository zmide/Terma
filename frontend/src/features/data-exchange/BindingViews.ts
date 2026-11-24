import {h} from 'vue';
import {SettingsPasswordField} from '../settings/SettingsPasswordField';
import {settingsIcon as icon} from '../settings/settings-icon';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import {action as baseAction} from '../forwards/ForwardForms';
import {createBindingService} from './binding-service';
import {identityName,type ExchangePort,type ImportRow,type BindingOptions,type Credential} from './exchange-model';
import '@/styles/data-exchange.css';
export function openBindingDialog(port:ExchangePort,items:ImportRow[],mode:'identity'|'credential',options:BindingOptions={},signal?:AbortSignal){
 return new Promise<Credential[]|null>(resolve=>{
  let modal:ModalBinding|null=null,settled=false;const credential=mode==='credential',t=port.tr,k=(name:string)=>t('connections:identity.'+name);
  const action=(label:string,run:()=>unknown,glyph='',className='',disabled=false,id='')=>{const node=baseAction(label,run,glyph,className,disabled);if(id)node.props={...node.props,id};return node;};
  const service=createBindingService(port,items,mode,options,()=>!settled&&!!modal?.alive()&&!signal?.aborted,()=>modal?.paint());
  function finish(value:Credential[]|null){if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);const field=document.querySelector<HTMLInputElement>('#modal .exchange-dialog #credentialPassword');if(field)field.value='';service.dispose();modal?.close();resolve(value);}
  const cancel=()=>finish(null);
  if(signal?.aborted){finish(null);return;}
  modal=showOperationsModal(()=>{const s=service.state,busy=s.busy||s.loading;return h('section',{class:'exchange-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'restoreKeyModalTitle'},[
   h('header',null,[h('div',null,[h('h2',{id:'restoreKeyModalTitle'},k(credential?'restore_title':'bind_title')),h('p',null,options.subtitleKey?t(options.subtitleKey):options.subtitle||k(credential?'restore_subtitle':'bind_subtitle'))]),action(t('common:actions.cancel'),cancel,'x','icon-button',false,'restoreKeyClose')]),
   h('p',{class:'exchange-muted'},k(credential?'restore_intro':'bind_intro')),
   h('div',{class:'exchange-binding-fields'},[
    h('label',{class:'exchange-field'},[h('span',null,k('existing_private_key')),h('select',{id:'identityBindingCandidate',value:s.candidate,disabled:busy,onChange:(e:Event)=>s.candidate=(e.target as HTMLSelectElement).value},[h('option',{value:''},k(s.loading?'loading_private_keys':'select')),...s.candidates.map(c=>h('option',{value:c.path},port.identityLabel(c)))])]),
    h('div',{class:'exchange-field'},[h('span',null,k('upload_current_directory')),h('div',{class:'exchange-actions'},[h('label',{class:'exchange-picker'},[h('input',{id:'identityBindingUpload',type:'file',disabled:busy,onChange:(e:Event)=>{if(settled)return;s.file=(e.target as HTMLInputElement).files?.[0]||null;modal?.paint();}}),h('span',null,t('common:auto.choose_file')),h('small',null,s.file?.name||t('common:auto.not_selected'))]),action(k('upload'),()=>service.upload(),'upload','',busy,'identityBindingUploadBtn')])]),
    credential?h('label',{class:'exchange-field'},[h('span',null,k('set_new_password')),h(SettingsPasswordField,{id:'credentialPassword',value:s.password,disabled:busy||options.password_replacement_allowed===false,autocomplete:'new-password',placeholder:k('password_placeholder'),showLabel:t('common:auto.show_password'),hideLabel:t('common:auto.hide_password'),onInput:(e:Event)=>s.password=(e.target as HTMLInputElement).value})]):null
   ]),
   h('p',{id:'identityBindingDirectory',class:'exchange-muted'},s.directory?t('connections:identity.upload_directory',{path:s.directory}):k('upload_directory_hint')),
   s.issue?h('div',{class:'exchange-error',role:'alert'},[service.status(),s.retryKind?action(t('common:actions.retry'),()=>service.retry(),'refresh-cw','',busy,'identityBindingRetry'):null]):null,
   h('div',{class:'exchange-actions exchange-select-actions'},[h('strong',null,k(credential?'select_credentials_connections':'select_bind_connections')),action(k('select_original_name'),()=>service.select('matching'),'','',busy,'identitySelectMatching'),action(k(credential?'select_all':'select_all_unbound'),()=>service.select('all'),'','',busy,'identitySelectAll'),action(k('clear_selection'),()=>service.select('none'),'','',busy,'identitySelectNone')]),
   h('div',{id:'identityBindingRows',class:'exchange-binding-rows'},s.rows.length?s.rows.map(row=>{const result=s.results.get(row.binding_id),name=row.connection_name||row.name||t('connections:identity.connection_fallback',{id:row.binding_id});return h('article',{key:row.binding_id,class:'exchange-binding-row','data-binding-row':row.binding_id},[
    h('input',{type:'checkbox',value:row.binding_id,checked:s.selected.has(row.binding_id),disabled:busy,'aria-label':t('connections:identity.checkbox_label',{name}),onChange:(e:Event)=>{(e.target as HTMLInputElement).checked?s.selected.add(row.binding_id):s.selected.delete(row.binding_id);}}),
    h('div',{class:'exchange-binding-copy'},[h('strong',null,name),h('small',null,`${row.ssh_user||''}@${row.ssh_host||''}:${row.ssh_port||22}`)]),
    h('div',{class:'exchange-binding-copy'},[h('small',null,k(credential?'original_auth':'original_key')),h('code',null,credential?service.original(row):row.key_name||identityName(row.old_path||row.identity_name))]),
    credential?h('label',{class:'exchange-field exchange-sort'},[h('span',null,k('sort')),h('input',{'data-restore-sort':row.binding_id,type:'number',min:1,max:2147483647,step:1,value:s.sort.get(row.binding_id),disabled:busy,'aria-label':t('connections:identity.sort_aria',{name}),onInput:(e:Event)=>s.sort.set(row.binding_id,(e.target as HTMLInputElement).value)})]):null,
    h('div',{'data-binding-result':row.binding_id,class:['exchange-binding-result',result?.ok?'exchange-success':result?'exchange-error':'']},result?result.ok?k('test_success'):t('connections:identity.test_failed',{error:port.phrase(result.output||k('connection_failed'))}):service.label(row))
   ]);}):h('p',null,k('no_connections'))),
   !s.issue?h('p',{id:'restoreKeyStatus',role:'status','aria-live':'polite',class:['exchange-status',s.statusKind==='error'?'exchange-error':s.statusKind==='success'?'exchange-success':'']},service.status()):null,
   h('footer',{class:'exchange-actions'},[action(t('common:actions.cancel'),cancel,'','',false,'restoreKeyCancel'),action(k('test_selected'),()=>service.test(),'plug','',busy,'identityBindingTest'),credential?action(k('clear_selected_credentials'),()=>service.clear(),'eraser','',busy,'credentialClearSelected'):null,action(k(credential?'bind_selected_key':'stage_binding'),()=>service.stageKey(),'key-round','',busy,'identityBindingStage'),credential?action(k('set_entered_password'),()=>service.stagePassword(),'key','',busy||options.password_replacement_allowed===false,'credentialPasswordStage'):null,action(options.finishKey?t(options.finishKey):options.finish_label||(credential?k('continue_restore'):t('common:actions.continue')),()=>{const value=service.finish();if(value)finish(value);},'check','primary',busy,'identityBindingFinish')])
  ]);},cancel);
  signal?.addEventListener('abort',cancel,{once:true});void service.load();
 });
}

