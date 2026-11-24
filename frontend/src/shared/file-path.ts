export function filenameFromPath(value: unknown): string {
  return String(value || '').split(/[\\/]/).at(-1) || '';
}
