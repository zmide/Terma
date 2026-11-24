const path = require('node:path');
const sessions = new WeakMap();

function intendedBlobFilename(url, trustedUrl) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'blob:' || !trustedUrl(parsed.pathname)) return '';
    const name = new URLSearchParams(parsed.hash.slice(1)).get('terma-filename') || '';
    if (!name || name.length > 240 || ['.', '..'].includes(name) || /[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name) || /[. ]$/.test(name)) return '';
    return name;
  } catch { return ''; }
}

function registerDownloadNames(contents, options) {
  let owners = sessions.get(contents.session);
  if (!owners) {
    owners = new Map();
    sessions.set(contents.session, owners);
    contents.session.on('will-download', (_event, item, sender) => {
      const owner = owners.get(sender?.id);
      if (!owner || sender.isDestroyed() || !owner.trustedUrl(sender.getURL())) return;
      const name = intendedBlobFilename(item.getURL(), owner.trustedUrl);
      if (name) item.setSaveDialogOptions({defaultPath:path.join(owner.directory(), name)});
    });
  }
  owners.set(contents.id, options);
  contents.once('destroyed', () => owners.delete(contents.id));
}

module.exports = {intendedBlobFilename, registerDownloadNames};
