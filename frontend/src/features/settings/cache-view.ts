import {settingsServices} from '@/features/settings/installed-services';
import { h, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
export function cacheManagementPanelView(scope: SettingsViewPort): VNodeChild {
    const owner = settingsServices.termaProgramCache;
    const {usage: data, clearing} = owner.snapshot();
    const categories = data.categories || {};
    const categoryLabels = {
        sftp_downloads: scope.tr("settings:auto.cache_sftp_download", {
            defaultValue: "SFTP 下载"
        }),
        sftp_uploads: scope.tr("settings:auto.cache_sftp_upload", {
            defaultValue: "SFTP 上传"
        }),
        sftp_drag: scope.tr("settings:auto.cache_sftp_drag", {
            defaultValue: "SFTP 拖出"
        }),
        updates: scope.tr("settings:auto.cache_update_packages", {
            defaultValue: "更新安装包"
        }),
        remote_components: scope.tr("settings:auto.cache_component_residue", {
            defaultValue: "组件安装残留"
        }),
        local_installers: scope.tr("settings:auto.cache_component_packages", {
            defaultValue: "本机组件安装包"
        })
    };
    const retainedBytes = Number(data.retained_bytes || 0);
    const rows = Object.entries(categoryLabels).map(([id, label]) => {
        const item = categories[id] || {};
        const reclaimable = Number(item.reclaimable_bytes || 0);
        const clearLabel = scope.tr("settings:auto.cache_clear_category", {
            label, defaultValue: `清理${label}`
        });
        return [h("div", {
                "class": "cache-category-row"
            }, [h("div", {}, [h("strong", {}, [label]), h("span", {}, [scope.formatBytes(Number(item.bytes || 0)), item.busy ? ` · ${scope.tr("settings:auto.cache_in_use", {
                            defaultValue: "使用中"
                        })}` : ""])]), h(TermaButton, {
                    "class": "icon-button danger", "data-cache-category": id, "title": clearLabel, "aria-label": clearLabel,
                    disabled: clearing !== null || reclaimable <= 0, loading: clearing === id,
                    onClick: () => owner.clear(id, label)
                }, {
                    default: () => [settingsIcon("trash-2")]
                })])];
    });
    const retained = retainedBytes > 0 ? scope.tr("settings:auto.cache_retained", {
        bytes: scope.formatBytes(retainedBytes), defaultValue: ` · 暂时保留 ${scope.formatBytes(retainedBytes)}`
    }) : "";
    return [h("section", {
            "id": "cacheManagementPanel"
        }, [h("div", {
                "class": "settings-kv"
            }, [h("span", {}, [scope.tr("settings:auto.current_cache", {
                        defaultValue: "当前缓存"
                    })]), h("strong", {}, [scope.formatBytes(Number(data.bytes || 0))])]), h("div", {
                "class": "cache-category-list"
            }, [rows]), h("div", {
                "class": "muted"
            }, [scope.tr("settings:auto.cache_reclaimable", {
                    bytes: scope.formatBytes(Number(data.reclaimable_bytes || 0)), defaultValue: `可清理 ${scope.formatBytes(Number(data.reclaimable_bytes || 0))}。正在生成、传输、暂停、安装或失败待续传的文件会保留。`
                }), retained]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "id": "refreshProgramCacheButton", disabled: clearing !== null, onClick: () => owner.load()
                }, {
                    default: () => [settingsIcon("refresh-cw"), h("span", {}, [scope.tr("settings:auto.refresh_usage", {
                                defaultValue: "刷新占用"
                            })])]
                }), h(TermaButton, {
                    "id": "clearProgramCacheButton", "class": "danger",
                    disabled: clearing !== null || Number(data.reclaimable_bytes || 0) <= 0, loading: clearing === '',
                    onClick: () => owner.clear()
                }, {
                    default: () => [settingsIcon("trash-2"), h("span", {}, [clearing === '' ? scope.tr('settings:auto.cache_clearing') : scope.tr("settings:auto.clear_all", {
                                defaultValue: "清理全部"
                            })])]
                })])])];
}
