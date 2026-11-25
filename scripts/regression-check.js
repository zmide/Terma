const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expectedArtifacts, relevantArtifacts, verifyReleaseVersion } = require("./release-artifacts-check");
const { verifyMacIconPadding } = require("./mac-icon-padding-check");
const runWorkspaceDockingChecks = require("./workspace-docking-check");
const { LEGACY_BUNDLE, LEGACY_INPUTS, indexScriptFiles, readFrontendDomain } = require("./frontend-source");
const { readBackendSource, readSftpJobSource, readSources } = require("./backend-source");
const { loadFrontendService } = require("./frontend-service-test-helper");
const { main: runAiBoundaryChecks } = require("./ai-check");
const ts = require("typescript-legacy");

const root = path.resolve(__dirname, "..");
const checks = [];
const frontendFiles = indexScriptFiles(root);
const frontendSources = indexScriptFiles(root, {expandLegacy:true});

function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  const mark = pass ? "OK" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ""}`);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

async function checkLegacyDelivery(base) {
  const request = (file, method) => fetch(`${base}/${file}`, {
    method, redirect:"manual", signal:AbortSignal.timeout(8000)
  });
  try {
    const bundle = await request(path.posix.basename(LEGACY_BUNDLE), "GET");
    const type = bundle.headers.get("content-type") || "";
    const body = await bundle.text();
    ok("兼容脚本旧构建产物已退出", bundle.status === 404 && !fs.existsSync(path.join(root, LEGACY_BUNDLE)));
    const retiredScripts = [...LEGACY_INPUTS, "app.js", "app-docking.js", "app-workspace.js", "app-workspace-groups.js", "app-i18n.js", "app-named-workspaces.js", "app-workspace-persistence.js", "app-vnc-clipboard.js", "app-vnc.js", "app-x11.js", "app-remote.js", "app-remote-profiles.js", "app-desktop-integration.js", "app-forwards.js", "app-linux-desktop.js", "app-quick-connect.js", "app-api.js", "app-settings-runtime.js", "app-settings.js", "app-settings-security.js", "app-connection-form.js", "app-connections-list.js"];
    const statuses = await Promise.all(retiredScripts.map(async file => {
      const response = await request(file, "HEAD");
      return {file, status:response.status};
    }));
    const failures = statuses.filter(({status}) => status !== 404);
    ok("已退出的兼容脚本旧地址返回 404", !failures.length,
      failures.length ? failures.map(({file, status}) => `${file}: ${status}`).join(", ") : `${statuses.length} 个`);
  } catch (error) {
    ok("兼容脚本及旧地址的 HTTP 交付", false, error.message);
  }
}

function typeScriptFiles(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes:true})) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
    }
  };
  visit(path.join(root, directory));
  return files;
}

function readTypeScriptTree(directory) {
  return typeScriptFiles(directory).map(file => fs.readFileSync(file, "utf8")).join("\n");
}

function hasNativeDialogCall(source) {
  // Resolve each file separately: a local confirm helper must not hide an unbound call in another file.
  const filename = "native-dialog-check.ts";
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram([filename], { noLib:true, noResolve:true }, {
    getSourceFile:file => file === filename ? tree : undefined,
    getDefaultLibFileName:() => "", writeFile:() => {}, getCurrentDirectory:() => "",
    getDirectories:() => [], fileExists:file => file === filename,
    readFile:file => file === filename ? source : undefined,
    getCanonicalFileName:file => file, useCaseSensitiveFileNames:() => true, getNewLine:() => "\n"
  });
  const checker = program.getTypeChecker();
  const names = new Set(["alert", "confirm", "prompt"]);
  const globals = new Set(["window", "globalThis", "self"]);
  let found = false;
  function visit(node) {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && names.has(callee.text)) {
        const symbol = checker.getSymbolAtLocation(callee);
        const local = symbol?.declarations?.some(declaration =>
          !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient)
          && !(ts.isFunctionDeclaration(declaration) && !declaration.body));
        if (!local) found = true;
      }
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && globals.has(callee.expression.text) && names.has(callee.name.text)) found = true;
      if (ts.isElementAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && globals.has(callee.expression.text) && callee.argumentExpression
        && ts.isStringLiteral(callee.argumentExpression) && names.has(callee.argumentExpression.text)) found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
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
    throw new Error("无法确认回归服务的数据目录，拒绝执行写入用例");
  }
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const relative = path.relative(path.resolve(os.tmpdir()), resolvedDataDirectory);
  const temporaryRoot = relative.split(path.sep)[0] || "";
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !temporaryRoot.startsWith("terma-web-regression-")) {
    throw new Error(`写入用例只能指向 terma-web-regression 临时目录，当前目标：${resolvedDataDirectory}`);
  }
  return resolvedDataDirectory;
}

async function main() {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
    console.log("Usage: node scripts/regression-check.js\nTERMA_CHECK_URL points to a running Terma instance (read-only by default).\nRun node scripts/web-regression-harness.js for isolated write tests.");
    return;
  }
  await runAiBoundaryChecks();
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
  const extraResources = Array.isArray(packageJson.build?.extraResources) ? packageJson.build.extraResources : [];
  const hasExtraResource = name => extraResources.some(item => item === name || (item && typeof item === "object" && item.from === name && item.to === name));
  ok("Linux desktop filename uses package metadata accepted by electron-builder", packageJson.desktopName === "terma.desktop" && !Object.prototype.hasOwnProperty.call(packageJson.build?.linux || {}, "desktopName"));
  ok("GNU GPL v3 license is declared and packaged", packageJson.license === "GPL-3.0-only" && licenseText.includes("GNU GENERAL PUBLIC LICENSE") && hasExtraResource("LICENSE"));
  ok("第三方组件声明随桌面安装包提供", hasExtraResource("THIRD_PARTY_NOTICES.md") && thirdPartySource.includes("listThirdPartyComponents") && ["xterm.js","Ace Editor","jsdiff","jsPDF","svg2pdf.js","Noto Sans SC","noVNC","TigerVNC Viewer","ZMODEM.js","ssh2","node-x11","i18next","Lucide","Electron","node-pty","VcXsrv"].every(name => thirdPartySource.includes(`name:\"${name}\"`)) && ["xterm.js","Ace Editor","jsdiff","jsPDF","svg2pdf.js","Noto Sans SC","noVNC","TigerVNC Viewer","zmodem.js","ssh2","node-x11","i18next","Lucide","Electron","node-pty","VcXsrv"].every(name => thirdPartyNotices.includes(`## ${name}`)));
  const vueNotices = read("frontend/dist/THIRD_PARTY_NOTICES.txt");
  ok("Vue、Tile UI 与 Kumo 组件信息和完整许可证随前端提供", ["Vue","Tile UI","Kumo"].every(name => thirdPartySource.includes(`name:\"${name}\"`) && thirdPartyNotices.includes(`## ${name}`)) && ["frontend/third-party/vue/LICENSE","frontend/third-party/i18next/LICENSE","frontend/third-party/tile-ui/LICENSE","frontend/src/styles/themes/LICENSE.kumo"].every(file => vueNotices.includes(read(file))) && packageJson.build.files.includes("frontend/dist/**/*"));
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
    macos: ["Terma-1.2.3-macos-x64.dmg", "Terma-1.2.3-macos-arm64.dmg"],
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
      && releaseWorkflow.includes("runs-on: [self-hosted, macOS, ARM64, terma-signer]")
      && releaseWorkflow.includes("environment: macos-signing")
      && releaseWorkflow.includes("Sign and notarize macOS DMGs")
      && !releaseWorkflow.includes("terma-macos-unsigned-x64-arm64")
      && releaseWorkflow.includes("--mac dmg --x64 --arm64 --publish never")
      && !releaseWorkflow.includes("--mac dmg zip --x64 --arm64 --publish never")
      && releaseWorkflow.includes("Remove unused macOS blockmaps")
      && releaseWorkflow.includes("if-no-files-found: error")
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
  const sftpViewSource = read("frontend/src/features/files/sftp/SftpView.ts");
  const sftpDirectoryLoaderSource = read("frontend/src/features/files/sftp/directory-loader.ts");
  const sftpDirectoryRequestsSource = read("frontend/src/features/files/sftp/directory-requests.ts");
  const sftpDirectoryCacheSource = read("frontend/src/features/files/sftp/directory-cache.ts");
  const sftpColumnLayoutSource = read("frontend/src/features/files/sftp/column-layout.ts");
  const sftpFileOpenSource = read("frontend/src/features/files/sftp/file-open-service.ts");
  const sftpFrontend = [
    read("frontend/src/entries/about-embed.ts"),
    readTypeScriptTree("frontend/src/features/files/sftp"),
    read("frontend/src/features/files/file-layout.ts"),
    readTypeScriptTree("frontend/src/features/quick")
  ].join("\n");
  const sftpCopyServiceSource = read("frontend/src/features/files/sftp/sftp-copy-service.ts");
  const sftpUploadServiceSource = read("frontend/src/features/files/sftp/sftp-upload-service.ts");
  const sftpTransferPreparationSource = read("frontend/src/features/files/sftp/transfer-preparation.ts");
  const sftpTaskServiceSource = read("frontend/src/features/files/sftp/sftp-task-service.ts");
  const sftpTaskModelSource = read("frontend/src/features/files/sftp/sftp-task-model.ts");
  const sftpTaskCardSource = read("frontend/src/features/files/sftp/TaskCard.ts");
  const sftpTaskRuntimeSource = read("frontend/src/features/files/sftp/task-runtime.ts");
  const taskActionSource = read("frontend/src/features/files/sftp/task-actions.ts");
  const taskHostSource = read("frontend/src/features/quick/quick-host.ts");
  const sftpPageLifecycleSource = read("frontend/src/features/files/sftp/page-lifecycle.ts");
  const quickViewsVue = read("frontend/src/features/quick/quick-views.ts");
  const taskCenterVue = read("frontend/src/features/quick/TaskCenter.ts");
  const quickVue = `${quickViewsVue}\n${taskCenterVue}`;
  const sftpPreviewFrontend = [read("frontend/src/features/files/sftp/view-workspace.ts"), read("frontend/src/features/files/sftp/image-preview.ts"), read("frontend/src/features/files/sftp/preview-model.ts"), read("frontend/src/features/files/sftp/SftpPreviewShell.ts"), read("frontend/src/features/files/sftp/file-preview-service.ts")].join("\n");
  const remoteProfileView = read("frontend/src/features/connections/RemoteProfileForm.tsx");
  const remoteProfileService = read("frontend/src/features/remote/profile-service.ts");
  const remoteProfileModel = read("frontend/src/features/remote/profile-model.ts");
  const remoteFrontend = readFrontendDomain(root, "remote") + remoteProfileView;
  const remoteClientRuntime = read("frontend/src/features/remote/client-runtime.ts");
  const remoteDesktopRuntime = read("frontend/src/features/remote/remote-desktop-runtime.ts");
  const sftpCss = read("public/app.css");
  const nativeSftpDragDesktopSource = read("desktop/native-sftp-drag.js");
  ok("文件时间格式化由前端 TypeScript 公共服务提供", read("frontend/src/features/files/file-layout.ts").includes("export function formatSftpTime") && read("frontend/src/features/files/sftp/view-workspace.ts").includes("import { formatSftpTime } from '../file-layout'"));
  ok("SFTP 列响应断点与滚动观察由 TypeScript 服务持有", sftpColumnLayoutSource.includes("function syncSftpListLayout") && sftpColumnLayoutSource.includes("function syncSftpListScrollCue") && sftpColumnLayoutSource.includes("function watchSftpListLayout") && sftpColumnLayoutSource.includes("new ResizeObserver") && read("frontend/src/features/files/sftp/view-workspace.ts").includes("columns.watchSftpListLayout(list, key)"));
  ok("SFTP 选择快照按标签管理，多选操作栏从两个所选项开始显示", sftpViewSource.includes("selectedEntries(key)") && sftpViewSource.includes("function syncSelection(") && sftpViewSource.includes("target.hidden = count < 2") && sftpViewSource.includes("setAllSelected(entry,"));
  ok("SFTP 大目录元数据支持 GNU 快路径并保留便携降级", sftpBackend.includes('if find . -maxdepth 0 -printf \'\' >/dev/null 2>&1; then TERMA_FIND_STYLE=gnu; else TERMA_FIND_STYLE=portable; fi') && sftpBackend.includes('if [ "$TERMA_FIND_STYLE" = gnu ]; then find . -mindepth 1 -maxdepth 1') && sftpBackend.includes('else terma_entries | while IFS= read -r entry; do terma_emit_metadata "$entry" || exit 1; done; fi'));
  ok("SFTP 目录枚举兼容 GNU/BSD stat 并展示符号链接目标大小", sftpBackend.includes('stat -c "%s %Y %a %U %G"') && sftpBackend.includes('stat -f "%z %m %Lp %Su %Sg"') && sftpBackend.includes('stat -L -c "%s %Y %a %U %G"') && sftpBackend.includes('stat -L -f "%z %m %Lp %Su %Sg"') && sftpBackend.includes("find . ! -name .") && sftpBackend.includes("-prune -exec") && sftpFrontend.includes("file.is_symlink"));
  ok("SFTP 文件读取、Shell 操作和传输任务均显式进入 POSIX Shell", sftpBackend.includes('const FILE_READ_SHELL = "/bin/sh -s"') && sftpBackend.includes("runRemoteCommand(connection, FILE_READ_SHELL, fileReadScript(command)") && sftpBackend.includes("spawnSftpSessionCommand(connection, FILE_READ_SHELL)") && sftpBackend.includes("child.stdin.end(fileReadScript(command))") && sftpBackend.includes("runRemoteCommand(connection, buildRemotePosixCommand(command)") && sftpJobsSource.includes("spawnSftpSessionCommand(connection, buildRemotePosixCommand(command))"));
  ok("SFTP 复用持久 SSH2 会话并在连接丢失后自动恢复", sftpSessionSource.includes("const sessions = new Map()") && sftpSessionSource.includes("record.client.exec") && sftpSessionSource.includes("for (let attempt = 0; attempt < 2") && sftpSessionSource.includes("await connectSftpSession(connection.id)") && !sftpSessionSource.includes("force:attempt > 0") && sftpSessionSource.includes("record.manualDisconnected = false") && sftpSessionServerSource.includes('parts[4] === "session"') && sftpSessionServerSource.includes("closeAllSftpSessions()") && sftpFrontend.includes("refreshSessions: key => sftpConnection.refresh(key)") && read("frontend/src/features/files/sftp/connection-service.ts").includes("await record.disconnecting") && read("frontend/src/features/files/sftp/connection-service.ts").includes("record.intent !== beforeWait"));
  ok("SFTP 普通目录列表隐藏新旧内部目录和上传暂存文件", sftpBackend.includes('! -name ${shellQuote(SFTP_RECYCLE_DIRECTORY)}') && sftpBackend.includes('! -name ${shellQuote(LEGACY_SFTP_RECYCLE_DIRECTORY)}') && sftpBackend.includes('! -name ${shellQuote(".terma-upload-*.part")}') && sftpBackend.includes('! -name ${shellQuote(".tunneldesk-upload-*.part")}'));
  ok("SFTP 单次 stat 读取大小、时间和权限元数据", sftpBackend.includes('meta=$(stat -c "%s %Y %a %U %G"') && sftpBackend.includes('meta=$(stat -f "%z %m %Lp %Su %Sg"') && !sftpBackend.includes('size=$(stat'));
  ok("SFTP 支持单项/多项压缩和权限设置", sftpBackend.includes("normalizeRemotePermissionRequest") && sftpBackend.includes("buildRemotePermissionCommand") && sftpJobsSource.includes("normalizeCompressionRequest") && sftpFrontend.includes("operations.compress(key)") && sftpFrontend.includes("operations.permissions(key)"));
  ok("SFTP 大目录使用服务端分页、快照与请求合并", sftpBackend.includes("paginateRemoteEntries") && sftpBackend.includes("DIRECTORY_CACHE_TTL_MS") && sftpBackend.includes("directorySnapshotRequests") && sftpBackend.includes("loadDirectorySnapshot") && sftpDirectoryLoaderSource.includes("port.request(id,params,controller.signal)") && sftpDirectoryRequestsSource.includes("const shared=new Map<string,Promise<SftpDirectoryPage>>()") && sftpViewSource.includes("class: 'pager sftp-pager'"));
  ok("SFTP 搜索支持加载反馈与有界子目录索引", sftpBackend.includes("buildRemoteRecursiveDirectoryEntriesCommand") && sftpBackend.includes("MAX_RECURSIVE_SEARCH_ENTRIES") && sftpFrontend.includes("directory.recursive(key, enabled)") && sftpDirectoryLoaderSource.includes("port.search(key,false)") && sftpViewSource.includes("entry.ui.searchBusy") && sftpViewSource.includes("auto.search_children"));
  ok("SFTP 双击目录进入、文件打开编辑", sftpViewSource.includes("activateEntry(entry, event, selection)") && sftpViewSource.includes("entry.options.run('navigate', file.path)") && sftpFrontend.includes("activateFile(entry: ViewEntry)"));
  ok("SFTP 任意扩展名显示文本打开", sftpViewSource.includes("data-sftp-open-kind") && sftpFileOpenSource.includes("createFileOpenService") && sftpFrontend.includes("preview.text(id, path)"));
  ok("SFTP SVG 同时支持图片预览和文本打开", sftpViewSource.includes("/\\.svgz?$/i.test(file.name)") && sftpViewSource.includes("rowButton('textEntry'") && sftpPreviewFrontend.includes("previewSftpText"));
  ok("SFTP SVG 支持预览、编辑和分栏模式互跳", sftpPreviewFrontend.includes("sftpImageViewMode") && sftpPreviewFrontend.includes("openSvgEditorMode") && sftpPreviewFrontend.includes("initialContent") && sftpPreviewFrontend.includes("initialModified") && sftpPreviewFrontend.includes("previewOptions.modified") && sftpFrontend.includes("sftpSvgEditorMode") && sftpFrontend.includes("showing-svg-preview") && sftpFrontend.includes("renderSvgEditorPreview") && sftpFrontend.includes("updateSvgPreviewZoom") && sftpFrontend.includes("onPreviewWheel") && sftpFrontend.includes("focusSvgSourceId") && sftpFrontend.includes("syncSvgPreviewFromCursor") && sftpFrontend.includes("centerSvgPreviewTarget") && sftpFrontend.includes("cancelSvgPreviewAutoFocus") && sftpFrontend.includes("svgPreviewTargetIdFromEvent") && read("frontend/src/features/files/file-layout.ts").includes("svgSplit"));
  ok("SFTP 远端 SVG 切换编辑时保留编码感知读取", sftpPreviewFrontend.includes("const hasEditorContent") && sftpPreviewFrontend.includes("...(hasEditorContent ? {") && sftpPreviewFrontend.includes("hasEditorContent && previewOptions.modified"));
  ok("SFTP SVG 实时预览调度更新并与差异预览互斥", sftpFrontend.includes("createSftpSvgEditorScheduler") && sftpFrontend.includes("svgScheduler.render()") && sftpFrontend.includes("svgScheduler.cursor()") && sftpFrontend.includes('if (mode === "split" && editorWorkspace?.classList.contains("showing-diff")) closeDiffPreview()') && sftpFrontend.includes('if (svgModeSelect?.value === "split") syncSvgEditorMode("edit")'));
  ok("终端 AI 长代码块保留可达的执行区", sftpCss.includes(".terminal-ai-code") && sftpCss.includes("max-height:min(360px,42vh)") && sftpCss.includes("overflow-y:auto") && read("frontend/src/features/assistant/markup-renderers.ts").includes("terminal-ai-execute-command"));
  ok("SFTP 面包屑跟随滚动", sftpCss.includes(".sftp-top { position:sticky") && sftpCss.includes(".sftp-breadcrumb { display:flex") && sftpCss.includes("overflow-x:auto"));
  ok("SFTP 紧凑工具栏支持新建、条件粘贴、导航和悬浮搜索", sftpViewSource.includes("host('toolbar', '', 'sftp-toolbar'") && sftpFrontend.includes("operations.createFile(key)") && sftpViewSource.includes("sftp-clipboard-state") && sftpFrontend.includes("filesServices.termaSftpFileActions.cancel()") && sftpFrontend.includes("directory.navigateHistory(key, direction)") && sftpViewSource.includes("event.preventDefault(); submitPath(entry)") && sftpFrontend.includes("sftp-floating-search") && sftpFrontend.includes("sftp-drop-overlay") && sftpCss.includes(".sftp-shell { position:relative; display:flex;") && sftpCss.includes(".sftp-top { position:sticky") && sftpCss.includes("container-name:sftp-view") && sftpCss.includes("@container sftp-view (max-width:760px)") && sftpCss.includes(".sftp-favorites.is-empty { display:none; }") && !sftpFrontend.includes('classList.toggle("empty")'));
  ok("SFTP 拖拽传输、冲突处理、批量下载和版本差异预览可用", sftpSessionSource.includes("stageSftpPaths") && sftpSessionSource.includes("deliverSftpPaths") && read("desktop/main.js").includes("terma:sftp-start-drag") && sftpFrontend.includes("events.drop(event, key)") && read("frontend/src/shared/static-action-registry.ts").includes("termaSftpDragWorkspace.drag.destinations.drop") && sftpFrontend.includes("sftpDiffHistory") && sftpFrontend.includes("/sftp/versions") && sftpFrontend.includes("transfer.selection(key)") && sftpFrontend.includes("firstDownload.confirm") && sftpFrontend.includes("return { queue, download, selection, again, desktopSelection") && sftpFrontend.includes("copy.chooseConflict({ api, choose: chooseModal, tr, isCurrent }") && sftpCopyServiceSource.includes("await port.conflict") && !sftpFrontend.includes("sftpClipboard.action") && sftpSessionServerSource.includes('parts[4] === "download-batch"') && sftpSessionServerSource.includes('parts[4] === "upload-plan"'));
  ok("SFTP 列表展示权限/所有者并支持无感后台同步", sftpViewSource.includes("permissions_owner") && sftpViewSource.includes("data-owner") && sftpFrontend.includes("sftpView.capture(key)") && sftpFrontend.includes("sftpView.restore(view, key)") && read("frontend/src/features/files/sftp/transfer-lifecycle.ts").includes("createDirectoryRefreshQueue(port.directories)") && sftpDirectoryLoaderSource.includes("list?.classList.toggle('is-refreshing',keep)"));
  ok("SFTP 任务由标题栏全局入口集中展示并区分进行中、失败与历史", taskCenterVue.includes("sftpTaskCenterButton") && taskCenterVue.includes("sftpTaskCenterDrawer") && taskCenterVue.includes("['failed', 'Failed'") && taskCenterVue.includes("sftpTaskCenter${id}Count") && taskCenterVue.includes("view === 'history' ? history : view === 'failed' ? failed : current") && taskHostSource.includes("import { sftpTaskCollections,") && sftpTaskModelSource.includes("const current = jobs.filter(job => sftpActiveStatuses.has(job.status))") && sftpTaskModelSource.includes("const failed = jobs.filter(job => job.status === 'failed'") && sftpTaskModelSource.includes("['done', 'cancelled'].includes(job.status)") && !sftpFrontend.includes('id="sftpJobs"'));
  ok("SFTP 全局任务中心保留进度及暂停继续取消等操作", taskCenterVue.includes("function renderTaskCenter") && quickViewsVue.includes("export {renderSftpJob} from '../files/sftp/TaskCard'") && sftpTaskCardSource.includes('const deletable = ["paused", "failed", "done", "cancelled"].includes(job.status)') && ["pause", "resume", "cancel"].every(action => sftpTaskCardSource.includes(`termaTaskActions.current.single(jobIdArg, '${action}'`)) && sftpTaskCardSource.includes("termaTaskActions.current.remove(jobIdArg") && read("frontend/src/entries/about-embed.ts").includes("message: taskWorkspace.presentation.message"));
  ok("SFTP 多文件传输提前进入统一队列并支持批量控制", read("public/index.html").includes('id="sftpTaskCenterPauseAllButton"') && read("public/index.html").includes('id="sftpTaskCenterResumeAllButton"') && read("public/index.html").includes('id="sftpTaskCenterClearQueueButton"') && taskActionSource.includes("queue:()=>sftpTaskQueue(host.jobs())") && ["pause", "resume", "cancel"].every(action => read("frontend/src/shared/static-action-registry.ts").includes(`termaTaskActions.current.batch('${action}', element)` )) && sftpFrontend.includes("downloads, uploads,") && sftpUploadServiceSource.includes("uploads.push({ item, started })") && sftpUploadServiceSource.includes("await port.refresh()") && sftpTransferRoutesSource.includes("paths.map((remotePath: string) => dependencies.startLocalDeliveryJob") && sftpTransferRoutesSource.includes('{jobs, count:jobs.length, status:"pending"}') && sftpJobsSource.includes("job.abortController?.abort?.()") && sftpSessionSource.includes("signal:progress?.signal"));
  ok("SFTP 生成文件使用安全中文文件名并提供打开、删除入口", read("frontend/src/features/files/sftp/generated-file-service.ts").includes('encodeURIComponent(filename)') && read("frontend/src/features/efficiency/NotificationToastView.ts").includes("return files.deleteFile(jobId)") && read("src/routes/sftp-desktop-download-routes.ts").includes("decodeGeneratedFilename") && read("src/routes/sftp-desktop-download-routes.ts").includes('contentType.startsWith("image/svg+xml")') && read("src/routes/sftp-desktop-download-routes.ts").includes('pathname === "/api/sftp/download-settings/delete-generated"') && sftpTaskCardSource.includes('job.type === "local-generated" && job.delivery_status === "saved"') && sftpTaskCardSource.includes("scope.openSftpGeneratedTaskDirectory"));
  ok("任务中心失败页支持一键删除失败记录", taskCenterVue.includes("sftpTaskCenterClearLabel") && taskCenterVue.includes("view === 'failed' ? 'tasks:dialogs.clear_failed_action'") && taskActionSource.includes("Promise.allSettled(failed.map(job=>port.remove(String(job.id))))") && read("frontend/src/shared/static-action-registry.ts").includes("tasks.view() === 'failed' ? actions.clearFailed"));
  ok("任务中心接入 Linux 桌面安装与卸载任务", sftpTaskRuntimeSource.includes('/api/linux-desktop/tasks') && sftpTaskRuntimeSource.includes("projectSftpTasks({transfer,sync,desktop,component,generated:port.generated()},port)") && sftpTaskModelSource.includes("type: desktop ? 'linux-desktop'") && sftpTaskCardSource.includes("remoteServices.termaRemoteManagement.desktop.openTask") && read("frontend/src/features/remote/desktop-service.ts").includes("port.jobs()") && remoteTaskRoutesSource.includes("clearFinishedLinuxDesktopTasks"));
  ok("SFTP 原生拖出取消等待系统终态后再清理", sftpJobsSource.includes('job.phase = "cancelling"') && sftpJobsSource.includes("accepted = Boolean(nativeDragCancelHandler") && sftpTaskServiceSource.includes("job.can_cancel !== false") && taskHostSource.includes("sftpTransferJobCanCancel: canCancelSftpTask"));
  ok("SFTP 后台任务创建不重复弹出加入提示", !/已加入[\s\S]{0,120}任务/.test(sftpFrontend));
  ok("SFTP 上传阶段使用用户视角文案", sftpFrontend.includes('phase === "receiving") return tr("tasks:phase.receiving", {defaultValue:"正在准备上传"})') && sftpFrontend.includes('phase === "uploading") return tr("tasks:phase.uploading", {defaultValue:"正在上传到远端"})') && !sftpFrontend.includes('return "正在接收"'));
  ok("SFTP 标题栏任务入口显示需关注任务数量及运行失败状态", taskCenterVue.includes("const status = failedCount ? 'failed' : activeCount ? 'running' : 'idle'") && taskCenterVue.includes("'is-running': activeCount > 0") && taskCenterVue.includes("'is-failed': failedCount > 0") && taskCenterVue.includes("const attention = current.length + failed.length") && taskCenterVue.includes("attention > 99 ? '99+' : String(attention)") && sftpCss.includes(".sftp-task-center-button.is-running") && sftpCss.includes(".sftp-task-center-button.is-failed"));
  ok("SFTP 本机接收与远端上传共享同一后台任务", sftpUploadServiceSource.includes('/sftp/upload-job') && sftpUploadServiceSource.includes('/api/sftp/jobs/${encodeURIComponent(started.id || \'\')}/content') && sftpFrontend.includes("sendSftpUpload({") && sftpFrontend.includes("requests: taskState.uploads") && !sftpFrontend.includes("正在接收 ${filename}") && sftpTransferRoutesSource.includes("startUploadReceiveJob") && sftpJobRoutesSource.includes("receiveUploadJobContent"));
  ok("SFTP 上传通过远端暂存文件原子完成且取消会清理", sftpJobsSource.includes("remote_temp_path") && sftpJobsSource.includes("uploadRemoteCommitCommand") && sftpJobsSource.includes("cleanupRemoteUploadArtifact") && sftpJobsSource.includes("invalidateRemoteDirectoryCache(job.connection_id)"));
  ok("悬浮任务进度卡位于标题栏下方并支持暂停继续、关闭与永久静默", read("frontend/src/features/efficiency/NotificationToastView.ts").includes("class: 'toast-copy'") && sftpCss.includes(".toast-head > .toast-icon") && sftpCss.includes('.sftp-task-float { position:absolute') && sftpCss.includes('top:calc(100% + 8px)') && read("public/index.html").includes('id="sftpTaskFloat"') && taskCenterVue.includes("sftp-task-float-pause") && taskCenterVue.includes("filesServices.termaTaskActions.current.floatAction") && taskCenterVue.includes("filesServices.termaTaskActions.current.single") && taskCenterVue.includes("scope.dismissSftpTaskFloat") && taskCenterVue.includes("scope.muteSftpTaskFloat") && read("frontend/src/entries/about-embed.ts").includes("message: taskWorkspace.presentation.message") && read("frontend/src/features/files/sftp/task-workspace.ts").includes("const runtime = createTaskRuntime(") && sftpTaskRuntimeSource.includes("port.tr('sftp:task_ui.mute_message')") && JSON.parse(read("public/locales/zh-CN/sftp.json")).task_ui.mute_message.includes("永久关闭此类悬浮进度卡") && read("frontend/src/features/settings/NotificationSettings.tsx").includes('taskCenterFloatingProgressEnabled') && read("src/runtime-settings.ts").includes("sftp_floating_progress_enabled"));
  const toastServiceSource = read("frontend/src/features/efficiency/notification-toast-service.ts");
  const toastViewSource = read("frontend/src/features/efficiency/NotificationToastView.ts");
  ok("页面通知独立计时纵向堆叠并在关闭后平滑上移", read("public/index.html").includes('id="toast" class="notification-stack"') && toastServiceSource.includes("const deadlines = new Map") && toastViewSource.includes("render(h(Fragment") && toastViewSource.includes("const delta = top - node.getBoundingClientRect().top") && toastViewSource.includes("service.dismiss(model.id)") && sftpCss.includes("grid-auto-flow:row") && sftpCss.includes("--z-notification:60100") && sftpCss.includes("z-index:var(--z-notification)") && sftpCss.includes("--notification-stack-offset") && sftpCss.includes("transform:translateY(var(--notification-stack-offset))"));
  ok("页面通知在悬停或聚焦时暂停销毁计时", toastServiceSource.includes("const pauses = new Map") && toastViewSource.includes("onPointerenter:") && toastViewSource.includes("onFocusin:") && toastServiceSource.includes("deadline.remaining") && toastServiceSource.includes("function schedule("));
  ok("页面通知支持分类开关、显示时长和独立悬浮任务卡设置", read("src/runtime-settings.ts").includes("DEFAULT_NOTIFICATION_DISPLAY") && read("src/runtime-settings.ts").includes("normalizeNotificationDisplay") && toastServiceSource.includes("function notificationDisplayPreferences") && toastServiceSource.includes("if (!preference.enabled) return") && read("frontend/src/features/settings/NotificationSettings.tsx").includes('notificationInfoEnabled') && read("frontend/src/features/settings/NotificationSettings.tsx").includes('notificationProgressSuccessDuration') && read("frontend/src/features/settings/NotificationSettings.tsx").includes('taskCenterFloatingProgressEnabled') && read("public/app.css").includes(".notification-preference-row"));
  ok("桌面通知可独立关闭并明确区分浏览器授权与 Terma 开关", read("src/runtime-settings.ts").includes("desktop_notifications_enabled") && read("src/routes/storage-routes.ts").includes("desktop_notifications_enabled:data.desktop_notifications_enabled") && require('./frontend-source').readFrontendDomain(process.cwd(),'utilities').includes("termaRuntimeSettingsModel?.snapshot?.saved?.desktop_notifications_enabled !== false") && read("frontend/src/features/settings/NotificationSettings.tsx").includes('notificationPermissionStatus') && read("frontend/src/features/settings/NotificationSettings.tsx").includes('desktopNotificationToggleBtn') && read("frontend/src/features/settings/NotificationSettings.tsx").includes('desktopNotificationStatus') && read("frontend/src/features/settings/notification-settings-actions.ts").includes("efficiencyServices.termaSystemNotifications.toggle(") && read("frontend/src/features/efficiency/system-notification-service.ts").includes("notifications_authorized_disabled"));
  ok("SFTP SVG 搜索按设备身份去重并保留定位上下文", sftpPreviewFrontend.includes("svgSearchTarget") && sftpPreviewFrontend.includes("exactTargets") && sftpPreviewFrontend.includes("source.closest(\"metadata\")") && sftpPreviewFrontend.includes("const contextWidth = Math.max(720") && sftpPreviewFrontend.includes("fit();"));
  ok("SFTP 文本查找与 SVG 源码定位支持单行横向滚动并强化选区高亮", read("frontend/src/features/files/sftp/svg-source.ts").includes("findSourceRange") && read("frontend/src/features/files/sftp/svg-source.ts").includes("selection.setRange") && read("frontend/src/features/files/sftp/svg-source.ts").includes("scrollCursorIntoView") && read("frontend/src/features/files/sftp/svg-source.ts").includes("sftp-svg-source-target") && read("frontend/src/features/files/sftp/editor-runtime.ts").includes("renderer?.scrollCursorIntoView") && read("frontend/src/features/files/sftp/editor-runtime.ts").includes("fallbackEditor.scrollLeft") && read("public/app.css").includes(".ace_selection") && read("public/app.css").includes(".sftp-svg-source-target") && read("scripts/ui-smoke-electron.js").includes("svgSplitOneLineSourceFocus"));
  const nativeDragAdapterSource = read("frontend/src/features/files/sftp/native-drag-adapter.ts");
  ok(
    "Linux 缺少 FUSE 时提示原因并保留兼容拖出",
    nativeDragAdapterSource.includes("function createNativeDragPresentation(")
      && nativeDragAdapterSource.includes("capabilities?.platform !== 'linux' || capabilities.sftpExternalDrag !== 'staged'")
      && nativeDragAdapterSource.includes("/dev/fuse is unavailable")
      && nativeDragAdapterSource.includes("cannot access /dev/fuse")
      && nativeDragAdapterSource.includes("fusermount3 is unavailable")
      && nativeDragAdapterSource.includes("port.text('sftp:drag.linux_fallback_notice'")
      && nativeDragAdapterSource.includes("'linux_compat_hint'")
      && read("frontend/src/features/files/sftp/drag-runtime.ts").includes("fallback: presentation.reportFallback")
      && read("frontend/src/features/files/sftp/browser-drag-runtime.ts").includes("if(mode==='staged')port.fallback()")
      && nativeSftpDragDesktopSource.includes('sftpExternalDrag: adapter.probe.available ? "streaming" : "staged"')
      && nativeSftpDragDesktopSource.includes('sftpNativeDragReason: adapter.probe.available ? ""')
  );
  ok("SFTP 回收站默认关闭，新写 Terma 且兼容旧 TunnelDesk 数据", sftpBackend.includes('SFTP_RECYCLE_DIRECTORY = ".terma-recycle-bin"') && sftpBackend.includes('LEGACY_SFTP_RECYCLE_DIRECTORY = ".tunneldesk-recycle-bin"') && sftpBackend.includes('for (const storage of ["terma", "tunneldesk"])') && sftpBackend.includes("buildRestoreRemoteRecycleCommand") && sftpBackend.includes("buildDeleteRemoteRecycleCommand") && sftpBackend.includes("buildClearRemoteRecycleCommand") && sftpFrontend.includes("termaSftpRecycle.open") && read("frontend/src/features/files/sftp/recycle-service.ts").includes("storage: storage(item)") && read("frontend/src/features/files/sftp/SftpDialogViews.ts").includes("sftpFilePresentation") && read("src/runtime-settings.ts").includes("sftp_recycle_bin_enabled"));
  ok("SFTP 权限命令兼容 Linux 与 macOS", sftpBackend.includes("permissionPathOperand") && sftpBackend.includes("chgrp") && !sftpBackend.includes("chown ${recursiveFlag}${shellQuote(`${normalized.owner}:${normalized.group}`)} --") && !sftpBackend.includes("chmod ${recursiveFlag}${normalized.mode} --"));
  ok(
    "移动端工作区返回入口由外壳统一提供",
    /<main id="content" class="content">\s*<div class="mobile-back-bar"><button id="mobileBack"/.test(read("public/index.html"))
      && read("frontend/src/styles/workspace.css").includes(".mobile-back { display:none !important; }")
      && /\.content\.mobile-show > \.mobile-back-bar\s*\{\s*position:relative;/.test(read("frontend/src/styles/workspace.css"))
      && !readFrontendDomain(root, "terminal").includes("terminal-mobile-back")
      && !remoteFrontend.includes("terminal-mobile-back")
  );
  const terminalTransport = read("frontend/src/features/terminal/terminal-transport-service.ts");
  const terminalConnection = read("frontend/src/features/terminal/terminal-connection-service.ts");
  ok("终端原始字节使用二进制 WebSocket 帧", read("src/terminal.ts").includes("Buffer.isBuffer(data) ? 2 : 1") && read("src/terminal.ts").includes("sendWebSocketFrame") && terminalTransport.includes("socket.binaryType = 'arraybuffer'") && terminalTransport.includes("new Uint8Array(data)") && readFrontendDomain(root, "terminal").includes("termaTerminalTransport.bind"));
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
  const missingFrontend = [...new Set([...frontendFiles, ...frontendSources])].filter(file => !fs.existsSync(path.join(root, file)));
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
  ok("Lucide 同步加载先于模块业务入口执行", /<script src="\/vendor\/lucide\/lucide\.min\.js[^\"]*"><\/script>/.test(indexHtml)
    && indexHtml.includes("<!-- TERMA_ABOUT_VUE_ASSETS -->")
    && /<script type="module"/.test(read("frontend/dist/about-embed.html")));

  const connectionViewsSource = read("frontend/src/features/connections/connection-views.ts");
  const connectionControllerSource = read("frontend/src/features/connections/connection-controller-service.ts");
  const connectionMenuSource = read("frontend/src/features/connections/connection-menu-service.ts");
  const connectionSaveSource = read("frontend/src/features/connections/connection-save-service.ts");
  const connectionFormActionsSource = read("frontend/src/features/connections/connection-form-actions-service.ts");
  const connectionHealthActionsSource = read("frontend/src/features/connections/connection-health-actions-service.ts");
  const connectionHealthBatchSource = read("frontend/src/features/connections/connection-health-batch-service.ts");
  const connectionValidationActionsSource = read("frontend/src/features/connections/connection-validation-actions-service.ts");
  const frontend = frontendSources.map(read).join("\n") + "\n" + connectionViewsSource + "\n" + connectionControllerSource + "\n" + sftpFrontend;
  const settingsVueSource = fs.readdirSync(path.join(root, "frontend/src/features/settings")).filter(file => /\.tsx?$/.test(file)).map(file => read("frontend/src/features/settings/" + file)).join("\n");
  const settingsFrontend = readFrontendDomain(root, "settings") + "\n" + settingsVueSource;
  const settingsViewSource = read("frontend/src/features/settings/SettingsPage.ts");
  const settingsNavSource = read("frontend/src/features/settings/SettingsNavigation.tsx");
  const settingsNavController = read("frontend/src/features/settings/settings-navigation-controller.ts");
  const settingsCacheSource = read("frontend/src/features/settings/program-cache-controller.ts") + "\n" + read("frontend/src/features/settings/cache-view.ts");
  const exchangeViewsSource=read("frontend/src/features/data-exchange/ExchangeViews.ts");
  const importFrontend = exchangeViewsSource + read("frontend/src/features/data-exchange/exchange-service.ts") + read("frontend/src/features/data-exchange/binding-service.ts") + read("frontend/src/features/data-exchange/BindingViews.ts");
  const terminalFrontend = readFrontendDomain(root, "terminal");
  const terminalToolbarViewSource = read("frontend/src/features/terminal/TerminalToolbarView.ts");
  const terminalToolbarModelSource = read("frontend/src/features/terminal/terminal-toolbar-service.ts");
  const terminalSettingsViewSource = read("frontend/src/features/terminal/TerminalSettingsView.ts");
  const terminalSettingsServiceSource = read("frontend/src/features/terminal/terminal-settings-service.ts");
  const terminalInteractionSource = read("frontend/src/features/terminal/terminal-interaction-service.ts");
  const terminalCursorCopySource = read("frontend/src/features/terminal/terminal-cursor-copy-mount.ts");
  const terminalSettingsModelSource = read("frontend/src/features/terminal/terminal-settings-model.ts");
  const terminalPreferencesServiceSource = read("frontend/src/features/terminal/terminal-preferences-service.ts");
  const terminalOutputFrontend = read("frontend/src/features/terminal/terminal-output-flow-service.ts");
  const terminalOutputFlowServiceSource = read("frontend/src/features/terminal/terminal-output-flow-service.ts");
  const terminalAiFrontend = [
    "markup-renderers.ts", "response-tools.ts", "response-context.ts", "response-text.ts",
    "response-commands.ts", "command-review.ts", "assistant-action-workspace.ts",
    "terminal-command-service.ts", "terminal-ai-tracker.ts", "request-workflow.ts", "request-action-queue.ts", "approval-markup.ts", "assistant-interactions.ts", "terminal-command-workspace.ts"
  ].map(file=>read("frontend/src/features/assistant/"+file)).join("\n") + "\n" + read("frontend/src/features/assistant/assistant-runtime-host.ts");
  const aiServiceSource = read("src/services/ai-service.ts");
  const aiRoutesSource = read("src/routes/ai-routes.ts");
  const forwardWorkspaceSource = read("frontend/src/features/forwards/forward-workspace.ts");
  const forwardRuntimeSource = read("frontend/src/features/forwards/forward-runtime.ts");
  const runningModelSource = read('frontend/src/features/operations/running-forwards.ts');
  const runningViewSource = read('frontend/src/features/operations/RunningForwardViews.ts');
  const logsFrontend = read("frontend/src/features/operations/workspace-operations-host.ts");
  const connectionHostSource = read("frontend/src/features/connections/connection-host.ts");
  const connectionsFrontend = connectionHostSource + "\n" + connectionViewsSource;
  const sshSaveService = read("frontend/src/features/connections/connection-save-service.ts");
  const sshEditSaveBranch = sshSaveService.match(/if \(connectAfterSave && savedConnectionId\)[\s\S]*?else if \(clearAfterSave && !payload\.id\)/)?.[0] || "";
  const remoteEditSaveBranch = read("frontend/src/features/remote/profile-editor-runtime.ts").split("complete: (id, action) => {")[1]?.split("function create(")[0] || "";
  const utilsFrontend = require('./frontend-source').readFrontendDomain(process.cwd(),'utilities');
  const viewportSource = read("frontend/src/shared/viewport-service.ts");
  const terminalViewportSource = read("frontend/src/features/terminal/terminal-viewport-service.ts");
  const terminalSurfaceSource = read("frontend/src/features/terminal/terminal-surface-service.ts");
  const { iconDefinition, iconHtml } = loadFrontendService("frontend/src/shared/ui/icon-service.ts");
  const terminalActionMenuFrontend = read("frontend/src/features/terminal/terminal-controls-mount.ts") + "\n" + read("frontend/src/features/terminal/TerminalDisplayMenuView.ts");
  const workspaceTabPresentation = read("frontend/src/features/workspace/workspace-tab-presentation.ts");
  const workspaceChrome = read("frontend/src/features/workspace/workspace-chrome-service.ts");
  const workspaceFrontend = read("frontend/src/shared/static-action-registry.ts") + "\n" + connectionViewsSource;
  const workspaceStateSource = read("frontend/src/features/workspace/workspace-state-service.ts");
  const workspaceShell = read("frontend/src/features/workspace/workspace-shell-controller.ts");
  const staticActionsFrontend = read("frontend/src/shared/static-action-registry.ts");
  const dockingFrontend = read("frontend/src/features/workspace/workspace-dock-runtime.ts");
  const productivityFrontend = readFrontendDomain(root, "productivity");
  const appEntry = staticActionsFrontend;
  const workspaceBootstrap = read("frontend/src/shared/workspace-bootstrap.ts");
  const workspaceRestoreSource = read("frontend/src/shared/workspace-restore.ts");
  const workspaceRestoreDelegated = workspaceBootstrap.includes("return persistence.restore()")
    && workspaceBootstrap.includes("saveTabs: () => workspaceServices.termaWorkspacePersistence?.save(), syncResponsivePane")
    && workspaceRestoreSource.includes("const restored = await port.restoreTabs()")
    && workspaceRestoreSource.includes("port.syncResponsivePane()");
  const appState = read("frontend/src/shared/application-state.ts");
  const appCss = read("public/app.css");
  const workspaceCss = read("frontend/src/styles/workspace.css");
  const narrowWorkspaceCss = appCss.slice(
    appCss.indexOf("@container workspace-pane (max-width:1100px)"),
    appCss.indexOf("@container workspace-pane (max-width:760px)")
  );
  const sftpTasksFrontend = sftpFrontend;
  const storageRoutesSource = read("src/routes/storage-routes.ts");
  const updateRouteSource = read("src/routes/update-routes.ts");
  const notificationsSource = read("src/notifications.ts");
  const notificationEventSource = read("frontend/src/features/efficiency/notification-event-service.ts");
  const notificationEntrySource = read("frontend/src/entries/about-embed.ts");
  const terminalSource = read("src/terminal.ts");
  const desktopSource = read("desktop/main.js");
  const appMenuSource = desktopSource.slice(desktopSource.indexOf("function buildAppMenu"), desktopSource.indexOf("function createTray"));
  const trayMenuSource = desktopSource.slice(desktopSource.indexOf("function refreshTrayMenu"), desktopSource.indexOf("function showError"));
  ok("原生弹窗规则区分协议对象方法及局部绑定", !hasNativeDialogCall("detection.confirm()")
    && !hasNativeDialogCall("const port = { async confirm(value) { return detection.confirm(value); } };")
    && !hasNativeDialogCall("interface Port { confirm(value:string): Promise<boolean> }")
    && !hasNativeDialogCall("const confirm = value => port.confirm(value); confirm('x');")
    && !hasNativeDialogCall("function run(confirm) { return confirm('x'); }")
    && !hasNativeDialogCall("// alert('x')\nconst text = `prompt('x')`;")
    && hasNativeDialogCall("function run(confirm) { confirm('x'); } confirm('x');")
    && hasNativeDialogCall("declare function confirm(value:string):boolean; confirm('x');")
    && hasNativeDialogCall("declare const alert:(value:string)=>void; alert('x');")
    && hasNativeDialogCall("confirm('x')") && hasNativeDialogCall("window.confirm('x')")
    && hasNativeDialogCall("globalThis['alert']('x')") && hasNativeDialogCall("self.prompt('x')"));
  const nativeDialogFiles = [...new Set([
    ...frontendSources.map(file => path.join(root, file)),
    path.join(root, "frontend/src/features/connections/connection-views.ts"),
    path.join(root, "frontend/src/features/files/file-layout.ts"),
    ...typeScriptFiles("frontend/src/features/files/sftp"),
    ...typeScriptFiles("frontend/src/features/quick")
  ])].filter(file => hasNativeDialogCall(fs.readFileSync(file, "utf8")));
  ok("无原生 alert/confirm/prompt", nativeDialogFiles.length === 0, nativeDialogFiles.map(file => path.relative(root, file)).join(", "));
  ok("模态弹窗不会因点击外部遮罩而误关闭", !frontend.includes("event.target === modal") && !frontend.includes("event.target===modal") && workspaceBootstrap.includes("event.stopImmediatePropagation()"));
  ok("共享弹窗统一标题、关闭按钮和吸顶操作区", appCss.includes(".modal-title-row {") && appCss.includes("padding:var(--modal-card-padding)") && appCss.includes("margin-top:calc(-1 * var(--modal-card-padding))") && appCss.includes("margin-bottom:calc(-1 * var(--modal-card-padding))") && appCss.includes(".vnc-clipboard-helper-state .rdp-server-head"));
  ok("图标刷新不监听全部 DOM 变化", !frontend.includes("new MutationObserver(refreshIcons)"));
  ok("动态图标直接输出 SVG", utilsFrontend.includes("sharedServices.termaIcons.html(name, label)")
    && iconHtml(iconDefinition({icons:{Server:[["path", {d:"M1 2"}]]}}, "server")).startsWith('<svg class="lucide'));
  ok(
    "移动端文件选择返回后恢复完整视口高度",
    utilsFrontend.includes("export const beginNativeFileDialogViewport")
      && utilsFrontend.includes("export const settleNativeFileDialogViewport")
      && utilsFrontend.includes("export const resetMobileWorkspaceShellScroll")
      && utilsFrontend.includes("sharedServices.termaViewport.settleFileDialog()")
      && viewportSource.includes("sync({ force: true, preferLayout: true })")
      && viewportSource.includes("nativeFileDialogPending && options.force !== true")
      && workspaceBootstrap.includes("\n  bindNativeFileDialogViewportRecovery();")
  );
  ok(
    "SSH 连接卡移除易误解的转发运行标识且仅显示已检测健康状态",
    connectionViewsSource.includes('const healthBadge: any = health ?')
      && connectionViewsSource.includes('"class": "conn-main"')
      && !connectionsFrontend.includes('class="conn-state"')
      && !connectionsFrontend.includes('class="status-dot')
      && !connectionsFrontend.includes('icon(health?.ok ? "circle-check" : health ? "circle-alert" : "circle-help")')
  );
  ok("转发入口包含局域网监听提示", settingsVueSource.includes("0.0.0.0") && settingsVueSource.includes("仅本机可访问"));
  ok("工作区标签菜单包含四种关闭方式", ['close_current_tab','close_other_tabs','close_right_tabs','close_all_tabs'].every(key => read("frontend/src/features/workspace/workspace-tab-actions.ts").includes('common:auto.'+key)));
  const workspaceLayoutService = fs.readFileSync(path.join(root, "frontend/src/features/workspace/workspace-layout-service.ts"), "utf8");
  const workspaceDragService = fs.readFileSync(path.join(root, "frontend/src/features/workspace/workspace-drag-service.ts"), "utf8");
  const workspacePersistence = fs.readFileSync(path.join(root, "frontend/src/features/workspace/workspace-persistence-service.ts"), "utf8");
  const workspaceHost = read("frontend/src/features/workspace/workspace-host.ts");
  const dockState = read("frontend/src/features/workspace/workspace-dock-state.ts");
  const dockingContract = dockState.includes("function workspaceLeaves")
    && dockState.includes("function workspaceFindPane")
    && dockingFrontend.includes("function workspaceReplacePaneWithSplit")
    && workspaceLayoutService.includes("let layout = prune(state.layout)")
    && workspacePersistence.includes("layout.serialize(snapshot.layout)")
    && workspacePersistence.includes("function restoreLayout(")
    && workspaceDragService.includes("function updateDropTarget") && workspaceDragService.includes("update: updateDropTarget")
    && workspaceFrontend.includes("workspaceServices.termaWorkspaceDrag?.tabs.begin(")
    && ["left", "right", "top", "bottom"].every(zone => workspaceDragService.includes(`['${zone}',`))
    && workspaceHost.includes("workspaceServices.termaWorkspaceTabCopy.duplicate(key)")
    && read("frontend/src/features/workspace/workspace-tab-copy.ts").includes("port.split(key,pane,options.splitZone)")
    && dockingFrontend.includes("focusedPaneId")
    && indexHtml.includes('id="workspaceDock"')
    && indexHtml.includes('id="workspaceViewsTpl"')
    && [".workspace-split-row", ".workspace-split-column", ".workspace-splitter", ".workspace-pane-drop-indicator", ".workspace-tab-insert-indicator", ".workspace-tab-drag-ghost"].every(
      selector => workspaceCss.includes(selector) && !appCss.includes(selector),
    )
    && appCss.includes("@container workspace-pane");
  const dockingResult = runWorkspaceDockingChecks({silent:true});
  ok("工作区支持递归分屏、四向落点、比例持久化与移动端单区块", dockingContract && dockingResult.passed, dockingResult.failures.join("; "));
  ok(
    "远程桌面标签以内嵌协议字母区分并兼容旧恢复数据",
    workspaceTabPresentation.includes("function workspaceTabProtocol(")
      && workspaceTabPresentation.includes("tab-protocol-letter")
      && workspaceTabPresentation.includes("remote-protocol-${protocol}")
      && appCss.includes(".tab-kind-icon.remote-desktop.remote-protocol-vnc { color:var(--accent); }")
      && appCss.includes(".tab-kind-icon.remote-desktop.remote-protocol-xdmcp { color:var(--warn); }")
      && read("scripts/ui-smoke-electron.js").includes("remoteProtocolTitlesCompact")
      && read("scripts/ui-smoke-electron.js").includes("remoteProtocolMonitorBadges")
  );
  ok("窄屏终端工具栏分行、左对齐并以图标保留全部操作", appCss.includes("container-name:terminal-view") && appCss.includes("container-name:terminal-toolbar") && appCss.includes("@container terminal-view (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:700px)") && appCss.includes(".terminal-title-row { flex:1 1 100%; width:100%; }") && appCss.includes(".terminal-actions { justify-content:flex-start; }") && appCss.includes(".terminal-actions > button:not(.terminal-dropdown-button) > span:not(.composite-icon) { display:none; }"));
  ok("移动端终端标题行按内容收缩并为外壳返回按钮留位", appCss.includes(".terminal-title-row { flex:0 0 auto; width:100%; padding-left:0; }") && /\.content\.mobile-show > \.mobile-back-bar\s*\{\s*position:relative;/.test(workspaceCss) && appCss.includes(".terminal-toolbar { align-items:flex-start; flex-direction:column"));
  ok("移动端终端字体菜单限制高度并保持关闭入口可见", appCss.includes(".mobile-action-menu { position:fixed") && appCss.includes("max-height:min(68dvh") && appCss.includes("overflow-y:auto") && appCss.includes(".mobile-action-menu .action-menu-close { position:sticky"));
  ok("移动端工作区表单聚焦时不触发页面自动缩放", appCss.includes(".workspace input, .workspace select, .workspace textarea { font-size:16px; }"));
  ok("移动端软键盘改变视口时保持当前工作区或操作区", workspaceShell.includes("setMobilePane(wasMobile ? mobilePane : applicationState.activeView === 'welcome' ? 'explorer' : 'workspace')") && viewportSource.includes("listen(port.window, 'resize', () => { sync(); port.syncResponsivePane(); })") && workspaceBootstrap.includes('\n  bindNativeFileDialogViewportRecovery();'));
  ok(
    "移动端启动恢复标签时先停留在连接列表",
    dockingFrontend.includes('viewName !== "welcome"')
      && dockingFrontend.includes('resolvedPaneId === workspaceDockState.focusedPaneId && !applicationState.restoringTabs')
      && workspaceRestoreDelegated
  );
  const sshFormModel = read("frontend/src/features/connections/connection-form-service.ts");
  ok("SSH 表单支持密钥和密码登录", indexHtml.includes("私钥登录") && indexHtml.includes("密码登录") && sshFormModel.includes("updateConnectionAuthFields"));
  ok("SSH 登录方式隔离认证字段", sshFormModel.includes("identity_file: passwordAuth ? ''") && sshFormModel.includes('ssh_password: passwordAuth ?') && sshFormModel.includes("['keyAuthBox', password], ['passwordAuthBox', !password]") && sshFormModel.includes('control.disabled = hidden'));
  ok("通知首次加载只建立游标", utilsFrontend.includes("initializeNotificationCursor") && read("frontend/src/features/efficiency/notification-polling-service.ts").includes('/api/notifications?since=0&language=') && read("frontend/src/features/efficiency/notification-state-service.ts").includes("state.cursorInitialized = true"));
  ok("运行中更新检查只刷新红点且不弹通知", notificationsSource.includes("event.silent === true ? {silent:true}") && notificationsSource.includes("if (!item.silent) appendNotificationSystemLog") && notificationEventSource.includes("event.silent !== true") && desktopSource.includes("event?.silent !== true"));
  ok("SFTP 读取响应不缓存敏感内容", /"Cache-Control"\s*:\s*"no-store"/.test(serverSource));
  ok("SFTP 删除由服务端设置决定是否进入回收站并使用后台任务", sftpTransferRoutesSource.includes("const recycleEnabled = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_recycle_bin_enabled") && sftpTransferRoutesSource.includes("dependencies.deletePathsJob(connectionId, requestedPaths, recycleEnabled") && sftpTransferRoutesSource.includes("Array.isArray(data.paths) ? data.paths : [data.path]") && sftpTransferRoutesSource.includes("pathBytesB64") && sftpTransferRoutesSource.includes("dependencies.sendJson(response, result, 202)") && sftpJobsSource.includes('progress_unit: "items"') && sftpTransferRoutesSource.includes('parts[4] === "trash" && parts[5] === "restore"'));
  ok("关于页全部内容由 Vue 接管并使用 Tile UI", settingsFrontend.includes("'data-terma-about-owned': 'all'") && read("frontend/src/app/AboutPage.tsx").includes("openLicense") && read("frontend/src/app/AboutPage.tsx").includes("terma-about-modal") && read("frontend/src/app/AboutPage.tsx").includes('id="updateCheckArea"') && read("frontend/src/app/UpdatePanel.tsx").includes("TermaButton") && read("frontend/src/app/UpdatePanel.tsx").includes("TermaLink") && read("frontend/src/app/AboutPage.tsx").includes("about-third-party-list") && serverSource.includes('pathname === "/api/about"'));
  const updateDownloadControllerSource = read("frontend/src/features/settings/update-download-controller.ts");
  const updatePanelSource = read("frontend/src/app/UpdatePanel.tsx");
  const updateControllerSource = read("frontend/src/features/settings/update-controller.ts");
  ok("设置页支持 GitHub Releases 更新检查", updateControllerSource.includes("/api/updates/check") && updatePanelSource.includes("termaUpdateStatus?.refresh(true)") && updatePanelSource.includes("settings:updates.view_release") && updateRouteSource.includes('pathname === "/api/updates/check"'));
  ok("更新完成后按当前安装类型隔离状态并提供安全操作", updateDownloadControllerSource.includes("/api/updates/open-directory") && updatePanelSource.includes("settings:updates.open_download_directory") && updatePanelSource.includes("settings:auto.update_redownload") && updateDownloadControllerSource.includes("settings:updates.open_package_confirm") && read("frontend/src/features/settings/update-status-model.ts").includes("download.asset_name !== download.selected_asset_name") && updatePanelSource.includes("currentDownload.package_type === 'portable'") && updateRouteSource.includes('pathname === "/api/updates/open-directory"') && updateRouteSource.includes('state.package_type === "portable"') && desktopSource.includes("shell.showItemInFolder(target)") && read("src/update-installer.ts").includes("matchesCurrentTarget") && read("src/update-installer.ts").includes("cleanupInstalledPackage") && serverSource.includes("scheduleInstalledUpdateCleanup"));
  ok("设置与导入导出使用独立操作区", workspaceFrontend.includes('primaryView === "settings"') && workspaceFrontend.includes('primaryView === "import"') && connectionViewsSource.includes("data-explorer-section") && connectionViewsSource.includes("exchange.navigate(id)"));
  const importSourceAt = exchangeViewsSource.indexOf("id:'import-source'");
  const importResultsAt = exchangeViewsSource.indexOf("id:'import-results'");
  const importExportAt = exchangeViewsSource.indexOf("id:'import-export'");
  ok("导入结果并入导入配置", importSourceAt >= 0 && importResultsAt > importSourceAt && importResultsAt < importExportAt && !importFrontend.includes('"import-results"') && !workspaceFrontend.includes('"import-results"'));
  ok("SSH config 与数据库使用连接级私钥绑定器", importFrontend.includes("bind(rows,'identity'") && importFrontend.includes("stageKey()") && importFrontend.includes("select_original_name") && importFrontend.includes("test_selected") && serverSource.includes("normalizeIdentityBindings"));
  ok("数据库导出明确选择是否包含 SSH 密码", importFrontend.includes("exclude_passwords") && importFrontend.includes("include_passwords") && serverSource.includes('include_passwords') && read("src/database/database-export.ts").includes("UPDATE connections SET ssh_password=NULL"));
  ok("数据库恢复始终列出全部连接及原验证方式", importFrontend.includes("bind(check.connections||[],'credential'") && importFrontend.includes("original_auth") && importFrontend.includes("set_entered_password") && serverSource.includes("connections: rows.map") && serverSource.includes("credential_bindings"));
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
  const connectionListSource = read("frontend/src/features/connections/connection-list-service.ts");
  const connectionGroupActionsSource = read("frontend/src/features/connections/connection-group-actions-service.ts");
  ok("SSH 连接支持持久排序、同值按名称升序并在两类导入中编辑", indexHtml.includes('id="conn_sort_order"') && exchangeViewsSource.includes("service.order(i,") && importFrontend.includes("data-restore-sort") && importerSource.includes("sort_order: 1") && dbSource.includes("sort_order INTEGER NOT NULL DEFAULT 1") && dbSource.includes("connections.sort_order, connections.name COLLATE NOCASE, connections.created_at, connections.id") && dbSource.includes('localeCompare(String(b.name || ""), "zh-Hans-CN"') && connectionListSource.includes("port.connections.sort(") && connectionListSource.includes("indexOf(left) - indexOf(right)"));
  ok("SSH 连接分组支持右键和更多菜单重命名", staticActionsFrontend.includes("connectionsServices.termaConnectionMenu?.openGroup") && connectionViewsSource.includes("connection-group-menu-button") && connectionGroupActionsSource.includes("connections:groups.rename") && connectionGroupActionsSource.includes("/api/connection-groups/rename") && serverSource.includes("renameConnectionGroup") && dbSource.includes("UPDATE connections SET group_name=?, updated_at=? WHERE group_name=?"));
  ok("SSH 连接分组支持持久化拖动排序且不被轮询重绘打断", connectionViewsSource.includes("beginConnectionGroupDrag") && connectionViewsSource.includes("connectionGroupDrag.renderPending = true") && read("frontend/src/features/connections/connection-group-drag-service.ts").includes("'pointercancel', cancel") && !frontend.includes("navigator.vibrate") && connectionListSource.includes("/api/connection-groups/reorder") && serverSource.includes("reorderConnectionGroups") && dbSource.includes("CREATE TABLE IF NOT EXISTS connection_groups"));
  ok("SSH 连接保存编排使用 typed service 并保留工作区动作", connectionSaveSource.includes("connectAfterSave") && connectionSaveSource.includes("closeAfterSave") && connectionSaveSource.includes("remote-profiles") && staticActionsFrontend.includes("connectionsServices.termaConnectionSave") && frontend.includes("static-connection-save-connect"));
  ok("SSH 连接表单动作与健康检查使用 typed service", connectionFormActionsSource.includes("identity-files/repair") && connectionFormActionsSource.includes("test-ssh") && connectionHealthActionsSource.includes("/health") && read("frontend/src/features/connections/connection-key-options.ts").includes("connectionsServices.termaConnectionFormActions") && connectionHostSource.includes("connectionsServices.termaConnectionHealthActions?.check(id)"));
  ok("全部连接健康检查使用 typed batch service", connectionHealthBatchSource.includes("Math.min(4") && connectionHealthBatchSource.includes("healthResults.set") && staticActionsFrontend.includes("connectionsServices.termaConnectionHealthBatch?.checkAll(element)"));
  ok("健康认证修复与仪表盘认证入口使用 typed service", connectionHealthActionsSource.includes("repairDashboardCredentials") && frontend.includes("repairSshCredentials") && read("frontend/src/features/connections/connection-dashboard.ts").includes('termaConnectionHealthActions?.repairDashboardCredentials'));
  ok("SSH 附加参数校验动作使用 typed service", connectionValidationActionsSource.includes("++state.revision") && connectionValidationActionsSource.includes("ensureValid") && connectionValidationActionsSource.includes("schedule(form") && connectionHostSource.includes("connectionsServices.termaConnectionValidationActions!.ensureValid(form)"));
  ok("快速 SSH 临时认证动作使用 typed service", read("frontend/src/features/quick/quick-ssh-service.ts").includes("method: 'POST'") && read("frontend/src/features/quick/quick-connect-actions.ts").includes("flow.submit(element"));
  ok("SSH 连接列表状态使用 typed service", read("frontend/src/features/connections/connection-list-service.ts").includes("toggleBulkMode") && connectionHostSource.includes("connectionsServices.termaConnectionList"));
  ok("SSH 连接批量动作使用 typed service", read("frontend/src/features/connections/connection-bulk-actions-service.ts").includes("bulk-update") && staticActionsFrontend.includes("connectionsServices.termaConnectionBulkActions?.apply()"));
  ok("SSH 与其他连接分组重命名使用 typed service", read("frontend/src/features/connections/connection-group-actions-service.ts").includes("/api/connection-groups/rename") && connectionHostSource.includes("connectionsServices.termaConnectionGroups?.rename(group)"));
  ok("SSH 与其他连接分组拖放使用 typed service", read("frontend/src/features/connections/connection-group-drag-service.ts").includes("connection-group-drag-active") && connectionHostSource.includes("connectionsServices.termaConnectionGroupDrag?.begin(event, group)"));
  ok("远程客户端探测、安装与启动使用 typed service", read("frontend/src/features/remote/client-service.ts").includes("/api/remote-clients/diagnostics") && read("frontend/src/features/remote/launch-service.ts").includes("/api/remote-profiles/${profileId}/launch") && remoteClientRuntime.includes("launch:") && remoteDesktopRuntime.includes("remoteServices.termaRemoteClients.diagnostics()") && read("frontend/src/features/remote/management-runtime.ts").includes("remoteServices.termaRemoteClients.launch"));
  ok("远程桌面诊断协调使用 typed service", read("frontend/src/features/remote/remote-desktop-service.ts").includes("vncReadyForLaunch") && read("frontend/src/features/remote/remote-desktop-workspace.ts").includes("port.prepare(profile, prepareOptions)") && remoteDesktopRuntime.includes("createRemoteDesktopService(port)"));
  ok("远程管理状态模型使用 typed service", read("frontend/src/features/remote/remote-management-model-service.ts").includes("endpointNotice") && read("frontend/src/features/remote/management-runtime.ts").includes("createRemoteManagementModelService") && read("frontend/src/features/remote/remote-protocol-view.ts").includes("port.diagnostics.render(container, protocol, diagnostics, id, key)"));
  ok("RDP 状态模型使用 typed service", read("frontend/src/features/remote/remote-management-model-service.ts").includes("function rdpManagementModel") && read("frontend/src/features/remote/remote-diagnostics-view.ts").includes("port.model(protocol, data, profile, key, options)"));
  ok("XDMCP/VNC 状态与来源模型使用 typed service", ["return xdmcpManagementModel(diagnostics, profile)", "vncManagementModel(profile, vnc, key, options)", "source: vncSourceManagementModel(profile, diagnostics, key)"].every(call => read("frontend/src/features/remote/remote-management-model-service.ts").includes(call)));
  ok("远程桌面状态由 Vue 视图投影", read("frontend/src/features/remote/RemoteDesktopViews.ts").includes("updateRemoteDesktopLaunch") && read("frontend/src/features/remote/RemoteFtpView.ts").includes("updateDesktopLaunch") && read("frontend/src/features/remote/remote-desktop-runtime.ts").includes("remoteServices.termaRemoteViews?.updateDesktopLaunch"));
  ok("转发列表支持分组、服务器折叠和持久排序", read("frontend/src/features/forwards/ForwardPages.ts").includes("globalForwardCollapsedGroups") && read("frontend/src/features/forwards/ForwardPages.ts").includes("globalForwardCollapsedConnections") && read("frontend/src/features/forwards/forward-sort.ts").includes("pointercancel") && read("frontend/src/features/forwards/ForwardPages.ts").includes("/api/connections/reorder") && serverSource.includes("reorderConnections") && dbSource.includes("function reorderConnections"));
  ok("SSH 连接分组手动收起后不被后台刷新重新展开", !appEntry.includes("if (selectedId === c.id) groupOpen.add(c.group_name)") && connectionControllerSource.includes("port.groupOpen.add") && staticActionsFrontend.includes("termaConnectionList?.toggleGroup(group)"));
  ok("SSH 连接分组标题支持无漏光滚动冻结和阴影分层", appCss.includes(".tree { overflow-y:auto; overflow-x:hidden; padding:0 0 18px;") && appCss.includes(".group-head-row.connection-group-head-row") && appCss.includes("position:sticky") && appCss.includes("background:var(--sidebar)") && appCss.includes("box-shadow:0 1px 0 var(--line)"));
  ok("SSH 连接菜单支持完整复制并按 copy 编号递增", connectionMenuSource.includes("port.tr('connections:actions.duplicate')") && connectionMenuSource.includes("run: () => port.duplicate(id)") && connectionHostSource.includes("duplicate: id => connectionsServices.termaConnectionController?.duplicate(id)") && connectionControllerSource.includes("/duplicate") && serverSource.includes('parts[3] === "duplicate"') && dbSource.includes("function duplicateConnection") && dbSource.includes("nextConnectionCopyName") && dbSource.includes("insertForward(connectionId, forward)"));
  ok("终端编码与字体使用独立下拉菜单并持久化",
    terminalToolbarModelSource.includes("terminalDisplayActions.encoding(event, key, id)")
      && terminalToolbarModelSource.includes("terminalDisplayActions.font(event, key, id)")
      && read("frontend/src/features/terminal/terminal-display-actions.ts").includes("terminalServices.termaTerminalPreferences!.apply(key,id,changes,message)")
      && terminalFrontend.includes("focusTerminalSession")
      && terminalPreferencesServiceSource.includes("terminal-preferences")
      && terminalFrontend.includes("terminalFontSizeField")
      && dbSource.includes("terminal_encoding TEXT NOT NULL DEFAULT 'utf8'")
      && dbSource.includes("terminal_font_size INTEGER NOT NULL DEFAULT 13")
      && dbSource.includes("terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13"));
  const runtimeSettingsSource = read("src/runtime-settings.ts");
  ok("终端与日志 AI 作为旁路能力接入并支持逐条 Agent 与内嵌审批",
    runtimeSettingsSource.includes("DEFAULT_AI_SETTINGS")
      && runtimeSettingsSource.includes("normalizeAiSettings")
      && settingsFrontend.includes("terminalAiEnabled")
      && settingsFrontend.includes("/api/ai/settings")
      && terminalAiFrontend.includes("terminal-ai-toggle")
      && terminalAiFrontend.includes("terminal-ai-insert-command")
      && terminalAiFrontend.includes("terminalAiCommandRisk")
      && terminalAiFrontend.includes("terminalAiReadOnlyFilePath")
      && terminalAiFrontend.includes("terminalAiReadOnlyFind")
      && terminalAiFrontend.includes("terminalAiToolCalls")
       && terminalAiFrontend.includes("terminalAiNormalizeToolCalls")
       && terminalAiFrontend.includes("assistantServices.termaAssistant.commands.wait")
       && terminalAiFrontend.includes("terminalAiSplitShellCommands")
       && terminalAiFrontend.includes("terminalAiResponseCommands(turn.answer)")
       && terminalAiFrontend.includes("interactions.approve")
       && terminalAiFrontend.includes("function approvalHtml")
       && !terminalAiFrontend.includes("TERMINAL_AI_AGENT_MAX_COMMANDS")
       && !terminalAiFrontend.includes("TERMINAL_AI_COMMAND_TIMEOUT_MS")
       && terminalAiFrontend.includes('state.permission === "full"')
       && aiServiceSource.includes('permission === "full"')
      && terminalAiFrontend.includes("renderTerminalAiMarkdown")
      && terminalAiFrontend.includes("log-ai-open")
      && terminalAiFrontend.includes("/api/ai/chat")
      && aiServiceSource.includes("redactAiText")
      && aiServiceSource.includes('redirect:"manual"')
       && !aiRoutesSource.includes("requireEncryptionUnlocked")
       && aiRoutesSource.includes("api_key")
       && serverSource.includes("handleAiRoutes"));
   ok("AI 供应商自定义名称可清除默认名称标记",
     read('frontend/src/features/settings/ai-provider-draft.ts').includes('if (change.name !== undefined) provider.default_name = false')
       && read('frontend/src/features/settings/ai-provider-draft.ts').includes('default_name:item.default_name === true')
       && runtimeSettingsSource.includes('Object.prototype.hasOwnProperty.call(source, "default_name")'));
  ok("全局终端设置独立持久化并应用到当前和未来会话",
    runtimeSettingsSource.includes("DEFAULT_TERMINAL_SETTINGS")
      && runtimeSettingsSource.includes("normalizeTerminalSettings")
      && runtimeSettingsSource.includes("schema_version: 22")
      && runtimeSettingsSource.includes("scrollback_lines")
      && runtimeSettingsSource.includes("language: normalizeLanguage")
      && runtimeSettingsSource.includes("language_onboarding_version")
      && runtimeSettingsSource.includes("DEFAULT_TERMINAL_SETTINGS = defaultTerminalSettings")
      && read("src/shared/terminal-settings.ts").includes("background_mode: 'theme'")
      && read("src/shared/terminal-settings.ts").includes("background_color: '#0f1720'")
      && runtimeSettingsSource.includes("TERMINAL_BACKGROUND_MODES")
      && storageRoutesSource.includes("terminal: data.terminal ?? current.terminal")
    && terminalFrontend.includes("terminalServices.termaTerminalSettings.open(key)")
      && terminalFrontend.includes("terminalServices.termaTerminalSettingsModel.theme(terminalServices.termaTerminalSettings.current())")
      && terminalSurfaceSource.includes("theme: port.theme()")
      && terminalSettingsServiceSource.includes("options.theme = theme")
      && terminalSettingsServiceSource.includes("options.minimumContrastRatio = 4.5")
      && terminalSurfaceSource.includes("minimumContrastRatio: 4.5")
      && terminalSettingsServiceSource.includes("for (const session of sessions) {")
      && terminalFrontend.includes("apply: session => terminalServices.termaTerminalSettings.apply(session)")
      && utilsFrontend.includes("terminalServices.termaTerminalSettings?.applyAll()")
      && terminalFrontend.includes("terminalServices.termaTerminalInteraction.bind(session")
      && terminalInteractionSource.includes("registerLinkProvider")
      && terminalInteractionSource.includes("onSelectionChange")
      && terminalInteractionSource.includes("addEventListener('paste'")
      && terminalFrontend.includes("terminalServices.termaTerminalClipboard.send(key, text)")
      && read("frontend/src/features/terminal/terminal-clipboard-service.ts").includes("const edited = await prompt(normalized)")
      && terminalSettingsViewSource.includes("terminal:settings.multiline_prompt")
      && read("frontend/src/features/terminal/terminal-text-dialogs.ts").includes("terminalServices.termaTerminalClipboard!.format(")
      && terminalSettingsViewSource.includes("terminal:settings.scope")
  );
  ok("终端提供带阶段提示的可滚动光标复制",
    terminalFrontend.includes("showTerminalContextMenu(event, key, connectionId)")
      && !terminalFrontend.includes("selectTerminalWordAtPointer")
      && terminalFrontend.includes('tr("terminal:context_menu.session_copy"')
      && terminalFrontend.includes("showTerminalSessionText(key)") && read("frontend/src/features/terminal/terminal-text-dialogs.ts").includes("export function showTerminalSessionText")
      && terminalFrontend.includes('tr("terminal:context_menu.cursor_copy"')
      && terminalFrontend.includes("terminalServices.termaTerminalCursorCopy.start(key)")
      && terminalCursorCopySource.includes("className = 'terminal-cursor-copy-hint'")
      && terminalCursorCopySource.includes("'terminal:settings.cursor_copy_start'")
      && terminalCursorCopySource.includes("'terminal:settings.cursor_copy_end'")
      && terminalCursorCopySource.includes("selectionBackground: '#2563eb'")
      && terminalCursorCopySource.includes("scrollLines(direction)")
      && terminalInteractionSource.includes("touchOffset")
      && read("frontend/src/features/terminal/terminal-input-workspace.ts").includes("navigator.clipboard?.readText")
      && appCss.includes(".terminal-cursor-copy-message")
      && require('./frontend-source').readFrontendDomain(process.cwd(),'utilities').includes("writeClipboardText"));
  ok("工作区按设置恢复所有标签类型", workspaceHost.includes("restore_workspace_tabs") && workspacePersistence.includes("state.persistableTab") && workspacePersistence.includes("const workspaceGroups = controller.serialize()") && !workspacePersistence.includes("tab.kind !== 'terminal'") && read("frontend/src/features/settings/WorkspacePreferences.tsx").includes("['restoreWorkspaceTabs', 'restore_workspace_tabs'"));
  const sftpGlobalSettingsSource = read("frontend/src/features/files/sftp/SftpGlobalSettings.ts");
  ok("SFTP 使用 Ace 编辑器、语言模式、换行、图片预览和页面内全局设置", Boolean(packageJson.dependencies?.["ace-builds"]) && indexHtml.includes("/vendor/ace/ace.js") && serverSource.includes("ACE_VENDOR_DIR") && sftpFrontend.includes("sftpEditorLanguageForFile") && sftpFrontend.includes("ace.edit") && sftpFrontend.includes("setUseWrapMode") && sftpFrontend.includes("preview.image(id, path)") && serverSource.includes("preview-image") && sftpFrontend.includes("sftpGlobalSettingsButton") && sftpFrontend.includes("filesServices.termaSftpGlobalSettings?.open()") && sftpGlobalSettingsSource.includes("sftpMaxOpenFileSizeMb") && !settingsFrontend.includes("function saveSftpGlobalSettings"));
  ok("SFTP 文本冲突使用本地 jsdiff 并提供有界左右对比", Boolean(packageJson.dependencies?.diff) && indexHtml.includes("/vendor/diff/diff.min.js") && serverSource.includes('vendorFile("diff", "dist/diff.min.js")') && sftpFrontend.includes("editorDiff(") && read("frontend/src/features/files/sftp/editor-document.ts").includes("MAX_ROWS = 4000") && read("frontend/src/features/files/sftp/editor-document.ts").includes("timeout: 1500") && read("THIRD_PARTY_NOTICES.md").includes("## jsdiff"));
  ok("SFTP 图片按二进制响应且 JSON 可一键格式化", serverSource.includes("Buffer.isBuffer(data)") && serverSource.includes("data instanceof Uint8Array") && sftpFrontend.includes("sftpTextFormatJson") && sftpFrontend.includes("JSON.stringify(parsed, null, 2)") && sftpFrontend.includes("JSON 格式错误"));
  ok("SFTP 下载按桌面与浏览器分流并管理临时缓存", runtimeSettingsSource.includes("sftp_download_directory") && sftpTransferRoutesSource.includes('deliveryMode:desktop ? "desktop" : "browser"') && sftpJobsSource.includes("autoSaveDownloadedFile") && sftpJobsSource.includes("DOWNLOAD_CACHE_TTL_MS") && sftpJobsSource.includes("BROWSER_DELIVERY_GRACE_MS") && sftpJobsSource.includes("markSftpJobDelivered") && sftpTransferPreparationSource.includes("port.text('sftp:transfer.first_download_title')") && sftpTransferPreparationSource.includes("sftpDesktopDownloadNoticeV1") && sftpTransferPreparationSource.includes("sftpBrowserDownloadNoticeV1") && sftpFrontend.includes("firstDownload.confirm") && sftpFrontend.includes("pendingDownloads: taskState.pendingDownloads") && sftpTaskCardSource.includes('scope.tr("tasks:actions.save_local"') && sftpGlobalSettingsSource.includes("t('sftp:settings.open_directory'") && sftpGlobalSettingsSource.includes("t('sftp:settings.auto_save_directory'"));
  const programCacheSource = read("src/program-cache.ts");
  const settingsGeneralSource = settingsViewSource.slice(settingsViewSource.indexOf('"id": "settings-general"'), settingsViewSource.indexOf('"id": "settings-basic"'));
  ok("通用设置瀑布布局按分屏容器宽度自适应", narrowWorkspaceCss.includes(".settings-grid.settings-waterfall { column-count:1; }"));
  ok("缓存管理独立于通用设置并按分类清理可释放缓存", storageRoutesSource.includes('pathname === "/api/cache"') && storageRoutesSource.includes('searchParams.get("category")') && serverSource.includes("programCacheView") && serverSource.includes("createProgramCacheManager") && programCacheSource.includes("retained_bytes") && programCacheSource.includes('"remote_components"') && programCacheSource.includes('"local_installers"') && read("src/update-installer.ts").includes("clearCache()") && settingsCacheSource.includes("cacheManagementPanelView") && settingsCacheSource.includes('owner.clear(id, label)') && settingsCacheSource.includes("SFTP 拖出") && settingsCacheSource.includes("settings:auto.cache_cleanup") && settingsViewSource.includes('"id": "settings-cache"') && settingsViewSource.indexOf("renderCacheSettings(scope), renderAboutSettings(scope)") >= 0 && !settingsGeneralSource.includes("cacheManagementPanelView"));
  ok("桌面端只向系统打开受信任的终端链接协议", desktopSource.includes('/^(https?|ftp|ssh|telnet):\\/\\//i.test(url)'));
  ok("终端支持 Ctrl 加滚轮平稳调整字号并保持当前阅读位置", terminalFrontend.includes("enableTerminalFontWheel") && terminalInteractionSource.includes("event.ctrlKey") && terminalInteractionSource.includes("event.stopPropagation()") && terminalInteractionSource.includes("capture: true") && terminalInteractionSource.includes("pendingDelta +") && terminalInteractionSource.includes("port.scheduleViewportTask") && terminalInteractionSource.includes("port.cancelViewportTask") && terminalFrontend.includes("termaTerminalViewport.captureSession") && terminalFrontend.includes("termaTerminalViewport.fitSession") && read("frontend/src/features/terminal/terminal-input-workspace.ts").includes("terminalViewport.flushSession(session)") && terminalViewportSource.includes("function scrollToLine") && terminalViewportSource.includes("viewport.scrollToLine(line, true)") && terminalViewportSource.includes("Math.abs(current - target) < 0.5"));
  ok("终端断开后支持按 Enter 重连并保留屏幕内容和标签级日志", terminalTransport.includes("terminal:system.closed_reconnect") && terminalTransport.includes("port.reconnectInput(data)") && terminalFrontend.includes("terminalReconnectInput(data)") && read("public/locales/zh-CN/terminal.json").includes("reconnecting_preserved") && !terminalFrontend.includes("session.term.reset()") && terminalConnection.includes("log_id=") && terminalSurfaceSource.includes("logId: port.logId()") && read("src/remote-terminal.ts").includes('url.searchParams.get("log_id")') && read("src/logs.ts").includes("terminalLogIdentity") && read("src/logs.ts").includes("重新连接时间"));
  ok("终端工具栏操作结束后恢复输入焦点", utilsFrontend.includes("function keepTerminalKeyboardClosed(event)") && utilsFrontend.includes("event?.preventDefault?.()") && terminalFrontend.includes("focusTerminalSession(key)") && read("frontend/src/features/forwards/forward-actions.ts").includes("scope.focus()") && forwardWorkspaceSource.includes("const inTab = host.captureTab"));
  ok("终端日志列表单独完整显示日期和时间", read("frontend/src/features/logs/LogListViews.ts").includes("log-item-time") && read("frontend/src/styles/log-list.css").includes("white-space:nowrap"));
  ok("远程桌面支持 TigerVNC、手动 noVNC 与系统客户端回退", Boolean(packageJson.dependencies?.["@novnc/novnc"]) && packageJson.scripts?.["vnc:prepare"] && serverSource.includes('pathname.startsWith("/vendor/novnc/")') && remoteProfileModel.includes("client_mode:text('vnc_client_mode')") && remoteProfileView.includes("['bundled',tr('bundled_tigervnc'") && remoteFrontend.includes("bundled_tigervnc") && dbSource.includes('client_mode:new Set(["auto", "bundled", "embedded", "system"])') && read("src/vnc-proxy.ts").includes("handleVncUpgrade"));
  const vncSessionOwner = fs.readFileSync(path.join(root, 'frontend/src/features/remote/vnc-session-service.ts'), 'utf8');
  ok("VNC 支持可选保存密码并在认证失败后重输更新", vncSessionOwner.includes("on('securityfailure'") && vncSessionOwner.includes("result.update_saved_password") && remoteFrontend.includes("自动传给内置 TigerVNC Viewer") && serverSource.includes('parts[3] === "vnc-credential"') && dbSource.includes("getVncProfileCredential") && fs.existsSync(path.join(root, "scripts/vnc-credential-check.js")));
  ok("其他协议新建表单支持保存并清空且 SSH 更多菜单保持精简", remoteProfileView.includes("'data-clear-after-save':'1'") && remoteProfileService.includes("remote:notifications.profile_saved_continue") && !connectionsFrontend.includes('label:"复制 SSH 命令"') && !connectionsFrontend.includes('label:"复制 SFTP 命令"') && !connectionsFrontend.includes('label:"用 VS Code Remote SSH 打开"'));
  ok("SSH 与其他连接编辑页支持仅保存、保存并关闭或保存并打开", connectionViewsSource.includes('"id": "connSaveOnly"') && connectionViewsSource.includes('"hidden": !editing') && connectionViewsSource.includes('connections:auto.save_only') && connectionViewsSource.includes(`"data-save-action": editing ? 'close' : null`) && connectionViewsSource.includes(`"data-close-after-save": editing ? '1' : null`) && connectionsFrontend.includes('connections:auto.save_close') && connectionsFrontend.includes('connections:auto.save_open') && staticActionsFrontend.includes("connectAfterSave:true") && staticActionsFrontend.includes("closeAfterSave:dataset.closeAfterSave === '1'") && remoteProfileView.includes("'data-save-action':'save'") && remoteProfileView.includes("tr('save_only'") && remoteProfileView.includes("'data-save-action':'close'") && remoteProfileView.includes("'data-save-action':'open'") && remoteEditSaveBranch.includes("action !== 'close' && action !== 'open'") && remoteEditSaveBranch.includes('host.open(saved, {forceLaunch: true})'));
  ok("连接编辑保存成功静默关闭源标签且错误仍提示", sshEditSaveBranch.includes("sourceTab.pinned = false") && sshEditSaveBranch.includes("closeTabsByKey([sourceTabKey], sourceTabKey)") && !sshEditSaveBranch.includes("notify(") && sshSaveService.includes("port.notify(port.localizedTermaUiPhrase(message), 'error')") && remoteEditSaveBranch.includes("tab.pinned = false") && remoteEditSaveBranch.includes("host.close(tab.key)") && !remoteEditSaveBranch.includes("notify(") && remoteProfileService.includes("port.tr('remote:notifications.profile_save_failed')") && remoteProfileService.includes("port.notify(state.error, 'error')"));
  const tabActionsSource = read('frontend/src/features/workspace/workspace-tab-actions.ts');
  const workspaceTabRuntime = read("frontend/src/features/workspace/workspace-tab-runtime.ts");
  ok("SSH 与其他连接标签右键支持快速编辑且拒绝临时连接", tabActionsSource.includes("!tab.quick_connection && !tab.transient") && tabActionsSource.includes("common:command_palette.edit_connection") && workspaceHost.includes("termaWorkspaceTabRuntime.connectionKind(tab)") && workspaceTabRuntime.includes("SSH_CONNECTION_TAB_KINDS.has(tab.kind)") && workspaceTabRuntime.includes("REMOTE_CONNECTION_TAB_KINDS.has(tab.kind)"));
  ok("VNC 内部全屏快捷栏位于通用设置并支持可靠顶部边界触发与移出延时", settingsViewSource.includes('"id": "settings-general"') && settingsViewSource.includes("h(WorkspacePreferences") && read("frontend/src/features/settings/WorkspacePreferences.tsx").includes('id="generalVncFullscreenToolbar"') && !settingsFrontend.includes('"id": "runtimeVncFullscreenToolbar"') && read('frontend/src/features/remote/RemoteDesktopViews.ts').includes("class: 'vnc-fullscreen-toolbar-edge-zone'") && read('frontend/src/features/remote/vnc-fullscreen.ts').includes("['pointerover','pointermove','mouseover','mousemove']") && read('frontend/src/features/remote/vnc-fullscreen.ts').includes('doc.addEventListener(type,pointer,true)') && read('frontend/src/features/remote/vnc-fullscreen.ts').includes('function hide(delay=500)') && appCss.includes(".vnc-fullscreen-toolbar-edge-zone:hover + .vnc-toolbar") && appCss.includes(".vnc-toolbar:has(:focus-visible)") && !appCss.includes(".vnc-toolbar:focus-within"));
  ok("VNC 新窗口使用原生标题栏并保持弹窗通知可见", desktopSource.includes('fetchJson("/api/remote-profiles")') && !desktopSource.includes("terma:vnc-window-maximize") && !read("desktop/preload.js").includes("toggleVncWindowMaximize") && !remoteFrontend.includes("data-vnc-window-maximize") && appCss.includes("html.vnc-fullscreen-document:fullscreen .modal { z-index:60030; }") && appCss.includes("html.vnc-fullscreen-document:fullscreen .notification-stack { z-index:var(--z-notification); }") && appCss.includes("body.vnc-detached-window-body .app { display:none !important; }") && !appCss.includes("vnc-detached-window-body #toast") && !appCss.includes("vnc-detached-window-body #modal"));
  ok("同一 VNC 连接只保留一个查看器并通过探测页切换窗口", desktopSource.includes("const detachedVncWindows = new Map()") && desktopSource.includes("activeDetachedVncWindow(id)") && desktopSource.includes('ipcMain.handle("terma:vnc-close-profile-window"') && read("desktop/preload.js").includes("closeVncWindowForProfile(profileId)") && read('frontend/src/features/remote/vnc-window-service.ts').includes('port.closeSession(key);port.disconnected(key)') && read('frontend/src/features/remote/vnc-runtime.ts').includes('desktop.open(id,false,true)') && read('frontend/src/features/remote/vnc-session-service.ts').includes('await port.prepareEmbedded(id)') && read('frontend/src/features/remote/vnc-window-service.ts').includes('await prepare(id,key)'));
  ok("系统远程客户端启动前重新探测并返回本地化结构化错误", read("frontend/src/features/remote/client-service.ts").includes("port.api('/api/remote-clients/diagnostics')") && read("frontend/src/features/remote/launch-service.ts").includes("port.clientReason(item, diagnostics, profile.protocol)") && remoteClientRuntime.includes("remoteServices.termaRemoteDesktop.presentation.reason(item, diagnostics, protocol)") && serverSource.includes('failure.publicCode = "remote_client_launch_failed"') && serverSource.includes("failure.publicParams") && read("public/locales/zh-CN/errors.json").includes('"remote_client_launch_failed"') && read("public/locales/en-US/errors.json").includes('"remote_client_launch_failed"'));
  ok("SSH 与其他协议使用独立活动入口并支持单个或全部快捷生成", indexHtml.includes('id="navRemote"') && indexHtml.includes('id="mobileRemote"') && connectionViewsSource.includes('"id": "conn_remote_generation"') && workspaceFrontend.includes('primaryView === "remote"') && connectionMenuSource.includes("connections:actions.generate_other_connections") && read("frontend/src/features/remote/profile-menu-actions.ts").includes("service.generate(id, protocol)") && read("frontend/src/features/remote/profile-menu-actions.ts").includes("service.generate(id, 'all')") && serverSource.includes('data.protocol || "").toLowerCase() === "all"') && dbSource.includes('createAllRemoteProfilesFromConnection') && fs.existsSync(path.join(root, "scripts/remote-profile-from-ssh-check.js")));
  ok("动作菜单左对齐并保留桌面父级子菜单", terminalActionMenuFrontend.includes("desktopPath") && terminalActionMenuFrontend.includes("action-submenu") && connectionMenuSource.includes("children: () => port.x11(id)") && connectionMenuSource.includes("children: () => port.remoteCreate(id)") && connectionsFrontend.includes("x11: id => x11Services.termaX11TerminalMenu?.actions(id)") && connectionsFrontend.includes("remoteCreate: id => remoteServices.termaRemoteList.fromSsh(id)") && appCss.includes(".action-menu button.has-submenu") && appCss.includes(".context-menu button") && appCss.includes("justify-content:flex-start !important"));
  ok("Windows 内置 X Server 支持自动识别 SSH 图形应用、软件光标和 XDMCP 完整桌面", read("frontend/src/features/x11/launcher-service.ts").includes("/x11-applications") && read("frontend/src/features/x11/terminal-service.ts").includes("x11-applications/verify") && read("src/x11.ts").includes("X11_APPLICATION_CATALOG") && read("src/ssh2-client.ts").includes("openBuiltinX11Channel") && remoteProfileModel.includes("xdmcp: {label:'XDMCP', icon:'panels-top-left', port:177, workspace:'desktop'}") && dbSource.includes('"rdp", "vnc", "xdmcp", "ftp"') && desktopSource.includes("openXdmcp") && read("desktop/xserver-runtime.js").includes('mode === "broadcast" ? "-broadcast"') && read("desktop/xserver-runtime.js").includes('"-swcursor"') && serverSource.includes("desktopIntegration?.testXdmcp"));
  ok("SSH 派生 RDP 不复用 SSH 用户名且保留显示设置", read("desktop/remote-clients.js").includes("source_ssh_connection_id") && read("desktop/remote-clients.js").includes("writeRdpFile(profile, {omitUsername:true})") && read("desktop/remote-clients.js").includes("dynamic resolution:i:") && dbSource.includes('username:["vnc", "ftp"].includes(protocol)'));
  ok("XDMCP 自动探测桌面与管理常见显示管理器", remoteProfileView.includes("remote_xdmcp_ssh_connection") && remoteDesktopRuntime.includes("termaRemoteManagement.protocol.inspect") && read("frontend/src/features/remote/management-runtime.ts").includes("protocol.operate(id, 'xdmcp'") && dbSource.includes("ssh_connection_id:integer") && serverSource.includes("detectXdmcpServer") && serverSource.includes("configureXdmcpServer") && read("src/xdmcp-manager.ts").includes("lightdm-gtk-greeter") && read("src/xdmcp-manager.ts").includes("WaylandEnable"));
  ok("桌面版可安装当前平台缺少的图形组件", read("desktop/xserver-runtime.js").includes("XQUARTZ_SHA256") && read("desktop/xserver-runtime.js").includes("XQUARTZ_TEAM_ID") && read("desktop/xserver-runtime.js").includes("with administrator privileges") && read("desktop/xserver-runtime.js").includes("installLinuxGraphicsComponents") && read("frontend/src/features/quick/quick-views.ts").includes("x11Services.termaX11.manager.operate('install'") && serverSource.includes('pathname === "/api/xserver/install"'));
  ok("旧远程配置无损解除协议白名单约束", dbSource.includes("remote_profiles_legacy_protocol_check") && dbSource.includes("INSERT INTO remote_profiles(id,name,group_name,protocol") && fs.existsSync(path.join(root, "scripts/remote-profile-migration-check.js")));
  ok("SSH 诊断只在明确跳板错误时提示跳板机", read("src/ssh-diagnostics.ts").includes('/jump host|proxyjump|proxy jump|jumphost/') && read("src/ssh-diagnostics.ts").includes('reason = "转发目标连接失败"'));
  ok("连接健康状态使用主题图标且保活字段保持紧凑", connectionViewsSource.includes('"class": ["health-badge", healthClass]') && connectionViewsSource.includes('"title": healthStatusText, "aria-label": healthStatusText') && connectionsFrontend.includes('connections:groups.health_status') && connectionViewsSource.includes('connectionIcon(health.ok ? "circle-check" : "circle-alert")') && connectionViewsSource.includes('connections:auto.keepalive_interval') && connectionViewsSource.includes('"id": "conn_keepalive_interval_help"'));
  const commandPaletteSource = read("frontend/src/features/efficiency/efficiency-runtime.ts"),paletteModelSource=read("frontend/src/features/efficiency/palette-model.ts"),paletteViewSource=read("frontend/src/features/efficiency/PaletteView.ts");
  const quickConnectSearchSource = read("frontend/src/features/quick/quick-connect-search-service.ts");
  ok("命令窗口默认不铺开连接和命令片段并在搜索时显示远程资源", quickConnectSearchSource.includes("function forwardRows") && quickConnectSearchSource.includes("forwardSearchText") && quickConnectSearchSource.includes("QUICK_RESULT_LIMIT = 120") && read("frontend/src/features/quick/quick-mount.ts").includes("requestAnimationFrame") && quickConnectSearchSource.includes("url_path") && quickViewsVue.includes('data-dblclick-action": "quick-connect-forward"') && quickViewsVue.includes('"data-forward-id": forward.id') && paletteViewSource.includes('"data-action": "quick-panel-remote-open"') && paletteViewSource.includes('navigation:auto.command_window') && commandPaletteSource.includes("registerPaletteActions") && paletteModelSource.includes("if(needle||target)") && commandPaletteSource.includes("scheduleQuickPanelRender") && paletteModelSource.includes("if(needle)for(const s of data.snippets)") && paletteModelSource.includes("kind:'snippet'"));
  ok("SFTP Shell 换行符可选且非 LF 保存有明确兼容性确认", sftpFrontend.includes("unsafeScriptLineEnding") && sftpFrontend.includes("shell_line_ending_warning") && sftpFrontend.includes("sftpLineEnding") && !sftpFrontend.includes('id="sftpLineEnding" ${unixScript ? "disabled"') && read("src/services/sftp-content-service.ts").includes('["lf", "crlf", "cr"].includes(requestedLineEnding) ? requestedLineEnding : (unixScript ? "lf" : "")'));
  ok("SFTP 编辑统计与全文搜索合并连续输入并在保存时精确校验", sftpFrontend.includes("scheduleEditorStats") && sftpFrontend.includes("editorSearchTimer") && sftpFrontend.includes("}, 120)") && sftpFrontend.includes("updateStats(true, getValue(), savedEncoding)"));
  ok("非 UTF-8 终端使用流式双向转码", terminalSource.includes('require("iconv-lite")') && terminalSource.includes("iconv.getDecoder(encoding)") && terminalSource.includes("iconv.encode(text, session.terminalEncoding)") && terminalSource.includes('connection.terminal_encoding || "utf8"'));
  ok("终端显示与日志共享解码文本且交互连接禁用 Nagle", terminalSource.includes("emitTerminalOutput(session, decoded, 1)") && terminalSource.includes("appendTerminalLog(session.logFile, data)") && terminalSource.includes("socket.setNoDelay?.(true)") && read("src/ssh2-client.ts").includes("_sock?.setNoDelay?.(true)"));
  ok("终端移除旧延迟采样与设置", !frontend.includes('terminalLatencyVisible') && !terminalFrontend.includes('startTerminalLatencySample') && !settingsFrontend.includes('terminalLatencyVisible'));
  ok("终端连接状态省略时悬停显示完整地址与状态", terminalFrontend.includes("updateTerminalConnectionStatus") && terminalFrontend.includes("updateTerminalStatusForLayout") && terminalToolbarModelSource.includes('statusTitle: `${address} · ${stateLabel}`') && terminalToolbarViewSource.includes('title: model.statusTitle'));
  ok("终端工具栏桌面端使用纯图标并在窄屏分行保留全部按钮", appCss.includes("container-name:terminal-view") && appCss.includes("@container terminal-view (max-width:1080px)") && appCss.includes("@container terminal-toolbar (max-width:1080px)") && appCss.includes("@media (min-width:761px) and (hover:hover) and (pointer:fine)") && appCss.includes(".terminal-actions > button > span:not(.composite-icon)") && terminalToolbarModelSource.includes("tr('terminal:toolbar.forward_list'") && terminalToolbarViewSource.includes("'terminal-action-forward-list'") && terminalToolbarViewSource.includes("'earth'"));
  const quickHeaderSource = read("frontend/src/features/quick/QuickHeader.ts");
  ok("X11、连接快捷入口和窗口标题保持统一", iconDefinition(undefined, "x11").attributes.class === "composite-icon x11-icon" && settingsVueSource.includes('settingsIcon("x11")') && terminalToolbarViewSource.includes("'x11'") && quickHeaderSource.includes("class: 'xserver-x-icon'") && quickHeaderSource.includes("h('ellipse'") && !productivityFrontend.includes('button.innerHTML = icon("x11")') && connectionViewsSource.includes('"data-action": "connection-open-sftp"') && connectionViewsSource.includes('"data-dblclick-action": "connection-open-terminal"') && read("frontend/src/features/remote/remote-desktop-runtime.ts").includes("jumpActions: relations.workspaceActions") && read("frontend/src/features/remote/profile-relations.ts").includes("function alternatives") && connectionViewsSource.includes('onDblclick') && connectionViewsSource.includes('scope.openRemoteProfile') && workspaceTabPresentation.includes("syncWorkspaceDocumentTitle") && workspaceTabPresentation.includes("compactWorkspaceTabTitle({...tab, ...meta") && workspaceTabPresentation.includes("workspaceDocumentResourceIdentity(resource)") && workspaceTabPresentation.includes('const parts = [endpoint, label, uniqueResource, "Terma"]') && workspaceTabPresentation.includes("desktop?.setWindowTitle?.(document.title)") && desktopSource.includes("normalizeMainWindowTitle(value)"));
  ok("新标签插入当前标签之后且工作区恢复不被启动阶段覆盖", workspaceStateSource.includes("nextTabs.splice(insertion >= 0 ? insertion + 1 : nextTabs.length") && dockingFrontend.includes("termaWorkspaceState!.addTab(applicationState.tabs, insertionAnchorKey") && dockingFrontend.includes("pane.tabs.splice(insertion >= 0 ? insertion + 1 : pane.tabs.length") && workspaceBootstrap.includes("applicationState.workspaceRestorePending = true") && workspaceHost.includes("pending:() => Boolean(applicationState.workspaceRestorePending)") && workspacePersistence.includes("if (port.pending()) return") && workspaceRestoreDelegated);
  ok("SFTP 任务中心宽高跨重启持久化且异常尺寸可恢复", sftpTasksFrontend.includes('SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1"') && sftpTasksFrontend.includes("persistSftpTaskCenterSize") && sftpTasksFrontend.includes("restoreSftpTaskCenterSize") && sftpTasksFrontend.includes('drawer.closest(".content")') && sftpTasksFrontend.includes("ensureSftpTaskCenterBoundsMonitoring") && sftpTasksFrontend.includes("localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY)") && indexHtml.includes('id="sftpTaskCenterResetSizeButton"'));
  const terminalControlsCss = read("frontend/src/styles/terminal-controls.css");
  const mobileWorkspaceCss = workspaceCss;
  const mobileTerminalToolbarRule = /\.terminal-toolbar \.terminal-actions > button:not\(\.terminal-global-settings-button\)\s*\{[^}]*width:30px;[^}]*height:30px;/s;
  ok("移动端终端 SFTP 按钮由终端样式紧凑显示并保留可访问名称", !indexHtml.includes('app-mobile-workspace.css') && mobileTerminalToolbarRule.test(terminalControlsCss) && !mobileWorkspaceCss.includes('.terminal-toolbar .terminal-actions > button') && terminalToolbarViewSource.includes("'aria-label': title || label") && terminalToolbarViewSource.includes('model.sftpTitle'));
  ok("SFTP 打开文件时显示状态、阻止重复请求并清除进度提示", read("frontend/src/features/files/sftp/preview-workspace.ts").includes("port.opening(id, path") && sftpFileOpenSource.includes('progress.complete()') && sftpViewSource.includes("opening ? 'auto.opening'") && sftpViewSource.includes("disabled: opening"));
  ok("SFTP 同一连接同一路径的文本编辑器复用并可恢复最小化窗口", sftpFrontend.includes("sftpTextEditorOpenKey") && sftpFrontend.includes("activateSftpTextEditor") && sftpFrontend.includes("sftpFloatingEditorRegistry") && sftpFrontend.includes("editorKey"));
  ok("SFTP 后台目录读取不因切换标签丢失并在恢复时重绘", sftpDirectoryLoaderSource.includes("const data=await port.request(id,params,controller.signal);if(!current()||controller.signal.aborted)return false;") && sftpDirectoryLoaderSource.includes("runtime.state.requestSeq===sequence") && sftpDirectoryLoaderSource.includes("const mounted=!!runtime.root?.isConnected") && sftpPageLifecycleSource.includes("if(!runtime.state.loading)") && sftpPageLifecycleSource.includes("runtime.renderedRequestSeq!==Number(runtime.state.requestSeq||0)") && sftpPageLifecycleSource.includes("port.paint(key,'list')") && read("frontend/src/features/files/sftp/directory-workspace.ts").includes("request: requests.request"));
  ok("SFTP 任务完成事件立即清理悬浮进行中状态", notificationEntrySource.includes("complete: sftpTransfers.completion.complete") && notificationEventSource.includes("event.action?.sftp_job_id") && notificationEventSource.includes("hooks.refreshSftpJobs") && notificationEntrySource.includes("sftpTransfers.completion.settle(event)") && read("src/sftp-upload-jobs.ts").includes("sftp_job_id:job.id") && sftpJobsSource.includes("sftp_job_id: job.id"));
  ok("通知仅在鼠标悬停或获得焦点时暂停销毁计时", toastViewSource.includes("onPointerenter:") && toastViewSource.includes("onPointerleave:") && toastViewSource.includes("onFocusin:") && toastViewSource.includes("onFocusout:") && !toastViewSource.includes("selectionchange") && !toastServiceSource.includes("selectionchange"));
  ok("SVG 搜索使用目标元素边框和尺寸标签定位", sftpPreviewFrontend.includes("dataset.label") && sftpPreviewFrontend.includes("bounds.width * scale") && appCss.includes(".sftp-svg-match-marker::after") && appCss.includes("content:attr(data-label)"));
  ok("SFTP 文本差异预览可以关闭并在失败时恢复", sftpFrontend.includes("closeDiffPreview") && sftpFrontend.includes("sftpDiffClose") && sftpFrontend.includes("diffRequestSequence") && appCss.includes(".sftp-diff-preview-head"));
  ok("SFTP 文本编辑支持检测、切换并保持编码", read("src/sftp.ts").includes("decodeRemoteText") && read("src/sftp.ts").includes("encodeRemoteText") && sftpFrontend.includes("sftpTextEncodingOptions") && sftpFrontend.includes("persist_default") && dbSource.includes("sftp_text_encoding TEXT NOT NULL DEFAULT 'auto'"));
  ok("SFTP 文件名编码独立切换并持久化", read("src/sftp.ts").includes("decodeRemoteFilenameOutput") && read("src/sftp.ts").includes("remotePathOperand") && sftpFrontend.includes("preferences.encoding(id, value)") && dbSource.includes("sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8'"));
  ok("SFTP 目录导航使用 LRU 缓存并按变化静默刷新", sftpDirectoryCacheSource.includes("const ttl = 10*60*1000") && sftpDirectoryCacheSource.includes("while(views.size>60||count>5000)") && sftpFrontend.includes("renderIfChangedOnly:true") && sftpFrontend.includes("silent:true") && read("frontend/src/entries/about-embed.ts").includes("clearCache: id => sftpDirectory.cache.clearConnection(id)"));
  ok("SFTP 文件夹大小按需递归读取精确字节并兼容 GNU/BSD stat", sftpBackend.includes("buildRemoteDirectorySizeCommand") && sftpBackend.includes("stat -c '%s'") && sftpBackend.includes("stat -f '%z'") && sftpBackend.includes('find "$TERMA_TARGET" -type f') && sftpBackend.includes("未返回不完整大小") && !sftpBackend.includes("du -") && serverSource.includes('parts[4] === "directory-size"') && sftpViewSource.includes("data-sftp-directory-size") && read("frontend/src/entries/about-embed.ts").includes("/sftp/directory-size"));
  ok("终端与 SFTP 可以按连接双向跳转", read("frontend/src/features/terminal/terminal-toolbar-service.ts").includes('sftp: id => filesServices.termaSftpPage.open(id)') && terminalToolbarViewSource.includes('actionsPort?.sftp(model.connectionId)') && read("frontend/src/features/files/sftp/view-workspace.ts").includes("terminal: () => openTerminal(id)"));
  ok("SFTP 支持可暂停续传的跨主机复制", sftpJobsSource.includes("createCheckpointTransfers") && sftpJobsSource.includes("checkpoint_manifest") && sftpJobsSource.includes("checkpoint_staging_path") && !sftpJobsSource.includes("source.stdout.pipe(target.stdin)") && sftpCopyServiceSource.includes("/sftp/cross-copy"));
  ok("终端与批量命令共享严格 WebSocket 帧解析器", terminalSource.includes("WebSocketFrameParser") && read("src/commands.ts").includes("WebSocketFrameParser") && read("src/websocket.ts").includes("客户端 WebSocket 数据帧必须掩码") && read("src/websocket.ts").includes("fragmentOpcode"));
  ok("终端 WebSocket 升级可安全处理客户端提前断开", terminalSource.includes('socket.on("error", () => {});') && /try\s*\{\s*return socket\.write/.test(read("src/websocket.ts")));
  const terminalDropWorkspace=read("frontend/src/features/terminal/terminal-drop-workspace.ts");
  const terminalDropService=read("frontend/src/features/terminal/terminal-drop-service.ts");
  ok("终端拖入继续使用 SFTP 并明确原登录用户权限边界", terminalDropWorkspace.includes("termaSftpTransfers.controller.submit(files,id,path,{tabKey:key,isCurrent:valid})") && terminalDropService.includes("terminal:drop.sftp_login_identity_hint") && terminalDropService.includes("terminal:drop.upload_failed_identity_hint") && !terminalDropWorkspace.includes("terminalZmodemUploadDroppedFiles"));
  ok("连接列表消除转发 N+1 查询并补索引", dbSource.includes('all("SELECT * FROM connection_forwards ORDER BY connection_id,id")') && dbSource.includes("idx_connection_forwards_connection_id") && dbSource.includes("idx_connections_group_sort"));
  ok("SFTP 大文件任务使用单一防抖写入且桌面保存不阻塞主循环", sftpJobsSource.includes("persistRequestedAt") && sftpJobsSource.includes("const flush = () =>") && sftpJobsSource.includes('require("node:stream/promises")') && sftpJobsSource.includes("await pipeline(input, output, {signal})") && sftpJobsSource.includes('job.phase = "system-saving"') && !sftpJobsSource.includes("copyFileSync") && read("src/sftp-job-store.ts").includes("fs.renameSync(temporary, file)") && read("src/logs.ts").includes("queueLogWrite") && !read("src/logs.ts").includes("fs.appendFileSync(logFile"));
  ok("同名私钥不会绕过连接级绑定", importerSource.includes("identity_file: null") && importerSource.includes("missing_identity: Boolean(keyName)") && !importerSource.includes("identityFileMap") && serverSource.includes("const target = requested ?") && !serverSource.includes("existingByName.get(keyName)"));
  ok("私钥绑定只接受已枚举路径", serverSource.includes("allowedPaths.has(path.resolve(requested))") && serverSource.includes("私钥绑定无效，请重新选择"));
  ok("SSH config 与数据库恢复允许保留未绑定私钥", !importFrontend.includes("个连接尚未绑定私钥") && importFrontend.includes("restore_intro") && serverSource.includes("updateIdentity.run(null, item.connection_id)") && !serverSource.includes("数据库备份中的连接尚未全部绑定私钥"));
  ok("数据库恢复后重新打开句柄并自动刷新", backupRestoreRoutesSource.includes("dependencies.reopenDatabase()") && backupRestoreRoutesSource.includes("database_reopened:true") && importFrontend.includes("database_restored") && importFrontend.includes("await port.reload()"));
  ok("数据库迁移包同步启用或关闭加密状态", backupRestoreRoutesSource.includes("if (stage.security) {") && backupRestoreRoutesSource.includes("encryption_enabled:Boolean(stage.security.encryption_enabled)"));
  ok("导入导出按 SSH config 与数据库拆分", importFrontend.includes('ssh_config_import_export') && importFrontend.includes('database_import_export') && exchangeViewsSource.indexOf('settings:auto.export_config') < exchangeViewsSource.indexOf('settings:auto.database_import_export'));
  const settingsNavIds = [...settingsNavController.matchAll(/^  \['(settings-[a-z-]+)'/gm)].map(match=>match[1]);
  ok("设置活动栏按职责重组并把缓存管理放在关于上方", JSON.stringify(settingsNavIds) === JSON.stringify(['settings-general','settings-ai','settings-basic','settings-key-management','settings-notifications','settings-runtime','settings-cache','settings-about']) && settingsNavSource.includes('TermaButton') && settingsNavSource.includes('termaSettingsNavigation.open(id)') && settingsViewSource.includes('"id": "settings-ai"') && settingsViewSource.includes('storageSettingsPanelView(scope)'));
  ok("桌面设置并入程序且菜单去重", settingsFrontend.includes("desktopBehaviorPanelView") && settingsFrontend.includes("storageSettingsPanelView") && settingsFrontend.includes("chooseDesktopVncClient") && storageRoutesSource.includes('pathname === "/api/desktop-settings"') && storageRoutesSource.includes('pathname === "/api/desktop-settings/choose-vnc-client"') && desktopSource.includes("vncClientPath") && desktopSource.includes("chooseVncClient") && desktopSource.includes("firstUse") && desktopSource.includes("会持久化保存到 Terma 设置中") && !appMenuSource.includes('{ label: "设置"') && !trayMenuSource.includes('{ label: "设置"') && !trayMenuSource.includes("备份配置数据库"));
  ok("桌面窗口隐藏原生菜单栏且保留托盘右键菜单", desktopSource.includes('const PRODUCT_NAME = "Terma"') && appMenuSource.includes("Menu.setApplicationMenu(null)") && trayMenuSource.includes('desktopUiText(`打开 ${PRODUCT_NAME}`, `Open ${PRODUCT_NAME}`)') && trayMenuSource.includes('desktopUiText("在浏览器打开", "Open in browser")') && trayMenuSource.includes('desktopUiText(`退出 ${PRODUCT_NAME}`, `Quit ${PRODUCT_NAME}`)'));
  ok("桌面原生标题栏与应用明暗主题同步", desktopSource.includes('preload: path.join(__dirname, "preload.js")') && desktopSource.includes("nativeTheme.themeSource = theme") && desktopSource.includes('ipcMain.on("terma:set-theme"') && read("desktop/preload.js").includes('ipcRenderer.send("terma:set-theme"') && require('./frontend-source').readFrontendDomain(process.cwd(),'utilities').includes("window.termaDesktop?.setTheme?.(theme)"));
  ok("桌面最小化后终端输出继续刷新且标签切换不暂停后台会话", desktopSource.includes("backgroundThrottling: false")
    && terminalTransport.includes("port.queueOutput(session, terminalOutput)")
    && terminalOutputFlowServiceSource.includes("globalThis.setTimeout(() => drain(session), delay)")
    && terminalOutputFlowServiceSource.includes("TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS")
    && !terminalOutputFrontend.includes("requestAnimationFrame(() => drainTerminalOutput")
    && !terminalOutputFrontend.includes("activeTabKey")
    && terminalOutputFrontend.includes("function resumeSessions(")
    && workspaceBootstrap.includes('  startApplicationLifecycle();')
    && read("frontend/src/shared/application-lifecycle-service.ts").includes("listen(port.window, 'focus', scheduleResume)"));
  ok("桌面活动栏切换整个操作面板并支持调节宽度", !indexHtml.includes('id="operationPaneToggle"') && indexHtml.includes('id="operationPaneExpand"') && indexHtml.includes('data-action="static-operation-expand"') && indexHtml.includes('id="operationPaneCollapse"') && indexHtml.includes('id="activityBarResize"') && indexHtml.includes('class="brand-mark"') && indexHtml.includes('class="brand-name-full"') && indexHtml.includes('data-primary="connections" data-explorer="true"') && indexHtml.includes('data-primary="settings" data-explorer="true"') && staticActionsFrontend.includes("'static-operation-expand':") && workspaceShell.includes('setCollapsed(view === previous && !collapsed)') && workspaceShell.includes("const collapsedKey = 'operationPaneCollapsed'") && workspaceChrome.includes("key: 'activityBarWidth'") && appCss.includes("--activity-bar-width:40px") && appCss.includes("grid-template-columns:var(--activity-bar-width) minmax(0,1fr)") && appCss.includes(".brand-mark { width:24px") && appCss.includes(".brand-name-full { white-space:nowrap; }") && appCss.includes(".app.operation-pane-collapsed .operation-pane-expand"));
  ok("桌面操作区宽度可调并记忆，移动端隐藏调节柄", indexHtml.includes('id="operationPaneResize"') && workspaceChrome.includes("min: 260, max: 520, initial: 292, key: 'operationPaneWidth'") && workspaceChrome.includes('localStorage.setItem(key, String(value))') && appCss.includes("--operation-pane-width:292px") && appCss.includes(".operation-pane-resizer") && appCss.includes(".operation-pane-narrow .conn-footer") && appCss.includes(".operation-pane-pin, .operation-pane-collapse, .operation-pane-pin-guide, .operation-pane-resizer { display:none !important; }"));
  ok("七个操作区分别固定或点击工作区自动收起并提供一次性引导", indexHtml.includes('id="operationPanePin"') && indexHtml.includes('id="operationPanePinGuide"') && workspaceShell.includes("const views = ['connections', 'remote', 'running', 'command', 'import', 'logs', 'settings']") && workspaceShell.includes("const guideKey = 'operationPanePinGuideSeenV3'") && workspaceShell.includes("addEventListener('click', contentClick, true)") && workspaceShell.includes("if (isMobileLayout() || event.button !== 0) return") && workspaceShell.includes("function positionGuide()") && appCss.includes("--operation-pane-pin-guide-anchor") && appCss.includes(".operation-pane-pin, .operation-pane-collapse, .operation-pane-pin-guide, .operation-pane-resizer { display:none !important; }"));
  ok("主题和刷新入口位于活动栏底部且保留移动端入口", indexHtml.indexOf('id="themeToggle"') > indexHtml.indexOf('class="activity-bottom"') && indexHtml.indexOf('id="activityRefresh"') > indexHtml.indexOf('id="themeToggle"') && indexHtml.indexOf('class="github-link"') > indexHtml.indexOf('id="activityRefresh"') && indexHtml.includes("mobile-brand-action theme-toggle") && require('./frontend-source').readFrontendDomain(process.cwd(),'utilities').includes('querySelectorAll(".theme-toggle")'));
  ok("终端工具栏使用紧凑单行控件", appCss.includes(".terminal-actions { flex:1 1 590px; flex-wrap:nowrap") && appCss.includes(".terminal-actions button { flex:0 0 auto; height:30px") && appCss.includes(".terminal-actions button > svg.lucide { width:14px"));
  ok(
    "桌面工作区标题、标签可调且终端内容使用窄边距",
    appCss.includes("--workspace-header-height:42px")
      && appCss.includes("--workspace-tab-height:32px")
      && appCss.includes(".left-pane { grid-template-rows:var(--workspace-header-height)")
      && appCss.includes(".brand, .topbar { height:var(--workspace-header-height)")
      && appCss.includes(".tabs-shell { position:relative; height:var(--workspace-tab-height)")
      && appCss.includes(".workspace-pane.terminal-pane > .workspace { padding:4px 2px 2px; scrollbar-gutter:auto; }")
      && read("frontend/src/features/workspace/workspace-chrome-service.ts").includes("key: 'workspaceHeaderHeight'")
      && read("frontend/src/features/workspace/workspace-chrome-service.ts").includes("key: 'workspaceTabHeight'")
  );
  ok("分屏间隔保持窄视觉和宽拖动热区",
    workspaceCss.includes("2px minmax(0,calc(100% - var(--workspace-split-ratio) - 2px))")
    && workspaceCss.includes("width:10px; justify-self:center; cursor:col-resize")
    && workspaceCss.includes("height:10px; align-self:center; cursor:row-resize")
    && terminalSurfaceSource.includes("overviewRuler: { width: 8 }"));
  ok("欢迎页转发计数随当前状态实时刷新", read('frontend/src/shared/data-refresh.ts').includes("if (port.activeView() === 'welcome') port.renderWelcome()") && read('frontend/src/shared/workspace-refresh.ts').includes('renderWelcome: () => connectionsServices.termaConnectionViews?.renderStartupSummary()') && workspaceFrontend.includes('forward.status === "running"') && workspaceFrontend.includes('forward.status === "reconnecting"') && workspaceFrontend.includes('forward.status === "failed"') && connectionViewsSource.includes('"class": "startup-count-card", "data-startup-state": "running"') && connectionViewsSource.includes('"class": "startup-count-card", "data-startup-state": "reconnecting"') && connectionViewsSource.includes('"data-startup-state": "failed"') && workspaceFrontend.includes('tr("common:workspace.running_label"') && workspaceFrontend.includes('tr("common:workspace.startup_failed_label"') && read("frontend/src/styles/connections.css").includes(".startup-counts .startup-count-card strong") && read("frontend/src/styles/connections.css").includes(".startup-counts .startup-count-card small") && !workspaceFrontend.includes("异常 ${failed}") && !workspaceFrontend.includes("转发成功 ${success}"));
  ok("转发失败状态显示原因、时间并打开对应日期日志", workspaceFrontend.includes('tr("common:workspace.ready_with_failures"') && connectionViewsSource.includes('"data-startup-state": "failed"') && workspaceFrontend.includes('"common:workspace.failure_logs"') && runningModelSource.includes("failed:all.filter") && runningViewSource.includes("value.status") && runningViewSource.includes("forward.last_error") && runningModelSource.includes("label('failed_at'") && read("frontend/src/features/operations/workspace-operations-host.ts").includes("logs: time => logsServices.termaLogReader.feature().service.date(Number(time) || undefined)") && forwardRuntimeSource.includes("function eventTimeText") && !forwardRuntimeSource.includes('|| "未运行"') && logsFrontend.includes("service.date("));
  ok("停止全部转发会刷新状态并清理异常与待恢复项", read("frontend/src/features/forwards/forward-global-service.ts").includes("hasStoppable") && read("frontend/src/features/forwards/forward-global-service.ts").includes("await port.reload()") && read("frontend/src/features/forwards/forward-global-service.ts").includes("common:notifications.exact.no_stoppable_forwards") && desktopSource.includes("function forwardNeedsStop(forward)") && desktopSource.includes("(item.forwards || []).some(forwardNeedsStop)") && dbSource.includes('["failed", "reconnecting"].includes(forward.status)'));
  ok("连接转发操作使用紧凑图标并保留完整提示", appCss.includes(".conn-actions button { width:28px; min-width:28px;") && connectionViewsSource.includes("connectionCompactToggleButton") && connectionViewsSource.includes('"title": text, "aria-label": text, "data-action": "connection-forward"') && connectionViewsSource.includes("connection-forward-toggle"));
  ok("Web 数据路径支持跨根目录浏览、安全远程管理与自动重启", settingsFrontend.includes("openStorageDirectoryBrowser") && read("frontend/src/features/settings/dialog-views.ts").includes("data-storage-root") && storageRoutesSource.includes('pathname === "/api/storage/directories"') && storageRoutesSource.includes("storageManagementAvailable") && storageRoutesSource.includes("!dependencies.authRequired(request)") && serverSource.includes("restart-web.js") && fs.existsSync(path.join(root, "scripts/restart-web.js")) && read("src/config.ts").includes(".terma-storage.json") && read("src/config.ts").includes(".tunneldesk-storage.json"));
  ok("活动栏按钮整栏居中且选中线独立", appCss.includes('.activity button, .activity a { position:relative; width:100%') && appCss.includes('.activity button.active::before') && !appCss.includes('width:46px; min-height:44px;'));
  const updateNoticeSource = read("frontend/src/features/settings/update-notice.ts");
  ok("新版本提醒支持已读和按版本忽略", updateNoticeSource.includes("termaUpdateReadVersion") && updateNoticeSource.includes("tunneldeskUpdateReadVersion") && updateNoticeSource.includes("sessionStorage") && updateNoticeSource.includes("markRead") && updateControllerSource.includes("/api/updates/ignore") && updatePanelSource.includes("termaUpdateStatus?.setIgnored(input.checked)") && indexHtml.includes("navSettingsUpdateDot") && updateRouteSource.includes('pathname === "/api/updates/ignore"') && utilsFrontend.includes("updateIgnored: Boolean(settingsServices.termaUpdateStatus?.current()?.update_ignored)") && notificationEventSource.includes("event.type === 'update' && context.updateIgnored"));
  ok("更新页按从新到旧展示最近十个正式版本并保留滚动位置", read("src/update-checker.ts").includes("release_notes: releases.slice(0, 10)") && read("src/update-checker.ts").includes("releases?per_page=10") && read("frontend/src/features/settings/release-notes-model.ts").includes("RELEASE_HISTORY_LIMIT = 10") && updatePanelSource.includes("notesElement.value.scrollTop = scrollTop") && updatePanelSource.includes("最近版本更新内容") && updatePanelSource.includes("updateDownloadLinkRows") && !settingsFrontend.includes("function updateStatusHtml"));

  ok("活动栏宽度变化会重排全部分屏", workspaceChrome.includes("if (options.fit !== false) fit();") && read("frontend/src/features/workspace/workspace-host.ts").includes("for (const pane of workspaceVisiblePanes())"));
  ok("终端滚动条和边框跟随终端背景保持低对比样式", terminalSettingsModelSource.includes("scrollbarSliderBackground: dark ? '#475569' : '#cbd5e1'") && terminalSettingsModelSource.includes("overviewRulerBorder: resolved") && terminalFrontend.includes("terminalServices.termaTerminalSettingsModel.theme(terminalServices.termaTerminalSettings.current())") && appCss.includes(".terminal-box .xterm-scrollable-element > .scrollbar { background:transparent !important; }") && appCss.includes("var(--terminal-background,var(--code))"));

  const base = (await webUrl(packageJson, licenseText)).replace(/\/$/, "");
  const isolatedRegression = process.env.TERMA_REGRESSION_ISOLATED === "1" || process.env.TUNNELDESK_REGRESSION_ISOLATED === "1";
  const isolatedDataDirectory = isolatedRegression ? await verifyIsolatedRegressionTarget(base) : null;
  await checkLegacyDelivery(base);
  try {
    const fixture = {retention_days:7,max_file_size_mb:1,max_total_size_mb:10,rotation_files:2};
    const settingsResponse = await fetch(`${base}/api/logs/settings`, isolatedDataDirectory ? {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(fixture)
    } : undefined);
    const logSettings = await settingsResponse.json();
    const settingsMatch = settingsResponse.ok && Object.entries(fixture).every(([key, value]) =>
      isolatedDataDirectory ? logSettings[key] === value : Number.isInteger(logSettings[key]));
    const logs = await fetch(`${base}/api/logs`).then(response=>response.json());
    const systemLog = logs.system?.[0];
    const windowResult = systemLog
      ? await fetch(`${base}/api/logs/read?path=${encodeURIComponent(systemLog.path)}&limit=4096&query=Terma`).then(response=>response.json())
      : null;
    const searchResult = await fetch(`${base}/api/logs/search?query=${encodeURIComponent("Terma")}`).then(response=>response.json());
    ok("日志设置、分段读取、内容搜索和服务端搜索接口", settingsMatch && windowResult && typeof windowResult.text === "string" && Number.isInteger(windowResult.offset) && Array.isArray(windowResult.matches) && Array.isArray(searchResult) && searchResult.every(item => item.path && Array.isArray(item.matches)));
  } catch (error) {
    ok("日志设置、分段读取和服务端搜索接口", false, error.message);
  }
  if (!isolatedDataDirectory) {
    ok("数据库恢复检查返回分组、逐连接引用、原验证方式和默认排序", true, "非隔离环境已安全跳过");
    ok("数据库恢复复用暂存文件、重开句柄并立即刷新", true, "非隔离环境已安全跳过");
  } else {
    const restoreFixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-restore-regression-"));
    const restoreFixturePath = path.join(restoreFixtureDirectory, "fixture.db");
    let restoreFixtureDb = null;
    let originalDatabaseBundle = null;
    try {
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
      && about.third_party_components.length >= 13
      && about.third_party_components.every(item => item?.name && item?.version && item?.license && /^https:\/\//.test(String(item?.project_url || "")))
      && about.third_party_components.some(item => item.name === "jsdiff" && item.version === "9.0.0" && item.license === "BSD-3-Clause")
      && about.third_party_components.some(item => item.name === "node-x11" && item.version === "4.3.1" && item.license === "MIT")
      && about.third_party_components.some(item => item.name === "jsPDF" && item.version === "4.2.1" && item.license === "MIT")
      && about.third_party_components.some(item => item.name === "svg2pdf.js" && item.version === "2.8.1" && item.license === "MIT")
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
  ok("批量命令提供 TXT/JSON 导出", read("frontend/src/features/batch/BatchViews.ts").includes("export_txt") && read("frontend/src/features/batch/BatchViews.ts").includes("export_json") && read("frontend/src/features/batch/batch-model.ts").includes("JSON.stringify(data,null,2)") && read("frontend/src/features/operations/workspace-operations-host.ts").includes("terma-batch-"));
  const connectionBulkSource = read("frontend/src/features/connections/connection-bulk-actions-service.ts");
  ok("SSH 连接支持批量选择、设置与删除", connectionListSource.includes("toggleBulkMode") && connectionViewsSource.includes("openConnectionBulkSettings") && connectionBulkSource.includes("/api/connections/bulk-update") && connectionBulkSource.includes("/api/connections/bulk-delete"));
  ok("新增 SSH 连接支持保存并清空或保存并连接", indexHtml.includes('id="connSaveAndClear"') && indexHtml.includes("保存并清空") && indexHtml.includes('data-action="static-connection-save-clear"') && indexHtml.includes('id="connSaveAndConnect"') && indexHtml.includes("保存并连接") && indexHtml.includes('data-action="static-connection-save-connect"') && sshSaveService.includes("表单已清空") && sshSaveService.includes("connectAfterSave") && sshSaveService.includes("closeTabsByKey") && sshSaveService.includes("openTerminal(savedConnectionId)"));
  ok("SSH 测试失败保持在页面内且按钮测试期间禁用", indexHtml.includes('id="connTestBtn"') && indexHtml.includes('id="connTestStatus"') && indexHtml.includes('data-action="static-connection-test"') && connectionFormActionsSource.includes("tr('connections:form.testing'") && connectionFormActionsSource.includes("tr('connections:form.test_unable'") && read("src/ssh2-client.ts").includes("normalizeSshTransportError(error, connection)") && read("src/ssh2-client.ts").includes("SSH 握手超时，请检查主机地址、端口和 SSH 服务") && read("src/ssh2-client.ts").includes('client.on("error", onError)') && read("src/ssh2-client.ts").includes('client.on("error", reportError)') && read("src/ssh2-client.ts").includes('child.on("error", () => {})'));
  ok("SSH 批量设置仅允许分组、端口和登录凭据", dbSource.includes("function bulkUpdateConnections") && dbSource.includes('changes, "group_name"') && dbSource.includes('changes, "ssh_port"') && serverSource.includes("所选私钥不在允许的密钥目录中"));
  ok("转发列表全选同步全选与半选状态", read("frontend/src/features/forwards/ForwardPages.ts").includes("indeterminate") && read("frontend/src/features/forwards/ForwardPages.ts").includes("data.items.every") && read("frontend/src/features/forwards/ForwardPages.ts").includes("connections:forwards.select_all"));

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
