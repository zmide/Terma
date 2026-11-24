import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {filesServices} from '@/features/files/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { render } from 'vue';
import { sftpDialogView } from './SftpDialogViews';
import { changedPrincipal, emptyPermissionPrincipals, normalizePermissionPrincipals } from './permission-principals';
import type { FileTextOptions, SftpArchiveOptions, SftpArchiveResult, SftpConfirmation, SftpDialogActions, SftpDialogBase, SftpDialogModel, SftpDirectoryNode, SftpInputOptions, SftpPermissionOptions, SftpRecycleItem, SftpRecycleOptions } from './sftp-dialog-types';
import '@/styles/sftp-dialogs.css';



type Owner = { host: HTMLElement; modal: HTMLElement; model: SftpDialogModel; actions: SftpDialogActions; options: SftpDialogBase; trigger: HTMLElement | null; finish: (value: unknown) => void; cleanup: () => void; token: number; confirmAction: (() => void) | null };
let current: Owner | null = null;

function paint(owner = current) {
  if (!owner || owner !== current) return;
  const active = document.activeElement;
  const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd, active.selectionDirection] as const : null;
  const scroll = [...owner.host.querySelectorAll<HTMLElement>('*')].filter(node => node.scrollTop || node.scrollLeft).map(node => [node, node.scrollTop, node.scrollLeft] as const);
  owner.host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  render(sftpDialogView(owner.model, owner.actions), owner.host);
  if (active instanceof HTMLElement && owner.host.contains(active) && active.isConnected) {
    active.focus({ preventScroll: true });
    if (selection?.[0] != null && selection[1] != null && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      try { active.setSelectionRange(selection[0], selection[1], selection[2] || undefined); } catch { /* Numeric fields have no caret range. */ }
    }
  }
  scroll.forEach(([node, top, left]) => { if (node.isConnected) { node.scrollTop = top; node.scrollLeft = left; } });
}

function release(value: unknown = null, focus = true) {
  const owner = current;
  if (!owner) return;
  current = null;
  owner.cleanup();
  render(null, owner.host);
  if (owner.host.parentNode === owner.modal) { owner.host.remove(); if (!owner.modal.childElementCount) owner.modal.hidden = true; }
  owner.finish(value);
  if (focus && owner.trigger?.isConnected) owner.trigger.focus({ preventScroll: true });
}

function valid(owner: Owner) {
  if (current !== owner) return false;
  if (owner.options.valid && !owner.options.valid()) { release(); return false; }
  return true;
}

function begin(kind: SftpDialogModel['kind'], options: SftpDialogBase, finish: Owner['finish'] = () => {}) {
  const modal = document.getElementById('modal');
  if (!modal) { options.dispose?.(); finish(null); return null; }
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  release(null, false);
  terminalServices.termaTerminalViews?.releaseDialog(); remoteServices.termaRemoteViews?.releaseDialog();
  connectionsServices.termaConnectionViews?.release(modal); quickServices.termaQuickViews?.release(modal);
  unmountSettingsDialog(); workspaceServices.termaWorkspaceViews?.unmountDialog();
  const host = document.createElement('div');
  host.className = 'terma-vue-root terma-sftp-dialog-root'; host.setAttribute('data-i18n-skip', ''); host.dataset.sftpDialog = kind;
  modal.replaceChildren(host); modal.onclick = null; modal.onkeydown = null; modal.hidden = false;
  const model: SftpDialogModel = { kind, tr: options.tr, busy: false, error: '', mode: '', owner: '', group: '', originalOwner: '', originalGroup: '', recursive: false,
    principals: emptyPermissionPrincipals(), principalsLoading: false,
    value: '', titleKey: '', labelKey: '', count: 0, mixedMode: false, hasDirectory: false, readOnly: false, confirmation: null,
    archiveMode: '', filename: '', path: '', target: '.', encoding: 'utf8', encodings: [], overwrite: true, namedFolder: false,
    browser: false, browserPath: '.', browserLoading: false, browserError: '', directories: [], newDirectory: false, newName: '', recycle: null, page: 1 };
  const owner: Owner = { host, modal, model, options, trigger, finish, token: 0, confirmAction: null, cleanup: () => {}, actions: {
    close: () => { if (current === owner && !model.busy) release(); }, submit: () => {},
    cancelConfirmation: () => { if (!model.busy) { if (model.kind === 'confirm') release(false); else { model.confirmation = null; owner.confirmAction = null; paint(); queueMicrotask(() => host.querySelector<HTMLElement>('#sftpRecycleClose')?.focus()); } } },
    change: (key, value) => { if (valid(owner) && !model.busy) { Object.assign(model, { [key]: value }); model.error = ''; paint(); } },
    permission: () => {}, browse: () => {}, expand: () => {}, recycle: () => {}
  } };
  current = owner;
  const keydown = (event: KeyboardEvent) => {
    if (current !== owner) return;
    if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('.sftp-principal-picker')?.querySelector('[role=listbox]')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (model.confirmation) owner.actions.cancelConfirmation(); else owner.actions.close(); }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !['checkbox', 'button'].includes(event.target.type)) { event.preventDefault(); if (event.target.id === 'sftpArchiveNewName') owner.actions.browse('mkdir'); else owner.actions.submit(); }
    if (event.key !== 'Tab') return;
    const fields = [...host.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.checkVisibility());
    const first = fields[0], last = fields.at(-1);
    if (first && event.shiftKey && (activeElement() === first || !host.contains(activeElement()))) { event.preventDefault(); last?.focus(); }
    else if (first && !event.shiftKey && (activeElement() === last || !host.contains(activeElement()))) { event.preventDefault(); first.focus(); }
  };
  const observer = new MutationObserver(() => { if (current !== owner) return; if (modal.hidden || host.parentNode !== modal) release(null, false); else host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; });
  observer.observe(modal, { attributes: true, attributeFilter: ['hidden'], childList: true });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('keydown', keydown, true);
  owner.cleanup = () => { observer.disconnect(); document.removeEventListener('keydown', keydown, true); options.dispose?.(); };
  queueMicrotask(() => { if (current !== owner) return; (host.querySelector<HTMLElement>('#sftpConfirmationCancel') || host.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)'))?.focus({ preventScroll: true }); });
  return owner;
}
function activeElement() { return document.activeElement; }

export function installSftpDialogs() {
  window.addEventListener('terma:language-changed', () => paint());
  filesServices.termaSftpDialogs = {
    release: () => release(), active: () => current?.model.kind || null,
    text(options) {
      const owner=begin('text',options);if(!owner)return;
      Object.assign(owner.model,{filename:options.name,path:options.path,value:options.content,readOnly:!options.writable});
      let failure:unknown=null;
      const errorText=()=>failure?(options.errorText?.(failure)||(failure instanceof Error?failure.message:String(failure))):'';
      const translate=()=>{if(current===owner){owner.model.error=errorText();paint(owner);}};
      window.addEventListener('terma:language-changed',translate);
      const cleanup=owner.cleanup;owner.cleanup=()=>{window.removeEventListener('terma:language-changed',translate);cleanup();};
      owner.actions.submit=async()=>{
        if(!valid(owner)||owner.model.busy||owner.model.readOnly)return;
        const content=owner.model.value;owner.model.busy=true;owner.model.error='';failure=null;paint(owner);
        try{await options.save(content);if(valid(owner))release();}
        catch(error){if(valid(owner)){failure=error;owner.model.busy=false;owner.model.error=errorText();paint(owner);}}
      };
      paint(owner);queueMicrotask(()=>{if(current===owner)owner.host.querySelector<HTMLTextAreaElement>('textarea')?.focus();});
    },
    input: options => new Promise(resolve => {
      const owner = begin('input', options, value => resolve(typeof value === 'string' ? value : null)); if (!owner) return;
      Object.assign(owner.model, { value: options.value, titleKey: options.titleKey, labelKey: options.labelKey });
      let failure: unknown = null;
      const translateError = () => { if (current === owner && failure) { owner.model.error = options.errorText?.(failure) || (failure instanceof Error ? failure.message : String(failure)); paint(); } };
      window.addEventListener('terma:language-changed', translateError);
      const cleanup = owner.cleanup;
      owner.cleanup = () => { window.removeEventListener('terma:language-changed', translateError); cleanup(); };
      owner.actions.submit = async () => {
        if (!valid(owner) || owner.model.busy) return;
        const value = owner.model.value.trim();
        if (!value || (options.validate && !options.validate(value))) return;
        if (!options.apply) return release(value);
        owner.model.busy = true; owner.model.error = ''; failure = null; paint();
        try { await options.apply(value); if (valid(owner)) release(value); }
        catch (error) {
          if (current !== owner) return;
          owner.model.busy = false; failure = error; translateError();
          owner.host.querySelector<HTMLInputElement>('#modalInputValue')?.focus();
        }
      };
      paint(); queueMicrotask(() => owner.host.querySelector<HTMLInputElement>('#modalInputValue')?.select());
    }),
    confirm: options => new Promise(resolve => {
      const owner = begin('confirm', options, value => resolve(value === true)); if (!owner) return;
      owner.model.confirmation = options.content;
      owner.actions.submit = () => { if (valid(owner)) release(true); }; paint();
    }),
    permissions(options) {
      const owner = begin('permissions', options); if (!owner) return;
      const m = owner.model; Object.assign(m, options.metadata, { count: options.count, originalOwner: options.metadata.owner, originalGroup: options.metadata.group });
      owner.actions.permission = (prefix, bit, checked) => {
        if (!valid(owner) || m.busy) return;
        const digits = /^[0-7]{3}$/.test(m.mode) ? [...m.mode].map(Number) : [0, 0, 0]; const index = ['owner', 'group', 'public'].indexOf(prefix); if (index < 0) return;
        digits[index] = checked ? digits[index] | bit : digits[index] & ~bit; m.mode = digits.join(''); paint();
      };
      owner.actions.submit = async () => {
        if (!valid(owner) || m.busy || !/^[0-7]{3}$/.test(m.mode)) return;
        m.busy = true; m.error = ''; paint();
        try { await options.apply({ mode: m.mode, owner: changedPrincipal(m.owner, m.originalOwner, m.principals.users, 'owner'), group: changedPrincipal(m.group, m.originalGroup, m.principals.groups, 'group'), recursive: m.recursive }); if (valid(owner)) release(); }
        catch (error) { if (current === owner) { m.busy = false; m.error = error instanceof Error ? error.message : options.tr('sftp:permissions_editor.update_failed'); paint(); } }
      }; paint();
      if (options.principals) {
        m.principalsLoading = true; paint();
        Promise.resolve().then(options.principals).then(principals => {
          if (valid(owner)) m.principals = normalizePermissionPrincipals(principals);
        }).catch(() => {}).finally(() => { if (valid(owner)) { m.principalsLoading = false; paint(); } });
      }
    },
    archive: options => new Promise(resolve => {
      const owner = begin('archive', options, value => resolve(value as SftpArchiveResult | null)); if (!owner) return;
      const m = owner.model; Object.assign(m, { archiveMode: options.mode, filename: options.filename, path: options.path, target: options.target, encoding: options.encoding, encodings: options.encodings, titleKey: options.titleKey || '', browserPath: options.target });
      let baseTarget = options.target;
      const syncTarget = () => { m.target = m.namedFolder ? options.join(baseTarget, options.folderName) : baseTarget; };
      const nodes = (data: Awaited<ReturnType<SftpArchiveOptions['list']>>) => (data.entries || []).filter(item => ['dir', 'directory'].includes(item.type)).map(item => ({ path: options.join(data.path, item.name), name: item.name, expanded: false, loading: false, error: '', children: [] } as SftpDirectoryNode));
      const load = async (path: string) => {
        if (!valid(owner)) return; const token = ++owner.token; m.browserPath = path; m.browserLoading = true; m.browserError = ''; paint();
        try { const data = await options.list(path); if (!valid(owner) || token !== owner.token) return; m.browserPath = data.path; m.directories = nodes(data); }
        catch (error) { if (current === owner && token === owner.token) m.browserError = error instanceof Error ? error.message : options.tr('sftp:archive.directory_read_failed'); }
        finally { if (current === owner && token === owner.token) { m.browserLoading = false; paint(); } }
      };
      owner.actions.change = (key, value) => { if (!valid(owner) || m.busy) return; Object.assign(m, { [key]: value }); if (key === 'target') baseTarget = m.namedFolder && m.target.endsWith('/' + options.folderName) ? m.target.slice(0, -options.folderName.length - 1) || '/' : m.target; if (key === 'namedFolder') syncTarget(); m.error = ''; paint(); };
      owner.actions.browse = async (action, path) => {
        if (!valid(owner) || m.busy) return;
        if (action === 'toggle') { m.browser = !m.browser; paint(); if (m.browser) await load(baseTarget); }
        if (action === 'load' || action === 'refresh' || action === 'parent') await load(action === 'parent' ? options.parent(m.browserPath) : path || m.browserPath);
        if (action === 'select' && !m.browserLoading && !m.browserError) { baseTarget = m.browserPath; syncTarget(); m.browser = false; paint(); }
        if (action === 'new') { m.newDirectory = !m.newDirectory; paint(); queueMicrotask(() => owner.host.querySelector<HTMLInputElement>('#sftpArchiveNewName')?.focus()); }
        if (action === 'mkdir' && m.newName.trim()) { m.busy = true; paint(); try { await options.mkdir(m.browserPath, m.newName.trim()); if (!valid(owner)) return; m.newDirectory = false; m.newName = ''; await load(m.browserPath); } catch (error) { if (current === owner) m.error = error instanceof Error ? error.message : options.tr('sftp:operations.create_directory_failed'); } finally { if (current === owner) { m.busy = false; paint(); } } }
      };
      owner.actions.expand = async node => {
        if (!valid(owner) || m.busy || node.loading) return; node.expanded = !node.expanded;
        if (!node.expanded || node.children.length) { paint(); return; } node.loading = true; node.error = ''; paint();
        try { const data = await options.list(node.path); if (valid(owner)) node.children = nodes(data); } catch (error) { if (current === owner) node.error = error instanceof Error ? error.message : options.tr('sftp:archive.directory_read_failed'); } finally { if (current === owner) { node.loading = false; paint(); } }
      };
      owner.actions.submit = () => {
        if (!valid(owner) || m.busy) return;
        if (options.mode === 'extract') { if (!m.target.trim()) { m.error = options.tr('sftp:archive.target_required'); paint(); return; } release({ target: m.target.trim(), encoding: m.encoding, overwrite: m.overwrite, namedFolder: m.namedFolder }); }
        else { if (!m.filename.trim()) { m.error = options.tr('sftp:archive.filename_required'); paint(); return; } release({ filename: m.filename.trim(), encoding: m.encoding }); }
      }; paint();
    }),
    recycle(options) {
      const owner = begin('recycle', options); if (!owner) return;
      const m = owner.model; m.page = options.page;
      const load = async (page = m.page) => {
        if (!valid(owner)) return; const token = ++owner.token; m.browserLoading = true; m.error = ''; paint();
        try { const data = await options.load(page); if (!valid(owner) || token !== owner.token) return; m.recycle = data; m.page = data.page; }
        catch (error) { if (current === owner && token === owner.token) m.error = error instanceof Error ? error.message : options.tr('sftp:recycle_bin.load_failed'); }
        finally { if (current === owner && token === owner.token) { m.browserLoading = false; paint(); } }
      };
      const mutate = async (action: string, item?: SftpRecycleItem) => {
        if (!valid(owner) || m.busy) return; m.confirmation = null; owner.confirmAction = null; m.busy = true; m.error = ''; paint();
        try { if (action === 'restore' && item) await options.restore(item); else if (action === 'delete' && item) await options.remove(item); else if (action === 'clear') await options.clear(); if (valid(owner)) await load(); }
        catch (error) { if (current === owner) m.error = error instanceof Error ? error.message : options.tr('sftp:recycle_bin.load_failed'); }
        finally { if (current === owner) { m.busy = false; paint(); } }
      };
      owner.actions.submit = () => { if (valid(owner) && !m.busy) owner.confirmAction?.(); };
      owner.actions.recycle = (action, item, page) => {
        if (!valid(owner) || m.busy) return;
        if (action === 'load') { void load(page); return; }
        if (action === 'restore') { void mutate(action, item); return; }
        m.confirmation = () => ({ title: options.tr(action === 'clear' ? 'sftp:recycle_bin.clear_title' : 'sftp:recycle_bin.permanent_delete'), message: options.tr(action === 'clear' ? 'sftp:recycle_bin.clear_message' : 'sftp:recycle_bin.delete_message', { name: item?.name || item?.original_path || '' }), confirm: options.tr(action === 'clear' ? 'sftp:recycle_bin.clear_confirm' : 'sftp:recycle_bin.permanent_delete'), danger: true });
        owner.confirmAction = () => { void mutate(action, item); }; paint(); queueMicrotask(() => owner.host.querySelector<HTMLElement>('#sftpConfirmationCancel')?.focus());
      }; void load();
    }
  };
}

export interface InstalledFeaturesFilesSftpSftpDialogMountServices {
  termaSftpDialogs?: {
      input(options: SftpInputOptions): Promise<string | null>;
      text(options: FileTextOptions): void;
      confirm(options: SftpDialogBase & { content: () => SftpConfirmation }): Promise<boolean>;
      permissions(options: SftpPermissionOptions): void;
      archive(options: SftpArchiveOptions): Promise<SftpArchiveResult | null>;
      recycle(options: SftpRecycleOptions): void;
      release(): void;
      active(): string | null;
    };
}
