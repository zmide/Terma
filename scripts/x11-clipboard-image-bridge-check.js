"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  MAX_IMAGE_BYTES,
  PNG_SIGNATURE,
  createX11ClipboardImageBridge,
  validPng
} = require("../desktop/x11-clipboard-image-bridge");

function png(seed = 1) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from([seed, seed + 1, seed + 2, seed + 3])]);
}

function mockX11() {
  const client = new EventEmitter();
  const atomIds = {
    CLIPBOARD:101,
    TARGETS:102,
    "image/png":103,
    "image/bmp":104,
    "application/x-qt-image":105,
    UTF8_STRING:106,
    STRING:107,
    TEXT:108,
    COMPOUND_TEXT:109
  };
  const calls = {owners:[], changes:[], events:[], destroyed:[]};
  client.atoms = {ATOM:4};
  client.AllocID = () => 77;
  client.CreateWindow = () => {};
  client.DestroyWindow = value => calls.destroyed.push(value);
  client.InternAtom = (_onlyIfExists, name, callback) => callback(null, atomIds[name]);
  client.SetSelectionOwner = (owner, selection, time) => calls.owners.push({owner, selection, time});
  client.ChangeProperty = (...args) => calls.changes.push(args);
  client.SendEvent = (...args) => calls.events.push(args);
  client.stream = {destroy() {}};
  return {
    calls,
    client,
    module:{
      createClient(options, callback) {
        assert.equal(options.display, "127.0.0.1:9.0");
        assert.equal(options.auth.name, "MIT-MAGIC-COOKIE-1");
        queueMicrotask(() => callback(null, {client, screen:[{root:88}]}));
        return client;
      }
    }
  };
}

async function run() {
  assert.deepEqual(validPng(png(1)), png(1));
  assert.equal(validPng(Buffer.from("not-png")), null);
  assert.equal(validPng(Buffer.alloc(MAX_IMAGE_BYTES + 1)), null);

  let clipboardImage = png(10);
  let clock = 1000;
  const mock = mockX11();
  const bridge = createX11ClipboardImageBridge({
    display:"127.0.0.1:9.0",
    authCookie:Buffer.alloc(16, 7),
    readClipboardPng:() => clipboardImage,
    now:() => clock,
    x11Module:mock.module
  });
  assert.equal(await bridge.start(), true);
  assert.equal(bridge.isReady(), true);
  assert.deepEqual(mock.calls.owners.at(-1), {owner:77, selection:101, time:0});

  mock.client.emit("event", {
    name:"SelectionRequest",
    time:1,
    owner:77,
    requestor:900,
    selection:101,
    target:102,
    property:901
  });
  assert.deepEqual(mock.calls.changes.at(-1), [0, 900, 901, 4, 32, [102, 103, 104, 105]]);
  assert.equal(mock.calls.events.at(-1)[3].property, 901);

  const changesBeforeTextRequest = mock.calls.changes.length;
  mock.client.emit("event", {
    name:"SelectionRequest",
    time:2,
    owner:77,
    requestor:905,
    selection:101,
    target:106,
    property:906
  });
  assert.equal(mock.calls.changes.length, changesBeforeTextRequest, "image-only clipboard must not claim an empty text conversion succeeded");
  assert.equal(mock.calls.events.at(-1)[3].property, 0);

  mock.client.emit("event", {
    name:"SelectionRequest",
    time:3,
    owner:77,
    requestor:910,
    selection:101,
    target:103,
    property:911
  });
  assert.deepEqual(mock.calls.changes.at(-1).slice(0, 5), [0, 910, 911, 103, 8]);
  assert.deepEqual(mock.calls.changes.at(-1)[5], clipboardImage);

  const claimsBeforeSettleClear = mock.calls.owners.length;
  mock.client.emit("event", {name:"SelectionClear", owner:77, selection:101});
  await bridge.refresh();
  assert.ok(mock.calls.owners.length > claimsBeforeSettleClear, "VcXsrv's competing claim immediately after a Windows clipboard change must be recovered");

  clock += 30000 + 1;
  const claimsBeforeRemoteClear = mock.calls.owners.length;
  mock.client.emit("event", {name:"SelectionClear", owner:77, selection:101});
  await bridge.refresh();
  assert.equal(mock.calls.owners.length, claimsBeforeRemoteClear, "an unchanged Windows image must not steal ownership back from a later remote X11 copy");

  clipboardImage = png(20);
  await bridge.refresh();
  assert.deepEqual(mock.calls.owners.at(-1), {owner:77, selection:101, time:0});
  assert.ok(mock.calls.owners.length > claimsBeforeRemoteClear);

  bridge.stop();
  assert.equal(bridge.isReady(), false);
  assert.deepEqual(mock.calls.destroyed, [77]);
  console.log("X11 图片剪贴板桥接检查通过：PNG 校验、selection owner、TARGETS/image/png 应答和远端所有权保护均有效");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
