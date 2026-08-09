async function showLogSettings() {
  const settings = await api("/api/logs/settings");
  $("modal").innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="logSettingsTitle">
    <h2 id="logSettingsTitle">日志设置</h2>
    <div class="grid">
      <div><label>保留天数（0 为不限）</label><input id="logSettingDays" type="number" min="0" max="3650" value="${Number(settings.retention_days || 0)}"></div>
      <div><label>单文件上限（MB）</label><input id="logSettingFileMb" type="number" min="1" max="2048" value="${Number(settings.max_file_size_mb || 50)}"></div>
      <div><label>全部日志上限（MB）</label><input id="logSettingTotalMb" type="number" min="10" max="102400" value="${Number(settings.max_total_size_mb || 1024)}"></div>
      <div><label>每个日志保留轮转数</label><input id="logSettingRotations" type="number" min="1" max="10" value="${Number(settings.rotation_files || 3)}"></div>
    </div>
    <p class="muted">写入超过单文件上限时自动轮转；后台每 6 小时按天数和总容量清理一次。</p>
    <div class="actions"><button onclick="closeModal()">取消</button><button onclick="runConfiguredLogCleanup()">立即清理</button><button class="primary" onclick="saveLogSettings()">保存</button></div>
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
  notify(`日志设置已保存，清理 ${Number(result.cleanup?.deleted || 0)} 个文件`, "success");
}

async function runConfiguredLogCleanup() {
  const result = await api("/api/logs/cleanup", {method:"POST", body:"{}"});
  closeModal();
  await renderLogs();
  notify(`日志清理完成：删除 ${Number(result.deleted || 0)} 个文件`, "success");
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
  if (!await confirmModal("删除这条日志？", "删除日志", "删除", "取消", true)) return;
  await deleteLogPaths([path]);
}

async function deleteLogGroup(key) {
  const paths = logPathsForKey(key);
  if (!paths.length) return notify("请选择日志", "error");
  if (!await confirmModal(`删除该分组下的 ${paths.length} 条日志？`, "删除分组日志", "删除", "取消", true)) return;
  await deleteLogPaths(paths);
}

async function clearAllLogs() {
  const paths = [...(logsData.system || []).map(log => log.path), ...(logsData.batch || []).map(log => log.path), ...(logsData.connections || []).flatMap(server => (server.logs || []).map(log => log.path))];
  if (!paths.length) return notify("暂无日志可清空", "info");
  if (!await confirmModal(`清空全部 ${paths.length} 条日志？`, "清空日志", "清空", "取消", true)) return;
  await deleteLogPaths(paths);
}

async function clearLogsOlderThan(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const paths = [...(logsData.system || []), ...(logsData.batch || []), ...(logsData.connections || []).flatMap(server => server.logs || [])]
    .filter(log => Number(log.time || 0) && Number(log.time) < cutoff)
    .map(log => log.path);
  if (!paths.length) return notify(`没有 ${days} 天前的日志`, "info");
  if (!await confirmModal(`删除 ${days} 天前的 ${paths.length} 条日志？`, "清理历史日志", "删除", "取消", true)) return;
  await deleteLogPaths(paths);
}

async function clearCustomLogRetention() {
  const days = Math.max(1, Number($("logRetentionDays")?.value || 0));
  if (!Number.isFinite(days)) return notify("请输入有效保留天数", "error");
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
  notify(`已删除 ${result.deleted.length} 条日志${result.errors.length ? `，失败 ${result.errors.length} 条` : ""}`, result.errors.length ? "error" : "success");
}
