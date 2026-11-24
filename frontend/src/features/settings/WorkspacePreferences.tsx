import {settingsServices} from '@/features/settings/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {notify} from '@/features/efficiency/notification-actions';
import { defineComponent, reactive, ref, watch, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { errorMessage } from '../operations/operations-types';
import { remoteQuickOpen, saveWorkspacePreferences } from './quick-open-preference';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { backgroundIntervals, normalizeRuntimeSettingsResponse, normalizeVncFullscreenToolbarMode,
  normalizeWorkspaceToolbarPlacement, runtimeBackgroundIntervalMs } from './runtime-settings-model';

const toggleFields = [
  ['restoreWorkspaceTabs', 'restore_workspace_tabs', 'restore_tabs'],
  ['generalRemoteDesktopQuickOpen', 'remote_desktop_quick_open_enabled', 'remote_desktop_quick_open'],
  ['generalVncQuickOpenNewWindow', 'vnc_quick_open_new_window', 'vnc_quick_open_new_window']
] as const;
const placementFields = [
  ['toolbarPlacementUnsplitTerminal', 'unsplit', 'terminal', 'single_terminal'],
  ['toolbarPlacementUnsplitSftp', 'unsplit', 'sftp', 'single_sftp'],
  ['toolbarPlacementSplitTerminal', 'split', 'terminal', 'split_terminal'],
  ['toolbarPlacementSplitSftp', 'split', 'sftp', 'split_sftp']
] as const;
const intervalFields = [
  ['generalUiRefreshIntervalSeconds', 'ui_refresh_interval_ms', 'ui_state'],
  ['generalSftpActiveStatusIntervalSeconds', 'sftp_active_status_poll_interval_ms', 'sftp_active'],
  ['generalSftpBackgroundStatusIntervalSeconds', 'sftp_background_status_poll_interval_ms', 'sftp_background'],
  ['generalVncLocalImageIntervalSeconds', 'vnc_local_image_poll_interval_ms', 'vnc_local_image'],
  ['generalVncRemoteImageIntervalSeconds', 'vnc_remote_image_poll_interval_ms', 'vnc_remote_image']
] as const;

type RuntimeSettings = ReturnType<typeof normalizeRuntimeSettingsResponse>;

function initialDraft(settings: RuntimeSettings | null, quickOpen: boolean) {
  const saved = settings?.saved;
  return {
    restore_workspace_tabs: saved?.restore_workspace_tabs !== false,
    remote_desktop_quick_open_enabled: quickOpen,
    vnc_quick_open_new_window: saved?.vnc_quick_open_new_window !== false,
    vnc_fullscreen_toolbar: normalizeVncFullscreenToolbarMode(saved?.vnc_fullscreen_toolbar),
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(saved?.workspace_toolbar_placement),
    intervals: Object.fromEntries(intervalFields.map(([,key]) =>
      [key, String(runtimeBackgroundIntervalMs(saved?.[key], backgroundIntervals[key]) / 1000)]))
  };
}

export const WorkspacePreferences = defineComponent({
  props: { scope: { type: Object as PropType<SettingsViewPort>, required: true } },
  setup(props) {
    const tr = (key: string) => props.scope.tr(`settings:${key}`);
    const draft = reactive(initialDraft(props.scope.runtimeSettings, remoteQuickOpen.enabled.value));
    const pending = ref(false);
    const dirty = ref(false);
    let committed = initialDraft(props.scope.runtimeSettings, remoteQuickOpen.enabled.value);

    function changed() {
      dirty.value = JSON.stringify(draft) !== JSON.stringify(committed);
    }
    function sync() {
      committed = initialDraft(props.scope.runtimeSettings, remoteQuickOpen.enabled.value);
      Object.assign(draft, initialDraft(props.scope.runtimeSettings, remoteQuickOpen.enabled.value));
      dirty.value = false;
    }
    watch([() => props.scope.runtimeSettings, remoteQuickOpen.enabled], () => { if (!dirty.value && !pending.value) sync(); });

    async function save(event: SubmitEvent) {
      event.preventDefault();
      if (pending.value) return;
      const target = (event.currentTarget as HTMLFormElement).closest<HTMLElement>('#view-settings');
      pending.value = true;
      try {
        const {intervals, ...prefs} = draft;
        const polling = intervalFields.map(([,key]) => {
          const seconds = Number(intervals[key]);
          if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw Error(tr('background_refresh.interval_invalid'));
          return [key, seconds * 1000];
        });
        await saveWorkspacePreferences({...prefs, ...Object.fromEntries(polling)});
        sync();
        if (target) settingsServices.termaRefreshVueSettings?.(target);
        workspaceServices.termaWorkspaceToolbar?.sync();
        remoteServices.termaVncRuntime?.refreshPolling();
        notify(tr('auto.workspace_saved'), 'success');
      } catch (error) {
        notify(errorMessage(error, tr('auto.workspace_save_failed')), 'error');
      } finally { pending.value = false; }
    }

    const place = (mode: 'unsplit' | 'split', kind: 'terminal' | 'sftp', control: HTMLSelectElement) => {
      draft.workspace_toolbar_placement[mode][kind] = control.value === 'tab' ? 'tab' : 'header';
      changed();
    };

    return () => <>
      <section data-terma-managed-fields="">
        <h3>{tr('auto.workspace')}</h3>
        {toggleFields.map(([id, key, label]) => <div key={id}>
          <label class="check-row"><input id={id} type="checkbox" checked={draft[key]} disabled={pending.value}
            onChange={event => { draft[key] = (event.currentTarget as HTMLInputElement).checked; changed(); }} /> {tr(`auto.${label}`)}</label>
          <div class="muted">{tr(`auto.${label}_hint`)}</div>
        </div>)}
        <div class="settings-vnc-toolbar-field">
          <label for="generalVncFullscreenToolbar">{tr('auto.vnc_fullscreen_toolbar')}</label>
          <select id="generalVncFullscreenToolbar" value={draft.vnc_fullscreen_toolbar} disabled={pending.value}
            onChange={event => { draft.vnc_fullscreen_toolbar = normalizeVncFullscreenToolbarMode((event.currentTarget as HTMLSelectElement).value); changed(); }}>
            {(['always','never','edge'] as const).map(mode => <option key={mode} value={mode}>{tr(`auto.vnc_fullscreen_toolbar_${mode}`)}</option>)}
          </select>
          <span>{tr('auto.vnc_fullscreen_toolbar_hint')}</span>
        </div>
        <h3>{tr('auto.action_location')}</h3>
        <div class="muted">{tr('auto.action_location_hint')}</div>
        {placementFields.map(([id, mode, kind, label]) => [
          <label key={`${id}-label`} for={id}>{tr(`auto.${label}`)}</label>,
          <select key={id} id={id} value={draft.workspace_toolbar_placement[mode][kind]} disabled={pending.value}
            onChange={event => place(mode, kind, event.currentTarget as HTMLSelectElement)}>
            <option value="tab">{tr('auto.toolbar_in_tab')}</option><option value="header">{tr('auto.toolbar_in_header')}</option>
          </select>
        ])}
      </section>
      <section class="background-refresh-settings" data-terma-managed-fields="">
        <form novalidate onSubmit={save}>
          <h3>{tr('background_refresh.title')}</h3>
          <div class="muted">{tr('background_refresh.description')}</div>
          <div class="background-refresh-grid">
            {intervalFields.map(([id,key,label]) => <label key={id} class="background-refresh-field" for={id}>
              <span>{tr(`background_refresh.${label}`)}</span><span><input id={id} type="number" min="1" max="60" step="1"
                value={draft.intervals[key]} disabled={pending.value}
                onInput={event => { draft.intervals[key] = (event.currentTarget as HTMLInputElement).value; changed(); }} />
                <small>{tr('background_refresh.seconds')}</small></span>
            </label>)}
          </div>
          <div class="muted">{tr('background_refresh.hint')}</div>
          <div class="actions"><TermaButton id="restoreWorkspaceTabsSave" type="submit" class="primary" loading={pending.value} disabled={pending.value}>
            {settingsIcon('save')}<span>{tr('general.save')}</span></TermaButton></div>
        </form>
      </section>
    </>;
  }
});
