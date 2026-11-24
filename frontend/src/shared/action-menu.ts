import {terminalServices} from '@/features/terminal/installed-services';
import {$} from '@/shared/workspace-dom';
import {localizedTermaUiPhrase} from './i18n/ui-phrase';
import type {TerminalDisplayMenuAction,TerminalMenuEvent} from '@/features/terminal/TerminalDisplayMenuView';
type ActionMenuEntry=Omit<TerminalDisplayMenuAction,'label'>&{label?:string};
export function hideActionMenu() {
  terminalServices.termaTerminalActionMenu?.close(false);
  terminalServices.termaTerminalDisplayMenu?.close(false);
  $("actionMenu")?.remove();
  $("actionSubMenu")?.remove();
  $("actionMenuBackdrop")?.remove();
}

export function normalizeActionMenuActions(actions:readonly ActionMenuEntry[]|null|undefined):TerminalDisplayMenuAction[] {
  if (!Array.isArray(actions)) return [];
  return actions.map(action => {
    if (!action || action.separator) return {...action,label:action?.label||""};
    const children = action.children;
    return {
      ...action,
      label:localizedTermaUiPhrase(action.label),
      children:children
        ? () => normalizeActionMenuActions(typeof children === "function" ? children() : children)
        : undefined
    };
  });
}

export function showActionMenu(event:TerminalMenuEvent,actions:readonly ActionMenuEntry[]) {
  const open = terminalServices.termaTerminalActionMenu?.open;
  if (typeof open !== "function") return false;
  return open(event, () => normalizeActionMenuActions(actions));
}

