"use strict";
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {createHostPerformanceService, parseHostPerformance, HOST_PERFORMANCE_COMMAND} = require("../dist/services/host-performance-service");
const {handleHostPerformanceRoutes} = require("../dist/routes/host-performance-routes");
const {createSshCommandLimits} = require("../dist/infrastructure/ssh-command-limits");
const {detectMacShellIntegration,MACOS_SHELL_INTEGRATION} = require("../dist/terminal-shell-integration");
const output = cpu => `TERMA_PERF_V1
CPU
cpu ${cpu} 0 20 100 10 0 0 0 0 0
MEM
MemTotal: 4096 kB
MemAvailable: 1024 kB
LOAD
0.1 0.2 0.3 2/100 55
PROC
11 2.5 300 worker
22 1.0 100 service
11 2.5 300 worker
END
`;
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  for(const [value,expected] of [["Darwin\n",MACOS_SHELL_INTEGRATION],["Linux\n",""],["x".repeat(257),""]]){
    const stream=Object.assign(new EventEmitter(),{close(){this.emit("close");}});
    const result=detectMacShellIntegration({exec(command,callback){assert.equal(command,"uname -s");callback(null,stream);queueMicrotask(()=>{stream.emit("data",value);stream.emit("close");});}});
    assert.equal(await result,expected);
  }
  assert.equal(await detectMacShellIntegration({exec(_command,callback){callback(Error("denied"));}}),"");
  assert.equal(await detectMacShellIntegration({exec(){throw Error("closed");}}),"");
  const first = parseHostPerformance(output(100), 10000);
  assert.equal(first.snapshot.cpuPercent, null);
  assert.equal(first.snapshot.processes.length, 2);
  assert.equal(first.snapshot.memory.usedBytes, 3072 * 1024);
  assert.equal(parseHostPerformance(output(120), 12000, first.cpu).snapshot.cpuPercent, 100);
  assert.equal(parseHostPerformance("TERMA_PERF_V1\nUNSUPPORTED\n", 1).snapshot.supported, false);
  const mac = `TERMA_PERF_V1
DARWIN
CPU
CPU usage: 10.00% user, 5.00% sys, 85.00% idle
MEM
12884901888
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 10000.
Pages inactive: 20000.
Pages speculative: 30000.
LOAD
{ 1.25 2.50 3.75 }
PROC
42 12.5 300 zsh
42 12.5 300 zsh
END`;
  const darwin = parseHostPerformance(mac, 12345);
  assert.equal(darwin.snapshot.cpuPercent, 15);
  assert.equal(darwin.snapshot.memory.usedBytes, 12884901888 - 60000 * 16384);
  assert.deepEqual(darwin.snapshot.load, [1.25, 2.5, 3.75]);
  assert.equal(darwin.snapshot.processes.length, 1);
  assert.equal(darwin.cpu, undefined, "macOS samples do not inherit Linux CPU counters");
  for (const invalid of [mac.replace("85.00%", "185.00%"), mac.replace("16384 bytes", "0 bytes"), mac.replace("Pages free: 10000.", "Pages free: NaN.")])
    assert.throws(() => parseHostPerformance(invalid, 1));
  for (const text of ["bad", output(1).replace("4096", "-1"), output(1).replace("0.1 0.2 0.3", "NaN 0 0"), "x".repeat(65537)])
    assert.throws(() => parseHostPerformance(text, 1));
  assert.doesNotMatch(HOST_PERFORMANCE_COMMAND, /kill|cmdline|args=|sudo/);
  let stopped;
  const controller = new AbortController(), guard = createSshCommandLimits({signal:controller.signal, maxOutputBytes:4}, error => {stopped = error;});
  assert.equal(guard.accept("中"), true);
  assert.equal(guard.accept("ab"), false);
  assert.equal(stopped.code, "SSH_OUTPUT_LIMIT");
  guard.dispose(); controller.abort();
  assert.equal(stopped.code, "SSH_OUTPUT_LIMIT");
  let time = 10000, calls = 0, pending, signal, rejectCommand;
  const service = createHostPerformanceService({now:() => time, run:(_connection, command, timeout, options) => {
    calls++; signal = options.signal;
    assert.equal(command, HOST_PERFORMANCE_COMMAND); assert.equal(timeout, 8000); assert.equal(options.maxOutputBytes, 65536);
    return new Promise((resolve, reject) => {pending = resolve; rejectCommand = reject;});
  }});
  const connection = {id:1, ssh_host:"review.test"};
  const a = new AbortController(), b = new AbortController();
  const one = service.sample(connection, a.signal), two = service.sample(connection, b.signal);
  assert.equal(calls, 1);
  a.abort(); await assert.rejects(one, {name:"AbortError"});
  assert.equal(signal.aborted, false);
  pending({status:0, stdout:output(100)});
  await two;
  await service.sample(connection); assert.equal(calls, 1, "samples within two seconds share cached snapshot");
  time += 2000;
  const failed = service.sample(connection); rejectCommand(Error("private command details"));
  await assert.rejects(failed);
  await assert.rejects(service.sample(connection)); assert.equal(calls, 2, "failed samples keep backoff without presenting stale success");
  time += 2000;
  const c = new AbortController(), canceled = service.sample(connection, c.signal);
  c.abort(); await assert.rejects(canceled, {name:"AbortError"}); assert.equal(signal.aborted, true);
  await tick();
  const changed = service.sample({...connection, ssh_host:"changed.test"});
  pending({status:0, stdout:output(140)}); assert.equal((await changed).cpuPercent, null, "changed host cannot inherit previous CPU baseline");
  service.dispose();

  let active = 0;
  const busy = createHostPerformanceService({run:(_c, _command, _t, options) => {
    active++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(Error(), {name:"AbortError"})), {once:true}));
  }});
  const jobs = Array.from({length:8}, (_, index) => busy.sample({id:index + 1}).catch(() => {}));
  assert.equal(active, 8); await assert.rejects(busy.sample({id:9}), {code:"PERFORMANCE_BUSY"});
  busy.dispose(); await Promise.all(jobs);

  const req = Object.assign(new EventEmitter(), {method:"GET"});
  const res = Object.assign(new EventEmitter(), {destroyed:false});
  let authorized = false, unlocked = false, sampled = false, reply;
  const port = {
    requireEncryptionUnlocked:() => {unlocked = true;},
    authorizeConnection:(_request, id) => {authorized = true; assert.equal(unlocked, true); return {id};},
    sample:async c => {sampled = true; assert.equal(authorized, true); return {id:c.id};},
    sendJson:(_response, value, status = 200) => {reply = {value, status};}
  };
  assert.equal(await handleHostPerformanceRoutes(req, res, "/api/connections/1/host-performance", port), true);
  assert.deepEqual(reply, {value:{id:1}, status:200}); assert.equal(sampled, true);
  assert.equal(req.listenerCount("aborted"), 0); assert.equal(res.listenerCount("close"), 0);
  await assert.rejects(handleHostPerformanceRoutes(req, res, "/api/connections/1/host-performance",
    {...port, requireEncryptionUnlocked:() => {throw Error("locked");}}), /locked/);
  await assert.rejects(handleHostPerformanceRoutes(req, res, "/api/connections/1/host-performance",
    {...port, authorizeConnection:() => {throw Error("forbidden");}}), /forbidden/);
  await handleHostPerformanceRoutes(req, res, "/api/connections/1/host-performance",
    {...port, sample:async () => {throw Error("secret remote stderr");}});
  assert.deepEqual(reply, {value:{code:"PERFORMANCE_UNAVAILABLE"}, status:502});
  for (const path of ["/api/connections/0/host-performance", "/api/connections/-1/host-performance", "/api/connections/1/host-performance/evil"])
    assert.equal(await handleHostPerformanceRoutes(req, res, path, port), false);
  console.log("Host performance parsing, bounded shared sampling, cancellation and authorized route checks passed.");
})().catch(error => {console.error(error); process.exitCode = 1;});
