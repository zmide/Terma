import {filesServices} from '@/features/files/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import {h,render,type VNodeChild} from 'vue';
import type {ModalBinding} from './operations-types';
import '@/styles/operations.css';

interface Owner {host:HTMLElement;modal:HTMLElement;view:()=>VNodeChild;close:()=>void;cleanup():void;trigger:HTMLElement|null;back?:()=>boolean}
let current:Owner|null=null;
function release(owner=current){
  if(!owner||owner!==current)return;current=null;owner.cleanup();render(null,owner.host);
  const attached=owner.host.parentElement===owner.modal;owner.host.remove();if(attached&&!owner.modal.childElementCount)owner.modal.hidden=true;
  owner.close();if(attached&&owner.trigger?.isConnected)owner.trigger.focus({preventScroll:true});
}
function paint(owner:Owner){
  if(owner!==current)return;
  const active=document.activeElement,field=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement?active:null;
  const selection=field?[field.selectionStart,field.selectionEnd,field.selectionDirection] as const:null;
  const positions=[...owner.host.querySelectorAll<HTMLElement>('*')].filter(node=>node.scrollTop||node.scrollLeft).map(node=>[node,node.scrollTop,node.scrollLeft] as const);
  owner.host.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';render(h('div',{class:'operations-view'},[owner.view()]),owner.host);
  if(active instanceof HTMLElement&&owner.host.contains(active)&&active.isConnected){active.focus({preventScroll:true});if(field&&selection?.[0]!=null&&selection[1]!=null)try{field.setSelectionRange(selection[0],selection[1],selection[2]||undefined);}catch{/* Some fields have no caret. */}}
  positions.forEach(([node,top,left])=>{if(node.isConnected){node.scrollTop=top;node.scrollLeft=left;}});
}
export function showOperationsModal(view:()=>VNodeChild,onClose:()=>void,onEscape?:()=>boolean):ModalBinding {
  const modal=document.getElementById('modal');if(!modal){onClose();return {alive:()=>false,paint(){},close(){}};}
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  release();filesServices.termaSftpDialogs?.release();filesServices.termaSftpComparisonViews?.release();
  terminalServices.termaTerminalViews?.releaseDialog();remoteServices.termaRemoteViews?.releaseDialog();connectionsServices.termaConnectionViews?.release(modal);
  quickServices.termaQuickViews?.release(modal);unmountSettingsDialog();workspaceServices.termaWorkspaceViews?.unmountDialog();
  const host=document.createElement('div');host.className='terma-vue-root terma-sftp-root terma-operations-root';host.setAttribute('data-i18n-skip','');
  modal.replaceChildren(host);modal.hidden=false;modal.onkeydown=null;modal.onclick=null;
  const owner:Owner={host,modal,view,close:onClose,cleanup(){},trigger,back:onEscape};current=owner;
  const keydown=(event:KeyboardEvent)=>{
    if(current!==owner)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!onEscape?.())release(owner);return;}
    if(event.key!=='Tab'||quickServices.termaCommandNavigation?.contains(modal))return;
    const target=host.querySelector<HTMLElement>('[data-automation-layer]')||host;
    const fields=[...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.checkVisibility());
    const first=fields[0],last=fields.at(-1);if(!first)return;
    if(event.shiftKey&&(document.activeElement===first||!target.contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!target.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  const refresh=()=>paint(owner),observer=new MutationObserver(()=>{if(current!==owner)return;if(modal.hidden||host.parentElement!==modal)release(owner);else refresh();});
  observer.observe(modal,{childList:true,attributes:true,attributeFilter:['hidden']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('keydown',keydown,true);window.addEventListener('terma:language-changed',refresh);
  owner.cleanup=()=>{observer.disconnect();document.removeEventListener('keydown',keydown,true);window.removeEventListener('terma:language-changed',refresh);};
  paint(owner);queueMicrotask(()=>{if(current===owner)host.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')?.focus({preventScroll:true});});
  return {alive:()=>current===owner&&host.parentElement===modal&&!modal.hidden,paint:()=>paint(owner),close:()=>release(owner)};
}
export const releaseOperationsModal=()=>release();
export const requestOperationsBack=()=>current?.back?.()||false;
