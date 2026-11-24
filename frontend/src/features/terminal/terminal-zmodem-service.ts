import {terminalServices} from '@/features/terminal/installed-services';
import {createTerminalZmodemRuntime} from './terminal-zmodem-runtime-service';
import type {ZmodemLibrary, ZmodemOffer, ZmodemProtocolSession, ZmodemRuntimePort} from './terminal-zmodem-types';
import type {TerminalZmodemViewModel} from './TerminalZmodemView';

export type TerminalZmodemState = {
  active: boolean;
  armed: boolean;
  cancelled: boolean;
  role: string;
  sentry: InstanceType<ZmodemLibrary['Sentry']> | null;
  zsession: ZmodemProtocolSession | null;
  offer: ZmodemOffer | null;
  acceptBatch: boolean;
  cancelDraining: boolean;
  discardUntil: number;
  transferred: number;
  batchTransferred: number;
  offeredFiles: number;
  emptyReceive: boolean;
  total: number;
  armedOutputTail: string;
  timer: ReturnType<typeof setTimeout> | null;
  panel?: HTMLElement | null;
  view?: TerminalZmodemViewModel | null;
  renderAt: number;
  preparedInput: string | null;
  generation: number;
  closed: boolean;
  picker: HTMLInputElement | null;
  sending: boolean;
  finishedZsession?: ZmodemProtocolSession | null;
};

export const TERMINAL_ZMODEM_DETECT_TIMEOUT_MS = 15000;
export const TERMINAL_ZMODEM_MAX_FILE_BYTES = 512 * 1024 * 1024;

function cleanCommand(value: unknown) {
  return String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
}

export function formatBytes(value: unknown) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function safeFilename(value: unknown) {
  const basename = String(value || '').split(/[\\/]/).at(-1) || 'download.bin';
  const cleaned = basename
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 240);
  return cleaned && !['.', '..'].includes(cleaned) && /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'download.bin';
}

export function commandInfo(value: unknown) {
  const command = cleanCommand(value);
  const match = command.match(/^(?:(?:sudo|command)\s+)*(?:\/?(?:[^\s/]+\/)*)(l?sz|l?rz)(?:\s+(.*))?$/i);
  if (!match) return {role: '', command, arguments: '', executable: '', canStart: false};
  const role = /rz$/i.test(match[1]) ? 'send' : 'receive';
  const argumentsText = String(match[2] || '').trim();
  const helpOnly = /^(?:-h|--help|--version)(?:\s|$)/i.test(argumentsText);
  const canStart = role === 'receive'
    ? Boolean(argumentsText) && !helpOnly
    : (!argumentsText || (argumentsText.startsWith('-') && !helpOnly));
  return {role, command, arguments: argumentsText, executable: String(match[1] || ''), canStart};
}

export function commandRole(value: unknown) {
  return commandInfo(value).role;
}

export function rzNeedsOverwrite(info: {role?: string; arguments?: string} | null | undefined) {
  if (info?.role !== 'send') return false;
  return !/(?:^|\s)(?:--overwrite|-[A-Za-z]*y[A-Za-z]*)(?=\s|$)/.test(String(info.arguments || ''));
}

export function rzInputWithOverwrite(data: unknown) {
  const value = String(data || '');
  const lineBreak = value.search(/[\r\n]/);
  if (lineBreak < 0) return value;
  const before = value.slice(0, lineBreak);
  const after = value.slice(lineBreak);
  return before.trim() ? `${before} -y${after}` : ` -y${after}`;
}

export function createState(session: {zmodemState?: Partial<TerminalZmodemState> | null}) {
  if (!session.zmodemState) {
    session.zmodemState = {
      active: false,
      armed: false,
      cancelled: false,
      role: '',
      sentry: null,
      zsession: null,
      offer: null,
      acceptBatch: false,
      cancelDraining: false,
      discardUntil: 0,
      transferred: 0,
      batchTransferred: 0,
      offeredFiles: 0,
      emptyReceive: false,
      total: 0,
      armedOutputTail: '',
      timer: null,
      panel: null,
      view: null,
      renderAt: 0,
      preparedInput: null,
      generation: 0,
      closed: false,
      picker: null,
      sending: false,
      finishedZsession: null
    };
  }
  return session.zmodemState as TerminalZmodemState;
}

export function sentFileSummary(files: Array<{name?: string}>, translate: (key: string, params?: Record<string, unknown>) => string) {
  const names = files.map(file => String(file.name || translate('terminal:zmodem.unnamed_file', {defaultValue: '未命名文件'})));
  const visible = names.slice(0, 4).join(translate('terminal:zmodem.file_separator', {defaultValue: '、'}));
  return names.length > 4
    ? translate('terminal:zmodem.file_summary_more', {names: visible, count: names.length, defaultValue: `${visible} 等 ${names.length} 个文件`})
    : visible;
}

export const terminalZmodemUtilities = {
  detectTimeoutMs: TERMINAL_ZMODEM_DETECT_TIMEOUT_MS,
  maxFileBytes: TERMINAL_ZMODEM_MAX_FILE_BYTES,
  formatBytes, safeFilename, commandInfo, commandRole, rzNeedsOverwrite,
  rzInputWithOverwrite, createState, sentFileSummary
};

export function installTerminalZmodemService(port: ZmodemRuntimePort) {
  terminalServices.termaTerminalZmodem = {
    ...terminalZmodemUtilities,
    ...createTerminalZmodemRuntime(port, terminalZmodemUtilities)
  };
}



export interface InstalledFeaturesTerminalTerminalZmodemServiceServices {
  termaTerminalZmodem: typeof terminalZmodemUtilities & ReturnType<typeof createTerminalZmodemRuntime>;
}
