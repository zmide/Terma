const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { launchWindowsRdpWithCredential } = require("./windows-rdp-credentials");

const MAC_WINDOWS_APP_URL = "macappstore://itunes.apple.com/app/id1295203466";
const MAC_WINDOWS_APP_PACKAGE_URL = "https://go.microsoft.com/fwlink/?linkid=868963";

function normalizeDesktopLanguage(value) {
  return String(value || "") === "en-US" ? "en-US" : "zh-CN";
}

function desktopUiText(language, chinese, english) {
  return normalizeDesktopLanguage(language) === "en-US" ? english : chinese;
}

function languageGetter(options = {}, environment = process.env) {
  return typeof options.getLanguage === "function"
    ? options.getLanguage
    : () => options.language || environment.TERMA_INTERFACE_LANGUAGE || process.env.TERMA_INTERFACE_LANGUAGE || "zh-CN";
}

function rdpDisplayMode(options = {}) {
  const mode = String(options.display_mode || "");
  if (["dynamic", "fullscreen", "fixed"].includes(mode)) return mode;
  if (Object.prototype.hasOwnProperty.call(options, "fullscreen")) return options.fullscreen === false ? "fixed" : "fullscreen";
  return "dynamic";
}

function remoteDesktopSize(options = {}) {
  return {
    width:Math.max(640, Math.min(8192, Math.round(Number(options.width || 1440)))),
    height:Math.max(480, Math.min(8192, Math.round(Number(options.height || 900))))
  };
}

function normalizeRemoteClientHost(value, language = process.env.TERMA_INTERFACE_LANGUAGE) {
  const raw = String(value ?? "").trim();
  const host = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (!host || host.startsWith("[") || host.endsWith("]") || /[\0\r\n\t\s/\\]/.test(host)) throw new Error(desktopUiText(
    language,
    "远程桌面目标地址无效",
    "The remote-desktop target address is invalid"
  ));
  if (host.includes(":") && net.isIP(host) !== 6) throw new Error(desktopUiText(
    language,
    "远程桌面目标 IPv6 地址无效",
    "The remote-desktop target IPv6 address is invalid"
  ));
  return host;
}

function remoteClientEndpoint(hostValue, portValue, language = process.env.TERMA_INTERFACE_LANGUAGE) {
  const host = normalizeRemoteClientHost(hostValue, language);
  const port = Number(portValue || 0);
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

function createRemoteClientAdapter(options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const runtimeSpawn = options.spawn || spawn;
  const runtimeSpawnSync = options.spawnSync || spawnSync;
  const runtimeFetch = options.fetch || globalThis.fetch;
  const runtimeShell = options.shell;
  const runtimeWindowsRdpCredentialLaunch = options.launchWindowsRdpWithCredential || launchWindowsRdpWithCredential;
  const existsSync = options.existsSync || fs.existsSync;
  const statSync = options.statSync || fs.statSync;
  const accessSync = options.accessSync || fs.accessSync;
  const getDataDir = options.getDataDir || (() => options.dataDir || process.cwd());
  const getXServerDiagnostics = options.getXServerDiagnostics || (() => null);
  const getVncClientPath = typeof options.getVncClientPath === "function"
    ? options.getVncClientPath
    : () => options.vncClientPath || "";
  const getLanguage = languageGetter(options, environment);
  const text = (chinese, english) => desktopUiText(getLanguage(), chinese, english);
  const normalizeHost = value => normalizeRemoteClientHost(value, getLanguage());
  const endpoint = (host, port) => remoteClientEndpoint(host, port, getLanguage());
  const startupProbeMs = Math.max(0, Number(options.startupProbeMs ?? 1400));
  const clientPath = platform === "win32" ? path.win32 : path.posix;

  function command(command, args) {
    try {
      return runtimeSpawnSync(command, args, {encoding:"utf8", windowsHide:true, timeout:3000});
    } catch {
      return {status:1, stdout:"", stderr:""};
    }
  }

  function findExecutable(names) {
    for (const name of names) {
      if (!name) continue;
      if (clientPath.isAbsolute(name) && existsSync(name)) return name;
      const lookup = platform === "win32" ? "where.exe" : "which";
      const result = command(lookup, [name]);
      const found = String(result.stdout || "").split(/\r?\n/).map(value => value.trim()).find(Boolean);
      if (result.status === 0 && found) return found;
    }
    return "";
  }

  function canSelectVncClient() {
    return typeof options.canSelectVncClient === "function"
      ? Boolean(options.canSelectVncClient())
      : Boolean(options.canSelectVncClient);
  }

  function validateVncClientPath(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("\0") || !clientPath.isAbsolute(raw)) throw new Error(text(
      "请选择 VNC 客户端的完整路径",
      "Select the full path to the VNC client"
    ));
    const executable = clientPath.normalize(raw);
    let stat;
    try {
      if (!existsSync(executable)) throw new Error("missing");
      stat = statSync(executable);
    } catch {
      throw new Error(text("选择的 VNC 客户端不存在", "The selected VNC client does not exist"));
    }
    const macApplication = platform === "darwin" && stat.isDirectory() && /\.app$/i.test(executable);
    if (!stat.isFile() && !macApplication) throw new Error(text(
      "选择的路径不是 VNC 客户端程序",
      "The selected path is not a VNC client application"
    ));
    if (platform === "win32" && !/\.exe$/i.test(executable)) throw new Error(text(
      "Windows VNC 客户端必须是 .exe 程序",
      "A Windows VNC client must be an .exe application"
    ));
    if (platform !== "win32" && !macApplication) {
      try { accessSync(executable, fs.constants.X_OK); }
      catch { throw new Error(text("选择的 VNC 客户端没有执行权限", "The selected VNC client is not executable")); }
    }
    return executable;
  }

  function configuredVncClientPath() {
    try {
      const configured = String(getVncClientPath() || "").trim();
      return configured ? validateVncClientPath(configured) : "";
    } catch {
      return "";
    }
  }

  function vncClientDetails(executable, configured = false) {
    if (!executable) return {client:"", executable:"", mode:"", application:"", configured:false};
    const name = clientPath.basename(executable);
    if (platform === "darwin" && /\.app$/i.test(executable)) {
      return {
        client:clientPath.basename(executable, ".app"),
        executable:"/usr/bin/open",
        mode:"application",
        application:executable,
        configured
      };
    }
    const normalizedExecutable = String(executable).replaceAll("\\", "/");
    const normalizedName = String(name).toLowerCase();
    const normalizedPath = normalizedExecutable.toLowerCase();
    const mode = /remmina(?:\.exe)?$/i.test(name)
      ? "remmina"
      : /gvncviewer(?:\.exe)?$/i.test(name)
        ? "gvncviewer"
        : /tvnviewer(?:\.exe)?$/i.test(name)
          ? "tightvnc"
          : /(?:^|\/)tigervnc(?:\/|$)/i.test(normalizedPath)
            ? "tigervnc"
            : (normalizedPath.includes("realvnc")
              || /(?:^|\/)vnc viewer(?: [^/]+)?\/vncviewer(?:\.exe)?$/i.test(normalizedPath)
              || /^vnc[-_ ]+viewer(?:\.exe)?$/i.test(normalizedName))
              ? "realvnc"
              : "generic";
    return {
      client:name,
      executable,
      mode,
      application:"",
      configured
    };
  }

  function windowsVncUriHandler() {
    if (platform !== "win32") return false;
    const keys = ["HKCU\\Software\\Classes\\vnc\\shell\\open\\command", "HKCR\\vnc\\shell\\open\\command"];
    return keys.some(key => command("reg.exe", ["query", key, "/ve"]).status === 0);
  }

  function macApplication(names) {
    const home = environment.HOME || "";
    const candidates = names.flatMap(name => [clientPath.join("/Applications", name), home ? clientPath.join(home, "Applications", name) : ""]);
    return candidates.find(file => file && existsSync(file)) || "";
  }

  function diagnostics() {
    let rdp = {available:false, client:"", executable:"", mode:"", application:""};
    let vnc = {available:false, client:"", executable:"", mode:"", application:""};
    const configuredVnc = configuredVncClientPath();
    if (platform === "win32") {
      const mstsc = findExecutable([clientPath.join(environment.SystemRoot || "C:\\Windows", "System32", "mstsc.exe")]);
      const vncViewer = findExecutable([
        configuredVnc,
        "vncviewer.exe",
        clientPath.join(environment.ProgramFiles || "", "TigerVNC", "vncviewer.exe"),
        clientPath.join(environment.ProgramFiles || "", "RealVNC", "VNC Viewer", "vncviewer.exe"),
        clientPath.join(environment.ProgramFiles || "", "TightVNC", "tvnviewer.exe"),
        clientPath.join(environment.ProgramFiles || "", "uvnc bvba", "UltraVNC", "vncviewer.exe"),
        clientPath.join(environment["ProgramFiles(x86)"] || "", "TigerVNC", "vncviewer.exe"),
        clientPath.join(environment["ProgramFiles(x86)"] || "", "RealVNC", "VNC Viewer", "vncviewer.exe"),
        clientPath.join(environment["ProgramFiles(x86)"] || "", "TightVNC", "tvnviewer.exe"),
        clientPath.join(environment["ProgramFiles(x86)"] || "", "uvnc bvba", "UltraVNC", "vncviewer.exe"),
        clientPath.join(environment.LOCALAPPDATA || "", "Programs", "RealVNC", "VNC Viewer", "vncviewer.exe")
      ]);
      const uri = windowsVncUriHandler();
      const details = vncClientDetails(vncViewer, Boolean(configuredVnc && vncViewer === configuredVnc));
      const selectable = !vncViewer && !uri && canSelectVncClient();
      rdp = {
        available:Boolean(mstsc),
        client:mstsc ? text("远程桌面连接", "Remote Desktop Connection") : "",
        executable:mstsc,
        mode:"rdp-file",
        application:"",
        password_transfer_supported:Boolean(mstsc),
        password_transfer_mode:mstsc ? "windows-credential-manager" : ""
      };
      vnc = {
        available:Boolean(vncViewer || uri),
        launchable:Boolean(vncViewer || uri || selectable),
        client:vncViewer ? details.client : uri ? text("系统 VNC 客户端", "System VNC client") : "",
        executable:details.executable,
        mode:vncViewer ? details.mode : uri ? "uri" : "",
        application:details.application,
        configured:details.configured,
        requires_selection:selectable,
        reason_code:selectable ? "vnc_client_selection_required" : "",
        reason:selectable
          ? text("未找到系统 VNC 客户端；打开时请选择 VNC Viewer 程序", "No system VNC client was found. Select a VNC Viewer application when opening the connection.")
          : ""
      };
    } else if (platform === "darwin") {
      const rdpApp = macApplication(["Windows App.app", "Microsoft Remote Desktop.app"]);
      const freeRdp = findExecutable(["xfreerdp3", "xfreerdp"]);
      let xServer = null;
      try { xServer = getXServerDiagnostics(); } catch {}
      const freeRdpDisplayReady = Boolean(environment.DISPLAY);
      const freeRdpNeedsXServer = Boolean(freeRdp && !freeRdpDisplayReady);
      const freeRdpCanStartXServer = Boolean(freeRdpNeedsXServer && xServer?.installed);
      const screenSharing = ["/System/Applications/Utilities/Screen Sharing.app", "/Applications/Utilities/Screen Sharing.app"].find(file => existsSync(file)) || "";
      const details = vncClientDetails(configuredVnc || screenSharing, Boolean(configuredVnc));
      const selectable = !configuredVnc && !screenSharing && canSelectVncClient();
      rdp = {
        available:Boolean(rdpApp || (freeRdp && freeRdpDisplayReady)),
        launchable:Boolean(rdpApp || (freeRdp && (freeRdpDisplayReady || freeRdpCanStartXServer))),
        client:rdpApp ? clientPath.basename(rdpApp, ".app") : freeRdp ? clientPath.basename(freeRdp) : "",
        executable:rdpApp ? "/usr/bin/open" : freeRdp,
        mode:rdpApp ? "rdp-file" : freeRdp ? "freerdp" : "",
        application:rdpApp,
        password_transfer_supported:Boolean(freeRdp && (freeRdpDisplayReady || freeRdpCanStartXServer)),
        password_transfer_mode:freeRdp ? "freerdp" : "",
        password_transfer_executable:freeRdp,
        password_transfer_client:freeRdp ? clientPath.basename(freeRdp) : "",
        password_transfer_requires_xserver:freeRdpNeedsXServer,
        requires_xserver:freeRdpNeedsXServer,
        xserver_installed:Boolean(xServer?.installed),
        can_install:!rdpApp && (!freeRdp || !freeRdpCanStartXServer),
        install_label:text("安装 Windows App", "Install Windows App"),
        install_kind:"app-store",
        reason:rdpApp || (freeRdp && freeRdpDisplayReady)
          ? ""
          : freeRdpCanStartXServer
            ? text("已检测到 FreeRDP；连接时 Terma 会自动启动 XQuartz", "FreeRDP was detected; Terma will start XQuartz automatically when connecting")
            : freeRdp
              ? text("已检测到 FreeRDP，但尚未安装可用的 XQuartz；可安装 XQuartz，或改用 Windows App", "FreeRDP was detected, but a usable XQuartz installation is missing. Install XQuartz or use Windows App instead.")
              : text("macOS 未检测到 RDP 客户端；可安装 Windows App 后重试", "No RDP client was detected on macOS. Install Windows App and try again.")
      };
      vnc = {
        available:Boolean(configuredVnc || screenSharing),
        launchable:Boolean(configuredVnc || screenSharing || selectable),
        client:configuredVnc ? details.client : screenSharing ? text("屏幕共享", "Screen Sharing") : "",
        executable:configuredVnc ? details.executable : screenSharing ? "/usr/bin/open" : "",
        mode:configuredVnc ? details.mode : screenSharing ? "uri" : "",
        application:configuredVnc ? details.application : screenSharing,
        configured:Boolean(configuredVnc),
        requires_selection:selectable,
        reason_code:selectable ? "vnc_client_selection_required" : "",
        reason:selectable
          ? text("未找到系统 VNC 客户端；打开时请选择 VNC Viewer 应用", "No system VNC client was found. Select a VNC Viewer application when opening the connection.")
          : ""
      };
    } else {
      const rdpClient = findExecutable(["xfreerdp3", "xfreerdp", "wlfreerdp", "remmina"]);
      const vncClient = findExecutable([configuredVnc, "vncviewer", "gvncviewer", "remmina"]);
      const rdpName = clientPath.basename(rdpClient || "");
      const vncName = clientPath.basename(vncClient || "");
      const rdpDisplayReady = /^wlfreerdp/i.test(rdpName)
        ? Boolean(environment.WAYLAND_DISPLAY || environment.DISPLAY)
        : Boolean(environment.DISPLAY);
      const vncDisplayReady = Boolean(environment.DISPLAY || environment.WAYLAND_DISPLAY);
      const vncDetails = vncClientDetails(vncClient, Boolean(configuredVnc && vncClient === configuredVnc));
      const vncSelectable = !vncClient && vncDisplayReady && canSelectVncClient();
      rdp = {
        available:Boolean(rdpClient && rdpDisplayReady),
        client:rdpName,
        executable:rdpClient,
        mode:/remmina$/i.test(rdpClient) ? "remmina" : "freerdp",
        application:"",
        password_transfer_supported:Boolean(rdpClient && !/remmina$/i.test(rdpClient) && rdpDisplayReady),
        password_transfer_mode:rdpClient && !/remmina$/i.test(rdpClient) ? "freerdp" : "",
        reason:!rdpClient
          ? text("未找到 FreeRDP 或 Remmina", "FreeRDP or Remmina was not found")
          : rdpDisplayReady
            ? ""
            : text("当前 Terma 没有可用的图形桌面 DISPLAY", "No graphical desktop DISPLAY is available to Terma"),
        can_install:!rdpClient,
        install_label:text("安装 FreeRDP", "Install FreeRDP")
      };
      vnc = {
        available:Boolean(vncClient && vncDisplayReady),
        launchable:Boolean((vncClient || vncSelectable) && vncDisplayReady),
        client:vncDetails.client || vncName,
        executable:vncDetails.executable,
        mode:vncDetails.mode,
        application:vncDetails.application,
        configured:vncDetails.configured,
        requires_selection:vncSelectable,
        reason_code:vncSelectable ? "vnc_client_selection_required" : "",
        reason:!vncClient
          ? vncSelectable
            ? text("未找到系统 VNC 客户端；打开时请选择 VNC Viewer 程序", "No system VNC client was found. Select a VNC Viewer application when opening the connection.")
            : text("未找到系统 VNC 客户端", "No system VNC client was found")
          : vncDisplayReady
            ? ""
            : text("当前 Terma 没有可用的图形桌面 DISPLAY", "No graphical desktop DISPLAY is available to Terma")
      };
    }
    return {
      platform,
      rdp,
      vnc,
      password_policy:text(
        "默认不传递密码；用户明确允许后，Windows 使用临时凭据存储，FreeRDP 使用标准输入，密码不会进入命令行",
        "Passwords are not transferred by default. When explicitly allowed, Windows uses temporary credential storage and FreeRDP uses standard input, so passwords never enter the command line."
      )
    };
  }

  function spawnDetached(executable, args) {
    return new Promise((resolve, reject) => {
      // GUI clients such as mstsc inherit STARTF_USESHOWWINDOW on Windows. Passing
      // windowsHide here leaves the client running without a visible window.
      const child = runtimeSpawn(executable, args, {detached:true, stdio:"ignore"});
      child.once("spawn", () => { child.unref?.(); resolve(null); });
      child.once("error", reject);
    });
  }

  function readableLaunchError(stderr, executable, code) {
    const text = String(stderr || "").replace(/\x1b\[[0-9;]*m/g, "");
    if (/failed to open display|cannot open display/i.test(text)) {
      return desktopUiText(
        getLanguage(),
        "FreeRDP 无法连接当前 Linux 图形桌面（DISPLAY 不可用），请从桌面会话启动 Terma",
        "FreeRDP cannot connect to the current Linux graphical desktop because DISPLAY is unavailable. Start Terma from the desktop session."
      );
    }
    if (/certificate name mismatch/i.test(text)) {
      return desktopUiText(
        getLanguage(),
        "RDP 证书名称与连接地址不一致，请在 FreeRDP 证书提示中确认后重试",
        "The RDP certificate name does not match the connection address. Confirm the FreeRDP certificate prompt and try again."
      );
    }
    if (/authentication failure|logon failure|ERRCONNECT_LOGON_FAILURE/i.test(text)) {
      return desktopUiText(
        getLanguage(),
        "RDP 登录失败，请检查桌面账号、密码和域",
        "RDP sign-in failed. Check the desktop username, password, and domain."
      );
    }
    const useful = text.split(/\r?\n/)
      .map(line => line.replace(/^\[[^\]]+\]\s*(?:\[[^\]]+\]\s*)*/, "").trim())
      .filter(line => line && !/^\d+:\s/.test(line) && !/Caught signal|winpr_log_backtrace|lib(?:winpr|freerdp)|__libc_start_main|\(_start\+/i.test(line));
    const original = useful.slice(-4).join(desktopUiText(getLanguage(), "；", "; "));
    return original || desktopUiText(
      getLanguage(),
      `${clientPath.basename(executable)} 启动后立即退出（代码 ${code ?? "未知"}）`,
      `${clientPath.basename(executable)} exited immediately after launch (code ${code ?? "unknown"})`
    );
  }

  function spawnObserved(executable, args, input = "") {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stderr = "";
      let timer = null;
      const secretInput = input ? Buffer.from(String(input), "utf8") : null;
      const clearSecretInput = () => { if (secretInput) secretInput.fill(0); };
      const child = runtimeSpawn(executable, args, {
        detached:true,
        stdio:[secretInput ? "pipe" : "ignore", "ignore", "pipe"],
        env:environment
      });
      const finish = (error=null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else {
          child.unref?.();
          resolve({pid:child.pid || 0});
        }
      };
      child.stderr?.on?.("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      child.once("spawn", () => {
        if (secretInput && child.stdin) {
          child.stdin.once("error", clearSecretInput);
          child.stdin.end(secretInput, clearSecretInput);
        }
        timer = setTimeout(() => finish(), startupProbeMs);
      });
      child.once("error", error => {
        clearSecretInput();
        finish(error);
      });
      child.once("close", code => {
        clearSecretInput();
        if (!settled) finish(code === 0 ? null : new Error(readableLaunchError(stderr, executable, code)));
      });
    });
  }

  function temporaryDirectory() {
    const directory = path.join(getDataDir(), "remote-client");
    fs.mkdirSync(directory, {recursive:true});
    return directory;
  }

  function cacheInfo() {
    if (platform !== "darwin") return {bytes:0, files:0, reclaimable_bytes:0, reclaimable_files:0, busy:false};
    const file = clientPath.join(getDataDir(), "remote-client", "WindowsApp.pkg");
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return {bytes:0, files:0, reclaimable_bytes:0, reclaimable_files:0, busy:false};
      return {bytes:stat.size, files:1, reclaimable_bytes:stat.size, reclaimable_files:1, busy:false};
    } catch {
      return {bytes:0, files:0, reclaimable_bytes:0, reclaimable_files:0, busy:false};
    }
  }

  function clearCache() {
    if (platform !== "darwin") return cacheInfo();
    const directory = clientPath.join(getDataDir(), "remote-client");
    const file = clientPath.join(directory, "WindowsApp.pkg");
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink()) fs.rmSync(file, {force:true});
    } catch {}
    try { fs.rmdirSync(directory); } catch {}
    return cacheInfo();
  }

  function verifyMacWindowsAppPackage(file) {
    if (platform !== "darwin" || !file || !existsSync(file)) throw new Error(text("Windows App 安装包不存在", "The Windows App installer package was not found"));
    const bytes = fs.statSync(file).size;
    if (bytes < 1024 * 1024) throw new Error(text("Windows App 安装包内容不完整", "The Windows App installer package is incomplete"));
    const signature = runtimeSpawnSync("/usr/sbin/pkgutil", ["--check-signature", file], {
      encoding:"utf8",
      timeout:15000,
      windowsHide:true
    });
    const signatureText = `${signature.stdout || ""}\n${signature.stderr || ""}`;
    if (signature.status !== 0 || !/Microsoft Corporation/i.test(signatureText) || !/Notarization:\s*trusted/i.test(signatureText)) {
      throw new Error(text("Windows App 安装包不是受信任的 Microsoft 签名包", "The Windows App installer package does not have a trusted Microsoft signature"));
    }
    return {bytes};
  }

  function localMacWindowsAppPackages() {
    const home = environment.HOME || "";
    const downloads = home ? clientPath.join(home, "Downloads") : "";
    return [
      clientPath.join(temporaryDirectory(), "WindowsApp.pkg"),
      downloads ? clientPath.join(downloads, "WindowsApp.pkg") : "",
      downloads ? clientPath.join(downloads, "Windows App.pkg") : ""
    ].filter(Boolean);
  }

  function findVerifiedMacWindowsAppPackage() {
    for (const file of localMacWindowsAppPackages()) {
      try {
        verifyMacWindowsAppPackage(file);
        return file;
      } catch {}
    }
    return "";
  }

  async function downloadMacWindowsAppPackage() {
    if (typeof runtimeFetch !== "function") throw new Error(text("当前运行环境不能下载 Windows App 安装包", "The current runtime cannot download the Windows App installer package"));
    const file = localMacWindowsAppPackages()[0];
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      const response = await runtimeFetch(MAC_WINDOWS_APP_PACKAGE_URL, {
        headers:{"User-Agent":"Terma-Windows-App-Installer"},
        redirect:"follow"
      });
      if (!response?.ok || !response.body) throw new Error(text(
        `Windows App 下载失败：HTTP ${response?.status || "未知"}`,
        `Windows App download failed: HTTP ${response?.status || "unknown"}`
      ));
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, {flags:"wx"}));
      verifyMacWindowsAppPackage(temporary);
      fs.renameSync(temporary, file);
      return file;
    } finally {
      try { fs.rmSync(temporary, {force:true}); } catch {}
    }
  }

  async function installMacWindowsAppPackage(file) {
    verifyMacWindowsAppPackage(file);
    const command = `/usr/sbin/installer -pkg ${JSON.stringify(file)} -target /`;
    await new Promise((resolve, reject) => {
      const child = runtimeSpawn("/usr/bin/osascript", ["-e", `do shell script ${JSON.stringify(command)} with administrator privileges`], {
        stdio:["ignore", "pipe", "pipe"],
        windowsHide:true
      });
      let stderr = "";
      child.stderr?.on?.("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve(null) : reject(new Error(stderr.trim() || text(
        "Windows App 安装被取消或失败",
        "Windows App installation was cancelled or failed"
      ))));
    });
  }

  function writeRdpFile(profile, fileOptions = {}) {
    const value = profile.options || {};
    const safeRdpValue = (input, label) => {
      const safeText = String(input ?? "");
      if (/[\0\r\n]/.test(safeText)) throw new Error(`${label}${text("不能包含换行或控制字符", " must not contain line breaks or control characters")}`);
      return safeText;
    };
    const displayMode = rdpDisplayMode(value);
    const {width, height} = remoteDesktopSize(value);
    const audioMode = value.audio === "remote" ? 1 : value.audio === "off" ? 2 : 0;
    const lines = [
      `full address:s:${endpoint(profile.host, Number(profile.port || 3389))}`,
      ...(fileOptions.omitUsername ? [] : [`username:s:${safeRdpValue(profile.username || "", text("RDP 用户名", "RDP username"))}`]),
      `domain:s:${safeRdpValue(value.domain || "", text("RDP 域", "RDP domain"))}`,
      `screen mode id:i:${displayMode === "fullscreen" ? 2 : 1}`,
      `desktopwidth:i:${width}`,
      `desktopheight:i:${height}`,
      `dynamic resolution:i:${displayMode === "dynamic" ? 1 : 0}`,
      `smart sizing:i:${displayMode === "dynamic" ? 1 : 0}`,
      `administrative session:i:${value.admin_session ? 1 : 0}`,
      `redirectclipboard:i:${value.clipboard === false ? 0 : 1}`,
      `audiomode:i:${audioMode}`,
      `prompt for credentials:i:${fileOptions.promptForCredentials === false ? 0 : 1}`,
      "authentication level:i:2"
    ];
    const file = path.join(temporaryDirectory(), `terma-${Number(profile.id)}-${Date.now()}.rdp`);
    fs.writeFileSync(file, `\uFEFF${lines.join("\r\n")}\r\n`, "utf16le");
    setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 10 * 60 * 1000).unref?.();
    return file;
  }

  async function openRdp(profile, item) {
    if (!item.available) throw new Error(item.reason || (platform === "darwin"
      ? text("未找到 Windows App 或 Microsoft Remote Desktop", "Windows App or Microsoft Remote Desktop was not found")
      : text("未找到可用的 RDP 客户端", "No usable RDP client was found")));
    const value = profile.options || {};
    const displayMode = rdpDisplayMode(value);
    const {width, height} = remoteDesktopSize(value);
    const password = String(profile.password || "");
    const passwordTransferRequested = Boolean(value.allow_password_transfer && password);
    let selectedItem = item;
    let transferMode = "";
    if (platform === "darwin" && item.mode === "rdp-file" && passwordTransferRequested) {
      if (!item.password_transfer_supported || !item.password_transfer_executable) {
        throw new Error(text(
          "macOS Windows App 没有可用的密码预填充接口。请安装 FreeRDP 与 XQuartz，或关闭“允许传递密码”后由 Windows App 输入凭据",
          "Windows App on macOS has no password prefill interface. Install FreeRDP and XQuartz, or turn off ‘Allow password transfer’ and enter credentials in Windows App."
        ));
      }
      selectedItem = {
        ...item,
        available:true,
        client:item.password_transfer_client || clientPath.basename(item.password_transfer_executable),
        executable:item.password_transfer_executable,
        mode:"freerdp",
        application:""
      };
    }
    if (passwordTransferRequested && !String(profile.username || "")) throw new Error(text("传递 RDP 密码时必须填写用户名", "A username is required when transferring the RDP password"));
    const omitGeneratedUsername = Number(value.source_ssh_connection_id || 0) > 0 && !String(profile.username || "");
    if (platform === "win32" && passwordTransferRequested) {
      const rdpEndpoint = endpoint(profile.host, Number(profile.port || 3389));
      const rdpFile = writeRdpFile(profile, {omitUsername:omitGeneratedUsername, promptForCredentials:false});
      await runtimeWindowsRdpCredentialLaunch({
        spawn:runtimeSpawn,
        environment,
        executable:selectedItem.executable,
        rdpFile,
        endpoint:rdpEndpoint,
        username:String(profile.username || ""),
        password
      });
      transferMode = "windows-credential-manager";
    } else if (platform === "win32" && omitGeneratedUsername) {
      // SSH-derived RDP entries should behave like typing the host into mstsc.
      // Reusing an SSH username here can select the wrong desktop account, but
      // the generated RDP file is still required for the selected display mode.
      await spawnDetached(selectedItem.executable, [writeRdpFile(profile, {omitUsername:true})]);
    } else if (platform === "win32") await spawnDetached(selectedItem.executable, [writeRdpFile(profile)]);
    else if (platform === "darwin" && selectedItem.mode === "rdp-file") await spawnDetached("/usr/bin/open", ["-a", selectedItem.application, writeRdpFile(profile)]);
    else if (selectedItem.mode === "remmina") {
      if (passwordTransferRequested) throw new Error(text(
        "当前 Remmina 启动方式不能安全接收已保存密码；请安装 FreeRDP，或关闭“允许传递密码”后由客户端输入凭据",
        "The current Remmina launch mode cannot safely receive a saved password. Install FreeRDP, or turn off ‘Allow password transfer’ and enter credentials in the client."
      ));
      const user = profile.username ? `${encodeURIComponent(profile.username)}@` : "";
      await spawnObserved(selectedItem.executable, ["-c", `rdp://${user}${endpoint(profile.host, Number(profile.port || 3389))}`]);
    } else {
      const args = [`/v:${endpoint(profile.host, Number(profile.port || 3389))}`];
      if (profile.username) args.push(`/u:${profile.username}`);
      if (value.domain) args.push(`/d:${value.domain}`);
      if (displayMode === "fullscreen") args.push("/f");
      else {
        args.push(`/size:${width}x${height}`);
        if (displayMode === "dynamic") args.push("/dynamic-resolution");
      }
      if (value.clipboard !== false) args.push("+clipboard");
      if (value.admin_session) args.push("/admin");
      args.push(`/audio-mode:${value.audio === "remote" ? 1 : value.audio === "off" ? 2 : 0}`);
      args.push("/cert:tofu");
      if (passwordTransferRequested && /[\0\r\n]/.test(password)) throw new Error(text(
        "该 RDP 密码包含换行或控制字符，不能通过 FreeRDP 标准输入传递",
        "This RDP password contains line breaks or control characters and cannot be passed through FreeRDP standard input"
      ));
      const stdinPassword = passwordTransferRequested ? `${password}\n` : "";
      if (stdinPassword) args.push("/from-stdin");
      await spawnObserved(selectedItem.executable, args, stdinPassword);
      if (stdinPassword) transferMode = "stdin";
    }
    return {
      ok:true,
      protocol:"rdp",
      client:selectedItem.client,
      credentials:transferMode || "prompt",
      password_transfer_requested:passwordTransferRequested,
      password_transfer_supported:Boolean(transferMode),
      startup_checked:platform !== "win32" && selectedItem.mode !== "rdp-file"
    };
  }

  async function openVnc(profile, item) {
    if (!item.available) throw new Error(text("未找到可用的 VNC 客户端", "No usable VNC client was found"));
    const value = profile.options || {};
    const port = Number(profile.port || 5900);
    const uri = `vnc://${endpoint(profile.host, port)}`;
    if (item.mode === "uri") {
      if (!runtimeShell?.openExternal) throw new Error(text("当前桌面环境不能打开 VNC 链接", "The current desktop environment cannot open VNC links"));
      await runtimeShell.openExternal(uri);
    } else if (item.mode === "application") await spawnDetached("/usr/bin/open", ["-a", item.application, uri]);
    else if (item.mode === "remmina") await spawnDetached(item.executable, ["-c", uri]);
    else if (item.mode === "gvncviewer") await spawnDetached(item.executable, [endpoint(profile.host, port)]);
    else if (item.mode === "tightvnc") await spawnDetached(item.executable, [`-host=${normalizeHost(profile.host)}`, `-port=${port}`]);
    else if (item.mode === "tigervnc") {
      const host = normalizeHost(profile.host);
      const args = [`${net.isIP(host) === 6 ? `[${host}]` : host}::${port}`, `-QualityLevel=${Number(value.quality ?? 8)}`];
      if (value.shared) args.push("-Shared");
      if (value.view_only) args.push("-ViewOnly");
      await spawnDetached(item.executable, args);
    }
    else if (item.mode === "realvnc") {
      // RealVNC Viewer does not accept TigerVNC-only switches. Its portable
      // target syntax is HOST::PORT.
      const host = normalizeHost(profile.host);
      await spawnDetached(item.executable, [`${net.isIP(host) === 6 ? `[${host}]` : host}::${port}`]);
    } else {
      const host = normalizeHost(profile.host);
      // Unknown VNC clients are intentionally launched with the portable
      // endpoint only. Client-specific switches can make a valid viewer fail
      // before it opens, so only an explicitly identified TigerVNC receives
      // TigerVNC flags above.
      await spawnDetached(item.executable, [`${net.isIP(host) === 6 ? `[${host}]` : host}::${port}`]);
    }
    return {ok:true, protocol:"vnc", client:item.client, credentials:"prompt"};
  }

  async function open(profile = {}) {
    if (!["rdp", "vnc"].includes(String(profile.protocol || ""))) throw new Error(text("仅 RDP/VNC 使用系统远程桌面客户端", "The system remote-desktop client supports RDP and VNC only"));
    const host = normalizeHost(profile.host);
    const port = Number(profile.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(text("远程桌面目标无效", "The remote-desktop target is invalid"));
    const state = diagnostics();
    return profile.protocol === "rdp" ? openRdp(profile, state.rdp) : openVnc(profile, state.vnc);
  }

  async function install(protocol) {
    if (protocol !== "rdp") throw new Error(text("当前只支持安装 RDP 客户端", "Only RDP client installation is supported here"));
    if (platform !== "darwin") throw new Error(text("当前平台没有可由此入口安装的 RDP 客户端", "This platform has no RDP client that can be installed from this entry point"));
    const current = diagnostics();
    if (current.rdp.application) return {ok:true, protocol, already_installed:true, client:current.rdp.client};
    let installer = findVerifiedMacWindowsAppPackage();
    let downloaded = false;
    if (!installer) {
      try {
        installer = await downloadMacWindowsAppPackage();
        downloaded = true;
      } catch (error) {
        if (!runtimeShell?.openExternal) throw error;
        await runtimeShell.openExternal(MAC_WINDOWS_APP_URL);
        return {ok:true, protocol, opened:true, target:"Mac App Store", fallback:true, message:error.message, restart_required:false};
      }
    }
    await installMacWindowsAppPackage(installer);
    const installed = diagnostics();
    if (!installed.rdp.application) throw new Error(text("安装命令已完成，但没有检测到 Windows App", "Installation completed, but Windows App was not detected"));
    return {ok:true, protocol, client:installed.rdp.client, offline:!downloaded, cached_package:true, restart_required:false};
  }

  return {cacheInfo, clearCache, diagnostics, findExecutable, install, open, validateVncClientPath, writeRdpFile};
}

module.exports = {MAC_WINDOWS_APP_PACKAGE_URL, MAC_WINDOWS_APP_URL, createRemoteClientAdapter};
