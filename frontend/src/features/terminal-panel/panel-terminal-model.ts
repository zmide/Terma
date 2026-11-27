import {createWorkspaceLayoutService, type WorkspaceLayoutNode, type WorkspacePaneNode} from '../workspace/workspace-layout-service';

const layout = createWorkspaceLayoutService();
export function createLocalTerminalGroups() {
  const groups: {id: string; layout: WorkspaceLayoutNode}[] = [];
  let active = '', focused = '';
  const pane = (key: string): WorkspacePaneNode => ({id: crypto.randomUUID(), type: 'pane', tabs: [key], activeTabKey: key});
  const current = () => groups.find(group => group.id === active);
  const keys = (node: WorkspaceLayoutNode) => layout.leaves(node).flatMap(item => item.tabs);
  function add(key: string, split: 'row' | 'column' | null = null) {
    const group = current(), node = group && layout.findPaneForTab(focused, group.layout);
    if (split && group && node) {
      group.layout = layout.replacePaneWithSplit(node.id, {id: crypto.randomUUID(), type: 'split', direction: split,
        ratio: 0.5, first: node, second: pane(key)}, group.layout);
    } else {
      const group = {id: crypto.randomUUID(), layout: pane(key)}; groups.push(group); active = group.id;
    }
    focused = key;
  }
  function select(key: string) {
    const group = groups.find(group => keys(group.layout).includes(key)); if (!group) return;
    active = group.id; focused = key;
  }
  function remove(key: string) {
    for (const group of [...groups]) {
      const node = layout.findPaneForTab(key, group.layout);
      if (!node) continue;
      node.tabs = []; node.activeTabKey = '';
      const next = layout.prune(group.layout);
      if (next) group.layout = next;
      else groups.splice(groups.indexOf(group), 1);
    }
    if (!current()) active = groups.at(-1)?.id || '';
    if (current() && !keys(current()!.layout).includes(focused)) focused = keys(current()!.layout)[0];
    if (!current()) focused = '';
  }
  return {groups, current, add, select, remove, keys, get focused() {return focused;}};
}
