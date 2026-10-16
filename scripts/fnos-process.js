"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

try {
  if (process.platform !== "linux" || process.env.TERMA_DISTRIBUTION !== "fnos") throw new Error("Unsupported process identity environment");
  const directory = process.env.TERMA_DATA_DIR;
  const identityFile = path.join(directory, "fnos-process.json");
  const pidFile = path.join(directory, "web.pid");
  const expectedEntry = fs.realpathSync(path.join(root, "dist/server.js"));
  const expectedExecutable = fs.realpathSync(process.execPath);
  function privateFile(file) {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error("Unsafe process identity file");
  }
  function identity(pid) {
    if (!/^[1-9][0-9]*$/.test(String(pid))) throw new Error("Invalid process ID");
    const base = `/proc/${pid}`;
    if (fs.statSync(base).uid !== process.getuid()) throw new Error("Foreign process owner");
    const args = fs.readFileSync(`${base}/cmdline`, "utf8").split("\0");
    if (!path.isAbsolute(args[0] || "") || !path.isAbsolute(args[1] || "")
      || fs.realpathSync(args[0]) !== expectedExecutable || fs.realpathSync(args[1]) !== expectedEntry) throw new Error("Foreign process command");
    const stat = fs.readFileSync(`${base}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return {pid:Number(pid), startTime:fields[19], parent:Number(fields[1]),
      bootId:fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), entry:expectedEntry, executable:expectedExecutable};
  }
  if (["record", "stop-child"].includes(process.argv[2])) {
    const item = identity(process.argv[3]);
    if (item.parent !== process.ppid) throw new Error("Only the launcher can record its child process");
    if (process.argv[2] === "stop-child") { process.kill(item.pid, "SIGTERM"); return; }
    if (fs.existsSync(identityFile)) privateFile(identityFile);
    const temporary = `${identityFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(item), {flag:"wx", mode:0o600});
    fs.renameSync(temporary, identityFile);
  } else if (process.argv[2] === "verify") {
    privateFile(pidFile);
    privateFile(identityFile);
    const pid = fs.readFileSync(pidFile, "utf8").trim();
    const saved = JSON.parse(fs.readFileSync(identityFile, "utf8"));
    const actual = identity(pid);
    for (const key of ["pid", "startTime", "bootId", "entry", "executable"]) if (actual[key] !== saved[key]) throw new Error("Process identity changed");
    process.kill(Number(pid), 0);
    console.log(pid);
  } else throw new Error("Unknown process identity action");
} catch { process.exitCode = 1; }
