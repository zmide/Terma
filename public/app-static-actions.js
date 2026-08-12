function staticActionValue(element, key, fallback = "") {
  return element.dataset[key] ?? fallback;
}

if (typeof registerTermaAction === "function") {
registerTermaAction("static-operation-pin", () => toggleOperationPanePinned());
registerTermaAction("static-operation-collapse", () => setOperationPaneCollapsed(true));
registerTermaAction("static-operation-expand", () => setOperationPaneCollapsed(false));
registerTermaAction("static-theme-toggle", () => toggleTheme());
registerTermaAction("static-refresh", () => loadAll());
registerTermaAction("static-operation-guide-dismiss", () => dismissOperationPanePinGuide());
registerTermaAction("static-primary", ({element}) => showPrimary(staticActionValue(element, "primary"), staticActionValue(element, "explorer") === "true"));
registerTermaAction("static-group-add", () => addGroup());
registerTermaAction("static-connection-new", () => newConnection());
registerTermaAction("static-forwards-start-all", () => startAllForwards());
registerTermaAction("static-forwards-stop-all", () => stopAllForwardsUi());
registerTermaAction("static-explorer-back", () => backToExplorer());
registerTermaAction("static-task-center-toggle", ({event}) => toggleSftpTaskCenter(event));
registerTermaAction("static-task-center-close", () => closeSftpTaskCenter());
registerTermaAction("static-task-center-view", ({element}) => setSftpTaskCenterView(staticActionValue(element, "taskView")));
registerTermaAction("static-task-center-clear", ({event, element}) => {
  event.stopPropagation();
  return clearFinishedSftpJobs(element);
});
registerTermaAction("static-task-list-open", ({event}) => openSftpTaskList(event));
registerTermaAction("static-task-resize-start", ({event, element}) => startSftpTaskCenterResize(event, element));
registerTermaAction("static-task-resize-reset", ({event}) => resetSftpTaskCenterSize(event));
registerTermaAction("static-task-resize-key", ({event}) => handleSftpTaskCenterResizeKey(event));
registerTermaAction("static-auth-fields", () => toggleAuthFields());
registerTermaAction("static-key-status", () => renderKeyStatus());
registerTermaAction("static-key-refresh", () => loadKeys());
registerTermaAction("static-file-picker", ({element}) => updateFilePicker(element));
registerTermaAction("static-key-upload", () => uploadKey());
registerTermaAction("static-key-repair", () => repairSelectedKey());
registerTermaAction("static-terminal-startup", ({element}) => toggleConnectionTerminalStartup(element.form));
registerTermaAction("static-terminal-profile", ({element}) => applyConnectionTerminalProfile(element.value, element));
registerTermaAction("static-connection-save-clear", ({element}) => saveConnectionForm(true, element));
registerTermaAction("static-connection-save-connect", ({element}) => saveConnectionForm(false, element, true));
registerTermaAction("static-connection-test", ({element}) => testConnectionForm(element));
registerTermaAction("static-connection-reset", () => resetConnectionForm());
registerTermaAction("static-forward-labels", () => toggleForwardLabels());
registerTermaAction("static-forward-template-apply", ({element}) => applyForwardTemplate(element.value));
registerTermaAction("static-forward-template-save", () => saveForwardTemplate());
registerTermaAction("static-forward-template-manage", () => showForwardTemplateManager());
registerTermaAction("static-forward-port-recommend", () => recommendForwardPort());
registerTermaAction("static-forward-edit-cancel", () => cancelForwardEdit());
registerTermaAction("static-forward-bulk-delete", () => bulkDeleteForwards());
registerTermaAction("static-import-config", () => parseImportConfig());
registerTermaAction("static-import-text", () => parseImportText());
registerTermaAction("static-import-bind-keys", () => bindImportIdentities());
registerTermaAction("static-import-test", () => batchTestImport());
registerTermaAction("static-import-save", () => batchSaveImport());
registerTermaAction("static-export-config", () => exportConfig());
registerTermaAction("static-export-copy", () => copyExport());
registerTermaAction("static-backup-database", () => downloadDatabaseBackup());
registerTermaAction("static-backup-bundle", () => downloadBackupBundle());
registerTermaAction("static-backup-restore", () => restoreDatabaseBackup());
registerTermaAction("cache-refresh", () => refreshProgramCacheSettings());
registerTermaAction("cache-clear-all", ({element}) => clearProgramCache("", element));
registerTermaAction("cache-clear-category", ({element}) => clearProgramCache(staticActionValue(element, "cacheCategory"), element));
}
