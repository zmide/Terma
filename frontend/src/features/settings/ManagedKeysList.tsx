import { defineComponent, h, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import type { ManagedKey } from './managed-keys-service';
import { keyManagementText, managedKeyState, runManagedKeyAction } from './managed-key-settings';

export const ManagedKeysList = defineComponent({
  name: 'ManagedKeysList',
  props: { scope: { type: Object as PropType<SettingsViewPort>, required: true } },
  setup(props) {
    return () => {
      const scope = props.scope;
      const t = keyManagementText(scope.tr);
      const state = managedKeyState(scope.settingsRoot);
      if (state.error) return <div class="warning">{state.error}</div>;
      if (!state.items) return <span class="muted">{t('loading', '正在读取密钥...')}</span>;
      if (!state.items.length) return <div class="ui-state empty compact"><strong>{t('empty', '暂无托管密钥')}</strong><span>{t('empty_hint', '可生成或导入 Terma 密钥。')}</span></div>;
      const button = (action: Parameters<typeof runManagedKeyAction>[0], item: ManagedKey, glyph: string, label: string, danger = false) =>
        h(TermaButton, { type: 'button', class: ['icon-button', { danger }], 'data-managed-action': action, title: label, 'aria-label': label,
          onClick: (event: MouseEvent) => runManagedKeyAction(action, item, event, scope.settingsRoot) }, () => settingsIcon(glyph));
      return state.items.map(item => <div class="ssh-managed-key-row" key={`${item.scope}:${item.path}`}>
        <div class="ssh-key-cell ssh-key-name-cell">
          <div class={['ssh-key-icon', { encrypted: item.has_passphrase }]}>{settingsIcon(item.has_passphrase ? 'lock-keyhole' : 'key-round')}</div>
          <div class="ssh-key-name-text"><strong data-i18n-skip title={item.name}>{item.name}</strong><span data-i18n-skip={item.comment ? '' : undefined}>{item.comment || t('no_comment', '无备注')}</span></div>
        </div>
        <div class="ssh-key-cell ssh-key-type-cell"><span class="key-type-badge">{item.type || item.key_type || t('unknown_type', '未知')}</span><span class="muted">{item.bits ? `${item.bits} bit` : ''}</span></div>
        <div class="ssh-key-cell ssh-key-scope-cell"><span>{item.scope === 'user' ? t('user_scope_short', '用户 ~/.ssh') : t('project_scope', 'Terma 密钥目录')}</span><small>{t(item.has_passphrase ? 'encrypted' : 'not_encrypted', item.has_passphrase ? '已加密' : '未加密')}</small></div>
        <div class="ssh-managed-key-actions">
          {button('properties', item, 'sliders-horizontal', t('properties', '属性'))}
          {button('public', item, 'key', t('show_public', '查看公钥'))}
          {button('deploy', item, 'upload', t('deploy', '部署公钥'))}
          {button('delete', item, 'trash-2', t('delete', '删除'), true)}
        </div>
      </div>);
    };
  }
});
