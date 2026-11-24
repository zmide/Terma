import {h,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import type {LauncherState} from './launcher-service';
import type {X11Port,X11Application} from './x11-types';
export function launcherView(state:LauncherState,port:Pick<X11Port,'tr'|'localize'>,actions:{close():void;detect():void;select(id:string):void;change(field:'command'|'args'|'mode',value:string):void;submit():void;guide():void;label(app:X11Application):string;category(app:X11Application):string;warning(discovery:NonNullable<LauncherState['discovery']>):string}):VNodeChild{
 const t=port.tr,button=(name:string,label:string,action:()=>void,disabled=false)=>h(TermaButton,{type:'button',class:'icon-button',title:label,'aria-label':label,disabled,onClick:action},()=>icon(name));
 const groups=new Map<string,X11Application[]>();for(const app of state.applications){const category=actions.category(app);groups.set(category,[...(groups.get(category)||[]),app]);}
 const field=(id:string,label:string,key:'command'|'args')=>h('label',null,[h('span',null,label),h('input',{id,value:state[key],disabled:state.busy,placeholder:key==='command'?'xterm':'',onInput:(e:Event)=>actions.change(key,(e.target as HTMLInputElement).value)})]);
 const warning=state.discovery?actions.warning(state.discovery):'';
 const status=state.loading?t('common:x11.detecting_applications'):state.error?port.localize(state.error):state.applications.length?t(warning?'common:x11.detected_with_warning':'common:x11.detected_applications',{count:state.applications.length,warning}):t(warning?'common:x11.none_with_warning':'common:x11.no_applications',{warning});
 return h('form',{class:'modal-card x11-app-launcher',role:'dialog','aria-modal':'true','aria-labelledby':'x11AppLauncherTitle',onSubmit:(e:Event)=>{e.preventDefault();actions.submit();}},[
  h('div',{class:'modal-title-row'},[h('div',null,[h('h2',{id:'x11AppLauncherTitle'},t('common:x11.app_launcher_title')),h('span',{class:'muted'},state.name)]),button('x',t('common:actions.close'),actions.close)]),
  h('div',{class:'x11-app-detection'},[h('div',{id:'x11AppDetection',class:['connection-test-status',state.error?'error':state.loading?'busy':warning?'warning':'success'],'aria-live':'polite'},status),button('refresh-cw',t('common:x11.detect_again'),actions.detect,state.loading||state.busy)]),
  h('div',{id:'x11AppInstallAction',class:'x11-app-install-action'},[h(TermaButton,{type:'button',disabled:state.busy,onClick:actions.guide},()=>[icon('download'),t('common:x11.install_graphical_apps')])]),
  h('div',{class:'grid'},[h('label',null,[h('span',null,t('common:x11.installed_applications')),h('select',{id:'x11AppPreset',value:state.selected,disabled:state.loading||state.busy,onChange:(e:Event)=>actions.select((e.target as HTMLSelectElement).value)},[...groups.entries()].map(([label,apps])=>h('optgroup',{label},apps.map(app=>h('option',{value:app.id},actions.label(app))))).concat([h('option',{value:'custom'},t('common:x11.custom_application'))]))]),h('label',null,[h('span',null,t('common:x11.forwarding_mode')),h('select',{id:'x11AppMode',value:state.mode,disabled:state.busy,onChange:(e:Event)=>actions.change('mode',(e.target as HTMLSelectElement).value)},[h('option',{value:'untrusted'},t('common:x11.mode_untrusted')),h('option',{value:'trusted'},t('common:x11.mode_trusted'))])])]),
  field('x11AppCommand',t('common:x11.application'),'command'),field('x11AppArgs',t('common:x11.arguments'),'args'),
  h('div',{class:'actions'},[h(TermaButton,{type:'submit',class:'primary',disabled:state.loading||state.busy},()=>[icon(state.busy?'loader-circle':'play'),t(state.busy?'common:x11.launching':'common:auto.start')]),h(TermaButton,{type:'button',onClick:actions.close},()=>t('common:actions.cancel'))])
 ]);
}
