import { h } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import type { WorkspaceGroupView } from './workspace-port';

export function renderWorkspaceGroups(groups: WorkspaceGroupView[], selection: { text: string; confirm: string; cancel: string; enabled: boolean } | null, combine: string) {
  return [<div class="workspace-group-tabs" role="tablist">{groups.map(group=>h(TermaButton, {
    key:group.id, class:['workspace-group-tab',group.active&&'active',group.activity&&'has-activity'],
    role:'tab','aria-selected':String(group.active),'aria-label':group.label,title:group.label,draggable:true,
    'data-workspace-group-id':group.id,'data-action':'workspace-group-switch','data-contextmenu-action':'workspace-group-menu',
    'data-dragstart-action':'workspace-group-drag-start','data-dragover-action':'workspace-group-drag-over','data-drop-action':'workspace-group-drop','data-dragend-action':'workspace-group-drag-end'
  },()=>[icon('panels-top-left'),<span>{group.name}</span>,group.activity?<i class="workspace-group-activity" aria-label={group.activityLabel}/>:null,<small>{group.count}</small>]))}</div>,
  <div class="workspace-group-actions">{selection?[
    <span class="workspace-group-selection">{selection.text}</span>,
    h(TermaButton,{class:'primary',disabled:!selection.enabled,title:selection.confirm,'aria-label':selection.confirm,'data-action':'workspace-group-selection-confirm'},()=>[icon('check'),<span>{selection.confirm}</span>]),
    h(TermaButton,{title:selection.cancel,'aria-label':selection.cancel,'data-action':'workspace-group-selection-cancel'},()=>[icon('x'),<span>{selection.cancel}</span>])
  ]:combine?h(TermaButton,{title:combine,'aria-label':combine,'data-action':'workspace-group-selection-begin'},()=>[icon('combine'),<span>{combine}</span>]):null}</div>];
}
