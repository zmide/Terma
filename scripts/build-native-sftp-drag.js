"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { assertNativeArchitecture } = require("./native-binary-check");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const electronVersion = String(packageJson.devDependencies?.electron || "")
  .replace(/^[^\d]*/, "");
const required = process.argv.includes("--required");
const diagnoseOnly = process.argv.includes("--diagnose");
const ifNeeded = process.argv.includes("--if-needed");
const currentArchOnly = process.argv.includes("--current-arch");

function failOrSkip(message, error) {
  const details = error instanceof Error ? `\n${error.message}` : "";
  if (required) {
    throw new Error(`${message}${details}`);
  }
  console.warn(`[native-sftp-drag] SKIP: ${message}${details}`);
  return false;
}

function executable(name) {
  const result = process.platform === "win32"
    ? childProcess.spawnSync("where.exe", [name], {
        encoding: "utf8",
        stdio: "pipe"
      })
    : childProcess.spawnSync("sh", ["-c", `command -v -- ${name}`], {
        encoding: "utf8",
        stdio: "pipe"
      });
  return result.status === 0;
}

function windowsCppToolchainAvailable() {
  if (executable("cl.exe")) return true;
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!fs.existsSync(vswhere)) return false;
  const result = childProcess.spawnSync(vswhere, [
    "-latest",
    "-products", "*",
    "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property", "installationPath"
  ], { encoding: "utf8", stdio: "pipe" });
  return result.status === 0 && Boolean(String(result.stdout || "").trim());
}

function run(command, args, options = {}) {
  console.log(`[native-sftp-drag] ${command} ${args.join(" ")}`);
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function copyBuiltFile(source, destination) {
  if (!fs.existsSync(source) || fs.statSync(source).size === 0) {
    throw new Error(`Native build output is missing or empty: ${source}`);
  }
  mkdir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  console.log(`[native-sftp-drag] Prepared ${path.relative(root, destination)}`);
}

function requestedArchitectures(platform) {
  const supported = new Set(["ia32", "x64", "arm64"]);
  const configured = String(process.env.TUNNELDESK_NATIVE_ARCHES || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (configured.length) {
    const invalid = configured.filter(value => !supported.has(value));
    if (invalid.length) {
      throw new Error(`Unsupported native architecture: ${invalid.join(", ")}`);
    }
    return [...new Set(configured)];
  }
  if (currentArchOnly) return [process.arch];
  if (platform === "darwin") return ["x64", "arm64"];
  return [process.arch];
}

function sourceFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (["build", "prebuilds"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function nativeBuildState(platform) {
  const sharedInputs = [__filename, path.join(root, "package.json")];
  if (platform === "win32") {
    const directory = path.join(root, "native", "win-sftp-drag");
    return {
      inputs:[
        ...sharedInputs,
        path.join(directory, "binding.gyp"),
        ...sourceFiles(path.join(directory, "src"))
      ],
      outputs:requestedArchitectures(platform).map(arch => ({
        file:path.join(directory, "prebuilds", `win32-${arch}`, "win_sftp_drag.node"),
        arch
      }))
    };
  }
  if (platform === "darwin") {
    const directory = path.join(root, "native", "macos-sftp-drag");
    return {
      inputs:[
        ...sharedInputs,
        path.join(directory, "binding.gyp"),
        ...sourceFiles(path.join(directory, "src"))
      ],
      outputs:requestedArchitectures(platform).map(arch => ({
        file:path.join(directory, "prebuilds", `darwin-${arch}`, "tunneldesk_macos_sftp_drag.node"),
        arch
      }))
    };
  }
  if (platform === "linux") {
    const directory = path.join(root, "native", "linux-sftp-drag");
    return {
      inputs:[
        ...sharedInputs,
        path.join(directory, "CMakeLists.txt"),
        ...sourceFiles(path.join(directory, "src"))
      ],
      outputs:[{
        file:path.join(directory, "prebuilds", `linux-${process.arch}`, "tunneldesk-linux-sftp-dragfs"),
        arch:process.arch
      }]
    };
  }
  return {inputs:sharedInputs, outputs:[]};
}

function nativeBuildIsCurrent(platform) {
  const state = nativeBuildState(platform);
  if (!state.outputs.length || state.inputs.some(file => !fs.existsSync(file))) return false;
  if (state.outputs.some(item => !fs.existsSync(item.file) || fs.statSync(item.file).size === 0)) return false;
  const newestInput = Math.max(...state.inputs.map(file => fs.statSync(file).mtimeMs));
  const oldestOutput = Math.min(...state.outputs.map(item => fs.statSync(item.file).mtimeMs));
  if (oldestOutput < newestInput) return false;
  for (const item of state.outputs) {
    assertNativeArchitecture(item.file, item.arch, `${platform} SFTP drag binary`);
  }
  console.log("[native-sftp-drag] Native output is up to date.");
  return true;
}

function buildNodeApiAddon(moduleDirectory, outputName, platform) {
  const nodeGyp = path.join(root, "node_modules", "node-gyp", "bin", "node-gyp.js");
  if (!fs.existsSync(nodeGyp)) {
    return failOrSkip("node-gyp is unavailable; run npm install first.");
  }
  if (!electronVersion) {
    return failOrSkip("Electron version is missing from package.json.");
  }
  if (platform === "win32" && !windowsCppToolchainAvailable()) {
    return failOrSkip(
      "Visual Studio C++ Build Tools were not found (cl.exe). Install the Desktop development with C++ workload."
    );
  }
  if (platform === "darwin" && !executable("xcrun")) {
    return failOrSkip("Xcode command-line tools were not found (xcrun).");
  }
  if (diagnoseOnly) {
    console.log(`[native-sftp-drag] ${platform} Node-API toolchain is available.`);
    return true;
  }

  for (const arch of requestedArchitectures(platform)) {
    run(process.execPath, [
      nodeGyp,
      "rebuild",
      "--release",
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      "--dist-url=https://electronjs.org/headers"
    ], {
      cwd: moduleDirectory,
      env: {
        npm_config_arch: arch,
        npm_config_target_arch: arch
      }
    });
    const source = path.join(moduleDirectory, "build", "Release", outputName);
    const destination = path.join(
      moduleDirectory,
      "prebuilds",
      `${platform}-${arch}`,
      outputName
    );
    assertNativeArchitecture(source, arch, `${platform} SFTP drag addon`);
    copyBuiltFile(source, destination);
  }
  return true;
}

function buildLinuxHelper() {
  const sourceDirectory = path.join(root, "native", "linux-sftp-drag");
  const buildDirectory = path.join(root, "build", "linux-sftp-drag");
  if (!executable("cmake")) {
    return failOrSkip("CMake was not found.");
  }
  if (!executable("pkg-config")) {
    return failOrSkip("pkg-config was not found.");
  }
  const packages = ["fuse3", "libcurl", "nlohmann_json"];
  const missing = packages.filter(name => {
    const result = childProcess.spawnSync("pkg-config", ["--exists", name], {
      stdio: "ignore",
      shell: false
    });
    return result.status !== 0;
  });
  if (missing.length) {
    return failOrSkip(
      `Linux native dependencies are missing: ${missing.join(", ")}. ` +
      "Install libfuse3-dev, libcurl development files and nlohmann-json3-dev."
    );
  }
  if (diagnoseOnly) {
    console.log("[native-sftp-drag] Linux FUSE3 toolchain is available.");
    return true;
  }

  run("cmake", [
    "-S", sourceDirectory,
    "-B", buildDirectory,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_TESTING=ON"
  ]);
  run("cmake", ["--build", buildDirectory, "--config", "Release", "--parallel"]);
  run("ctest", [
    "--test-dir", buildDirectory,
    "-C", "Release",
    "--output-on-failure"
  ]);

  const outputName = "tunneldesk-linux-sftp-dragfs";
  const source = path.join(buildDirectory, outputName);
  const destination = path.join(
    sourceDirectory,
    "prebuilds",
    `linux-${process.arch}`,
    outputName
  );
  assertNativeArchitecture(source, process.arch, "Linux SFTP drag helper");
  copyBuiltFile(source, destination);
  fs.chmodSync(destination, 0o755);
  return true;
}

function main() {
  console.log(
    `[native-sftp-drag] platform=${process.platform} arch=${process.arch} ` +
    `electron=${electronVersion || "unknown"} mode=${required ? "required" : "optional"}`
  );
  if (ifNeeded && !diagnoseOnly && nativeBuildIsCurrent(process.platform)) return true;
  if (process.platform === "win32") {
    return buildNodeApiAddon(
      path.join(root, "native", "win-sftp-drag"),
      "win_sftp_drag.node",
      "win32"
    );
  }
  if (process.platform === "darwin") {
    return buildNodeApiAddon(
      path.join(root, "native", "macos-sftp-drag"),
      "tunneldesk_macos_sftp_drag.node",
      "darwin"
    );
  }
  if (process.platform === "linux") {
    return buildLinuxHelper();
  }
  return failOrSkip(`Native SFTP drag-out is not supported on ${process.platform}.`);
}

try {
  const result = main();
  if (required && result === false) process.exitCode = 1;
} catch (error) {
  console.error(
    `[native-sftp-drag] ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
