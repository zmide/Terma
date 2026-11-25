"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {createRequire} = require("node:module");
const {spawn} = require("node:child_process");

function createFallbackStaticHandler(emptyDirectory) {
  const filename = path.resolve(__dirname, "../dist/static-content-handler.js");
  const source = fs.readFileSync(filename, "utf8");
  const fixture = {exports: {}};
  vm.runInNewContext(source, {
    module: fixture,
    exports: fixture.exports,
    require: createRequire(filename),
    __filename: filename,
    __dirname: path.join(emptyDirectory, "backend"),
    Buffer
  }, {filename});
  return fixture.exports.serveStatic;
}

async function startFallbackFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-fallback-ui-"));
  const child = spawn(process.execPath, [__filename, "--serve"], {
    env: {...process.env, ELECTRON_RUN_AS_NODE: "1",
      TERMA_DATA_DIR: path.join(root, "data"), TERMA_SSH_DIR: path.join(root, ".ssh"),
      TERMA_FALLBACK_FIXTURE_ROOT: root},
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  const diagnostics = [];
  child.stderr.on("data", value => diagnostics.push(String(value)));
  const closed = new Promise(resolve => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await closed;
    fs.rmSync(root, {recursive: true, force: true});
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Fallback fixture startup timed out")), 15000);
      child.once("message", message => {clearTimeout(timeout); resolve(message.url);});
      child.once("error", error => {clearTimeout(timeout); reject(error);});
      child.once("exit", code => {clearTimeout(timeout); reject(new Error(`Fallback fixture exited ${code}: ${diagnostics.join("")}`));});
    });
    return {url, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}

if (require.main === module) {
  if (process.argv[2] !== "--serve" || !process.env.TERMA_FALLBACK_FIXTURE_ROOT) {
    throw new Error("Fallback fixture requires its temporary test root");
  }
  const security = require("../dist/security");
  security.setPassword(require("node:crypto").randomBytes(24).toString("hex"));
  security.updateSecurityOptions({auth_mode: "always"});
  const serve = createFallbackStaticHandler(process.env.TERMA_FALLBACK_FIXTURE_ROOT);
  const server = require("node:http").createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/api/auth/login") {
      request.resume();
      response.writeHead(401, {"Content-Type": "application/json"});
      return response.end(JSON.stringify({error_code: "auth_login_invalid"}));
    }
    serve(request, response, pathname);
  });
  server.listen(0, "127.0.0.1", () => {
    process.send({url: `http://127.0.0.1:${server.address().port}`});
  });
}

module.exports = {createFallbackStaticHandler, startFallbackFixture};
