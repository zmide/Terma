const assert = require("node:assert/strict");
const fs = require("node:fs");
const {EventEmitter} = require("node:events");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { readSftpJobSource } = require("./backend-source");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const adapterPath = path.join(root, "desktop", "native-sftp-drag.js");

function withMissingWindowsAddon(callback) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(adapterPath)];
  Module._load = function(request, parent, isMain) {
    if (String(request).replaceAll("\\", "/").endsWith("/native/win-sftp-drag")) {
      const error = new Error("fixture: native addon unavailable");
      error.code = "MODULE_NOT_FOUND";
      throw error;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback(require(adapterPath));
  } finally {
    Module._load = originalLoad;
  }
}

function checkUnavailableNativeFallback() {
  const adapter = withMissingWindowsAddon(({createNativeSftpDrag}) => {
    return createNativeSftpDrag({
      platform: "win32",
      app: {},
      nativeImage: {},
      iconPath: path.join(root, "desktop", "assets", "icon.png")
    });
  });
  const capabilities = adapter.capabilities();
  assert.equal(adapter.probe.available, false);
  assert.equal(adapter.probe.supported, false);
  assert.equal(capabilities.platform, "win32");
  assert.equal(capabilities.sftpExternalDrag, "staged");
  assert.equal(capabilities.sftpNativeDragStart, "leave-window");
  assert.match(capabilities.sftpNativeDragReason, /fixture: native addon unavailable/);
}

function checkWindowsActivationAndMetadataFastPath() {
  let receivedSpec = null;
  let activatedId = "";
  let internalTargetState = null;
  const originalLoad = Module._load;
  delete require.cache[require.resolve(adapterPath)];
  Module._load = function(request, parent, isMain) {
    if (String(request).replaceAll("\\", "/").endsWith("/native/win-sftp-drag")) {
      return {
        probe() {
          return {available:true,supported:true,protocol:"CFSTR_FILEDESCRIPTORW/CFSTR_FILECONTENTS"};
        },
        startDrag(spec) {
          receivedSpec = spec;
          return {requestId:"win-fixture-request"};
        },
        activateDrag(requestId) {
          activatedId = requestId;
          return true;
        },
        setInternalTarget(requestId, active) {
          assert.equal(requestId, "win-fixture-request");
          internalTargetState = active;
          return true;
        },
        cancelDrag() { return true; }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const {createNativeSftpDrag} = require(adapterPath);
    const adapter = createNativeSftpDrag({
      platform:"win32",
      app:{},
      nativeImage:{},
      iconPath:path.join(root, "desktop", "assets", "icon.png")
    });
    const started = adapter.start({
      requestId:"renderer-request",
      token:"fixture-token",
      manifestUrl:"http://127.0.0.1:8088/api/sftp/native-drag/fixture-token",
      contentBaseUrl:"http://127.0.0.1:8088/api/sftp/native-drag/fixture-token/content",
      ticket:{
        top_level:[{
          id:"0",
          name:"ready.txt",
          type:"file",
          size:123,
          modified_at:1_700_000_000.125,
          metadata_known:true
        }]
      }
    }, () => {});
    assert.equal(started.nativeId, "win-fixture-request");
    assert.equal(receivedSpec.waitForActivation, true);
    assert.equal(receivedSpec.armTimeoutMs, 10_000);
    assert.deepEqual(receivedSpec.items, [{
      id:"0",
      relativePath:"ready.txt",
      isDirectory:false,
      size:123,
      mtimeMs:1_700_000_000_125
    }]);
    assert.equal(adapter.activate(started.nativeId), true);
    assert.equal(activatedId, "win-fixture-request");
    assert.equal(adapter.setInternalTarget(started.nativeId, {id:2}), true);
    assert.equal(internalTargetState, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(adapterPath)];
  }
}

function checkWindowsDelayedDirectoryInternalCancelPath() {
  const receivedSpecs = [];
  const internalTargets = [];
  const cancelled = [];
  const originalLoad = Module._load;
  delete require.cache[require.resolve(adapterPath)];
  Module._load = function(request, parent, isMain) {
    if (String(request).replaceAll("\\", "/").endsWith("/native/win-sftp-drag")) {
      return {
        probe() {
          return {available:true,supported:true,protocol:"CFSTR_FILEDESCRIPTORW/CFSTR_FILECONTENTS"};
        },
        startDrag(spec) {
          receivedSpecs.push(spec);
          return {requestId:"win-large-directory"};
        },
        activateDrag() { return true; },
        setInternalTarget(requestId, active) {
          internalTargets.push({requestId, active});
          return true;
        },
        cancelDrag(requestId) {
          cancelled.push(requestId);
          return true;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const {createNativeSftpDrag} = require(adapterPath);
    const adapter = createNativeSftpDrag({
      platform:"win32",
      app:{},
      nativeImage:{},
      iconPath:path.join(root, "desktop", "assets", "icon.png")
    });
    const started = adapter.start({
      requestId:"renderer-large-directory",
      token:"fixture-large-directory-token",
      manifestUrl:"http://127.0.0.1:8088/api/sftp/native-drag/fixture-large-directory-token",
      contentBaseUrl:"http://127.0.0.1:8088/api/sftp/native-drag/fixture-large-directory-token/content",
      ticket:{
        top_level:[{
          id:"0",
          name:".cache",
          type:"directory",
          size:0,
          modified_at:0,
          metadata_known:false
        }]
      }
    }, () => {});

    assert.equal(started.nativeId, "win-large-directory");
    assert.equal(
      Object.hasOwn(receivedSpecs[0], "items"),
      false,
      "a remote directory must stay manifest-backed instead of being flattened synchronously in Electron"
    );
    assert.equal(adapter.setInternalTarget(started.nativeId, {id:1}), true);
    assert.deepEqual(internalTargets, [{requestId:"win-large-directory",active:true}]);
    assert.equal(adapter.cancel(started.nativeId), true);
    assert.deepEqual(cancelled, ["win-large-directory"]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(adapterPath)];
  }
}

function checkMacPromiseUsesTicketItemId() {
  let receivedSpec = null;
  const originalLoad = Module._load;
  delete require.cache[require.resolve(adapterPath)];
  Module._load = function(request, parent, isMain) {
    if (String(request).replaceAll("\\", "/").endsWith("/native/macos-sftp-drag")) {
      return {
        probe() {
          return {available:true,supported:true,protocol:"NSFilePromiseProvider"};
        },
        startDrag(spec) {
          receivedSpec = spec;
          return {sessionId:spec.sessionId};
        },
        setInternalTarget() {},
        cancelDrag() { return false; },
        completeWrite() {},
        dispose() {}
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const {createNativeSftpDrag} = require(adapterPath);
    const adapter = createNativeSftpDrag({
      platform:"darwin",
      app:{},
      nativeImage:{},
      iconPath:path.join(root, "desktop", "assets", "icon.png")
    });
    const started = adapter.start({
      requestId:"mac-ticket-id-check",
      token:"fixture-token",
      browserWindow:{getNativeWindowHandle:() => Buffer.alloc(8)},
      zoomFactor:1,
      ticket:{
        top_level:[{
          id:"0",
          remote_path:"/remote/path/must-not-be-used-as-id.txt",
          name:"item.txt",
          type:"file",
          size:12
        }]
      }
    }, () => {});
    assert.equal(started.nativeId, "mac-ticket-id-check");
    assert.equal(receivedSpec.items[0].id, "0");
    assert.notEqual(receivedSpec.items[0].id, receivedSpec.items[0].remote_path);
    assert.equal(adapter.capabilities().sftpNativeDragStart, "pointerdown");
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(adapterPath)];
  }
}

function checkLinuxHelperUtilities() {
  const {
    __linuxHelperCandidates: linuxHelperCandidates,
    __findLinuxHelper: findLinuxHelper,
    __parseJsonLine: parseJsonLine
  } = require(adapterPath);
  const appPath = path.join(root, ".native-drag-fixture", "app");
  const candidates = linuxHelperCandidates({getAppPath: () => appPath});
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = `terma-linux-sftp-dragfs${suffix}`;
  const legacyExecutable = `tunneldesk-linux-sftp-dragfs${suffix}`;

  assert.ok(candidates.length >= 4);
  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.every(candidate => path.isAbsolute(candidate)));
  assert.ok(candidates.some(candidate => candidate.endsWith(path.join(
    "native",
    "linux-sftp-drag",
    "prebuilds",
    `linux-${process.arch}`,
    executable
  ))));
  assert.ok(candidates.includes(path.resolve(appPath, "native", "linux-sftp-drag", "build", executable)));
  const primaryPrebuild = path.resolve(root, "native", "linux-sftp-drag", "prebuilds", `linux-${process.arch}`, executable);
  const legacyPrebuild = path.resolve(root, "native", "linux-sftp-drag", "prebuilds", `linux-${process.arch}`, legacyExecutable);
  const primaryBuild = path.resolve(root, "native", "linux-sftp-drag", "build", executable);
  assert.ok(candidates.includes(legacyPrebuild), "旧 helper 名称必须保留为读取后备");
  assert.ok(candidates.indexOf(primaryPrebuild) < candidates.indexOf(legacyPrebuild), "新 helper 必须优先于旧 helper");
  const originalStatSync = fs.statSync;
  try {
    let available = new Set([primaryBuild, legacyPrebuild]);
    fs.statSync = candidate => {
      if (available.has(path.resolve(candidate))) return {isFile:() => true};
      const error = new Error("not found");
      error.code = "ENOENT";
      throw error;
    };
    assert.equal(findLinuxHelper({getAppPath: () => appPath}), primaryBuild, "任一目录存在新 helper 时都必须优先于旧名称");
    available = new Set([legacyPrebuild]);
    assert.equal(findLinuxHelper({getAppPath: () => appPath}), legacyPrebuild, "缺少新 helper 时必须能回退读取旧 helper");
  } finally {
    fs.statSync = originalStatSync;
  }

  assert.deepEqual(parseJsonLine('  {"event":"ready","paths":["/mnt/a"]}  '), {
    event: "ready",
    paths: ["/mnt/a"]
  });
  assert.equal(parseJsonLine("not-json"), null);
  assert.equal(parseJsonLine(""), null);
}

function checkLinuxArtifactNamingContract() {
  const {verifyPackaged} = require("./native-sftp-drag-artifacts-check");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "terma-native-drag-artifacts-"));
  try {
    const nativeDirectory = path.join(fixture, "resources", "native");
    fs.mkdirSync(nativeDirectory, {recursive:true});
    fs.writeFileSync(path.join(nativeDirectory, "tunneldesk-linux-sftp-dragfs"), "legacy");
    assert.throws(
      () => verifyPackaged("linux", fixture),
      /unexpected legacy artifacts[\s\S]*tunneldesk-linux-sftp-dragfs/
    );
  } finally {
    fs.rmSync(fixture, {recursive:true, force:true});
  }
}

function createLinuxHelperFixture() {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter();
  const ticketPipe = new EventEmitter();
  const writes = [];
  stdout.setEncoding = () => stdout;
  stderr.setEncoding = () => stderr;
  stdin.write = value => {
    writes.push(String(value));
    return true;
  };
  ticketPipe.end = value => {
    child.ticketUrl = String(value || "");
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdio = [stdin, stdout, stderr, ticketPipe];
  child.writes = writes;
  child.killCount = 0;
  child.kill = () => {
    child.killCount += 1;
    return true;
  };
  child.send = message => stdout.emit("data", `${JSON.stringify(message)}\n`);
  return child;
}

async function checkLinuxAdapterStateMachine() {
  const originalLoad = Module._load;
  const originalStatSync = fs.statSync;
  const spawned = [];
  delete require.cache[require.resolve(adapterPath)];
  Module._load = function(request, parent, isMain) {
    if (request === "node:child_process") {
      const childProcess = originalLoad.call(this, request, parent, isMain);
      return {
        ...childProcess,
        spawn() {
          const child = createLinuxHelperFixture();
          spawned.push(child);
          return child;
        },
        spawnSync() {
          return {
            status:0,
            stdout:'{"available":true,"supported":true,"protocol":"fuse3"}\n',
            stderr:""
          };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let adapter;
  try {
    const {createNativeSftpDrag} = require(adapterPath);
    fs.statSync = candidate => {
      if (/^(?:terma|tunneldesk)-linux-sftp-dragfs(?:\.exe)?$/.test(path.basename(String(candidate)))) {
        return {isFile:() => true};
      }
      return originalStatSync(candidate);
    };
    adapter = createNativeSftpDrag({
      platform:"linux",
      app:{getAppPath:() => root},
      nativeImage:{
        createFromPath() {
          return {resize:() => ({fixture:true})};
        }
      },
      iconPath:path.join(root, "desktop", "assets", "icon.png"),
      screen:{getCursorScreenPoint:() => ({x:320,y:240})},
      linuxContentCompleteCloseMs:20,
      linuxHelperTerminateMs:20,
      linuxHelperForceKillMs:20,
      linuxCancelCloseGraceSeconds:1,
      linuxCancelHelperTerminateMs:20
    });
  } finally {
    fs.statSync = originalStatSync;
    Module._load = originalLoad;
    delete require.cache[require.resolve(adapterPath)];
  }

  const terminalTypes = new Set(["completed", "cancelled", "error"]);
  const waitForRelease = () => new Promise(resolve => setTimeout(resolve, 220));
  const begin = name => {
    const events = [];
    const requestId = `linux-state-${name}`;
    const started = adapter.start({
      requestId,
      token:`token-${name}`,
      manifestUrl:`http://127.0.0.1:8088/api/sftp/native-drag/token-${name}`,
      webContents:{startDrag() {}},
      ticket:{top_level:[{id:"0",name:"fixture.txt",type:"file",size:7}]}
    }, event => events.push(event));
    const child = spawned.at(-1);
    assert.equal(started.nativeId, requestId);
    assert.match(child.ticketUrl, new RegExp(`token-${name}`));
    child.send({event:"ready",paths:[`/run/user/1000/tunneldesk/${name}/fixture.txt`]});
    assert.equal(adapter.activate(requestId), true);
    return {requestId, child, events};
  };
  const terminals = scenario => scenario.events.filter(event => terminalTypes.has(event.type));
  const close = (scenario, code=0) => {
    scenario.child.send({event:"closed"});
    scenario.child.emit("exit", code, null);
    scenario.child.emit("close", code, null);
  };

  const completed = begin("completed");
  await waitForRelease();
  assert.equal(completed.events.some(event => event.type === "released"), true);
  assert.deepEqual(terminals(completed), [], "released must not be a terminal event");
  completed.child.send({event:"content-complete"});
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(
    completed.child.writes.some(value => value.includes('"command":"shutdown"')),
    true,
    "completed external delivery should close the FUSE helper after a short grace"
  );
  assert.ok(completed.child.killCount >= 1, "a helper retaining FUSE handles should be terminated");
  close(completed);
  assert.deepEqual(terminals(completed).map(event => event.type), ["completed"]);

  const exitBeforeStdoutDrain = begin("exit-before-stdout-drain");
  await waitForRelease();
  exitBeforeStdoutDrain.child.emit("exit", 0, null);
  exitBeforeStdoutDrain.child.stdout.emit("data", '{"event":"content-');
  exitBeforeStdoutDrain.child.stdout.emit("data", 'complete"}\n{"event":"closed"}\n');
  exitBeforeStdoutDrain.child.emit("close", 0, null);
  assert.deepEqual(
    terminals(exitBeforeStdoutDrain).map(event => event.type),
    ["completed"],
    "process exit must wait for stdout to drain before deciding the terminal result"
  );

  const probedOnly = begin("probed-only");
  await waitForRelease();
  probedOnly.child.send({event:"consuming"});
  close(probedOnly);
  assert.deepEqual(terminals(probedOnly).map(event => event.type), ["cancelled"]);

  const helperClosing = begin("helper-closing");
  await waitForRelease();
  helperClosing.child.send({event:"closing",message:"release-idle-timeout"});
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.ok(helperClosing.child.killCount >= 1, "a helper stuck while closing must be terminated");
  close(helperClosing);
  assert.deepEqual(terminals(helperClosing).map(event => event.type), ["cancelled"]);

  const readError = begin("read-error");
  await waitForRelease();
  readError.child.send({event:"read-error",message:"fixture read failed"});
  close(readError);
  assert.deepEqual(terminals(readError).map(event => event.type), ["error"]);
  assert.equal(terminals(readError)[0].message, "fixture read failed");

  const internal = begin("internal");
  await waitForRelease();
  assert.equal(adapter.setInternalTarget(internal.requestId, {id:2}), true);
  assert.deepEqual(terminals(internal).map(event => event.type), ["completed"]);
  assert.equal(internal.child.writes.some(value => value.includes('"command":"cancel"')), true);
  close(internal);
  assert.deepEqual(terminals(internal).map(event => event.type), ["completed"]);

  const cancelled = begin("cancelled");
  await waitForRelease();
  assert.equal(adapter.cancel(cancelled.requestId), true);
  close(cancelled);
  assert.deepEqual(terminals(cancelled).map(event => event.type), ["cancelled"]);
  assert.equal(cancelled.child.writes.filter(value => value.includes('"command":"cancel"')).length, 1);

  const cancelPipeClosed = begin("cancel-pipe-closed");
  await waitForRelease();
  cancelPipeClosed.child.stdin.write = () => {
    throw new Error("EPIPE fixture");
  };
  assert.equal(adapter.cancel(cancelPipeClosed.requestId), true);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.ok(cancelPipeClosed.child.killCount >= 1, "cancel must terminate a helper even when its control pipe is closed");
  close(cancelPipeClosed);
  assert.deepEqual(terminals(cancelPipeClosed).map(event => event.type), ["cancelled"]);

  const startDragErrorEvents = [];
  const startDragError = adapter.start({
    requestId:"linux-state-start-drag-error",
    token:"token-start-drag-error",
    manifestUrl:"http://127.0.0.1:8088/api/sftp/native-drag/token-start-drag-error",
    webContents:{startDrag() { throw new Error("startDrag fixture failed"); }},
    ticket:{top_level:[{id:"0",name:"fixture.txt",type:"file",size:7}]}
  }, event => startDragErrorEvents.push(event));
  const startDragErrorChild = spawned.at(-1);
  startDragErrorChild.send({event:"ready",paths:["/run/user/1000/tunneldesk/start-drag-error/fixture.txt"]});
  assert.equal(adapter.activate(startDragError.nativeId), true);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.deepEqual(
    startDragErrorEvents.filter(event => terminalTypes.has(event.type)).map(event => event.type),
    ["error"]
  );
  assert.ok(startDragErrorChild.killCount >= 1, "startDrag failure must terminate the FUSE helper");
  startDragErrorChild.emit("exit", 1, null);
  startDragErrorChild.emit("close", 1, null);

  adapter.dispose();
}

function checkLinuxFuseOptionsContract() {
  const source = fs.readFileSync(path.join(
    root,
    "native",
    "linux-sftp-drag",
    "src",
    "dragfs.cpp"
  ), "utf8");
  const cmake = fs.readFileSync(path.join(
    root,
    "native",
    "linux-sftp-drag",
    "CMakeLists.txt"
  ), "utf8");

  assert.doesNotMatch(
    source,
    /fuse_opt_add_arg\(&arguments,\s*"-f"\)/,
    "manual fuse_loop_mt initialization must not pass the fuse_main-only -f option"
  );
  assert.match(source, /fuse_opt_add_arg\(&arguments,\s*"-o"\)/);
  assert.match(source, /create_unmounted_fuse/);
  assert.match(source, /name == "release"[\s\S]*release_requested_\.store\(true\)[\s\S]*touch_lease\(grace\)/);
  assert.match(source, /completed_release[\s\S]*std::min\(lease_deadline_, next_deadline\)/);
  assert.doesNotMatch(source, /content_complete_\.load\(\) && open_references_\.load\(\) == 0/);
  assert.match(source, /mark_content_access\(\)[\s\S]*emit_event\("consuming"\)/);
  assert.match(source, /release_requested_\.load\(\)[\s\S]*content_complete_\.load\(\)[\s\S]*options_\.close_grace/);
  assert.match(source, /completed_release = release_requested_\.load\(\) && content_complete_\.load\(\) && expired/);
  assert.match(source, /abandoned_release = release_requested_\.load\(\) && !content_complete_\.load\(\) && expired/);
  assert.match(source, /forced \|\| completed_release \|\| abandoned_release \|\| \(open_references == 0 && expired\)/);
  assert.match(source, /name == "cancel"[\s\S]*cancel_requested_\.exchange\(true\)[\s\S]*cancel_deadline_[\s\S]*emit_event\("cancelled"\)/);
  assert.match(source, /if \(cancelled\)[\s\S]*open_references == 0 \|\| cancel_expired[\s\S]*request_exit/);
  assert.match(source, /name == "shutdown"[\s\S]*force_exit_when_idle_\.store\(true\);[\s\S]*request_exit\(name\)/);
  assert.match(source, /count <= 0[\s\S]*force_exit_when_idle_\.store\(true\);[\s\S]*request_exit\("control-closed"\)/);
  assert.match(source, /POLLHUP[\s\S]*force_exit_when_idle_\.store\(true\);[\s\S]*request_exit\("control-closed"\)/);
  assert.doesNotMatch(source, /length == 0 \|\| node\.delivery_complete/);
  assert.match(source, /on_open[\s\S]*state->mark_content_access\(\)/);
  assert.match(source, /on_opendir[\s\S]*state->mark_content_access\(\)/);
  assert.match(cmake, /linux-sftp-dragfs-fuse-options/);
  assert.match(cmake, /--validate-fuse-options/);
}

function checkPreloadCapabilityFallback() {
  const source = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");
  let exposedName = "";
  let exposedValue = null;
  const ipcRenderer = {
    sendSync(channel) {
      assert.equal(channel, "terma:capabilities");
      return undefined;
    },
    send() {},
    on() {},
    removeListener() {}
  };
  vm.runInNewContext(source, {
    require(id) {
      assert.equal(id, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposedName = name;
            exposedValue = value;
          }
        },
        ipcRenderer
      };
    },
    process: {platform: "linux"},
    Object,
    Array,
    Number,
    String
  }, {filename: "desktop/preload.js"});

  assert.equal(exposedName, "termaDesktop");
  assert.ok(exposedValue);
  assert.equal(exposedValue.capabilities.platform, "linux");
  assert.equal(exposedValue.capabilities.sftpExternalDrag, false);
  assert.equal(Object.isFrozen(exposedValue.capabilities), true);
}

function checkNativeSessionRaceGuards() {
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
  const adapterSource = fs.readFileSync(adapterPath, "utf8");
  const rendererSource = readFrontendDomain(root, "sftp");
  const jobsSource = readSftpJobSource(root);
  const sessionSource = fs.readFileSync(path.join(root, "src", "sftp-session.ts"), "utf8");

  assert.match(mainSource, /completedDeliveries:new Set\(\)/);
  assert.match(mainSource, /inflightDeliveries:new Map\(\)/);
  assert.match(mainSource, /renamedItems:new Map\(\)/);
  assert.match(mainSource, /sourceTabKey:String\(payload\?\.sourceTabKey/);
  assert.match(mainSource, /const kind = value\.kind === "terminal"/);
  assert.match(mainSource, /const deliveryKey = `\$\{itemId\}\\0\$\{targetPath\}`/);
  assert.match(mainSource, /if \(result\?\.renamed\)[\s\S]*session\.renamedItems\.set/);
  assert.match(mainSource, /renamedItems:\[\.\.\.session\.renamedItems\.values\(\)\]/);
  assert.match(mainSource, /let succeeded = Boolean\(internalTarget\) \|\| \(ok && !session\.writeError && !contentError\)/);
  assert.match(mainSource, /finishNativeSftpDragJob\?\.\([\s\S]*cancelled \? "cancelled" : succeeded \? "done" : "failed"/);
  assert.match(mainSource, /nativeEvent\.type === "consuming"[\s\S]*session\.consuming = true/);
  assert.match(mainSource, /nativeEvent\.type === "contentComplete"[\s\S]*session\.contentComplete = true/);
  assert.match(mainSource, /if \(!session\?\.terminalEvent \|\| session\.resultSent\) return/);
  assert.match(mainSource, /if \(\["completed", "cancelled", "ended", "error", "terminalError"\]\.includes\(nativeEvent\.type\)\)[\s\S]*maybeFinishNativeDragSession\(session\)/);
  assert.match(mainSource, /outcome\?\.status === "cancelled"[\s\S]*succeeded = false/);
  assert.match(mainSource, /if \(internalTarget\) \{[\s\S]*discardNativeSftpDragJob\?\.\(session\.token\)/);
  assert.match(mainSource, /ok:succeeded/);
  assert.match(mainSource, /if \(process\.platform === "linux"\) session\.nativeOwnsTicket = true/);
  assert.match(mainSource, /abortController:new AbortController\(\)/);
  assert.match(mainSource, /deliverNativeSftpDragTicketItem\([\s\S]*signal:session\.abortController\?\.signal/);
  assert.match(mainSource, /beginNativeSftpDragJob\?\.\(session\.token, session\.ticket\)/);
  assert.match(mainSource, /onProgress:bytes => recordNativeSftpDragBytes\?\.\(session\.token, bytes\)/);
  assert.match(mainSource, /nativeEvent\.type === "ended" && !session\.uiReleased[\s\S]*type:"released"/);
  assert.match(mainSource, /session\.cancelling && terminal\.type === "ended"/);
  assert.match(mainSource, /process\.platform === "darwin" && session\.terminalEvent\.type === "ended"/);
  assert.match(mainSource, /windowsReleaseAcknowledged/);
  assert.match(mainSource, /NATIVE_SFTP_DRAG_WINDOWS_TARGET_ACK_TIMEOUT_MS = 2000/);
  assert.match(mainSource, /\(point\.x - bounds\.x\) \/ zoomFactor/);
  assert.match(mainSource, /terma:sftp-drag-activate/);
  assert.match(mainSource, /cancelled \? "已取消拖出"/);
  assert.match(mainSource, /forceTicketRelease:process\.platform === "linux"/);
  assert.match(adapterSource, /const LINUX_DROP_SETTLE_MS = 150/);
  assert.match(adapterSource, /message\.event === "read-error"/);
  assert.match(adapterSource, /message\.event === "consuming"[\s\S]*state\.consuming = true/);
  assert.match(adapterSource, /options\.screen\?\.getCursorScreenPoint/);
  assert.match(adapterSource, /state\.finalizeTimer = setTimeout/);
  assert.match(adapterSource, /state\.dragReleased = true;[\s\S]*onEvent\(cursorEvent\("released"\)\)/);
  assert.match(adapterSource, /message\.event === "closed"[\s\S]*finishAfterHelperClose\(\)/);
  assert.match(adapterSource, /!state\.contentComplete[\s\S]*type:"cancelled"/);
  assert.match(adapterSource, /setInternalTarget\(nativeId, target\)[\s\S]*state\.finishInternalDrop\?\.\(\)/);
  assert.match(adapterSource, /!state\.ready \|\| !state\.activated \|\| state\.dragStarted/);
  assert.match(adapterSource, /onEvent\(\{type: "ready", requestId: spec\.requestId\}\)/);
  assert.match(adapterSource, /state\.files = files;[\s\S]*state\.activated = false;[\s\S]*onEvent\(\{type: "ready"/);
  assert.match(adapterSource, /sftpNativeDragStart: adapter\.probe\.available \? "pointerdown" : "leave-window"/);
  assert.match(adapterSource, /waitForActivation:true/);
  assert.match(adapterSource, /metadata_known === true/);
  assert.match(adapterSource, /module\.setInternalTarget\?\.\(nativeId, Boolean\(target\)\)/);
  assert.match(rendererSource, /\{armed:true,\s*sourceTabKey:tabKey\}/);
  assert.match(rendererSource, /activateSftpDrag\?\.\(pointer\.nativeRequestId\)/);
  assert.match(rendererSource, /pointer\.activated && pointer\.nativeStarted/);
  assert.doesNotMatch(rendererSource, /pointer\.activated && \(pointer\.nativeReady \|\| pointer\.nativeStarted\)/);
  assert.match(rendererSource, /event\.type === "ready"[\s\S]*sftpNativeDragPointer\.nativeReady = true/);
  assert.match(rendererSource, /event\.type === "ready"[\s\S]*request\.activated\) window\.termaDesktop\?\.activateSftpDrag/);
  assert.match(rendererSource, /event\.type === "transferStarted"[\s\S]*refreshSftpJobs\(\)/);
  assert.doesNotMatch(rendererSource, /dataTransfer\.setData\("text\/plain"/);
  assert.doesNotMatch(rendererSource, /activateSftpNativeDragPointer\(pointer\);\s*if \(pointer\.row\)/);
  assert.match(rendererSource, /setSftpDragTarget\?\.\(requestId, normalized, \{final:Boolean\(options\.final\)\}\)/);
  assert.match(rendererSource, /sourceTabKey:request\.sourceTabKey/);
  assert.match(rendererSource, /target\.kind === "terminal"/);
  assert.match(jobsSource, /const topLevelSizeKnown = topLevel\.length > 0[\s\S]*entry\?\.metadata_known === true/);
  assert.match(jobsSource, /function recordNativeSftpDragBytes\([\s\S]*recordTransferred\(job, added\)/);
  assert.match(sessionSource, /input\.on\("data", \(chunk\) => \{[\s\S]*onProgress\(bytes\)/);
}

async function main() {
  checkUnavailableNativeFallback();
  checkWindowsActivationAndMetadataFastPath();
  checkWindowsDelayedDirectoryInternalCancelPath();
  checkMacPromiseUsesTicketItemId();
  checkLinuxHelperUtilities();
  checkLinuxArtifactNamingContract();
  await checkLinuxAdapterStateMachine();
  checkLinuxFuseOptionsContract();
  checkPreloadCapabilityFallback();
  checkNativeSessionRaceGuards();
  console.log("native SFTP desktop drag checks passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
