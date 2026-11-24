import type { LocalEntry, LocalListing } from '../files/local-file-service';
import { defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from '../settings/settings-icon';
import type { QuickViewPort } from './quick-port';

export function serverDirectoryPicker(scope: QuickViewPort, inputId: string, close: () => void) {
  return h(defineComponent({
    setup() {
      const state = reactive({ path: '', display: '', parent: '', entries: [] as LocalEntry[], roots: [] as LocalEntry[], error: '', busy: false, page: 1, pages: 1, create: false, name: '' });
      const expanded = reactive(new Map<string, LocalEntry[]>());
      const language = ref(0);
      let generation = 0, alive = true;
      const t = (key: string) => { void language.value; return scope.tr('sftp:server_picker.' + key); };
      const button = (name: string, icon: string, run: () => unknown, disabled = false) => h(TermaButton, { type: 'button', title: t(name), 'aria-label': t(name), disabled, onClick: run }, { default: () => [settingsIcon(icon), h('span', null, t(name))] });
      const listing = (path: string, page = 1) => scope.api<LocalListing>('/api/server-files?path=' + encodeURIComponent(path) + '&page=' + page + '&page_size=100&show_hidden=true');
      async function load(path = state.path, page = 1) {
        const ticket = ++generation;
        state.busy = true; state.error = '';
        try {
          const result = await listing(path, page);
          if (!alive || ticket !== generation) return;
          Object.assign(state, { path: result.path || '', display: result.display_path || '', parent: result.parent || '', entries: (result.entries || []).filter((entry: LocalEntry) => ['dir', 'directory', 'drive'].includes(entry.type)), page: result.page || page, pages: result.total_pages || 1 });
        } catch (error: any) { if (alive && ticket === generation) state.error = error.message; }
        finally { if (alive && ticket === generation) state.busy = false; }
      }
      async function toggle(entry: LocalEntry) {
        if (expanded.has(entry.path)) { expanded.delete(entry.path); return; }
        try {
          const result = await listing(entry.path);
          if (alive) expanded.set(entry.path, (result.entries || []).filter((item: LocalEntry) => ['dir','directory'].includes(item.type)));
        } catch (error: any) { if (alive) state.error = error.message; }
      }
      async function create() {
        if (!state.name.trim() || !state.path || state.busy) return;
        state.busy = true;
        try {
          await scope.api('/api/server-files/create', { method: 'POST', body: JSON.stringify({ directory: state.path, name: state.name.trim(), type: 'dir' }) });
          state.name = ''; state.create = false; expanded.clear(); await load();
        } catch (error: any) { if (alive) state.error = error.message; }
        finally { if (alive) state.busy = false; }
      }
      const translate = () => language.value++;
      onMounted(async () => {
        window.addEventListener('terma:language-changed', translate);
        try {
          const roots = await listing('');
          if (!alive) return;
          state.roots = roots.entries || [];
          const input = document.getElementById(inputId) as HTMLInputElement | null;
          const resolved = input?.value ? await scope.api<Pick<LocalListing, 'path'>>('/api/server-files/resolve?path=' + encodeURIComponent(input.value)).catch(() => null) : null;
          if (alive) await load(resolved?.path || '');
        } catch (error: any) { if (alive) state.error = error.message; }
      });
      onBeforeUnmount(() => { alive = false; generation++; window.removeEventListener('terma:language-changed', translate); });
      const node = (entry: LocalEntry, depth = 0): any => h('div', { key: entry.path }, [
        h('div', { class: 'server-picker-node', style: { paddingInlineStart: depth * 12 + 'px' } }, [
          h(TermaButton, { type: 'button', 'aria-label': t(expanded.has(entry.path) ? 'collapse' : 'expand'), 'aria-expanded': expanded.has(entry.path), onClick: () => toggle(entry) }, { default: () => settingsIcon(expanded.has(entry.path) ? 'chevron-down' : 'chevron-right') }),
          h(TermaButton, { type: 'button', title: entry.display_path || entry.name, class: { selected: state.path === entry.path }, onClick: () => load(entry.path) }, { default: () => [settingsIcon('folder'), h('span', null, entry.display_path || entry.name)] })
        ]),
        ...(expanded.get(entry.path) || []).map(child => node(child, depth + 1))
      ]);
      return () => h('section', { class: 'server-directory-picker', 'aria-label': t('title') }, [
        h('div', {class:'server-picker-toolbar'}, [h('strong', null, t('title')),h(TermaButton,{type:'button',title:scope.tr('common:actions.close'),'aria-label':scope.tr('common:actions.close'),onClick:close},{default:()=>settingsIcon('x')})]), h('p', { class: 'hint' }, t('host_hint')),
        h('div', { class: 'server-picker-toolbar' }, [button('roots', 'hard-drive', () => load('')), button('up', 'arrow-up', () => load(state.parent), !state.path || state.busy), button('refresh', 'refresh-cw', () => load(), state.busy), button('new_folder', 'folder-plus', () => { state.create = !state.create; }, !state.path || state.busy)]),
        h('p', { class: 'server-picker-path' }, state.display || t('roots')),
        state.create ? h('div', { class: 'server-picker-toolbar' }, [h('input', { value: state.name, maxlength: 255, 'aria-label': t('folder_name'), placeholder: t('folder_name'), onInput: (event: Event) => { state.name = (event.target as HTMLInputElement).value; }, onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); void create(); } } }), button('create', 'check', create, state.busy || !state.name.trim())]) : null,
        h('div', { class: 'server-picker-columns' }, [h('div', { class: 'server-picker-tree' }, state.roots.map(entry => node(entry))), h('div', { class: 'server-picker-entries', 'aria-busy': state.busy }, state.entries.length ? state.entries.map(entry => node(entry)) : h('p', { class: 'hint' }, t(state.busy ? 'loading' : 'empty')))]),
        state.pages > 1 ? h('div', { class: 'server-picker-toolbar' }, [button('previous', 'chevron-left', () => load(state.path, state.page - 1), state.page <= 1), h('span', null, state.page + ' / ' + state.pages), button('next', 'chevron-right', () => load(state.path, state.page + 1), state.page >= state.pages)]) : null,
        state.error ? h('p', { role: 'alert' }, state.error) : null,
        button('select', 'folder-check', () => { const input = document.getElementById(inputId) as HTMLInputElement | null; if (input && state.display) { input.value = state.display; input.dispatchEvent(new Event('input', { bubbles: true })); close(); input.focus(); } }, !state.path || state.busy)
      ]);
    }
  }));
}
