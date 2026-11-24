import {terminalServices} from '@/features/terminal/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout,keepTerminalKeyboardClosed} from '@/shared/browser-ui';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {handleTerminalSessionButton,changeTerminalFont} from '@/features/terminal/terminal-page';
import {terminalSessionConnectionStatus,toggleTerminalConnection} from '@/features/terminal/terminal-connection-runtime';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {showRecentTerminalCommands} from './terminal-text-dialogs';
import {terminalFontSizeForCurrentLayout} from '@/features/terminal/terminal-metadata';
import {terminalDisplayActions} from '@/features/terminal/terminal-display-actions';
import {terminalEncodingLabel,terminalConnectionStateLabel} from '@/features/terminal/terminal-metadata';
import { terminalStartupOverrides, effectiveTerminalStartupConfig } from '@/features/terminal/terminal-startup-state';
import { workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import type { ManagementConnection } from '../remote/management-types';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import type { TerminalStartupConfig } from './TerminalStartupView';
import type { TerminalToolbarModel } from './TerminalToolbarView';
import type { TerminalPreferences } from './terminal-preferences-service';
import type { TerminalSessionCoreSession } from './terminal-session-core-service';

type Connection = ManagementConnection & Partial<TerminalPreferences & TerminalStartupConfig> & {
  terminal_session_mode?: unknown;
  terminal_session_id?: unknown;
  x11_mode?: unknown;
};
type Session = Pick<TerminalSessionCoreSession, 'autoReconnectPending' | 'socket'> & {
  connection?: Connection | null;
  connected?: unknown;
};
type Tab = Pick<WorkspaceTab, 'key' | 'kind'> & {
  id?: unknown;
  sessionMode?: unknown;
  persistentSessionId?: unknown;
};
type Startup = Partial<TerminalStartupConfig> & { x11_mode?: unknown };

export interface TerminalToolbarActions {
  keepKeyboard(event: PointerEvent): unknown;
  sftp(id: number): unknown;
  remoteJump(event: MouseEvent, id: number): unknown;
  session(event: MouseEvent, key: string): unknown;
  fontSize(key: string, delta: number): unknown;
  encoding(event: MouseEvent, key: string, id: number): unknown;
  font(event: MouseEvent, key: string, id: number): unknown;
  startup(key: string, id: number): unknown;
  quickX11(event: MouseEvent, key: string): unknown;
  x11(event: MouseEvent, id: number, key: string): unknown;
  settings(key: string): unknown;
  keys(key: string): unknown;
  quickCommands(key: string): unknown;
  recent(key: string): unknown;
  connection(id: number, key: string): unknown;
  forwards(id: number): unknown;
}

export interface TerminalToolbarPort {
  session(key: string): Session | undefined;
  tab(key: string): Tab | undefined;
  connection(id: number): Connection | null;
  state(key: string, session: Session | undefined): unknown;
  stateLabel(state: string): string;
  mobile(): boolean;
  encoding(connection: Connection, key: string): string;
  startup(connection: Connection, key: string): Startup;
  startupLabel(startup: Startup): string;
  temporaryStartup(key: string): boolean;
  aiOpen(key: string): boolean;
  openState: number;
  quickCommandsVisible(): boolean;
  remoteProfiles(id: number): readonly { id?: unknown }[];
  localFiles(): boolean;
  fontSize(connection: Connection): number;
  keysVisible(): boolean;
  tr(key: string, params?: Record<string, unknown>): string;
  actions: TerminalToolbarActions;
}

export function createTerminalToolbarService(port: TerminalToolbarPort) {
  const tr = (key: string, params?: Record<string, unknown>) => port.tr(key, params);
  const states = new Map<string, string>();

  function model(key: string): TerminalToolbarModel | null {
    const tabKey = String(key || '');
    const session = port.session(tabKey);
    const tab = port.tab(tabKey);
    const connection = session?.connection || port.connection(Number(tab?.id || 0));
    if (!connection) return null;

    const quick = Boolean(connection.quick_connection || tab?.kind === 'quick-terminal');
    const rawState = states.get(tabKey) || port.state(tabKey, session);
    const state = typeof rawState === 'string' && ['connected', 'reconnecting', 'disconnected', 'authentication', 'authorization'].includes(rawState) ? rawState : 'connecting';
    const connectionState = state === 'connected' ? 'connected' : state === 'disconnected' ? 'disconnected' : 'connecting';
    const stateLabel = port.stateLabel(state);
    const address = `${connection.ssh_user || ''}@${connection.ssh_host || ''}:${connection.ssh_port || 22}`;
    const sessionEnabled = !quick
      && String(tab?.sessionMode || connection.terminal_session_mode || 'none') === 'persistent'
      && Boolean(String(tab?.persistentSessionId || connection.terminal_session_id || '').trim());
    const shellMode = quick ? 'temporary' : sessionEnabled ? 'persistent' : 'normal';
    const shellLabel = tr(`terminal:toolbar.shell_${shellMode}`, { defaultValue: { temporary: '临时 Shell', persistent: '保活 Shell', normal: '普通 Shell' }[shellMode] });
    const sessionTitle = tr(sessionEnabled ? 'terminal:toolbar.session_enabled' : 'terminal:toolbar.session_disabled', { defaultValue: sessionEnabled ? '可恢复会话' : '启用可恢复会话' });
    const encoding = port.encoding(connection, tabKey);
    const startup = port.startup(connection, tabKey);
    const startupLabel = port.startupLabel(startup);
    const startupTemporary = port.temporaryStartup(tabKey);
    const temporarySuffix = startupTemporary ? tr('terminal:startup.temporary_suffix', { defaultValue: '（仅当前标签）' }) : '';
    const x11Mode = String(startup?.x11_mode || connection.x11_mode || 'off');
    const x11ModeLabel = x11Mode === 'trusted'
      ? tr('common:auto.trusted_x11', { defaultValue: '可信 X11' })
      : x11Mode === 'untrusted'
        ? tr('common:auto.untrusted_x11', { defaultValue: '受限 X11' })
        : tr('common:auto.x11_disabled', { defaultValue: '关闭 X11' });
    const aiOpen = Boolean(port.aiOpen(tabKey));
    const reconnecting = state === 'reconnecting' || Boolean(session?.autoReconnectPending);
    const connecting = reconnecting || ['connecting', 'authentication', 'authorization'].includes(state);
    const connected = state === 'connected' || Boolean(session?.connected && session.socket?.readyState === port.openState);
    const quickCommandsVisible = port.quickCommandsVisible();
    const remoteProfiles = !quick ? port.remoteProfiles(connection.id) : [];

    return {
      key: tabKey,
      connectionId: Number(connection.id),
      quick,
      address,
      statusText: port.mobile() ? `${address} · ${stateLabel}` : '',
      statusTitle: `${address} · ${stateLabel}`,
      connectionStatusCode: state,
      connectionState,
      shellMode,
      sessionEnabled,
      sessionTitle,
      sessionLabel: tr('terminal:toolbar.session_short', { defaultValue: '会话' }),
      shellLabel,
      temporaryLabel: tr('terminal:toolbar.temporary', { defaultValue: '临时' }),
      sftpTitle: tr('terminal:toolbar.open_sftp_manager', { defaultValue: '打开此连接的 SFTP 文件管理' }),
      hasLocalFiles: port.localFiles(),
      localFilesTitle: tr('navigation:auto.new_local_files_tab', { defaultValue: '新建本地文件标签' }),
      hasRemoteJump: Boolean(remoteProfiles.length),
      remoteJumpTitle: tr('remote:jump.open_title', { defaultValue: '打开此连接的远程桌面' }),
      remoteJumpProfileId: Number(remoteProfiles[0]?.id || 0),
      forwardListTitle: tr('terminal:toolbar.forward_list', { defaultValue: '转发列表' }),
      fontSize: port.fontSize(connection),
      fontSizeTitle: tr('terminal:toolbar.current_font_size', { defaultValue: '当前终端字号' }),
      decreaseFontTitle: tr('terminal:toolbar.decrease_font_hint', { defaultValue: '减小字体（Ctrl+滚轮）' }),
      increaseFontTitle: tr('terminal:toolbar.increase_font_hint', { defaultValue: '增大字体（Ctrl+滚轮）' }),
      encoding,
      encodingTitle: tr('terminal:toolbar.change_encoding', { encoding, defaultValue: `切换终端编码：${encoding}` }),
      encodingAriaLabel: tr('terminal:toolbar.change_encoding_short', { defaultValue: '切换终端编码' }),
      fontTitle: tr('terminal:toolbar.change_font', { defaultValue: '切换终端字体' }),
      fontLabel: tr('terminal:toolbar.font', { defaultValue: '字体' }),
      startupVisible: !quick,
      startupTitle: tr('terminal:startup.button_title', { profile: startupLabel, temporary: temporarySuffix, defaultValue: `终端配置：${startupLabel}${temporarySuffix}` }),
      startupLabel: tr('terminal:toolbar.config', { defaultValue: '配置' }),
      startupTemporary,
      x11Title: tr('terminal:x11_menu.current_mode', { mode: x11ModeLabel, defaultValue: `X11 图形转发：当前终端${x11ModeLabel}` }),
      x11Active: x11Mode === 'trusted' || x11Mode === 'untrusted',
      aiTitle: tr(aiOpen ? 'terminal:ai.close' : 'terminal:ai.open', { defaultValue: aiOpen ? '关闭终端 AI' : '打开终端 AI' }),
      aiOpen,
      globalSettingsTitle: tr('terminal:toolbar.global_settings', { defaultValue: '全局终端设置' }),
      keysVisible: Boolean(port.keysVisible()),
      keysTitle: tr(port.keysVisible() ? 'terminal:toolbar.hide_shortcuts' : 'terminal:toolbar.show_shortcuts', { defaultValue: port.keysVisible() ? '隐藏快捷键' : '显示快捷键' }),
      keysLabel: tr(port.keysVisible() ? 'terminal:toolbar.hide_shortcuts_short' : 'terminal:toolbar.shortcuts', { defaultValue: port.keysVisible() ? '隐藏快捷键' : '快捷键' }),
      quickCommandsVisible,
      quickCommandsTitle: tr(quickCommandsVisible ? 'terminal:quick_commands.hide' : 'terminal:quick_commands.show'),
      quickCommandsLabel: tr('terminal:quick_commands.toolbar'),
      recentTitle: tr('terminal:toolbar.recent_commands', { defaultValue: '最近命令' }),
      recentLabel: tr('terminal:toolbar.recent_commands', { defaultValue: '最近命令' }),
      forwardListLabel: tr('terminal:toolbar.forward_list', { defaultValue: '转发列表' }),
      connected,
      connecting,
      reconnecting,
      reconnectTitle: tr(reconnecting ? 'terminal:toolbar.reconnecting' : connecting ? 'terminal:toolbar.connecting' : connected ? 'terminal:toolbar.disconnect' : 'terminal:toolbar.reconnect', { defaultValue: reconnecting ? '正在重连' : connecting ? '正在连接' : connected ? '断开终端连接' : '重新连接终端' }),
      reconnectLabel: tr(reconnecting ? 'terminal:toolbar.reconnecting_short' : connecting ? 'terminal:toolbar.connecting_short' : connected ? 'terminal:toolbar.disconnect_short' : 'terminal:toolbar.reconnect_short', { defaultValue: reconnecting ? '重连中' : connecting ? '连接中' : connected ? '断开' : '重连' }),
      scrollOverflow: false,
      scrollCanLeft: false,
      scrollCanRight: false,
      scrollLeftTitle: tr('common:auto.scroll_left', { defaultValue: '向左滚动快捷按钮' }),
      scrollRightTitle: tr('common:auto.scroll_right', { defaultValue: '向右滚动快捷按钮' })
    };
  }

  return {
    model, actions: port.actions,
    status: {
      set: (key: string, state: string) => { states.set(key, state); },
      get: (key: string) => states.get(key),
      release: (key: string) => { states.delete(key); }
    }
  };
}



export function installTerminalToolbarService() {
  if (terminalServices.termaTerminalToolbarService) return terminalServices.termaTerminalToolbarService;
  return terminalServices.termaTerminalToolbarService = createTerminalToolbarService({
    session: key => terminalSessions.get(key),
    tab: key => workspaceTabByKey(key) || undefined,
    connection: id => currentConnection(id)??null,
    state: (key, session) => [...document.querySelectorAll<HTMLElement>('.terminal-toolbar')]
      .find(element => element.dataset.workspaceTabKey === key || element.dataset.terminalTabKey === key)
      ?.querySelector<HTMLElement>('#terminalStatus')?.dataset.connectionState
      || terminalSessionConnectionStatus(session),
    stateLabel: state => terminalConnectionStateLabel(state),
    mobile: () => isMobileLayout(),
    encoding: (connection, key) => terminalEncodingLabel(connection, key),
    startup: (connection, key) => effectiveTerminalStartupConfig(connection, key),
    startupLabel: startup => terminalServices.termaTerminalStartup!.label(startup),
    temporaryStartup: key => terminalStartupOverrides.has(key),
    aiOpen: key => Boolean(assistantServices.termaAssistant.service.state(key).open),
    get openState() { return WebSocket.OPEN; },
    quickCommandsVisible: () => efficiencyServices.termaEfficiency?.quick.visible() ?? false,
    remoteProfiles: id => remoteServices.termaRemoteDesktop.relations.desktopsForSsh(id),
    localFiles: () => true,
    fontSize: connection => terminalFontSizeForCurrentLayout(connection),
    keysVisible: () => applicationState.terminalKeysVisible,
    tr: (key, params) => tr(key, params),
    actions: {
      keepKeyboard: event => keepTerminalKeyboardClosed(event),
      sftp: id => filesServices.termaSftpPage.open(id),
      remoteJump: (event, id) => remoteServices.termaRemoteDesktop.relations.jumpFromSsh(event, id),
      session: (event, key) => handleTerminalSessionButton(event, key),
      fontSize: (key, delta) => changeTerminalFont(key, delta),
      encoding: (event, key, id) => terminalDisplayActions.encoding(event, key, id),
      font: (event, key, id) => terminalDisplayActions.font(event, key, id),
      startup: (key, id) => terminalServices.termaTerminalStartup?.open(key, id),
      quickX11: (event, key) => x11Services.termaX11TerminalMenu?.openQuick(event, key),
      x11: (event, id, key) => x11Services.termaX11TerminalMenu?.open(event, id, key),
      settings: key => terminalServices.termaTerminalSettings?.open(key),
      keys: key => terminalServices.termaTerminalKeysService?.toggle(key),
      quickCommands: key => efficiencyServices.termaEfficiency.quick.toggle(key),
      recent: key => showRecentTerminalCommands(key),
      connection: (id, key) => toggleTerminalConnection(id, key),
      forwards: id => forwardsServices.termaForwardWorkspace.openConnection(id)
    }
  });
}

export interface InstalledFeaturesTerminalTerminalToolbarServiceServices {
  termaTerminalToolbarService?: ReturnType<typeof createTerminalToolbarService>;
}
