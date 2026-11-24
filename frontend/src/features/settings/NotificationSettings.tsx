import {efficiencyServices} from '@/features/efficiency/installed-services';
import { computed, defineComponent, reactive, watch, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import type { SettingsViewPort } from './settings-port';
import { normalizeNotificationDisplay } from './runtime-settings-model';
import { notificationActions, notificationMode, parseNotificationSeconds, saveNotificationSettings, toggleSettingsDesktopNotifications } from './notification-settings-actions';

const categories = ['info','success','error'] as const;
const durations = {info:'notificationInfoDuration',success:'notificationSuccessDuration',error:'notificationErrorDuration'} as const;
const controls = {info:'notificationInfoEnabled',success:'notificationSuccessEnabled',error:'notificationErrorEnabled'} as const;
const modeOptions = ['on','muted','off'] as const;
const seconds = (ms: number | null) => ms === null ? '' : String(ms / 1000);
const target = (event: Event) => event.currentTarget as HTMLInputElement;

export const NotificationSettings = defineComponent({
  props:{ scope:{type:Object as PropType<SettingsViewPort>,required:true}, permission:{type:String,required:true}, toggleLabel:{type:String,required:true} },
  setup(props) {
    const tr:SettingsViewPort['tr'] = (key,options) => props.scope.tr(key,options);
    const text = (key:string,options?:Record<string,unknown>) => tr('settings:auto.' + key,options);
    const saved = () => {
      const runtime = props.scope.runtimeSettings?.saved;
      return {mode:notificationMode(props.scope.securitySettings?.notification_mode), display:normalizeNotificationDisplay(runtime?.notification_display),
        floating:runtime?.sftp_floating_progress_enabled !== false};
    };
    const initial = saved();
    const fromDisplay = (display: typeof initial.display) => ({
      info:{enabled:display.info.enabled, seconds:seconds(display.info.duration_ms)},
      success:{enabled:display.success.enabled,seconds:seconds(display.success.duration_ms)},
      error:{enabled:display.error.enabled,seconds:seconds(display.error.duration_ms)},
      progress:{enabled:display.progress.enabled,success:seconds(display.progress.success_duration_ms),error:seconds(display.progress.error_duration_ms)}
    });
    const draft = reactive({dirty:false,mode:initial.mode,floating:initial.floating,...fromDisplay(initial.display)});
    watch(() => props.scope, () => {
      if (draft.dirty || notificationActions.saving) return;
      const next = saved();
      Object.assign(draft,{mode:next.mode,floating:next.floating,...fromDisplay(next.display)});
    });
    const system = computed(() => {
      const painted = {permission:props.permission,toggleLabel:props.toggleLabel};
      return notificationActions.revision && efficiencyServices.termaSystemNotifications ? {
        permission:efficiencyServices.termaSystemNotifications.permissionText(),toggleLabel:efficiencyServices.termaSystemNotifications.toggleLabel()
      } : painted;
    });
    const edit = (change: () => void) => { change();draft.dirty = true; };
    const locked = () => notificationActions.saving || notificationActions.toggling;
    const duration = (id:string, label:string, value:string, disabled:boolean, update:(value:string)=>void, placeholder?:string) =>
      <label class="notification-duration"><span>{text(label)}</span>
        <input id={id} type="number" min="0.5" max="60" step="0.1" value={value} placeholder={placeholder}
          disabled={disabled || notificationActions.saving} onInput={event => edit(() => update(target(event).value))}/>
        <span>{text('seconds')}</span></label>;
    const toggle = (id:string, label:string, checked:boolean, update:(value:boolean)=>void) =>
      <label class="check-row"><input id={id} type="checkbox" checked={checked} disabled={notificationActions.saving}
        onChange={event => edit(() => update(target(event).checked))}/> {text(label)}</label>;
    const categoryPayload = (category: typeof categories[number]) => ({enabled:draft[category].enabled,
      duration_ms:parseNotificationSeconds(draft[category].seconds,tr)});
    async function save() {
      const ok = await saveNotificationSettings(() => ({mode:draft.mode,floating:draft.floating,display:{
        info:categoryPayload('info'),success:categoryPayload('success'),error:categoryPayload('error'),
        progress:{enabled:draft.progress.enabled,success_duration_ms:parseNotificationSeconds(draft.progress.success,tr,true),
          error_duration_ms:parseNotificationSeconds(draft.progress.error,tr,true)}
      }}),tr);
      if (ok) draft.dirty = false;
    }
    return () => <section data-terma-managed-fields>
      <h3>{text('notifications')}</h3><div class="muted">{text('notifications_intro')}</div>
      <div id="notificationPermissionStatus" class="cmd">{text('notification_status',{status:system.value.permission})}</div>
      <label for="notificationMode">{text('notification_method')}</label><div class="muted">{text('notification_method_hint')}</div>
      <select id="notificationMode" value={draft.mode} disabled={notificationActions.saving}
        onChange={event => edit(() => {draft.mode = notificationMode(target(event).value);})}>
        {modeOptions.map(mode => <option key={mode} value={mode}>{text('notification_mode_' + mode)}</option>)}
      </select>
      <h3>{text('page_notifications')}</h3>
      <div class="notification-preference-list">
        {categories.map(category => <div key={category} class="notification-preference-row">
          {toggle(controls[category],`${category}_notification`,draft[category].enabled,value => {draft[category].enabled = value;})}
          {duration(durations[category],'display',draft[category].seconds,!draft[category].enabled,value => {draft[category].seconds = value;})}
        </div>)}
        <div class="notification-preference-row notification-progress-preference">
          {toggle('notificationProgressEnabled','progress_notification',draft.progress.enabled,value => {draft.progress.enabled = value;})}
          <div class="notification-progress-durations">
            {duration('notificationProgressSuccessDuration','after_success',draft.progress.success,!draft.progress.enabled,value=>{draft.progress.success=value;},text('task_default'))}
            {duration('notificationProgressErrorDuration','after_failure',draft.progress.error,!draft.progress.enabled,value=>{draft.progress.error=value;})}
          </div>
        </div>
        <div class="notification-preference-row">
          {toggle('taskCenterFloatingProgressEnabled','floating_task_card',draft.floating,value => {draft.floating = value;})}
          <span class="muted">{text('while_task_running')}</span>
        </div>
      </div>
      <div class="muted">{text('notification_disable_hint')}</div>
      <div class="desktop-notification-control">
        <div id="desktopNotificationStatus" class="cmd">{system.value.permission}</div>
        <div class="actions">
          <TermaButton id="notificationSaveBtn" class="primary" disabled={locked()} loading={notificationActions.saving} onClick={save}>
            {text('save_notifications')}
          </TermaButton>
          <TermaButton id="desktopNotificationToggleBtn" disabled={locked()} loading={notificationActions.toggling} onClick={toggleSettingsDesktopNotifications}>
            {notificationActions.toggling ? text('saving') : system.value.toggleLabel}
          </TermaButton>
        </div>
      </div>
    </section>;
  }
});
