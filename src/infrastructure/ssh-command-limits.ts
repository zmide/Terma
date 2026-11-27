interface CommandLimits {signal?: AbortSignal; maxOutputBytes?: number}

/** Shared by native SSH and built-in exec channels; only callers opting in change behavior. */
export function createSshCommandLimits(options: CommandLimits, stop: (error: Error) => void) {
  const limit = Number.isSafeInteger(options.maxOutputBytes) && Number(options.maxOutputBytes) > 0
    ? Math.min(Number(options.maxOutputBytes), 1024 * 1024) : Infinity;
  let bytes = 0, disposed = false, stopped = false;
  const abort = () => {
    if (disposed || stopped) return;
    stopped = true; stop(Object.assign(new Error('SSH command aborted'), {name: 'AbortError'}));
  };
  options.signal?.addEventListener('abort', abort, {once: true});
  if (options.signal?.aborted) queueMicrotask(abort);
  return {
    accept(chunk: Uint8Array | string) {
      if (disposed || stopped || options.signal?.aborted) return false;
      bytes += Buffer.byteLength(chunk);
      if (bytes <= limit) return true;
      stopped = true;
      stop(Object.assign(new Error('SSH command output limit exceeded'), {code: 'SSH_OUTPUT_LIMIT'}));
      return false;
    },
    dispose() {disposed = true; options.signal?.removeEventListener('abort', abort);}
  };
}
