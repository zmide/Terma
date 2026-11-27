const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Script } = require("node:vm");
const ts = require("typescript-legacy");
const { LEGACY_BUNDLE, legacyBundleSource } = require("./frontend-source");

const repositoryRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(repositoryRoot, "frontend");
const viteBinary = path.join(
  frontendRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite"
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const legacySource = legacyBundleSource(repositoryRoot);
new Script(legacySource, { filename: LEGACY_BUNDLE });

function run(args) {
  const result = spawnSync(npmCommand, args, {
    cwd: frontendRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!fs.existsSync(viteBinary)) run(["ci", "--no-audit", "--no-fund"]);
run(["run", "build"]);


// These hooks keep their synchronous positions before the Vue entry installs.
for (const [source, destination] of [
  ["src/app/csp-bootstrap.ts", "csp-bootstrap.js"],
  ["src/features/settings/appearance-bootstrap.ts", "app-theme-settings.js"]
]) {
  const filename = path.join(frontendRoot, source);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}
  });
  fs.writeFileSync(path.join(repositoryRoot, "public", destination), output.outputText, "utf8");
}

const notices = [
  ["Vue 3.5.44", "third-party/vue/LICENSE"],
  ["i18next 26.5.5", "third-party/i18next/LICENSE"],
  ["Tile UI f047bf2f17820d4c6a5525ff37de7f18a2148d1e", "third-party/tile-ui/LICENSE"],
  ["Tile UI styles and Cloudflare Kumo 7e0ff40546f08405d05bc9754f0ff0fd009ece0a", "src/styles/themes/LICENSE.kumo"]
].map(([name, file]) => `${name}\n${"=".repeat(name.length)}\n\n${fs.readFileSync(path.join(frontendRoot, file), "utf8")}\n`);
for (const [name, file] of [
  ["basic-ftp 6.2.6", "node_modules/basic-ftp/LICENSE.txt"],
  ["DOMPurify 3.5.0", "node_modules/dompurify/LICENSE"]
]) {
  notices.push(`${name}\n${"=".repeat(name.length)}\n\n${fs.readFileSync(path.join(repositoryRoot, file), "utf8")}\n`);
}
fs.writeFileSync(path.join(frontendRoot, "dist", "THIRD_PARTY_NOTICES.txt"), notices.join("\n"), "utf8");
