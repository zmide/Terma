export interface InlineRenameEntry {
  path: string;
  name: string;
  type: string;
}

export interface InlineRenameController {
  click(label: HTMLElement, entry: InlineRenameEntry): void;
  begin(label: HTMLElement, entry: InlineRenameEntry): void;
  cancel(): void;
  dispose(): void;
}

interface RenameOptions {
  mobile: () => boolean;
  isSelected: (path: string) => boolean;
  hasSingleSelection: () => boolean;
  rename: (entry: InlineRenameEntry, next: string) => Promise<void> | void;
  notify: (message: string) => void;
  invalidName: () => string;
  ariaLabel: () => string;
  conflictName: () => string;
}

function parentRemotePath(path: string) {
  const clean = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const index = clean.lastIndexOf('/');
  return index <= 0 ? (clean.startsWith('/') ? '/' : '.') : clean.slice(0, index);
}

export function createSftpInlineRenameController(options: RenameOptions): InlineRenameController {
  let editor: { cancel: () => void } | null = null;
  let armedPath = '';
  let pendingPath = '';
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let renameTimer: ReturnType<typeof setTimeout> | null = null;

  const clearClickIntent = () => {
    if (armTimer) clearTimeout(armTimer);
    if (renameTimer) clearTimeout(renameTimer);
    armTimer = null;
    renameTimer = null;
    armedPath = '';
    pendingPath = '';
  };

  const cancel = () => {
    clearClickIntent();
    editor?.cancel();
    editor = null;
  };

  const begin = (label: HTMLElement, entry: InlineRenameEntry) => {
    if (options.mobile() || !label.isConnected) return;
    editor?.cancel();
    const row = label.closest<HTMLElement>('.sftp-row');
    if (!row) return;
    const field = document.createElement('input');
    const labelRect = label.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const dot = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
    field.type = 'text';
    field.value = entry.name;
    field.className = 'sftp-inline-rename-input';
    field.setAttribute('aria-label', options.ariaLabel());
    Object.assign(field.style, {
      position: 'absolute',
      left: `${Math.max(0, labelRect.left - rowRect.left)}px`,
      top: `${Math.max(0, labelRect.top - rowRect.top - 3)}px`,
      width: `${Math.min(rowRect.right - labelRect.left - 8, Math.max(120, labelRect.width + 28))}px`,
      zIndex: '5'
    });
    row.classList.add('sftp-inline-renaming');
    label.style.visibility = 'hidden';
    row.appendChild(field);
    let finished = false;
    const errorBox = document.createElement('span');
    errorBox.className = 'sftp-inline-rename-error';
    errorBox.id = `sftp-rename-error-${Math.random().toString(36).slice(2)}`;
    errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
    row.appendChild(errorBox);
    let lastError: unknown = null;
    const translateError = () => {
      field.setAttribute('aria-label', options.ariaLabel());
      if (!lastError || finished) return;
      const error = lastError as Error & { publicCode?: string };
      errorBox.textContent = error.publicCode === 'sftp_rename_exists' ? options.conflictName() : error.message || String(lastError);
    };
    window.addEventListener('terma:language-changed', translateError);
    const finish = () => {
      if (finished) return;
      finished = true;
      label.style.visibility = '';
      field.remove();
      errorBox.remove();
      window.removeEventListener('terma:language-changed', translateError);
      row.classList.remove('sftp-inline-renaming');
      if (editor?.cancel === finish) editor = null;
    };
    editor = { cancel: finish };
    const save = async () => {
      if (finished || field.disabled) return;
      const next = field.value;
      if (next === entry.name) return finish();
      if (!next.trim() || next === '.' || next === '..' || /[\\/\0\r\n]/.test(next)) {
        options.notify(options.invalidName());
        field.focus();
        return;
      }
      field.disabled = true;
      errorBox.hidden = true; field.removeAttribute('aria-invalid');
      try {
        await options.rename(entry, next);
        finish();
      } catch (error) {
        if (finished) return;
        field.disabled = false;
        lastError = error; translateError(); errorBox.hidden = false;
        field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', errorBox.id);
        field.focus();
      }
    };
    for (const event of ['click', 'dblclick', 'pointerdown']) field.addEventListener(event, value => value.stopPropagation());
    field.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      else if (event.key === 'Enter') { event.preventDefault(); void save(); }
    });
    field.addEventListener('blur', () => { if (!field.disabled) void save(); });
    field.focus();
    field.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  };

  return {
    click(label, entry) {
      if (options.mobile() || !label.isConnected) { clearClickIntent(); return; }
      const path = String(entry.path || '');
      if (options.isSelected(path) && options.hasSingleSelection() && (armedPath === path || (pendingPath === path && armTimer))) {
        if (armTimer) clearTimeout(armTimer);
        if (renameTimer) clearTimeout(renameTimer);
        armTimer = null;
        renameTimer = setTimeout(() => {
          renameTimer = null;
          armedPath = '';
          pendingPath = '';
          if (options.isSelected(path) && options.hasSingleSelection()) begin(label, entry);
        }, 360);
        return;
      }
      clearClickIntent();
      pendingPath = path;
      armTimer = setTimeout(() => {
        armTimer = null;
        pendingPath = '';
        armedPath = path;
      }, 360);
    },
    begin(label, entry) {
      clearClickIntent();
      if (options.mobile() || !options.isSelected(entry.path) || !options.hasSingleSelection()) return;
      begin(label, entry);
    },
    cancel,
    dispose() { cancel(); }
  };
}

export function sftpInlineRenameTarget(entry: InlineRenameEntry, next: string) {
  const parent = parentRemotePath(entry.path).replace(/\/$/, '');
  return `${parent}/${next}`.replace(/^\/\./, '/');
}
