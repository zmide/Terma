"use strict";

const semverMajor = Number(String(process.versions.node || "0").split(".")[0]);
const minimumMajor = 22;

function fail(message) {
  console.error(`Terma requires Node.js ${minimumMajor} or newer. ${message}`);
  process.exitCode = 1;
}

if (!Number.isFinite(semverMajor) || semverMajor < minimumMajor) {
  fail(`Detected Node.js v${process.versions.node || "unknown"}.`);
} else {
  try {
    require("node:sqlite");
  } catch (error) {
    fail(`The built-in node:sqlite module is unavailable (${error.code || error.message || "unknown error"}).`);
  }
}

if (!process.exitCode) console.log(`Node.js v${process.versions.node} is ready.`);
