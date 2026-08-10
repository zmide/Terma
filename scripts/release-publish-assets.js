"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  expectedArtifacts,
  verifyReleaseVersion
} = require("./release-artifacts-check");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function releaseFileNames(directory) {
  return fs.readdirSync(directory, {withFileTypes:true})
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function expectedReleaseFiles(version = packageJson.version) {
  const core = ["windows", "linux", "macos", "linux-source"]
    .flatMap(platform => expectedArtifacts(platform, version));
  const blockmaps = core
    .filter(name => /windows-x64-installer\.exe$|macos-(?:x64|arm64)\.(?:dmg|zip)$/i.test(name))
    .map(name => `${name}.blockmap`);
  return [...core, ...blockmaps, `Terma-${version}-sbom.cdx.json`].sort((left, right) => left.localeCompare(right, "en"));
}

function assertExactFiles(actual, expected, label) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(name => !actualSet.has(name));
  const unexpected = actual.filter(name => !expectedSet.has(name));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`${label} does not match the expected release set (${details})`);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function prepare(directory) {
  verifyReleaseVersion();
  const expected = expectedReleaseFiles();
  const actual = releaseFileNames(directory).filter(name => name !== "SHA256SUMS");
  assertExactFiles(actual, expected, "Downloaded workflow artifacts");
  const lines = actual.map(name => `${sha256(path.join(directory, name))}  ${name}`);
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
  console.log(`Verified ${actual.length} release assets and generated SHA256SUMS.`);
}

function verifyRemote(directory, uploadedListFile) {
  const local = releaseFileNames(directory);
  const uploaded = fs.readFileSync(uploadedListFile, "utf8")
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
  assertExactFiles(uploaded, local, "Draft release assets");
  console.log(`Verified ${uploaded.length} uploaded release assets.`);
}

if (require.main === module) {
  const command = String(process.argv[2] || "");
  const directory = path.resolve(root, process.argv[3] || "release-assets");
  if (command === "prepare") prepare(directory);
  else if (command === "verify-remote") verifyRemote(directory, path.resolve(root, process.argv[4] || "uploaded-assets.txt"));
  else throw new Error("Usage: release-publish-assets.js <prepare|verify-remote> <directory> [uploaded-list]");
}

module.exports = { expectedReleaseFiles, prepare, verifyRemote };
