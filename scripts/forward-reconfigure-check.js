"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sshSource = fs.readFileSync(path.join(root, "src", "ssh.ts"), "utf8");

async function main() {
  const {createForwardReconfigurationService} = require(path.join(root, "dist", "services", "forward-reconfiguration-service.js"));
  const calls = [];
  let stored = {id:7, connection_id:3, mode:"local", bind_host:"127.0.0.1", bind_port:6001, target_host:"127.0.0.1", target_port:80};
  const service = createForwardReconfigurationService({
    getForward:id => ({...stored, id}),
    updateForward:(id, data) => {
      calls.push(["update", id, data.bind_port]);
      stored = {...stored, ...data, id};
    },
    reconfigureForwardRuntime:async (id, applyConfiguration, restoreConfiguration) => {
      calls.push(["runtime", id]);
      applyConfiguration();
      assert.equal(stored.bind_port, 6002, "the new configuration must be applied inside the serialized runtime operation");
      restoreConfiguration();
      assert.equal(stored.bind_port, 6001, "the old configuration must remain available for rollback");
      return {ok:true, was_running:true, restarted:true, rolled_back:false};
    }
  });

  const result = await service.reconfigureForward(7, {...stored, bind_port:6002});
  assert.equal(result.restarted, true);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["runtime", 7],
    ["update", 7, 6002],
    ["update", 7, 6001]
  ]);
  assert.match(sshSource, /async function reconfigureForwardRuntime[\s\S]*return enqueueForwardOperation\(id,[\s\S]*await stopForwardRuntime\(id, \{preserveRestoreState:true\}\)[\s\S]*applyConfiguration\(\)[\s\S]*await performStartForwardInternal\(id, \{\}\)[\s\S]*restoreConfiguration\(\)/, "running edits must stop, update, restart, and roll back within one per-forward operation queue");
  assert.match(sshSource, /FORWARD_RECONFIGURE_ROLLED_BACK/, "a rolled-back restart must expose a stable error code");
  assert.match(sshSource, /FORWARD_RECONFIGURE_ROLLBACK_FAILED/, "a failed rollback must expose a distinct stable error code");

  console.log("PASS running forward edits restart atomically and retain rollback data");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
