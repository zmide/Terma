import {defineComponent, h, nextTick, ref, type PropType} from 'vue';
import {TermaButton} from './TermaButton';
import {settingsIcon} from '@/features/settings/settings-icon';
import {desktopIntegrationExpiryText, normalizeDesktopIntegrationScopes, type DesktopIntegrationStatus} from '../desktop-integration-service';

export interface AuthorizationViewPort {
  tr(key: string, params?: Record<string, unknown>): string;
}

const DesktopAuthorization = defineComponent({
  name: 'DesktopAuthorization',
  props: {
    status: {type: Object as PropType<DesktopIntegrationStatus>, required: true},
    scopes: {type: Array as PropType<string[]>, required: true},
    tr: {type: Function as PropType<AuthorizationViewPort['tr']>, required: true},
    refreshTarget: {type: String, default: ''},
    remoteProfileId: {type: Number, default: 0},
    language: String
  },
  setup(props) {
    const selected = ref('10');
    const customMinutes = ref('120');
    const customInput = ref<HTMLInputElement | null>(null);
    const changeDuration = (event: Event) => {
      selected.value = (event.target as HTMLSelectElement).value;
      if (selected.value === 'custom') void nextTick(() => customInput.value?.focus());
    };
    const option = (value: string, label: string) => h('option', {value}, label);
    return () => {
      const t = props.tr;
      const status = props.status;
      const scopes = normalizeDesktopIntegrationScopes(props.scopes);
      const authorized = scopes.length > 0 && Boolean(status.native_desktop || scopes.every(scope => status.scopes?.includes(scope)));
      if (authorized && status.authorization_kind !== 'temporary') return null;
      if (!authorized && !status.desktop_backend_available) return null;
      const attributes = {'data-refresh-target': props.refreshTarget, 'data-remote-profile-id': props.remoteProfileId};
      const copy = authorized ? desktopIntegrationExpiryText(t,status) : t(status.can_request_authorization
        ? 'remote:desktop_authorization.request_hint'
        : status.web_session_authenticated
          ? 'remote:desktop_authorization.same_device_only'
          : 'common:notifications.desktop_authorization_login_required');
      const controls = authorized
        ? [h(TermaButton, {type: 'button', 'data-action': 'desktop-integration-revoke', ...attributes},
          () => [settingsIcon('shield-off'), h('span', null, t('remote:desktop_authorization.revoke'))])]
        : status.can_request_authorization ? [
          h('label', {class: 'desktop-integration-duration'}, [
            h('span', null, t('remote:desktop_authorization.duration')),
            h('select', {'data-role': 'desktop-integration-duration', value: selected.value, onChange: changeDuration}, [
              ...[5, 10, 30].map(count => option(String(count), t('remote:desktop_authorization.minutes', {count}))),
              option('60', t('remote:desktop_authorization.hour')),
              option('custom', t('remote:desktop_authorization.custom')),
              option('browser-session', t('remote:desktop_authorization.browser_session_option'))
            ])
          ]),
          h('label', {class: 'desktop-integration-custom-duration', hidden: selected.value !== 'custom'}, [
            h('span', null, t('remote:desktop_authorization.minute_unit')),
            h('input', {
              ref: customInput, type: 'number', min: 1, max: 480, step: 1, inputmode: 'numeric',
              'data-role': 'desktop-integration-custom-minutes', value: customMinutes.value,
              onInput: (event: Event) => { customMinutes.value = (event.target as HTMLInputElement).value; }
            })
          ]),
          h(TermaButton, {type: 'button', class: 'primary', 'data-action': 'desktop-integration-authorize', 'data-scopes': scopes.join(','), ...attributes},
            () => [settingsIcon('shield-check'), h('span', null, t('remote:desktop_authorization.request'))])
        ] : [];
      return h('div', {class: ['connection-test-status', authorized ? 'success' : 'warning', 'desktop-integration-authorization']}, [
        h('div', {class: 'desktop-integration-authorization-copy'}, [
          h('b', null, t(authorized ? 'remote:desktop_authorization.enabled' : 'remote:desktop_authorization.waiting')),
          h('small', null, copy)
        ]),
        controls.length ? h('div', {class: 'desktop-integration-authorization-actions'}, controls) : null
      ]);
    };
  }
});

export function desktopAuthorizationView(
  port: AuthorizationViewPort,
  status: DesktopIntegrationStatus | null | undefined,
  scopes: string[],
  options: {refreshTarget?: string; remoteProfileId?: number} = {}
) {
  return h(DesktopAuthorization, {
    status: status || {}, scopes, ...options, tr: port.tr,
    language: document.documentElement.lang
  });
}
