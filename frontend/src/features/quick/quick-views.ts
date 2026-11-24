import {quickServices} from '@/features/quick/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import type { X11Modal } from '../x11/x11-surfaces';
import {x11Presentation} from '../x11/presentation-service';
import {desktopAuthorizationView} from '@/shared/ui/DesktopAuthorization';
import { h, mergeProps, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { quickIcon, quickEmptyState, paintQuickView, appendQuickView } from './quick-mount';
import { QUICK_RESULT_LIMIT } from './quick-connect-search-service';
import type { QuickViewHost, QuickViewPort } from './quick-port';
import { managementContent } from '../remote/RemoteManagementView';
import { x11RemoteActionKey } from '../x11/remote-service';
import type { X11Snapshot } from '../x11/x11-types';
export function quickResultLimitHtml(scope: QuickViewPort, shown: any, total: any): any {
    if (shown >= total)
        return "";
    return [h("div", {
            "class": "quick-result-limit"
        }, [scope.tr("connections:quick_open.result_limit", {
                shown, total, defaultValue: `仅显示前 ${shown} / ${total} 项，请继续输入关键词缩小范围`
            })])];
}
export function renderQuickConnectionRows(scope: QuickViewPort, query: any = ""): any {
    const list: any = scope.$("quickConnectionList");
    if (!list)
        return;
    const allConnectionRows: any = scope.search.connectionRows(query);
    const allForwardRows: any = scope.search.forwardRows(query);
    const rows: any = allConnectionRows.slice(0, QUICK_RESULT_LIMIT);
    const forwardRows: any = allForwardRows.slice(0, QUICK_RESULT_LIMIT);
    const target: any = scope.ssh.parse(query);
    const exact: any = scope.ssh.matching(target);
    const savedRows: any = rows.map((connection: any) => [h("div", {
            "class": "quick-connection-row", "data-dblclick-action": "quick-connect-terminal", "data-connection-id": connection.id, "tabindex": "0", "title": scope.tr("connections:quick_open.double_click_terminal", {
                defaultValue: "双击打开终端"
            })
        }, [h("strong", {
                "title": connection.name
            }, [quickIcon(connection.favorite ? "star" : "server"), h("span", {}, [connection.name])]), h("code", {
                "title": connection.ssh_host
            }, [connection.ssh_host]), h("span", {
                "class": "quick-connection-port"
            }, [Number(connection.ssh_port || 22)]), h("span", {
                "class": "quick-connection-user", "title": ["SSH · ", connection.ssh_user].join('')
            }, ["SSH · ", connection.ssh_user]), h("div", {
                "class": "quick-connection-actions"
            }, [h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-action": "quick-connect-edit", "data-connection-id": connection.id, "title": scope.tr("connections:quick_open.edit", {
                        defaultValue: "编辑连接"
                    }), "aria-label": scope.tr("connections:quick_open.edit", {
                        defaultValue: "编辑连接"
                    })
                }, {
                    default: () => [quickIcon("pencil")]
                }), h(TermaButton, {
                    "class": "icon-button primary", "type": "button", "data-action": "quick-connect-terminal", "data-connection-id": connection.id, "title": scope.tr("connections:quick_open.open_terminal", {
                        defaultValue: "打开终端"
                    }), "aria-label": scope.tr("connections:quick_open.open_terminal", {
                        defaultValue: "打开终端"
                    })
                }, {
                    default: () => [quickIcon("square-terminal")]
                }), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-action": "quick-connect-sftp", "data-connection-id": connection.id, "title": scope.tr("connections:quick_open.open_sftp", {
                        defaultValue: "打开 SFTP 文件管理"
                    }), "aria-label": scope.tr("connections:quick_open.open_sftp", {
                        defaultValue: "打开 SFTP 文件管理"
                    })
                }, {
                    default: () => [quickIcon("folder-sync")]
                })])])]);
    const forwardingRows: any = forwardRows.map(({ connection, forward }: any) => {
        const accessUrl: any = quickServices.termaQuickForwardPresentation.url(forward);
        const status: any = quickServices.termaQuickForwardPresentation.status(forward);
        const type: any = [quickServices.termaQuickForwardPresentation.mode(forward), forward.service_type && forward.service_type !== "other" ? String(forward.service_type).toUpperCase() : ""].filter(Boolean).join(" · ");
        const server: any = `${connection.name} · ${connection.ssh_host}`;
        const openRule: any = scope.tr("connections:quick_open.open_forward", {
            defaultValue: "打开转发规则"
        });
        const openUrl: any = scope.tr("connections:quick_open.open_forward_url", {
            defaultValue: "打开访问地址"
        });
        const toggleLabel: any = forwardsServices.termaForwardRuntime.isActive(forward)
            ? scope.tr("connections:quick_open.stop_forward", {
                defaultValue: "停止转发"
            })
            : scope.tr("connections:quick_open.start_forward", {
                defaultValue: "启动转发"
            });
        const addressLabel: any = scope.tr("connections:quick_open.access_address", {
            defaultValue: "访问地址"
        });
        const typeText: any = type || scope.tr("connections:quick_open.forward_rule", {
            defaultValue: "转发规则"
        });
        return [h("div", {
                "class": "quick-connection-row quick-forward-row", "data-dblclick-action": "quick-connect-forward", "data-connection-id": connection.id, "data-forward-id": forward.id, "tabindex": "0", "title": openRule
            }, [h("strong", {
                    "title": quickServices.termaQuickForwardPresentation.name(forward)
                }, [quickIcon("route"), h("span", {}, [quickServices.termaQuickForwardPresentation.name(forward)]), h("small", {
                        "class": ["quick-forward-status ", forward.status || "stopped"].join('')
                    }, [status])]), h("span", {
                    "class": "quick-forward-server"
                }, [h("code", {
                        "title": server
                    }, [server]), accessUrl ? [h("small", {
                            "title": accessUrl
                        }, [addressLabel, "：", accessUrl])] : ""]), h("span", {
                    "class": "quick-connection-port"
                }, [Number(forward.bind_port || 0)]), h("span", {
                    "class": "quick-connection-user", "title": `${typeText} · ${quickServices.termaQuickForwardPresentation.rule(forward)}`
                }, [typeText]), h("div", {
                    "class": "quick-connection-actions quick-forward-actions"
                }, [" ", accessUrl ? [h("a", {
                            "class": "icon-button", "href": accessUrl, "target": "_blank", "rel": "noopener", "title": openUrl, "aria-label": openUrl
                        }, [quickIcon("external-link")])] : "", " ", h(TermaButton, {
                        "class": ["icon-button", forwardsServices.termaForwardRuntime.isActive(forward) ? " danger" : " primary"].join(''), "type": "button", "data-action": "quick-forward-toggle", "data-forward-id": forward.id, "title": toggleLabel, "aria-label": toggleLabel
                    }, {
                        default: () => [quickIcon(forwardsServices.termaForwardRuntime.isActive(forward) ? "square" : "play")]
                    }), h(TermaButton, {
                        "class": "icon-button primary", "type": "button", "data-action": "quick-connect-forward", "data-connection-id": connection.id, "data-forward-id": forward.id, "title": openRule, "aria-label": openRule
                    }, {
                        default: () => [quickIcon("route")]
                    })])])];
    });
    const targetRows: any = target && !allForwardRows.length ? [exact.length ? "" : [h(TermaButton, {
                "class": "quick-connection-target-row primary-target", "type": "button", "data-action": "quick-connect-direct"
            }, {
                default: () => [h("span", {
                        "class": "quick-result-icon"
                    }, [quickIcon("zap")]), h("span", {}, [h("strong", {}, [scope.tr("connections:quick_open.quick_connect", {
                                defaultValue: "快速连接"
                            })]), h("small", {}, [scope.ssh.endpoint(target), " · ", scope.tr("connections:quick_open.quick_connect_hint", {
                                defaultValue: "可使用终端、SFTP 与 X11，不保存连接"
                            })])]), h("span", {}, [quickIcon("square-terminal")])]
            })], h(TermaButton, {
            "class": "quick-connection-target-row", "type": "button", "data-action": "quick-connect-new"
        }, {
            default: () => [h("span", {
                    "class": "quick-result-icon"
                }, [quickIcon("plus")]), h("span", {}, [h("strong", {}, [scope.tr("connections:quick_open.new_ssh_connection", {
                            defaultValue: "新建 SSH 连接"
                        })]), h("small", {}, [scope.tr("connections:quick_open.new_ssh_hint", {
                            endpoint: scope.ssh.endpoint(target), defaultValue: `使用 ${scope.ssh.endpoint(target)} 填充连接表单`
                        })])]), h("span", {}, [quickIcon("pencil")])]
        })] : "";
    const connectionSection: any = rows.length ? [h("div", {
            "class": "quick-result-section-label"
        }, [h("span", {}, [scope.tr("connections:quick_open.connections", {
                    defaultValue: "SSH 连接"
                })]), h("span", {}, [allConnectionRows.length])]), savedRows, quickResultLimitHtml(scope, rows.length, allConnectionRows.length)] : "";
    const forwardSection: any = forwardRows.length ? [h("div", {
            "class": "quick-result-section-label"
        }, [h("span", {}, [scope.tr("connections:quick_open.forwards", {
                    defaultValue: "转发规则"
                })]), h("span", {}, [allForwardRows.length])]), forwardingRows, quickResultLimitHtml(scope, forwardRows.length, allForwardRows.length)] : "";
    paintQuickView(list, (rows.length || forwardRows.length || targetRows.length) ? [connectionSection, forwardSection, targetRows] : quickEmptyState("empty", scope.tr("connections:quick_open.no_matching_servers", {
        defaultValue: "没有匹配的连接或转发"
    }), query
        ? scope.tr("connections:quick_open.direct_target_hint", {
            defaultValue: "也可以输入 用户名@主机:端口 直接连接"
        })
        : scope.tr("connections:quick_open.add_ssh_hint", {
            defaultValue: "请先添加 SSH 连接或转发规则"
        })));
    scope.refreshIcons();
}
export function openQuickConnectionLauncher(scope: QuickViewPort): any {
    const modal: any = scope.$("modal");
    if (!modal)
        return;
    modal.dataset.quickConnectionLauncher = "1";
    paintQuickView(modal, [h("div", {
            "class": "modal-card quick-connection-modal", "role": "dialog", "aria-modal": "true", "aria-labelledby": "quickConnectionTitle"
        }, [h("header", {
                "class": "quick-connection-head"
            }, [h("div", {}, [h("h2", {
                        "id": "quickConnectionTitle"
                    }, [scope.tr("connections:quick_open.title", {
                            defaultValue: "快速打开"
                        })]), h("span", {}, [scope.tr("connections:quick_open.subtitle", {
                            defaultValue: "搜索 SSH 连接和转发规则；双击打开"
                        })])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-action": "quick-connect-close", "title": scope.tr("common:actions.close", {
                        defaultValue: "关闭"
                    }), "aria-label": scope.tr("common:actions.close", {
                        defaultValue: "关闭"
                    })
                }, {
                    default: () => [quickIcon("x")]
                })]), h("label", {
                "class": "quick-connection-search"
            }, [quickIcon("search"), h("input", {
                    "id": "quickConnectionSearch", "type": "search", "autocomplete": "off", "spellcheck": "false", "placeholder": scope.tr("connections:quick_open.search_placeholder", {
                        defaultValue: "搜索连接、转发、端口或 URL，也可输入 用户名@主机:端口"
                    }), "data-input-action": "quick-connect-search", "data-keydown-action": "quick-connect-keydown"
                }, [])]), h("div", {
                "class": "quick-connection-table"
            }, [h("div", {
                    "class": "quick-connection-columns", "aria-hidden": "true"
                }, [h("span", {}, [scope.tr("connections:quick_open.name", {
                            defaultValue: "名称"
                        })]), h("span", {}, [scope.tr("connections:quick_open.host", {
                            defaultValue: "服务器"
                        })]), h("span", {}, [scope.tr("connections:quick_open.port", {
                            defaultValue: "端口"
                        })]), h("span", {}, [scope.tr("connections:quick_open.kind_or_user", {
                            defaultValue: "类型 / 用户"
                        })]), h("span", {
                        "class": "quick-connection-actions-heading"
                    }, [scope.tr("connections:quick_open.actions", {
                            defaultValue: "操作"
                        })])]), h("div", {
                    "id": "quickConnectionList", "class": "quick-connection-list"
                }, [])])])]);
    modal.hidden = false;
    modal.onclick = null;
    renderQuickConnectionRows(scope);
    scope.$("quickConnectionSearch")?.focus({
        preventScroll: true
    });
}
export function closeQuickConnectionLauncher(scope: QuickViewPort): any {
    const modal: any = scope.$("modal");
    if (!modal || modal.dataset.quickConnectionLauncher !== "1")
        return;
    scope.cancelQuickSearch();
    modal.hidden = true;
    modal.dataset.quickConnectionLauncher = "";
    modal.onclick = null;
    paintQuickView(modal, "");
}
export function syncQuickSshAuthFields(scope: QuickViewPort): any {
    const keyAuth: any = scope.sshFlow.authType() === "key";
    const password: any = scope.$("quickSshPassword");
    const key: any = scope.$("quickSshIdentity");
    const passphrase: any = scope.$("quickSshPassphrase");
    if (password) {
        password.closest(".quick-ssh-auth-panel").hidden = keyAuth;
        password.required = !keyAuth;
        password.disabled = keyAuth;
    }
    if (key) {
        key.closest(".quick-ssh-auth-panel").hidden = !keyAuth;
        key.required = keyAuth;
        key.disabled = !keyAuth;
    }
    if (passphrase)
        passphrase.disabled = !keyAuth;
}
export function closeQuickSshAuthModal(scope: QuickViewPort): any {
    scope.sshFlow.cancel();
    const modal: any = scope.$("modal");
    if (!modal || modal.dataset.quickSshAuth !== "1")
        return;
    modal.dataset.quickSshAuth = "";
    modal.hidden = true;
    modal.onkeydown = null;
    paintQuickView(modal, "");
}
export async function startQuickSshConnection(scope: QuickViewPort, target: any, options: any = {}): Promise<any> {
    if (!target?.host)
        return;
    scope.sshFlow.closeSurfaces();
    const identities: any = await scope.api("/api/identity-files").catch(() => []);
    const modal: any = scope.$("modal");
    modal.dataset.quickSshAuth = "1";
    const title: any = options.repair
        ? scope.tr("connections:quick_ssh.repair_title", {
            defaultValue: "修复临时 SSH 凭据"
        })
        : options.reconnectKey
            ? scope.tr("connections:quick_ssh.reconnect_title", {
                defaultValue: "重新认证快速连接"
            })
            : scope.tr("connections:quick_ssh.title", {
                defaultValue: "快速连接"
            });
    paintQuickView(modal, [h("form", {
            "class": "modal-card quick-ssh-auth-modal", "data-submit-action": "quick-ssh-submit", "data-host": target.host, "data-port": Number(target.port || 22), "data-reconnect-key": options.reconnectKey || ""
        }, [h("header", {
                "class": "quick-ssh-auth-head"
            }, [h("div", {}, [h("h2", {}, [title]), h("span", {}, [scope.ssh.endpoint(target)])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "data-action": "quick-ssh-close", "title": scope.tr("common:actions.close", {
                        defaultValue: "关闭"
                    }), "aria-label": scope.tr("common:actions.close", {
                        defaultValue: "关闭"
                    })
                }, {
                    default: () => [quickIcon("x")]
                })]), h("div", {
                "class": "quick-ssh-target-grid"
            }, [h("div", {}, [h("label", {
                        "for": "quickSshUser"
                    }, [scope.tr("connections:auto.ssh_user", {
                            defaultValue: "SSH 用户名"
                        })]), h("input", {
                        "id": "quickSshUser", "required": true, "autocomplete": "username", "value": target.user || "", "placeholder": "root"
                    }, [])]), h("div", {}, [h("label", {
                        "for": "quickSshPort"
                    }, [scope.tr("connections:auto.ssh_port", {
                            defaultValue: "端口"
                        })]), h("input", {
                        "id": "quickSshPort", "type": "number", "min": "1", "max": "65535", "required": true, "value": Number(target.port || 22)
                    }, [])])]), h("fieldset", {
                "class": "quick-ssh-auth-choice"
            }, [h("legend", {}, [scope.tr("connections:auto.login_method", {
                        defaultValue: "认证方式"
                    })]), h("label", {}, [h("input", {
                        "type": "radio", "name": "quickSshAuthType", "value": "password", "checked": true, "data-change-action": "quick-ssh-auth-type"
                    }, []), h("span", {}, [quickIcon("key-round"), scope.tr("connections:auto.password_login", {
                            defaultValue: "密码"
                        })])]), h("label", {}, [h("input", {
                        "type": "radio", "name": "quickSshAuthType", "value": "key", "data-change-action": "quick-ssh-auth-type"
                    }, []), h("span", {}, [quickIcon("file-key"), scope.tr("connections:auto.key_login", {
                            defaultValue: "私钥"
                        })])])]), h("div", {
                "class": "quick-ssh-auth-panel"
            }, [h("label", {
                    "for": "quickSshPassword"
                }, [scope.tr("connections:auto.ssh_password", {
                        defaultValue: "SSH 密码"
                    })]), h("input", {
                    "id": "quickSshPassword", "type": "password", "required": true, "autocomplete": "current-password"
                }, [])]), h("div", {
                "class": "quick-ssh-auth-panel", "hidden": true
            }, [h("label", {
                    "for": "quickSshIdentity"
                }, [scope.tr("connections:auto.key_login", {
                        defaultValue: "私钥"
                    })]), h("select", {
                    "id": "quickSshIdentity"
                }, [h("option", {
                        "value": [].join('')
                    }, [scope.tr("connections:identity.select", {
                            defaultValue: "请选择私钥"
                        })]), identities.map((item: any) => [h("option", {
                            "value": item.path
                        }, [scope.localizedIdentityFileLabel(item, {
                                permission: true
                            })])])]), h("label", {
                    "for": "quickSshPassphrase"
                }, [scope.tr("connections:auto.key_passphrase", {
                        defaultValue: "私钥口令（可选）"
                    })]), h("input", {
                    "id": "quickSshPassphrase", "type": "password", "autocomplete": "off"
                }, [])]), h("div", {
                "id": "quickSshStatus", "class": ["quick-ssh-status ", options.repair ? "warning" : ""].join(''), "aria-live": "polite"
            }, [options.repair ? scope.tr("connections:quick_ssh.repair_hint", {
                    defaultValue: "上次认证失败。请修改用户名、密码或私钥；新凭据仍只用于本次临时会话，不会保存到连接库。"
                }) : scope.tr("connections:quick_ssh.session_hint", {
                    defaultValue: "凭据仅用于本次临时会话（最长 12 小时），不会保存到连接库。"
                })]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "data-action": "quick-ssh-new"
                }, {
                    default: () => [scope.tr("connections:quick_ssh.save_connection", {
                            defaultValue: "保存为 SSH 连接"
                        })]
                }), h(TermaButton, {
                    "type": "button", "data-action": "quick-ssh-close"
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                }), h(TermaButton, {
                    "id": "quickSshConnect", "class": "primary", "type": "submit"
                }, {
                    default: () => [quickIcon("square-terminal"), h("span", {}, [scope.tr("connections:quick_ssh.connect_terminal", {
                                defaultValue: "连接终端"
                            })])]
                })])])]);
    modal.hidden = false;
    modal.onkeydown = (event: any) => {
        if (event.key === "Escape")
            closeQuickSshAuthModal(scope);
    };
    const preferredAuth: any = options.authType === "key" ? "key" : "password";
    const authInput: any = document.querySelector(`input[name="quickSshAuthType"][value="${preferredAuth}"]`);
    if (authInput)
        authInput.checked = true;
    syncQuickSshAuthFields(scope);
    scope.refreshIcons();
    setTimeout(() => scope.$(target.user ? "quickSshPassword" : "quickSshUser")?.focus({
        preventScroll: true
    }), 0);
}
export function openTerminalSessionManager(_scope:QuickViewPort){return sessionEfficiencyServices.termaSessionEfficiency.open();}
export {renderSftpJob} from '../files/sftp/TaskCard';
export function showXServerManagerLoading(scope: QuickViewPort): any {
    const modal: any = scope.$("modal");
    const closeLabel: any = scope.tr("common:actions.close", {
        defaultValue: "关闭"
    });
    const title: any = scope.tr("common:x11.local_xserver_title", {
        defaultValue: "本机 X Server"
    });
    modal.dataset.xServerManager = "1";
    paintQuickView(modal, [h("div", {
            "class": "modal-card xserver-manager", "role": "dialog", "aria-modal": "true", "aria-labelledby": "xServerManagerTitle"
        }, [h("div", {
                "class": "modal-title-row"
            }, [h("div", {}, [h("h2", {
                        "id": "xServerManagerTitle"
                    }, [title]), h("span", {
                        "class": "muted"
                    }, [scope.tr("common:x11.loading_context", {
                            defaultValue: "正在读取本机与当前 SSH 上下文"
                        })])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "onClick": () => x11Services.termaX11.closeManager(), "title": closeLabel, "aria-label": closeLabel
                }, {
                    default: () => [quickIcon("x")]
                })]), h("div", {
                "class": "xserver-state loading"
            }, [h("span", {}, [quickIcon("loader-circle")]), h("div", {}, [h("b", {}, [scope.tr("common:x11.opening_manager", {
                            defaultValue: "正在打开 X Server 管理"
                        })]), h("small", {}, [scope.tr("common:x11.checking_context", {
                            defaultValue: "正在检查桌面授权、DISPLAY 和 SSH X11 转发状态..."
                        })])])])])]);
    modal.hidden = false;
    modal.onclick = null;
    scope.refreshIcons();
}
export function renderXServerManager(scope: QuickViewPort, snapshot: X11Snapshot) {
 const modal=scope.$('modal');
 if (!modal) return;
 const {diagnostics,sshX11,x11Clipboard,connection}=snapshot;const quickConnection=Boolean(connection?.quick_connection);
    const busy = x11Services.termaX11.manager.state.busy;
    const authorizationRequired: any = Boolean(diagnostics.authorization_required);
    const localDirectAuthorized: any = diagnostics.authorization_kind === "local-direct";
    const standaloneBackend: any = diagnostics.integration_available === false && !diagnostics.desktop_backend_available;
    const integrationUnavailable: any = authorizationRequired || standaloneBackend;
    const integrationUnavailableReason: any = x11Presentation.reason(diagnostics, standaloneBackend
        ? scope.tr("common:x11.standalone_backend_unavailable", {
            defaultValue: "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server"
        })
        : scope.tr("common:x11.browser_integration_unauthorized", {
            defaultValue: "当前浏览器会话没有桌面集成权限"
        }));
    const serverSide: any = diagnostics.server_side || {};
    const installLabel: any = diagnostics.platform === "linux"
        ? scope.tr("common:x11.install_linux_graphical_components", {
            defaultValue: "安装 Linux 图形组件"
        })
        : scope.tr("common:x11.install_xquartz_local", {
            defaultValue: "安装 XQuartz"
        });
    const defaultX11Mode: any = connection?.x11_mode === "trusted" ? "trusted" : connection?.x11_mode === "untrusted" ? "untrusted" : "off";
    const temporaryX11Label: any = scope.tr("common:x11.open_temporary_terminal", {
        defaultValue: "临时打开 X11 终端"
    });
    const defaultEnableLabel: any = scope.tr("common:x11.default_enable", {
        defaultValue: "普通终端默认启用"
    });
    const defaultDisableLabel: any = scope.tr("common:x11.default_disable", {
        defaultValue: "关闭普通终端默认 X11"
    });
    const linuxX11Action: any = !integrationUnavailable && diagnostics.platform === "linux" && connection
        ? [h(TermaButton, {
                "class": "primary", "type": "button", disabled: busy, "onClick": () => x11Services.termaX11.openTerminalFromManager(Number(connection.id))
            }, {
                default: () => [quickIcon("square-terminal"), h("span", {}, [temporaryX11Label])]
            }), quickConnection ? "" : [h(TermaButton, {
                    "type": "button", disabled: busy, "onClick": (event: any) => x11Services.termaX11.changeDefault(Number(connection.id), defaultX11Mode === "off" ? "trusted" : "off", event.currentTarget)
                }, {
                    default: () => [quickIcon(defaultX11Mode === "off" ? "badge-check" : "circle-off"), h("span", {}, [defaultX11Mode === "off" ? defaultEnableLabel : defaultDisableLabel])]
                })]] : "";
    const linuxHint: any = !integrationUnavailable && diagnostics.platform === "linux" && diagnostics.available
        ? [h("div", {
                "class": "connection-test-status"
            }, [quickConnection
                    ? scope.tr("common:x11.quick_display_ready", {
                        name: connection?.name, defaultValue: `本机 DISPLAY 已就绪；“${connection?.name}”是临时连接，可临时打开 X11 终端，但不会保存默认 X11 配置。`
                    })
                    : connection
                        ? defaultX11Mode === "off"
                            ? scope.tr("common:x11.display_ready_default_off", {
                                name: connection.name, defaultValue: `本机 DISPLAY 已就绪；“${connection.name}”的普通终端尚未默认请求 X11，可临时打开或保存为默认。`
                            })
                            : scope.tr("common:x11.display_ready_default_mode", {
                                name: connection.name, mode: defaultX11Mode === "trusted" ? scope.tr("common:auto.trusted_x11", {
                                    defaultValue: "可信 X11"
                                }) : scope.tr("common:auto.untrusted_x11", {
                                    defaultValue: "受限 X11"
                                }), defaultValue: `“${connection.name}”的普通终端已默认使用${defaultX11Mode === "trusted" ? "可信" : "受限"} X11，可直接运行 Java GUI 等图形程序。`
                            })
                        : scope.tr("common:x11.display_ready_no_connection", {
                            defaultValue: "本机 DISPLAY 已就绪；SSH 普通终端是否转发图形窗口取决于对应连接保存的 X11 模式。"
                        })])] : "";
    const sshX11Block: any = renderSshX11ForwardingPanel(scope, connection, sshX11);
    const x11ClipboardBlock: any = renderX11ClipboardHelperPanel(scope, connection, x11Clipboard);
    const stateTitle: any = authorizationRequired
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
    const stateReason: any = integrationUnavailable
        ? integrationUnavailableReason
        : x11Presentation.reason(diagnostics, scope.tr("common:x11.reason_xserver_unavailable", {
            defaultValue: "X Server 当前不可用"
        }));
    const stateIcon: any = authorizationRequired ? "shield-alert" : integrationUnavailable ? "monitor-x" : diagnostics.available ? "circle-check" : diagnostics.running ? "circle-pause" : "circle-alert";
    const stateClass: any = integrationUnavailable ? "warning" : diagnostics.available ? "ready" : diagnostics.running ? "warning" : "";
    const detailRow: any = (label: any, value: any) => [h("div", {}, [h("dt", {}, [label]), h("dd", {}, [value])])];
    const details: any = integrationUnavailable
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
                })), ["win32", "darwin"].includes(diagnostics.platform||"") ? detailRow(scope.tr("common:x11.detail_next_start", {
                    defaultValue: "下次启动"
                }), diagnostics.auto_start === false ? scope.tr("common:x11.detail_keep_closed", {
                    defaultValue: "保持关闭"
                }) : scope.tr("common:x11.detail_auto_start", {
                    defaultValue: "自动启动"
                })) : ""])];
    const closeLabel: any = scope.tr("common:actions.close", {
        defaultValue: "关闭"
    });
    const managerTitle: any = scope.tr("common:x11.local_xserver_title", {
        defaultValue: "本机 X Server"
    });
    const managerSubtitle: any = authorizationRequired
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
    const autoStartHint: any = scope.tr("common:x11.auto_start_hint", {
        defaultValue: "自动启动只会启动已经存在的本机 X Server。Windows 源码启动会准备 Terma 内置运行时；Linux 和 macOS 的系统组件需要在此单独确认安装。"
    });
    const refreshLabel: any = scope.tr("common:auto.refresh", {
        defaultValue: "刷新"
    });
    const stopLabel: any = scope.tr("common:auto.stop", {
        defaultValue: "停止"
    });
    const startLabel: any = scope.tr("common:auto.start", {
        defaultValue: "启动"
    });
    paintQuickView(modal, [h("div", {
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
                    default: () => [quickIcon("x")]
                })]), h("div", {
                "class": ["xserver-state ", stateClass].join('')
            }, [h("span", {}, [quickIcon(stateIcon)]), h("div", {}, [h("b", {}, [stateTitle]), h("small", {}, [stateReason])])]), " ", details, " ", desktopIntegrationAuthorizationMarkup(scope, diagnostics, ["xserver"], {
                refreshTarget: "xserver"
            }), " ", !integrationUnavailable ? [h("div", {
                    "class": "connection-test-status"
                }, [autoStartHint])] : "", " ", linuxHint, " ", sshX11Block, " ", x11ClipboardBlock, h("div",{id:"x11ForwardingTaskState"}), " ", h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", disabled: busy, "onClick": () => x11Services.termaX11.manager.refresh()
                }, {
                    default: () => [quickIcon("refresh-cw"), h("span", {}, [refreshLabel])]
                }), !integrationUnavailable && diagnostics.can_stop ? [h(TermaButton, {
                        "type": "button", disabled: busy, "onClick": (event: any) => x11Services.termaX11.manager.operate('stop', event.currentTarget)
                    }, {
                        default: () => [quickIcon("square"), h("span", {}, [stopLabel])]
                    })] : "", !integrationUnavailable && diagnostics.can_install ? [h(TermaButton, {
                        "class": "primary", "type": "button", disabled: busy, "onClick": (event: any) => x11Services.termaX11.manager.operate('install', event.currentTarget)
                    }, {
                        default: () => [quickIcon("download"), h("span", {}, [installLabel])]
                    })] : "", !integrationUnavailable && diagnostics.can_start ? [h(TermaButton, {
                        "class": "primary", "type": "button", disabled: busy, "onClick": (event: any) => x11Services.termaX11.manager.operate('start', event.currentTarget)
                    }, {
                        default: () => [quickIcon("play"), h("span", {}, [startLabel])]
                    })] : "", linuxX11Action])])]);
    modal.hidden = false;
    modal.dataset.xServerManager = "1";
    scope.refreshIcons();
    if (connection) {
        const actionKey = x11RemoteActionKey('forwarding', Number(connection.id));
        scope.syncUiActionControls(actionKey, scope.isUiActionInFlight(actionKey));
        const componentsActionKey = x11RemoteActionKey('components', Number(connection.id));
        scope.syncUiActionControls(componentsActionKey, scope.isUiActionInFlight(componentsActionKey));
        const clipboardActionKey = x11RemoteActionKey('clipboard', Number(connection.id));
        scope.syncUiActionControls(clipboardActionKey, scope.isUiActionInFlight(clipboardActionKey));
    }
    return true;
}
export function renderSshX11ForwardingPanel(scope: Pick<QuickViewHost, 'tr' | 'sshAuthenticationFailure' | 'localizedTermaUiPhrase'>, connection: any, sshX11: any, source = "xserver"): any {
    if (!connection)
        return "";
    const quickConnection: any = Boolean(connection.quick_connection || Number(connection.id) < 0);
    const connectionLabel: any = quickConnection ? scope.tr("remote:management.temporary_connection", {
        name: connection.name, defaultValue: `${connection.name}（临时）`
    }) : connection.name;
    const id = Number(connection.id);
    if (sshX11?.error) {
        const authenticationFailed: any = typeof scope.sshAuthenticationFailure === "function" && scope.sshAuthenticationFailure(sshX11);
        const repairAction: any = !authenticationFailed ? "" : quickConnection
            ? [h(TermaButton, {
                    "type": "button", "onClick": () => x11Services.termaX11.repairTemporary(id)
                }, {
                    default: () => [quickIcon("key-round"), h("span", {}, [scope.tr("common:actions.repair_temporary_credentials", {
                                defaultValue: "修复临时 SSH 凭据"
                            })])]
                })] : [h(TermaButton, {
                "type": "button", "onClick": () => x11Services.termaX11.repair(id, source)
            }, {
                default: () => [quickIcon("key-round"), h("span", {}, [scope.tr("common:actions.repair_credentials", {
                            defaultValue: "修复 SSH 凭据"
                        })])]
            })];
        return [h("div", {
                "class": "x11-forwarding-panel warning"
            }, [h("div", {
                    "class": "x11-forwarding-head"
                }, [h("span", {}, [quickIcon("circle-alert")]), h("div", {}, [h("b", {}, [scope.tr("common:x11.forwarding_title", {
                                name: connectionLabel, defaultValue: `远端 SSH X11 组件与转发 · ${connectionLabel}`
                            })]), h("small", {}, [typeof scope.localizedTermaUiPhrase === "function" ? scope.localizedTermaUiPhrase(sshX11.error) : sshX11.error])])]), repairAction ? [h("div", {
                        "class": "actions"
                    }, [repairAction])] : ""])];
    }
    const enabled: any = sshX11?.x11_forwarding === "yes";
    const macos: any = sshX11?.platform === "macos";
    const ready: any = Boolean(sshX11?.ready ?? (enabled && sshX11?.xauth_path));
    const status: any = enabled
        ? ready
            ? scope.tr("common:x11.status_ready", {
                defaultValue: "已开启，xauth 配置可用"
            })
            : macos && !sshX11?.xquartz_installed
                ? scope.tr("common:x11.status_xquartz_missing", {
                    defaultValue: "已开启，但远端未安装 XQuartz"
                })
                : macos && !sshX11?.xauth_location_valid
                    ? scope.tr("common:x11.status_xauth_location_invalid", {
                        defaultValue: "已开启，但 sshd 的 XAuthLocation 不可用"
                    })
                    : scope.tr("common:x11.status_xauth_missing", {
                        defaultValue: "已开启，但未检测到 xauth"
                    })
        : sshX11?.x11_forwarding === "no" ? scope.tr("common:x11.status_disabled", {
            defaultValue: "已关闭"
        }) : scope.tr("common:x11.status_unknown", {
            defaultValue: "未能确定"
        });
    const action: any = enabled ? "disable" : "enable";
    const actionKey = x11RemoteActionKey('forwarding', id);
    const operateForwarding = (event: MouseEvent) => x11Services.termaX11.remote.operate(id, 'forwarding', action, event.currentTarget as HTMLElement, source);
    const forwardingAction: any = action === "enable"
        ? scope.tr("common:x11.enable_forwarding", {
            defaultValue: "开启 X11 转发"
        })
        : scope.tr("common:x11.disable_forwarding", {
            defaultValue: "关闭 X11 转发"
        });
    const automaticAction: any = sshX11.can_manage
        ? [h(TermaButton, {
                "class": action === "enable" ? "primary" : "danger", "type": "button", "data-ui-action-key": actionKey, "onClick": operateForwarding
            }, {
                default: () => [quickIcon(action === "enable" ? "shield-check" : "shield-off"), h("span", {}, [forwardingAction])]
            })] : [h(TermaButton, {
            "class": action === "enable" ? "primary" : "danger", "type": "button", "data-ui-action-key": actionKey, "onClick": operateForwarding
        }, {
            default: () => [quickIcon("key-round"), h("span", {}, [scope.tr(action === "enable" ? "common:x11.temporary_enable" : "common:x11.temporary_disable", {
                        defaultValue: `临时授权后${action === "enable" ? "开启" : "关闭"}`
                    })])]
        }), sshX11.can_terminal_manage && sshX11.terminal_commands?.[action] ? [h(TermaButton, {
                "type": "button", "onClick": () => x11Services.termaX11.remote.configureTerminal(id, action, source)
            }, {
                default: () => [quickIcon("square-terminal"), h("span", {}, [scope.tr(action === "enable" ? "common:x11.manual_enable" : "common:x11.manual_disable", {
                            defaultValue: `在终端手动${action === "enable" ? "开启" : "关闭"}`
                        })])]
            })] : ""];
    const installX11Components: any = macos && !sshX11?.xquartz_installed
        ? [h(TermaButton, {
                "type": "button", "onClick": () => x11Services.termaX11.openGuide(id)
            }, {
                default: () => [quickIcon("package-plus"), h("span", {}, [scope.tr("common:x11.install_xquartz", {
                            defaultValue: "安装远端 XQuartz"
                        })])]
            })] : !macos && !sshX11?.xauth_path
        ? [h(TermaButton, {
                "type": "button", "onClick": () => x11Services.termaX11.openGuide(id)
            }, {
                default: () => [quickIcon("package-plus"), h("span", {}, [scope.tr("common:x11.install_components", {
                            defaultValue: "安装 xauth / X11 组件"
                        })])]
            })] : "";
    const uninstallX11Components: any = !macos && sshX11?.xauth_path
        ? [h(TermaButton, {
                "class": "danger", "type": "button", "data-ui-action-key": x11RemoteActionKey('components', id), "onClick": (event: any) => x11Services.termaX11.remote.operate(id, 'components', 'uninstall', event.currentTarget, 'xserver')
            }, {
                default: () => [quickIcon("package-minus"), h("span", {}, [scope.tr("common:x11.remove_components", {
                            defaultValue: "卸载 X11 组件"
                        })])]
            })] : "";
    const privilegeHint: any = !sshX11.can_manage && sshX11.can_terminal_manage
        ? [h("div", {
                "class": "x11-forwarding-hint"
            }, [scope.tr(quickConnection ? "common:x11.quick_privilege_hint" : "common:x11.privilege_hint", {
                    defaultValue: quickConnection ? "后台探测使用当前临时凭据，不会保存连接或继承终端中的 sudo -i；管理员授权只用于这一次操作。" : "后台探测会使用保存的 SSH 账号建立独立连接，不会继承其他终端中的 sudo -i。通过终端操作时可正常输入 sudo 密码。"
                })])] : "";
    const missingXauthHint: any = enabled && !ready
        ? [h("div", {
                "class": "x11-forwarding-hint warning"
            }, [scope.tr(macos ? "common:x11.missing_xquartz_hint" : "common:x11.missing_xauth_hint", {
                    defaultValue: macos ? "远端缺少可用的 XQuartz/xauth，SSH 可以连接，但图形窗口无法转发。" : "远端未检测到 xauth，sshd 无法为 X11 会话创建授权 Cookie；请安装后重新建立 X11 终端。"
                })])] : "";
    return [h("div", {
            "class": ["x11-forwarding-panel ", ready ? "ready" : enabled ? "warning" : ""].join('')
        }, [h("div", {
                "class": "x11-forwarding-head"
            }, [h("span", {}, [quickIcon(ready ? "circle-check" : enabled ? "circle-alert" : "circle-off")]), h("div", {}, [h("b", {}, [scope.tr("common:x11.forwarding_title", {
                            name: connectionLabel, defaultValue: `远端 SSH X11 组件与转发 · ${connectionLabel}`
                        })]), h("small", {}, [status, " · ", sshX11.config_file || "/etc/ssh/sshd_config"])])]), h("div", {
                "class": "x11-forwarding-meta"
            }, [h("span", {}, [scope.tr("common:x11.platform", {
                        platform: macos ? "macOS" : "Linux", defaultValue: `平台：${macos ? "macOS" : "Linux"}`
                    })]), h("span", {}, ["sshd: ", sshX11.sshd_present ? scope.tr("common:auto.detected", {
                        defaultValue: "已检测"
                    }) : scope.tr("common:auto.not_detected", {
                        defaultValue: "未检测到"
                    })]), h("span", {}, [macos ? "XQuartz" : "xauth", ": ", macos ? (sshX11.xquartz_installed ? scope.tr("common:auto.installed", {
                        defaultValue: "已安装"
                    }) : scope.tr("common:auto.not_installed", {
                        defaultValue: "未安装"
                    })) : (sshX11.xauth_path || scope.tr("common:auto.not_detected", {
                        defaultValue: "未检测到"
                    }))]), h("span", {}, ["XAuthLocation: ", sshX11.xauth_location || scope.tr("common:auto.not_set", {
                        defaultValue: "未设置"
                    })]), h("span", {}, ["DISPLAY ", scope.tr("common:x11.offset", {
                        defaultValue: "偏移"
                    }), ": ", sshX11.x11_display_offset || scope.tr("common:auto.unknown", {
                        defaultValue: "未知"
                    })])]), missingXauthHint, h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "type": "button", "onClick": () => source === 'linux-desktop' ? remoteServices.termaRemoteManagement.desktop.load() : x11Services.termaX11.manager.refresh()
                }, {
                    default: () => [quickIcon("refresh-cw"), h("span", {}, [scope.tr("common:actions.detect_again", {
                                defaultValue: "重新检测"
                            })])]
                }), installX11Components, uninstallX11Components, automaticAction]), privilegeHint])];
}
export function renderX11ClipboardHelperPanel(scope: QuickViewPort, connection: any, diagnostics: any): any {
    if (!connection)
        return "";
    const id: any = Number(connection.id || 0);
    const actionKey = x11RemoteActionKey('clipboard', id);
    if (!diagnostics)
        return [h("section", {
                "class": "xserver-clipboard-panel"
            }, [h("div", {
                    "class": "connection-test-status warning"
                }, [scope.tr("common:x11.clipboard_status_failed", {
                        defaultValue: "无法读取远端 xclip 状态，请刷新后重试。"
                    })])])];
    const plan: any = diagnostics.install_plan || {};
    const installed: any = diagnostics.installed === true;
    const stateClass: any = installed ? "success" : diagnostics.platform === "linux" ? "warning" : "error";
    const stateText: any = installed
        ? scope.tr("common:x11.clipboard_installed", {
            defaultValue: "远端已安装 xclip，可用于 X11 图片剪贴板。"
        })
        : diagnostics.platform === "linux"
            ? scope.tr("common:x11.clipboard_missing", {
                defaultValue: "远端尚未安装 xclip；安装后，X11 转发终端可接收本机剪贴板图片。"
            })
            : scope.tr("common:x11.clipboard_not_linux", {
                defaultValue: "当前远端不是 Linux，Terma 不会安装 xclip。"
            });
    const guides = remoteServices.termaRemoteManagement.guides;
    const install = !installed && diagnostics.platform === 'linux'
        ? guides.install(plan, (mode, button) => x11Services.termaX11.remote.operate(id, 'clipboard', mode, button, 'xserver'), undefined, actionKey) : undefined;
    const manual = guides.manual(plan, {
        steps: Array.isArray(diagnostics.guide?.steps) ? diagnostics.guide.steps : [],
        commands: Array.isArray(diagnostics.guide?.commands) ? diagnostics.guide.commands : [],
        note: scope.tr("common:x11.clipboard_note", {
            defaultValue: "图片通过 SSH X11 转发直接写入远端图形剪贴板；VNC 连接的图片剪贴板仍需在 VNC 会话中配置对应的 xclip 或 wl-clipboard。"
        })
    });
    const retryLabel: any = scope.tr("common:x11.clipboard_retry", {
        defaultValue: "重新检测"
    });
    return [h("section", {
            "class": ["xserver-clipboard-panel ", installed ? "ready" : "warning"].join('')
        }, [h("div", {
                "class": "remote-service-head xserver-clipboard-head"
            }, [h("span", {
                    "class": ["remote-service-icon ", installed ? "ready" : "warning"].join('')
                }, [quickIcon(installed ? "clipboard-check" : "clipboard-x")]), h("div", {}, [h("b", {}, [scope.tr("common:x11.clipboard", {
                            defaultValue: "X11 图片剪贴板"
                        })]), h("small", {}, [connection.name || connection.ssh_host || scope.tr("common:x11.remote_host", {
                            defaultValue: "SSH 主机"
                        }), " · ", diagnostics.package_manager || scope.tr("common:x11.package_unknown", {
                            defaultValue: "未识别包管理器"
                        })])]), h(TermaButton, {
                    "class": "icon-button", "type": "button", "onClick": () => x11Services.termaX11.inspectClipboard(id), "title": retryLabel, "aria-label": retryLabel
                }, {
                    default: () => [quickIcon("refresh-cw")]
                })]), h("div", {
                "class": ["connection-test-status ", stateClass].join('')
            }, [quickIcon(installed ? "circle-check" : "info"), h("span", {}, [stateText])]), managementContent({install, manual}), installed ? [h("div", {
                    "class": "actions tight"
                }, [h(TermaButton, {
                        "class": "danger", "type": "button", "data-ui-action-key": actionKey, "onClick": (event: any) => x11Services.termaX11.remote.operate(id, 'clipboard', 'uninstall', event.currentTarget, 'xserver')
                    }, {
                        default: () => [quickIcon("package-minus"), h("span", {}, [scope.tr("common:x11.remove_xclip", {
                                    defaultValue: "卸载 xclip"
                                })])]
                    })])] : "", h("div", {
                "id": "x11ClipboardTaskState"
            }, [])])];
}
export const desktopIntegrationAuthorizationMarkup = desktopAuthorizationView;
export function renderX11InstallGuide(scope:QuickViewPort,connectionId:number,result:import('../x11/x11-types').X11Result):any {const modal=scope.$('modal') as X11Modal | null;
        if (!modal) return;
        if(!result.discovery&&!result.install_plan){
            const failed=typeof result.error==='string';
            paintQuickView(modal,h('section',{class:'modal-card wide x11-install-guide',role:'dialog','aria-modal':'true'},[h('div',{class:'modal-title-row'},[h('h2',{id:'x11InstallGuideTitle'},scope.tr('common:x11.install_graphical_apps')),h(TermaButton,{class:'icon-button',title:scope.tr('common:actions.close'),'aria-label':scope.tr('common:actions.close'),onClick:()=>x11Services.termaX11.closeGuide()},()=>quickIcon('x'))]),h('div',{class:['connection-test-status','remote-diagnostic-status',failed?'error':'busy']},[h('span',{class:'remote-diagnostic-icon'},quickIcon(failed?'circle-alert':'loader-circle')),h('span',{class:'remote-diagnostic-copy'},failed?String(result.error):scope.tr('common:x11.detecting_applications')),failed?h('span',{class:'remote-diagnostic-actions'},h(TermaButton,{onClick:()=>x11Services.termaX11.openGuide(connectionId)},()=>scope.tr('common:actions.retry'))):null]) ]));
            modal._x11ConnectionId=connectionId;modal.hidden=false;return;
        }
        const discovery: any = result.discovery || {};
        const plan: any = result.install_plan || discovery.install_plan || {};
        const guides = remoteServices.termaRemoteManagement.guides;
        const command = guides.mode(plan, 'online').command || String(plan.command || '').trim();
        const optional: any = Array.isArray(plan.optional_commands) ? plan.optional_commands : [];
        const macos: any = discovery.platform === "macos";
        const installed: any = macos ? Boolean(discovery.xquartz_installed && discovery.xauth_available) : Boolean(discovery.xauth_available);
        const applicationCount: any = Array.isArray(discovery.applications) ? discovery.applications.length : 0;
        const installStateClass: any = installed ? "success" : plan.supported ? "warning" : "error";
        const installStateText: any = installed
            ? macos
                ? scope.tr("common:x11.guide_xquartz_ready", {
                    defaultValue: "远端 XQuartz 与 xauth 已识别，X11 组件已经可用。"
                })
                : applicationCount
                    ? scope.tr("common:x11.guide_apps_ready", {
                        count: applicationCount, defaultValue: "远端已识别 xauth 和 {{count}} 个常用 X11 程序，组件安装完成。"
                    })
                    : scope.tr("common:x11.guide_xauth_ready", {
                        defaultValue: "远端 xauth 已安装；尚未识别到常用 X11 程序，可继续安装工具或直接填写程序路径。"
                    })
            : plan.supported
                ? (macos
                    ? scope.tr("common:x11.guide_xquartz_incomplete", {
                        defaultValue: "远端 macOS 未安装完整的 XQuartz 组件，请选择安装方式。"
                    })
                    : scope.tr("common:x11.guide_components_incomplete", {
                        defaultValue: "远端没有完整识别到 xauth 或常用 X11 程序，请选择安装方式。"
                    }))
                : (macos && discovery.xquartz_installed
                    ? scope.tr("common:x11.guide_redetect_xquartz", {
                        defaultValue: "远端 XQuartz 已安装；请重新检测 SSH X11 转发配置和图形程序。"
                    })
                    : scope.tr("common:x11.guide_manual_required", {
                        defaultValue: "当前远端没有识别到可自动执行的包管理器，请打开手动安装说明。"
                    }));
        const title: any = macos
            ? scope.tr("common:x11.install_xquartz", {
                defaultValue: "安装远端 XQuartz"
            })
            : scope.tr("common:x11.install_graphical_apps", {
                defaultValue: "安装/配置 X11 图形程序"
            });
        const steps: any = Array.isArray(plan.instructions) ? plan.instructions : [];
        const id = Number(connectionId);
        const actionKey = x11RemoteActionKey('components', id);
        const closeLabel: any = scope.tr("common:actions.close", {
            defaultValue: "关闭"
        });
        paintQuickView(modal, [h("div", {
                "class": "modal-card wide x11-install-guide remote-install-dialog", "role": "dialog", "aria-modal": "true", "aria-labelledby": "x11InstallGuideTitle"
            }, [h("div", {
                    "class": "modal-title-row"
                }, [h("div", {}, [h("h2", {
                            "id": "x11InstallGuideTitle"
                        }, [title]), h("span", {
                            "class": "muted"
                        }, [discovery.platform || scope.tr("common:x11.remote_host", {
                                defaultValue: "远端主机"
                            }), " · ", plan.package_manager || scope.tr("common:x11.package_unknown", {
                                defaultValue: "未识别包管理器"
                            })])]), h(TermaButton, {
                        "class": "icon-button", "type": "button", "onClick": () => x11Services.termaX11.closeGuide(), "title": closeLabel, "aria-label": closeLabel
                    }, {
                        default: () => [quickIcon("x")]
                    })]), h("div", {
                    "class": ["connection-test-status ", installStateClass].join('')
                }, [installStateText]), " ", managementContent({install: guides.install(plan, (mode, button) => x11Services.termaX11.remote.operate(id, 'components', mode, button, 'install-guide'), undefined, actionKey), manual: guides.manual(plan, {
                    steps, commands: optional, note: macos ? scope.tr("common:x11.guide_xquartz_restart_note", {
                        defaultValue: "XQuartz 安装完成后通常需要退出并重新登录 macOS，再重新建立 SSH X11 会话。"
                    }) : scope.tr("common:x11.guide_offline_note", {
                        defaultValue: "如果服务器和本机都不能联网，请在另一台同发行版、同架构设备上下载 xauth、x11-apps、xterm 及完整依赖后上传安装。"
                    })})
                }), " ", optional.length ? [h("details", {
                        "class": "x11-install-optional"
                    }, [h("summary", {}, [scope.tr("common:x11.guide_optional_apps", {
                                defaultValue: "可选：安装 Firefox 等大型程序"
                            })]), h("div", {}, [optional.map((item: any) => [h("pre", {
                                    "class": "x11-install-command"
                                }, [item])])])])] : "", " ", h("div", {
                    "id": "x11InstallTaskState"
                }, []), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "type": "button", "onClick": () => x11Services.termaX11.closeGuide()
                    }, {
                        default: () => [closeLabel]
                    }), installed && !macos ? [h(TermaButton, {
                            "class": "danger", "type": "button", "data-ui-action-key": actionKey, "onClick": (event: any) => x11Services.termaX11.remote.operate(id, 'components', 'uninstall', event.currentTarget, 'install-guide')
                        }, {
                            default: () => [quickIcon("package-minus"), h("span", {}, [scope.tr("common:x11.remove_components", {
                                        defaultValue: "卸载 X11 组件"
                                    })])]
                        })] : "", command ? [h(TermaButton, {
                            "type": "button", "onClick": () => x11Services.termaX11.manual(id, command, 'install', '', macos)
                        }, {
                            default: () => [quickIcon("square-terminal"), h("span", {}, [scope.tr("common:x11.run_recommended_terminal", {
                                        defaultValue: "在终端执行推荐命令"
                                    })])]
                        })] : [h(TermaButton, {
                            "type": "button", "onClick": () => x11Services.termaX11.manual(id, '', 'guide')
                        }, {
                            default: () => [quickIcon("square-terminal"), h("span", {}, [scope.tr("common:x11.open_install_terminal", {
                                        defaultValue: "打开安装终端"
                                    })])]
                        })]])])]);
        modal._x11ConnectionId = Number(connectionId);
        modal.hidden = false;
        modal.onclick = null;
        scope.refreshIcons();
        scope.syncUiActionControls(actionKey, scope.isUiActionInFlight(actionKey));
}
