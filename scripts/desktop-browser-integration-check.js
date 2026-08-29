const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createDesktopBrowserAuthorizationPromptGate } = require("../desktop/browser-authorization-prompt");
const { readFrontendDomain } = require("./frontend-source");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-desktop-browser-integration-"));
const previousData = process.env.TERMA_DATA_DIR;
const previousSsh = process.env.TERMA_SSH_DIR;
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
process.env.TERMA_DISABLE_UPDATE_CHECK = "1";

function mockRequest({
  remoteAddress="127.0.0.1",
  localAddress="127.0.0.1",
  host="127.0.0.1:8088",
  cookie="",
  headers={}
} = {}) {
  return {
    headers:{host, ...(cookie ? {cookie} : {}), ...headers},
    socket:{remoteAddress, localAddress, localPort:8088}
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

function request(port, pathname, {method="GET", cookie="", body="", origin=`http://127.0.0.1:${port}`, headers={}} = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body) : null;
    const req = http.request({
      host:"127.0.0.1",
      port,
      path:pathname,
      method,
      headers:{
        Host:`127.0.0.1:${port}`,
        Origin:origin,
        ...(cookie ? {Cookie:cookie} : {}),
        ...headers,
        ...(payload ? {"Content-Type":"application/json", "Content-Length":payload.length} : {})
      }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status:response.statusCode,
        headers:response.headers,
        body:Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.once("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function responseCookie(response, name) {
  const values = response.headers["set-cookie"] || [];
  const entry = values.find(value => String(value).startsWith(`${name}=`));
  return entry ? String(entry).split(";", 1)[0] : "";
}

async function waitForCondition(predicate, message, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function main() {
  const security = require("../dist/security");
  const terminalSource = fs.readFileSync(path.join(__dirname, "..", "src", "terminal.ts"), "utf8");
  const terminalRoutesSource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "terminal-routes.ts"), "utf8");
  const terminalUiSource = readFrontendDomain(path.join(__dirname, ".."), "terminal");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf8");
  const desktopMainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  assert.match(terminalSource, /closeDesktopBrowserGrantTerminals/);
  assert.match(terminalSource, /桌面集成授权已到期，本次 X11 终端已关闭/);
  assert.match(serverSource, /closeDesktopBrowserGrantSessions:closeDesktopBrowserGrantTerminals/);
  assert.match(serverSource, /isDesktopCapabilityRequest\(req, "xserver"\)/, "X11 启动票据和 WebSocket 必须在后端复核桌面授权");
  assert.match(serverSource, /localDirectDesktopIntegrationStatus\(req, "xserver"\)\.authorized[\s\S]*grant = nativeDesktop \|\| localDirectAuthorized \? null/, "自动授权的 X11 终端不能继续绑定旧临时 grant");
  assert.match(terminalRoutesSource, /DESKTOP_INTEGRATION_AUTH_REQUIRED/);
  assert.match(desktopMainSource, /desktopBrowserAuthorizationPromptGate\.request\(/, "Electron 桌面授权确认必须使用独占门控");
  assert.match(terminalUiSource, /\["trusted", "untrusted"\]\.includes\(effectiveX11Mode\)/, "默认启用 X11 的连接必须在 WebSocket 前申请启动票据");
  assert.match(terminalUiSource, /startup:\{\.\.\.\(startupOverride \|\| \{\}\), x11_mode:"off"\}/, "默认 X11 未授权时必须通过一次性启动票据降级为普通 SSH");
  assert.match(terminalUiSource, /已自动降级为普通 SSH 终端/, "默认 X11 降级必须在终端中明确提示");
  assert.match(terminalUiSource, /error\.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED"[\s\S]*openXServerManager\(c\.id, key\)/, "X11 授权失败必须显示原因，并把当前连接上下文传给可选择时长的授权界面");
  security.resetWebAccessSecurity();
  const session = security.createSession();
  const sessionCookie = `td_session=${session}`;
  const directRequest = mockRequest({cookie:sessionCookie});

  security.setDesktopCapabilityRuntimeListenHosts(["127.0.0.1"]);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), false, "本机直连自动授权必须默认关闭");
  security.updateSecurityOptions({local_direct_desktop_integration_enabled:true});
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), true);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "remote-client"), true);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "local-files"), false, "本机直连自动授权不能扩大到完整桌面能力");
  assert.equal(security.isDesktopCapabilityRequest(mockRequest(), "xserver"), true, "LAN-only 策略下真正的本机直连可沿用免登录 Web 边界");
  security.updateSecurityOptions({auth_mode:"always"});
  assert.equal(security.isDesktopCapabilityRequest(mockRequest(), "xserver"), false, "始终认证策略下自动授权仍需有效 Web 会话");
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), true);
  security.updateSecurityOptions({auth_mode:"lan"});
  assert.equal(security.isDesktopCapabilityRequest(mockRequest({
    cookie:sessionCookie,
    headers:{"x-forwarded-for":"127.0.0.1"}
  }), "xserver"), false, "带转发头的请求不能伪装成本机直连");
  assert.equal(security.isDesktopCapabilityRequest(mockRequest({
    cookie:sessionCookie,
    host:"terma.example.test"
  }), "xserver"), false, "外部 Host 不能获得本机直连自动授权");
  security.setDesktopCapabilityRuntimeListenHosts(["0.0.0.0"]);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), false, "通配监听必须关闭自动授权");
  security.setDesktopCapabilityRuntimeListenHosts(["192.168.31.10"]);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), false, "局域网监听必须关闭自动授权");
  security.setDesktopCapabilityRuntimeListenHosts(["::1"]);
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), true, "IPv6 回环监听应满足自动授权策略");
  security.updateSecurityOptions({
    trusted_proxy_enabled:true,
    trusted_proxy_addresses:["127.0.0.1"]
  });
  assert.equal(security.isDesktopCapabilityRequest(directRequest, "xserver"), false, "启用可信反向代理后自动授权必须失效");
  security.updateSecurityOptions({
    trusted_proxy_enabled:false,
    local_direct_desktop_integration_enabled:false
  });
  security.setDesktopCapabilityRuntimeListenHosts(["127.0.0.1"]);

  let resolveExclusivePrompt;
  let exclusivePromptCount = 0;
  const exclusivePromptGate = createDesktopBrowserAuthorizationPromptGate();
  const firstPrompt = exclusivePromptGate.request(() => {
    exclusivePromptCount += 1;
    return new Promise(resolve => { resolveExclusivePrompt = resolve; });
  });
  await waitForCondition(() => typeof resolveExclusivePrompt === "function", "等待首个桌面授权确认超时");
  const secondPrompt = await exclusivePromptGate.request(() => {
    exclusivePromptCount += 1;
    return true;
  });
  assert.equal(secondPrompt, false, "已有桌面授权确认进行时，第二个请求必须立即拒绝");
  assert.equal(exclusivePromptCount, 1, "并发授权不能复用或再打开第二个确认框");
  resolveExclusivePrompt(true);
  assert.equal(await firstPrompt, true);
  assert.equal(exclusivePromptGate.pending(), false);

  assert.throws(
    () => security.createDesktopBrowserGrant(mockRequest(), ["xserver"]),
    /请先使用 Web 密码或访问 Token登录|请先使用 Web 密码或访问 Token 登录/
  );
  assert.throws(
    () => security.createDesktopBrowserGrant(mockRequest({
      remoteAddress:"192.168.31.20",
      localAddress:"192.168.31.10",
      host:"192.168.31.10:8088",
      cookie:sessionCookie
    }), ["xserver"]),
    /只允许本机浏览器申请/
  );
  assert.throws(() => security.createDesktopBrowserGrant(directRequest, ["local-files"]), /没有可授予/);

  const grantsBeforeBrowserSession = security.securityDiagnostics().desktop_browser_grants;
  const browserSessionGrant = security.createDesktopBrowserGrant(directRequest, ["xserver"], {browserSession:true});
  assert.ok(browserSessionGrant.expiresAt > browserSessionGrant.createdAt);
  assert.ok(browserSessionGrant.expiresAt - browserSessionGrant.createdAt <= 12 * 60 * 60 * 1000);
  assert.equal(browserSessionGrant.maxAgeSeconds, null);
  const browserSessionSetCookie = security.desktopBrowserGrantCookie(directRequest, browserSessionGrant.token, browserSessionGrant.maxAgeSeconds);
  assert.doesNotMatch(browserSessionSetCookie, /Max-Age=/, "本次浏览器会话授权必须使用会话 Cookie");
  const browserSessionCookie = browserSessionSetCookie.split(";", 1)[0];
  const browserSessionRequest = mockRequest({cookie:`${sessionCookie}; ${browserSessionCookie}`});
  assert.equal(security.desktopBrowserGrantStatus(browserSessionRequest).authorized, true);
  assert.equal(security.desktopBrowserGrantStatus(browserSessionRequest).browser_session, true);
  const originalBrowserSessionNow = Date.now;
  Date.now = () => browserSessionGrant.expiresAt + 1;
  try {
    assert.equal(security.desktopBrowserGrantStatus(browserSessionRequest).authorized, false, "本次浏览器会话授权必须有服务端硬过期时间");
    assert.equal(security.securityDiagnostics().desktop_browser_grants, grantsBeforeBrowserSession);
  } finally {
    Date.now = originalBrowserSessionNow;
  }

  const grant = security.createDesktopBrowserGrant(directRequest, ["xserver"]);
  const grantSetCookie = security.desktopBrowserGrantCookie(directRequest, grant.token, grant.maxAgeSeconds);
  assert.match(grantSetCookie, /^terma_desktop_grant=/);
  assert.doesNotMatch(grantSetCookie, /^td_desktop_grant=/);
  assert.match(grantSetCookie, /Path=\//, "临时授权 Cookie 必须覆盖终端 WebSocket 路径");
  const grantCookie = grantSetCookie.split(";", 1)[0];
  const authorizedRequest = mockRequest({cookie:`${sessionCookie}; ${grantCookie}`});
  assert.equal(security.isDesktopRequest(authorizedRequest), false, "临时授权不能冒充完整桌面令牌");
  assert.equal(security.isDesktopCapabilityRequest(authorizedRequest, "xserver"), true);
  assert.equal(security.isDesktopCapabilityRequest(authorizedRequest, "remote-client"), false);
  assert.equal(security.isDesktopCapabilityRequest(authorizedRequest, "local-files"), false);
  assert.equal(security.desktopBrowserGrantStatus(authorizedRequest).authorized, true);
  assert.match(security.desktopBrowserGrantStatus(authorizedRequest).grant_id, /^[0-9a-f-]{36}$/i);

  const customGrant = security.createDesktopBrowserGrant(directRequest, ["xserver"], {durationMs:30 * 60 * 1000});
  assert.equal(customGrant.maxAgeSeconds, 30 * 60, "自定义授权不应继续被旧的 10 分钟上限截断");

  const otherSession = security.createSession();
  assert.equal(security.isDesktopCapabilityRequest(mockRequest({
    cookie:`td_session=${otherSession}; ${grantCookie}`
  }), "xserver"), false, "临时授权必须绑定原 Web 会话");

  const expiringGrant = security.createDesktopBrowserGrant(directRequest, ["xserver"], 60 * 1000);
  const expiringCookie = security.desktopBrowserGrantCookie(directRequest, expiringGrant.token, expiringGrant.maxAgeSeconds).split(";", 1)[0];
  const originalNow = Date.now;
  Date.now = () => originalNow() + 61 * 1000;
  try {
    assert.equal(security.isDesktopCapabilityRequest(mockRequest({
      cookie:`${sessionCookie}; ${expiringCookie}`
    }), "xserver"), false, "到期授权必须自动失效");
  } finally {
    Date.now = originalNow;
  }
  assert.equal(security.revokeDesktopBrowserGrant(authorizedRequest), true);

  security.setDesktopAuthToken("native-desktop-token");
  const nativeRequest = mockRequest({cookie:"td_desktop=native-desktop-token"});
  assert.equal(security.isDesktopRequest(nativeRequest), true);
  assert.equal(security.isDesktopCapabilityRequest(nativeRequest, "local-files"), true);
  security.setDesktopAuthToken("");

  const serverModule = require("../dist/server");
  const port = await availablePort();
  let approved = true;
  const promptRequests = [];
  const httpPromptGate = createDesktopBrowserAuthorizationPromptGate();
  let deferHttpPrompt = false;
  let resolveHttpPrompt = null;
  let starts = 0;
  const backend = serverModule.startServer(
    serverModule.parseArgs(["--host", "127.0.0.1", "--port", String(port)]),
    {
      exitOnShutdown:false,
      desktopAuthToken:"native-http-token",
      desktopIntegration:{
        confirmDesktopBrowserAuthorization:requestDetails => httpPromptGate.request(() => {
          promptRequests.push(requestDetails);
          if (!deferHttpPrompt) return approved;
          return new Promise(resolve => { resolveHttpPrompt = resolve; });
        }),
        getDesktopDirectory:() => root,
        xServerDiagnostics:() => ({platform:"win32", available:true, running:true, display:":0.0", server:"VcXsrv"}),
        startXServer:() => ({ok:true, started:++starts}),
        stopXServer:() => ({ok:true}),
        remoteClientDiagnostics:() => ({rdp:{available:true, client:"RDP"}, vnc:{available:true, client:"VNC"}})
      }
    }
  );
  try {
    await backend.ready;
    const browserSession = security.createSession();
    const browserCookie = `td_session=${browserSession}`;
    const status = await request(port, "/api/desktop-integration/status", {cookie:browserCookie});
    assert.equal(status.status, 200, status.body);
    const statusBody = JSON.parse(status.body);
    assert.equal(statusBody.desktop_backend_available, true);
    assert.equal(statusBody.authorization_required, true);
    assert.equal(statusBody.can_request_authorization, true);

    security.updateSecurityOptions({local_direct_desktop_integration_enabled:true});
    const securityView = await request(port, "/api/security", {cookie:browserCookie});
    assert.equal(securityView.status, 200, securityView.body);
    const securityViewBody = JSON.parse(securityView.body);
    assert.equal(securityViewBody.local_direct_desktop_integration_enabled, true);
    assert.equal(securityViewBody.local_direct_desktop_integration.authorized, true);
    assert.deepEqual(securityViewBody.local_direct_desktop_integration.actual_listen_hosts, ["127.0.0.1"]);
    const automaticStatus = await request(port, "/api/desktop-integration/status", {cookie:browserCookie});
    assert.equal(automaticStatus.status, 200, automaticStatus.body);
    const automaticStatusBody = JSON.parse(automaticStatus.body);
    assert.equal(automaticStatusBody.authorized, true);
    assert.equal(automaticStatusBody.authorization_kind, "local-direct");
    assert.deepEqual(automaticStatusBody.scopes.sort(), ["remote-client", "xserver"]);
    assert.equal(automaticStatusBody.authorization_required, false);
    assert.equal(automaticStatusBody.can_request_authorization, false);
    assert.equal(automaticStatusBody.local_direct_authorized, true);
    assert.equal(automaticStatus.headers["set-cookie"], undefined, "自动授权状态不能生成授权 Cookie");
    const automaticAuthorization = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:browserCookie,
      body:JSON.stringify({scopes:["xserver", "remote-client"]})
    });
    assert.equal(automaticAuthorization.status, 200, automaticAuthorization.body);
    assert.equal(automaticAuthorization.headers["set-cookie"], undefined, "自动授权不能隐式创建临时 grant Cookie");
    assert.equal(promptRequests.length, 0, "自动授权不应弹出桌面确认");
    assert.equal((await request(port, "/api/xserver", {cookie:browserCookie})).status, 200);
    assert.equal((await request(port, "/api/remote-clients/diagnostics", {cookie:browserCookie})).status, 200);
    assert.equal((await request(port, "/api/local-files", {cookie:browserCookie})).status, 403);
    assert.equal((await request(port, "/api/desktop-integration/status", {
      cookie:browserCookie,
      origin:"http://terma.example.test"
    })).status, 403, "Origin 校验必须继续先于自动授权");
    security.updateSecurityOptions({local_direct_desktop_integration_enabled:false});
    security.setDesktopCapabilityRuntimeListenHosts(["127.0.0.1"]);

    const noSession = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      body:JSON.stringify({scopes:["xserver"]})
    });
    assert.equal(noSession.status, 401, noSession.body);

    const authorization = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:browserCookie,
      body:JSON.stringify({scopes:["xserver"], authorization_mode:"timed", duration_minutes:30})
    });
    assert.equal(authorization.status, 200, authorization.body);
    assert.deepEqual(promptRequests.map(item => item.scopes), [["xserver"]]);
    assert.equal(promptRequests[0].duration_mode, "timed");
    assert.equal(promptRequests[0].duration_minutes, 30);
    const httpGrantCookie = responseCookie(authorization, "terma_desktop_grant");
    assert.ok(httpGrantCookie, "授权响应必须设置 Terma 临时授权 Cookie");
    assert.match(String(authorization.headers["set-cookie"]?.[0] || ""), /Max-Age=1800/);
    const authorizedCookie = `${browserCookie}; ${httpGrantCookie}`;

    security.updateSecurityOptions({local_direct_desktop_integration_enabled:true});
    const localDirectOverGrant = JSON.parse((await request(port, "/api/desktop-integration/status", {cookie:authorizedCookie})).body);
    assert.equal(localDirectOverGrant.authorization_kind, "local-direct", "自动授权生效时不应继续显示旧临时 grant");
    assert.equal(localDirectOverGrant.authorization_id, "", "自动授权不能绑定旧 grant ID");
    security.updateSecurityOptions({local_direct_desktop_integration_enabled:false});

    const xserver = await request(port, "/api/xserver", {cookie:authorizedCookie});
    assert.equal(xserver.status, 200, xserver.body);
    assert.equal(JSON.parse(xserver.body).integration_available, true);
    const started = await request(port, "/api/xserver", {method:"POST", cookie:authorizedCookie, body:"{}"});
    assert.equal(started.status, 200, started.body);
    assert.equal(starts, 1);

    const remoteDiagnostics = await request(port, "/api/remote-clients/diagnostics", {cookie:authorizedCookie});
    assert.equal(remoteDiagnostics.status, 200, remoteDiagnostics.body);
    assert.equal(JSON.parse(remoteDiagnostics.body).authorization_required, true, "X Server scope 不能调用系统远程客户端");
    const localFiles = await request(port, "/api/local-files", {cookie:authorizedCookie});
    assert.equal(localFiles.status, 403, localFiles.body);

    const expandedAuthorization = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:authorizedCookie,
      body:JSON.stringify({scopes:["remote-client"], authorization_mode:"browser-session"})
    });
    assert.equal(expandedAuthorization.status, 200, expandedAuthorization.body);
    assert.deepEqual(promptRequests.map(item => item.scopes), [["xserver"], ["xserver", "remote-client"]]);
    assert.equal(promptRequests[1].duration_mode, "browser-session");
    const expandedGrantCookie = responseCookie(expandedAuthorization, "terma_desktop_grant");
    assert.doesNotMatch(String(expandedAuthorization.headers["set-cookie"]?.[0] || ""), /Max-Age=/);
    const expandedCookie = `${browserCookie}; ${expandedGrantCookie}`;
    const expandedDiagnostics = await request(port, "/api/remote-clients/diagnostics", {cookie:expandedCookie});
    assert.equal(expandedDiagnostics.status, 200, expandedDiagnostics.body);
    assert.equal(JSON.parse(expandedDiagnostics.body).integration_available, true);
    assert.equal((await request(port, "/api/local-files", {cookie:expandedCookie})).status, 403, "扩展 scope 后仍不能访问完整桌面 API");

    const revoked = await request(port, "/api/desktop-integration/authorize", {
      method:"DELETE",
      cookie:expandedCookie,
      body:"{}"
    });
    assert.equal(revoked.status, 200, revoked.body);
    assert.match(String(revoked.headers["set-cookie"]?.[0] || ""), /^terma_desktop_grant=.*Max-Age=0/);
    assert.equal((await request(port, "/api/xserver", {method:"POST", cookie:authorizedCookie, body:"{}"})).status, 403);

    const invalidDuration = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:browserCookie,
      body:JSON.stringify({scopes:["xserver"], authorization_mode:"timed", duration_minutes:481})
    });
    assert.equal(invalidDuration.status, 400, invalidDuration.body);
    assert.match(invalidDuration.body, /1 到 480 分钟/);

    const secondBrowserSession = security.createSession();
    const secondBrowserCookie = `td_session=${secondBrowserSession}`;
    const promptCountBeforeConcurrency = promptRequests.length;
    deferHttpPrompt = true;
    const firstConcurrentAuthorization = request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:browserCookie,
      body:JSON.stringify({scopes:["xserver"], authorization_mode:"timed", duration_minutes:10})
    });
    await waitForCondition(() => typeof resolveHttpPrompt === "function", "等待并发授权确认超时");
    const secondConcurrentAuthorization = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:secondBrowserCookie,
      body:JSON.stringify({scopes:["xserver"], authorization_mode:"timed", duration_minutes:10})
    });
    assert.equal(JSON.parse(secondConcurrentAuthorization.body).approved, false);
    assert.equal(responseCookie(secondConcurrentAuthorization, "terma_desktop_grant"), "", "第二个会话不能共享首个确认结果");
    resolveHttpPrompt(true);
    const firstConcurrentResult = await firstConcurrentAuthorization;
    deferHttpPrompt = false;
    resolveHttpPrompt = null;
    assert.equal(JSON.parse(firstConcurrentResult.body).approved, true);
    const firstConcurrentGrantCookie = responseCookie(firstConcurrentResult, "terma_desktop_grant");
    assert.ok(firstConcurrentGrantCookie);
    assert.equal(promptRequests.length, promptCountBeforeConcurrency + 1, "两个并发会话最多触发一次有效授权确认");
    assert.equal((await request(port, "/api/xserver", {
      method:"POST",
      cookie:`${secondBrowserCookie}; ${firstConcurrentGrantCookie}`,
      body:"{}"
    })).status, 403, "并发会话不能使用绑定到另一 Web 会话的授权");

    const promptCountBeforeRejection = promptRequests.length;
    approved = false;
    const rejected = await request(port, "/api/desktop-integration/authorize", {
      method:"POST",
      cookie:browserCookie,
      body:JSON.stringify({scopes:["xserver"]})
    });
    assert.equal(rejected.status, 200, rejected.body);
    assert.equal(JSON.parse(rejected.body).approved, false);
    assert.equal(promptRequests.length, promptCountBeforeRejection + 1);
    assert.deepEqual(promptRequests.at(-1).scopes, ["xserver"]);
  } finally {
    await backend.shutdown();
  }

  console.log("Desktop browser integration check passed: Terma cookie naming, strict local-direct policy, loopback/session binding, timed/custom/browser-session grants, expiry, revoke, native confirmation, and full-desktop isolation");
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
