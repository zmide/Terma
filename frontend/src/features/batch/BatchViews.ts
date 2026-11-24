import {h,render,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {action,forwardDialog} from '../forwards/ForwardForms';
import {createBatchService} from './batch-service';
import {createCommandTemplates} from './template-service';
import {matchesRun,resultStatus,runStatus,type BatchPort,type CommandTemplate} from './batch-model';
import '@/styles/batch.css';
interface Owner {host:HTMLElement;target:HTMLElement;service:ReturnType<typeof createBatchService>|null;paint():void;close():void}
export function createBatchViews(port:BatchPort){
  const owners=new Map<HTMLElement,Owner>(),sessions=new Map<object,ReturnType<typeof createBatchService>>(),dialogs=new Map<object,ReturnType<typeof forwardDialog>>();
  const t=(key:string,values?:Record<string,unknown>)=>port.tr('terminal:batch.'+key,values),templates=createCommandTemplates(port,paintAll);let editor:ReturnType<typeof forwardDialog>|null=null,menu:HTMLElement|null=null,frame=0,menuPaint=()=>{};
  function paintAll(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;owners.forEach(v=>v.paint());menuPaint();});}
  function scopeService(key?:string){const scope=port.scope(key);if(!scope)return null;let service=sessions.get(scope.owner);if(!service){const dialog=forwardDialog(port);dialogs.set(scope.owner,dialog);service=createBatchService(port,scope,dialog.ask);service.subscribe(paintAll);sessions.set(scope.owner,service);}return service;}
  function clearMenu(){if(!menu)return;render(null,menu);menu.remove();menu=null;menuPaint=()=>{};document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',menuKey,true);}
  const outside=(event:Event)=>{if(event.target instanceof Node&&!menu?.contains(event.target))clearMenu();},menuKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();clearMenu();}};
  function context(event:MouseEvent,service:ReturnType<typeof createBatchService>|null){
    const target=event.target instanceof Element?event.target.closest<HTMLTextAreaElement|HTMLPreElement>('textarea.command-textarea,.command-output,.template-command-editor'):null;if(!target)return;
    event.preventDefault();event.stopPropagation();clearMenu();const text=target instanceof HTMLTextAreaElement?target.value.slice(target.selectionStart,target.selectionEnd)||target.value:getSelection()?.toString()||target.textContent||'';
    const host=menu=document.createElement('div');host.id='commandContextMenu';host.className='terma-vue-root terma-batch-root batch-context';host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';host.setAttribute('data-i18n-skip','');document.body.appendChild(host);
    const run=async(work:()=>Promise<unknown>|void)=>{try{await work();}catch(e){port.notify(port.error(e,t('operation_failed')),'error');}finally{clearMenu();}};
    const view=()=>h('div',{role:'menu'},[
      action(t('context_copy'),()=>run(()=>port.copy(text)),'copy'),target instanceof HTMLTextAreaElement?action(t('context_paste'),()=>run(async()=>{if(!target.isConnected||target.disabled)return;const start=target.selectionStart,end=target.selectionEnd,value=target.value,pasted=await port.paste();if(!target.isConnected||target.disabled||target.value!==value)return;target.value=value.slice(0,start)+pasted+value.slice(end);target.dispatchEvent(new Event('input',{bubbles:true}));target.focus();target.setSelectionRange(start+pasted.length,start+pasted.length);}),'clipboard','',target.disabled):null,
      target instanceof HTMLTextAreaElement?action(t('context_select_all'),()=>{target.focus();target.select();clearMenu();},'text-select'):action(t('context_copy_all'),()=>run(()=>port.copy(target.textContent||'')),'copy')
    ]);menuPaint=()=>{if(menu!==host)return;host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(view(),host);};menuPaint();const rect=host.getBoundingClientRect();host.style.left=Math.max(8,Math.min(event.clientX,innerWidth-rect.width-8))+'px';host.style.top=Math.max(8,Math.min(event.clientY,innerHeight-rect.height-8))+'px';document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',menuKey,true);
    void service;
  }
  function templateEditor(item?:CommandTemplate){
    editor?.close();let dialog:ReturnType<typeof forwardDialog>|null=null;const controller=templates.editor(item,()=>!!dialog?.alive(),()=>dialog?.paint()),s=controller.state;
    const field=(key:'name'|'command'|'description',label:string)=>h('label',{class:'batch-field'},[h('span',null,label),h(key==='command'?'textarea':'input',{id:key==='name'?'templateName':key==='command'?'templateCommand':'templateDescription',name:key,class:key==='command'?'template-command-editor':'',value:s[key],disabled:s.busy,spellcheck:false,wrap:'off',onInput:(e:Event)=>{s[key]=(e.target as HTMLInputElement).value;},onContextmenu:(e:MouseEvent)=>context(e,null)})]);
    dialog=editor=forwardDialog(port,()=>h('section',{class:'batch-template-editor',role:'dialog','aria-modal':'true','aria-labelledby':'commandTemplateTitle'},[
      h('header',null,[h('div',null,[h('h2',{id:'commandTemplateTitle'},port.tr(item?'terminal:template_editor.edit_title':'terminal:template_editor.add_title')),h('p',null,port.tr('terminal:template_editor.hint'))]),action(port.tr('common:actions.close'),()=>dialog?.close(),'x','icon-button')]),
      h('form',{onSubmit:(e:Event)=>{e.preventDefault();void controller.save(()=>dialog?.close());}},[field('name',port.tr('terminal:template_editor.name')),field('command',port.tr('terminal:template_editor.command')),field('description',port.tr('terminal:template_editor.comment')),s.error?h('p',{class:'batch-error',role:'alert'},s.error):null,h('div',{class:'batch-actions'},[h(TermaButton,{type:'submit',class:'primary',disabled:s.busy},()=>port.tr(s.busy?'common:auto.saving':item?'terminal:template_editor.save':'terminal:template_editor.add')),action(port.tr('common:actions.cancel'),()=>dialog?.close())])])
    ]));
  }
  function sidebar(){const model=templates.model;return h('section',{class:'batch-template-list'},[
    model.loading?h('p',{role:'status'},t('loading_templates')):null,model.error?h('p',{class:'batch-error',role:'alert'},[model.error,action(port.tr('common:actions.retry'),()=>templates.load(),'refresh-cw')]):null,
    ...model.items.map(item=>h('article',{key:item.id,'data-template-id':item.id},[
      h('button',{type:'button',class:'batch-template-main',onClick:()=>{port.open();const service=scopeService();service?.apply(item);}},[h('strong',null,item.name),h('pre',{title:item.command},item.command),item.description?h('small',null,item.description):null]),
      h('div',{class:'batch-template-actions'},[action(t('edit_template'),()=>templateEditor(item),'pencil','icon-button'),action(t('delete_template'),()=>{const dialog=forwardDialog(port);void templates.remove(item.id,dialog.ask,()=>port.primary()==='command');},'trash-2','danger icon-button')])
    ])),!model.loading&&!model.items.length?h('div',{class:'batch-empty'},[h('strong',null,t('templates_empty_title')),h('p',null,t('templates_empty_hint')),action(port.tr('terminal:template_editor.add_title'),()=>templateEditor(),'plus','primary')]):null
  ]);}
  function tools() {
    return h('div', {class:'batch-tools explorer-action-strip explorer-compact-actions'}, [
      action(t('title'),port.open,'play','primary'),
      h('div',{class:'explorer-aux-actions'},[
        action(port.tr('terminal:auto.add_template'),()=>templateEditor(),'plus','icon-button')
      ])
    ]);
  }
  function page(service:ReturnType<typeof createBatchService>){const s=service.model,d=s.draft,busy=service.busy(),run=s.run,visibleRun=matchesRun(d,run),groups=new Map<string,ReturnType<BatchPort['visibleConnections']>>();for(const c of port.visibleConnections()){if(!groups.has(c.group_name))groups.set(c.group_name,[]);groups.get(c.group_name)!.push(c);}
    return h('section',{class:'batch-page'},[
      h('header',{class:'batch-page-head'},[h('div',null,[h('h2',null,t('title')),h('p',null,t('subtitle'))]),h('div',{class:'batch-actions'},[action(t('select_all'),()=>service.selectAll(true),'list-checks','',busy),action(t('clear_selection'),()=>service.selectAll(false),'list-x','',busy)])]),
      h('div',{class:'batch-options'},[h('label',{class:'batch-field'},[h('span',null,t('preset_template')),h('select',{id:'batchCommandTemplate',value:d.templateId,disabled:busy,onChange:(e:Event)=>{const value=(e.target as HTMLSelectElement).value,item=templates.model.items.find(v=>v.id===value);if(item)service.apply(item);else service.change('templateId','');}},[h('option',{value:''},t('manual_command')),...templates.model.items.map(v=>h('option',{value:v.id},v.name))])]),h('label',{class:'batch-field'},[h('span',null,t('timeout_seconds')),h('input',{id:'batchCommandTimeout',type:'number',min:5,max:600,value:d.timeout,disabled:busy,onInput:(e:Event)=>service.change('timeout',(e.target as HTMLInputElement).value)})])]),
      h('label',{class:'batch-field'},[h('span',null,t('command')),h('textarea',{id:'batchCommandText',class:'command-textarea',value:d.command,disabled:busy,wrap:'off',spellcheck:false,placeholder:t('command_placeholder'),onInput:(e:Event)=>service.change('command',(e.target as HTMLTextAreaElement).value),onContextmenu:(e:MouseEvent)=>context(e,service)})]),
      h('div',{class:'batch-actions batch-run-actions'},[action(t(s.phase==='preparing'?'preparing':busy?'running':'run'),()=>service.start(),'play','primary',busy),action(t('stop'),()=>service.stop(),'square','',!busy),visibleRun&&run?.status==='finished'?action(t('export_txt'),()=>service.export('txt'),'file-text'):null,visibleRun&&run?.status==='finished'?action(t('export_json'),()=>service.export('json'),'braces'):null]),
      service.errorText()?h('p',{class:'batch-error',role:'alert'},service.errorText()):null,h('p',{id:'batchCommandStatus',role:'status'},[s.phase==='preparing'?t('verifying_host_identity'):s.phase==='connecting'?t('connecting_channel'):visibleRun&&run?runStatus(port,run):'',visibleRun&&run?.log_path?action((run.log_label||t('view_log')),()=>port.openLog(run.log_path,run.log_label),'scroll-text'):null]),
      h('div',{class:'batch-target-head'},[h('h3',null,t('targets')),h('span',{id:'batchTargetCount'},t('selected_count',{count:d.selected.size}))]),
      h('div',{class:'batch-targets'},groups.size?[...groups].map(([name,list])=>h('section',{class:'batch-target-group',key:name},[h('h4',null,[port.groupName(name),h('small',null,list.length)]),...list.map(c=>h('label',{class:'batch-target',key:c.id},[h('input',{type:'checkbox',class:'batch-command-check',value:c.id,checked:d.selected.has(c.id),disabled:busy,onChange:()=>service.select(c.id)}),h('span',null,[h('strong',null,c.name),h('small',null,`${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`)])]))])):h('div',{class:'batch-empty'},[h('strong',null,t('targets_empty_title')),h('p',null,t('targets_empty_hint'))])),
      h('div',{id:'batchCommandResults',class:'batch-results'},visibleRun&&run?run.ids.map(id=>{const item=run.results[id]!;return h('article',{id:'batchResult-'+id,class:['batch-result',item.ok===true?'ok':item.ok===false?'bad':''],key:id},[h('header',null,[h('strong',null,item.name),h('span',null,resultStatus(port,item,run))]),h('pre',{id:'batchOutput-'+id,class:'command-output',tabindex:0,onContextmenu:(e:MouseEvent)=>context(e,service)},item.output)]);}):[])
    ]);
  }
  function mount(target:HTMLElement,kind:'page'|'list'|'tools'){
    const service=kind==='page'?scopeService():null;if(kind==='page'&&!service)return null;const previous=owners.get(target);if(previous&&previous.service===service&&previous.host.dataset.batchView===kind&&previous.host.parentElement===target){previous.paint();return service;}previous?.close();
    const host=document.createElement('div');host.className='terma-vue-root terma-batch-root';host.dataset.batchView=kind;host.setAttribute('data-i18n-skip','');target.replaceChildren(host);if(service)target.dataset.batchTabKey=service.scope.key;
    let closed=false;const owner:Owner={host,target,service,paint(){if(closed||host.parentElement!==target)return;const focused=document.activeElement,field=focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement?focused:null,selection=field?[field.selectionStart,field.selectionEnd]:null;
      const scroll=[target,...host.querySelectorAll<HTMLElement>('*')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>[n,n.scrollTop,n.scrollLeft,n.scrollHeight-n.scrollTop-n.clientHeight<24&&n.matches('.command-output')] as const);
      host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(kind==='page'?page(service!):kind==='list'?sidebar():tools(),host);
      for(const [node,top,left,follow]of scroll)if(node.isConnected){node.scrollTop=follow?node.scrollHeight:top;node.scrollLeft=left;}if(focused instanceof HTMLElement&&host.contains(focused)&&focused.isConnected){focused.focus({preventScroll:true});if(field&&selection?.[0]!=null&&selection[1]!=null)try{field.setSelectionRange(selection[0],selection[1]);}catch{/* Numeric fields have no selection. */}}
    },close(){if(closed)return;closed=true;render(null,host);host.remove();if(owners.get(target)===owner)owners.delete(target);}};owners.set(target,owner);owner.paint();return service;
  }
  const lifecycle=new MutationObserver(()=>{for(const [tag,service]of sessions)if(!service.scope.valid()){service.dispose();dialogs.get(tag)?.close();dialogs.delete(tag);sessions.delete(tag);}for(const view of [...owners.values()])if(view.host.parentElement!==view.target||view.service&&!view.service.scope.valid())view.close();});lifecycle.observe(document.body,{childList:true,subtree:true});
  const theme=new MutationObserver(paintAll);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('terma:language-changed',paintAll);
  return {templates,mountPage:(target:HTMLElement)=>mount(target,'page'),mountList:(target:HTMLElement)=>mount(target,'list'),mountTools:(target:HTMLElement)=>mount(target,'tools'),service:scopeService,templateEditor,refresh:paintAll,context,clearMenu,
    dispose(key:string){const scope=port.scope(key);for(const [tag,service]of sessions)if(service.scope.key===key&&(!service.scope.valid()||tag===scope?.owner)){service.dispose();dialogs.get(tag)?.close();dialogs.delete(tag);sessions.delete(tag);}paintAll();},
    release(){for(const service of sessions.values())service.dispose();sessions.clear();for(const dialog of dialogs.values())dialog.close();dialogs.clear();for(const owner of [...owners.values()])owner.close();editor?.close();clearMenu();}
  };
}
