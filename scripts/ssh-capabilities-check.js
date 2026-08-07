const assert = require("node:assert/strict");
const {
  PLATFORM_CAPABILITY_PROBE,
  POSIX_CAPABILITY_PROBE,
  WINDOWS_POWERSHELL_PROBE,
  WINDOWS_PWSH_PROBE,
  discoverRemoteTerminalCapabilities,
  parsePosixCapabilityOutput,
  parseWindowsCapabilityOutput
} = require("../dist/ssh-capabilities");
const legacyPrefix = ["T", "D"].join("");

function profile(capabilities, id) {
  return capabilities.profiles.find((item) => item.id === id);
}

function tool(capabilities, id) {
  return capabilities.tools.find((item) => item.id === id);
}

async function main() {
  const legacyLinux = parsePosixCapabilityOutput([
    `${legacyPrefix}_CAPS_V1\t\t`,
    "PLATFORM\tLinux\t",
    "DEFAULT_SHELL\t/bin/sh\tpasswd",
    "SHELL\tsh\t/bin/sh"
  ].join("\n"));
  assert.equal(legacyLinux.platform, "linux");
  assert.equal(legacyLinux.default_shell.name, "sh");
  const linuxFixture = [
    "noise before marker",
    "TERMA_CAPS_V1\t\t",
    "PLATFORM\tLinux\t",
    "DEFAULT_SHELL\t/bin/bash\tpasswd",
    "SHELL\tsh\t/bin/sh",
    "SHELL\tbash\t/bin/bash",
    "SHELL\tzsh\t/bin/zsh",
    "EXEC\tpython3\t/usr/bin/python3",
    "EXEC\tnode\t/usr/bin/node",
    "EXEC\ttmux\t/usr/bin/tmux",
    "EXEC\tgit\t/usr/bin/git",
    "EXEC\tgh\t/usr/bin/gh"
  ].join("\n");
  const linux = parsePosixCapabilityOutput(`\u001b[32m${linuxFixture}\u001b[0m`);
  assert.equal(linux.platform, "linux");
  assert.deepEqual(linux.default_shell, {
    name: "bash",
    label: "Bash",
    path: "/bin/bash",
    source: "passwd"
  });
  assert.equal(profile(linux, "bash").is_default, true);
  assert.equal(profile(linux, "python3").kind, "repl");
  assert.equal(profile(linux, "python3").args, "-i");
  assert.equal(profile(linux, "node").kind, "repl");
  assert.equal(profile(linux, "node").args, "-i");
  assert.equal(profile(linux, "tmux").kind, "session");
  assert.ok(tool(linux, "git"));
  assert.ok(tool(linux, "gh"));
  assert.equal(profile(linux, "git"), undefined, "Git 只能显示为已检测工具，不能作为启动配置");
  assert.equal(profile(linux, "gh"), undefined, "GitHub CLI 只能显示为已检测工具，不能作为启动配置");
  assert.equal(profile(linux, "git-bash"), undefined, "Linux 上安装 Git 不能被误标为 Git Bash");

  const macFixture = [
    "TERMA_CAPS_V1\t\t",
    "PLATFORM\tDarwin\t",
    "DEFAULT_SHELL\t/bin/zsh\tdirectory_service",
    "SHELL\tsh\t/bin/sh",
    "SHELL\tbash\t/bin/bash",
    "SHELL\tzsh\t/bin/zsh",
    "EXEC\tpython3\t/usr/bin/python3",
    "EXEC\tscreen\t/usr/bin/screen",
    "EXEC\tgit\t/usr/bin/git"
  ].join("\n");
  const mac = await discoverRemoteTerminalCapabilities(async (command) => {
    if (command === PLATFORM_CAPABILITY_PROBE) return "Darwin\n";
    assert.equal(command, POSIX_CAPABILITY_PROBE);
    return { stdout: Buffer.from(macFixture) };
  });
  assert.equal(mac.platform, "macos");
  assert.equal(mac.platform_label, "macOS");
  assert.equal(mac.default_shell.name, "zsh");
  assert.equal(mac.default_shell.source, "directory_service");
  assert.equal(profile(mac, "zsh").is_default, true);
  assert.equal(profile(mac, "screen").args, "-xRR terma");

  const windowsFixture = [
    "TERMA_CAPS_V1\t\t",
    "PLATFORM\twindows\t",
    "DEFAULT_SHELL\tC:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\topenssh_registry",
    "EXEC\tcmd\tC:\\Windows\\System32\\cmd.exe",
    "EXEC\tpowershell\tC:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "EXEC\tpwsh\tC:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "EXEC\tbash\tC:\\Program Files\\Git\\bin\\bash.exe",
    "EXEC\tpython\tC:\\Python313\\python.exe",
    "EXEC\tpy\tC:\\Windows\\py.exe",
    "EXEC\tnode\tC:\\Program Files\\nodejs\\node.exe",
    "EXEC\tgit\tC:\\Program Files\\Git\\cmd\\git.exe",
    "EXEC\tgh\tC:\\Program Files\\GitHub CLI\\gh.exe",
    "GIT_INSTALL\tgit\tC:\\Program Files\\Git",
    "EXEC\tgit-bash\tC:\\Program Files\\Git\\bin\\bash.exe"
  ].join("\r\n");
  let windowsCalls = 0;
  const windows = await discoverRemoteTerminalCapabilities(async (command) => {
    windowsCalls += 1;
    if (command === PLATFORM_CAPABILITY_PROBE) throw new Error("'uname' is not recognized");
    assert.notEqual(command, POSIX_CAPABILITY_PROBE, "Windows 默认 Shell 不应收到带重定向的 POSIX 探针");
    assert.ok(command === WINDOWS_POWERSHELL_PROBE || command === WINDOWS_PWSH_PROBE);
    return windowsFixture;
  });
  assert.equal(windowsCalls, 2);
  assert.equal(windows.platform, "windows");
  assert.equal(windows.default_shell.name, "powershell");
  assert.equal(profile(windows, "powershell").is_default, true);
  assert.equal(profile(windows, "powershell").args, "-NoLogo");
  assert.equal(profile(windows, "git-bash").label, "Git Bash");
  assert.equal(profile(windows, "git-bash").path, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.equal(profile(windows, "bash"), undefined, "同一路径不应重复显示 Bash 和 Git Bash");
  assert.equal(profile(windows, "python").args, "-i");
  assert.equal(profile(windows, "py").args, "-i");
  assert.equal(profile(windows, "node").args, "-i");
  assert.ok(tool(windows, "git"));
  assert.ok(tool(windows, "gh"));

  const fakeGitBashFixture = [
    "TERMA_CAPS_V1\t\t",
    "PLATFORM\twindows\t",
    "DEFAULT_SHELL\tC:\\Windows\\System32\\cmd.exe\tcomspec",
    "EXEC\tcmd\tC:\\Windows\\System32\\cmd.exe",
    "EXEC\tbash\tC:\\Tools\\MSYS2\\usr\\bin\\bash.exe",
    "EXEC\tgit-bash\tC:\\Tools\\PretendGit\\bin\\bash.exe",
    "GIT_INSTALL\tgit\tC:\\Program Files\\Git",
    "EXEC\tgit\tC:\\Program Files\\Git\\cmd\\git.exe"
  ].join("\n");
  const fakeGitBash = parseWindowsCapabilityOutput(fakeGitBashFixture);
  assert.equal(profile(fakeGitBash, "git-bash"), undefined, "非 Git for Windows 安装目录不能标记为 Git Bash");
  assert.equal(profile(fakeGitBash, "bash").label, "Bash");

  const noDefault = parsePosixCapabilityOutput([
    "TERMA_CAPS_V1\t\t",
    "PLATFORM\tLinux\t",
    "DEFAULT_SHELL\t\t",
    "EXEC\tbash\t/bin/bash"
  ].join("\n"));
  assert.equal(noDefault.default_shell, null);
  assert.ok(noDefault.warnings.length);

  const unknown = await discoverRemoteTerminalCapabilities(async () => "not a capability response", { timeoutMs: 1000 });
  assert.equal(unknown.platform, "unknown");
  assert.equal(unknown.profiles.length, 0);
  assert.ok(unknown.warnings.length);

  const encoded = WINDOWS_POWERSHELL_PROBE.split(" ").at(-1);
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(decoded, /Get-Command/);
  assert.match(decoded, /GitForWindows/);
  assert.doesNotMatch(decoded, /\b(Start-Process|Set-ItemProperty|New-Item|Remove-Item)\b/);

  console.log("远端终端能力探测检查通过：Linux/macOS/Windows、Git Bash 识别、REPL 参数与只读探针");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
