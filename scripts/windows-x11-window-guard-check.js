"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  planWindowsX11WindowCorrection,
  windowsX11WindowGuardScript
} = require("../desktop/windows-x11-window-guard");

const workArea = {left:0, top:0, right:1920, bottom:1040};

assert.deepEqual(
  planWindowsX11WindowCorrection(
    {left:-8, top:-31, right:792, bottom:569},
    {x:0, y:0},
    workArea
  ),
  {left:0, top:0},
  "An X11 client placed at screen origin must keep its Windows title bar inside the work area"
);

assert.equal(
  planWindowsX11WindowCorrection(
    {left:100, top:100, right:900, bottom:700},
    {x:108, y:131},
    workArea
  ),
  null,
  "A normally positioned decorated window must not move"
);

assert.equal(
  planWindowsX11WindowCorrection(
    {left:100, top:-8, right:900, bottom:592},
    {x:108, y:23},
    workArea
  ),
  null,
  "A partially clipped window with an operable title bar must stay where the user placed it"
);

assert.deepEqual(
  planWindowsX11WindowCorrection(
    {left:-760, top:100, right:40, bottom:700},
    {x:-752, y:131},
    workArea
  ),
  {left:0, top:100},
  "A horizontally unreachable window must return to the nearest work-area edge"
);

assert.deepEqual(
  planWindowsX11WindowCorrection(
    {left:-8, top:-31, right:2192, bottom:1069},
    {x:0, y:0},
    workArea
  ),
  {left:0, top:0},
  "An oversized window must keep its size while restoring an operable title bar"
);

assert.equal(planWindowsX11WindowCorrection({}, {}, workArea), null);

const fallbackScript = windowsX11WindowGuardScript(4321);
assert.match(fallbackScript, /\$SWP_ASYNCWINDOWPOS = 0x4000/);
assert.match(fallbackScript, /\$setWindowFlags =[^\r\n]*\$SWP_ASYNCWINDOWPOS/);
const wpsCompatibilityScript = windowsX11WindowGuardScript(4321, {enableWpsCompatibility:true});
assert.match(wpsCompatibilityScript, /\$enableWpsCompatibility = \$true/);
assert.match(wpsCompatibilityScript, /WPS\(\?: Office\)\?/);
assert.match(wpsCompatibilityScript, /WM_NCLBUTTONDOWN/);
assert.match(wpsCompatibilityScript, /ShowWindow/);

const nativeSource = fs.readFileSync(
  path.join(__dirname, "..", "native", "win-sftp-drag", "src", "addon.cc"),
  "utf8"
);
assert.match(nativeSource, /visible_width < kX11WindowGuardMinimumVisibleWidth/);
assert.match(nativeSource, /SWP_ASYNCWINDOWPOS/);

console.log("Windows X11 window guard checks passed");
