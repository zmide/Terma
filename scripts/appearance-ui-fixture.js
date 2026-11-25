/** Replays the real bootstrap in a disposable renderer containing stale appearance state. */
function replayAppearanceBootstrap() {
  const entry = document.querySelector('script[src^="/app-theme-settings.js"]');
  if (!entry) throw new Error('The synchronous appearance entry is missing');
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = entry.src;
    script.onload = () => {script.remove(); resolve();};
    script.onerror = () => {script.remove(); reject(new Error('The appearance entry could not be loaded'));};
    document.head.append(script);
  });
}
module.exports = { replayAppearanceBootstrap };
