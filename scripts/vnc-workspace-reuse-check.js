const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "public", "app-remote.js"), "utf8");
const openStart = source.indexOf("async function openRemoteDesktop(");
const openEnd = source.indexOf("\nfunction renderRdpServerState", openStart);
const openRemoteDesktop = source.slice(openStart, openEnd);
const renderStart = source.indexOf("function renderEmbeddedVnc(");
const renderEnd = source.indexOf("\nasync function connectEmbeddedVnc", renderStart);
const renderEmbeddedVnc = source.slice(renderStart, renderEnd);
const focusStart = source.indexOf("function vncSessionCanFocus(");
const focusEnd = source.indexOf("\nasync function ensureVncClipboardTransport", focusStart);
const vncFocus = source.slice(focusStart, focusEnd);
const connectStart = source.indexOf("async function connectEmbeddedVnc(");
const connectEnd = source.indexOf("\nasync function saveVncCredential", connectStart);
const connectEmbeddedVnc = source.slice(connectStart, connectEnd);
const fullscreenStart = source.indexOf("function syncVncFullscreenPresentation(");
const fullscreenEnd = source.indexOf("\nasync function launchRemoteDesktop", fullscreenStart);
const fullscreenSource = source.slice(fullscreenStart, fullscreenEnd);
const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.css"), "utf8");

assert.ok(openStart >= 0 && openEnd > openStart, "openRemoteDesktop source must be available");
assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderEmbeddedVnc source must be available");
assert.ok(focusStart >= 0 && focusEnd > focusStart, "VNC focus guard source must be available");
assert.ok(connectStart >= 0 && connectEnd > connectStart, "connectEmbeddedVnc source must be available");
assert.ok(fullscreenStart >= 0 && fullscreenEnd > fullscreenStart, "VNC fullscreen source must be available");

const cachedWorkspace = openRemoteDesktop.indexOf("const existingVncSession");
const desktopProbe = openRemoteDesktop.indexOf("inspectLinuxDesktopForRemoteProfile(profile)");
assert.ok(cachedWorkspace >= 0, "VNC open path must detect an existing workspace");
assert.ok(desktopProbe >= 0, "first VNC open must retain Linux desktop diagnostics");
assert.ok(cachedWorkspace < desktopProbe, "an existing VNC workspace must be restored before any remote desktop probe");
assert.match(openRemoteDesktop, /const existingVncSession = embeddedVnc \? vncSessions\.get\(key\) : null;[\s\S]*?if \(existingVncSession\?\.workspace && \(existingVncSession\.connected \|\| existingVncSession\.connecting\)\) return renderEmbeddedVnc\(profile, key\)/);

const cachedBranch = renderEmbeddedVnc.slice(
  renderEmbeddedVnc.indexOf("if (session?.workspace)"),
  renderEmbeddedVnc.indexOf("view.innerHTML =")
);
assert.match(cachedBranch, /view\.replaceChildren\(session\.workspace\)/, "tab switching must reattach the existing VNC workspace");
assert.match(cachedBranch, /session\.rfb\.scaleViewport = true/, "reattached noVNC canvas must refresh its scale immediately");
assert.doesNotMatch(cachedBranch, /session\.rfb\.scaleViewport = false/, "tab switching must not force a second canvas layout pass");
assert.doesNotMatch(cachedBranch, /inspectLinuxDesktopForRemoteProfile|connectEmbeddedVnc\(profile, key\)[\s\S]*await/, "cached VNC restore must stay local and synchronous");

assert.match(vncFocus, /session\?\.workspace\?\.isConnected/, "a detached VNC workspace must not steal keyboard focus");
assert.match(vncFocus, /paneId !== focusedPaneId/, "a visible VNC in a background split pane must not steal keyboard focus");
assert.match(vncFocus, /paneState\?\.activeTabKey[\s\S]*?paneState\.activeTabKey !== session\.key/, "only the active VNC tab in a pane may receive focus");

assert.match(connectEmbeddedVnc, /const connectionRevision = Number\(session\.connectionRevision \|\| 0\) \+ 1/);
assert.match(connectEmbeddedVnc, /vncSessions\.get\(key\) === session && session\.connectionRevision === connectionRevision/);
assert.match(connectEmbeddedVnc, /const RFB = await noVncRfbClass\(\);\s*if \(!isCurrentConnection\(\)\) return;/);
assert.match(connectEmbeddedVnc, /vnc-credential[\s\S]*?if \(!isCurrentConnection\(\)\) return;/, "a closed or reopened tab must discard a late credential response");
assert.match(connectEmbeddedVnc, /addEventListener\("connect"[\s\S]*?!isCurrentConnection\(\)/, "an obsolete noVNC connection event must be ignored");
assert.match(connectEmbeddedVnc, /catch \(error\) \{\s*if \(!isCurrentConnection\(\)\) return;/, "an obsolete connection failure must not alter the replacement tab");

assert.match(fullscreenSource, /document\.documentElement\.requestFullscreen\(\)/, "fullscreen must keep noVNC's body-level cursor overlay inside the fullscreen tree");
assert.match(fullscreenSource, /document\.addEventListener\("fullscreenchange", syncVncFullscreenPresentation\)/, "fullscreen exit must restore the regular VNC presentation");
assert.match(fullscreenSource, /session\.rfb\.scaleViewport = true/, "fullscreen changes must refresh noVNC scaling");
assert.doesNotMatch(fullscreenSource, /viewport\.requestFullscreen/, "the VNC viewport alone must not enter fullscreen because noVNC's fallback cursor lives under document.body");
assert.match(css, /html\.vnc-fullscreen-document:fullscreen \.vnc-viewport\.vnc-fullscreen-active \{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:60000;/s, "the active VNC viewport must cover the fullscreen document without covering noVNC's software cursor layer");

console.log("VNC 工作区复用检查通过：已有标签立即恢复，旧连接异步结果隔离，后台分屏不抢焦点，全屏保留远端光标");
