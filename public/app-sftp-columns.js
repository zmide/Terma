const SFTP_COLUMN_LAYOUT_STORAGE_KEY = "termaSftpColumnLayoutV1";
const SFTP_COLUMN_KEYS = Object.freeze(["name", "size", "mtime", "access"]);
const SFTP_ACTION_COLUMN_KEY = "actions";
const SFTP_COLUMN_DEFAULTS = Object.freeze({
  name:{weight:2.45,min:160},
  size:{weight:.72,min:64},
  mtime:{weight:1.28,min:104},
  access:{weight:1.34,min:96}
});
let sftpColumnDragKey = "";
let sftpColumnSortSuppressedUntil = 0;

function defaultSftpColumnLayout() {
  return {
    order:[...SFTP_COLUMN_KEYS],
    weights:Object.fromEntries(SFTP_COLUMN_KEYS.map(key => [key, SFTP_COLUMN_DEFAULTS[key].weight])),
    actionWeight:3.6
  };
}

function normalizeSftpColumnLayout(value) {
  const fallback = defaultSftpColumnLayout();
  const suppliedOrder = Array.isArray(value?.order) ? value.order.map(String) : [];
  const order = [...new Set(suppliedOrder.filter(key => SFTP_COLUMN_KEYS.includes(key)))];
  for (const key of SFTP_COLUMN_KEYS) if (!order.includes(key)) order.push(key);
  const legacyWidths = value?.widths && typeof value.widths === "object" ? value.widths : null;
  const legacyTotal = legacyWidths
    ? SFTP_COLUMN_KEYS.reduce((total, key) => total + Math.max(0, Number(legacyWidths[key]) || 0), 0)
    : 0;
  const weights = {};
  for (const key of SFTP_COLUMN_KEYS) {
    const supplied = Number(value?.weights?.[key]);
    const migrated = legacyTotal > 0 ? (Math.max(0, Number(legacyWidths[key]) || 0) / legacyTotal) * 5.79 : 0;
    weights[key] = Math.round(Math.max(.2, Math.min(8, Number.isFinite(supplied) ? supplied : migrated || fallback.weights[key])) * 1000) / 1000;
  }
  const actionWeight = Math.round(Math.max(.2, Math.min(8, Number(value?.actionWeight) || fallback.actionWeight)) * 1000) / 1000;
  return {order, weights, actionWeight};
}

function readSftpColumnLayout() {
  try { return normalizeSftpColumnLayout(JSON.parse(localStorage.getItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY) || "{}")); }
  catch { return defaultSftpColumnLayout(); }
}

function writeSftpColumnLayout(layout) {
  const normalized = normalizeSftpColumnLayout(layout);
  localStorage.setItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function sftpOrderedColumnHtml(parts) {
  return readSftpColumnLayout().order.map(key => parts[key] || "").join("");
}

function sftpColumnLabel(key) {
  return {name:"名称",size:"大小",mtime:"修改时间",access:"权限 / 所有者"}[key] || key;
}

function sftpHeaderColumnHtml(key, tabKey, mark="") {
  const sortable = ["name", "size", "mtime"].includes(key);
  const label = `${sftpColumnLabel(key)}${mark ? ` ${mark}` : ""}`;
  const compatibilityClass = {size:"sftp-size",mtime:"sftp-time",access:"sftp-access"}[key] || "";
  return `<div class="sftp-head-cell sftp-column-${key} ${compatibilityClass}" data-sftp-column="${key}" draggable="true">${sortable
    ? `<button type="button" data-sftp-column-sort="${key}" data-sftp-tab-key="${escAttr(tabKey)}">${esc(label)}</button>`
    : `<span>${esc(label)}</span>`}<i class="sftp-column-resize" data-sftp-column-resize="${key}" role="separator" aria-orientation="vertical" aria-label="调整${esc(sftpColumnLabel(key))}与下一列的比例" tabindex="0"></i></div>`;
}

function visibleSftpColumnKeys(list) {
  const order = readSftpColumnLayout().order;
  if (list?.classList.contains("sftp-actions-more-only")) return order.filter(key => key === "name");
  if (list?.classList.contains("sftp-actions-minimal")) return order.filter(key => key !== "access");
  return order;
}

function sftpLayoutTrackKeys(list) {
  return [...visibleSftpColumnKeys(list), SFTP_ACTION_COLUMN_KEY];
}

function sftpActionsColumnWidth(list) {
  const width = Math.max(0, Number(list?.clientWidth || list?.getBoundingClientRect?.().width || 0));
  if (list?.classList.contains("sftp-actions-more-only")) return 54;
  if (list?.classList.contains("sftp-actions-compact")) return 132;
  if (list?.classList.contains("sftp-actions-medium")) return Math.min(400, Math.max(250, Math.round(width * .4)));
  return Math.min(560, Math.max(420, Math.round(width * .31)));
}

function applySftpColumnLayout(list) {
  if (!list) return;
  const layout = readSftpColumnLayout();
  const columns = sftpLayoutTrackKeys(list).map(key => `minmax(0,${key === SFTP_ACTION_COLUMN_KEY ? layout.actionWeight : layout.weights[key]}fr)`);
  list.style.setProperty("--sftp-grid-columns", ["36px", ...columns].join(" "));
  list.style.removeProperty("--sftp-grid-min-width");
}

function refreshSftpColumnLayouts() {
  document.querySelectorAll(".sftp-list").forEach(list => {
    applySftpColumnLayout(list);
    const tabKey = String(list.dataset.sftpTabKey || activeTabKey || "");
    if (sftpTabRuntimes.has(tabKey) && typeof renderSftpEntries === "function") renderSftpEntries(tabKey);
  });
}

function persistSftpColumnOrder(sourceKey, targetKey, after=false) {
  if (!SFTP_COLUMN_KEYS.includes(sourceKey) || !SFTP_COLUMN_KEYS.includes(targetKey) || sourceKey === targetKey) return;
  const layout = readSftpColumnLayout();
  layout.order = layout.order.filter(key => key !== sourceKey);
  const targetIndex = layout.order.indexOf(targetKey);
  layout.order.splice(Math.max(0, targetIndex + (after ? 1 : 0)), 0, sourceKey);
  writeSftpColumnLayout(layout);
  document.querySelectorAll(".sftp-list").forEach(list => {
    const tabKey = String(list.dataset.sftpTabKey || activeTabKey || "");
    if (sftpTabRuntimes.has(tabKey)) renderSftpEntries(tabKey);
  });
}

function sftpResizePair(list, key) {
  const tracks = sftpLayoutTrackKeys(list);
  const index = tracks.indexOf(key);
  if (index < 0 || index >= tracks.length - 1) return null;
  const nextKey = tracks[index + 1];
  const currentCell = list.querySelector(`.sftp-head-cell[data-sftp-column="${key}"]`);
  const nextCell = nextKey === SFTP_ACTION_COLUMN_KEY
    ? list.querySelector(".sftp-head-actions")
    : list.querySelector(`.sftp-head-cell[data-sftp-column="${nextKey}"]`);
  if (!currentCell || !nextCell) return null;
  const currentWidth = currentCell.getBoundingClientRect().width;
  const nextWidth = nextCell.getBoundingClientRect().width;
  const total = currentWidth + nextWidth;
  if (total < 2) return null;
  const currentMin = Math.min(SFTP_COLUMN_DEFAULTS[key].min, Math.max(28, total - 28));
  const nextMinimum = nextKey === SFTP_ACTION_COLUMN_KEY
    ? (list?.classList.contains("sftp-actions-more-only") ? 44 : list?.classList.contains("sftp-actions-compact") ? 116 : list?.classList.contains("sftp-actions-medium") ? 220 : 330)
    : SFTP_COLUMN_DEFAULTS[nextKey].min;
  const nextMin = Math.min(nextMinimum, Math.max(28, total - currentMin));
  return {key, nextKey, currentWidth, nextWidth, total, currentMin, nextMin};
}

function setSftpColumnPairWidth(layout, pair, currentWidth) {
  const minimum = Math.min(pair.currentMin, Math.max(28, pair.total - pair.nextMin));
  const maximum = Math.max(minimum, pair.total - pair.nextMin);
  const bounded = Math.max(minimum, Math.min(maximum, currentWidth));
  const currentWeight = pair.key === SFTP_ACTION_COLUMN_KEY ? layout.actionWeight : layout.weights[pair.key];
  const nextWeight = pair.nextKey === SFTP_ACTION_COLUMN_KEY ? layout.actionWeight : layout.weights[pair.nextKey];
  const totalWeight = Math.max(.4, Number(currentWeight || 0) + Number(nextWeight || 0));
  layout.weights[pair.key] = Math.round((bounded / pair.total) * totalWeight * 1000) / 1000;
  const updatedNextWeight = Math.round((totalWeight - layout.weights[pair.key]) * 1000) / 1000;
  if (pair.nextKey === SFTP_ACTION_COLUMN_KEY) layout.actionWeight = updatedNextWeight;
  else layout.weights[pair.nextKey] = updatedNextWeight;
}

function beginSftpColumnResize(event, list, key) {
  if (event.button !== 0 || !SFTP_COLUMN_KEYS.includes(key)) return;
  const pair = sftpResizePair(list, key);
  if (!pair) return;
  event.preventDefault();
  event.stopPropagation();
  const layout = readSftpColumnLayout();
  const startX = event.clientX;
  const handle = event.currentTarget;
  list.classList.add("sftp-column-resizing");
  try { handle.setPointerCapture?.(event.pointerId); } catch {}
  const move = moveEvent => {
    setSftpColumnPairWidth(layout, pair, pair.currentWidth + moveEvent.clientX - startX);
    writeSftpColumnLayout(layout);
    document.querySelectorAll(".sftp-list").forEach(applySftpColumnLayout);
  };
  const finish = () => {
    list.classList.remove("sftp-column-resizing");
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

function resizeSftpColumnByKeyboard(event, list, key) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !SFTP_COLUMN_KEYS.includes(key)) return;
  const pair = sftpResizePair(list, key);
  if (!pair) return;
  event.preventDefault();
  const layout = readSftpColumnLayout();
  setSftpColumnPairWidth(layout, pair, pair.currentWidth + (event.key === "ArrowLeft" ? -16 : 16));
  writeSftpColumnLayout(layout);
  document.querySelectorAll(".sftp-list").forEach(applySftpColumnLayout);
}

function bindSftpColumnControls(list) {
  if (!list) return;
  list.dataset.sftpColumnsBound = "1";
  list.querySelectorAll("[data-sftp-column-resize]").forEach(handle => {
    const key = handle.dataset.sftpColumnResize;
    const canResize = Boolean(sftpResizePair(list, key));
    handle.hidden = !canResize;
    if (!canResize) return;
    handle.addEventListener("pointerdown", event => beginSftpColumnResize(event, list, key));
    handle.addEventListener("keydown", event => resizeSftpColumnByKeyboard(event, list, key));
  });
  list.querySelectorAll("[data-sftp-column]").forEach(cell => {
    cell.addEventListener("dragstart", event => {
      if (event.target.closest?.("[data-sftp-column-resize]")) return event.preventDefault();
      sftpColumnDragKey = cell.dataset.sftpColumn || "";
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-terma-sftp-column", sftpColumnDragKey);
      cell.classList.add("dragging");
    });
    cell.addEventListener("dragover", event => {
      if (!sftpColumnDragKey || sftpColumnDragKey === cell.dataset.sftpColumn) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      cell.classList.add("drop-target");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
    cell.addEventListener("drop", event => {
      if (!sftpColumnDragKey) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      persistSftpColumnOrder(sftpColumnDragKey, cell.dataset.sftpColumn, event.clientX >= rect.left + rect.width / 2);
      sftpColumnSortSuppressedUntil = Date.now() + 400;
    });
    cell.addEventListener("dragend", () => {
      sftpColumnDragKey = "";
      list.querySelectorAll(".sftp-head-cell").forEach(node => node.classList.remove("dragging", "drop-target"));
    });
  });
  list.querySelectorAll("[data-sftp-column-sort]").forEach(button => button.addEventListener("click", () => {
    if (Date.now() < sftpColumnSortSuppressedUntil) return;
    setSftpSort(button.dataset.sftpColumnSort, button.dataset.sftpTabKey || activeTabKey);
  }));
  applySftpColumnLayout(list);
}
