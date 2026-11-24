import {connectionsServices} from '@/features/connections/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {createTerminalLogId} from '@/features/terminal/terminal-identity';
import {translate as tr} from '../../shared/i18n/runtime';
import {escapeHtml} from '../../shared/html-escape';
import {runtimePreferences} from '../settings/runtime-settings-model';
import {workspaceCssEscape,workspaceTabByKey} from '../workspace/workspace-dock-state';
import {closeWorkspaceModal} from '../workspace/workspace-modal-host';
import * as text from './response-text';
import * as commands from './response-commands';
import {terminalAiCurrentBufferText,type BufferSession} from './response-context';
import type {CommandSession,CommandPort} from './terminal-command-service';
import type {ExternalConnection} from './external-tools-service';
import type {AssistantRuntimePort} from './assistant-runtime';

type HostConnection=ExternalConnection&{updated_at?:unknown};
type HostSession=CommandSession&BufferSession&{
  id?:number;connection?:HostConnection;
  term?:BufferSession['term']&{getSelection?():string};
};

export function assistantSettings():Record<string,unknown> {
  return runtimePreferences.snapshot?.saved?.ai||runtimePreferences.snapshot?.ai||{};
}
export function assistantScope(key:string) {
  const session=terminalSessions.get(key),tab=workspaceTabByKey(key);
  const connection=()=>session?.connection||connectionsServices.termaConnectionController!.current(session?.id) as HostConnection|null;
  const stamp=(value:HostConnection|null|undefined)=>JSON.stringify([value?.id,value?.ssh_host,value?.ssh_port,value?.ssh_user,value?.identity_file,value?.updated_at]);
  const initial=stamp(connection());
  return ()=>terminalSessions.get(key)===session&&(!tab||workspaceTabByKey(key)===tab)&&stamp(connection())===initial;
}
export function assistantPanelElement(key:string,selector='.terminal-ai-panel'):HTMLElement|null {
  const owned=terminalServices.termaTerminalSurface.element(key,selector);
  if(owned)return owned;
  const panel=document.querySelector<HTMLElement>(`.terminal-ai-panel[data-terminal-ai-key="${workspaceCssEscape(key)}"]`);
  return panel&&(selector==='.terminal-ai-panel'||panel.matches(selector))?panel:null;
}
export function assistantPlacement(){return assistantSettings().terminal_ai_placement==='bottom'?'bottom':'right';}
export function assistantPanelPlaceholder(key:string) {
  queueMicrotask(()=>assistantServices.termaAssistant.paint(key));
  return `<section class="terminal-ai-panel" data-terminal-ai-key="${escapeHtml(key)}" data-i18n-skip hidden></section>`;
}
export function syncAssistantPlacements() {
  for(const [key,state] of assistantServices.termaAssistant.entries()) {
    if(!state.permission) {
      const value=String(assistantSettings().terminal_ai_permission||'');
      state.permission=['suggest','confirm','controlled','full'].includes(value)?value:'confirm';
    }
    assistantPanelElement(key)?.closest('.terminal-tab-surface')?.classList.toggle('terminal-ai-right',assistantPlacement()==='right');
  }
  for(const panel of document.querySelectorAll<HTMLElement>('.terminal-ai-panel[data-terminal-ai-key]')) {
    panel.closest('.terminal-tab-surface')?.classList.toggle('terminal-ai-right',assistantPlacement()==='right');
    const key=panel.dataset.terminalAiKey||'';
    if(key&&assistantServices.termaAssistant.service.has(key))assistantServices.termaAssistant.paint(key);
  }
}
export function createAssistantRuntimeHost():AssistantRuntimePort {
  return {
    tr,settings:assistantSettings,read:key=>localStorage.getItem(key),write:(key,value)=>localStorage.setItem(key,value),
    id:()=>createTerminalLogId(),now:()=>Date.now(),redact:text.terminalAiRedactAttachment,strip:text.terminalAiStripControl,command:commands.terminalAiCommandText,
    settle:key=>assistantServices.termaAssistant.execution.settleApproval(key,false),
    stopExecution:key=>{assistantServices.termaAssistant.tasks.stop(key);const session=terminalSessions.get(key);if(session)session.agentCommandInFlight=null;},
    scope:assistantScope,
    selection:key=>{const session=terminalSessions.get(key);return session?.sensitiveInput?'':String(session?.term?.getSelection?.()||'');},
    screen:key=>terminalAiCurrentBufferText(terminalSessions.get(key)),
    notify:key=>efficiencyServices.termaNotificationToasts?.notify(tr(key),'info'),
    insertCommand:(key,value,options)=>sendTerminalData(key,value,{...options,focus:options.focus!==false}),
    checkpointSend:async(key,command,signal)=>{
      const value=String(command||'');
      if(!value||signal?.aborted)return {sent:false,blockId:''};
      const state=assistantServices.termaAssistant.service.state(key),started=Date.now();
      const sent=sendTerminalData(key,value+'\r',{trackCommand:true,focus:false});
      const block=sent?state.blocks.slice().reverse().find(item=>item.command===value&&Number(item.startedAt||0)>=started-5):null;
      return {sent:Boolean(sent&&block?.id),blockId:block?.id||''};
    },
    checkpointWait:(key,blockId,signal)=>assistantServices.termaAssistant.commands.wait(key,blockId,{signal}),
    fetch:(payload,signal)=>fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,stream:true}),signal}),
    mcpRequest:(path,options={},signal)=>sharedServices.termaWorkspaceRequest(path,{...options,signal}),
    executeCommand:(key,command,options={})=>assistantServices.termaAssistant.commands.execute(key,command,options),
    waitCommand:(key,blockId,signal)=>assistantServices.termaAssistant.commands.wait(key,blockId,{signal}),
    externalConnection:id=>connectionsServices.termaConnectionController!.current(Number(id)),
    externalJumpConnection:id=>connectionsServices.termaConnectionController!.current(Number(id)),
    externalRequest:(path,options={})=>sharedServices.termaWorkspaceRequest(path,options),
    copyExternal:value=>navigator.clipboard.writeText(String(value||'')),
    notifyExternal:(message,level)=>efficiencyServices.termaNotificationToasts?.notify(message,level),
    userAgent:()=>String(navigator.userAgent||''),platform:()=>String(navigator.platform||''),
    desktop:()=>Boolean(window.termaDesktop),nativeWindow:()=>Boolean(window.termaDesktop),externalTools:()=>true,
    clipboard:()=>Boolean(navigator.clipboard),filesystem:()=>Boolean(window.termaDesktop&&typeof window.termaDesktop==='object'&&'chooseDirectory' in window.termaDesktop&&window.termaDesktop.chooseDirectory),
    requestError:response=>sharedServices.termaPublicErrors.fromResponse(response,tr('terminal:ai.request_failed')),
    commands:commands.terminalAiResponseCommands,cut:commands.terminalAiAnswerThroughFirstCommand,
    recordAnswer:(...args)=>assistantServices.termaAssistant.tasks.recordAnswer(...args),
    locale:()=>sharedServices.termaI18nRuntime?.getLanguage()||'zh-CN',
    panel:assistantPanelElement,placement:assistantPlacement,
    toolbar:key=>{
      for(const button of document.querySelectorAll(`.terminal-ai-button[data-terminal-ai-key="${workspaceCssEscape(key)}"]`)) {
        const state=assistantServices.termaAssistant.service.state(key);
        button.classList.toggle('active',state.open);button.setAttribute('aria-pressed',String(state.open));
      }
      terminalServices.termaTerminalToolbar?.refresh(key);
    },
    logSource:key=>{
      const reader=logsServices.termaLogReader.feature(),state=reader.service.get(key),view=reader.element(key);
      if(!state||!view)return null;
      const selected=String(window.getSelection()?.toString()||'').trim();
      return {text:(selected||state.text||'').slice(0,16000),current:()=>reader.service.get(key)===state&&reader.element(key)===view};
    },
    beforeModal:closeWorkspaceModal
  };
}
