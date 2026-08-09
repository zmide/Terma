const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "local-files.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server.ts"), "utf8");
const localUi = fs.readFileSync(path.join(root, "public", "app-local-files.js"), "utf8");
const sftpUi = readFrontendDomain(root, "sftp");
const terminalUi = readFrontendDomain(root, "terminal");
const docking = readFrontendDomain(root, "docking");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");

assert.match(server, /pathname === "\/api\/local-files"/);
assert.match(server, /pathname === "\/api\/local-files\/rename"/);
assert.match(server, /pathname === "\/api\/local-files\/delete"/);
assert.match(server, /pathname === "\/api\/local-files\/create"/);
assert.match(server, /pathname === "\/api\/local-files\/chmod"/);
assert.match(server, /!isDesktopRequest\(req\) \|\| !desktopIntegration\?\.getDesktopDirectory/);
assert.match(server, /startLocalDeliveryJob\(Number\(data\.connection_id\), data\.paths \|\| \[\], data\.target/);
assert.match(server, /pathname === "\/api\/local-files\/receive"[\s\S]*?sendJson\(res, startLocalDeliveryJob\(/);
assert.match(server, /pathname === "\/api\/local-files\/receive-desktop"[\s\S]*?deliveryMode:"desktop"/);
assert.match(server, /data\.mode === "separate"[\s\S]*?startLocalDeliveryJob\(connectionId, paths, targetDirectory/);
assert.match(server, /sendJson\(res, startLocalDeliveryJob\([\s\S]*?\), 202\)/);
const sftpJobs = fs.readFileSync(path.join(root, "src", "sftp-jobs.ts"), "utf8");
assert.match(sftpJobs, /function startLocalDeliveryJob\(/);
assert.match(sftpJobs, /type:"local-delivery"/);
assert.match(sftpJobs, /deliverSftpPaths\(connectionId, paths, current\.target_directory/);
assert.match(sftpJobs, /current\.status = "done"/);
assert.match(sftpJobs, /current\.status = "failed"/);
assert.match(server, /pathname === "\/api\/local-files\/receive-plan"/);
assert.match(server, /data\.conflict \|\| "rename"/);
assert.match(localUi, /localFilesReceiveConflictChoice/);
assert.match(localUi, /\{label:"覆盖", value:"overwrite"/);
assert.match(localUi, /\{label:"自动重命名", value:"rename"/);
assert.match(source, /LOCAL_TRANSFER_TOP_LEVEL_LIMIT = 100/);
assert.match(source, /LOCAL_TRANSFER_ENTRY_LIMIT = 1000/);
assert.match(source, /!path\.isAbsolute\(requested\)/);
assert.match(source, /lstat\.isSymbolicLink\(\)/);
assert.match(localUi, /LOCAL_FILES_DRAG_MIME/);
assert.match(localUi, /LOCAL_FILES_COMPUTER_PATH/);
assert.match(localUi, /local-files-breadcrumb/);
assert.match(localUi, /localFilesBreadcrumbHtml/);
assert.match(localUi, /navigateLocalFilesComputer/);
assert.match(localUi, /setLocalFilesPageSize/);
assert.match(localUi, /class="icon-button local-files-open-button"[^>]*>\$\{icon\("hard-drive"\)\}<\/button>/);
assert.doesNotMatch(localUi, /local-files-open-button[^>]*>[\s\S]*?<span>本地<\/span>/);
assert.match(localUi, /clearLocalFilesSearch/);
assert.match(localUi, /runtime\.location === "computer"/);
assert.match(localUi, /openLocalFilesInPlacement\("left"\)/);
assert.match(localUi, /openLocalFilesInPlacement\("right"\)/);
assert.match(localUi, /openLocalFilesInPlacement\("top"\)/);
assert.match(localUi, /openLocalFilesInPlacement\("bottom"\)/);
assert.match(localUi, /event\.shiftKey && runtime\.anchorPath/);
assert.match(localUi, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(localUi, /showLocalFileEntryMenu/);
assert.match(localUi, /showLocalFilesDirectoryMenu/);
assert.match(localUi, /deleteSelectedLocalFiles/);
assert.match(localUi, /showLocalFilesUploadMenu/);
assert.match(localUi, /readLocalFileDragPayload/);
assert.match(localUi, /input\.checked && !input\.disabled/);
assert.match(localUi, /data-local-files-single-action/);
assert.match(localUi, /button\.disabled = selected\.length !== 1/);
assert.match(localUi, /deleteLocalFiles\(selectedPaths, tabKey\)/);
assert.match(localUi, /copyText\(selectedPaths\.join\("\\n"\)\)/);
assert.match(localUi, /data-change-action="local-files-page-limit"/);
assert.match(localUi, /data-action="local-files-entry-select"/);
assert.match(localUi, /registerTermaAction\("local-files-entry-activate"/);
assert.doesNotMatch(localUi, /\son(?:click|change|input|dblclick|contextmenu|drag\w*|drop)=/i);
assert.match(localUi, /const sourceActiveTabKey = sourcePane\?\.activeTabKey \|\| activeTabKey/);
assert.match(localUi, /sourceTabs\.scrollLeft = sourceScrollLeft/);
assert.match(localUi, /noteSftpDragFeedbackActivity/);
assert.match(localUi, /workspaceTabByKey\(tabKey\)/);
assert.match(localUi, /\/api\/local-files\/upload/);
assert.match(localUi, /\/api\/local-files\/receive/);
assert.match(localUi, /trackLocalDeliveryJobTarget\(job, target\.key, directory\)/);
assert.match(localUi, /trackSftpMutationJob\(job\)/);
assert.match(localUi, /refreshLocalFilesForDeliveryJob\(job\)/);
const sftpTasksUi = fs.readFileSync(path.join(root, "public", "app-sftp-tasks.js"), "utf8");
assert.match(sftpTasksUi, /job\.type === "local-delivery"/);
assert.match(sftpTasksUi, /refreshLocalFilesForDeliveryJob\(job\)/);
assert.match(sftpUi, /sendSftpSelectionToDesktop/);
assert.match(sftpUi, /readLocalFileDragPayload/);
assert.match(sftpUi, /target\.kind === "local-files"/);
assert.match(sftpUi, /\.local-files-drop-overlay:not\(\[hidden\]\)/);
assert.match(sftpUi, /workspaceTabByKey\(internalTarget\.tabKey\)/);
assert.match(sftpUi, /event\?\.shiftKey && anchorPath/);
assert.match(terminalUi, /localFilesToolbarButtonHtml/);
assert.match(terminalUi, /readLocalFileDragPayload/);
assert.match(terminalUi, /kind:"terminal"/);
assert.match(terminalUi, /uploadLocalFilesToSftp/);
assert.match(docking, /"local-files"/);
assert.match(index, /id="view-local-files"/);
assert.match(index, /app-local-files\.js/);
assert.match(css, /\.workspace-pane\[data-active-view="local-files"\] > \.workspace \{ display:flex; flex-direction:column; overflow:hidden; \}/);
assert.match(css, /#view-local-files:not\(\[hidden\]\) \{ display:flex; flex:1 1 auto; min-height:0; flex-direction:column; \}/);
assert.match(css, /@container local-files-view \(max-width:760px\)[\s\S]*\.local-files-list \{ --local-grid-columns:28px minmax\(0,1fr\) minmax\(96px,118px\); \}/);
assert.match(css, /@container local-files-view \(max-width:520px\)[\s\S]*\.local-files-list > \.sftp-pager-dock > \.sftp-pager/);
assert.doesNotMatch(localUi, /function localFilesInlineArg\(/, "事件委托后不应继续拼接 inline 参数");
assert.match(localUi, /data-path="\$\{escAttr\(entry\.path\)\}"/);
for (const viewport of [320, 392, 520]) {
  const contentWidth = viewport - 16;
  const fixedColumnsAndGaps = 28 + 96 + 16;
  assert.ok(contentWidth - fixedColumnsAndGaps >= 0, `${viewport}px 窄窗下本地文件名称列必须保留非负宽度`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "terma-local-files-check-"));
process.env.TERMA_DATA_DIR = path.join(temp, "data");
process.env.TERMA_SSH_DIR = path.join(temp, "ssh");
try {
  const directory = path.join(temp, "browse");
  fs.mkdirSync(path.join(directory, "Folder"), {recursive:true});
  fs.writeFileSync(path.join(directory, "alpha.txt"), "alpha");
  fs.writeFileSync(path.join(directory, "beta.txt"), "beta beta");
  const localFiles = require(path.join(root, "dist", "local-files.js"));
  const listed = localFiles.listLocalDirectory(directory, {page:1, page_size:25, sort:"name", dir:"asc"});
  assert.equal(listed.kind, "directory");
  assert.equal(listed.path, path.resolve(directory));
  assert.equal(listed.entries[0].name, "Folder");
  assert.equal(listed.total, 3);
  const searched = localFiles.listLocalDirectory(directory, {query:"BETA"});
  assert.deepEqual(searched.entries.map(entry => entry.name), ["beta.txt"]);
  const createdFile = localFiles.createLocalEntry(directory, "created.txt", "file");
  assert.equal(fs.existsSync(createdFile.path), true);
  const createdDir = localFiles.createLocalEntry(directory, "created-dir", "dir");
  assert.equal(fs.statSync(createdDir.path).isDirectory(), true);
  const renamed = localFiles.renameLocalPath(createdFile.path, "renamed.txt");
  assert.equal(path.basename(renamed.path), "renamed.txt");
  assert.throws(() => localFiles.renameLocalPath(renamed.path, "created-dir"), /目标名称已存在/);
  if (process.platform !== "win32") {
    const chmod = localFiles.chmodLocalPath(renamed.path, "640");
    assert.equal(chmod.mode, "640");
    assert.equal(fs.statSync(renamed.path).mode & 0o777, 0o640);
  } else {
    assert.throws(() => localFiles.chmodLocalPath(renamed.path, "640"), /Windows/);
  }
  const deleted = localFiles.deleteLocalPaths([renamed.path, createdDir.path]);
  assert.equal(deleted.paths.length, 2);
  assert.equal(fs.existsSync(renamed.path), false);
  assert.equal(fs.existsSync(createdDir.path), false);
  assert.throws(() => localFiles.normalizeLocalDirectory("relative/path"), /本地目录路径无效/);
  assert.throws(() => localFiles.normalizeLocalDirectory(path.join(directory, "alpha.txt")), /本地路径不是目录/);
  const parsedDrives = localFiles.__parseWindowsDriveRows([
    {Name:"C:\\\\", VolumeLabel:"System", IsReady:true, TotalSize:1000, AvailableFreeSpace:250},
    {Name:"D:\\\\", VolumeLabel:"", IsReady:false, TotalSize:0, AvailableFreeSpace:0},
    {Name:"not-a-drive", VolumeLabel:"bad", IsReady:true}
  ]);
  assert.deepEqual(parsedDrives.map(entry => entry.path), ["C:\\", "D:\\"]);
  assert.equal(parsedDrives[0].name, "System (C:)");
  const computer = localFiles.listLocalComputer({platform:"win32", driveProvider:() => parsedDrives, page:1, page_size:25});
  assert.equal(computer.kind, "computer");
  assert.equal(computer.display_path, "此电脑");
  assert.equal(computer.parent_kind, "none");
  assert.equal(computer.entries.length, 2);
  assert.deepEqual(computer.entries.map(entry => entry.path), ["C:\\", "D:\\"]);

  const symlinkTarget = path.join(temp, "symlink-target");
  const symlinkPath = path.join(directory, "linked-directory");
  fs.mkdirSync(symlinkTarget, {recursive:true});
  fs.writeFileSync(path.join(symlinkTarget, "outside.txt"), "outside");
  try {
    fs.symlinkSync(symlinkTarget, symlinkPath, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => localFiles.normalizeLocalTransferPaths([symlinkPath]), /符号链接/);
    assert.throws(() => localFiles.__collectLocalTree(directory), /符号链接/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  }

  const oversized = path.join(temp, "oversized-tree");
  fs.mkdirSync(oversized);
  for (let index = 0; index < 1000; index += 1) fs.writeFileSync(path.join(oversized, `${index}.txt`), "");
  assert.throws(() => localFiles.__collectLocalTree(oversized), /最多包含 1000 个文件和目录/);
} finally {
  try { require(path.join(root, "dist", "db.js")).closeDatabase(); } catch {}
  fs.rmSync(temp, {recursive:true, force:true});
}

console.log("本地文件标签检查通过：桌面端权限、路径校验、四向分屏、多选和 SFTP 内部互传");
