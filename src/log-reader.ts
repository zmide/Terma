import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export interface LogSettings {
  schema_version: number;
  retention_days: number;
  max_file_size_mb: number;
  max_total_size_mb: number;
  rotation_files: number;
  updated_at?: string;
}

export interface LogWindowOptions {
  beforeOffset?: number;
  limitBytes?: number;
  raw?: boolean;
  query?: string;
  contextLines?: number;
  maxMatches?: number;
  line?: number;
}

export interface LogSearchMatch {
  line: number;
  text: string;
}

export interface LogWindowResult {
  text: string;
  offset: number;
  end_offset: number;
  total_bytes: number;
  has_older: boolean;
  has_newer: boolean;
  matches: LogSearchMatch[];
  matches_truncated: boolean;
  start_line?: number;
  target_line?: number;
}

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  schema_version: 3,
  retention_days: 0,
  max_file_size_mb: 10,
  max_total_size_mb: 0,
  rotation_files: 0
};

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

export function normalizeLogSettings(value: Partial<LogSettings> = {}): LogSettings {
  return {
    schema_version: 3,
    retention_days: clampInteger(value.retention_days, DEFAULT_LOG_SETTINGS.retention_days, 0, 3650),
    max_file_size_mb: clampInteger(value.max_file_size_mb, DEFAULT_LOG_SETTINGS.max_file_size_mb, 1, 2048),
    max_total_size_mb: clampInteger(value.max_total_size_mb, DEFAULT_LOG_SETTINGS.max_total_size_mb, 0, 102400),
    rotation_files: clampInteger(value.rotation_files, DEFAULT_LOG_SETTINGS.rotation_files, 0, 100000),
    ...(value.updated_at ? { updated_at: String(value.updated_at) } : {})
  };
}

export function readLogSettings(file: string): LogSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LogSettings>;
    // Version 1 stored the previous defaults. Treat that untouched format as a
    // migration to the new unlimited defaults; later versions preserve choices.
    if (Number(parsed.schema_version || 0) < 3) return { ...DEFAULT_LOG_SETTINGS };
    return normalizeLogSettings(parsed);
  } catch {
    return { ...DEFAULT_LOG_SETTINGS };
  }
}

export function writeLogSettings(file: string, value: Partial<LogSettings>): LogSettings {
  const settings = { ...normalizeLogSettings(value), updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return settings;
}

export function resolveLogFile(logDir: string, relativePath: string): string {
  const root = path.resolve(logDir);
  const resolved = path.resolve(root, String(relativePath || ""));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("日志路径无效");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("日志不存在");
  return resolved;
}

type TerminalCell = string | null;

interface TerminalRenderSurface {
  lines: TerminalCell[][];
  history: TerminalCell[][];
  snapshot: TerminalCell[][];
  row: number;
  column: number;
  height: number;
}

interface TerminalTranscriptState {
  lines: TerminalCell[][];
  row: number;
  column: number;
  alternate: TerminalRenderSurface | null;
}

function terminalCharacterWidth(character: string): number {
  const code = character.codePointAt(0) || 0;
  if (/\p{Mark}/u.test(character)) return 0;
  if (code < 0x1100) return 1;
  return code <= 0x115f
    || code === 0x2329
    || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)
    ? 2
    : 1;
}

function terminalSurfaceLine(surface: {lines: TerminalCell[][]; row: number}): TerminalCell[] {
  while (surface.lines.length <= surface.row) surface.lines.push([]);
  return surface.lines[surface.row];
}

function writeTerminalCharacter(surface: {lines: TerminalCell[][]; row: number; column: number}, character: string): void {
  const width = terminalCharacterWidth(character);
  const line = terminalSurfaceLine(surface);
  if (width === 0) {
    const previous = Math.max(0, surface.column - 1);
    line[previous] = `${line[previous] || ""}${character}`;
    return;
  }
  while (line.length < surface.column) line.push(" ");
  line[surface.column] = character;
  if (width === 2) line[surface.column + 1] = null;
  surface.column += width;
}

function terminalLineText(line: TerminalCell[] = []): string {
  return line.map(cell => cell || "").join("").trimEnd();
}

function terminalLineFeed(surface: TerminalRenderSurface | TerminalTranscriptState): void {
  if ("history" in surface && surface.row >= surface.height - 1) {
    surface.history.push(surface.lines.shift() || []);
    surface.lines.push([]);
    surface.row = Math.max(0, surface.height - 1);
    return;
  }
  surface.row += 1;
  terminalSurfaceLine(surface);
}

function eraseTerminalLine(surface: TerminalRenderSurface | TerminalTranscriptState, mode: number): void {
  const line = terminalSurfaceLine(surface);
  if (mode === 2) {
    surface.lines[surface.row] = [];
    return;
  }
  if (mode === 1) {
    for (let index = 0; index <= surface.column; index += 1) line[index] = " ";
    return;
  }
  line.length = Math.min(line.length, surface.column);
}

function normalizedTerminalTranscriptLines(lines: string[]): string[] {
  const output: string[] = [];
  let blankCount = 0;
  for (const source of lines) {
    const line = source.trimEnd();
    if (!line) {
      blankCount += 1;
      if (blankCount > 2) continue;
    } else blankCount = 0;
    output.push(line);
  }
  while (output.length && !output[output.length - 1]) output.pop();
  return output;
}

function meaningfulAlternateLines(lines: TerminalCell[][]): string[] {
  const rendered = lines.map(terminalLineText);
  while (rendered.length && !rendered[0]) rendered.shift();
  while (rendered.length && !rendered[rendered.length - 1]) rendered.pop();
  return normalizedTerminalTranscriptLines(rendered.filter(line => !/^\[terma-[A-Za-z0-9_-]+:/.test(line)));
}

function appendAlternateTerminalSurface(state: TerminalTranscriptState): void {
  const alternate = state.alternate;
  if (!alternate) return;
  let lines = meaningfulAlternateLines([...alternate.history, ...alternate.lines]);
  if (!lines.length) lines = meaningfulAlternateLines(alternate.snapshot);
  if (lines.length) {
    const current = terminalLineText(terminalSurfaceLine(state));
    if (current || state.column > 0) terminalLineFeed(state);
    state.column = 0;
    for (const line of lines) {
      state.lines[state.row] = Array.from(line);
      terminalLineFeed(state);
      state.column = 0;
    }
  }
  state.alternate = null;
}

function applyTerminalCsi(state: TerminalTranscriptState, parameterText: string, final: string): void {
  const privateMode = parameterText.startsWith("?");
  const raw = privateMode ? parameterText.slice(1) : parameterText;
  const params = raw.split(";").map(value => value === "" ? 0 : Number(value) || 0);
  if (privateMode && (final === "h" || final === "l") && params.some(value => [47, 1047, 1049].includes(value))) {
    if (final === "h") {
      if (state.alternate) appendAlternateTerminalSurface(state);
      state.alternate = {lines:Array.from({length:24}, () => []), history:[], snapshot:[], row:0, column:0, height:24};
    } else appendAlternateTerminalSurface(state);
    return;
  }
  const surface = state.alternate || state;
  const amount = Math.max(1, params[0] || 1);
  if ((final === "H" || final === "f") && state.alternate) {
    surface.row = Math.max(0, (params[0] || 1) - 1);
    surface.column = Math.max(0, (params[1] || 1) - 1);
    terminalSurfaceLine(surface);
    return;
  }
  if (final === "A") surface.row = Math.max(0, surface.row - amount);
  else if (final === "B") surface.row += amount;
  else if (final === "C") surface.column += amount;
  else if (final === "D") surface.column = Math.max(0, surface.column - amount);
  else if (final === "E") { surface.row += amount; surface.column = 0; }
  else if (final === "F") { surface.row = Math.max(0, surface.row - amount); surface.column = 0; }
  else if (final === "G" || final === "`") surface.column = Math.max(0, (params[0] || 1) - 1);
  else if (final === "d" && state.alternate) surface.row = Math.max(0, (params[0] || 1) - 1);
  else if (final === "K") eraseTerminalLine(surface, params[0] || 0);
  else if (final === "J" && state.alternate && [2, 3].includes(params[0] || 0)) {
    const snapshot = [...state.alternate.history, ...state.alternate.lines].map(line => [...line]);
    if (meaningfulAlternateLines(snapshot).length) state.alternate.snapshot = snapshot;
    state.alternate.lines = Array.from({length:state.alternate.height}, () => []);
  } else if (final === "r" && state.alternate) {
    state.alternate.height = Math.max(1, Math.min(1000, params[1] || params[0] || state.alternate.height));
    while (state.alternate.lines.length < state.alternate.height) state.alternate.lines.push([]);
    if (state.alternate.lines.length > state.alternate.height) state.alternate.lines.length = state.alternate.height;
    state.alternate.row = Math.min(state.alternate.row, state.alternate.height - 1);
  } else if (final === "S" && state.alternate) {
    for (let index = 0; index < amount; index += 1) {
      state.alternate.history.push(state.alternate.lines.shift() || []);
      state.alternate.lines.push([]);
    }
  } else if (final === "T" && state.alternate) {
    for (let index = 0; index < amount; index += 1) {
      state.alternate.lines.pop();
      state.alternate.lines.unshift([]);
    }
  }
  terminalSurfaceLine(surface);
}

export function renderTerminalTranscript(value: string): string {
  const text = String(value || "");
  const state: TerminalTranscriptState = {lines:[[]], row:0, column:0, alternate:null};
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === "\x1b") {
      const next = text[index + 1] || "";
      if (next === "[") {
        let end = index + 2;
        while (end < text.length && !/[\x40-\x7e]/.test(text[end])) end += 1;
        if (end >= text.length) break;
        applyTerminalCsi(state, text.slice(index + 2, end), text[end]);
        index = end + 1;
        continue;
      }
      if (next === "]") {
        let end = index + 2;
        while (end < text.length && text[end] !== "\x07" && !(text[end] === "\x1b" && text[end + 1] === "\\")) end += 1;
        index = end < text.length ? end + (text[end] === "\x1b" ? 2 : 1) : text.length;
        continue;
      }
      index += next === "(" || next === ")" ? 3 : 2;
      continue;
    }
    const surface = state.alternate || state;
    if (character === "\r") surface.column = 0;
    else if (character === "\n") { terminalLineFeed(surface); surface.column = 0; }
    else if (character === "\b" || character === "\x7f") surface.column = Math.max(0, surface.column - 1);
    else if (character === "\t") surface.column += 8 - (surface.column % 8);
    else if (character >= " ") writeTerminalCharacter(surface, character);
    index += character.codePointAt(0)! > 0xffff ? 2 : 1;
  }
  if (state.alternate) appendAlternateTerminalSurface(state);
  return normalizedTerminalTranscriptLines(state.lines.map(terminalLineText)).join("\n");
}

function stripAnsi(text: string): string {
  return renderTerminalTranscript(text);
}

async function searchLog(
  file: string,
  query: string,
  contextLines: number,
  maxMatches: number,
  raw: boolean
): Promise<{ matches: LogSearchMatch[]; truncated: boolean }> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { matches: [], truncated: false };
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const previous: Array<{ line: number; text: string }> = [];
  const pending: Array<{ line: number; rows: Array<{ line: number; text: string }>; remaining: number }> = [];
  const completed: LogSearchMatch[] = [];
  let lineNumber = 0;
  let truncated = false;
  for await (const sourceLine of lines) {
    lineNumber += 1;
    const text = raw ? sourceLine : stripAnsi(sourceLine);
    for (const block of pending) {
      if (block.remaining <= 0) continue;
      block.rows.push({ line: lineNumber, text });
      block.remaining -= 1;
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].remaining > 0) continue;
      const block = pending.splice(index, 1)[0];
      completed.push({
        line: block.line,
        text: block.rows.map(row => `${row.line}: ${row.text}`).join("\n")
      });
    }
    const lower = text.toLowerCase();
    if (terms.some(term => lower.includes(term))) {
      if (completed.length + pending.length >= maxMatches) {
        truncated = true;
      } else {
        pending.push({
          line: lineNumber,
          rows: [...previous, { line: lineNumber, text }],
          remaining: contextLines
        });
      }
    }
    previous.push({ line: lineNumber, text });
    while (previous.length > contextLines) previous.shift();
  }
  for (const block of pending) {
    completed.push({
      line: block.line,
      text: block.rows.map(row => `${row.line}: ${row.text}`).join("\n")
    });
  }
  return { matches: completed.slice(0, maxMatches), truncated };
}

export async function readLogWindow(
  logDir: string,
  relativePath: string,
  options: LogWindowOptions = {}
): Promise<LogWindowResult> {
  const file = resolveLogFile(logDir, relativePath);
  const stat = await fs.promises.stat(file);
  const total = stat.size;
  const limit = options.limitBytes === undefined
    ? Math.max(total, 1)
    : clampInteger(options.limitBytes, 256 * 1024, 4096, Math.max(1024 * 1024, total));
  let startLine: number | undefined;
  let targetLine: number | undefined;
  let start: number;
  let end: number;
  let buffer: Buffer;
  const requestedLine = clampInteger(options.line, 0, 1, 100_000_000);
  if (requestedLine > 0) {
    // Explicit line navigation is infrequent and log files are capped at 50 MB by
    // default, so an asynchronous full-file read keeps the byte/UTF-8 boundaries
    // exact without blocking the server's event loop.
    const full = await fs.promises.readFile(file);
    let line = 1;
    let targetStart = 0;
    while (line < requestedLine) {
      const newline = full.indexOf(0x0a, targetStart);
      if (newline < 0) {
        targetStart = full.length;
        break;
      }
      targetStart = newline + 1;
      line += 1;
    }
    if (line === requestedLine && targetStart <= total) {
      const targetEndMarker = full.indexOf(0x0a, targetStart);
      const targetEnd = targetEndMarker < 0 ? total : targetEndMarker + 1;
      start = Math.max(0, targetStart - Math.floor(limit / 2));
      if (start > 0) {
        const firstCompleteLine = full.indexOf(0x0a, start);
        start = firstCompleteLine < 0 ? total : firstCompleteLine + 1;
      }
      if (start > targetStart) start = targetStart;
      end = Math.min(total, start + limit);
      if (end <= targetStart) {
        start = targetStart;
        end = Math.min(total, targetStart + limit);
      }
      // Keep the selected line visible even when it is unusually long.
      if (targetEnd > end && targetStart === start) end = Math.min(total, targetEnd);
      buffer = full.subarray(start, end);
      startLine = 1;
      for (let cursor = 0; cursor < start; cursor += 1) {
        if (full[cursor] === 0x0a) startLine += 1;
      }
      targetLine = requestedLine;
    } else {
      end = options.beforeOffset === undefined
        ? total
        : Math.max(0, Math.min(total, Math.floor(Number(options.beforeOffset) || 0)));
      start = Math.max(0, end - limit);
      const length = Math.max(0, end - start);
      const handle = await fs.promises.open(file, "r");
      buffer = Buffer.alloc(length);
      try {
        if (length) {
          const result = await handle.read(buffer, 0, length, start);
          buffer = buffer.subarray(0, result.bytesRead);
        }
      } finally {
        await handle.close();
      }
    }
  } else {
    end = options.beforeOffset === undefined
      ? total
      : Math.max(0, Math.min(total, Math.floor(Number(options.beforeOffset) || 0)));
    start = Math.max(0, end - limit);
    const length = Math.max(0, end - start);
    const handle = await fs.promises.open(file, "r");
    buffer = Buffer.alloc(length);
    try {
      if (length) {
        const result = await handle.read(buffer, 0, length, start);
        buffer = buffer.subarray(0, result.bytesRead);
      }
    } finally {
      await handle.close();
    }
  }
  let text = buffer.toString("utf8");
  if (start > 0 && startLine === undefined) {
    const firstLineEnd = text.indexOf("\n");
    if (firstLineEnd >= 0) text = text.slice(firstLineEnd + 1);
  }
  if (!options.raw) text = stripAnsi(text);
  const searched = await searchLog(
    file,
    String(options.query || ""),
    clampInteger(options.contextLines, 2, 0, 10),
    clampInteger(options.maxMatches, 50, 1, 200),
    Boolean(options.raw)
  );
  return {
    text,
    offset: start,
    end_offset: end,
    total_bytes: total,
    has_older: start > 0,
    has_newer: end < total,
    matches: searched.matches,
    matches_truncated: searched.truncated,
    ...(startLine === undefined ? {} : { start_line: startLine }),
    ...(targetLine === undefined ? {} : { target_line: targetLine })
  };
}

function walkLogFiles(root: string): Array<{ file: string; stat: fs.Stats }> {
  if (!fs.existsSync(root)) return [];
  const out: Array<{ file: string; stat: fs.Stats }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.log(?:\.\d+)?$/i.test(entry.name)) out.push({ file, stat: fs.statSync(file) });
    }
  };
  visit(root);
  return out;
}

export function rotateLogFile(file: string, incomingBytes: number, settings: LogSettings): boolean {
  if (!fs.existsSync(file)) return false;
  const maximum = settings.max_file_size_mb * 1024 * 1024;
  if (fs.statSync(file).size + incomingBytes <= maximum) return false;
  if (settings.rotation_files === 0) {
    let index = 1;
    while (fs.existsSync(file + "." + index)) index += 1;
    fs.renameSync(file, file + "." + index);
    return true;
  }
  for (let index = settings.rotation_files; index >= 1; index -= 1) {
    const current = index === 1 ? file : `${file}.${index - 1}`;
    const next = `${file}.${index}`;
    if (!fs.existsSync(current)) continue;
    if (index === settings.rotation_files) fs.rmSync(next, { force: true });
    fs.renameSync(current, next);
  }
  return true;
}

export function enforceLogRetention(
  logDir: string,
  settings: LogSettings,
  skipFiles: ReadonlySet<string> = new Set()
): { deleted: number; freed_bytes: number } {
  const files = walkLogFiles(logDir);
  const now = Date.now();
  const cutoff = settings.retention_days > 0 ? now - settings.retention_days * 24 * 60 * 60 * 1000 : 0;
  let deleted = 0;
  let freed = 0;
  const remove = (item: { file: string; stat: fs.Stats }): void => {
    if (skipFiles.has(path.resolve(item.file)) || !fs.existsSync(item.file)) return;
    fs.rmSync(item.file, { force: true });
    deleted += 1;
    freed += item.stat.size;
  };
  if (cutoff) {
    for (const item of files) {
      if (item.stat.mtimeMs < cutoff) remove(item);
    }
  }
  const remaining = files.filter(item => fs.existsSync(item.file)).sort((left, right) => left.stat.mtimeMs - right.stat.mtimeMs);
  const maximumTotal = settings.max_total_size_mb > 0 ? settings.max_total_size_mb * 1024 * 1024 : 0;
  let total = remaining.reduce((sum, item) => sum + item.stat.size, 0);
  if (!maximumTotal) return { deleted, freed_bytes: freed };
  for (const item of remaining) {
    if (total <= maximumTotal) break;
    if (skipFiles.has(path.resolve(item.file))) continue;
    remove(item);
    total -= item.stat.size;
  }
  return { deleted, freed_bytes: freed };
}
