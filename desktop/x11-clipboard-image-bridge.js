"use strict";

const crypto = require("node:crypto");

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BMP_SIGNATURE = Buffer.from([0x42, 0x4d]);
const POLL_INTERVAL_MS = 500;
// VcXsrv's Windows clipboard worker can take several seconds to observe an
// image-only X11 owner and briefly clear/reclaim CLIPBOARD. Keep the cached
// PNG available long enough for that feedback cycle and for a normal user to
// paste into the remote application.
const LOCAL_CLIPBOARD_SETTLE_MS = 30 * 1000;
const MAX_SETTLE_CLAIMS = 60;

function validPng(value) {
  const image = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : Buffer.alloc(0);
  if (!image.length || image.length > MAX_IMAGE_BYTES || image.length < PNG_SIGNATURE.length) return null;
  return image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? image : null;
}

function validBmp(value) {
  const bitmap = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : Buffer.alloc(0);
  if (!bitmap.length || bitmap.length > MAX_IMAGE_BYTES || bitmap.length < BMP_SIGNATURE.length) return null;
  return bitmap.subarray(0, BMP_SIGNATURE.length).equals(BMP_SIGNATURE) ? bitmap : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function internAtom(X, name) {
  return new Promise((resolve, reject) => {
    X.InternAtom(false, name, (error, atom) => error ? reject(error) : resolve(Number(atom)));
  });
}

function createX11ClipboardImageBridge(options = {}) {
  const display = String(options.display || "").trim();
  const authCookie = Buffer.isBuffer(options.authCookie) ? options.authCookie : Buffer.alloc(0);
  const x11Module = options.x11Module || null;
  const readClipboardPng = typeof options.readClipboardPng === "function" ? options.readClipboardPng : null;
  const readClipboardFormats = typeof options.readClipboardFormats === "function" ? options.readClipboardFormats : null;
  const readClipboardRevision = typeof options.readClipboardRevision === "function" ? options.readClipboardRevision : null;
  const deferClaimUntilFocused = options.deferClaimUntilFocused === true;
  const onDiagnostic = typeof options.onDiagnostic === "function" ? options.onDiagnostic : null;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs))
    ? Math.max(250, Math.min(5000, Number(options.pollIntervalMs)))
    : POLL_INTERVAL_MS;
  let client = null;
  let ownerWindow = 0;
  let rootWindow = 0;
  let atoms = null;
  let timer = null;
  let stopped = false;
  let ownsClipboard = false;
  let currentHash = "";
  let suppressedHash = "";
  let image = null;
  let imageBmp = null;
  let localImageChangedAt = 0;
  let claimAttempts = 0;
  let ready = false;
  let startPromise = null;
  let lastReadDiagnostic = "";
  let lastProcessedClipboardRevision = 0;
  let lastFocusActive = null;
  let focusCheckPromise = null;

  const diagnostic = (event, details = {}) => {
    if (!onDiagnostic) return;
    try { onDiagnostic({event, ...details}); } catch {}
  };

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const release = () => {
    if (!client || !ownerWindow || !atoms?.clipboard || !ownsClipboard) return;
    try { client.SetSelectionOwner(0, atoms.clipboard, 0); } catch {}
    ownsClipboard = false;
  };

  const x11FocusActive = async () => {
    if (!deferClaimUntilFocused || !client?.GetInputFocus) return true;
    if (focusCheckPromise) return focusCheckPromise;
    focusCheckPromise = new Promise(resolve => {
      try {
        client.GetInputFocus((error, result) => {
          if (error) return resolve(true);
          const focus = Number(result?.focus ?? 0);
          resolve(Boolean(focus > 1 && focus !== rootWindow && focus !== ownerWindow));
        });
      } catch {
        resolve(true);
      }
    }).finally(() => { focusCheckPromise = null; });
    return focusCheckPromise;
  };

  const sendSelectionNotify = (event, property) => {
    if (!client || !event) return;
    try {
      client.SendEvent(event.requestor, 0, 0, {
        name: "SelectionNotify",
        time: event.time,
        requestor: event.requestor,
        selection: event.selection,
        target: event.target,
        property: property || 0
      });
    } catch {}
  };

  const answerSelectionRequest = event => {
    if (!atoms || event.selection !== atoms.clipboard || !client) return;
    diagnostic("selection-request", {
      target:Number(event.target || 0),
      property:Number(event.property || 0),
      requestor:Number(event.requestor || 0)
    });
    const property = Number(event.property || event.target || 0);
    if (!property) return sendSelectionNotify(event, 0);
    try {
      if (event.target === atoms.targets) {
        client.ChangeProperty(0, event.requestor, property, client.atoms.ATOM, 32, [
          atoms.targets,
          atoms.imagePng,
          atoms.imageBmp,
          atoms.qtImage
        ]);
        sendSelectionNotify(event, property);
        diagnostic("selection-response", {target:"TARGETS", property});
        return;
      }
      if (event.target === atoms.imagePng && image) {
        client.ChangeProperty(0, event.requestor, property, atoms.imagePng, 8, image);
        sendSelectionNotify(event, property);
        diagnostic("selection-response", {target:"image/png", bytes:image.length, property});
        return;
      }
      if (event.target === atoms.imageBmp && imageBmp) {
        client.ChangeProperty(0, event.requestor, property, atoms.imageBmp, 8, imageBmp);
        sendSelectionNotify(event, property);
        diagnostic("selection-response", {target:"image/bmp", bytes:imageBmp.length, property});
        return;
      }
      if (event.target === atoms.qtImage && image) {
        // Qt accepts PNG as a standard image MIME payload even when its
        // private target is present in TARGETS; keep the same bounded bytes.
        client.ChangeProperty(0, event.requestor, property, atoms.qtImage, 8, image);
        sendSelectionNotify(event, property);
        diagnostic("selection-response", {target:"application/x-qt-image", bytes:image.length, property});
        return;
      }
      if ([atoms.utf8String, atoms.string, atoms.text, atoms.compoundText].includes(event.target)) {
        // This owner represents an image-only Windows clipboard payload. An
        // empty text success makes VcXsrv and Qt consumers prefer text over
        // the advertised image formats, after which VcXsrv mirrors that empty
        // text back to Windows and destroys the source image. Refuse text
        // explicitly so consumers continue with image/png or image/bmp.
        sendSelectionNotify(event, 0);
        diagnostic("selection-response", {target:"text-unsupported", property:0});
        return;
      }
    } catch {}
    sendSelectionNotify(event, 0);
  };

  const claimImage = nextImage => {
    if (!client || !ownerWindow || !atoms?.clipboard || !nextImage) return false;
    const nextHash = sha256(nextImage);
    image = nextImage;
    currentHash = nextHash;
    if (suppressedHash === nextHash && !ownsClipboard) return false;
    if (!ownsClipboard) {
      try {
        client.SetSelectionOwner(ownerWindow, atoms.clipboard, 0);
        ownsClipboard = true;
        claimAttempts += 1;
        diagnostic("claim", {bytes:nextImage.length, hash:nextHash.slice(0, 12), attempt:claimAttempts});
      } catch {
        diagnostic("claim-error", {bytes:nextImage.length, hash:nextHash.slice(0, 12)});
        return false;
      }
    }
    return true;
  };

  const refreshClipboard = async () => {
    if (stopped || !ready || (!readClipboardPng && !readClipboardFormats)) return;
    try {
      const focusActive = await x11FocusActive();
      if (lastFocusActive !== focusActive) {
        lastFocusActive = focusActive;
        diagnostic("focus-state", {active:focusActive});
      }
      if (!focusActive && ownsClipboard) release();
      const clipboardRevision = Math.max(0, Number(await readClipboardRevision?.() || 0));
      const ownershipRecoveryRequired = Boolean(focusActive && !ownsClipboard && currentHash && suppressedHash !== currentHash);
      if (clipboardRevision > 0 && clipboardRevision === lastProcessedClipboardRevision && !ownershipRecoveryRequired && (focusActive || !ownsClipboard)) return;
      const readResult = readClipboardFormats
        ? await readClipboardFormats()
        : {png:await readClipboardPng()};
      if (clipboardRevision > 0) lastProcessedClipboardRevision = clipboardRevision;
      const nextImage = validPng(readResult?.png);
      const nextBmp = validBmp(readResult?.bmp) || Buffer.alloc(0);
      if (!nextImage) {
        if (lastReadDiagnostic !== "empty") diagnostic("clipboard-empty");
        lastReadDiagnostic = "empty";
        // VcXsrv may briefly replace the Windows image with an empty text
        // clipboard while it observes our image/png selection owner. Keep
        // the last valid PNG through that feedback window so the owner can
        // be reclaimed without losing the payload.
        const transientLocalImage = Boolean(
          image
          && currentHash
          && localImageChangedAt
          && now() - localImageChangedAt <= LOCAL_CLIPBOARD_SETTLE_MS
        );
        if (transientLocalImage) {
          if (focusActive && !ownsClipboard && claimAttempts < MAX_SETTLE_CLAIMS) claimImage(image);
          return;
        }
        // A later X11 owner may have replaced our selection. Keep the cached
        // image only until the next local image arrives, but do not reclaim it
        // after the local settle window; that would overwrite remote copies.
        if (ownsClipboard) release();
        image = null;
        imageBmp = null;
        currentHash = "";
        suppressedHash = "";
        localImageChangedAt = 0;
        claimAttempts = 0;
        return;
      }
      const nextHash = sha256(nextImage);
      const readDiagnostic = `image:${nextHash.slice(0, 12)}:${nextImage.length}`;
      if (lastReadDiagnostic !== readDiagnostic) {
        diagnostic("clipboard-image", {bytes:nextImage.length, hash:nextHash.slice(0, 12), ownsClipboard});
        lastReadDiagnostic = readDiagnostic;
      }
      if (nextHash !== currentHash) {
        suppressedHash = "";
        localImageChangedAt = now();
        claimAttempts = 0;
        image = nextImage;
        currentHash = nextHash;
        imageBmp = nextBmp.length ? nextBmp : null;
        if (focusActive) claimImage(nextImage);
      } else if (!ownsClipboard && suppressedHash !== nextHash) {
        imageBmp = nextBmp.length ? nextBmp : imageBmp;
        if (focusActive) claimImage(nextImage);
      } else if (!ownsClipboard) {
        image = nextImage;
        imageBmp = nextBmp.length ? nextBmp : imageBmp;
      }
    } catch (error) {
      diagnostic("refresh-error", {message:String(error?.message || error || "unknown error").slice(0, 240)});
    }
  };

  const start = () => {
    if (startPromise) return startPromise;
    startPromise = new Promise(resolve => {
      if (!display || (!readClipboardPng && !readClipboardFormats) || stopped) {
        diagnostic("start-skipped", {display:Boolean(display), reader:Boolean(readClipboardPng || readClipboardFormats), stopped});
        return resolve(false);
      }
      let x11;
      try { x11 = x11Module || require("x11"); } catch (error) {
        diagnostic("module-error", {message:String(error?.message || error || "unknown error").slice(0, 240)});
        return resolve(false);
      }
      const auth = authCookie.length
        ? {name:"MIT-MAGIC-COOKIE-1", data:authCookie.toString("latin1")}
        : {name:"", data:""};
      try {
        client = x11.createClient({display, auth, shm:false}, async (error, displayInfo) => {
          if (error || !displayInfo?.client) {
            diagnostic("connect-error", {message:String(error?.message || error || "X11 client unavailable").slice(0, 240)});
            return resolve(false);
          }
          client = displayInfo.client;
          diagnostic("connected", {display});
          try {
            const root = displayInfo.screen?.[0]?.root;
            rootWindow = Number(root || 0);
            ownerWindow = client.AllocID();
            client.CreateWindow(ownerWindow, root, 0, 0, 1, 1, 0, 0, 0, 0, {});
            const [clipboard, targets, imagePng, imageBmpAtom, qtImage, utf8String, string, textAtom, compoundText] = await Promise.all([
              internAtom(client, "CLIPBOARD"),
              internAtom(client, "TARGETS"),
              internAtom(client, "image/png"),
              internAtom(client, "image/bmp"),
              internAtom(client, "application/x-qt-image"),
              internAtom(client, "UTF8_STRING"),
              internAtom(client, "STRING"),
              internAtom(client, "TEXT"),
              internAtom(client, "COMPOUND_TEXT")
            ]);
            atoms = {
              clipboard,
              targets,
              imagePng,
              imageBmp:imageBmpAtom,
              qtImage,
              utf8String,
              string,
              text:textAtom,
              compoundText
            };
            diagnostic("atoms-ready", {clipboard, targets, imagePng, imageBmp:imageBmpAtom, qtImage, utf8String, string, text:textAtom, compoundText, ownerWindow});
            client.on("event", event => {
              if (event?.name === "SelectionRequest") answerSelectionRequest(event);
              else if (event?.name === "SelectionClear" && event.selection === atoms?.clipboard && event.owner === ownerWindow) {
                ownsClipboard = false;
                const settlingLocalChange = currentHash
                  && now() - localImageChangedAt <= LOCAL_CLIPBOARD_SETTLE_MS
                  && claimAttempts < MAX_SETTLE_CLAIMS;
                suppressedHash = settlingLocalChange ? "" : currentHash;
                diagnostic("selection-clear", {
                  settlingLocalChange,
                  ownsClipboard:false,
                  hash:currentHash ? currentHash.slice(0, 12) : "",
                  claimAttempts
                });
              }
            });
            client.on("error", () => {});
            ready = true;
            diagnostic("ready", {ownerWindow});
            await refreshClipboard();
            timer = setInterval(() => { void refreshClipboard(); }, pollIntervalMs);
            timer.unref?.();
            resolve(true);
          } catch (error) {
            diagnostic("start-error", {message:String(error?.message || error || "unknown error").slice(0, 240)});
            resolve(false);
          }
        });
        client.on?.("error", error => diagnostic("client-error", {message:String(error?.message || error || "unknown error").slice(0, 240)}));
      } catch (error) {
        diagnostic("create-client-error", {message:String(error?.message || error || "unknown error").slice(0, 240)});
        resolve(false);
      }
    });
    return startPromise;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopTimer();
    release();
    try { if (ownerWindow && client) client.DestroyWindow(ownerWindow); } catch {}
    try { client?.close?.(); } catch {}
    try { client?.stream?.destroy?.(); } catch {}
    client = null;
    ownerWindow = 0;
    ready = false;
    diagnostic("stopped");
  };

  return {start, stop, refresh:refreshClipboard, isReady:() => ready};
}

module.exports = {
  MAX_IMAGE_BYTES,
  BMP_SIGNATURE,
  PNG_SIGNATURE,
  createX11ClipboardImageBridge,
  validBmp,
  validPng
};
