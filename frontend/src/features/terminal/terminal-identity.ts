export function createTerminalLogId(){
  const random=globalThis.crypto?.randomUUID?.()||`${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now()}-${String(random).replace(/[^A-Za-z0-9_-]/g,'').slice(0,64)}`;
}
