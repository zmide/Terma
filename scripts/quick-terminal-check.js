const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

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
const { loadFrontendService } = require("./frontend-service-test-helper");

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

function frontendSsh(connections = null) {
  const context = {
    connections:connections || [
      {id:1, name:"saved", ssh_host:"example.com", ssh_port:22, ssh_user:"root"},
      {id:2, name:"ipv6", ssh_host:"2001:db8::1", ssh_port:2200, ssh_user:"admin"}
    ],
    console,
    tr:(key, options={}) => options.defaultValue || key
  };
  return loadFrontendService("frontend/src/features/quick/quick-ssh-service.ts").createQuickSshService(context);
}

async function checkFrontendTicketFlow(cancelAt) {
  const {createQuickSshService, createQuickSshFlow} = loadFrontendService("frontend/src/features/quick/quick-ssh-service.ts");
  const calls = [];
  const secret = {value:"synthetic-password"};
  const form = {dataset:{host:"example.com", reconnectKey:"fixture-quick-terminal"}};
  const fields = {quickSshUser:{value:"review"}, quickSshPort:{value:"2222"}, quickSshPassword:secret};
  const connection = {id:-42};
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const host = {
    $: id => fields[id],
    tr:(key, options) => options?.defaultValue || key,
    setButtonBusy() {},
    async api(route, options) {
      const method = options.method;
      calls.push([route, method, JSON.parse(options.body)]);
      if (cancelAt === 'preflight' && route === '/api/ssh/preflight') await gate;
      if (cancelAt === 'ticket' && method === 'POST' && route === '/api/terminal/quick-tickets') await gate;
      return {connection, token:'fixture-token'};
    },
    quickSessionId: key => key === 'fixture-quick-terminal' ? -42 : 0,
    openQuickTerminal() { assert.fail('A reauthentication must reuse its original terminal'); },
    resumeQuickTerminal: (key, record, token) => calls.push(['resume', key, record, token])
  };
  const service = createQuickSshService(host);
  const flow = createQuickSshFlow(host, service, {closeLauncher() {}, closeAuth() { flow.cancel(); }, openAuth: async () => {}});
  const submitted = flow.submit(form, null);
  await flow.submit(form, null);
  if (cancelAt) {
    flow.cancel();
    assert.equal(secret.value, '');
    release();
  }
  await submitted;
  assert.equal(secret.value, '');
  assert.equal(form.dataset.submitting, '');
  assert.deepEqual(calls[0], ['/api/ssh/preflight','POST',{connection:{ssh_user:'review',ssh_host:'example.com',ssh_port:2222}}]);
  if (cancelAt === 'preflight') {
    assert.equal(calls.length, 1);
    return;
  }
  assert.equal(calls[1][2].quick_connection_id, -42);
  assert.equal(calls[1][2].ssh_password, 'synthetic-password');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], cancelAt === 'ticket'
    ? ['/api/terminal/quick-tickets','DELETE',{token:'fixture-token'}]
    : ['resume','fixture-quick-terminal',connection,'fixture-token']);
}

async function main() {
  assert.equal(QUICK_TERMINAL_TICKET_TTL_MS, 12 * 60 * 60 * 1000);
  for (const phase of [null, "preflight", "ticket"]) await checkFrontendTicketFlow(phase);
  console.log("PASS quick SSH reauthentication, duplicate submission, credential clearing and cancellation around ticket creation");
  const frontend = frontendSsh();
  assert.deepEqual(
    JSON.parse(JSON.stringify(frontend.parse("root@example.com:22"))),
    {raw:"root@example.com:22", user:"root", host:"example.com", port:22, user_missing:false}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(frontend.parse("[2001:db8::1]:2200"))),
    {raw:"[2001:db8::1]:2200", user:"", host:"2001:db8::1", port:2200, user_missing:true}
  );
  assert.equal(frontend.parse("host-only").port, 22);
  assert.equal(frontend.parse("alice@example.com@[2001:db8::1]:2222").user, "alice@example.com");
  assert.equal(frontend.parse("host:bad"), null);
  assert.equal(frontend.parse("-oProxyCommand=bad"), null);
  for (const value of ["", "a b", "host:0", "host:65536", "[::1]:0", "[::1]:bad", "host/path", "\0", "@host"]) {
    assert.equal(frontend.parse(value), null, `target format remains rejected ${JSON.stringify(value)}`);
  }
  assert.equal(frontend.endpoint({user:"review",host:"2001:db8::1",port:2200}),"review@[2001:db8::1]:2200");
  assert.deepEqual(Array.from(frontend.matching(frontend.parse("root@example.com")), item => item.id), [1]);
  assert.deepEqual(Array.from(frontend.matching(frontend.parse("[2001:db8::1]:2200")), item => item.id), [2]);
  const {createWorkspaceStateService} = loadFrontendService("frontend/src/features/workspace/workspace-state-service.ts");
  const workspaceState = createWorkspaceStateService({
    mainId:"workspace-main", legacyNames:new Set(), nextGroupId:() => "group", defaultName:() => "Workspace"
  });
  assert.equal(workspaceState.persistableTab({key:"temporary", kind:"quick-terminal"}), null,
    "temporary quick connection credentials cannot enter saved workspace groups");
  assert.equal(workspaceState.persistableTab({key:"saved", kind:"terminal", id:1}).id, 1);
  console.log("PASS quick SSH target parsing and saved connection matching");

  const searchConnections = [
    {id:3,name:"Node 10",group_name:"实验",tags:["blue"],ssh_host:"node-10.example",ssh_user:"admin",ssh_port:2200,favorite:0,forwards:[]},
    {id:2,name:"Node 2",group_name:"生产",tags:["green"],ssh_host:"prod.example",ssh_user:"root",ssh_port:22,favorite:1,forwards:[
      {id:22,service_name:"SOCKS 10",mode:"socks",status:"stopped",bind_host:"127.0.0.1",bind_port:1080,target_host:"",target_port:"",url_path:"",service_note:"dynamic proxy"},
      {id:21,service_name:"HTTP 2",mode:"local",status:"running",bind_host:"127.0.0.1",bind_port:8080,target_host:"127.0.0.1",target_port:80,url_scheme:"http",url_path:"/status"}
    ]},
    {id:1,name:"Node 1",group_name:"生产",tags:["blue"],ssh_host:"other.example",ssh_user:"root",ssh_port:22,favorite:0,forwards:[]}
  ];
  const searchContext = frontendSsh(searchConnections);
  let dynamicAlias = "dynamic forwarding";
  const searchPort = {
    connections:searchConnections,
    tr(key, options={}) {
      return key.endsWith("search_alias_socks") ? dynamicAlias : options.defaultValue || key;
    },
    parseQuickSshTarget:value => searchContext.parse(value),
    quickSshExactConnections:target => searchContext.matching(target)
  };
  const {createQuickConnectSearchService} = loadFrontendService("frontend/src/features/quick/quick-connect-search-service.ts");
  const search = createQuickConnectSearchService(searchPort);
  assert.deepEqual(Array.from(search.connectionRows(), item => item.id), [2,1,3]);
  assert.deepEqual(Array.from(search.connectionRows("node 2"), item => item.id), [2]);
  assert.deepEqual(Array.from(search.connectionRows("prod.example"), item => item.id), [2]);
  assert.deepEqual(Array.from(search.connectionRows("root@prod.example"), item => item.id), [2]);
  assert.deepEqual(Array.from(search.connectionRows("missing.example")), []);
  assert.deepEqual(Array.from(search.forwardRows("node-10.example")), []);
  assert.deepEqual(Array.from(search.forwardRows("node 2")).map(row => row.forward.id), [21,22]);
  assert.deepEqual(Array.from(search.forwardRows("status")).map(row => row.forward.id), [21]);
  assert.deepEqual(Array.from(search.forwardRows("dynamic forwarding")).map(row => row.forward.id), [22]);
  dynamicAlias = "SOCKS 动态代理";
  assert.deepEqual(Array.from(search.forwardRows("socks 动态代理")).map(row => row.forward.id), [22]);
  searchConnections[2].name = "Node 11";
  assert.deepEqual(Array.from(search.connectionRows("node 11"), item => item.id), [1]);
  console.log("PASS quick connection and forwarding search, stable order, locale aliases and in-place cache refresh");

  const {createQuickConnectActions} = loadFrontendService("frontend/src/features/quick/quick-connect-actions.ts");
  const actions = [];
  const actionService = createQuickConnectActions({
    close: () => actions.push("close"),
    connection: (mode, id) => actions.push([mode,id]),
    openForwards: (id, forwardId) => actions.push(["forward",id,forwardId]),
    findForward: id => searchConnections[1].forwards.find(forward => forward.id === id),
    isActive: forward => forward.status === "running",
    forwardMissing: () => actions.push("missing"),
    async command(kind,id) { await Promise.resolve(); actions.push([kind,id]); },
    refresh: () => actions.push("refresh"),
    direct: query => actions.push(["direct",query])
  }, search);
  actionService.connection("edit", "Infinity");
  actionService.openForward(1, "0.1");
  actionService.submit("prod.example");
  actionService.submit("HTTP 2");
  actionService.submit("missing.example");
  await actionService.toggle({dataset:{forwardId:"invalid"}});
  await actionService.toggle({dataset:{forwardId:"23"}});
  await actionService.toggle({dataset:{forwardId:"21"}});
  await actionService.toggle({dataset:{forwardId:"22"}});
  assert.deepEqual(actions, [
    "close",["terminal",2],"close",["forward",2,21],["direct","missing.example"],
    "missing",["stop",21],"refresh",["start",22],"refresh"
  ]);
  console.log("PASS quick connection action selection, forwarding command and refresh order");

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

  const terminalSource = readFrontendDomain(root, "terminal");
  const terminalBackendSource = fs.readFileSync(path.join(root, "src", "terminal.ts"), "utf8");
  const quickActionSource = fs.readFileSync(path.join(root, "frontend/src/features/quick/quick-connect-actions.ts"), "utf8");
  const quickSshServiceSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "quick-ssh-service.ts"), "utf8");
  const quickViewsSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "quick-views.ts"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "frontend/src/shared/api/workspace-request.ts"), "utf8");
  const x11Source = fs.readFileSync(path.join(root, "frontend/src/features/x11/x11-runtime.ts"), "utf8");
  assert.match(terminalSource, /quickConnectionsById/);
  const connectionSource = fs.readFileSync(path.join(root, "frontend/src/features/terminal/terminal-connection-service.ts"), "utf8");
  assert.match(connectionSource, /&language=\$\{encodeURIComponent\(port\.language\(\)\)\}/);
  assert.match(fs.readFileSync(path.join(root,"frontend/src/entries/about-embed.ts"),"utf8"), /language:\s*\(\)\s*=>\s*normalizeTermaLanguage\(document\.documentElement\.lang/);
  assert.match(terminalBackendSource, /function normalizeTerminalLanguage\(value\)[\s\S]*=== "en-US" \? "en-US" : "zh-CN"/);
  assert.match(terminalBackendSource, /Connected to \$\{endpoint\}/);
  assert.match(terminalBackendSource, /\[X11\] Forwarding established: \$\{x11Diagnostics\.display\}/);
  const terminalToolbar = fs.readFileSync(path.join(root, 'frontend/src/features/terminal/TerminalToolbarView.ts'), 'utf8');
  assert.match(terminalToolbar, /terminal-action-sftp/);
  assert.match(terminalToolbar, /actionsPort\?\.sftp\(model\.connectionId\)/);
  assert.match(apiSource, /X-Terma-Quick-Connection/);
  assert.match(x11Source, /quick: feature\.terminal\.quick/);
  const x11HostSource = fs.readFileSync(path.join(root, "frontend/src/features/x11/x11-host.ts"), "utf8");
  const x11ContextSource = fs.readFileSync(path.join(root, 'frontend/src/features/x11/context-service.ts'), 'utf8');
  assert.match(x11HostSource, /activeContext: context.active/, "X Server 管理器入口必须委托上下文所有者");
  assert.match(x11ContextSource, /port\.activeKey\(\)[\s\S]+port\.session\(terminalKey\)\?\.connection/, "X Server 管理器必须优先使用当前活动终端上下文");
  assert.doesNotMatch(x11Source, /currentConnection\(xServerManagerConnectionId\)\s*\|\|\s*currentConnection\(\)/, "X Server 管理器不得回退到无关的左侧选中服务器");
  const x11MenuSource = fs.readFileSync(path.join(root, 'frontend/src/features/x11/terminal-menu-service.ts'), 'utf8');
  assert.match(x11MenuSource, /key: 'quick-manager'[\s\S]*port\.manager\(id, key\)/, "临时 X11 菜单必须把连接和终端上下文传给管理器端口");
  assert.match(x11Source, /manager: feature\.openManager/, "管理器端口须透传连接 ID 和终端键");
  const manualSource=fs.readFileSync(path.join(root,'frontend/src/features/x11/manual-terminal.ts'),'utf8');assert.ok(manualSource.includes('port.send(key,command)')&&manualSource.includes('common:x11.config_command_sent'),'临时X11配置复用原终端且只插入命令');
  assert.match(quickViewsSource, /const quickConnection(?:\s*:\s*any)?\s*=\s*Boolean\(connection\?\.quick_connection\)[\s\S]+?quickConnection\s*\?\s*""\s*:\s*\[h\(TermaButton[\s\S]+?termaX11\.changeDefault/, "临时连接不得显示会写数据库的默认 X11 操作");
  assert.match(apiSource, /\(sftp\|x11-forwarding\|x11-applications\|terminal-clipboard\)/, "临时连接令牌必须同时保护 SFTP、X11 管理、应用探测与终端剪贴板请求");
  assert.match(fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-toolbar-service.ts"),"utf8"), /tab\?\.kind === 'quick-terminal'/, "临时终端必须参与终端工具栏挂载");
  assert.match(fs.readFileSync(path.join(root, "frontend/src/features/workspace/workspace-toolbar-placement.ts"), "utf8"), /kind === "terminal" && tabKind === "quick-terminal"/, "工作区必须把临时终端识别为终端工具栏所有者");
  assert.match(quickSshServiceSource, /const submission = \{form, cancelled: false\}/, "快速认证必须用独立请求状态区分用户取消和指纹弹窗替换");
  assert.match(quickActionSource, /registry\.register\('quick-ssh-submit'[\s\S]*return flow\.submit\(element/, "快速认证入口注册类型化提交动作");
  assert.doesNotMatch(quickActionSource, /\/api\/ssh\/preflight|\/api\/terminal\/quick-tickets/, "事件注册复用认证服务");
  assert.match(quickSshServiceSource, /submission\.cancelled[\s\S]*method: 'DELETE'/, "用户取消时必须回收已经创建的临时凭据");
  assert.match(quickSshServiceSource, /clearPayloadSecrets\(payload\)/, "快速认证服务必须清理临时凭据字段");
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
