async function showLogSettings() {
  const settings = await api("/api/logs/settings");
  $("modal").innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="logSettingsTitle">
    <h2 id="logSettingsTitle">${esc(tr("common:log_maintenance.title", {defaultValue:"Log settings"}))}</h2>
    <div class="grid">
      <div><label>${esc(tr("common:log_maintenance.retention_days", {defaultValue:"Retention days (0 for unlimited)"}))}</label><input id="logSettingDays" type="number" min="0" max="3650" value="${Number(settings.retention_days || 0)}"></div>
      <div><label>${esc(tr("common:log_maintenance.file_limit_mb", {defaultValue:"Per-file limit (MB)"}))}</label><input id="logSettingFileMb" type="number" min="1" max="2048" value="${Number(settings.max_file_size_mb || 50)}"></div>
      <div><label>${esc(tr("common:log_maintenance.total_limit_mb", {defaultValue:"Total log limit (MB)"}))}</label><input id="logSettingTotalMb" type="number" min="10" max="102400" value="${Number(settings.max_total_size_mb || 1024)}"></div>
      <div><label>${esc(tr("common:log_maintenance.rotation_files", {defaultValue:"Rotated files kept per log"}))}</label><input id="logSettingRotations" type="number" min="1" max="10" value="${Number(settings.rotation_files || 3)}"></div>
    </div>
    <p class="muted">${esc(tr("common:log_maintenance.description", {defaultValue:"Logs rotate automatically when the per-file limit is reached. The background cleanup runs every 6 hours and applies the retention and total-size limits."}))}</p>
    <div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.cancel", {defaultValue:"Cancel"}))}</button><button onclick="runConfiguredLogCleanup()">${esc(tr("common:log_maintenance.clean_now", {defaultValue:"Clean now"}))}</button><button class="primary" onclick="saveLogSettings()">${esc(tr("common:actions.save", {defaultValue:"Save"}))}</button></div>
  </div>`;
  $("modal").hidden = false;
}

async function saveLogSettings() {
  const result = await api("/api/logs/settings", {method:"PUT", body:JSON.stringify({
    retention_days:Number($("logSettingDays").value),
    max_file_size_mb:Number($("logSettingFileMb").value),
    max_total_size_mb:Number($("logSettingTotalMb").value),
    rotation_files:Number($("logSettingRotations").value)
  })});
  closeModal();
  await renderLogs();
  notify(tr("common:log_maintenance.settings_saved", {count:Number(result.cleanup?.deleted || 0), defaultValue:"Log settings saved; cleaned {{count}} files"}), "success");
}

async function runConfiguredLogCleanup() {
  const result = await api("/api/logs/cleanup", {method:"POST", body:"{}"});
  closeModal();
  await renderLogs();
  notify(tr("common:log_maintenance.cleanup_complete", {count:Number(result.deleted || 0), defaultValue:"Log cleanup completed: deleted {{count}} files"}), "success");
}


function logPathsForKey(key) {
  if (key === "system") {
    return (logsData.system || []).map(log => log.path);
  }
  if (key === "batch") {
    return (logsData.batch || []).map(log => log.path);
  }
  const name = key.replace(/^server:/, "");
  const server = (logsData.connections || []).find(item => item.name === name);
  return (server?.logs || []).map(log => log.path);
}

async function deleteLog(path) {
  if (!await confirmModal(tr("common:log_maintenance.delete_one_confirm", {defaultValue:"Delete this log?"}), tr("common:log_maintenance.delete_title", {defaultValue:"Delete log"}), tr("common:actions.delete", {defaultValue:"Delete"}), tr("common:actions.cancel", {defaultValue:"Cancel"}), true)) return;
  await deleteLogPaths([path]);
}

async function deleteLogGroup(key) {
  const paths = logPathsForKey(key);
  if (!paths.length) return notify(tr("common:log_maintenance.select_log", {defaultValue:"Select a log"}), "error");
  if (!await confirmModal(tr("common:log_maintenance.delete_group_confirm", {count:paths.length, defaultValue:"Delete {{count}} logs in this group?"}), tr("common:log_maintenance.delete_group_title", {defaultValue:"Delete group logs"}), tr("common:actions.delete", {defaultValue:"Delete"}), tr("common:actions.cancel", {defaultValue:"Cancel"}), true)) return;
  await deleteLogPaths(paths);
}

async function clearAllLogs() {
  const paths = [...(logsData.system || []).map(log => log.path), ...(logsData.batch || []).map(log => log.path), ...(logsData.connections || []).flatMap(server => (server.logs || []).map(log => log.path))];
  if (!paths.length) return notify(tr("common:log_maintenance.nothing_to_clear", {defaultValue:"There are no logs to clear"}), "info");
  if (!await confirmModal(tr("common:log_maintenance.clear_all_confirm", {count:paths.length, defaultValue:"Clear all {{count}} logs?"}), tr("common:log_maintenance.clear_title", {defaultValue:"Clear logs"}), tr("common:actions.clear", {defaultValue:"Clear"}), tr("common:actions.cancel", {defaultValue:"Cancel"}), true)) return;
  await deleteLogPaths(paths);
}

async function clearLogsOlderThan(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const paths = [...(logsData.system || []), ...(logsData.batch || []), ...(logsData.connections || []).flatMap(server => server.logs || [])]
    .filter(log => Number(log.time || 0) && Number(log.time) < cutoff)
    .map(log => log.path);
  if (!paths.length) return notify(tr("common:log_maintenance.no_older_logs", {days, defaultValue:"There are no logs older than {{days}} days"}), "info");
  if (!await confirmModal(tr("common:log_maintenance.delete_older_confirm", {days, count:paths.length, defaultValue:"Delete {{count}} logs older than {{days}} days?"}), tr("common:log_maintenance.history_title", {defaultValue:"Clean historical logs"}), tr("common:actions.delete", {defaultValue:"Delete"}), tr("common:actions.cancel", {defaultValue:"Cancel"}), true)) return;
  await deleteLogPaths(paths);
}

async function clearCustomLogRetention() {
  const days = Math.max(1, Number($("logRetentionDays")?.value || 0));
  if (!Number.isFinite(days)) return notify(tr("common:log_maintenance.invalid_retention", {defaultValue:"Enter a valid retention period"}), "error");
  await clearLogsOlderThan(days);
}

async function deleteLogPaths(paths) {
  const result = await api("/api/logs/delete", {method:"POST", body:JSON.stringify({paths})});
  const deleted = new Set(result.deleted || []);
  const activeLogPath = tabs.find(tab => tab.key === activeTabKey)?.path;
  tabs = tabs.filter(tab => !(tab.kind === "log" && deleted.has(tab.path)));
  if (activeView === "log" && deleted.has(activeLogPath)) renderWelcome();
  renderTabs();
  await renderLogs();
  const message = result.errors.length
    ? tr("common:log_maintenance.delete_result_with_errors", {deleted:result.deleted.length, failed:result.errors.length, defaultValue:"Deleted {{deleted}} logs; {{failed}} failed"})
    : tr("common:log_maintenance.delete_result", {count:result.deleted.length, defaultValue:"Deleted {{count}} logs"});
  notify(message, result.errors.length ? "error" : "success");
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if ($("logSettingsTitle") && typeof showLogSettings === "function") showLogSettings().catch(() => {});
  });
}
