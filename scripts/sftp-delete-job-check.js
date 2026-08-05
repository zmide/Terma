const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { Server } = require("ssh2");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-sftp-delete-job-check-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TUNNELDESK_DATA_DIR, { recursive:true });
fs.mkdirSync(process.env.TUNNELDESK_SSH_DIR, { recursive:true });
const { trustTestHost } = require("./ssh-host-trust-test-helper");

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength:2048 });
const hostKey = privateKey.export({ type:"pkcs1", format:"pem" });
const commands = [];
const sshServer = new Server({ hostKeys:[hostKey] }, client => {
  client.on("authentication", context => context.accept());
  client.on("ready", () => client.on("session", accept => {
    const session = accept();
    session.on("exec", (acceptExec, _reject, info) => {
      const stream = acceptExec();
      const command = String(info?.command || "");
      const markers = [...new Set(command.match(/__TUNNELDESK_DELETE_[0-9a-f]{24}__:\d+/g) || [])];
      commands.push(command);
      let index = 0;
      const sendNext = () => {
        if (index >= markers.length) {
          if (command.includes("cancel-me")) return;
          if (command.includes("fail-me")) {
            stream.stderr.write("simulated delete failure");
            stream.exit(1);
          } else {
            stream.exit(0);
          }
          stream.end();
          return;
        }
        if (command.includes("fail-me") && index >= 1) {
          stream.stderr.write("simulated delete failure");
          stream.exit(1);
          stream.end();
          return;
        }
        if (command.includes("cancel-me") && index >= 1) return;
        const marker = `${markers[index]}\n`;
        index += 1;
        try {
          stream.write(marker.slice(0, 11));
          setImmediate(() => {
            try { stream.write(marker.slice(11)); } catch {}
            setImmediate(sendNext);
          });
        } catch {}
      };
      sendNext();
    });
  }));
});

function listen() {
  return new Promise((resolve, reject) => sshServer.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForJob(jobs, id, expectedStatus) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (job?.status === expectedStatus) return job;
    if (job && ["done", "failed", "cancelled"].includes(job.status) && job.status !== expectedStatus) {
      throw new Error(`delete job reached ${job.status}, expected ${expectedStatus}: ${job.error || job.stderr || ""}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`delete job did not reach ${expectedStatus}`);
}

async function waitForProgress(jobs, id, completedItems) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (Number(job?.completed_items || 0) >= completedItems) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`delete job did not reach ${completedItems} completed items`);
}

async function main() {
  await listen();
  const db = require("../dist/db");
  const dbModule = require.cache[require.resolve("../dist/db")];
  const connection = {
    id:99103,
    name:"delete-job-check",
    ssh_host:"127.0.0.1",
    ssh_port:sshServer.address().port,
    ssh_user:"smoke",
    auth_type:"password",
    ssh_password:"smoke",
    sftp_filename_encoding:"utf8"
  };
  const originalGetConnection = dbModule.exports.getConnection;
  dbModule.exports.getConnection = id => Number(id) === connection.id ? connection : originalGetConnection(id);
  await trustTestHost(connection);
  const sessions = require("../dist/sftp-session");
  const jobs = require("../dist/sftp-jobs");
  const jobIds = [];
  let appServer = null;
  try {
    assert.throws(
      () => jobs.__buildDeleteJobRequest(connection, ["/"], false),
      /根目录或当前目录/,
      "background deletion must reject the remote root"
    );
    const deduplicated = jobs.__buildDeleteJobRequest(connection, ["/tmp/a.txt", "/tmp/a.txt"], false);
    assert.equal(deduplicated.item_count, 1, "duplicate paths must only produce one delete step");

    const recycledStart = jobs.deletePathsJob(connection.id, ["/tmp/回收 one.txt", "/tmp/recycle-two"], true);
    jobIds.push(recycledStart.id);
    assert.deepEqual(
      {status:recycledStart.status, type:recycledStart.type, recycled:recycledStart.recycled, item_count:recycledStart.item_count, progress_unit:recycledStart.progress_unit},
      {status:"running", type:"delete", recycled:true, item_count:2, progress_unit:"items"}
    );
    const recycled = await waitForJob(jobs, recycledStart.id, "done");
    assert.equal(recycled.completed_items, 2);
    assert.equal(recycled.transferred, 2);
    assert.equal(recycled.size, 2);
    assert.equal(recycled.progress, 100);
    const recycleCommand = commands.find(command => command.includes(".tunneldesk-recycle-bin"));
    assert.ok(recycleCommand, "recycle-enabled jobs must use the existing remote recycle directory");
    assert.match(recycleCommand, new RegExp(Buffer.from("/tmp/回收 one.txt", "utf8").toString("base64")));
    const recycleIds = [...recycleCommand.matchAll(/items\/([a-z0-9-]{8,80})/g)].map(match => match[1]);
    assert.equal(new Set(recycleIds).size, 2, "each recycled path must keep an independent recycle item");

    const permanentStart = jobs.deletePathsJob(connection.id, "/tmp/one's file.txt", false);
    jobIds.push(permanentStart.id);
    const permanent = await waitForJob(jobs, permanentStart.id, "done");
    assert.equal(permanent.item_count, 1, "the legacy single-path contract must remain supported");
    const permanentCommand = commands.find(command => command.includes("one") && command.includes("rm -rf --"));
    assert.ok(permanentCommand);
    assert.equal(permanentCommand.includes(".tunneldesk-recycle-bin"), false);

    const failedStart = jobs.deletePathsJob(connection.id, ["/tmp/first.txt", "/tmp/fail-me.txt"], false);
    jobIds.push(failedStart.id);
    const failed = await waitForJob(jobs, failedStart.id, "failed");
    assert.equal(failed.completed_items, 1, "a failed batch must retain understandable item progress");
    assert.equal(failed.progress, 50);
    assert.match(failed.error, /simulated delete failure/);

    const cancelledStart = jobs.deletePathsJob(connection.id, ["/tmp/before-cancel.txt", "/tmp/cancel-me.txt"], false);
    jobIds.push(cancelledStart.id);
    await waitForProgress(jobs, cancelledStart.id, 1);
    jobs.cancelSftpJob(cancelledStart.id);
    const cancelled = await waitForJob(jobs, cancelledStart.id, "cancelled");
    assert.equal(cancelled.completed_items, 1);
    assert.equal(cancelled.progress, 50);

    const serverModule = require("../dist/server");
    const port = await availablePort();
    appServer = serverModule.startServer(
      serverModule.parseArgs(["--host", "127.0.0.1", "--port", String(port)]),
      {exitOnShutdown:false}
    );
    await appServer.ready;
    const baseUrl = `http://127.0.0.1:${port}`;
    const legacyResponse = await fetch(`${baseUrl}/api/connections/${connection.id}/sftp/delete`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({path:"/tmp/api-legacy-path.txt"})
    });
    const legacyBody = await legacyResponse.json();
    assert.equal(legacyResponse.status, 202, JSON.stringify(legacyBody));
    assert.equal(legacyBody.item_count, 1);
    assert.equal(legacyBody.recycled, false);
    jobIds.push(legacyBody.id);
    await waitForJob(jobs, legacyBody.id, "done");

    fs.writeFileSync(
      path.join(process.env.TUNNELDESK_DATA_DIR, "runtime-settings.json"),
      JSON.stringify({listen_hosts:["127.0.0.1"], listen_port:port, sftp_recycle_bin_enabled:true}),
      "utf8"
    );
    const batchResponse = await fetch(`${baseUrl}/api/connections/${connection.id}/sftp/delete`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({paths:["/tmp/api-batch-one.txt", "/tmp/api-batch-two.txt"]})
    });
    const batchBody = await batchResponse.json();
    assert.equal(batchResponse.status, 202, JSON.stringify(batchBody));
    assert.equal(batchBody.item_count, 2);
    assert.equal(batchBody.recycled, true);
    jobIds.push(batchBody.id);
    await waitForJob(jobs, batchBody.id, "done");

    console.log("SFTP delete background job check passed.");
  } finally {
    try { await appServer?.shutdown(); } catch {}
    for (const id of jobIds) {
      try {
        const current = jobs.listSftpJobs().find(item => item.id === id);
        if (current && ["running", "pending", "paused"].includes(current.status)) jobs.cancelSftpJob(id);
      } catch {}
      try { jobs.deleteSftpJob(id); } catch {}
    }
    sessions.closeAllSftpSessions();
    try { db.closeDatabase(); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await new Promise(resolve => sshServer.close(() => resolve()));
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
});
