import { defineComponent, h, nextTick, ref, type PropType, type VNode } from 'vue';
import { SettingsPasswordField } from '../settings/SettingsPasswordField';
import type { ConnectionViewPort } from './connection-port';

export const ConnectionBulkFields = defineComponent({
  props: {
    scope: {type: Object as PropType<ConnectionViewPort>, required: true},
    identities: {type: Array as PropType<Array<{path?: string}>>, required: true},
  },
  setup(props) {
    const group = ref(false), port = ref(false), auth = ref(false);
    const authType = ref('password');
    const groupField = ref<HTMLInputElement>(), portField = ref<HTMLInputElement>();
    const tr = (key: string, defaultValue: string) => props.scope.tr(key, {defaultValue});

    function row(id: string, label: string, enabled: typeof group, fields: VNode[], focus?: () => void) {
      return h('div', {class: ['bulk-setting-row', {credentials: id === 'bulkSetAuth'}]}, [
        h('label', {class: 'checkline'}, [
          h('input', {id, type: 'checkbox', checked: enabled.value, onChange(event: Event) {
            enabled.value = (event.currentTarget as HTMLInputElement).checked;
            if (enabled.value && focus) void nextTick(focus);
          }}), label,
        ]), ...fields,
      ]);
    }

    return () => {
      const password = authType.value === 'password';
      const options = props.scope.groupNames('', 'ssh') as string[];
      return [
        row('bulkSetGroup', tr('connections:list.change_group', '修改分组'), group, [
          h('input', {id: 'bulkGroup', ref: groupField, list: 'bulkGroupOptions', disabled: !group.value,
            placeholder: tr('connections:list.group_placeholder', '选择或输入分组')}),
          h('datalist', {id: 'bulkGroupOptions'}, options.map(name => h('option', {key: name, value: name}))),
        ], () => groupField.value?.focus()),
        row('bulkSetPort', tr('connections:list.change_port', '修改端口'), port, [
          h('input', {id: 'bulkPort', ref: portField, type: 'number', min: '1', max: '65535', defaultValue: '22', disabled: !port.value}),
        ], () => portField.value?.focus()),
        row('bulkSetAuth', tr('connections:list.change_credentials', '修改登录凭据'), auth, [
          h('div', {id: 'bulkAuthFields'}, [
            h('select', {id: 'bulkAuthType', disabled: !auth.value, value: authType.value, onChange(event: Event) {
              authType.value = (event.currentTarget as HTMLSelectElement).value;
            }}, [
              h('option', {value: 'password'}, tr('connections:auto.password_login', '密码')),
              h('option', {value: 'key'}, tr('connections:auto.key_login', '私钥')),
            ]),
            h(SettingsPasswordField, {id: 'bulkPassword', autocomplete: 'new-password', hidden: !password,
              disabled: !auth.value || !password, placeholder: tr('connections:list.new_password_placeholder', '输入新 SSH 密码'),
              showLabel: tr('common:auto.show_password', '显示密码'), hideLabel: tr('common:auto.hide_password', '隐藏密码')}),
            h('select', {id: 'bulkIdentity', disabled: !auth.value || password, hidden: password}, [
              h('option', {key: '', value: ''}, tr('connections:identity.select', '选择私钥')),
              ...props.identities.map(item => h('option', {key: item.path, value: String(item.path || '')},
                props.scope.localizedIdentityFileLabel(item, {permission: true}))),
            ]),
          ]),
        ]),
      ];
    };
  },
});
