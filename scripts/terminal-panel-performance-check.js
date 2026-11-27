"use strict";
const assert = require("node:assert/strict");
const {loadFrontendService} = require("./frontend-service-test-helper");
let clock = 10000, timers = new Map(), sequence = 0;
const {createPerformanceSampler} = loadFrontendService("frontend/src/features/terminal-panel/performance-sampler.ts", {
  setTimeout:(callback, delay) => {const id = ++sequence; timers.set(id, {callback, due:clock + delay}); return id;},
  clearTimeout:id => timers.delete(id)
});
async function advance(amount = 0) {
  clock += amount;
  for (const [id, timer] of [...timers]) if (timer.due <= clock) {timers.delete(id); timer.callback();}
  await new Promise(resolve => setImmediate(resolve));
}
(async () => {
  let calls = [], resolve;
  const sampler = createPerformanceSampler({now:() => clock, request:(id, signal) => {
    calls.push({id, signal}); return new Promise(done => {resolve = done;});
  }});
  sampler.watch("one", 1, false, () => {});
  await advance(); assert.equal(calls.length, 0, "restoring tabs cannot start sampling");
  sampler.watch("one", 1, true, () => {}); sampler.watch("two", 1, true, () => {});
  await advance(); assert.equal(calls.length, 1, "visible panes share a sample");
  sampler.watch("one", 1, false, () => {}); assert.equal(calls[0].signal.aborted, false);
  sampler.watch("two", 1, false, () => {}); assert.equal(calls[0].signal.aborted, true);
  resolve({supported:true, sampledAt:clock}); await advance(2000); assert.equal(calls.length, 1);
  sampler.watch("one", 1, true, () => {}); await advance(); assert.equal(calls.length, 2);
  resolve({supported:true, sampledAt:clock}); await advance();
  await advance(1999); assert.equal(calls.length, 2);
  await advance(1); assert.equal(calls.length, 3);
  resolve({supported:false, sampledAt:clock}); await advance(6000); await advance(6000);
  assert.equal(calls.length, 3, "unsupported systems stop polling");
  sampler.watch("one", 2, true, () => {}); await advance(); assert.equal(calls.at(-1).id, 2);
  sampler.release("one"); assert.equal(calls.at(-1).signal.aborted, true);
  sampler.dispose(); resolve({supported:true, sampledAt:clock}); await advance(10000);
  assert.equal(timers.size, 0);
  console.log("Panel performance shared sampling, two-second cadence, pause, restore, target switch and disposal checks passed.");
})().catch(error => {console.error(error); process.exitCode = 1;});
