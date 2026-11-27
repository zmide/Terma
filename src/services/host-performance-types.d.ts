export interface PerformanceProcess {pid: number; name: string; cpu: number; memoryBytes: number}
export interface HostPerformanceSnapshot {
  supported: boolean; sampledAt: number; cpuPercent: number | null;
  memory: {totalBytes: number; usedBytes: number}; load: number[]; processes: PerformanceProcess[];
}
