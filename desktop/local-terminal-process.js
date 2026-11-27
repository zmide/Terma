"use strict";
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const fs = require("node:fs");

function detectedShellProfiles(platform = process.platform, environment = process.env, exists = fs.existsSync) {
  const find = (name, candidates = []) => [...candidates, ...(environment.PATH || environment.Path || "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name))].find(file => path.isAbsolute(file) && exists(file));
  const profiles = [];
  const add = (id, label, file, args) => {if (file && exists(file)) profiles.push({id, label, file, args});};
  if (platform === "win32") {
    const system = path.join(environment.SystemRoot || "C:\\Windows", "System32"), programs = environment.ProgramFiles || "C:\\Program Files";
    add("powershell", "PowerShell", path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo"]);
    add("pwsh", "PowerShell 7", find("pwsh.exe", [path.join(programs, "PowerShell", "7", "pwsh.exe")]), ["-NoLogo"]);
    add("cmd", "Command Prompt", path.join(system, "cmd.exe"), ["/Q"]);
    add("git-bash", "Git Bash", find("bash.exe", [path.join(programs, "Git", "bin", "bash.exe"),
      path.join(environment.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe")]), ["--login", "-i"]);
  } else {
    const file = environment.SHELL && path.isAbsolute(environment.SHELL) ? environment.SHELL : "/bin/sh";
    add("shell", path.basename(file), file, ["-l"]);
    for (const name of ["zsh", "bash", "fish", "sh"]) {
      const candidate = find(name, ["/bin/" + name, "/usr/bin/" + name, "/opt/homebrew/bin/" + name]);
      if (candidate && candidate !== file) add(name, name, candidate, ["-l"]);
    }
  }
  return profiles;
}

function shellProfile(profile, platform = process.platform, environment = process.env) {
  const detected = detectedShellProfiles(platform, environment).find(item => item.id === profile);
  if (detected) return detected;
  if (platform === "win32") {
    const system = path.join(environment.SystemRoot || "C:\\Windows", "System32");
    if (profile === "cmd") return {file:path.join(system, "cmd.exe"), args:["/Q"], label:"CMD"};
    if (profile === "powershell") return {file:path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), args:["-NoLogo"], label:"PowerShell"};
    throw new Error("INVALID_SHELL");
  }
  if (profile !== "shell") throw new Error("INVALID_SHELL");
  const file = environment.SHELL && path.isAbsolute(environment.SHELL) ? environment.SHELL : "/bin/sh";
  return {file, args:["-l"], label:path.basename(file)};
}

function startLocalProcess(profile, size, emit, dependencies = {}) {
  const selected = shellProfile(profile, dependencies.platform, dependencies.environment);
  const env = {...process.env, TERM:"xterm-256color"};
  for (const key of Object.keys(env)) if (/^(?:TERMA_|TUNNELDESK_|ELECTRON_)/.test(key)) delete env[key];
  let pty;
  try {pty = (dependencies.loadPty || (() => require("../dist/pty-runtime").loadNodePty()))();}
  catch {pty = null;}
  if (pty) {
    try {
      const child = pty.spawn(selected.file, selected.args, {name:"xterm-256color", cols:size.cols, rows:size.rows,
        cwd:os.homedir(), env, ...(process.platform === "win32" ? {useConptyDll:true} : {encoding:"utf8"})});
      child.onData(data => emit({type:"data", data}));
      child.onExit(result => emit({type:"exit", code:result.exitCode}));
      return {pty:true, label:selected.label, write:data => child.write(data),
        resize:(cols, rows) => child.resize(cols, rows), close:() => child.kill()};
    } catch { /* A missing native PTY retains a functional pipe terminal. */ }
  }
  const child = (dependencies.spawn || spawn)(selected.file, selected.args, {
    cwd:os.homedir(), env, windowsHide:true, stdio:["pipe","pipe","pipe"]
  });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", data => emit({type:"data", data}));
  child.stderr.on("data", data => emit({type:"data", data}));
  child.on("error", () => emit({type:"error", code:"LOCAL_TERMINAL_FAILED"}));
  child.on("exit", code => emit({type:"exit", code}));
  return {pty:false, label:selected.label, write:data => child.stdin.write(data.replace(/\r/g, "\n")),
    resize:() => {}, close:() => child.kill()};
}
module.exports = {shellProfile, startLocalProcess, detectedShellProfiles};
