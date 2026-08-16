const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const iconv = require("iconv-lite");
const { buildRemotePosixCommand } = require("./remote-posix");
const { publicError, publicErrorDetails, remoteOutputError } = require("./public-error");
const {
  aptPrintUrisUsesOnlyCachedPackages,
  aptOutputNeedsLocalResolution,
  buildAptCachedInstallCommand,
  buildAptPrintUrisCommand,
  buildAptOfflineInstallCommand,
  buildAptOfflinePreflightCommand,
  buildAptPlatformProbeCommand,
  downloadAptBundle,
  parseAptPlatformProbe,
  parseAptPrintUris,
  normalizeAptPackages,
  resolveAptPackagesFromOfficialRepositories,
  shouldUseAptRepositoryFallback
} = require("./remote-offline-installer");

function now() { return Date.now(); }

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

const TASK_LOG_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function normalizeTaskLogEncoding(value) {
  const aliases = {
    "utf-8":"utf8",
    "gb-18030":"gb18030",
    gb2312:"gbk",
    cp936:"gbk",
    "shift-jis":"shift_jis",
    sjis:"shift_jis",
    euckr:"euc-kr",
    "iso-8859-1":"latin1"
  };
  const requested = String(value || "utf8").trim().toLowerCase();
  const normalized = aliases[requested] || requested;
  return TASK_LOG_ENCODINGS.has(normalized) && iconv.encodingExists(normalized) ? normalized : "utf8";
}

function packageCandidateSets(packages, alternatives=[]) {
  const MAX_CANDIDATE_SETS = 64;
  const slots = packages.map((packageName, index) => {
    const values = Array.isArray(alternatives?.[index]) ? alternatives[index] : [];
    return [...new Set([packageName, ...values].map(value => String(value || "").trim()).filter(Boolean))];
  });
  return slots.reduce((sets, choices) => {
    const next = [];
    for (const prefix of sets) {
      for (const choice of choices) {
        next.push([...prefix, choice]);
        if (next.length >= MAX_CANDIDATE_SETS) return next;
      }
    }
    return next;
  }, [[]]);
}

function aptPlatformSatisfiesPackages(platform, packages) {
  const installed = platform?.installed instanceof Set ? platform.installed : new Set(platform?.installed || []);
  const provided = platform?.provided instanceof Set ? platform.provided : new Set(platform?.provided || []);
  return packages.every(value => {
    const packageName = String(value || "").replace(/:[a-z0-9-]+$/i, "");
    return installed.has(packageName) || provided.has(packageName);
  });
}

const ACTION_LABELS = {
  install:"在线安装",
  "install-offline":"使用远端缓存安装",
  "install-local-offline":"本机下载后离线安装",
  uninstall:"卸载",
  start:"启动",
  stop:"停止",
  enable:"启用并启动",
  disable:"停止并禁用",
  restart:"重新启动",
  configure:"配置"
};

const REMOTE_TASK_STAGE_KEYS = new Set([
  "prepare",
  "download",
  "upload",
  "install",
  "configure",
  "execute",
  "verify"
]);

function normalizedTaskLocaleKey(value, fallback = "remote-component") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function taskCurrentKey(task) {
  if (task.status === "done") return "done";
  if (task.status === "failed") return "failed";
  if (task.status === "cancelled") return "cancelled";
  const stage = String(task.stage || "").trim().toLowerCase();
  return REMOTE_TASK_STAGE_KEYS.has(stage) ? stage : "running";
}

function taskFailureDetails(error, fallbackCode = "remote_component_operation_failed") {
  const source = error && typeof error === "object" ? error : null;
  const hasExplicitPublicCode = Boolean(
    source?.publicCode
    || source?.public_code
    || source?.errorCode
    || source?.error_code
  );
  const details = publicErrorDetails(error, fallbackCode);
  return {
    code:details.code,
    params:details.params,
    preserveMessage:details.preserveMessage && hasExplicitPublicCode
  };
}

function failTask(task, error, fallbackCode = "remote_component_operation_failed") {
  const message = String(error?.message || error || "远端组件操作失败").trim();
  const details = taskFailureDetails(error, fallbackCode);
  task.status = "failed";
  task.error = message;
  task.error_code = details.code;
  task.error_params = details.params;
  task.preserve_error_message = details.preserveMessage;
  task.current = "操作失败";
}

function actionLabel(action, fallback = "") {
  return String(fallback || ACTION_LABELS[String(action || "")] || action || "远端操作");
}

function taskView(task) {
  return {
    id:task.id,
    type:"remote-component",
    component:task.component,
    component_label:task.component_label,
    component_key:normalizedTaskLocaleKey(task.component),
    action:task.action,
    action_label:task.action_label,
    action_key:normalizedTaskLocaleKey(task.action, "configure"),
    mode:task.mode || "",
    resource_key:task.resource_key || "",
    resource_keys:[...(task.resource_keys || (task.resource_key ? [task.resource_key] : []))],
    connection_id:task.connection_id,
    connection_name:task.connection_name,
    status:task.status,
    stage:task.stage,
    progress:Number(task.progress || 0),
    progress_unit:"percent",
    progress_known:true,
    current:task.current || "",
    current_key:taskCurrentKey(task),
    current_params:task.current_params || {},
    logs:task.logs.slice(-300),
    error:task.error || "",
    error_code:task.error_code || "",
    error_params:task.error_params || {},
    preserve_error_message:task.preserve_error_message === true,
    created_at:task.created_at,
    updated_at:task.updated_at,
    finished_at:task.finished_at || 0,
    before:task.before || null,
    after:task.after || null,
    can_cancel:false,
    can_pause:false
  };
}

function createRemoteOfflineTaskManager(dependencies: any = {}) {
  const tasks = new Map();
  const activeLocalDirectories = new Set();
  let sequence = 0;
  const dataDir = String(dependencies.data_dir || process.cwd());

  function cacheEntryPaths() {
    const root = path.resolve(dataDir);
    try {
      return fs.readdirSync(root, {withFileTypes:true})
        .filter(entry => /^remote-component-\d+-\d+-\d+$/.test(entry.name))
        .map(entry => path.resolve(root, entry.name))
        .filter(target => path.dirname(target) === root);
    } catch {
      return [];
    }
  }

  function treeStats(target) {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return {bytes:stat.size, files:1};
      return fs.readdirSync(target).reduce((total, name) => {
        const child = treeStats(path.join(target, name));
        total.bytes += child.bytes;
        total.files += child.files;
        return total;
      }, {bytes:0, files:0});
    } catch {
      return {bytes:0, files:0};
    }
  }

  function cacheInfo() {
    let bytes = 0;
    let files = 0;
    let reclaimableBytes = 0;
    let reclaimableFiles = 0;
    for (const target of cacheEntryPaths()) {
      const stats = treeStats(target);
      bytes += stats.bytes;
      files += stats.files;
      if (!activeLocalDirectories.has(target)) {
        reclaimableBytes += stats.bytes;
        reclaimableFiles += stats.files;
      }
    }
    return {
      bytes,
      files,
      reclaimable_bytes:reclaimableBytes,
      reclaimable_files:reclaimableFiles,
      busy:activeLocalDirectories.size > 0
    };
  }

  function clearCache() {
    for (const target of cacheEntryPaths()) {
      if (activeLocalDirectories.has(target)) continue;
      fs.rmSync(target, {recursive:true, force:true});
    }
    return cacheInfo();
  }

  function append(task, text, stream = "system") {
    const value = String(text || "").trim();
    if (!value) return;
    task.logs.push({at:now(), stream, text:value});
    if (task.logs.length > 400) task.logs.splice(0, task.logs.length - 400);
    task.updated_at = now();
  }

  function appendDecodedText(task, text, stream = "stdout") {
    const key = String(stream || "stdout");
    const partial = `${task.log_partials.get(key) || ""}${String(text || "")}`;
    const lines = partial.split(/\r?\n/);
    task.log_partials.set(key, lines.pop() || "");
    for (const line of lines) append(task, line, stream);
    if (task.stage === "execute" && task.progress < 88) {
      task.progress = Math.min(88, task.progress + Math.max(1, Math.min(4, lines.length)));
      task.updated_at = now();
    }
  }

  function appendChunk(task, chunk, stream = "stdout") {
    const key = String(stream || "stdout");
    if (typeof chunk === "string") {
      appendDecodedText(task, chunk, key);
      return;
    }
    let decoder = task.log_decoders.get(key);
    if (!decoder) {
      decoder = iconv.getDecoder(task.log_encoding);
      task.log_decoders.set(key, decoder);
    }
    appendDecodedText(task, decoder.write(Buffer.from(chunk || "")), key);
  }

  function flushTaskLogs(task) {
    for (const [stream, decoder] of task.log_decoders.entries()) {
      appendDecodedText(task, decoder.end(), stream);
    }
    task.log_decoders.clear();
    for (const [stream, partial] of task.log_partials.entries()) {
      if (partial) append(task, partial, stream);
    }
    task.log_partials.clear();
  }

  function update(task, stage, progress, current = "") {
    task.stage = stage;
    task.progress = Math.max(0, Math.min(99, Number(progress || 0)));
    task.current = String(current || "");
    task.updated_at = now();
  }

  async function waitUpload(id, task, label, offset, total) {
    const deadline = now() + 30 * 60 * 1000;
    while (now() < deadline) {
      const jobs = await Promise.resolve(dependencies.list_sftp_jobs?.() || []);
      const job = jobs.find(item => String(item.id) === String(id));
      if (!job) throw new Error(`SFTP 上传任务不存在：${label}`);
      const transferred = Math.max(0, Number(job.transferred || 0));
      const size = Math.max(1, Number(total || job.size || 1));
      update(task, "upload", 55 + Math.min(30, (offset + transferred) / Math.max(1, total) * 30), `正在上传 ${label}`);
      if (["done"].includes(job.status)) return;
      if (["failed", "cancelled"].includes(job.status)) throw new Error(job.error || `${label} 上传失败`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`上传 ${label} 超时`);
  }

  function list() {
    return [...tasks.values()].map(taskView).sort((a,b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  }

  function remove(id) {
    const task = tasks.get(String(id || ""));
    if (!task) return false;
    if (task.status === "running") throw new Error("运行中的离线安装任务不能删除");
    tasks.delete(task.id);
    return true;
  }

  function clearFinished() {
    let removed = 0;
    for (const task of tasks.values()) {
      if (!["done", "cancelled"].includes(task.status)) continue;
      tasks.delete(task.id);
      removed += 1;
    }
    return {removed};
  }

  function normalizedResourceKeys(primaryKey, extraKeys = []) {
    return [...new Set([primaryKey, ...(Array.isArray(extraKeys) ? extraKeys : [])]
      .map(value => String(value || "").trim())
      .filter(Boolean))];
  }

  function packageManagerResourceKey(connection) {
    return `package-manager:${Number(connection?.id || 0)}`;
  }

  function assertResourcesAvailable(resourceKeys, componentLabel="远端组件") {
    const requested = new Set(normalizedResourceKeys("", resourceKeys));
    if (!requested.size) return;
    const running = [...tasks.values()].find(task => {
      if (task.status !== "running") return false;
      const occupied = normalizedResourceKeys(task.resource_key, task.resource_keys);
      return occupied.some(key => requested.has(key));
    });
    if (!running) return;
    const error: any = publicError(
      "REMOTE_TASK_CONFLICT",
      `${componentLabel}已有“${running.action_label || "管理"}”任务正在执行，请等待完成后再试`,
      {},
      409
    );
    error.task = taskView(running);
    throw error;
  }

  function startAptInstall(options: any = {}) {
    const connection = options.connection;
    if (!connection) throw new Error("离线安装缺少 SSH 管理连接");
    const resourceKey = String(options.resource_key || `remote-component:${Number(connection.id || 0)}:${String(options.component || "remote-component")}`).trim();
    const resourceKeys = normalizedResourceKeys(resourceKey, [
      ...(Array.isArray(options.resource_keys) ? options.resource_keys : []),
      packageManagerResourceKey(connection)
    ]);
    assertResourcesAvailable(resourceKeys, options.component_label);
    let packages = normalizeAptPackages(options.packages);
    const requestedPackages = [...packages];
    const task = {
      id:`remote-component-${now()}-${++sequence}`,
      component:String(options.component || "remote-component"),
      component_label:String(options.component_label || "远端组件"),
      action:String(options.action || "install-local-offline"),
      action_label:actionLabel(options.action || "install-local-offline", options.action_label),
      mode:"local-offline",
      resource_key:resourceKey,
      resource_keys:resourceKeys,
      connection_id:Number(connection.id || 0),
      connection_name:String(connection.name || connection.ssh_host || ""),
      status:"running",
      stage:"prepare",
      progress:3,
      current:"正在读取远端软件包清单",
      logs:[],
      error:"",
      created_at:now(),
      updated_at:now(),
      finished_at:0,
      grant_id:String(options.grant?.id || ""),
      before:options.before || null,
      after:null,
      log_encoding:normalizeTaskLogEncoding(connection.terminal_encoding),
      log_decoders:new Map(),
      log_partials:new Map()
    };
    tasks.set(task.id, task);
    append(task, `开始本机离线安装：${task.component_label}（${packages.join(", ")}）`);
    void (async () => {
      let localDirectory = "";
      let remoteDirectory = `/tmp/terma-offline-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      try {
        let probe = null;
        let probeOutput = "";
        let usedLocalRepository = false;
        let platform = null;
        let packagesAlreadySatisfied = false;
        const candidateSets = packageCandidateSets(requestedPackages, options.package_alternatives);
        const onChunk = (chunk, stream) => appendChunk(task, chunk, stream || "stdout");
        const runAfterInstall = async () => {
          if (typeof options.after_install !== "function") return;
          update(task, "configure", 91, String(options.configure_label || "正在应用服务配置"));
          const configured = await options.after_install(onChunk);
          flushTaskLogs(task);
          if (configured?.status !== 0) {
            throw remoteOutputError(`${configured?.stderr || configured?.stdout || configured?.error?.message || "远端服务配置失败"}`.trim());
          }
        };
        const completeAfterVerification = async (readyLog, doneLog) => {
          await runAfterInstall();
          update(task, "verify", 96, "正在验证安装结果");
          append(task, readyLog);
          if (typeof options.verify === "function") task.after = await options.verify();
          if (typeof options.validate === "function") {
            const validation = await options.validate(task.after);
            if (validation === false) {
              throw publicError("REMOTE_COMPONENT_VERIFICATION_FAILED", `${task.component_label}安装命令已结束，但状态验证未通过`);
            }
            if (typeof validation === "string" && validation) {
              throw publicError("REMOTE_COMPONENT_VERIFICATION_FAILED", validation);
            }
          }
          task.status = "done";
          task.progress = 100;
          task.stage = "done";
          task.current = "已完成";
          append(task, doneLog);
        };
        const completeIfPackagesAlreadySatisfied = async () => {
          if (!packagesAlreadySatisfied) return false;
          await completeAfterVerification(
            `远端已安装的软件包已满足本次请求（${packages.join(", ")}），跳过下载、上传和重复安装`,
            "现有安装状态验证通过"
          );
          return true;
        };
        const resolveWithLocalRepository = async (reason = "") => {
          usedLocalRepository = true;
          append(task, reason ? `${reason}；将由本机刷新匹配的软件包索引` : "远端 APT 索引不可用，正在由本机刷新匹配的软件包索引", "warning");
          update(task, "prepare", 6, "正在识别远端发行版、架构和已安装依赖");
          const platformResult = await dependencies.run_ssh_command(connection, buildRemotePosixCommand(buildAptPlatformProbeCommand()), 60000);
          const platformOutput = `${platformResult?.stdout || ""}${platformResult?.stderr || ""}`;
          if (platformResult?.status !== 0) throw new Error(platformOutput.trim() || "无法识别远端 APT 平台");
          platform = parseAptPlatformProbe(platformOutput);
          if (!platform?.codename || !platform?.arch) {
            throw new Error("已识别到远端使用 APT，但无法确定发行版代号或 CPU 架构；请改用在线安装或手动导入匹配的软件包");
          }
          update(task, "prepare", 8, `正在本机读取 ${platform.os_id || "Debian/Ubuntu"} ${platform.codename} ${platform.arch} 软件包索引`);
          const resolver = dependencies.resolve_apt_packages || resolveAptPackagesFromOfficialRepositories;
          let resolved = null;
          let lastResolveError = null;
          for (const candidate of candidateSets) {
            try {
              const next = await resolver(candidate, platform, {
                onIndex(index) { task.current = `正在读取 ${index.component} 软件包索引`; task.updated_at = now(); }
              });
              if (Array.isArray(next) && next.length) {
                resolved = next;
                packages = candidate;
                if (candidate.join("\n") !== requestedPackages.join("\n")) append(task, `本机索引已切换可用候选：${candidate.join(", ")}`, "warning");
                break;
              }
              if (Array.isArray(next) && !next.length && aptPlatformSatisfiesPackages(platform, candidate)) {
                resolved = [];
                packages = candidate;
                packagesAlreadySatisfied = true;
                break;
              }
            } catch (error) {
              lastResolveError = error;
            }
          }
          if (packagesAlreadySatisfied) return [];
          if (!Array.isArray(resolved) || !resolved.length) {
            throw lastResolveError || new Error("本机官方软件源索引没有解析出可安装的软件包");
          }
          append(task, `本机软件源索引已解析 ${resolved.length} 个待安装软件包`);
          return resolved;
        };
        for (const candidate of candidateSets) {
          const currentProbe = await dependencies.run_ssh_command(connection, buildRemotePosixCommand(buildAptPrintUrisCommand(candidate)), 60000);
          const currentOutput = `${currentProbe?.stdout || ""}${currentProbe?.stderr || ""}`;
          probe = currentProbe;
          probeOutput = currentOutput;
          if (currentProbe?.status === 0) {
            packages = candidate;
            if (candidate.join("\n") !== requestedPackages.join("\n")) append(task, `远端没有完整提供首选软件包，已切换可用候选：${candidate.join(", ")}`, "warning");
            break;
          }
        }
        let items = null;
        let parseError = null;
        if (probe?.status === 0) {
          try { items = parseAptPrintUris(probeOutput); }
          catch (error) { parseError = error; }
        }
        if (!items?.length && probe?.status === 0 && aptPrintUrisUsesOnlyCachedPackages(probeOutput)) {
          append(task, "远端 APT 缓存已包含本次安装所需的全部软件包，将直接使用缓存继续，不再联网解析或重复上传", "warning");
          update(task, "install", 86, "正在使用远端 APT 缓存安装");
          const cachedInstallCommand = buildAptCachedInstallCommand(packages);
          const usePrivilege = Boolean(options.grant || (options.elevate && !options.direct_root));
          const cachedResult = usePrivilege
            ? await dependencies.run_privileged_stream(connection, cachedInstallCommand, {grant_id:options.grant?.id, scope:options.scope || `remote-component.${task.component}`, timeout_ms:20 * 60 * 1000}, onChunk)
            : await dependencies.run_ssh_stream(connection, buildRemotePosixCommand(cachedInstallCommand), 20 * 60 * 1000, onChunk);
          flushTaskLogs(task);
          if (cachedResult?.status !== 0) throw new Error(`${cachedResult?.stderr || cachedResult?.stdout || cachedResult?.error?.message || "远端缓存安装失败"}`.trim());
          await completeAfterVerification("远端缓存软件包安装命令已完成", "远端缓存安装完成");
          return;
        }
        if (!items?.length && (parseError || shouldUseAptRepositoryFallback(probeOutput))) {
          const reason = parseError
            ? `远端 APT 没有提供完整的下载清单（${parseError.message || "清单不可用"}），正在自动切换本机索引`
            : "远端 APT 索引过期、镜像不可达或软件包不可下载，正在自动切换本机官方索引";
          items = await resolveWithLocalRepository(reason);
        }
        if (await completeIfPackagesAlreadySatisfied()) return;
        if (!items?.length) {
          const detail = probeOutput.trim() || parseError?.message || "远端 apt 无法解析软件包依赖";
          throw new Error(`${detail}\nTerma 未能安全切换本机索引；请检查远端发行版信息，或改用在线安装/手动安装说明`);
        }
        const downloadAndUpload = async (resolvedItems, attempt = 1) => {
          const totalBytes = resolvedItems.reduce((sum, item) => sum + Math.max(0, Number(item.size || 0)), 0);
          append(task, `${usedLocalRepository ? "本机索引" : "远端清单"}返回 ${resolvedItems.length} 个软件包，合计约 ${Math.ceil(totalBytes / 1024)} KiB`);
          update(task, "download", 12, attempt > 1 ? "正在重新下载完整软件包依赖" : "正在本机下载软件包和依赖");
          // The caller passes the component cache root (already named
          // `remote-components`); keep each attempt directly below it.
          if (localDirectory) {
            activeLocalDirectories.delete(localDirectory);
            fs.rmSync(localDirectory, {recursive:true, force:true});
          }
          localDirectory = path.resolve(path.join(dataDir, `${task.id}-${attempt}`));
          activeLocalDirectories.add(localDirectory);
          const progressByFile = new Map();
          const bundle = await (dependencies.download_apt_bundle || downloadAptBundle)(resolvedItems, {
            directory:localDirectory,
            onProgress(progress) {
              progressByFile.set(progress.filename, Number(progress.bytes || 0));
              const downloaded = [...progressByFile.values()].reduce((sum, value) => sum + value, 0);
              const ratio = totalBytes ? downloaded / totalBytes : 0;
              update(task, "download", 12 + Math.min(38, ratio * 38), `正在下载 ${progress.filename}`);
            }
          });
          if (!Array.isArray(bundle?.files) || !bundle.files.length) throw new Error("本机离线包下载结果为空");
          append(task, `本机下载完成：${bundle.files.length} 个软件包`);
          update(task, "upload", 52, attempt > 1 ? "正在替换远端软件包目录" : "正在准备上传目录");
          const prepareCommand = `${attempt > 1 ? `rm -rf -- ${shellQuote(remoteDirectory)}; ` : ""}umask 077; mkdir -p ${shellQuote(remoteDirectory)}`;
          const mkdirResult = await dependencies.run_ssh_command(connection, buildRemotePosixCommand(prepareCommand), 30000);
          if (mkdirResult?.status !== 0) throw new Error(`${mkdirResult?.stderr || mkdirResult?.stdout || "无法创建远端离线目录"}`.trim());
          let uploadedBytes = 0;
          const bundleBytes = Math.max(1, Number(bundle.bytes || totalBytes || 0));
          for (const filename of bundle.files) {
            const source = String(filename || "");
            if (!path.isAbsolute(source)) throw new Error(`本机离线包路径不是绝对路径：${source || "未知文件"}`);
            const localFile = path.resolve(source);
            const stat = fs.statSync(localFile);
            if (!stat.isFile()) throw new Error(`本机离线包不是普通文件：${localFile}`);
            const label = path.basename(localFile);
            const remoteFile = path.posix.join(remoteDirectory, path.posix.basename(localFile.replace(/\\/g, "/")));
            if (!remoteFile.startsWith(`${remoteDirectory}/`)) throw new Error(`远端离线包路径无效：${remoteFile}`);
            const job = dependencies.start_upload(connection.id, localFile, remoteFile, stat.size);
            if (!job?.id) throw new Error(`无法创建 SFTP 上传任务：${label}`);
            await waitUpload(job.id, task, label, uploadedBytes, bundleBytes);
            uploadedBytes += stat.size;
          }
          append(task, "软件包已通过 SFTP 上传到远端临时目录");
          return bundle;
        };

        await downloadAndUpload(items, 1);
        update(task, "verify", 83, "正在检查离线依赖是否完整");
        const preflight = await dependencies.run_ssh_command(connection, buildRemotePosixCommand(buildAptOfflinePreflightCommand(remoteDirectory)), 120000);
        let preflightOutput = `${preflight?.stdout || ""}${preflight?.stderr || ""}`;
        if (preflight?.status !== 0 && aptOutputNeedsLocalResolution(preflightOutput) && !usedLocalRepository) {
          items = await resolveWithLocalRepository("远端软件包清单缺少依赖，正在自动补全并重新上传");
          if (await completeIfPackagesAlreadySatisfied()) return;
          await downloadAndUpload(items, 2);
          update(task, "verify", 83, "正在重新检查离线依赖");
          const retry = await dependencies.run_ssh_command(connection, buildRemotePosixCommand(buildAptOfflinePreflightCommand(remoteDirectory)), 120000);
          preflightOutput = `${retry?.stdout || ""}${retry?.stderr || ""}`;
          if (retry?.status !== 0) {
            throw new Error(`离线依赖自动补全后仍未通过远端检查：${preflightOutput.trim() || "远端 apt 未返回详细原因"}`);
          }
          append(task, "离线依赖已自动补全，远端预检查通过");
        } else if (preflight?.status !== 0) {
          throw new Error(`远端离线依赖预检查失败：${preflightOutput.trim() || "远端 apt 未返回详细原因"}`);
        } else {
          append(task, "远端离线依赖预检查通过");
        }
        update(task, "install", 86, "正在使用远端管理员权限安装");
        const installCommand = buildAptOfflineInstallCommand(remoteDirectory, packages);
        // A root SSH session must execute the uploaded package paths directly;
        // trying to create a privileged grant without credentials makes a
        // root-only offline install fail before apt is reached.
        const usePrivilege = Boolean(options.grant || (options.elevate && !options.direct_root));
        const result = usePrivilege
          ? await dependencies.run_privileged_stream(connection, installCommand, {grant_id:options.grant?.id, scope:options.scope || `remote-component.${task.component}`, timeout_ms:20 * 60 * 1000}, onChunk)
          : await dependencies.run_ssh_stream(connection, buildRemotePosixCommand(installCommand), 20 * 60 * 1000, onChunk);
        flushTaskLogs(task);
        if (result?.status !== 0) {
          throw remoteOutputError(`${result?.stderr || result?.stdout || result?.error?.message || "远端离线安装失败"}`.trim());
        }
        await completeAfterVerification("远端离线安装命令已完成", "离线安装完成");
      } catch (error) {
        flushTaskLogs(task);
        failTask(task, error);
        append(task, task.error, "error");
      } finally {
        try {
          if (remoteDirectory) await dependencies.run_ssh_command(connection, buildRemotePosixCommand(`rm -rf -- ${shellQuote(remoteDirectory)}`), 30000);
        } catch (error) { append(task, `远端临时目录清理失败：${error.message}`, "warning"); }
        try { if (localDirectory) fs.rmSync(localDirectory, {recursive:true, force:true}); } catch (error) { append(task, `本机临时包清理失败：${error.message}`, "warning"); }
        if (localDirectory) activeLocalDirectories.delete(localDirectory);
        if (options.release_grant) options.release_grant(options.grant);
        task.finished_at = now();
        task.updated_at = task.finished_at;
        // Successful/cancelled history expires eventually, while failures
        // remain available until the user explicitly removes them.
        if (["done", "cancelled"].includes(task.status)) {
          setTimeout(() => tasks.delete(task.id), 60 * 60 * 1000).unref?.();
        }
      }
    })();
    return taskView(task);
  }

  function startCommand(options: any = {}) {
    const connection = options.connection;
    if (!connection) throw new Error("远端操作缺少 SSH 管理连接");
    if (typeof options.run !== "function") throw new Error("远端操作缺少执行函数");
    const action = String(options.action || "configure");
    const resourceKey = String(options.resource_key || `remote-component:${Number(connection.id || 0)}:${String(options.component || "remote-component")}`).trim();
    const packageManagerLock = options.package_manager_lock === true
      || /(?:^|-)install(?:-|$)|(?:^|-)uninstall(?:-|$)/.test(action.toLowerCase());
    const resourceKeys = normalizedResourceKeys(resourceKey, [
      ...(Array.isArray(options.resource_keys) ? options.resource_keys : []),
      ...(packageManagerLock ? [packageManagerResourceKey(connection)] : [])
    ]);
    assertResourcesAvailable(resourceKeys, options.component_label);
    const task = {
      id:`remote-component-${now()}-${++sequence}`,
      component:String(options.component || "remote-component"),
      component_label:String(options.component_label || "远端组件"),
      action,
      action_label:actionLabel(action, options.action_label),
      mode:String(options.mode || "online"),
      resource_key:resourceKey,
      resource_keys:resourceKeys,
      connection_id:Number(connection.id || 0),
      connection_name:String(connection.name || connection.ssh_host || ""),
      status:"running",
      stage:"prepare",
      progress:4,
      current:String(options.prepare_label || `正在准备${actionLabel(action, options.action_label)}`),
      logs:[],
      error:"",
      created_at:now(),
      updated_at:now(),
      finished_at:0,
      before:options.before || null,
      after:null,
      log_encoding:normalizeTaskLogEncoding(connection.terminal_encoding),
      log_decoders:new Map(),
      log_partials:new Map()
    };
    tasks.set(task.id, task);
    append(task, `开始${task.action_label}：${task.component_label}`);
    void (async () => {
      try {
        update(task, "execute", 14, String(options.execute_label || `正在${task.action_label}`));
        const streamedLogCount = task.logs.length;
        const result = await options.run((chunk, stream) => appendChunk(task, chunk, stream || "stdout"));
        flushTaskLogs(task);
        if (task.logs.length === streamedLogCount) {
          append(task, result?.stdout, "stdout");
          append(task, result?.stderr, "stderr");
        }
        if (result?.status !== 0) {
          throw remoteOutputError(`${result?.stderr || result?.stdout || result?.error?.message || `${task.component_label}${task.action_label}失败`}`.trim());
        }
        update(task, "verify", 94, String(options.verify_label || "正在重新探测远端状态"));
        if (typeof options.verify === "function") task.after = await options.verify(result);
        if (typeof options.validate === "function") {
          const validation = await options.validate(task.after, result);
          if (validation === false) {
            throw publicError("REMOTE_COMPONENT_VERIFICATION_FAILED", `${task.component_label}${task.action_label}命令已结束，但状态验证未通过`);
          }
          if (typeof validation === "string" && validation) {
            throw publicError("REMOTE_COMPONENT_VERIFICATION_FAILED", validation);
          }
        }
        task.status = "done";
        task.stage = "done";
        task.progress = 100;
        task.current = "已完成";
        append(task, `${task.action_label}完成`);
      } catch (error) {
        flushTaskLogs(task);
        failTask(task, error);
        append(task, task.error, "error");
      } finally {
        try { options.release?.(); } catch {}
        task.finished_at = now();
        task.updated_at = task.finished_at;
        if (["done", "cancelled"].includes(task.status)) {
          setTimeout(() => tasks.delete(task.id), 60 * 60 * 1000).unref?.();
        }
      }
    })();
    return taskView(task);
  }

  return { cacheInfo, clearCache, clearFinished, list, remove, startAptInstall, startCommand, taskView };
}

module.exports = { createRemoteOfflineTaskManager };
