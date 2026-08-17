const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expectedArtifacts, relevantArtifacts, verifyReleaseVersion } = require("./release-artifacts-check");
const { verifyMacIconPadding } = require("./mac-icon-padding-check");
const runWorkspaceDockingChecks = require("./workspace-docking-check");
const { indexScriptFiles, readFrontendDomain } = require("./frontend-source");
const { readBackendSource, readSftpJobSource, readSources } = require("./backend-source");

const root = path.resolve(__dirname, "..");
const checks = [];
const frontendFiles = indexScriptFiles(root);

function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  const mark = pass ? "OK" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ""}`);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function hasNativeDialogCall(source) {
  return /(?:^|[^\w$.])(?:alert|confirm|prompt)\s*\(/m.test(source)
    || /\b(?:window|globalThis|self)\s*(?:\.\s*(?:alert|confirm|prompt)|\[\s*["'](?:alert|confirm|prompt)["']\s*\])\s*\(/.test(source);
}

async function webUrl(packageJson, licenseText) {
  if (process.env.TERMA_CHECK_URL || process.env.TUNNELDESK_CHECK_URL) return process.env.TERMA_CHECK_URL || process.env.TUNNELDESK_CHECK_URL;
  let persisted = "";
  try {
    const info = JSON.parse(read("data/web.json"));
    persisted = info.local_url || info.urls?.[0] || "";
  } catch {
    try {
      persisted = read("data/web.url").trim();
    } catch {}
  }
  const candidates = [...new Set(["http://127.0.0.1:8099", persisted].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate.replace(/\/$/, "")}/api/about`);
      const about = response.ok ? await response.json() : null;
      if (about?.version === packageJson.version && about?.license_text === licenseText) return candidate;
    } catch {}
  }
  return persisted || "http://127.0.0.1:8099";
}

async function checkFetch(url, name) {
  try {
    const res = await fetch(url);
    ok(name, res.ok, `${res.status} ${res.statusText}`);
    return res.ok ? await res.json().catch(() => null) : null;
  } catch (error) {
    ok(name, false, error.message);
    return null;
  }
}

async function captureDatabaseBundle(base) {
  const response = await fetch(`${base}/api/backup/bundle`);
  if (!response.ok) throw new Error(`完整数据库备份失败：${response.status} ${response.statusText}`);
  const bundle = Buffer.from(await response.arrayBuffer());
  if (bundle.length < 32) throw new Error("完整数据库备份为空或过小");
  return bundle;
}

async function restoreDatabaseBundle(base, bundle) {
  const checkResponse = await fetch(`${base}/api/restore/database/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Terma-Filename": "regression-preserved.termabackup"
    },
    body: bundle
  });
  const check = await checkResponse.json().catch(() => null);
  if (!checkResponse.ok || !check?.restore_token) {
    throw new Error(`完整数据库备份恢复检查失败：${check?.error || checkResponse.statusText || checkResponse.status}`);
  }
  const restoreResponse = await fetch(`${base}/api/restore/database`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({restore_token: check.restore_token, credential_bindings: [], identity_bindings: []})
  });
  const restored = await restoreResponse.json().catch(() => null);
  if (!restoreResponse.ok || restored?.database_reopened !== true) {
    throw new Error(`完整数据库备份恢复失败：${restored?.error || restoreResponse.statusText || restoreResponse.status}`);
  }
  return restored;
}

async function verifyIsolatedRegressionTarget(base) {
  const response = await fetch(`${base}/api/desktop-settings`);
  const settings = await response.json().catch(() => null);
  const dataDirectory = String(settings?.paths?.dataDir || "").trim();
  if (!response.ok || !dataDirectory) {
    throw new Error("无法确认回归服务的数据目录，拒绝执行数据库恢复用例");
  }
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const relative = path.relative(path.resolve(os.tmpdir()), resolvedDataDirectory);
  const temporaryRoot = relative.split(path.sep)[0] || "";
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !temporaryRoot.startsWith("terma-web-regression-")) {
    throw new Error(`数据库恢复用例只能指向 terma-web-regression 临时目录，当前目标：${resolvedDataDirectory}`);
  }
  return resolvedDataDirectory;
}

async function main() {
  const packageJson = JSON.parse(read("package.json"));
  const licenseText = read("LICENSE");
  const thirdPartyNotices = read("THIRD_PARTY_NOTICES.md");
  const thirdPartySource = read("src/third-party-components.ts");
  const routeFiles = fs.readdirSync(path.join(root, "src", "routes"))
    .filter(file => file.endsWith(".ts"))
    .map(file => path.join("src", "routes", file));
  const serverSource = readBackendSource(root, [
    "src/storage-restore.ts",
    ...routeFiles,
    "src/services/remote-admin-service.ts",
    "src/services/remote-component-service.ts",
    "src/services/x11-management-service.ts",
    "src/services/vnc-management-service.ts",
    "src/services/linux-desktop-service.ts",
    "src/services/native-sftp-drag-service.ts",
    "src/services/sftp-content-service.ts",
    "src/static-content-handler.ts",
    "src/http-response.ts"
  ]);
  ok("Linux desktop filename uses package metadata accepted by electron-builder", packageJson.desktopName === "terma.desktop" && !Object.prototype.hasOwnProperty.call(packageJson.build?.linux || {}, "desktopName"));
  ok("GNU GPL v3 license is declared and packaged", packageJson.license === "GPL-3.0-only" && licenseText.includes("GNU GENERAL PUBLIC LICENSE") && packageJson.build?.extraResources?.includes("LICENSE"));
  ok("第三方组件声明随桌面安装包提供", packageJson.build?.extraResources?.includes("THIRD_PARTY_NOTICES.md") && thirdPartySource.includes("listThirdPartyComponents") && ["xterm.js","Ace Editor","jsdiff","noVNC","ZMODEM.js","ssh2","node-x11","i18next","Lucide","Electron","node-pty","VcXsrv"].every(name => thirdPartySource.includes(`name:\"${name}\"`)) && ["xterm.js","Ace Editor","jsdiff","noVNC","zmodem.js","ssh2","node-x11","i18next","Lucide","Electron","node-pty","VcXsrv"].every(name => thirdPartyNotices.includes(`## ${name}`)));
  const lucideVersion = String(packageJson.dependencies?.lucide || "").match(/(\d+\.\d+\.\d+)/)?.[1] || "";
  ok("Lucide 运行时版本与随附组件声明一致", Boolean(lucideVersion) && thirdPartySource.includes(`name:\"Lucide\", version:\"${lucideVersion}\"`) && thirdPartyNotices.includes(`## Lucide\n\n- Project: https://github.com/lucide-icons/lucide\n- Version: ${lucideVersion}`));
  const electronVersion = String(packageJson.devDependencies?.electron || "").match(/(\d+\.\d+\.\d+)/)?.[1] || "";
  ok("Electron 运行时版本与随附组件声明一致", Boolean(electronVersion) && thirdPartySource.includes(`name:\"Electron\", version:\"${electronVersion}\"`) && thirdPartyNotices.includes(`## Electron\n\n- Project: https://github.com/electron/electron\n- Version: ${electronVersion}`));
  ok("Electron unpacks node-pty", Array.isArray(packageJson.build?.asarUnpack) && packageJson.build.asarUnpack.includes("node_modules/node-pty/**/*"));
  ok("Electron afterPack hook exists", typeof packageJson.build?.afterPack === "string" && fs.existsSync(path.join(root, packageJson.build.afterPack)));
  ok("macOS package verifies PTY helper", read(".github/workflows/release.yml").includes("Verify packaged PTY helper") && read("scripts/after-pack.js").includes("chmodSync(helper, 0o755)"));
  const macIcon = packageJson.build?.mac?.icon;
  const macIconPath = typeof macIcon === "string" ? path.join(root, macIcon) : "";
  const macIconHeader = macIconPath && fs.existsSync(macIconPath) ? fs.readFileSync(macIconPath).subarray(0, 4).toString("ascii") : "";
  ok("macOS package uses Terma ICNS", macIcon === "desktop/assets/icon.icns" && macIconHeader === "icns");
  let macIconPadding = null;
  try {
    macIconPadding = verifyMacIconPadding(path.join(root, "desktop", "assets", "icon-macos.png"));
  } catch {}
  ok(
    "macOS icon keeps the Dock-safe transparent margin",
    macIconPadding?.contentWidth === 768 && macIconPadding?.contentHeight === 768
  );
  const releaseWorkflow = read(".github/workflows/release.yml");
  ok("macOS afterPack verifies application icon", read("scripts/after-pack.js").includes("verifyMacIcon(context)") && read("scripts/after-pack.js").includes("CFBundleIconFile"));
  ok("macOS package verifies application icon", releaseWorkflow.includes("Verify packaged macOS icon") && releaseWorkflow.includes("CFBundleIconFile") && releaseWorkflow.includes('test "$icon_file" = "icon.icns"') && releaseWorkflow.includes("mac-icon-padding-check.js"));
  ok(
    "桌面发布文件名包含系统、架构和安装类型",
    packageJson.build?.nsis?.artifactName === "${productName}-${version}-windows-${arch}-installer.${ext}"
      && packageJson.build?.portable?.artifactName === "${productName}-${version}-windows-${arch}-portable.${ext}"
      && packageJson.build?.linux?.artifactName === "${productName}-${version}-linux-${arch}.${ext}"
      && packageJson.build?.mac?.artifactName === "${productName}-${version}-macos-${arch}.${ext}"
  );
  const expectedReleaseArtifacts = {
    windows: ["Terma-1.2.3-windows-x64-installer.exe", "Terma-1.2.3-windows-x64-portable.exe"],
    linux: ["Terma-1.2.3-linux-x86_64.AppImage", "Terma-1.2.3-linux-amd64.deb", "Terma-1.2.3-linux-x86_64.rpm"],
    macos: ["Terma-1.2.3-macos-x64.dmg", "Terma-1.2.3-macos-x64.zip", "Terma-1.2.3-macos-arm64.dmg", "Terma-1.2.3-macos-arm64.zip"],
    "linux-source": ["Terma-1.2.3-linux-source-noarch.tar.gz"]
  };
  let mismatchedReleaseTagRejected = false;
  try {
    verifyReleaseVersion(`v${packageJson.version}-mismatch`, "tag");
  } catch {
    mismatchedReleaseTagRejected = true;
  }
  ok(
    "发布校验覆盖所有平台和真实架构",
    Object.entries(expectedReleaseArtifacts).every(([platform, expected]) => JSON.stringify(expectedArtifacts(platform, "1.2.3")) === JSON.stringify(expected))
      && relevantArtifacts("macos", ["unexpected.blockmap"]).includes("unexpected.blockmap")
      && verifyReleaseVersion(`v${packageJson.version}`, "branch").checked === false
      && verifyReleaseVersion(`v${packageJson.version}`, "tag").checked === true
      && mismatchedReleaseTagRejected
  );
  ok(
    "GitHub Actions 在上传前校验产物名称",
    ["windows", "linux", "macos", "linux-source"].every((platform) => releaseWorkflow.includes(`release-artifacts-check.js ${platform}`))
      && releaseWorkflow.includes("Terma-windows-x64")
      && releaseWorkflow.includes("Terma-linux-x64")
      && releaseWorkflow.includes("Terma-macos-x64-arm64")
      && releaseWorkflow.includes("Terma-linux-source-noarch")
  );
  const sftpBackend = read("src/sftp.ts");
  const sftpJobsSource = readSftpJobSource(root);
  const sftpSessionSource = read("src/sftp-session.ts");
  const sftpSessionServerSource = readSources(root, [
    "src/server.ts",
    "src/server-runtime.ts",
    "src/routes/sftp-transfer-routes.ts",
    "src/routes/local-control-routes.ts"
  ]);
  const sftpJobRoutesSource = read("src/routes/sftp-job-routes.ts");
  const backupRestoreRoutesSource = read("src/routes/backup-restore-routes.ts");
  const remoteTaskRoutesSource = read("src/routes/remote-task-routes.ts");
  const sftpTransferRoutesSource = read("src/routes/sftp-transfer-routes.ts");
  const sftpEncodingSource = read("src/sftp-encoding.ts");
  const sftpFrontend = readFrontendDomain(root, "sftp");
  const remoteFrontend = readFrontendDomain(root, "remote");
  const sftpCss = read("public/app.css");
  const nativeSftpDragDesktopSource = read("desktop/native-sftp-drag.js");
  ok("SFTP 大目录元数据支持 GNU 快路径并保留便携降级", sftpBackend.includes('if find . -maxdepth 0 -printf \'\' >/dev/null 2>&1; then TERMA_FIND_STYLE=gnu; else TERMA_FIND_STYLE=portable; fi') && sftpBackend.includes('if [ "$TERMA_FIND_STYLE" = gnu ]; then find . -mindepth 1 -maxdepth 1') && sftpBackend.includes('else terma_entries | while IFS= read -r entry; do terma_emit_metadata "$entry" || exit 1; done; fi'));
  ok("SFTP 目录枚举兼容 GNU/BSD stat 并展示符号链接目标大小", sftpBackend.includes('stat -c "%s %Y %a %U %G"') && sftpBackend.includes('stat -f "%z %m %Lp %Su %Sg"') && sftpBackend.includes('stat -L -c "%s %Y %a %U %G"') && sftpBackend.includes('stat -L -f "%z %m %Lp %Su %Sg"') && sftpBackend.includes("find . ! -name .") && sftpBackend.includes("-prune -exec") && sftpFrontend.includes("entry.is_symlink"));
  ok("SFTP 命令不依赖远端登录 Shell", sftpBackend.includes("spawnSftpSessionCommand(connection, buildRemotePosixCommand(command))") && sftpJobsSource.includes("spawnSftpSessionCommand(connection, buildRemotePosixCommand(command))"));
  ok("SFTP 复用持久 SSH2 会话并在连接丢失后自动恢复", sftpSessionSource.includes("const sessions = new Map()") && sftpSessionSource.includes("record.client.exec") && sftpSessionSource.includes("for (let attempt = 0; attempt < 2") && sftpSessionSource.includes("await connectSftpSession(connection.id, {force:attempt > 0})") && sftpSessionSource.includes("record.manualDisconnected = false") && sftpSessionServerSource.includes('parts[4] === "session"') && sftpSessionServerSource.includes("closeAllSftpSessions()") && sftpFrontend.includes("refreshActiveSftpSessionStatus") && sftpFrontend.includes("const sftpDisconnectRequests = new Map()") && sftpFrontend.includes("if (disconnecting) await disconnecting.catch"));
  ok("SFTP 普通目录列表隐藏新旧内部目录和上传暂存文件", sftpBackend.includes('! -name ${shellQuote(SFTP_RECYCLE_DIRECTORY)}') && sftpBackend.includes('! -name ${shellQuote(LEGACY_SFTP_RECYCLE_DIRECTORY)}') && sftpBackend.includes('! -name ${shellQuote(".terma-upload-*.part")}') && sftpBackend.includes('! -name ${shellQuote(".tunneldesk-upload-*.part")}'));
  ok("SFTP 单次 stat 读取大小、时间和权限元数据", sftpBackend.includes('meta=$(stat -c "%s %Y %a %U %G"') && sftpBackend.includes('meta=$(stat -f "%z %m %Lp %Su %Sg"') && !sftpBackend.includes('size=$(stat'));
  ok("SFTP 支持单项/多项压缩和权限设置", sftpBackend.includes("normalizeRemotePermissionRequest") && sftpBackend.includes("buildRemotePermissionCommand") && sftpJobsSource.includes("normalizeCompressionRequest") && sftpFrontend.includes("compressSftpSelection") && sftpFrontend.includes("openSftpPermissionsForSelection"));
  ok("SFTP 大目录使用服务端分页、快照与请求合并", sftpBackend.includes("paginateRemoteEntries") && sftpBackend.includes("DIRECTORY_CACHE_TTL_MS") && sftpBackend.includes("directorySnapshotRequests") && sftpBackend.includes("loadDirectorySnapshot") && sftpFrontend.includes("loadSftpPage") && sftpFrontend.includes("sftp-pager"));
  ok("SFTP 搜索支持加载反馈与有界子目录索引", sftpBackend.includes("buildRemoteRecursiveDirectoryEntriesCommand") && sftpBackend.includes("MAX_RECURSIVE_SEARCH_ENTRIES") && sftpFrontend.includes("setSftpRecursiveSearch") && sftpFrontend.includes("syncSftpSearchFeedback") && sftpFrontend.includes("搜索子目录"));
  ok("SFTP 双击目录进入、文件打开编辑", sftpFrontend.includes("activateSftpEntry") && sftpFrontend.includes('ondblclick="activateSftpEntry'));
  ok("SFTP 任意扩展名显示文本打开", !sftpFrontend.includes("isTextPreviewName") && sftpFrontend.includes("以文本打开"));
  ok("SFTP 面包屑跟随滚动", sftpCss.includes(".sftp-top { position:sticky") && sftpCss.includes(".sftp-breadcrumb { display:flex") && sftpCss.includes("overflow-x:auto"));
  ok("SFTP 紧凑工具栏支持新建、条件粘贴、导航和悬浮搜索", sftpFrontend.includes('class="sftp-toolbar"') && sftpFrontend.includes("createSftpFile") && sftpFrontend.includes("renderSftpClipboardActions") && sftpFrontend.includes("cancelSftpClipboard") && sftpFrontend.includes("navigateSftpHistory") && sftpFrontend.includes("submitSftpPath") && sftpFrontend.includes('class="sftp-floating-search"') && sftpFrontend.includes('class="sftp-drop-overlay"') && sftpCss.includes(".sftp-shell { position:relative; display:flex;") && sftpCss.includes(".sftp-top { position:sticky") && sftpCss.includes("container-name:sftp-view") && sftpCss.includes("@container sftp-view (max-width:760px)") && sftpCss.includes(".sftp-favorites.is-empty { display:none; }") && !sftpFrontend.includes('classList.toggle("empty"'));
  ok("SFTP 拖拽传输、冲突处理、批量下载和版本差异预览可用", sftpSessionSource.includes("stageSftpPaths") && sftpSessionSource.includes("deliverSftpPaths") && read("desktop/main.js").includes("terma:sftp-start-drag") && sftpFrontend.includes("handleSftpDrop") && sftpFrontend.includes("dropSftpItemsOnTab") && sftpFrontend.includes("sftpDiffHistory") && sftpFrontend.includes("/sftp/versions") && sftpFrontend.includes("downloadSftpSelection") && sftpFrontend.includes("confirmSftpDownloadNotice") && sftpFrontend.includes("queueSftpDownload") && sftpFrontend.includes("conflict = await sftpConflictChoice") && !sftpFrontend.includes("sftpClipboard.action") && sftpSessionServerSource.includes('parts[4] === "download-batch"') && sftpSessionServerSource.includes('parts[4] === "upload-plan"'));
  ok("SFTP 列表展示权限/所有者并支持无感后台同步", sftpFrontend.includes("权限 / 所有者") && sftpFrontend.includes("captureSftpViewState") && sftpFrontend.includes("restoreSftpViewState") && sftpFrontend.includes("completedSftpMutationForCurrentView") && sftpFrontend.includes("sftpPendingDirectoryRefreshes") && sftpFrontend.includes('list.classList.toggle("is-refreshing", keepContents)'));
  ok("SFTP 任务由标题栏全局入口集中展示并区分进行中、失败与历史", read("public/index.html").includes('id="sftpTaskCenterButton"') && read("public/index.html").includes('id="sftpTaskCenterDrawer"') && read("public/index.html").includes('id="sftpTaskCenterFailedTab"') && read("public/index.html").includes('id="sftpTaskCenterFailedCount"') && sftpFrontend.includes("function sftpTaskCollections") && sftpFrontend.includes("const current = jobs.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status))") && sftpFrontend.includes('const failed = jobs.filter(job => job.status === "failed"') && sftpFrontend.includes('const showingFailed = sftpTaskCenterView === "failed"') && sftpFrontend.includes('["done", "cancelled"].includes(job.status)') && !sftpFrontend.includes('id="sftpJobs"'));
  ok("SFTP 全局任务中心保留进度及暂停继续取消等操作", sftpFrontend.includes("function updateSftpTaskCenter") && sftpFrontend.includes('const deletable = ["paused", "failed", "done", "cancelled"].includes(job.status)') && sftpFrontend.includes("pauseSftpJob") && sftpFrontend.includes("resumeSftpJob") && sftpFrontend.includes("cancelSftpJob") && sftpFrontend.includes("deleteSftpJob"));
  ok("任务中心失败页支持一键删除失败记录", read("public/index.html").includes('id="sftpTaskCenterClearLabel"') && sftpFrontend.includes('tr(showingFailed ? "tasks:dialogs.clear_failed_action" : "tasks:dialogs.clear_history_action"') && sftpFrontend.includes("function clearFailedSftpJobs") && sftpFrontend.includes("Promise.allSettled(failed.map(job => deleteSftpJobRecord(job.id)))") && read("public/app-static-actions.js").includes('sftpTaskCenterView === "failed" ? clearFailedSftpJobs'));
  ok("任务中心接入 Linux 桌面安装与卸载任务", sftpFrontend.includes('/api/linux-desktop/tasks') && sftpFrontend.includes('type:"linux-desktop"') && sftpFrontend.includes("openLinuxDesktopTask") && remoteFrontend.includes("if (typeof refreshSftpJobs === \"function\") void refreshSftpJobs()") && remoteTaskRoutesSource.includes("clearFinishedLinuxDesktopTasks"));
  ok("SFTP 原生拖出取消等待系统终态后再清理", sftpJobsSource.includes('job.phase = "cancelling"') && sftpJobsSource.includes("accepted = Boolean(nativeDragCancelHandler") && sftpFrontend.includes("job.can_cancel !== false"));
  ok("SFTP 后台任务创建不重复弹出加入提示", !/已加入[\s\S]{0,120}任务/.test(sftpFrontend));
  ok("SFTP 上传阶段使用用户视角文案", sftpFrontend.includes('phase === "receiving") return tr("tasks:phase.receiving", {defaultValue:"正在准备上传"})') && sftpFrontend.includes('phase === "uploading") return tr("tasks:phase.uploading", {defaultValue:"正在上传到远端"})') && !sftpFrontend.includes('return "正在接收"'));
  ok("SFTP 标题栏任务入口显示需关注任务数量及运行失败状态", sftpFrontend.includes('const status = failedCount ? "failed" : activeCount ? "running" : "idle"') && sftpFrontend.includes('button.classList.toggle("is-running"') && sftpFrontend.includes('button.classList.toggle("is-failed"') && sftpFrontend.includes("const attentionCount = current.length + failed.length") && sftpFrontend.includes('badge.textContent = attentionCount > 99 ? "99+" : String(attentionCount)') && sftpCss.includes(".sftp-task-center-button.is-running") && sftpCss.includes(".sftp-task-center-button.is-failed"));
  ok("SFTP 本机接收与远端上传共享同一后台任务", sftpFrontend.includes('/sftp/upload-job') && sftpFrontend.includes('/api/sftp/jobs/${encodeURIComponent(started.id)}/content') && sftpFrontend.includes("sftpUploadRequests") && !sftpFrontend.includes("正在接收 ${filename}") && sftpTransferRoutesSource.includes("startUploadReceiveJob") && sftpJobRoutesSource.includes("receiveUploadJobContent"));
  ok("SFTP 上传通过远端暂存文件原子完成且取消会清理", sftpJobsSource.includes("remote_temp_path") && sftpJobsSource.includes("uploadRemoteCommitCommand") && sftpJobsSource.includes("cleanupRemoteUploadArtifact") && sftpJobsSource.includes("invalidateRemoteDirectoryCache(job.connection_id)"));
  ok("悬浮任务进度卡位于标题栏下方并支持暂停继续、关闭与永久静默", read("public/app-utils.js").includes('class="toast-copy"') && sftpCss.includes(".toast-head > .toast-icon") && sftpCss.includes('.sftp-task-float { position:absolute') && sftpCss.includes('top:calc(100% + 8px)') && read("public/index.html").includes('id="sftpTaskFloat"') && sftpFrontend.includes("toggleSftpTaskFloatJob") && sftpFrontend.includes("sftp-task-float-pause") && sftpFrontend.includes("dismissSftpTaskFloat") && sftpFrontend.includes("muteSftpTaskFloat") && sftpFrontend.includes("永久关闭此类悬浮进度卡") && readFrontendDomain(root, "settings").includes('id="taskCenterFloatingProgressEnabled"') && read("src/runtime-settings.ts").includes("sftp_floating_progress_enabled"));
  ok(
    "页面通知独立计时纵向堆叠并在关闭后平滑上移",
    read("public/index.html").includes('id="toast" class="notification-stack"')
      && read("public/app-utils.js").includes("const toastTimers = new Map()")
      && read("public/app-utils.js").includes("stack.appendChild(toast)")
      && read("public/app-utils.js").includes("function animateToastReflow")
      && read("public/app-utils.js").includes("dismissToast(this.closest('.toast'))")
      && sftpCss.includes("grid-auto-flow:row")
      && sftpCss.includes("--notification-stack-offset")
      && sftpCss.includes("transform:translateY(var(--notification-stack-offset))")
  );
  ok("页面通知支持分类开关、显示时长和独立悬浮任务卡设置", read("src/runtime-settings.ts").includes("DEFAULT_NOTIFICATION_DISPLAY") && read("src/runtime-settings.ts").includes("normalizeNotificationDisplay") && read("public/app-utils.js").includes("function notificationDisplayPreferences") && read("public/app-utils.js").includes("preference?.enabled === false") && readFrontendDomain(root, "settings").includes('id="notificationInfoEnabled"') && readFrontendDomain(root, "settings").includes('id="notificationProgressSuccessDuration"') && readFrontendDomain(root, "settings").includes('id="taskCenterFloatingProgressEnabled"') && read("public/app.css").includes(".notification-preference-row"));
  ok(
    "Linux 缺少 FUSE 时提示原因并保留兼容拖出",
    sftpFrontend.includes("function sftpNativeDragFallbackInfo()")
      && sftpFrontend.includes('capabilities?.platform !== "linux" || capabilities?.sftpExternalDrag !== "staged"')
      && sftpFrontend.includes("/dev/fuse is unavailable")
      && sftpFrontend.includes("cannot access /dev/fuse")
      && sftpFrontend.includes("fusermount3 is unavailable")
      && sftpFrontend.includes('tr("sftp:drag.linux_fallback_notice"')
      && sftpFrontend.includes('tr("sftp:drag.linux_compat_hint"')
      && (sftpFrontend.match(/showSftpNativeDragFallbackNotice\(\)/g) || []).length >= 2
      && nativeSftpDragDesktopSource.includes('sftpExternalDrag: adapter.probe.available ? "streaming" : "staged"')
      && nativeSftpDragDesktopSource.includes('sftpNativeDragReason: adapter.probe.available ? ""')
  );
  ok("SFTP 回收站默认关闭，新写 Terma 且兼容旧 TunnelDesk 数据", sftpBackend.includes('SFTP_RECYCLE_DIRECTORY = ".terma-recycle-bin"') && sftpBackend.includes('LEGACY_SFTP_RECYCLE_DIRECTORY = ".tunneldesk-recycle-bin"') && sftpBackend.includes('for (const storage of ["terma", "tunneldesk"])') && sftpBackend.includes("buildRestoreRemoteRecycleCommand") && sftpBackend.includes("buildDeleteRemoteRecycleCommand") && sftpBackend.includes("buildClearRemoteRecycleCommand") && sftpFrontend.includes("openSftpRecycleBin") && sftpFrontend.includes("JSON.stringify({id, storage})") && read("src/runtime-settings.ts").includes("sftp_recycle_bin_enabled"));
  ok("SFTP 权限命令兼容 Linux 与 macOS", sftpBackend.includes("permissionPathOperand") && sftpBackend.includes("chgrp") && !sftpBackend.includes("chown ${recursiveFlag}${shellQuote(`${normalized.owner}:${normalized.group}`)} --") && !sftpBackend.includes("chmod ${recursiveFlag}${normalized.mode} --"));
  ok(
    "移动端工作区返回入口由外壳统一提供",
    /<main id="content" class="content">\s*<div class="mobile-back-bar"><button id="mobileBack"/.test(read("public/index.html"))
      && sftpCss.includes(".mobile-back { display:none !important; }")
      && sftpCss.includes(".content.mobile-show.terminal-content > .mobile-back-bar { position:relative;")
      && !readFrontendDomain(root, "terminal").includes("terminal-mobile-back")
      && !remoteFrontend.includes("terminal-mobile-back")
  );
  ok("终端原始字节使用二进制 WebSocket 帧", read("src/terminal.ts").includes("Buffer.isBuffer(data) ? 2 : 1") && read("src/terminal.ts").includes("sendWebSocketFrame") && readFrontendDomain(root, "terminal").includes('socket.binaryType = "arraybuffer"') && readFrontendDomain(root, "terminal").includes("new Uint8Array(event.data)"));
  ok("SFTP 文本读取保护并支持原字节备份", sftpEncodingSource.includes("new TextDecoder") && sftpBackend.includes("[ ! -f") && sftpBackend.includes("backup_path"));
  ok("密码 SSH 使用内置跨平台依赖", Boolean(packageJson.dependencies?.ssh2));
  const startBat = read("start.bat");
  const dependencyState = read("scripts/dependency-state.js");
  const detachedStarter = read("scripts/start-detached.js");
  ok("Windows 后台启动不保留控制台并透传桌面监听参数", startBat.includes("start-detached.js desktop %SERVER_ARGS%") && startBat.includes("start-detached.js web") && detachedStarter.includes("[root, ...process.argv.slice(3)]") && read("desktop/main.js").includes("...parseServerArgs()") && detachedStarter.includes("windowsHide: true") && detachedStarter.includes("child.unref()") && !startBat.includes("cmd /c npm run desktop:run") && !startBat.includes("timeout /t"));
  ok("Linux/macOS 桌面启动透传监听参数并监控后台进程", read("start.sh").includes('start-detached.js desktop $DESKTOP_ARGS "$@"') && read("start.sh").includes('start-detached.js web "$@"') && detachedStarter.includes("TERMA_START_PRINT_PID"));
  ok("启动脚本在依赖清单变化后自动安装", startBat.includes("scripts\\dependency-state.js") && read("start.sh").includes("scripts/dependency-state.js") && dependencyState.includes("package-lock.json") && dependencyState.includes(".terma-dependencies.sha256") && dependencyState.includes(".tunneldesk-dependencies.sha256"));
  ok("关闭流程停止健康监控并退出桌面主进程", serverSource.includes("await stopForwardHealthMonitor()") && read("src/ssh.ts").includes("async function stopForwardHealthMonitor()") && read("desktop/main.js").includes("onShutdown: () =>"));
  ok("dist/server.js 存在", fs.existsSync(path.join(root, "dist/server.js")));
  const missingFrontend = frontendFiles.filter(file => !fs.existsSync(path.join(root, file)));
  ok("前端模块文件完整", missingFrontend.length === 0, missingFrontend.join(", "));
  const indexHtml = read("public/index.html");
  let cursor = -1;
  const ordered = frontendFiles.every(file => {
    const next = indexHtml.indexOf(`/${path.basename(file)}`, cursor + 1);
    if (next < 0) return false;
    cursor = next;
    return true;
  });
  ok("public/index.html 按顺序加载前端模块", ordered);
  const assetVersions = [...indexHtml.matchAll(/[?&]v=([^"&]+)/g)].map(match => match[1]);
  ok("静态资源缓存版本由服务端统一注入", assetVersions.length > 0
    && assetVersions.every(version => version === "__TERMA_VERSION__")
    && serverSource.includes('.replaceAll("__TERMA_VERSION__", encodeURIComponent(PACKAGE_VERSION))'), [...new Set(assetVersions)].join(", "));
  ok("Lucide 在业务脚本前加载", indexHtml.indexOf("/vendor/lucide/lucide.min.js") >= 0 && indexHtml.indexOf("/vendor/lucide/lucide.min.js") < indexHtml.indexOf("/app-api.js"));

  const frontend = frontendFiles.map(read).join("\n");
  const settingsFrontend = readFrontendDomain(root, "settings");
  const settingsViewSource = read("public/app-settings.js");
  const settingsCacheSource = read("public/app-settings-cache.js");
  const importFrontend = read("public/app-import.js");
  const terminalFrontend = readFrontendDomain(root, "terminal");
  const terminalOutputFrontend = read("public/app-terminal-output.js");
  const forwardsFrontend = read("public/app-forwards.js");
  const runningFrontend = read("public/app-running.js");
  const logsFrontend = readFrontendDomain(root, "logs");
  const connectionsFrontend = readFrontendDomain(root, "connections");
  const sshEditSaveBranch = connectionsFrontend.match(/if \(connectAfterSave && savedConnectionId\)[\s\S]*?else if \(clearAfterSave && !p\.id\)/)?.[0] || "";
  const remoteEditSaveBranch = remoteFrontend.match(/if \(\(saveAction === "close" \|\| saveAction === "open"\) && savedId\)[\s\S]*?else if \(clearAfterSave && !id\)/)?.[0] || "";
  const utilsFrontend = read("public/app-utils.js");
  const workspaceFrontend = read("public/app-workspace.js");
  const staticActionsFrontend = read("public/app-static-actions.js");
  const dockingFrontend = readFrontendDomain(root, "docking");
  const productivityFrontend = readFrontendDomain(root, "productivity");
  const appEntry = read("public/app.js");
  const appState = read("public/app-state.js");
  const appCss = read("public/app.css");
  const sftpTasksFrontend = read("public/app-sftp-tasks.js");
  const storageRoutesSource = read("src/routes/storage-routes.ts");
  const updateRouteSource = read("src/routes/update-routes.ts");
  const terminalSource = read("src/terminal.ts");
  const desktopSource = read("desktop/main.js");
  const appMenuSource = desktopSource.slice(desktopSource.indexOf("function buildAppMenu"), desktopSource.indexOf("function createTray"));
  const trayMenuSource = desktopSource.slice(desktopSource.indexOf("function refreshTrayMenu"), desktopSource.indexOf("function showError"));
  ok("原生弹窗规则区分协议对象方法", !hasNativeDialogCall("detection.confirm()") && hasNativeDialogCall("confirm('x')") && hasNativeDialogCall("window.confirm('x')"));
  ok("无原生 alert/confirm/prompt", !hasNativeDialogCall(frontend));
  ok("模态弹窗不会因点击外部遮罩而误关闭", !frontend.includes("event.target === modal") && !frontend.includes("event.target===modal") && appEntry.includes("event.stopImmediatePropagation()"));
  ok("共享弹窗统一标题、关闭按钮和吸顶操作区", appCss.includes(".modal-title-row {") && appCss.includes("padding:var(--modal-card-padding)") && appCss.includes("margin-top:calc(-1 * var(--modal-card-padding))") && appCss.includes("margin-bottom:calc(-1 * var(--modal-card-padding))") && appCss.includes(".vnc-clipboard-helper-state .rdp-server-head"));
  ok("图标刷新不监听全部 DOM 变化", !frontend.includes("new MutationObserver(refreshIcons)"));
  ok("动态图标直接输出 SVG", frontend.includes('return `<svg class="lucide'));
  ok(
    "移动端文件选择返回后恢复完整视口高度",
    utilsFrontend.includes("function beginNativeFileDialogViewport()")
      && utilsFrontend.includes("function settleNativeFileDialogViewport()")
      && utilsFrontend.includes("function resetMobileWorkspaceShellScroll()")
      && utilsFrontend.includes("resetMobileWorkspaceShellScroll();")
      && utilsFrontend.includes("preferLayout:true")
      && utilsFrontend.includes("nativeFileDialogPending && options.force !== true")
      && appEntry.includes("bindNativeFileDialogViewportRecovery()")
  );
  ok(
    "SSH 健康状态图标不再与快捷操作争用底部宽度",
    /<span class="conn-state">[\s\S]*?<span class="health-badge/.test(connectionsFrontend)
      && !/<div class="conn-summary">[\s\S]*?<span class="health-badge/.test(connectionsFrontend)
  );
  ok("转发入口包含局域网监听提示", frontend.includes("0.0.0.0") && frontend.includes("仅本机可访问"));
  ok("工作区标签菜单包含四种关闭方式", ["关闭当前标签", "关闭其他标签", "关闭右侧标签", "关闭所有标签"].every(text => frontend.includes(text)));
  const dockingContract = dockingFrontend.includes("function workspaceLeaves")
    && dockingFrontend.includes("function workspaceFindPane")
    && dockingFrontend.includes("function workspaceReplacePaneWithSplit")
    && dockingFrontend.includes("function pruneWorkspaceLayout")
    && dockingFrontend.includes("function serializeWorkspaceLayout")
    && dockingFrontend.includes("function restoreWorkspaceLayoutNode")
    && dockingFrontend.includes("function workspaceDropZoneAtPoint")
    && ["left", "right", "top", "bottom"].every(zone => dockingFrontend.includes(`[\"${zone}\"`))
    && dockingFrontend.includes("duplicateWorkspaceTab")
    && dockingFrontend.includes("focusedPaneId")
    && indexHtml.includes('id="workspaceDock"')
    && indexHtml.includes('id="workspaceViewsTpl"')
    && appCss.includes(".workspace-split-row")
    && appCss.includes(".workspace-split-column")
    && appCss.includes(".workspace-splitter")
    && appCss.includes("@container workspace-pane")
    && appCss.includes(".workspace-pane-drop-indicator");
  const dockingResult = runWorkspaceDockingChecks({silent:true});
  ok("工作区支持递归分屏、四向落点、比例持久化与移动端单区块", dockingContract && dockingResult.passed, dockingResult.failures.join("; "));
  ok(
    "远程桌面标签以内嵌协议字母区分并兼容旧恢复数据",
    workspaceFrontend.includes("const inferredProtocol = savedProtocol ||")
      && workspaceFrontend.includes("tab-protocol-letter")
      && workspaceFrontend.includes("remote-protocol-${escAttr(inferredProtocol)}")
      && appCss.includes(".tab-kind-icon.remote-desktop.remote-protocol-vnc { color:var(--accent); }")
      && appCss.includes(".tab-kind-icon.remote-desktop.remote-protocol-xdmcp { color:var(--warn); }")
      && read("scripts/ui-smoke-electron.js").includes("remoteProtocolTitlesCompact")
      && read("scripts/ui-smoke-electron.js").includes("remoteProtocolMonitorBadges")
  );
  ok("窄屏终端工具栏分行、左对齐并以图标保留全部操作", appCss.includes("container-name:terminal-view") && appCss.includes("container-name:terminal-toolbar") && appCss.includes("@container terminal-view (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:700px)") && appCss.includes(".terminal-title-row { flex:1 1 100%; width:100%; }") && appCss.includes(".terminal-actions { justify-content:flex-start; }") && appCss.includes(".terminal-actions > button:not(.terminal-dropdown-button) > span:not(.composite-icon) { display:none; }"));
  ok("移动端终端标题行按内容收缩并为外壳返回按钮留位", appCss.includes(".terminal-title-row { flex:0 0 auto; width:100%; padding-left:0; }") && appCss.includes(".content.mobile-show.terminal-content > .mobile-back-bar { position:relative;") && appCss.includes(".terminal-toolbar { align-items:flex-start; flex-direction:column"));
  ok("移动端终端字体菜单限制高度并保持关闭入口可见", appCss.includes(".mobile-action-menu { position:fixed") && appCss.includes("max-height:min(68dvh") && appCss.includes("overflow-y:auto") && appCss.includes(".mobile-action-menu .action-menu-close { position:sticky"));
  ok("移动端工作区表单聚焦时不触发页面自动缩放", appCss.includes(".workspace input, .workspace select, .workspace textarea { font-size:16px; }"));
  ok("移动端软键盘改变视口时保持当前工作区或操作区", workspaceFrontend.includes('let mobilePaneView = "explorer"') && workspaceFrontend.includes('mobilePaneView = "workspace"') && workspaceFrontend.includes('responsiveLayoutMobile = true') && workspaceFrontend.includes('if (mobilePaneView === "workspace") showMobileWorkspace()') && appEntry.includes('window.addEventListener("resize", () => { syncViewportHeight(); syncResponsivePane(); })'));
  ok(
    "移动端启动恢复标签时先停留在连接列表",
    workspaceFrontend.includes('viewName !== "welcome" && !window.restoringTabs')
      && dockingFrontend.includes('resolvedPaneId === focusedPaneId && !window.restoringTabs')
      && appEntry.includes("const restored = restoreTabsState();")
      && appEntry.includes("syncResponsivePane();")
  );
  ok("SSH 表单支持密钥和密码登录", indexHtml.includes("私钥登录") && indexHtml.includes("密码登录") && frontend.includes("toggleAuthFields"));
  ok("SSH 登录方式隔离认证字段", frontend.includes('identity_file:passwordAuth ? ""') && frontend.includes('ssh_password:passwordAuth ?') && frontend.includes('control.disabled = password') && frontend.includes('control.disabled = !password'));
  ok("通知首次加载只建立游标", frontend.includes("initializeNotificationCursor") && frontend.includes('/api/notifications?since=0&language=') && frontend.includes("notificationCursorInitialized = true"));
  ok("SFTP 读取响应不缓存敏感内容", /"Cache-Control"\s*:\s*"no-store"/.test(serverSource));
  ok("SFTP 删除由服务端设置决定是否进入回收站并使用后台任务", sftpTransferRoutesSource.includes("const recycleEnabled = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_recycle_bin_enabled") && sftpTransferRoutesSource.includes("dependencies.deletePathsJob(connectionId, requestedPaths, recycleEnabled)") && sftpTransferRoutesSource.includes("Array.isArray(data.paths) ? data.paths : [data.path]") && sftpTransferRoutesSource.includes("dependencies.sendJson(response, result, 202)") && sftpJobsSource.includes('progress_unit: "items"') && sftpTransferRoutesSource.includes('parts[4] === "trash" && parts[5] === "restore"'));
  ok("关于页与开源许可弹窗已接入", settingsFrontend.includes('id="settings-about"') && settingsFrontend.includes("查看开源许可正文") && settingsFrontend.includes("showLicenseModal") && settingsFrontend.includes("about-third-party-list") && settingsFrontend.includes("third_party_components") && serverSource.includes('pathname === "/api/about"'));
  ok("设置页支持 GitHub Releases 更新检查", settingsFrontend.includes("refreshUpdateStatus") && settingsFrontend.includes('tr("settings:updates.view_release"') && updateRouteSource.includes('pathname === "/api/updates/check"'));
  ok("更新完成后按当前安装类型隔离状态并提供安全操作", settingsFrontend.includes("openDownloadedUpdateDirectory") && settingsFrontend.includes('tr("settings:updates.open_download_directory"') && settingsFrontend.includes('tr("settings:auto.update_redownload"') && settingsFrontend.includes('tr("settings:updates.open_package_confirm"') && settingsFrontend.includes("download.asset_name === download.selected_asset_name") && settingsFrontend.includes('download.package_type === "portable"') && updateRouteSource.includes('pathname === "/api/updates/open-directory"') && updateRouteSource.includes('state.package_type === "portable"') && desktopSource.includes("shell.showItemInFolder(target)") && read("src/update-installer.ts").includes("matchesCurrentTarget") && read("src/update-installer.ts").includes("cleanupInstalledPackage") && serverSource.includes("scheduleInstalledUpdateCleanup"));
  ok("设置与导入导出使用独立操作区", workspaceFrontend.includes('primaryView === "settings"') && workspaceFrontend.includes('primaryView === "import"') && workspaceFrontend.includes("data-explorer-section") && importFrontend.includes("scrollToImportSection"));
  const importSourceAt = indexHtml.indexOf('id="import-source"');
  const importResultsAt = indexHtml.indexOf('id="import-results"');
  const importExportAt = indexHtml.indexOf('id="import-export"');
  ok("导入结果并入导入配置", importSourceAt >= 0 && importResultsAt > importSourceAt && importResultsAt < importExportAt && !importFrontend.includes('"import-results"') && !workspaceFrontend.includes('"import-results"'));
  ok("SSH config 与数据库使用连接级私钥绑定器", importFrontend.includes("showIdentityBindingModal") && importFrontend.includes("测试选中连接") && importFrontend.includes("暂存绑定") && importFrontend.includes("选择原同名") && serverSource.includes("normalizeIdentityBindings"));
  ok("数据库导出明确选择是否包含 SSH 密码", importFrontend.includes("不包含密码（推荐）") && importFrontend.includes("包含密码") && serverSource.includes('include_passwords') && read("src/database/database-export.ts").includes("UPDATE connections SET ssh_password=NULL"));
  ok("数据库恢复始终列出全部连接及原验证方式", importFrontend.includes("showDatabaseCredentialModal") && importFrontend.includes("原验证方式") && importFrontend.includes("设置所填密码") && serverSource.includes("connections: rows.map") && serverSource.includes("credential_bindings"));
  const importerSource = read("src/importer.ts");
  const dbSource = [
    "src/db.ts",
    "src/database/core.ts",
    "src/database/connection-normalizer.ts",
    "src/database/config-snapshot-service.ts",
    "src/database/database-export.ts",
    "src/database/migrations.ts",
    "src/database/connection-repository.ts",
    "src/database/forward-repository.ts",
    "src/database/productivity-repository.ts",
    "src/database/remote-profile-repository.ts",
    "src/database/secret-rewriter.ts"
  ].map(read).join("\n");
  ok("SSH 连接支持持久排序、同值按名称升序并在两类导入中编辑", indexHtml.includes('id="conn_sort_order"') && frontend.includes("setImportSortOrder") && frontend.includes("data-restore-sort") && importerSource.includes("sort_order: 1") && dbSource.includes("sort_order INTEGER NOT NULL DEFAULT 1") && dbSource.includes("connections.sort_order, connections.name COLLATE NOCASE, connections.created_at, connections.id") && dbSource.includes('localeCompare(String(b.name || ""), "zh-Hans-CN"') && frontend.includes("connections.sort((a,b) => (order.get(a.group_name) ?? names.length) - (order.get(b.group_name) ?? names.length));"));
  ok("SSH 连接分组支持右键和更多菜单重命名", frontend.includes("showConnectionGroupMenu") && frontend.includes("connection-group-menu-button") && frontend.includes("重命名分组") && frontend.includes("/api/connection-groups/rename") && serverSource.includes("renameConnectionGroup") && dbSource.includes("UPDATE connections SET group_name=?, updated_at=? WHERE group_name=?"));
  ok("SSH 连接分组支持持久化拖动排序且不被轮询重绘打断", frontend.includes("beginConnectionGroupDrag") && frontend.includes("saveConnectionGroupOrder") && frontend.includes("connectionGroupDrag.renderPending = true") && frontend.includes("pointercancel\", cancel") && !frontend.includes("navigator.vibrate") && frontend.includes("/api/connection-groups/reorder") && serverSource.includes("reorderConnectionGroups") && dbSource.includes("CREATE TABLE IF NOT EXISTS connection_groups"));
  ok("SSH 连接分组手动收起后不被后台刷新重新展开", !appEntry.includes("if (selectedId === c.id) groupOpen.add(c.group_name)") && frontend.includes("function selectConnection(id)") && frontend.includes("groupOpen.add(c.group_name)") && frontend.includes("function toggleGroupOpen(group)"));
  ok("SSH 连接分组标题支持无漏光滚动冻结和阴影分层", appCss.includes(".tree { overflow-y:auto; overflow-x:hidden; padding:0 0 18px;") && appCss.includes(".group-head-row.connection-group-head-row") && appCss.includes("position:sticky") && appCss.includes("background:var(--sidebar)") && appCss.includes("box-shadow:0 1px 0 var(--line)"));
  ok("SSH 连接菜单支持完整复制并按 copy 编号递增", frontend.includes('tr("connections:actions.duplicate"') && frontend.includes('run:()=>duplicateConnection(id)') && frontend.includes("/duplicate") && serverSource.includes('parts[3] === "duplicate"') && dbSource.includes("function duplicateConnection") && dbSource.includes("nextConnectionCopyName") && dbSource.includes("insertForward(connectionId, forward)"));
  ok("终端编码与字体使用独立下拉菜单并持久化", terminalFrontend.includes("showTerminalEncodingMenu") && terminalFrontend.includes("showTerminalFontMenu") && terminalFrontend.includes("applyTerminalPreferences") && terminalFrontend.includes("focusTerminalSession") && terminalFrontend.includes("terminal-preferences") && terminalFrontend.includes("terminalFontSizeField") && dbSource.includes("terminal_encoding TEXT NOT NULL DEFAULT 'utf8'") && dbSource.includes("terminal_font_size INTEGER NOT NULL DEFAULT 13") && dbSource.includes("terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13"));
  const runtimeSettingsSource = read("src/runtime-settings.ts");
  ok("全局终端设置独立持久化并应用到当前和未来会话",
    runtimeSettingsSource.includes("DEFAULT_TERMINAL_SETTINGS")
      && runtimeSettingsSource.includes("normalizeTerminalSettings")
      && runtimeSettingsSource.includes("schema_version: 16")
      && runtimeSettingsSource.includes("language: normalizeLanguage")
      && runtimeSettingsSource.includes("language_onboarding_version")
      && runtimeSettingsSource.includes('background_mode: "theme"')
      && runtimeSettingsSource.includes('background_color: "#0f1720"')
      && runtimeSettingsSource.includes("TERMINAL_BACKGROUND_MODES")
      && serverSource.includes("terminal: data.terminal ?? current.terminal")
      && terminalFrontend.includes("showTerminalGlobalSettings")
      && terminalFrontend.includes("terminalThemeForSettings")
      && terminalFrontend.includes("theme:terminalThemeForSettings()")
      && terminalFrontend.includes("session.term.options.theme = theme")
      && terminalFrontend.includes("session.term.options.minimumContrastRatio = 4.5")
      && terminalFrontend.includes("minimumContrastRatio:4.5")
      && terminalFrontend.includes("for (const session of terminalSessions.values()) {")
      && terminalFrontend.includes("applyTerminalGlobalSettingsToSession(session);")
      && terminalFrontend.includes("applyTerminalGlobalSettingsToSessions();")
      && utilsFrontend.includes('if (typeof applyTerminalGlobalSettingsToSessions === "function") applyTerminalGlobalSettingsToSessions();')
      && terminalFrontend.includes("bindTerminalGlobalBehavior")
      && terminalFrontend.includes("registerLinkProvider")
      && terminalFrontend.includes("onSelectionChange")
      && terminalFrontend.includes('addEventListener("paste"')
      && terminalFrontend.includes("sendTerminalPasteText")
      && terminalFrontend.includes("editTerminalMultilinePaste")
      && terminalFrontend.includes('tr("terminal:settings.multiline_prompt"')
      && terminalFrontend.includes("formatTerminalCopiedText")
      && terminalFrontend.includes('tr("terminal:settings.scope"')
  );
  ok("终端提供带阶段提示的可滚动光标复制", terminalFrontend.includes("showTerminalContextMenu(event, key, connectionId)") && !terminalFrontend.includes("selectTerminalWordAtPointer") && terminalFrontend.includes('tr("terminal:context_menu.session_copy"') && terminalFrontend.includes("showTerminalSessionText") && terminalFrontend.includes('tr("terminal:context_menu.cursor_copy"') && terminalFrontend.includes("startTerminalCursorCopy") && terminalFrontend.includes('className = "terminal-cursor-copy-hint"') && terminalFrontend.includes('tr("terminal:settings.cursor_copy_start"') && terminalFrontend.includes('tr("terminal:settings.cursor_copy_end"') && terminalFrontend.includes('selectionBackground:"#2563eb"') && terminalFrontend.includes("scrollLines(direction)") && terminalFrontend.includes("touchOffset") && terminalFrontend.includes("navigator.clipboard?.readText") && appCss.includes(".terminal-cursor-copy-message") && read("public/app-utils.js").includes("writeClipboardText"));
  ok("工作区按设置恢复所有标签类型", dockingFrontend.includes("restore_workspace_tabs") && dockingFrontend.includes("workspaceGroupPersistableTab") && dockingFrontend.includes("workspaceGroups:groups") && !dockingFrontend.includes('tab.kind !== "terminal"') && settingsFrontend.includes('id="restoreWorkspaceTabs"'));
  ok("SFTP 使用 Ace 编辑器、语言模式、换行、图片预览和页面内全局设置", Boolean(packageJson.dependencies?.["ace-builds"]) && indexHtml.includes("/vendor/ace/ace.js") && serverSource.includes("ACE_VENDOR_DIR") && sftpFrontend.includes("sftpEditorLanguageForFile") && sftpFrontend.includes("ace.edit") && sftpFrontend.includes("setUseWrapMode") && sftpFrontend.includes("previewSftpImage") && serverSource.includes("preview-image") && sftpFrontend.includes('id="sftpGlobalSettingsButton"') && settingsFrontend.includes("showSftpGlobalSettings") && settingsFrontend.includes("sftpMaxOpenFileSizeMb"));
  ok("SFTP 文本冲突使用本地 jsdiff 并提供有界左右对比", Boolean(packageJson.dependencies?.diff) && indexHtml.includes("/vendor/diff/diff.min.js") && serverSource.includes('vendorFile("diff", "dist/diff.min.js")') && sftpFrontend.includes("sftpDiffViewerHtml") && sftpFrontend.includes("SFTP_DIFF_MAX_ROWS") && sftpFrontend.includes("timeout:1500") && read("THIRD_PARTY_NOTICES.md").includes("## jsdiff"));
  ok("SFTP 图片按二进制响应且 JSON 可一键格式化", serverSource.includes("Buffer.isBuffer(data)") && serverSource.includes("data instanceof Uint8Array") && sftpFrontend.includes('id="sftpTextFormatJson"') && sftpFrontend.includes("JSON.stringify(parsed, null, 2)") && sftpFrontend.includes("JSON 格式错误"));
  ok("SFTP 下载按桌面与浏览器分流并管理临时缓存", runtimeSettingsSource.includes("sftp_download_directory") && sftpTransferRoutesSource.includes('deliveryMode:desktop ? "desktop" : "browser"') && sftpJobsSource.includes("autoSaveDownloadedFile") && sftpJobsSource.includes("DOWNLOAD_CACHE_TTL_MS") && sftpJobsSource.includes("BROWSER_DELIVERY_GRACE_MS") && sftpJobsSource.includes("markSftpJobDelivered") && sftpFrontend.includes('tr("sftp:transfer.first_download_title"') && sftpFrontend.includes("sftpPendingBrowserDownloads") && sftpFrontend.includes('tr("tasks:actions.save_local"') && settingsFrontend.includes('tr("sftp:settings.open_directory"') && settingsFrontend.includes('tr("sftp:settings.auto_save_directory"'));
  const programCacheSource = read("src/program-cache.ts");
  const settingsGeneralSource = settingsViewSource.slice(settingsViewSource.indexOf('id="settings-general"'), settingsViewSource.indexOf('id="settings-basic"'));
  ok("缓存管理独立于通用设置并按分类清理可释放缓存", storageRoutesSource.includes('pathname === "/api/cache"') && storageRoutesSource.includes('searchParams.get("category")') && serverSource.includes("programCacheView") && serverSource.includes("createProgramCacheManager") && programCacheSource.includes("retained_bytes") && programCacheSource.includes('"remote_components"') && programCacheSource.includes('"local_installers"') && read("src/update-installer.ts").includes("clearCache()") && settingsCacheSource.includes("cacheManagementPanelHtml") && settingsCacheSource.includes("data-action=\"cache-clear-category\"") && settingsCacheSource.includes("SFTP 拖出") && settingsCacheSource.includes("清理程序缓存") && settingsViewSource.includes('id="settings-cache"') && settingsViewSource.indexOf('id="settings-cache"') < settingsViewSource.indexOf('id="settings-about"') && !settingsGeneralSource.includes("cacheManagementPanelHtml"));
  ok("桌面端只向系统打开受信任的终端链接协议", desktopSource.includes('/^(https?|ftp|ssh|telnet):\\/\\//i.test(url)'));
  ok("终端支持 Ctrl 加滚轮平稳调整字号并保持当前阅读位置", terminalFrontend.includes("enableTerminalFontWheel") && terminalFrontend.includes("event.ctrlKey") && terminalFrontend.includes("event.stopPropagation()") && terminalFrontend.includes("{passive:false,capture:true}") && terminalFrontend.includes("queueTerminalFontWheelChange") && terminalFrontend.includes("pendingFontWheelDelta") && terminalFrontend.includes("captureTerminalViewport") && terminalFrontend.includes("fitTerminalPreservingViewport") && terminalFrontend.includes("flushTerminalViewportFit(session)") && terminalFrontend.includes("scrollTerminalToLineImmediately") && terminalFrontend.includes("viewport.scrollToLine(line, true)") && terminalFrontend.includes("Math.abs(current - target) < 0.5"));
  ok("终端断开后支持按 Enter 重连并保留屏幕内容和标签级日志", terminalFrontend.includes("连接已关闭，按 Enter 重新连接") && terminalFrontend.includes("terminalReconnectInput(data)") && terminalFrontend.includes("以上终端内容已保留") && !terminalFrontend.includes("session.term.reset()") && terminalFrontend.includes("log_id=") && terminalFrontend.includes("logId:createTerminalLogId()") && terminalSource.includes('url.searchParams.get("log_id")') && read("src/logs.ts").includes("terminalLogIdentity") && read("src/logs.ts").includes("重新连接时间"));
  ok("终端工具栏操作结束后恢复输入焦点", utilsFrontend.includes("function keepTerminalKeyboardClosed(event)") && utilsFrontend.includes("event?.preventDefault?.()") && terminalFrontend.includes("focusTerminalSession(key)") && read("public/app-forwards.js").includes('workspace.tab?.kind === "terminal"') && read("public/app-forwards.js").includes("focusTerminalSession(workspace.tab.key)"));
  ok("终端日志列表单独完整显示日期和时间", logsFrontend.includes("terminalLogPresentation") && logsFrontend.includes('class="log-item-time"') && appCss.includes(".log-item-time") && appCss.includes("white-space:nowrap"));
  ok("远程桌面支持内置 VNC 与系统客户端切换并持久化选择", Boolean(packageJson.dependencies?.["@novnc/novnc"]) && serverSource.includes('pathname.startsWith("/vendor/novnc/")') && remoteFrontend.includes('client_mode:$("remote_vnc_client_mode").value') && dbSource.includes('client_mode:new Set(["auto", "embedded", "system"])') && read("src/vnc-proxy.ts").includes("handleVncUpgrade"));
  ok("VNC 支持可选保存密码并在认证失败后重输更新", remoteFrontend.includes("handleVncSecurityFailure") && remoteFrontend.includes("update_saved_password") && remoteFrontend.includes("VNC 密码可选保存并加密存储") && serverSource.includes('parts[3] === "vnc-credential"') && dbSource.includes("getVncProfileCredential") && fs.existsSync(path.join(root, "scripts/vnc-credential-check.js")));
  ok("其他协议新建表单支持保存并清空且 SSH 更多菜单保持精简", remoteFrontend.includes('data-clear-after-save="1"') && remoteFrontend.includes("连接已保存，可以继续添加") && !connectionsFrontend.includes('label:"复制 SSH 命令"') && !connectionsFrontend.includes('label:"复制 SFTP 命令"') && !connectionsFrontend.includes('label:"用 VS Code Remote SSH 打开"'));
  ok("SSH 与其他连接编辑页支持仅保存、保存并关闭或保存并打开", indexHtml.includes('id="connSaveOnly"') && connectionsFrontend.includes('saveOnly.hidden = false') && connectionsFrontend.includes('connections:auto.save_only') && connectionsFrontend.includes('primarySave.dataset.saveAction = "close"') && connectionsFrontend.includes('saveAndOpen.dataset.closeAfterSave = "1"') && connectionsFrontend.includes('connections:auto.save_close') && connectionsFrontend.includes('connections:auto.save_open') && connectionsFrontend.includes("connectAfterSave") && connectionsFrontend.includes("closeAfterSave") && remoteFrontend.includes('data-save-action="save"') && remoteFrontend.includes('remote:auto.save_only') && remoteFrontend.includes('data-save-action="close"') && remoteFrontend.includes('data-save-action="open"') && remoteFrontend.includes('saveAction === "close" || saveAction === "open"') && remoteFrontend.includes("openRemoteProfile(profile)"));
  ok("连接编辑保存成功静默关闭源标签且错误仍提示", sshEditSaveBranch.includes("sourceTab.pinned = false") && sshEditSaveBranch.includes("closeTabsByKey([sourceTabKey], sourceTabKey)") && !sshEditSaveBranch.includes("notify(") && remoteEditSaveBranch.includes("sourceTab.pinned = false") && remoteEditSaveBranch.includes("closeTabsByKey([sourceTabKey], sourceTabKey)") && !remoteEditSaveBranch.includes("notify(") && remoteFrontend.includes('notify(error.message || tr("remote:notifications.profile_save_failed"'));
  ok("SSH 与其他连接标签右键支持快速编辑且拒绝临时连接", workspaceFrontend.includes("function workspaceTabConnectionEditAction(tab)") && workspaceFrontend.includes("WORKSPACE_SSH_CONNECTION_TAB_KINDS.has(tab.kind)") && workspaceFrontend.includes("WORKSPACE_REMOTE_CONNECTION_TAB_KINDS.has(tab.kind)") && workspaceFrontend.includes("tab?.quick_connection || tab?.transient") && workspaceFrontend.includes('tr("common:command_palette.edit_connection"') && dockingFrontend.includes("workspaceTabConnectionEditAction(tab)"));
  ok("VNC 内部全屏快捷栏位于通用设置并支持可靠顶部边界触发与移出延时", settingsViewSource.includes('id="settings-general"') && settingsViewSource.includes('id="generalVncFullscreenToolbar"') && !settingsFrontend.includes('id="runtimeVncFullscreenToolbar"') && remoteFrontend.includes('class="vnc-fullscreen-toolbar-edge-zone"') && read("public/app-vnc-window.js").includes('addEventListener("pointerover", handleVncFullscreenEdgePointer, true)') && read("public/app-vnc-window.js").includes("VNC_FULLSCREEN_TOOLBAR_HIDE_DELAY_MS = 500") && read("public/app-vnc-window.js").includes("hideVncFullscreenEdgeToolbar(delay=VNC_FULLSCREEN_TOOLBAR_HIDE_DELAY_MS)") && appCss.includes(".vnc-fullscreen-toolbar-edge-zone:hover + .vnc-toolbar") && appCss.includes(".vnc-toolbar:has(:focus-visible)") && !appCss.includes(".vnc-toolbar:focus-within"));
  ok("VNC 新窗口使用原生标题栏并保持弹窗通知可见", desktopSource.includes('fetchJson("/api/remote-profiles")') && !desktopSource.includes("terma:vnc-window-maximize") && !read("desktop/preload.js").includes("toggleVncWindowMaximize") && !remoteFrontend.includes("data-vnc-window-maximize") && appCss.includes("html.vnc-fullscreen-document:fullscreen .modal { z-index:60030; }") && appCss.includes("body.vnc-detached-window-body .app { display:none !important; }") && !appCss.includes("vnc-detached-window-body #toast") && !appCss.includes("vnc-detached-window-body #modal"));
  ok("同一 VNC 连接只保留一个查看器并通过探测页切换窗口", desktopSource.includes("const detachedVncWindows = new Map()") && desktopSource.includes("activeDetachedVncWindow(id)") && desktopSource.includes('ipcMain.handle("terma:vnc-close-profile-window"') && read("desktop/preload.js").includes("closeVncWindowForProfile(profileId)") && remoteFrontend.includes("prepareVncManagementForDetachedWindow") && remoteFrontend.includes("closeRemoteProtocolSession(key)") && remoteFrontend.includes("openRemoteDesktop(id, false, true)") && remoteFrontend.includes("prepareEmbeddedVncWindowSwitch(profile.id)"));
  ok("系统远程客户端启动前重新探测并返回本地化结构化错误", remoteFrontend.includes('api("/api/remote-clients/diagnostics")') && remoteFrontend.includes("localizedRemoteClientReason") && serverSource.includes('failure.publicCode = "remote_client_launch_failed"') && serverSource.includes("failure.publicParams") && read("public/locales/zh-CN/errors.json").includes('"remote_client_launch_failed"') && read("public/locales/en-US/errors.json").includes('"remote_client_launch_failed"'));
  ok("SSH 与其他协议使用独立活动入口并支持单个或全部快捷生成", indexHtml.includes('id="navRemote"') && indexHtml.includes('id="mobileRemote"') && indexHtml.includes('id="conn_remote_generation"') && workspaceFrontend.includes('primaryView === "remote"') && connectionsFrontend.includes('生成其他连接') && remoteFrontend.includes('createRemoteProfileFromSsh') && remoteFrontend.includes('createAllRemoteProfilesFromSsh') && serverSource.includes('data.protocol || "").toLowerCase() === "all"') && dbSource.includes('createAllRemoteProfilesFromConnection') && fs.existsSync(path.join(root, "scripts/remote-profile-from-ssh-check.js")));
  ok("动作菜单左对齐并保留桌面父级子菜单", utilsFrontend.includes("function showActionSubMenu") && utilsFrontend.includes('id = "actionSubMenu"') && connectionsFrontend.includes("children:()=>x11LaunchActions(id)") && connectionsFrontend.includes("children:()=>remoteProfileFromSshActions(id)") && appCss.includes(".action-menu button.has-submenu") && appCss.includes(".context-menu button") && appCss.includes("justify-content:flex-start !important"));
  ok("Windows 内置 X Server 支持自动识别 SSH 图形应用、软件光标和 XDMCP 完整桌面", remoteFrontend.includes("detectX11Applications") && remoteFrontend.includes("x11-applications/verify") && read("src/x11.ts").includes("X11_APPLICATION_CATALOG") && read("src/ssh2-client.ts").includes("openBuiltinX11Channel") && remoteFrontend.includes('xdmcp:{label:"XDMCP"') && dbSource.includes('"rdp", "vnc", "xdmcp", "ftp"') && desktopSource.includes("openXdmcp") && read("desktop/xserver-runtime.js").includes('mode === "broadcast" ? "-broadcast"') && read("desktop/xserver-runtime.js").includes('"-swcursor"') && serverSource.includes("desktopIntegration?.testXdmcp"));
  ok("SSH 派生 RDP 不复用 SSH 用户名且保留显示设置", read("desktop/remote-clients.js").includes("source_ssh_connection_id") && read("desktop/remote-clients.js").includes("writeRdpFile(profile, {omitUsername:true})") && read("desktop/remote-clients.js").includes("dynamic resolution:i:") && dbSource.includes('username:["vnc", "ftp"].includes(protocol)'));
  ok("XDMCP 自动探测桌面与管理常见显示管理器", remoteFrontend.includes("remote_xdmcp_ssh_connection") && remoteFrontend.includes("inspectXdmcpServer") && remoteFrontend.includes("configureXdmcpHost") && dbSource.includes("ssh_connection_id:integer") && serverSource.includes("detectXdmcpServer") && serverSource.includes("configureXdmcpServer") && read("src/xdmcp-manager.ts").includes("lightdm-gtk-greeter") && read("src/xdmcp-manager.ts").includes("WaylandEnable"));
  ok("桌面版可安装当前平台缺少的图形组件", read("desktop/xserver-runtime.js").includes("XQUARTZ_SHA256") && read("desktop/xserver-runtime.js").includes("XQUARTZ_TEAM_ID") && read("desktop/xserver-runtime.js").includes("with administrator privileges") && read("desktop/xserver-runtime.js").includes("installLinuxGraphicsComponents") && remoteFrontend.includes("installXServerComponentsFromManager") && serverSource.includes('pathname === "/api/xserver/install"'));
  ok("旧远程配置无损解除协议白名单约束", dbSource.includes("remote_profiles_legacy_protocol_check") && dbSource.includes("INSERT INTO remote_profiles(id,name,group_name,protocol") && fs.existsSync(path.join(root, "scripts/remote-profile-migration-check.js")));
  ok("SSH 诊断只在明确跳板错误时提示跳板机", read("src/ssh-diagnostics.ts").includes('/jump host|proxyjump|proxy jump|jumphost/') && read("src/ssh-diagnostics.ts").includes('reason = "转发目标连接失败"'));
  ok("连接健康状态使用主题图标且保活字段保持紧凑", connectionsFrontend.includes('class="health-badge${healthClass}"') && connectionsFrontend.includes('title="${escAttr(healthStatusText)}"') && connectionsFrontend.includes('connections:groups.health_status') && !connectionsFrontend.includes('${icon(health?.ok ? "circle-check" : health ? "circle-alert" : "circle-help")} ${esc(healthText)}') && indexHtml.includes("保活间隔（秒）") && indexHtml.includes('id="conn_keepalive_interval_help"'));
  ok("非 UTF-8 终端使用流式双向转码", terminalSource.includes('require("iconv-lite")') && terminalSource.includes("iconv.getDecoder(encoding)") && terminalSource.includes("iconv.encode(text, session.terminalEncoding)") && terminalSource.includes('connection.terminal_encoding || "utf8"'));
  ok("终端显示与日志共享解码文本且交互连接禁用 Nagle", terminalSource.includes("emitTerminalOutput(session, decoded, 1)") && terminalSource.includes("appendTerminalLog(session.logFile, data)") && terminalSource.includes("socket.setNoDelay?.(true)") && read("src/ssh2-client.ts").includes("_sock?.setNoDelay?.(true)"));
  ok("终端默认显示真实交互响应延迟且可在通用设置关闭", frontend.includes('localStorage.getItem("terminalLatencyVisible") !== "0"') && terminalFrontend.includes("startTerminalLatencySample") && terminalFrontend.includes("finishTerminalLatencySample") && terminalFrontend.includes('tr("terminal:latency.hint"') && terminalFrontend.includes('tr("terminal:latency.latest"') && settingsFrontend.includes('id="terminalLatencyVisible"') && settingsFrontend.includes('tr("settings:auto.terminal_latency_hint"'));
  ok("终端连接状态省略时悬停显示完整地址与状态", terminalFrontend.includes("updateTerminalConnectionStatus") && terminalFrontend.includes("updateTerminalStatusForLayout") && terminalFrontend.includes("status.title = `${address}${state ? ` · ${state}` : \"\"}`") && terminalFrontend.includes('title="${esc(connectionAddress)}"'));
  ok("终端工具栏桌面端使用纯图标并在窄屏分行保留全部按钮", appCss.includes("container-name:terminal-view") && appCss.includes("@container terminal-view (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:1080px)") && appCss.includes("@media (min-width:761px) and (hover:hover) and (pointer:fine)") && appCss.includes(".terminal-actions > button > span:not(.composite-icon)") && terminalFrontend.includes('tr("terminal:toolbar.forward_list"') && terminalFrontend.includes('class="terminal-action-forward-list"') && terminalFrontend.includes('icon("earth")'));
  ok("X11、连接快捷入口和窗口标题保持统一", utilsFrontend.includes('name === "x11"') && settingsFrontend.includes('icon("x11")') && terminalFrontend.includes('icon("x11")') && productivityFrontend.includes('class="xserver-x-icon"') && productivityFrontend.includes('<ellipse') && !productivityFrontend.includes('button.innerHTML = icon("x11")') && connectionsFrontend.includes('data-action="connection-open-sftp"') && connectionsFrontend.includes('data-dblclick-action="connection-open-terminal"') && remoteFrontend.includes("remoteDesktopProfilesForProfile") && remoteFrontend.includes("remoteDesktopSwitchProfiles") && remoteFrontend.includes('ondblclick="event.stopPropagation();${primary}"') && workspaceFrontend.includes("syncWorkspaceDocumentTitle") && workspaceFrontend.includes("workspaceTabPresentation({...tab, ...meta") && workspaceFrontend.includes("workspaceDocumentResourceIdentity(resource)") && workspaceFrontend.includes('const parts = ["Terma", endpoint, label') && workspaceFrontend.includes("setWindowTitle?.(document.title)") && desktopSource.includes("normalizeMainWindowTitle(value)"));
  ok("新标签插入当前标签之后且工作区恢复不被启动阶段覆盖", workspaceFrontend.includes("insertion >= 0 ? insertion + 1 : tabs.length") && dockingFrontend.includes("pane.tabs.splice(insertion >= 0 ? insertion + 1 : pane.tabs.length") && appEntry.includes("workspaceRestorePending = true") && workspaceFrontend.includes("if (window.workspaceRestorePending) return") && dockingFrontend.includes("if (window.workspaceRestorePending) return") && appEntry.includes("const restored = restoreTabsState()"));
  ok("SFTP 任务中心宽高跨重启持久化", sftpTasksFrontend.includes('SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1"') && sftpTasksFrontend.includes("persistSftpTaskCenterSize") && sftpTasksFrontend.includes("restoreSftpTaskCenterSize") && sftpTasksFrontend.includes("localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY)"));
  ok("移动端终端 SFTP 按钮保留完整文字宽度", appCss.includes("button.terminal-action-sftp { width:auto; min-width:84px; padding-inline:10px; }"));
  ok("SFTP 打开文件时显示状态并阻止重复请求", sftpFrontend.includes("withSftpFileOpenFeedback") && sftpFrontend.includes('tr("sftp:auto.opening_file"') && sftpFrontend.includes('tr("sftp:auto.opening"'));
  ok("SFTP 文本编辑支持检测、切换并保持编码", read("src/sftp.ts").includes("decodeRemoteText") && read("src/sftp.ts").includes("encodeRemoteText") && sftpFrontend.includes("sftpTextEncodingOptions") && sftpFrontend.includes("persist_default") && dbSource.includes("sftp_text_encoding TEXT NOT NULL DEFAULT 'auto'"));
  ok("SFTP 文件名编码独立切换并持久化", read("src/sftp.ts").includes("decodeRemoteFilenameOutput") && read("src/sftp.ts").includes("remotePathOperand") && sftpFrontend.includes("showSftpFilenameEncodingMenu") && dbSource.includes("sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8'"));
  ok("SFTP 目录导航使用 LRU 缓存并按变化静默刷新", sftpFrontend.includes("sftpDirectoryViewCache") && sftpFrontend.includes("SFTP_DIRECTORY_VIEW_CACHE_TTL_MS") && sftpFrontend.includes("SFTP_DIRECTORY_VIEW_CACHE_MAX_DIRECTORIES") && sftpFrontend.includes("SFTP_DIRECTORY_VIEW_CACHE_MAX_ENTRIES") && sftpFrontend.includes("renderIfChangedOnly:true") && sftpFrontend.includes("sftpDirectoryContentSignature") && sftpFrontend.includes("silent:true") && sftpFrontend.includes("clearSftpDirectoryViewCache"));
  ok("SFTP 文件夹大小按需递归读取精确字节并兼容 GNU/BSD stat", sftpBackend.includes("buildRemoteDirectorySizeCommand") && sftpBackend.includes("stat -c '%s'") && sftpBackend.includes("stat -f '%z'") && sftpBackend.includes('find "$TERMA_TARGET" -type f') && sftpBackend.includes("未返回不完整大小") && !sftpBackend.includes("du -") && serverSource.includes('parts[4] === "directory-size"') && sftpFrontend.includes("sftpDirectorySizeButtonHtml") && sftpFrontend.includes("/sftp/directory-size"));
  ok("终端与 SFTP 可以按连接双向跳转", terminalFrontend.includes("openSftp(${c.id})") && sftpFrontend.includes("openTerminal(${id})"));
  ok("SFTP 支持可暂停续传的跨主机复制", sftpJobsSource.includes("createCheckpointTransfers") && sftpJobsSource.includes("checkpoint_manifest") && sftpJobsSource.includes("checkpoint_staging_path") && !sftpJobsSource.includes("source.stdout.pipe(target.stdin)") && sftpFrontend.includes("/sftp/cross-copy"));
  ok("终端与批量命令共享严格 WebSocket 帧解析器", terminalSource.includes("WebSocketFrameParser") && read("src/commands.ts").includes("WebSocketFrameParser") && read("src/websocket.ts").includes("客户端 WebSocket 数据帧必须掩码") && read("src/websocket.ts").includes("fragmentOpcode"));
  ok("连接列表消除转发 N+1 查询并补索引", dbSource.includes('all("SELECT * FROM connection_forwards ORDER BY connection_id,id")') && dbSource.includes("idx_connection_forwards_connection_id") && dbSource.includes("idx_connections_group_sort"));
  ok("SFTP 状态防抖原子写入且日志使用缓冲队列", sftpJobsSource.includes("setTimeout(() => persistJobs(true), 400)") && read("src/sftp-job-store.ts").includes("fs.renameSync(temporary, file)") && read("src/logs.ts").includes("queueLogWrite") && !read("src/logs.ts").includes("fs.appendFileSync(logFile"));
  ok("同名私钥不会绕过连接级绑定", importerSource.includes("identity_file: null") && importerSource.includes("missing_identity: Boolean(keyName)") && !importerSource.includes("identityFileMap") && serverSource.includes("const target = requested ?") && !serverSource.includes("existingByName.get(keyName)"));
  ok("私钥绑定只接受已枚举路径", serverSource.includes("allowedPaths.has(path.resolve(requested))") && serverSource.includes("私钥绑定无效，请重新选择"));
  ok("SSH config 与数据库恢复允许保留未绑定私钥", !importFrontend.includes("个连接尚未绑定私钥") && importFrontend.includes("未重新绑定的普通私钥路径会被清除") && serverSource.includes("updateIdentity.run(null, item.connection_id)") && !serverSource.includes("数据库备份中的连接尚未全部绑定私钥"));
  ok("数据库恢复后重新打开句柄并自动刷新", backupRestoreRoutesSource.includes("dependencies.reopenDatabase()") && backupRestoreRoutesSource.includes("database_reopened:true") && importFrontend.includes("数据库已恢复并自动刷新") && importFrontend.includes("await loadAll()"));
  ok("数据库迁移包同步启用或关闭加密状态", backupRestoreRoutesSource.includes("if (stage.security) {") && backupRestoreRoutesSource.includes("encryption_enabled:Boolean(stage.security.encryption_enabled)"));
  ok("导入导出按 SSH config 与数据库拆分", workspaceFrontend.includes("SSH config 导入导出") && workspaceFrontend.includes("数据库导入导出") && indexHtml.indexOf("导出 SSH config") < indexHtml.indexOf("数据库导入导出"));
  ok("设置活动栏按职责重组并把缓存管理放在关于上方", workspaceFrontend.includes('"settings-general", "settings-2", "common:auto.general_settings"') && workspaceFrontend.includes('"settings-basic", "shield-check", "common:auto.security"') && workspaceFrontend.includes('"settings-cache", "hard-drive", "common:auto.cache_management"') && workspaceFrontend.indexOf('"settings-cache", "hard-drive", "common:auto.cache_management"') < workspaceFrontend.indexOf('"settings-about", "info", "common:auto.about"') && !workspaceFrontend.includes('"settings-advanced"') && settingsFrontend.indexOf("storageSettingsPanelHtml()") < settingsFrontend.indexOf('id="settings-basic"'));
  ok("桌面设置并入程序且菜单去重", settingsFrontend.includes("desktopBehaviorPanelHtml") && settingsFrontend.includes("storageSettingsPanelHtml") && storageRoutesSource.includes('pathname === "/api/desktop-settings"') && desktopSource.includes("desktopIntegration") && !appMenuSource.includes('{ label: "设置"') && !trayMenuSource.includes('{ label: "设置"') && !trayMenuSource.includes("备份配置数据库"));
  ok("桌面窗口隐藏原生菜单栏且保留托盘右键菜单", desktopSource.includes('const PRODUCT_NAME = "Terma"') && appMenuSource.includes("Menu.setApplicationMenu(null)") && trayMenuSource.includes('desktopUiText(`打开 ${PRODUCT_NAME}`, `Open ${PRODUCT_NAME}`)') && trayMenuSource.includes('desktopUiText("在浏览器打开", "Open in browser")') && trayMenuSource.includes('desktopUiText(`退出 ${PRODUCT_NAME}`, `Quit ${PRODUCT_NAME}`)'));
  ok("桌面原生标题栏与应用明暗主题同步", desktopSource.includes('preload: path.join(__dirname, "preload.js")') && desktopSource.includes("nativeTheme.themeSource = theme") && desktopSource.includes('ipcMain.on("terma:set-theme"') && read("desktop/preload.js").includes('ipcRenderer.send("terma:set-theme"') && read("public/app-utils.js").includes("window.termaDesktop?.setTheme?.(theme)"));
  ok("桌面最小化后终端输出继续刷新且标签切换不暂停后台会话", desktopSource.includes("backgroundThrottling: false")
    && terminalFrontend.includes("queueTerminalOutput(session, terminalOutput)")
    && terminalOutputFrontend.includes("session.terminalOutputFrame = setTimeout")
    && !terminalOutputFrontend.includes("requestAnimationFrame(() => drainTerminalOutput")
    && !terminalOutputFrontend.includes("activeTabKey")
    && terminalOutputFrontend.includes("function refreshTerminalSessionsAfterWindowResume()")
    && appEntry.includes('window.addEventListener("focus", scheduleTerminalWindowResumeRefresh)'));
  ok("桌面活动栏切换整个操作面板并支持调节宽度", !indexHtml.includes('id="operationPaneToggle"') && indexHtml.includes('id="operationPaneExpand"') && indexHtml.includes('data-action="static-operation-expand"') && indexHtml.includes('id="operationPaneCollapse"') && indexHtml.includes('id="activityBarResize"') && indexHtml.includes('class="brand-mark"') && indexHtml.includes('class="brand-name-full"') && indexHtml.includes('data-primary="connections" data-explorer="true"') && indexHtml.includes('data-primary="settings" data-explorer="true"') && staticActionsFrontend.includes('registerTermaAction("static-operation-expand"') && workspaceFrontend.includes("name === primaryView ? !operationPaneCollapsed : false") && workspaceFrontend.includes('localStorage.setItem("operationPaneCollapsed"') && workspaceFrontend.includes('localStorage.setItem("activityBarWidth"') && appCss.includes("--activity-bar-width:40px") && appCss.includes("grid-template-columns:var(--activity-bar-width) minmax(0,1fr)") && appCss.includes(".brand-mark { width:24px") && appCss.includes(".brand-name-full { white-space:nowrap; }") && appCss.includes(".app.operation-pane-collapsed .operation-pane-expand"));
  ok("桌面操作区宽度可调并记忆，移动端隐藏调节柄", indexHtml.includes('id="operationPaneResize"') && workspaceFrontend.includes("OPERATION_PANE_WIDTH_DEFAULT = 292") && workspaceFrontend.includes("OPERATION_PANE_WIDTH_MIN = 260") && workspaceFrontend.includes("OPERATION_PANE_WIDTH_MAX = 520") && workspaceFrontend.includes('localStorage.setItem("operationPaneWidth"') && workspaceFrontend.includes("function applyOperationPaneWidth") && appCss.includes("--operation-pane-width:292px") && appCss.includes(".operation-pane-resizer") && appCss.includes(".operation-pane-narrow .conn-footer") && appCss.includes(".operation-pane-pin, .operation-pane-collapse, .operation-pane-pin-guide, .operation-pane-resizer { display:none !important; }"));
  ok("七个操作区分别固定或点击工作区自动收起并提供一次性引导", indexHtml.includes('id="operationPanePin"') && indexHtml.includes('id="operationPanePinGuide"') && appState.includes("operationPanePinnedByView = loadOperationPanePinnedState()") && workspaceFrontend.includes('OPERATION_PANE_PRIMARY_VIEWS = ["connections", "remote", "running", "command", "import", "logs", "settings"]') && workspaceFrontend.includes('OPERATION_PANE_PIN_GUIDE_STORAGE_KEY = "operationPanePinGuideSeenV3"') && workspaceFrontend.includes("content.addEventListener(\"click\", handleOperationPaneContentClick, true)") && workspaceFrontend.includes("if (isMobileLayout() || event.button !== 0) return") && workspaceFrontend.includes("positionOperationPanePinGuide") && appCss.includes("--operation-pane-pin-guide-anchor") && appCss.includes(".operation-pane-pin, .operation-pane-collapse, .operation-pane-pin-guide, .operation-pane-resizer { display:none !important; }"));
  ok("主题和刷新入口位于活动栏底部且保留移动端入口", indexHtml.indexOf('id="themeToggle"') > indexHtml.indexOf('class="activity-bottom"') && indexHtml.indexOf('id="activityRefresh"') > indexHtml.indexOf('id="themeToggle"') && indexHtml.indexOf('class="github-link"') > indexHtml.indexOf('id="activityRefresh"') && indexHtml.includes("mobile-brand-action theme-toggle") && read("public/app-utils.js").includes('querySelectorAll(".theme-toggle")'));
  ok("终端工具栏使用紧凑单行控件", appCss.includes(".terminal-actions { flex:1 1 590px; flex-wrap:nowrap") && appCss.includes(".terminal-actions button { flex:0 0 auto; height:30px") && appCss.includes(".terminal-actions button > svg.lucide { width:14px"));
  ok(
    "桌面工作区标题、标签可调且终端内容使用窄边距",
    appCss.includes("--workspace-header-height:42px")
      && appCss.includes("--workspace-tab-height:32px")
      && appCss.includes(".left-pane { grid-template-rows:var(--workspace-header-height)")
      && appCss.includes(".brand, .topbar { height:var(--workspace-header-height)")
      && appCss.includes(".tabs-shell { position:relative; height:var(--workspace-tab-height)")
      && appCss.includes(".workspace-pane.terminal-pane > .workspace { padding:4px 2px 2px; scrollbar-gutter:auto; }")
      && dockingFrontend.includes('localStorage.setItem("workspaceHeaderHeight"')
      && dockingFrontend.includes('localStorage.setItem("workspaceTabHeight"')
  );
  ok("分屏间隔保持窄视觉和宽拖动热区", appCss.includes("2px minmax(0,calc(100% - var(--workspace-split-ratio) - 2px))") && appCss.includes("width:10px; justify-self:center; cursor:col-resize") && appCss.includes("height:10px; align-self:center; cursor:row-resize") && terminalFrontend.includes("overviewRuler:{width:8}"));
  ok("欢迎页转发计数随当前状态实时刷新", appEntry.includes('if (activeView === "welcome") renderStartupSummary()') && workspaceFrontend.includes('forward.status === "running"') && workspaceFrontend.includes('forward.status === "reconnecting"') && workspaceFrontend.includes('forward.status === "failed"') && workspaceFrontend.includes('class="startup-count-card" data-startup-state="running"') && workspaceFrontend.includes('class="startup-count-card" data-startup-state="reconnecting"') && workspaceFrontend.includes('data-startup-state="failed"') && workspaceFrontend.includes('tr("common:workspace.running_label"') && workspaceFrontend.includes('tr("common:workspace.startup_failed_label"') && appCss.includes(".startup-counts .startup-count-card strong") && appCss.includes(".startup-counts .startup-count-card small") && !workspaceFrontend.includes("异常 ${failed}") && !workspaceFrontend.includes("转发成功 ${success}"));
  ok("转发失败状态显示原因、时间并打开对应日期日志", workspaceFrontend.includes('tr("common:workspace.ready_with_failures"') && workspaceFrontend.includes('data-startup-state="failed"') && workspaceFrontend.includes('"common:workspace.failure_logs"') && runningFrontend.includes("const failedCount") && runningFrontend.includes("forwardStatusText(forward.status)") && runningFrontend.includes("forward.last_error") && runningFrontend.includes('tr("connections:forwards.failed_at"') && runningFrontend.includes("openSystemLogAt") && forwardsFrontend.includes("function forwardEventTimeText") && !forwardsFrontend.includes('|| "未运行"') && logsFrontend.includes("async function openSystemLogAt(timestamp)"));
  ok("停止全部转发会刷新状态并清理异常与待恢复项", forwardsFrontend.includes("function forwardNeedsStop(forward)") && forwardsFrontend.includes('status !== "stopped"') && forwardsFrontend.includes('Boolean(Number(forward?.restore || 0))') && forwardsFrontend.indexOf("await loadAll();") < forwardsFrontend.indexOf("const targets = connections.filter(c => (c.forwards || []).some(forwardNeedsStop));") && forwardsFrontend.includes('tr("common:notifications.exact.no_stoppable_forwards"') && desktopSource.includes("function forwardNeedsStop(forward)") && desktopSource.includes("(item.forwards || []).some(forwardNeedsStop)") && dbSource.includes('["failed", "reconnecting"].includes(forward.status)'));
  ok("连接转发操作使用紧凑图标并保留完整提示", appCss.includes(".conn-actions button { width:28px; min-width:28px;") && frontend.includes("connectionCompactToggleButton") && frontend.includes('aria-label="${escAttr(text)}"') && frontend.includes("connection-forward-toggle"));
  ok("Web 数据路径支持跨根目录浏览、安全远程管理与自动重启", settingsFrontend.includes("openStorageDirectoryBrowser") && settingsFrontend.includes("data-storage-root") && storageRoutesSource.includes('pathname === "/api/storage/directories"') && storageRoutesSource.includes("storageManagementAvailable") && storageRoutesSource.includes("!dependencies.authRequired(request)") && serverSource.includes("restart-web.js") && fs.existsSync(path.join(root, "scripts/restart-web.js")) && read("src/config.ts").includes(".terma-storage.json") && read("src/config.ts").includes(".tunneldesk-storage.json"));
  ok("活动栏按钮整栏居中且选中线独立", appCss.includes('.activity button, .activity a { position:relative; width:100%') && appCss.includes('.activity button.active::before') && !appCss.includes('width:46px; min-height:44px;'));
  ok("新版本提醒支持已读和按版本忽略", settingsFrontend.includes("termaUpdateReadVersion") && settingsFrontend.includes("tunneldeskUpdateReadVersion") && settingsFrontend.includes("sessionStorage") && settingsFrontend.includes("markUpdateNoticeRead") && settingsFrontend.includes("update_ignored") && settingsFrontend.includes("setUpdateVersionIgnored") && indexHtml.includes("navSettingsUpdateDot") && updateRouteSource.includes('pathname === "/api/updates/ignore"') && read("public/app-utils.js").includes('event.type === "update" && updateSettings?.update_ignored'));
  ok("更新页按从新到旧展示最近十个正式版本并保留滚动位置", read("src/update-checker.ts").includes("release_notes: releases.slice(0, 10)") && read("src/update-checker.ts").includes("releases?per_page=10") && settingsFrontend.includes("updateReleaseNotesHtml") && settingsFrontend.includes("update.release_notes.slice(0, 10)") && settingsFrontend.includes("updateNotesScrollTop") && settingsFrontend.includes("renderUpdateStatus") && settingsFrontend.includes("最近版本更新内容"));

  ok("活动栏宽度变化会重排全部分屏", workspaceFrontend.includes('typeof scheduleWorkspaceChromeFit === "function"') && workspaceFrontend.includes("scheduleWorkspaceChromeFit();"));
  ok("终端滚动条和边框跟随终端背景保持低对比样式", terminalFrontend.includes('scrollbarSliderBackground:dark ? "#475569" : "#cbd5e1"') && terminalFrontend.includes("overviewRulerBorder:background") && appCss.includes(".terminal-box .xterm-scrollable-element > .scrollbar { background:transparent !important; }") && appCss.includes("var(--terminal-background,var(--code))"));

  const base = (await webUrl(packageJson, licenseText)).replace(/\/$/, "");
  try {
    const savedLogSettings = await fetch(`${base}/api/logs/settings`, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({retention_days:7,max_file_size_mb:1,max_total_size_mb:10,rotation_files:2})
    }).then(response=>response.json());
    const logs = await fetch(`${base}/api/logs`).then(response=>response.json());
    const systemLog = logs.system?.[0];
    const windowResult = systemLog
      ? await fetch(`${base}/api/logs/read?path=${encodeURIComponent(systemLog.path)}&limit=4096&query=Terma`).then(response=>response.json())
      : null;
    ok("日志设置、分段读取和服务端搜索接口", savedLogSettings.retention_days === 7 && savedLogSettings.max_file_size_mb === 1 && savedLogSettings.max_total_size_mb === 10 && savedLogSettings.rotation_files === 2 && windowResult && typeof windowResult.text === "string" && Number.isInteger(windowResult.offset) && Array.isArray(windowResult.matches));
  } catch (error) {
    ok("日志设置、分段读取和服务端搜索接口", false, error.message);
  }
  const isolatedRegression = process.env.TERMA_REGRESSION_ISOLATED === "1" || process.env.TUNNELDESK_REGRESSION_ISOLATED === "1";
  if (!isolatedRegression) {
    ok("数据库恢复检查返回分组、逐连接引用、原验证方式和默认排序", true, "非隔离环境已安全跳过");
    ok("数据库恢复复用暂存文件、重开句柄并立即刷新", true, "非隔离环境已安全跳过");
  } else {
    const restoreFixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-restore-regression-"));
    const restoreFixturePath = path.join(restoreFixtureDirectory, "fixture.db");
    let restoreFixtureDb = null;
    let originalDatabaseBundle = null;
    try {
      const isolatedDataDirectory = await verifyIsolatedRegressionTarget(base);
      ok("隔离回归拒绝项目和用户数据目录", true, isolatedDataDirectory);
      // Preserve the complete database before the live restore so direct isolated runs are reversible.
      originalDatabaseBundle = await captureDatabaseBundle(base);
      ok("隔离回归先保存完整数据库备份", true, `${originalDatabaseBundle.length} bytes`);
      const { DatabaseSync } = require("node:sqlite");
      const missingKeyName = `missing-regression-${process.pid}-${Date.now()}`;
      restoreFixtureDb = new DatabaseSync(restoreFixturePath);
      restoreFixtureDb.exec(`CREATE TABLE connections (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT '测试',
        ssh_host TEXT NOT NULL, ssh_port INTEGER NOT NULL DEFAULT 22, ssh_user TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'key', identity_file TEXT, ssh_password TEXT, tags TEXT, extra_args TEXT,
        autostart_forwards INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`);
      const insert = restoreFixtureDb.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
      for (let index = 1; index <= 12; index += 1) {
        insert.run(index, `fixture-${index}`, "测试", `fixture-${index}.invalid`, 22, "root", "key", `C:\\old\\.ssh\\${missingKeyName}`, index, index);
      }
      restoreFixtureDb.close();
      restoreFixtureDb = null;
      const response = await fetch(`${base}/api/restore/database/check`, {method:"POST", body:fs.readFileSync(restoreFixturePath)});
      const restoreCheck = await response.json().catch(() => null);
      ok("数据库恢复检查返回分组、逐连接引用、原验证方式和默认排序", response.ok && restoreCheck?.missing_identities?.length === 1 && restoreCheck.missing_identities[0].key_name === missingKeyName && restoreCheck.missing_identities[0].connection_count === 12 && restoreCheck.missing_identities[0].connection_names?.length === 12 && restoreCheck.unresolved_identities?.length === 12 && restoreCheck.connections?.length === 12 && restoreCheck.connections.every(item => item.original_auth_type === "key" && item.sort_order === 1) && typeof restoreCheck.upload_directory === "string");
      if (restoreCheck?.restore_token) {
        const restoredResponse = await fetch(`${base}/api/restore/database`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({restore_token:restoreCheck.restore_token, credential_bindings:[]})
        });
        const restored = await restoredResponse.json().catch(()=>null);
        const refreshed = await fetch(`${base}/api/connections`).then(item=>item.json()).catch(()=>[]);
        ok("数据库恢复复用暂存文件、重开句柄并立即刷新", restoredResponse.ok && restored?.database_reopened === true && refreshed.length === 12 && refreshed.every(item=>item.sort_order === 1));
      }
    } catch (error) {
      ok("数据库恢复检查返回分组、逐连接引用、原验证方式和默认排序", false, error.message);
    } finally {
      try { restoreFixtureDb?.close(); } catch {}
      try { fs.rmSync(restoreFixtureDirectory, {recursive:true, force:true}); } catch {}
      if (originalDatabaseBundle) {
        try {
          await restoreDatabaseBundle(base, originalDatabaseBundle);
          ok("隔离回归结束恢复原数据库", true);
        } catch (error) {
          ok("隔离回归结束恢复原数据库", false, error.message);
        }
      }
    }
  }
  const about = await checkFetch(`${base}/api/about`, "Web API /api/about");
  ok(
    "关于接口版本与许可元数据一致",
    about?.product_name === "Terma"
      && about?.version === packageJson.version
      && about?.license === packageJson.license
      && about?.repository_url === packageJson.homepage,
    about ? `${about.product_name || "?"} v${about.version || "?"} · ${about.license || "?"}` : "无响应"
  );
  ok("关于接口不返回作者邮箱", typeof about?.author === "string" && !about.author.includes("<") && !about.author.includes(">"));
  ok(
    "关于接口返回完整 GPL v3 正文",
    typeof about?.license_text === "string"
      && about.license_text === licenseText
      && about.license_text.includes("GNU GENERAL PUBLIC LICENSE")
      && about.license_text.includes("END OF TERMS AND CONDITIONS"),
    typeof about?.license_text === "string" ? `${about.license_text.length} 字符` : "无正文"
  );
  ok(
    "关于接口返回组件、版本与许可证清单",
    Array.isArray(about?.third_party_components)
      && about.third_party_components.length >= 11
      && about.third_party_components.every(item => item?.name && item?.version && item?.license && /^https:\/\//.test(String(item?.project_url || "")))
      && about.third_party_components.some(item => item.name === "jsdiff" && item.version === "9.0.0" && item.license === "BSD-3-Clause")
      && about.third_party_components.some(item => item.name === "node-x11" && item.version === "3.9.1" && item.license === "MIT")
      && about.third_party_notices_available === true,
    Array.isArray(about?.third_party_components) ? `${about.third_party_components.length} 项组件` : "无组件清单"
  );
  const updateStatus = await checkFetch(`${base}/api/updates/status`, "Web API /api/updates/status");
  ok("更新状态接口不联网即可返回当前版本", updateStatus?.current_version === packageJson.version && typeof updateStatus?.update_available === "boolean");
  const connections = await checkFetch(`${base}/api/connections`, "Web API /api/connections");
  if (Array.isArray(connections)) {
    ok("连接列表响应为数组", true, `${connections.length} 条连接`);
    ok("连接 API 不返回 SSH 密码", connections.every(item => !("ssh_password" in item)));
    ok("连接 API 返回有效排序值", connections.every(item => Number.isInteger(item.sort_order) && item.sort_order >= 1));
  }
  else ok("连接列表响应为数组", false);

  const keys = await checkFetch(`${base}/api/identity-files`, "Web API /api/identity-files");
  ok("密钥列表包含来源信息", Array.isArray(keys) && keys.every(item => item.source && item.source_label));

  const diagnostics = await checkFetch(`${base}/api/diagnostics/runtime`, "Web API /api/diagnostics/runtime");
  if (diagnostics?.pty?.available && diagnostics.platform === "darwin") {
    ok("PTY diagnostics include spawn-helper", Boolean(diagnostics.pty.helper_exists), diagnostics.pty.helper_path || "not found");
  }
  ok("运行诊断包含日志目录", Boolean(diagnostics?.log_dir), diagnostics?.log_dir || "");
  ok("运行诊断包含 PTY 状态", typeof diagnostics?.pty?.available === "boolean");
  ok("运行诊断包含 PTY 可运行状态", typeof diagnostics?.pty?.operational === "boolean");

  const startup = await checkFetch(`${base}/api/startup-status`, "Web API /api/startup-status");
  ok("启动状态包含实际 Web 地址", Boolean(startup?.local_url), startup?.local_url || "");
  ok("启动状态包含自动转发汇总", startup?.autostart && typeof startup.autostart.failed === "number");

  const snapshots = await checkFetch(`${base}/api/config-snapshots`, "Web API /api/config-snapshots");
  ok("配置快照列表响应为数组", Array.isArray(snapshots), Array.isArray(snapshots) ? `${snapshots.length} 个快照` : "");
  ok("批量命令提供 TXT/JSON 导出", frontend.includes('tr("terminal:batch.export_txt"') && frontend.includes('tr("terminal:batch.export_json"'));
  ok("SSH 连接支持批量选择、设置与删除", frontend.includes("toggleConnectionBulkMode") && frontend.includes("openConnectionBulkSettings") && frontend.includes("/api/connections/bulk-update") && frontend.includes("performBulkDeleteConnections"));
  ok("新增 SSH 连接支持保存并清空或保存并连接", indexHtml.includes('id="connSaveAndClear"') && indexHtml.includes("保存并清空") && indexHtml.includes('data-action="static-connection-save-clear"') && indexHtml.includes('id="connSaveAndConnect"') && indexHtml.includes("保存并连接") && indexHtml.includes('data-action="static-connection-save-connect"') && frontend.includes("表单已清空") && frontend.includes("connectAfterSave") && frontend.includes("closeTabsByKey") && frontend.includes("openTerminal(savedConnectionId)"));
  ok("SSH 测试失败保持在页面内且按钮测试期间禁用", indexHtml.includes('id="connTestBtn"') && indexHtml.includes('id="connTestStatus"') && indexHtml.includes('data-action="static-connection-test"') && frontend.includes('tr("connections:form.testing"') && frontend.includes('tr("connections:form.test_unable"') && read("src/ssh2-client.ts").includes("normalizeSshTransportError(error, connection)") && read("src/ssh2-client.ts").includes("SSH 握手超时，请检查主机地址、端口和 SSH 服务") && read("src/ssh2-client.ts").includes('client.on("error", onError)') && read("src/ssh2-client.ts").includes('client.on("error", reportError)') && read("src/ssh2-client.ts").includes('child.on("error", () => {})'));
  ok("SSH 批量设置仅允许分组、端口和登录凭据", dbSource.includes("function bulkUpdateConnections") && dbSource.includes('changes, "group_name"') && dbSource.includes('changes, "ssh_port"') && serverSource.includes("所选私钥不在允许的密钥目录中"));
  ok("转发列表全选同步全选与半选状态", frontend.includes('id="forwardSelectAll"') && frontend.includes("selectAll.indeterminate") && frontend.includes('tr("connections:forwards.select_all"'));

  const failed = checks.filter(item => !item.pass);
  if (failed.length) {
    console.error(`回归检查失败：${failed.length} 项`);
    process.exit(1);
  }
  console.log(`回归检查通过：${checks.length} 项`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
