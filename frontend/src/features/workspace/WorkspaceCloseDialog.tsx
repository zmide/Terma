import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';

export interface ClosingWorkspaceTab { title: string; status: string; persistent: boolean }
type Translate = (key: string, values?: Record<string, unknown>) => string;
let dismissCurrent: (() => void) | undefined;
export function dismissWorkspaceClose() { dismissCurrent?.(); }

export function confirmWorkspaceClose(target: HTMLElement, tabs: ClosingWorkspaceTab[], tr: Translate) {
  remoteServices.termaRemoteViews?.releaseDialog();
  terminalServices.termaTerminalViews?.releaseDialog();
  connectionsServices.termaConnectionViews?.release(target);
  quickServices.termaQuickViews?.release(target);
  unmountSettingsDialog();
  dismissWorkspaceClose();
  return new Promise<false | 'detach' | 'terminate'>(resolve=>{
    let finished=false;
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const persistentCount=tabs.filter(tab=>tab.persistent).length;
    const allPersistent=persistentCount===tabs.length;
    const finish=(choice:false|'detach'|'terminate')=>{
      if(finished)return;finished=true;dismissCurrent=undefined;
      document.removeEventListener('keydown',keydown,true);
      window.removeEventListener('terma:language-changed',paint);
      observer.disconnect();render(null,target);target.hidden=true;
      target.classList.remove('terma-vue-root','terma-workspace-root');
      target.removeAttribute('data-i18n-skip');delete target.dataset.workspaceDialog;
      if(trigger?.isConnected)trigger.focus({preventScroll:true});resolve(choice);
    };
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);return;}
      if(event.key!=='Tab')return;
      const buttons=[...target.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const next=event.shiftKey?buttons.at(-1):buttons[0];
      if(!target.contains(document.activeElement)||(event.shiftKey?document.activeElement===buttons[0]:document.activeElement===buttons.at(-1))){event.preventDefault();next?.focus();}
    };
    const status=(tab:ClosingWorkspaceTab)=>tr(`common:auto.${['connected','disconnected'].includes(tab.status)?tab.status:'connecting'}`);
    const detachLabel=()=>tr(allPersistent?'common:dialogs.detach_close':persistentCount?'common:dialogs.close_tabs':'common:dialogs.disconnect_close');
    const paint=()=>{
      const multiple=tabs.length>1;
      const message=tr(multiple?(allPersistent?'common:dialogs.persistent_tabs_many':persistentCount?'common:dialogs.connected_tabs_many_mixed':'common:dialogs.connected_tabs_many'):(allPersistent?'common:dialogs.persistent_tab_one':'common:dialogs.connected_tab_one'),{count:tabs.length,persistentCount,title:tabs[0]?.title||tr('common:dialogs.current_tab'),status:tabs[0]?status(tabs[0]):''});
      render(<div class="modal-card workspace-close-tabs-modal" role="alertdialog" aria-modal="true" aria-labelledby="workspaceCloseTabsTitle" aria-describedby="workspaceCloseTabsMessage">
        <h2 id="workspaceCloseTabsTitle">{tr('common:dialogs.connected_tabs_title')}</h2><div id="workspaceCloseTabsMessage" class="modal-message">{message}</div>
        {multiple?<ul class="workspace-close-tabs-list">{tabs.map((tab,index)=><li key={index}><strong data-i18n-skip>{tab.title||tr('common:dialogs.unnamed_tab')}</strong><span>{status(tab)}{tab.persistent?` · ${tr('common:dialogs.recoverable_session_continues')}`:''}</span></li>)}</ul>:null}
        <div class="actions workspace-close-tabs-actions">
          {h(TermaButton,{id:'workspaceCloseTabsCancel',onClick:()=>finish(false)},()=>tr('common:actions.cancel'))}
          {h(TermaButton,{id:persistentCount?'workspaceCloseTabsDetach':'workspaceCloseTabsConfirm',class:persistentCount?'':'danger',onClick:()=>finish('detach')},()=>[icon(allPersistent?'panel-top-close':'link-2-off'),<span>{detachLabel()}</span>])}
          {persistentCount?h(TermaButton,{id:'workspaceCloseTabsTerminate',class:'danger',onClick:()=>finish('terminate')},()=>[icon('x-circle'),<span>{tr('common:dialogs.terminate_persistent_close')}</span>]):null}
        </div>
      </div>,target);
    };
    const observer=new MutationObserver(()=>{if(target.hidden){finish(false);return;}target.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';});
    dismissCurrent=()=>finish(false);
    target.replaceChildren();target.onclick=null;target.onkeydown=null;target.hidden=false;
    target.classList.add('terma-vue-root','terma-workspace-root');target.dataset.workspaceDialog='close';target.setAttribute('data-i18n-skip','');
    target.dataset.theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    observer.observe(target,{attributes:true,attributeFilter:['hidden']});
    document.addEventListener('keydown',keydown,true);window.addEventListener('terma:language-changed',paint);
    paint();target.querySelector<HTMLElement>('#workspaceCloseTabsCancel')?.focus();
  });
}
