import {remoteServices} from '@/features/remote/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import { checkFields, settingsTabs, terminalSettingsView, textFields, type TerminalSettingsState } from './TerminalSettingsView';
import type { TerminalPasteOptions, TerminalSettingsPort, TerminalSettingsValues, TerminalShortcut } from './terminal-settings-port';
import { terminalStartupView, type TerminalStartupOptions } from './TerminalStartupView';
import '@/styles/terminal-settings.css';
import '@/styles/terminal-startup.css';

type SettingsOwner = { kind: 'settings'; state: TerminalSettingsState; trigger: HTMLElement | null };
type PasteOwner = { kind: 'paste'; options: TerminalPasteOptions; resolve(value: string | null): void; trigger: HTMLElement | null };
type StartupOwner = { kind: 'startup'; options: TerminalStartupOptions; trigger: HTMLElement | null };
type FontPromptOptions = { value: string; tr: (key: string, params?: Record<string, unknown>) => string; titleKey: string; labelKey: string };
type FontPromptOwner = { kind: 'font-prompt'; options: FontPromptOptions; resolve(value: string | null): void; trigger: HTMLElement | null };
type Owner = SettingsOwner | PasteOwner | StartupOwner | FontPromptOwner;



export function installTerminalDialogs() {
  const element = document.getElementById('modal');
  if (!element) return;
  const target: HTMLElement = element;
  let current: Owner | null = null;
  let nextRowId = 0;
  let observer: MutationObserver | null = null;
  const settings = () => current?.kind === 'settings' ? current.state : null;
  const rememberFields = () => {
    const state = settings();
    if (!state) return;
    for (const [id, value] of Object.entries(state.fields)) {
      const field = target.querySelector<HTMLInputElement | HTMLSelectElement>(`#${CSS.escape(id)}`);
      if (field) state.fields[id] = typeof value === 'boolean' ? (field as HTMLInputElement).checked : field.value;
    }
    const background = target.querySelector<HTMLInputElement>('input[name="terminalSettingBackgroundMode"]:checked');
    if (background) state.backgroundMode = background.value;
    for (const [index, row] of state.rows.entries()) {
      const label = target.querySelector<HTMLInputElement>(`[data-shortcut-label="${index}"]`);
      const enabled = target.querySelector<HTMLInputElement>(`[data-shortcut-enabled="${index}"]`);
      if (label) row.value.label = label.value;
      if (enabled) row.value.enabled = enabled.checked;
    }
  };
  const fillShortcuts = (value: unknown) => {
    const state = settings(); if (!state) return;
    state.rows = state.port.normalizeShortcuts(value).map(value => ({ id: ++nextRowId, value }));
    state.error = false;
  };
  const fill = (state: TerminalSettingsState, values: TerminalSettingsValues) => {
    for (const [id, property] of Object.entries(textFields)) state.fields[id] = property === 'url_prefixes' ? values.url_prefixes.join(' | ') : String(values[property]);
    for (const [id, property] of Object.entries(checkFields)) state.fields[id] = values[property];
    state.backgroundMode = values.background_mode;
    fillShortcuts(values.shortcut_keys);
  };
  const readShortcuts = () => {
    rememberFields();
    const state = settings();
    return state ? state.port.normalizeShortcuts(state.rows.map(row => row.value)) : [];
  };
  const readSettings = (): TerminalSettingsValues | undefined => {
    rememberFields(); const state = settings();
    if (!state) return undefined;
    const values = { ...state.port.settings, background_mode: state.backgroundMode, shortcut_keys: readShortcuts() };
    for (const [id, property] of Object.entries(textFields)) {
      const value = String(state.fields[id] ?? '');
      if (property === 'url_prefixes') values.url_prefixes = value.split(/[|,\s]+/).filter(Boolean);
      else if (property === 'font_size' || property === 'scrollback_lines') values[property] = Number(value);
      else values[property] = property === 'font_family' ? value.trim() : value;
    }
    for (const [id, property] of Object.entries(checkFields)) values[property] = state.fields[id] === true;
    return values;
  };
  const release = (value: string | null = null, focus = false) => {
    if (!current) return;
    const old = current; current = null;
    observer?.disconnect(); observer = null;
    target.removeEventListener('keydown', onKeydown, true);
    if (old.kind === 'paste') {
      const textarea = target.querySelector<HTMLTextAreaElement>('#terminalPasteEditor');
      if (textarea) textarea.value = '';
      old.options.value = '';
      old.resolve(value);
    } else if (old.kind === 'font-prompt') {
      old.resolve(value);
    } else if (old.kind === 'settings') { old.state.fields = {}; old.state.rows = []; }
    render(null, target); target.hidden = true;
    target.classList.remove('terma-vue-root', 'terma-terminal-dialog');
    target.removeAttribute('data-i18n-skip'); delete target.dataset.terminalDialog; delete target.dataset.theme;
    if (focus) {
      if (old.kind === 'settings') old.state.port.close();
      else if (old.trigger?.isConnected) old.trigger.focus({ preventScroll: true });
    }
  };
  const close = () => {
    if (current?.kind === 'startup') current.options.actions.close();
    else if (!settings()?.busy) release(null, true);
  };
  const paint = () => {
    if (!current) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && target.contains(active) ? active : null;
    const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const : null;
    const scroll = [...target.querySelectorAll<HTMLElement>('*')].filter(element => element.scrollTop || element.scrollLeft).map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    if (current.kind === 'settings') render(terminalSettingsView(current.state), target);
    else if (current.kind === 'startup') render(terminalStartupView(current.options), target);
    else if (current.kind === 'paste') {
      const owner = current, options = owner.options, t = options.tr;
      const finish = (value: string | null) => { if (current === owner) release(value, true); };
      const button = (id: string, title: string, action: () => void, glyph = '', className = '') => h(TermaButton, { id, type: 'button', class: className, onClick: action }, () => [glyph ? icon(glyph) : null, h('span', null, title)]);
      const closeLabel = t('common:actions.close');
      render(h('div', { class: 'modal-card terminal-paste-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'terminalPasteTitle' }, [
        h('div', { class: 'terminal-settings-head' }, [h('div', null, [h('h2', { id: 'terminalPasteTitle' }, t('terminal:settings.multiline_paste_title')),
          h('span', { id: 'terminalPasteSummary' }, t('terminal:settings.paste_summary', { lines: options.value ? options.value.split('\n').length : 0, characters: options.value.length }))]),
          h(TermaButton, { id: 'terminalPasteClose', type: 'button', class: 'icon-button', title: closeLabel, 'aria-label': closeLabel, onClick: () => finish(null) }, () => icon('x'))]),
        h('label', { for: 'terminalPasteEditor' }, t('terminal:settings.paste_content')),
        h('textarea', { id: 'terminalPasteEditor', class: 'terminal-paste-editor', spellcheck: false, value: options.value,
          onInput: (event: Event) => { options.value = (event.target as HTMLTextAreaElement).value; paint(); } }),
        h('div', { class: 'actions terminal-paste-actions' }, [
          button('terminalPasteCancel', t('common:actions.cancel'), () => finish(null)),
          button('terminalPasteSingleLine', t('terminal:settings.merge_and_paste'), () => finish(options.singleLine(options.value))),
          button('terminalPasteConfirm', t('terminal:settings.paste_to_terminal'), () => finish(options.value), 'clipboard-paste', 'primary')
        ])
      ]), target);
    } else {
      const owner = current, options = owner.options, t = options.tr;
      const finish = (value: string | null) => { if (current === owner) release(value, true); };
      const closeLabel = t('common:actions.close');
      const title = t(options.titleKey);
      render(h('div', { class: 'modal-card terminal-font-prompt-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'terminalFontPromptTitle' }, [
        h('div', { class: 'terminal-settings-head' }, [h('h2', { id: 'terminalFontPromptTitle' }, title),
          h(TermaButton, { id: 'terminalFontPromptClose', type: 'button', class: 'icon-button', title: closeLabel, 'aria-label': closeLabel, onClick: () => finish(null) }, () => icon('x'))]),
        h('label', { for: 'terminalFontPromptInput' }, t(options.labelKey)),
        h('input', { id: 'terminalFontPromptInput', class: 'terminal-font-prompt-input', type: 'text', value: options.value, autocomplete: 'off', spellcheck: false,
          onInput: (event: Event) => { options.value = (event.target as HTMLInputElement).value; } }),
        h('div', { class: 'actions terminal-font-prompt-actions' }, [
          h(TermaButton, { id: 'terminalFontPromptCancel', type: 'button', onClick: () => finish(null) }, () => t('common:actions.cancel')),
          h(TermaButton, { id: 'terminalFontPromptSave', type: 'button', class: 'primary', onClick: () => finish(options.value.trim() || null) }, () => t('common:actions.save'))
        ])
      ]), target);
    }
    if (focused?.isConnected) {
      focused.focus({ preventScroll: true });
      if (selection && selection[0] != null && selection[1] != null && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) {
        try { focused.setSelectionRange(selection[0], selection[1], selection[2] || undefined); } catch { /* Numeric inputs have no text selection. */ }
      }
    }
    scroll.forEach(({ element, top, left }) => { if (element.isConnected) { element.scrollTop = top; element.scrollLeft = left; } });
    if (current.kind === 'settings') {
      const tab = target.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const list = tab?.parentElement;
      if (tab && list) {
        const bounds = list.getBoundingClientRect(), item = tab.getBoundingClientRect();
        if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
        else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
      }
    }
  };
  const refresh = () => { rememberFields(); paint(); };
  const selectTab = (name: string, focus = false) => {
    const state = settings(); if (!state) return;
    rememberFields(); state.tab = settingsTabs.some(tab => tab[0] === name) ? name : 'appearance'; paint();
    const suffix = settingsTabs.find(tab => tab[0] === state.tab)![1];
    const tab = target.querySelector<HTMLElement>(`#terminalSettingsTab${suffix}`);
    const list = tab?.parentElement;
    if (list && tab) {
      if (focus) tab.focus({ preventScroll: true });
      const r = tab.getBoundingClientRect(); list.scrollLeft += r.left - list.getBoundingClientRect().left - (list.clientWidth - r.width) / 2;
    }
  };
  const save = async () => {
    const owner = current, state = settings(); if (!state || state.busy) return;
    try {
      const values = readSettings();
      if (!values) return;
      state.busy = true; paint();
      await state.port.save(values);
      if (current === owner) release(null, true);
    } catch (error) { if (current === owner) state.port.saveError(error); }
    finally { if (current === owner) { state.busy = false; paint(); } }
  };
  const editShortcut = (index: number, action: string) => {
    const state = settings(); if (!state || state.busy || !Number.isInteger(index) || !state.rows[index]) return;
    rememberFields(); const destination = index + (action === 'up' ? -1 : 1);
    if (action === 'remove') state.rows.splice(index, 1);
    else if (['up', 'down'].includes(action) && destination >= 0 && destination < state.rows.length) [state.rows[index], state.rows[destination]] = [state.rows[destination]!, state.rows[index]!];
    else return;
    state.error = false; paint();
    const next = Math.min(action === 'remove' ? index : destination, state.rows.length - 1);
    target.querySelector<HTMLElement>(`[data-shortcut-row="${next}"][data-shortcut-action="${action}"]:not(:disabled)`)?.focus();
  };
  const addShortcut = () => {
    const state = settings(); if (!state || state.busy) return;
    rememberFields(); const f = state.fields;
    try {
      const value = state.port.normalizeShortcuts([...state.rows.map(row => row.value), {
        key: f.terminalShortcutKey === 'custom' ? f.terminalShortcutCharacter : f.terminalShortcutKey, label: f.terminalShortcutLabel,
        ctrl: f.terminalShortcutCtrl, alt: f.terminalShortcutAlt, shift: f.terminalShortcutShift, enabled: true
      }]).at(-1)!;
      state.rows.push({ id: ++nextRowId, value }); state.error = false; f.terminalShortcutLabel = ''; paint();
      const list = target.querySelector<HTMLElement>('#terminalShortcutRows'); if (list) list.scrollTop = list.scrollHeight;
      target.querySelector<HTMLElement>('#terminalShortcutKey')?.focus();
    } catch { state.error = true; paint(); }
  };
  function onKeydown(event: KeyboardEvent) {
    if (!current || target.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (current.kind === 'font-prompt' && event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      const value = target.querySelector<HTMLInputElement>('#terminalFontPromptInput')?.value.trim() || null;
      release(value, true); return;
    }
    if (current.kind === 'paste' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); release(current.options.value, true); return;
    }
    if (event.key !== 'Tab') return;
    const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(element => element.tabIndex >= 0 && element.checkVisibility());
    const first = fields[0], last = fields.at(-1);
    if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  const prepare = () => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    release(); remoteServices.termaRemoteViews?.releaseDialog(); quickServices.termaQuickViews?.release(target); connectionsServices.termaConnectionViews?.release(target);
    unmountSettingsDialog(); workspaceServices.termaWorkspaceViews?.unmountDialog();
    target.replaceChildren(); target.onclick = null; target.onkeydown = null; target.hidden = false;
    target.classList.add('terma-vue-root', 'terma-terminal-dialog'); target.setAttribute('data-i18n-skip', '');
    target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    target.addEventListener('keydown', onKeydown, true);
    observer = new MutationObserver(() => {
      if (target.hidden) { release(); return; }
      target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      refresh();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(target, { attributes: true, attributeFilter: ['hidden'] });
    return trigger;
  };
  window.addEventListener('terma:language-changed', refresh);
  terminalServices.termaTerminalViews = {
    releaseDialog: () => release(), settingsActive: () => !!settings(), startupActive: () => current?.kind === 'startup',
    startupOptions: () => current?.kind === 'startup' ? current.options : null,
    closeSettings: () => { if (settings()) close(); },
    refreshSettings: refresh, selectTab,
    readSettings, readShortcuts, saveSettings: save, editShortcut, addShortcut,
    selectedBackgroundMode() { rememberFields(); return settings()?.backgroundMode || 'theme'; },
    fillShortcuts(value) { rememberFields(); fillShortcuts(value); paint(); },
    fillSettings(values) { const state = settings(); if (!state) return; rememberFields(); fill(state, values); paint(); },
    resetSeparators() { const state = settings(); if (!state) return; rememberFields(); state.fields.terminalSettingWordSeparators = state.port.defaults.word_separators; paint(); },
    selectBackground(color) { const state = settings(); if (!state) return; rememberFields(); state.backgroundMode = 'custom'; state.fields.terminalSettingBackgroundColor = color; paint(); },
    showSettings(port) {
      const trigger = prepare();
      const state: TerminalSettingsState = {
        port, fields: { terminalShortcutKey: port.shortcutKeys[0] || 'Esc', terminalShortcutCharacter: '', terminalShortcutLabel: '', terminalShortcutCtrl: false, terminalShortcutAlt: false, terminalShortcutShift: false },
        backgroundMode: 'theme', rows: [], tab: 'appearance', error: false, busy: false,
        change(id, value) { rememberFields(); state.fields[id] = value; if (id === 'terminalSettingBackgroundColor') state.backgroundMode = 'custom'; paint(); },
        selectTab, selectBackground(mode) { rememberFields(); state.backgroundMode = mode; paint(); },
        reset() { rememberFields(); fill(state, port.defaults); paint(); }, resetShortcuts() { rememberFields(); fillShortcuts(port.defaults.shortcut_keys); paint(); },
        resetSeparators() { terminalServices.termaTerminalViews!.resetSeparators(); }, editShortcut, addShortcut, save, close
      };
      current = { kind: 'settings', state, trigger }; target.dataset.terminalDialog = 'settings'; fill(state, port.settings); paint();
      target.querySelector<HTMLElement>('#terminalSettingsTabAppearance')?.focus();
    },
    promptPaste(options) {
      const trigger = prepare(); target.dataset.terminalDialog = 'paste';
      return new Promise(resolve => {
        options.value = String(options.value || '').replace(/\r\n?/g, '\n'); current = { kind: 'paste', options, resolve, trigger }; paint();
        const editor = target.querySelector<HTMLTextAreaElement>('#terminalPasteEditor'); editor?.focus(); editor?.setSelectionRange(options.value.length, options.value.length);
      });
    },
    promptFont(options) {
      const trigger = prepare(); target.dataset.terminalDialog = 'font-prompt';
      return new Promise(resolve => {
        options.value = String(options.value || ''); current = { kind: 'font-prompt', options, resolve, trigger }; paint();
        const input = target.querySelector<HTMLInputElement>('#terminalFontPromptInput'); input?.focus(); input?.select();
      });
    },
    showStartupSettings(options) {
      const trigger = prepare();
      options.refresh = refresh;
      current = { kind: 'startup', options, trigger }; target.dataset.terminalDialog = 'startup'; paint();
      target.querySelector<HTMLElement>('#terminalStartupProfile')?.focus();
    },
    async promptStartup(options, selector, run, valid) {
      const owner = current;
      if (owner?.kind !== 'startup' || owner.options !== options || !valid()) return null;
      const card = target.querySelector('.terminal-startup-modal');
      const top = target.querySelector('.terminal-startup-scroll')?.scrollTop || 0;
      const opened = [...target.querySelectorAll<HTMLDetailsElement>('[data-session-component] details[open]')]
        .map(node => node.closest<HTMLElement>('[data-session-component]')!.dataset.sessionComponent);
      let invalid = false, prompted = false;
      const inspect = (records: MutationRecord[]) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const cards = [node, ...node.querySelectorAll('.modal-card')].filter(node => node.matches('.modal-card'));
          for (const next of cards) {
            if (next === card) continue;
            if (next.matches(selector)) prompted = true;
            else invalid = true;
          }
        }
        if (!prompted && current !== owner && !target.querySelector(selector)) invalid = true;
      };
      const observer = new MutationObserver(inspect);
      observer.observe(target, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
      try {
        const value = await run(() => {
          inspect(observer.takeRecords());
          return !invalid && valid();
        });
        inspect(observer.takeRecords());
        if (invalid || !valid()) return null;
        if (current === owner && !target.hidden) return value;
        if (!prompted || !target.hidden || target.querySelector('.modal-card')) return null;
        observer.disconnect();
        terminalServices.termaTerminalViews!.showStartupSettings(options);
        const scroll = target.querySelector('.terminal-startup-scroll');
        for (const id of opened) {
          const details = target.querySelector<HTMLDetailsElement>(`[data-session-component="${CSS.escape(id || '')}"] details`);
          if (details) details.open = true;
        }
        if (scroll) scroll.scrollTop = top;
        return value;
      } finally {
        observer.disconnect();
      }
    },
    fillStartup(values, saveDefault) {
      if (current?.kind !== 'startup') return;
      Object.assign(current.options.draft, values);
      if (saveDefault !== undefined) current.options.saveDefault = saveDefault;
      paint();
    }
  };
}

export interface InstalledFeaturesTerminalTerminalDialogMountServices {
  termaTerminalViews?: {
      showSettings(port: TerminalSettingsPort): void;
      settingsActive(): boolean;
      releaseDialog(): void;
      closeSettings(): void;
      refreshSettings(): void;
      selectedBackgroundMode(): string;
      selectTab(name: string): void;
      selectBackground(color: string): void;
      fillSettings(values: TerminalSettingsValues): void;
      readSettings(): TerminalSettingsValues | undefined;
      saveSettings(): Promise<void>;
      fillShortcuts(value: unknown): void;
      readShortcuts(): TerminalShortcut[];
      editShortcut(index: number, action: string): void;
      addShortcut(): void;
      resetSeparators(): void;
      promptPaste(options: TerminalPasteOptions): Promise<string | null>;
      promptFont(options: FontPromptOptions): Promise<string | null>;
      showStartupSettings(options: TerminalStartupOptions): void;
      promptStartup<T>(options: TerminalStartupOptions, selector: string, run: (valid: () => boolean) => Promise<T>, valid: () => boolean): Promise<T | null>;
      startupActive(): boolean;
      startupOptions(): TerminalStartupOptions | null;
      fillStartup(values: TerminalStartupOptions['draft'], saveDefault?: boolean): void;
    };
}
