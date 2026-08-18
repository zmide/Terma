const SFTP_COLUMN_LAYOUT_STORAGE_KEY = "termaSftpColumnLayoutV1";
const SFTP_COLUMN_KEYS = Object.freeze(["name", "size", "mtime", "access"]);
const SFTP_ACTION_COLUMN_KEY = "actions";
const SFTP_COLUMN_MIN_WEIGHT = .001;
const SFTP_COLUMN_MIN_PIXELS = 3;
const SFTP_ACTION_COLUMN_DEFAULT_WEIGHT = 3.6;
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
    actionWeight:SFTP_ACTION_COLUMN_DEFAULT_WEIGHT
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
    weights[key] = Math.round(Math.max(SFTP_COLUMN_MIN_WEIGHT, Math.min(8, Number.isFinite(supplied) ? supplied : migrated || fallback.weights[key])) * 1000) / 1000;
  }
  const actionWeight = Math.round(Math.max(SFTP_COLUMN_MIN_WEIGHT, Math.min(8, Number(value?.actionWeight) || fallback.actionWeight)) * 1000) / 1000;
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
  return {
    name:tr("sftp:auto.name", {defaultValue:"名称"}),
    size:tr("sftp:auto.size", {defaultValue:"大小"}),
    mtime:tr("sftp:auto.modified", {defaultValue:"修改时间"}),
    access:tr("sftp:auto.permissions_owner", {defaultValue:"权限 / 所有者"})
  }[key] || key;
}

function sftpHeaderColumnHtml(key, tabKey, mark="") {
  const sortable = ["name", "size", "mtime"].includes(key);
  const label = `${sftpColumnLabel(key)}${mark ? ` ${mark}` : ""}`;
  const compatibilityClass = {size:"sftp-size",mtime:"sftp-time",access:"sftp-access"}[key] || "";
  return `<div class="sftp-head-cell sftp-column-${key} ${compatibilityClass}" data-sftp-column="${key}" draggable="true">${sortable
    ? `<button type="button" data-sftp-column-sort="${key}" data-sftp-tab-key="${escAttr(tabKey)}"><span>${esc(label)}</span>${key === "name" ? `<small class="sftp-compact-column-labels">${esc(tr("sftp:auto.compact_columns", {defaultValue:"大小 · 修改时间 · 权限"}))}</small>` : ""}</button>`
    : `<span>${esc(label)}</span>`}<i class="sftp-column-resize" data-sftp-column-resize="${key}" role="separator" aria-orientation="vertical" aria-label="${escAttr(tr("sftp:auto.resize_columns", {column:sftpColumnLabel(key), defaultValue:`调整${sftpColumnLabel(key)}与下一列的比例`}))}" tabindex="0"></i></div>`;
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

function sftpActionsColumnWidth(list, actionWeight=readSftpColumnLayout().actionWeight) {
  const width = Math.max(0, Number(list?.clientWidth || list?.getBoundingClientRect?.().width || 0));
  if (list?.classList.contains("sftp-actions-more-only")) return 54;
  const ratio = Math.max(SFTP_COLUMN_MIN_WEIGHT, Number(actionWeight || 0)) / SFTP_ACTION_COLUMN_DEFAULT_WEIGHT;
  if (list?.classList.contains("sftp-actions-compact")) return Math.min(200, Math.max(SFTP_COLUMN_MIN_PIXELS, Math.round(132 * ratio)));
  if (list?.classList.contains("sftp-actions-medium")) {
    const base = Math.min(400, Math.max(250, Math.round(width * .4)));
    return Math.min(480, Math.max(SFTP_COLUMN_MIN_PIXELS, Math.round(base * ratio)));
  }
  const base = Math.min(560, Math.max(420, Math.round(width * .31)));
  return Math.min(560, Math.max(SFTP_COLUMN_MIN_PIXELS, Math.round(base * ratio)));
}

function sftpUsesFixedActionTrack(list) {
  return list?.classList.contains("sftp-actions-medium")
    || list?.classList.contains("sftp-actions-compact")
    || list?.classList.contains("sftp-actions-more-only");
}

function sftpActionColumnBaseWidth(list) {
  return sftpActionsColumnWidth(list, SFTP_ACTION_COLUMN_DEFAULT_WEIGHT);
}

function applySftpColumnLayout(list) {
  if (!list) return;
  if (list.dataset.sftpPixelColumns === "1") return;
  const layout = readSftpColumnLayout();
  const fixedActions = sftpUsesFixedActionTrack(list);
  const columns = sftpLayoutTrackKeys(list).map(key => {
    if (key !== SFTP_ACTION_COLUMN_KEY) return `minmax(0,${layout.weights[key]}fr)`;
    return fixedActions ? `${sftpActionsColumnWidth(list, layout.actionWeight)}px` : `minmax(0,${layout.actionWeight}fr)`;
  });
  list.style.setProperty("--sftp-grid-columns", ["36px", ...columns].join(" "));
  list.style.removeProperty("--sftp-grid-min-width");
}

function releaseSftpPixelColumnLayout(list) {
  if (!list || list.dataset.sftpPixelColumns !== "1") return;
  delete list.dataset.sftpPixelColumns;
  delete list.dataset.sftpPixelColumnsWidth;
  list.style.removeProperty("--sftp-grid-columns");
}

function sftpMeasuredTrackWidths(list, tracks=sftpLayoutTrackKeys(list)) {
  return new Map(tracks.map(key => [key, Math.max(0, Number(sftpTrackElement(list, key)?.getBoundingClientRect?.().width || 0))]));
}

function lockSftpPixelColumnLayout(list, tracks, widths) {
  if (!list) return;
  list.dataset.sftpPixelColumns = "1";
  list.dataset.sftpPixelColumnsWidth = String(Math.max(0, Number(list.getBoundingClientRect?.().width || list.clientWidth || 0)));
  list.style.setProperty("--sftp-grid-columns", ["36px", ...tracks.map(key => `${Math.max(SFTP_COLUMN_MIN_PIXELS, Number(widths.get(key) || 0))}px`)].join(" "));
}

function refreshSftpColumnLayouts() {
  document.querySelectorAll(".sftp-list").forEach(list => {
    releaseSftpPixelColumnLayout(list);
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
    releaseSftpPixelColumnLayout(list);
    const tabKey = String(list.dataset.sftpTabKey || activeTabKey || "");
    if (sftpTabRuntimes.has(tabKey)) renderSftpEntries(tabKey);
  });
}

function sftpResizePair(list, key) {
  const layout = readSftpColumnLayout();
  const tracks = sftpLayoutTrackKeys(list);
  const index = tracks.indexOf(key);
  if (index < 0 || index >= tracks.length - 1) return null;
  const nextKey = tracks[index + 1];
  if (nextKey === SFTP_ACTION_COLUMN_KEY && list?.classList.contains("sftp-actions-more-only")) return null;
  const currentCell = list.querySelector(`.sftp-head-cell[data-sftp-column="${key}"]`);
  const nextCell = nextKey === SFTP_ACTION_COLUMN_KEY
    ? list.querySelector(".sftp-head-actions")
    : list.querySelector(`.sftp-head-cell[data-sftp-column="${nextKey}"]`);
  if (!currentCell || !nextCell) return null;
  const currentWidth = currentCell.getBoundingClientRect().width;
  const nextWidth = nextCell.getBoundingClientRect().width;
  const total = currentWidth + nextWidth;
  if (total < 2) return null;
  const currentMin = SFTP_COLUMN_MIN_PIXELS;
  const nextMin = SFTP_COLUMN_MIN_PIXELS;
  const currentWeight = Number(layoutValueForSftpColumn(layout, key) || 0);
  const nextWeight = Number(layoutValueForSftpColumn(layout, nextKey) || 0);
  return {
    key,
    nextKey,
    currentWidth,
    nextWidth,
    total,
    currentMin,
    nextMin,
    currentWeight,
    nextWeight,
    totalWeight:Math.max(SFTP_COLUMN_MIN_WEIGHT * 2, currentWeight + nextWeight),
    actionWidthBase:nextKey === SFTP_ACTION_COLUMN_KEY && sftpUsesFixedActionTrack(list) ? sftpActionColumnBaseWidth(list) : 0,
    dataPixelsPerWeight:currentWeight > 0 ? currentWidth / currentWeight : 0
  };
}

function layoutValueForSftpColumn(layout, key) {
  return key === SFTP_ACTION_COLUMN_KEY ? layout.actionWeight : layout.weights[key];
}

function sftpTrackElement(list, key) {
  return key === SFTP_ACTION_COLUMN_KEY
    ? list.querySelector(".sftp-head-actions")
    : list.querySelector(`.sftp-head-cell[data-sftp-column="${key}"]`);
}

function rebaseSftpColumnLayout(list, source=readSftpColumnLayout()) {
  const layout = normalizeSftpColumnLayout(source);
  const tracks = sftpLayoutTrackKeys(list);
  const fixedActions = sftpUsesFixedActionTrack(list);
  const weightedKeys = fixedActions ? tracks.filter(key => key !== SFTP_ACTION_COLUMN_KEY) : tracks;
  const widths = new Map(weightedKeys.map(key => [key, Math.max(0, Number(sftpTrackElement(list, key)?.getBoundingClientRect?.().width || 0))]));
  const totalWidth = [...widths.values()].reduce((total, width) => total + width, 0);
  const totalWeight = weightedKeys.reduce((total, key) => total + Math.max(SFTP_COLUMN_MIN_WEIGHT, Number(layoutValueForSftpColumn(layout, key) || 0)), 0);
  if (totalWidth > 0 && totalWeight > 0) {
    for (const key of weightedKeys) {
      const value = Math.max(SFTP_COLUMN_MIN_WEIGHT, widths.get(key) / totalWidth * totalWeight);
      if (key === SFTP_ACTION_COLUMN_KEY) layout.actionWeight = value;
      else layout.weights[key] = value;
    }
  }
  if (fixedActions && tracks.includes(SFTP_ACTION_COLUMN_KEY)) {
    const actionWidth = Math.max(0, Number(sftpTrackElement(list, SFTP_ACTION_COLUMN_KEY)?.getBoundingClientRect?.().width || 0));
    const baseWidth = sftpActionColumnBaseWidth(list);
    if (actionWidth > 0 && baseWidth > 0) layout.actionWeight = actionWidth / baseWidth * SFTP_ACTION_COLUMN_DEFAULT_WEIGHT;
  }
  return layout;
}

function prepareSftpColumnResize(list, key) {
  const pair = sftpResizePair(list, key);
  if (!pair) return null;
  const tracks = sftpLayoutTrackKeys(list);
  const widths = sftpMeasuredTrackWidths(list, tracks);
  const layout = rebaseSftpColumnLayout(list);
  pair.currentWeight = Number(layoutValueForSftpColumn(layout, pair.key) || 0);
  pair.nextWeight = Number(layoutValueForSftpColumn(layout, pair.nextKey) || 0);
  pair.totalWeight = Math.max(SFTP_COLUMN_MIN_WEIGHT * 2, pair.currentWeight + pair.nextWeight);
  pair.dataPixelsPerWeight = pair.currentWeight > 0 ? pair.currentWidth / pair.currentWeight : 0;
  lockSftpPixelColumnLayout(list, tracks, widths);
  return {pair, layout, tracks, widths};
}

function setSftpColumnPairWidth(layout, pair, currentWidth) {
  const minimum = Math.min(pair.currentMin, Math.max(SFTP_COLUMN_MIN_PIXELS, pair.total - pair.nextMin));
  const maximum = Math.max(minimum, pair.total - pair.nextMin);
  const bounded = Math.max(minimum, Math.min(maximum, currentWidth));
  if (pair.nextKey === SFTP_ACTION_COLUMN_KEY && pair.actionWidthBase > 0) {
    const nextWidth = pair.total - bounded;
    if (pair.dataPixelsPerWeight > 0) layout.weights[pair.key] = Math.round((bounded / pair.dataPixelsPerWeight) * 1000) / 1000;
    layout.actionWeight = Math.round((nextWidth / pair.actionWidthBase) * SFTP_ACTION_COLUMN_DEFAULT_WEIGHT * 1000) / 1000;
    return {currentWidth:bounded, nextWidth};
  }
  const updatedCurrentWeight = Math.round((bounded / pair.total) * pair.totalWeight * 1000) / 1000;
  const updatedNextWeight = Math.round((pair.totalWeight - updatedCurrentWeight) * 1000) / 1000;
  if (pair.key === SFTP_ACTION_COLUMN_KEY) layout.actionWeight = updatedCurrentWeight;
  else layout.weights[pair.key] = updatedCurrentWeight;
  if (pair.nextKey === SFTP_ACTION_COLUMN_KEY) layout.actionWeight = updatedNextWeight;
  else layout.weights[pair.nextKey] = updatedNextWeight;
  return {currentWidth:bounded, nextWidth:pair.total - bounded};
}

function applySftpColumnResize(list, prepared, currentWidth) {
  const result = setSftpColumnPairWidth(prepared.layout, prepared.pair, currentWidth);
  if (!result) return;
  prepared.widths.set(prepared.pair.key, result.currentWidth);
  prepared.widths.set(prepared.pair.nextKey, result.nextWidth);
  lockSftpPixelColumnLayout(list, prepared.tracks, prepared.widths);
  writeSftpColumnLayout(prepared.layout);
  document.querySelectorAll(".sftp-list").forEach(other => {
    if (other !== list) applySftpColumnLayout(other);
  });
}

function beginSftpColumnResize(event, list, key) {
  if (event.button !== 0 || !SFTP_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareSftpColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  list.classList.add("sftp-column-resizing");
  try { handle.setPointerCapture?.(event.pointerId); } catch {}
  const move = moveEvent => {
    if (pointerId != null && moveEvent.pointerId != null && moveEvent.pointerId !== pointerId) return;
    applySftpColumnResize(list, prepared, pair.currentWidth + moveEvent.clientX - startX);
  };
  const finish = finishEvent => {
    if (pointerId != null && finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return;
    list.classList.remove("sftp-column-resizing");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    try { handle.releasePointerCapture?.(pointerId); } catch {}
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}

function resizeSftpColumnByKeyboard(event, list, key) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !SFTP_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareSftpColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  applySftpColumnResize(list, prepared, pair.currentWidth + (event.key === "ArrowLeft" ? -16 : 16));
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
