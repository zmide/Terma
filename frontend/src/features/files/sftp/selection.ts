export interface SftpSelectionEvent {
  shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean;
  preserveSelection?: boolean; forceSingle?: boolean;
}

/** Selection rules are independent of focus, paint timing and the active workspace pane. */
export function sftpSelection(paths: string[], selected: string[], anchor: string, path: string,
  event: SftpSelectionEvent = {}, checkbox = false) {
  const current = paths.indexOf(path), checked = new Set(selected.filter(value => paths.includes(value)));
  if (current < 0 || event.preserveSelection) return {paths: [...checked], anchor};
  const start = paths.indexOf(anchor);
  if (event.shiftKey && start >= 0) {
    if (!event.ctrlKey && !event.metaKey) checked.clear();
    for (let index = Math.min(start, current); index <= Math.max(start, current); index++) checked.add(paths[index]);
    return {paths: paths.filter(value => checked.has(value)), anchor};
  }
  // A native checkbox click has already changed its checked state.
  if (!checkbox) {
    if (event.ctrlKey || event.metaKey || (!event.forceSingle && checked.size >= 2)) {
      if (checked.has(path)) checked.delete(path); else checked.add(path);
    } else { checked.clear(); checked.add(path); }
  }
  return {paths: paths.filter(value => checked.has(value)), anchor: path};
}
