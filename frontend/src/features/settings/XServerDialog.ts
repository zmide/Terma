import {x11Services} from '@/features/x11/installed-services';
import {desktopAuthorizationView as desktopIntegrationAuthorizationMarkup} from '@/shared/ui/DesktopAuthorization';
import { h, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import {x11Presentation} from '../x11/presentation-service';
import type { SettingsDialogPort } from './settings-dialog-port';
export function renderLocalXServerDialog(scope: SettingsDialogPort, diagnostics: any): VNodeChild {
    const authorizationRequired = Boolean(diagnostics.authorization_required);
    const localDirectAuthorized = diagnostics.authorization_kind === "local-direct";
    const standaloneBackend = diagnostics.integration_available === false && !diagnostics.desktop_backend_available;
    const integrationUnavailable = authorizationRequired || standaloneBackend;
    const integrationUnavailableReason = x11Presentation.reason(diagnostics, standaloneBackend
        ? scope.tr("common:x11.standalone_backend_unavailable", {
            defaultValue: "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server"
        })
        : scope.tr("common:x11.browser_integration_unauthorized", {
            defaultValue: "当前浏览器会话没有桌面集成权限"
        }));
    const serverSide = diagnostics.server_side || {};
    const installLabel = diagnostics.platform === "linux"
        ? scope.tr("common:x11.install_linux_graphical_components", {
            defaultValue: "安装 Linux 图形组件"
        })
        : scope.tr("common:x11.install_xquartz_local", {
            defaultValue: "安装 XQuartz"
        });
    const linuxHint = !integrationUnavailable && diagnostics.platform === "linux"
        ? h("div", {class: "connection-test-status"}, scope.tr("common:x11.display_ready_no_connection", {
            defaultValue: "本机 DISPLAY 已就绪；SSH 普通终端是否转发图形窗口取决于对应连接保存的 X11 模式。"
        })) : null;
    const stateTitle = authorizationRequired
        ? scope.tr("common:x11.state_waiting_authorization", {
            defaultValue: "等待桌面授权"
        })
        : standaloneBackend
            ? scope.tr("common:x11.state_integration_unavailable", {
                defaultValue: "桌面集成不可用"
            })
            : diagnostics.available
                ? scope.tr("common:auto.ready", {
                    defaultValue: "已就绪"
                })
                : diagnostics.platform === "linux" && !diagnostics.display
                    ? scope.tr("common:x11.state_no_display", {
                        defaultValue: "未检测到桌面显示会话"
                    })
                    : diagnostics.running
                        ? scope.tr("common:auto.running", {
                            defaultValue: "正在运行"
                        })
                        : diagnostics.installed
                            ? scope.tr("common:x11.state_not_started", {
                                defaultValue: "未启动"
                            })
                            : scope.tr("common:auto.not_installed", {
                                defaultValue: "未安装"
                            });
    const stateReason = integrationUnavailable
        ? integrationUnavailableReason
        : x11Presentation.reason(diagnostics, scope.tr("common:x11.reason_xserver_unavailable", {
            defaultValue: "X Server 当前不可用"
        }));
    const stateIcon = authorizationRequired ? "shield-alert" : integrationUnavailable ? "monitor-x" : diagnostics.available ? "circle-check" : diagnostics.running ? "circle-pause" : "circle-alert";
    const stateClass = integrationUnavailable ? "warning" : diagnostics.available ? "ready" : diagnostics.running ? "warning" : "";
    const detailRow = (label: any, value: any) => [h("div", {}, [h("dt", {}, [label]), h("dd", {}, [value])])];
    const details = integrationUnavailable
        ? authorizationRequired
            ? [h("dl", {
                    "class": "xserver-details"
                }, [detailRow(scope.tr("common:x11.detail_current_backend", {
                        defaultValue: "当前后端"
                    }), scope.tr("common:x11.detail_terma_desktop_backend", {
                        defaultValue: "Terma 桌面后端"
                    })), detailRow(scope.tr("common:x11.detail_browser_session", {
                        defaultValue: "浏览器会话"
                    }), scope.tr("common:x11.detail_browser_not_authorized", {
                        defaultValue: "尚未获得桌面集成授权"
                    })), detailRow("X Server", diagnostics.running || diagnostics.available ? scope.tr("common:auto.running", {
                        defaultValue: "正在运行"
                    }) : scope.tr("common:x11.detail_status_limited", {
                        defaultValue: "状态受限"
                    })), serverSide.display ? detailRow(scope.tr("common:x11.detail_backend_display", {
                        defaultValue: "后端 DISPLAY"
                    }), serverSide.display) : "", detailRow(scope.tr("common:x11.detail_authorization_scope", {
                        defaultValue: "授权范围"
                    }), scope.tr("common:x11.detail_authorization_scope_value", {
                        defaultValue: "仅 X Server 与本机图形调用；时长由申请时选择"
                    }))])] : [h("dl", {
                "class": "xserver-details"
            }, [detailRow(scope.tr("common:x11.detail_current_backend", {
                    defaultValue: "当前后端"
                }), scope.tr("common:x11.detail_standalone_backend", {
                    defaultValue: "独立 Web/测试后端"
                })), detailRow(scope.tr("common:x11.detail_desktop_device", {
                    defaultValue: "桌面设备"
                }), scope.tr("common:x11.detail_xserver_unavailable", {
                    defaultValue: "无法探测 X Server"
                })), serverSide.display ? detailRow(scope.tr("common:x11.detail_backend_display", {
                    defaultValue: "后端 DISPLAY"
                }), serverSide.display) : "", detailRow(scope.tr("common:x11.detail_management_scope", {
                    defaultValue: "管理范围"
                }), scope.tr("common:x11.detail_terma_desktop_only", {
                    defaultValue: "仅运行 Terma 的桌面设备"
                }))])]
        : [h("dl", {
                "class": "xserver-details"
            }, [detailRow(scope.tr("common:x11.detail_run_mode", {
                    defaultValue: "运行方式"
                }), x11Presentation.modeLabel(String(diagnostics.mode || ''))), detailRow("DISPLAY", diagnostics.display || "-"), localDirectAuthorized ? detailRow(scope.tr("common:x11.detail_browser_permission", {
                    defaultValue: "浏览器权限"
                }), scope.tr("common:x11.detail_local_auto_authorized", {
                    defaultValue: "本机直连自动授权"
                })) : "", detailRow(scope.tr("common:x11.detail_management_scope", {
                    defaultValue: "管理范围"
                }), diagnostics.managed ? scope.tr("common:x11.detail_current_session", {
                    defaultValue: "Terma 当前会话"
                }) : scope.tr("common:x11.detail_system_session", {
                    defaultValue: "系统或桌面会话"
                })), ["win32", "darwin"].includes(diagnostics.platform) ? detailRow(scope.tr("common:x11.detail_next_start", {
                    defaultValue: "下次启动"
                }), diagnostics.auto_start === false ? scope.tr("common:x11.detail_keep_closed", {
                    defaultValue: "保持关闭"
                }) : scope.tr("common:x11.detail_auto_start", {
                    defaultValue: "自动启动"
                })) : ""])];
    const closeLabel = scope.tr("common:actions.close", {
        defaultValue: "关闭"
    });
    const managerTitle = scope.tr("common:x11.local_xserver_title", {
        defaultValue: "本机 X Server"
    });
    const managerSubtitle = authorizationRequired
        ? scope.tr("common:x11.browser_not_authorized", {
            defaultValue: "当前浏览器尚未授权"
        })
        : standaloneBackend
            ? scope.tr("common:x11.standalone_backend", {
                defaultValue: "独立 Web/测试后端"
            })
            : localDirectAuthorized
                ? scope.tr("common:x11.local_direct_authorized", {
                    defaultValue: "本机直连自动授权"
                })
                : diagnostics.server || x11Presentation.modeLabel(String(diagnostics.mode || ''));
    const autoStartHint = scope.tr("common:x11.auto_start_hint", {
        defaultValue: "自动启动只会启动已经存在的本机 X Server。Windows 源码启动会准备 Terma 内置运行时；Linux 和 macOS 的系统组件需要在此单独确认安装。"
    });
    const refreshLabel = scope.tr("common:auto.refresh", {
        defaultValue: "刷新"
    });
    const stopLabel = scope.tr("common:auto.stop", {
        defaultValue: "停止"
    });
    const startLabel = scope.tr("common:auto.start", {
        defaultValue: "启动"
    });
    return [h("div", {
            "class": "modal-card xserver-manager", "role": "dialog", "aria-modal": "true", "aria-labelledby": "xServerManagerTitle"
        }, [h("div", {
                "class": "modal-title-row"
            }, [h("div", {}, [h("h2", {
                        "id": "xServerManagerTitle"
                    }, [managerTitle]), h("span", {
                        "class": "muted"
                    }, [managerSubtitle])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "onClick": () => x11Services.termaX11.closeManager(), "title": closeLabel, "aria-label": closeLabel
                }, {
                    default: () => [settingsIcon("x")]
                })]), h("div", {
                "class": ["xserver-state ", stateClass].join('')
            }, [h("span", {}, [settingsIcon(stateIcon)]), h("div", {}, [h("b", {}, [stateTitle]), h("small", {}, [stateReason])])]), " ", details, " ", desktopIntegrationAuthorizationMarkup(scope, diagnostics, ["xserver"], {
                refreshTarget: "xserver"
            }), " ", !integrationUnavailable ? [h("div", {
                    "class": "connection-test-status"
                }, [autoStartHint])] : "", " ", linuxHint, " ", h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "onClick": () => x11Services.termaX11.manager.refresh()
                }, {
                    default: () => [settingsIcon("refresh-cw"), h("span", {}, [refreshLabel])]
                }), !integrationUnavailable && diagnostics.can_stop ? [h(TermaButton, {
                        "type": "button", "onClick": (event: MouseEvent) => x11Services.termaX11.manager.operate('stop', event.currentTarget as HTMLElement)
                    }, {
                        default: () => [settingsIcon("square"), h("span", {}, [stopLabel])]
                    })] : "", !integrationUnavailable && diagnostics.can_install ? [h(TermaButton, {
                        "class": "primary", "type": "button", "onClick": (event: MouseEvent) => x11Services.termaX11.manager.operate('install', event.currentTarget as HTMLElement)
                    }, {
                        default: () => [settingsIcon("download"), h("span", {}, [installLabel])]
                    })] : "", !integrationUnavailable && diagnostics.can_start ? [h(TermaButton, {
                        "class": "primary", "type": "button", "onClick": (event: MouseEvent) => x11Services.termaX11.manager.operate('start', event.currentTarget as HTMLElement)
                    }, {
                        default: () => [settingsIcon("play"), h("span", {}, [startLabel])]
                    })] : ""])])];
}

