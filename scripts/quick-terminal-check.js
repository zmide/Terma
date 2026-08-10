const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const {
  QUICK_TERMINAL_TICKET_TTL_MS,
  authorizeQuickConnectionId,
  consumeQuickTerminalTicket,
  createQuickTerminalTicket,
  normalizeQuickTerminalConnection,
  purgeExpiredQuickTerminalTickets,
  resolveQuickConnectionById,
  revokeQuickTerminalTicket
} = require(path.join(root, "dist", "quick-terminal.js"));
const { handleTerminalRoutes } = require(path.join(root, "dist", "routes", "terminal-routes.js"));
const { handleSftpOpenRoutes } = require(path.join(root, "dist", "routes", "sftp-open-routes.js"));
const { handleX11ForwardingRoutes } = require(path.join(root, "dist", "routes", "x11-forwarding-routes.js"));
const { handleX11ApplicationRoutes } = require(path.join(root, "dist", "routes", "x11-application-routes.js"));
const { getSftpConnection } = require(path.join(root, "dist", "sftp-session.js"));

function passwordConnection(overrides={}) {
  return {
    name:"temporary",
    ssh_host:"example.com",
    ssh_port:22,
    ssh_user:"root",
    auth_type:"password",
    ssh_password:"test-only-secret",
    ...overrides
  };
}

function frontendContext() {
  const context = {
    connections:[
      {id:1, name:"saved", ssh_host:"example.com", ssh_port:22, ssh_user:"root"},
      {id:2, name:"ipv6", ssh_host:"2001:db8::1", ssh_port:2200, ssh_user:"admin"}
    ],
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "public", "app-quick-ssh.js"), "utf8"), context, {filename:"app-quick-ssh.js"});
  return context;
}

async function main() {
  assert.equal(QUICK_TERMINAL_TICKET_TTL_MS, 12 * 60 * 60 * 1000);
  const frontend = frontendContext();
  assert.deepEqual(
    JSON.parse(JSON.stringify(frontend.parseQuickSshTarget("root@example.com:22"))),
    {raw:"root@example.com:22", user:"root", host:"example.com", port:22, user_missing:false}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(frontend.parseQuickSshTarget("[2001:db8::1]:2200"))),
    {raw:"[2001:db8::1]:2200", user:"", host:"2001:db8::1", port:2200, user_missing:true}
  );
  assert.equal(frontend.parseQuickSshTarget("host-only").port, 22);
  assert.equal(frontend.parseQuickSshTarget("alice@example.com@[2001:db8::1]:2222").user, "alice@example.com");
  assert.equal(frontend.parseQuickSshTarget("host:bad"), null);
  assert.equal(frontend.parseQuickSshTarget("-oProxyCommand=bad"), null);
  assert.deepEqual(Array.from(frontend.quickSshExactConnections(frontend.parseQuickSshTarget("root@example.com")), item => item.id), [1]);
  assert.deepEqual(Array.from(frontend.quickSshExactConnections(frontend.parseQuickSshTarget("[2001:db8::1]:2200")), item => item.id), [2]);
  assert.match(fs.readFileSync(path.join(root, "public", "app-workspace.js"), "utf8"), /tab\.kind !== "quick-terminal"/);
  assert.match(fs.readFileSync(path.join(root, "public", "app-workspace-groups.js"), "utf8"), /tab\.kind === "quick-terminal"/);
  console.log("PASS quick SSH target parsing and saved connection matching");

  const normalized = normalizeQuickTerminalConnection(passwordConnection());
  assert.equal(normalized.quick_connection, true);
  assert.equal(normalized.x11_mode, "off");
  assert.equal(normalized.extra_args, "");
  assert.throws(() => normalizeQuickTerminalConnection(passwordConnection({ssh_host:"-oProxyCommand=bad"})), /主机/);
  assert.throws(() => normalizeQuickTerminalConnection(passwordConnection({ssh_user:""})), /用户/);
  assert.throws(() => normalizeQuickTerminalConnection(passwordConnection({ssh_port:70000})), /1-65535/);
  assert.throws(() => normalizeQuickTerminalConnection({...passwordConnection(), auth_type:"key", identity_file:"C:\\outside\\id_rsa"}), /私钥|路径|目录/);
  console.log("PASS quick SSH runtime validation rejects host, user, port and key path escapes");

  const ticket = createQuickTerminalTicket(passwordConnection(), "session-a");
  assert.ok(Number.isSafeInteger(ticket.connection.id) && ticket.connection.id < 0);
  assert.equal(ticket.connection.ssh_password, undefined);
  assert.equal(ticket.connection.private_key_passphrase, undefined);
  assert.equal(ticket.connection.identity_file, undefined);
  const consumed = consumeQuickTerminalTicket(ticket.token, "session-a");
  assert.equal(consumed.ssh_password, "test-only-secret");
  consumed.ssh_password = "";
  assert.equal(consumeQuickTerminalTicket(ticket.token, "session-a").ssh_password, "test-only-secret");
  assert.equal(authorizeQuickConnectionId(ticket.connection.id, ticket.token, "session-a").ssh_host, "example.com");
  assert.throws(() => authorizeQuickConnectionId(ticket.connection.id - 1, ticket.token, "session-a"), /不匹配/);
  assert.throws(() => authorizeQuickConnectionId(ticket.connection.id, ticket.token, "session-b"), /失效/);
  assert.equal(resolveQuickConnectionById(ticket.connection.id).ssh_host, "example.com");
  assert.equal(getSftpConnection(ticket.connection.id).ssh_user, "root");

  const wrongBinding = createQuickTerminalTicket(passwordConnection(), "session-a");
  assert.throws(() => consumeQuickTerminalTicket(wrongBinding.token, "session-b"), /失效/);
  assert.equal(consumeQuickTerminalTicket(wrongBinding.token, "session-a").ssh_user, "root");
  assert.deepEqual(revokeQuickTerminalTicket(wrongBinding.token, "session-b"), {ok:false, connection_id:0});
  const revokedConnectionId = wrongBinding.connection.id;
  assert.deepEqual(revokeQuickTerminalTicket(wrongBinding.token, "session-a"), {ok:true, connection_id:revokedConnectionId});
  assert.equal(resolveQuickConnectionById(revokedConnectionId), null);
  assert.throws(() => consumeQuickTerminalTicket(wrongBinding.token, "session-a"), /失效/);
  const expired = createQuickTerminalTicket(passwordConnection(), "session-a");
  purgeExpiredQuickTerminalTickets(Date.now() + QUICK_TERMINAL_TICKET_TTL_MS + 1);
  assert.throws(() => consumeQuickTerminalTicket(expired.token, "session-a"), /失效/);
  console.log("PASS quick connection credentials are request-bound, reusable, revocable and expiring");

  let created = null;
  let sent = null;
  const handled = await handleTerminalRoutes({method:"POST"}, {}, "/api/terminal/quick-tickets", {
    createQuickTerminalTicket(value, binding) { created = {value, binding}; return {token:"ticket"}; },
    createTerminalStartupTicket() { throw new Error("unexpected startup ticket"); },
    getConnection() { throw new Error("unexpected connection lookup"); },
    isDesktopCapabilityRequest() { return false; },
    async readJson() { return passwordConnection(); },
    requestAuthenticationBinding() { return "session-binding"; },
    requireEncryptionUnlocked() { throw new Error("password quick connect must not require stored-secret unlock"); },
    revokeQuickTerminalTicket() { throw new Error("unexpected revoke"); },
    sendJson(_response, data, status) { sent = {data, status}; }
  });
  assert.equal(handled, true);
  assert.equal(created.binding, "session-binding");
  assert.equal(created.value.ssh_host, "example.com");
  assert.deepEqual(sent, {data:{token:"ticket"}, status:201});
  let unlockChecked = false;
  await handleTerminalRoutes({method:"POST"}, {}, "/api/terminal/quick-tickets", {
    createQuickTerminalTicket() { return {token:"key-ticket"}; },
    createTerminalStartupTicket() { throw new Error("unexpected startup ticket"); },
    getConnection() { throw new Error("unexpected connection lookup"); },
    isDesktopCapabilityRequest() { return false; },
    async readJson() { return {...passwordConnection(), auth_type:"key", ssh_password:"", identity_file:"test-key"}; },
    requestAuthenticationBinding() { return "session-binding"; },
    requireEncryptionUnlocked() { unlockChecked = true; },
    revokeQuickTerminalTicket() { throw new Error("unexpected revoke"); },
    sendJson() {}
  });
  assert.equal(unlockChecked, true);
  let disconnectedId = 0;
  let closedTerminalId = 0;
  let revokedBinding = "";
  sent = null;
  await handleTerminalRoutes({method:"DELETE"}, {}, "/api/terminal/quick-tickets", {
    createQuickTerminalTicket() { throw new Error("unexpected create"); },
    createTerminalStartupTicket() { throw new Error("unexpected startup ticket"); },
    getConnection() { throw new Error("unexpected connection lookup"); },
    isDesktopCapabilityRequest() { return false; },
    async readJson() { return {token:"quick-ticket"}; },
    requestAuthenticationBinding() { return "session-binding"; },
    requireEncryptionUnlocked() {},
    revokeQuickTerminalTicket(token, binding) {
      assert.equal(token, "quick-ticket");
      revokedBinding = binding;
      return {ok:true, connection_id:-42};
    },
    closeQuickConnectionTerminals(id) { closedTerminalId = id; },
    disconnectSftpSession(id) { disconnectedId = id; },
    sendJson(_response, data, status) { sent = {data, status}; }
  });
  assert.equal(revokedBinding, "session-binding");
  assert.equal(closedTerminalId, -42);
  assert.equal(disconnectedId, -42);
  assert.deepEqual(sent, {data:{ok:true, connection_id:-42}, status:undefined});
  console.log("PASS quick connection routes bind creation and revocation to the authenticated request");

  const terminalSource = fs.readFileSync(path.join(root, "public", "app-terminal.js"), "utf8");
  const quickSshSource = fs.readFileSync(path.join(root, "public", "app-quick-ssh.js"), "utf8");
  const dockingSource = fs.readFileSync(path.join(root, "public", "app-docking.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "public", "app-api.js"), "utf8");
  const x11Source = fs.readFileSync(path.join(root, "public", "app-x11.js"), "utf8");
  assert.match(terminalSource, /quickConnectionsById/);
  assert.match(terminalSource, /terminal-action-sftp/);
  assert.match(apiSource, /X-Terma-Quick-Connection/);
  assert.match(x11Source, /openQuickX11Terminal/);
  assert.match(x11Source, /function activeXServerManagerContext\(\)/);
  assert.match(x11Source, /const tabKey[^\n]+activeTabKey[\s\S]+terminalSessions\.get\(tabKey\)/, "X Server 管理器必须优先使用当前活动终端上下文");
  assert.doesNotMatch(x11Source, /currentConnection\(xServerManagerConnectionId\)\s*\|\|\s*currentConnection\(\)/, "X Server 管理器不得回退到无关的左侧选中服务器");
  assert.match(x11Source, /openXServerManager\(connectionId, terminalKey\)/, "临时 X11 菜单必须把连接和终端上下文传给 X Server 管理器");
  assert.match(x11Source, /配置命令已放入当前临时终端/, "临时 X11 手动配置必须复用当前终端且等待用户确认执行");
  assert.match(x11Source, /quickConnection \? "" : `<button[^`]+changeConnectionDefaultX11/s, "临时连接不得显示会写数据库的默认 X11 操作");
  assert.match(apiSource, /\(sftp\|x11-forwarding\|x11-applications\)/, "临时连接令牌必须同时保护 SFTP、X11 管理与应用探测请求");
  assert.match(terminalSource, /\["terminal", "quick-terminal"\]\.includes\(tab\.kind\)/, "临时终端必须参与终端工具栏挂载");
  assert.match(dockingSource, /kind === "terminal" && tab\.kind === "quick-terminal"/, "工作区必须把临时终端识别为终端工具栏所有者");
  assert.match(quickSshSource, /const submission = \{form, cancelled:false\}/, "快速认证必须用独立请求状态区分用户取消和指纹弹窗替换");
  assert.doesNotMatch(quickSshSource, /if \(!form\.isConnected \|\| \$\("modal"\)\?\.dataset\.quickSshAuth/, "主机指纹弹窗替换认证表单后不得中止快速连接");
  assert.match(quickSshSource, /submission\.cancelled[\s\S]*\/api\/terminal\/quick-tickets[\s\S]*method:"DELETE"/, "用户取消时必须回收已经创建的临时凭据");
  console.log("PASS quick connection UI exposes SFTP and X11 through the bound capability token");

  let authorizedX11Id = 0;
  let detectedX11Id = 0;
  sent = null;
  assert.equal(await handleX11ForwardingRoutes(
    {method:"GET"},
    {},
    "/api/connections/-42/x11-forwarding",
    {
      authorizeConnection(_request, connectionId) {
        authorizedX11Id = Number(connectionId);
        return {id:Number(connectionId), name:"temporary", quick_connection:true};
      },
      createRemoteAdminGrant() { throw new Error("unexpected grant"); },
      async detectSshX11ForConnection(connection) {
        detectedX11Id = connection.id;
        return {ready:true};
      },
      async readJson() { throw new Error("unexpected body"); },
      releaseRemoteAdminGrant() {},
      sendJson(_response, data, status) { sent = {data, status}; },
      async startSshX11ConfigurationTask() { throw new Error("unexpected task"); }
    }
  ), true);
  assert.equal(authorizedX11Id, -42);
  assert.equal(detectedX11Id, -42);
  assert.deepEqual(sent, {data:{ready:true}, status:undefined});
  await assert.rejects(
    () => handleX11ForwardingRoutes(
      {method:"GET"},
      {},
      "/api/connections/-42/x11-forwarding",
      {
        authorizeConnection() { throw new Error("quick token rejected"); },
        createRemoteAdminGrant() { throw new Error("unexpected grant"); },
        async detectSshX11ForConnection() { throw new Error("must not probe"); },
        async readJson() { return {}; },
        releaseRemoteAdminGrant() {},
        sendJson() {},
        async startSshX11ConfigurationTask() { throw new Error("unexpected task"); }
      }
    ),
    /quick token rejected/
  );
  console.log("PASS quick X11 inspection authorizes the transient connection before probing the host");

  let listedX11ConnectionId = 0;
  sent = null;
  assert.equal(await handleX11ApplicationRoutes(
    {method:"POST"}, {}, "/api/connections/-42/x11-applications", {
      authorizeConnection(_request, connectionId) { return {id:Number(connectionId), quick_connection:true}; },
      async installForConnection() { throw new Error("unexpected install"); },
      async installPlanForConnection() { throw new Error("unexpected plan"); },
      async listForConnection(connection) { listedX11ConnectionId = connection.id; return {applications:[]}; },
      async readJson() { throw new Error("unexpected body"); },
      sendJson(_response, data, status) { sent = {data, status}; },
      async verifyForConnection() { throw new Error("unexpected verify"); }
    }
  ), true);
  assert.equal(listedX11ConnectionId, -42);
  assert.deepEqual(sent, {data:{discovery:{applications:[]}}, status:undefined});
  let uninstalledX11ConnectionId = 0;
  sent = null;
  assert.equal(await handleX11ApplicationRoutes(
    {method:"POST"}, {}, "/api/connections/-42/x11-applications/install", {
      authorizeConnection(_request, connectionId) { return {id:Number(connectionId), quick_connection:true}; },
      async installForConnection(connection, data) {
        uninstalledX11ConnectionId = connection.id;
        assert.deepEqual(data, {action:"uninstall", admin_auth:{token:"grant-token"}});
        return {ok:true, action:"uninstall"};
      },
      async installPlanForConnection() { throw new Error("unexpected plan"); },
      async listForConnection() { throw new Error("unexpected list"); },
      async readJson() { return {action:"uninstall", admin_auth:{token:"grant-token"}}; },
      sendJson(_response, data, status) { sent = {data, status}; },
      async verifyForConnection() { throw new Error("unexpected verify"); }
    }
  ), true);
  assert.equal(uninstalledX11ConnectionId, -42);
  assert.deepEqual(sent, {data:{ok:true, action:"uninstall"}, status:undefined});
  await assert.rejects(() => handleX11ApplicationRoutes(
    {method:"POST"}, {}, "/api/connections/-42/x11-applications/install-plan", {
      authorizeConnection() { throw new Error("quick X11 token rejected"); },
      async installForConnection() { throw new Error("must not install"); },
      async installPlanForConnection() { throw new Error("must not plan"); },
      async listForConnection() { throw new Error("must not list"); },
      async readJson() { return {}; },
      sendJson() {},
      async verifyForConnection() { throw new Error("must not verify"); }
    }
  ), /quick X11 token rejected/);
  console.log("PASS quick X11 application routes authorize the transient connection before probing, installing or uninstalling");

  let authorizedSftpId = 0;
  let streamedSftpId = 0;
  assert.equal(handleSftpOpenRoutes(
    {method:"GET", url:"/api/connections/-42/sftp/open?path=%2Ftmp%2Ffile.txt"},
    {},
    "/api/connections/-42/sftp/open",
    {
      authorizeConnectionId(_request, connectionId) { authorizedSftpId = connectionId; return connectionId; },
      runtimeSettingsFile:"runtime.json",
      readRuntimeSettings() { return {sftp_max_open_file_size_mb:50}; },
      secureHeaders(headers) { return headers; },
      streamRemoteOpenFile(connectionId) { streamedSftpId = connectionId; }
    }
  ), true);
  assert.equal(authorizedSftpId, -42);
  assert.equal(streamedSftpId, -42);
  console.log("PASS quick SFTP streaming route requires connection authorization before reading");

  await require("./credential-repair-check.js")();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
