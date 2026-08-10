const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dgram = require("node:dgram");
const {EventEmitter} = require("node:events");
const {MAC_WINDOWS_APP_PACKAGE_URL, MAC_WINDOWS_APP_URL, createRemoteClientAdapter} = require("../desktop/remote-clients");
const {launchWindowsRdpWithCredential, windowsRdpCredentialTarget, windowsRdpCredentialTargets} = require("../desktop/windows-rdp-credentials");
const { readFrontendDomain } = require("./frontend-source");

const root = path.join(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-remote-client-"));
const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const remoteUiSource = readFrontendDomain(root, "remote");
const serverSource = fs.readFileSync(path.join(root, "src", "server.ts"), "utf8");
const connectivitySource = fs.readFileSync(path.join(root, "src", "remote-connectivity.ts"), "utf8");
const xserverSource = fs.readFileSync(path.join(root, "desktop", "xserver-runtime.js"), "utf8");
const desktopIntegrationRoutesSource = fs.readFileSync(path.join(root, "src", "routes", "desktop-integration-routes.ts"), "utf8");
const windowsCredentialScriptSource = fs.readFileSync(path.join(root, "desktop", "windows-rdp-credential.ps1"), "utf8");
const launches = [];
const shellLaunches = [];
const windowsCredentialLaunches = [];

function fakeSpawn(executable, args, options) {
  launches.push({executable,args,options});
  const child = new EventEmitter();
  child.stdin = {
    once() { return this; },
    end(value, callback) {
      launches.at(-1).stdin = Buffer.from(value || "");
      callback?.();
    }
  };
  child.unref = () => {};
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

function unavailableCommand() {
  return {status:1,stdout:"",stderr:""};
}

async function main() {
  const {
    __remoteClientDiagnosticsWithoutDesktopIntegration,
    __xServerDiagnosticsWithoutDesktopIntegration,
    __xdmcpTaskResourceKey
  } = require("../dist/server");
  const {probeXdmcpEndpoint, xdmcpQueryPacket} = require("../dist/remote-connectivity");
  const xdmcpResponder = dgram.createSocket("udp4");
  let receivedXdmcpQuery = null;
  xdmcpResponder.on("message", (message, remote) => {
    receivedXdmcpQuery = Buffer.from(message);
    xdmcpResponder.send(Buffer.from([0, 1, 0, 5, 0, 0]), remote.port, remote.address);
  });
  await new Promise((resolve, reject) => {
    xdmcpResponder.once("error", reject);
    xdmcpResponder.bind(0, "127.0.0.1", resolve);
  });
  const xdmcpProbe = await probeXdmcpEndpoint("127.0.0.1", xdmcpResponder.address().port, 500);
  xdmcpResponder.close();
  assert.deepEqual(receivedXdmcpQuery, xdmcpQueryPacket(), "XDMCP 降级探测必须发送标准 Query 数据包");
  assert.deepEqual(xdmcpProbe, {ok:true, responded:true, response:"willing", error:""});
  const resourceConnection = {id:42};
  assert.equal(__xdmcpTaskResourceKey(resourceConnection,{action:"enable"}), "xdmcp-server:42");
  assert.equal(__xdmcpTaskResourceKey(resourceConnection,{action:"repair-xrdp"}), "rdp-server:42");
  assert.equal(__xdmcpTaskResourceKey(resourceConnection,{action:"install-local-offline",target_action:"rdp"}), "rdp-server:42");
  assert.equal(__xdmcpTaskResourceKey(resourceConnection,{action:"install-lightdm"}), "xdmcp-server:42");
  const limitedClients = __remoteClientDiagnosticsWithoutDesktopIntegration({
    platform:"win32",
    available:true,
    running:true,
    server:"vcxsrv.exe",
    reason:"本机 X Server 已就绪"
  });
  assert.equal(limitedClients.desktop, false);
  assert.equal(limitedClients.integration_available, false);
  assert.match(limitedClients.rdp.reason, /系统 RDP 客户端只能由获得临时授权的本机浏览器或 Terma 桌面端调用/);
  assert.match(limitedClients.vnc.reason, /系统 VNC 客户端只能由获得临时授权的本机浏览器或 Terma 桌面端调用/);
  assert.equal(limitedClients.xdmcp.available, false);
  assert.match(limitedClients.xdmcp.reason, /^本机 X Server 已就绪；当前请求无法调用 Terma 桌面集成$/);
  assert.doesNotMatch(limitedClients.message, /RDP、VNC 和 XDMCP/);
  const limitedXServer = __xServerDiagnosticsWithoutDesktopIntegration({
    platform:"win32",
    available:true,
    running:true,
    server:"vcxsrv.exe",
    display:":0.0",
    reason:"本机 X Server 已就绪"
  });
  assert.equal(limitedXServer.desktop, false);
  assert.equal(limitedXServer.integration_available, false);
  assert.equal(limitedXServer.available, false, "独立后端不能把服务端进程状态冒充为桌面集成状态");
  assert.equal(limitedXServer.reason, "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server");
  assert.equal(limitedXServer.server_side.available, true);
  assert.equal(limitedXServer.server_side.server, "vcxsrv.exe");
  const browserLimitedXServer = __xServerDiagnosticsWithoutDesktopIntegration({
    platform:"win32",
    available:true,
    running:true,
    server:"vcxsrv.exe",
    display:":0.0"
  }, {
    desktop_backend_available:true,
    authorization_required:true,
    can_request_authorization:true
  }, "win32");
  assert.equal(browserLimitedXServer.available, true);
  assert.equal(browserLimitedXServer.authorization_required, true);
  assert.equal(browserLimitedXServer.can_request_authorization, true);
  assert.equal(browserLimitedXServer.reason, "当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。");
  assert.match(desktopIntegrationRoutesSource, /remote-clients\/diagnostics[\s\S]*?remoteClientDiagnosticsWithoutDesktopIntegration\(x11, scopedIntegration, platform\)/);
  assert.match(desktopIntegrationRoutesSource, /pathname === "\/api\/xserver"[\s\S]*?xServerDiagnosticsWithoutDesktopIntegration/);
  assert.match(windowsCredentialScriptSource, /CredWriteW/);
  assert.match(windowsCredentialScriptSource, /CredentialPersistSession/);
  assert.match(windowsCredentialScriptSource, /finally \{[\s\S]*?TermaWindowsCredential\]::Delete[\s\S]*?TermaWindowsCredential\]::Restore/);

  let credentialHelperLaunch = null;
  const helperResult = await launchWindowsRdpWithCredential({
    environment:{SystemRoot:"C:\\Windows"},
    executable:"C:\\Windows\\System32\\mstsc.exe",
    rdpFile:"C:\\Terma\\temporary.rdp",
    endpoint:"rdp.example:3389",
    username:"alice",
    password:"stdin-only-secret",
    cleanupSeconds:1,
    spawn:(executable,args,options) => {
      credentialHelperLaunch = {executable,args,options};
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        once() { return this; },
        end(value, callback) {
          credentialHelperLaunch.stdin = Buffer.from(value || "");
          callback?.();
          queueMicrotask(() => child.stdout.emit("data", Buffer.from("TERMA_RDP_CREDENTIAL_READY\r\n")));
        }
      };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });
  assert.deepEqual(helperResult.credential_targets, ["TERMSRV/rdp.example:3389", "TERMSRV/rdp.example"]);
  assert.doesNotMatch(JSON.stringify({executable:credentialHelperLaunch.executable,args:credentialHelperLaunch.args,options:credentialHelperLaunch.options}), /stdin-only-secret/);
  assert.equal(JSON.parse(credentialHelperLaunch.stdin.toString("utf8")).password, "stdin-only-secret");
  assert.equal(credentialHelperLaunch.options.windowsHide, true);

  const windows = createRemoteClientAdapter({
    platform:"win32",
    environment:{SystemRoot:"C:\\Windows",ProgramFiles:"C:\\Program Files"},
    dataDir:temporary,
    existsSync:file => file.endsWith("mstsc.exe") || file.endsWith("TigerVNC\\vncviewer.exe"),
    spawn:fakeSpawn,
    spawnSync:unavailableCommand,
    launchWindowsRdpWithCredential:async options => {
      windowsCredentialLaunches.push(options);
      return {credential_targets:windowsRdpCredentialTargets(options.endpoint)};
    },
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  const windowsDiagnostics = windows.diagnostics();
  assert.equal(windowsDiagnostics.rdp.available, true);
  assert.equal(windowsDiagnostics.vnc.available, true);
  assert.equal(windowsDiagnostics.rdp.password_transfer_mode, "windows-credential-manager");
  assert.match(windowsDiagnostics.password_policy, /临时凭据存储.*不会进入命令行/);

  const windowsRdpResult = await windows.open({id:1,protocol:"rdp",host:"rdp.example",port:3389,username:"alice",password:"must-not-leak",options:{fullscreen:false,width:1280,height:720,clipboard:true,allow_password_transfer:true}});
  const windowsCredentialLaunch = windowsCredentialLaunches.at(-1);
  assert.match(windowsCredentialLaunch.executable, /mstsc\.exe$/i);
  assert.equal(windowsCredentialLaunch.endpoint, "rdp.example:3389");
  assert.equal(windowsCredentialLaunch.username, "alice");
  assert.equal(windowsCredentialLaunch.password, "must-not-leak");
  assert.equal(windowsRdpCredentialTarget(windowsCredentialLaunch.endpoint), "TERMSRV/rdp.example:3389");
  assert.deepEqual(windowsRdpCredentialTargets(windowsCredentialLaunch.endpoint), ["TERMSRV/rdp.example:3389", "TERMSRV/rdp.example"]);
  assert.deepEqual(windowsRdpCredentialTargets("[2001:db8::11]:3389"), ["TERMSRV/[2001:db8::11]:3389", "TERMSRV/2001:db8::11"]);
  const rdpBytes = fs.readFileSync(windowsCredentialLaunch.rdpFile);
  assert.equal(rdpBytes[0], 0xff);
  assert.equal(rdpBytes[1], 0xfe);
  const rdpText = rdpBytes.toString("utf16le");
  assert.match(rdpText, /full address:s:rdp\.example:3389/);
  assert.match(rdpText, /screen mode id:i:1/);
  assert.match(rdpText, /desktopwidth:i:1280/);
  assert.match(rdpText, /desktopheight:i:720/);
  assert.match(rdpText, /dynamic resolution:i:0/);
  assert.match(rdpText, /prompt for credentials:i:0/);
  assert.doesNotMatch(rdpText, /must-not-leak/);
  assert.equal(windowsRdpResult.credentials, "windows-credential-manager");
  assert.equal(windowsRdpResult.password_transfer_requested, true);
  assert.equal(windowsRdpResult.password_transfer_supported, true);

  await windows.open({id:11,protocol:"rdp",host:"[2001:db8::11]",port:3389,username:"",password:"",options:{}});
  const ipv6RdpLaunch = launches.at(-1);
  const ipv6RdpText = fs.readFileSync(ipv6RdpLaunch.args[0]).toString("utf16le");
  assert.match(ipv6RdpText, /full address:s:\[2001:db8::11\]:3389/);

  await windows.open({id:2,protocol:"rdp",host:"generated.example",port:3389,username:"",options:{source_ssh_connection_id:42}});
  const generatedRdpLaunch = launches.at(-1);
  assert.match(generatedRdpLaunch.executable, /mstsc\.exe$/i);
  assert.notEqual(generatedRdpLaunch.options?.windowsHide, true, "mstsc 窗口不能被隐藏启动");
  assert.equal(generatedRdpLaunch.args.length, 1);
  const generatedRdpText = fs.readFileSync(generatedRdpLaunch.args[0]).toString("utf16le");
  assert.match(generatedRdpText, /full address:s:generated\.example:3389/);
  assert.doesNotMatch(generatedRdpText, /username:s:/);
  assert.doesNotMatch(generatedRdpText, /ssh-user/);
  assert.match(generatedRdpText, /dynamic resolution:i:1/);
  assert.match(generatedRdpText, /smart sizing:i:1/);

  await windows.open({id:2,protocol:"vnc",host:"vnc.example",port:5901,password:"must-not-leak",options:{quality:7,shared:true,view_only:true}});
  const vncLaunch = launches.at(-1);
  assert.match(vncLaunch.executable, /vncviewer\.exe$/i);
  assert.deepEqual(vncLaunch.args, ["vnc.example::5901","-QualityLevel=7","-Shared","-ViewOnly"]);
  assert.doesNotMatch(JSON.stringify(vncLaunch), /must-not-leak/);

  await windows.open({id:12,protocol:"vnc",host:"2001:db8::12",port:5901,password:"",options:{quality:7}});
  assert.deepEqual(launches.at(-1).args, ["[2001:db8::12]::5901", "-QualityLevel=7"]);

  const mac = createRemoteClientAdapter({
    platform:"darwin",
    environment:{HOME:"/Users/tester"},
    dataDir:temporary,
    existsSync:file => ["/Applications/Windows App.app","/System/Applications/Utilities/Screen Sharing.app"].includes(String(file).replace(/\\/g,"/")),
    spawn:fakeSpawn,
    spawnSync:unavailableCommand,
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  assert.equal(mac.diagnostics().rdp.client, "Windows App");
  assert.equal(mac.diagnostics().vnc.client, "屏幕共享");
  await mac.open({id:31,protocol:"rdp",host:"mac-rdp.example",port:3389,username:"desktop-user",options:{display_mode:"dynamic",width:1920,height:1080}});
  const macRdpLaunch = launches.at(-1);
  assert.deepEqual(macRdpLaunch.args.slice(0, 2), ["-a", "/Applications/Windows App.app"]);
  const macRdpText = fs.readFileSync(macRdpLaunch.args[2]).toString("utf16le");
  assert.match(macRdpText, /dynamic resolution:i:1/);
  assert.match(macRdpText, /desktopwidth:i:1920/);
  await assert.rejects(
    mac.open({id:32,protocol:"rdp",host:"mac-rdp.example",port:3389,username:"desktop-user",password:"mac-secret",options:{allow_password_transfer:true}}),
    /Windows App.*FreeRDP/
  );
  await mac.open({id:3,protocol:"vnc",host:"mac.example",port:5900,options:{}});
  assert.equal(shellLaunches.at(-1), "vnc://mac.example:5900");

  const macWithPasswordFreeRdp = createRemoteClientAdapter({
    platform:"darwin",
    environment:{HOME:"/Users/tester",DISPLAY:":0"},
    dataDir:temporary,
    existsSync:file => String(file).replace(/\\/g,"/") === "/Applications/Windows App.app",
    spawn:fakeSpawn,
    spawnSync:(command,args) => args[0] === "xfreerdp"
      ? {status:0,stdout:"/opt/homebrew/bin/xfreerdp\n",stderr:""}
      : unavailableCommand(),
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  const macPasswordResult = await macWithPasswordFreeRdp.open({id:33,protocol:"rdp",host:"mac-rdp.example",port:3389,username:"desktop-user",password:"mac-secret",options:{allow_password_transfer:true}});
  const macPasswordLaunch = launches.at(-1);
  assert.equal(macPasswordLaunch.executable, "/opt/homebrew/bin/xfreerdp");
  assert.ok(macPasswordLaunch.args.includes("/from-stdin"));
  assert.equal(macPasswordLaunch.stdin.toString("utf8"), "mac-secret\n");
  assert.equal(macPasswordResult.credentials, "stdin");

  const macWithoutRdp = createRemoteClientAdapter({
    platform:"darwin",
    environment:{HOME:"/Users/tester"},
    existsSync:file => String(file).replace(/\\/g,"/") === "/System/Applications/Utilities/Screen Sharing.app",
    spawn:fakeSpawn,
    spawnSync:unavailableCommand,
    fetch:async () => { throw new Error("offline"); },
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  assert.equal(macWithoutRdp.diagnostics().rdp.available, false);
  assert.equal(macWithoutRdp.diagnostics().rdp.can_install, true);
  await macWithoutRdp.install("rdp");
  assert.equal(shellLaunches.at(-1), MAC_WINDOWS_APP_URL);
  assert.match(MAC_WINDOWS_APP_PACKAGE_URL, /^https:\/\/go\.microsoft\.com\//);

  const cachedPackage = path.join(temporary, "remote-client", "WindowsApp.pkg");
  fs.mkdirSync(path.dirname(cachedPackage), {recursive:true});
  fs.writeFileSync(cachedPackage, Buffer.alloc(1024 * 1024));
  let installedMacApp = false;
  function fakeMacInstallerSpawn(executable, args, options) {
    launches.push({executable,args,options});
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      installedMacApp = true;
      child.emit("close", 0);
    });
    return child;
  }
  const macOfflinePackage = createRemoteClientAdapter({
    platform:"darwin",
    environment:{HOME:"/Users/tester"},
    dataDir:temporary,
    existsSync:file => {
      const normalized = String(file).replace(/\\/g,"/");
      return normalized === cachedPackage.replace(/\\/g,"/") || (installedMacApp && normalized === "/Applications/Windows App.app");
    },
    spawn:fakeMacInstallerSpawn,
    spawnSync:(command,args) => command === "/usr/sbin/pkgutil" && args[0] === "--check-signature"
      ? {status:0,stdout:"Developer ID Installer: Microsoft Corporation\nNotarization: trusted\n",stderr:""}
      : unavailableCommand(),
    fetch:async () => { throw new Error("offline package should be reused"); }
  });
  const offlineInstall = await macOfflinePackage.install("rdp");
  assert.equal(offlineInstall.offline, true);
  assert.equal(offlineInstall.cached_package, true);
  assert.equal(offlineInstall.client, "Windows App");
  assert.equal(launches.at(-1).executable, "/usr/bin/osascript");

  const macFreeRdpEnvironment = {HOME:"/Users/tester"};
  const macFreeRdp = createRemoteClientAdapter({
    platform:"darwin",
    environment:macFreeRdpEnvironment,
    existsSync:()=>false,
    spawn:fakeSpawn,
    spawnSync:(command,args) => args[0] === "xfreerdp"
      ? {status:0,stdout:"/opt/homebrew/bin/xfreerdp\n",stderr:""}
      : {status:1,stdout:"",stderr:""},
    getXServerDiagnostics:()=>({installed:true,running:false,display:""}),
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  const macFreeRdpStopped = macFreeRdp.diagnostics().rdp;
  assert.equal(macFreeRdpStopped.available, false);
  assert.equal(macFreeRdpStopped.launchable, true);
  assert.equal(macFreeRdpStopped.requires_xserver, true);
  assert.equal(macFreeRdpStopped.xserver_installed, true);
  assert.equal(macFreeRdpStopped.can_install, false);
  assert.match(macFreeRdpStopped.reason, /自动启动 XQuartz/);
  macFreeRdpEnvironment.DISPLAY = ":0";
  assert.equal(macFreeRdp.diagnostics().rdp.available, true);

  const macFreeRdpWithoutXQuartz = createRemoteClientAdapter({
    platform:"darwin",
    environment:{HOME:"/Users/tester"},
    existsSync:()=>false,
    spawn:fakeSpawn,
    spawnSync:(command,args) => args[0] === "xfreerdp"
      ? {status:0,stdout:"/opt/homebrew/bin/xfreerdp\n",stderr:""}
      : {status:1,stdout:"",stderr:""},
    getXServerDiagnostics:()=>({installed:false,running:false,display:""}),
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  }).diagnostics().rdp;
  assert.equal(macFreeRdpWithoutXQuartz.available, false);
  assert.equal(macFreeRdpWithoutXQuartz.launchable, false);
  assert.equal(macFreeRdpWithoutXQuartz.requires_xserver, true);
  assert.equal(macFreeRdpWithoutXQuartz.can_install, true);
  assert.match(macFreeRdpWithoutXQuartz.reason, /安装 XQuartz.*Windows App/);
  assert.match(mainSource, /passwordTransferNeedsXServer/);
  assert.match(mainSource, /current\.mode === "freerdp" && !current\.available\) \|\| passwordTransferNeedsXServer/);
  assert.match(remoteUiSource, /const clientLaunchable = Boolean\(item\.available \|\| item\.launchable\)/);
  assert.match(remoteUiSource, /remoteDesktopXServerButton/);
  assert.match(remoteUiSource, /item\.xserver_installed \? "启动 XQuartz" : "安装 XQuartz"/);
  assert.match(connectivitySource, /function probeTcpEndpoint\(host: unknown, port: unknown, timeoutMs = 2200\)/);
  assert.match(connectivitySource, /function probeXdmcpEndpoint\(host: unknown, port: unknown, timeoutMs = 2200\)/);
  assert.match(connectivitySource, /method:"xdmcp-query"/);
  assert.match(xserverSource, /family === 6 \? "udp6" : "udp4"/);
  assert.match(xserverSource, /dns\.lookup\(host/);
  assert.match(serverSource, /profile\.protocol === "rdp"[\s\S]*?await probeTcpEndpoint\(profile\.host, profile\.port \|\| 3389\)/, "RDP 启动前必须从保存的远程连接探测目标端口");
  assert.match(serverSource, /无法从本机连接 RDP 服务/, "RDP 端口不可达时必须阻止启动并给出明确提示");
  assert.match(serverSource, /password:profile\.password/, "RDP 启动必须把已解密密码限定在桌面适配器边界内");

  const linux = createRemoteClientAdapter({
    platform:"linux",
    environment:{DISPLAY:":0"},
    startupProbeMs:0,
    spawn:fakeSpawn,
    spawnSync:(command,args) => args[0] === "xfreerdp3"
      ? {status:0,stdout:"/usr/bin/xfreerdp3\n",stderr:""}
      : args[0] === "vncviewer"
        ? {status:0,stdout:"/usr/bin/vncviewer\n",stderr:""}
        : {status:1,stdout:"",stderr:""},
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  await linux.open({id:4,protocol:"rdp",host:"linux.example",port:3389,username:"root",password:"must-not-leak",options:{fullscreen:true,audio:"off"}});
  const linuxLaunch = launches.at(-1);
  assert.equal(linuxLaunch.executable, "/usr/bin/xfreerdp3");
  assert.ok(linuxLaunch.args.includes("/v:linux.example:3389"));
  assert.ok(linuxLaunch.args.includes("/u:root"));
  assert.ok(linuxLaunch.args.includes("/audio-mode:2"));
  assert.ok(linuxLaunch.args.includes("/cert:tofu"));
  assert.doesNotMatch(JSON.stringify(linuxLaunch), /must-not-leak/);
  const linuxIpv6Result = await linux.open({id:44,protocol:"rdp",host:"[2001:db8::44]",port:3389,username:"root",password:"stdin-secret",options:{allow_password_transfer:true}});
  const linuxIpv6Launch = launches.at(-1);
  assert.ok(linuxIpv6Launch.args.includes("/v:[2001:db8::44]:3389"));
  assert.ok(linuxIpv6Launch.args.includes("/from-stdin"));
  assert.equal(linuxIpv6Launch.stdin.toString("utf8"), "stdin-secret\n");
  assert.doesNotMatch(JSON.stringify(linuxIpv6Launch), /stdin-secret/);
  assert.equal(linuxIpv6Result.credentials, "stdin");
  assert.equal(linuxIpv6Result.password_transfer_requested, true);
  assert.equal(linuxIpv6Result.password_transfer_supported, true);
  await linux.open({id:41,protocol:"rdp",host:"dynamic.example",port:3389,username:"root",options:{display_mode:"dynamic",width:2560,height:1440}});
  const dynamicLinuxLaunch = launches.at(-1);
  assert.ok(dynamicLinuxLaunch.args.includes("/size:2560x1440"));
  assert.ok(dynamicLinuxLaunch.args.includes("/dynamic-resolution"));

  const headlessLinux = createRemoteClientAdapter({
    platform:"linux",
    environment:{},
    spawn:fakeSpawn,
    spawnSync:(command,args) => args[0] === "xfreerdp"
      ? {status:0,stdout:"/usr/bin/xfreerdp\n",stderr:""}
      : {status:1,stdout:"",stderr:""}
  });
  assert.equal(headlessLinux.diagnostics().rdp.available, false);
  await assert.rejects(
    headlessLinux.open({id:5,protocol:"rdp",host:"linux.example",port:3389,options:{}}),
    /DISPLAY/
  );

  console.log("远程桌面适配回归检查通过：Windows、macOS、Linux 的 RDP/VNC 启动参数、macOS FreeRDP/XQuartz 降级与凭据边界");
}

main().finally(() => {
  const resolved = path.resolve(temporary);
  const root = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("terma-remote-client-")) fs.rmSync(resolved,{recursive:true,force:true});
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
