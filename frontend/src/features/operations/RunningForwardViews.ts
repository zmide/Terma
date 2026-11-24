import {operationsServices} from '@/features/operations/installed-services';
import {h,render,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '@/features/settings/settings-icon';
import {createRunningForwards,type RunningPort,type ForwardRow} from './running-forwards';
import '@/styles/running-forwards.css';
interface View {target:HTMLElement;host:HTMLElement;cleanup():void;paint():void}
export function createRunningViews(port:RunningPort){
  const service=createRunningForwards(port),views=new Map<string,View>();
  const t=port.tr;
  const button=(label:string,run:()=>unknown,glyph:string,cls='',disabled=false)=>h(TermaButton,{type:'button',title:label,'aria-label':label,class:cls,disabled,onClick:run},()=>[icon(glyph),cls.includes('icon-button')?null:h('span',null,label)]);
  const label=(key:string)=>t('connections:forward_manager.'+key);
  function row(value:ForwardRow):VNodeChild{
    const forward=value.forward,disabled=service.model.busy.has(forward.id)||!!service.model.toolbar;
    return h('article',{class:'forward-running-row',key:forward.id,'data-forward-id':forward.id},[
      h('button',{type:'button',class:'running-forward-main',onClick:()=>service.manage(forward.id),title:label('manage_rule')},[
        h('span',{class:'running-forward-title'},[h('strong',{title:value.title},value.title),h('span',{class:['running-status',forward.status]},value.status)]),
        h('span',{class:'running-mode'},value.mode),h('span',{class:'conn-meta'},value.connection.name+' · '+value.rule),
        ...[value.failedAt,value.quality,forward.service_note].filter(Boolean).map(text=>h('span',{class:'conn-meta'},text)),
        forward.last_error?h('span',{class:'forward-error-detail'},forward.last_error.slice(0,500)):null,
        value.url?h('code',{class:'running-forward-url'},value.url):null
      ]),
      h('div',{class:'running-actions'},[
        value.url?h('a',{class:'open-forward-link',href:value.url,target:'_blank',rel:'noopener noreferrer',title:t('common:auto.open')},[icon('external-link'),h('span',null,t('common:auto.open'))]):h('span',{class:'running-no-url'},label('no_running_address')),
        value.url?button(t('common:auto.copy'),()=>service.copy(forward.id),'copy','icon-button'):null,
        button(t('common:actions.retry'),()=>service.command(forward.id,'retry'),'rotate-cw','icon-button running-retry',disabled),
        button(forward.status==='failed'?t('common:auto.clear'):t('connections:actions.stop_forwards'),()=>service.command(forward.id,'stop'),forward.status==='failed'?'circle-x':'square','danger icon-button running-stop',disabled),
        forward.last_error&&forward.updated_at?button(t('common:workspace.failure_logs'),()=>service.logs(forward.id),'scroll-text','forward-error-log-link'):null
      ])
    ]);
  }
  function list(){const data=service.rows();return h('section',{class:'running-forward-view'},[
    h('div',{class:'running-overview'},(['running','reconnecting','failed'] as const).map(kind=>h('span',{class:kind},[h('strong',null,data.counts[kind]),h('span',{class:'running-overview-label'},t('connections:forwards.'+kind))]))),
    h('label',{class:'running-search search-field explorer-search'},[icon('search'),h('input',{id:'runningFilterInput',type:'search',value:service.model.query,placeholder:label('search_current'),'aria-label':label('search_current'),onInput:(event:Event)=>service.search((event.target as HTMLInputElement).value)})]),
    service.model.error?h('p',{class:'running-error',role:'alert'},service.model.error):null,
    h('div',{class:'running-forward-list'},data.rows.length?data.rows.map(row):h('div',{class:'ui-state'},[icon('route'),h('strong',null,data.total?t('common:auto.no_matches'):label('no_active')),h('p',null,data.total?label('search_current'):label('no_active_hint'))]))
  ]);}
  function tools(){const busy=!!service.model.toolbar;return h('div',{class:'running-tools explorer-action-strip explorer-compact-actions'},[
    button(label('manage_all'),()=>service.manage(),'route','primary'),
    h('div',{class:'explorer-aux-actions'},[
      button(t('connections:auto.restore_forwards'),()=>service.toolbar('restore'),'history','icon-button',busy||service.model.busy.size>0),
      button(label('stop_all'),()=>service.toolbar('stop'),'square','danger icon-button',busy||service.model.busy.size>0)
    ])
  ]);}
  function mount(target:HTMLElement,kind:'list'|'tools'){
    const previous=views.get(kind);if(previous?.target===target&&previous.host.parentElement===target){previous.paint();return;}previous?.cleanup();
    const host=document.createElement('div');host.className='terma-vue-root terma-running-root';host.setAttribute('data-i18n-skip','');target.replaceChildren(host);
    const value:View={target,host,cleanup(){},paint(){
      if(host.parentElement!==target)return;const focused=document.activeElement,field=focused instanceof HTMLInputElement?focused:null,selection=field?[field.selectionStart,field.selectionEnd]:null;
      const top=target.scrollTop,positions=[...host.querySelectorAll<HTMLElement>('*')].filter(node=>node.scrollTop).map(node=>[node,node.scrollTop] as const);
      host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(kind==='list'?list():tools(),host);
      target.scrollTop=top;for(const [node,scroll]of positions)if(node.isConnected)node.scrollTop=scroll;
      if(focused instanceof HTMLElement&&host.contains(focused)&&focused.isConnected){focused.focus({preventScroll:true});if(field&&selection?.[0]!=null&&selection[1]!=null)try{field.setSelectionRange(selection[0],selection[1]);}catch{/* Search fields may not expose a caret. */}}
    }};
    const update=()=>value.paint(),observer=new MutationObserver(()=>{if(host.parentElement!==target)value.cleanup();else update();});
    observer.observe(target,{childList:true});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('terma:language-changed',update);
    let removed=false;value.cleanup=()=>{if(removed)return;removed=true;observer.disconnect();window.removeEventListener('terma:language-changed',update);render(null,host);host.remove();if(views.get(kind)===value){views.delete(kind);if(kind==='list')service.detach();}};
    views.set(kind,value);if(kind==='list')service.attach(()=>views.forEach(view=>view.paint()));value.paint();
  }
  return {service,mountList:(target:HTMLElement)=>mount(target,'list'),mountTools:(target:HTMLElement)=>mount(target,'tools'),release(){[...views.values()].forEach(view=>view.cleanup());}};
}
export function installRunningViews(port:RunningPort){let feature:ReturnType<typeof createRunningViews>|null=null;const current=()=>feature||(feature=createRunningViews(port));const running:(typeof operationsServices)['termaRunning']={mountList:target=>current().mountList(target),mountTools:target=>current().mountTools(target),service:()=>current().service,release:()=>feature?.release()};operationsServices.termaRunning=running;return running;}


export interface InstalledFeaturesOperationsRunningForwardViewsServices {
  termaRunning:{mountList(target:HTMLElement):void;mountTools(target:HTMLElement):void;service():ReturnType<typeof createRunningForwards>;release():void}
}
