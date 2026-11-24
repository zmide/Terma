import type {TerminalZmodemViewModel} from './TerminalZmodemView';

export interface ZmodemOffer {
  get_details(): {name?: string; size?: number; files_remaining?: number; bytes_remaining?: number};
  accept(options: {on_input(octets: number[] | Uint8Array): void}): Promise<unknown>;
}
export interface ZmodemProtocolSession {
  aborted?(): boolean;
  abort(): void;
  close(): Promise<unknown>;
  start(): Promise<unknown> | void;
  on(event: 'session_end', listener: () => void): void;
  on(event: 'offer', listener: (offer: ZmodemOffer) => void): void;
}
export interface ZmodemDetection {
  confirm(): ZmodemProtocolSession;
  get_session_role(): string;
}
export interface ZmodemLibrary {
  Sentry: new (options: {
    to_terminal(octets: number[]): void;
    sender(octets: number[]): void;
    on_detect(detection: ZmodemDetection): void;
    on_retract(): void;
  }) => {consume(value: ArrayBuffer): void};
  Browser: {send_files(session: ZmodemProtocolSession, files: File[], options: {
    on_progress(file: File, transfer: {get_offset?(): number}): void;
    on_file_complete(file: File): void;
  }): Promise<unknown>};
}
export interface ZmodemRuntimeSession {
  key?: string;
  id: number;
  mount?: HTMLElement | null;
  term?: {element?: HTMLElement; focus?(): void};
  socket?: {readyState: number; send(value: string | Uint8Array): void} | null;
  commandBuffer?: string;
  currentDirectoryKnown?: boolean;
  currentDirectory?: string;
  zmodemState?: import('./terminal-zmodem-service').TerminalZmodemState;
  zmodemBinaryMode?: boolean;
  panel?: HTMLElement | null;
}
export interface ZmodemRuntimePort {
  library(): ZmodemLibrary | null;
  loadScript(source: string): Promise<unknown>;
  tr(key: string, params?: Record<string, unknown>): string;
  output(session: ZmodemRuntimeSession, value: string | Uint8Array): void;
  notify(message: string, level: 'info' | 'success' | 'error'): void;
  promptCommand(session: ZmodemRuntimeSession): string;
  broadcastCount(): number;
  focus(key: string): void;
  current(session: ZmodemRuntimeSession): boolean;
  render(session: ZmodemRuntimeSession, view: TerminalZmodemViewModel): boolean;
  releaseView(session: ZmodemRuntimeSession): void;
  uploadPlan(id: number, directory: string, names: string[]): Promise<{items?: ZmodemUploadItem[]}>;
  conflict(items: ZmodemUploadItem[]): Promise<string>;
  choose(title: string, detail: string, actions: {label: string; value: string; className?: string}[]): Promise<string>;
}
export interface ZmodemUploadItem {name: string; exists?: boolean; suggested_name?: string}
export type ZmodemUtils = typeof import('./terminal-zmodem-service').terminalZmodemUtilities;
