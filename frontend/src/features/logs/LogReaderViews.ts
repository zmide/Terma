import {logsServices} from '@/features/logs/installed-services';
import {h,render,type VNodeChild} from 'vue';
import {action} from '../forwards/ForwardForms';
import {currentLineIndex,textPieces,displayLogText,type ReaderPort,type ReaderState} from './log-reader-model';
import {createLogReader,type ScrollMode} from './log-reader-service';
import '@/styles/log-reader.css';
export function logLines(text:string,query:string,state:Partial<ReaderState>={}){const current=currentLineIndex(text,query,state);return text.split('\n').flatMap((line,index)=>{let first=true;return [h('span',{class:'log-line',key:(state.startLine||0)+index,'data-log-line':state.startLine?state.startLine+index:undefined,'data-log-current':index===current?'true':undefined},textPieces(line,query).map(piece=>{if(!piece.match)return piece.text;const selected=index===current&&first;first=false;return h('mark',{class:selected?'log-search-current':undefined},piece.text);})), '\n'];});}
export function createLogReaderViews(port:ReaderPort){
 const views=new Map<string,{host:HTMLElement;target:HTMLElement;close():void;paint(mode?:ScrollMode):void}>();
 const service=createLogReader(port,(key,mode)=>mount(key,mode)),t=port.tr;
  function view(key:string,state:ReaderState){const index=state.matchIndex,count=state.matches.length,search=state.pendingSearchQuery??state.query;return h('section',{class:'log-reader-page'},[
  h('div',{class:'log-detail-search',role:'search',hidden:!state.detailSearchOpen},[h('label',{class:'log-reader-search'},[h('span',null,t('common:log_viewer.search_current')),h('input',{id:'logDetailSearch',type:'search',autocomplete:'off',spellcheck:false,value:search,'data-tab-key':key,'data-log-reader-input':'',placeholder:t('common:log_viewer.search_current'),'aria-label':t('common:log_viewer.search_current'),onInput:(e:Event)=>service.schedule((e.target as HTMLInputElement).value,key),onKeydown:(e:KeyboardEvent)=>{if(e.key==='Enter'){e.preventDefault();void service.search((e.target as HTMLInputElement).value,key);}}})]),h('span',{class:'log-detail-search-count','aria-live':'polite'},count&&index>=0?`${index+1}/${count}${state.matches_truncated?'+':''}`:search.trim()?'0/0':''),h('div',{class:'log-detail-search-actions'},[
    action(t('common:log_viewer.previous_match'),()=>service.move(-1,key),'chevron-up','icon-button',!count),action(t('common:log_viewer.next_match'),()=>service.move(1,key),'chevron-down','icon-button',!count),action(t('common:actions.close'),()=>service.showSearch(key,false),'x','icon-button')])]),
  h('div',{class:'log-view-actions'},[action(t('terminal:ai.log_open'),()=>port.ai(key),'sparkles'),port.externalAvailable()?action(t('common:log_viewer.open_external'),()=>service.external(key),'external-link'):null,action(t('common:auto.refresh'),()=>service.refresh(key),'refresh-cw','',state.busy),action(t('common:log_viewer.search_current'),()=>focusSearch(key),'search')]),
  state.loading?h('p',{role:'status'},t('common:log_viewer.loading')):null,
  service.error(state)?h('div',{role:'alert',class:'log-reader-error'},[service.error(state),action(t('common:actions.retry'),()=>service.refresh(key),'refresh-cw')]):null,
  state.has_older?h('div',{class:'log-load-actions'},[action(t('common:log_viewer.load_older'),()=>service.older(key),'chevrons-up','',state.busy),h('small',null,t('common:log_viewer.chunk_hint'))]):null,
  h('pre',{class:'log-view','data-i18n-skip':'',onScroll:(e:Event)=>state.scrollTop=(e.currentTarget as HTMLElement).scrollTop},logLines(displayLogText(state.text||(!state.loading?t('common:log_display.empty'):''),state,port),state.query,state))
 ]);}
 function mount(key:string,mode?:ScrollMode){const s=service.get(key),scope=port.scope(key),target=scope?.element();if(!s||!target||!scope?.valid())return;let current=views.get(key);if(current?.target!==target||current.host.parentElement!==target){current?.close();for(const [other,v]of [...views])if(v.target===target)views.get(other)?.close();const host=document.createElement('div');host.className='terma-vue-root terma-log-reader-root';host.setAttribute('data-i18n-skip','');target.replaceChildren(host);let closed=false,request=0;
    current={host,target,close(){if(closed)return;closed=true;request++;render(null,host);host.remove();views.delete(key);},paint(scroll='preserve'){
      if(closed||host.parentElement!==target)return;const state=service.get(key);if(!state)return;const focus=document.activeElement,input=focus instanceof HTMLInputElement?focus:null,selection=input?[input.selectionStart,input.selectionEnd]:null,pre=host.querySelector<HTMLElement>('.log-view'),previous={top:pre?.scrollTop??state.scrollTop,height:pre?.scrollHeight||0};host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(view(key,state),host);
      if(focus instanceof HTMLElement&&host.contains(focus)&&focus.isConnected){focus.focus({preventScroll:true});if(input&&selection?.[0]!=null&&selection[1]!=null)try{input.setSelectionRange(selection[0],selection[1]);}catch{/* Search inputs may not expose selection. */}}
      const next=host.querySelector<HTMLElement>('.log-view');if(!next)return;const version=++request,apply=()=>{if(closed||version!==request||!scope.valid()||!next.isConnected)return;if(scroll==='end')next.scrollTop=next.scrollHeight;else if(scroll==='restore')next.scrollTop=state.scrollTop;else if(scroll==='older')next.scrollTop=previous.top+Math.max(0,next.scrollHeight-previous.height);else if(scroll==='target'){const marker=host.querySelector<HTMLElement>('[data-log-current] mark.log-search-current,[data-log-current]')||host.querySelector<HTMLElement>(`[data-log-line="${state.targetLine}"]`);if(marker){const r=marker.getBoundingClientRect(),b=next.getBoundingClientRect();next.scrollTop+=r.top+r.height/2-b.top-next.clientHeight/2;}}else next.scrollTop=previous.top;state.scrollTop=next.scrollTop;};apply();requestAnimationFrame(()=>{apply();requestAnimationFrame(apply);});
    }};views.set(key,current);target.dataset.logTabKey=key;
  }current.paint(mode);
 }
 function focusSearch(key:string){service.showSearch(key);requestAnimationFrame(()=>{const input=views.get(key)?.host.querySelector<HTMLInputElement>('#logDetailSearch');input?.focus({preventScroll:true});input?.select();});}
 const language=()=>service.language(),theme=new MutationObserver(()=>views.forEach(v=>v.paint()));theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('terma:language-changed',language);
 const lifetime=new MutationObserver(()=>{service.prune();for(const [key,v]of [...views])if(!port.scope(key)?.valid()||v.host.parentElement!==v.target){v.close();}});lifetime.observe(document.getElementById('workspaceDock')||document.body,{childList:true,subtree:true});
 const keydown=(e:KeyboardEvent)=>{const current=port.current(),state=service.get(current.key);if(current.kind!=='log'||!state||document.getElementById('modal')?.hidden===false)return;if(e.key==='Escape'&&state.detailSearchOpen){e.preventDefault();service.showSearch(current.key,false);}else if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();focusSearch(current.key);}};document.addEventListener('keydown',keydown,true);
 const markup=(text:string,query:string,state:Partial<ReaderState>={})=>{const target=document.createElement('div');render(h('span',null,logLines(text,query,state)),target);const result=target.firstElementChild?.innerHTML||'';render(null,target);return result;};
 return {service,mount,focusSearch,markup,element:(key:string)=>port.scope(key)?.element()||null,release(key?:string){if(key){views.get(key)?.close();service.dispose(key);}else{[...views.values()].forEach(v=>v.close());for(const key of [...service.entries.keys()])service.dispose(key);}},scroll(key:string,mode:ScrollMode='restore'){views.get(key)?.paint(mode);}};
}
let feature:ReturnType<typeof createLogReaderViews>|null=null;
export function installLogReader(port:ReaderPort){const current=()=>feature||(feature=createLogReaderViews(port));logsServices.termaLogReader={feature:current};}



export interface InstalledFeaturesLogsLogReaderViewsServices {
  termaLogReader:{feature():ReturnType<typeof createLogReaderViews>}
}
