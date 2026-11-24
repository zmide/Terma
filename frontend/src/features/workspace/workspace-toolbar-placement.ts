import {workspaceServices} from '@/features/workspace/installed-services';
import type {WorkspacePaneNode} from './workspace-layout-service';

export type ToolbarPlacement = Partial<Record<'split' | 'unsplit', Record<string, unknown>>>;
type ToolbarKind = 'terminal' | 'sftp';
interface ToolbarOwner {kind: ToolbarKind; tabKey: string; mount: HTMLElement | null}
interface PlacementPort {
  settings(): ToolbarPlacement;
  mobile(): boolean;
  dock(): HTMLElement | null;
  focused(): string;
  panes(): WorkspacePaneNode[];
  visiblePanes(): WorkspacePaneNode[];
  pane(id: string): WorkspacePaneNode | null;
  paneForTab(key: string): WorkspacePaneNode | null;
  paneElement(id: string): HTMLElement | null;
  paneNodes(): Iterable<HTMLElement>;
  tabKind(key: string): string | undefined;
  escape(value: string): string;
  legacySync(): void;
  updateTerminal(key: string): void;
  updateSftp(key: string): void;
  fitTerminal(): void;
  bindTerminalScroll(toolbar: HTMLElement): void;
}

export function createWorkspaceToolbarPlacement(port: PlacementPort, doc: Document = document) {
  // Toolbar placement is touched by several hot paths (tab activation, pane focus,
  // settings changes). Keep a tiny dirty/signature guard so repeated focus events
  // do not scan and reparent every terminal/SFTP toolbar when nothing changed.
  let workspaceToolbarPlacementDirty = true;
  let workspaceToolbarPlacementSignature = "";
  const workspaceToolbarKnownElements = new WeakMap<HTMLElement, ToolbarOwner>();

  function workspaceToolbarPlacementStateSignature() {
    const panes = port.panes().map(pane => `${pane.id}:${pane.activeTabKey}:${pane.tabs.join(",")}`).join("|");
    let settings = "";
    try { settings = JSON.stringify(port.settings()); } catch {}
    const toolbarCount = doc.querySelectorAll?.(".terminal-toolbar, .sftp-toolbar")?.length || 0;
    return `${doc.documentElement?.lang || ""}|${port.focused()}|${port.mobile() ? "mobile" : "desktop"}|${panes}|${toolbarCount}|${settings}`;
  }

  function workspacePaneHeaderToolsElement(paneId: string) {
    return port.paneElement(paneId)?.querySelector<HTMLElement>('[data-workspace-role="header-tools"]') || null;
  }

  function workspaceToolbarPlacementForTab(tabKey: string, kind = "") {
    if (port.mobile()) return "tab";
    const toolbarKind = kind || port.tabKind(tabKey) || "";
    const mode = port.panes().length > 1 ? "split" : "unsplit";
    const placement = port.settings()?.[mode]?.[toolbarKind];
    return placement === "tab" ? "tab" : "header";
  }

  function workspaceToolbarMountElement(kind: ToolbarKind, tabKey: string) {
    const escapedKind = port.escape(kind);
    const escapedKey = port.escape(tabKey);
    const registered = doc.querySelector<HTMLElement>(`[data-workspace-toolbar-mount="${escapedKind}"][data-workspace-tab-key="${escapedKey}"]`);
    if (registered) return registered;
    const pane = port.paneForTab(tabKey);
    const view = (pane && port.paneElement(pane.id)?.querySelector<HTMLElement>(`#view-${escapedKind}`)) || null;
    const viewKey = view?.dataset?.workspaceTabKey
      || view?.dataset?.terminalTabKey
      || view?.dataset?.sftpTabKey
      || "";
    if (!view || (viewKey && viewKey !== tabKey)) return null;
    const mountId = kind === "terminal" ? "terminalToolbarMount" : kind === "sftp" ? "sftpToolbarMount" : "";
    return mountId ? view.querySelector<HTMLElement>(`#${mountId}`) : null;
  }

  function registerWorkspaceToolbar(kind: ToolbarKind, tabKey: string, toolbar: HTMLElement | null, mount: HTMLElement | null) {
    if (!toolbar || !tabKey || !["terminal", "sftp"].includes(kind)) return null;
    const previous = workspaceToolbarKnownElements.get(toolbar);
    if (!previous || previous.kind !== kind || previous.tabKey !== tabKey || previous.mount !== mount) {
      workspaceToolbarPlacementDirty = true;
    }
    workspaceToolbarKnownElements.set(toolbar, {kind, tabKey, mount});
    toolbar.dataset.workspaceToolbarKind = kind;
    toolbar.dataset.workspaceTabKey = tabKey;
    if (mount) {
      mount.dataset.workspaceToolbarMount = kind;
      mount.dataset.workspaceTabKey = tabKey;
    }
    return toolbar;
  }

  function workspaceToolbarRecord(toolbar: HTMLElement | null): ToolbarOwner & {toolbar: HTMLElement} | null {
    if (!toolbar) return null;
    // Telnet/serial own their inline toolbar; SSH/SFTP placement must not adopt it.
    if (toolbar.closest<HTMLElement>("#view-remote-terminal")) return null;
    const kind = toolbar.dataset.workspaceToolbarKind
      || (toolbar.classList.contains("terminal-toolbar") ? "terminal" : toolbar.classList.contains("sftp-toolbar") ? "sftp" : "");
    if (kind !== "terminal" && kind !== "sftp") return null;
    const pane = toolbar.closest<HTMLElement>(".workspace-pane");
    const view = toolbar.closest<HTMLElement>(`#view-${kind}`);
    const mount = toolbar.closest<HTMLElement>("[data-workspace-toolbar-mount]")
      || toolbar.closest<HTMLElement>(kind === "terminal" ? "#terminalToolbarMount" : "#sftpToolbarMount");
    const tabKey = toolbar.dataset.workspaceTabKey
      || mount?.dataset?.workspaceTabKey
      || view?.dataset?.workspaceTabKey
      || view?.dataset?.terminalTabKey
      || view?.dataset?.sftpTabKey
      || port.pane(pane?.dataset.paneId ?? "")?.activeTabKey
      || "";
    if (!tabKey) return null;
    const ownerMount = workspaceToolbarMountElement(kind, tabKey) || mount;
    registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
    return {kind, tabKey, toolbar, mount:ownerMount};
  }

  function workspaceToolbarDestination(kind: ToolbarKind, tabKey: string, mount: HTMLElement | null = null) {
    const pane = port.paneForTab(tabKey);
    const tabKind = port.tabKind(tabKey);
    const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
    const tabOwnsToolbar = tabKind === kind || (kind === "terminal" && tabKind === "quick-terminal");
    if (!pane || !tabOwnsToolbar || pane.activeTabKey !== tabKey) {
      return {host:ownerMount, visible:false, header:false};
    }
    if (port.mobile()) {
      return {host:ownerMount, visible:pane.id === port.focused(), header:false};
    }
    if (workspaceToolbarPlacementForTab(tabKey, kind) === "tab") {
      return {host:workspacePaneHeaderToolsElement(pane.id), visible:true, header:true};
    }
    if (pane.id === port.focused()) {
      return {host:doc.getElementById("workspaceGlobalHeaderTools"), visible:true, header:true};
    }
    return {host:ownerMount, visible:false, header:false};
  }

  function returnWorkspaceToolbarToMount(toolbar: HTMLElement | null, hidden = true) {
    const record = workspaceToolbarRecord(toolbar);
    if (!toolbar) return;
    if (!record) {
      toolbar.remove();
      return;
    }
    if (!record.mount?.isConnected) {
      toolbar.remove();
      return;
    }
    if (record.mount && toolbar.parentElement !== record.mount) record.mount.appendChild(toolbar);
    toolbar.classList.remove("terminal-toolbar-header", "sftp-toolbar-header");
    toolbar.hidden = hidden;
  }

  function bindWorkspaceToolbarHorizontalScroll(toolbar: HTMLElement) {
    const terminalActions = toolbar?.querySelector?.(".terminal-actions");
    if (terminalActions) {
      port.bindTerminalScroll(toolbar);
      return;
    }
    const actions = toolbar.querySelector<HTMLElement>(".sftp-toolbar-actions");
    if (!actions || actions.dataset.workspaceHorizontalScroll === "1") return;
    actions.dataset.workspaceHorizontalScroll = "1";
    actions.tabIndex = 0;
    actions.addEventListener("wheel", event => {
      if (actions.scrollWidth <= actions.clientWidth + 1) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const previous = actions.scrollLeft;
      actions.scrollLeft += delta;
      if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
    }, {passive:false});
    actions.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || actions.scrollWidth <= actions.clientWidth + 1) return;
      const previous = actions.scrollLeft;
      if (event.key === "Home") actions.scrollLeft = 0;
      else if (event.key === "End") actions.scrollLeft = actions.scrollWidth;
      else actions.scrollLeft += event.key === "ArrowLeft" ? -120 : 120;
      if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
    });
  }

  function placeWorkspaceToolbar(kind: ToolbarKind, tabKey: string, toolbar: HTMLElement, mount: HTMLElement | null = null) {
    bindWorkspaceToolbarHorizontalScroll(toolbar);
    registerWorkspaceToolbar(kind, tabKey, toolbar, mount);
    const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
    if (ownerMount) registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
    const destination = workspaceToolbarDestination(kind, tabKey, ownerMount);
    const host = destination.host || ownerMount;
    if (!host) {
      toolbar.remove();
      return false;
    }
    for (const existing of [...host.querySelectorAll<HTMLElement>(":scope > .terminal-toolbar, :scope > .sftp-toolbar")]) {
      if (existing === toolbar) continue;
      const existingRecord = workspaceToolbarRecord(existing);
      if (existingRecord?.kind === kind && existingRecord.tabKey === tabKey) existing.remove();
      else returnWorkspaceToolbarToMount(existing, true);
    }
    if (toolbar.parentElement !== host) host.appendChild(toolbar);
    toolbar.hidden = !destination.visible;
    toolbar.classList.toggle("terminal-toolbar-header", destination.header && kind === "terminal");
    toolbar.classList.toggle("sftp-toolbar-header", destination.header && kind === "sftp");
    return destination.visible;
  }

  function syncWorkspaceToolbarHostVisibility() {
    const hosts = [
      doc.getElementById("workspaceGlobalHeaderTools"),
      ...[...port.paneNodes()].map(pane => pane.querySelector<HTMLElement>('[data-workspace-role="header-tools"]'))
    ].filter(entry => entry !== null);
    for (const host of hosts) {
      host.hidden = ![...host.children].some(child => child.matches?.(".terminal-toolbar:not([hidden]), .sftp-toolbar:not([hidden])"));
    }
  }

  function syncWorkspaceToolbarPlacements(options: {force?: boolean} = {}) {
    if (!port.dock()) return port.legacySync();
    const signature = workspaceToolbarPlacementStateSignature();
    if (options.force !== true && !workspaceToolbarPlacementDirty && signature === workspaceToolbarPlacementSignature) return false;
    // A toolbar discovered while this pass is running marks the next pass dirty;
    // this keeps dynamically mounted SFTP/terminal surfaces from being skipped.
    workspaceToolbarPlacementDirty = false;
    const discovered = [...doc.querySelectorAll<HTMLElement>(".terminal-toolbar, .sftp-toolbar")]
      .map(workspaceToolbarRecord)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const owners = new Map<string, (typeof discovered)[number]>();
    for (const record of discovered) {
      const owner = `${record.kind}\0${record.tabKey}`;
      const previous = owners.get(owner);
      if (!previous) {
        owners.set(owner, record);
        continue;
      }
      const previousAtMount = previous.toolbar.parentElement === previous.mount;
      const currentAtMount = record.toolbar.parentElement === record.mount;
      if (currentAtMount && !previousAtMount) {
        previous.toolbar.remove();
        owners.set(owner, record);
      } else {
        record.toolbar.remove();
      }
    }
    const records = [...owners.values()];
    let changed = false;
    const ranked = records.map(record => ({
      ...record,
      destination:workspaceToolbarDestination(record.kind, record.tabKey, record.mount)
    })).sort((left, right) => Number(left.destination.visible) - Number(right.destination.visible));
    for (const record of ranked) {
      const toolbar = record.toolbar;
      const beforeParent = toolbar.parentElement;
      const beforeHidden = toolbar.hidden;
      const beforeHeader = toolbar.classList.contains("terminal-toolbar-header") || toolbar.classList.contains("sftp-toolbar-header");
      placeWorkspaceToolbar(record.kind, record.tabKey, toolbar, record.mount);
      changed = changed || beforeParent !== toolbar.parentElement
        || beforeHidden !== toolbar.hidden
        || beforeHeader !== (toolbar.classList.contains("terminal-toolbar-header") || toolbar.classList.contains("sftp-toolbar-header"));
    }
    syncWorkspaceToolbarHostVisibility();
    for (const pane of port.visiblePanes()) {
      const kind = port.tabKind(pane.activeTabKey);
      if (kind === 'terminal' || kind === 'quick-terminal') port.updateTerminal(pane.activeTabKey);
      if (kind === 'sftp') port.updateSftp(pane.activeTabKey);
    }
    if (changed) port.fitTerminal();
    workspaceToolbarPlacementSignature = workspaceToolbarPlacementStateSignature();
    return changed;
  }

  return {
    placement:workspaceToolbarPlacementForTab,
    register:registerWorkspaceToolbar,
    place:placeWorkspaceToolbar,
    returnToMount:returnWorkspaceToolbarToMount,
    visibility:syncWorkspaceToolbarHostVisibility,
    sync:syncWorkspaceToolbarPlacements
  };
}

export function installWorkspaceToolbarPlacement(port: PlacementPort) {
  return workspaceServices.termaWorkspaceToolbar = createWorkspaceToolbarPlacement(port);
}



export interface InstalledFeaturesWorkspaceWorkspaceToolbarPlacementServices {
  termaWorkspaceToolbar?: ReturnType<typeof createWorkspaceToolbarPlacement>
}
