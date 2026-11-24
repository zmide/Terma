import {forwardsServices} from '@/features/forwards/installed-services';
import {h,render,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {safeForwardUrl} from '../operations/running-forwards';
import {active,filterRows,paginate,rows,type ForwardPort,type Row,type Draft} from './forward-model';
import {createForwardService} from './forward-service';
import {action,forwardDialog,forwardFields,openForwardEditor} from './ForwardForms';
import {forwardSort} from './forward-sort';
import '@/styles/forward-pages.css';
interface Owner {connectionId:number;scopeOwner:object|null;host:HTMLElement;paint():void;close():void;focus(id:number):void;service:ReturnType<typeof createForwardService>}
interface SavedDraft {connectionId:number;draft:Draft;editing:number;templateId:string;templatesOpen:boolean}
export function createForwardPages(port:ForwardPort){
  const owners=new Map<HTMLElement,Owner>();let editor:ReturnType<typeof openForwardEditor>=null;
  let drafts=new WeakMap<object,SavedDraft>();
  const t=port.tr,manager=(key:string,values?:Record<string,unknown>)=>t('connections:forward_manager.'+key,values);
  function mount(target:HTMLElement,connectionId=0,focusId=0){
    const scopeOwner=port.scopeOwner(),old=owners.get(target);if(old?.connectionId===connectionId&&old.scopeOwner===scopeOwner&&old.host.parentElement===target){old.focus(focusId);old.paint();return old;}
    if(scopeOwner)for(const owner of [...owners.values()])if(owner.scopeOwner===scopeOwner&&owner!==old)owner.close();old?.close();
    const valid=port.scope(),host=document.createElement('div');host.className='terma-vue-root terma-forward-root';host.setAttribute('data-i18n-skip','');target.replaceChildren(host);
    let disposed=false,menuId=0,highlight=focusId;const sort=forwardSort(),alive=()=>!disposed&&host.parentElement===target&&valid();
    const question=forwardDialog(port),service=createForwardService(port,alive,()=>paint(),question.ask),state=service.state;
    const prefix=connectionId?'connectionForward':'globalForward',pageKey=connectionId?`connectionForwardPage:${connectionId}`:'globalForwardPage';
    const storedSet=(key:string)=>{try{const value:unknown=JSON.parse(port.stored(key)||'[]');return new Set(Array.isArray(value)?value.map(String):[]);}catch{return new Set<string>();}};
    const model={query:connectionId?'':port.stored('globalForwardSearch')||'',status:connectionId?'all':port.stored('globalForwardStatus')||'all',connection:connectionId||Number(port.stored('globalForwardConnection'))||0,group:connectionId?'flat':['ssh','name'].includes(port.stored('globalForwardGroupMode')||'')?port.stored('globalForwardGroupMode')!:'flat',page:Number(port.stored(pageKey))||1,size:Number(port.stored(prefix+'PageSize'))||12,selected:new Set<number>(),groups:storedSet('globalForwardCollapsedGroups'),connections:storedSet('globalForwardCollapsedConnections')};
    const filtered=()=>filterRows(rows(port),model.query,model.status,model.connection,port.locale());
    const change=(key:'query'|'status'|'connection'|'group'|'page'|'size',value:string|number)=>{if(key==='connection'||key==='page'||key==='size')model[key]=Number(value)||0;else model[key]=String(value);if(key!=='page')model.page=1;if(!connectionId){const keys={query:'globalForwardSearch',status:'globalForwardStatus',connection:'globalForwardConnection',group:'globalForwardGroupMode',page:'globalForwardPage',size:'globalForwardPageSize'};port.store(keys[key],String(value));}else if(key==='size')port.store('connectionForwardPageSize',String(value));port.store(pageKey,String(model.page));model.selected.clear();menuId=0;paint();};
    const choose=(label:string,value:string,options:[string,string][],onChange:(value:string)=>void,name:string)=>h('label',{class:'forward-field'},[h('span',null,label),h('select',{name,value,onChange:(e:Event)=>onChange((e.target as HTMLSelectElement).value)},options.map(([id,text])=>h('option',{value:id},text)))]);
    const check=(label:string,checked:boolean,onChange:()=>void,indeterminate=false)=>h('label',{class:'forward-checkline'},[h('input',{type:'checkbox',checked,indeterminate,onChange,disabled:!!state.busy.size}),h('span',null,label)]);
    const toggleSelected=(id:number)=>{if(model.selected.has(id))model.selected.delete(id);else model.selected.add(id);paint();};
    const edit=(id:number,preferred=connectionId)=>{menuId=0;if(connectionId){service.edit(id,connectionId);host.querySelector('form')?.scrollIntoView({block:'start'});}else editor=openForwardEditor(port,id,preferred||port.connections()[0]?.id||0);};
    const copy=(value:string)=>service.run('copy',()=>port.copy(value));
    function card(row:Row):VNodeChild{
      const {connection,forward:f}=row,busy=!!state.busy.size,url=f.status==='running'?safeForwardUrl(port.access(f)):'',quality=port.quality(f);
      const menu=menuId===f.id;
      const details=[
        h('p',{class:'forward-connection'},connection.name+' · '+connection.ssh_host+':'+(connection.ssh_port||22)),
        h('div',{class:'forward-rule-detail'},[h('span',null,row.mode),h('code',null,row.rule)]),
        f.group_name?h('small',{class:'forward-group-label'},manager('group_label',{name:f.group_name})):null,
        f.service_note?h('p',null,f.service_note):null,
        quality?h('small',{class:'forward-runtime'},quality):null,
        f.status==='failed'&&f.updated_at?h('small',{class:'forward-runtime'},t('connections:forwards.failed_at',{time:new Date(Number(f.updated_at)>1e12?Number(f.updated_at):Number(f.updated_at)*1000).toLocaleString(port.locale(),{hour12:false})})):null
      ];
      const address=h('div',{class:'forward-address'},url?[h('code',null,url),h('a',{class:'open-forward-link',href:url,target:'_blank',rel:'noopener noreferrer'},[icon('external-link'),h('span',null,t('common:auto.open'))]),action(t('common:auto.copy'),()=>copy(url),'copy','',busy)]:h('span',null,manager('address_after_start')));
      const actions=h('div',{class:'forward-row-actions'},[
          action(t(active(f)?'common:auto.stop':'common:auto.start'),()=>service.toggle(f.id),active(f)?'square':'play',active(f)?'':'primary',busy),
          action(t('common:actions.edit'),()=>edit(f.id),'pencil','',busy),
          !connectionId?action(manager('server_rules'),()=>port.openConnection(connection.id),'server-cog'):null,
          action(t('connections:actions.more'),()=>{menuId=menu?0:f.id;paint();},'ellipsis','',busy),
          action(t('common:actions.delete'),()=>service.remove([f.id]),'trash-2','danger',busy)
      ]);
      return h('article',{key:f.id,class:['forward-rule-row',highlight===f.id?'is-focused':''],'data-forward-id':f.id},[
        h('header',null,[connectionId?check(row.title,model.selected.has(f.id),()=>toggleSelected(f.id)):h('strong',null,row.title),h('span',{class:['forward-state',f.status||'stopped']},row.status)]),
        connectionId?h('div',{class:'forward-rule-meta'},details):details,
        f.last_error?h('div',{class:'forward-error'},[h('span',null,f.last_error.slice(0,500)),f.updated_at?action(t('common:workspace.failure_logs'),()=>port.logs(Number(f.updated_at)),'scroll-text'):null]):null,
        connectionId?h('div',{class:'forward-rule-controls'},[address,actions]):[address,actions],
        menu?h('div',{class:'forward-rule-menu',role:'menu'},[
          action(t('navigation:menus.forward_copy_rule'),()=>{menuId=0;void copy(row.rule);},'copy'),
          f.mode!=='socks'?action(t('navigation:menus.forward_copy_target_address'),()=>{menuId=0;void copy(`${f.target_host}:${f.target_port}`);},'target'):null,
          f.mode!=='remote'?action(t('navigation:menus.forward_test_connectivity'),()=>{menuId=0;void service.run('diagnose',()=>port.diagnose(f.id));},'activity'):null
        ]):null
      ]);
    }
    function templateList(){return h('div',{class:'forward-template-list',id:'forwardTemplateManager'},port.templates().length?port.templates().map(value=>h('article',{key:value.id,class:state.templateId===String(value.id)?'active':''},[
      h('strong',null,value.name),h('code',null,`${value.bind_host}:${value.bind_port} → ${value.mode==='socks'?'SOCKS5':value.target_host+':'+value.target_port}`),
      h('div',{class:'forward-row-actions'},[
        action(t('connections:forward_pages.apply'),()=>service.apply(String(value.id)),'check','',!!state.busy.size),
        action(t('common:actions.edit'),()=>{service.apply(String(value.id));state.templateId=String(value.id);paint();},'pencil','',!!state.busy.size),
        action(t('connections:forwards.template_apply_batch'),()=>service.templateAction(String(value.id),'batch'),'copy-plus','',!!state.busy.size),
        action(t('common:actions.delete'),()=>service.templateAction(String(value.id),'delete'),'trash-2','danger',!!state.busy.size)
      ])
    ])):h('p',null,t('connections:forward_pages.no_templates')));}
    function form(){return h('section',{class:'forward-inline-editor'},[
      h('h3',null,t(state.templateId?'connections:forwards.template_save_edit_title':state.editing?'connections:auto.save_forward':'connections:auto.add_forward')),
      h('div',{class:'forward-template-bar'},[
        choose(t('connections:auto.choose_template'),'', [['',t('connections:auto.choose_template')],...port.templates().map(v=>[String(v.id),v.name] as [string,string])],id=>service.apply(id),'forward_template_select'),
        action(t('connections:auto.manage_template'),()=>{state.templatesOpen=!state.templatesOpen;paint();},'list','',!!state.busy.size)
      ]),
      h('form',{id:'forwardForm',onSubmit:(e:Event)=>{e.preventDefault();void service.save(()=>{model.selected.clear();});}},[
        forwardFields(port,state.draft,!!state.editing,!!state.busy.size,paint),
        h('div',{class:'forward-form-actions'},[
          h(TermaButton,{id:'forwardSubmitBtn',type:'submit',class:'primary',disabled:!!state.busy.size},()=>t(state.busy.has('save')?'common:auto.saving':state.editing?'connections:auto.save_forward':'connections:auto.add_forward')),
          action(t('connections:auto.recommend_port'),service.recommend,'wand-sparkles','',!!state.busy.size||state.draft.mode==='remote'),
          action(t('connections:auto.save_template'),service.templateSave,'save','',!!state.busy.size),
          state.editing||state.templateId?action(t('connections:auto.cancel_edit'),()=>service.edit(0,connectionId),'x','',!!state.busy.size):null
        ])
      ]),state.templatesOpen?templateList():null
    ]);}
    function pager(data:ReturnType<typeof paginate<Row>>){if(!data.total)return null;return h('nav',{class:'forward-page-nav','aria-label':manager('pagination.label')},[
      h('span',{class:'forward-page-summary'},manager('pagination.showing',{from:data.first,to:data.last,total:data.total})),
      h('div',{class:'forward-page-controls'},[
        choose(manager('pagination.page_size'),String(data.size),[12,24,48,96].map(v=>[String(v),String(v)]),v=>change('size',v),'page_size'),
        h('div',{class:'forward-page-turns'},[
          action(manager('pagination.previous'),()=>change('page',data.page-1),'chevron-left','',data.page<=1),
          h('strong',{'aria-live':'polite'},manager('pagination.page',{page:data.page,pages:data.pages})),
          action(manager('pagination.next'),()=>change('page',data.page+1),'chevron-right','',data.page>=data.pages)
        ])
      ])
    ]);}
    function groups(items:Row[],sorting:boolean){
      const byGroup=new Map<string,Map<number,Row[]>>();
      for(const row of items){const group=row.connection.group_name||'默认分组';if(!byGroup.has(group))byGroup.set(group,new Map());const connections=byGroup.get(group)!;if(!connections.has(row.connection.id))connections.set(row.connection.id,[]);connections.get(row.connection.id)!.push(row);}
      const order=port.groups(),names=[...byGroup.keys()].sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)));
      const collapse=(kind:'groups'|'connections',key:string)=>{const values=model[kind];values.has(key)?values.delete(key):values.add(key);port.store(kind==='groups'?'globalForwardCollapsedGroups':'globalForwardCollapsedConnections',JSON.stringify([...values]));paint();};
      const save=async(kind:'group'|'connection',group:string,values:string[])=>service.run('sort',async()=>{
        if(!alive()||!canSort())return;
        if(kind==='group'){const present=port.groups();if(values.some(v=>!present.includes(v)))return;const merged=[...values,...present.filter(v=>!values.includes(v))];await port.api('/api/connection-groups/reorder',{method:'POST',body:JSON.stringify({names:merged})});}
        else{const originals=port.connections().filter(c=>c.group_name===group).map(c=>c.id),visible=values.map(Number);if(!visible.length||visible.some(id=>!originals.includes(id))||new Set(visible).size!==visible.length)return;const ids=[...visible,...originals.filter(id=>!visible.includes(id))];await port.api('/api/connections/reorder',{method:'POST',body:JSON.stringify({group_name:group,ids})});}
        await port.reload();port.notify(manager('order_saved'),'success');
      });
      const handle=(kind:'group'|'connection',group:string)=>h('button',{type:'button',class:'forward-drag-handle',disabled:!sorting||!!state.busy.size,title:manager(sorting?'drag_hint':'drag_filtered_hint'),'aria-label':manager(sorting?'drag_hint':'drag_filtered_hint'),onPointerdown:(e:PointerEvent)=>sort.begin(e,e.currentTarget as HTMLElement,values=>save(kind,group,values),paint),onKeydown:(e:KeyboardEvent)=>{if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key)||!sorting)return;e.preventDefault();const node=(e.currentTarget as HTMLElement).closest<HTMLElement>('[data-forward-sort-key]'),container=node?.parentElement;if(!node||!container)return;const values=[...container.children].map(n=>(n as HTMLElement).dataset.forwardSortKey||''),index=values.indexOf(node.dataset.forwardSortKey||''),next=index+(e.key==='ArrowUp'?-1:1);if(next<0||next>=values.length)return;[values[index],values[next]]=[values[next]!,values[index]!];void save(kind,group,values);}},icon('grip-vertical'));
      return h('div',{class:'forward-group-list'},names.map(name=>h('section',{class:'forward-group',key:name,'data-forward-sort-key':name},[
        h('header',null,[handle('group',''),action(port.groupName(name),()=>collapse('groups',name),model.groups.has(name)?'chevron-right':'chevron-down'),h('small',null,manager('group_summary',{servers:byGroup.get(name)!.size,rules:[...byGroup.get(name)!.values()].flat().length}))]),
        !model.groups.has(name)?h('div',null,[...byGroup.get(name)!.entries()].sort(([a],[b])=>{const source=port.connections();return source.findIndex(c=>c.id===a)-source.findIndex(c=>c.id===b);}).map(([id,values])=>h('section',{class:'forward-connection-group',key:id,'data-forward-sort-key':String(id)},[
          h('header',null,[handle('connection',name),action(values[0]!.connection.name,()=>collapse('connections',String(id)),model.connections.has(String(id))?'chevron-right':'chevron-down'),action(manager('add_short'),()=>edit(0,id),'plus')]),
          !model.connections.has(String(id))?h('div',{class:'forward-card-grid'},values.map(card)):null
        ]))):null
      ])));
    }
    function namedGroups(items:Row[]){
      const names=[...new Set(items.map(r=>r.forward.group_name||''))].sort((a,b)=>a.localeCompare(b,port.locale(),{numeric:true}));
      return h('div',{class:'forward-group-list'},names.map(name=>{const key='forward-name:'+name,all=rows(port).filter(r=>(r.forward.group_name||'')===name),busy=!!state.busy.size;return h('section',{class:'forward-named-group',key:name,'data-forward-group':name},[
        h('header',null,[action(name||manager('ungrouped'),()=>{model.groups.has(key)?model.groups.delete(key):model.groups.add(key);port.store('globalForwardCollapsedGroups',JSON.stringify([...model.groups]));paint();},model.groups.has(key)?'chevron-right':'chevron-down'),h('small',null,manager('group_rules',{count:all.length})),h('div',{class:'forward-row-actions'},[action(manager('start_group'),()=>service.bulk('start',name),'play','',busy||all.every(r=>active(r.forward))),action(manager('stop_group'),()=>service.bulk('stop',name),'square','danger',busy)])]),
        !model.groups.has(key)?h('div',{class:'forward-card-grid'},items.filter(r=>(r.forward.group_name||'')===name).map(card)):null
      ]);}));
    }
    function canSort(){return !connectionId&&!model.query.trim()&&model.status==='all'&&!model.connection&&model.page===1&&filtered().length<=model.size;}
    function view(){const all=rows(port),items=filtered(),data=paginate(items,model.page,model.size);model.page=data.page;port.store(pageKey,String(data.page));const present=new Set(all.filter(r=>!connectionId||r.connection.id===connectionId).map(r=>r.forward.id));for(const id of model.selected)if(!present.has(id))model.selected.delete(id);
      const connection=port.connections().find(c=>c.id===connectionId),busy=!!state.busy.size;
      return h('div',{class:['forward-page',connectionId?'forward-connection-page':'']},[
        h('header',{class:'forward-page-head'},[h('div',null,[h('h2',null,connection?connection.name+' · '+t('connections:forwards.workspace_title'):manager('title')),h('p',null,connection?t('connections:forwards.rules_count',{count:connection.forwards.length}):manager('subtitle',{count:all.length}))]),
          h('div',{class:'forward-row-actions'},[connection?action(t(connection.forwards.some(active)?'connections:actions.stop_forwards':'connections:actions.start_forwards'),()=>service.toolbar(connection.forwards.some(active)?'stop':'start',connectionId),connection.forwards.some(active)?'square':'play','',busy):action(t('connections:auto.restore_forwards'),()=>service.toolbar('restore'),'history','',busy),!connectionId?action(manager('stop_all'),()=>service.bulk('stop'),'square','danger',busy):null,!connectionId?action(manager('add'),()=>edit(0),'plus','primary',busy):null])]),
        state.error?h('p',{role:'alert',class:'forward-error'},state.error):null,
        connectionId?connection?form():h('p',null,t('connections:forwards.no_connection_selected')):h('section',{class:'forward-manager-filter'},[
          h('div',{class:'forward-statistics'},['all','running','reconnecting','failed','stopped'].map(status=>h('button',{type:'button',class:[status,model.status===status?'active':''],onClick:()=>change('status',status)},[h('strong',null,status==='all'?all.length:all.filter(r=>(r.forward.status||'stopped')===status).length),h('span',null,status==='all'?manager('total'):t('connections:forwards.'+status))]))),
          h('label',{class:'forward-search'},[icon('search'),h('input',{name:'forward_search',type:'search',value:model.query,placeholder:manager('search'),'aria-label':manager('search'),onInput:(e:Event)=>change('query',(e.target as HTMLInputElement).value)})]),
          h('div',{class:'forward-filters'},[
            choose(manager('status_filter'),model.status,[['all',manager('all_statuses')],...['running','reconnecting','failed','stopped'].map(s=>[s,t('connections:forwards.'+s)] as [string,string])],v=>change('status',v),'status_filter'),
            choose(manager('server_filter'),String(model.connection),[['0',manager('all_servers')],...port.connections().map(c=>[String(c.id),c.name] as [string,string])],v=>change('connection',v),'connection_filter'),
            choose(manager('group_mode'),model.group,[['flat',manager('no_grouping')],['ssh',manager('group_by_ssh')],['name',manager('group_by_name')]],v=>change('group',v),'group_mode')
          ])
        ]),
        connectionId&&data.total?h('div',{class:'forward-bulk-bar'},[check(t('connections:forwards.select_all'),data.items.every(r=>model.selected.has(r.forward.id)),()=>{const all=data.items.every(r=>model.selected.has(r.forward.id));data.items.forEach(r=>all?model.selected.delete(r.forward.id):model.selected.add(r.forward.id));paint();},data.items.some(r=>model.selected.has(r.forward.id))&&!data.items.every(r=>model.selected.has(r.forward.id))),model.selected.size?action(t('connections:forwards.delete_selected',{count:model.selected.size}),()=>service.remove([...model.selected]),'trash-2','danger',busy):null]):null,
        h('section',{class:'forward-results'},[h('h3',null,manager('results',{count:data.total})),data.total?model.group==='ssh'?groups(data.items,canSort()):model.group==='name'?namedGroups(data.items):connectionId?data.items.map(card):h('div',{class:'forward-card-grid'},data.items.map(card)):h('div',{class:'forward-empty'},[icon('route'),h('strong',null,manager('empty')),h('p',null,manager('empty_hint'))])]),pager(data)
      ]);
    }
    function paint(){if(!alive()||sort.active())return;const focused=document.activeElement,field=focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement?focused:null,selection=field?[field.selectionStart,field.selectionEnd]:null;
      const scroll=[target,...host.querySelectorAll<HTMLElement>('*')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>[n,n.scrollTop,n.scrollLeft] as const);
      host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(view(),host);for(const [node,top,left]of scroll)if(node.isConnected){node.scrollTop=top;node.scrollLeft=left;}
      if(focused instanceof HTMLElement&&host.contains(focused)&&focused.isConnected){focused.focus({preventScroll:true});if(field&&selection?.[0]!=null&&selection[1]!=null)try{field.setSelectionRange(selection[0],selection[1]);}catch{/* Numeric inputs have no text selection. */}}
    }
    const observer=new MutationObserver(()=>{if(host.parentElement!==target)owner.close();else paint();});observer.observe(target,{childList:true});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const lifetime=new MutationObserver(()=>{if(!valid())owner.close();});lifetime.observe(document.getElementById('workspaceDock')||document.body,{childList:true,subtree:true});
    const outside=(event:Event)=>{if(menuId&&event.target instanceof Node&&!host.querySelector('.forward-rule-menu')?.contains(event.target)&&!(event.target instanceof Element&&event.target.closest('.forward-row-actions'))){menuId=0;paint();}};
    const language=()=>{paint();};window.addEventListener('terma:language-changed',language);document.addEventListener('pointerdown',outside,true);
    const owner:Owner={connectionId,scopeOwner,host,service,paint,focus(id){if(!id)return;const item=rows(port).find(r=>r.forward.id===id);if(!item)return;model.query='';model.status='all';model.connection=connectionId;model.groups.delete(item.connection.group_name);model.groups.delete('forward-name:'+(item.forward.group_name||''));model.connections.delete(String(item.connection.id));const list=filtered(),index=list.findIndex(r=>r.forward.id===id);model.page=Math.floor(index/model.size)+1;highlight=id;paint();requestAnimationFrame(()=>{if(alive())host.querySelector(`[data-forward-id="${id}"]`)?.scrollIntoView({block:'center'});});},close(){if(disposed)return;
      if(scopeOwner&&connectionId&&valid()&&!state.busy.has('save'))drafts.set(scopeOwner,{connectionId,draft:{...state.draft},editing:state.editing,templateId:state.templateId,templatesOpen:state.templatesOpen});
      disposed=true;sort.dispose();question.close();observer.disconnect();lifetime.disconnect();window.removeEventListener('terma:language-changed',language);document.removeEventListener('pointerdown',outside,true);render(null,host);host.remove();owners.delete(target);}};
    owners.set(target,owner);const saved=scopeOwner?drafts.get(scopeOwner):null;if(scopeOwner)drafts.delete(scopeOwner);if(connectionId&&saved?.connectionId===connectionId){Object.assign(state,{draft:{...saved.draft},editing:saved.editing,templateId:saved.templateId,templatesOpen:saved.templatesOpen});}else if(connectionId)service.edit(0,connectionId);paint();owner.focus(focusId);return owner;
  }
  return {mount,refresh(){owners.forEach(owner=>owner.paint());},release(target?:HTMLElement){if(target)owners.get(target)?.close();else{[...owners.values()].forEach(owner=>owner.close());editor?.close();drafts=new WeakMap();}},editor(id:number,connectionId:number){editor=openForwardEditor(port,id,connectionId);},closeEditor:()=>editor?.close(),connection(target:HTMLElement,id:number,focusId=0){return mount(target,id,focusId);},manage(target:HTMLElement,id=0){return mount(target,0,id);}};
}
export function installForwardPages(port:ForwardPort){
  let feature:ReturnType<typeof createForwardPages>|null=null,dialog:ReturnType<typeof forwardDialog>|null=null;
  const current=()=>feature||(feature=createForwardPages(port));
  const pages:(typeof forwardsServices)['termaForwardPages']={
    connection:(target,id,focusId)=>current().connection(target,id,focusId),manage:(target,id)=>current().manage(target,id),
    refresh:()=>feature?.refresh(),editor:(id,c)=>current().editor(id,c),closeEditor:()=>feature?.closeEditor(),
    release(target){feature?.release(target);if(!target){dialog?.close();dialog=null;}},
    ask(question){if(!dialog)dialog=forwardDialog(port);return dialog.ask(question);}
  };
  forwardsServices.termaForwardPages=pages;return pages;
}


export interface InstalledFeaturesForwardsForwardPagesServices {
  termaForwardPages:{connection(target:HTMLElement,id:number,focusId?:number):Owner;manage(target:HTMLElement,id?:number):Owner;refresh():void;editor(id:number,connectionId:number):void;closeEditor():void;release(target?:HTMLElement):void;ask:import('./forward-service').Ask}
}
