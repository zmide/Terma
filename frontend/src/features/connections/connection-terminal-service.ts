import {connectionsServices} from '@/features/connections/installed-services';
import {tr,registerTermaI18nRenderer} from '@/shared/i18n/workspace-bootstrap';
import {$} from '@/shared/workspace-dom';
import {workspacePaneNodes} from '@/features/workspace/workspace-dock-state';
import {refreshExtraArgsLanguage} from './connection-validation-view';
import { connectionGroupDisplayName } from '@/shared/connection-group';

export type ConnectionTerminalKind = 'shell' | 'repl' | 'session' | 'tool' | 'custom';
export type ConnectionTerminalPlatform = 'windows' | 'posix' | 'auto';

export type ConnectionTerminalProfile = {
  label: string;
  name: string;
  path: string;
  args: string;
  kind: ConnectionTerminalKind;
  platform: ConnectionTerminalPlatform;
  working_directory: string;
  [key: string]: unknown;
};

export type ConnectionTerminalTool = {
  label: string;
  path: string;
  version: string;
};

export type ConnectionTerminalCapabilities = {
  platform: string;
  platform_label: string;
  default_shell: { name: string; label: string; path: string } | null;
  profiles: ConnectionTerminalProfile[];
  tools: ConnectionTerminalTool[];
  warnings: string[];
};

export type ConnectionTerminalFormConfig = {
  terminal_startup_mode: 'default' | 'program';
  terminal_profile_name: string;
  terminal_profile_kind: ConnectionTerminalKind;
  terminal_program_path: string;
  terminal_program_args: string;
  terminal_working_directory: string;
  terminal_program_platform: ConnectionTerminalPlatform;
};

type ConnectionTerminalForm = HTMLFormElement & {
  _terminalCapabilities?: ConnectionTerminalCapabilities | null;
  _terminalCapabilitiesChecked?: boolean;
  _terminalProbeStale?: boolean;
  _terminalCredentialRevision?: number;
};

type ConnectionTerminalConnection = Partial<ConnectionTerminalFormConfig> & Record<string, unknown>;
type TranslationOptions = Record<string, unknown> & { defaultValue?: string };

const PROFILE_GROUPS: Array<[ConnectionTerminalKind, string, string]> = [
  ['shell', 'terminal:startup.group_shell', 'Shell'],
  ['repl', 'terminal:startup.group_repl', '交互式语言'],
  ['session', 'terminal:startup.group_session', '会话工具'],
  ['tool', 'terminal:startup.group_tool', '交互工具'],
  ['custom', 'terminal:startup.group_custom', '其他']
];

const translate=(key:string,options:TranslationOptions={})=>tr(key,options);
const elementById=$;

export function setLocalizedText(element: HTMLElement | null, key: string, options: TranslationOptions = {}) {
  if (!element) return;
  (element as HTMLElement & {_connectionTranslation?: {key: string; options: TranslationOptions}})._connectionTranslation = {key, options};
  element.textContent = translate(key, options);
}

function field(form: ConnectionTerminalForm | null | undefined, id: string) {
  if (form?.querySelector) return form.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  return elementById(id);
}

function normalizeKind(value: unknown): ConnectionTerminalKind {
  const kind = String(value || '').toLowerCase();
  return PROFILE_GROUPS.some(([candidate]) => candidate === kind) ? kind as ConnectionTerminalKind : 'custom';
}

function normalizePlatform(value: unknown): ConnectionTerminalPlatform {
  const platform = String(value || '').toLowerCase();
  if (['windows', 'win32', 'win'].includes(platform)) return 'windows';
  if (['posix', 'linux', 'darwin', 'macos', 'unix', 'freebsd'].includes(platform)) return 'posix';
  return 'auto';
}

function terminalArgs(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item ?? '')).filter(Boolean).join(' ');
  return String(value ?? '');
}

function profilePath(profile: Record<string, unknown> | null | undefined) {
  return String(profile?.path ?? profile?.program_path ?? profile?.executable ?? profile?.command ?? '');
}

export function formConfig(form: ConnectionTerminalForm | null = elementById('connectionForm') as ConnectionTerminalForm | null): ConnectionTerminalFormConfig {
  const value = (id: string) => field(form, id) as HTMLInputElement | HTMLSelectElement | null;
  return {
    terminal_startup_mode: value('conn_terminal_startup_mode')?.value === 'program' ? 'program' : 'default',
    terminal_profile_name: value('conn_terminal_profile_name')?.value.trim() || '',
    terminal_profile_kind: normalizeKind(value('conn_terminal_profile_kind')?.value),
    terminal_program_path: value('conn_terminal_program_path')?.value.trim() || '',
    terminal_program_args: value('conn_terminal_program_args')?.value.trim() || '',
    terminal_working_directory: value('conn_terminal_working_directory')?.value.trim() || '',
    terminal_program_platform: normalizePlatform(value('conn_terminal_program_platform')?.value)
  };
}

function toggleStartup(form: ConnectionTerminalForm | null = elementById('connectionForm') as ConnectionTerminalForm | null) {
  const value = (id: string) => field(form, id) as HTMLInputElement | HTMLSelectElement | null;
  const program = value('conn_terminal_startup_mode')?.value === 'program';
  const box = field(form, 'connTerminalProgramFields');
  const path = value('conn_terminal_program_path');
  const profileSelect = value('conn_terminal_profile_select') as HTMLSelectElement | null;
  if (box) {
    box.hidden = !program;
    box.setAttribute('aria-hidden', String(!program));
  }
  if (path) path.required = program;
  if (!profileSelect) return;
  if (program && (profileSelect.value === '' || profileSelect.value === '__default__')) {
    if ([...profileSelect.options].some(option => option.value === '__custom__')) {
      profileSelect.value = '__custom__';
      const profileName = value('conn_terminal_profile_name');
      if (profileName && !profileName.value.trim()) profileName.value = translate('terminal:startup.custom_program', {defaultValue: '自定义程序'});
      const profileKind = value('conn_terminal_profile_kind');
      if (profileKind) profileKind.value = 'custom';
    }
  } else if (!program && [...profileSelect.options].some(option => option.value === '__default__')) {
    profileSelect.value = '__default__';
  }
}

function resetProfileSelect(form: ConnectionTerminalForm | null, saved = false) {
  const select = field(form, 'conn_terminal_profile_select') as HTMLSelectElement | null;
  if (!select) return;
  const config = formConfig(form);
  select.replaceChildren();
  if (saved && config.terminal_startup_mode === 'program' && config.terminal_program_path) {
    select.add(new Option(
      translate('terminal:startup.saved_option', {
        name: config.terminal_profile_name || config.terminal_program_path,
        defaultValue: `当前已保存：${config.terminal_profile_name || config.terminal_program_path}`
      }),
      '__current__',
      true,
      true
    ));
  } else {
    select.add(new Option(
      translate('terminal:startup.test_ssh_hint', {defaultValue: '测试 SSH 后显示可用选项'}),
      '',
      true,
      true
    ));
  }
  select.add(new Option(translate('terminal:startup.custom_program_option', {defaultValue: '自定义程序...'}), '__custom__'));
}

export function resetStartup(form: ConnectionTerminalForm | null = elementById('connectionForm') as ConnectionTerminalForm | null) {
  const value = (id: string) => field(form, id) as HTMLInputElement | HTMLSelectElement | null;
  if (!value('conn_terminal_startup_mode')) return;
  value('conn_terminal_startup_mode')!.value = 'default';
  value('conn_terminal_profile_name')!.value = '';
  value('conn_terminal_profile_kind')!.value = 'shell';
  value('conn_terminal_program_path')!.value = '';
  value('conn_terminal_program_args')!.value = '';
  value('conn_terminal_working_directory')!.value = '';
  value('conn_terminal_program_platform')!.value = 'auto';
  resetProfileSelect(form);
  const status = field(form, 'connTerminalDetectionStatus');
  if (status) {
    status.className = 'terminal-startup-detection muted';
    setLocalizedText(status, 'terminal:startup.not_detected', {defaultValue: '尚未检测。填写连接信息后点击“测试 SSH”。'});
  }
  const summary = field(form, 'connTerminalCapabilities');
  if (summary) {
    summary.hidden = true;
    summary.className = 'terminal-startup-capabilities';
    summary.replaceChildren();
  }
  form!._terminalCapabilities = null;
  form!._terminalCapabilitiesChecked = false;
  form!._terminalProbeStale = false;
  form!._terminalCredentialRevision = (form!._terminalCredentialRevision ?? 0) + 1;
  toggleStartup(form);
}

export function fillStartup(form: ConnectionTerminalForm | null, connection: ConnectionTerminalConnection = {}) {
  const value = (id: string) => field(form, id) as HTMLInputElement | HTMLSelectElement | null;
  if (!value('conn_terminal_startup_mode')) return;
  const mode = connection.terminal_startup_mode === 'program' || connection.terminal_program_path ? 'program' : 'default';
  value('conn_terminal_startup_mode')!.value = mode;
  value('conn_terminal_profile_name')!.value = String(connection.terminal_profile_name || '');
  value('conn_terminal_profile_kind')!.value = normalizeKind(connection.terminal_profile_kind || (mode === 'program' ? 'custom' : 'shell'));
  value('conn_terminal_program_path')!.value = String(connection.terminal_program_path || '');
  value('conn_terminal_program_args')!.value = String(connection.terminal_program_args || '');
  value('conn_terminal_working_directory')!.value = String(connection.terminal_working_directory || '');
  value('conn_terminal_program_platform')!.value = normalizePlatform(connection.terminal_program_platform);
  resetProfileSelect(form, true);
  const status = field(form, 'connTerminalDetectionStatus');
  if (status) {
    status.className = 'terminal-startup-detection muted';
    setLocalizedText(status, mode === 'program' ? 'terminal:startup.saved_detection' : 'terminal:startup.server_default_hint');
  }
  form!._terminalCapabilities = null;
  form!._terminalCapabilitiesChecked = false;
  form!._terminalProbeStale = false;
  form!._terminalCredentialRevision = 0;
  toggleStartup(form);
}

function capabilityProfiles(raw: Record<string, any> = {}): ConnectionTerminalProfile[] {
  const direct = Array.isArray(raw.profiles) ? raw.profiles : Array.isArray(raw.terminal_profiles) ? raw.terminal_profiles : [];
  const combined = direct.length ? direct : [
    ...(Array.isArray(raw.shells) ? raw.shells.map((item: any) => typeof item === 'object' ? {...item, kind: item.kind || 'shell'} : {label: String(item), path: String(item), kind: 'shell'}) : []),
    ...(Array.isArray(raw.repls) ? raw.repls.map((item: any) => typeof item === 'object' ? {...item, kind: item.kind || 'repl'} : {label: String(item), path: String(item), kind: 'repl'}) : []),
    ...(Array.isArray(raw.session_tools) ? raw.session_tools.map((item: any) => typeof item === 'object' ? {...item, kind: item.kind || 'session'} : {label: String(item), path: String(item), kind: 'session'}) : []),
    ...(Array.isArray(raw.interactive_tools) ? raw.interactive_tools.map((item: any) => typeof item === 'object' ? {...item, kind: item.kind || 'tool'} : {label: String(item), path: String(item), kind: 'tool'}) : [])
  ];
  return combined.map((profile: any, index: number) => {
    const item = typeof profile === 'object' && profile ? profile : {path: String(profile || '')};
    const path = profilePath(item);
    if (!path) return null;
    return {
      ...item,
      _index: index,
      label: String(item.label || item.name || path),
      name: String(item.name || item.label || path),
      path,
      args: terminalArgs(item.args ?? item.program_args),
      kind: normalizeKind(item.kind || item.type),
      platform: normalizePlatform(item.platform || raw.platform),
      working_directory: String(item.working_directory ?? item.cwd ?? '')
    };
  }).filter(Boolean) as ConnectionTerminalProfile[];
}

function normalizeCapabilities(raw: Record<string, any> = {}): ConnectionTerminalCapabilities {
  const defaultValue = raw.default_shell ?? raw.login_shell ?? null;
  const defaultShell = typeof defaultValue === 'string'
    ? {name: defaultValue.split(/[\\/]/).pop() || defaultValue, label: defaultValue.split(/[\\/]/).pop() || defaultValue, path: defaultValue}
    : defaultValue && typeof defaultValue === 'object'
      ? {
          ...defaultValue,
          name: String(defaultValue.name || defaultValue.label || profilePath(defaultValue)),
          label: String(defaultValue.label || defaultValue.name || profilePath(defaultValue)),
          path: profilePath(defaultValue)
        }
      : null;
  const tools = (Array.isArray(raw.tools) ? raw.tools : [])
    .map((item: any) => typeof item === 'object' && item
      ? {label: String(item.label || item.name || item.id || item.path || ''), path: String(item.path || ''), version: String(item.version || '')}
      : {label: String(item || ''), path: '', version: ''})
    .filter((item: ConnectionTerminalTool) => item.label);
  return {
    platform: String(raw.platform || 'unknown').toLowerCase(),
    platform_label: String(raw.platform_label || raw.os_label || raw.platform || translate('terminal:startup.unknown_platform', {defaultValue: '未知平台'})),
    default_shell: defaultShell,
    profiles: capabilityProfiles(raw),
    tools,
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : raw.warning ? [raw.warning] : []).map(String).filter(Boolean)
  };
}

function appendChip(parent: HTMLElement, text: string, title = '') {
  const chip = document.createElement('span');
  chip.className = 'terminal-startup-chip';
  chip.textContent = text;
  if (title) chip.title = title;
  parent.appendChild(chip);
}

function renderCapabilitySummary(form: ConnectionTerminalForm | null, capabilities: ConnectionTerminalCapabilities) {
  const box = field(form, 'connTerminalCapabilities');
  if (!box) return;
  box.replaceChildren();
  box.hidden = false;
  box.className = 'terminal-startup-capabilities';

  const heading = document.createElement('div');
  heading.className = 'terminal-startup-capability-heading';
  const defaultShell = capabilities.default_shell;
  const shellText = defaultShell?.path || defaultShell?.label || translate('terminal:startup.not_detected_short', {defaultValue: '未识别'});
  setLocalizedText(heading, 'terminal:startup.capability_summary', {
    platform: capabilities.platform_label,
    shell: shellText,
    defaultValue: `${capabilities.platform_label} · 默认 Shell：${shellText}`
  });
  box.appendChild(heading);

  if (capabilities.profiles.length) {
    const row = document.createElement('div');
    row.className = 'terminal-startup-capability-row';
    const label = document.createElement('strong');
    setLocalizedText(label, 'terminal:startup.launchable', {defaultValue: '可启动'});
    row.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'terminal-startup-chips';
    capabilities.profiles.forEach(profile => appendChip(chips, profile.label, `${profile.path}${profile.args ? ` ${profile.args}` : ''}`));
    row.appendChild(chips);
    box.appendChild(row);
  }

  if (capabilities.tools.length) {
    const row = document.createElement('div');
    row.className = 'terminal-startup-capability-row';
    const label = document.createElement('strong');
    setLocalizedText(label, 'terminal:startup.installed_tools', {defaultValue: '已安装工具'});
    row.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'terminal-startup-chips';
    capabilities.tools.forEach(tool => appendChip(chips, `${tool.label}${tool.version ? ` ${tool.version}` : ''}`, tool.path));
    row.appendChild(chips);
    box.appendChild(row);
  }

  capabilities.warnings.forEach(text => {
    const warning = document.createElement('div');
    warning.className = 'terminal-startup-capability-warning';
    warning.textContent = text;
    box.appendChild(warning);
  });
}

function renderProfiles(form: ConnectionTerminalForm | null, rawCapabilities: Record<string, any>) {
  const capabilities = normalizeCapabilities(rawCapabilities);
  const select = field(form, 'conn_terminal_profile_select') as HTMLSelectElement | null;
  const config = formConfig(form);
  if (!form) return capabilities;
  form._terminalCapabilities = capabilities;
  form._terminalCapabilitiesChecked = true;
  form._terminalProbeStale = false;
  if (!select) return capabilities;

  select.replaceChildren();
  const defaultShell = capabilities.default_shell;
  const defaultLabel = defaultShell?.label || defaultShell?.name || defaultShell?.path;
  select.add(new Option(
    defaultLabel
      ? translate('terminal:startup.default_detected_option', {shell: defaultLabel, defaultValue: `自动使用默认 Shell（${defaultLabel}）`})
      : translate('terminal:startup.default_login_shell_option', {defaultValue: '自动使用服务器默认登录 Shell'}),
    '__default__'
  ));

  const profileIndex = new Map(capabilities.profiles.map((profile, index) => [profile, index]));
  for (const [kind, labelKey, fallbackLabel] of PROFILE_GROUPS) {
    const profiles = capabilities.profiles.filter(profile => profile.kind === kind);
    if (!profiles.length) continue;
    const group = document.createElement('optgroup');
    group.label = translate(labelKey, {defaultValue: fallbackLabel});
    profiles.forEach(profile => group.appendChild(new Option(
      `${profile.label}${profile.args ? ` · ${profile.args}` : ''}`,
      `profile:${profileIndex.get(profile)}`
    )));
    select.appendChild(group);
  }
  select.add(new Option(translate('terminal:startup.custom_program_option', {defaultValue: '自定义程序...'}), '__custom__'));

  if (config.terminal_startup_mode === 'default') {
    select.value = '__default__';
  } else {
    const matchIndex = capabilities.profiles.findIndex(profile =>
      profile.path === config.terminal_program_path && profile.args === config.terminal_program_args
    );
    if (matchIndex >= 0) {
      select.value = `profile:${matchIndex}`;
    } else {
      const current = new Option(
        translate('terminal:startup.current_option', {
          name: config.terminal_profile_name || config.terminal_program_path,
          defaultValue: `当前配置：${config.terminal_profile_name || config.terminal_program_path}`
        }),
        '__current__',
        true,
        true
      );
      select.insertBefore(current, select.firstChild);
    }
  }
  renderCapabilitySummary(form, capabilities);
  return capabilities;
}

function applyProfile(value: string, select: HTMLSelectElement | null = null) {
  const form = (select?.closest('form') || elementById('connectionForm')) as ConnectionTerminalForm | null;
  const fieldValue = (id: string) => field(form, id) as HTMLInputElement | HTMLSelectElement | null;
  if (!form || !fieldValue('conn_terminal_startup_mode') || value === '' || value === '__current__') return;
  if (value === '__default__') {
    fieldValue('conn_terminal_startup_mode')!.value = 'default';
    toggleStartup(form);
    return;
  }
  if (value === '__custom__') {
    fieldValue('conn_terminal_startup_mode')!.value = 'program';
    const name = fieldValue('conn_terminal_profile_name');
    if (name && !name.value.trim()) name.value = translate('terminal:startup.custom_program', {defaultValue: '自定义程序'});
    fieldValue('conn_terminal_profile_kind')!.value = 'custom';
    toggleStartup(form);
    setTimeout(() => (fieldValue('conn_terminal_program_path') as HTMLInputElement | null)?.focus(), 0);
    return;
  }
  const index = Number(String(value).replace(/^profile:/, ''));
  const profile = form._terminalCapabilities?.profiles?.[index];
  if (!profile) return;
  fieldValue('conn_terminal_startup_mode')!.value = 'program';
  fieldValue('conn_terminal_profile_name')!.value = profile.name || profile.label || '';
  fieldValue('conn_terminal_profile_kind')!.value = normalizeKind(profile.kind);
  fieldValue('conn_terminal_program_path')!.value = profile.path;
  fieldValue('conn_terminal_program_args')!.value = profile.args || '';
  fieldValue('conn_terminal_working_directory')!.value = profile.working_directory || '';
  fieldValue('conn_terminal_program_platform')!.value = normalizePlatform(profile.platform);
  toggleStartup(form);
}

function markDetectionStale(form: ConnectionTerminalForm | null = elementById('connectionForm') as ConnectionTerminalForm | null) {
  if (!form?._terminalCapabilitiesChecked || form._terminalProbeStale) return;
  form._terminalProbeStale = true;
  const status = field(form, 'connTerminalDetectionStatus');
  if (status) {
    status.className = 'terminal-startup-detection stale';
    setLocalizedText(status, 'terminal:startup.detection_stale', {defaultValue: '连接信息已变化，下面的检测结果可能已过期。请重新测试 SSH。'});
  }
  field(form, 'connTerminalCapabilities')?.classList.add('is-stale');
}

function refreshFormLanguage(form: ConnectionTerminalForm | null) {
  if (!form) return;
  form.querySelectorAll<HTMLElement>('*').forEach(element => {
    const translation = (element as HTMLElement & {_connectionTranslation?: {key: string; options: TranslationOptions}})._connectionTranslation;
    if (translation) setLocalizedText(element, translation.key, translation.options);
  });
  const config = formConfig(form);
  const select = field(form, 'conn_terminal_profile_select') as HTMLSelectElement | null;
  if (select) {
    for (const option of select.options) {
      if (!option.value) setLocalizedText(option, 'terminal:startup.test_ssh_hint');
      else if (option.value === '__custom__') setLocalizedText(option, 'terminal:startup.custom_program_option');
      else if (option.value === '__current__') setLocalizedText(option, form._terminalCapabilitiesChecked ? 'terminal:startup.current_option' : 'terminal:startup.saved_option', {name: config.terminal_profile_name || config.terminal_program_path});
      else if (option.value === '__default__') {
        const shell = form._terminalCapabilities?.default_shell;
        const label = shell?.label || shell?.name || shell?.path;
        setLocalizedText(option, label ? 'terminal:startup.default_detected_option' : 'terminal:startup.default_login_shell_option', {shell: label});
      }
    }
    const kinds = PROFILE_GROUPS.filter(([kind]) => form._terminalCapabilities?.profiles?.some(profile => profile.kind === kind));
    [...select.querySelectorAll('optgroup')].forEach((group, index) => {
      if (kinds[index]) group.label = translate(kinds[index][1]);
    });
  }
  const direct = field(form, 'conn_jump')?.querySelector('option[value=""]') as HTMLOptionElement | null;
  if (direct) setLocalizedText(direct, 'connections:auto.direct');
  const groups = field(form, 'conn_group') as HTMLSelectElement | null;
  if (groups) {
    [...groups.options].forEach(option => {
      option.textContent = option.value === '__new_group__'
        ? translate('connections:groups.new_option')
        : connectionGroupDisplayName(option.value);
    });
  }
  if (form._terminalCapabilities) {
    renderCapabilitySummary(form, form._terminalCapabilities);
    field(form, 'connTerminalCapabilities')?.classList.toggle('is-stale', Boolean(form._terminalProbeStale));
  }
  refreshExtraArgsLanguage(form);
}

function refreshFormsLanguage() {
  const forms = new Set<ConnectionTerminalForm>();
  document.querySelectorAll<HTMLFormElement>('form#connectionForm').forEach(form => forms.add(form as ConnectionTerminalForm));
  const panes = workspacePaneNodes;
  if (panes?.values) {
    for (const pane of panes.values()) pane.querySelectorAll<HTMLFormElement>('form#connectionForm').forEach((form: HTMLFormElement) => forms.add(form as ConnectionTerminalForm));
  }
  forms.forEach(refreshFormLanguage);
}

export function createConnectionTerminalService() {
  return {
    setLocalizedText,
    field,
    refreshFormLanguage,
    formConfig,
    toggleStartup,
    resetProfileSelect,
    resetStartup,
    fillStartup,
    capabilityProfiles,
    normalizeCapabilities,
    renderCapabilitySummary,
    renderProfiles,
    applyProfile,
    markDetectionStale
  };
}

export function installConnectionTerminalService() {
  const service = createConnectionTerminalService();
  if (!connectionsServices.termaConnectionTerminal) connectionsServices.termaConnectionTerminal = service;
  registerTermaI18nRenderer(refreshFormsLanguage);
}



export interface InstalledFeaturesConnectionsConnectionTerminalServiceServices {
  termaConnectionTerminal?: ReturnType<typeof createConnectionTerminalService>;
}
