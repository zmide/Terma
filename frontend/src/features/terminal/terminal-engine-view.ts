import {workspaceDockState} from '../workspace/workspace-dock-state';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import type {Terminal} from '@xterm/xterm';
import {workspaceFindPaneForTab,workspaceFindPane} from '../workspace/workspace-dock-state';
import {executionPaneId,workspacePaneElement} from '../workspace/workspace-pane-scope';


export function bindTerminalInterruptKey(term:Pick<Terminal,'attachCustomKeyEventHandler'|'hasSelection'>,key:string) {
  term.attachCustomKeyEventHandler(event=>{
    if(event.type!=='keydown'||event.repeat||!event.ctrlKey||event.metaKey||event.altKey||event.shiftKey
      ||String(event.key||'').toLowerCase()!=='c'||term.hasSelection())return true;
    event.preventDefault();
    sendTerminalData(key,'\x03',{focus:false});
    return false;
  });
}

export function terminalViewForKey(key=''):HTMLElement|null {
  const pane=workspaceFindPaneForTab(key)||workspaceFindPane(executionPaneId())||workspaceFindPane(workspaceDockState.focusedPaneId);
  const view=pane?workspacePaneElement(pane.id)?.querySelector<HTMLElement>('#view-terminal'):null;
  return view||document.getElementById('view-terminal');
}


