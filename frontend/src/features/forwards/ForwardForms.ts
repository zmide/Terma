import {h,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import type {ForwardPort,Draft} from './forward-model';
import {createForwardService,type Question} from './forward-service';
import '@/styles/automations.css';
export const action=(label:string,run:()=>unknown,glyph='',className='',disabled=false,attrs:Record<string,unknown>={})=>h(TermaButton,{type:'button',title:label,'aria-label':label,class:className,disabled,...attrs,onClick:run},()=>[glyph?icon(glyph):null,className.includes('icon-button')?null:h('span',null,label)]);
export function forwardFields(port:ForwardPort,value:Draft,editing:boolean,busy:boolean,paint:()=>void,includeConnection=false){
  const t=port.tr,auto=(key:string)=>t('connections:auto.'+key);
  const groupList = includeConnection ? 'globalForwardGroupNames' : 'forwardGroupNames';
  function input(key: keyof Draft, label: string, options?: [string, string][]) {
    const portNumber = key.endsWith('_port');
    const control = options ? h('select', {
      name: key, value: value[key], disabled: busy || key === 'connection_id' && editing,
      onChange(event: Event) {
        const next = (event.target as HTMLSelectElement).value;
        if (key === 'connection_id') value.connection_id = Number(next);
        else value[key] = next;
        paint();
      }
    }, options.map(([id, name]) => h('option', { value: id }, name))) : h('input', {
      name: key, value: value[key], type: portNumber ? 'number' : 'text',
      min: portNumber ? 1 : undefined, max: portNumber ? 65535 : undefined,
      maxlength: key === 'url_path' ? 2048 : key === 'group_name' ? 128 : undefined,
      list: key === 'group_name' ? groupList : undefined,
      required: key === 'bind_port' || key === 'target_port', disabled: busy, spellcheck: false,
      onInput(event: Event) {
        if (key !== 'connection_id') value[key] = (event.target as HTMLInputElement).value;
      }
    });
    return h('label', { class: 'forward-field', key }, [
      h('span', null, label),
      options || key === 'group_name'
        ? h('span', { class: 'field-dropdown' }, [control, icon('chevron-down')])
        : control
    ]);
  }
  return h('div',{class:'forward-fields'},[
    includeConnection?input('connection_id',t('common:auto.server'),port.connections().map(c=>[String(c.id),c.name+' · '+c.ssh_host])):null,
    input('mode',auto('forward_type'),[['local',auto('local_forward')],['remote',auto('remote_forward')],['socks','SOCKS5 -D']]),
    input('bind_host',auto(value.mode==='remote'?'remote_bind_host':value.mode==='socks'?'socks_bind_host':'local_bind_host')),
    input('bind_port',auto(value.mode==='remote'?'remote_bind_port':value.mode==='socks'?'socks_bind_port':'local_bind_port')),
    value.mode!=='socks'?input('target_host',auto('target_host')):null,value.mode!=='socks'?input('target_port',auto('target_port')):null,
    input('group_name',t('connections:forward_manager.group_name')),h('datalist',{id:groupList},[...new Set(port.connections().flatMap(c=>c.forwards.map(f=>f.group_name).filter(Boolean)))].map(name=>h('option',{value:name}))),
    input('service_name',auto('service_name')),input('service_type',auto('service_type'),[['',t('common:auto.automatic')],...['web','mysql','redis','ssh','socks','other'].map(type=>[type,type==='other'?t('common:auto.other'):({web:'Web',mysql:'MySQL',redis:'Redis',ssh:'SSH',socks:'SOCKS5'}[type]||type)] as [string,string])]),
    input('url_scheme',auto('access_protocol'),[['',t('common:auto.automatic')],['http','HTTP'],['https','HTTPS']]),input('url_path',auto('url_path')),input('service_note',auto('note'))
  ]);
}
export function forwardDialog(port:Pick<ForwardPort,'tr'>,body?:()=>VNodeChild,onClosed=()=>{}){
  let binding:ModalBinding|null=null,question:Question|null=null,resolve:((answer:string)=>void)|null=null,input='',trigger:HTMLElement|null=null;
  const t=port.tr,settle=(value:string)=>{const pending=resolve;question=null;resolve=null;pending?.(value);if(body){binding?.paint();if(trigger?.isConnected)trigger.focus({preventScroll:true});}else binding?.close();};
  function view(){
    const confirmation=question?h('section',{
      class:['forward-question',body&&'automation-confirm'],role:'dialog','aria-modal':'true',
      'aria-labelledby':'forwardQuestionTitle','data-automation-layer':''
    },[
      h('h2',{id:'forwardQuestionTitle'},question.title()),question.message?h('p',null,question.message()):null,
      question.input!==undefined?h('label',{class:'forward-field'},[h('span',null,t('connections:forwards.template_name')),h('input',{name:'template_name',value:input,maxlength:256,onInput:(e:Event)=>{input=(e.target as HTMLInputElement).value;binding?.paint();},onKeydown:(e:KeyboardEvent)=>{if(e.key==='Enter'&&input.trim()){e.preventDefault();settle(input.trim());}}})]):null,
      h('div',{class:'forward-form-actions'},question.choices.map((choice,index)=>action(choice.label(),()=>settle(choice.value==='input'?input.trim():choice.value),'',choice.danger?'danger':choice.value?'primary':'',choice.value==='input'&&!input.trim(),{'data-choice':String(index)})))
    ]):null;
    return h('div',{class:['forward-dialog-root',!body&&'is-confirmation']},[
      body?h('div',{class:'forward-editor-layer',inert:!!question,'aria-hidden':question?'true':undefined},[body()]):null,
      body&&confirmation?h('div',{class:'automation-layer'},[confirmation]):confirmation
    ]);
  }
  const mount=()=>{binding=showOperationsModal(view,()=>{binding=null;const pending=resolve;question=null;resolve=null;pending?.('');onClosed();},()=>{if(question){settle('');return true;}return false;});};
  if(body)mount();
  return {alive:()=>!!binding?.alive(),paint:()=>binding?.paint(),close:()=>binding?.close(),ask:(value:Question)=>new Promise<string>(done=>{
    resolve?.('');question=value;resolve=done;input=value.input||'';trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!binding?.alive())mount();else binding.paint();queueMicrotask(()=>{document.querySelector<HTMLElement>('[data-automation-layer] input,[data-automation-layer] button')?.focus();});
  })};
}
export function openForwardEditor(port:ForwardPort,id:number,connectionId:number){
  const valid=port.scope();let dialog:ReturnType<typeof forwardDialog>|null=null;
  const service=createForwardService(port,()=>!!dialog?.alive()&&valid(),()=>dialog?.paint(),q=>dialog!.ask(q));
  // Initialise without a visible owner; mounting is done only after the complete draft exists.
  service.state.editing=id;const row=port.connections().flatMap(c=>c.forwards.map(f=>({c,f}))).find(r=>r.f.id===id);
  if(id&&!row){port.notify(port.tr('connections:forwards.not_found'),'error');return null;}
  const {state}=service;
  const initialise=()=>service.edit(id,row?.c.id||connectionId);
  dialog=forwardDialog(port,()=>h('section',{class:'forward-editor',role:'dialog','aria-modal':'true','aria-labelledby':'globalForwardEditorTitle'},[
    h('header',null,[h('div',null,[h('h2',{id:'globalForwardEditorTitle'},port.tr(id?'connections:forward_manager.edit':'connections:forward_manager.add')),h('p',null,port.tr(row&&['running','reconnecting'].includes(row.f.status||'')?'connections:forward_manager.running_edit_hint':'connections:forward_manager.editor_hint'))]),action(port.tr('common:actions.close'),()=>dialog?.close(),'x','icon-button')]),
    h('form',{id:'globalForwardEditorForm',onSubmit:(e:Event)=>{e.preventDefault();void service.save(()=>dialog?.close());}},[
      forwardFields(port,state.draft,!!id,!!state.busy.size,()=>dialog?.paint(),true),state.error?h('p',{role:'alert',class:'forward-error'},state.error):null,
      h('div',{class:'forward-form-actions'},[action(port.tr('common:actions.cancel'),()=>dialog?.close()),h(TermaButton,{type:'submit',class:'primary',disabled:!!state.busy.size},()=>port.tr(state.busy.size?'common:auto.saving':'common:actions.save'))])
    ])
  ]));initialise();return dialog;
}
