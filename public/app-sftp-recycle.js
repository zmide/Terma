function closeSftpRecycleBin() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
  sftpRecycleBinConnectionId = 0;
}

function sftpRecycleIconHtml(item) {
  const type = String(item?.type || "file").toLowerCase() === "dir" ? "dir" : "file";
  const name = String(item?.name || item?.original_path || "");
  const kind = type === "dir"
    ? "dir"
    : (typeof sftpFileKind === "function" ? sftpFileKind(name) : "file");
  const markup = typeof sftpIcon === "function"
    ? sftpIcon(name, type === "dir")
    : icon(type === "dir" ? "folder" : "file");
  return `<span class="sftp-icon sftp-recycle-icon ${escAttr(kind)}" data-item-type="${type}">${markup}</span>`;
}

function sftpRecycleItemHtml(connectionId, item) {
  const deletedAt = item.deleted_at
    ? new Date(item.deleted_at).toLocaleString(document.documentElement.lang || undefined)
    : tr("sftp:recycle_bin.unknown_time", {defaultValue:"时间未知"});
  const storage = item.storage === "tunneldesk" ? "tunneldesk" : "terma";
  const legacy = storage === "tunneldesk" ? tr("sftp:recycle_bin.legacy_suffix", {defaultValue:" · 旧版数据"}) : "";
  const deletedText = tr("sftp:recycle_bin.deleted_at", {date:deletedAt, legacy, defaultValue:`删除于 ${deletedAt}${legacy}`});
  const restore = tr("sftp:recycle_bin.restore", {defaultValue:"恢复"});
  const permanentDelete = tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"});
  const idArg = sftpTaskInlineArgument(item.id);
  const nameArg = sftpTaskInlineArgument(item.name || item.original_path);
  const storageArg = sftpTaskInlineArgument(storage);
  return `<div class="sftp-recycle-item">${sftpRecycleIconHtml(item)}<div data-i18n-skip><strong title="${escAttr(item.original_path)}">${esc(item.name || item.original_path)}</strong><span>${esc(item.original_path)}</span><small>${esc(deletedText)}</small></div><div class="actions tight"><button type="button" title="${escAttr(restore)}" aria-label="${escAttr(restore)}" onclick="restoreSftpRecycleItem(${Number(connectionId)},${idArg},${storageArg})">${icon("undo-2")}<span>${esc(restore)}</span></button><button class="danger" type="button" title="${escAttr(permanentDelete)}" aria-label="${escAttr(permanentDelete)}" onclick="deleteSftpRecycleItem(${Number(connectionId)},${idArg},${nameArg},${storageArg})">${icon("trash-2")}<span>${esc(permanentDelete)}</span></button></div></div>`;
}

async function openSftpRecycleBin(tabKey=activeTabKey, connectionIdOverride=0, pageOverride=null) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const connectionId = Number(connectionIdOverride || tab?.id || runtime?.state.connectionId || sftpRecycleBinConnectionId);
  if (!connectionId) return;
  sftpRecycleBinConnectionId = connectionId;
  if (pageOverride !== null && Number.isFinite(Number(pageOverride))) sftpRecycleBinPage = Math.max(1, Math.trunc(Number(pageOverride)));
  const modal = $("modal");
  modal.onclick = null;
  const close = tr("common:actions.close", {defaultValue:"关闭"});
  const clear = tr("sftp:recycle_bin.clear", {defaultValue:"清空回收站"});
  modal.innerHTML = `<div class="modal-card wide sftp-recycle-modal" role="dialog" aria-modal="true" aria-labelledby="sftpRecycleTitle"><div class="sftp-modal-head"><div><h2 id="sftpRecycleTitle">${esc(tr("sftp:recycle_bin.title", {defaultValue:"SFTP 回收站"}))}</h2><span id="sftpRecycleSummary">${esc(tr("sftp:recycle_bin.loading_remote", {defaultValue:"正在读取远端回收站"}))}</span></div><button class="icon-button" type="button" title="${escAttr(close)}" aria-label="${escAttr(close)}" onclick="closeSftpRecycleBin()">${icon("x")}</button></div><div id="sftpRecycleList" class="sftp-recycle-list">${stateView("loading", tr("sftp:recycle_bin.loading", {defaultValue:"正在读取回收站"}))}</div><div class="actions"><button id="sftpRecycleClear" class="danger" type="button" title="${escAttr(clear)}" aria-label="${escAttr(clear)}" hidden onclick="clearSftpRecycleBin(${connectionId})">${icon("trash-2")}<span>${esc(clear)}</span></button><button type="button" onclick="closeSftpRecycleBin()">${esc(close)}</button></div></div>`;
  modal.hidden = false;
  try {
    const data = await api(`/api/connections/${connectionId}/sftp/trash?page=${encodeURIComponent(sftpRecycleBinPage)}&page_size=${SFTP_RECYCLE_BIN_PAGE_SIZE}`);
    if (sftpRecycleBinConnectionId !== connectionId || !$("sftpRecycleList")) return;
    const items = Array.isArray(data.items) ? data.items : [];
    sftpRecycleBinPage = Number(data.page || sftpRecycleBinPage || 1);
    const total = Number(data.total || 0);
    const totalPages = Math.max(1, Number(data.total_pages || 1));
    const state = data.enabled
      ? tr("sftp:recycle_bin.enabled", {defaultValue:"已开启"})
      : tr("sftp:recycle_bin.disabled", {defaultValue:"当前关闭"});
    $("sftpRecycleSummary").textContent = tr("sftp:recycle_bin.summary", {state, count:total, defaultValue:`${state} · ${total} 个项目`});
    const pager = totalPages > 1
      ? `<div class="pager sftp-recycle-pager"><button type="button" onclick="setSftpRecycleBinPage(${sftpRecycleBinPage - 1})" ${sftpRecycleBinPage <= 1 ? "disabled" : ""}>${esc(tr("common:auto.previous_page", {defaultValue:"上一页"}))}</button><span class="pager-count">${esc(tr("common:auto.page_of", {page:sftpRecycleBinPage, pages:totalPages, defaultValue:`${sftpRecycleBinPage}/${totalPages}`}))}</span><button type="button" onclick="setSftpRecycleBinPage(${sftpRecycleBinPage + 1})" ${sftpRecycleBinPage >= totalPages ? "disabled" : ""}>${esc(tr("common:auto.next_page", {defaultValue:"下一页"}))}</button></div>`
      : "";
    $("sftpRecycleList").innerHTML = items.length
      ? items.map(item => sftpRecycleItemHtml(connectionId, item)).join("") + pager
      : stateView("empty", tr("sftp:recycle_bin.empty", {defaultValue:"回收站为空"}), data.enabled
        ? tr("sftp:recycle_bin.empty_enabled_hint", {defaultValue:"删除的远程项目会保存在这里。"})
        : tr("sftp:recycle_bin.empty_disabled_hint", {defaultValue:"可在 SFTP 页面右上角的全局设置中开启回收站。"}));
    $("sftpRecycleClear").hidden = !items.length;
  } catch (error) {
    if ($("sftpRecycleList")) $("sftpRecycleList").innerHTML = stateView("error", tr("sftp:recycle_bin.load_failed", {defaultValue:"回收站读取失败"}), error.message, `<button onclick="openSftpRecycleBin(${sftpTaskInlineArgument(tabKey)})">${esc(tr("common:actions.retry", {defaultValue:"重试"}))}</button>`);
  }
}

function setSftpRecycleBinPage(page) {
  const target = Math.max(1, Math.trunc(Number(page) || 1));
  if (!sftpRecycleBinConnectionId || target === sftpRecycleBinPage) return;
  sftpRecycleBinPage = target;
  openSftpRecycleBin("", sftpRecycleBinConnectionId, target);
}

async function restoreSftpRecycleItem(connectionId, id, storage="terma") {
  try {
    const result = await api(`/api/connections/${connectionId}/sftp/trash/restore`, {method:"POST", body:JSON.stringify({id, storage})});
    const path = result.original_path || tr("sftp:drag.remote_item", {defaultValue:"远程项目"});
    notify(tr("sftp:recycle_bin.restored", {path, defaultValue:`已恢复：${path}`}), "success");
    queueSftpDirectoryRefresh(connectionId);
    flushPendingSftpDirectoryRefresh();
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.restore_failed", {defaultValue:"恢复失败"}), "error");
  }
  openSftpRecycleBin("", connectionId, sftpRecycleBinPage);
}

async function deleteSftpRecycleItem(connectionId, id, name, storage="terma") {
  if (!await confirmModal(
    tr("sftp:recycle_bin.delete_message", {name, defaultValue:`永久删除回收站中的项目且无法恢复？\n${name}`}),
    tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"}),
    tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return openSftpRecycleBin("", connectionId, sftpRecycleBinPage);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/delete`, {method:"POST", body:JSON.stringify({id, storage})});
    notify(tr("sftp:recycle_bin.deleted", {defaultValue:"回收站项目已永久删除"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.delete_failed", {defaultValue:"永久删除失败"}), "error");
  }
  openSftpRecycleBin("", connectionId, sftpRecycleBinPage);
}

async function clearSftpRecycleBin(connectionId) {
  if (!await confirmModal(
    tr("sftp:recycle_bin.clear_message", {defaultValue:"永久删除当前服务器回收站内的全部项目？此操作无法撤销。"}),
    tr("sftp:recycle_bin.clear_title", {defaultValue:"清空 SFTP 回收站"}),
    tr("sftp:recycle_bin.clear_confirm", {defaultValue:"全部永久删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return openSftpRecycleBin("", connectionId, sftpRecycleBinPage);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/clear`, {method:"POST", body:"{}"});
    notify(tr("sftp:recycle_bin.cleared", {defaultValue:"SFTP 回收站已清空"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.clear_failed", {defaultValue:"清空回收站失败"}), "error");
  }
  openSftpRecycleBin("", connectionId, sftpRecycleBinPage);
}
