const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sync-check-"));
  const repositoryRoot = path.join(__dirname, "..");
  process.env.TERMA_DATA_DIR = path.join(root, "data");
  const workspace = path.join(root, "workspace");

  try {
    fs.mkdirSync(path.join(workspace, ".git"), {recursive:true});
    fs.mkdirSync(path.join(workspace, "node_modules"));
    fs.mkdirSync(path.join(workspace, "src"));
    fs.writeFileSync(path.join(workspace, ".git", "config"), "ignored");
    fs.writeFileSync(path.join(workspace, "node_modules", "module.js"), "ignored");
    fs.writeFileSync(path.join(workspace, "src", "main.js"), "kept");
    fs.writeFileSync(path.join(workspace, "debug.log"), "custom ignored");
    fs.writeFileSync(path.join(workspace, "scratch.tmp"), "default ignored");
    const { syncTestHelpers } = require("../dist/sftp-sync");
    const syncSource = fs.readFileSync(path.join(repositoryRoot, "src", "sftp-sync.ts"), "utf8");
    assert.doesNotMatch(
      syncSource,
      /fs\.(?:readdirSync|statSync|readFileSync|mkdirSync|writeFileSync|utimesSync)\(/,
      "目录同步任务不得把本地磁盘操作放回共享 Node 事件循环"
    );
    assert.match(syncSource, /page_size:200, refresh:page === 1/, "目录同步必须复用首屏生成的远端目录快照");
    assert.match(syncSource, /listing\.total_pages/, "目录同步必须读取后端返回的完整页数");
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const items = await syncTestHelpers.localTree(workspace, syncTestHelpers.exclusionMatchers("*.log"));
    assert.deepEqual([...items.keys()], ["src/main.js"]);
    assert.equal(yielded, true, "本地目录扫描必须让出 Node 事件循环");
    await assert.rejects(
      syncTestHelpers.localTree(workspace, syncTestHelpers.exclusionMatchers(), () => true),
      /目录同步已取消/
    );
    assert.throws(() => syncTestHelpers.checkedLocalTarget(workspace, "../outside"), /越界/);
    assert.equal(syncTestHelpers.checkedLocalTarget(workspace, "src/main.js"), path.join(workspace, "src", "main.js"));
    const largePlan = {actions:Array.from({length:20000}, (_, index) => ({index, relative:`file-${index}`}))};
    const detailJob = syncTestHelpers.jobView({id:"scan-large", selected:[1], plan_result:largePlan});
    const summaryJob = syncTestHelpers.jobView({id:"scan-large", selected:[1], plan_result:largePlan}, {includePlanResult:false});
    assert.equal(detailJob.plan_result, largePlan, "单任务详情必须继续返回同步清单");
    assert.equal(summaryJob.plan_result, undefined, "任务轮询列表必须省略大型同步清单");
    assert.equal(summaryJob.has_plan_result, true, "任务摘要应保留同步清单存在标记");
    assert.equal(JSON.stringify(summaryJob).includes("file-19999"), false, "任务摘要序列化不得携带同步清单内容");

    const frontend = readFrontendDomain(repositoryRoot, "productivity");
    const tasks = readFrontendDomain(repositoryRoot, "sftp");
    assert.match(frontend, /生成变更清单/);
    assert.match(frontend, /上传本地版本/);
    assert.match(frontend, /selected_indexes/);
    assert.match(tasks, /retrySftpSyncJob/);
    assert.match(tasks, /exportSftpSyncResult/);
    console.log("SFTP 目录同步检查通过：异步目录扫描、事件循环让出、取消、排除规则、路径边界、冲突预览、任务重试和结果导出均已覆盖");
  } finally {
    try { require("../dist/db").closeDatabase(); } catch {}
    fs.rmSync(root, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
