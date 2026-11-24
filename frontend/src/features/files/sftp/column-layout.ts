import { fitSftpRowActions } from './row-actions';
export const SFTP_COLUMN_LAYOUT_STORAGE_KEY = "termaSftpColumnLayoutV1";

export interface SftpColumnLayout { order: string[]; weights: Record<string,number>; actionWeight: number }
interface RawLayout { order?: unknown[]; weights?: Record<string,unknown>; widths?: Record<string,unknown>; actionWeight?: unknown }
export interface SftpColumnResizeRuntime { resizeObserver?: ResizeObserver | null; resizeFrame?: number }
export interface SftpColumnPort {
  activeKey(): string;
  exists(key:string): boolean;
  render(key:string): unknown;
  sort(key:string,tabKey:string): unknown;
  mobile?(): boolean;
  runtime?(key:string): SftpColumnResizeRuntime | null;
  ensureRuntime?(key:string): SftpColumnResizeRuntime | null;
}
export function createSftpColumns(port: SftpColumnPort) {
const SFTP_COLUMN_KEYS = Object.freeze(["name", "size", "mtime", "access"]);
const SFTP_ACTION_COLUMN_KEY = "actions";
const SFTP_COLUMN_MIN_WEIGHT = .001;
const SFTP_COLUMN_MIN_PIXELS = 3;
const SFTP_COLUMN_SAFE_MIN_PIXELS = 24;
// Existing preferences store action widths relative to this weight.
const SFTP_ACTION_COLUMN_REFERENCE_WEIGHT = 3.6;
const SFTP_COLUMN_DEFAULTS: Readonly<Record<string,{weight:number;min:number}>> = Object.freeze({
  name:{weight:3.2,min:160},
  size:{weight:.72,min:64},
  mtime:{weight:1.28,min:104},
  access:{weight:1.34,min:96}
});
let sftpColumnDragKey = "";
let sftpColumnSortSuppressedUntil = 0;
const resizeBindings = new WeakSet<HTMLElement>();
const dragBindings = new WeakSet<HTMLElement>();
const sortBindings = new WeakSet<HTMLElement>();

function defaultSftpColumnLayout() {
  return {
    order:[...SFTP_COLUMN_KEYS],
    weights:Object.fromEntries(SFTP_COLUMN_KEYS.map(key => [key, SFTP_COLUMN_DEFAULTS[key].weight])),
    actionWeight:2.6
  };
}

function normalizeSftpColumnLayout(value: RawLayout | null | undefined) {
  const fallback = defaultSftpColumnLayout();
  const suppliedOrder = Array.isArray(value?.order) ? value.order.map(String) : [];
  const order = [...new Set(suppliedOrder.filter(key => SFTP_COLUMN_KEYS.includes(key)))];
  for (const key of SFTP_COLUMN_KEYS) if (!order.includes(key)) order.push(key);
  const legacyWidths = value?.widths && typeof value.widths === "object" ? value.widths : null;
  const legacyTotal = legacyWidths
    ? SFTP_COLUMN_KEYS.reduce((total, key) => total + Math.max(0, Number(legacyWidths?.[key]) || 0), 0)
    : 0;
  const weights: Record<string,number> = {};
  for (const key of SFTP_COLUMN_KEYS) {
    const supplied = Number(value?.weights?.[key]);
    const migrated = legacyTotal > 0 ? (Math.max(0, Number(legacyWidths?.[key]) || 0) / legacyTotal) * 5.79 : 0;
    weights[key] = Math.round(Math.max(SFTP_COLUMN_MIN_WEIGHT, Math.min(8, Number.isFinite(supplied) ? supplied : migrated || fallback.weights[key])) * 1000) / 1000;
  }
  const actionWeight = Math.round(Math.max(SFTP_COLUMN_MIN_WEIGHT, Math.min(8, Number(value?.actionWeight) || fallback.actionWeight)) * 1000) / 1000;
  return {order, weights, actionWeight};
}

function readSftpColumnLayout() {
  try { return normalizeSftpColumnLayout(JSON.parse(localStorage.getItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY) || "{}")); }
  catch { return defaultSftpColumnLayout(); }
}

function writeSftpColumnLayout(layout: SftpColumnLayout) {
  const normalized = normalizeSftpColumnLayout(layout);
  localStorage.setItem(SFTP_COLUMN_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function visibleSftpColumnKeys(list: HTMLElement | null) {
  const order = readSftpColumnLayout().order;
  if (list?.classList.contains("sftp-actions-more-only")) return order.filter(key => key === "name");
  if (list?.classList.contains("sftp-actions-minimal")) return order.filter(key => key !== "access");
  return order;
}

function sftpLayoutTrackKeys(list: HTMLElement | null) {
  return [...visibleSftpColumnKeys(list), SFTP_ACTION_COLUMN_KEY];
}

function sftpActionsColumnWidth(list: HTMLElement | null, actionWeight=readSftpColumnLayout().actionWeight) {
  const width = Math.max(0, Number(list?.clientWidth || list?.getBoundingClientRect?.().width || 0));
  if (list?.classList.contains("sftp-actions-more-only")) return 54;
  const ratio = Math.max(SFTP_COLUMN_MIN_WEIGHT, Number(actionWeight || 0)) / SFTP_ACTION_COLUMN_REFERENCE_WEIGHT;
  if (list?.classList.contains("sftp-actions-compact")) return Math.min(200, Math.max(SFTP_COLUMN_SAFE_MIN_PIXELS, Math.round(132 * ratio)));
  if (list?.classList.contains("sftp-actions-medium")) {
    const base = Math.min(400, Math.max(250, Math.round(width * .4)));
    return Math.min(480, Math.max(SFTP_COLUMN_SAFE_MIN_PIXELS, Math.round(base * ratio)));
  }
  const base = Math.min(560, Math.max(420, Math.round(width * .31)));
  return Math.min(560, Math.max(SFTP_COLUMN_SAFE_MIN_PIXELS, Math.round(base * ratio)));
}

function sftpUsesFixedActionTrack(list: HTMLElement | null) {
  return list?.classList.contains("sftp-actions-medium")
    || list?.classList.contains("sftp-actions-compact")
    || list?.classList.contains("sftp-actions-more-only");
}

function sftpActionColumnBaseWidth(list: HTMLElement | null) {
  return sftpActionsColumnWidth(list, SFTP_ACTION_COLUMN_REFERENCE_WEIGHT);
}

function applySftpColumnLayout(list: HTMLElement | null) {
  if (!list) return;
  if (list.dataset.sftpPixelColumns === "1") { syncSftpColumnVisibility(list); return; }
  const layout = readSftpColumnLayout();
  const fixedActions = sftpUsesFixedActionTrack(list);
  const columns = sftpLayoutTrackKeys(list).map(key => {
    if (key !== SFTP_ACTION_COLUMN_KEY) return `minmax(0,${layout.weights[key]}fr)`;
    return fixedActions ? `${sftpActionsColumnWidth(list, layout.actionWeight)}px` : `minmax(0,${layout.actionWeight}fr)`;
  });
  list.style.setProperty("--sftp-grid-columns", ["36px", ...columns].join(" "));
  list.style.removeProperty("--sftp-grid-min-width");
  syncSftpColumnVisibility(list);
}

function syncSftpListLayout(list: HTMLElement | null, measuredWidth?: number) {
  if (!list) return;
  const width = Number(measuredWidth) || list.getBoundingClientRect().width;
  const lockedWidth = Number(list.dataset.sftpPixelColumnsWidth || 0);
  if (lockedWidth > 0 && Math.abs(width - lockedWidth) > 1) releaseSftpPixelColumnLayout(list);
  const mobile = Boolean(port.mobile?.());
  list.classList.toggle("sftp-actions-medium", width > 0 && width <= 1200);
  list.classList.toggle("sftp-actions-compact", width > 0 && width <= 1000);
  list.classList.toggle("sftp-actions-minimal", width > 0 && width <= 620);
  list.classList.toggle("sftp-actions-more-only", width > 0 && (width <= 520 || mobile));
  applySftpColumnLayout(list);
}

function syncSftpListScrollCue(list: HTMLElement | null) {
  if (!list) return;
  const hasMoreBelow = list.scrollHeight - list.scrollTop - list.clientHeight > 2;
  list.classList.toggle("has-scroll-below", hasMoreBelow);
}

function watchSftpListLayout(list: HTMLElement | null, tabKey=port.activeKey()) {
  const runtime = port.ensureRuntime?.(tabKey) || port.runtime?.(tabKey);
  if (!list || !runtime) return;
  runtime.resizeObserver?.disconnect();
  if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
  runtime.resizeObserver = null;
  runtime.resizeFrame = 0;
  syncSftpListLayout(list);
  if (list.dataset.sftpScrollCueBound !== "1") {
    list.dataset.sftpScrollCueBound = "1";
    list.addEventListener("scroll", () => syncSftpListScrollCue(list), {passive:true});
  }
  syncSftpListScrollCue(list);
  requestAnimationFrame(() => syncSftpListScrollCue(list));
  if (typeof ResizeObserver !== "function") return;
  runtime.resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect?.width;
    if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
    runtime.resizeFrame = requestAnimationFrame(() => {
      runtime.resizeFrame = 0;
      if (!list.isConnected) return;
      syncSftpListLayout(list, width);
      syncSftpListScrollCue(list);
    });
  });
  runtime.resizeObserver.observe(list);
}

function syncSftpColumnVisibility(list: HTMLElement | null) {
  if (!list) return;
  for (const key of SFTP_COLUMN_KEYS) {
    const head = list.querySelector(`.sftp-head-cell[data-sftp-column="${key}"]`);
    const width = Number(head?.getBoundingClientRect?.().width || 0);
    const narrow = width > 0 && width < (key === "name" ? 92 : key === "access" ? 68 : 48);
    list.querySelectorAll(`.sftp-column-${key}`).forEach(node => node.classList.toggle("is-too-narrow", narrow));
  }
  fitSftpRowActions(list);
}

function releaseSftpPixelColumnLayout(list: HTMLElement | null) {
  if (!list || list.dataset.sftpPixelColumns !== "1") return;
  delete list.dataset.sftpPixelColumns;
  delete list.dataset.sftpPixelColumnsWidth;
  list.style.removeProperty("--sftp-grid-columns");
}

function sftpMeasuredTrackWidths(list: HTMLElement, tracks=sftpLayoutTrackKeys(list)) {
  return new Map(tracks.map(key => [key, Math.max(0, Number(sftpTrackElement(list, key)?.getBoundingClientRect?.().width || 0))]));
}

function lockSftpPixelColumnLayout(list: HTMLElement | null, tracks: string[], widths: Map<string,number>) {
  if (!list) return;
  list.dataset.sftpPixelColumns = "1";
  list.dataset.sftpPixelColumnsWidth = String(Math.max(0, Number(list.getBoundingClientRect?.().width || list.clientWidth || 0)));
  list.style.setProperty("--sftp-grid-columns", ["36px", ...tracks.map(key => `${Math.max(SFTP_COLUMN_SAFE_MIN_PIXELS, Number(widths.get(key) || 0))}px`)].join(" "));
}

function refreshSftpColumnLayouts() {
  document.querySelectorAll<HTMLElement>(".sftp-list").forEach(list => {
    releaseSftpPixelColumnLayout(list);
    applySftpColumnLayout(list);
    const tabKey = String(list.dataset.sftpTabKey || port.activeKey() || "");
    if (port.exists(tabKey)) port.render(tabKey);
  });
}

function persistSftpColumnOrder(sourceKey: string, targetKey: string, after=false) {
  if (!SFTP_COLUMN_KEYS.includes(sourceKey) || !SFTP_COLUMN_KEYS.includes(targetKey) || sourceKey === targetKey) return;
  const layout = readSftpColumnLayout();
  layout.order = layout.order.filter(key => key !== sourceKey);
  const targetIndex = layout.order.indexOf(targetKey);
  layout.order.splice(Math.max(0, targetIndex + (after ? 1 : 0)), 0, sourceKey);
  writeSftpColumnLayout(layout);
  document.querySelectorAll<HTMLElement>(".sftp-list").forEach(list => {
    releaseSftpPixelColumnLayout(list);
    const tabKey = String(list.dataset.sftpTabKey || port.activeKey() || "");
    if (port.exists(tabKey)) port.render(tabKey);
  });
}

function sftpResizePair(list: HTMLElement, key: string) {
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
  const currentMin = SFTP_COLUMN_MIN_PIXELS;
  const nextMin = SFTP_COLUMN_MIN_PIXELS;
  if (total < currentMin + nextMin) return null;
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

function layoutValueForSftpColumn(layout: SftpColumnLayout, key: string) {
  return key === SFTP_ACTION_COLUMN_KEY ? layout.actionWeight : layout.weights[key];
}

function sftpTrackElement(list: HTMLElement, key: string) {
  return key === SFTP_ACTION_COLUMN_KEY
    ? list.querySelector(".sftp-head-actions")
    : list.querySelector(`.sftp-head-cell[data-sftp-column="${key}"]`);
}

function rebaseSftpColumnLayout(list: HTMLElement, source=readSftpColumnLayout()) {
  const layout = normalizeSftpColumnLayout(source);
  const tracks = sftpLayoutTrackKeys(list);
  const fixedActions = sftpUsesFixedActionTrack(list);
  const weightedKeys = fixedActions ? tracks.filter(key => key !== SFTP_ACTION_COLUMN_KEY) : tracks;
  const widths = new Map(weightedKeys.map(key => [key, Math.max(0, Number(sftpTrackElement(list, key)?.getBoundingClientRect?.().width || 0))]));
  const totalWidth = [...widths.values()].reduce((total, width) => total + width, 0);
  const totalWeight = weightedKeys.reduce((total, key) => total + Math.max(SFTP_COLUMN_MIN_WEIGHT, Number(layoutValueForSftpColumn(layout, key) || 0)), 0);
  if (totalWidth > 0 && totalWeight > 0) {
    for (const key of weightedKeys) {
      const value = Math.max(SFTP_COLUMN_MIN_WEIGHT, (widths.get(key) || 0) / totalWidth * totalWeight);
      if (key === SFTP_ACTION_COLUMN_KEY) layout.actionWeight = value;
      else layout.weights[key] = value;
    }
  }
  if (fixedActions && tracks.includes(SFTP_ACTION_COLUMN_KEY)) {
    const actionWidth = Math.max(0, Number(sftpTrackElement(list, SFTP_ACTION_COLUMN_KEY)?.getBoundingClientRect?.().width || 0));
    const baseWidth = sftpActionColumnBaseWidth(list);
    if (actionWidth > 0 && baseWidth > 0) layout.actionWeight = actionWidth / baseWidth * SFTP_ACTION_COLUMN_REFERENCE_WEIGHT;
  }
  return layout;
}

function prepareSftpColumnResize(list: HTMLElement, key: string) {
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

function setSftpColumnPairWidth(layout: SftpColumnLayout, pair: NonNullable<ReturnType<typeof sftpResizePair>>, currentWidth: number) {
  const currentSafeMin = Math.max(pair.currentMin, SFTP_COLUMN_SAFE_MIN_PIXELS);
  const nextSafeMin = Math.max(pair.nextMin, SFTP_COLUMN_SAFE_MIN_PIXELS);
  const minimum = Math.min(currentSafeMin, Math.max(SFTP_COLUMN_SAFE_MIN_PIXELS, pair.total - nextSafeMin));
  const maximum = Math.max(minimum, pair.total - nextSafeMin);
  const bounded = Math.max(minimum, Math.min(maximum, currentWidth));
  if (pair.nextKey === SFTP_ACTION_COLUMN_KEY && pair.actionWidthBase > 0) {
    const nextWidth = pair.total - bounded;
    if (pair.dataPixelsPerWeight > 0) layout.weights[pair.key] = Math.round((bounded / pair.dataPixelsPerWeight) * 1000) / 1000;
    layout.actionWeight = Math.round((nextWidth / pair.actionWidthBase) * SFTP_ACTION_COLUMN_REFERENCE_WEIGHT * 1000) / 1000;
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

function applySftpColumnResize(list: HTMLElement, prepared: NonNullable<ReturnType<typeof prepareSftpColumnResize>>, currentWidth: number) {
  const result = setSftpColumnPairWidth(prepared.layout, prepared.pair, currentWidth);
  if (!result) return;
  prepared.widths.set(prepared.pair.key, result.currentWidth);
  prepared.widths.set(prepared.pair.nextKey, result.nextWidth);
  lockSftpPixelColumnLayout(list, prepared.tracks, prepared.widths);
  syncSftpColumnVisibility(list);
  writeSftpColumnLayout(prepared.layout);
  document.querySelectorAll<HTMLElement>(".sftp-list").forEach(other => {
    if (other !== list) applySftpColumnLayout(other);
  });
}

function beginSftpColumnResize(event: PointerEvent, list: HTMLElement, key: string) {
  if (event.button !== 0 || !SFTP_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareSftpColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const handle = event.currentTarget instanceof Element ? event.currentTarget : null;
  const pointerId = event.pointerId;
  list.classList.add("sftp-column-resizing");
  try { handle?.setPointerCapture?.(event.pointerId); } catch {}
  const move = (moveEvent: PointerEvent) => {
    if (pointerId != null && moveEvent.pointerId != null && moveEvent.pointerId !== pointerId) return;
    applySftpColumnResize(list, prepared, pair.currentWidth + moveEvent.clientX - startX);
  };
  const finish = (finishEvent: PointerEvent) => {
    if (pointerId != null && finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return;
    list.classList.remove("sftp-column-resizing");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    try { handle?.releasePointerCapture?.(pointerId); } catch {}
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}

function resizeSftpColumnByKeyboard(event: KeyboardEvent, list: HTMLElement, key: string) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !SFTP_COLUMN_KEYS.includes(key)) return;
  const prepared = prepareSftpColumnResize(list, key);
  if (!prepared) return;
  const {pair} = prepared;
  event.preventDefault();
  applySftpColumnResize(list, prepared, pair.currentWidth + (event.key === "ArrowLeft" ? -16 : 16));
}

function bindSftpColumnControls(list: HTMLElement | null) {
  if (!list) return;
  list.dataset.sftpColumnsBound = "1";
  list.querySelectorAll<HTMLElement>("[data-sftp-column-resize]").forEach(handle => {
    const key = handle.dataset.sftpColumnResize || "";
    const canResize = Boolean(sftpResizePair(list, key));
    handle.hidden = !canResize;
    if (!canResize || resizeBindings.has(handle)) return;
    resizeBindings.add(handle);
    handle.addEventListener("pointerdown", event => beginSftpColumnResize(event, list, key));
    handle.addEventListener("keydown", event => resizeSftpColumnByKeyboard(event, list, key));
  });
  list.querySelectorAll<HTMLElement>("[data-sftp-column]").forEach(cell => {
    if (dragBindings.has(cell)) return;
    dragBindings.add(cell);
    cell.addEventListener("dragstart", event => {
      if ((event.target instanceof Element ? event.target : null)?.closest("[data-sftp-column-resize]")) return event.preventDefault();
      sftpColumnDragKey = cell.dataset.sftpColumn || "";
      event.dataTransfer!.effectAllowed = "move";
      event.dataTransfer!.setData("application/x-terma-sftp-column", sftpColumnDragKey);
      cell.classList.add("dragging");
    });
    cell.addEventListener("dragover", event => {
      if (!sftpColumnDragKey || sftpColumnDragKey === cell.dataset.sftpColumn) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "move";
      cell.classList.add("drop-target");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
    cell.addEventListener("drop", event => {
      if (!sftpColumnDragKey) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      persistSftpColumnOrder(sftpColumnDragKey, cell.dataset.sftpColumn || "", event.clientX >= rect.left + rect.width / 2);
      sftpColumnSortSuppressedUntil = Date.now() + 400;
    });
    cell.addEventListener("dragend", () => {
      sftpColumnDragKey = "";
      list.querySelectorAll(".sftp-head-cell").forEach(node => node.classList.remove("dragging", "drop-target"));
    });
  });
  list.querySelectorAll<HTMLElement>("[data-sftp-column-sort]").forEach(button => {
    if (sortBindings.has(button)) return;
    sortBindings.add(button);
    button.addEventListener("click", () => {
      if (Date.now() < sftpColumnSortSuppressedUntil) return;
      port.sort(button.dataset.sftpColumnSort || "name", button.dataset.sftpTabKey || port.activeKey());
    });
  });
  applySftpColumnLayout(list);
}

return {defaultSftpColumnLayout,normalizeSftpColumnLayout,readSftpColumnLayout,writeSftpColumnLayout,visibleSftpColumnKeys,sftpLayoutTrackKeys,sftpActionsColumnWidth,sftpUsesFixedActionTrack,sftpActionColumnBaseWidth,applySftpColumnLayout,syncSftpListLayout,syncSftpListScrollCue,watchSftpListLayout,syncSftpColumnVisibility,releaseSftpPixelColumnLayout,sftpMeasuredTrackWidths,lockSftpPixelColumnLayout,refreshSftpColumnLayouts,persistSftpColumnOrder,sftpResizePair,layoutValueForSftpColumn,sftpTrackElement,rebaseSftpColumnLayout,prepareSftpColumnResize,setSftpColumnPairWidth,applySftpColumnResize,beginSftpColumnResize,resizeSftpColumnByKeyboard,bindSftpColumnControls};
}


export interface InstalledFeaturesFilesSftpColumnLayoutServices {
  termaSftpColumns: ReturnType<typeof createSftpColumns> & {storageKey: typeof SFTP_COLUMN_LAYOUT_STORAGE_KEY};
}
