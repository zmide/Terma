const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { main:runAiBoundaryCheck } = require("./ai-check");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-security-boundary-"));
const previousData = process.env.TERMA_DATA_DIR;
const previousSsh = process.env.TERMA_SSH_DIR;
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
process.env.TERMA_DISABLE_UPDATE_CHECK = "1";

function mockRequest({
  remoteAddress="127.0.0.1",
  localAddress="127.0.0.1",
  localPort=8088,
  host="localhost:8088",
  origin,
  headers={},
  encrypted=false
} = {}) {
  return {
    headers:{host, ...(origin === undefined ? {} : {origin}), ...headers},
    socket:{remoteAddress, localAddress, localPort, encrypted}
  };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, headers={}, method="GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host:"127.0.0.1",
      port,
      path:pathname,
      method,
      headers
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks).toString("utf8")}));
    });
    req.once("error", reject);
    req.end();
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Security boundary server exited early with code ${child.exitCode}`);
    try {
      const response = await request(port, "/api/auth/status", {Host:"terma.example.test"});
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the security boundary server");
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 3000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  const security = require("../dist/security");
  security.resetWebAccessSecurity();

  const directLoopback = mockRequest({origin:"http://localhost:8088"});
  assert.equal(security.authRequired(directLoopback), false);
  assert.equal(security.hostAllowed(directLoopback), true);
  assert.equal(security.sameOrigin(directLoopback), true);
  security.updateSecurityOptions({secure_cookie_mode:"always"});
  assert.equal(security.sameOrigin(directLoopback), true, "Cookie policy must not change the actual request protocol");
  assert.equal(security.sameOrigin(mockRequest({origin:"https://localhost:8088"})), false);
  assert.equal(security.webSocketOriginAllowed(mockRequest()), true);
  security.setToken("security-boundary-test-token");
  assert.equal(security.authRequired(directLoopback), false, "LAN-only policy must keep genuine loopback access password-free");
  assert.equal(security.isAuthenticated(directLoopback), true);
  security.updateSecurityOptions({auth_mode:"always"});
  assert.equal(security.authRequired(directLoopback), true, "Always-auth policy must protect loopback requests");
  assert.equal(security.isAuthenticated(directLoopback), false);
  const tokenSession = security.login("security-boundary-test-token", directLoopback);
  assert.equal(security.isAuthenticated(mockRequest({
    origin:"http://localhost:8088",
    headers:{cookie:`td_session=${tokenSession}`}
  })), true, "The login page must accept a configured access token when no Web password exists");
  security.setToken("security-boundary-rotated-token");
  assert.equal(security.isAuthenticated(mockRequest({
    origin:"http://localhost:8088",
    headers:{cookie:`td_session=${tokenSession}`}
  })), false, "Rotating the access token must revoke sessions created with the previous credential state");
  const rotatedTokenSession = security.login("security-boundary-rotated-token", directLoopback);
  assert.equal(security.isAuthenticated(mockRequest({
    origin:"http://localhost:8088",
    headers:{cookie:`td_session=${rotatedTokenSession}`}
  })), true);
  security.updateSecurityOptions({auth_mode:"lan"});
  assert.equal(security.authRequired(directLoopback), false);
  assert.equal(security.updateSecurityOptions({auth_mode:"off", confirm_unsafe:true}).auth_mode, "off");
  assert.equal(security.authRequired(mockRequest({
    remoteAddress:"192.168.31.50",
    localAddress:"192.168.50.10",
    host:"192.168.50.10:8088",
    origin:"http://192.168.50.10:8088"
  })), false, "Off policy must disable Web authentication for LAN requests");
  security.updateSecurityOptions({auth_mode:"lan"});
  security.resetWebAccessSecurity();
  assert.throws(
    () => security.updateSecurityOptions({allowed_hosts:["https://terma.example.test/path"]}),
    /Host.*(主机名|IP)/
  );
  const machineHost = String(os.hostname() || "").trim().toLowerCase();
  if (machineHost) {
    const machineRequest = mockRequest({host:`${machineHost}:8088`, origin:`http://${machineHost}:8088`});
    assert.equal(security.hostAllowed(machineRequest), true);
    assert.equal(security.authRequired(machineRequest), false);
  }

  security.updateSecurityOptions({allowed_hosts:["terma.example.test"]});
  const untrustedProxy = mockRequest({
    host:"terma.example.test",
    origin:"http://terma.example.test",
    headers:{"x-forwarded-for":"203.0.113.4"}
  });
  assert.equal(security.hostAllowed(untrustedProxy), true);
  assert.equal(security.authRequired(untrustedProxy), true);
  assert.equal(security.isAuthenticated(untrustedProxy), false);
  assert.equal(security.requestSourceAddress(untrustedProxy), "127.0.0.1");

  const directLan = mockRequest({
    remoteAddress:"192.168.31.50",
    localAddress:"192.168.50.10",
    host:"192.168.50.10:8088",
    origin:"http://192.168.50.10:8088"
  });
  assert.equal(security.authRequired(directLan), true);
  assert.equal(security.hostAllowed(directLan), true);
  assert.equal(security.sameOrigin(directLan), true);

  security.updateSecurityOptions({
    auth_mode:"lan",
    lan_auth_enabled:true,
    trusted_proxy_enabled:true,
    trusted_proxy_addresses:["127.0.0.1"],
    allowed_hosts:["terma.example.test"]
  });
  const proxyHeaders = {
    "x-forwarded-for":"203.0.113.4, 198.51.100.9",
    "x-forwarded-proto":"https"
  };
  const proxyRequest = mockRequest({
    host:"terma.example.test",
    origin:"https://terma.example.test",
    headers:proxyHeaders
  });
  assert.equal(security.authRequired(proxyRequest), true);
  assert.equal(security.isAuthenticated(proxyRequest), false);
  assert.equal(security.requestSourceAddress(proxyRequest), "198.51.100.9");
  assert.equal(security.hostAllowed(proxyRequest), true);
  assert.equal(security.sameOrigin(proxyRequest), true);
  assert.equal(security.webSocketOriginAllowed(proxyRequest), true);
  assert.equal(security.webSocketOriginAllowed(mockRequest({host:"terma.example.test", headers:proxyHeaders})), false);
  assert.equal(security.sameOrigin(mockRequest({
    host:"terma.example.test:8443",
    origin:"http://terma.example.test:8443",
    headers:{...proxyHeaders, "x-forwarded-proto":"https"}
  })), false);

  const evilRebinding = mockRequest({host:"evil.example.test", origin:"http://evil.example.test"});
  assert.equal(security.hostAllowed(evilRebinding), false);
  assert.equal(security.sameOrigin(evilRebinding), false);
  assert.equal(security.sameOrigin(mockRequest({host:"terma.example.test.evil", origin:"https://terma.example.test.evil", headers:proxyHeaders})), false);
  assert.equal(security.sameOrigin(mockRequest({host:"terma.example.test", origin:"https://evil.example.test", headers:proxyHeaders})), false);
  assert.equal(security.sameOrigin(mockRequest({host:"terma.example.test", origin:"null", headers:proxyHeaders})), false);

  const nativeLoopback = mockRequest({host:"localhost:8088"});
  assert.equal(security.isDirectLoopbackRequest(nativeLoopback), true, "Trusted proxy settings must not break direct desktop helpers without proxy headers");

  security.setDesktopAuthToken("desktop-test-token");
  assert.equal(security.isDesktopRequest(proxyRequest), false);
  const desktopRequest = mockRequest({
    host:"terma.example.test",
    origin:"https://terma.example.test",
    headers:{...proxyHeaders, "x-terma-desktop-token":"desktop-test-token"}
  });
  assert.equal(security.isDesktopRequest(desktopRequest), true);
  assert.equal(security.isAuthenticated(desktopRequest), true);
  security.setDesktopAuthToken("");

  const serverModule = require("../dist/server");
  const desktopPort = await availablePort();
  const desktopToken = "desktop-integration-test-token";
  const desktopBackend = serverModule.startServer(
    serverModule.parseArgs(["--host", "127.0.0.1", "--port", String(desktopPort)]),
    {
      exitOnShutdown:false,
      desktopAuthToken:desktopToken,
      desktopIntegration:{getDesktopDirectory:() => root}
    }
  );
  try {
    await desktopBackend.ready;
    const browserSession = security.createSession();
    const plainLocalFiles = await request(desktopPort, "/api/local-files", {
      Host:`127.0.0.1:${desktopPort}`,
      Cookie:`td_session=${browserSession}`
    });
    assert.equal(plainLocalFiles.status, 403, plainLocalFiles.body);
    const plainShutdown = await request(desktopPort, "/api/shutdown", {
      Host:`127.0.0.1:${desktopPort}`,
      Cookie:`td_session=${browserSession}`
    }, "POST");
    assert.equal(plainShutdown.status, 403, plainShutdown.body);
    const desktopLocalFiles = await request(desktopPort, "/api/local-files", {
      Host:`127.0.0.1:${desktopPort}`,
      Cookie:`td_desktop=${desktopToken}`
    });
    assert.equal(desktopLocalFiles.status, 200, desktopLocalFiles.body);
    const shutdownTokenFile = path.join(process.env.TERMA_DATA_DIR, "shutdown.token");
    const shutdownToken = fs.readFileSync(shutdownTokenFile, "utf8").trim();
    assert.match(shutdownToken, /^[A-Za-z0-9_-]{32,128}$/);
    const tokenShutdown = await request(desktopPort, "/api/shutdown", {
      Host:`127.0.0.1:${desktopPort}`,
      "X-Terma-Shutdown-Token":shutdownToken
    }, "POST");
    assert.equal(tokenShutdown.status, 200, tokenShutdown.body);
    await desktopBackend.shutdown();
    assert.equal(fs.existsSync(shutdownTokenFile), false);
  } finally {
    await desktopBackend.shutdown();
  }

  const port = await availablePort();
  const child = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd:path.resolve(__dirname, ".."),
    env:process.env,
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    await waitForServer(port, child);
    const validHeaders = {
      Host:"terma.example.test",
      Origin:"https://terma.example.test",
      "X-Forwarded-For":"198.51.100.20",
      "X-Forwarded-Proto":"https"
    };
    const status = await request(port, "/api/auth/status", validHeaders);
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body).auth_required, true);
    assert.equal((await request(port, "/api/about", validHeaders)).status, 401);
    assert.equal((await request(port, "/api/about", {Host:"evil.example.test", Origin:"http://evil.example.test"})).status, 421);
    assert.equal((await request(port, "/api/about", {...validHeaders, Origin:"https://evil.example.test"})).status, 403);
    assert.equal((await request(port, "/api/about", {Host:`127.0.0.1:${port}`})).status, 401);
  } catch (error) {
    if (output.length) console.error(output.join("").slice(-12000));
    throw error;
  } finally {
    await stopServer(child);
  }

  await runAiBoundaryCheck();

  console.log("Security boundary check passed: direct local access, LAN auth, trusted proxies, Host allowlist, Origin checks, desktop token, and HTTP enforcement");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, {recursive:true, force:true});
  if (previousData === undefined) delete process.env.TERMA_DATA_DIR;
  else process.env.TERMA_DATA_DIR = previousData;
  if (previousSsh === undefined) delete process.env.TERMA_SSH_DIR;
  else process.env.TERMA_SSH_DIR = previousSsh;
});
