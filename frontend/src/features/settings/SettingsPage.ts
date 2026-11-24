import {efficiencyServices} from '@/features/efficiency/installed-services';
import { SettingsPasswordField } from './SettingsPasswordField';
import { h, mergeProps, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { AboutPage } from '@/app/AboutPage';
import { settingsIcon } from './settings-icon';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import type { SettingsViewPort } from './settings-port';
import { storageSettingsPanelView, desktopBehaviorPanelView } from './general-view';
import { sshHostTrustPanelView, localDirectDesktopIntegrationStatusView } from './security-view';
import { RuntimeSettingsPanel } from './runtime-view';
import { cacheManagementPanelView } from './cache-view';
import { aiSettingsPanelView } from './ai-view';
import { managedKeyManagementView, sshKeyManagementView } from './keys-view';
import { NotificationSettings } from './NotificationSettings';
import { runSecuritySettingsAction, updateSecurityIntegrationPreview } from './security-settings-actions';
import { WorkspacePreferences } from './WorkspacePreferences';
export function renderGeneralSettings(scope: SettingsViewPort): VNodeChild {
    return h("div", {
        "class": "settings-group", "id": "settings-general", hidden: scope.activeSettingsSection !== 'settings-general'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:general.title", {
                    defaultValue: "通用设置"
                })]), h("span", {}, [scope.tr("settings:general.description", {
                    defaultValue: "管理桌面端行为、工作区恢复和后台刷新。"
                })])]), h("div", {
            "class": "settings-grid settings-waterfall"
        }, [storageSettingsPanelView(scope), desktopBehaviorPanelView(scope), h(WorkspacePreferences, {scope})])]);
}
export function renderAiSettings(scope: SettingsViewPort): VNodeChild {
    return h("div", {
        "class": "settings-group", "id": "settings-ai", hidden: scope.activeSettingsSection !== 'settings-ai'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:sections.ai", {
                    defaultValue: "AI 设置"
                })]), h("span", {}, [scope.tr("settings:ai.section_description", {
                    defaultValue: "配置终端与日志中的 AI 助手，不影响终端的正常连接和使用。"
                })])]), h("div", {
            "class": "settings-grid single"
        }, [typeof aiSettingsPanelView === "function" ? aiSettingsPanelView(scope) : ""])]);
}
export function renderSecuritySettings(scope: SettingsViewPort): VNodeChild {
    const s = scope.securitySettings || {};
    return h("div", {
        "class": "settings-group", "id": "settings-basic", hidden: scope.activeSettingsSection !== 'settings-basic'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:auto.security_settings")]), h("span", {}, [scope.tr("settings:auto.security_description")])]), h("div", {
            "class": "settings-grid settings-waterfall"
        }, [" ", sshHostTrustPanelView(scope), " ", h("section", {}, [h("h3", {}, [scope.tr("settings:auto.web_access")]), h("label", {}, [scope.tr("settings:auto.auth_policy")]), h("select", {
                    "id": "securityAuthMode"
                }, [h("option", mergeProps({
                        "value": "lan"
                    }, (s.auth_mode === "lan" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.auth_lan")]), h("option", mergeProps({
                        "value": "always"
                    }, (s.auth_mode === "always" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.auth_always")]), h("option", mergeProps({
                        "value": "off"
                    }, (s.auth_mode === "off" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.auth_off")])]), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.local_direct_hint")]), h("label", {}, [scope.tr("settings:auto.cookie_security")]), h("select", {
                    "id": "securitySecureCookieMode"
                }, [h("option", mergeProps({
                        "value": "auto"
                    }, ((s.secure_cookie_mode || "auto") === "auto" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.cookie_auto")]), h("option", mergeProps({
                        "value": "always"
                    }, (s.secure_cookie_mode === "always" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.cookie_always")]), h("option", mergeProps({
                        "value": "never"
                    }, (s.secure_cookie_mode === "never" ? {
                        "selected": true
                    } : {})), [scope.tr("settings:auto.cookie_never")])]), h("label", {
                    "class": "check-row"
                }, [h("input", mergeProps({
                        "id": "securityOriginProtocolCheck", "type": "checkbox"
                    }, (s.origin_protocol_check_enabled !== false ? {
                        "checked": true
                    } : {})), []), " ", scope.tr("settings:auto.origin_protocol_check")]), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.origin_protocol_check_hint")]), h("label", {
                    "class": "check-row"
                }, [h("input", mergeProps({
                        "id": "securityTrustedProxyEnabled", "type": "checkbox", "onChange": updateSecurityIntegrationPreview
                    }, (s.trusted_proxy_enabled ? {
                        "checked": true
                    } : {})), []), " ", scope.tr("settings:auto.trust_proxy")]), h("label", {}, [scope.tr("settings:auto.trusted_proxy_ip")]), h("input", {
                    "id": "securityTrustedProxyAddresses", "value": (s.trusted_proxy_addresses || []).join(", "), "placeholder": scope.tr("settings:auto.trusted_proxy_placeholder")
                }, []), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.trusted_proxy_hint")]), h("label", {
                    "class": "check-row"
                }, [h("input", mergeProps({
                        "id": "securityLocalDirectDesktopIntegration", "type": "checkbox", "onChange": updateSecurityIntegrationPreview
                    }, (s.local_direct_desktop_integration_enabled ? {
                        "checked": true
                    } : {})), []), " ", scope.tr("settings:auto.local_desktop_integration")]), " ", localDirectDesktopIntegrationStatusView(scope, s), " ", h("label", {}, [scope.tr("settings:auto.allowed_hosts")]), h("input", {
                    "id": "securityAllowedHosts", "value": (s.allowed_hosts || []).join(", "), "placeholder": scope.tr("settings:auto.allowed_hosts_placeholder")
                }, []), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.allowed_hosts_hint")]), h("h3", {}, [scope.tr("settings:auto.login_rate_limit")]), h("label", {}, [scope.tr("settings:auto.source_failures")]), h("input", {
                    "id": "securityLoginMaxFailures", "type": "number", "min": Number(s.login_protection?.limits?.maxFailures?.min || 1), "max": Number(s.login_protection?.limits?.maxFailures?.max || 100), "value": Number(s.login_protection?.max_failures || 5)
                }, []), h("label", {}, [scope.tr("settings:auto.source_window")]), h("input", {
                    "id": "securityLoginWindowSeconds", "type": "number", "min": Number(s.login_protection?.limits?.windowSeconds?.min || 30), "max": Number(s.login_protection?.limits?.windowSeconds?.max || 86400), "value": Number(s.login_protection?.window_seconds || 300)
                }, []), h("label", {}, [scope.tr("settings:auto.source_lock")]), h("input", {
                    "id": "securityLoginLockSeconds", "type": "number", "min": Number(s.login_protection?.limits?.lockSeconds?.min || 1), "max": Number(s.login_protection?.limits?.lockSeconds?.max || 86400), "value": Number(s.login_protection?.lock_seconds || 300)
                }, []), h("label", {
                    "class": "check-row"
                }, [h("input", mergeProps({
                        "id": "securityGlobalLoginProtectionEnabled", "type": "checkbox"
                    }, (s.login_protection?.global_enabled !== false ? {
                        "checked": true
                    } : {})), []), " ", scope.tr("settings:auto.global_login_protection")]), h("label", {}, [scope.tr("settings:auto.global_failures")]), h("input", {
                    "id": "securityGlobalLoginMaxFailures", "type": "number", "min": Number(s.login_protection?.limits?.globalMaxFailures?.min || 0), "max": Number(s.login_protection?.limits?.globalMaxFailures?.max || 10000), "value": Number(s.login_protection?.global_max_failures || 50)
                }, []), h("label", {}, [scope.tr("settings:auto.global_window")]), h("input", {
                    "id": "securityGlobalLoginWindowSeconds", "type": "number", "min": Number(s.login_protection?.limits?.globalWindowSeconds?.min || 30), "max": Number(s.login_protection?.limits?.globalWindowSeconds?.max || 86400), "value": Number(s.login_protection?.global_window_seconds || 300)
                }, []), h("label", {}, [scope.tr("settings:auto.global_lock")]), h("input", {
                    "id": "securityGlobalLoginLockSeconds", "type": "number", "min": Number(s.login_protection?.limits?.globalLockSeconds?.min || 1), "max": Number(s.login_protection?.limits?.globalLockSeconds?.max || 86400), "value": Number(s.login_protection?.global_lock_seconds || 60)
                }, []), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.login_protection_hint")]), h("div", {
                    "class": "warning"
                }, [scope.tr("settings:auto.lan_password_warning")]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "class": "primary", "data-security-action": "policy", "onClick": (event: MouseEvent) => runSecuritySettingsAction('policy', event, scope.tr)
                    }, {
                        default: () => [scope.tr("settings:auto.save_auth_policy")]
                    }), h(TermaButton, {
                        "data-security-action": "logout", "onClick": (event: MouseEvent) => runSecuritySettingsAction('logout', event, scope.tr)
                    }, {
                        default: () => [scope.tr("settings:auto.sign_out")]
                    })])]), h("section", {}, [h("h3", {}, [scope.tr("settings:auto.session_management")]), h("label", {}, [scope.tr("settings:auto.session_ttl")]), h("input", {
                    "id": "securitySessionTtlMinutes", "type": "number", "min": Number(s.session_management?.limits?.ttl_minutes?.min || 5), "max": Number(s.session_management?.limits?.ttl_minutes?.max || 43200), "value": Number(s.session_management?.ttl_minutes || 720)
                }, []), h("label", {}, [scope.tr("settings:auto.session_max")]), h("input", {
                    "id": "securitySessionMaxSessions", "type": "number", "min": Number(s.session_management?.limits?.max_sessions?.min || 1), "max": Number(s.session_management?.limits?.max_sessions?.max || 10000), "value": Number(s.session_management?.max_sessions || 1000)
                }, []), h("label", {}, [scope.tr("settings:auto.session_cleanup")]), h("input", {
                    "id": "securitySessionCleanupMinutes", "type": "number", "min": Number(s.session_management?.limits?.cleanup_minutes?.min || 1), "max": Number(s.session_management?.limits?.cleanup_minutes?.max || 1440), "value": Number(s.session_management?.cleanup_minutes || 10)
                }, []), h("div", {
                    "class": "cmd"
                }, [scope.tr("settings:auto.active_sessions", {
                        count: Number(s.active_sessions || 0)
                    })]), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.session_hint")]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "class": "primary", "data-security-action": "session", "onClick": (event: MouseEvent) => runSecuritySettingsAction('session', event, scope.tr)
                    }, {
                        default: () => [settingsIcon("save"), h("span", {}, [scope.tr("settings:auto.save_session")])]
                    })])]), h("section", {}, [h("h3", {}, [scope.tr("settings:auto.passwords_tokens")]), h("label", {}, [scope.tr("settings:auto.set_web_password"), " ", h("span", {
                        "id": "securityPasswordState"
                    }, [scope.tr(s.password_set ? "settings:auto.set" : "settings:auto.not_set")])]), h(SettingsPasswordField, {
                    "id": "securityPassword", "placeholder": scope.tr("settings:auto.web_password_placeholder"),
                    showLabel: scope.tr('common:auto.show_password'),
                    hideLabel: scope.tr('common:auto.hide_password')
                }), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.web_password_hint")]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "data-security-action": "password", "onClick": (event: MouseEvent) => runSecuritySettingsAction('password', event, scope.tr)
                    }, {
                        default: () => [scope.tr("settings:auto.save_password")]
                    })]), h("label", {}, [scope.tr("settings:auto.access_token"), " ", h("span", {
                        "id": "securityTokenState"
                    }, [scope.tr(s.token_set ? "settings:auto.set" : "settings:auto.not_set")])]), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:auto.access_token_hint")]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "id": "securityTokenBtn", "data-security-action": "token", "onClick": (event: MouseEvent) => runSecuritySettingsAction('token', event, scope.tr)
                    }, {
                        default: () => [scope.tr(s.token_set ? "settings:auto.regenerate_token" : "settings:auto.generate_token")]
                    })])]), h("section", {
                "class": "security-encryption-section"
            }, [h("h3", {}, [scope.tr("settings:auto.config_encryption")]), h("details", {
                    "id": "securityAdvancedDetails", "class": "advanced-settings", "open": true
                }, [h("summary", {}, [scope.tr("settings:auto.config_encryption"), " ", scope.tr(s.encryption_transition_pending ? "settings:auto.encryption_transition_pending" : s.encryption_upgrade_required ? "settings:auto.encryption_upgrade_required" : s.encryption_enabled ? (s.encryption_unlocked ? "settings:auto.encryption_state_unlocked" : "settings:auto.encryption_state_locked") : "settings:auto.encryption_optional")]), h("div", {
                        "class": "muted"
                    }, [scope.tr("settings:auto.config_encryption_hint")]), h("div", {
                        "class": "warning"
                    }, [scope.tr("settings:auto.config_encryption_detail")]), h("label", {}, [scope.tr("settings:auto.master_password")]), h(SettingsPasswordField, {
                        "id": "securityMasterPassword", "placeholder": scope.tr(s.encryption_enabled ? "settings:auto.existing_master_password_placeholder" : "settings:auto.new_master_password_placeholder"),
                        showLabel: scope.tr('common:auto.show_password'),
                        hideLabel: scope.tr('common:auto.hide_password')
                    }), h("div", {
                        "class": "actions"
                    }, [" ", s.encryption_enabled ? "" : [h(TermaButton, {
                                "data-security-action": "enable", "onClick": (event: MouseEvent) => runSecuritySettingsAction('enable', event, scope.tr)
                            }, {
                                default: () => [scope.tr("settings:auto.enable_encryption")]
                            })], " ", s.encryption_enabled ? [h(TermaButton, {
                                "data-security-action": "unlock", "onClick": (event: MouseEvent) => runSecuritySettingsAction('unlock', event, scope.tr)
                            }, {
                                default: () => [scope.tr(s.encryption_transition_pending ? "settings:auto.continue_repair" : s.encryption_upgrade_required ? "settings:auto.unlock_rotate" : "settings:auto.unlock")]
                            }), s.encryption_transition_pending ? "" : [h(TermaButton, {
                                    "class": "danger", "data-security-action": "disable", "onClick": (event: MouseEvent) => runSecuritySettingsAction('disable', event, scope.tr)
                                }, {
                                    default: () => [scope.tr("settings:security.decrypt_disable")]
                                })]] : "", " "])])])])]);
}
export function renderKeysSettings(scope: SettingsViewPort): VNodeChild {
    const s = scope.securitySettings || {};
    return h("div", {
        "class": "settings-group", "id": "settings-key-management", hidden: scope.activeSettingsSection !== 'settings-key-management'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:sections.key_management", {
                    defaultValue: "用户密钥管理"
                })]), h("span", {}, [scope.tr("settings:key_management.description", {
                    defaultValue: "管理 Terma 密钥目录中的 SSH 私钥、公钥和部署操作。"
                })])]), h("div", {
            "class": "settings-grid single"
        }, [typeof sshKeyManagementView === "function" ? sshKeyManagementView(scope, s) : ""])]);
}
export function renderNotificationsSettings(scope: SettingsViewPort): VNodeChild {
    const system = efficiencyServices.termaSystemNotifications;
    return h('div', {class:'settings-group',id:'settings-notifications',hidden:scope.activeSettingsSection !== 'settings-notifications'}, [
        h('div', {class:'settings-group-head'}, [h('h3',null,scope.tr('settings:auto.notification_settings')),
            h('span',null,scope.tr('settings:auto.notifications_description'))]),
        h('div', {class:'settings-grid single'}, [h(NotificationSettings, {scope,
            permission:system?.permissionText() ?? '', toggleLabel:system?.toggleLabel() ?? ''})])
    ]);
}
export function renderRuntimeSettings(scope: SettingsViewPort): VNodeChild {
    return h("div", {
        "class": "settings-group", "id": "settings-runtime", hidden: scope.activeSettingsSection !== 'settings-runtime'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:sections.runtime")]), h("span", {}, [scope.tr("settings:auto.runtime_description")])]), h("div", {
            "class": "settings-grid runtime-settings-grid"
        }, [h("section", {}, [h("h3", {}, [scope.tr("settings:auto.listener_config")]), h("div", {
                    "id": "runtimeSettingsPanel"
                }, [h(RuntimeSettingsPanel, {scope})])]), h(RuntimeDiagnostics, {scope})])]);
}
export function renderCacheSettings(scope: SettingsViewPort): VNodeChild {
    return h("div", {
        "class": "settings-group", "id": "settings-cache", hidden: scope.activeSettingsSection !== 'settings-cache'
    }, [h("div", {
            "class": "settings-group-head"
        }, [h("h3", {}, [scope.tr("settings:sections.cache")]), h("span", {}, [scope.tr("settings:auto.cache_description")])]), h("div", {
            "class": "settings-grid single"
        }, [" ", cacheManagementPanelView(scope), " "])]);
}
export function renderAboutSettings(scope: SettingsViewPort): VNodeChild {
    return h('div', {
        class: 'settings-group terma-vue-root terma-about-root terma-about-embedded', id: 'settings-about', hidden: scope.activeSettingsSection !== 'settings-about', 'data-terma-about-owned': 'all'
    }, [h(AboutPage, {
            i18n: scope.aboutI18n, embedded: true, part: 'all', initialInfo: scope.aboutSettings
        })]);
}
export function renderSettingsBody(scope: SettingsViewPort): VNodeChild {
    return [h("div", {
            "class": "panel settings-panel"
        }, [h("div", {
                "class": "workspace-head"
            }, [h("div", {}, [h("h2", {}, [scope.tr("settings:title", {
                            defaultValue: "设置"
                        })]), h("div", {
                        "class": "subtitle"
                    }, [scope.tr("settings:subtitle", {
                            defaultValue: "访问保护、通知、运行信息与开源许可。"
                        })])])]), h("div", {
                "class": "settings-layout"
            }, [h("div", {
                    "class": "settings-groups"
                }, [renderGeneralSettings(scope), renderAiSettings(scope), renderSecuritySettings(scope), renderKeysSettings(scope), renderNotificationsSettings(scope), renderRuntimeSettings(scope), renderCacheSettings(scope), renderAboutSettings(scope)])])])];
}
