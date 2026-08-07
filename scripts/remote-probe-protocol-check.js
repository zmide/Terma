"use strict";

const assert = require("node:assert/strict");
const {
  remoteProbeMarker,
  remoteProbeValue,
  selectRemoteProbeLines
} = require("../dist/remote-probe-protocol");

const legacyPrefix = ["T", "D"].join("");

assert.deepEqual(
  selectRemoteProbeLines(`${legacyPrefix}_VNC_PLATFORM=linux\n${legacyPrefix}_VNC_PORT=5900`, "VNC_"),
  ["PLATFORM=linux", "PORT=5900"]
);
assert.equal(remoteProbeValue(`${legacyPrefix}_X11_DISPLAY=localhost:10.0`, "DISPLAY", "X11_"), "localhost:10.0");
assert.equal(remoteProbeMarker(`${legacyPrefix}_CAPS_V1\t\t`, "CAPS_V1"), `${legacyPrefix}_CAPS_V1`);

const mixed = `${legacyPrefix}_VALUE=legacy\nTERMA_VALUE=current`;
assert.deepEqual(selectRemoteProbeLines(mixed), ["VALUE=current"]);
assert.equal(remoteProbeValue(mixed, "VALUE"), "current");
assert.equal(remoteProbeMarker(`${legacyPrefix}_CAPS_V1\nTERMA_CAPS_V1`, "CAPS_V1"), "TERMA_CAPS_V1");

console.log("远端探测协议检查通过：新 TERMA 前缀优先，旧前缀仍可读取");
