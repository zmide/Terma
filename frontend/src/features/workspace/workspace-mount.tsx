import {workspaceServices} from '@/features/workspace/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import { Fragment, h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { renderWorkspaceTabs } from './WorkspaceTabs';
import { workspaceTabPresentation } from './workspace-tab-presentation';
import type { WorkspaceLayout, WorkspaceViewPort } from './workspace-port';
import '@/styles/workspace.css';
import { renderWorkspaceGroups } from './WorkspaceGroups';
import { confirmWorkspaceClose, dismissWorkspaceClose } from './WorkspaceCloseDialog';

const paneMounts = new Map<HTMLElement, { host: HTMLElement; port: WorkspaceViewPort; id: string }>();
const roots = new Set<HTMLElement>();
const paints = new Map<HTMLElement, () => void>();

function own(target: HTMLElement) {
  target.classList.add('terma-vue-root','terma-workspace-root');
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  target.setAttribute('data-i18n-skip','');
  roots.add(target);
}

function paneView(id: string, port: WorkspaceViewPort) {
  const label = (key: string) => port.tr(`navigation:auto.${key}`);
  return h('section', {class:'workspace-pane','data-pane-id':id,'data-terma-workspace-owned':'pane',onPointerdownCapture:()=>port.focus(id),onFocusinCapture:()=>port.focus(id)}, [
    <div class="workspace-pane-chrome"><div class="tabs-shell" onContextmenu={event => {if (!(event.target as Element).closest('.tab,button')) port.tabsMenu(event);}}>
      {h(TermaButton,{class:'tabs-scroll-button tabs-scroll-left',title:label('scroll_tabs_left'),'aria-label':label('scroll_tabs_left'),hidden:true,onClick:()=>port.scroll(id,-1)},()=>icon('chevron-left'))}
      <div class="tabs" role="tablist" onScroll={() => port.tabScroll(id)} onWheel={event=>port.tabWheel(id,event)} />
      {h(TermaButton,{class:'tabs-scroll-button tabs-scroll-right',title:label('scroll_tabs_right'),'aria-label':label('scroll_tabs_right'),hidden:true,onClick:()=>port.scroll(id,1)},()=>icon('chevron-right'))}
      <div class="workspace-tab-insert-indicator" aria-hidden="true" hidden />
      {h('div', {
        class: 'workspace-tab-resizer', role: 'separator', 'aria-orientation': 'horizontal',
        'aria-label': label('resize_tab_bar'), tabindex: 0, title: label('resize_tab_bar_hint'),
        onVnodeMounted: vnode => workspaceServices.termaWorkspaceChrome?.bind(vnode.el as HTMLElement, 'tabs'),
        onVnodeBeforeUnmount: vnode => workspaceServices.termaWorkspaceChrome?.unbind(vnode.el as HTMLElement)
      })}
    </div><div class="workspace-header-tools" data-workspace-role="header-tools" hidden /></div>,
    <div class="workspace" />,
    <div class="workspace-pane-drop-indicator" aria-hidden="true" hidden><span /></div>
  ]);
}

function layoutView(node: WorkspaceLayout, port: WorkspaceViewPort): ReturnType<typeof h> {
  if (node.type === 'pane') {
    const attach = (element: HTMLElement) => {
    const pane = port.pane(node.id);
    if (pane.parentElement !== element) element.appendChild(pane);
    };
    return h('div', {key:node.id,class:'workspace-pane-slot','data-pane-slot-id':node.id,onVnodeMounted:vnode=>attach(vnode.el as HTMLElement),onVnodeUpdated:vnode=>attach(vnode.el as HTMLElement)});
  }
  const ratio = Math.max(port.minRatio,Math.min(port.maxRatio,Number(node.ratio)||0.5));
  return <div key={node.id} class={`workspace-split workspace-split-${node.direction}`} data-split-id={node.id} style={{'--workspace-split-ratio':`${ratio*100}%`}}>
    <div class="workspace-split-child workspace-split-first">{layoutView(node.first,port)}</div>
    <div class="workspace-splitter" role="separator" tabindex="0" aria-orientation={node.direction==='row'?'vertical':'horizontal'} aria-label={port.tr('navigation:auto.resize_split')} aria-valuemin={Math.round(port.minRatio*100)} aria-valuemax={Math.round(port.maxRatio*100)} aria-valuenow={Math.round(ratio*100)} onPointerdown={event=>port.splitStart(node.id,event)} onDblclick={()=>port.splitReset(node.id)} onKeydown={event=>port.splitKey(node.id,event)} />
    <div class="workspace-split-child workspace-split-second">{layoutView(node.second,port)}</div>
  </div>;
}

export function installWorkspaceViews() {
  workspaceServices.termaWorkspaceViews = {
    presentation: workspaceTabPresentation,
    retains:target=>[...paneMounts.keys()].some(pane=>pane===target||pane.contains(target)),
    confirmClose:confirmWorkspaceClose,
    unmountDialog:dismissWorkspaceClose,
    createPane(id, port) {
      const host = document.createElement('div');
      render(paneView(id,port),host);
      const pane = host.firstElementChild as HTMLElement;
      own(pane);
      pane.querySelector('.workspace')!.appendChild(port.views(id));
      paneMounts.set(pane,{host,port,id});
      return pane;
    },
    releasePane(pane) {
      const mount = paneMounts.get(pane);
      if (!mount) return;
      settingsServices.termaUnmountVueAbout?.(pane);
      connectionsServices.termaConnectionViews?.release(pane);
      for(const target of pane.querySelectorAll<HTMLElement>('.terma-remote-root')) remoteServices.termaRemoteViews?.release(target);
      for(const target of pane.querySelectorAll<HTMLElement>('[data-terma-settings-owned]')) settingsServices.termaUnmountVueSettings?.(target);
      const tabs = pane.querySelector<HTMLElement>('.tabs');
      if (tabs) this.unmount(tabs);
      render(null,mount.host);
      paneMounts.delete(pane); roots.delete(pane);
    },
    layout(target,tree,port) { own(target); render(layoutView(tree,port),target); },
    tabs(target,tabs,port,mobile=false) {
      own(target);
      const paint=()=>render(h(Fragment,null,renderWorkspaceTabs(tabs,port,mobile)),target);
      paints.set(target,paint);paint();
    },
    menu(target,items) {
      own(target);
      target.setAttribute('role','menu');
      render(h(Fragment,null,items.map(item=>h(TermaButton,{role:'menuitem',title:item.label,'aria-label':item.label,disabled:!item.enabled,onClick:item.action},()=>[icon(item.icon),<span>{item.label}</span>]))),target);
    },
    groups(target,groups,selection,combine) {own(target);render(h(Fragment,null,renderWorkspaceGroups(groups,selection,combine)),target);},
    unmount(target) { render(null,target);paints.delete(target);roots.delete(target); }
  };
  new MutationObserver(()=>{
    const theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
    for(const target of roots) {
      if(!target.isConnected && ![...paneMounts.keys()].some(pane=>pane===target||pane.contains(target))) {roots.delete(target);paints.delete(target);continue;}
      if(target.dataset.theme!==theme)target.dataset.theme=theme;
    }
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('terma:language-changed',()=>{
    for(const {host,port,id} of paneMounts.values()) render(paneView(id,port),host);
  });
  window.dispatchEvent(new Event('terma-workspace-views-ready'));
}
