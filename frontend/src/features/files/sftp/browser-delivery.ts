interface DeliveryJob { id: string; type: string; status: string }
interface DeliveryPort { pending: Set<string>; save(id: string): void; saved(): void; failed?(error: unknown): void }
/** Claim before dispatch so a synchronous refresh cannot deliver the same file twice. */
export function deliverCompletedDownloads(jobs: DeliveryJob[], port: DeliveryPort) {
  for (const job of jobs) {
    if (job.type !== 'download' || job.status !== 'done' || !port.pending.delete(job.id)) continue;
    try { port.save(job.id); port.saved(); }
    catch (error) { port.pending.add(job.id); port.failed?.(error); }
  }
}
export function saveBrowserDownload(id: string, refresh: () => unknown) {
  if (!id || id.includes('\0')) throw new Error('Invalid download ID');
  const anchor = document.createElement('a');
  anchor.href = `/api/sftp/jobs/${encodeURIComponent(id)}/fetch`;
  anchor.download = '';
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { setTimeout(() => anchor.remove(), 1000); }
  setTimeout(() => { void Promise.resolve().then(refresh).catch(() => {}); }, 1500);
}
