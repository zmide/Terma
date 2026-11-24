export interface SftpPollState {
  hidden: boolean; hasActiveJobs: boolean; drawerOpen: boolean; vncRendering: boolean;
  activeSessionKey?: string; activeSessionInterval: number; allSessionsInterval: number;
}
export interface SftpPollPort {
  now(): number;
  setTimer(callback: () => void, delay: number): unknown;
  clearTimer(timer: unknown): void;
  timerChanged(timer: unknown): void;
  state(): SftpPollState;
  lastJobsPollAt(): number;
  refreshJobs(maxAge: number): Promise<unknown>;
  refreshSessions(key?: string): Promise<unknown>;
}
const interval = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

/** One timer and one in-flight poll; foreground wakes coalesce behind an active request. */
export function createSftpTaskPoller(port: SftpPollPort) {
  let started = false, busy = false, wakePending = false;
  let timer: unknown = null;
  let activeAt: number | null = null, allAt: number | null = null;
  const clear = () => { if (timer !== null) port.clearTimer(timer); timer = null; port.timerChanged(null); };
  function schedule(delay: number) {
    clear();
    timer = port.setTimer(() => { timer = null; port.timerChanged(null); void run(); }, delay);
    port.timerChanged(timer);
  }
  async function run() {
    if (!started || busy) return;
    busy = true;
    const force = wakePending; wakePending = false;
    let nextDelay = 10000;
    try {
      const state = port.state(), now = port.now();
      const jobsInterval = state.hasActiveJobs ? 2000 : state.drawerOpen ? 3000 : state.vncRendering ? 15000 : 10000;
      const activeInterval = interval(state.activeSessionInterval, 5000), allInterval = interval(state.allSessionsInterval, 15000);
      nextDelay = state.hidden ? 30000 : Math.min(jobsInterval, state.activeSessionKey ? activeInterval : allInterval);
      if (state.hidden) return;
      const calls: Promise<unknown>[] = [];
      const jobsAge = now - port.lastJobsPollAt();
      if (force || jobsAge < 0 || jobsAge >= jobsInterval) calls.push(Promise.resolve().then(() => port.refreshJobs(force ? 0 : jobsInterval)));
      if (force || allAt === null || now < allAt || now - allAt >= allInterval) {
        allAt = now; if (state.activeSessionKey) activeAt = now;
        calls.push(Promise.resolve().then(() => port.refreshSessions()));
      } else if (state.activeSessionKey && (activeAt === null || now < activeAt || now - activeAt >= activeInterval)) {
        activeAt = now;
        calls.push(Promise.resolve().then(() => port.refreshSessions(state.activeSessionKey)));
      }
      await Promise.allSettled(calls);
    } catch {
      // A failed state read must not leave polling permanently in-flight.
    } finally {
      busy = false;
      if (started) schedule(wakePending ? 0 : nextDelay);
    }
  }
  function wake() {
    if (!started) return;
    wakePending = true;
    if (!busy) schedule(0);
  }
  function start(immediate = false) {
    if (started) { if (immediate) wake(); return; }
    started = true;
    if (busy) wakePending = true;
    else { wakePending = immediate; schedule(immediate ? 0 : 3000); }
  }
  function stop() { started = false; wakePending = false; clear(); }
  return { start, stop, wake, get running() { return started; }, get refreshing() { return busy; } };
}
/** Own page listeners with the poller; only a running page may resume from bfcache. */
export function createSftpTaskLifecycle(port: SftpPollPort, page = document, host = window) {
  const poller = createSftpTaskPoller(port);
  let bound = false, disposed = false, resumeOnShow = false;
  const visibility = () => { if (!page.hidden) poller.wake(); };
  const hide = () => { resumeOnShow = poller.running; poller.stop(); };
  const show = (event: PageTransitionEvent) => {
    const resume = resumeOnShow; resumeOnShow = false;
    if (event.persisted && resume && !disposed) poller.start(true);
  };
  function start(immediate = false) {
    if (disposed) return;
    if (!bound) {
      page.addEventListener('visibilitychange', visibility);
      host.addEventListener('pagehide', hide);
      host.addEventListener('pageshow', show);
      bound = true;
    }
    poller.start(immediate);
  }
  function stop() { resumeOnShow = false; poller.stop(); }
  function dispose() {
    disposed = true; stop();
    if (!bound) return;
    page.removeEventListener('visibilitychange', visibility);
    host.removeEventListener('pagehide', hide);
    host.removeEventListener('pageshow', show);
    bound = false;
  }
  return { start, stop, wake: poller.wake, dispose,
    get running() { return poller.running; }, get refreshing() { return poller.refreshing; } };
}
