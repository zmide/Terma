const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");
const root = path.resolve(__dirname, "..");
const {
  __cacheDirectorySnapshot,
  __cachedDirectorySnapshot,
  __remoteBackupVersionTimestamp,
  buildClearRemoteRecycleCommand,
  buildDeleteRemoteRecycleCommand,
  buildListRemoteRecycleCommand,
  buildRecycleRemotePathCommand,
  buildRestoreRemoteRecycleCommand,
  buildRemoteCreateFileCommand,
  __buildRemoteDirectoryEntriesCommand,
  __buildRemoteDirectoryReadCommand,
  __buildRemotePagedDirectoryEntriesCommand,
  __buildRemoteRecursiveDirectoryEntriesCommand,
  __parseRemoteDirectoryOutput,
  __parseRemotePagedDirectoryOutput,
  __normalizeRemoteDirectoryReadError,
  __shouldFallbackToPagedDirectoryRead,
  __buildReadRemoteBinaryCommand,
  __buildReadRemoteBinaryExecCommand,
  __buildStreamRemoteOpenCommand,
  buildRemoteDirectorySizeCommand,
  buildRemotePermissionCommand,
  invalidateRemoteDirectoryCache,
  normalizeRemotePermissionRequest,
  normalizeRemoteDirectoryListOptions,
  parseRemoteRecycleItems,
  paginateRemoteEntries
} = require("../dist/sftp");
const { normalizeCompressionRequest } = require("../dist/sftp-jobs");
const { buildRemoteExtractCommand, normalizeArchiveFilenameEncoding } = require("../dist/sftp-operation-commands");

function names(result) {
  return result.entries.map((entry) => entry.name);
}

const fixtures = [
  { name: "z-folder", type: "dir", size: 0, mtime: 30 },
  { name: "a-folder", type: "dir", size: 0, mtime: 20 },
  { name: "file-10.txt", type: "file", size: 10, mtime: 10 },
  { name: "file-2.txt", type: "file", size: 10, mtime: 20 },
  { name: "other.log", type: "file", size: 5, mtime: 30 }
];

const defaults = normalizeRemoteDirectoryListOptions();
assert.equal(__remoteBackupVersionTimestamp("test.txt.bak-20260811204633706-f0f1abcd", "test.txt.bak-"), Date.UTC(2026, 7, 11, 20, 46, 33, 706));
assert.equal(__remoteBackupVersionTimestamp("test.txt.bak-legacy", "test.txt.bak-", 1234), 1234);
assert.deepEqual(defaults, { page:1, page_size:50, query:"", sort:"name", dir:"asc", refresh:false, recursive:false });
assert.equal(normalizeRemoteDirectoryListOptions({page_size:999}).page_size, 200);
assert.equal(normalizeRemoteDirectoryListOptions({refresh:"1"}).refresh, true);
assert.equal(normalizeRemoteDirectoryListOptions({recursive:"1"}).recursive, true);
assert.throws(() => normalizeRemoteDirectoryListOptions({page:0}), /页码必须是正整数/);
assert.throws(() => normalizeRemoteDirectoryListOptions({sort:"owner"}), /目录排序字段无效/);
assert.throws(() => normalizeRemoteDirectoryListOptions({dir:"sideways"}), /目录排序方向无效/);

const byName = paginateRemoteEntries(fixtures, {page:1, page_size:25, sort:"name", dir:"asc"});
assert.deepEqual(names(byName), ["a-folder", "z-folder", "file-2.txt", "file-10.txt", "other.log"]);
assert.equal(byName.total, 5);
assert.equal(byName.unfiltered_total, 5);
assert.equal(byName.total_pages, 1);

const bySizeDescending = paginateRemoteEntries(fixtures, {page:1, page_size:25, sort:"size", dir:"desc"});
assert.deepEqual(names(bySizeDescending).slice(0, 2), ["z-folder", "a-folder"], "目录在降序时也必须位于文件之前");
assert.deepEqual(names(bySizeDescending).slice(2), ["file-10.txt", "file-2.txt", "other.log"]);

const filtered = paginateRemoteEntries(fixtures, {page:1, page_size:25, query:"FILE", sort:"name", dir:"asc"});
assert.deepEqual(names(filtered), ["file-2.txt", "file-10.txt"]);
assert.equal(filtered.total, 2);
assert.equal(filtered.unfiltered_total, 5);

const many = Array.from({length: 215}, (_, index) => ({
  name: `item-${String(index + 1).padStart(3, "0")}`,
  type: "file",
  size: index,
  mtime: index
}));
const secondPage = paginateRemoteEntries(many, {page:2, page_size:50, sort:"mtime", dir:"asc"});
assert.equal(secondPage.entries.length, 50);
assert.equal(secondPage.entries[0].name, "item-051");
assert.equal(secondPage.page, 2);
assert.equal(secondPage.total_pages, 5);

const clampedPage = paginateRemoteEntries(many, {page:99, page_size:50, sort:"mtime", dir:"asc"});
assert.equal(clampedPage.page, 5);
assert.equal(clampedPage.entries.length, 15);
assert.equal(clampedPage.entries[0].name, "item-201");

const empty = paginateRemoteEntries([], {page:8, page_size:25});
assert.deepEqual(empty, {entries:[], page:1, page_size:25, total:0, total_pages:1, unfiltered_total:0});

const recursiveCommand = __buildRemoteRecursiveDirectoryEntriesCommand();
assert.match(recursiveCommand, /find \. ! -name \./);
assert.match(recursiveCommand, /\.terma-recycle-bin/);
assert.match(recursiveCommand, /\.terma-upload-\*\.part/);

const cacheExpiry = Date.now() + 60 * 1000;
__cacheDirectorySnapshot(9001, ".", {path:"/home/test", entries:fixtures, expires_at:cacheExpiry});
assert.equal(__cachedDirectorySnapshot(9001, ".")?.path, "/home/test", "请求路径应命中规范路径快照");
assert.equal(__cachedDirectorySnapshot(9001, "/home/test")?.entries.length, fixtures.length, "规范路径应命中同一快照");
__cacheDirectorySnapshot(9002, ".", {path:"/home/other", entries:[], expires_at:cacheExpiry});
invalidateRemoteDirectoryCache(9001);
assert.equal(__cachedDirectorySnapshot(9001, "."), null, "连接级失效应清除请求路径别名");
assert.equal(__cachedDirectorySnapshot(9001, "/home/test"), null, "连接级失效应清除规范路径快照");
assert.equal(__cachedDirectorySnapshot(9002, ".")?.path, "/home/other", "连接级失效不能影响其他连接");
invalidateRemoteDirectoryCache(9002);

__cacheDirectorySnapshot(9003, ".", {path:"/expired", entries:fixtures, expires_at:Date.now() - 1});
assert.equal(__cachedDirectorySnapshot(9003, "."), null, "过期快照不能继续返回");

const frontendContext = {};
vm.createContext(frontendContext);
const sftpFrontendSource = readFrontendDomain(path.join(__dirname, ".."), "sftp");
vm.runInContext(sftpFrontendSource, frontendContext);
assert.equal(frontendContext.joinRemotePath("/", "Users"), "/Users");
assert.equal(frontendContext.joinRemotePath("/Users", "demo"), "/Users/demo");
assert.equal(frontendContext.parentRemotePath("/"), "/");
assert.equal(frontendContext.parentRemotePath("/Users"), "/");
assert.equal(frontendContext.parentRemotePath("relative"), ".");
assert.match(sftpFrontendSource, /if \(!loaded && navigation\.index === nextIndex\) \{\s*navigation\.index = previousIndex;/, "目录加载失败时必须恢复 SFTP 历史游标");
assert.match(sftpFrontendSource, /runtime\.state = \{\.\.\.currentState, loading:false, requestSeq\}/, "目录加载失败时必须恢复原 SFTP 目录状态");
assert.match(sftpFrontendSource, /directoryAccessError \? "connected" : "disconnected"/, "目录权限和不存在错误不能误报为 SFTP 连接断开");
assert.match(sftpFrontendSource, /function jumpSftpPage\(/, "SFTP 分页必须支持直接跳转到指定页");
assert.match(sftpFrontendSource, /class="sftp-page-jump"/, "SFTP 分页器必须渲染页码跳转控件");
assert.match(sftpFrontendSource, /event\.ctrlKey.*event\.deltaY/s, "图片预览必须支持 Ctrl 加滚轮缩放");
assert.match(sftpFrontendSource, /event\.key\.toLowerCase\(\) === "f"/, "SVG 预览必须支持 Ctrl+F 搜索");
assert.match(sftpFrontendSource, /sanitizeSftpSvgDocument/, "SVG 预览必须在渲染前清理不安全内容");
assert.match(sftpFrontendSource, /sftpSvgHasUnsafeCssResource/, "SVG 清理必须保留内部渐变、滤镜和裁剪引用并阻止外部资源");
assert.match(sftpFrontendSource, /animateTransform,animateMotion/, "SVG 清理必须移除 SMIL 动画节点");
assert.doesNotMatch(sftpFrontendSource, /onclick="downloadSftp\(/, "图片预览下载必须使用事件绑定而不是内联脚本");
assert.match(sftpFrontendSource, /sftp-svg-match-marker/, "SVG 搜索结果必须显示独立定位标记");
assert.match(sftpFrontendSource, /sftpImagePreviewFullscreen/, "图片预览必须记住全屏状态");
assert.match(sftpFrontendSource, /sftpFloatingEditorShelfItem/, "浮动编辑器必须支持最小化暂存栏");
assert.match(sftpFrontendSource, /mountedRuntime\.detachedView = detachedView/, "SFTP 标签切换必须保留已渲染目录视图");
assert.match(sftpFrontendSource, /insideFloatingEditor/, "编辑器内 Ctrl+F 不能穿透到 SFTP 全局搜索");
assert.match(sftpFrontendSource, /root\.style\.overflow = "visible"/, "SVG 预览不能用 hidden 溢出裁剪内容");
const sftpColumnSource = fs.readFileSync(path.join(root, "public", "app-sftp-columns.js"), "utf8");
assert.match(sftpColumnSource, /SFTP_COLUMN_MIN_PIXELS = 3/, "SFTP 列宽下限应为 3px");
assert.match(sftpColumnSource, /const currentMin = SFTP_COLUMN_MIN_PIXELS/, "SFTP 列宽拖动应使用 3px 下限");
assert.match(sftpColumnSource, /total < currentMin \+ nextMin/, "SFTP 相邻列拖动必须同时满足两列最小宽度");

const permission = normalizeRemotePermissionRequest(["/srv/a b", "/srv/a b"], "640", true, "www", "www");
assert.deepEqual(permission, {paths:["/srv/a b"], mode:"640", recursive:true, owner:"www", group:"www"});
const permissionCommand = buildRemotePermissionCommand({paths:["/srv/a b", "/srv/o'k"], mode:"640", recursive:true, owner:"www", group:"www"});
assert.match(permissionCommand, /chown -R 'www:www' '\/srv\/a b' '\/srv\/o'\\''k'/);
assert.match(permissionCommand, /chmod -R 640 '\/srv\/a b' '\/srv\/o'\\''k'/);
assert.doesNotMatch(permissionCommand, /(?:^|\s)--(?:\s|$)/, "macOS/BSD chmod 和 chown 不支持 GNU 的 -- 参数");

const dashedRelativePermission = buildRemotePermissionCommand({paths:["-danger", "folder/file.txt"], mode:"600", recursive:false});
assert.match(dashedRelativePermission, /'\.\/-danger'/, "破折号开头的相对路径必须加上 .\/，避免被识别为命令参数");
assert.match(dashedRelativePermission, /chmod 600 '\.\/-danger' '\.\/folder\/file\.txt'/);
assert.doesNotMatch(dashedRelativePermission, /(?:^|\s)--(?:\s|$)/);

const ownerOnlyPermission = buildRemotePermissionCommand({paths:["/srv/app"], mode:"750", recursive:false, owner:"deploy"});
assert.match(ownerOnlyPermission, /chown 'deploy' '\/srv\/app'/);
assert.doesNotMatch(ownerOnlyPermission, /chgrp/);
assert.match(ownerOnlyPermission, /chmod 750 '\/srv\/app'/);

const groupOnlyPermission = buildRemotePermissionCommand({paths:["/srv/shared"], mode:"770", recursive:true, group:"staff"});
assert.match(groupOnlyPermission, /chgrp -R 'staff' '\/srv\/shared'/);
assert.doesNotMatch(groupOnlyPermission, /chown/);
assert.match(groupOnlyPermission, /chmod -R 770 '\/srv\/shared'/);
assert.doesNotMatch(groupOnlyPermission, /(?:^|\s)--(?:\s|$)/);
assert.throws(() => normalizeRemotePermissionRequest(["/"], "755", true), /不能对根目录/);
assert.throws(() => normalizeRemotePermissionRequest(["folder/.."], "755", true), /不能对根目录或当前目录/);
assert.throws(() => normalizeRemotePermissionRequest(["/srv/a"], "0755"), /三位八进制/);
assert.throws(() => normalizeRemotePermissionRequest(["/srv/a"], "755", false, "www;id"), /所有者格式无效/);

const createFile = buildRemoteCreateFileCommand("  folder\\nested/./new file.txt  ");
assert.equal(createFile.path, "folder/nested/new file.txt");
assert.match(createFile.command, /^if \[ -e 'folder\/nested\/new file\.txt' \] \|\| \[ -L 'folder\/nested\/new file\.txt' \]; then /);
assert.match(createFile.command, /'目标文件已存在' >&2; exit 1; fi; : > 'folder\/nested\/new file\.txt'$/);

const quotedCreateFile = buildRemoteCreateFileCommand("folder/o'k.txt");
assert.equal(quotedCreateFile.path, "folder/o'k.txt");
assert.match(quotedCreateFile.command, /'folder\/o'\\''k\.txt'/, "新建文件路径必须经过 shell 安全引用");
assert.equal((quotedCreateFile.command.match(/'folder\/o'\\''k\.txt'/g) || []).length, 3, "存在性检查和创建命令必须使用同一安全路径");

assert.throws(() => buildRemoteCreateFileCommand("/"), /新建文件路径无效/);
assert.throws(() => buildRemoteCreateFileCommand(".."), /新建文件路径无效/);
assert.throws(() => buildRemoteCreateFileCommand("../outside.txt"), /新建文件路径无效/);
assert.throws(() => buildRemoteCreateFileCommand("folder/../../outside.txt"), /新建文件路径无效/);
assert.throws(() => buildRemoteCreateFileCommand("folder/"), /文件名不能以斜杠结尾/);

const directorySizeCommand = buildRemoteDirectorySizeCommand("/srv/a b/o'k", null, "0123456789abcdef");
assert.match(directorySizeCommand, /TERMA_TARGET='\/srv\/a b\/o'\\''k'/, "目录大小路径必须经过 shell 安全引用");
assert.match(directorySizeCommand, /stat -c '%s'/, "Linux 和 BusyBox 应使用 GNU stat 字节数");
assert.match(directorySizeCommand, /stat -f '%z'/, "macOS 和 BSD 应使用 BSD stat 字节数");
assert.match(directorySizeCommand, /find "\$TERMA_TARGET" -type f/, "目录大小必须递归统计普通文件");
assert.match(directorySizeCommand, /\[ ! -r "\$TERMA_TARGET" \] \|\| \[ ! -x "\$TERMA_TARGET" \].*__TERMA_DIRECTORY_PERMISSION_DENIED__/, "目录大小读取必须在遍历前报告顶层目录权限失败");
assert.match(directorySizeCommand, /2>\/dev\/null.*__TERMA_DIRECTORY_CONTENT_UNREADABLE__/, "目录大小遍历失败时必须隐藏远端本地化错误并返回 ASCII 标记");
assert.match(directorySizeCommand, /__TERMA_DIRECTORY_NOT_FOUND__/, "目录大小读取必须区分目录不存在");
assert.match(directorySizeCommand, /__TERMA_DIRECTORY_SIZE_UNSUPPORTED__/, "目录大小读取必须使用固定标记报告 stat 不兼容");
assert.match(directorySizeCommand, /\.terma-size-0123456789abcdef/, "临时统计文件名应可预测且会由 trap 清理");
assert.doesNotMatch(directorySizeCommand, /\bdu\b/, "目录大小应汇总精确文件字节数，不能使用按块取整的 du");
assert.throws(() => buildRemoteDirectorySizeCommand(""), /远程目录路径无效/);
assert.throws(() => buildRemoteDirectorySizeCommand("bad\0path"), /远程目录路径无效/);

const directoryEntriesCommand = __buildRemoteDirectoryEntriesCommand();
assert.match(directoryEntriesCommand, /\[ -L "\$entry" \]/, "目录列表必须识别符号链接");
assert.match(directoryEntriesCommand, /stat -L -c "%s %Y %a %U %G"/, "GNU stat 必须展示链接目标的真实元数据");
assert.match(directoryEntriesCommand, /stat -L -f "%z %m %Lp %Su %Sg"/, "BSD stat 必须展示链接目标的真实元数据");
assert.match(directoryEntriesCommand, /terma_link_size/, "目录列表必须保留链接本身大小以解释显示差异");
assert.match(directoryEntriesCommand, /\.terma-recycle-bin/);
assert.match(directoryEntriesCommand, /\.tunneldesk-recycle-bin/);
assert.match(directoryEntriesCommand, /\.terma-upload-\*\.part/);
assert.match(directoryEntriesCommand, /\.tunneldesk-upload-\*\.part/);
assert.match(directoryEntriesCommand, /__TERMA_PAGED_DIRECTORY__/, "大型目录必须在逐项 stat 前切换到分页读取");
const protectedDirectoryCommand = __buildRemoteDirectoryReadCommand("'/root'", "printf '%s\\n' '__TERMA_DIRECTORY_V1__'; printf '%s\\n' \"$(pwd)\"");
assert.match(protectedDirectoryCommand, /terma_directory='\/root'/, "目录读取必须先保存经过安全引用的目标路径");
assert.match(protectedDirectoryCommand, /\[ ! -x "\$terma_directory" \].*__TERMA_DIRECTORY_PERMISSION_DENIED__/, "目录读取必须用 ASCII 标记报告权限失败，不能依赖远端错误编码");
assert.match(protectedDirectoryCommand, /cd "\$terma_directory" \|\| \{.*__TERMA_DIRECTORY_ACCESS_FAILED__.*\}; \{ .*; \}$/, "目录枚举必须整体受 cd 成功条件约束");
assert.equal(__shouldFallbackToPagedDirectoryRead(new Error("远程文件操作超时")), true);
assert.equal(__shouldFallbackToPagedDirectoryRead(new Error("cd: /root: Permission denied")), false, "权限错误不能回退后继续枚举原目录");
const normalizedPermissionError = __normalizeRemoteDirectoryReadError(new Error("cd: /root: 权限不够"), "/root");
assert.equal(normalizedPermissionError.message, "没有权限访问远程目录：/root");
assert.equal(normalizedPermissionError.code, "SFTP_DIRECTORY_PERMISSION_DENIED");
assert.equal(normalizedPermissionError.statusCode, 403);
const normalizedGarbledPermissionError = __normalizeRemoteDirectoryReadError(new Error("__TERMA_DIRECTORY_PERMISSION_DENIED__\n/bin/sh: ???"), "/root");
assert.equal(normalizedGarbledPermissionError.message, "没有权限访问远程目录：/root");
assert.equal(normalizedGarbledPermissionError.code, "SFTP_DIRECTORY_PERMISSION_DENIED");
assert.equal(normalizedGarbledPermissionError.statusCode, 403);
const normalizedUnreadableSizeError = __normalizeRemoteDirectoryReadError(new Error("__TERMA_DIRECTORY_CONTENT_UNREADABLE__\nfind: ???"), "/srv/data");
assert.equal(normalizedUnreadableSizeError.message, "目录存在无法读取的内容，未返回不完整大小");
assert.equal(normalizedUnreadableSizeError.code, "SFTP_DIRECTORY_CONTENT_UNREADABLE");
assert.equal(normalizedUnreadableSizeError.statusCode, 403);
const normalizedUnsupportedSizeError = __normalizeRemoteDirectoryReadError(new Error("__TERMA_DIRECTORY_SIZE_UNSUPPORTED__"), "/srv/data");
assert.equal(normalizedUnsupportedSizeError.message, "远程系统缺少兼容的 stat 命令");
assert.equal(normalizedUnsupportedSizeError.code, "SFTP_DIRECTORY_SIZE_UNSUPPORTED");
const normalizedMissingDirectoryError = __normalizeRemoteDirectoryReadError(new Error("__TERMA_DIRECTORY_NOT_FOUND__"), "/missing");
assert.equal(normalizedMissingDirectoryError.message, "远程目录不存在：/missing");
assert.equal(normalizedMissingDirectoryError.code, "SFTP_DIRECTORY_NOT_FOUND");
assert.equal(normalizedMissingDirectoryError.statusCode, 404);

const parsedDirectory = __parseRemoteDirectoryOutput([
  "__TERMA_DIRECTORY_V1__",
  "/home/ha2",
  ".history\\tf\\t0 1721289951 640 ha2 ha2\\t0\\t0\\t0"
].join("\n"));
assert.equal(parsedDirectory.path, "/home/ha2");
assert.equal(parsedDirectory.rows.length, 1);
assert.throws(
  () => __parseRemoteDirectoryOutput(".history\\tf\\t0 1721289951 640 ha2 ha2\\t0\\t0\\t0\n.config\\td"),
  /远程目录响应格式无效/,
  "文件元数据不能被当成当前目录路径"
);

const parsedPagedDirectory = __parseRemotePagedDirectoryOutput([
  "__TERMA_DIRECTORY_V1__",
  "/home/ha2",
  "80",
  "80",
  ".history\\tf\\t0\\t1721289951\\t640\\tha2\\tha2\\t0\\t0\\t0"
].join("\n"));
assert.equal(parsedPagedDirectory.path, "/home/ha2");
assert.equal(parsedPagedDirectory.total, 80);
assert.equal(parsedPagedDirectory.unfilteredTotal, 80);
assert.throws(
  () => __parseRemotePagedDirectoryOutput("__TERMA_DIRECTORY_V1__\n/home/ha2\n.history\\tf\n80"),
  /分页响应格式无效/,
  "分页数量行损坏时必须拒绝响应"
);
const sftpSource = fs.readFileSync(path.join(root, "src", "sftp.ts"), "utf8");
assert.match(sftpSource, /listRemoteDirPaged/, "大型目录应在目录命令超时后使用分页目录读取");
assert.match(sftpSource, /buildRemotePagedDirectoryEntriesCommand/, "大型目录读取必须在远端限制返回行数");
const largeDirectoryMetadataCommand = __buildRemotePagedDirectoryEntriesCommand({page:2, page_size:50, sort:"mtime", dir:"desc"});
assert.match(largeDirectoryMetadataCommand, /__TERMA_DIRECTORY_V1__/, "分页目录响应必须包含不可与文件名混淆的协议头");
assert.match(largeDirectoryMetadataCommand, /-printf '%f\\t%y\\t%s\\t%T@\\t%m\\t%u\\t%g/, "GNU find 应批量读取大型目录元数据，避免逐项启动 stat");
assert.match(largeDirectoryMetadataCommand, /terma_emit_all_metadata/, "大小和时间排序必须保留完整元数据");
assert.match(largeDirectoryMetadataCommand, /-k2,2nr/, "大型目录按大小或时间降序时必须在远端完成数值排序");
assert.doesNotMatch(sftpSource, /metadata_fallback:true/, "大型目录不能通过丢弃大小、时间和权限来提速");

const readLinkedFileCommand = __buildReadRemoteBinaryCommand("/vmlinuz", 5 * 1024 * 1024);
assert.match(readLinkedFileCommand, /stat -L -c "%s"/, "打开前必须读取 GNU 链接目标真实大小");
assert.match(readLinkedFileCommand, /stat -L -f "%z"/, "打开前必须读取 BSD 链接目标真实大小");
assert.match(readLinkedFileCommand, /符号链接本身为 %s B，目标文件实际为 %s B/, "超限提示必须解释链接大小与目标大小");
assert.match(readLinkedFileCommand, /head -c 5242881 "\$TERMA_TARGET"/, "通过大小检查后仍要做有界读取");

const readLinkedFileExecCommand = __buildReadRemoteBinaryExecCommand("/vmlinuz", 5 * 1024 * 1024);
assert.match(readLinkedFileCommand, /\*\[!0-9\]\*/, "读取脚本包含会触发 csh\/tcsh 历史展开的数字校验表达式");
assert.match(readLinkedFileExecCommand, /^\/bin\/sh -c 'terma_payload=[A-Za-z0-9+/=]+;/, "远端文件读取必须使用登录 Shell 安全的 POSIX 封装");
assert.doesNotMatch(readLinkedFileExecCommand, /!/, "登录 Shell 可见的读取命令不能暴露历史展开字符");
const readPayload = /^\/bin\/sh -c 'terma_payload=([A-Za-z0-9+/=]+);/.exec(readLinkedFileExecCommand);
assert.ok(readPayload, "远端文件读取封装必须包含 Base64 脚本载荷");
assert.equal(Buffer.from(readPayload[1], "base64").toString("utf8"), readLinkedFileCommand, "POSIX 封装不能改变远端文件读取脚本");

const streamedOpenCommand = __buildStreamRemoteOpenCommand("/srv/data/report.txt", 50 * 1024 * 1024);
assert.match(streamedOpenCommand, /TERMA_OPEN_READY:%s:%s:%s/, "stream open must return bounded size metadata first");
assert.match(streamedOpenCommand, /TERMA_LIMIT=52428800/, "stream open must enforce the configured limit remotely");
assert.match(streamedOpenCommand, /head -c "\$TERMA_SIZE" < "\$TERMA_TARGET"/, "stream open must stop at the initial size when a live file keeps growing");
assert.match(streamedOpenCommand, /\[ ! -f "\$TERMA_TARGET" \]/, "stream open must reject directories and device files");

const recycleId = "m1abcd23-0123456789abcdef";
const recycleDeletedAt = 1784567890123;
const recyclePath = "/srv/data/o'k 文件.txt";
const recycleCommand = buildRecycleRemotePathCommand(recyclePath, recycleId, recycleDeletedAt);
assert.match(recycleCommand, /\.terma-recycle-bin/);
assert.doesNotMatch(recycleCommand, /\.tunneldesk-recycle-bin/);
assert.match(recycleCommand, /\$terma_root\/items/);
assert.match(recycleCommand, /'\/srv\/data\/o'\\''k 文件\.txt'/, "回收站移动命令必须安全引用特殊路径");
assert.match(recycleCommand, new RegExp(Buffer.from(recyclePath, "utf8").toString("base64")));
assert.match(recycleCommand, new RegExp(String(recycleDeletedAt)));
assert.match(recycleCommand, /if mv .*payload/);

const parsedRecycleItems = parseRemoteRecycleItems([
  `m1abcd23-0123456789abcdef\t${Buffer.from("/srv/较早.txt").toString("base64")}\t100\tfile\ttunneldesk`,
  `m1abcd24-fedcba9876543210\t${Buffer.from("/srv/目录 空格").toString("base64")}\t200\tdir\tterma`
].join("\n"));
assert.equal(parsedRecycleItems.length, 2);
assert.equal(parsedRecycleItems[0].original_path, "/srv/目录 空格");
assert.equal(parsedRecycleItems[0].name, "目录 空格");
assert.equal(parsedRecycleItems[0].type, "dir");
assert.equal(parsedRecycleItems[0].storage, "terma");
assert.equal(parsedRecycleItems[1].deleted_at, 100);
assert.equal(parsedRecycleItems[1].storage, "tunneldesk");

const restoreCommand = buildRestoreRemoteRecycleCommand(recycleId, recyclePath);
assert.match(restoreCommand, /\.terma-recycle-bin/);
assert.match(restoreCommand, /原路径已有同名项目，无法恢复/);
assert.match(restoreCommand, /mkdir -p '\/srv\/data'/);
assert.match(restoreCommand, /mv "\$terma_item\/payload" '\/srv\/data\/o'\\''k 文件\.txt'/);
const legacyRestoreCommand = buildRestoreRemoteRecycleCommand(recycleId, recyclePath, null, "tunneldesk");
assert.match(legacyRestoreCommand, /\.tunneldesk-recycle-bin/);
const listRecycleCommand = buildListRemoteRecycleCommand();
assert.match(listRecycleCommand, /path\.b64/);
assert.match(listRecycleCommand, /\.terma-recycle-bin/);
assert.match(listRecycleCommand, /\.tunneldesk-recycle-bin/);
assert.match(listRecycleCommand, /'terma'/);
assert.match(listRecycleCommand, /'tunneldesk'/);
assert.match(buildDeleteRemoteRecycleCommand(recycleId), /\.terma-recycle-bin/);
assert.match(buildDeleteRemoteRecycleCommand(recycleId), /rm -rf "\$terma_item"/);
assert.match(buildDeleteRemoteRecycleCommand(recycleId, "tunneldesk"), /\.tunneldesk-recycle-bin/);
const clearRecycleCommand = buildClearRemoteRecycleCommand();
assert.match(clearRecycleCommand, /\.terma-recycle-bin/);
assert.match(clearRecycleCommand, /\.tunneldesk-recycle-bin/);
assert.equal((clearRecycleCommand.match(/rm -rf "\$terma_root\/items"/g) || []).length, 2);
assert.throws(() => buildRecycleRemotePathCommand("/", recycleId), /根目录或当前目录/);
assert.throws(() => buildRecycleRemotePathCommand("/home/user/.terma-recycle-bin/items", recycleId), /回收站目录/);
assert.throws(() => buildRecycleRemotePathCommand("/home/user/.tunneldesk-recycle-bin/items", recycleId), /回收站目录/);
assert.throws(() => buildDeleteRemoteRecycleCommand("../../outside"), /项目编号无效/);
assert.throws(() => buildDeleteRemoteRecycleCommand(recycleId, "unknown"), /回收站来源无效/);
assert.throws(() => parseRemoteRecycleItems(`${recycleId}\tnot-base64!\t1\tfile`), /元数据已损坏/);

const singleArchive = normalizeCompressionRequest(["/srv/file.txt"], "/srv", "file-copy");
assert.equal(singleArchive.name, "file-copy.tar.gz");
assert.equal(singleArchive.output, "/srv/file-copy.tar.gz");
assert.equal(singleArchive.filename_encoding, "default");
assert.match(singleArchive.command, /tar -czf/);
assert.match(singleArchive.command, /'\.\/file\.txt'/);
const multiArchive = normalizeCompressionRequest(["/srv/folder", "/srv/-danger"], "/srv", "bundle.tar.gz", null, "utf-8");
assert.equal(multiArchive.paths.length, 2);
assert.equal(multiArchive.filename_encoding, "utf8");
assert.match(multiArchive.command, /--format=posix --pax-option=hdrcharset=UTF-8/);
assert.match(multiArchive.command, /'\.\/-danger'/);
assert.equal(normalizeArchiveFilenameEncoding("euc-kr"), "euc_kr");
assert.equal(normalizeArchiveFilenameEncoding("ISO-8859-1"), "latin1");
assert.throws(() => normalizeArchiveFilenameEncoding("cp500"), /不支持的压缩包文件名编码/);
const zipExtract = buildRemoteExtractCommand(null, "/srv/archive.zip", "/srv/output", {encoding:"gb18030", overwrite:false});
assert.equal(zipExtract.target, "/srv/output");
assert.equal(zipExtract.encoding, "gb18030");
assert.equal(zipExtract.overwrite, false);
assert.match(zipExtract.command, /^mkdir -p -- '\/srv\/output' && cd '\/srv\/output' && unzip -n -O 'GB18030' '\/srv\/archive\.zip'$/);
const defaultZipExtract = buildRemoteExtractCommand(null, "/srv/archive.zip", "/srv/output");
assert.match(defaultZipExtract.command, /unzip -o '\/srv\/archive\.zip'$/);
assert.doesNotMatch(defaultZipExtract.command, / -O /);
const tarExtractWithoutOverwrite = buildRemoteExtractCommand(null, "/srv/archive.tar.gz", "/srv/output", {overwrite:false});
assert.match(tarExtractWithoutOverwrite.command, /GNU tar/);
assert.match(tarExtractWithoutOverwrite.command, /--skip-old-files -xzf '\/srv\/archive\.tar\.gz'/);
const defaultTarExtract = buildRemoteExtractCommand(null, "/srv/archive.tar", "/srv/output");
assert.match(defaultTarExtract.command, /tar -xf '\/srv\/archive\.tar'$/);
const tarWithoutOverwrite = buildRemoteExtractCommand(null, "/srv/archive.tar", "/srv/output", {overwrite:false});
assert.match(tarWithoutOverwrite.command, /--skip-old-files -xf '\/srv\/archive\.tar'/);
assert.throws(() => normalizeCompressionRequest(["/srv/a", "/tmp/b"], "/srv", "bundle"), /同一目录/);
assert.throws(() => normalizeCompressionRequest(["/srv/a"], "/srv", "nested/bundle"), /不能包含路径/);
assert.throws(() => normalizeCompressionRequest(["/srv/a.tar.gz"], "/srv", "a.tar.gz"), /不能覆盖/);

assert.deepEqual(JSON.parse(JSON.stringify(frontendContext.permissionModeToChecks("755"))), {
  ownerRead:true, ownerWrite:true, ownerExecute:true,
  groupRead:true, groupWrite:false, groupExecute:true,
  publicRead:true, publicWrite:false, publicExecute:true
});
assert.equal(frontendContext.permissionChecksToMode({ownerRead:true,ownerWrite:true,ownerExecute:false,groupRead:true,groupWrite:false,groupExecute:false,publicRead:false,publicWrite:false,publicExecute:false}), "640");
assert.equal(frontendContext.normalizePermissionMode("888"), "");

console.log("SFTP pagination checks passed");
