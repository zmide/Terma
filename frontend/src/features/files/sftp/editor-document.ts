import {filesServices} from '@/features/files/installed-services';
export type LineEnding = 'lf' | 'crlf' | 'cr';
export function editorLineEnding(value: unknown): LineEnding { return value === 'crlf' || value === 'cr' ? value : 'lf'; }
export function editorUnixScript(title: string, content = '') {
  const name = String(title || '').replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  return /\.(sh|bash|zsh|ksh|dash|fish)$/.test(name) || ['.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile', '.kshrc'].includes(name) || /^\uFEFF?#!/.test(content);
}
export function prepareEditorSave(title: string, content: string, encoding = 'utf8', lineEnding = 'lf') {
  const original = String(content || ''), originalEncoding = String(encoding || 'utf8');
  const unixScript = editorUnixScript(title, original), selected = editorLineEnding(lineEnding);
  const newline = { lf: '\n', crlf: '\r\n', cr: '\r' }[selected];
  let value = (unixScript ? original.replace(/^\uFEFF/, '') : original).replace(/\r\n|\r|\n/g, '\n').replace(/\n/g, newline);
  if (unixScript && value && !value.endsWith(newline)) value += newline;
  const savedEncoding = unixScript && originalEncoding === 'utf8bom' ? 'utf8' : originalEncoding;
  return { content: value, encoding: savedEncoding, lineEnding: selected, unixScript, unsafeScriptLineEnding: unixScript && selected !== 'lf', changed: value !== original || savedEncoding !== originalEncoding };
}
export function editorByteMeasurement(content: string, encoding = 'utf8') {
  const selected = String(encoding || 'utf8').toLowerCase();
  return { bytes: new Blob([String(content || '')]).size + (selected === 'utf8bom' ? 3 : 0), exact: selected === 'utf8' || selected === 'utf8bom' };
}

export type EditorVersion = { id?: string; size?: number; changed_at?: number; mtime?: number; [key: string]: unknown };
export function editorVersions(value: unknown): EditorVersion[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 10).map(item => ({ ...item })) : [];
}

/** Each floating editor owns its revisions and async work; remote writes are never replayed. */
export function createEditorDocumentSession() {
  let revision = 0, disposed = false, saving = false, historySequence = 0, comparisonSequence = 0;
  return {
    get revision() { return revision; },
    get saving() { return saving; },
    change() { revision += 1; },
    async save<P extends object,T>(payload: Readonly<P>, capturedRevision: number, write: (payload: Readonly<P>) => Promise<T>) {
      if (disposed || saving) return null;
      saving = true;
      try {
        const result = await write(Object.freeze({ ...payload }));
        return disposed ? null : { result, current: capturedRevision === revision };
      } finally { saving = false; }
    },
    async history(load: () => Promise<{ versions?: unknown }>) {
      const sequence = ++historySequence;
      const value = await load();
      return !disposed && sequence === historySequence ? editorVersions(value?.versions) : null;
    },
    async compare<T>(load: () => Promise<T>) {
      const sequence = ++comparisonSequence;
      const value = await load();
      return !disposed && sequence === comparisonSequence ? { value } : null;
    },
    closeComparison() { comparisonSequence += 1; },
    dispose() { disposed = true; historySequence += 1; comparisonSequence += 1; }
  };
}

type DiffPart = { value: string; added?: boolean; removed?: boolean };
type DiffCell = { kind: 'blank' | 'same' | 'removed' | 'added'; number: string; text: string };
type DiffRow = { collapsed: string } | { changed: boolean; cells: DiffCell[] };
export type EditorDiff = { oldLabel: string; newLabel: string; hasChanges: boolean; unavailable: boolean; message: string; rows: DiffRow[] };
type DiffPort = { diffLines: (a: string, b: string, options: { stripTrailingCr: boolean; timeout: number; maxEditLength: number }) => DiffPart[] | undefined; tr: (key: string, params?: Record<string, unknown>) => string; bytes: (value: number) => string };
const MAX_CHARS = 2 * 1024 * 1024, MAX_ROWS = 4000;
function lines(value: string) { const values = value.replace(/\r\n?/g, '\n').split('\n'); if (values.at(-1) === '') values.pop(); return values; }
export function editorDiff(oldText: string, newText: string, labels: { oldLabel?: string; newLabel?: string }, port: DiffPort): EditorDiff {
  const previous = String(oldText || ''), current = String(newText || '');
  const model: EditorDiff = { oldLabel: labels.oldLabel || port.tr('sftp:diff.old_version'), newLabel: labels.newLabel || port.tr('sftp:diff.new_version'), hasChanges: false, unavailable: false, message: '', rows: [] };
  const unavailable = (key: string, params?: Record<string, unknown>) => ({ ...model, unavailable: true, message: port.tr(key, params) });
  if (previous.length + current.length > MAX_CHARS) return unavailable('sftp:diff.text_too_large', { limit: port.bytes(MAX_CHARS) });
  const parts = port.diffLines(previous, current, { stripTrailingCr: true, timeout: 1500, maxEditLength: 20000 });
  if (!parts) return unavailable('sftp:diff.difference_too_large');
  model.hasChanges = parts.some(part => part.added || part.removed);
  if (!model.hasChanges) { model.message = port.tr('sftp:diff.same_content'); return model; }
  let oldLine = 1, newLine = 1;
  const append = (oldValue: string | null, newValue: string | null, changed = false) => {
    if (model.rows.length >= MAX_ROWS) return false;
    model.rows.push({ changed, cells: [
      { kind: oldValue === null ? 'blank' : changed ? 'removed' : 'same', number: oldValue === null ? '' : String(oldLine++), text: oldValue === null ? '' : oldValue || ' ' },
      { kind: newValue === null ? 'blank' : changed ? 'added' : 'same', number: newValue === null ? '' : String(newLine++), text: newValue === null ? '' : newValue || ' ' }
    ] }); return true;
  };
  for (let index = 0; index < parts.length && model.rows.length < MAX_ROWS; index += 1) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      const common = lines(part.value);
      if (common.length <= 12) { for (const line of common) if (!append(line, line)) break; }
      else {
        for (const line of common.slice(0, 4)) if (!append(line, line)) break;
        if (model.rows.length >= MAX_ROWS) break;
        const count = common.length - 8; oldLine += count; newLine += count;
        model.rows.push({ collapsed: port.tr('sftp:diff.unchanged_lines', { count }) });
        for (const line of common.slice(-4)) if (!append(line, line)) break;
      }
      continue;
    }
    const next = parts[index + 1], paired = part.removed && next?.added;
    const before = part.removed ? lines(part.value) : [], after = part.added ? lines(part.value) : paired ? lines(next.value) : [];
    if (paired) index += 1;
    for (let row = 0; row < Math.max(before.length, after.length); row += 1) if (!append(before[row] ?? null, after[row] ?? null, true)) break;
  }
  if (model.rows.length >= MAX_ROWS) model.rows.push({ collapsed: port.tr('sftp:diff.row_limit', { count: MAX_ROWS }) });
  return model;
}

export function installEditorDocument() { filesServices.termaEditorDocument = { prepare: prepareEditorSave, lineEnding: editorLineEnding, unixScript: editorUnixScript, measure: editorByteMeasurement, versions: editorVersions, create: createEditorDocumentSession, diff: editorDiff }; }


export interface InstalledFeaturesFilesSftpEditorDocumentServices {
  termaEditorDocument?: { prepare: typeof prepareEditorSave; lineEnding: typeof editorLineEnding; unixScript: typeof editorUnixScript; measure: typeof editorByteMeasurement; versions: typeof editorVersions; create: typeof createEditorDocumentSession; diff: typeof editorDiff }
}
