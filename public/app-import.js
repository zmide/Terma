const IMPORT_SECTION_META = {
  "import-source": () => tr("settings:auto.ssh_config_import_export", {defaultValue:"SSH config 导入导出"}),
  "import-export": () => tr("settings:auto.database_import_export", {defaultValue:"数据库导入导出"}),
  "configSnapshots": () => tr("settings:auto.config_snapshots", {defaultValue:"配置快照"})
};

function importSectionLabel(id) {
  const label = IMPORT_SECTION_META[normalizeImportSection(id)] || IMPORT_SECTION_META["import-source"];
  return label();
}
let activeImportSection = "import-source";
let legacyBrandMigrationState = null;

function localizedConfigSnapshotReason(reason) {
  const source = String(reason || "");
  const labels = {
    "调整 SSH 连接分组顺序前自动快照":tr("settings:auto.snapshot_reason_group_order", {defaultValue:"调整 SSH 连接分组顺序前自动快照"}),
    "批量修改 SSH 连接前自动快照":tr("settings:auto.snapshot_reason_bulk_edit", {defaultValue:"批量修改 SSH 连接前自动快照"}),
    "批量删除 SSH 连接前自动快照":tr("settings:auto.snapshot_reason_bulk_delete", {defaultValue:"批量删除 SSH 连接前自动快照"}),
    "批量导入前自动快照":tr("settings:auto.snapshot_reason_bulk_import", {defaultValue:"批量导入前自动快照"}),
    "重命名 SSH 连接分组前自动快照":tr("settings:auto.snapshot_reason_group_rename", {defaultValue:"重命名 SSH 连接分组前自动快照"}),
    "批量应用转发模板前自动快照":tr("settings:auto.snapshot_reason_forward_template", {defaultValue:"批量应用转发模板前自动快照"}),
    "回滚前自动快照":tr("settings:auto.snapshot_reason_restore", {defaultValue:"回滚前自动快照"}),
    "恢复数据库前自动快照":tr("settings:auto.snapshot_reason_database_restore", {defaultValue:"恢复数据库前自动快照"}),
    "手动快照":tr("settings:auto.snapshot_reason_manual", {defaultValue:"手动快照"})
  };
  return labels[source] || localizedTermaUiPhrase(source);
}

function showImport(updateTab=true) {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const existingView = $("view-import");
  if (existingView?.querySelector("#importMainPanel")) {
    setWorkspace(tr("navigation:auto.import_export", {defaultValue:"导入导出"}), tr("settings:auto.import_migration", {defaultValue:"迁移 SSH config、数据库备份和连接配置快照。"}), "import", "import", updateTab, true, {kind:"import"});
    renderBackupControls();
    renderLegacyBrandMigration();
    showImportSection(activeImportSection, {moveToWorkspace:false});
    void renderConfigSnapshots();
    void loadSecuritySettings().then(() => inPane(renderBackupControls)).catch(() => {});
    return;
  }
  $("view-import").innerHTML = $("importTpl").innerHTML;
  refreshIcons();
  setWorkspace(tr("navigation:auto.import_export", {defaultValue:"导入导出"}), tr("settings:auto.import_migration", {defaultValue:"迁移 SSH config、数据库备份和连接配置快照。"}), "import", "import", updateTab, true, {kind:"import"});
  renderBackupControls();
  loadSecuritySettings().then(() => inPane(renderBackupControls)).catch(() => {});
  renderLegacyBrandMigration();
  renderImport();
  renderConfigSnapshots();
  showImportSection(activeImportSection, {moveToWorkspace:false});
}

function normalizeImportSection(id) {
  return Object.prototype.hasOwnProperty.call(IMPORT_SECTION_META, id) ? id : "import-source";
}

function openImportSection(id) {
  activeImportSection = normalizeImportSection(id);
  if (activeView !== "import") showImport();
  showImportSection(activeImportSection);
}

function showImportSection(id, options={}) {
  const next = normalizeImportSection(id);
  activeImportSection = next;
  const mainPanel = $("importMainPanel");
  if (mainPanel) mainPanel.hidden = next === "configSnapshots";
  for (const sectionId of Object.keys(IMPORT_SECTION_META)) {
    const section = $(sectionId);
    if (section) section.hidden = sectionId !== next;
  }
  setExplorerSectionActive(next);
  if (activeView === "import" && $("workspaceSubtitle")) $("workspaceSubtitle").textContent = importSectionLabel(next);
  if (options.moveToWorkspace !== false) {
    const scope = typeof currentWorkspaceDomScope === "function" ? currentWorkspaceDomScope() : document;
    scope.querySelector(".workspace")?.scrollTo?.({top:0, behavior:"auto"});
    if (isMobileLayout()) showMobileWorkspace();
  }
}

function scrollToImportSection(id) {
  openImportSection(id);
}

async function renderConfigSnapshots() {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const root = $("view-import");
  if (!root) return;
  let box = $("configSnapshots");
  if (!box) {
    box = document.createElement("div");
    box.id = "configSnapshots";
    box.className = "panel snapshot-panel";
    root.appendChild(box);
  }
  box.innerHTML = stateView("loading", tr("settings:import.snapshots_loading", {defaultValue:"正在加载配置快照"}));
  try {
    const items = await api("/api/config-snapshots");
    box.innerHTML = `<div class="workspace-head"><div><h3>${esc(tr("settings:auto.config_snapshots", {defaultValue:"配置版本快照"}))}</h3><div class="subtitle">${esc(tr("settings:auto.config_snapshots_hint", {defaultValue:"导入、恢复和批量应用模板前会自动创建，最多保留 20 个。"}))}</div></div><button onclick="createConfigSnapshotUi()">${esc(tr("settings:auto.create_now", {defaultValue:"立即创建"}))}</button></div>${items.length ? `<div class="snapshot-list">${items.map(item => {
      const createdAt = new Date(item.created_at).toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false});
      const counts = [
        tr("settings:auto.snapshot_connections", {count:item.counts?.connections || 0, defaultValue:`连接 ${item.counts?.connections || 0}`}),
        tr("settings:auto.snapshot_forwards", {count:item.counts?.forwards || 0, defaultValue:`转发 ${item.counts?.forwards || 0}`}),
        tr("settings:auto.snapshot_templates", {count:item.counts?.templates || 0, defaultValue:`模板 ${item.counts?.templates || 0}`})
      ].join(" · ");
      return `<div class="snapshot-row"><div><strong>${esc(localizedConfigSnapshotReason(item.reason))}</strong><span>${esc(createdAt)} · ${esc(counts)}</span></div><div class="actions tight"><button onclick="restoreConfigSnapshotUi('${escAttr(item.id)}')">${esc(tr("settings:auto.snapshot_restore", {defaultValue:"回滚"}))}</button><button class="danger" onclick="deleteConfigSnapshotUi('${escAttr(item.id)}')">${esc(tr("common:actions.delete", {defaultValue:"删除"}))}</button></div></div>`;
    }).join("")}</div>` : stateView("empty", tr("settings:import.snapshots_empty", {defaultValue:"暂无配置快照"}), tr("settings:auto.config_snapshots_empty_hint", {defaultValue:"可手动创建，后续高风险操作也会自动保存。"}))}`;
  } catch (error) {
    box.innerHTML = stateView("error", tr("settings:import.snapshots_load_failed", {defaultValue:"快照加载失败"}), localizedTermaUiPhrase(error.message || tr("settings:import.unknown_error", {defaultValue:"未知错误"})));
  }
  inPane(() => showImportSection(activeImportSection, {moveToWorkspace:false}));
}

async function createConfigSnapshotUi() {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  await api("/api/config-snapshots", {method:"POST",body:JSON.stringify({reason:"手动快照"})});
  notify(tr("settings:import.snapshot_created", {defaultValue:"配置快照已创建"}), "success");
  inPane(renderConfigSnapshots);
}

async function restoreConfigSnapshotUi(id) {
  if (!requireConfigEncryptionUnlocked(tr("settings:import.snapshot_restore_context", {defaultValue:"回滚配置快照"}))) return;
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  if (!await confirmModal(
    tr("settings:import.snapshot_restore_confirm", {defaultValue:"回滚会停止当前转发并覆盖连接、转发和模板配置。继续？"}),
    tr("settings:import.snapshot_restore_title", {defaultValue:"回滚配置快照"}),
    tr("settings:import.snapshot_restore_action", {defaultValue:"确认回滚"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return;
  await api(`/api/config-snapshots/${id}/restore`, {method:"POST"});
  await loadAll();
  notify(tr("settings:import.snapshot_restored", {defaultValue:"配置快照已回滚"}), "success");
  inPane(renderConfigSnapshots);
}

async function deleteConfigSnapshotUi(id) {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  if (!await confirmModal(
    tr("settings:import.snapshot_delete_confirm", {defaultValue:"删除该配置快照？"}),
    tr("settings:import.snapshot_delete_title", {defaultValue:"删除快照"}),
    tr("common:actions.delete", {defaultValue:"删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return;
  await api(`/api/config-snapshots/${id}`, {method:"DELETE"});
  inPane(renderConfigSnapshots);
}

function renderBackupControls() {
  const bundleBtn = $("backupBundleBtn");
  const bundleNote = $("backupBundleNote");
  if (!bundleBtn || !bundleNote) return;
  const enabled = Boolean(securitySettings?.encryption_enabled);
  bundleBtn.hidden = !enabled;
  bundleBtn.disabled = enabled && !securitySettings?.encryption_ready;
  bundleBtn.title = bundleBtn.disabled ? tr("settings:import.bundle_unlock_first", {defaultValue:"先解锁配置加密后再下载迁移包"}) : "";
  bundleNote.textContent = enabled
    ? tr("settings:import.backup_encrypted_hint", {defaultValue:"已启用配置加密：建议下载 .termabackup 加密迁移包。迁移包包含完整数据库和配置加密元数据，不包含 SSH 私钥文件、Web 密码或访问 Token。旧版 .tdbackup 文件仍可导入。"})
    : tr("settings:import.backup_plain_hint", {defaultValue:"未启用配置加密：通常下载普通 .db 数据库备份即可。启用配置加密后才会显示加密迁移包下载入口。"});
}

function legacyBrandMigrationStatus(state) {
  if (state?.legacy_running) return {kind:"error", icon:"circle-alert", text:tr("settings:import.legacy_running", {defaultValue:"旧版程序仍在运行。请先退出旧版，再迁移数据。"})};
  if (state?.status === "failed") return {kind:"error", icon:"circle-alert", text:localizedTermaUiPhrase(state.message || tr("settings:import.legacy_previous_failed", {defaultValue:"上一次旧版数据迁移失败。"}))};
  if (state?.completed) return {kind:"success", icon:"circle-check", text:tr("settings:auto.legacy_complete", {defaultValue:"已完成旧版数据合并。当前数据和旧目录都已保留。"})};
  if (state?.target_has_data) return {kind:"info", icon:"shield-alert", text:tr("settings:import.legacy_target_has_data", {defaultValue:"Terma 已有数据。迁移前会完整备份，再合并缺失的连接、分组、远程配置、工作区和密钥。"})};
  if (state?.source_available) return {kind:"info", icon:"database", text:tr("settings:import.legacy_source_found", {defaultValue:"发现可迁移的旧版数据。"})};
  return {kind:"info", icon:"circle-check", text:tr("settings:import.legacy_source_missing", {defaultValue:"未发现可迁移的旧版数据。"})};
}

async function renderLegacyBrandMigration() {
  const box = $("legacyBrandMigration");
  if (!box) return;
  box.innerHTML = stateView("loading", tr("settings:import.legacy_checking", {defaultValue:"正在检查旧版数据"}));
  try {
    const state = await api("/api/legacy-brand-migration");
    legacyBrandMigrationState = state;
    if (!state?.available) {
      box.innerHTML = `<div class="runtime-feedback info">${icon("monitor-off")}<span>${esc(localizedTermaUiPhrase(state?.message || tr("settings:auto.legacy_desktop_only", {defaultValue:"旧版数据迁移仅能在本机桌面版中执行"})))}</span></div>`;
      refreshIcons();
      return;
    }
    const status = legacyBrandMigrationStatus(state);
    const migration = state.last_migration || {};
    const canMigrate = Boolean(state.source_available) && !state.legacy_running;
    const actionLabel = state.completed
      ? tr("settings:auto.legacy_recheck_merge", {defaultValue:"重新检查并合并"})
      : state.target_has_data
        ? tr("settings:import.legacy_backup_merge", {defaultValue:"备份并合并旧数据"})
        : tr("settings:import.legacy_migrate_restart", {defaultValue:"迁移并重新启动"});
    const action = canMigrate
      ? `<button class="${state.target_has_data ? "danger" : "primary"}" data-ui-action-key="legacy-brand-migration" onclick="migrateLegacyBrandData(this)">${actionLabel}</button>`
      : "";
    const lastBackup = migration.backup ? `<div class="muted">${esc(tr("settings:auto.legacy_backup", {path:migration.backup, defaultValue:`当前 Terma 数据备份：${migration.backup}`}))}</div>` : "";
    const migratedAtText = migration.migrated_at ? new Date(migration.migrated_at).toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false}) : "";
    const migratedAt = migratedAtText ? `<div class="muted">${esc(tr("settings:auto.legacy_last_migration", {time:migratedAtText, defaultValue:`最近迁移：${migratedAtText}`}))}</div>` : "";
    const currentSource = state.source_available ? `<div class="muted">${esc(tr("settings:auto.legacy_source", {path:state.source, defaultValue:`旧版目录：${state.source}`}))}</div>` : "";
    const redetectLabel = tr("settings:auto.legacy_redetect", {defaultValue:"重新检测旧版数据"});
    box.innerHTML = `<div class="legacy-brand-migration-content"><div class="runtime-feedback ${status.kind}">${icon(status.icon)}<span>${esc(status.text)}</span></div>${currentSource}${migratedAt}${lastBackup}<div class="actions tight"><button onclick="renderLegacyBrandMigration()" title="${escAttr(redetectLabel)}" aria-label="${escAttr(redetectLabel)}">${icon("refresh-cw")}</button>${action}</div></div>`;
    refreshIcons();
  } catch (error) {
    box.innerHTML = stateView("error", tr("settings:import.legacy_check_failed", {defaultValue:"旧版数据检查失败"}), localizedTermaUiPhrase(error.message || tr("settings:import.legacy_state_failed", {defaultValue:"无法读取迁移状态"})));
  }
}

async function migrateLegacyBrandData(button) {
  const state = legacyBrandMigrationState || await api("/api/legacy-brand-migration");
  if (!state?.available || !state.source_available) return renderLegacyBrandMigration();
  if (state.legacy_running) return notify(tr("settings:import.legacy_exit_first", {defaultValue:"请先退出旧版程序，再迁移数据"}), "error");
  const mergeCurrent = Boolean(state.target_has_data);
  const message = mergeCurrent
    ? tr("settings:import.legacy_merge_confirm", {defaultValue:"会先完整备份当前 Terma 数据，再合并旧版数据中缺失的连接、分组、远程配置、工作区和密钥；同名项目保留当前设置，只补齐缺失凭据。旧版目录不会删除。继续？"})
    : tr("settings:import.legacy_migrate_confirm", {defaultValue:"会迁移旧版数据中的连接、分组、远程配置、工作区和密钥并重新启动 Terma。旧版目录不会删除。继续？"});
  if (!await confirmModal(
    message,
    tr("settings:import.legacy_title", {defaultValue:"迁移旧版数据"}),
    mergeCurrent ? tr("settings:import.legacy_merge_action", {defaultValue:"备份并合并"}) : tr("settings:import.legacy_migrate_action", {defaultValue:"迁移并重启"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    mergeCurrent
  )) return;
  if (!beginUiAction("legacy-brand-migration", button, tr("settings:import.legacy_migrating", {defaultValue:"迁移中..."}))) return;
  try {
    const result = await api("/api/legacy-brand-migration", {method:"POST", body:JSON.stringify({merge_current:mergeCurrent})});
    if (!result?.ok) throw new Error(localizedTermaUiPhrase(result?.error || tr("settings:import.legacy_not_started", {defaultValue:"旧版数据迁移未启动"})));
    notify(tr("settings:import.legacy_started", {defaultValue:"正在迁移旧版数据，Terma 即将重新启动"}), "success");
  } catch (error) {
    notify(localizedTermaUiPhrase(error.message || tr("settings:import.legacy_failed", {defaultValue:"旧版数据迁移失败"})), "error");
    endUiAction("legacy-brand-migration", button);
    await renderLegacyBrandMigration();
  }
}

async function parseImportConfig(){
  const f=$("config_upload").files[0];
  if(!f) return notify(tr("settings:import.select_config_file", {defaultValue:"请选择 config 文件"}),"error");
  const form=new FormData();
  form.append("config", f);
  const res=await fetch("/api/import/parse",{method:"POST",body:form});
  if(!res.ok) return notify((await apiErrorFromResponse(res, tr("settings:import.parse_failed", {defaultValue:"配置解析失败"}))).message,"error");
  importState=await res.json();
  renderImport();
  notify(importState.missing_keys.length
    ? tr("settings:import.missing_keys", {keys:importState.missing_keys.join(", "), defaultValue:`发现未绑定私钥，可选绑定：${importState.missing_keys.join(", ")}`})
    : tr("settings:import.parse_success", {count:importState.count, defaultValue:`解析成功：${importState.count} 个连接`}), importState.missing_keys.length?"info":"success");
}

async function parseImportText(){
  const text=$("config_text").value.trim();
  if(!text) return notify(tr("settings:import.paste_config", {defaultValue:"请粘贴 config 内容"}),"error");
  importState=await api("/api/import/parse-text",{method:"POST",body:JSON.stringify({text})});
  renderImport();
  notify(importState.missing_keys.length
    ? tr("settings:import.missing_keys", {keys:importState.missing_keys.join(", "), defaultValue:`发现未绑定私钥，可选绑定：${importState.missing_keys.join(", ")}`})
    : tr("settings:import.parse_success", {count:importState.count, defaultValue:`解析成功：${importState.count} 个连接`}), importState.missing_keys.length?"info":"success");
}

async function uploadImportKeys(){
  const files=[...$("import_key_upload").files];
  if(!files.length) return notify(tr("settings:import.select_key_files", {defaultValue:"请选择密钥文件"}),"error");
  for(const f of files) await uploadOneKey(f);
  notify(tr("settings:import.keys_uploaded", {count:files.length, defaultValue:`已上传 ${files.length} 个密钥，请重新解析 config`}), "success");
}

function renderImport(results){
  if (!$("importResults")) return;
  const tunnels = importState.tunnels || [];
  const separator = tr("settings:import.item_separator", {defaultValue:"；"});
  $("importResults").innerHTML = tunnels.map((t,i)=>`<div class="panel"><div class="import-connection-head"><strong>${esc(t.name)}</strong><label>${esc(tr("settings:import.sort_label", {defaultValue:"排序"}))} <input type="number" min="1" max="2147483647" step="1" value="${Number(t.sort_order) || 1}" onchange="setImportSortOrder(${i},this.value)"></label></div><div class="cmd">${esc(t.ssh_user)}@${esc(t.ssh_host)}:${esc(t.ssh_port)}</div><div>${(t.forwards||[]).map(f=>`${esc(f.bind_host)}:${esc(f.bind_port)} -> ${esc(f.target_host)}:${esc(f.target_port)}`).join(esc(separator))}</div>${t.identity_name ? `<div class="identity-binding-summary"><span>${esc(tr("settings:import.original_key", {name:t.identity_name, defaultValue:`原密钥：${t.identity_name}`}))}</span><span class="${t.missing_identity ? "muted" : "success"}">${esc(t.missing_identity ? tr("settings:import.unbound_importable", {defaultValue:"未绑定（可直接导入）"}) : tr("settings:import.bound_key", {name:identityDisplayName(t.identity_file), defaultValue:`已绑定：${identityDisplayName(t.identity_file)}`}))}</span></div>` : ""}<div class="muted">${esc(results ? localizedTermaUiPhrase(results[i]?.output || tr("settings:import.test_ok", {defaultValue:"测试通过"})) : t.missing_identity ? tr("settings:import.no_identity_hint", {defaultValue:"未指定私钥，可稍后补充；使用前请确认默认 SSH 认证可用"}) : tr("settings:import.pending_test", {defaultValue:"待测试"}))}</div></div>`).join("") || "";
  const bindButton = $("bindImportKeysBtn");
  if (bindButton) {
    bindButton.hidden = !tunnels.some(item => item.identity_name);
    bindButton.textContent = tunnels.some(item => item.missing_identity)
      ? tr("settings:import.bind_optional", {defaultValue:"绑定私钥（可选）"})
      : tr("settings:import.adjust_binding", {defaultValue:"调整私钥绑定"});
  }
}

function clearImportState(){
  importState = {tunnels: [], missing_keys: []};
  if ($("config_upload")) $("config_upload").value = "";
  if ($("config_text")) $("config_text").value = "";
  if ($("import_key_upload")) $("import_key_upload").value = "";
  if ($("importResults")) $("importResults").innerHTML = "";
}

function importReady(){ if(!importState.tunnels?.length) throw new Error(tr("settings:import.parse_first", {defaultValue:"请先解析 config"})); }

async function batchTestImport(){
  const btn=$("batchTestBtn");
  try{
    importReady();
    setButtonBusy(btn,true,tr("settings:import.testing", {defaultValue:"测试中..."}));
    renderImport((importState.tunnels||[]).map(()=>({output:tr("settings:import.test_in_progress", {defaultValue:"正在测试..."})})));
    const r=await api("/api/import/test",{method:"POST",body:JSON.stringify({tunnels:importState.tunnels})});
    renderImport(r.results);
    notify(tr("settings:import.batch_test_complete", {ok:r.ok, failed:r.failed, defaultValue:`批量测试完成：成功 ${r.ok} 个，失败 ${r.failed} 个`}), r.failed?"error":"success");
  }catch(e){notify(localizedTermaUiPhrase(e.message),"error");} finally { setButtonBusy(btn,false); }
}

async function batchSaveImport(){
  const btn=$("batchSaveBtn");
  try{
    importReady();
    setButtonBusy(btn,true,tr("settings:import.saving", {defaultValue:"保存中..."}));
    const r=await api("/api/import/save",{method:"POST",body:JSON.stringify({tunnels:importState.tunnels})});
    await loadAll();
    if(!r.errors.length) clearImportState();
    notify(r.errors.length
      ? tr("settings:import.import_partial", {saved:r.saved, failed:r.errors.length, defaultValue:`成功导入 ${r.saved} 个连接，失败 ${r.errors.length} 个`})
      : tr("settings:import.import_complete", {saved:r.saved, defaultValue:`成功导入 ${r.saved} 个连接`}), r.errors.length?"error":"success");
  }catch(e){notify(localizedTermaUiPhrase(e.message),"error");} finally { setButtonBusy(btn,false); }
}

async function exportConfig(){
  const r=await api("/api/export/config",{method:"POST",body:JSON.stringify({ids:[]})});
  $("export_text").value=r.config;
  notify(tr("settings:import.config_generated", {defaultValue:"已生成 config"}), "success");
}

async function copyExport(){ await navigator.clipboard.writeText($("export_text").value); notify(tr("settings:import.copied", {defaultValue:"已复制"}), "success"); }

async function downloadDatabaseBackup() {
  const passwordChoice = await chooseModal(
    tr("settings:import.database_backup_title", {defaultValue:"下载数据库备份"}),
    tr("settings:import.database_backup_message", {defaultValue:"数据库备份可能包含 SSH 登录密码。请选择是否导出密码信息；不包含密码更适合日常备份和跨设备传输。"}),
    [
      {label:tr("settings:import.exclude_passwords", {defaultValue:"不包含密码（推荐）"}), value:"exclude", className:"primary"},
      {label:tr("settings:import.include_passwords", {defaultValue:"包含密码"}), value:"include", className:"danger"},
      {label:tr("common:actions.cancel", {defaultValue:"取消"}), value:"cancel"}
    ]
  );
  if (passwordChoice === "cancel") return;
  const includePasswords = passwordChoice === "include";
  const res = await fetch(`/api/backup/database?include_passwords=${includePasswords ? "1" : "0"}`);
  if (!res.ok) return notify((await apiErrorFromResponse(res, tr("settings:import.backup_failed", {defaultValue:"数据库备份下载失败"}))).message, "error");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terma-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  a.click();
  URL.revokeObjectURL(url);
  notify(includePasswords
    ? tr("settings:import.backup_with_passwords", {defaultValue:"数据库备份已下载（包含 SSH 密码）"})
    : tr("settings:import.backup_without_passwords", {defaultValue:"数据库备份已下载（不包含 SSH 密码）"}), "success");
}

function setImportSortOrder(index, value) {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1 || order > 2147483647) {
    importState.tunnels[index].sort_order = 1;
    renderImport();
    return notify(tr("settings:import.sort_invalid", {defaultValue:"排序值必须是大于等于 1 的整数"}), "error");
  }
  importState.tunnels[index].sort_order = order;
}

async function downloadBackupBundle() {
  if (!requireConfigEncryptionUnlocked(tr("settings:import.bundle_download_context", {defaultValue:"下载加密迁移包"}))) return;
  if (!await confirmModal(
    tr("settings:import.bundle_download_confirm", {defaultValue:"加密迁移包会包含数据库中的加密 SSH 凭据和解锁元数据，请妥善保管。继续下载？"}),
    tr("settings:import.bundle_download_title", {defaultValue:"下载加密迁移包"}),
    tr("settings:import.bundle_download_action", {defaultValue:"继续下载"}),
    tr("common:actions.cancel", {defaultValue:"取消"})
  )) return;
  const res = await fetch("/api/backup/bundle");
  if (!res.ok) return notify((await apiErrorFromResponse(res, tr("settings:import.bundle_download_failed", {defaultValue:"加密迁移包下载失败"}))).message, "error");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terma-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.termabackup`;
  a.click();
  URL.revokeObjectURL(url);
  notify(tr("settings:import.bundle_downloaded", {defaultValue:"加密迁移包已下载"}), "success");
}

function identityDisplayName(value) {
  const parts = String(value || "").replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || tr("connections:identity.unnamed_private_key", {defaultValue:"未命名私钥"});
}

async function loadIdentityBindingOptions() {
  const info = await api("/api/identity-files/info");
  return {items:Array.isArray(info?.items) ? info.items : [], upload_directory:String(info?.upload_directory || "")};
}

function showIdentityBindingModal(items, options={}) {
  const rows = (items || []).map((item, index) => ({...item, binding_id:String(item.binding_id ?? item.connection_id ?? index)}));
  return new Promise((resolve) => {
    const modal = $("modal");
    modal.onclick = null;
    const bindings = new Map(rows.filter(row => !row.missing_identity && row.identity_file).map(row => [row.binding_id, {path:row.identity_file, name:identityDisplayName(row.identity_file)}]));
    let identityInfo = {items:[], upload_directory:options.upload_directory || ""};
    modal.innerHTML = `<div class="modal-card wide restore-key-modal" role="dialog" aria-modal="true" aria-labelledby="restoreKeyModalTitle">
      <div class="restore-key-head"><div><h2 id="restoreKeyModalTitle">${esc(tr("connections:identity.bind_title", {defaultValue:"绑定连接私钥"}))}</h2><span>${esc(options.subtitle || tr("connections:identity.bind_subtitle", {defaultValue:"为待导入连接选择实际使用的私钥。"}))}</span></div><button id="restoreKeyClose" class="icon-button" type="button" title="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}" aria-label="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}">${icon("x")}</button></div>
      <p class="restore-key-intro">${esc(tr("connections:identity.bind_intro", {defaultValue:"私钥不要求与原文件同名。可为部分连接选择或上传私钥并暂存；未绑定的连接会保留为空，之后可在连接设置中补充。"}))}</p>
      <div class="identity-binding-source">
        <div><label for="identityBindingCandidate">${esc(tr("connections:identity.existing_private_key", {defaultValue:"已有私钥"}))}</label><select id="identityBindingCandidate"><option value="">${esc(tr("connections:identity.loading_private_keys", {defaultValue:"正在加载私钥..."}))}</option></select></div>
        <div><label>${esc(tr("connections:identity.upload_current_directory", {defaultValue:"上传私钥到当前密钥目录"}))}</label><div class="upload-line"><label class="file-picker"><input id="identityBindingUpload" type="file" accept="*/*" onchange="updateFilePicker(this)"><span class="file-picker-button">${esc(tr("common:auto.choose_file", {defaultValue:"选择文件"}))}</span><span class="file-picker-name" data-i18n="common:auto.not_selected">${esc(tr("common:auto.not_selected", {defaultValue:"未选择文件"}))}</span></label><button id="identityBindingUploadBtn" type="button">${esc(tr("connections:identity.upload", {defaultValue:"上传"}))}</button></div></div>
      </div>
      <div id="identityBindingDirectory" class="muted"></div>
      <div class="identity-binding-toolbar"><span>${esc(tr("connections:identity.select_bind_connections", {defaultValue:"选择要绑定的连接"}))}</span><div class="actions tight"><button id="identitySelectMatching" type="button">${esc(tr("connections:identity.select_original_name", {defaultValue:"选择原同名"}))}</button><button id="identitySelectAll" type="button">${esc(tr("connections:identity.select_all_unbound", {defaultValue:"全选未绑定"}))}</button><button id="identitySelectNone" type="button">${esc(tr("connections:identity.clear_selection", {defaultValue:"取消选择"}))}</button></div></div>
      <div id="identityBindingRows" class="identity-binding-rows">${rows.map(row => {
        const connectionName = row.connection_name || row.name || tr("connections:identity.connection_fallback", {id:row.binding_id, defaultValue:`连接 ${row.binding_id}`});
        return `<label class="identity-binding-row" data-binding-row="${escAttr(row.binding_id)}"><input type="checkbox" value="${escAttr(row.binding_id)}" aria-label="${escAttr(tr("connections:identity.checkbox_label", {name:connectionName, defaultValue:`选择 ${connectionName}`}))}"><span><strong>${esc(connectionName)}</strong><small>${esc(row.ssh_user || "")}@${esc(row.ssh_host || "")}:${esc(row.ssh_port || 22)}</small></span><span><small>${esc(tr("connections:identity.original_key", {defaultValue:"原密钥"}))}</small><code>${esc(row.key_name || identityDisplayName(row.old_path || row.identity_name))}</code></span><span class="identity-binding-result" data-binding-result="${escAttr(row.binding_id)}">${esc(tr("connections:identity.unbound", {defaultValue:"未绑定"}))}</span></label>`;
      }).join("")}</div>
      <div id="restoreKeyStatus" class="restore-key-status" role="status" aria-live="polite">${esc(tr("connections:identity.bind_status_hint", {defaultValue:"可选择私钥进行绑定，也可直接继续并保留未绑定连接。"}))}</div>
      <div class="actions"><button id="restoreKeyCancel">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="identityBindingTest" type="button">${esc(tr("connections:identity.test_selected", {defaultValue:"测试选中连接"}))}</button><button id="identityBindingStage" type="button">${esc(tr("connections:identity.stage_binding", {defaultValue:"暂存绑定"}))}</button><button id="identityBindingFinish" class="primary" type="button">${esc(options.finish_label || tr("common:actions.continue", {defaultValue:"继续"}))}</button></div>
    </div>`;
    modal.hidden = false;
    const status = $("restoreKeyStatus");
    const candidateSelect = $("identityBindingCandidate");
    const selectedRows = () => [...modal.querySelectorAll("#identityBindingRows input:checked")].map(input => rows.find(row => row.binding_id === input.value)).filter(Boolean);
    const currentCandidate = () => identityInfo.items.find(item => item.path === candidateSelect.value);
    const refreshCandidates = (selectedPath="") => {
      candidateSelect.replaceChildren(
        new Option(tr("connections:identity.select", {defaultValue:"选择私钥"}), ""),
        ...identityInfo.items.map(item => new Option(localizedIdentityFileLabel(item, {permission:true}), String(item.path || "")))
      );
      if (selectedPath) candidateSelect.value = selectedPath;
      $("identityBindingDirectory").textContent = identityInfo.upload_directory
        ? tr("connections:identity.upload_directory", {path:identityInfo.upload_directory, defaultValue:`上传目标目录：${identityInfo.upload_directory}`})
        : tr("connections:identity.upload_directory_hint", {defaultValue:"上传后会保存到当前设置使用的密钥目录。"});
    };
    const finish = (result) => {
      modal.hidden = true;
      modal.onclick = null;
      modal.innerHTML = "";
      resolve(result);
    };
    const setStatus = (text, type="") => {
      status.className = `restore-key-status ${type}`.trim();
      status.textContent = text;
    };
    const renderBindings = () => {
      for (const row of rows) {
        const result = modal.querySelector(`[data-binding-result="${CSS.escape(row.binding_id)}"]`);
        const binding = bindings.get(row.binding_id);
        result.textContent = binding
          ? tr("connections:identity.staged", {name:binding.name, defaultValue:`已暂存：${binding.name}`})
          : tr("connections:identity.unbound", {defaultValue:"未绑定"});
        result.className = `identity-binding-result ${binding ? "success" : ""}`;
      }
    };
    renderBindings();
    const requireSelection = () => {
      const candidate = currentCandidate();
      const selected = selectedRows();
      if (!candidate) throw new Error(tr("connections:identity.select_or_upload", {defaultValue:"请先选择或上传一把私钥"}));
      if (!selected.length) throw new Error(tr("connections:identity.select_connection", {defaultValue:"请勾选至少一个连接"}));
      return {candidate, selected};
    };
    $("identityBindingUploadBtn").onclick = async () => {
      const input = $("identityBindingUpload");
      const file = input.files?.[0];
      if (!file) return setStatus(tr("connections:identity.select_upload_key", {defaultValue:"请选择要上传的私钥"}), "error");
      try {
        setStatus(tr("connections:identity.uploading", {name:file.name, defaultValue:`正在上传 ${file.name}...`}), "busy");
        const uploaded = await uploadOneKey(file);
        identityInfo = await loadIdentityBindingOptions();
        refreshCandidates(uploaded.path);
        setStatus(tr("connections:identity.uploaded_bind", {name:localizedIdentityFileLabel(uploaded, {permission:true}), defaultValue:`已上传 ${localizedIdentityFileLabel(uploaded, {permission:true})}，可勾选连接进行绑定。`}), "success");
      } catch (error) {
        setStatus(tr("connections:identity.upload_failed", {error:localizedTermaUiPhrase(error.message || tr("settings:import.unknown_error", {defaultValue:"未知错误"})), defaultValue:`上传失败：${error.message || "未知错误"}`}), "error");
      }
    };
    $("identitySelectMatching").onclick = () => {
      const candidate = currentCandidate();
      if (!candidate) return setStatus(tr("connections:identity.select_key_first", {defaultValue:"请先选择一把私钥"}), "error");
      modal.querySelectorAll("#identityBindingRows input").forEach(input => {
        const row = rows.find(item => item.binding_id === input.value);
        input.checked = identityDisplayName(row?.key_name || row?.old_path || row?.identity_name) === candidate.name;
      });
    };
    $("identitySelectAll").onclick = () => modal.querySelectorAll("#identityBindingRows input").forEach(input => { input.checked = !bindings.has(input.value); });
    $("identitySelectNone").onclick = () => modal.querySelectorAll("#identityBindingRows input").forEach(input => { input.checked = false; });
    $("identityBindingTest").onclick = async () => {
      try {
        const {candidate, selected} = requireSelection();
        setStatus(tr("connections:identity.testing_connections", {count:selected.length, defaultValue:`正在测试 ${selected.length} 个连接...`}), "busy");
        const tunnels = selected.map(row => ({...row, identity_file:candidate.path, missing_identity:false, extra_args:/^(?:tdenc|termaenc):v1:/.test(String(row.extra_args || "")) ? "" : row.extra_args || ""}));
        const response = await api("/api/import/test", {method:"POST", body:JSON.stringify({tunnels})});
        response.results.forEach((result, index) => {
          const target = modal.querySelector(`[data-binding-result="${CSS.escape(selected[index].binding_id)}"]`);
          target.textContent = result.ok
            ? tr("connections:identity.test_success", {defaultValue:"测试成功"})
            : tr("connections:identity.test_failed", {error:localizedTermaUiPhrase(result.output || tr("connections:identity.connection_failed", {defaultValue:"连接失败"})), defaultValue:`测试失败：${result.output || "连接失败"}`});
          target.className = `identity-binding-result ${result.ok ? "success" : "error"}`;
        });
        setStatus(tr("connections:identity.test_complete", {ok:response.ok, failed:response.failed, defaultValue:`测试完成：成功 ${response.ok} 个，失败 ${response.failed} 个。`}), response.failed ? "error" : "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("identityBindingStage").onclick = () => {
      try {
        const {candidate, selected} = requireSelection();
        selected.forEach(row => bindings.set(row.binding_id, candidate));
        renderBindings();
        modal.querySelectorAll("#identityBindingRows input:checked").forEach(input => { input.checked = false; });
        setStatus(tr("connections:identity.bindings_staged", {count:selected.length, defaultValue:`已暂存 ${selected.length} 个连接的绑定，可继续选择下一把私钥。`}), "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("identityBindingFinish").onclick = () => {
      finish(rows.filter(row => bindings.has(row.binding_id)).map(row => ({connection_id:Number(row.connection_id || row.binding_id), binding_id:row.binding_id, identity_path:bindings.get(row.binding_id).path, identity_name:bindings.get(row.binding_id).name})));
    };
    $("restoreKeyCancel").onclick = () => finish(null);
    $("restoreKeyClose").onclick = () => finish(null);
    loadIdentityBindingOptions().then(info => { identityInfo=info; refreshCandidates(); }).catch(error => setStatus(localizedTermaUiPhrase(error.message || tr("connections:identity.list_load_failed", {defaultValue:"私钥列表加载失败"})), "error"));
  });
}

function showDatabaseCredentialModal(items, options={}) {
  const rows = (items || []).map((item, index) => ({...item, binding_id:String(item.connection_id ?? index)}));
  return new Promise((resolve) => {
    const modal = $("modal");
    modal.onclick = null;
    const staged = new Map(rows.filter(row => row.original_auth_type === "password").map(row => [row.binding_id, {
      connection_id:Number(row.connection_id),
      auth_type:"password",
      password_action:row.has_password ? "preserve" : "clear"
    }]));
    let identityInfo = {items:[], upload_directory:options.upload_directory || ""};
    const originalCredential = row => row.original_auth_type === "password"
      ? row.has_password
        ? row.password_encrypted
          ? tr("connections:identity.password_encrypted", {defaultValue:"密码登录（含加密密码）"})
          : tr("connections:identity.password_in_backup", {defaultValue:"密码登录（备份含密码）"})
        : tr("connections:identity.password_not_in_backup", {defaultValue:"密码登录（备份未包含密码）"})
      : row.identity_encrypted
        ? tr("connections:identity.encrypted_key_path", {defaultValue:"私钥登录（路径已加密）"})
        : tr("connections:identity.private_key", {name:row.key_name || tr("connections:identity.not_recorded", {defaultValue:"未记录"}), defaultValue:`私钥：${row.key_name || "未记录"}`});
    modal.innerHTML = `<div class="modal-card wide restore-key-modal restore-credential-modal" role="dialog" aria-modal="true" aria-labelledby="restoreKeyModalTitle">
      <div class="restore-key-head"><div><h2 id="restoreKeyModalTitle">${esc(tr("connections:identity.restore_title", {defaultValue:"恢复连接凭据"}))}</h2><span>${esc(options.subtitle || tr("connections:identity.restore_subtitle", {defaultValue:"确认备份中每个连接原来的验证方式，并按需重新设置凭据。"}))}</span></div><button id="restoreKeyClose" class="icon-button" type="button" title="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}" aria-label="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}">${icon("x")}</button></div>
      <p class="restore-key-intro">${esc(tr("connections:identity.restore_intro", {defaultValue:"所有连接都会列在下方。可为选中连接绑定私钥或设置新密码；未重新绑定的普通私钥路径会被清除，备份中已有的密码默认保留。"}))}</p>
      <div class="credential-binding-source">
        <div><label for="identityBindingCandidate">${esc(tr("connections:identity.existing_private_key", {defaultValue:"已有私钥"}))}</label><select id="identityBindingCandidate"><option value="">${esc(tr("connections:identity.loading_private_keys", {defaultValue:"正在加载私钥..."}))}</option></select></div>
        <div><label>${esc(tr("connections:identity.upload_private_key", {defaultValue:"上传私钥"}))}</label><div class="upload-line"><label class="file-picker"><input id="identityBindingUpload" type="file" accept="*/*" onchange="updateFilePicker(this)"><span class="file-picker-button">${esc(tr("common:auto.choose_file", {defaultValue:"选择文件"}))}</span><span class="file-picker-name" data-i18n="common:auto.not_selected">${esc(tr("common:auto.not_selected", {defaultValue:"未选择文件"}))}</span></label><button id="identityBindingUploadBtn" type="button">${esc(tr("connections:identity.upload", {defaultValue:"上传"}))}</button></div></div>
        <div><label for="credentialPassword">${esc(tr("connections:identity.set_new_password", {defaultValue:"设置新 SSH 密码"}))}</label><input id="credentialPassword" type="password" autocomplete="new-password" placeholder="${escAttr(tr("connections:identity.password_placeholder", {defaultValue:"输入后应用到选中连接"}))}" ${options.password_replacement_allowed === false ? "disabled" : ""}></div>
      </div>
      <div id="identityBindingDirectory" class="muted"></div>
      <div class="identity-binding-toolbar"><span>${esc(tr("connections:identity.select_credentials_connections", {defaultValue:"选择要设置凭据的连接"}))}</span><div class="actions tight"><button id="identitySelectMatching" type="button">${esc(tr("connections:identity.select_original_name", {defaultValue:"选择原同名"}))}</button><button id="identitySelectAll" type="button">${esc(tr("connections:identity.select_all", {defaultValue:"全选"}))}</button><button id="identitySelectNone" type="button">${esc(tr("connections:identity.clear_selection", {defaultValue:"取消选择"}))}</button></div></div>
      <div id="identityBindingRows" class="identity-binding-rows">${rows.map(row => {
        const connectionName = row.connection_name || tr("connections:identity.connection_fallback", {id:row.binding_id, defaultValue:`连接 ${row.binding_id}`});
        return `<div class="identity-binding-row" data-binding-row="${escAttr(row.binding_id)}"><input type="checkbox" value="${escAttr(row.binding_id)}" aria-label="${escAttr(tr("connections:identity.checkbox_label", {name:connectionName, defaultValue:`选择 ${connectionName}`}))}"><span><strong>${esc(connectionName)}</strong><small>${esc(row.ssh_user || "")}@${esc(row.ssh_host || "")}:${esc(row.ssh_port || 22)}</small></span><span><small>${esc(tr("connections:identity.original_auth", {defaultValue:"原验证方式"}))}</small><code>${esc(originalCredential(row))}</code></span><span class="restore-sort-field"><small>${esc(tr("connections:identity.sort", {defaultValue:"排序"}))}</small><input data-restore-sort="${escAttr(row.binding_id)}" aria-label="${escAttr(tr("connections:identity.sort_aria", {name:connectionName, defaultValue:`${connectionName} 排序`}))}" type="number" min="1" max="2147483647" step="1" value="${Number(row.sort_order) || 1}"></span><span class="identity-binding-result" data-binding-result="${escAttr(row.binding_id)}"></span></div>`;
      }).join("") || `<div class="restore-credential-empty">${esc(tr("connections:identity.no_connections", {defaultValue:"该数据库没有 SSH 连接，可直接继续恢复。"}))}</div>`}</div>
      <div id="restoreKeyStatus" class="restore-key-status" role="status" aria-live="polite">${esc(options.password_replacement_allowed === false ? tr("connections:identity.password_locked_hint", {defaultValue:"加密迁移包恢复前不能改写密码；恢复并解锁后可在连接设置中修改。"}) : tr("connections:identity.credential_status_hint", {defaultValue:"请选择连接后绑定私钥或设置密码，也可保留当前提示状态继续恢复。"}))}</div>
      <div class="actions credential-binding-actions"><button id="restoreKeyCancel">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="identityBindingTest" type="button">${esc(tr("connections:identity.test_selected", {defaultValue:"测试选中连接"}))}</button><button id="credentialClearSelected" type="button">${esc(tr("connections:identity.clear_selected_credentials", {defaultValue:"清除选中凭据"}))}</button><button id="identityBindingStage" type="button">${esc(tr("connections:identity.bind_selected_key", {defaultValue:"绑定所选私钥"}))}</button><button id="credentialPasswordStage" type="button" ${options.password_replacement_allowed === false ? "disabled" : ""}>${esc(tr("connections:identity.set_entered_password", {defaultValue:"设置所填密码"}))}</button><button id="identityBindingFinish" class="primary" type="button">${esc(tr("connections:identity.continue_restore", {defaultValue:"继续恢复"}))}</button></div>
    </div>`;
    modal.hidden = false;
    enhancePasswordInputs(modal);
    const status = $("restoreKeyStatus");
    const candidateSelect = $("identityBindingCandidate");
    const passwordInput = $("credentialPassword");
    const selectedRows = () => [...modal.querySelectorAll('#identityBindingRows input[type="checkbox"]:checked')].map(input => rows.find(row => row.binding_id === input.value)).filter(Boolean);
    const currentCandidate = () => identityInfo.items.find(item => item.path === candidateSelect.value);
    const finish = result => {
      modal.hidden = true;
      modal.onclick = null;
      modal.innerHTML = "";
      resolve(result);
    };
    const setStatus = (text, type="") => {
      status.className = `restore-key-status ${type}`.trim();
      status.textContent = text;
    };
    const bindingLabel = row => {
      const binding = staged.get(row.binding_id);
      if (binding?.auth_type === "key") return tr("connections:identity.will_bind", {name:identityDisplayName(binding.identity_path), defaultValue:`将绑定：${identityDisplayName(binding.identity_path)}`});
      if (binding?.password_action === "replace") return tr("connections:identity.will_use_new_password", {defaultValue:"将使用新密码"});
      if (binding?.password_action === "preserve") return row.password_encrypted
        ? tr("connections:identity.preserve_encrypted_password", {defaultValue:"保留备份中的加密密码"})
        : tr("connections:identity.preserve_password", {defaultValue:"保留备份密码"});
      if (binding?.password_action === "clear") return tr("connections:identity.password_not_set", {defaultValue:"密码未设置"});
      if (row.identity_encrypted) return tr("connections:identity.preserve_encrypted_key", {defaultValue:"保留加密私钥路径"});
      return tr("connections:identity.key_unbound", {defaultValue:"私钥未绑定"});
    };
    const renderBindings = () => rows.forEach(row => {
      const result = modal.querySelector(`[data-binding-result="${CSS.escape(row.binding_id)}"]`);
      if (!result) return;
      const binding = staged.get(row.binding_id);
      result.textContent = bindingLabel(row);
      result.className = `identity-binding-result ${binding?.identity_path || binding?.password_action === "replace" || binding?.password_action === "preserve" || row.identity_encrypted ? "success" : ""}`;
    });
    const requireRows = () => {
      const selected = selectedRows();
      if (!selected.length) throw new Error(tr("connections:identity.select_connection", {defaultValue:"请勾选至少一个连接"}));
      return selected;
    };
    const refreshCandidates = (selectedPath="") => {
      candidateSelect.replaceChildren(
        new Option(tr("connections:identity.select", {defaultValue:"选择私钥"}), ""),
        ...identityInfo.items.map(item => new Option(localizedIdentityFileLabel(item, {permission:true}), String(item.path || "")))
      );
      if (selectedPath) candidateSelect.value = selectedPath;
      $("identityBindingDirectory").textContent = identityInfo.upload_directory
        ? tr("connections:identity.upload_directory", {path:identityInfo.upload_directory, defaultValue:`上传目标目录：${identityInfo.upload_directory}`})
        : tr("connections:identity.upload_directory_hint", {defaultValue:"上传后会保存到当前设置使用的密钥目录。"});
    };
    renderBindings();
    $("identityBindingUploadBtn").onclick = async () => {
      const file = $("identityBindingUpload").files?.[0];
      if (!file) return setStatus(tr("connections:identity.select_upload_key", {defaultValue:"请选择要上传的私钥"}), "error");
      try {
        setStatus(tr("connections:identity.uploading", {name:file.name, defaultValue:`正在上传 ${file.name}...`}), "busy");
        const uploaded = await uploadOneKey(file);
        identityInfo = await loadIdentityBindingOptions();
        refreshCandidates(uploaded.path);
        setStatus(tr("connections:identity.uploaded_apply", {name:localizedIdentityFileLabel(uploaded, {permission:true}), defaultValue:`已上传 ${localizedIdentityFileLabel(uploaded, {permission:true})}，可应用到选中连接。`}), "success");
      } catch (error) {
        setStatus(tr("connections:identity.upload_failed", {error:localizedTermaUiPhrase(error.message || tr("settings:import.unknown_error", {defaultValue:"未知错误"})), defaultValue:`上传失败：${error.message || "未知错误"}`}), "error");
      }
    };
    $("identitySelectMatching").onclick = () => {
      const candidate = currentCandidate();
      if (!candidate) return setStatus(tr("connections:identity.select_key_first", {defaultValue:"请先选择一把私钥"}), "error");
      modal.querySelectorAll('#identityBindingRows input[type="checkbox"]').forEach(input => {
        const row = rows.find(item => item.binding_id === input.value);
        input.checked = row?.original_auth_type === "key" && row.key_name === candidate.name;
      });
    };
    $("identitySelectAll").onclick = () => modal.querySelectorAll('#identityBindingRows input[type="checkbox"]').forEach(input => { input.checked = true; });
    $("identitySelectNone").onclick = () => modal.querySelectorAll('#identityBindingRows input[type="checkbox"]').forEach(input => { input.checked = false; });
    $("identityBindingStage").onclick = () => {
      try {
        const candidate = currentCandidate();
        if (!candidate) throw new Error(tr("connections:identity.select_or_upload", {defaultValue:"请先选择或上传一把私钥"}));
        const selected = requireRows();
        selected.forEach(row => staged.set(row.binding_id, {connection_id:Number(row.connection_id), auth_type:"key", identity_path:candidate.path}));
        renderBindings();
        setStatus(tr("connections:identity.key_bindings_staged", {count:selected.length, defaultValue:`已为 ${selected.length} 个连接暂存私钥绑定。`}), "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("credentialPasswordStage").onclick = () => {
      try {
        const password = passwordInput.value;
        if (!password) throw new Error(tr("connections:identity.enter_password_first", {defaultValue:"请先输入新 SSH 密码"}));
        const selected = requireRows();
        selected.forEach(row => staged.set(row.binding_id, {connection_id:Number(row.connection_id), auth_type:"password", password_action:"replace", password}));
        passwordInput.value = "";
        renderBindings();
        setStatus(tr("connections:identity.passwords_staged", {count:selected.length, defaultValue:`已为 ${selected.length} 个连接暂存新密码。`}), "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("credentialClearSelected").onclick = () => {
      try {
        const selected = requireRows();
        selected.forEach(row => {
          const current = staged.get(row.binding_id);
          if (current?.auth_type === "password" || row.original_auth_type === "password") staged.set(row.binding_id, {connection_id:Number(row.connection_id), auth_type:"password", password_action:"clear"});
          else staged.delete(row.binding_id);
        });
        renderBindings();
        setStatus(tr("connections:identity.credentials_cleared", {count:selected.length, defaultValue:`已清除 ${selected.length} 个连接暂存的凭据。`}), "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("identityBindingTest").onclick = async () => {
      try {
        const selected = requireRows();
        const tunnels = selected.map(row => {
          const binding = staged.get(row.binding_id);
          if (binding?.auth_type === "key" && binding.identity_path) return {...row, auth_type:"key", identity_file:binding.identity_path, ssh_password:"", missing_identity:false};
          if (binding?.auth_type === "password" && binding.password_action === "replace") return {...row, auth_type:"password", identity_file:"", ssh_password:binding.password, missing_identity:false};
          throw new Error(tr("connections:identity.test_requires_credentials", {name:row.connection_name, defaultValue:`连接 ${row.connection_name} 需要先暂存可测试的新私钥或新密码`}));
        });
        setStatus(tr("connections:identity.testing_connections", {count:tunnels.length, defaultValue:`正在测试 ${tunnels.length} 个连接...`}), "busy");
        const response = await api("/api/import/test", {method:"POST", body:JSON.stringify({tunnels})});
        response.results.forEach((result, index) => {
          const target = modal.querySelector(`[data-binding-result="${CSS.escape(selected[index].binding_id)}"]`);
          target.textContent = result.ok
            ? tr("connections:identity.test_success", {defaultValue:"测试成功"})
            : tr("connections:identity.test_failed", {error:localizedTermaUiPhrase(result.output || tr("connections:identity.connection_failed", {defaultValue:"连接失败"})), defaultValue:`测试失败：${result.output || "连接失败"}`});
          target.className = `identity-binding-result ${result.ok ? "success" : "error"}`;
        });
        setStatus(tr("connections:identity.test_complete", {ok:response.ok, failed:response.failed, defaultValue:`测试完成：成功 ${response.ok} 个，失败 ${response.failed} 个。`}), response.failed ? "error" : "success");
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("identityBindingFinish").onclick = () => {
      try {
        const result = rows.map(row => {
          const input = modal.querySelector(`[data-restore-sort="${CSS.escape(row.binding_id)}"]`);
          const sortOrder = Number(input?.value || 1);
          if (!Number.isInteger(sortOrder) || sortOrder < 1 || sortOrder > 2147483647) {
            const name = row.connection_name || row.connection_id;
            throw new Error(tr("connections:identity.sort_invalid", {name, defaultValue:`连接 ${name} 的排序值无效`}));
          }
          return {...(staged.get(row.binding_id) || {connection_id:Number(row.connection_id)}), sort_order:sortOrder};
        });
        finish(result);
      } catch (error) { setStatus(localizedTermaUiPhrase(error.message), "error"); }
    };
    $("restoreKeyCancel").onclick = () => finish(null);
    $("restoreKeyClose").onclick = () => finish(null);
    loadIdentityBindingOptions().then(info => { identityInfo=info; refreshCandidates(); }).catch(error => setStatus(localizedTermaUiPhrase(error.message || tr("connections:identity.list_load_failed", {defaultValue:"私钥列表加载失败"})), "error"));
  });
}

async function bindImportIdentities() {
  const items = (importState.tunnels || []).map((tunnel, index) => ({...tunnel, binding_id:String(index), connection_id:index + 1})).filter(item => item.identity_name);
  if (!items.length) return notify(tr("settings:import.no_identity_references", {defaultValue:"当前 SSH config 没有引用私钥"}), "success");
  const bindings = await showIdentityBindingModal(items, {
    subtitle:tr("settings:import.bind_import_subtitle", {defaultValue:"可为 SSH config 中的连接指定私钥；未绑定连接仍可导入。"}),
    finish_label:tr("settings:import.continue_import", {defaultValue:"继续导入"})
  });
  if (!bindings) return;
  for (const binding of bindings) {
    const tunnel = importState.tunnels[Number(binding.binding_id)];
    if (!tunnel) continue;
    tunnel.identity_file = binding.identity_path;
    tunnel.missing_identity = false;
  }
  importState.missing_keys = [...new Set(importState.tunnels.filter(item => item.missing_identity).map(item => item.identity_name))];
  renderImport();
  const remaining = importState.tunnels.filter(item => item.missing_identity).length;
  notify(remaining
    ? tr("settings:import.bindings_staged_with_remaining", {count:bindings.length, remaining, defaultValue:`已暂存 ${bindings.length} 个私钥绑定，${remaining} 个连接保持未绑定`})
    : tr("settings:import.bindings_staged", {count:bindings.length, defaultValue:`已暂存 ${bindings.length} 个私钥绑定`}), remaining ? "info" : "success");
}

async function inspectDatabaseBackup(file) {
  const response = await fetch("/api/restore/database/check", {
    method:"POST",
    headers:{"Content-Type":"application/octet-stream", "X-Terma-Filename":encodeURIComponent(file.name || "backup.db")},
    body:file
  });
  if (!response.ok) throw await apiErrorFromResponse(response, tr("settings:import.database_check_failed", {defaultValue:"数据库检查失败"}));
  const result = await response.json().catch(()=>({error:tr("settings:import.database_check_failed", {defaultValue:"数据库检查失败"})}));
  return result;
}

async function restoreDatabaseBackup() {
  if (!requireConfigEncryptionUnlocked(tr("settings:import.database_restore_context", {defaultValue:"恢复数据库"}))) return;
  const file = $("db_restore_upload")?.files?.[0];
  if (!file) return notify(tr("settings:import.select_database_backup", {defaultValue:"请选择数据库备份文件"}), "error");
  let credentialBindings = [];
  let check;
  try {
    check = await inspectDatabaseBackup(file);
    const selected = await showDatabaseCredentialModal(check.connections || [], {
      subtitle:tr("settings:import.credential_restore_subtitle", {defaultValue:"请确认每个连接原来的验证方式；可重新绑定私钥、保留备份密码或设置新密码。"}),
      upload_directory:check.upload_directory,
      password_replacement_allowed:check.password_replacement_allowed
    });
    if (!selected) {
      await api("/api/restore/database/stage", {method:"DELETE", body:JSON.stringify({restore_token:check.restore_token})}).catch(()=>{});
      return;
    }
    credentialBindings = selected;
  } catch (error) {
    return notify(localizedTermaUiPhrase(error.message || tr("settings:import.database_check_failed", {defaultValue:"数据库检查失败"})), "error");
  }
  const encryptedText = check.encrypted_bundle
    ? `\n\n${tr("settings:import.encrypted_bundle_warning", {defaultValue:"该备份包含配置加密元数据，恢复后需要使用原主密码解锁加密配置。"})}`
    : "";
  const encryptedWithoutMetadata = !check.encrypted_bundle && (check.connections || []).some(item => item.identity_encrypted || item.password_encrypted)
    ? `\n\n${tr("settings:import.encrypted_without_metadata_warning", {defaultValue:"检测到已加密凭据，但普通 .db 不包含解锁元数据；跨设备恢复应改用原设备导出的加密迁移包。"})}`
    : "";
  const unboundCount = check.unresolved_identities?.length || 0;
  const unboundText = unboundCount
    ? `\n\n${tr("settings:import.unbound_warning", {count:unboundCount, defaultValue:`${unboundCount} 个连接将不绑定私钥，旧机器上的私钥路径会被清除；之后可在连接设置中补充。`})}`
    : "";
  const restoreMessage = `${tr("settings:import.database_restore_confirm", {defaultValue:"恢复数据库会覆盖当前连接配置，建议先下载备份。继续？"})}${unboundText}${encryptedText}${encryptedWithoutMetadata}`;
  if (!await confirmModal(
    restoreMessage,
    tr("settings:import.database_restore_title", {defaultValue:"恢复数据库"}),
    tr("settings:import.database_restore_action", {defaultValue:"继续恢复"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) {
    await api("/api/restore/database/stage", {method:"DELETE", body:JSON.stringify({restore_token:check.restore_token})}).catch(()=>{});
    return;
  }
  const res = await fetch("/api/restore/database", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({restore_token:check.restore_token, credential_bindings:credentialBindings})});
  if (!res.ok) return notify((await apiErrorFromResponse(res, tr("settings:import.restore_failed", {defaultValue:"恢复失败"}))).message, "error");
  const body = await res.json().catch(()=>({error:tr("settings:import.restore_failed", {defaultValue:"恢复失败"})}));
  const restoredUnbound = body.unresolved_identities?.length || 0;
  const suffix = restoredUnbound
    ? tr("settings:import.restored_unbound_suffix", {count:restoredUnbound, defaultValue:`；${restoredUnbound} 个连接保持未绑定`})
    : "";
  await loadAll();
  if ($("db_restore_upload")) $("db_restore_upload").value = "";
  renderImport();
  notify(body.encrypted_bundle
    ? tr("settings:import.bundle_restored", {suffix, defaultValue:`加密迁移包已恢复并刷新，请用原主密码解锁${suffix}`})
    : tr("settings:import.database_restored", {suffix, defaultValue:`数据库已恢复并自动刷新${suffix}`}), "success");
}
