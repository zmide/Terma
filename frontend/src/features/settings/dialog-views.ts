import {x11Services} from '@/features/x11/installed-services';
import { SettingsPasswordField } from './SettingsPasswordField';
import { LanguageOnboarding } from './LanguageOnboarding';
import type { LanguageOnboardingView } from './language-settings-controller';
import { h, mergeProps, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsDialogKind, SettingsDialogPort } from './settings-dialog-port';
import { renderLocalXServerDialog } from './XServerDialog';
import type { SshHostTrustChallenge } from './ssh-host-trust-dialog-service';
import { sshKeyAlgorithm, sshKeySizes, type WizardView, type KeyResultView } from './key-wizard-service';
import { keyManagementText, type PublicKeyDialog, type KeyPropertiesDialog, type KeyDeployDialog, type KeyImportDialog } from './managed-key-settings';
const connectionLabel = (connection: SettingsDialogPort['connections'][number]) => `${connection.name}  ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
const renderDialogEmptyState = (_kind: string, title: string) => h('div', {
    class: 'ui-state empty compact'
}, [h('strong', null, title)]);
function renderDirectory(scope: SettingsDialogPort, values: Record<string, any>): VNodeChild {
    const { listing, navigate, select } = values;
    return [h("div", {
            "class": "modal-card wide storage-directory-modal", "role": "dialog", "aria-modal": "true", "aria-labelledby": "storageDirectoryTitle"
        }, [h("h2", {
                "id": "storageDirectoryTitle"
            }, [scope.tr("settings:storage.select_runtime_root")]), h("div", {
                "class": "storage-directory-path"
            }, [h("code", {}, [listing.current])]), h("div", {
                "class": "storage-directory-roots", "aria-label": scope.tr("settings:storage.filesystem_roots")
            }, [(listing.roots || []).map((item: any, index: any) => [h(TermaButton, {
                        "type": "button", "data-storage-root": index, "class": item.path === listing.current ? "active" : "", onClick: () => navigate(item.path)
                    }, {
                        default: () => [settingsIcon("hard-drive"), h("span", {}, [item.name])]
                    })])]), h("div", {
                "class": "storage-directory-actions"
            }, [h(TermaButton, mergeProps({
                    "id": "storageDirectoryUp", "type": "button", onClick: () => { if (listing.parent) navigate(listing.parent); }
                }, (listing.parent ? {} : {
                    "disabled": true
                })), {
                    default: () => [settingsIcon("corner-left-up"), h("span", {}, [scope.tr("settings:storage.parent_directory")])]
                }), h(TermaButton, {
                    "id": "storageDirectorySelect", "class": "primary", "type": "button", onClick: select
                }, {
                    default: () => [settingsIcon("folder-check"), h("span", {}, [scope.tr("settings:storage.select_current")])]
                })]), h("div", {
                "class": "storage-directory-list"
            }, [listing.directories.length ? listing.directories.map((item: any, index: any) => [h(TermaButton, {
                        "type": "button", "data-storage-directory": index, onClick: () => navigate(item.path)
                    }, {
                        default: () => [settingsIcon("folder"), h("span", {}, [item.name])]
                    })]) : renderDialogEmptyState("empty", scope.tr("settings:storage.no_subdirectories"))]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "onClick": (event: any) => { scope.closeModal(); }
                }, {
                    default: () => [scope.tr("common:actions.cancel")]
                })])])];
}
function renderPublicKey(scope: SettingsDialogPort, { value, copy }: PublicKeyDialog): VNodeChild {
    return [h("div", {
            "class": "modal-card wide ssh-key-public-modal"
        }, [h("div", {
                "class": "ssh-key-public-head"
            }, [h("div", {}, [h("span", {
                        "class": "eyebrow"
                    }, [scope.tr('settings:key_management.public_eyebrow', {
                            defaultValue: 'PUBLIC KEY'
                        })]), h("h2", {}, [scope.tr('settings:key_management.public_title', {
                            defaultValue: 'SSH 公钥'
                        })])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [settingsIcon('x')]
                })]), h("div", {
                "class": "ssh-key-public-preview"
            }, [h("div", {
                    "class": "ssh-key-public-preview-icon"
                }, [settingsIcon('key-round')]), h("div", {}, [h("strong", {}, [scope.tr('settings:key_management.public_hint', {
                            defaultValue: '可安全复制到远端 authorized_keys'
                        })]), h("span", {}, [scope.tr('settings:key_management.public_readonly', {
                            defaultValue: '公钥内容只读显示，不会泄露私钥。'
                        })])])]), h("textarea", {
                "id": "managedPublicKeyText", "data-i18n-skip": true, "readonly": true
            }, [value || '']), h("div", {
                "class": "ssh-key-modal-actions"
            }, [h(TermaButton, {
                    "type": "button", "data-managed-copy": "true", onClick: copy
                }, {
                    default: () => [settingsIcon('copy'), h("span", {}, [scope.tr('settings:key_management.copy', {
                                defaultValue: '复制公钥'
                            })])]
                }), h(TermaButton, {
                    "type": "button", "class": "primary", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [scope.tr('common:actions.close', {
                            defaultValue: '关闭'
                        })]
                })])])];
}
function renderKeyProperties(scope: SettingsDialogPort, { data, save }: KeyPropertiesDialog): VNodeChild {
    const t = keyManagementText(scope.tr);
    const encrypted = data.has_passphrase === true;
    const fingerprint = data.fingerprint?.trim();
    return [h("div", {
            "class": "modal-card wide ssh-key-properties-modal"
        }, [h("div", {
                "class": "ssh-key-public-head"
            }, [h("div", {}, [h("span", {
                        "class": "eyebrow"
                    }, [t('properties_eyebrow', 'Key details')]), h("h2", {
                        "data-i18n-skip": true
                    }, [data.name || t('properties', 'Key properties')])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [settingsIcon('x')]
                })]), h("div", {
                "class": "ssh-key-properties-grid"
            }, [h("div", {}, [h("span", {}, [t('algorithm', 'Algorithm')]), h("strong", {}, [data.type || data.key_type || 'SSH'])]), h("div", {}, [h("span", {}, [t('length', 'Length')]), h("strong", {}, [data.bits ? `${data.bits} bit` : '-'])]), h("div", {}, [h("span", {}, [t('protection', 'Protection')]), h("strong", {
                        "class": encrypted ? 'is-encrypted' : 'is-open'
                    }, [settingsIcon(encrypted ? 'lock-keyhole' : 'unlock-keyhole'), encrypted ? t('encrypted', 'Encrypted') : t('not_encrypted', 'Unencrypted')])]), h("div", {}, [h("span", {}, [t('scope_column', 'Location')]), h("strong", {}, [data.scope === 'user' ? t('user_scope_short', 'User ~/.ssh') : t('project_scope', 'Terma key directory')])])]), h("div", {
                "class": "ssh-key-property-fingerprint"
            }, [h("span", {}, [t('fingerprint', 'Fingerprint')]), h("code", {}, [fingerprint || '-'])]), h("div", {
                "class": "ssh-key-property-field"
            }, [h("label", {
                    "for": "managedKeyComment"
                }, [t('comment', 'Comment')]), h("input", {
                    "id": "managedKeyComment", "value": data.comment || '', "maxlength": "120", "placeholder": t('comment_placeholder', 'For example: production, office laptop')
                }, [])]), h("div", {
                "class": "ssh-key-passphrase-box"
            }, [h("div", {}, [h("strong", {}, [encrypted ? t('change_passphrase', 'Change private-key passphrase') : t('set_passphrase', 'Set private-key passphrase')]), h("span", {}, [t('passphrase_hint', 'The passphrase is used only for this change and is not saved in Terma settings.')])]), h("label", {}, [t('current_passphrase', 'Current passphrase'), h(SettingsPasswordField, {
                        "id": "managedCurrentPassphrase", "autocomplete": "current-password", showLabel:scope.tr('common:auto.show_password'), hideLabel:scope.tr('common:auto.hide_password'), disabled:!encrypted
                    })]), h("label", {}, [t('new_passphrase', 'New passphrase'), h(SettingsPasswordField, {
                        "id": "managedNewPassphrase", "autocomplete": "new-password", "placeholder": t('empty_to_remove', 'Leave empty to remove the passphrase'),
                        showLabel: scope.tr('common:auto.show_password'),
                        hideLabel: scope.tr('common:auto.hide_password')
                    })])]), h("div", {
                "class": "ssh-key-modal-actions"
            }, [h(TermaButton, {
                    "type": "button", "data-managed-properties-save": "true", "class": "primary", onClick: save
                }, {
                    default: () => [settingsIcon('save'), h("span", {}, [t('save_changes', 'Save changes')])]
                }), h(TermaButton, {
                    "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [scope.tr('common:actions.cancel', {
                            defaultValue: 'Cancel'
                        })]
                })])])];
}
function renderKeyDeploy(scope: SettingsDialogPort, { deploy }: KeyDeployDialog): VNodeChild {
    const t = keyManagementText(scope.tr);
    const options = scope.connections.map((connection: any) => [h("option", {
            "value": connection.id
        }, [connectionLabel(connection)])]);
    return [h("div", {
            "class": "modal-card ssh-key-deploy-modal"
        }, [h("div", {
                "class": "ssh-key-public-head"
            }, [h("h2", {}, [t('deploy_title', '部署公钥')]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [settingsIcon('x')]
                })]), h("p", {
                "class": "muted"
            }, [t('deploy_hint', '选择一个 SSH 连接，将公钥追加到远端 authorized_keys。')]), h("label", {}, [t('target', '目标连接'), h("select", {
                    "id": "managedDeployConnection"
                }, [h("option", {
                        "value": [].join('')
                    }, [t('select_target', '选择 SSH 连接')]), options])]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "class": "primary", "data-managed-deploy-confirm": "true", onClick: deploy
                }, {
                    default: () => [settingsIcon('upload'), h("span", {}, [t('deploy', '部署公钥')])]
                }), h(TermaButton, {
                    "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [scope.tr('common:actions.cancel', {
                            defaultValue: '取消'
                        })]
                })])])];
}
function renderKeyImport(scope: SettingsDialogPort, { pick }: KeyImportDialog): VNodeChild {
    const t = keyManagementText(scope.tr);
    return [h("div", {
            "class": "modal-card ssh-key-deploy-modal"
        }, [h("div", {
                "class": "ssh-key-public-head"
            }, [h("h2", {}, [t('import_title', '导入 SSH 密钥')]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [settingsIcon('x')]
                })]), h("label", {}, [t('import_scope', '导入到'), h("select", {
                    "id": "managedImportScope"
                }, [h("option", {
                        "value": "project"
                    }, [t('project_scope', 'Terma 密钥目录')]), h("option", {
                        "value": "user"
                    }, [t('user_scope', '用户 ~/.ssh')])])]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "class": "primary", "data-managed-import-confirm": "true", onClick: pick
                }, {
                    default: () => [settingsIcon('upload'), h("span", {}, [t('choose_file', '选择私钥文件')])]
                }), h(TermaButton, {
                    "type": "button", "data-managed-modal-close": "true", onClick: scope.closeModal
                }, {
                    default: () => [scope.tr('common:actions.cancel', {
                            defaultValue: '取消'
                        })]
                })])])];
}
function renderKeyWizard(scope: SettingsDialogPort, values: WizardView): VNodeChild {
    return [h("form", {
            "class": "modal-card wide ssh-key-wizard",
            onSubmit(event: SubmitEvent) {
                event.preventDefault();
                const data = new FormData(event.currentTarget as HTMLFormElement);
                void values.submit({
                    name: String(data.get('name') || ''),
                    comment: String(data.get('comment') || ''),
                    passphrase: String(data.get('passphrase') || ''),
                    type: sshKeyAlgorithm(data.get('type')),
                    bits: Number(data.get('bits'))
                });
            }
        }, [h("h2", {}, [scope.tr("navigation:auto.ssh_key_wizard", {
                    defaultValue: "SSH 密钥向导"
                })]), h("div", {
                "class": "grid"
            }, [h("div", {}, [h("label", {}, [scope.tr("navigation:auto.key_name", {
                            defaultValue: "密钥名称"
                        })]), h("input", {
                        "id": "sshKeyName", "name": "name", "value": "id_ed25519_terma", "maxlength": "80"
                    }, [])]), h("div", {}, [h("label", {}, [scope.tr("navigation:auto.note", {
                            defaultValue: "备注"
                        })]), h("input", {
                        "id": "sshKeyComment", "name": "comment", "value": "Terma", "maxlength": "120"
                    }, [])])]), h("div", {
                "class": "grid"
            }, [h("div", {}, [h("label", {}, [scope.tr("navigation:auto.key_type", {
                            defaultValue: "密钥类型"
                        })]), h("select", {
                        "id": "sshKeyType", "name": "type",
                        onChange: (event: Event) => values.changeType(sshKeyAlgorithm((event.currentTarget as HTMLSelectElement).value))
                    }, [h("option", {
                            "value": "ed25519"
                        }, ["Ed25519"]), h("option", {
                            "value": "rsa"
                        }, ["RSA"]), h("option", {
                            "value": "ecdsa"
                        }, ["ECDSA"])])]), h("div", {}, [h("label", {}, [scope.tr("navigation:auto.key_bits", {
                            defaultValue: "密钥长度"
                        })]), h("select", {
                        "id": "sshKeyBits", "name": "bits",
                        disabled: values.wizardType === 'ed25519'
                    }, sshKeySizes[values.wizardType].map(value => h('option', { key: value, value: String(value) }, String(value) + (values.wizardType === 'ed25519' ? ' (' + scope.tr('navigation:auto.standard') + ')' : ''))))])]), h("label", {}, [scope.tr("navigation:auto.key_passphrase", {
                    defaultValue: "私钥口令（可选）"
                })]), h(SettingsPasswordField, {
                "id": "sshKeyPassphrase", "name": "passphrase", "autocomplete": "new-password",
                showLabel: scope.tr('common:auto.show_password'),
                hideLabel: scope.tr('common:auto.hide_password')
            }), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "class": "primary", "type": "submit", disabled: values.busy, loading: values.busy
                }, {
                    default: () => [settingsIcon("key-round"), h("span", {}, [scope.tr("navigation:auto.generate_key", {
                                defaultValue: "生成密钥"
                            })])]
                }), h(TermaButton, {
                    "onClick": (event: any) => { scope.closeModal(); }
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                })])])];
}
function renderKeyResult(scope: SettingsDialogPort, values: KeyResultView): VNodeChild {
    const { result } = values;
    return [h("form", {
            "class": "modal-card wide ssh-key-wizard ssh-key-result-modal",
            onSubmit(event: SubmitEvent) {
                event.preventDefault();
                void values.deploy(Number(new FormData(event.currentTarget as HTMLFormElement).get('connection')));
            }
        }, [h("div", {
                "class": "ssh-key-result-head"
            }, [h("div", {}, [h("h2", {}, [scope.tr("navigation:auto.key_generated", {
                            defaultValue: "密钥已生成"
                        })]), h("span", {}, [scope.tr("navigation:auto.key_generated_hint", {
                            defaultValue: "密钥已保存，可复制公钥或部署到 SSH 连接。"
                        })])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "onClick": (event: any) => { scope.closeModal(); }
                }, {
                    default: () => [settingsIcon("x")]
                })]), h("div", {
                "class": "key-result-summary"
            }, [h("div", {}, [h("span", {}, [scope.tr("navigation:auto.private_key_location", {
                            defaultValue: "私钥位置"
                        })]), h("code", {}, [result.private_path])]), h("span", {
                    "class": "status-pill"
                }, [result.has_passphrase ? scope.tr("navigation:auto.key_protected", {
                        defaultValue: "私钥已使用口令保护"
                    }) : scope.tr("navigation:auto.key_unprotected", {
                        defaultValue: "私钥未设置口令"
                    })])]), h("div", {
                "class": "ssh-key-result-section"
            }, [h("label", {
                    "for": "generatedPublicKey"
                }, [scope.tr("navigation:auto.public_key", {
                        defaultValue: "公钥"
                    })]), h("textarea", {
                    "id": "generatedPublicKey", "data-i18n-skip": true, "readonly": true
                }, [result.public_key])]), h("div", {
                "class": "ssh-key-result-section"
            }, [h("label", {
                    "for": "generatedKeyConnection"
                }, [scope.tr("navigation:auto.deploy_to_server", {
                        defaultValue: "部署到服务器"
                    })]), h("select", {
                    "id": "generatedKeyConnection", "name": "connection"
                }, [h("option", {
                        "value": [].join('')
                    }, [scope.tr("navigation:auto.select_ssh", {
                            defaultValue: "选择 SSH 连接"
                        })]), scope.connections.map((connection: any) => [h("option", {
                            "value": connection.id
                        }, [connectionLabel(connection)])])])]), h("div", {
                "class": "ssh-key-result-actions"
            }, [h(TermaButton, {
                    "onClick": values.copy
                }, {
                    default: () => [settingsIcon("copy"), h("span", {}, [scope.tr("navigation:auto.copy_public_key", {
                                defaultValue: "复制公钥"
                            })])]
                }), h(TermaButton, {
                    "onClick": values.download
                }, {
                    default: () => [settingsIcon("download"), h("span", {}, [scope.tr("navigation:auto.download_public_key", {
                                defaultValue: "下载公钥"
                            })])]
                }), h(TermaButton, {
                    "class": "primary", "type": "submit"
                }, {
                    default: () => [settingsIcon("upload"), h("span", {}, [scope.tr("navigation:auto.deploy_public_key", {
                                defaultValue: "部署公钥"
                            })])]
                }), h(TermaButton, {
                    "onClick": () => { scope.closeModal(); values.done(); }
                }, {
                    default: () => [scope.tr("navigation:auto.complete", {
                            defaultValue: "完成"
                        })]
                })])])];
}
function renderChoice(scope: SettingsDialogPort, values: Record<string, any>): VNodeChild {
    const { title, message, actions, finish } = values;
    return [h("div", {
            "class": "modal-card settings-choice-modal"
        }, [h("h2", {}, [title]), h("div", {
                "class": "modal-message"
            }, [message]), h("div", {
                "class": "actions"
            }, [actions.map((item: any, index: any) => [h(TermaButton, {
                        "class": item.className || "", "data-choice": index,
                        onClick: () => finish(actions[index].value)
                    }, {
                        default: () => [item.label]
                    })])])])];
}
function renderInput(scope: SettingsDialogPort, values: Record<string, any>): VNodeChild {
    const { title, label, defaultValue, finish } = values;
    return [h("div", {
            "class": "modal-card"
        }, [h("h2", {}, [title]), h("label", {}, [label]), h("input", {
                "id": "modalInputValue", "value": defaultValue,
                onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') {
                    event.preventDefault();
                    finish(String(scope.$('modalInputValue')?.value || '').trim());
                } }
            }, []), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "class": "primary", "id": "modalConfirmBtn",
                    onClick: () => finish(String(scope.$('modalInputValue')?.value || '').trim())
                }, {
                    default: () => [scope.tr("common:auto.confirm", {
                            defaultValue: "确定"
                        })]
                }), h(TermaButton, {
                    "id": "modalCancelBtn",
                    onClick: () => finish('')
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                })])])];
}
function renderHostTrust(scope: SettingsDialogPort, values: Record<string, any>): VNodeChild {
    const challenge: SshHostTrustChallenge = values.challenge || {};
    const changed = challenge.state === 'changed';
    const unknown = scope.tr('common:auto.unknown', { defaultValue: '未知' });
    const permanentLabel = changed
        ? scope.tr('common:dialogs.ssh_host_update_trust', { defaultValue: '更新并永久信任' })
        : scope.tr('common:dialogs.ssh_host_save_trust', { defaultValue: '信任并保存' });
    const title = changed
        ? scope.tr('common:dialogs.ssh_host_changed_title', { defaultValue: 'SSH 主机密钥发生变化' })
        : scope.tr('common:dialogs.ssh_host_verify_title', { defaultValue: '确认 SSH 主机指纹' });
    const hostLabel = challenge.host_label || scope.tr('common:dialogs.ssh_host_unknown', { defaultValue: '未知主机' });
    const notice = changed
        ? scope.tr('common:dialogs.ssh_host_changed_notice', { defaultValue: '保存过的主机密钥与本次连接不一致。这可能是服务器重装或密钥更新，也可能表示连接被冒充。请先核对新指纹。' })
        : scope.tr('common:dialogs.ssh_host_first_notice', { defaultValue: '这是 Terma 首次连接这台 SSH 主机。请与服务器管理员或可信渠道核对指纹。' });
    const finish = (value: 'once' | 'persist' | null) => values.finish(value);
    return [h('div', {
        class: ['modal-card', 'ssh-host-trust-modal', changed ? 'changed' : 'unknown'],
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'sshHostTrustTitle'
    }, [
        h('div', { class: 'ssh-host-trust-head' }, [
            h('span', { class: 'ssh-host-trust-icon', 'aria-hidden': 'true' }, [settingsIcon(changed ? 'shield-alert' : 'shield-question')]),
            h('div', {}, [
                h('h2', { id: 'sshHostTrustTitle' }, [title]),
                h('span', {}, [hostLabel])
            ])
        ]),
        h('div', { class: 'ssh-host-trust-notice' }, [notice]),
        h('dl', { class: 'ssh-host-trust-details' }, [
            h('div', {}, [
                h('dt', {}, [scope.tr('common:dialogs.ssh_host_algorithm', { defaultValue: '算法' })]),
                h('dd', {}, [challenge.key_type || unknown])
            ]),
            ...(changed ? [h('div', { class: 'previous' }, [
                h('dt', {}, [scope.tr('common:dialogs.ssh_host_previous_fingerprint', { defaultValue: '原指纹' })]),
                h('dd', {}, [h('code', {}, [challenge.previous_fingerprint || unknown])])
            ])] : []),
            h('div', { class: 'current' }, [
                h('dt', {}, [scope.tr(changed ? 'common:dialogs.ssh_host_new_fingerprint' : 'common:dialogs.ssh_host_fingerprint', { defaultValue: changed ? '新指纹' : '指纹' })]),
                h('dd', {}, [h('code', {}, [challenge.fingerprint || unknown])])
            ])
        ]),
        h('div', { class: 'ssh-host-trust-hint' }, [
            scope.tr('common:dialogs.ssh_host_once_hint', { defaultValue: '“仅本次信任”不会写入信任记录；下次连接仍会重新确认。' })
        ]),
        h('div', { class: 'actions ssh-host-trust-actions' }, [
            h(TermaButton, { id: 'sshHostTrustOnce', type: 'button', onClick: () => finish('once') }, {
                default: () => [scope.tr('common:dialogs.ssh_host_trust_once', { defaultValue: '仅本次信任' })]
            }),
            h(TermaButton, { id: 'sshHostTrustPersist', type: 'button', class: changed ? 'danger' : 'primary', onClick: () => finish('persist') }, {
                default: () => [permanentLabel]
            }),
            h(TermaButton, { id: 'sshHostTrustCancel', type: 'button', onClick: () => finish(null) }, {
                default: () => [scope.tr('common:actions.cancel', { defaultValue: '取消' })]
            })
        ])
    ])];
}
export function renderSettingsDialog(kind: SettingsDialogKind, scope: SettingsDialogPort, values: Record<string, any>): VNodeChild {
    switch (kind) {
        case 'language-onboarding': return h(LanguageOnboarding, { scope, view: values as LanguageOnboardingView });
        case 'xserver-local': return values.diagnostics ? renderLocalXServerDialog(scope, values.diagnostics) : h('div', {class:'modal-card xserver-manager'}, [h('h2',null,scope.tr('common:x11.local_xserver_title')),h('div',{class:values.error?'warning':'muted'},values.error||scope.tr('common:x11.opening_manager')),h(TermaButton,{onClick:()=>x11Services.termaX11.closeManager()},()=>scope.tr('common:actions.close'))]);
        case 'directory': return renderDirectory(scope, values);
        case 'public-key': return renderPublicKey(scope, values as PublicKeyDialog);
        case 'key-properties': return renderKeyProperties(scope, values as KeyPropertiesDialog);
        case 'key-deploy': return renderKeyDeploy(scope, values as KeyDeployDialog);
        case 'key-import': return renderKeyImport(scope, values as KeyImportDialog);
        case 'key-wizard': return renderKeyWizard(scope, values as WizardView);
        case 'key-result': return renderKeyResult(scope, values as KeyResultView);
        case 'choice': return renderChoice(scope, values);
        case 'input': return renderInput(scope, values);
        case 'host-trust': return renderHostTrust(scope, values);
        default: throw new Error('Unknown settings dialog');
    }
}
