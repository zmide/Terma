"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const arch = value("--arch") || process.arch;
const stagingArchive = value("--pack-staging");
const stageOnly = args.includes("--stage-only");
if (stageOnly && stagingArchive) throw new Error("Use either --stage-only or --pack-staging");
if (process.platform !== "linux" || !["x64", "arm64"].includes(arch) || (!stagingArchive && process.arch !== arch)) {
  throw new Error("Prepare native dependencies with Node.js 22 on matching Linux x64 or arm64 hardware");
}
if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error("Use Node.js 22 to match the fnOS runtime ABI");
const output = path.resolve(value("--output") || path.join(root, "release", "fnos"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "terma-fnos-build-"));
const pack = path.join(workspace, "terma");
const server = path.join(pack, "app", "server");

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, {cwd, stdio:"inherit", env:{...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD:"1"}});
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.code})`);
}

try {
  if (stagingArchive) {
    run("python3", [path.join(root, "scripts", "extract-fnos-staging.py"), path.resolve(stagingArchive), workspace]);
  } else {
    if (!args.includes("--skip-build")) run("npm", ["run", "build"]);
    fs.cpSync(path.join(root, "packaging", "fnos"), pack, {recursive:true});
    fs.mkdirSync(server, {recursive:true});
    for (const name of ["dist", "public", "package.json", "package-lock.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      fs.cpSync(path.join(root, name), path.join(server, name), {recursive:true});
    }
    fs.cpSync(path.join(root, "LICENSE"), path.join(pack, "LICENSE"));
    fs.mkdirSync(path.join(server, "scripts"));
    for (const name of ["fnos-initialize.js", "fnos-config.js", "fnos-process.js", "node-runtime-check.js", "patch-ssh2-sftp-raw.js"]) {
      fs.copyFileSync(path.join(root, "scripts", name), path.join(server, "scripts", name));
    }
    run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], server);
    run(process.execPath, [path.join(server, "scripts", "patch-ssh2-sftp-raw.js")], server);
    fs.unlinkSync(path.join(server, "scripts", "patch-ssh2-sftp-raw.js"));
    run(process.execPath, ["-e", "require('node:sqlite');require('node-pty');console.log('fnOS runtime dependencies are ready')"], server);
    const pkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
    pkg.termaDistribution = "fnos";
    pkg.termaFnosArchitecture = arch;
    fs.writeFileSync(path.join(server, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    const description = require("./fnos-description").renderFnosDescription(pack);
    const manifest = fs.readFileSync(path.join(pack, "manifest"), "utf8")
      .replaceAll("@VERSION@", pkg.version).replaceAll("@PLATFORM@", arch === "x64" ? "x86" : "arm")
      .replaceAll("@DESCRIPTION@", description);
    fs.writeFileSync(path.join(pack, "manifest"), manifest);
    for (const name of fs.readdirSync(path.join(pack, "cmd"))) {
      const file = path.join(pack, "cmd", name);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
      fs.chmodSync(file, 0o755);
      run("bash", ["-n", file]);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
  const sourceVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  if (pkg.version !== sourceVersion || pkg.termaDistribution !== "fnos" || pkg.termaFnosArchitecture !== arch) {
    throw new Error("Native staging version or architecture does not match the requested package");
  }
  run(process.execPath, [path.join(root, "scripts", "fnos-package-check.js"), pack, arch]);
  fs.mkdirSync(output, {recursive:true});
  if (stageOnly) {
    const archive = path.join(output, `Terma-${pkg.version}-fnos-${arch}.staging.tar.gz`);
    run("tar", ["--hard-dereference", "-czf", archive, "-C", workspace, "terma"]);
    console.log(`Created native staging archive ${archive}`);
  } else {
    run(process.env.FNPACK || "fnpack", ["build", "--directory", pack], workspace);
    const generated = fs.readdirSync(workspace).filter(name => name.endsWith(".fpk"));
    if (generated.length !== 1) throw new Error("Expected exactly one FPK output");
    const name = `Terma-${pkg.version}-fnos-${arch}.fpk`;
    fs.copyFileSync(path.join(workspace, generated[0]), path.join(output, name));
    const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(output, name))).digest("hex");
    fs.writeFileSync(path.join(output, `${name}.sha256`), `${hash}  ${name}\n`);
    console.log(`Created ${path.join(output, name)}`);
  }
} finally {
  if (path.dirname(workspace) !== fs.realpathSync(os.tmpdir()) || !path.basename(workspace).startsWith("terma-fnos-build-")) throw new Error("Unsafe temporary workspace");
  if (!args.includes("--keep-workspace")) fs.rmSync(workspace, {recursive:true, force:true});
  else console.log(`Build workspace: ${workspace}`);
}
