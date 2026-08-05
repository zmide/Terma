const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./windows-x11-window-guard-check");
const {
  startWindowsX11WindowGuard,
  stopWindowsX11WindowGuard,
  windowsX11WindowGuardScript
} = require("../desktop/windows-x11-window-guard");
const {
  createXServerRuntime,
  environmentKey,
  XQUARTZ_BYTES,
  XQUARTZ_SHA256,
  XQUARTZ_TEAM_ID,
  XQUARTZ_URL,
  XQUARTZ_VERSION,
  isWindowsDisplayCollisionError,
  parseWindowsXServerDisplayNumbers,
  parseXQuartzProcessIds,
  parseXQuartzProcessOutput,
  retryWindowsDisplayLaunch,
  terminateTrackedXdmcpChildren,
  xdmcpLaunchFailureMessage,
  wildcardXauthorityRecords
} = require("../desktop/xserver-runtime");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-xserver-check-"));

async function main() {
  try {
    const runtime = path.join(temporary, "runtime", "xserver", "win32");
    fs.mkdirSync(runtime, {recursive:true});
    fs.writeFileSync(path.join(runtime, "vcxsrv.exe"), "fixture");
    fs.writeFileSync(path.join(runtime, "xauth.exe"), "fixture");
    const manager = createXServerRuntime({
      platform:"win32",
      projectRoot:temporary,
      userDataPath:path.join(temporary, "data"),
      environment:{PATH:""}
    });
    const diagnostics = manager.diagnostics();
    assert.equal(diagnostics.installed, true);
    assert.equal(diagnostics.mode, "bundled");
    assert.equal(diagnostics.can_start, true);
    assert.equal(diagnostics.xdmcp_available, true);
    assert.match(diagnostics.executable, /runtime[\\/]xserver[\\/]win32[\\/]vcxsrv\.exe$/i);

    const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "xserver-runtime.js"), "utf8");
    assert.match(source, /"-auth", attemptAuthorityFile/);
    assert.doesNotMatch(source, /["']-ac["']/);
    assert.match(source, /XAUTHORITY/);
    assert.match(source, /TUNNELDESK_XAUTH/);
    assert.match(source, /waitForUntrustedXauth\(display, xauth, attemptAuthorityFile\)/);
    assert.match(source, /env:\{\.\.\.environment, DISPLAY:display, XAUTHORITY:probeFile\}/);
    assert.match(source, /if \(await canConnect\(port, 250\)\) continue/);
    assert.match(source, /activeWindowsDisplays\.has\(candidate\)/);
    assert.match(source, /retryWindowsDisplayLaunch\(/);
    assert.match(source, /fs\.copyFileSync\(sourceAuthorityFile, probeFile\)/);
    assert.match(source, /"nmerge", "-"/);
    assert.match(source, /"-listen", "tcp"/);
    assert.match(source, /"-multiwindow",[\s\S]*"-compositewm",[\s\S]*"-swcursor"/);
    assert.doesNotMatch(source, /"-nodecoration"/);
    assert.match(source, /startWindowsX11WindowGuard\(processHandle, \{environment\}\)/);
    assert.match(source, /stopWindowsX11WindowGuard\(activeWindowGuard\)/);
    assert.match(source, /"-swcursor"/);
    assert.match(source, /"-lesspointer"/);
    assert.match(source, /"-wgl"/);
    assert.doesNotMatch(source, /"-nowgl"/);
    assert.equal(environmentKey({Path:"fixture"}, "PATH"), "Path");
    assert.equal(environmentKey({HOME:"fixture"}, "PATH"), "PATH");
    assert.match(source, /\[pathKey\]:runtimePath/);
    assert.match(source, /environment\[pathKey\] = runtimePath/);
    const xdmcpLaunchSource = source.slice(source.indexOf("async function openXdmcp"), source.indexOf("async function testXdmcp"));
    assert.doesNotMatch(xdmcpLaunchSource, /"-wgl"/);
    assert.match(source, /"-dpi", "96"/);
    assert.match(source, /"\+extension", "SECURITY"/);
    assert.match(source, /mode === "broadcast" \? "-broadcast" : mode === "indirect" \? "-indirect" : "-query"/);
    assert.match(source, /"-port", String\(port\)/);
    assert.match(source, /"-once"/);
    assert.match(source, /"-terminate", "5"/);
    assert.match(source, /"-logfile", launchLogFile/);
    assert.match(source, /waitForStableProcess\(processHandle\)/);
    assert.match(xdmcpLaunchFailureMessage("(EE) XDMCP fatal error: Session failed", 7), /TCP 6007/);
    assert.match(xdmcpLaunchFailureMessage("(EE) XDMCP fatal error: Session failed", 7), /VPN、NAT/);
    assert.equal(XQUARTZ_VERSION, "2.8.6");
    assert.equal(XQUARTZ_BYTES, 122035963);
    assert.equal(XQUARTZ_SHA256, "9ac35a505095bfbd3009c3b4772f0c6421e2f79c4210ab908459270d1c447909");
    assert.equal(XQUARTZ_TEAM_ID, "NA574AWV7E");
    assert.match(XQUARTZ_URL, /^https:\/\/github\.com\/XQuartz\/XQuartz\/releases\/download\//);
    assert.deepEqual(parseXQuartzProcessOutput([
      "/bin/sh /opt/X11/bin/startx -- /opt/X11/bin/Xquartz",
      "xinit /opt/X11/etc/X11/xinit/xinitrc -- /opt/X11/bin/Xquartz :0 -nolisten tcp -auth /Users/test/.serverauth.12",
      "/opt/X11/bin/Xquartz :0 -nolisten tcp -auth /Users/test/.serverauth.12"
    ].join("\n")), {
      running:true,
      command:"xinit /opt/X11/etc/X11/xinit/xinitrc -- /opt/X11/bin/Xquartz :0 -nolisten tcp -auth /Users/test/.serverauth.12",
      display:":0",
      authorityFile:"/Users/test/.serverauth.12"
    });
    assert.deepEqual(parseXQuartzProcessIds([
      "67005 /Applications/Utilities/XQuartz.app/Contents/MacOS/X11.bin",
      "67014 /bin/sh /opt/X11/bin/startx -- /opt/X11/bin/Xquartz",
      "67268 xinit /opt/X11/etc/X11/xinit/xinitrc -- /opt/X11/bin/Xquartz :0",
      "67269 /opt/X11/bin/Xquartz :0 -nolisten tcp",
      "70000 /opt/X11/bin/Xephyr :1 -query 192.168.1.10"
    ].join("\n")), [67005, 67014, 67268, 67269]);
    assert.match(source, /pkgutil", \["--check-signature"/);
    assert.match(source, /Notarization:\\s\*trusted/);
    assert.match(source, /with administrator privileges/);
    assert.match(source, /function installLinuxGraphicsComponents/);
    assert.match(source, /xserver-xephyr/);
    assert.match(source, /freerdp2-x11/);
    assert.match(source, /openLinuxXdmcp/);
    assert.match(source, /openMacXdmcp/);
    assert.match(source, /TunnelDesk 内置 XDMCP（XQuartz）/);
    assert.match(source, /tell application \"XQuartz\" to quit/);
    assert.match(source, /waitForMacXephyr/);
    const macDiagnostics = createXServerRuntime({platform:"darwin", userDataPath:path.join(temporary, "mac-data"), environment:{HOME:path.join(temporary, "home")}}).diagnostics();
    assert.equal(macDiagnostics.installed, false);
    assert.equal(macDiagnostics.can_install, true);

    const trackedChildren = new Map();
    const reservedDisplays = new Set([7, 8]);
    const gracefulChild = {
      pid:701,
      exitCode:null,
      killed:false,
      kill() {
        this.killed = true;
        this.exitCode = 0;
      }
    };
    const forcedChild = {
      pid:801,
      exitCode:null,
      killed:false,
      kill() { this.killed = true; }
    };
    trackedChildren.set(gracefulChild, 7);
    trackedChildren.set(forcedChild, 8);
    const taskkillCalls = [];
    const stoppedChildren = await terminateTrackedXdmcpChildren(trackedChildren, reservedDisplays, {
      platform:"win32",
      timeoutMs:0,
      spawnSync:(command,args) => {
        taskkillCalls.push({command,args});
        forcedChild.exitCode = 1;
        return {status:0,stdout:"",stderr:""};
      }
    });
    assert.equal(stoppedChildren, 2);
    assert.equal(gracefulChild.killed, true);
    assert.equal(forcedChild.killed, true);
    assert.deepEqual(taskkillCalls, [{command:"taskkill.exe",args:["/PID","801","/T","/F"]}]);
    assert.equal(trackedChildren.size, 0);
    assert.equal(reservedDisplays.size, 0);
    assert.match(source, /if \(platform === "win32"\) \{\s*await terminateTrackedXdmcpChildren\(xdmcpChildren, reservedDisplayNumbers/);
    assert.match(source, /if \(platform === "darwin"\) \{\s*await terminateTrackedXdmcpChildren\(xdmcpChildren, reservedDisplayNumbers/);
    assert.match(source, /killXQuartzProcesses\("TERM"\)/);
    assert.match(source, /killXQuartzProcesses\("KILL"\)/);
    assert.doesNotMatch(source, /xdmcpChildren\.add\(/);

    assert.deepEqual(parseWindowsXServerDisplayNumbers([
      '"C:\\Program Files\\VcXsrv\\vcxsrv.exe" :0 -multiwindow',
      'C:\\tools\\Xming.exe 127.0.0.1:3.0 -clipboard',
      'C:\\Windows\\System32\\notepad.exe :7',
      '"C:\\TunnelDesk\\vcxsrv.exe" :0 -query 192.168.1.10'
    ].join("\n")), [0, 3]);
    assert.equal(isWindowsDisplayCollisionError(new Error("Invalid MIT-MAGIC-COOKIE-1 key")), true);
    assert.equal(isWindowsDisplayCollisionError(new Error("ordinary startup failure")), false);
    const allocated = [];
    const launched = [];
    const retried = await retryWindowsDisplayLaunch(
      async excluded => {
        const display = [0, 1, 2].find(candidate => !excluded.has(candidate));
        allocated.push({display, excluded:[...excluded]});
        return display;
      },
      async display => {
        launched.push(display);
        if (display === 0) {
          const error = new Error("X11 display :0 is already in use");
          error.code = "X11_DISPLAY_COLLISION";
          throw error;
        }
        return {display};
      }
    );
    assert.deepEqual(retried, {display:1});
    assert.deepEqual(launched, [0, 1]);
    assert.deepEqual(allocated, [
      {display:0, excluded:[]},
      {display:1, excluded:[0]}
    ]);
    assert.equal(wildcardXauthorityRecords(
      "0100 000f 4445534b544f502d4a373446334248 0001 31 0012 4d49542d4d414749432d434f4f4b49452d31 0010 00112233445566778899aabbccddeeff"
    ), "ffff 000f 4445534b544f502d4a373446334248 0001 31 0012 4d49542d4d414749432d434f4f4b49452d31 0010 00112233445566778899aabbccddeeff");

    const guardScript = windowsX11WindowGuardScript(4321);
    assert.match(guardScript, /\$serverProcessId = 4321/);
    assert.match(guardScript, /ClientToScreen/);
    assert.match(guardScript, /MonitorFromWindow/);
    assert.match(guardScript, /visibleTitleHeight/);
    assert.match(guardScript, /SetWindowPos/);
    assert.throws(() => windowsX11WindowGuardScript(0), /process ID/i);
    const nativeGuardCalls = [];
    const nativeGuardModule = {
      startX11WindowGuard(pid) {
        nativeGuardCalls.push({kind:"start", pid});
        return true;
      },
      stopX11WindowGuard() {
        nativeGuardCalls.push({kind:"stop"});
        return true;
      }
    };
    const nativeGuard = startWindowsX11WindowGuard({pid:4321}, {
      nativeModule:nativeGuardModule,
      spawn() { throw new Error("PowerShell fallback must not start when the native guard is available"); }
    });
    assert.equal(nativeGuard.kind, "native");
    assert.deepEqual(nativeGuardCalls, [{kind:"start", pid:4321}]);
    assert.equal(stopWindowsX11WindowGuard(nativeGuard), true);
    assert.deepEqual(nativeGuardCalls, [{kind:"start", pid:4321}, {kind:"stop"}]);
    const guardCalls = [];
    const guardChild = {
      exitCode:null,
      once(event, callback) { guardCalls.push({kind:"once", event, callbackType:typeof callback}); },
      unref() { guardCalls.push({kind:"unref"}); },
      kill() { guardCalls.push({kind:"kill"}); this.exitCode = 0; }
    };
    const startedGuard = startWindowsX11WindowGuard({pid:4321}, {
      nativeModule:{startX11WindowGuard() { return false; }},
      environment:{SystemRoot:"C:\\Windows", PATH:"fixture"},
      spawn:(command,args,options) => {
        guardCalls.push({kind:"spawn", command, args, options});
        return guardChild;
      }
    });
    assert.equal(startedGuard, guardChild);
    const guardSpawn = guardCalls.find(item => item.kind === "spawn");
    assert.match(guardSpawn.command, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
    assert.deepEqual(guardSpawn.args.slice(0, 6), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
    assert.equal(guardSpawn.options.windowsHide, true);
    assert.equal(guardSpawn.options.stdio, "ignore");
    assert.equal(guardCalls.some(item => item.kind === "unref"), true);
    assert.equal(stopWindowsX11WindowGuard(guardChild), true);
    assert.equal(guardCalls.some(item => item.kind === "kill"), true);

    const xdmcpFixture = dgram.createSocket("udp4");
    await new Promise((resolve, reject) => {
      xdmcpFixture.once("error", reject);
      xdmcpFixture.bind(0, "127.0.0.1", resolve);
    });
    xdmcpFixture.on("message", (message, remote) => {
      assert.equal(message.readUInt16BE(0), 1);
      assert.equal(message.readUInt16BE(2), 2);
      const hostname = Buffer.from("fixture-host");
      const status = Buffer.from("ready");
      const payload = Buffer.alloc(2 + 2 + hostname.length + 2 + status.length);
      let offset = 2;
      payload.writeUInt16BE(hostname.length, offset);
      hostname.copy(payload, offset + 2);
      offset += 2 + hostname.length;
      payload.writeUInt16BE(status.length, offset);
      status.copy(payload, offset + 2);
      const response = Buffer.alloc(6 + payload.length);
      response.writeUInt16BE(1, 0);
      response.writeUInt16BE(5, 2);
      response.writeUInt16BE(payload.length, 4);
      payload.copy(response, 6);
      xdmcpFixture.send(response, remote.port, remote.address);
    });
    const tested = await manager.testXdmcp({host:"127.0.0.1", port:xdmcpFixture.address().port, options:{mode:"query"}});
    xdmcpFixture.close();
    assert.equal(tested.ok, true);
    assert.equal(tested.hostname, "fixture-host");
    assert.equal(tested.message, "ready");
    console.log("X Server 运行时检查通过：随包路径、Xauthority、Windows 窗口守护、Linux 图形组件、XDMCP 会话和 XQuartz 安装边界");
  } finally {
    fs.rmSync(temporary, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
