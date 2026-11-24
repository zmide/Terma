import {quickServices} from '@/features/quick/installed-services';
import {h,render} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import type {Translate} from '../operations/operations-types';
import {requestOperationsBack} from '../operations/operations-modal';
import '@/styles/command-navigation.css';
interface Port {tr:Translate;closeModal():void;refreshRoot():void}
interface Field {id:string;name:string;index:number;value:string;checked:boolean}
interface Snapshot {fields:Field[];scroll:{id:string;index:number;top:number}[];focused:string}
interface Page {key:string;open:()=>unknown;snapshot?:Snapshot;seen:boolean}
export function installCommandNavigation(port:Port){
 let panel:HTMLElement|null=null,modal:HTMLElement|null=null,frame:HTMLElement|null=null,header:HTMLElement|null=null,slot:HTMLElement|null=null,anchor:Comment|null=null,observer:MutationObserver|null=null;
 let pages:Page[]=[],serial=0,transition=false,restore:Page|null=null,rootFocus:HTMLElement|null=null,rootTop=0,rootSkipped=false;
 const active=()=>!!frame&&!!pages.length;
 const capture=():Snapshot=>({fields:[...modal!.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')].flatMap((node,index)=>node.type==='password'||node.type==='file'||/password|passphrase|secret|token/i.test(node.id+' '+node.name)||node.closest('[data-workflow-secret]')?[]:[{id:node.id,name:node.name,index,value:node.value,checked:node instanceof HTMLInputElement&&node.checked}]),scroll:[...modal!.querySelectorAll<HTMLElement>('*')].map((node,index)=>({id:node.id,index,top:node.scrollTop})).filter(node=>node.top>0),focused:document.activeElement instanceof HTMLElement?document.activeElement.id:''});
 const forget=(page:Page)=>{page.snapshot?.fields.forEach(field=>field.value='');delete page.snapshot;};
 function restoreFields(page:Page){if(!modal||!page.snapshot)return;const fields=[...modal.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')];
  for(const saved of page.snapshot.fields){const field=saved.id?fields.find(n=>n.id===saved.id):fields[saved.index];if(field){field.value=saved.value;if(field instanceof HTMLInputElement)field.checked=saved.checked;field.dispatchEvent(new Event(field instanceof HTMLSelectElement||field instanceof HTMLInputElement&&field.type==='checkbox'?'change':'input',{bubbles:true}));}}
  const nodes=[...modal.querySelectorAll<HTMLElement>('*')];for(const saved of page.snapshot.scroll){const node=saved.id?nodes.find(n=>n.id===saved.id):nodes[saved.index];if(node)node.scrollTop=saved.top;}
  if(page.snapshot.focused)modal.querySelector<HTMLElement>('#'+CSS.escape(page.snapshot.focused))?.focus({preventScroll:true});restore=null;
 }
 function paint(){
  if(!header||!frame)return;
  const title=modal?.querySelector('h2')?.textContent||port.tr('navigation:auto.command_window');
  frame.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
  if(modal){modal.dataset.theme=frame.dataset.theme;modal.querySelectorAll('[aria-modal="true"]').forEach(node=>node.setAttribute('aria-modal','false'));}
  render(h('div',null,[h('div',{class:'command-page-toolbar'},[
   h(TermaButton,{type:'button',class:'command-page-back',onClick:back,'aria-label':port.tr('common:actions.back')},()=>[icon('arrow-left'),h('span',null,port.tr('common:actions.back'))]),
   h('strong',{id:'commandPageTitle'},title),h(TermaButton,{type:'button',class:'icon-button',onClick:back,title:port.tr('common:actions.close'),'aria-label':port.tr('common:actions.close')},()=>icon('x'))
  ]),h('p',{class:'command-page-loading',role:'status',hidden:!modal?.hidden},port.tr('common:command_palette.loading'))]),header);
 }
 function changed(){if(!active()||transition||!modal)return;const page=pages.at(-1)!;paint();if(!modal.hidden&&modal.childElementCount){page.seen=true;if(restore===page)restoreFields(page);}else if(page.seen)void back();}
 function attach(){panel=document.getElementById('quickPanel');modal=document.getElementById('modal');const dialog=panel?.querySelector<HTMLElement>('.quick-panel-dialog');if(!panel||!modal||!dialog)return false;
  rootFocus=document.activeElement instanceof HTMLElement&&panel.contains(document.activeElement)?document.activeElement:panel.querySelector<HTMLElement>('#quickPanelInput');rootTop=panel.querySelector('#quickPanelResults')?.scrollTop||0;
  rootSkipped=panel.hasAttribute('data-i18n-skip');panel.removeAttribute('data-i18n-skip');panel.querySelector('.quick-panel-search')?.setAttribute('data-i18n-skip','');
  anchor=document.createComment('command-page-modal');modal.before(anchor);frame=document.createElement('div');frame.className='command-page terma-vue-root';frame.setAttribute('data-command-page','');
  header=document.createElement('header');header.setAttribute('data-i18n-skip','');slot=document.createElement('div');slot.className='command-page-content';frame.append(header,slot);dialog.append(frame);slot.append(modal);panel.dataset.commandPage='1';panel.hidden=false;
  observer=new MutationObserver(changed);observer.observe(modal,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});return true;
 }
 function detach(){serial++;pages.forEach(forget);pages=[];restore=null;observer?.disconnect();observer=null;
  if(modal&&anchor?.isConnected)anchor.replaceWith(modal);anchor=null;if(header)render(null,header);frame?.remove();frame=null;header=null;slot=null;
  if(panel){delete panel.dataset.commandPage;if(rootSkipped)panel.setAttribute('data-i18n-skip','');port.refreshRoot();const list=panel.querySelector('#quickPanelResults');if(list)list.scrollTop=rootTop;}
  if(rootFocus?.isConnected)rootFocus.focus({preventScroll:true});else panel?.querySelector<HTMLElement>('#quickPanelInput')?.focus({preventScroll:true});
 }
 function invoke(page:Page){const version=++serial;page.seen=false;transition=true;port.closeModal();let result:unknown;
  try{result=page.open();}catch(error){transition=false;changed();throw error;}transition=false;changed();
  const finish=()=>{if(version!==serial)return;changed();if(restore===page)restoreFields(page);if(modal?.hidden&&!page.seen){
    // Vue modal views can mount on the next task after an async page opener
    // returns. Give the view one turn to attach before treating it as a
    // cancelled page; otherwise loading pages disappear before their request
    // settles and the command window loses its back stack.
    setTimeout(()=>{if(version!==serial||page!==pages.at(-1)||page.seen||!modal?.hidden)return;void back();},0);
  }};
  if(result instanceof Promise)void result.then(finish,finish);else queueMicrotask(finish);return result;
 }
 function page(key:string,open:()=>unknown):unknown {if(!active())return open();const previous=pages.at(-1);if(previous?.key===key){previous.open=open;return invoke(previous);}
  const existing=pages.findIndex(item=>item.key===key);if(existing>=0){pages.splice(existing+1).forEach(forget);const current=pages[existing]!;current.open=open;restore=current;return invoke(current);}
  if(previous&&!previous.seen&&modal?.hidden){previous.key=key;previous.open=open;return invoke(previous);}
  if(previous&&modal&&!modal.hidden)previous.snapshot=capture();const current:Page={key,open,seen:false};pages.push(current);return invoke(current);
 }
 function start(key:string,open:()=>unknown){if(active())return page(key,open);if(!attach())return open();pages.push({key,open,seen:false});return invoke(pages[0]!);}
 function back(){if(!active()||transition||requestOperationsBack())return;transition=true;port.closeModal();if(modal&&!modal.hidden){transition=false;return;}const removed=pages.pop();if(removed)forget(removed);transition=false;const previous=pages.at(-1);if(previous){restore=previous;return invoke(previous);}detach();}
 function exit(){if(!active())return true;transition=true;port.closeModal();if(modal&&!modal.hidden){transition=false;return false;}transition=false;detach();return true;}
 const keydown=(event:KeyboardEvent)=>{if(!active()||!frame)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void back();return;}if(event.key!=='Tab')return;
  const fields=[...frame.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(n=>n.checkVisibility());const first=fields[0],last=fields.at(-1);if(!first)return;
  if(event.shiftKey&&(document.activeElement===first||!frame.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!frame.contains(document.activeElement))){event.preventDefault();first.focus();}
 };
 document.addEventListener('keydown',keydown,true);window.addEventListener('terma:language-changed',paint);new MutationObserver(paint).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 quickServices.termaCommandNavigation={start,page,back,exit,active,contains:node=>!!frame?.contains(node),guard:()=>{const version=serial;return ()=>version===serial&&active();}};
}


export interface InstalledFeaturesQuickCommandNavigationServices {
  termaCommandNavigation:{start(key:string,open:()=>unknown):unknown;page(key:string,open:()=>unknown):unknown;back():unknown;exit():boolean;active():boolean;contains(node:Node):boolean;guard():()=>boolean}
}
