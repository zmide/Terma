import {settingsServices} from '@/features/settings/installed-services';
import { h, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { ManagedKeysList } from './ManagedKeysList';
import { keyManagementText, loadManagedKeys, setManageUserKeys, startManagedKeyImport } from './managed-key-settings';
export function managedKeyManagementView(scope: SettingsViewPort, settings: any = {}): VNodeChild {
    const managedByFnos = scope.runtimeSettings?.distribution === 'fnos';
    const enabled = !managedByFnos && settings.manage_user_ssh_keys_enabled === true;
    const t = keyManagementText(scope.tr);
    return [h("section", {
            "class": "ssh-key-management-panel", "id": "sshKeyManagementPanel"
        }, [h("div", {
                "class": "ssh-key-management-toolbar"
            }, [h("div", {
                    "class": "ssh-key-management-title"
                }, [h("div", {
                        "class": "ssh-key-management-mark"
                    }, [settingsIcon('key-round')]), h("div", {}, [h("strong", {}, [t('project_title', 'Terma 密钥目录')]), h("span", {
                            "class": "muted"
                        }, [t('project_hint', '私钥只在本机管理，列表不会显示私钥内容。')])])]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "type": "button", "data-managed-action": "generate", onClick: () => settingsServices.termaKeyWizard.open()
                    }, {
                        default: () => [settingsIcon('plus'), h("span", {}, [t('generate', 'Generate key')])]
                    }), h(TermaButton, {
                        "type": "button", "data-managed-action": "import", onClick: () => startManagedKeyImport(scope.settingsRoot, enabled)
                    }, {
                        default: () => [settingsIcon('upload'), h("span", {}, [t('import', 'Import key')])]
                    }), h(TermaButton, {
                        "type": "button", "class": "icon-button", "data-managed-action": "refresh", "title": t('refresh', 'Refresh'), "aria-label": t('refresh', 'Refresh'),
                        onClick: () => loadManagedKeys(scope.settingsRoot)
                    }, {
                        default: () => [settingsIcon('refresh-cw')]
                    })])]), h("div", {
                "class": "ssh-key-management-scope"
            }, [h("div", {}, [h("strong", {}, [t('user_scope', '用户 ~/.ssh')]), h("span", {
                        "class": "muted"
                    }, [managedByFnos ? t('fnos_scope_hint', '飞牛应用仅管理 Terma 密钥目录，请将私钥导入上方目录。') : t('user_scope_hint', '开启后可查看、导入和部署用户目录中的密钥')])]), h("label", {
                    "class": "switch-row", 'data-terma-managed-fields': ''
                }, [h("input", {
                        "id": "manageUserSshKeysEnabled", "type": "checkbox", checked: enabled, disabled: managedByFnos,
                        onChange: (event: Event) => setManageUserKeys(event, scope.settingsRoot)
                    }), h("span", {
                        "class": "switch-track", "aria-hidden": "true"
                    }, []), h("span", {}, [enabled ? t('enabled', '已启用') : t('disabled', '默认关闭')])])]), h("div", {
                "class": "ssh-key-table-head"
            }, [h("span", {}, [t('key_column', '密钥')]), h("span", {}, [t('type_column', '类型')]), h("span", {}, [t('scope_column', '目录')]), h("span", {}, [t('actions_column', '操作')])]), h("div", {
                "id": "managedKeysList", "class": "ssh-key-management-list"
            }, [h(ManagedKeysList, { scope })])])];
}
export function sshKeyManagementView(scope: SettingsViewPort, settings: any = {}): VNodeChild {
    return managedKeyManagementView(scope, settings);
}
