const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {EventEmitter} = require("node:events");
const {MAC_WINDOWS_APP_PACKAGE_URL, MAC_WINDOWS_APP_URL, createRemoteClientAdapter} = require("../desktop/remote-clients");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-remote-client-"));
const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
const remoteUiSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-remote.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf8");
const launches = [];
const shellLaunches = [];

function fakeSpawn(executable, args, options) {
  launches.push({executable,args,options});
  const child = new EventEmitter();
  child.unref = () => {};
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

function unavailableCommand() {
  return {status:1,stdout:"",stderr:""};
}

async function main() {
  const windows = createRemoteClientAdapter({
    platform:"win32",
    environment:{SystemRoot:"C:\\Windows",ProgramFiles:"C:\\Program Files"},
    dataDir:temporary,
    existsSync:file => file.endsWith("mstsc.exe") || file.endsWith("TigerVNC\\vncviewer.exe"),
    spawn:fakeSpawn,
    spawnSync:unavailableCommand,
    shell:{openExternal:async uri => shellLaunches.push(uri)}
  });
  const windowsDiagnostics = windows.diagnostics();
  assert.equal(windowsDiagnostics.rdp.available, true);
  assert.equal(windowsDiagnostics.vnc.available, true);
  assert.match(windowsDiagnostics.password_policy, /不会把密码放入命令行/);

  await windows.open({id:1,protocol:"rdp",host:"rdp.example",port:3389,username:"alice",password:"must-not-leak",options:{fullscreen:false,width:1280,height:720,clipboard:true}});
  const rdpLaunch = launches.at(-1);
  assert.match(rdpLaunch.executable, /mstsc\.exe$/i);
  assert.equal(rdpLaunch.args.length, 1);
  const rdpBytes = fs.readFileSync(rdpLaunch.args[0]);
  assert.equal(rdpBytes[0], 0xff);
  assert.equal(rdpBytes[1], 0xfe);
  const rdpText = rdpBytes.toString("utf16le");
  assert.match(rdpText, /full address:s:rdp\.example:3389/);
  assert.match(rdpText, /screen mode id:i:1/);
  assert.match(rdpText, /desktopwidth:i:1280/);
  assert.match(rdpText, /desktopheight:i:720/);
  assert.match(rdpText, /dynamic resolution:i:0/);
  assert.match(rdpText, /prompt for credentials:i:1/);
  assert.doesNotMatch(rdpText, /must-not-leak/);

  await windows.open({id:2,protocol:"rdp",host:"generated.example",port:3389,username:"ssh-user",options:{source_ssh_connection_id:42}});
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
  await mac.open({id:3,protocol:"vnc",host:"mac.example",port:5900,options:{}});
  assert.equal(shellLaunches.at(-1), "vnc://mac.example:5900");

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
  assert.match(mainSource, /current\.mode === "freerdp" && !current\.available\) await xServerRuntime\.start\(\)/);
  assert.match(remoteUiSource, /const clientLaunchable = Boolean\(item\.available \|\| item\.launchable\)/);
  assert.match(remoteUiSource, /remoteDesktopXServerButton/);
  assert.match(remoteUiSource, /item\.xserver_installed \? "启动 XQuartz" : "安装 XQuartz"/);
  assert.match(serverSource, /function probeTcpEndpoint\(host, port, timeoutMs=2200\)/);
  assert.match(serverSource, /profile\.protocol === "rdp"[\s\S]*?await probeTcpEndpoint\(profile\.host, profile\.port \|\| 3389\)/, "RDP 启动前必须从本机探测目标端口");
  assert.match(serverSource, /无法从本机连接 RDP 服务/, "RDP 端口不可达时必须阻止启动并给出明确提示");

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
  if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("tunneldesk-remote-client-")) fs.rmSync(resolved,{recursive:true,force:true});
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
