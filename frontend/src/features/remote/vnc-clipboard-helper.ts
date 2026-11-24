import { errorMessage, request, type Api, type Translate } from '../operations/operations-types';
import type { ClipboardHelperOptions, ClipboardResult, ClipboardTextOptions } from './VncClipboardDialog';
import type { ManagementModel, ManagementAction } from './RemoteManagementView';
import type { createRemoteInstallGuideService } from './install-guide-service';
import type { RemoteComponentTask } from './component-task-service';
import { connectionStamp, type ManagementConnection } from './management-types';
import { normalizeRelatedHost } from './profile-relations';
import type { RemoteProfile } from './profile-model';
import { usesSshClipboard } from './vnc-clipboard-model';
import type { VncSession } from './vnc-types';

interface Connection extends ManagementConnection { favorite?: boolean }
interface UninstallPlan { available?: boolean; reason?: unknown; package_names?: string[] }
interface HelperDiagnostics {
  available?: boolean;
  platform?: string;
  root?: boolean;
  transport?: string;
  connection_id?: number;
  connection_name?: string;
  tool?: string;
  resolved_by?: string;
  reason?: unknown;
  install_plan?: Record<string, unknown> & { uninstall?: UninstallPlan };
  uninstall_plan?: UninstallPlan;
  guide?: { steps?: unknown[]; commands?: string[]; summary?: unknown };
}
interface HelperTask extends RemoteComponentTask { after?: HelperDiagnostics }
interface HelperResponse {
  task?: HelperTask;
  before?: HelperDiagnostics;
  after?: HelperDiagnostics;
  task_conflict?: boolean;
  conflict_same_action?: boolean;
  error?: unknown;
}
interface DialogState {
  selected: number;
  loading: boolean;
  generation: number;
  diagnostics?: HelperDiagnostics;
  error?: unknown;
  options: ClipboardHelperOptions;
  current(): boolean;
}

export interface VncClipboardHelperHost {
  api: Api;
  tr: Translate;
  notify(message: string, kind: 'error' | 'info' | 'success'): void;
  localize(value: unknown): string;
  connections(): Connection[];
  profile(id: number): RemoteProfile | undefined;
  authenticationFailure(error: unknown): boolean;
  repair(id: number, context: string, saved: () => Promise<unknown>): Promise<unknown>;
  action(id: string, title: string, icon: string, run: (button: HTMLElement) => void, key?: string, className?: string): ManagementAction;
  begin(key: string, button: HTMLElement, label: string): boolean;
  end(key: string, button: HTMLElement): void;
  taskRequested(result: HelperResponse, label: string, queued: string): boolean;
}
interface HelperPort extends VncClipboardHelperHost {
  current(session: VncSession): () => boolean;
  session(key: string): VncSession | undefined;
  focus(session: VncSession): void;
  status(session: VncSession, text?: string, state?: string, duration?: number): void;
  prompt(options: ClipboardHelperOptions): Promise<ClipboardResult>;
  refresh(options: ClipboardHelperOptions): void;
  finish(options: ClipboardHelperOptions, value: ClipboardResult): void;
  promptText(options: ClipboardTextOptions): Promise<string | null>;
  guides(): Pick<ReturnType<typeof createRemoteInstallGuideService>, 'install' | 'manual'>;
  confirm(packageLabel: string): Promise<boolean>;
  authorize(id: number, label: string, scope: string, valid: () => boolean): Promise<{admin_grant_id: string} | null>;
  watch(task: HelperTask): Promise<HelperTask>;
  taskError(task: HelperTask): string;
  reset(session: VncSession): void;
  transport(session: VncSession): Promise<string>;
  send(session: VncSession, value: string, announce: boolean): Promise<boolean>;
  start(session: VncSession): void;
  stop(session: VncSession): void;
}

function matchingVncClipboardConnections(profile: RemoteProfile, connections: Connection[]) {
  const host = normalizeRelatedHost(profile.host);
  if (!host) return [];
  const user = String(profile.username || '').trim().toLowerCase();
  const preferred = (connection: Connection) => Number(Boolean(user && connection.ssh_user?.trim().toLowerCase() === user));
  return connections.filter(connection => normalizeRelatedHost(connection.ssh_host) === host)
    .sort((left, right) => preferred(right) - preferred(left) || Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
      || left.id - right.id);
}

function selectedSource(profile: RemoteProfile) {
  return Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0);
}

export function createVncClipboardHelper(port: HelperPort) {
  const dialogs = new WeakMap<VncSession, DialogState>();
  const t = (key: string, params?: Record<string, unknown>) => port.tr(`remote:clipboard.${key}`, params);
  const matches = (profile: RemoteProfile) => matchingVncClipboardConnections(profile, port.connections());
  const candidate = (session: VncSession) => selectedSource(session.profile) > 0 || matches(session.profile).length > 0;
  const actionKey = (session: VncSession) => `vnc-clipboard-helper:${session.profile.id}`;
  const actions = {operate};
  const helperPath = (session: VncSession) => `/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`;
  const post = <T>(session: VncSession, action: string, connectionId: number, admin?: {admin_grant_id: string} | null) =>
    request<T>(port.api, helperPath(session), {method:'POST', body:JSON.stringify({
      action, connection_id: connectionId, ...(admin ? {admin_auth: admin} : {})
    })});

  function fail(session: VncSession, message: string) {
    session.clipboardBridgeError = message;
    port.status(session, t('helper_unavailable'), 'error');
    port.notify(message, 'error');
  }

  function showDiagnostics(state: DialogState, diagnostics: HelperDiagnostics) {
    state.loading = false;
    state.diagnostics = diagnostics;
    port.refresh(state.options);
  }

  async function inspect(session: VncSession) {
    const state = dialogs.get(session);
    if (!state?.current()) return;
    const version = ++state.generation;
    const selection = state.selected;
    const ownsResponse = () => state.current() && state.generation === version;
    state.loading = true;
    state.error = undefined;
    state.diagnostics = undefined;
    port.refresh(state.options);
    try {
      const diagnostics = await post<HelperDiagnostics>(session, 'guide', selection);
      if (!ownsResponse()) return;
      if (selection && diagnostics.connection_id && diagnostics.connection_id !== selection) throw Error(t('probe_failed'));
      showDiagnostics(state, diagnostics);
    } catch (error) {
      if (!ownsResponse()) return;
      state.loading = false;
      state.error = error;
      port.refresh(state.options);
    }
  }

  function diagnosticModel(session: VncSession, state: DialogState): ManagementModel {
    if (state.loading) return {loading: t('detecting_helper')};
    const detect = port.action('detect-again', t('detect_again'), 'refresh-cw', () => {void inspect(session);});
    if (state.error) {
      const actions = [detect];
      if (state.selected > 0 && port.authenticationFailure(state.error)) {
        actions.push(port.action('repair-credentials', t('repair_ssh_credentials'), 'key-round', () => {
          if (state.current()) void port.repair(state.selected, t('auth_failed'), () => configure(session.key));
        }));
      }
      return {notices: [{title:t('helper_unavailable'), detail:port.localize(errorMessage(state.error, '')) || t('probe_failed'),
        tone:'error', icon:'circle-alert', actions}]};
    }
    const d = state.diagnostics;
    if (!d) return {};
    const platform = d.platform?.toLowerCase(), available = Boolean(d.available), plan = d.install_plan || {};
    const name = platform === 'macos' ? 'macOS' : platform === 'linux' ? 'Linux' : t('unknown_platform');
    const detail = available ? t(platform === 'macos' ? 'macos_builtin' : 'unicode_channel_ready')
      : port.localize(d.reason) || t(platform === 'macos' ? 'macos_check_session'
        : platform === 'linux' ? 'install_matching_tool' : 'confirm_remote_system');
    const model: ManagementModel = {
      head: {title: available ? t('available_title', {platform: name, tool: d.tool ? ` · ${d.tool}` : ''})
        : t('unavailable_title', {platform: name}), detail: d.connection_name || session.profile.host || '',
        icon: available ? 'circle-check' : 'circle-alert', tone: available ? 'ready' : 'warning'},
      actions: [detect], notices: [{detail, tone: available ? 'success' : 'warning', icon: available ? 'circle-check' : 'info'}],
      manual: port.guides().manual(plan, {steps: d.guide?.steps, commands: d.guide?.commands,
        note: port.localize(d.guide?.summary) || t('return_detect')})
    };
    const key = actionKey(session);
    if (platform === 'linux' && !available) model.install = port.guides().install(plan,
      (mode, button) => {void actions.operate(session.key, mode, button);}, undefined, key);
    if (platform === 'linux' && available && (d.uninstall_plan || plan.uninstall)?.available) {
      model.actions!.push(port.action('uninstall', t('uninstall_helper'), 'package-minus',
        button => {void actions.operate(session.key, 'uninstall', button);}, key, 'danger'));
    }
    return model;
  }

  function dialogModel(session: VncSession, state: DialogState): ReturnType<ClipboardHelperOptions['model']> {
    const profile = session.profile;
    const matching = matches(profile);
    const first = matching[0];
    const host = normalizeRelatedHost(profile.host);
    return {
      title:t('helper_title'), endpoint:`${profile.name} · ${profile.host}`, close:t('close'), cancel:t('cancel'), save:t('save_detect'),
      explanation:t('protocol_explanation'), matched:Boolean(first),
      match:first ? t('matches_found', {count:matching.length, name:first.name || first.ssh_host}) : t('no_match'),
      label:t('ssh_connection'), hint:t('platform_tools_hint'), selected:state.selected,
      connections:[{value:0, label:t('match_same_host')}, ...port.connections().map(connection => ({
        value: connection.id, label: t('connection_option', {name:connection.name, user:connection.ssh_user,
          host:connection.ssh_host, port:connection.ssh_port || 22,
          sameHost:normalizeRelatedHost(connection.ssh_host) === host ? t('same_host_suffix') : ''})
      }))], diagnostic: diagnosticModel(session, state)
    };
  }

  function open(session: VncSession) {
    const owned = port.current(session);
    const options: ClipboardHelperOptions = {
      model: () => dialogModel(session, state),
      select(value) {
        if (!state.current()) return;
        state.selected = value;
        void inspect(session);
      },
      dismissed() { if (dialogs.get(session) === state) dialogs.delete(session); }
    };
    const state: DialogState = {
      selected:selectedSource(session.profile) || matches(session.profile)[0]?.id || 0,
      loading:true, generation:0, options, current:() => owned() && dialogs.get(session) === state
    };
    const result = port.prompt(options);
    dialogs.set(session, state);
    void inspect(session);
    return result.finally(() => { if (dialogs.get(session) === state) dialogs.delete(session); });
  }

  async function persist(session: VncSession, id: number, current: () => boolean) {
    const profile = session.profile;
    const options = {...profile.options};
    delete options.ssh_connection_id;
    if (id > 0) options.source_ssh_connection_id = id;
    else delete options.source_ssh_connection_id;
    const saved = await request<RemoteProfile>(port.api, `/api/remote-profiles/${profile.id}`, {method:'PUT', body:JSON.stringify({options})});
    if (!current()) return false;
    if (saved.id !== profile.id || saved.protocol !== 'vnc') throw Error(t('setup_failed'));
    profile.options = saved.options || options;
    const stored = port.profile(Number(profile.id));
    if (stored && stored !== profile) stored.options = {...profile.options};
    return true;
  }

  async function configure(key: string) {
    const session = port.session(key);
    if (!session) return port.notify(t('session_missing'), 'error');
    let current = port.current(session);
    try {
      const id = await open(session);
      if (typeof id !== 'number' || !current()) return;
      if (id > 0 && !matches(session.profile).some(connection => connection.id === id)) {
        return fail(session, t('selected_ssh_unavailable'));
      }
      if (!await persist(session, id, current)) return;
      current = port.current(session);
      port.reset(session);
      const transport = await port.transport(session);
      if (!current()) return;
      if (!usesSshClipboard(transport)) return fail(session, port.localize(session.clipboardBridgeError) || t('selected_ssh_unavailable'));
      port.status(session, t('helper_enabled'), 'success', 2600);
      port.notify(t('unicode_helper_enabled_via', {connection:session.clipboardBridgeConnectionName || t('selected_ssh')}), 'success');
      const pending = session.clipboardPendingUnicodeText;
      session.clipboardPendingUnicodeText = undefined;
      if (pending !== undefined) await port.send(session, pending, true);
      if (current() && session.clipboardAutoSync) port.start(session);
    } catch (error) {
      if (current()) fail(session, errorMessage(error, t('setup_failed')));
    } finally {
      if (current()) port.focus(session);
    }
  }

  async function verify(session: VncSession, uninstall: boolean, current: () => boolean) {
    if (!current()) return;
    port.reset(session);
    const transport = await port.transport(session);
    if (!current()) return;
    if (usesSshClipboard(transport) === uninstall) {
      throw Error(uninstall ? t('uninstall_still_detected')
        : port.localize(session.clipboardBridgeError) || t('install_session_unavailable'));
    }
    port.status(session, t(uninstall ? 'helper_uninstalled' : 'helper_enabled'), 'success', 2600);
    port.notify(t(uninstall ? 'uninstall_verified' : 'install_verified'), 'success');
  }

  async function operate(key: string, mode: string, button: HTMLElement) {
    const session = port.session(key);
    if (!session) return port.notify(t('session_missing'), 'error');
    const state = dialogs.get(session), diagnostics = state?.diagnostics;
    if (!state?.current() || diagnostics?.platform?.toLowerCase() !== 'linux') return;
    if (!['online', 'offline', 'local-offline', 'uninstall'].includes(mode)) return;
    const uninstall = mode === 'uninstall', plan = diagnostics.uninstall_plan || diagnostics.install_plan?.uninstall;
    if (uninstall && (!diagnostics.available || !plan?.available)) {
      return port.notify(port.localize(plan?.reason) || t('no_safe_uninstall'), 'error');
    }
    const action = uninstall ? 'uninstall' : mode === 'local-offline' ? 'install-local-offline' : mode === 'offline' ? 'install-offline' : 'install';
    const viewLabel = port.tr(`remote:vnc_ui.${mode === 'local-offline' ? 'mode_local_offline' : mode === 'offline' ? 'mode_remote_cache' : 'mode_online'}`);
    const source = state.selected || Number(diagnostics.connection_id || 0);
    const connection = port.connections().find(item => item.id === source);
    if (!connection || normalizeRelatedHost(connection.ssh_host) !== normalizeRelatedHost(session.profile.host)) {
      return port.notify(t('selected_ssh_unavailable'), 'error');
    }
    const connectionIdentity = connectionStamp(connection);
    const sourceCurrent = () => {
      const paired = port.connections().find(item => item.id === source);
      return Boolean(paired && connectionStamp(paired) === connectionIdentity);
    };
    const keyForAction = actionKey(session);
    if (!port.begin(keyForAction, button, t(uninstall ? 'uninstalling' : 'installing'))) {
      return port.notify(t('task_running'), 'info');
    }
    let current = port.current(session), paused = false;
    const valid = () => current() && sourceCurrent();
    port.finish(state.options, {installing:true});
    try {
      const packageLabel = plan?.package_names?.join('、') || diagnostics.tool || t('helper_package');
      if (uninstall && !await port.confirm(packageLabel)) return;
      if (!valid()) return;
      const label = t(uninstall ? 'uninstall_unicode_action' : 'install_unicode_action', {mode:viewLabel});
      const admin = diagnostics.root ? null : await port.authorize(source, label, `vnc.clipboard-helper.${action}`, valid);
      if ((!diagnostics.root && !admin) || !valid() || !await persist(session, state.selected, valid)) return;
      current = port.current(session);
      if (!valid()) return;
      const result = await post<HelperResponse>(session, action, source, admin);
      if (!valid()) return;
      port.stop(session);
      port.reset(session);
      paused = true;
      let resolvedUninstall = uninstall;
      if (result.task) {
        resolvedUninstall = (result.task.action || action) === 'uninstall';
        port.status(session, t(resolvedUninstall ? 'helper_uninstalling' : 'helper_installing'), 'active');
        port.taskRequested(result, t(uninstall ? 'uninstall_helper_action' : 'install_helper_action', {mode:viewLabel}),
          t(uninstall ? 'uninstall_added' : 'install_added', {mode:viewLabel}));
        const finished = await port.watch(result.task);
        if (!valid()) return;
        if (finished.status !== 'done') {
          throw Error(port.taskError(finished) || t('task_failed', {action:t(resolvedUninstall ? 'uninstall' : 'install')}));
        }
      }
      await verify(session, resolvedUninstall, valid);
    } catch (error) {
      if (current()) fail(session, errorMessage(error, t(uninstall ? 'uninstall_failed' : 'install_failed')));
    } finally {
      if (paused && current() && session.clipboardAutoSync) port.start(session);
      port.end(keyForAction, button);
    }
  }

  function promptText(session: VncSession, reason: unknown = '') {
    return port.promptText({value:'', model:() => ({title:t('send_to', {name:session.profile.name || 'VNC'}),
      reason:port.localize(reason), label:t('text_to_send'), placeholder:t('manual_paste_placeholder'),
      notice:t('session_only_notice'), cancel:t('cancel'), send:t('send')})});
  }

  function release(session: VncSession) {
    const state = dialogs.get(session);
    if (state) port.finish(state.options, null);
  }

  return Object.assign(actions, {candidate, configure, promptText, inspect, release});
}
