"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  JAVA_GUI_COMPATIBILITY_COMMANDS,
  XRDP_RENDER_PROBE_SCRIPT,
  createVncRenderingDiagnostics,
  createXdmcpRenderingDiagnostics,
  createXrdpRenderingDiagnostics
} = require("../dist/remote-graphics-rendering");

assert.match(XRDP_RENDER_PROBE_SCRIPT, /DRMDevice/);
assert.match(XRDP_RENDER_PROBE_SCRIPT, /DRISWRAST|swrast/);
assert.match(XRDP_RENDER_PROBE_SCRIPT, /\.xorgxrdp\./);
assert.equal(JAVA_GUI_COMPATIBILITY_COMMANDS.length, 3);
assert.match(JAVA_GUI_COMPATIBILITY_COMMANDS.find(item => item.id === "java2d").command, /sun\.java2d\.xrender=false/);
assert.match(JAVA_GUI_COMPATIBILITY_COMMANDS.find(item => item.id === "javafx").command, /prism\.order=sw/);

const softwareRdp = createXrdpRenderingDiagnostics({
  installed:true,
  active:true,
  display:":10",
  drm_device:"/dev/dri/renderD128",
  drm_device_available:false,
  software_rendering:true,
  log_file:"/home/test/.xorgxrdp.10.log"
});
assert.equal(softwareRdp.state, "software");
assert.equal(softwareRdp.java_gui_risk, true);
assert.equal(softwareRdp.compatibility_commands.length, 3);
assert.match(softwareRdp.detail, /可能白屏/);

const acceleratedRdp = createXrdpRenderingDiagnostics({
  installed:true,
  active:true,
  display:":10",
  drm_device:"/dev/dri/renderD128",
  drm_device_available:true,
  software_rendering:false,
  log_file:"/home/test/.xorgxrdp.10.log"
});
assert.equal(acceleratedRdp.state, "accelerated");
assert.equal(acceleratedRdp.java_gui_risk, false);
assert.deepEqual(acceleratedRdp.compatibility_commands, []);

const sharedRdpVnc = createVncRenderingDiagnostics({
  installed:true,
  server_mode:"shared-x11",
  source_display:":10.0",
  source_xrdp:true,
  xrdp_display:":10",
  xrdp_drm_device:"/dev/dri/renderD128",
  xrdp_drm_device_available:false,
  xrdp_software_rendering:true
});
assert.equal(sharedRdpVnc.state, "software");
assert.equal(sharedRdpVnc.java_gui_risk, true);
assert.match(sharedRdpVnc.backend, /x11vnc/);
assert.match(sharedRdpVnc.detail, /继承/);

const sharedPhysicalVnc = createVncRenderingDiagnostics({installed:true, server_mode:"shared-x11", source_display:":0"});
assert.equal(sharedPhysicalVnc.state, "shared");
assert.equal(sharedPhysicalVnc.java_gui_risk, false);

const macVnc = createVncRenderingDiagnostics({installed:true, platform:"macos"});
assert.equal(macVnc.state, "shared");
assert.equal(macVnc.java_gui_risk, false);
assert.match(macVnc.backend, /Screen Sharing/);

const virtualVnc = createVncRenderingDiagnostics({installed:true, server_mode:"virtual", source_display:":1"});
assert.equal(virtualVnc.state, "software");
assert.equal(virtualVnc.java_gui_risk, true);
assert.match(virtualVnc.backend, /TigerVNC/);

const xdmcp = createXdmcpRenderingDiagnostics({enabled:true, listening:true, ready:true});
assert.equal(xdmcp.state, "remote-x11");
assert.equal(xdmcp.java_gui_risk, true);
assert.match(xdmcp.detail, /JavaFX/);
assert.equal(createXdmcpRenderingDiagnostics({enabled:false, listening:false}).visible, false);

const remoteUi = fs.readFileSync(path.join(__dirname, "..", "public", "app-remote.js"), "utf8");
assert.match(remoteUi, /remoteGraphicsRenderingMarkup/);
assert.match(remoteUi, /copyRemoteGraphicsCommand/);
const copyHandler = remoteUi.slice(remoteUi.indexOf("async function copyRemoteGraphicsCommand"), remoteUi.indexOf("function renderRdpServerState"));
assert.match(copyHandler, /await writeClipboardText\(command\)/);
assert.doesNotMatch(copyHandler, /await copyText\(command\)/);
console.log("远程图形渲染检查通过：XRDP、共享/虚拟 VNC、XDMCP 与 Java GUI 兼容命令状态统一");
