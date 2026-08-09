const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const appVersion = require("../package.json").version;

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`认证验证服务器提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/auth/status`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待认证验证服务器启动超时");
}

function assertLoginPagePasswordToggle(html) {
  assert.equal((html.match(/id="passwordToggle"/g) || []).length, 1);
  assert.match(html, /<button id="passwordToggle" class="password-toggle" type="button" title="显示密码" aria-label="显示密码" aria-pressed="false">/);
  assert.match(html, /<link rel="stylesheet" href="\/login\.css">/);
  assert.match(html, /<script src="\/login\.js" defer><\/script>/);
  assert.doesNotMatch(html, /\sonclick=/);
  assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
  assert.equal((html.match(/class="password-toggle"/g) || []).length, 1);
  assert.match(html, /id="passwordHideIcon"[^>]*hidden/);
  const css = fs.readFileSync(path.resolve(__dirname, "../public/login.css"), "utf8");
  assert.match(css, /\.card\{[^}]*width:min\(360px,100%\)[^}]*box-sizing:border-box/);
  assert.match(css, /body\{[^}]*padding:16px[^}]*overflow-x:hidden/);

  const script = fs.readFileSync(path.resolve(__dirname, "../public/login.js"), "utf8");
  const makeElement = (properties = {}) => ({
    ...properties,
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus(options) { this.focusOptions = options; this.focusCount = (this.focusCount || 0) + 1; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  });
  const password = makeElement({ value: "unchanged-secret", type: "password", selectionStart: 3, selectionEnd: 9 });
  const toggle = makeElement({ title: "显示密码" });
  toggle.setAttribute("aria-label", "显示密码");
  toggle.setAttribute("aria-pressed", "false");
  const showIcon = makeElement({ hidden: false });
  const hideIcon = makeElement({ hidden: true });
  const loginButton = makeElement();
  const elements = {
    password,
    passwordToggle: toggle,
    passwordShowIcon: showIcon,
    passwordHideIcon: hideIcon,
    loginButton,
    err: makeElement()
  };
  const context = {
    document: { getElementById(id) { return elements[id]; } },
    fetch: async () => ({ ok: true }),
    location: { href: "" }
  };
  vm.runInNewContext(script, context, { timeout: 1000 });
  const click = toggle.listeners.get("click");
  assert.equal(typeof click, "function", "密码眼睛按钮应绑定点击处理器");
  click();
  assert.equal(password.type, "text");
  assert.equal(password.value, "unchanged-secret");
  assert.equal(password.selectionStart, 3);
  assert.equal(password.selectionEnd, 9);
  assert.equal(toggle.title, "隐藏密码");
  assert.equal(toggle.getAttribute("aria-label"), "隐藏密码");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(showIcon.hidden, true);
  assert.equal(hideIcon.hidden, false);
  assert.equal(password.focusOptions.preventScroll, true);
  click();
  assert.equal(password.type, "password");
  assert.equal(password.value, "unchanged-secret");
  assert.equal(toggle.title, "显示密码");
  assert.equal(toggle.getAttribute("aria-label"), "显示密码");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(showIcon.hidden, false);
  assert.equal(hideIcon.hidden, true);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-auth-integration-"));
  const previousData = process.env.TERMA_DATA_DIR;
  const previousSsh = process.env.TERMA_SSH_DIR;
  process.env.TERMA_DATA_DIR = path.join(root, "data");
  process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
  const password = `Td-${crypto.randomBytes(18).toString("base64url")}`;
  const security = require("../dist/security");
  security.setPassword(password);
  security.updateSecurityOptions({
    auth_mode: "always",
    secure_cookie_mode: "always",
    trusted_proxy_enabled: true,
    trusted_proxy_addresses: ["127.0.0.1"],
    session_ttl_minutes: 90,
    session_max_sessions: 7,
    session_cleanup_minutes: 2
  });
  assert.throws(
    () => security.updateSecurityOptions({ session_ttl_minutes:4 }),
    /会话有效期必须是 5-43200 之间的整数/
  );
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = [];
  server.stdout.on("data", chunk => output.push(chunk.toString()));
  server.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    await waitForServer(url, server);
    const loginPageResponse = await fetch(url + "/login");
    assert.equal(loginPageResponse.status, 200);
    const loginCsp = loginPageResponse.headers.get("content-security-policy") || "";
    assert.match(loginCsp, /script-src 'self'/);
    assert.match(loginCsp, /script-src-attr 'none'/);
    assert.doesNotMatch(loginCsp, /unsafe-inline/);
    assertLoginPagePasswordToggle(await loginPageResponse.text());
    assert.equal((await fetch(url + "/login.js")).status, 200);
    assert.equal((await fetch(url + "/login.css")).status, 200);
    assert.equal((await fetch(`${url}/api/about`)).status, 401);
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "X-Forwarded-For":"192.0.2.10" },
        body: JSON.stringify({ password:"wrong-password" })
      });
      assert.equal(response.status, 401);
    }
    const locked = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "X-Forwarded-For":"192.0.2.10" },
      body: JSON.stringify({ password:"wrong-password" })
    });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) >= 1);

    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "X-Forwarded-For":"192.0.2.11" },
      body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /td_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Max-Age=5400/);
    const sessionCookie = cookie.split(";")[0];
    assert.equal((await fetch(`${url}/api/about`, { headers:{Cookie:sessionCookie} })).status, 200);
    const authenticatedLoginPage = await fetch(`${url}/login`, {
      headers:{Cookie:sessionCookie},
      redirect:"manual"
    });
    assert.equal(authenticatedLoginPage.status, 302);
    assert.equal(authenticatedLoginPage.headers.get("location"), "/");
    const lanModeResponse = await fetch(`${url}/api/security`, {
      method:"PUT",
      headers:{Cookie:sessionCookie, "Content-Type":"application/json"},
      body:JSON.stringify({
        auth_mode:"lan",
        trusted_proxy_enabled:false,
        trusted_proxy_addresses:[]
      })
    });
    assert.equal(lanModeResponse.status, 200);
    const localLoginPage = await fetch(`${url}/login`, {redirect:"manual"});
    assert.equal(localLoginPage.status, 302);
    assert.equal(localLoginPage.headers.get("location"), "/");
    const offModeResponse = await fetch(`${url}/api/security`, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({auth_mode:"off", confirm_unsafe:true})
    });
    assert.equal(offModeResponse.status, 200);
    const disabledLoginPage = await fetch(`${url}/login`, {redirect:"manual"});
    assert.equal(disabledLoginPage.status, 302);
    assert.equal(disabledLoginPage.headers.get("location"), "/");
    const alwaysModeResponse = await fetch(`${url}/api/security`, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        auth_mode:"always",
        trusted_proxy_enabled:true,
        trusted_proxy_addresses:["127.0.0.1"]
      })
    });
    assert.equal(alwaysModeResponse.status, 200);
    assert.equal((await fetch(`${url}/login`, {redirect:"manual"})).status, 200);
    const mainPageResponse = await fetch(`${url}/`, {headers:{Cookie:sessionCookie}});
    assert.equal(mainPageResponse.status, 200);
    const mainCsp = mainPageResponse.headers.get("content-security-policy") || "";
    const mainHtml = await mainPageResponse.text();
    const nonce = mainHtml.match(/name="terma-csp-nonce" content="([^"]+)"/)?.[1] || "";
    assert.equal(nonce.length, 24);
    assert.ok(mainCsp.includes(`style-src 'self' 'nonce-${nonce}'`));
    assert.match(mainCsp, /script-src 'self'/);
    assert.doesNotMatch(mainCsp, /script-src 'self' 'unsafe-inline'/);
    assert.ok(mainHtml.includes(`<script src="/csp-bootstrap.js?v=${appVersion}"></script>`));
    assert.equal((await fetch(`${url}/csp-bootstrap.js`, {headers:{Cookie:sessionCookie}})).status, 200);
    const sessionSettingsResponse = await fetch(`${url}/api/security`, {
      method:"PUT",
      headers:{Cookie:sessionCookie, "Content-Type":"application/json"},
      body:JSON.stringify({
        session_ttl_minutes:60,
        session_max_sessions:6,
        session_cleanup_minutes:3
      })
    });
    assert.equal(sessionSettingsResponse.status, 200);
    const sessionSettings = await sessionSettingsResponse.json();
    assert.equal(sessionSettings.encryption_enabled, false);
    assert.equal(sessionSettings.encryption_unlocked, true);
    assert.deepEqual(sessionSettings.session_management, {
      ttl_minutes:60,
      max_sessions:6,
      cleanup_minutes:3,
      limits:{
        ttl_minutes:{min:5,max:43200},
        max_sessions:{min:1,max:10000},
        cleanup_minutes:{min:1,max:1440}
      }
    });
    assert.equal(sessionSettings.active_sessions, 1);
    const rotateTokenResponse = await fetch(`${url}/api/security/token`, {
      method:"POST",
      headers:{Cookie:sessionCookie, "Content-Type":"application/json"},
      body:"{}"
    });
    assert.equal(rotateTokenResponse.status, 200);
    const rotatedTokenCookie = rotateTokenResponse.headers.get("set-cookie");
    assert.match(rotatedTokenCookie, /td_session=/);
    const rotatedSessionCookie = rotatedTokenCookie.split(";")[0];
    const rotatedTokenResult = await rotateTokenResponse.json();
    assert.match(rotatedTokenResult.token, /^[A-Za-z0-9_-]{32,128}$/);
    assert.equal((await fetch(`${url}/api/about`, { headers:{Cookie:sessionCookie} })).status, 401);
    assert.equal((await fetch(`${url}/api/about`, { headers:{Cookie:rotatedSessionCookie} })).status, 200);
    const tokenLogin = await fetch(`${url}/api/auth/login`, {
      method:"POST",
      headers:{"Content-Type":"application/json", "X-Forwarded-For":"192.0.2.12"},
      body:JSON.stringify({password:rotatedTokenResult.token})
    });
    assert.equal(tokenLogin.status, 200);
    assert.equal((await fetch(`${url}/api/auth/logout`, {
      method:"POST",
      headers:{Cookie:rotatedSessionCookie, "Content-Type":"application/json"},
      body:"{}"
    })).status, 200);
    assert.equal((await fetch(`${url}/api/about`, { headers:{Cookie:rotatedSessionCookie} })).status, 401);
    console.log("Web 登录集成检查通过：来源锁定、Retry-After、随机密码、会话策略保存、动态 Cookie 有效期和注销");
  } catch (error) {
    if (output.length) console.error(output.join("").slice(-12000));
    throw error;
  } finally {
    try { server.kill("SIGTERM"); } catch {}
    await new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try { server.kill("SIGKILL"); } catch {}
        resolve();
      }, 3000);
      server.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fs.rmSync(root, { recursive:true, force:true });
    if (previousData === undefined) delete process.env.TERMA_DATA_DIR;
    else process.env.TERMA_DATA_DIR = previousData;
    if (previousSsh === undefined) delete process.env.TERMA_SSH_DIR;
    else process.env.TERMA_SSH_DIR = previousSsh;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
