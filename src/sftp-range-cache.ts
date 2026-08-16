const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const states = new Map<string, any>();
const PERSIST_INTERVAL_MS = 1000;
const PERSIST_BYTE_INTERVAL = 1024 * 1024;

function addRange(ranges: number[][], start: number, end: number) {
  if (end < start) return;
  const merged: number[][] = [];
  let first = Math.max(0, start);
  let last = Math.max(first, end);
  let inserted = false;
  for (const current of ranges) {
    if (current[1] + 1 < first) {
      merged.push(current);
      continue;
    }
    if (last + 1 < current[0]) {
      if (!inserted) merged.push([first, last]);
      inserted = true;
      merged.push(current);
      continue;
    }
    first = Math.min(first, current[0]);
    last = Math.max(last, current[1]);
  }
  if (!inserted) merged.push([first, last]);
  ranges.splice(0, ranges.length, ...merged);
}

function cacheKey(parts: unknown[]) {
  return crypto.createHash("sha256").update(parts.map(item => String(item ?? "")).join("\0")).digest("hex");
}

function loadState(root: string, key: string, size: number) {
  const id = `${path.resolve(root)}\0${key}`;
  const cached = states.get(id);
  if (cached && Number(cached.size) === size) return cached;
  fs.mkdirSync(root, {recursive:true});
  const dataPath = path.join(root, `${key}.data`);
  const metadataPath = path.join(root, `${key}.json`);
  let ranges: number[][] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (Number(parsed.size) === size && Array.isArray(parsed.ranges)) {
      const loadedRanges = parsed.ranges
        .filter((range: any) => Array.isArray(range) && range.length === 2)
        .map((range: any) => [Math.max(0, Number(range[0] || 0)), Math.max(0, Number(range[1] || 0))])
        .filter((range: number[]) => range[1] >= range[0] && range[1] < size)
        .sort((left: number[], right: number[]) => left[0] - right[0]);
      ranges = [];
      for (const range of loadedRanges) addRange(ranges, range[0], range[1]);
    }
  } catch {}
  if (!fs.existsSync(dataPath)) ranges = [];
  const now = Date.now();
  const state = {id, key, root, dataPath, metadataPath, size, ranges, updatedAt:now, lastPersistAt:now, bytesSincePersist:0, dirty:false};
  states.set(id, state);
  return state;
}

function markStateDirty(state: any, bytes = 0) {
  state.dirty = true;
  state.bytesSincePersist = Math.max(0, Number(state.bytesSincePersist || 0)) + Math.max(0, Number(bytes || 0));
}

function persistState(state: any, force = false) {
  if (!state.dirty) return false;
  const now = Date.now();
  if (!force
    && now - Number(state.lastPersistAt || 0) < PERSIST_INTERVAL_MS
    && Number(state.bytesSincePersist || 0) < PERSIST_BYTE_INTERVAL) return false;
  state.updatedAt = now;
  const temporary = `${state.metadataPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({version:1, size:state.size, ranges:state.ranges, updated_at:state.updatedAt}, null, 2), "utf8");
    fs.renameSync(temporary, state.metadataPath);
    state.lastPersistAt = now;
    state.bytesSincePersist = 0;
    state.dirty = false;
    const timestamp = new Date();
    try { fs.utimesSync(state.root, timestamp, timestamp); } catch {}
    return true;
  } finally {
    try { fs.rmSync(temporary, {force:true}); } catch {}
  }
}

async function flushState(file: any, state: any, force = false) {
  if (!state.dirty) return false;
  const now = Date.now();
  if (!force
    && now - Number(state.lastPersistAt || 0) < PERSIST_INTERVAL_MS
    && Number(state.bytesSincePersist || 0) < PERSIST_BYTE_INTERVAL) return false;
  await file.sync();
  return persistState(state, true);
}

function segmentsForRange(ranges: number[][], start: number, end: number) {
  const segments: any[] = [];
  let cursor = start;
  for (const range of ranges) {
    if (range[1] < cursor) continue;
    if (range[0] > end) break;
    if (range[0] > cursor) segments.push({start:cursor, end:Math.min(end, range[0] - 1), cached:false});
    const cachedStart = Math.max(cursor, range[0]);
    const cachedEnd = Math.min(end, range[1]);
    if (cachedEnd >= cachedStart) segments.push({start:cachedStart, end:cachedEnd, cached:true});
    cursor = cachedEnd + 1;
    if (cursor > end) break;
  }
  if (cursor <= end) segments.push({start:cursor, end, cached:false});
  return segments;
}

async function writeAt(file: any, chunk: Buffer, position: number) {
  let offset = 0;
  while (offset < chunk.length) {
    const result = await file.write(chunk, offset, chunk.length - offset, position + offset);
    if (!result.bytesWritten) throw new Error("无法写入原生拖出缓存");
    offset += result.bytesWritten;
  }
}

function retryDelay(attempt: number) {
  return new Promise(resolve => setTimeout(resolve, Math.min(1500, 150 * Math.pow(2, attempt))));
}

function openCachedRange(options: any) {
  const size = Math.max(0, Number(options.size || 0));
  const start = Math.max(0, Math.min(size, Number(options.start || 0)));
  const end = Math.max(start - 1, Math.min(size - 1, Number(options.end ?? size - 1)));
  if (end < start) return Readable.from([]);
  const key = cacheKey(options.keyParts || []);
  const state = loadState(options.root, key, size);
  const stream = Readable.from((async function* () {
    const file = await fs.promises.open(state.dataPath, fs.existsSync(state.dataPath) ? "r+" : "w+");
    try {
      const stat = await file.stat();
      if (stat.size !== size) await file.truncate(size);
      for (const segment of segmentsForRange(state.ranges, start, end)) {
        if (segment.cached) {
          const cached = fs.createReadStream(state.dataPath, {start:segment.start, end:segment.end, autoClose:true});
          for await (const chunk of cached) yield chunk;
          continue;
        }
        let cursor = segment.start;
        let attempts = 0;
        while (cursor <= segment.end) {
          let source: any = null;
          const attemptStart = cursor;
          try {
            source = await options.openSource(cursor, segment.end);
            for await (const raw of source) {
              const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
              const remaining = segment.end - cursor + 1;
              const output = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
              if (!output.length) continue;
              await writeAt(file, output, cursor);
              cursor += output.length;
              addRange(state.ranges, attemptStart, cursor - 1);
              markStateDirty(state, output.length);
              await flushState(file, state);
              yield output;
              if (cursor > segment.end) break;
            }
            if (cursor <= segment.end) throw new Error("远端范围读取提前结束");
            await flushState(file, state, true);
          } catch (error) {
            if (cursor > attemptStart) {
              addRange(state.ranges, attemptStart, cursor - 1);
              markStateDirty(state);
              await flushState(file, state, true);
            }
            if (attempts >= Math.max(0, Number(options.retries ?? 2))) throw error;
            attempts += 1;
            await retryDelay(attempts);
          } finally {
            try { source?.destroy?.(); } catch {}
          }
        }
      }
    } finally {
      await flushState(file, state, true);
      await file.close().catch(() => {});
    }
  })());
  stream.cache_key = key;
  return stream;
}

module.exports = {
  __addRange:addRange,
  __loadState:loadState,
  __persistState:persistState,
  __segmentsForRange:segmentsForRange,
  cacheKey,
  openCachedRange
};
