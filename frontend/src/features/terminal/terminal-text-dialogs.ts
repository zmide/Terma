import {efficiencyServices} from '@/features/efficiency/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {h} from 'vue';
import {showOperationsModal} from '../operations/operations-modal';
import type {ModalBinding} from '../operations/operations-types';
import {TermaButton} from '../../shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {translate as tr} from '../../shared/i18n/runtime';
import {terminalHistory} from './terminal-history';
import {captureTerminalSessionInput} from './terminal-input-target';
import type {TerminalSurfaceSession} from './terminal-surface-service';
const notify=(message:string,kind:'info'|'success')=>efficiencyServices.termaNotificationToasts?.notify(message,kind);
const focus=(key:string)=>terminalServices.termaTerminalSurface.focus(key);
const button=(id:string,text:string,action:()=>unknown,className='')=>h(TermaButton,{id,class:className,type:'button',onClick:action},()=>text);

export function showRecentTerminalCommands(key:string){
  const items=terminalHistory.list();
  if(!items.length){notify(tr('terminal:recent.empty'),'info');return;}
  const target=captureTerminalSessionInput(key);
  let binding:ModalBinding;
  binding=showOperationsModal(()=>h('div',{class:'modal-card wide',role:'dialog','aria-modal':'true','aria-labelledby':'recentCommandTitle'},[
    h('h2',{id:'recentCommandTitle'},tr('terminal:recent.title')),
    h('div',{class:'muted'},tr('terminal:recent.newest_first')),
    h('div',{class:'recent-command-list'},items.map((command,index)=>h(TermaButton,{
      'data-index':index,type:'button',onClick:()=>{
        if(!binding.alive())return;
        const valid=target.isCurrent();binding.close();if(valid)sendTerminalData(key,`${command}\r`);
      }
    },()=>[h('span',{class:'recent-command-index'},index+1),h('code',null,command)]))),
    h('div',{class:'actions'},[
      button('recentCommandClear',tr('common:actions.clear'),()=>{terminalHistory.clear();binding.close();notify(tr('terminal:recent.cleared'),'success');},'danger'),
      button('recentCommandClose',tr('common:actions.close'),()=>binding.close())
    ])
  ]),()=>{if(target.isCurrent())focus(key);});
}

export function terminalBufferText(session?:Pick<TerminalSurfaceSession,'term'>){
  const buffer=session?.term.buffer.active;if(!buffer)return '';
  const lines:string[]=[];
  for(let index=0;index<buffer.length;index++)lines.push(buffer.getLine(index)?.translateToString(true)||'');
  return lines.join('\n').replace(/\s+$/,'');
}
export function showTerminalSessionText(key:string){
  const session=terminalSessions.get(key);
  if(!session){notify(tr('terminal:notifications.session_missing'),'info');return;}
  let text=terminalServices.termaTerminalClipboard!.format(terminalBufferText(session));
  if(!text){notify(tr('terminal:notifications.no_copy_content'),'info');return;}
  const target=captureTerminalSessionInput(key);let binding:ModalBinding,busy=false;
  const close=()=>binding.close();
  const copy=async()=>{
    if(busy||!binding.alive())return;busy=true;binding.paint();
    try {if(await sharedServices.termaClipboard.copy(text))if(binding.alive())close();}
    finally {busy=false;if(binding.alive())binding.paint();}
  };
  binding=showOperationsModal(()=>h('div',{class:'modal-card terminal-session-text-modal',role:'dialog','aria-modal':'true','aria-labelledby':'terminalSessionTextTitle'},[
    h('div',{class:'terminal-settings-head'},[
      h('div',null,[h('h2',{id:'terminalSessionTextTitle'},tr('terminal:session_copy.title')),h('span',null,tr('terminal:session_copy.summary',{lines:text.split('\n').length,characters:text.length}))]),
      h(TermaButton,{id:'terminalSessionTextClose',type:'button',class:'icon-button',title:tr('common:actions.close'),'aria-label':tr('common:actions.close'),onClick:close},()=>icon('x'))
    ]),
    h('textarea',{id:'terminalSessionTextEditor',class:'terminal-session-text-editor',readonly:true,spellcheck:false,'aria-label':tr('terminal:session_copy.full_text'),value:text}),
    h('div',{class:'actions terminal-session-text-actions'},[
      button('terminalSessionTextCancel',tr('common:actions.close'),close),
      h(TermaButton,{id:'terminalSessionTextCopy',class:'primary',type:'button',disabled:busy,onClick:copy},()=>[icon('copy-check'),h('span',null,tr('terminal:session_copy.copy_all'))])
    ])
  ]),()=>{text='';if(target.isCurrent())focus(key);});
  queueMicrotask(()=>{
    if(!binding.alive())return;
    const editor=document.getElementById('terminalSessionTextEditor');
    editor?.focus({preventScroll:true});if(editor)editor.scrollTop=editor.scrollHeight;
  });
}


