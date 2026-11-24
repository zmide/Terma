export interface TerminalBroadcastInputPort {
  targets(): readonly string[];
  isTarget(key: string): boolean;
  sensitive(key: string): boolean;
  send(key: string, payload: unknown): void;
  sendAll(keys: readonly string[], payload: unknown): void;
  captureTargets(keys: readonly string[]): () => boolean;
  dangerous(value: string): boolean;
  paused(): boolean;
  setPaused(value: boolean): void;
}

export function createTerminalBroadcastInputService(port: TerminalBroadcastInputPort) {
  function handle(sourceKey: string, outgoing: unknown, raw = '') {
    const source = String(sourceKey || '');
    if (!port.isTarget(source)) return {handled: false, keys: [] as string[]};
    const keys = [...port.targets()];
    if (keys.length < 2) return {handled: false, stop: true, keys};
    if (keys.some(key => port.sensitive(key))) {
      port.send(source, outgoing);
      const pause = !port.paused();
      if (pause) port.setPaused(true);
      return {handled: true, pause, keys};
    }
    const resume = port.paused();
    if (resume) port.setPaused(false);
    const value = String(raw || '');
    const confirm = value.length > 2 && (/\r|\n/.test(value) || port.dangerous(value));
    if (confirm) {
      const current = port.captureTargets(keys);
      let settled = false;
      return {handled: true, resume, confirm, keys, source, raw: value, commit: () => {
        if (settled) return false;
        settled = true;
        const open = port.targets();
        if (!current() || keys.length !== open.length || keys.some(key => !open.includes(key) || port.sensitive(key))) return false;
        port.sendAll(keys, outgoing);
        return true;
      }};
    }
    port.sendAll(keys, outgoing);
    return {handled: true, resume, sent: true, keys};
  }
  return {handle};
}
