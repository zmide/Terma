import { h } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { workspaceTabIcon } from './workspace-tab-presentation';
import type { WorkspaceTabView, WorkspaceViewPort } from './workspace-port';

function tabIcon(tab: WorkspaceTabView) {
  const marker = workspaceTabIcon(tab.kind, tab.protocol || '');
  return marker && <span class={marker.classes} aria-hidden="true">{icon(marker.glyph)}{marker.badge && <span class="tab-protocol-letter">{marker.badge}</span>}</span>;
}

function action(port: WorkspaceViewPort, name: string) {
  return (event: Event) => {
    event.stopPropagation();
    port.action(name, event, event.currentTarget as HTMLElement);
  };
}

export function renderWorkspaceTabs(tabs: WorkspaceTabView[], port: WorkspaceViewPort, mobile = false) {
  return tabs.map(tab => {
    const dot = tab.status ? <span class={`tab-connection-dot ${tab.status}`} title={tab.statusLabel} aria-hidden="true" /> : null;
    if (mobile) return <div key={tab.key} class={['mobile-workspace-tab', tab.active && 'active', tab.selected && 'multi-selected']} role="presentation">
      {h(TermaButton, {class:'mobile-workspace-tab-main', role:'tab', 'aria-selected':String(tab.active), 'aria-checked':String(tab.selected), 'aria-label':tab.label, title:tab.tooltip, 'data-tab-key':tab.key, 'data-action':'mobile-workspace-tab-activate', onClick:action(port,'mobile-workspace-tab-activate')}, () => [dot,tabIcon(tab),<span class="mobile-workspace-tab-title">{tab.title}</span>])}
      {tab.closable && !tab.pinned ? h(TermaButton, {class:'mobile-workspace-tab-close', 'aria-label':tab.closeLabel, title:tab.closeLabel, 'data-tab-key':tab.key, 'data-action':'workspace-tab-close', onPointerdown:action(port,'workspace-event-stop'), onClick:action(port,'workspace-tab-close')}, () => '×') : null}
    </div>;
    return h(TermaButton, {
      key:tab.key, class:['tab', tab.active&&'active', tab.selected&&'multi-selected', tab.pinned&&'pinned', tab.broadcast&&'broadcast-selected', tab.activity&&`activity-${tab.activity}`, tab.dropTarget&&'sftp-drop-target'],
      role:'tab', 'aria-selected':String(tab.active), 'aria-checked':String(tab.selected), 'data-tab-key':tab.key, 'data-kind':tab.kind, title:tab.tooltip, 'aria-label':tab.label,
      'data-action':'workspace-tab-activate',
      onPointerdown:action(port,'workspace-tab-drag-start'), onClick:action(port,'workspace-tab-activate'), onContextmenu:action(port,'workspace-tab-menu'),
      onDragover:action(port,'workspace-tab-sftp-drag-over'), onDragleave:action(port,'workspace-tab-sftp-drag-leave'), onDrop:action(port,'workspace-tab-sftp-drop')
    }, () => [dot,tabIcon(tab),tab.pinned?<span class="tab-pin" aria-hidden="true">{icon('pin')}</span>:null,<span class="tab-title">{tab.title}</span>,tab.closable&&!tab.pinned?<span class="tab-close" title={tab.closeLabel} aria-label={tab.closeLabel} data-tab-key={tab.key} data-action="workspace-tab-close" onPointerdown={action(port,'workspace-event-stop')} onClick={action(port,'workspace-tab-close')}>x</span>:null]);
  });
}
