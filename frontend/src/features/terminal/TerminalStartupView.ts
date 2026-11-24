import { h, type VNode, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { managementContent, type ManagementModel } from '../remote/RemoteManagementView';
import type { RemoteComponentTask } from '../remote/component-task-service';

export interface TerminalStartupConfig {
  terminal_startup_mode: 'default' | 'program';
  terminal_profile_name: string;
  terminal_profile_kind: string;
  terminal_program_path: string;
  terminal_program_args: string;
  terminal_working_directory: string;
  terminal_program_platform: 'auto' | 'posix' | 'windows';
}

export interface TerminalStartupProfile {
  label?: string;
  name?: string;
  kind?: string;
  path?: string;
  args?: string;
  working_directory?: string;
  platform?: string;
  is_default?: boolean;
}

export interface TerminalStartupCapability {
  status: 'idle' | 'loading' | 'success' | 'warning';
  platform?: string;
  shell?: string;
  error?: string;
  headline?: string;
  detected?: string[];
  warnings?: string[];
}

export interface TerminalStartupSessionComponent {
  label?: string;
  installed?: boolean;
  version?: string;
  active_sessions?: number;
  terma_active_sessions?: number;
  install_plan?: Record<string, unknown>;
  uninstall_plan?: {available?: boolean};
}

export interface TerminalStartupSession {
  status: 'idle' | 'loading' | 'success' | 'warning';
  supported?: boolean;
  root?: boolean;
  components?: Record<string, TerminalStartupSessionComponent>;
  message?: string;
  model?(component: string): ManagementModel;
  tasks?: Record<string, RemoteComponentTask>;
}

export interface TerminalStartupOptions {
  key: string;
  connectionId: number;
  temporary: boolean;
  draft: TerminalStartupConfig;
  saved: TerminalStartupConfig;
  profiles: TerminalStartupProfile[];
  saveDefault: boolean;
  capability: TerminalStartupCapability;
  session: TerminalStartupSession;
  isMobile: boolean;
  busy?: boolean;
  refresh?: () => void;
  tr(key: string, params?: Record<string, unknown>): string;
  actions: {
    close(): void;
    restore(): void;
    detect(): Promise<void>;
    manageComponent?(component: string, action: string): Promise<void>;
    refreshComponents?(): Promise<void>;
    apply(target: 'current' | 'new' | 'split', splitZone: string, draft: TerminalStartupConfig, saveDefault: boolean): Promise<void>;
  };
}

const normalizeConfig = (value: Partial<TerminalStartupConfig>): TerminalStartupConfig => ({
  terminal_startup_mode: value.terminal_startup_mode === 'program' ? 'program' : 'default',
  terminal_profile_name: String(value.terminal_profile_name || ''),
  terminal_profile_kind: String(value.terminal_profile_kind || 'custom'),
  terminal_program_path: String(value.terminal_program_path || ''),
  terminal_program_args: String(value.terminal_program_args || ''),
  terminal_working_directory: String(value.terminal_working_directory || ''),
  terminal_program_platform: value.terminal_program_platform === 'posix' || value.terminal_program_platform === 'windows' ? value.terminal_program_platform : 'auto'
});

const profileLabel = (profile: TerminalStartupProfile | TerminalStartupConfig, tr: TerminalStartupOptions['tr']) => {
  if ('terminal_startup_mode' in profile) return profile.terminal_startup_mode === 'default' ? tr('terminal:startup.server_default_shell') : profile.terminal_profile_name || profile.terminal_program_path.split(/[\\\\/]/).pop() || tr('terminal:startup.custom_program');
  return profile.label || profile.name || profile.path || tr('terminal:startup.custom_program');
};

function startupField(options: TerminalStartupOptions, id: string, label: string, value: string, onInput: (value: string) => void, attrs: Record<string, unknown> = {}) {
  return h('label', { for: id }, [label, h('input', {
    id, value, ...attrs, disabled: options.busy,
    onInput: (event: Event) => onInput((event.target as HTMLInputElement).value)
  })]);
}

function capabilityView(options: TerminalStartupOptions): VNode {
  const { capability, tr } = options;
  const className = `terminal-startup-capability ${capability.status === 'idle' ? '' : capability.status}`;
  const detectedHeadline = capability.shell
    ? tr('terminal:startup.default_summary', {platform: capability.platform || tr('terminal:startup.remote_system'), shell: capability.shell})
    : capability.platform;
  const headline = capability.status === 'warning' && capability.error !== undefined
    ? tr('terminal:startup.detect_failed', {error: capability.error})
    : capability.status === 'loading'
      ? tr('terminal:startup.detecting')
      : detectedHeadline || capability.headline || tr('terminal:startup.waiting_detection');
  const children: VNodeChild[] = [h('strong', null, headline)];
  if (capability.detected?.length) children.push(h('span', null, tr('terminal:startup.detected_tools', { tools: capability.detected.join('、'), defaultValue: `已检测工具：${capability.detected.join('、')}` })));
  if (capability.warnings?.length) children.push(...capability.warnings.map(warning => h('span', { class: 'terminal-startup-capability-warning' }, warning)));
  return h('div', { id: 'terminalStartupCapabilitySummary', class: className }, children);
}

function sessionView(options: TerminalStartupOptions): VNode {
  const { session, tr } = options;
  if (session.status === 'loading') return h('div', { id: 'terminalSessionComponents', class: 'terminal-startup-capability loading' }, tr('terminal:session.detecting', { defaultValue: '正在检测 tmux 和 screen…' }));
  if (session.status === 'warning' || session.supported === false) return h('div', { id: 'terminalSessionComponents', class: 'terminal-startup-capability warning' }, [
    h('strong', null, tr('terminal:session.title', { defaultValue: '可恢复会话组件' })),
    h('span', null, session.status === 'warning'
      ? tr('terminal:session.detect_failed', {error: session.message || ''})
      : session.message || tr('terminal:session.unsupported', { defaultValue: '当前远端系统暂不支持自动管理 tmux/screen，请手动安装后再启用会话保活。' }))
  ]);
  const components = Object.entries(session.components || {});
  return h('div', { id: 'terminalSessionComponents', class: 'terminal-session-components' }, [
    h('div', { class: 'terminal-session-components-head' }, [
      h('strong', null, tr('terminal:session.title', { defaultValue: '可恢复会话组件' })),
      h('small', null, tr('terminal:session.install_hint', { defaultValue: '安装任务会显示在任务中心；没有可用方式时请按手动说明操作。' }))
    ]),
    components.length ? h('div', { class: 'terminal-session-component-list' }, components.map(([id, item]) => {
      const active = Math.max(0, Number(item.active_sessions) || 0);
      const termaActive = Math.max(0, Number(item.terma_active_sessions) || 0);
      const status = item.installed
        ? tr('terminal:session.installed', { version: item.version ? ` · ${item.version}` : '', defaultValue: `已安装${item.version ? ` · ${item.version}` : ''}` })
        : tr('terminal:session.not_installed', { defaultValue: '未安装' });
      const activity = active
        ? tr('terminal:session.active_sessions', { count: active, termaCount: termaActive, defaultValue: `活动会话 ${active} 个，其中 Terma ${termaActive} 个` })
        : tr('terminal:session.no_active_sessions', { defaultValue: '无活动会话' });
      return h('section', { class: 'terminal-session-component-row remote-management-view terma-remote-root', key: id, 'data-session-component': id }, [
        h('div', { class: 'terminal-session-component-head' }, [
          h('span', { class: 'terminal-session-component-icon', 'aria-hidden': 'true' }, icon(id === 'screen' ? 'panels-top-left' : 'square-terminal')),
          h('div', { class: 'terminal-session-component-copy' }, [
            h('div', { class: 'terminal-session-component-title' }, [h('b', null, ['tmux', 'screen'].includes(id) ? tr(`terminal:session.component_${id}`) : item.label || id), h('span', { class: `terminal-session-component-status ${item.installed ? 'installed' : 'missing'}` }, status)]),
            h('small', null, activity)
          ])
        ]),
        ...managementContent(session.model?.(id) || {})
      ]);
    })) : h('span', null, tr('terminal:session.no_components'))
  ]);
}

export function terminalStartupView(options: TerminalStartupOptions): VNode {
  const { tr } = options;
  const draft = options.draft;
  const closeText = tr('common:actions.close', { defaultValue: '关闭' });
  const savedLabel = tr('terminal:startup.saved_value', { profile: profileLabel(options.saved, tr) });
  const chooseProfile = (value: string) => {
    if (value === 'default') {
      Object.assign(draft, normalizeConfig({ terminal_startup_mode: 'default' }));
    } else if (value.startsWith('profile:')) {
      const profile = options.profiles[Number(value.slice(8))];
      if (profile) Object.assign(draft, normalizeConfig({ terminal_startup_mode: 'program', terminal_profile_name: profile.label || profile.name, terminal_profile_kind: profile.kind, terminal_program_path: profile.path, terminal_program_args: profile.args, terminal_working_directory: profile.working_directory, terminal_program_platform: profile.platform as TerminalStartupConfig['terminal_program_platform'] }));
    } else {
      draft.terminal_startup_mode = 'program';
    }
    options.refresh?.();
  };
  const setField = (field: keyof TerminalStartupConfig, value: string) => {
    draft[field] = value as never;
    if (field !== 'terminal_startup_mode') draft.terminal_startup_mode = 'program';
    options.refresh?.();
  };
  const button = (label: string, action: () => void, attrs: Record<string, unknown> = {}, glyph = '') => h(TermaButton, { type: 'button', ...attrs, disabled: Boolean(options.busy || attrs.disabled), onClick: action }, () => [glyph ? icon(glyph) : null, h('span', null, label)]);
  const groups = [
    ['shell', tr('terminal:startup.detected_shells', { defaultValue: '检测到的 Shell' })],
    ['repl', tr('terminal:startup.interactive_programs', { defaultValue: '交互式程序' })],
    ['session', tr('terminal:startup.session_tools', { defaultValue: '会话工具' })],
    ['tool', tr('terminal:startup.other_tools', { defaultValue: '其他可启动工具' })]
  ];
  const profileOptions: VNodeChild[] = [h('option', { value: 'default', selected: draft.terminal_startup_mode === 'default' }, tr('terminal:startup.default_option', { defaultValue: '自动（使用服务器默认登录 Shell）' }))];
  for (const [kind, label] of groups) {
    const profiles = options.profiles.map((profile, index) => ({ profile, index })).filter(item => item.profile.kind === kind);
    if (profiles.length) profileOptions.push(h('optgroup', { label }, profiles.map(({ profile, index }) => h('option', { value: `profile:${index}` }, `${profileLabel(profile, tr)}${profile.is_default ? tr('terminal:startup.default_suffix', { defaultValue: '（默认）' }) : ''}`))));
  }
  profileOptions.push(h('option', { value: 'custom', selected: draft.terminal_startup_mode === 'program' }, tr('terminal:startup.custom_option', { defaultValue: '自定义程序、Shell 或命令行工具' })));
  const profileValue = draft.terminal_startup_mode === 'default' ? 'default' : 'custom';
  return h('div', { class: 'modal-card wide terminal-startup-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'terminalStartupTitle', 'aria-busy': options.busy || options.capability.status === 'loading' ? 'true' : 'false' }, [
    h('div', { class: 'terminal-settings-head' }, [h('div', null, [h('h2', { id: 'terminalStartupTitle' }, tr('terminal:startup.title', { defaultValue: '终端配置' })), h('span', null, tr(options.temporary ? 'terminal:startup.temporary_subtitle' : 'terminal:startup.saved_subtitle', { defaultValue: options.temporary ? '当前标签正在使用临时配置' : '当前使用 SSH 连接中保存的默认配置' }))]), button('', options.actions.close, { id: 'terminalStartupClose', class: 'icon-button', title: closeText, 'aria-label': closeText }, 'x')]),
    h('div', { class: 'terminal-startup-scroll' }, [
      h('div', { class: 'terminal-startup-saved-row' }, [h('div', { class: 'terminal-startup-saved' }, savedLabel), options.temporary ? button(tr('terminal:startup.restore_saved', { defaultValue: '恢复连接保存值' }), options.actions.restore, { id: 'terminalStartupRestore' }, 'rotate-ccw') : null]),
      h('label', { for: 'terminalStartupProfile' }, [tr('terminal:startup.profile', { defaultValue: '启动配置' }), h('select', { id: 'terminalStartupProfile', disabled: options.busy, value: profileValue, onChange: (event: Event) => chooseProfile((event.target as HTMLSelectElement).value) }, profileOptions)]),
      h('div', { class: 'terminal-startup-capability-control' }, [capabilityView(options), button(tr('terminal:startup.detect_again', { defaultValue: '重新检测' }), () => void options.actions.detect(), { id: 'terminalStartupDetect', disabled: options.capability.status === 'loading' }, 'scan-search')]),
      sessionView(options),
      h('div', { id: 'terminalStartupProgramFields', class: 'terminal-startup-fields', hidden: draft.terminal_startup_mode === 'default' }, [
        h('input', { id: 'terminalStartupKind', type: 'hidden', value: draft.terminal_profile_kind }),
        h('div', { class: 'grid' }, [
          startupField(options, 'terminalStartupProfileName', tr('terminal:startup.profile_name', { defaultValue: '配置名称' }), draft.terminal_profile_name, value => setField('terminal_profile_name', value), { maxlength: 120, placeholder: tr('terminal:startup.profile_example', { defaultValue: '例如：Bash（登录模式）' }) }),
          h('label', { for: 'terminalStartupPlatform' }, [tr('terminal:startup.remote_type', { defaultValue: '远端类型' }), h('select', { id: 'terminalStartupPlatform', disabled: options.busy, value: draft.terminal_program_platform, onChange: (event: Event) => setField('terminal_program_platform', (event.target as HTMLSelectElement).value) }, [h('option', { value: 'auto' }, tr('terminal:startup.auto_detect', { defaultValue: '自动识别' })), h('option', { value: 'posix' }, 'Linux / macOS / Unix'), h('option', { value: 'windows' }, 'Windows OpenSSH')])])
        ]),
        startupField(options, 'terminalStartupPath', tr('terminal:startup.program_path', { defaultValue: '程序完整路径' }), draft.terminal_program_path, value => setField('terminal_program_path', value), { maxlength: 2048, spellcheck: false, placeholder: '/bin/bash, /usr/bin/python3, or C:\\Program Files\\PowerShell\\7\\pwsh.exe' }),
        startupField(options, 'terminalStartupArgs', tr('terminal:startup.startup_args', { defaultValue: '启动参数' }), draft.terminal_program_args, value => setField('terminal_program_args', value), { maxlength: 4096, spellcheck: false, placeholder: tr('terminal:startup.startup_args_hint', { defaultValue: '-l、-i 等；路径和参数请分开填写' }) }),
        startupField(options, 'terminalStartupCwd', tr('terminal:startup.working_directory', { defaultValue: '启动工作目录（可选）' }), draft.terminal_working_directory, value => setField('terminal_working_directory', value), { maxlength: 2048, spellcheck: false, placeholder: '/srv/app or C:\\work' }),
        h('div', { class: 'muted' }, tr('terminal:startup.secret_warning', { defaultValue: '参数支持引号分组。请勿在启动参数中填写密码、令牌或私钥。' }))
      ]),
      h('label', { class: 'terminal-startup-save-default', for: 'terminalStartupSaveDefault' }, [h('input', { id: 'terminalStartupSaveDefault', disabled: options.busy, type: 'checkbox', checked: options.saveDefault, onChange: (event: Event) => { options.saveDefault = (event.target as HTMLInputElement).checked; } }), h('span', null, [h('strong', null, tr('terminal:startup.save_default', { defaultValue: '同时保存为该 SSH 连接的默认配置' })), h('small', null, tr('terminal:startup.save_default_hint', { defaultValue: '默认不勾选；未勾选时只对这次打开的目标标签临时生效。' }))])])
    ]),
    h('div', { class: 'actions terminal-startup-actions' }, [
      button(tr('common:actions.cancel', { defaultValue: '取消' }), options.actions.close, { id: 'terminalStartupCancel' }),
      button(tr('terminal:startup.open_current', { defaultValue: '本终端打开' }), () => void options.actions.apply('current', '', draft, options.saveDefault), { id: 'terminalStartupCurrent', class: 'primary' }, 'refresh-cw'),
      button(tr('terminal:startup.open_new_tab', { defaultValue: '新标签打开' }), () => void options.actions.apply('new', '', draft, options.saveDefault), { id: 'terminalStartupNewTab' }, 'copy-plus'),
      !options.isMobile ? h('div', { class: 'terminal-startup-split-picker' }, [button(tr('terminal:startup.open_split', { defaultValue: '新标签分屏打开' }), () => undefined, { id: 'terminalStartupSplit', 'aria-haspopup': 'menu', title: tr('terminal:startup.split_picker', { defaultValue: '悬浮后选择上、下、左、右分屏' }) }, 'panels-top-left'), h('div', { class: 'terminal-startup-split-options', role: 'menu', 'aria-label': tr('terminal:startup.split_direction', { defaultValue: '选择新标签分屏方向' }) }, [h('span', { class: 'terminal-startup-split-center', 'aria-hidden': 'true' }, icon('panels-top-left')), ...[['top', 'arrow-up'], ['bottom', 'arrow-down'], ['left', 'arrow-left'], ['right', 'arrow-right']].map(([zone, glyph]) => button('', () => void options.actions.apply('split', zone, draft, options.saveDefault), { 'data-split-zone': zone, role: 'menuitem', title: tr(`terminal:startup.split_${zone}`, { defaultValue: `在${zone}分屏打开` }), 'aria-label': tr(`terminal:startup.split_${zone}`, { defaultValue: `在${zone}分屏打开` }) }, glyph))])]) : null
    ])
  ]);
}

