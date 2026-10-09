function fileNavigationMouseContext(event) {
  if (![3, 4].includes(event.button) || event.defaultPrevented || !document.getElementById("modal")?.hidden) return null;
  if (event.target?.closest?.(".sftp-editor-floating-root, .modal, [role='dialog']")) return null;
  const owner = event.target?.closest?.(".sftp-shell[data-sftp-tab-key], .sftp-toolbar[data-workspace-tab-key], .local-files-shell[data-tab-key]");
  if (!owner) return null;
  const tabKey = owner.dataset.sftpTabKey || owner.dataset.workspaceTabKey || owner.dataset.tabKey;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  if (!tab || !["sftp", "local-files"].includes(tab.kind)) return null;
  return {tabKey, kind:tab.kind, direction:event.button === 3 ? -1 : 1};
}

const fileNavigationMouseRequests = new Map();

function handleFileNavigationMouse(event) {
  const context = fileNavigationMouseContext(event);
  if (!context) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.type !== "mouseup" || fileNavigationMouseRequests.has(context.tabKey)) return;
  const navigate = context.kind === "sftp" ? navigateSftpHistory : navigateLocalFilesHistory;
  const request = Promise.resolve().then(() => navigate(context.direction, context.tabKey))
    .catch(error => notify(error.message || String(error), "error"))
    .finally(() => fileNavigationMouseRequests.delete(context.tabKey));
  fileNavigationMouseRequests.set(context.tabKey, request);
}

for (const type of ["mousedown", "mouseup", "auxclick"]) {
  document.addEventListener(type, handleFileNavigationMouse, true);
}
