const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const {
  X11_APPLICATION_CATALOG,
  X11_DISCOVERY_SCRIPT,
  buildRemoteX11InstallPlan,
  discoverRemoteX11Applications,
  parseX11ApplicationDiscovery,
  verifyRemoteX11Application
} = require("../dist/x11");
const { shouldFallbackFromX11 } = require("../dist/ssh2-client");
const { buildRemotePosixCommand } = require("../dist/remote-posix");
const legacyPrefix = ["T", "D"].join("");

function unwrapRemotePosixCommand(command) {
  const match = /^\/bin\/sh -c 'terma_payload=([A-Za-z0-9+/=]+);/.exec(String(command || ""));
  assert.ok(match, "remote X11 probe must use the login-shell-safe POSIX wrapper");
  return Buffer.from(match[1], "base64").toString("utf8");
}

async function main() {
  assert.equal(shouldFallbackFromX11({requested:true, available:false}), true);
  assert.equal(shouldFallbackFromX11({requested:true, available:true}), false);
  assert.equal(shouldFallbackFromX11(null), false);
  assert.ok(X11_APPLICATION_CATALOG.some(item => item.id === "xterm"));
  assert.ok(X11_APPLICATION_CATALOG.some(item => item.id === "konsole"));
  assert.match(X11_DISCOVERY_SCRIPT, /command -v 'xterm'/);
  assert.match(X11_DISCOVERY_SCRIPT, /command -v 'startplasma-x11'/);
  assert.match(X11_DISCOVERY_SCRIPT, /PACKAGE_MANAGER/);
  assert.match(X11_DISCOVERY_SCRIPT, /PRIVILEGED/);

  const aptPlan = buildRemoteX11InstallPlan({platform:"Linux", package_manager:"apt", privileged:false});
  assert.equal(aptPlan.supported, true);
  assert.equal(aptPlan.requires_password, true);
  assert.match(aptPlan.command, /sudo apt install -y/);
  const macPlan = buildRemoteX11InstallPlan({platform:"Darwin", package_manager:"brew", privileged:false});
  assert.equal(macPlan.supported, true);
  assert.match(macPlan.command, /XQuartz-2\.8\.6\.pkg/);
  assert.match(macPlan.command, /shasum -a 256/);
  assert.match(macPlan.command, /pkgutil --check-signature/);
  assert.match(macPlan.command, /sudo \/usr\/sbin\/installer/);

  const parsed = parseX11ApplicationDiscovery([
    "TERMA_X11_APPS_V1",
    "PLATFORM\tLinux",
    "XAUTH\t/usr/bin/xauth",
    "XQUARTZ\t0",
    "PACKAGE_MANAGER\tapt",
    "PRIVILEGED\t0",
    "APP\txterm\t/usr/bin/xterm",
    "APP\tkonsole\t/usr/bin/konsole",
    "APP\tdolphin\t/usr/bin/dolphin"
  ].join("\n"));
  assert.equal(parsed.platform, "linux");
  assert.equal(parsed.xauth_available, true);
  assert.equal(parsed.package_manager, "apt");
  assert.equal(parsed.privileged, false);
  assert.equal(parsed.xquartz_installed, false);
  assert.deepEqual(parsed.applications.map(item => item.id), ["xterm", "konsole", "dolphin"]);
  assert.equal(parsed.applications[2].mode, "trusted");
  const legacyParsed = parseX11ApplicationDiscovery([
    `${legacyPrefix}_X11_APPS_V1`,
    "PLATFORM\tLinux",
    "XAUTH\t/usr/bin/xauth",
    "APP\txterm\t/usr/bin/xterm"
  ].join("\n"));
  assert.equal(legacyParsed.applications[0].id, "xterm");

  const discovered = await discoverRemoteX11Applications(async command => {
    assert.equal(command, buildRemotePosixCommand(X11_DISCOVERY_SCRIPT));
    return {status:0, stdout:"TERMA_X11_APPS_V1\nPLATFORM\tLinux\nXAUTH\t\nAPP\txclock\t/usr/bin/xclock\n"};
  });
  assert.equal(discovered.applications[0].id, "xclock");
  assert.equal(discovered.warnings.length, 1);
  assert.match(discovered.warnings[0], /如果终端已获得 DISPLAY 且图形程序可以打开，可继续使用/);

  const verified = await verifyRemoteX11Application(async command => {
    assert.match(unwrapRemotePosixCommand(command), /command -v '\/usr\/bin\/xterm'/);
    return {status:0, stdout:"TERMA_X11_APP_OK\t/usr/bin/xterm\n"};
  }, "/usr/bin/xterm");
  assert.equal(verified.path, "/usr/bin/xterm");
  const legacyVerified = await verifyRemoteX11Application(async () => ({status:0, stdout:`${legacyPrefix}_X11_APP_OK\t/usr/bin/xterm\n`}), "/usr/bin/xterm");
  assert.equal(legacyVerified.path, "/usr/bin/xterm");

  await assert.rejects(
    () => verifyRemoteX11Application(async () => ({status:127, stdout:"TERMA_X11_APP_MISSING\n"}), "missing-app"),
    /未安装|无法执行/
  );
  assert.throws(() => parseX11ApplicationDiscovery("ordinary output"), /无法识别/);

  const x11Terminal=fs.readFileSync(path.join(__dirname,'../frontend/src/features/x11/terminal-service.ts'),'utf8');
  const remoteFrontend = [
    ...['terminal-service','remote-service','local-service','launcher-service','LauncherView'].map(name=>fs.readFileSync(path.join(__dirname,'../frontend/src/features/x11/'+name+'.ts'),'utf8')),
    readFrontendDomain(path.join(__dirname, ".."), "remote"),
    fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "features", "quick", "quick-views.ts"), "utf8")
  ].join("\n");
  const frontendCss = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
  const connectionFrontend = fs.readFileSync(path.join(__dirname, "../frontend/src/features/connections/connection-host.ts"), "utf8");
  const terminalToolbar = fs.readFileSync(path.join(__dirname, '../frontend/src/features/terminal/terminal-toolbar-service.ts'), 'utf8');
  const desktopRuntime = fs.readFileSync(path.join(__dirname, '../frontend/src/features/remote/remote-desktop-runtime.ts'), 'utf8');
  const desktopProbe = fs.readFileSync(path.join(__dirname, '../frontend/src/features/remote/resource-probe.ts'), 'utf8');
  const remoteProfileForm = fs.readFileSync(path.join(__dirname, '../frontend/src/features/connections/RemoteProfileForm.tsx'), 'utf8');
  const utilityFrontend = fs.readFileSync(path.join(__dirname, "../frontend/src/shared/action-menu.ts"), "utf8");
  const terminalMenuFrontend = [
    fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "features", "terminal", "terminal-controls-mount.ts"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "features", "terminal", "TerminalDisplayMenuView.ts"), "utf8")
  ].join("\n");
  const ssh2Source = fs.readFileSync(path.join(__dirname, "..", "src", "ssh2-client.ts"), "utf8");
  const terminalSource = fs.readFileSync(path.join(__dirname, "..", "src", "terminal.ts"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "xserver-runtime.js"), "utf8");
  assert.match(x11Terminal, /port\.override\(key,\{\.\.\.port\.startup\(c\),x11_mode:value\}\);return port\.openTerminal\(c\.id,key,title\)/, "临时终端配置必须保留 X11 模式");
  assert.match(remoteFrontend, /\/x11-applications["'`]/);
  assert.match(remoteFrontend, /x11-applications\/verify/);
  assert.match(remoteFrontend, /termaX11\.openGuide\(id\)/);
  assert.match(remoteFrontend, /安装远端 XQuartz/);
  assert.match(remoteFrontend, /不会继承其他终端中的 sudo -i/);
  const linuxModel = fs.readFileSync(path.join(__dirname, "../frontend/src/features/remote/linux-desktop-model.ts"), "utf8");
  const locale = require("../public/locales/zh-CN/remote.json").linux_desktop;
  assert.match(linuxModel, /macos \? 'macos_title' : 'title'/);
  assert.equal(locale.macos_title, "macOS X11 管理");
  assert.match(linuxModel, /macos \? 'macos_hint' : 'unsupported_hint'/);
  assert.match(locale.macos_hint, /macOS 不安装 Linux 桌面环境/);
  assert.match(remoteFrontend, /termaX11\.remote\.configureTerminal\(id, action, source\)/);
  assert.match(remoteFrontend, /x11\.sshd-config/, "SSH X11 管理授权必须绑定后端使用的精确 scope");
  assert.match(fs.readFileSync(path.join(__dirname,'../frontend/src/features/remote/admin-service.ts'),'utf8'),/quick\?'once'/,'temporary grants remain one-time');
  assert.match(desktopRuntime, /termaRemoteManagement\.setupGuide\(/);
  assert.match(remoteFrontend, /在终端执行/);
  const productivityFrontend = [
    readFrontendDomain(path.join(__dirname, ".."), "productivity"),
    fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "features", "quick", "QuickHeader.ts"), "utf8")
  ].join("\n");
  assert.match(productivityFrontend, /xServerQuickButton/);
  assert.match(remoteFrontend,/common:x11\.detected_applications/);
  assert.match(remoteFrontend, /state\.error\?'error':state\.loading\?'busy':warning\?'warning':'success'/);
  assert.doesNotMatch(remoteFrontend, /请在终端中输入 SSH 密码/);
  const connectionMenu = fs.readFileSync(path.join(__dirname, "../frontend/src/features/connections/connection-menu-service.ts"), "utf8");
  assert.match(connectionMenu, /key: 'x11'[\s\S]*?children: \(\) => port\.x11\(id\)/, "连接菜单应把 X11 操作声明为原位子菜单");
  assert.match(connectionFrontend, /x11: id => x11Services\.termaX11TerminalMenu\?\.actions\(id\)/, "连接菜单 X11 子菜单应复用领域入口");
  const x11Menu = fs.readFileSync(path.join(__dirname, '../frontend/src/features/x11/terminal-menu-service.ts'), 'utf8');
  for (const mode of ['untrusted', 'trusted', 'off']) {
    assert.ok(x11Menu.includes(`children: () => scopes(id, '${mode}', key)`), `${mode} X11 默认动作必须提供作用范围子菜单`);
  }
  assert.match(x11Menu, /current_terminal[\s\S]*new_terminal[\s\S]*next_start/, "X11 模式作用范围必须完整且顺序稳定");
  assert.match(terminalToolbar, /termaX11TerminalMenu\?\.openQuick\(event, key\)/, "临时终端应委托类型化 X11 菜单");
  assert.match(terminalToolbar, /termaX11TerminalMenu\?\.open\(event, id, key\)/, "SSH 终端应委托类型化 X11 菜单");
  assert.match(x11Terminal,/await persist\(id,value,fixed\.current\)[\s\S]*scope==='current'[\s\S]*port\.override[\s\S]*port\.reconnect/,'current scope persists before reconnect');
  assert.match(x11Terminal,/await persist\(id,value,fixed\.current\)[\s\S]*scope==='new'\)return open/,'new scope persists before opening');
  assert.match(utilityFrontend, /terminalServices\.termaTerminalActionMenu\?\.open/, "旧动作菜单入口应委托给 Vue 菜单");
  assert.match(terminalMenuFrontend, /desktopPath/, "Vue 动作菜单应保留桌面父级子菜单");
  assert.match(terminalMenuFrontend, /mobilePath/, "Vue 动作菜单应保留窄屏返回路径");
  assert.match(ssh2Source, /openBuiltinX11Channel/);
  assert.match(ssh2Source, /rewriteX11Authorization/);
  assert.match(ssh2Source, /probeBuiltinX11Session/);
  assert.match(ssh2Source, /shouldFallbackFromX11\(diagnostics\)[\s\S]*x11Options = null;/, "X11 探测失败后主终端必须移除 X11 请求");
  assert.match(ssh2Source, /远端没有分配 DISPLAY/);
  assert.match(terminalSource, /\[X11\] 转发已建立/);
  assert.match(terminalSource, /\[X11\] 转发未建立/);
  assert.match(terminalSource, /本次已自动降级为普通 SSH 终端/, "X11 降级必须向用户说明普通命令行仍可使用");
  assert.match(remoteProfileForm, /tr\('xdmcp_local_xserver_hint'/);
  assert.match(require('../public/locales/zh-CN/remote.json').auto.xdmcp_local_xserver_hint, /XDMCP 不依赖 SSH X11 转发/);
  assert.match(remoteFrontend, /renderSshX11ForwardingPanel/);
  assert.match(desktopProbe, /read\(id,'linux-desktop'\),read\(id,'x11-forwarding'\)/);
  assert.match(runtimeSource, /if \(await canConnect\(port, 250\)\) continue/);
  assert.match(runtimeSource, /"-multiwindow",[\s\S]*"-compositewm",[\s\S]*"-swcursor"/, "Windows 多窗口模式必须保留当前 Composite 与光标兼容参数");
  assert.doesNotMatch(runtimeSource, /"-nodecoration"/, "X Server 不得显式关闭窗口装饰");
  assert.match(runtimeSource, /"-swcursor"/, "Windows X Server 启动参数必须保留软件光标兼容开关");
  assert.match(frontendCss, /\.linux-desktop-card button\.primary[^}]*color:#fff !important/s, "Linux 桌面安装按钮文字必须保持清晰对比度");
  assert.match(frontendCss, /\.modal-card\s*\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow-y:auto/s, "通用弹窗必须限制在可视高度并内部滚动");
  assert.match(frontendCss, /\.modal-card:not\([^}]*> :is\(h2,\.modal-title-row[^}]*position:sticky/s, "通用弹窗标题必须在长内容滚动时保持可见");
  assert.match(frontendCss, /\.xserver-manager \.x11-forwarding-head small\s*\{[^}]*overflow:auto[^}]*overflow-wrap:anywhere/s, "X Server 长探测日志不得撑开弹窗");
  assert.doesNotMatch(remoteFrontend, /普通 SSH 终端不会自动获得 X11 转发/, "X Server 管理提示必须按连接的默认 X11 状态显示");
  console.log("X11 图形应用检查通过：远端自动识别、启动前校验、内置 SSH 转发和临时转发模式");
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
