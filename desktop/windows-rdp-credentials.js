const path = require("node:path");

const READY_MARKER = "TERMA_RDP_CREDENTIAL_READY";

function windowsRdpCredentialText(chinese, english, language = process.env.TERMA_INTERFACE_LANGUAGE) {
  return String(language || "").toLowerCase().startsWith("en") ? english : chinese;
}

function windowsPowerShellExecutable(environment = process.env) {
  return path.win32.join(environment.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function windowsRdpCredentialTarget(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value || /[\0\r\n]/.test(value)) throw new Error(windowsRdpCredentialText("RDP 凭据目标无效", "The RDP credential target is invalid"));
  return `TERMSRV/${value}`;
}

function windowsRdpCredentialTargets(endpoint) {
  const value = String(endpoint || "").trim();
  const host = value.startsWith("[")
    ? value.slice(1, value.indexOf("]"))
    : value.replace(/:\d+$/, "");
  return [...new Set([windowsRdpCredentialTarget(value), windowsRdpCredentialTarget(host)])];
}

function launchWindowsRdpWithCredential(options = {}) {
  const runtimeSpawn = options.spawn;
  const language = options.language || options.environment?.TERMA_INTERFACE_LANGUAGE || process.env.TERMA_INTERFACE_LANGUAGE;
  const text = (chinese, english) => windowsRdpCredentialText(chinese, english, language);
  if (typeof runtimeSpawn !== "function") throw new Error(text("Windows RDP 启动器不可用", "The Windows RDP launcher is unavailable"));
  const executable = String(options.executable || "");
  const rdpFile = String(options.rdpFile || "");
  const username = String(options.username || "");
  const password = String(options.password || "");
  if (!username) throw new Error(text("传递 RDP 密码时必须填写用户名", "A username is required when transferring the RDP password"));
  if (!password) throw new Error(text("没有可传递的 RDP 密码", "No RDP password is available to transfer"));
  if ([executable, rdpFile, username, password].some(value => /\0/.test(value))) throw new Error(text("RDP 凭据包含无效控制字符", "The RDP credentials contain invalid control characters"));

  const helper = path.join(__dirname, "windows-rdp-credential.ps1");
  const powershell = windowsPowerShellExecutable(options.environment);
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper];
  const payload = Buffer.from(JSON.stringify({
    targets:windowsRdpCredentialTargets(options.endpoint),
    username,
    password,
    executable,
    rdp_file:rdpFile,
    cleanup_seconds:Math.max(1, Math.min(30, Math.round(Number(options.cleanupSeconds || 30))))
  }), "utf8");

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer = null;
    const child = runtimeSpawn(powershell, args, {
      detached:false,
      stdio:["pipe", "pipe", "pipe"],
      windowsHide:true
    });
    const clearPayload = () => payload.fill(0);
    const finish = error => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      clearPayload();
      if (error) reject(error);
      else resolve({credential_targets:windowsRdpCredentialTargets(options.endpoint)});
    };
    const inspectOutput = () => {
      if (stdout.includes(READY_MARKER)) finish(null);
    };
    child.stdout?.on?.("data", chunk => {
      stdout = (stdout + chunk.toString()).slice(-4096);
      inspectOutput();
    });
    child.stderr?.on?.("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once("spawn", () => {
      child.stdin.once?.("error", clearPayload);
      child.stdin.end(payload, clearPayload);
      timer = setTimeout(() => finish(new Error(text("Windows RDP 凭据交接超时，请重试", "Windows RDP credential handoff timed out. Try again."))), 10000);
      timer.unref?.();
    });
    child.once("error", error => finish(error));
    child.once("close", code => {
      if (!settled) finish(new Error(stderr.trim() || stdout.trim() || text(
        `Windows RDP 凭据交接失败（代码 ${code ?? "未知"}）`,
        `Windows RDP credential handoff failed (code ${code ?? "unknown"})`
      )));
    });
  });
}

module.exports = {
  READY_MARKER,
  launchWindowsRdpWithCredential,
  windowsPowerShellExecutable,
  windowsRdpCredentialTarget,
  windowsRdpCredentialTargets
};
