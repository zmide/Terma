const assert = require("assert");
const fs = require("fs");
const iconv = require("iconv-lite");
const os = require("os");
const path = require("path");
const { createRemoteOfflineTaskManager } = require("../dist/remote-offline-tasks");

function decodeRemoteShellPayload(command) {
  const match = String(command || "").match(/\btd_payload=([A-Za-z0-9+/=]+);/);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : String(command || "");
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-offline-task-check-"));
  const packageFile = path.join(root, "xclip_1_amd64.deb");
  fs.writeFileSync(packageFile, "deb", "utf8");
  let releaseResourceTask;
  const resourceTaskGate = new Promise(resolve => { releaseResourceTask = resolve; });
  const resourceManager = createRemoteOfflineTaskManager({data_dir:root});
  const resourceTask = resourceManager.startCommand({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"vnc-server",
    component_label:"VNC 服务",
    resource_key:"vnc-server:15",
    action:"stop",
    async run() {
      await resourceTaskGate;
      return {status:0, stdout:"stopped"};
    }
  });
  let duplicateExecutorRan = false;
  assert.throws(() => resourceManager.startCommand({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"vnc-server",
    component_label:"VNC 服务",
    resource_key:"vnc-server:15",
    action:"uninstall",
    async run() { duplicateExecutorRan = true; return {status:0}; }
  }), error => error?.statusCode === 409 && error?.code === "REMOTE_TASK_CONFLICT" && error?.task?.id === resourceTask.id);
  assert.equal(duplicateExecutorRan, false, "a conflicting executor must never start");
  assert.throws(() => resourceManager.startAptInstall({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"vnc-server",
    component_label:"VNC 服务",
    resource_key:"vnc-server:15",
    packages:["tigervnc"]
  }), error => error?.statusCode === 409 && error?.code === "REMOTE_TASK_CONFLICT" && error?.task?.id === resourceTask.id, "command and local-offline tasks must share the same resource lock");
  const parallelResource = resourceManager.startCommand({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"rdp-server",
    component_label:"RDP 服务",
    resource_key:"rdp-server:99",
    action:"start",
    async run() { return {status:0}; }
  });
  assert.equal(parallelResource.status, "running", "different resources should remain independently manageable");
  releaseResourceTask();
  const resourceDeadline = Date.now() + 3000;
  while (Date.now() < resourceDeadline && resourceManager.list().find(item => item.id === resourceTask.id)?.status === "running") {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(resourceManager.list().find(item => item.id === resourceTask.id)?.status, "done");
  const resourceRetry = resourceManager.startCommand({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"vnc-server",
    component_label:"VNC 服务",
    resource_key:"vnc-server:15",
    action:"uninstall",
    async run() { return {status:0}; }
  });
  assert.equal(resourceRetry.status, "running", "resource lock should be released after the original task reaches a terminal state");
  assert.ok(resourceRetry.resource_keys.includes("package-manager:99"), "install and uninstall tasks must reserve the host package manager");
  assert.throws(() => resourceManager.startCommand({
    connection:{id:99, name:"resource-lock", ssh_host:"resource-lock.test"},
    component:"rdp-server",
    component_label:"RDP 服务",
    resource_key:"rdp-server:99",
    action:"install",
    async run() { return {status:0}; }
  }), error => error?.statusCode === 409 && error?.code === "REMOTE_TASK_CONFLICT" && error?.task?.id === resourceRetry.id, "different components must not run package-manager operations concurrently on the same host");
  const commands = [];
  let sshCalls = 0;
  let released = false;
  let configured = false;
  const manager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command(_connection, command) {
      commands.push(command);
      sshCalls += 1;
      if (sshCalls === 1) return {
        status:0,
        stdout:"'https://deb.example.test/xclip_1_amd64.deb' xclip_1_amd64.deb 3"
      };
      return {status:0, stdout:""};
    },
    async download_apt_bundle(_items, options) {
      options.onProgress?.({filename:"xclip_1_amd64.deb", bytes:3, total:3});
      return {directory:root, files:[packageFile], bytes:3};
    },
    start_upload() { return {id:"upload-1"}; },
    list_sftp_jobs() { return [{id:"upload-1", status:"done", transferred:3, size:3}]; },
    async run_privileged_stream(_connection, command, request, onChunk) {
      commands.push(command);
      assert.equal(request.scope, "vnc.server.install-local-offline");
      const output = iconv.encode("安装完成\n", "gbk");
      onChunk(output.subarray(0, 1), "stdout");
      onChunk(output.subarray(1), "stdout");
      return {status:0, stdout:""};
    },
    async run_ssh_stream() { throw new Error("privileged stream expected"); }
  });
  const grant = {id:"grant-1"};
  const started = manager.startAptInstall({
    connection:{id:7, name:"demo", ssh_host:"demo.test", terminal_encoding:"gbk"},
    component:"vnc-server",
    component_label:"VNC 服务",
    packages:["xclip"],
    grant,
    scope:"vnc.server.install-local-offline",
    async after_install(onChunk) {
      configured = true;
      onChunk(Buffer.from("configured\n"), "stdout");
      return {status:0, stdout:""};
    },
    async verify() { return {installed:true}; },
    validate(after) { return after.installed === true; },
    release_grant(value) { released = value === grant; }
  });
  assert.equal(started.status, "running");
  const deadline = Date.now() + 3000;
  let task;
  while (Date.now() < deadline) {
    task = manager.list().find(item => item.id === started.id);
    if (task?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(task.status, "done");
  assert.equal(task.progress, 100);
  assert.equal(released, true);
  assert.equal(configured, true);
  assert.equal(task.after.installed, true);
  assert.ok(commands.some(command => command.includes("base64 -d")));
  assert.ok(commands.some(command => command.includes("Dir::Etc::sourcelist=/dev/null") && command.includes("apt-get")));
  assert.ok(task.logs.some(item => item.text === "安装完成"), "APT task logs should decode split GBK output with the connection encoding");
  assert.ok(!fs.existsSync(path.join(root, "remote-components", "remote-components")), "component cache root must not be duplicated");
  assert.equal(manager.remove(task.id), true);

  let fallbackSshCalls = 0;
  let fallbackPlatform = null;
  const fallbackCandidates = [];
  const fallbackManager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command() {
      fallbackSshCalls += 1;
      if (fallbackSshCalls <= 2) return {status:100, stderr:"E: Package has no installation candidate"};
      if (fallbackSshCalls === 3) return {status:0, stdout:[
        "TERMA_APT_OS_ID=linx", "TERMA_APT_CODENAME=buster", "TERMA_APT_ARCH=amd64",
        "TERMA_APT_INSTALLED=libx11-6:amd64\tinstall ok installed\t"
      ].join("\n")};
      return {status:0, stdout:""};
    },
    async resolve_apt_packages(packages, platform) {
      fallbackPlatform = platform;
      fallbackCandidates.push([...packages]);
      if (packages[0] === "xclip") throw new Error("xclip 在本机索引中不可用");
      return [{url:"https://archive.debian.org/debian/xclip.deb", filename:"xclip_1_amd64.deb", size:3}];
    },
    async download_apt_bundle(_items, options) {
      options.onProgress?.({filename:"xclip_1_amd64.deb", bytes:3, total:3});
      return {directory:root, files:[packageFile], bytes:3};
    },
    start_upload() { return {id:"upload-fallback"}; },
    list_sftp_jobs() { return [{id:"upload-fallback", status:"done", transferred:3, size:3}]; },
    async run_privileged_stream() { return {status:0, stdout:""}; },
    async run_ssh_stream() { throw new Error("privileged stream expected"); }
  });
  const fallbackStarted = fallbackManager.startAptInstall({
    connection:{id:70, name:"linx", ssh_host:"linx.test"},
    component:"vnc-clipboard-helper", component_label:"Unicode 剪贴板辅助工具", packages:["xclip"], package_alternatives:[["xsel"]],
    grant:{id:"grant-fallback"}, elevate:true,
    async verify() { return {available:true, tool:"xclip"}; }
  });
  const fallbackDeadline = Date.now() + 3000;
  let fallbackTask;
  while (Date.now() < fallbackDeadline) {
    fallbackTask = fallbackManager.list().find(item => item.id === fallbackStarted.id);
    if (fallbackTask?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(fallbackTask.status, "done");
  assert.equal(fallbackPlatform.os_id, "linx");
  assert.equal(fallbackTask.after.tool, "xclip");
  assert.deepEqual(fallbackCandidates, [["xclip"], ["xsel"]], "本机离线索引应继续尝试可用的候选包");
  assert.ok(fallbackTask.logs.some(item => item.text.includes("本机刷新")));
  assert.equal(fallbackManager.remove(fallbackTask.id), true);

  let cachedResolverCalls = 0;
  let cachedDownloads = 0;
  let cachedUploads = 0;
  let cachedInstallCommand = "";
  const cachedManager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command() {
      return {status:0, stdout:[
        "The following NEW packages will be installed:",
        "  xfce4 xfce4-goodies",
        "Need to get 0 B/987 kB of archives."
      ].join("\n")};
    },
    async resolve_apt_packages() { cachedResolverCalls += 1; throw new Error("cached install must not resolve repositories"); },
    async download_apt_bundle() { cachedDownloads += 1; throw new Error("cached install must not download"); },
    start_upload() { cachedUploads += 1; throw new Error("cached install must not upload"); },
    async run_ssh_stream(_connection, command) {
      cachedInstallCommand = command;
      return {status:0, stdout:"installed from cache\n"};
    }
  });
  const cachedStarted = cachedManager.startAptInstall({
    connection:{id:73, name:"cached-xfce", ssh_host:"cached-xfce.test"},
    component:"linux-desktop-xfce", component_label:"Linux 桌面 · XFCE", packages:["xfce4", "xfce4-goodies"],
    direct_root:true,
    async verify() { return {desktops:[{id:"xfce"}]}; },
    validate(after) { return after.desktops.some(item => item.id === "xfce"); }
  });
  const cachedDeadline = Date.now() + 3000;
  let cachedTask;
  while (Date.now() < cachedDeadline) {
    cachedTask = cachedManager.list().find(item => item.id === cachedStarted.id);
    if (cachedTask?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(cachedTask.status, "done");
  assert.equal(cachedResolverCalls, 0);
  assert.equal(cachedDownloads, 0);
  assert.equal(cachedUploads, 0);
  assert.match(decodeRemoteShellPayload(cachedInstallCommand), /apt-get --no-download install -y/);
  assert.ok(cachedTask.logs.some(item => item.text.includes("远端 APT 缓存已包含")));
  assert.equal(cachedManager.remove(cachedTask.id), true);

  let satisfiedProbeCalls = 0;
  let satisfiedResolverCalls = 0;
  let satisfiedDownloads = 0;
  let satisfiedUploads = 0;
  let satisfiedStreams = 0;
  let satisfiedConfigurations = 0;
  let satisfiedVerifications = 0;
  const satisfiedManager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command(_connection, command) {
      satisfiedProbeCalls += 1;
      if (satisfiedProbeCalls === 1) return {status:0, stdout:"xrdp is already the newest version"};
      if (satisfiedProbeCalls === 2) return {status:0, stdout:[
        "TERMA_APT_OS_ID=debian", "TERMA_APT_CODENAME=buster", "TERMA_APT_ARCH=arm64",
        "TERMA_APT_INSTALLED=xrdp:arm64\tinstall ok installed\t",
        "TERMA_APT_INSTALLED=xorgxrdp:arm64\tinstall ok installed\t"
      ].join("\n")};
      return {status:0, stdout:""}; // temporary-directory cleanup
    },
    async resolve_apt_packages(packages, platform) {
      satisfiedResolverCalls += 1;
      assert.deepEqual(packages, ["xrdp", "xorgxrdp"]);
      assert.equal(platform.installed.has("xrdp"), true);
      assert.equal(platform.installed.has("xorgxrdp"), true);
      return [];
    },
    async download_apt_bundle() { satisfiedDownloads += 1; throw new Error("already-satisfied task must not download"); },
    start_upload() { satisfiedUploads += 1; throw new Error("already-satisfied task must not upload"); },
    async run_privileged_stream() { satisfiedStreams += 1; throw new Error("already-satisfied task must not install"); },
    async run_ssh_stream() { satisfiedStreams += 1; throw new Error("already-satisfied task must not install"); }
  });
  const satisfiedStarted = satisfiedManager.startAptInstall({
    connection:{id:72, name:"already-installed", ssh_host:"already-installed.test"},
    component:"rdp-server", component_label:"RDP 服务", packages:["xrdp", "xorgxrdp"],
    async after_install(onChunk) {
      satisfiedConfigurations += 1;
      onChunk(Buffer.from("existing packages configured\n"), "stdout");
      return {status:0, stdout:""};
    },
    async verify() {
      satisfiedVerifications += 1;
      return {xrdp_installed:true, xorgxrdp_installed:true};
    },
    validate(after) {
      assert.equal(after.xrdp_installed, true);
      assert.equal(after.xorgxrdp_installed, true);
      return true;
    }
  });
  const satisfiedDeadline = Date.now() + 3000;
  let satisfiedTask;
  while (Date.now() < satisfiedDeadline) {
    satisfiedTask = satisfiedManager.list().find(item => item.id === satisfiedStarted.id);
    if (satisfiedTask?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(satisfiedTask.status, "done");
  assert.equal(satisfiedTask.progress, 100);
  assert.equal(satisfiedTask.after.xrdp_installed, true);
  assert.equal(satisfiedResolverCalls, 1);
  assert.equal(satisfiedConfigurations, 1);
  assert.equal(satisfiedVerifications, 1);
  assert.equal(satisfiedDownloads, 0);
  assert.equal(satisfiedUploads, 0);
  assert.equal(satisfiedStreams, 0);
  assert.ok(satisfiedTask.logs.some(item => item.text.includes("跳过下载、上传和重复安装")));
  assert.ok(satisfiedTask.logs.some(item => item.text.includes("现有安装状态验证通过")));
  assert.equal(satisfiedManager.remove(satisfiedTask.id), true);

  let repairCalls = 0;
  let repairedDownloads = 0;
  let repairUpload = 0;
  const repairManager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command(_connection, command) {
      repairCalls += 1;
      if (repairCalls === 1) return {status:0, stdout:"'https://deb.example.test/xclip_1_amd64.deb' xclip_1_amd64.deb 3"};
      if (repairCalls === 2) return {status:0, stdout:""}; // first mkdir
      if (repairCalls === 3) return {status:1, stderr:"E: Some packages could not be downloaded"}; // dependency preflight
      if (repairCalls === 4) return {status:0, stdout:[
        "TERMA_APT_OS_ID=linx", "TERMA_APT_CODENAME=buster", "TERMA_APT_ARCH=amd64"
      ].join("\n")};
      if (repairCalls === 5) return {status:0, stdout:""}; // retry mkdir
      return {status:0, stdout:""}; // retry preflight
    },
    async resolve_apt_packages() {
      repairedDownloads += 1;
      return [{url:"https://archive.debian.org/debian/xclip.deb", filename:"xclip_1_amd64.deb", size:3}];
    },
    async download_apt_bundle(_items, options) {
      repairedDownloads += 1;
      options.onProgress?.({filename:"xclip_1_amd64.deb", bytes:3, total:3});
      return {directory:root, files:[packageFile], bytes:3};
    },
    start_upload() { repairUpload += 1; return {id:`upload-repair-${repairUpload}`}; },
    list_sftp_jobs() { return [{id:`upload-repair-${repairUpload}`, status:"done", transferred:3, size:3}]; },
    async run_privileged_stream() { return {status:0, stdout:"installed\n"}; }
  });
  const repairStarted = repairManager.startAptInstall({
    connection:{id:71, name:"repair", ssh_host:"repair.test"},
    component:"vnc-clipboard-helper", component_label:"Unicode 剪贴板辅助工具", packages:["xclip"],
    grant:{id:"grant-repair"}, elevate:true,
    async verify() { return {available:true}; }
  });
  const repairDeadline = Date.now() + 3000;
  let repairTask;
  while (Date.now() < repairDeadline) {
    repairTask = repairManager.list().find(item => item.id === repairStarted.id);
    if (repairTask?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(repairTask.status, "done");
  assert.equal(repairUpload, 2, "incomplete dependency bundles should be uploaded again after local resolution");
  assert.ok(repairTask.logs.some(item => item.text.includes("自动补全")));
  assert.equal(repairManager.remove(repairTask.id), true);

  const failedManager = createRemoteOfflineTaskManager({
    data_dir:root,
    async run_ssh_command() { return {status:1, stderr:"probe failed"}; }
  });
  const failed = failedManager.startAptInstall({
    connection:{id:8, name:"demo-failed", ssh_host:"demo.test"},
    component:"vnc-server", component_label:"VNC 服务", packages:["xclip"]
  });
  const failedDeadline = Date.now() + 1000;
  let failedView;
  while (Date.now() < failedDeadline) {
    failedView = failedManager.list().find(item => item.id === failed.id);
    if (failedView?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(failedView.status, "failed");
  assert.ok(failedManager.list().some(item => item.id === failed.id), "failed tasks remain until explicitly removed");
  assert.equal(failedManager.clearFinished().removed, 0, "clear history must retain failed tasks");
  assert.equal(failedManager.remove(failed.id), true);

  let commandReleased = false;
  const commandManager = createRemoteOfflineTaskManager({data_dir:root});
  const commandTask = commandManager.startCommand({
    connection:{id:9, name:"command-task", ssh_host:"demo.test"},
    component:"rdp-server",
    component_label:"RDP 服务",
    action:"uninstall",
    action_label:"卸载",
    mode:"uninstall",
    before:{xrdp_installed:true},
    async run(onChunk) {
      onChunk(Buffer.from("removing packages\n"), "stdout");
      return {status:0, stdout:""};
    },
    async verify() { return {xrdp_installed:false}; },
    validate(after) { return after.xrdp_installed === false; },
    release() { commandReleased = true; }
  });
  const commandDeadline = Date.now() + 1000;
  let commandView;
  while (Date.now() < commandDeadline) {
    commandView = commandManager.list().find(item => item.id === commandTask.id);
    if (commandView?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(commandView.status, "done");
  assert.equal(commandView.progress, 100);
  assert.equal(commandView.action_label, "卸载");
  assert.equal(commandView.mode, "uninstall");
  assert.equal(commandView.before.xrdp_installed, true);
  assert.equal(commandView.after.xrdp_installed, false);
  assert.equal(commandReleased, true);
  assert.ok(commandView.logs.some(item => item.text.includes("removing packages")));

  const utf8Manager = createRemoteOfflineTaskManager({data_dir:root});
  const utf8Task = utf8Manager.startCommand({
    connection:{id:10, name:"utf8-task", ssh_host:"demo.test"},
    component:"x11",
    component_label:"X11 组件",
    action:"configure",
    async run(onChunk) {
      const output = Buffer.from("默认 UTF-8 日志\n", "utf8");
      onChunk(output.subarray(0, 1), "stdout");
      onChunk(output.subarray(1), "stdout");
      return {status:0, stdout:""};
    }
  });
  const utf8Deadline = Date.now() + 1000;
  let utf8View;
  while (Date.now() < utf8Deadline) {
    utf8View = utf8Manager.list().find(item => item.id === utf8Task.id);
    if (utf8View?.status !== "running") break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(utf8View.status, "done");
  assert.ok(utf8View.logs.some(item => item.text === "默认 UTF-8 日志"), "default UTF-8 task logs should preserve split multibyte output");
  fs.rmSync(root, {recursive:true, force:true});
  console.log("remote offline task checks passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
