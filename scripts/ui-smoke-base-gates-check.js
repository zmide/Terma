const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");
const {groups, smokeScenarios} = require("./ui-smoke-groups");

const filename = path.join(__dirname, "ui-smoke-harness.js");
const source = fs.readFileSync(filename, "utf8");
const entry = "main().catch(error => {";
assert.equal(source.split(entry).length, 2);
const executable = source.replace(entry, "globalThis.completion = main().catch(error => {");
let checks = 1;
function equal(actual, expected) {
  assert.deepEqual(actual, expected);
  checks++;
}

async function run(scenario, failedScenario, baseOnly = true, group = "") {
  const runs = [];
  const messages = [];
  let stopped = false;
  const processFixture = {
    execPath: process.execPath,
    platform: process.platform,
    env: {TERMA_UI_BASE_ONLY: baseOnly ? "1" : "", TERMA_UI_GROUP:group},
    argv: ["node", filename, ...(scenario ? [scenario] : [])],
    exitCode: 0
  };
  function spawn(_program, arguments_, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = () => {stopped = true; child.exitCode = 0; child.emit("close", 0);};
    if (arguments_[0].endsWith("ui-smoke-electron.js")) {
      const name = options.env.TERMA_UI_SCENARIO || "base";
      runs.push({name, profile: options.env.TERMA_UI_USER_DATA});
      queueMicrotask(() => child.emit("close", name === failedScenario ? 1 : 0));
    }
    return child;
  }
  const context = {
    __dirname,
    process: processFixture,
    console: {log(){}, error: error => messages.push(String(error)), warn: message => messages.push(message)},
    setTimeout, clearTimeout, AbortSignal,
    fetch: async () => ({ok: true}),
    require: name => name === "electron" ? "fixture-electron" :
      name === "node:child_process" ? {spawn} : require(name)
  };
  vm.runInNewContext(executable, context, {filename});
  await context.completion;
  return {runs, stopped, exitCode: processFixture.exitCode, messages};
}

(async () => {
  for (const scenario of ["", "base"]) {
    const result = await run(scenario);
    equal(result.runs.map(item => item.name), ["base", "m8-efficiency", "m6-automations"]);
    equal(new Set(result.runs.map(item => item.profile)).size, 3);
    equal(result.exitCode, 0);
    equal(result.stopped, true);
  }
  const standalone = await run("settings");
  equal(standalone.runs.map(item => item.name), ["settings"]);
  equal(standalone.exitCode, 0);
  equal(standalone.stopped, true);
  const complete = await run("", undefined, false);
  equal(complete.runs.filter(item => item.name === "m8-efficiency").length, 1);
  equal(complete.runs.filter(item => item.name === "m6-automations").length, 1);
  equal(complete.exitCode, 0);
  equal(complete.stopped, true);
  equal(complete.runs.map(item => item.name), smokeScenarios());
  equal(new Set(complete.runs.map(item => item.name)).size, 39);
  for (const [group, expected] of Object.entries(groups)) {
    const result = await run("", undefined, false, group);
    equal(result.runs.map(item => item.name), expected);
    equal(result.exitCode, 0);
    equal(new Set(result.runs.map(item => item.profile)).size, expected.length);
    const failure = await run("", expected[0], false, group);
    equal(failure.runs.map(item => item.name), [expected[0]]);
    equal(failure.exitCode, 1);
    equal(failure.stopped, true);
  }
  const invalid = await run("", undefined, false, "unknown");
  equal(invalid.runs.length, 0);
  equal(invalid.exitCode, 1);
  const ambiguous = await run("settings", undefined, false, "files");
  equal(ambiguous.runs.length, 0);
  equal(ambiguous.exitCode, 1);
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/regression.yml"), "utf8");
  const matrixGroups = workflow.match(/group: \[([a-z, ]+)\]/)?.[1].split(",").map(value => value.trim());
  equal(matrixGroups, Object.keys(groups));
  assert.match(workflow, /name: Ubuntu \/ Electron UI smoke\s+if: always\(\)\s+needs: ui-scenarios/);
  assert.match(workflow, /UI_RESULT: \$\{\{ needs\.ui-scenarios\.result \}\}/);
  assert.match(workflow, /run: test "\$UI_RESULT" = success/);
  for (const [failed, expected] of [
    ["base", ["base"]],
    ["m8-efficiency", ["base", "m8-efficiency"]],
    ["m6-automations", ["base", "m8-efficiency", "m6-automations"]]
  ]) {
    const result = await run("base", failed);
    equal(result.runs.map(item => item.name), expected);
    equal(result.exitCode, 1);
    equal(result.stopped, true);
    equal(result.messages.some(message => message.includes("退出码 1")), true);
  }
  console.log(`Base smoke gate checks passed (${checks} assertions)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
