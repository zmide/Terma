const DEFAULT_UPDATE_STARTUP_DELAY_MS = 10 * 1000;
const DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function positiveDelay(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createUpdateScheduler(options: any = {}) {
  const checker = options.checker;
  if (!checker || typeof checker.check !== "function") throw new Error("更新调度器缺少检查器");
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const onError = typeof options.onError === "function" ? options.onError : null;
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  const startupDelayMs = positiveDelay(options.startupDelayMs, DEFAULT_UPDATE_STARTUP_DELAY_MS);
  const intervalMs = positiveDelay(options.intervalMs, DEFAULT_UPDATE_INTERVAL_MS);
  let timer: any = null;
  let started = false;
  let generation = 0;
  let completedChecks = 0;

  function schedule(delayMs: number, scheduledGeneration: number) {
    if (!started || scheduledGeneration !== generation) return;
    timer = setTimer(() => run(scheduledGeneration), delayMs);
    timer?.unref?.();
  }

  async function run(scheduledGeneration: number) {
    if (!started || scheduledGeneration !== generation) return;
    timer = null;
    const startup = completedChecks === 0;
    try {
      const result = await checker.check({force:true, notify:startup});
      completedChecks += 1;
      try { onResult?.(result, {startup}); } catch {}
    } catch (error) {
      try { onError?.(error); } catch {}
    } finally {
      if (started && scheduledGeneration === generation) schedule(intervalMs, scheduledGeneration);
    }
  }

  function start() {
    if (started) return;
    started = true;
    generation += 1;
    completedChecks = 0;
    schedule(startupDelayMs, generation);
  }

  function stop() {
    started = false;
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return { start, stop };
}

module.exports = {
  DEFAULT_UPDATE_INTERVAL_MS,
  DEFAULT_UPDATE_STARTUP_DELAY_MS,
  createUpdateScheduler
};
