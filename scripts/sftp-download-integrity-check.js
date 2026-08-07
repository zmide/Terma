const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Server } = require("ssh2");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-download-check-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TERMA_DATA_DIR, { recursive:true });
fs.mkdirSync(process.env.TERMA_SSH_DIR, { recursive:true });
const { trustTestHost } = require("./ssh-host-trust-test-helper");

const payload = Buffer.alloc(640 * 1024);
for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 31 + 7) & 0xff;
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength:2048 });
const hostKey = privateKey.export({ type:"pkcs1", format:"pem" });
const sshServer = new Server({ hostKeys:[hostKey] }, client => {
  client.on("authentication", context => context.accept());
  client.on("ready", () => client.on("session", accept => {
    const session = accept();
    session.on("exec", (acceptExec, _reject, info) => {
      const stream = acceptExec();
      const command = String(info?.command || "");
      if (command.includes("wc -c")) stream.write(String(payload.length));
      else if (command.includes("cat --")) stream.write(payload);
      else if (command.includes("tar -C")) stream.write(payload);
      else stream.stderr.write("unsupported test command");
      stream.exit(command.includes("wc -c") || command.includes("cat --") || command.includes("tar -C") ? 0 : 1);
      stream.end();
    });
  }));
});

function waitForServer() {
  return new Promise((resolve, reject) => sshServer.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function waitForJob(jobs, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (job?.status === "done") return job;
    if (job && ["failed", "cancelled"].includes(job.status)) throw new Error(job.error || job.stderr || job.status);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("download integrity job timed out");
}

async function main() {
  await waitForServer();
  const db = require("../dist/db");
  const dbModule = require.cache[require.resolve("../dist/db")];
  const connection = {
    id:99101,
    name:"download-integrity-check",
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
  let jobId = "";
  let archiveJobId = "";
  try {
    const started = jobs.startDownloadJob(connection.id, "/fixture/download.bin", { deliveryMode:"browser" });
    jobId = started.id;
    const completed = await waitForJob(jobs, jobId);
    const result = jobs.getSftpJobFile(jobId);
    const downloaded = fs.readFileSync(result.path);
    assert.equal(completed.size, payload.length);
    assert.equal(completed.transferred, payload.length, "completed transfer count must equal the remote size");
    assert.equal(downloaded.length, payload.length, "a completed download must not be truncated");
    assert.equal(hash(downloaded), hash(payload), "a completed download must preserve every byte");
    const archived = jobs.startArchiveDownloadJob(connection.id, ["/fixture/folder"], { deliveryMode:"browser" });
    archiveJobId = archived.id;
    await waitForJob(jobs, archiveJobId);
    const archive = jobs.getSftpJobFile(archiveJobId);
    assert.match(archive.name, /^terma-.+\.tar\.gz$/, "a browser archive download must keep its tar.gz filename");
    assert.ok(fs.statSync(archive.path).size > 0, "the archive response must use the completed job artifact");
    console.log("SFTP download integrity check passed.");
  } finally {
    try {
      const current = jobId && jobs.listSftpJobs().find(item => item.id === jobId);
      if (current && ["running", "pending", "paused"].includes(current.status)) jobs.cancelSftpJob(jobId);
    } catch {}
    try {
      const current = archiveJobId && jobs.listSftpJobs().find(item => item.id === archiveJobId);
      if (current && ["running", "pending", "paused"].includes(current.status)) jobs.cancelSftpJob(archiveJobId);
    } catch {}
    try { if (jobId) jobs.deleteSftpJob(jobId); } catch {}
    try { if (archiveJobId) jobs.deleteSftpJob(archiveJobId); } catch {}
    sessions.closeAllSftpSessions();
    try { db.closeDatabase(); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await new Promise(resolve => sshServer.close(() => resolve()));
  try { fs.rmSync(temporaryRoot, { recursive:true, force:true }); } catch {}
});
