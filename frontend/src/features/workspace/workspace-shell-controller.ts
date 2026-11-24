import {settingsServices} from '@/features/settings/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {notify} from '@/features/efficiency/notification-actions';
import {applicationState} from '@/shared/application-state';
import {syncTerminalResponsiveFontSizes,syncTerminalToolbarPlacement} from '@/features/terminal/terminal-page';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { installShellViews, refreshShellViews } from './ShellNavigation';

const views = ['connections', 'remote', 'running', 'command', 'import', 'logs', 'settings'] as const;
type Primary = typeof views[number];
const isPrimary = (value: string): value is Primary => views.some(view => view === value);
const collapsedKey = 'operationPaneCollapsed';
const pinKey = 'operationPanePinnedByViewV1';
const guideKey = 'operationPanePinGuideSeenV3';

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep the change for this window. */ }
}

function readPinnedViews() {
  let saved: Partial<Record<Primary, unknown>> = {};
  try {
    const value: unknown = JSON.parse(readPreference(pinKey) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* Invalid saved preferences use defaults. */ }
  return new Map(views.map(view => [view, saved[view] !== false]));
}

let collapsed = false;
let pinnedViews = new Map<Primary, boolean>();
let guideSeen = false;
let showGuide = false;
let subtitle = '';
let mobilePane: 'explorer' | 'workspace' = 'explorer';
let wasMobile = false;
let renderFrame = 0;
let activitySequence = 0;

function isPinned(view = applicationState.primaryView) {
  return !isPrimary(view) || pinnedViews.get(view) !== false;
}

function positionGuide() {
  const guide = document.getElementById('operationPanePinGuide');
  const button = document.getElementById('operationPanePin');
  if (!guide || !button || guide.hidden) return;
  const bounds = guide.getBoundingClientRect();
  const pin = button.getBoundingClientRect();
  const anchor = pin.left + pin.width / 2 - bounds.left;
  guide.style.setProperty('--operation-pane-pin-guide-anchor', `${Math.max(18, Math.min(bounds.width - 18, anchor))}px`);
}

function refresh() {
  refreshShellViews();
  positionGuide();
}

function dismissGuide() {
  if (!showGuide) return;
  showGuide = false;
  refresh();
}

function syncOperationPane() {
  const mobile = isMobileLayout();
  document.querySelector('.app')?.classList.toggle('operation-pane-collapsed', collapsed && !mobile);
  if (mobile || collapsed) showGuide = false;
  else if (!guideSeen && document.getElementById('operationPanePinGuide')) {
    showGuide = guideSeen = true;
    writePreference(guideKey, '1');
    requestAnimationFrame(positionGuide);
  }
  refresh();
}

function setCollapsed(value: boolean) {
  collapsed = value;
  writePreference(collapsedKey, value ? '1' : '0');
  syncOperationPane();
  terminalViewport.schedule();
}

function setPinned(value: boolean, view = applicationState.primaryView) {
  if (!isPrimary(view)) return;
  pinnedViews.set(view, value);
  writePreference(pinKey, JSON.stringify(Object.fromEntries(pinnedViews)));
  showGuide = false;
  refresh();
}

function contentClick(event: MouseEvent) {
  if (isMobileLayout() || event.button !== 0) return;
  if (!collapsed && !isPinned()) setCollapsed(true);
  else dismissGuide();
}

function setHeading(value: string) {
  subtitle = String(value || '');
  refresh();
}

export function installWorkspaceShell() {
  collapsed = readPreference(collapsedKey) === '1';
  pinnedViews = readPinnedViews();
  guideSeen = readPreference(guideKey) === '1';
  wasMobile = isMobileLayout();
  installShellViews({tr, snapshot: () => ({
    primary: applicationState.primaryView, pinned: isPinned(), collapsed, guide: showGuide,
    update: settingsServices.termaUpdateNotice.visible(), subtitle,
    theme: document.documentElement.dataset.theme || 'light'
  })});
  document.getElementById('content')?.addEventListener('click', contentClick, true);
  window.addEventListener('resize', positionGuide);
}

function setMobilePane(pane: typeof mobilePane) {
  mobilePane = pane;
  const workspace = pane === 'workspace';
  document.querySelector('.left-pane')?.classList.toggle('mobile-hide', workspace);
  document.getElementById('content')?.classList.toggle('mobile-show', workspace);
  document.body.classList.toggle('mobile-terminal-active', workspace && ['terminal', 'remote-terminal'].includes(applicationState.activeView));
  workspaceServices.termaWorkspaceMobile?.render();
}

function syncResponsive() {
  const mobile = isMobileLayout();
  const layoutChanged = mobile !== wasMobile;
  if (mobile) workspaceServices.termaWorkspaceChrome?.cancel();
  syncOperationPane();
  syncTerminalResponsiveFontSizes();
  if (mobile) setMobilePane(wasMobile ? mobilePane : applicationState.activeView === 'welcome' ? 'explorer' : 'workspace');
  else {
    document.querySelector('.left-pane')?.classList.remove('mobile-hide');
    document.getElementById('content')?.classList.remove('mobile-show');
    document.body.classList.remove('mobile-terminal-active');
  }
  wasMobile = mobile;
  syncTerminalToolbarPlacement();
  filesServices.termaSftpPage?.toolbar(applicationState.activeTabKey);
  return layoutChanged;
}

function pending(value: boolean) {
  document.querySelector('.activity')?.classList.toggle('activity-render-pending', value);
}

function report(error: unknown) {
  notify(error instanceof Error ? error.message : String(error), 'error');
}

function renderPrimary(view: Primary, mobile: boolean) {
  switch (view) {
    case 'import': {
      if (!mobile) {
        const exchange = dataExchangeServices.termaExchange.feature();
        if (applicationState.activeView === 'import') exchange.syncNavigation();
        else exchange.open();
      }
      break;
    }
    case 'command':
      void batchServices.termaBatch.renderExplorer({reload:false}).catch(report);
      if (!mobile) batchServices.termaBatch.open();
      break;
    case 'settings':
      if (!mobile) {
        if (applicationState.activeView !== 'settings') void settingsServices.termaSettingsViews?.open();
        else settingsServices.termaSettingsNavigation.show(undefined, {moveToWorkspace:false});
      }
      break;
    case 'running':
      forwardsServices.termaForwardWorkspace.renderRunning();
      if (!mobile) forwardsServices.termaForwardWorkspace.openManager();
      break;
    case 'logs':
      void logsServices.termaLogList.renderExplorer().catch(report);
      break;
    default:
      connectionsServices.termaConnectionViews?.renderConnections();
  }
}

function showPrimary(view: string, togglePane = false) {
  if (!isPrimary(view)) return;
  activitySequence += 1;
  const mobile = isMobileLayout();
  const previous = applicationState.primaryView;
  applicationState.primaryView = view;
  document.getElementById('sideConnections')?.classList.toggle('active', view === 'connections');
  document.getElementById('sideRemote')?.classList.toggle('active', view === 'remote');
  document.getElementById('sideImport')?.classList.toggle('active', view === 'import');
  if (togglePane && !mobile) setCollapsed(view === previous && !collapsed);
  else refresh();
  if (mobile) setMobilePane('explorer');
  else if (view !== 'import' && view !== 'command' && view !== 'settings') document.querySelector('.left-pane')?.classList.remove('mobile-hide');
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  pending(true);
  connectionsServices.termaConnectionViews?.renderExplorerTools();
  if (view === 'import' || view === 'command' || view === 'settings') {
    try { renderPrimary(view, mobile); } finally { pending(false); }
    return;
  }
  renderFrame = requestAnimationFrame(() => {
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      try { if (applicationState.primaryView === view) renderPrimary(view, mobile); } finally { pending(false); }
    });
  });
}

function reveal(view: Primary) {
  if (!isMobileLayout() && collapsed) setCollapsed(false);
  showPrimary(view);
}

export function selectExplorerSection(sectionId: string) {
  if (document.getElementById('explorerTools')?.dataset.termaSettingsOwned !== undefined) return;
  for (const button of document.querySelectorAll<HTMLElement>('#explorerTools [data-explorer-section]')) {
    button.classList.toggle('active', button.dataset.explorerSection === sectionId);
  }
}

export const workspaceShell = {
  showPrimary, reveal, setHeading, refresh, syncOperationPane, syncResponsive, setCollapsed, setPinned, isPinned, dismissGuide,
  activitySequence: () => activitySequence,
  togglePinned: () => setPinned(!isPinned()),
  isCollapsed: () => collapsed,
  showMobileExplorer: () => setMobilePane('explorer'),
  showMobileWorkspace: () => setMobilePane('workspace')
};



export interface InstalledFeaturesWorkspaceWorkspaceShellControllerServices {
  termaWorkspaceShell: typeof workspaceShell
}
