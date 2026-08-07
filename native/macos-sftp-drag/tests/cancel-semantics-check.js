"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "addon.mm"), "utf8");
const types = fs.readFileSync(path.join(root, "index.d.ts"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

assert.match(
  source,
  /errorWithDomain:NSCocoaErrorDomain\s+code:NSUserCancelledError/,
  "Promise cancellation must use the Cocoa user-cancelled NSError"
);
assert.match(
  source,
  /errorWithDomain:@"com\.zmide\.terma\.sftp-drag"\s+code:1003/,
  "ordinary delivery failures must keep the Terma error domain"
);
assert.match(
  source,
  /for \(TDDragController \*candidate in \[gControllers reverseObjectEnumerator\]\)/,
  "cancelDrag(sessionId) must find controllers retained after the drag session ends"
);
assert.match(
  source,
  /cancelled = \[controller cancelPromiseWrites\]/,
  "cancelDrag must support Finder Promise cancellation after the AppKit drag ends"
);
assert.match(
  source,
  /if \(cancelled\) \{\s+completionHandler\(TDUserCancelledPromiseError\(\)\)/,
  "writes requested after cancellation must also finish as user-cancelled"
);
assert.equal(
  (source.match(/baseEvent:"cancelled"/g) || []).length,
  1,
  "the native controller must define a single cancelled terminal-event emission"
);
assert.match(types, /type: "cancelled"/);
assert.match(readme, /NSCocoaErrorDomain/);
assert.match(readme, /AbortSignal/);

console.log("macOS Promise 取消语义检查通过");
