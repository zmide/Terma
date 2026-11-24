import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render, Fragment, type VNodeChild } from 'vue';
import * as views from './connection-views';
import { settingsIcon } from '../settings/settings-icon';
import type { ConnectionViewPort } from './connection-port';
import '@/styles/connections.css';

export const connectionIcon = settingsIcon;
export const connectionEmptyState = (kind: string, title: string, detail = '', actions?: VNodeChild) => h('div', { class: `ui-state ${kind}` }, [h('span', {class:'ui-state-icon','aria-hidden':'true'}), h('strong', null, title), detail ? h('span', null, detail) : null, actions ? h('div',{class:'actions'},actions) : null]);
const roots = new Set<HTMLElement>();
const paints = new Map<HTMLElement, () => unknown>();
let activePaint: (() => unknown) | undefined;
let port: ConnectionViewPort;
let saveGroup: ((name: string) => void) | undefined;
type ConnectionViews = { [K in keyof typeof views]: (...args: any[]) => any } & { release:(target:HTMLElement)=>void; form:(target:HTMLElement)=>void; refreshWelcome:()=>void };


export function releaseConnectionView(target: HTMLElement) {
  if (target.id === 'modal') saveGroup = undefined;
  for (const root of [...roots].reverse()) {
    if(root===target || target.contains(root)) {
      render(null,root); roots.delete(root); paints.delete(root);
      root.classList.remove('terma-connections-root','terma-vue-root');
      root.removeAttribute('data-theme');
      root.removeAttribute('data-i18n-skip');
    }
  }
}

export function setConnectionGroupSave(save?: (name: string) => void) {
  saveGroup = save;
}

export function submitConnectionGroup() {
  const modal = document.getElementById('modal');
  const save = saveGroup;
  if (!modal || modal.hidden || !save || remoteServices.termaRemoteProfiles?.busy()) return;
  const field = modal.querySelector<HTMLInputElement>('#modalGroupName');
  if (!field) return;
  const name = field.value.trim();
  if (!name) return port.notify(port.tr('connections:groups.name_required'), 'error');
  port.closeModal?.();
  save(name);
}

export function paintConnectionView(target: HTMLElement, children: VNodeChild) {
  if(!target) return;
  for(const root of [...roots].reverse()) {
    if(root!==target && target.contains(root)) releaseConnectionView(root);
  }
  if(!roots.has(target)) {
    if(target.id==='modal') {
      remoteServices.termaRemoteViews?.releaseDialog();
      terminalServices.termaTerminalViews?.releaseDialog();
      quickServices.termaQuickViews?.release(target);
      unmountSettingsDialog();
      workspaceServices.termaWorkspaceViews?.unmountDialog();
    }
    target.replaceChildren();
  }
  target.classList.add('terma-vue-root','terma-connections-root');
  target.setAttribute('data-i18n-skip','');
  target.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
  roots.add(target);
  if(activePaint) paints.set(target,activePaint);
  render(h(Fragment,null,children as any),target);
}

export function paintConnectionModal(target: HTMLElement, content: () => VNodeChild) {
  const paint = () => paintConnectionView(target, content());
  paint();
  paints.set(target, paint);
}
// Controllers own credentials and runtime options; repaint only translates their view.
async function preserveDraft(target: HTMLElement, paint: () => unknown) {
  const fields=[...target.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')];
  const values=fields.map(element=>({
    element, value:element.value, checked:element instanceof HTMLInputElement && element.checked,
    option:element instanceof HTMLSelectElement ? element.selectedOptions[0] : undefined
  }));
  const focused=target.contains(document.activeElement) ? document.activeElement : null;
  const position=focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    ? {start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection} : null;
  await paint();
  for(const saved of values) {
    if(target.contains(saved.element)) {
      if (saved.element instanceof HTMLSelectElement && saved.option && saved.element.contains(saved.option)) {
        saved.element.selectedIndex=saved.option.index;
      } else if (!(saved.element instanceof HTMLInputElement && saved.element.type === 'file')) {
        saved.element.value=saved.value;
      }
      if(saved.element instanceof HTMLInputElement) saved.element.checked=saved.checked;
    }
    saved.value='';
  }
  for(const form of target.querySelectorAll<HTMLFormElement>('#connectionForm')) {
    connectionsServices.termaConnectionTerminal?.refreshFormLanguage(form);
    connectionsServices.termaConnectionFormActions?.refreshIdentityOptions(form);
  }
  if(focused instanceof HTMLElement && focused.isConnected) {
    focused.focus({preventScroll:true});
    if(position && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && position.start!=null && position.end!=null) {
      try{focused.setSelectionRange(position.start,position.end,position.direction || undefined);}catch{/* Number/file fields have no text range. */}
    }
  }
}

export function installConnectionViews(host: ConnectionViewPort) {
  port=host;
  const call=(name:keyof typeof views,args:any[])=>{
    const previous=activePaint;
    const repaint=()=>call(name,args);
    activePaint=repaint;
    try {
      if(name==='renderExplorerTools' && port.primaryView==='settings') releaseConnectionView(port.$('explorerTools'));
      return (views[name] as any)(port,...args);
    } finally {activePaint=previous;}
  };
  const welcome=()=>{
    const target=port.$('view-welcome');
    if(!target || !roots.has(target)) return;
    const translated=Object.create(port) as ConnectionViewPort;
    translated.setWorkspace=()=>{};translated.loadStartupSummary=()=>{};
    views.renderWelcome(translated); views.renderStartupSummary(port);
  };
  connectionsServices.termaConnectionViews=Object.assign(Object.fromEntries(Object.keys(views).map(name=>[name,(...args:any[])=>call(name as keyof typeof views,args)])),{
    release:releaseConnectionView,
    form:(target:HTMLElement)=>{
      // Opening another connection resets its controller-owned fields and options.
      releaseConnectionView(target);
      const editing=Boolean(port.selectedId);
      const paint=()=>paintConnectionView(target,views.connectionFormView(port,editing));
      paints.set(target,paint);paint();
    },refreshWelcome:welcome
  }) as ConnectionViews;
  window.addEventListener('terma:language-changed',()=>{
    connectionsServices.termaConnectionLocalizationReady=(async()=>{
    for(const [target,paint] of [...paints]) {
      if(!roots.has(target)) continue;
      if(target.isConnected || workspaceServices.termaWorkspaceViews?.retains(target)) {
        if(target.id==='view-welcome') welcome();
        else if(target.id==='view-edit' || target.id==='modal') await preserveDraft(target,paint);
        else if(target.id==='startupSummary') views.renderStartupSummary(port,target);
      }else releaseConnectionView(target);
    }
    })();
  });
  new MutationObserver(()=>{
    for(const root of roots) root.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
}

export interface InstalledFeaturesConnectionsConnectionMountServices {
  termaConnectionViews?: ConnectionViews;
  termaConnectionLocalizationReady?: Promise<void>;
}
