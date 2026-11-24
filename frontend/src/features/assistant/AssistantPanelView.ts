import {markupView} from './markup-view';
import { escapeHtml as escapeText } from '../../shared/html-escape';
import type {AssistantState} from './assistant-model';
import type {createMarkupRenderers} from './markup-renderers';
export interface PanelViewPort {tr(key:string,params?:Record<string,unknown>):string;settings():Record<string,unknown>;approval(key:string):string;taskDock(key:string):string;draft(value:string):void;persist():void}
export function assistantPanelView(key:string,state:AssistantState,markup:ReturnType<typeof createMarkupRenderers>,port:PanelViewPort){const t=port.tr,chat=state.mode==='chat',html=markup.terminalAiPanelHtml(key),inner=html.slice(html.indexOf('>')+1,html.lastIndexOf('</section>'));
 const fragment=(value:string)=>markupView(value);
 return markupView(inner,(node)=>{
  const data=node.getAttributeNames(),has=(name:string)=>data.includes('data-terminal-ai-'+name),action=node.getAttribute('data-change-action');
  if(has('blocks'))return{children:fragment(state.blocks.length?state.blocks.slice().reverse().map(b=>markup.terminalAiBlockHtml(key,b,state.selectedBlockId,{chatMode:chat})).join(''):`<div class="terminal-ai-empty">${escapeText(t('terminal:ai.empty_blocks'))}</div>`)};
  if(has('turns'))return{children:fragment(state.error?`<div class="terminal-ai-error"><span>${escapeText(state.error)}</span></div>`:state.turns.length?markup.terminalAiTurnsHtml(key,state.turns):`<div class="terminal-ai-welcome"><span>${escapeText(t(chat?'terminal:ai.chat_welcome':'terminal:ai.welcome'))}</span></div>`)};
  if(has('approval'))return{props:{hidden:chat},children:fragment(chat?'':port.approval(key))};
  if(has('task-dock')){const html=chat?'':port.taskDock(key);return{props:{hidden:!html},children:markupView(html,element=>element.getAttribute('data-terminal-ai-task-dock-details')==='true'?{props:{onToggle:(event:Event)=>{state.taskPlanCollapsed=!(event.target as HTMLDetailsElement).open;port.persist();}}}:undefined)};}
  if(has('attachments'))return{children:fragment(state.attachments.map((a,index)=>`<span class="terminal-ai-attachment" title="${escapeText(a.name)}"><span>${escapeText(a.name)}</span><small>${markup.terminalAiFormatTokens(Math.round(a.text.length/4))}</small><button type="button" class="icon-button" data-action="terminal-ai-attachment-remove" data-terminal-ai-key="${escapeText(key)}" data-attachment-index="${index}" title="${escapeText(t('terminal:ai.remove_attachment'))}" aria-label="${escapeText(t('terminal:ai.remove_attachment'))}">×</button></span>`).join(''))};
  if(has('prompt'))return{props:{value:state.draft,disabled:state.busy,onInput:(event:Event)=>port.draft((event.target as HTMLTextAreaElement).value)}};
  if(has('send'))return{props:{disabled:state.busy}};if(has('stop'))return{props:{hidden:!state.busy}};
  if(action==='terminal-ai-permission')return{props:{value:state.permission}};
  if(action==='terminal-ai-model')return{props:{value:state.modelCustom?'__custom__':state.model||''}};
  if(node.getAttribute('data-input-action')==='terminal-ai-model-custom')return{props:{hidden:!state.modelCustom,disabled:!state.modelCustom,value:state.model}};
  if(action==='terminal-ai-reasoning')return{props:{value:state.reasoning_effort}};
  if(has('composer-model'))return{children:[state.model||t('terminal:ai.model_unselected')]};
  if(has('composer-reasoning'))return{children:[markup.terminalAiReasoningLabel(state.reasoning_effort)]};
  if(has('permission-hint'))return{children:[markup.terminalAiPermissionHint(state.permission)]};
  if(has('permission-row'))return{props:{hidden:chat}};
  if(has('session-usage')){const total=state.turns.reduce((sum,turn)=>sum+markup.terminalAiTurnUsage(turn).total,0);return{props:{title:t('terminal:ai.session_usage_hint'),'aria-label':t('terminal:ai.session_usage_hint')},children:[total?t('terminal:ai.session_tokens',{tokens:markup.terminalAiFormatTokens(total)}):state.turns.length?t('terminal:ai.session_tokens_pending'):'Agent']};}
  if(has('context-note')){const last=[...state.turns].reverse().find(turn=>markup.terminalAiTurnUsage(turn).available),tokens=last?markup.terminalAiTurnUsage(last).input:0,window=markup.terminalAiFormatTokens(Number(port.settings().context_tokens)||1000000);return{props:{title:t('terminal:ai.context_usage_hint'),'aria-label':t('terminal:ai.context_usage_hint')},children:[tokens?t('terminal:ai.context_usage',{window,selected:markup.terminalAiFormatTokens(tokens)}):t('terminal:ai.context_pending',{window})]};}
  return undefined;
 });
}
