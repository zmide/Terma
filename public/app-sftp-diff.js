const SFTP_DIFF_MAX_ROWS = 4000;
const SFTP_DIFF_MAX_CHARS = 2 * 1024 * 1024;
const SFTP_EDITOR_LAYOUT_STORAGE_KEY = "termaSftpEditorLayoutV1";

function readSftpEditorLayout() {
  let value = {};
  try { value = JSON.parse(localStorage.getItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY) || "{}"); } catch {}
  return {
    width:Math.max(760, Math.min(1600, Number(value.width) || 1180)),
    height:Math.max(560, Math.min(1100, Number(value.height) || 820)),
    split:Math.max(28, Math.min(76, Number(value.split) || 58))
  };
}

function writeSftpEditorLayout(value) {
  const current = readSftpEditorLayout();
  const supplied = {...current, ...value};
  const next = {
    width:Math.max(760, Math.min(1600, Number(supplied.width) || current.width)),
    height:Math.max(560, Math.min(1100, Number(supplied.height) || current.height)),
    split:Math.max(28, Math.min(76, Number(supplied.split) || current.split))
  };
  localStorage.setItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function applySftpEditorLayout(card, workspace) {
  const layout = readSftpEditorLayout();
  workspace?.style.setProperty("--sftp-editor-split", `${layout.split}%`);
  if (!card || isMobileLayout()) return layout;
  card.style.width = `${Math.min(layout.width, window.innerWidth - 32)}px`;
  card.style.height = `${Math.min(layout.height, window.innerHeight - 32)}px`;
  return layout;
}

function bindSftpEditorLayout(card, workspace, splitter, onResize=()=>{}) {
  applySftpEditorLayout(card, workspace);
  let saveTimer = 0;
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    onResize();
    if (isMobileLayout()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeSftpEditorLayout({width:card.offsetWidth, height:card.offsetHeight}), 120);
  }) : null;
  observer?.observe(card);
  splitter?.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !workspace.classList.contains("showing-diff")) return;
    event.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const handle = event.currentTarget;
    document.body.classList.add("sftp-editor-split-resizing");
    try { handle.setPointerCapture?.(event.pointerId); } catch {}
    const move = moveEvent => {
      const split = Math.max(28, Math.min(76, ((moveEvent.clientY - rect.top) / Math.max(1, rect.height)) * 100));
      workspace.style.setProperty("--sftp-editor-split", `${split}%`);
      workspace.dataset.split = String(split);
      onResize();
    };
    const finish = () => {
      document.body.classList.remove("sftp-editor-split-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      writeSftpEditorLayout({split:Number(workspace.dataset.split) || readSftpEditorLayout().split});
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
  return () => {
    clearTimeout(saveTimer);
    observer?.disconnect();
  };
}

function setSftpEditorDiffVisible(workspace, splitter, preview, visible) {
  workspace?.classList.toggle("showing-diff", Boolean(visible));
  if (splitter) splitter.hidden = !visible;
  if (preview) preview.hidden = !visible;
}

function sftpDiffDisplayTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "时间未知";
  return new Date(timestamp).toLocaleString("zh-CN", {hour12:false});
}

function sftpDiffPartLines(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function sftpDiffLineCell(kind, number, value) {
  const empty = value === null || typeof value === "undefined";
  return `<div class="sftp-diff-cell ${kind}${empty ? " empty" : ""}"><span>${number || ""}</span><code>${empty ? "" : (esc(value) || " ")}</code></div>`;
}

function sftpDiffViewerHtml(oldText, newText, options={}) {
  const previous = String(oldText || "");
  const current = String(newText || "");
  if (previous.length + current.length > SFTP_DIFF_MAX_CHARS) {
    return `<div class="sftp-diff-unavailable">用于比较的文本超过 ${formatBytes(SFTP_DIFF_MAX_CHARS)}，已停止计算以避免界面卡顿；文件仍可正常编辑和保存。</div>`;
  }
  const parts = window.Diff?.diffLines?.(previous, current, {
    stripTrailingCr:true,
    timeout:1500,
    maxEditLength:20000
  });
  if (!parts) return `<div class="sftp-diff-unavailable">文件差异过大，已停止计算以避免界面卡顿。</div>`;
  const rows = [];
  let oldLine = 1;
  let newLine = 1;
  const appendPair = (oldValue, newValue, changed=false) => {
    if (rows.length >= SFTP_DIFF_MAX_ROWS) return false;
    rows.push(`<div class="sftp-diff-row${changed ? " changed" : ""}">${sftpDiffLineCell(oldValue === null ? "blank" : changed ? "removed" : "same", oldValue === null ? 0 : oldLine++, oldValue)}${sftpDiffLineCell(newValue === null ? "blank" : changed ? "added" : "same", newValue === null ? 0 : newLine++, newValue)}</div>`);
    return true;
  };
  const appendCommon = lines => {
    if (lines.length <= 12) return lines.every(line => appendPair(line, line));
    for (const line of lines.slice(0, 4)) if (!appendPair(line, line)) return false;
    const hidden = lines.length - 8;
    oldLine += hidden;
    newLine += hidden;
    rows.push(`<div class="sftp-diff-collapsed"><span>${hidden} 行未变化</span></div>`);
    for (const line of lines.slice(-4)) if (!appendPair(line, line)) return false;
    return true;
  };
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      if (!appendCommon(sftpDiffPartLines(part.value))) break;
      continue;
    }
    const next = parts[index + 1];
    const paired = part.removed && next?.added;
    const oldLines = part.removed ? sftpDiffPartLines(part.value) : [];
    const newLines = part.added ? sftpDiffPartLines(part.value) : paired ? sftpDiffPartLines(next.value) : [];
    if (paired) index += 1;
    const length = Math.max(oldLines.length, newLines.length);
    for (let lineIndex = 0; lineIndex < length; lineIndex += 1) {
      if (!appendPair(oldLines[lineIndex] ?? null, newLines[lineIndex] ?? null, true)) break;
    }
    if (rows.length >= SFTP_DIFF_MAX_ROWS) break;
  }
  if (rows.length >= SFTP_DIFF_MAX_ROWS) rows.push(`<div class="sftp-diff-collapsed"><span>只显示前 ${SFTP_DIFF_MAX_ROWS} 行，请使用外部对比工具查看完整内容</span></div>`);
  const changed = parts.some(part => part.added || part.removed);
  return `<div class="sftp-side-diff${changed ? "" : " no-changes"}"><div class="sftp-diff-columns"><strong>${esc(options.oldLabel || "旧版本")}</strong><strong>${esc(options.newLabel || "新版本")}</strong></div>${changed ? rows.join("") : `<div class="sftp-diff-unavailable">两个版本内容相同。</div>`}</div>`;
}

function openSftpExternalComparison(session, comparison) {
  return new Promise(resolve => {
    const modal = $("modal");
    const conflict = session.status === "conflict";
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-card sftp-comparison-modal" role="dialog" aria-modal="true">
      <div class="sftp-comparison-head"><div><h2>${esc(comparison.remote_path || session.remote_path)}</h2><span>覆盖前请确认左右两侧的变化</span></div><button class="icon-button" data-sftp-compare-choice="" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="sftp-comparison-meta"><span><b>远端当前版本</b>${esc(sftpDiffDisplayTime(comparison.remote_changed_at))} · ${esc(formatBytes(comparison.old_size || 0))}</span><span><b>外部编辑内容</b>${esc(sftpDiffDisplayTime(comparison.local_changed_at))} · ${esc(formatBytes(comparison.new_size || 0))}</span></div>
      <div class="sftp-comparison-body">${sftpDiffViewerHtml(comparison.old_text, comparison.new_text, {oldLabel:comparison.old_label, newLabel:comparison.new_label})}</div>
      <div class="actions sftp-comparison-actions"><button class="danger" data-sftp-compare-choice="${conflict ? "overwrite" : "save"}">${conflict ? "覆盖并备份远端" : "保存到远端"}</button><button data-sftp-compare-choice="save_as">另存为</button><button data-sftp-compare-choice="cancel">取消</button></div>
    </div>`;
    refreshIcons();
    let done = false;
    const finish = choice => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKeyDown, true);
      modal.hidden = true;
      resolve(choice);
    };
    const onKeyDown = event => { if (event.key === "Escape") finish(""); };
    document.addEventListener("keydown", onKeyDown, true);
    modal.querySelectorAll("[data-sftp-compare-choice]").forEach(button => button.addEventListener("click", () => finish(button.dataset.sftpCompareChoice || "")));
  });
}
