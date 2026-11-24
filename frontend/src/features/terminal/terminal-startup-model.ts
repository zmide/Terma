import type { TerminalStartupConfig } from './TerminalStartupView';

type Startup = TerminalStartupConfig & {x11_mode?: string};
const startupKinds = new Set(['shell', 'repl', 'session', 'tool', 'custom']);

export function normalizeTerminalStartupConfig(input: unknown = {}): Startup {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const mode = value.terminal_startup_mode === 'program' ? 'program' : 'default';
  const x11 = ['off', 'untrusted', 'trusted'].includes(String(value.x11_mode || '')) ? String(value.x11_mode) : undefined;
  const kind = String(value.terminal_profile_kind || 'custom');
  if (mode === 'default') return {
    terminal_startup_mode: 'default',
    terminal_profile_name: '',
    terminal_profile_kind: 'shell',
    terminal_program_path: '',
    terminal_program_args: '',
    terminal_working_directory: '',
    terminal_program_platform: 'auto',
    ...(x11 ? {x11_mode: x11} : {})
  };
  return {
    terminal_startup_mode: 'program',
    terminal_profile_name: String(value.terminal_profile_name || '').trim().slice(0, 120),
    terminal_profile_kind: startupKinds.has(kind) ? kind : 'custom',
    terminal_program_path: String(value.terminal_program_path || '').trim(),
    terminal_program_args: String(value.terminal_program_args || '').trim(),
    terminal_working_directory: String(value.terminal_working_directory || '').trim(),
    terminal_program_platform: value.terminal_program_platform === 'posix' || value.terminal_program_platform === 'windows'
      ? value.terminal_program_platform : 'auto',
    ...(x11 ? {x11_mode: x11} : {})
  };
}

export function terminalSessionBackendForStartup(config: unknown) {
  const value = normalizeTerminalStartupConfig(config || {});
  if (value.terminal_startup_mode !== 'program' || value.terminal_profile_kind !== 'session') return '';
  const name = value.terminal_program_path.split(/[\\/]/).pop()?.replace(/\.exe$/i, '').toLowerCase();
  return name === 'tmux' || name === 'screen' ? name : '';
}

