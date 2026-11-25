// Static markup retained only for legacy CSS/adapter probes in the base smoke.
// Product SFTP surfaces use the Vue view, dialog and diff owners.
function installSftpDomFixtures(){
globalThis.sftpBreadcrumbHtml = function sftpBreadcrumbHtml(id, remotePath, tabKey=activeTabKey) {
  const raw = String(remotePath || ".").replace(/\\/g, "/");
  const clean = raw === "/" ? "/" : (raw.replace(/\/+$/,"") || ".");
  if (clean === ".") return `<button class="crumb active" aria-current="page" onclick="window.termaSftpView.navigate('.','${escAttr(tabKey)}')">${esc(tr("sftp:auto.current_directory"))}</button>`;
  const absolute = clean.startsWith("/");
  const parts = clean.split("/").filter(Boolean);
  const crumbs = absolute ? [{label:tr("sftp:auto.root_directory"), path:"/"}] : [{label:tr("sftp:auto.current_directory"), path:"."}];
  let current = absolute ? "" : ".";
  for (const part of parts) {
    current = current === "." ? part : `${current.replace(/\/$/,"")}/${part}`;
    crumbs.push({label:part, path:current});
  }
  return crumbs.map((item, index) => `<button class="crumb ${index === crumbs.length - 1 ? "active" : ""}" ${index === crumbs.length - 1 ? 'aria-current="page"' : ""} title="${esc(item.path)}" onclick="window.termaSftpView.navigate('${escAttr(item.path)}','${escAttr(tabKey)}')">${esc(item.label)}</button>`).join(`<span class="crumb-sep" aria-hidden="true">${icon("chevron-right")}</span>`);
};
globalThis.renderSftpFavorites = function renderSftpFavorites(id, tabKey=activeTabKey) {
  const items = window.termaSftpPreferences.snapshot(id);
  return `<span class="sftp-favorites-label">${esc(tr("sftp:auto.favorites"))}</span>${items.length ? items.map(item => `<button onclick="window.termaSftpView.navigate('${escAttr(item.path)}','${escAttr(tabKey)}')" title="${escAttr(item.path)}"><span aria-hidden="true">★</span>${esc(item.name || item.path)}</button>`).join("") : `<span class="muted">${esc(tr("sftp:auto.favorites_hint"))}</span>`}`;
};
globalThis.renderSftpClipboardActions = function renderSftpClipboardActions(tabKey=activeTabKey) {
  if (!window.termaSftpFileActions.clipboard.value?.paths?.length) return "";
  const count = window.termaSftpFileActions.clipboard.value.paths.length;
  const moving = window.termaSftpFileActions.clipboard.value.mode === "move";
  const mode = tr(moving ? "sftp:clipboard.move" : "sftp:clipboard.copy", {defaultValue:moving ? "移动" : "复制"});
  const matches = window.termaSftpView.matchesClipboard(tabKey);
  const canPaste = matches || window.termaSftpFileActions.clipboard.value.mode === "copy";
  const crossHost = canPaste && !matches;
  const queue = tr(moving ? "sftp:clipboard.move_queue" : "sftp:clipboard.copy_queue", {count, defaultValue:`${mode}队列 ${count} 项`});
  const source = window.termaSftpFileActions.clipboard.value.connectionName ? tr("sftp:clipboard.source", {name:window.termaSftpFileActions.clipboard.value.connectionName, defaultValue:`来源：${window.termaSftpFileActions.clipboard.value.connectionName}`}) : "";
  const pasteTitle = matches
    ? tr("sftp:clipboard.paste_current", {defaultValue:"粘贴到当前目录"})
    : crossHost
      ? tr("sftp:clipboard.copy_from_source", {defaultValue:"从来源主机复制到当前主机"})
      : tr("sftp:clipboard.cross_copy_only", {defaultValue:"跨主机仅支持复制，不能移动"});
  const action = crossHost ? tr("sftp:clipboard.cross_copy", {defaultValue:"跨主机复制"}) : tr("common:actions.paste", {defaultValue:"粘贴"});
  const cancelTitle = tr("sftp:clipboard.cancel_title", {defaultValue:"取消复制/移动队列"});
  const cancelLabel = tr("sftp:clipboard.cancel_label", {defaultValue:"取消复制或移动队列"});
  return `<span class="sftp-clipboard-state" title="${escAttr(source || queue)}">${icon(moving ? "folder-input" : "copy")}<span>${esc(queue)}</span></span><button class="primary" onclick="pasteSftpClipboard('${escAttr(tabKey)}')" ${canPaste ? "" : "disabled"} title="${escAttr(pasteTitle)}">${icon(crossHost ? "network" : "clipboard-paste")}<span>${esc(action)}</span></button><button class="icon-button" title="${escAttr(cancelTitle)}" aria-label="${escAttr(cancelLabel)}" onclick="window.termaSftpFileActions.cancel()">${icon("x")}</button>`;
};
globalThis.sftpDiffDisplayTime = function sftpDiffDisplayTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return tr("sftp:diff.time_unknown", {defaultValue:"时间未知"});
  return new Date(timestamp).toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false});
};
globalThis.sftpDiffLineCell = function sftpDiffLineCell(kind, number, value) {
  const empty = value === null || typeof value === "undefined";
  return `<div class="sftp-diff-cell ${kind}${empty ? " empty" : ""}"><span>${number || ""}</span><code>${empty ? "" : (esc(value) || " ")}</code></div>`;
};
globalThis.sftpDiffViewerHtml = function sftpDiffViewerHtml(oldText, newText, options={}) {
  const model = window.termaEditorDocument.diff(oldText, newText, options, {diffLines:(...args)=>window.Diff?.diffLines?.(...args),tr,bytes:window.termaSftpTaskWorkspace.presentation.bytes});
  if (model.unavailable) return `<div class="sftp-diff-unavailable">${esc(model.message)}</div>`;
  const rows = model.rows.map(row => row.collapsed !== undefined
    ? `<div class="sftp-diff-collapsed"><span>${esc(row.collapsed)}</span></div>`
    : `<div class="sftp-diff-row${row.changed ? " changed" : ""}">${row.cells.map(cell => sftpDiffLineCell(cell.kind, cell.number, cell.kind === "blank" ? null : cell.text)).join("")}</div>`).join("");
  return `<div class="sftp-side-diff${model.hasChanges ? "" : " no-changes"}"><div class="sftp-diff-columns"><strong>${esc(model.oldLabel)}</strong><strong>${esc(model.newLabel)}</strong></div>${model.hasChanges ? rows : `<div class="sftp-diff-unavailable">${esc(model.message)}</div>`}</div>`;
};
}
module.exports={installSftpDomFixtures};
