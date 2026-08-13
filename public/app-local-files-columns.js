const LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY = "termaLocalFilesColumnLayoutV1";
const LOCAL_FILES_COLUMN_KEYS = Object.freeze(["name", "size", "mtime"]);
const LOCAL_FILES_COLUMN_DEFAULTS = Object.freeze({
  name:{weight:2.45,min:160},
  size:{weight:.98,min:96},
  mtime:{weight:1.28,min:112}
});

function defaultLocalFilesColumnLayout() {
  return {weights:Object.fromEntries(LOCAL_FILES_COLUMN_KEYS.map(key => [key, LOCAL_FILES_COLUMN_DEFAULTS[key].weight]))};
}

function normalizeLocalFilesColumnLayout(value) {
  const fallback = defaultLocalFilesColumnLayout();
  const weights = {};
  for (const key of LOCAL_FILES_COLUMN_KEYS) {
    const supplied = Number(value?.weights?.[key]);
    weights[key] = Math.round(Math.max(.2, Math.min(8, Number.isFinite(supplied) ? supplied : fallback.weights[key])) * 1000) / 1000;
  }
  return {weights};
}

function readLocalFilesColumnLayout() {
  try { return normalizeLocalFilesColumnLayout(JSON.parse(localStorage.getItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY) || "{}")); }
  catch { return defaultLocalFilesColumnLayout(); }
}

function writeLocalFilesColumnLayout(layout) {
  const normalized = normalizeLocalFilesColumnLayout(layout);
  localStorage.setItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function localFilesColumnLabel(key) {
  return {name:"名称", size:"大小", mtime:"修改时间"}[key] || key;
}

function localFilesHeaderColumnHtml(key, tabKey, mark="") {
  const label = `${localFilesColumnLabel(key)}${mark ? ` ${mark}` : ""}`;
  const hasNext = LOCAL_FILES_COLUMN_KEYS.indexOf(key) < LOCAL_FILES_COLUMN_KEYS.length - 1;
  return `<div class="local-files-head-cell local-files-column-${key}" data-local-files-column="${key}"><button type="button" data-action="local-files-sort" data-sort="${key}" data-tab-key="${escAttr(tabKey)}"><span>${esc(label)}</span>${key === "name" ? `<small class="local-files-compact-column-labels">类型 · 修改时间</small>` : ""}</button>${hasNext ? `<i class="local-files-column-resize" data-local-files-column-resize="${key}" role="separator" aria-orientation="vertical" aria-label="调整${esc(localFilesColumnLabel(key))}与下一列的比例" tabindex="0"></i>` : ""}</div>`;
}

function visibleLocalFilesColumnKeys(list) {
  const width = Number(list?.getBoundingClientRect?.().width || list?.clientWidth || 0);
  return width > 0 && width <= 760 ? ["name", "size"] : [...LOCAL_FILES_COLUMN_KEYS];
}

function applyLocalFilesColumnLayout(list) {
  if (!list) return;
  if (list.dataset.localFilesPixelColumns === "1") return;
  const width = Number(list.getBoundingClientRect?.().width || list.clientWidth || 0);
  const layout = readLocalFilesColumnLayout();
  const columns = visibleLocalFilesColumnKeys(list).map(key => `minmax(0,${layout.weights[key]}fr)`);
  list.style.setProperty("--local-grid-columns", [width > 0 && width <= 760 ? "28px" : "24px", ...columns].join(" "));
}

function releaseLocalFilesPixelColumnLayout(list) {
  if (!list || list.dataset.localFilesPixelColumns !== "1") return;
  delete list.dataset.localFilesPixelColumns;
  delete list.dataset.localFilesPixelColumnsWidth;
  list.style.removeProperty("--local-grid-columns");
}

function localFilesMeasuredTrackWidths(list, keys=visibleLocalFilesColumnKeys(list)) {
  return new Map(keys.map(key => [key, Math.max(0, Number(list.querySelector(`.local-files-head-cell[data-local-files-column="${key}"]`)?.getBoundingClientRect?.().width || 0))]));
}

function lockLocalFilesPixelColumnLayout(list, keys, widths) {
  if (!list) return;
  const listWidth = Number(list.getBoundingClientRect?.().width || list.clientWidth || 0);
  const checkWidth = listWidth > 0 && listWidth <= 760 ? 28 : 24;
  list.dataset.localFilesPixelColumns = "1";
  list.dataset.localFilesPixelColumnsWidth = String(Math.max(0, listWidth));
  list.style.setProperty("--local-grid-columns", [`${checkWidth}px`, ...keys.map(key => `${Math.max(0, Number(widths.get(key) || 0))}px`)].join(" "));
}

function localFilesResizePair(list, key) {
  const visibleKeys = visibleLocalFilesColumnKeys(list);
  const index = visibleKeys.indexOf(key);
  if (index < 0 || index >= visibleKeys.length - 1) return null;
  const nextKey = visibleKeys[index + 1];
  const currentCell = list.querySelector(`.local-files-head-cell[data-local-files-column="${key}"]`);
  const nextCell = list.querySelector(`.local-files-head-cell[data-local-files-column="${nextKey}"]`);
  if (!currentCell || !nextCell) return null;
  const currentWidth = currentCell.getBoundingClientRect().width;
  const nextWidth = nextCell.getBoundingClientRect().width;
  const total = currentWidth + nextWidth;
  if (total < 2) return null;
  const compact = Number(list?.getBoundingClientRect?.().width || list?.clientWidth || 0) <= 760;
  const currentPreferredMin = compact ? (key === "name" ? 84 : 64) : LOCAL_FILES_COLUMN_DEFAULTS[key].min;
  const nextPreferredMin = compact ? (nextKey === "name" ? 84 : 64) : LOCAL_FILES_COLUMN_DEFAULTS[nextKey].min;
  const currentMin = Math.min(currentPreferredMin, Math.max(28, total - 28));
  const nextMin = Math.min(nextPreferredMin, Math.max(28, total - currentMin));
  const totalWeight = Math.max(.4, Number(readLocalFilesColumnLayout().weights[key] || 0) + Number(readLocalFilesColumnLayout().weights[nextKey] || 0));
  return {key, nextKey, currentWidth, total, currentMin, nextMin, totalWeight};
}

function setLocalFilesColumnPairWidth(layout, pair, currentWidth) {
  const minimum = Math.min(pair.currentMin, Math.max(28, pair.total - pair.nextMin));
  const maximum = Math.max(minimum, pair.total - pair.nextMin);
  const bounded = Math.max(minimum, Math.min(maximum, currentWidth));
  layout.weights[pair.key] = Math.round((bounded / pair.total) * pair.totalWeight * 1000) / 1000;
  layout.weights[pair.nextKey] = Math.round((pair.totalWeight - layout.weights[pair.key]) * 1000) / 1000;
}

function rebaseLocalFilesColumnLayout(list, source=readLocalFilesColumnLayout()) {
  const layout = normalizeLocalFilesColumnLayout(source);
  const visibleKeys = visibleLocalFilesColumnKeys(list);
  const widths = new Map(visibleKeys.map(key => [key, Math.max(0, Number(list.querySelector(`.local-files-head-cell[data-local-files-column="${key}"]`)?.getBoundingClientRect?.().width || 0))]));
  const totalWidth = [...widths.values()].reduce((total, width) => total + width, 0);
  const totalWeight = visibleKeys.reduce((total, key) => total + Math.max(.2, Number(layout.weights[key] || 0)), 0);
  if (totalWidth > 0 && totalWeight > 0) {
    for (const key of visibleKeys) layout.weights[key] = Math.max(.2, widths.get(key) / totalWidth * totalWeight);
  }
  return layout;
}

function prepareLocalFilesColumnResize(list, key) {
  const pair = localFilesResizePair(list, key);
  if (!pair) return null;
  const keys = visibleLocalFilesColumnKeys(list);
  const widths = localFilesMeasuredTrackWidths(list, keys);
  const layout = rebaseLocalFilesColumnLayout(list);
  pair.totalWeight = Math.max(.4, Number(layout.weights[pair.key] || 0) + Number(layout.weights[pair.nextKey] || 0));
  lockLocalFilesPixelColumnLayout(list, keys, widths);
  return {pair, layout, keys, widths};
}

function applyLocalFilesColumnResize(list, prepared, currentWidth) {
  const {pair, layout, keys, widths} = prepared;
  const minimum = Math.min(pair.currentMin, Math.max(28, pair.total - pair.nextMin));
  const maximum = Math.max(minimum, pair.total - pair.nextMin);
  const bounded = Math.max(minimum, Math.min(maximum, currentWidth));
  setLocalFilesColumnPairWidth(layout, pair, bounded);
  widths.set(pair.key, bounded);
  widths.set(pair.nextKey, pair.total - bounded);
  lockLocalFilesPixelColumnLayout(list, keys, widths);
  writeLocalFilesColumnLayout(layout);
  document.querySelectorAll(".local-files-list").forEach(other => {
    if (other !== list) applyLocalFilesColumnLayout(other);
  });
}

function beginLocalFilesColumnResize(event, list, key) {
  if (event.button !== 0 || !LOCAL_FILES_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareLocalFilesColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  list.classList.add("local-files-column-resizing");
  try { handle.setPointerCapture?.(event.pointerId); } catch {}
  const move = moveEvent => {
    if (pointerId != null && moveEvent.pointerId != null && moveEvent.pointerId !== pointerId) return;
    applyLocalFilesColumnResize(list, prepared, pair.currentWidth + moveEvent.clientX - startX);
  };
  const finish = finishEvent => {
    if (pointerId != null && finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return;
    list.classList.remove("local-files-column-resizing");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    try { handle.releasePointerCapture?.(pointerId); } catch {}
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}

function resizeLocalFilesColumnByKeyboard(event, list, key) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !LOCAL_FILES_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareLocalFilesColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  applyLocalFilesColumnResize(list, prepared, pair.currentWidth + (event.key === "ArrowLeft" ? -16 : 16));
}

function syncLocalFilesColumnControls(list) {
  if (!list) return;
  const width = Number(list.getBoundingClientRect?.().width || list.clientWidth || 0);
  const lockedWidth = Number(list.dataset.localFilesPixelColumnsWidth || 0);
  if (lockedWidth > 0 && Math.abs(width - lockedWidth) > 1) releaseLocalFilesPixelColumnLayout(list);
  applyLocalFilesColumnLayout(list);
  list.querySelectorAll("[data-local-files-column-resize]").forEach(handle => {
    const key = handle.dataset.localFilesColumnResize;
    const canResize = Boolean(localFilesResizePair(list, key));
    handle.hidden = !canResize;
  });
}

function bindLocalFilesColumnControls(list) {
  if (!list) return;
  list.querySelectorAll("[data-local-files-column-resize]").forEach(handle => {
    const key = handle.dataset.localFilesColumnResize;
    handle.addEventListener("pointerdown", event => beginLocalFilesColumnResize(event, list, key));
    handle.addEventListener("keydown", event => resizeLocalFilesColumnByKeyboard(event, list, key));
  });
  syncLocalFilesColumnControls(list);
}
