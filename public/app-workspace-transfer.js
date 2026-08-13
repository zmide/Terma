function workspacePeerTabsFor(sourceTabKey, kinds=["terminal", "sftp", "local-files"]) {
  if (isMobileLayout()) return [];
  const sourcePane = workspaceFindPaneForTab(sourceTabKey);
  if (!sourcePane || workspaceLeaves().length < 2) return [];
  const allowedKinds = new Set(kinds);
  return workspaceLeaves()
    .filter(pane => pane.id !== sourcePane.id)
    .map(pane => ({pane, tab:typeof workspaceTabByKey === "function" ? workspaceTabByKey(pane.activeTabKey) : tabs.find(tab => tab.key === pane.activeTabKey)}))
    .filter(({tab}) => tab && allowedKinds.has(tab.kind));
}

function workspaceTransferTargetLabel(target) {
  const tab = target?.tab || target;
  if (!tab) return "";
  if (tab.kind === "terminal") return `终端：${tab.title || tab.name || tab.id}`;
  if (tab.kind === "sftp") return `SFTP：${tab.title || tab.name || tab.id}`;
  const runtime = typeof localFileRuntimes !== "undefined" ? localFileRuntimes.get(String(tab.key || "")) : null;
  return `本地文件：${runtime?.displayPath || runtime?.path || tab.subtitle || tab.title || "目录"}`;
}

function workspaceLocalFilesTargetReady(sourceTabKey, target) {
  const tab = target?.tab || target;
  if (!tab) return false;
  if (tab.kind === "sftp") return Number(tab.id) > 0;
  if (tab.kind === "terminal") return Boolean(terminalSessions?.get?.(String(tab.key || ""))?.connected);
  if (tab.kind !== "local-files") return false;
  const targetRuntime = typeof localFileRuntimes !== "undefined" ? localFileRuntimes.get(String(tab.key || "")) : null;
  const sourceRuntime = typeof localFileRuntimes !== "undefined" ? localFileRuntimes.get(String(sourceTabKey || "")) : null;
  return Boolean(
    targetRuntime?.location === "directory"
    && targetRuntime.path
    && localDeliveryPathKey(targetRuntime.path) !== localDeliveryPathKey(sourceRuntime?.path)
  );
}

async function copyLocalFilesToLocalTab(payload, target) {
  if (!payload?.paths?.length || target?.kind !== "local-files") return;
  const runtime = localFileRuntimes.get(String(target.key || ""));
  if (runtime?.location !== "directory" || !runtime.path) throw new Error("请先在对端本地文件标签中打开一个目录");
  const plan = await api("/api/local-files/copy-plan", {
    method:"POST",
    body:JSON.stringify({paths:payload.paths, target:runtime.path})
  });
  const conflicts = (plan.items || []).filter(item => item.exists);
  let conflict = "error";
  if (conflicts.length) {
    const preview = conflicts.slice(0, 6).map(item => item.name).join("、");
    conflict = await chooseModal("本地目录存在同名项目", `${preview}${conflicts.length > 6 ? ` 等 ${conflicts.length} 项` : ""}`, [
      {label:"覆盖", value:"overwrite", className:"danger"},
      {label:"自动重命名", value:"rename", className:"primary"},
      {label:"取消", value:"cancel"}
    ]);
  }
  if (conflict === "cancel") return;
  const result = await api("/api/local-files/copy", {
    method:"POST",
    body:JSON.stringify({paths:payload.paths, target:runtime.path, conflict})
  });
  await loadLocalFiles(target.key, {path:runtime.path, location:"directory", page:runtime.page, refresh:true});
  notify(`已发送 ${result.count || payload.paths.length} 个项目到 ${runtime.displayPath || runtime.path}`, "success");
}

async function sendLocalFilesToWorkspacePeer(payload, target) {
  if (target?.kind === "terminal") return uploadLocalFilesToTerminalTab(payload, target);
  if (target?.kind === "sftp") return uploadLocalFilesToSftp(payload, target, target.key);
  if (target?.kind === "local-files") return copyLocalFilesToLocalTab(payload, target);
}

function workspaceLocalFilesTransferActions(sourceTabKey, payload) {
  if (!payload?.paths?.length) return [];
  return workspacePeerTabsFor(sourceTabKey)
    .map(({tab}) => tab)
    .filter(tab => workspaceLocalFilesTargetReady(sourceTabKey, tab))
    .map(tab => ({label:`发送到${workspaceTransferTargetLabel(tab)}`, icon:tab.kind === "terminal" ? "terminal" : tab.kind === "sftp" ? "server" : "folder-copy", run:() => sendLocalFilesToWorkspacePeer(payload, tab)}));
}

function workspaceSftpTransferEntries(tabKey, pathValue, name, type) {
  const selected = typeof selectedSftpEntries === "function" ? selectedSftpEntries(tabKey) : [];
  if (selected.some(item => String(item.path) === String(pathValue))) return selected;
  return [{path:pathValue, name:name || String(pathValue || "").split("/").pop() || "项目", type:type || "file"}];
}

async function sendSftpEntriesToWorkspacePeer(sourceTabKey, connectionId, entries, target) {
  if (!entries?.length) return;
  const drag = {sourceTabKey:String(sourceTabKey || ""), connectionId:Number(connectionId), entries};
  if (target?.kind === "terminal") return copySftpDraggedItemsToTerminalTab(drag, target);
  if (target?.kind === "sftp") return copySftpDraggedItemsToTarget(drag, target);
  if (target?.kind === "local-files") return copySftpDraggedItemsToLocalTab(drag, target);
}

function workspaceSftpPathTransferActions(sourceTabKey, connectionId, pathValue, name, type) {
  const entries = workspaceSftpTransferEntries(sourceTabKey, pathValue, name, type);
  return workspacePeerTabsFor(sourceTabKey)
    .map(({tab}) => tab)
    .filter(tab => {
      if (tab.kind === "terminal") return Boolean(terminalSessions?.get?.(String(tab.key || ""))?.connected);
      if (tab.kind === "local-files") {
        const runtime = typeof localFileRuntimes !== "undefined" ? localFileRuntimes.get(String(tab.key || "")) : null;
        return Boolean(runtime?.location === "directory" && runtime.path);
      }
      return Number(tab.id) > 0;
    })
    .map(tab => ({label:`发送到${workspaceTransferTargetLabel(tab)}`, icon:tab.kind === "terminal" ? "terminal" : tab.kind === "sftp" ? "server" : "folder-copy", run:() => sendSftpEntriesToWorkspacePeer(sourceTabKey, connectionId, entries, tab)}));
}
