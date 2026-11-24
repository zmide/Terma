import {x11Services} from '@/features/x11/installed-services';
import { SettingsPasswordField } from './SettingsPasswordField';
import { h, mergeProps, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
export function storageSettingsPanelView(scope: SettingsViewPort): VNodeChild {
    const settings = scope.desktopSettings?.settings || {};
    const paths = scope.desktopSettings?.paths || {};
    const storage = scope.desktopSettings?.storage || {};
    if (scope.runtimeSettings?.distribution === 'fnos')
        return [h("section", {
                "class": "desktop-settings-section storage-settings-section"
            }, [h("h3", {}, [scope.tr("settings:storage.title")]), h("div", {
                    "class": "muted"
                }, [scope.tr("errors:backend.fnos_storage_managed")]), h("div", {
                    "class": "desktop-current-paths"
                }, [h("code", {}, [scope.tr("settings:auto.data_path_label", {
                            path: paths.dataDir || ""
                        })]), h("code", {}, [scope.tr("settings:auto.key_path_label", {
                            path: paths.sshDir || ""
                        })])])])];
    const configurable = Boolean(scope.desktopSettings?.available);
    const saveAction = [h(TermaButton, {
            "class": "primary storage-settings-save", "type": "button", "onClick": (event: any) => {
                if (configurable) {
                    scope.saveDesktopSettings(event.currentTarget);
                }
                else {
                    scope.saveWebStorageSettings(event.currentTarget);
                }
            }
        }, {
            default: () => [settingsIcon("save"), h("span", {}, [scope.tr("settings:auto.save_data_restart")])]
        })];
    if (scope.desktopSettings?.storage_management_available === false)
        return [h("section", {
                "class": "desktop-settings-section storage-settings-section"
            }, [h("h3", {}, [scope.tr("settings:storage.title")]), h("div", {
                    "class": "warning"
                }, [scope.tr("settings:storage.remote_management_warning")])])];
    return [h("section", {
            "class": "desktop-settings-section storage-settings-section"
        }, [h("h3", {}, [scope.tr("settings:storage.title")]), h("div", {
                "class": "storage-settings-layout"
            }, [" ", configurable ? [h("label", {
                        "for": "desktopDataMode"
                    }, [scope.tr("settings:auto.data_path_mode")]), h("div", {
                        "class": "storage-settings-primary-row"
                    }, [h("select", {
                            "id": "desktopDataMode", "onChange": (event: any) => { scope.syncDesktopCustomDataMode(); }
                        }, [" ", scope.desktopSettings?.project_mode_available ? [h("option", mergeProps({
                                    "value": "project"
                                }, (settings.dataMode === "project" ? {
                                    "selected": true
                                } : {})), [scope.tr("settings:storage.project_folder")])] : "", " ", h("option", mergeProps({
                                "value": "user"
                            }, (settings.dataMode === "user" ? {
                                "selected": true
                            } : {})), [scope.tr("settings:storage.user_data_recommended")]), h("option", mergeProps({
                                "value": "custom"
                            }, (settings.dataMode === "custom" ? {
                                "selected": true
                            } : {})), [scope.tr("settings:storage.custom_path")])]), " ", saveAction, " "]), h("div", {
                        "id": "desktopCustomDataBox", "class": "desktop-custom-path"
                    }, [h("label", {
                            "for": "desktopCustomDataDir"
                        }, [scope.tr("settings:storage.custom_data_root")]), h("div", {
                            "class": "upload-line"
                        }, [h("input", {
                                "id": "desktopCustomDataDir", "value": settings.customDataDir || "", "placeholder": scope.tr("settings:auto.choose_absolute_path")
                            }, []), h(TermaButton, {
                                "type": "button", "onClick": (event: any) => { scope.chooseDesktopDataDirectory(); }
                            }, {
                                default: () => [settingsIcon("folder-open"), h("span", {}, [scope.tr("settings:storage.choose")])]
                            })])]), h("div", {
                        "class": "muted"
                    }, [scope.tr("settings:auto.data_path_restart_hint")])] : [h("label", {
                        "for": "webStorageRoot"
                    }, [scope.tr("settings:storage.runtime_root")]), h("div", {
                        "class": "storage-settings-primary-row"
                    }, [h("div", {
                            "class": "upload-line"
                        }, [h("input", {
                                "id": "webStorageRoot", "value": storage.root || scope.desktopSettings?.base_dir || "", "placeholder": scope.tr("settings:auto.choose_absolute_path")
                            }, []), h(TermaButton, {
                                "type": "button", "onClick": (event: any) => { scope.openStorageDirectoryBrowser(); }
                            }, {
                                default: () => [settingsIcon("folder-open"), h("span", {}, [scope.tr("settings:storage.browse")])]
                            })]), " ", saveAction, " "]), h("label", {
                        "class": "check-row"
                    }, [h("input", {
                            "id": "webStorageMigrate", "type": "checkbox", "checked": true
                        }, []), " ", scope.tr("settings:storage.copy_to_new_root")]), h("div", {
                        "class": "muted"
                    }, [scope.tr("settings:storage.web_root_hint")])], " ", h("div", {
                    "class": "desktop-current-paths"
                }, [h("code", {}, [scope.tr("settings:auto.data_path_label", {
                            path: paths.dataDir || "", defaultValue: `数据：${paths.dataDir || ""}`
                        })]), h("code", {}, [scope.tr("settings:auto.key_path_label", {
                            path: paths.sshDir || "", defaultValue: `密钥：${paths.sshDir || ""}`
                        })])])])])];
}
export function desktopBehaviorPanelView(scope: SettingsViewPort): VNodeChild {
    if (!scope.desktopSettings?.available)
        return "";
    const settings = scope.desktopSettings.settings || {};
    const xserver = scope.desktopSettings.xserver || {};
    const vnc = scope.desktopSettings.vnc_client || {};
    const configuredVncPath = String(vnc.configured_path || "").trim();
    const vncStatusIcon = vnc.available ? "circle-check" : vnc.requires_selection ? "circle-alert" : "circle-minus";
    const vncStatus = configuredVncPath
        ? scope.tr("settings:auto.vnc_client_saved", {
            client: vnc.client || configuredVncPath, defaultValue: `已保存：${vnc.client || configuredVncPath}`
        })
        : vnc.available
            ? scope.tr("settings:auto.vnc_client_detected", {
                client: vnc.client || scope.tr("settings:auto.unknown_value", {
                    defaultValue: "系统客户端"
                }), defaultValue: `自动检测：${vnc.client || "系统客户端"}`
            })
            : scope.tr("settings:auto.vnc_client_missing", {
                defaultValue: "尚未选择系统 VNC 客户端"
            });
    const vncPath = configuredVncPath || String(vnc.executable || "").trim();
    const displaySuffix = xserver.display ? ` · ${xserver.display}` : "";
    const xserverState = xserver.available
        ? scope.tr("settings:auto.xserver_ready", {
            display: displaySuffix, defaultValue: `已就绪${displaySuffix}`
        })
        : scope.tr(xserver.installed ? "settings:storage.xserver_startable" : "settings:auto.not_installed");
    return [h("section", {
            "class": "desktop-settings-section", "id": "desktopBehaviorPanel"
        }, [h("h3", {}, [scope.tr("settings:auto.desktop_behavior")]), h("div", {
                "class": "muted"
            }, [scope.tr("settings:auto.desktop_behavior_hint")]), h("div", {
                "class": "desktop-settings-grid"
            }, [h("div", {
                    "class": "desktop-toggle-list"
                }, [h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "desktopOpenAtLogin", "type": "checkbox"
                        }, (settings.openAtLogin ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:auto.open_at_login")]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "desktopMinimizeToTray", "type": "checkbox"
                        }, (settings.minimizeToTray ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:auto.minimize_to_tray")]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "desktopStartMinimized", "type": "checkbox"
                        }, (settings.startMinimizedToTray ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:auto.start_minimized")]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "desktopStartupNotification", "type": "checkbox"
                        }, (settings.showStartupNotification ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:auto.startup_notification")]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "desktopXServerAutoStart", "type": "checkbox"
                        }, (settings.xServerAutoStart !== false ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:auto.prepare_xserver")])])]), h("div", {
                "class": "desktop-runtime-row"
            }, [h("span", {}, [settingsIcon(xserver.available ? "circle-check" : xserver.installed ? "circle-pause" : "circle-alert"), h("b", {}, ["X Server"]), h("small", {}, [xserverState])]), h(TermaButton, {
                    "type": "button", "onClick": () => x11Services.termaX11.openManager(0, "", "settings")
                }, {
                    default: () => [settingsIcon("x11"), h("span", {}, [scope.tr("settings:storage.manage")])]
                })]), h("div", {
                "class": "desktop-runtime-row desktop-vnc-client-row"
            }, [h("span", {}, [settingsIcon(vncStatusIcon), h("b", {}, [scope.tr("settings:auto.vnc_client_title", {
                            defaultValue: "系统 VNC 客户端"
                        })]), h("small", {
                        "title": vncPath
                    }, [vncStatus])]), h(TermaButton, {
                    "type": "button", "onClick": (event: any) => { scope.chooseDesktopVncClient(); }
                }, {
                    default: () => [settingsIcon("folder-open"), h("span", {}, [configuredVncPath ? scope.tr("settings:auto.vnc_client_change", {
                                defaultValue: "更改"
                            }) : scope.tr("settings:auto.vnc_client_choose", {
                                defaultValue: "选择"
                            })])]
                })]), h("div", {
                "class": "muted desktop-vnc-client-hint"
            }, [scope.tr("settings:auto.vnc_client_persistent_hint", {
                    defaultValue: "首次选择后会持久化保存到 Terma 设置中；以后打开系统 VNC 客户端不会重复询问。需要更换时，请在这里修改。"
                })]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "id": "desktopSettingsSaveBtn", "class": "primary", "type": "button", "onClick": (event: any) => { scope.saveDesktopSettings(event.currentTarget); }
                }, {
                    default: () => [settingsIcon("save"), h("span", {}, [scope.tr("settings:auto.save_desktop_behavior")])]
                })])])];
}
