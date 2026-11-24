import {filesServices} from '@/features/files/installed-services';
export type SftpTask = {
  id?: string; type?: string; status?: string; phase?: string;
  resume_supported?: boolean; can_pause?: boolean; can_resume?: boolean; can_cancel?: boolean;
};
type Result = { ok?: boolean; status?: string; error?: string; [key: string]: unknown };
export type SftpTaskAction = 'pause' | 'resume' | 'cancel';
export interface SftpTaskPort {
  api(url: string, request: { method: string }): Promise<Result>;
  abortUpload(id: string): void;
}
const active = new Set(['running', 'pending', 'paused']);
export const canPauseSftpTask = (job?: SftpTask) => !!job && job.resume_supported === true &&
  (job.status === 'running' ? job.can_pause !== false : job.status === 'pending' && ['download', 'cross-copy'].includes(job.type || ''));
export const canResumeSftpTask = (job?: SftpTask) => !!job && job.status === 'paused' && !!job.can_resume;
export const canCancelSftpTask = (job?: SftpTask) => !!job && active.has(job.status || '') && job.can_cancel !== false && !(job.type === 'upload' && job.phase === 'committing');

export function createSftpTaskService() {
  const pending = new Set<string>();
  const deleting=new Map<string,Promise<unknown>>();
  let refreshPromise: Promise<unknown> | null = null;
  let refreshAgain = false;
  async function run(port: SftpTaskPort, id: string, action: SftpTaskAction) {
    const key = String(id || '');
    if (!key || key.includes('\0') || !['pause', 'resume', 'cancel'].includes(action) || pending.has(key)) return null;
    const sync = key.startsWith('sync:');
    if ((sync && (action !== 'cancel' || key.length === 5)) || key.startsWith('desktop:') || key.startsWith('component:')) return null;
    pending.add(key);
    try {
      const endpoint = sync ? `/api/sftp/sync/jobs/${encodeURIComponent(key.slice(5))}/cancel`
        : `/api/sftp/jobs/${encodeURIComponent(key)}/${action}`;
      const result = await port.api(endpoint, { method: 'POST' });
      // Do not abort the browser body when the server rejects cancellation or loses connectivity.
      if (action === 'cancel' && !sync && result?.ok !== false && !result?.error && ['cancelled', 'cancelling'].includes(result?.status || '')) port.abortUpload(key);
      return result;
    } finally { pending.delete(key); }
  }
  async function batch<T, R>(jobs: T[], operation: (job: T) => Promise<R>, concurrency = 6) {
    let next = 0;
    const results: PromiseSettledResult<R>[] = new Array(jobs.length);
    const limit = Number.isFinite(concurrency) ? Math.max(1, Math.min(8, Math.floor(concurrency))) : 6;
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        try { results[index] = { status: 'fulfilled', value: await operation(jobs[index]) }; }
        catch (reason) { results[index] = { status: 'rejected', reason }; }
      }
    }));
    return results;
  }
  function refresh<T>(operation: () => Promise<T>): Promise<T> {
    if (refreshPromise) { refreshAgain = true; return refreshPromise as Promise<T>; }
    refreshPromise = (async () => {
      let result: T;
      do { refreshAgain = false; result = await operation(); await Promise.resolve(); } while (refreshAgain);
      return result;
    })().finally(() => { refreshPromise = null; refreshAgain = false; });
    return refreshPromise as Promise<T>;
  }
  function remove(port:{api(url:string,request:{method:string}):Promise<unknown>;generated(id:string):void},id:string):Promise<unknown>{
    const key=String(id||'');if(!key||key.includes('\0')||key.length>4000)return Promise.resolve(null);
    const previous=deleting.get(key);if(previous)return previous;
    const request=Promise.resolve().then(()=>{
      if(key.startsWith('local:')){port.generated(key);return {ok:true};}
      const routes=[['desktop:','/api/linux-desktop/tasks/'],['component:','/api/remote-component/tasks/'],['sync:','/api/sftp/sync/jobs/']] as const;
      const route=routes.find(([prefix])=>key.startsWith(prefix));
      const value=route?key.slice(route[0].length):key;
      if(!value)return null;
      return port.api((route?route[1]:'/api/sftp/jobs/')+encodeURIComponent(value),{method:'DELETE'});
    }).finally(()=>{if(deleting.get(key)===request)deleting.delete(key);});
    deleting.set(key,request);return request;
  }
  return { run, batch, refresh, remove, isPending: (id: string) => pending.has(id), get refreshing() { return refreshPromise; },
    canPause: canPauseSftpTask, canResume: canResumeSftpTask, canCancel: canCancelSftpTask };
}

export function installSftpTaskService() { filesServices.termaSftpTasks = createSftpTaskService(); }


export interface InstalledFeaturesFilesSftpSftpTaskServiceServices {
  termaSftpTasks?: ReturnType<typeof createSftpTaskService>
}
