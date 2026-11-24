import type { createVncClipboardImages } from './vnc-clipboard-images';
import type { createVncClipboardText } from './vnc-clipboard-text';
import type { VncSession } from './vnc-types';

const TEXT_INTERVAL_MS = 900;
const LOCAL_IMAGE_INTERVAL_MS = 5000;
const REMOTE_IMAGE_INTERVAL_MS = 3000;
const INPUT_IDLE_MS = 1400;

interface PollTimers {
  text?: ReturnType<typeof setInterval>;
  local?: ReturnType<typeof setTimeout>;
  remote?: ReturnType<typeof setTimeout>;
  idle?: number;
}

interface PollingPort {
  text: Pick<ReturnType<typeof createVncClipboardText>, 'transport' | 'fromLocal' | 'poll'>;
  images: Pick<ReturnType<typeof createVncClipboardImages>, 'automatic' | 'fromLocal' | 'poll'>;
  sessions(): Iterable<VncSession>;
  interval(key: string, fallback: number): number;
  now(): number;
}

export function createVncClipboardPolling(port: PollingPort) {
  const timers = new WeakMap<VncSession, PollTimers>();
  const imageInterval = (local: boolean) => local
    ? port.interval('vnc_local_image_poll_interval_ms', LOCAL_IMAGE_INTERVAL_MS)
    : port.interval('vnc_remote_image_poll_interval_ms', REMOTE_IMAGE_INTERVAL_MS);

  function stop(session: VncSession) {
    const running = timers.get(session);
    if (!running) return;
    timers.delete(session);
    clearInterval(running.text);
    clearTimeout(running.local);
    clearTimeout(running.remote);
    if (running.idle !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(running.idle);
  }

  function start(session: VncSession) {
    stop(session);
    if (!session.connected || !session.clipboardAutoSync) return;
    const running: PollTimers = {};
    timers.set(session, running);
    const current = () => timers.get(session) === running && session.connected && session.clipboardAutoSync;
    void port.text.transport(session);
    running.text = setInterval(() => {
      if (!current()) return;
      void port.text.fromLocal(session, current);
      void port.text.poll(session, false, current);
    }, TEXT_INTERVAL_MS);

    const imageCurrent = () => current() && session.clipboardAutoSyncImages;
    function schedule(local: boolean, delay = imageInterval(local)) {
      if (!imageCurrent()) return;
      running[local ? 'local' : 'remote'] = setTimeout(() => {
        if (!imageCurrent()) return;
        const idleFor = port.now() - (session.lastInteractionAt ?? 0);
        if (local && idleFor < INPUT_IDLE_MS) {
          schedule(true, INPUT_IDLE_MS - idleFor);
          return;
        }
        const run = async () => {
          if (!imageCurrent()) return;
          running.idle = undefined;
          try {
            if (local) await port.images.fromLocal(session);
            else await port.images.poll(session);
          } finally {
            schedule(local);
          }
        };
        // Only local PNG decoding waits for idle. Remote metadata uses its configured period.
        if (local && typeof requestIdleCallback === 'function') {
          running.idle = requestIdleCallback(() => { void run(); }, {timeout: 1000});
        } else void run();
      }, delay);
    }
    schedule(true);
    schedule(false);
  }

  function refresh() {
    for (const session of port.sessions()) {
      if (session.connected && session.clipboardAutoSync && session.clipboardAutoSyncImages) start(session);
    }
  }

  async function afterFocus() {
    await Promise.allSettled(Array.from(port.sessions())
      .filter(port.images.automatic)
      .map(session => port.images.fromLocal(session)));
  }

  return {start, stop, refresh, afterFocus};
}
