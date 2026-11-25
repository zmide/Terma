// Runs in the Electron renderer. Drive the real controller through its API responses.
async function loadUpdateFixture(update) {
  const next = structuredClone(update);
  const original = api;
  window.termaSettingsRequests.updates.cancel();
  window.termaUpdateDownloads.stopPolling();
  api = (url, options) => {
    if (url === '/api/updates/status') return Promise.resolve(next);
    if (url === '/api/updates/download/status') return Promise.resolve(next?.download_status);
    return original(url, options);
  };
  try {
    await window.termaUpdateStatus.loadCached();
  } finally {
    api = original;
    window.termaUpdateDownloads.stopPolling();
  }
}

module.exports = { loadUpdateFixture };
