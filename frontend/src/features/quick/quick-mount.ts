import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sharedServices} from '@/shared/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render, Fragment, type VNode, type VNodeChild } from 'vue';
import * as views from './quick-views';
import { settingsIcon } from '../settings/settings-icon';
import type { QuickViewHost, QuickViewPort } from './quick-port';
import { createQuickSshFlow, createQuickSshService } from './quick-ssh-service';
import type { Forward } from '../forwards/forward-model';
import { createQuickConnectActions, registerQuickConnectActions } from './quick-connect-actions';
import { createQuickTaskViewHost, createQuickViewHost, openQuickSavedTerminal } from './quick-host';
import { sftpActiveStatuses } from '../files/sftp/sftp-task-model';
import type { createTaskState } from '../files/sftp/task-workspace';
import { renderTaskCenter, renderTaskFloat, type TaskCenterPort } from './TaskCenter';
import { renderQuickHeader } from './QuickHeader';
import '@/styles/quick.css';
import {installCommandNavigation} from './command-navigation';
import {createQuickConnectSearchService, createQuickForwardPresentation} from './quick-connect-search-service';

export const quickIcon = settingsIcon;
export const quickEmptyState = (kind: string, title: string, detail = '') => h('div', { class: `ui-state ${kind}` }, [h('span', {class:'ui-state-icon','aria-hidden':'true'}), h('strong', null, title), detail ? h('p', null, detail) : null]);
const roots = new Set<HTMLElement>();
const additions = new Map<HTMLElement, HTMLElement[]>();
let port: QuickViewPort;
let modalView: { name: string; args: any[]; trigger: HTMLElement | null } | null = null;
type QuickViews = { [K in keyof typeof views]: (...args: any[]) => any } & { renderTaskCenter: (jobs?: any[]) => void; renderTaskFloat: (jobs?: any[]) => void; renderQuickHeader: (snapshot?: Record<string, any> | null, error?: boolean) => void };
type QuickReleaseOptions = { preserveQuickSshSubmission?: boolean };
declare global {
  interface Window {
    termaDesktop?: unknown;
  }
}

export function paintQuickView(target: HTMLElement, children: VNodeChild) {
  if (target.id === 'modal' && !roots.has(target)) {
    terminalServices.termaTerminalViews?.releaseDialog();
    remoteServices.termaRemoteViews?.releaseDialog();
    connectionsServices.termaConnectionViews?.release(target);
    unmountSettingsDialog();
    workspaceServices.termaWorkspaceViews?.unmountDialog();
  }
  if (!roots.has(target)) target.replaceChildren();
  for (const root of [...roots].reverse()) {
    if (root !== target && (!root.isConnected || target.contains(root))) { render(null, root); roots.delete(root); }
  }
  for (const [parent, children] of additions) {
    if (parent === target || target.contains(parent)) {
      children.forEach(child => { render(null, child); roots.delete(child); child.remove(); });
      additions.delete(parent);
    }
  }
  target.classList.add('terma-vue-root', 'terma-quick-root');
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  target.setAttribute('data-i18n-skip', '');
  roots.add(target);
  const normalized = Array.isArray(children) ? children : children == null || children === '' ? [] : [children];
  render(h(Fragment, null, normalized as VNode[]), target);
}

// Separate keyed Vue roots for optional additions keep the existing grid and focus order.
export function appendQuickView(target: HTMLElement, children: VNodeChild, position = 'beforeend') {
  const host = document.createElement('div');
  host.style.display = 'contents';
  if (position === 'afterend') target.after(host);
  else if (position === 'afterbegin') target.prepend(host);
  else target.append(host);
  const list = additions.get(target) || []; list.push(host); additions.set(target, list);
  paintQuickView(host, children);
}

export function releaseQuickView(target: HTMLElement, options: QuickReleaseOptions = {}) {
  if (target.id === 'modal' && roots.has(target)) {
    // Cancel pending controller work before handing the shared modal to another view.
    if (target.dataset.xServerManager === '1') x11Services.termaX11.closeManager();
    if (target.dataset.quickSshAuth === '1') {
      if (options.preserveQuickSshSubmission) {
        // Host verification replaces the form while its submitted request waits.
        port.sshFlow.clearSecrets();
        target.dataset.quickSshAuth = '';
      } else views.closeQuickSshAuthModal(port);
    }
    if (target.dataset.quickConnectionLauncher === '1') views.closeQuickConnectionLauncher(port);
    target.onkeydown = null;
    target.onclick = null;
  }
  if (target.id === 'modal' && modalView) {
    const trigger = modalView.trigger; modalView = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  const owned = [...roots].filter(root => root === target || target.contains(root)).reverse();
  owned.forEach(root => { render(null, root); roots.delete(root); });
  for (const [parent, children] of additions) {
    if (parent === target || target.contains(parent) || !parent.isConnected) {
      children.forEach(child => child.remove()); additions.delete(parent);
    }
  }
  target.classList.remove('terma-vue-root', 'terma-quick-root');
  target.removeAttribute('data-i18n-skip');
}

export function installQuickViews(tasks: ReturnType<typeof createTaskState>) {
  const host = createQuickViewHost();
  const ssh = quickServices.termaQuickSshService = createQuickSshService(host);
  const search = quickServices.termaQuickConnectSearch = createQuickConnectSearchService({
    get connections() { return host.connections; },
    tr: host.tr,
    parseQuickSshTarget: ssh.parse,
    quickSshExactConnections: ssh.matching
  });
  quickServices.termaQuickForwardPresentation = createQuickForwardPresentation(host.tr, search);
  const openLauncher = () => quickServices.termaQuickViews?.openQuickConnectionLauncher();
  const closeLauncher = () => quickServices.termaQuickViews?.closeQuickConnectionLauncher();
  const closeAuth = () => quickServices.termaQuickViews?.closeQuickSshAuthModal();
  const openAuth: Parameters<typeof createQuickSshFlow>[2]['openAuth'] = target => quickServices.termaQuickViews?.startQuickSshConnection(target);
  const sshFlow = quickServices.termaQuickSshFlow = createQuickSshFlow(host, ssh, {closeLauncher, closeAuth, openAuth});
  let frame: number | undefined;
  let query = '';
  function cancelQuickSearch() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }
  port = Object.assign(host, {ssh, search, sshFlow, cancelQuickSearch});
  const taskPort: TaskCenterPort = {
    ...createQuickTaskViewHost(),
    tr: host.tr,
    get sftpLatestJobs() { return tasks.jobs; },
    get sftpTaskCenterView() { return tasks.view; },
    SFTP_ACTIVE_JOB_STATUSES: sftpActiveStatuses,
    sftpDismissedFloatingJobIds: tasks.dismissed
  };
  const actions = quickServices.termaQuickConnectActions = createQuickConnectActions({
    connection(action, id) {
      if (action === 'edit') return connectionsServices.termaConnectionFormWorkspace.edit(id);
      if (action === 'terminal') return openQuickSavedTerminal(id);
      return filesServices.termaSftpPage.open(id);
    },
    close: closeLauncher,
    openForwards: (id, forward) => forwardsServices.termaForwardWorkspace.openConnection(id, true, forward),
    findForward: id => forwardsServices.termaForwardWorkspace.find(id),
    isActive: forward => forwardsServices.termaForwardRuntime.isActive(forward as Forward),
    forwardMissing: () => host.notify(host.tr('connections:forwards.not_found', {defaultValue:'Forwarding rule not found'}), 'error'),
    command: (kind, id, button) => forwardsServices.termaForwardActions.command(id, kind, false, button),
    refresh: () => {
      views.renderQuickConnectionRows(port, document.querySelector<HTMLInputElement>('#quickConnectionSearch')?.value || '');
      const panel = document.getElementById('quickPanel');
      if (panel && !panel.hidden) efficiencyServices.termaEfficiency.palette.refresh(panel.querySelector<HTMLInputElement>('#quickPanelInput')?.value || '', false);
    },
    direct: sshFlow.runDefault
  }, search);
  registerQuickConnectActions(sharedServices.termaEventRegistry!, actions, ssh, sshFlow, {
    openLauncher, closeLauncher, closeAuth, openAuth,
    syncAuth: () => views.syncQuickSshAuthFields(port),
    schedule(value) {
      query = value;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        views.renderQuickConnectionRows(port, query);
      });
    }
  });
  installCommandNavigation({tr:(key,options)=>port.tr(key,options),closeModal:()=>port.closeModal(),refreshRoot:()=>efficiencyServices.termaEfficiency.palette.refresh(document.querySelector<HTMLInputElement>('#quickPanelInput')?.value||'',false)});
  const opening = new Set(['openQuickConnectionLauncher', 'startQuickSshConnection', 'openTerminalSessionManager', 'showXServerManagerLoading', 'renderXServerManager', 'renderX11InstallGuide']);
  quickServices.termaQuickViews = Object.assign(Object.fromEntries(Object.entries(views).map(([name, fn]) => [name, (...args: any[]) => {
    const context = opening.has(name) ? { name, args, trigger: modalView?.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null) } : null;
    const result = (fn as (scope: QuickViewPort, ...args: any[]) => any)(port, ...args);
    if (context) {
      const remember = () => { const modal = document.getElementById('modal'); if (modal && !modal.hidden && roots.has(modal)) modalView = context; };
      if (result instanceof Promise) result.then(remember, () => {}); else remember();
    }
    const modal = document.getElementById('modal');
    if (name.startsWith('close') && modal?.hidden) releaseQuickView(modal);
    return result;
  }])), { release: releaseQuickView, renderTaskCenter: (jobs?: any[]) => renderTaskCenter(taskPort, jobs), renderTaskFloat: (jobs?: any[]) => renderTaskFloat(taskPort, jobs), renderQuickHeader: (snapshot?: Record<string, any> | null, error?: boolean) => renderQuickHeader(host, snapshot, error) }) as QuickViews & { release: typeof releaseQuickView };
  const refreshLocalization = async () => {
    renderQuickHeader(host); renderTaskCenter(taskPort);
    const modal = document.getElementById('modal');
    const current = modalView;
    if (!modal || modal.hidden || !current || !roots.has(modal)) return;
    if(modal.querySelector('.xserver-manager,.x11-install-guide'))return;
    const picker=modal.querySelector<HTMLElement>('[data-server-directory-picker]');
    if(picker){picker.remove();roots.delete(picker);}
    const fields = [...modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')].map((field, index) => ({ id: field.id, name: field.getAttribute('name'), index, value: field.value, checked: field instanceof HTMLInputElement && field.checked }));
    const details = [...modal.querySelectorAll('details')].map(element => element.open);
    const visibility = [...modal.querySelectorAll<HTMLElement>('[id]')].map(element => ({ id: element.id, hidden: element.hidden }));
    const scroll = [...modal.querySelectorAll<HTMLElement>('*')].filter(element => element.scrollTop > 0).map(element => ({ id: element.id, className: element.className, top: element.scrollTop }));
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const restore = () => {
      const next = [...modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')];
      for (const saved of fields) { const field = saved.id ? next.find(element => element.id === saved.id) : next[saved.index]; if (!field || (saved.name && field.name !== saved.name)) continue; field.value = saved.value; if (field instanceof HTMLInputElement) field.checked = saved.checked; }
    };
    try {
      await (views[current.name as keyof typeof views] as (scope: QuickViewPort, ...args: any[]) => any)(port, ...current.args);
      if (modalView !== current || modal.hidden) return;
      restore();
      if (current.name === 'openQuickConnectionLauncher') views.renderQuickConnectionRows(port, modal.querySelector<HTMLInputElement>('#quickConnectionSearch')?.value || '');
      if (current.name === 'startQuickSshConnection') views.syncQuickSshAuthFields(port);
      [...modal.querySelectorAll('details')].forEach((element, index) => { element.open = details[index] || false; });
      for (const saved of visibility) { const element = document.getElementById(saved.id); if (element && modal.contains(element)) element.hidden = saved.hidden; }
      for (const saved of scroll) { const element = saved.id ? document.getElementById(saved.id) : [...modal.querySelectorAll<HTMLElement>('*')].find(element => element.className === saved.className); if (element) element.scrollTop = saved.top; }
      if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    } finally {
      if(picker) {
        const input=document.getElementById(picker.dataset.serverDirectoryPicker || '');
        if(modalView===current && input && modal.contains(input)) {input.closest('label')?.after(picker);roots.add(picker);}
        else render(null,picker);
      }
      fields.forEach(field => { field.value = ''; });
    }
  };
  window.addEventListener('terma:language-changed', () => {
    quickServices.termaQuickLocalizationReady = refreshLocalization();
  });
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('modal');
    const panel = document.getElementById('quickPanel');
    const layer = document.querySelector<HTMLElement>('.sftp-automation-confirm-layer');
    const target = layer || (panel && !panel.hidden ? panel : modal && !modal.hidden && roots.has(modal) ? modal : null);
    if (!target || event.key !== 'Tab') return;
    const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.checkVisibility());
    const first = fields[0], last = fields.at(-1); if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }, true);
  const observer = new MutationObserver(() => {
    for (const root of roots) {
      if (!root.isConnected) { render(null, root); roots.delete(root); }
      else root.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export interface InstalledFeaturesQuickQuickMountServices {
  termaQuickViews?: QuickViews & { release: (target: HTMLElement, options?: QuickReleaseOptions) => void };
  termaQuickLocalizationReady?: Promise<void>;
}
