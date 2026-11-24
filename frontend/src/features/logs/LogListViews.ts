import {logsServices} from '@/features/logs/installed-services';
import {h,render,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {action,forwardDialog} from '../forwards/ForwardForms';
import {createLogListService,logBytes,logLabel,type LogListPort,type LogGroup} from './log-list-service';
import '@/styles/log-list.css';
export function createLogListViews(port:LogListPort){
  const views=new Map<HTMLElement,{paint():void;close():void}>(),question=forwardDialog(port),service=createLogListService(port,()=>views.forEach(v=>v.paint()),question.ask),t=port.tr;
  const label=(value:string)=>logLabel(value,t,port.locale());
  const highlight=(text:string):string|VNodeChild[]=>{const q=service.model.query.trim(),at=q?text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()):-1;return at<0?text:[text.slice(0,at),h('mark',null,text.slice(at,at+q.length)),text.slice(at+q.length)];};
  function group(value:LogGroup):VNodeChild{const m=service.model,files=service.filtered(value.files),open=m.open.has(value.key),page=Math.min(m.pages.get(value.key)||0,Math.max(0,Math.ceil(files.length/10)-1)),title=value.name+' · '+logBytes(value.files.reduce((n,f)=>n+(f.size_bytes||0),0))+' · '+t('common:log_maintenance.file_count',{count:files.length});
    if(m.query.trim()&&!files.length)return null;
    return h('section',{class:'log-list-group',key:value.key},[
      h('header',null,[h('button',{type:'button',class:'log-list-group-main',title,onClick:()=>service.toggle(value.key),'aria-expanded':open},[icon(open?'chevron-down':'chevron-right'),icon(value.glyph),h('strong',null,value.name),h('small',null,files.length)]),action(t('common:log_maintenance.delete_group_title'),()=>service.remove(value.files.map(f=>f.path),true),'trash-2','danger icon-button',m.busy||!value.files.length)]),
      open?files.slice(page*10,(page+1)*10).map(file=>{const display=label(file.label),dated=value.key.startsWith('server:')?display.match(/^(.*)-(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.*)$/):null;return h('div',{class:'log-list-row',key:file.path},[
        h('button',{class:'log-list-file log-item',type:'button',title:display+' · '+logBytes(file.size_bytes),'data-log-path':file.path,'data-log-query':m.query,'data-log-line':m.hits.get(file.path)?.matches?.[0]?.line||0,onClick:()=>service.open(file)},[h('span',null,dated?dated[1]:display),dated?h('time',{class:'log-item-time'},dated[2]):null,m.hits.get(file.path)?.matches?.[0]?.text?h('small',{class:'log-item-hit'},highlight(m.hits.get(file.path)!.matches![0]!.text.slice(0,400))):null]),
        action(t('navigation:menus.delete_log',{name:label(file.label)}),()=>service.remove([file.path]),'trash-2','danger icon-button',m.busy)
      ]);}):null,
      open&&files.length>10?h('div',{class:'log-list-pager'},[action(t('common:auto.previous_page'),()=>service.page(value.key,page-1),'chevron-left','',page===0),h('span',null,`${page+1}/${Math.ceil(files.length/10)}`),action(t('common:auto.next_page'),()=>service.page(value.key,page+1),'chevron-right','',(page+1)*10>=files.length)]):null
    ]);
  }
  function list(){const m=service.model,groups=service.groups(),has=groups.some(g=>service.filtered(g.files).length);return h('div',{class:'log-list'},[
    m.loading?h('p',{role:'status'},t('common:log_maintenance.loading')):null,m.searching?h('p',{role:'status'},t('common:log_maintenance.searching')):null,
    service.error()?h('div',{class:'log-list-error',role:'alert'},[service.error(),action(t('common:actions.retry'),()=>service.load(),'refresh-cw')]):null,
    ...groups.map(group),!m.loading&&!has?h('div',{class:'log-list-empty'},[icon('scroll-text'),h('strong',null,t('common:auto.no_terminal_logs')),h('p',null,t(m.query.trim()?'common:log_viewer.no_matches':'common:auto.terminal_logs_hint'))]):null
  ]);}
  function tools() {
    const searchLabel = t('common:workspace.search_logs');
    const cleanupLabel = t('common:workspace.cleanup_logs');
    return h('div', {class:'log-list-tools explorer-action-strip explorer-compact-actions'}, [
      h('label', {class:'search-field explorer-search'}, [
        icon('search'),
        h('input', {
          id:'logSearch', type:'search', value:service.model.query,
          placeholder:searchLabel, 'aria-label':searchLabel,
          onInput:(event:Event)=>service.search((event.target as HTMLInputElement).value)
        })
      ]),
      action(t('common:auto.today_logs'),port.today,'calendar-days','primary'),
      h('div',{class:'explorer-aux-actions'},[
        action(t('common:workspace.log_settings'),port.settings,'settings-2','icon-button'),
        h(TermaButton,{type:'button',class:'icon-button',title:cleanupLabel,'aria-label':cleanupLabel,onClick:port.cleanup},()=>icon('list-filter'))
      ])
    ]);
  }
  function mount(target:HTMLElement,kind:'list'|'tools'){
    const existing=views.get(target);if(existing){existing.paint();return;}const host=document.createElement('div');host.className='terma-vue-root terma-log-list-root';host.setAttribute('data-i18n-skip','');target.replaceChildren(host);let closed=false;
    const paint=()=>{if(closed||host.parentElement!==target)return;const focus=document.activeElement,field=focus instanceof HTMLInputElement?focus:null,selection=field?[field.selectionStart,field.selectionEnd]:null,top=target.scrollTop;host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(kind==='list'?list():tools(),host);target.scrollTop=top;if(focus instanceof HTMLElement&&focus.isConnected&&host.contains(focus)){focus.focus({preventScroll:true});if(field&&selection?.[0]!=null&&selection[1]!=null)try{field.setSelectionRange(selection[0],selection[1]);}catch{/* Search controls may omit selection support. */}}};
    const observer=new MutationObserver(()=>{if(host.parentElement!==target)close();else paint();});observer.observe(target,{childList:true});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('terma:language-changed',paint);
    const close=()=>{if(closed)return;closed=true;observer.disconnect();window.removeEventListener('terma:language-changed',paint);render(null,host);host.remove();views.delete(target);if(kind==='list'){service.suspend();question.close();}};views.set(target,{paint,close});paint();
  }
  return {service,label,mountList:(target:HTMLElement)=>mount(target,'list'),mountTools:(target:HTMLElement)=>mount(target,'tools'),release(){[...views.values()].forEach(v=>v.close());}};
}
let feature:ReturnType<typeof createLogListViews>|null=null;
export function installLogList(port:LogListPort,renderExplorer:()=>Promise<unknown>){const current=()=>feature||(feature=createLogListViews(port));logsServices.termaLogList={renderExplorer,list:target=>current().mountList(target),tools:target=>current().mountTools(target),service:()=>current().service,label:value=>current().label(value),release:()=>feature?.release()};}


export interface InstalledFeaturesLogsLogListViewsServices {
  termaLogList:{renderExplorer():Promise<unknown>;list(target:HTMLElement):void;tools(target:HTMLElement):void;service():ReturnType<typeof createLogListService>;label(value:string):string;release():void}
}
