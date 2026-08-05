const assert = require("assert");
const fs = require("fs");
const iconv = require("iconv-lite");
const os = require("os");
const path = require("path");
const { createRemoteOfflineTaskManager } = require("../dist/remote-offline-tasks");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-offline-task-check-"));
  const packageFile = path.join(root, "xclip_1_amd64.deb");
  fs.writeFileSync(packageFile, "deb", "utf8");
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
        "TD_APT_OS_ID=linx", "TD_APT_CODENAME=buster", "TD_APT_ARCH=amd64",
        "TD_APT_INSTALLED=libx11-6:amd64\tinstall ok installed\t"
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
        "TD_APT_OS_ID=linx", "TD_APT_CODENAME=buster", "TD_APT_ARCH=amd64"
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
