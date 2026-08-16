const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { PassThrough, Readable, Writable } = require("node:stream");
const {
  __commitCommand,
  createCheckpointTransfers
} = require("../dist/sftp-checkpoint-transfers");

function remoteError(message, code=2) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalize(value) {
  return path.posix.normalize(String(value || ".").replace(/\\/g, "/")) || ".";
}

function stats(node) {
  return {
    mode:node.mode || (node.type === "directory" ? 0o40755 : node.type === "symlink" ? 0o120777 : 0o100644),
    mtime:node.mtime || 100,
    size:node.type === "file" ? node.data.length : 0,
    isDirectory:() => node.type === "directory",
    isFile:() => node.type === "file",
    isSymbolicLink:() => node.type === "symlink"
  };
}

class FakeRemoteFileSystem {
  constructor(nodes={}) {
    this.nodes = new Map();
    this.permissionPaths = new Set();
    this.nodes.set("/", {type:"directory", mtime:100});
    for (const [remotePath, node] of Object.entries(nodes)) this.nodes.set(normalize(remotePath), {...node, data:node.data ? Buffer.from(node.data) : undefined});
  }

  channel() {
    const filesystem = this;
    return {
      lstat(remotePath, callback) {
        const key = normalize(remotePath);
        if (filesystem.permissionPaths.has(key)) return callback(remoteError(`permission denied: ${key}`, "EACCES"));
        const node = filesystem.nodes.get(key);
        callback(node ? null : remoteError(`not found: ${key}`), node ? stats(node) : undefined);
      },
      readdir(remotePath, callback) {
        const directory = normalize(remotePath).replace(/\/$/, "") || "/";
        const prefix = directory === "/" ? "/" : `${directory}/`;
        const names = new Set();
        for (const key of filesystem.nodes.keys()) {
          if (!key.startsWith(prefix) || key === directory) continue;
          const remainder = key.slice(prefix.length);
          if (remainder && !remainder.includes("/")) names.add(remainder);
        }
        callback(null, [...names].map(filename => ({filename})));
      },
      readlink(remotePath, callback) {
        const node = filesystem.nodes.get(normalize(remotePath));
        callback(node?.type === "symlink" ? null : remoteError("not a symlink"), node?.target);
      },
      mkdir(remotePath, callback) {
        const key = normalize(remotePath);
        if (filesystem.nodes.has(key)) return callback(remoteError("already exists", "EEXIST"));
        filesystem.nodes.set(key, {type:"directory", mtime:100});
        callback(null);
      },
      symlink(target, remotePath, callback) {
        filesystem.nodes.set(normalize(remotePath), {type:"symlink", target:String(target), mtime:100});
        callback(null);
      },
      unlink(remotePath, callback) {
        filesystem.nodes.delete(normalize(remotePath));
        callback(null);
      },
      chmod(remotePath, mode, callback) {
        const node = filesystem.nodes.get(normalize(remotePath));
        if (node) node.mode = mode;
        callback(null);
      },
      utimes(remotePath, _atime, mtime, callback) {
        const node = filesystem.nodes.get(normalize(remotePath));
        if (node) node.mtime = Number(mtime);
        callback(null);
      },
      createReadStream(remotePath, options={}) {
        const node = filesystem.nodes.get(normalize(remotePath));
        const start = Math.max(0, Number(options.start || 0));
        const data = node?.type === "file" ? node.data.subarray(start) : Buffer.alloc(0);
        return Readable.from((async function* () {
          for (let cursor = 0; cursor < data.length; cursor += 64 * 1024) {
            await new Promise(resolve => setTimeout(resolve, 15));
            yield data.subarray(cursor, Math.min(data.length, cursor + 64 * 1024));
          }
        })());
      },
      createWriteStream(remotePath, options={}) {
        const key = normalize(remotePath);
        let initialized = false;
        return new Writable({
          write(chunk, _encoding, callback) {
            if (!initialized) {
              initialized = true;
              if (options.flags !== "a") filesystem.nodes.set(key, {type:"file", data:Buffer.alloc(0), mtime:100});
            }
            const current = filesystem.nodes.get(key);
            const existing = current?.type === "file" ? current.data : Buffer.alloc(0);
            filesystem.nodes.set(key, {type:"file", data:Buffer.concat([existing, Buffer.from(chunk)]), mtime:100});
            callback();
          }
        });
      },
      end() {}
    };
  }
}

function fakeCommandChild(command, commands) {
  const child = new EventEmitter();
  child.command = command;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = signal => {
    child.emit("close", null, signal || "SIGTERM");
    return true;
  };
  commands.push(command);
  setTimeout(() => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  }, 5);
  return child;
}

async function waitFor(jobs, id, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = jobs.get(id);
    if (job && predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const job = jobs.get(id);
  throw new Error(`checkpoint job timed out: ${job?.status || "missing"} ${job?.error || ""}`);
}

async function main() {
  const payload = Buffer.alloc(512 * 1024);
  for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 13 + 5) & 0xff;
  const sourceFs = new FakeRemoteFileSystem({
    "/source":{type:"directory", mtime:100},
    "/source/payload.bin":{type:"file", data:payload, mtime:100}
  });
  const targetFs = new FakeRemoteFileSystem({"/target":{type:"directory", mtime:100}});
  const jobs = new Map();
  const commands = [];
  const connections = new Map([
    [1, {id:1, name:"source"}],
    [2, {id:2, name:"target"}]
  ]);
  const service = createCheckpointTransfers({
    finishTransferMetrics:job => { job.speed_bps = 0; },
    getSftpConnection:id => connections.get(Number(id)),
    jobs,
    notifyEvent:() => {},
    openSftpChannel:async id => Number(id) === 1 ? sourceFs.channel() : targetFs.channel(),
    persistJobs:() => {},
    queueTransferJob:(_kind, job, runner, options={}) => {
      job.status = "pending";
      job.phase = options.phase || job.phase;
      job.current = options.current || job.current;
      setTimeout(() => void runner(), 0);
    },
    recordTransferred:(job, bytes) => {
      job.transferred = Number(job.transferred || 0) + Number(bytes || 0);
      job.progress = job.size ? Math.min(99, Math.floor(job.transferred / job.size * 100)) : 0;
    },
    releaseTransferSlot:() => {},
    remotePathOperand:(_connection, value) => `'${String(value).replace(/'/g, `'\\''`)}'`,
    resetTransferSpeed:job => { job.speed_bps = 0; },
    shellQuote:value => `'${String(value).replace(/'/g, `'\\''`)}'`,
    spawnRemote:(_connection, command) => fakeCommandChild(command, commands),
    updateTransferProgress:job => { job.progress = job.size ? Math.min(99, Math.floor(Number(job.transferred || 0) / job.size * 100)) : 0; }
  });

  const started = service.startCrossCopyJob(1, 2, ["/source/payload.bin"], "/target", "error");
  const running = await waitFor(jobs, started.id, job => job.status === "running" && typeof job.pauseNow === "function" && job.transferred >= 64 * 1024);
  running.status = "paused";
  running.can_pause = false;
  running.pauseNow();
  await waitFor(jobs, started.id, job => job.status === "paused" && !job.pauseNow);
  const partialPath = path.posix.join(running.checkpoint_staging_path, "incoming", "payload.bin");
  const partial = targetFs.nodes.get(partialPath)?.data || Buffer.alloc(0);
  assert.ok(partial.length > 0 && partial.length < payload.length, "pausing must keep a reusable target-side byte checkpoint");

  service.resumeCrossCopyJob(running);
  const completed = await waitFor(jobs, started.id, job => job.status === "done");
  assert.equal(completed.started_at > 0, true);
  assert.equal(completed.resume_supported, true);
  assert.equal(completed.progress, 100);
  assert.equal(completed.progress_estimated, false);
  assert.deepEqual(targetFs.nodes.get(partialPath).data, payload, "resuming must append only the missing remote bytes");
  assert.ok(commands.some(command => command.includes("td_committed=1")), "completed checkpoint transfers must use the atomic commit command");

  const commit = __commitCommand(
    connections.get(2),
    {
      target_directory:"/target",
      checkpoint_staging_path:"/target/.terma-cross-copy-test.part",
      checkpoint_top_level:[{target_name:"payload.bin"}],
      conflict_mode:"overwrite"
    },
    (_connection, value) => `'${value}'`,
    value => `'${value}'`
  );
  assert.match(commit, /: > '[^']*placed-0' && mv --/, "placement markers must exist before final-path moves");
  assert.match(commit, /if \[ -e '[^']*payload\.bin' \] \|\| \[ -L '[^']*payload\.bin' \]; then mv --/, "rollback must tolerate an absent final target");

  assert.throws(() => service.startCrossCopyJob(1, 1, ["/source/payload.bin"], "/source", "overwrite"), /覆盖自身/);
  targetFs.permissionPaths.add("/target/payload.bin");
  const denied = service.startCrossCopyJob(1, 2, ["/source/payload.bin"], "/target", "rename");
  const failed = await waitFor(jobs, denied.id, job => job.status === "failed");
  assert.match(failed.error, /permission denied/, "target permission errors must not be treated as a missing filename");
  console.log("SFTP checkpoint transfer check passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
