import {createHash} from 'node:crypto';
const {buildRemotePosixCommand}: {buildRemotePosixCommand(script: string): string} = require('../remote-posix');

import type {PerformanceProcess, HostPerformanceSnapshot} from './host-performance-types';
export type {PerformanceProcess, HostPerformanceSnapshot} from './host-performance-types';
interface Connection {id: number; [key: string]: unknown}
interface CommandResult {status: number | null; stdout: string; error?: Error | null}
interface PerformancePort {
  run(connection: Connection, command: string, timeout: number, options: {signal: AbortSignal; maxOutputBytes: number}): Promise<CommandResult>;
  now?(): number;
}
const failure = (code = 'PERFORMANCE_UNAVAILABLE') => Object.assign(new Error(code), {code, statusCode: code === 'PERFORMANCE_BUSY' ? 429 : 502});
const aborted = () => Object.assign(new Error('Performance request aborted'), {name: 'AbortError'});

// No user-controlled arguments, environment, paths or process command lines enter this script.
export const HOST_PERFORMANCE_COMMAND = buildRemotePosixCommand(`
LC_ALL=C; export LC_ALL
printf 'TERMA_PERF_V1\\n'
case "$(uname -s 2>/dev/null)" in
Darwin)
printf 'DARWIN\\nCPU\\n'
/usr/bin/top -l 1 -n 0 | /usr/bin/awk '/^CPU usage:/ {print; exit}'
printf 'MEM\\n'; /usr/sbin/sysctl -n hw.memsize; /usr/bin/vm_stat
printf 'LOAD\\n'; /usr/sbin/sysctl -n vm.loadavg
printf 'PROC\\n'
/bin/ps -A -c -o pid=,pcpu=,rss=,comm= | /usr/bin/sort -nr -k2,2 | /usr/bin/head -n 60
/bin/ps -A -c -o pid=,pcpu=,rss=,comm= | /usr/bin/sort -nr -k3,3 | /usr/bin/head -n 60
printf 'END\\n'; exit 0;;
Linux) ;;
*) printf 'UNSUPPORTED\\n'; exit 0;;
esac
printf 'CPU\\n'; head -n 1 /proc/stat
printf 'MEM\\n'; grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo
printf 'LOAD\\n'; cat /proc/loadavg
printf 'PROC\\n'
ps -eo pid=,pcpu=,rss=,comm= --sort=-pcpu 2>/dev/null | head -n 60
ps -eo pid=,pcpu=,rss=,comm= --sort=-rss 2>/dev/null | head -n 60
printf 'END\\n'
`.trim());

function parseDarwinPerformance(rows: string[]) {
  const idle = rows[rows.indexOf('CPU') + 1]?.match(/([\d.]+)% idle/);
  const totalBytes = Number(rows[rows.indexOf('MEM') + 1]);
  const pageSize = Number(rows.find(row => row.startsWith('Mach Virtual Memory Statistics:'))?.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (name: string) => {
    const row = rows.find(row => row.startsWith(`${name}:`));
    const value = Number(row?.match(/:\s+(\d+)\.$/)?.[1]);
    if (!Number.isSafeInteger(value) || value < 0) throw failure();
    return value;
  };
  const available = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * pageSize;
  const load = rows[rows.indexOf('LOAD') + 1]?.match(/^\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}$/)?.slice(1).map(Number);
  if (!idle || Number(idle[1]) > 100 || !Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || !Number.isSafeInteger(pageSize) || pageSize <= 0 || !Number.isSafeInteger(available)
    || !load || load.some(value => !Number.isFinite(value) || value < 0)) throw failure();
  return {cpuPercent: 100 - Number(idle[1]), memory: {totalBytes, usedBytes: Math.max(0, totalBytes - Math.min(totalBytes, available))}, load};
}

export function parseHostPerformance(output: string, sampledAt: number, previous?: {total: number; idle: number}) {
  if (Buffer.byteLength(output) > 65536) throw failure();
  const rows = output.trim().split(/\r?\n/);
  if (rows[0] !== 'TERMA_PERF_V1') throw failure();
  if (rows[1] === 'UNSUPPORTED') return {snapshot: {supported: false, sampledAt, cpuPercent: null,
    memory: {totalBytes: 0, usedBytes: 0}, load: [], processes: []} as HostPerformanceSnapshot, cpu: undefined};
  const darwin = rows[1] === 'DARWIN' ? parseDarwinPerformance(rows) : null;
  const cpuLine = rows[rows.indexOf('CPU') + 1], values = cpuLine?.trim().split(/\s+/).slice(1, 9).map(Number);
  if (!darwin && (!cpuLine?.startsWith('cpu ') || values.length < 4 || values.some(value => !Number.isFinite(value) || value < 0))) throw failure();
  const cpu = darwin ? undefined : {total: values.reduce((sum, value) => sum + value, 0), idle: values[3] + (values[4] || 0)};
  const memoryValue = (key: string) => {
    const row = rows.find(row => row.startsWith(`${key}:`));
    if (!row) return 0;
    const value = row.match(/^[A-Za-z]+:\s+(\d+)\s+kB$/);
    if (!value || !Number.isSafeInteger(Number(value[1]) * 1024)) throw failure();
    return Number(value[1]) * 1024;
  };
  const totalBytes = darwin?.memory.totalBytes || memoryValue('MemTotal');
  const available = rows.some(row => row.startsWith('MemAvailable:')) ? memoryValue('MemAvailable')
    : memoryValue('MemFree') + memoryValue('Buffers') + memoryValue('Cached');
  const load = darwin?.load || rows[rows.indexOf('LOAD') + 1]?.trim().split(/\s+/).slice(0, 3).map(Number);
  if (!totalBytes || !Number.isSafeInteger(totalBytes) || load?.length !== 3 || load.some(value => !Number.isFinite(value) || value < 0)) throw failure();
  const begin = rows.indexOf('PROC'), end = rows.indexOf('END');
  if (begin < 0 || end < begin || end - begin > 121) throw failure();
  const processes = new Map<number, PerformanceProcess>();
  for (const row of rows.slice(begin + 1, end)) {
    const match = row.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]), percent = Number(match[2]), bytes = Number(match[3]) * 1024;
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(percent) || !Number.isSafeInteger(bytes)) continue;
    processes.set(pid, {pid, name: match[4].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120),
      cpu: Math.min(percent, 100000), memoryBytes: bytes});
  }
  const elapsed = previous && cpu ? cpu.total - previous.total : 0;
  const cpuPercent = darwin ? darwin.cpuPercent : elapsed > 0 && cpu && cpu.idle >= previous!.idle
    ? Math.max(0, Math.min(100, 100 * (1 - (cpu.idle - previous!.idle) / elapsed))) : null;
  return {snapshot: {supported: true, sampledAt, cpuPercent,
    memory: darwin?.memory || {totalBytes, usedBytes: Math.max(0, totalBytes - Math.min(totalBytes, available))},
    load, processes: [...processes.values()]} as HostPerformanceSnapshot, cpu};
}

export function createHostPerformanceService(port: PerformancePort) {
  type RecordState = {stamp: string; used: number; cpu?: {total: number; idle: number};
    snapshot?: HostPerformanceSnapshot; failed?: boolean; inflight?: Promise<HostPerformanceSnapshot>; controller?: AbortController; clients: Set<symbol>};
  const records = new Map<number, RecordState>(), now = port.now || Date.now;
  function collect(connection: Connection, record: RecordState) {
    const controller = new AbortController(); record.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort',
      () => reject(aborted()), {once: true}));
    const task = (async () => {
      const result = await port.run(connection, HOST_PERFORMANCE_COMMAND, 8000, {signal: controller.signal, maxOutputBytes: 65536});
      if (controller.signal.aborted) throw aborted();
      if (result.status !== 0 || result.error) throw failure();
      const parsed = parseHostPerformance(result.stdout, now(), record.cpu);
      if (records.get(connection.id) !== record) throw aborted();
      record.snapshot = parsed.snapshot; record.cpu = parsed.cpu; record.failed = false; return parsed.snapshot;
    })();
    record.inflight = Promise.race([task, abort]).catch(error => {record.failed = true; throw error;}).finally(() => {
      clearTimeout(timer); record.inflight = undefined; record.controller = undefined;
      // Keep a short backoff after failures as well as successful samples.
      record.used = now();
    });
  }
  async function sample(connection: Connection, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(connection.id) || connection.id <= 0) throw failure();
    const stamp = createHash('sha256').update(JSON.stringify(connection)).digest('hex');
    let record = records.get(connection.id);
    if (!record || record.stamp !== stamp) {
      record?.controller?.abort(); records.delete(connection.id);
      for (const [id, value] of records) if (!value.inflight && now() - value.used > 60000) records.delete(id);
      if (records.size >= 64) {
        const idle = [...records].filter(([, value]) => !value.inflight).sort((a, b) => a[1].used - b[1].used)[0];
        if (!idle) throw failure('PERFORMANCE_BUSY'); records.delete(idle[0]);
      }
      record = {stamp, used: 0, clients: new Set()}; records.set(connection.id, record);
    }
    if (!record.inflight) {
      if (record.used && now() - record.used < 2000) {
        if (record.snapshot && !record.failed) return record.snapshot;
        throw failure();
      }
      if ([...records.values()].filter(value => value.inflight).length >= 8) throw failure('PERFORMANCE_BUSY');
      collect(connection, record);
    }
    const active = record, client = Symbol(), pending = active.inflight!;
    active.clients.add(client);
    return new Promise<HostPerformanceSnapshot>((resolve, reject) => {
      const abort = () => {finish(); reject(aborted());};
      const finish = () => {
        signal?.removeEventListener('abort', abort); active.clients.delete(client);
        if (!active.clients.size && active.inflight) active.controller?.abort();
      };
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) return abort();
      pending.then(value => {finish(); resolve(value);}, error => {finish(); reject(error);});
    });
  }
  return {sample, dispose() {for (const record of records.values()) record.controller?.abort(); records.clear();}};
}
