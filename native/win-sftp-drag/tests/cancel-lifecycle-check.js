"use strict";

const assert = require("node:assert/strict");
const { app } = require("electron");
const nativeDrag = require("..");

function waitForEvent(events, predicate, timeoutMs = 5000) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for native drag event: ${JSON.stringify(events)}`));
    }, timeoutMs);
    events.waiters.push(event => {
      if (!predicate(event)) return false;
      clearTimeout(timeout);
      resolve(event);
      return true;
    });
  });
}

async function main() {
  await app.whenReady();
  const probe = nativeDrag.probe();
  assert.equal(probe.available, true, probe.reason || "Windows native drag module is unavailable");

  const events = [];
  events.waiters = [];
  const result = nativeDrag.startDrag({
    items:[{
      id:"cancel-lifecycle",
      relativePath:"cancel-lifecycle.txt",
      size:1,
      contentUrl:"http://127.0.0.1:1/not-read"
    }],
    waitForActivation:true,
    armTimeoutMs:5000
  }, null, event => {
    events.push(event);
    events.waiters = events.waiters.filter(waiter => !waiter(event));
  });

  assert.equal(result.accepted, true);
  await waitForEvent(events, event => event.type === "ready");
  assert.equal(nativeDrag.cancelDrag(result.requestId), true);
  const terminal = await waitForEvent(
    events,
    event => ["cancelled", "completed", "error"].includes(event.type)
  );

  assert.equal(terminal.type, "cancelled");
  assert.equal(
    events.some(event => event.type === "contentError"),
    false,
    "Cancelling an armed drag must not be reported as a file-content error"
  );
  assert.equal(
    events.filter(event => ["cancelled", "completed", "error"].includes(event.type)).length,
    1,
    "Cancellation must produce exactly one terminal callback"
  );

  nativeDrag.probe();
  console.log("Windows SFTP native drag cancellation lifecycle check passed.");
}

main()
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
