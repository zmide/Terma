const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-automation-check-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
fs.mkdirSync(process.env.TERMA_DATA_DIR, {recursive:true});
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});

async function main() {
  const db = require("../dist/db");
  const automation = require("../dist/sftp-automations");
  const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sftp_automations','sftp_automation_runs','sftp_automation_baselines') ORDER BY name").map(row => row.name);
  assert.deepEqual(tables, ["sftp_automation_baselines", "sftp_automation_runs", "sftp_automations"]);
  assert.ok(db.all("PRAGMA table_info(sftp_automations)").some(column => column.name === "sort_order"));
  const base = new Date(2026, 8, 9, 10, 20, 0).getTime();
  const daily = automation.nextScheduledRun({frequency:"daily",hour:11,minute:0}, base);
  assert.equal(new Date(daily * 1000).getHours(), 11);
  assert.equal(new Date(daily * 1000).getDate(), 9);
  const weekly = automation.nextScheduledRun({frequency:"weekly",weekday:new Date(base).getDay(),hour:9,minute:0}, base);
  assert.ok(weekly * 1000 > base);
  const once = automation.nextScheduledRun({frequency:"once",at_ms:base + 60000}, base);
  assert.equal(once, Math.floor((base + 60000) / 1000));
  assert.equal(automation.nextScheduledRun({frequency:"every_second",interval:5}, base), Math.floor((base + 5000) / 1000));
  assert.equal(automation.nextScheduledRun({frequency:"every_minute",interval:2}, base), Math.floor((base + 120000) / 1000));
  assert.equal(automation.nextScheduledRun({frequency:"every_hour",interval:3}, base), Math.floor((base + 10800000) / 1000));
  assert.ok(automation.nextScheduledRun({frequency:"daily",interval:2,hour:11,minute:0}, base));
  assert.ok(automation.nextScheduledRun({frequency:"monthly",interval:2,day:15,hour:11,minute:0}, base));
  assert.ok(automation.nextScheduledRun({frequency:"yearly",interval:1,month:10,day:9,hour:11,minute:0}, base));
  assert.equal(automation.nextScheduledRun({frequency:"countdown",countdown_seconds:30}, base), Math.floor((base + 30000) / 1000));
  assert.equal(automation.nextScheduledRun({frequency:"half_hour",interval:1,start_at_ms:base}, base), Math.floor((base + 1800000) / 1000));
  assert.equal(new Date(automation.nextScheduledRun({frequency:"half_hour",half_hour_slots:[21],start_at_ms:base}, base) * 1000).getHours(), 10);
  assert.equal(new Date(automation.nextScheduledRun({frequency:"half_hour",half_hour_slots:[21],start_at_ms:base}, base) * 1000).getMinutes(), 30);
  assert.equal(automation.nextScheduledRun({frequency:"half_hour",half_hour_slots:[],start_at_ms:base}, base), null);
  assert.ok(automation.nextScheduledRun({frequency:"cron",cron:"*/5 * * * *"}, base));
  const cronPreview = automation.previewCronRuns("*/5 * * * *", base, 3);
  assert.equal(cronPreview.length, 3);
  assert.ok(cronPreview[0] > base && cronPreview[1] > cronPreview[0] && cronPreview[2] > cronPreview[1]);
  assert.deepEqual(automation.previewCronRuns("100 0 0 0 0", base, 3), []);
  assert.equal(automation.nextAutomationRun({kind:"sync",enabled:true,trigger_mode:"manual",options:{}}, base), null);
  assert.equal(automation.nextAutomationRun({kind:"sync",enabled:true,trigger_mode:"interval",options:{interval_minutes:5}}, base), Math.floor((base + 300000) / 1000));
  assert.equal(automation.nextAutomationRun({kind:"sync",enabled:true,trigger_mode:"continuous",options:{}}, base), Math.floor((base + 10000) / 1000));
  assert.equal(automation.nextAutomationRun({kind:"sync",enabled:true,trigger_mode:"schedule",schedule:{frequency:"every_hour",interval:2}}, base), Math.floor((base + 7200000) / 1000));
  assert.equal(automation.nextAutomationRun({kind:"sync",enabled:true,trigger_mode:"continuous",schedule:{frequency:"realtime",start_at_ms:base+60000}}, base), Math.floor((base + 60000) / 1000));
  assert.equal(automation.__test.normalizeRelative("a\\b"), "a/b");
  assert.equal(automation.__test.localTarget("C:/workspace", "src/main.js").replace(/\\/g, "/"), "C:/workspace/src/main.js");
  assert.throws(() => automation.__test.localTarget("C:/workspace", "../outside"), /越界/);
  const repository = require("../dist/sftp-automation-repository");
  assert.equal(repository.inferAutomationKind({kind:"auto",direction:"upload",schedule:{frequency:"daily"}}), "transfer");
  assert.equal(repository.inferAutomationKind({kind:"auto",direction:"bidirectional",schedule:{frequency:"daily"}}), "sync");
  assert.equal(repository.inferAutomationKind({kind:"auto",direction:"download",schedule:{frequency:"realtime"}}), "sync");
  assert.equal(repository.inferAutomationKind({kind:"auto",direction:"download",schedule:{frequency:"daily"},options:{propagate_deletes:true}}), "sync");
  assert.equal(repository.inferAutomationKind({kind:"auto",direction:"upload",schedule:{frequency:"daily"}}, {kind:"sync",direction:"bidirectional",schedule:{}}), "sync");
  assert.equal(repository.normalizeSchedule({frequency:"legacy_manual"}).frequency, "legacy_manual");
  const normalized = repository.normalizeSchedule({frequency:"every_second",interval:2,start_at_ms:base,weekdays:[1,3]});
  assert.equal(normalized.frequency, "every_second");
  assert.equal(normalized.interval, 2);
  assert.deepEqual(normalized.weekdays, [1, 3]);
  const normalizedOptions = repository.normalizeOptions({}, "transfer");
  assert.equal(normalizedOptions.history_limit, 300);
  assert.equal(normalizedOptions.compare_content, true);
  assert.equal(normalizedOptions.propagate_deletes, false);
  assert.equal(repository.getBaseline(99999), null);
  const connection = db.run("INSERT INTO connections(name,ssh_host,ssh_user,created_at,updated_at) VALUES(?,?,?,?,?)", ["test","127.0.0.1","test",Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)]);
  const automationRow = db.run("INSERT INTO sftp_automations(kind,name,connection_id,local_path,remote_path,direction,trigger_mode,schedule_json,options_json,enabled,missed_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["sync","test",Number(connection.lastInsertRowid),process.cwd(),".","bidirectional","manual","{}","{}",0,"run_once",Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)]);
  repository.setScheduleState(Number(automationRow.lastInsertRowid), {next_run_at:Math.floor(base/1000)});
  assert.equal(repository.getAutomation(Number(automationRow.lastInsertRowid)).next_run_at, Math.floor(base/1000));
  repository.setScheduleState(Number(automationRow.lastInsertRowid), {next_run_at:null});
  assert.equal(repository.getAutomation(Number(automationRow.lastInsertRowid)).next_run_at, null);
  const compatibilityRoot = path.join(root, "compatibility");
  fs.mkdirSync(compatibilityRoot, {recursive:true});
  for (let index = 0; index < 305; index += 1) {
    const runId = repository.createRun(Number(automationRow.lastInsertRowid), "manual");
    repository.finishRun(runId, "done", {processed:1,transferred:1,deleted:0,skipped:0,conflicts:0,failed:0,details:[{path:`item-${index}.txt`,action:"uploaded"}]});
  }
  const runPage = repository.listRunsPage(Number(automationRow.lastInsertRowid), 2);
  assert.equal(runPage.total, 300);
  assert.equal(runPage.page_size, 100);
  assert.equal(runPage.total_pages, 3);
  assert.equal(runPage.items.length, 100);
  assert.equal(runPage.history_limit, 300);
  const reducedHistory = repository.setHistoryLimit(Number(automationRow.lastInsertRowid), 100);
  assert.equal(reducedHistory.history_limit, 100);
  assert.equal(repository.listRunsPage(Number(automationRow.lastInsertRowid), 1).total, 100);
  assert.equal(repository.clearRuns(Number(automationRow.lastInsertRowid)).deleted, 100);
  assert.equal(repository.listRunsPage(Number(automationRow.lastInsertRowid), 1).total, 0);
  const noChangeAutomation = repository.saveAutomation({kind:"sync",name:"no-change compaction",connection_id:Number(connection.lastInsertRowid),local_path:compatibilityRoot,remote_path:"no-change",direction:"bidirectional",trigger_mode:"manual",enabled:false,options:{notify:false}});
  for (let index = 0; index < 3; index += 1) {
    const runId = repository.createRun(noChangeAutomation.id, "schedule");
    repository.finishRun(runId, "done", {processed:4,transferred:0,deleted:0,skipped:4,conflicts:0,failed:0,details:[{path:`same-${index}.txt`,action:"skipped",reason:"unchanged"}]});
  }
  let compactedRuns = repository.listRunsPage(noChangeAutomation.id, 1);
  assert.equal(compactedRuns.total, 1);
  assert.equal(compactedRuns.items[0].summary.no_change_streak, 3);
  const changedRun = repository.createRun(noChangeAutomation.id, "schedule");
  repository.finishRun(changedRun, "done", {processed:1,transferred:1,deleted:0,skipped:0,conflicts:0,failed:0,details:[{path:"changed.txt",action:"uploaded"}]});
  const nextNoChange = repository.createRun(noChangeAutomation.id, "schedule");
  repository.finishRun(nextNoChange, "done", {processed:4,transferred:0,deleted:0,skipped:4,conflicts:0,failed:0,details:[{path:"same-again.txt",action:"skipped",reason:"unchanged"}]});
  compactedRuns = repository.listRunsPage(noChangeAutomation.id, 1);
  assert.equal(compactedRuns.total, 3);
  assert.equal(compactedRuns.items[0].summary.no_change_streak, 1);
  assert.equal(compactedRuns.items[2].summary.no_change_streak, 3);
  repository.clearRuns(noChangeAutomation.id);
  const legacyStartedAt = Math.floor(Date.now() / 1000) - 10;
  const insertLegacyRun = (suffix, offset, summary, status="done", error="") => db.run(
    "INSERT INTO sftp_automation_runs(run_id,automation_id,status,reason,started_at,finished_at,summary_json,error) VALUES(?,?,?,?,?,?,?,?)",
    [`legacy-${suffix}`,noChangeAutomation.id,status,"schedule",legacyStartedAt + offset,legacyStartedAt + offset,JSON.stringify(summary),error]
  );
  insertLegacyRun("quiet-1", 1, {processed:2,transferred:0,deleted:0,skipped:2,conflicts:0,failed:0});
  insertLegacyRun("quiet-2", 2, {processed:2,transferred:0,deleted:0,skipped:2,conflicts:0,failed:0});
  insertLegacyRun("changed", 3, {processed:1,transferred:1,deleted:0,skipped:0,conflicts:0,failed:0});
  insertLegacyRun("quiet-3", 4, {processed:2,transferred:0,deleted:0,skipped:2,conflicts:0,failed:0});
  insertLegacyRun("quiet-4", 5, {processed:2,transferred:0,deleted:0,skipped:2,conflicts:0,failed:0});
  insertLegacyRun("unknown", 6, {});
  compactedRuns = repository.listRunsPage(noChangeAutomation.id, 1);
  assert.equal(compactedRuns.total, 4);
  assert.deepEqual(compactedRuns.items.map(item => item.summary.no_change_streak || 0), [0,2,0,2]);
  const sftp = require("../dist/sftp");
  assert.match(sftp.buildDeleteRemoteFileCommand("safe/file.txt").command, /! -f/);
  assert.throws(() => sftp.buildDeleteRemoteFileCommand("/"), /不能删除根目录/);
  const state = {local:{"a.txt":{size:1,mtime:2}},remote:{}};
  const checksum = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
  const baseline = repository.saveBaseline(Number(automationRow.lastInsertRowid), state, checksum);
  assert.match(baseline.checksum, /^[a-f0-9]{64}$/);
  assert.equal(repository.getBaseline(Number(automationRow.lastInsertRowid)).state.local["a.txt"].size, 1);
  repository.deleteBaseline(Number(automationRow.lastInsertRowid));
  const compatibleSync = repository.saveAutomation({kind:"sync",name:"legacy sync",connection_id:Number(connection.lastInsertRowid),local_path:compatibilityRoot,remote_path:"legacy",direction:"bidirectional",trigger_mode:"manual",enabled:false,options:{conflict:"skip",notify:false}});
  const compatibleState = {local:{},remote:{},meta:{fingerprint:repository.automationLegacyFingerprint(compatibleSync),version:1}};
  repository.saveBaseline(compatibleSync.id, compatibleState, crypto.createHash("sha256").update(JSON.stringify(compatibleState)).digest("hex"));
  const scheduledSync = repository.saveAutomation({kind:"auto",schedule:{frequency:"cron",cron:"*/5 * * * *"},trigger_mode:"schedule",options:{notify:true}}, compatibleSync.id);
  assert.equal(scheduledSync.kind, "sync");
  assert.equal(scheduledSync.trigger_mode, "schedule");
  assert.equal(scheduledSync.schedule.frequency, "cron");
  assert.equal(scheduledSync.options.notify, true);
  assert.equal(repository.getBaseline(compatibleSync.id).state.meta.fingerprint, repository.automationRuleFingerprint(scheduledSync));
  const changedRules = repository.saveAutomation({kind:"auto",direction:"upload"}, compatibleSync.id);
  assert.equal(changedRules.kind, "sync");
  assert.notEqual(repository.getBaseline(compatibleSync.id).state.meta.fingerprint, repository.automationRuleFingerprint(changedRules));
  const stableOrder = repository.listAutomations().map(item => Number(item.id));
  repository.setScheduleState(Number(automationRow.lastInsertRowid), {next_run_at:Math.floor(base / 1000),last_status:"running"});
  assert.deepEqual(repository.listAutomations().map(item => Number(item.id)), stableOrder);
  const reordered = [...stableOrder].reverse();
  assert.deepEqual(repository.reorderAutomations(reordered), {ok:true,ids:reordered});
  assert.deepEqual(repository.listAutomations().map(item => Number(item.id)), reordered);
  assert.deepEqual(repository.listAutomations().map(item => Number(item.sort_order)), reordered.map((_, index) => index + 1));
  assert.throws(() => repository.reorderAutomations(reordered.slice(1)), /任务列表已变化/);
  assert.throws(() => repository.reorderAutomations([...reordered, 999999]), /任务列表已变化/);
  const frontend = fs.readFileSync(path.join(__dirname, "..", "public", "app-sftp-automations.js"), "utf8");
  assert.match(frontend, /installSftpAutomationQuickAction/);
  assert.match(frontend, /sftpAutomationQuickButton/);
  automation.startSftpAutomationScheduler();
  automation.stopSftpAutomationScheduler();
  console.log("SFTP 传输与同步任务检查通过：统一周期、后端类型推断、实时/计划安全同步、路径保护、桌面入口和调度器生命周期均已覆盖");
  db.closeDatabase();
}

main().catch(error => {
  console.error(error);
  try { require("../dist/db").closeDatabase(); } catch {}
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(root, {recursive:true,force:true}); } catch {}
});
