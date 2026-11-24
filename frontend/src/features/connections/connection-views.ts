import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {operationsServices} from '@/features/operations/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import { computed, defineComponent, h, mergeProps, shallowRef, type VNode, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { SettingsPasswordField } from '../settings/SettingsPasswordField';
import { remoteQuickOpen } from '../settings/quick-open-preference';
import { filePickerPresentation } from '../../shared/form-controls';
import { connectionIcon, connectionEmptyState, paintConnectionView, paintConnectionModal, releaseConnectionView, setConnectionGroupSave } from './connection-mount';
import { RemoteProfileForm } from './RemoteProfileForm';
import { ConnectionBulkFields } from './ConnectionBulkFields';
import { profileHostGroups } from '../remote/profile-host-groups';
import { sections as exchangeSections, sectionKey as exchangeSectionKey } from '../data-exchange/exchange-model';
import type { ConnectionViewPort } from './connection-port';
const passwordProps = (scope: ConnectionViewPort) => ({showLabel: scope.tr('common:auto.show_password'), hideLabel: scope.tr('common:auto.hide_password')});
const selectedConnectionId = shallowRef<number | null>(null);

function setSelectedConnectionRow(id: number | null) {
    selectedConnectionId.value = id;
}

export function syncSelectedConnectionRow(_scope: ConnectionViewPort, id: number | null) {
    setSelectedConnectionRow(id);
}

const ConnectionRow = defineComponent({
    name: 'ConnectionRow',
    props: { connectionId: { type: [Number, String], required: true } },
    setup(props, { slots }) {
        const active = computed(() => Number(props.connectionId) === selectedConnectionId.value);
        return () => h('div', {
            class: ['conn-row', { active: active.value }],
            'data-connection-id': props.connectionId
        }, slots.default?.());
    }
});

export function renderConnections(scope: ConnectionViewPort): any {
    if (scope.connectionGroupDrag) {
        scope.connectionGroupDrag.renderPending = true;
        return;
    }
    if (scope.primaryView === "logs") {
        releaseConnectionView(scope.$('connectionGroups'));
        return scope.renderLogs().catch((e: any) => scope.notify(scope.localizedTermaUiPhrase(e.message), "error"));
    }
    if (scope.primaryView === "running") {
        releaseConnectionView(scope.$('connectionGroups'));
        return scope.renderRunningForwards();
    }
    if (scope.primaryView === "command") {
        releaseConnectionView(scope.$('connectionGroups'));
        return scope.renderCommandTemplates({reload:false}).catch((e: any) => scope.notify(scope.localizedTermaUiPhrase(e.message), "error"));
    }
    if (scope.primaryView === "remote")
        return renderRemoteConnections(scope);
    const uiState: any = scope.captureUiState(scope.$("connectionGroups") || document);
    scope.connectionVirtual.scrollTop = scope.$("connectionGroups")?.scrollTop || scope.connectionVirtual.scrollTop;
    const sshGroups: any = scope.filteredConnections().reduce((m: any, c: any) => { (m[c.group_name] ||= []).push(c); return m; }, {});
    const names: any = [...new Set([...scope.orderedConnectionGroupNames("connections"), ...Object.keys(sshGroups)])]
        .filter((name: any) => sshGroups[name]?.length);
    const existingIds: any = new Set(scope.connections.map((c: any) => c.id));
    if (selectedConnectionId.value !== null && !existingIds.has(selectedConnectionId.value)) {
        setSelectedConnectionRow(null);
    }
    [...scope.selectedConnectionIds].forEach((id: any) => {
        if (!existingIds.has(id))
            scope.selectedConnectionIds.delete(id);
    });
    const groupHtml: any = names.map((g: any) => {
        const open: any = scope.groupOpen.has(g);
        const displayName: any = scope.connectionGroupDisplayName(g);
        return h("div", {
                key: g, "class": "group", "data-group-name": encodeURIComponent(g)
            }, [h("div", {
                    "class": "group-head-row connection-group-head-row"
                }, [h("span", {
                        "class": "connection-group-drag-handle", "role": "button", "tabindex": "0", "title": scope.tr("connections:groups.group_drag", {
                            name: displayName, defaultValue: `长按拖动 ${displayName} 分组排序`
                        }), "aria-label": scope.tr("connections:groups.group_drag", {
                            name: displayName, defaultValue: `长按拖动 ${displayName} 分组排序`
                        }), "onPointerdown": (event: any) => { scope.beginConnectionGroupDrag(event, decodeURIComponent((encodeURIComponent(g)))); }
                    }, [connectionIcon("grip-vertical")]), h(TermaButton, {
                        "class": "group-head", "aria-expanded": open, "data-action": "connection-group-toggle", "data-contextmenu-action": "connection-group-menu", "data-group": encodeURIComponent(g)
                    }, {
                        default: () => [h("span", {
                                "class": "chev", "aria-hidden": "true"
                            }, [connectionIcon(open ? "chevron-down" : "chevron-right")]), h("span", {}, [displayName]), h("span", {
                                "class": "count"
                            }, [sshGroups[g]?.length || 0])]
                    }), h(TermaButton, {
                        "class": "icon-button connection-group-menu-button", "data-action": "connection-group-menu", "data-group": encodeURIComponent(g), "title": scope.tr("connections:groups.group_actions", {
                            name: displayName, defaultValue: `${displayName} 分组操作`
                        }), "aria-label": scope.tr("connections:groups.group_actions", {
                            name: displayName, defaultValue: `${displayName} 分组操作`
                        })
                    }, {
                        default: () => [connectionIcon("ellipsis")]
                    })]), " ", open ? renderVirtualConnectionRows(scope, sshGroups[g] || []) : "", " "]);
    });
    const emptyHtml: any = connectionEmptyState("empty", scope.connectionSearch ? scope.tr("connections:list.no_matching_ssh", {
        defaultValue: "没有匹配的 SSH 连接"
    }) : scope.tr("connections:list.no_ssh", {
        defaultValue: "暂无 SSH 连接"
    }), scope.connectionSearch ? scope.tr("connections:list.adjust_search", {
        defaultValue: "请调整搜索关键词。"
    }) : scope.tr("connections:list.no_ssh_hint", {
        defaultValue: "添加 SSH 连接后即可打开终端、SFTP、转发和 X11。"
    }), scope.connectionSearch ? [h(TermaButton, {
            "data-action": "connection-search-clear"
        }, {
            default: () => [scope.tr("connections:list.clear_search", {
                    defaultValue: "清除搜索"
                })]
        })] : [h(TermaButton, {
            "class": "primary", "data-action": "connection-new"
        }, {
            default: () => [scope.tr("connections:list.add_ssh", {
                    defaultValue: "添加 SSH"
                })]
        })]);
    paintConnectionView(scope.$("connectionGroups"), [renderGroupCreator(scope), renderConnectionBulkBar(scope), groupHtml.length ? groupHtml : emptyHtml]);
    scope.restoreUiState(uiState);
    syncConnectionBulkBar(scope);
}

export function renderRemoteProfileEditor(scope: ConnectionViewPort, profile: import('../remote/profile-model').RemoteProfile, callbacks: import('../remote/profile-editor-runtime').RemoteEditorBinding): void {
    const target = scope.$('view-edit');
    if (!target)
        return;
    paintConnectionView(target, h(RemoteProfileForm, {
        language: document.documentElement.lang,
        scope,
        profile,
        defaultGroup: callbacks.defaultGroup,
        onCreateGroup: callbacks.onCreateGroup,
        servicePort: callbacks.servicePort,
        key: callbacks.ownerKey,
        onTest: callbacks.onTest,
        onClose: callbacks.onClose
    }));
}

const bulkSelection = shallowRef({total: 0, allVisible: false, partiallyVisible: false});

export function syncConnectionBulkBar(scope: ConnectionViewPort) {
    if (!scope.connectionBulkMode) return;
    const visible = scope.filteredConnections() as {id: number}[];
    const selected = visible.filter(({id}) => scope.selectedConnectionIds.has(id)).length;
    bulkSelection.value = {total: scope.selectedConnectionIds.size,
        allVisible: visible.length > 0 && selected === visible.length,
        partiallyVisible: selected > 0 && selected < visible.length};
}

const ConnectionBulkBar = defineComponent((props: {scope: ConnectionViewPort}) => () => {
    const {scope} = props;
    const {total, allVisible, partiallyVisible} = bulkSelection.value;
    return h("div", {
            "class": "connection-bulk-bar"
        }, [h("label", {
                "class": "checkline"
                    }, [h("input", {
                    "id": "connectionSelectAll", "type": "checkbox", checked: allVisible, indeterminate: partiallyVisible,
                    "data-change-action": "connection-select-all"
                }, []), h("span", {
                    "id": "connectionBulkCount"
                }, [scope.tr("connections:groups.selected_count", {
                        count: total, defaultValue: `已选 ${total} 项`
                    })])]), h("div", {
                "class": "actions tight"
            }, [h(TermaButton, {
                    "id": "connectionBulkEditBtn", "data-action": "connection-bulk-settings", "disabled": total === 0
                }, {
                    default: () => [connectionIcon("settings-2"), h("span", {}, [scope.tr("connections:groups.bulk_settings", {
                                defaultValue: "批量设置"
                            })])]
                }), h(TermaButton, {
                    "id": "connectionBulkDeleteBtn", "class": "danger", "data-action": "connection-bulk-delete", "disabled": total === 0
                }, {
                    default: () => [connectionIcon("trash-2"), h("span", {}, [scope.tr("common:actions.delete", {
                                defaultValue: "删除"
                            })])]
                })])]);
}, {props: ['scope']});

function renderConnectionBulkBar(scope: ConnectionViewPort) {
    return scope.connectionBulkMode ? h(ConnectionBulkBar, {scope}) : null;
}
function renderVirtualConnectionRows(scope: ConnectionViewPort, items: any): any {
    if (items.length <= 80)
        return items.map((c: any) => renderConnectionRow(scope, c));
    const viewport: any = scope.$("connectionGroups")?.clientHeight || 600;
    const start: any = Math.max(0, Math.floor(scope.connectionVirtual.scrollTop / scope.connectionVirtual.rowHeight) - scope.connectionVirtual.buffer);
    const visibleCount: any = Math.ceil(viewport / scope.connectionVirtual.rowHeight) + scope.connectionVirtual.buffer * 2;
    const end: any = Math.min(items.length, start + visibleCount);
    const top: any = start * scope.connectionVirtual.rowHeight;
    const bottom: any = Math.max(0, (items.length - end) * scope.connectionVirtual.rowHeight);
    return [h("div", {
            "class": "virtual-spacer", "style": ["height:", top, "px"].join('')
        }, []), items.slice(start, end).map((c: any) => renderConnectionRow(scope, c)), h("div", {
            "class": "virtual-spacer", "style": ["height:", bottom, "px"].join('')
        }, [])];
}
function renderGroupCreator(scope: ConnectionViewPort): any {
    const groups = connectionsServices.termaConnectionGroups;
    if (!groups?.adding)
        return "";
    return [h("div", {
            "class": "panel", "style": "margin:8px;padding:8px"
        }, [h("label", {
                "style": "margin-top:0", for: 'newGroupName'
            }, [scope.tr("connections:groups.new_title", {
                    defaultValue: "新分组"
                })]), h("div", {
                "class": "upload-line"
            }, [h("input", {
                    "id": "newGroupName", "placeholder": scope.tr("connections:groups.placeholder", {
                        defaultValue: "例如：生产环境"
                    })
                }, []), h(TermaButton, {
                    "data-connection-group-add": "confirm", onClick: () => groups.confirmAdding(scope.$('newGroupName')?.value ?? '')
                }, {
                    default: () => [scope.tr("common:auto.confirm", {
                            defaultValue: "确定"
                        })]
                })]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "data-connection-group-add": "cancel", onClick: groups.cancelAdding
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                })])])];
}
export function renderConnectionRow(scope: ConnectionViewPort, c: any): any {
    const health: any = scope.healthResults.get(c.id);
    const healthClass: any = health ? (health.ok ? " ok" : " bad") : "";
    const healthText: any = health?.status || "";
    const localizedHealthText: any = health && typeof scope.translatedTermaPhrase === "function" ? scope.translatedTermaPhrase(healthText) || healthText : healthText;
    const identityWarning: any = scope.connectionIdentityWarningMessage(c);
    const selectConnectionText: any = scope.tr("connections:groups.select_connection", {
        name: c.name, defaultValue: `选择 ${c.name}`
    });
    const healthStatusText: any = health ? scope.tr("connections:groups.health_status", {
        status: localizedHealthText, defaultValue: `健康状态：${localizedHealthText}`
    }) : "";
    const healthBadge: any = health ? [h("span", {
            "class": ["health-badge", healthClass].join(''), "title": healthStatusText, "aria-label": healthStatusText
        }, [connectionIcon(health.ok ? "circle-check" : "circle-alert")])] : "";
    const quickActionsText: any = scope.tr("connections:groups.quick_actions", {
        name: c.name, defaultValue: `${c.name} 快捷操作`
    });
    const openTerminalText: any = scope.tr("connections:actions.open_terminal", {
        defaultValue: "打开终端"
    });
    const openSftpText: any = scope.tr("connections:actions.open_sftp", {
        defaultValue: "打开 SFTP 文件管理"
    });
    const manageForwardsText: any = scope.tr("connections:actions.manage_forwards", {
        defaultValue: "管理转发"
    });
    const favoriteText: any = c.favorite
        ? scope.tr("connections:actions.unfavorite", {
            defaultValue: "取消收藏"
        })
        : scope.tr("connections:actions.favorite", {
            defaultValue: "收藏连接"
        });
    const moreText: any = scope.tr("connections:actions.more", {
        defaultValue: "更多操作"
    });
    const bulkCheck: any = scope.connectionBulkMode ? [h("label", {
            "class": "connection-bulk-check", "title": selectConnectionText
        }, [h("input", mergeProps({
                "type": "checkbox", "data-change-action": "connection-select", "data-connection-id": c.id
            }, (scope.selectedConnectionIds.has(c.id) ? {
                "checked": true
            } : {})), []), h("span", {
                "class": "sr-only"
            }, [selectConnectionText])])] : "";
    return [h(ConnectionRow, {
            key: c.id, connectionId: c.id, class: { "bulk-mode": scope.connectionBulkMode }
        }, () => [" ", bulkCheck, " ", h("div", {
                "class": "conn-main"
            }, [h("span", {
                    "class": "conn-name conn-name-open", "title": scope.tr("connections:actions.double_click_terminal", {
                        defaultValue: "双击打开终端"
                    }), "data-dblclick-action": "connection-open-terminal", "data-connection-id": c.id
                }, [c.name]), healthBadge]), h("div", {
                "class": "conn-meta"
            }, [c.ssh_user, "@", c.ssh_host, ":", c.ssh_port]), " ", c.tags ? [h("div", {
                    "class": "forward-tags"
                }, [String(c.tags).split(",").filter(Boolean).map((tag: any) => [h("span", {}, [tag])])])] : "", " ", h("div", {
                "class": "conn-footer"
            }, [h("div", {
                    "class": "conn-summary"
                }, [h("span", {
                        "title": scope.tr("connections:forwards.short_count", {
                            count: c.forwards.length, defaultValue: `${c.forwards.length} 条转发`
                        })
                    }, [connectionIcon("route"), " ", c.forwards.length]), identityWarning ? [h("span", {
                            "class": "connection-identity-warning", "title": identityWarning, "aria-label": identityWarning
                        }, [connectionIcon("triangle-alert"), " ", scope.tr("connections:actions.identity_reimport", {
                                defaultValue: "私钥需重新导入"
                            })])] : ""]), h("div", {
                    "class": "conn-actions", "aria-label": quickActionsText
                }, [h(TermaButton, {
                        "class": "icon-button conn-primary-action", "data-action": "connection-open-terminal", "data-connection-id": c.id, "title": openTerminalText, "aria-label": openTerminalText
                    }, {
                        default: () => [connectionIcon("square-terminal")]
                    }), h(TermaButton, {
                        "class": "icon-button", "data-action": "connection-open-sftp", "data-connection-id": c.id, "title": openSftpText, "aria-label": openSftpText
                    }, {
                        default: () => [connectionIcon("folder-sync")]
                    }), h(TermaButton, {
                        "class": "icon-button", "data-action": "connection-open-forwards", "data-connection-id": c.id, "title": manageForwardsText, "aria-label": manageForwardsText
                    }, {
                        default: () => [connectionIcon("route")]
                    }), " ", connectionCompactToggleButton(scope, c), " ", h(TermaButton, {
                        "class": ["icon-button connection-favorite", c.favorite ? " active" : ""].join(''), "data-action": "connection-favorite", "data-connection-id": c.id, "data-favorite": c.favorite ? 0 : 1, "title": favoriteText, "aria-label": favoriteText, "aria-pressed": c.favorite ? "true" : "false"
                    }, {
                        default: () => [connectionIcon("star")]
                    }), h(TermaButton, {
                        "class": "icon-button", "data-action": "connection-menu", "data-connection-id": c.id, "title": moreText, "aria-label": moreText
                    }, {
                        default: () => [connectionIcon("ellipsis")]
                    })])])])];
}
export function connectionCompactToggleButton(scope: ConnectionViewPort, c: any): any {
    const action: any = scope.connectionHasRunningForwards(c) ? "stop" : "start";
    const text: any = action === "start"
        ? scope.tr("connections:actions.start_forwards", {
            defaultValue: "启用转发"
        })
        : scope.tr("connections:actions.stop_forwards", {
            defaultValue: "停止转发"
        });
    return [h(TermaButton, {
            "class": ["icon-button connection-forward-toggle", action === "stop" ? " is-running" : ""].join(''), "title": text, "aria-label": text, "data-action": "connection-forward", "data-connection-id": c.id, "data-forward-action": action
        }, {
            default: () => [connectionIcon(action === "start" ? "play" : "square")]
        })];
}
export function renderRemoteHostGroups(scope: ConnectionViewPort, profiles: any, hosts = profileHostGroups): any {
    const grouped: any = new Map();
    for (const profile of profiles || []) {
        const key: any = hosts.key(profile);
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(profile);
    }
    const keys: any = [...grouped.keys()];
    const searching: any = Boolean(String(scope.remoteConnectionSearch || "").trim());
    return keys.map((key: any) => {
        const items: any = grouped.get(key) || [];
        const first: any = items[0] || {};
        const encoded: any = encodeURIComponent(key);
        const open: any = searching || hosts.isOpen(key);
        const label: any = hosts.label(first);
        return [h("div", {
                key, "class": "remote-host-group", "data-remote-host-key": encoded
            }, [h("div", {
                    "class": "remote-host-head-row"
                }, [h(TermaButton, {
                        "class": "remote-host-head", "type": "button", "aria-expanded": open ? "true" : "false",
                        onClick: () => { hosts.toggle(key); scope.renderConnections(); }
                    }, {
                        default: () => [h("span", {
                                "class": "chev"
                            }, [open ? "▾" : "▸"]), h("span", {
                                "class": "remote-host-icon"
                            }, [connectionIcon("server")]), h("span", {
                                "class": "remote-host-label", "title": label
                            }, [label]), h("span", {
                                "class": "count"
                            }, [items.length])]
                    })]), " ", open ? items.map((profile: any) => renderRemoteProfileRow(scope, profile, hosts)) : "", " "])];
    });
}
export function renderRemoteConnections(scope: ConnectionViewPort): any {
    const search = scope.$("remoteConnectionSearch") as HTMLInputElement | null;
    if (search && search.value !== scope.remoteConnectionSearch) search.value = scope.remoteConnectionSearch;
    const uiState: any = scope.captureUiState(scope.$("connectionGroups") || document);
    const visibleProfiles: any = scope.filteredRemoteProfiles();
    const groups: any = visibleProfiles.reduce((result: any, profile: any) => { (result[profile.group_name] ||= []).push(profile); return result; }, {});
    const names: any = [...new Set([...scope.orderedConnectionGroupNames("remote"), ...Object.keys(groups)])].filter((name: any) => groups[name]?.length);
    if (localStorage.getItem("openRemoteGroups") === null && names.length) {
        names.forEach((name: any) => scope.remoteGroupOpen.add(name));
        scope.saveRemoteGroupState();
    }
    const groupHtml: any = names.map((name: any) => {
        const open: any = scope.remoteGroupOpen.has(name);
        const displayName: any = scope.connectionGroupDisplayName(name);
        return h("div", {
                key: name, "class": "group", "data-group-name": encodeURIComponent(name)
            }, [h("div", {
                    "class": "group-head-row connection-group-head-row"
                }, [h("span", {
                        "class": "connection-group-drag-handle", "role": "button", "tabindex": "0", "title": scope.tr("connections:groups.drag", {
                            defaultValue: "长按拖动分组排序"
                        }), "aria-label": scope.tr("connections:groups.group_drag", {
                            name: displayName, defaultValue: `长按拖动 ${displayName} 分组排序`
                        }), "onPointerdown": (event: any) => { scope.beginConnectionGroupDrag(event, decodeURIComponent((encodeURIComponent(name)))); }
                    }, [connectionIcon("grip-vertical")]), h(TermaButton, {
                        "class": "group-head", "aria-expanded": open, "data-action": "connection-group-toggle", "data-contextmenu-action": "connection-group-menu", "data-group": encodeURIComponent(name)
                    }, {
                        default: () => [h("span", {
                                "class": "chev", "aria-hidden": "true"
                            }, [connectionIcon(open ? "chevron-down" : "chevron-right")]), h("span", {}, [displayName]), h("span", {
                                "class": "count"
                            }, [groups[name]?.length || 0])]
                    }), h(TermaButton, {
                        "class": "icon-button connection-group-menu-button", "data-action": "connection-group-menu", "data-group": encodeURIComponent(name), "title": scope.tr("connections:groups.actions", {
                            defaultValue: "分组操作"
                        }), "aria-label": scope.tr("connections:groups.group_actions", {
                            name: displayName, defaultValue: `${displayName} 分组操作`
                        })
                    }, {
                        default: () => [connectionIcon("ellipsis")]
                    })]), " ", open ? renderRemoteHostGroups(scope, groups[name] || []) : "", " "]);
    });
    const emptyHtml: any = connectionEmptyState("empty", scope.remoteConnectionSearch ? scope.tr("connections:list.no_matching_remote", {
        defaultValue: "没有匹配的其他连接"
    }) : scope.tr("connections:list.no_remote", {
        defaultValue: "暂无其他连接"
    }), scope.remoteConnectionSearch ? scope.tr("connections:list.adjust_search", {
        defaultValue: "请调整搜索关键词。"
    }) : scope.tr("connections:list.no_remote_hint", {
        defaultValue: "可以单独添加连接，也可以从 SSH 连接的更多菜单快速生成。"
    }), scope.remoteConnectionSearch ? [h(TermaButton, {
            "data-action": "remote-search-clear"
        }, {
            default: () => [scope.tr("connections:list.clear_search", {
                    defaultValue: "清除搜索"
                })]
        })] : [h(TermaButton, {
            "class": "primary", "data-action": "remote-new"
        }, {
            default: () => [scope.tr("connections:list.add_remote", {
                    defaultValue: "添加其他连接"
                })]
        })]);
    paintConnectionView(scope.$("connectionGroups"), [renderGroupCreator(scope), groupHtml.length ? groupHtml : emptyHtml]);
    scope.restoreUiState(uiState);
}
export function renderRemoteProfileRow(scope: ConnectionViewPort, profile: any, hosts = profileHostGroups): any {
    const busy=scope.remoteProfileBusy(profile.id);
    const meta: any = scope.REMOTE_PROTOCOL_META[profile.protocol] || {
        label: profile.protocol.toUpperCase(), icon: "plug"
    };
    const active: any = hosts.isSelected(profile.id) ? " active" : "";
    const capability: any = profile.protocol === "rdp"
        ? scope.tr("remote:capabilities.local_rdp", {
            defaultValue: "本机 RDP"
        })
        : profile.protocol === "vnc"
            ? profile.options?.client_mode === "system"
                ? scope.tr("remote:capabilities.system_client", {
                    defaultValue: "系统客户端"
                })
                : scope.normalizedVncClientMode(profile.options) === "embedded"
                    ? scope.tr("remote:capabilities.embedded_novnc", {
                        defaultValue: "内置 noVNC"
                    })
                    : scope.tr("remote:capabilities.bundled_tigervnc", {
                        defaultValue: "内置 TigerVNC Viewer"
                    })
            : profile.protocol === "xdmcp" ? scope.tr("remote:capabilities.embedded_xdmcp", {
                defaultValue: "内置 XDMCP"
            })
                : profile.protocol === "ftp" ? scope.tr("remote:capabilities.embedded_files", {
                    defaultValue: "内置文件"
                }) : scope.tr("remote:capabilities.embedded_terminal", {
                    defaultValue: "内置终端"
                });
    const sourceConnection: any = scope.connections.find((connection: any) => Number(connection.id) === Number(profile.options?.source_ssh_connection_id));
    const sourceTitle: any = sourceConnection ? scope.tr("remote:capabilities.source_ssh", {
        name: sourceConnection.name, defaultValue: ` · 来自 SSH：${sourceConnection.name}`
    }) : "";
    const displayName: any = sourceConnection ? sourceConnection.name : profile.name;
    const endpoint = scope.remoteProfileEndpoint(profile);
    const actionText: any = scope.remoteProtocolAction(profile.protocol);
    const editText: any = scope.tr("remote:actions.edit", {
        defaultValue: "编辑连接"
    });
    const favoriteText: any = scope.tr(profile.favorite ? "remote:actions.unfavorite" : "remote:actions.favorite", {
        defaultValue: profile.favorite ? "取消收藏" : "收藏连接"
    });
    const moreText: any = scope.tr("remote:actions.more", {
        defaultValue: "更多操作"
    });
    const quickActionsText: any = scope.tr("remote:actions.quick_actions", {
        name: profile.name, defaultValue: `${profile.name} 快捷操作`
    });
    return [h("div", {
            "class": ["conn-row remote-profile-row", active].join(''), "data-remote-profile-id": profile.id
        }, [h("div", {
                "class": "conn-main"
            }, [h("span", {
                    "class": "conn-name conn-name-open", "title": scope.tr("remote:actions.double_click", {
                        action: actionText, defaultValue: `双击${actionText}`
                    }), "onDblclick": (event: any) => { event.stopPropagation(); scope.openRemoteProfile(profile); }
                }, [displayName]), h("span", {
                    "class": ["protocol-badge protocol-", profile.protocol].join('')
                }, [connectionIcon(meta.icon), " ", scope.remoteProtocolLabel(profile.protocol)])]), h("div", {
                "class": "conn-meta", "title": endpoint
            }, [endpoint]), " ", profile.tags ? [h("div", {
                    "class": "forward-tags"
                }, [String(profile.tags).split(",").filter(Boolean).map((tag: any) => [h("span", {}, [tag])])])] : "", " ", h("div", {
                "class": "conn-footer"
            }, [h("div", {
                    "class": "conn-summary"
                }, [h("span", {
                        "title": capability + sourceTitle
                    }, [connectionIcon(["rdp", "vnc", "xdmcp"].includes(profile.protocol) ? "external-link" : "layers-2"), " ", capability]), sourceConnection ? [h("span", {
                            "class": "remote-source-badge", "title": scope.tr("remote:capabilities.source", {
                                name: sourceConnection.name, defaultValue: `来源：${sourceConnection.name}`
                            })
                        }, [connectionIcon("server-cog")])] : ""]), h("div", {
                    "class": "conn-actions", "aria-label": quickActionsText
                }, [h(TermaButton, {disabled:busy,
                        "class": "icon-button conn-primary-action", "onClick": (event: any) => { scope.openRemoteProfile(profile); }, "title": actionText, "aria-label": actionText
                    }, {
                        default: () => [connectionIcon(meta.icon)]
                    }), h(TermaButton, {disabled:busy,
                        "class": "icon-button", "onClick": () => remoteServices.termaRemoteProfiles.editor.edit(Number(profile.id)), "title": editText, "aria-label": editText
                    }, {
                        default: () => [connectionIcon("pencil")]
                    }), h(TermaButton, {disabled:busy,
                        "class": ["icon-button connection-favorite", profile.favorite ? " active" : ""].join(''), "onClick": (event: MouseEvent) => {
                            event.stopPropagation();
                            void remoteServices.termaRemoteList.favorite(Number(profile.id),!profile.favorite).catch((error:Error)=>scope.notify(scope.localizedTermaUiPhrase(error.message),'error'));
                        }, "title": favoriteText, "aria-label": favoriteText, "aria-pressed": profile.favorite ? "true" : "false"
                    }, {
                        default: () => [connectionIcon("star")]
                    }), h(TermaButton, {disabled:busy,
                        "class": "icon-button", "onClick": (event: any) => { scope.showRemoteProfileMenu(event, profile.id); }, "title": moreText, "aria-label": moreText
                    }, {
                        default: () => [connectionIcon("ellipsis")]
                    })])])])];
}
export async function openConnectionBulkSettings(scope: ConnectionViewPort): Promise<any> {
    const count: any = scope.selectedConnectionIds.size;
    if (!count)
        return scope.notify(scope.tr("connections:list.select_ssh", {
            defaultValue: "请选择 SSH 连接"
        }), "info");
    const info: any = await scope.api("/api/identity-files/info");
    const modal = scope.$("modal");
    modal.hidden = false;
    paintConnectionModal(modal, () => h("div", {
            "class": "modal-card wide connection-bulk-modal"
        }, [h("h2", {}, [scope.tr("connections:list.bulk_settings_title", {
                    defaultValue: "批量设置 SSH 连接"
                })]), h("div", {
                "class": "muted"
            }, [scope.tr("connections:list.bulk_settings_hint", {
                    count, defaultValue: `将设置应用到已选的 ${count} 个连接。未勾选的项目保持原值；修改端口或凭据时会停止这些连接的转发。`
                })]), h(ConnectionBulkFields, {scope, identities: info.items || []}), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "data-action": "connection-modal-close"
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                }), h(TermaButton, {
                    "class": "primary", "data-action": "connection-bulk-apply"
                }, {
                    default: () => [scope.tr("connections:list.apply_settings", {
                            defaultValue: "应用设置"
                        })]
                })])]));
    scope.refreshIcons();
}
export function bulkDeleteConnections(scope: ConnectionViewPort): any {
    const ids: any = [...scope.selectedConnectionIds];
    if (!ids.length)
        return scope.notify(scope.tr("connections:list.select_ssh", {
            defaultValue: "请选择 SSH 连接"
        }), "info");
    scope.$("modal").hidden = false;
    paintConnectionView(scope.$("modal"), [h("div", {
            "class": "modal-card"
        }, [h("h2", {}, [scope.tr("connections:list.bulk_delete_title", {
                    defaultValue: "批量删除 SSH 连接"
                })]), h("div", {
                "class": "modal-message"
            }, [scope.tr("connections:list.bulk_delete_confirm", {
                    count: ids.length, defaultValue: `确定删除选中的 ${ids.length} 个 SSH 连接及其全部转发吗？删除前会自动创建配置快照。`
                })]), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "data-action": "connection-modal-close"
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                }), h(TermaButton, {
                    "class": "danger", "data-action": "connection-bulk-delete-confirm"
                }, {
                    default: () => [scope.tr("connections:list.confirm_delete", {
                            defaultValue: "确认删除"
                        })]
                })])])]);
}
export function openGroupModal(scope: ConnectionViewPort, onSave: (name: string) => void) {
    scope.$("modal").hidden = false;
    paintConnectionView(scope.$("modal"), [h("div", {
            "class": "modal-card"
        }, [h("h2", {}, [scope.tr("connections:groups.new_title", {
                    defaultValue: "新增分组"
                })]), h("label", {}, [scope.tr("connections:groups.name_label", {
                    defaultValue: "分组名称"
                })]), h("input", {
                "id": "modalGroupName", "placeholder": scope.tr("connections:groups.placeholder", {
                    defaultValue: "例如：生产环境"
                })
            }, []), h("div", {
                "class": "actions"
            }, [h(TermaButton, {
                    "class": "primary", "data-action": "connection-group-save"
                }, {
                    default: () => [scope.tr("common:actions.save", {
                            defaultValue: "保存"
                        })]
                }), h(TermaButton, {
                    "data-action": "connection-modal-close"
                }, {
                    default: () => [scope.tr("common:actions.cancel", {
                            defaultValue: "取消"
                        })]
                })])])]);
    setConnectionGroupSave(onSave);
    setTimeout(() => scope.$("modalGroupName")?.focus(), 0);
}
export function renderWelcome(scope: ConnectionViewPort): any {
    const title: any = scope.tr("common:workspace.welcome_title", {
        defaultValue: "开始使用"
    });
    paintConnectionView(scope.$("view-welcome"), [h("div", { class: "workspace-welcome" }, [
        h("section", { class: "workspace-welcome-intro" }, [
            h("div", { class: "workspace-welcome-mark", "aria-hidden": "true" }, [connectionIcon("terminal")]),
            h("div", { class: "workspace-welcome-copy" }, [
                h("h2", null, title),
                h("p", null, scope.tr("common:workspace.welcome_hint")),
                h("div", { class: "workspace-welcome-actions" }, [
                    h(TermaButton, { class: "primary", "data-action": "workspace-show-connections" }, {
                        default: () => [connectionIcon("server"), h("span", null, scope.tr("common:workspace.view_connections"))]
                    }),
                    h(TermaButton, { "data-action": "quick-connect-open" }, {
                        default: () => [connectionIcon("zap"), h("span", null, scope.tr("common:auto.quick_open"))]
                    })
                ])
            ])
        ]),
        h("div", { id: "startupSummary" })
    ])]);
    scope.setWorkspace(title, scope.tr("common:workspace.welcome_subtitle", {
        defaultValue: "选择左侧项目后开始操作"
    }), "welcome", "welcome", true, false, {
        kind: "welcome"
    });
    scope.loadStartupSummary();
}
export function renderStartupSummary(scope: ConnectionViewPort, box: HTMLElement | null = scope.$("startupSummary")): void {
    const s = box && scope.startupSummaryStatus(box);
    if (!box || !s)
        return;
    const forwards: any = scope.connections.flatMap((connection: any) => connection.forwards || []);
    const running: any = forwards.filter((forward: any) => forward.status === "running").length;
    const reconnecting: any = forwards.filter((forward: any) => forward.status === "reconnecting").length;
    const failed: any = forwards.filter((forward: any) => forward.status === "failed").length;
    const latestFailed: any = forwards.filter((forward: any) => forward.status === "failed").sort((a: any, b: any) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
    const urls: any = [s.local_url, ...(s.lan_urls || [])].filter(Boolean);
    const starting: any = s.state === "starting";
    const warning: any = !starting && failed > 0;
    const title: any = starting
        ? scope.tr("common:workspace.startup_running", {
            defaultValue: "启动任务正在执行"
        })
        : warning
            ? scope.tr("common:workspace.ready_with_failures", {
                defaultValue: "Terma 已就绪，存在启动失败的转发"
            })
            : scope.tr("common:workspace.ready", {
                defaultValue: "Terma 已就绪"
            });
    const logTimestamp: any = Number(latestFailed?.updated_at || 0);
    const runningLabel: any = scope.tr("common:workspace.running_label", {
        defaultValue: "运行中"
    });
    const reconnectingLabel: any = scope.tr("common:workspace.reconnecting_label", {
        defaultValue: "重连中"
    });
    const failedLabel: any = scope.tr("common:workspace.startup_failed_label", {
        defaultValue: "启动失败"
    });
    paintConnectionView(box, [h("div", {
            "class": ["startup-summary ", warning ? "warning" : "ready"].join('')
        }, [h("div", { class: "startup-overview" }, [
            h("strong", { class: "startup-title" }, [h("i", { "aria-hidden": "true" }), title]),
            urls.length ? h("div", { class: "startup-addresses" }, urls.map((url: string) => h("code", { key: url }, url))) : null
        ]), h("div", {
                "class": "startup-counts"
            }, [h("span", {
                    "class": "startup-count-card", "data-startup-state": "running"
                }, [h("strong", {}, [running]), h("small", {}, [runningLabel])]), reconnecting ? [h("span", {
                        "class": "startup-count-card", "data-startup-state": "reconnecting"
                    }, [h("strong", {}, [reconnecting]), h("small", {}, [reconnectingLabel])])] : "", failed ? [h(TermaButton, {
                        "class": "startup-status-button bad", "data-startup-state": "failed", "data-action": "workspace-show-running", "title": scope.tr("common:workspace.view_startup_failures", {
                            defaultValue: "查看启动失败的转发"
                        })
                    }, {
                        default: () => [h("strong", {}, [failed]), h("small", {}, [failedLabel])]
                    })] : [h("span", {
                        "class": "startup-count-card", "data-startup-state": "failed"
                    }, [h("strong", {}, ["0"]), h("small", {}, [failedLabel])])], h(TermaButton, {
                    "class": "startup-log-button", "data-action": "workspace-startup-log", "data-log-timestamp": logTimestamp
                }, {
                        default: () => [connectionIcon("scroll-text"), h("span", null, scope.tr(failed ? "common:workspace.failure_logs" : "common:workspace.system_logs", {
                            defaultValue: failed ? "失败日志" : "系统日志"
                        }))]
                })])])]);
}
const RemoteQuickOpenButton = defineComponent({
    props: {
        label: { type: String, required: true },
        enabledTitle: { type: String, required: true },
        disabledTitle: { type: String, required: true }
    },
    setup(props) {
        return () => {
            const active = remoteQuickOpen.enabled.value;
            return h(TermaButton, {
                id: 'workspace-remote-quick-open', class: active ? 'icon-button active' : 'icon-button',
                title: active ? props.enabledTitle : props.disabledTitle,
                'aria-label': props.label, 'aria-pressed': String(active), 'aria-busy': String(remoteQuickOpen.pendingWrites.value > 0),
                onClick: remoteQuickOpen.toggle
            }, { default: () => connectionIcon('zap') });
        };
    }
});

export function renderExplorerTools(scope: ConnectionViewPort): any {
    const tools: any = scope.$("explorerTools");
    const tree: any = scope.$("connectionGroups");
    if (tools?.dataset.termaSettingsOwned)
        settingsServices.termaUnmountVueSettings?.(tools);
    scope.syncOperationPaneState();
    tree?.classList.toggle("log-tree", scope.primaryView === "logs");
    tools.classList.remove("log-mode", "section-mode", "connection-mode", "remote-connection-mode", "compact-mode");
    if (tree)
        tree.hidden = ["settings", "import"].includes(scope.primaryView);
    if (scope.primaryView === "logs") { tools.classList.add("compact-mode"); releaseConnectionView(tools); logsServices.termaLogList.tools(tools); return; }
    if (scope.primaryView === "running") {
        tools.classList.add("compact-mode");
        releaseConnectionView(tools);
        return operationsServices.termaRunning.mountTools(tools);
    }
    if (scope.primaryView === "command") { releaseConnectionView(tools); batchServices.termaBatch.mountTools(tools); return; }
    if (scope.primaryView === "import") {
        const exchange = dataExchangeServices.termaExchange.feature(), activeSection = exchange.activeSection();
        const icons = {'import-source': 'file-input', 'import-export': 'database-backup', configSnapshots: 'history'};
        tools.classList.add("section-mode");
        paintConnectionView(tools, exchangeSections.map(id => h(TermaButton, {
            key: id, class: id === activeSection ? 'active' : '', 'data-explorer-section': id, onClick: () => exchange.navigate(id)
        }, {default: () => [connectionIcon(icons[id]), h('span', scope.tr(exchangeSectionKey(id)))]})));
        return;
    }
    if (scope.primaryView === "settings") {
        tools.classList.add("section-mode");
        settingsServices.termaSettingsViews?.navigation(tools);
        return;
    }
    const remote = scope.primaryView === "remote";
    tools.classList.add("connection-mode");
    if (remote) tools.classList.add("remote-connection-mode");
    const iconAction = (action: string, glyph: string, label: string, attrs: Record<string, string> = {}) => h(TermaButton, {
        class: "icon-button", "data-action": action, title: label, "aria-label": label, ...attrs
    }, {default: () => [connectionIcon(glyph)]});
    const quickActions = [iconAction("workspace-group-add", "folder-plus", scope.tr("common:auto.add_group"))];
    if (remote) {
        quickActions.push(
            h(RemoteQuickOpenButton, {
                label: scope.tr('common:auto.quick_open_remote_desktop'),
                enabledTitle: scope.tr('remote:auto.quick_open_enabled_title'),
                disabledTitle: scope.tr('remote:auto.quick_open_disabled_title')
            }),
            iconAction("workspace-linux-desktop", "monitor-cog", scope.tr("remote:linux_desktop.title")),
            iconAction("workspace-show-connections", "server-cog", scope.tr("remote:auto.from_ssh")),
            h(TermaButton, {class: "icon-button", id: "workspace-remote-xserver",
                title: scope.tr("common:x11.manager"), "aria-label": scope.tr("common:x11.manager"),
                onClick: () => x11Services.termaX11.openManager()
            }, {default: () => [connectionIcon("x11")]})
        );
    } else {
        const bulk = scope.connectionBulkMode;
        quickActions.push(
            iconAction("workspace-connection-bulk", bulk ? "check-check" : "list-checks",
                scope.tr(bulk ? "common:workspace.finish_bulk_management" : "common:workspace.bulk_management"), {
                    class: bulk ? "icon-button active" : "icon-button", "aria-pressed": String(Boolean(bulk))
                }),
            iconAction("static-forwards-start-all", "play", scope.tr("common:auto.start_all_forwards")),
            iconAction("static-forwards-stop-all", "square", scope.tr("common:auto.stop_all_forwards")),
            iconAction("workspace-connection-check-all", "activity", scope.tr("connections:groups.check_all"))
        );
    }
    const searchLabel = scope.tr(remote ? "common:workspace.search_remote_connections" : "common:workspace.search_ssh_connections");
    paintConnectionView(tools, [h("div", {class: "search-field explorer-search"}, [
        connectionIcon("search"), h("input", {
            id: remote ? "remoteConnectionSearch" : "connectionSearch", placeholder: searchLabel,
            defaultValue: remote ? scope.remoteConnectionSearch : scope.connectionSearch,
            "data-input-action": remote ? "workspace-remote-search" : "workspace-connection-search"
        })
    ]), h("div", {class: "explorer-action-strip connection-action-strip connection-toolbar"}, [
        h(TermaButton, {class: "primary explorer-main-action", "data-action": remote ? "workspace-remote-add" : "workspace-connection-new"}, {
            default: () => [connectionIcon("plus"), h("span", scope.tr(remote ? "remote:auto.add_connection" : "common:auto.add_ssh"))]
        }),
        h("div", {class: "connection-quick-actions"}, quickActions)
    ])]);
}
export function connectionFormView(scope: ConnectionViewPort, editing = false): any {
    const uploadName = filePickerPresentation((scope.$('key_upload') as HTMLInputElement | null)?.files || null, scope.tr);
    return [h("div", {
            "class": "panel"
        }, [h("form", {
                "id": "connectionForm"
            }, [h("input", {
                    "type": "hidden", "id": "conn_id"
                }, []), h("div", {
                    "class": "grid"
                }, [h("div", {}, [h("label", {
                            "data-i18n": "common:auto.name"
                        }, [scope.tr("common:auto.name")]), h("input", {
                            "id": "conn_name", "required": true, "placeholder": "server-a"
                        }, [])]), h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.group"
                        }, [scope.tr("connections:auto.group")]), h("select", {
                            "id": "conn_group"
                        }, [])])]), h("div", {
                    "class": "grid"
                }, [h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.ssh_user"
                        }, [scope.tr("connections:auto.ssh_user")]), h("input", {
                            "id": "conn_user", "required": true, "placeholder": "root"
                        }, [])]), h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.ssh_host"
                        }, [scope.tr("connections:auto.ssh_host")]), h("input", {
                            "id": "conn_host", "required": true, "placeholder": "example.com"
                        }, [])])]), h("div", {
                    "class": "grid3"
                }, [h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.ssh_port"
                        }, [scope.tr("connections:auto.ssh_port")]), h("input", {
                            "id": "conn_port", "type": "number", "min": "1", "max": "65535", "defaultValue": "22"
                        }, [])]), h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.sort"
                        }, [scope.tr("connections:auto.sort")]), h("input", {
                            "id": "conn_sort_order", "type": "number", "min": "1", "max": "2147483647", "step": "1", "defaultValue": "1"
                        }, [])]), h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.auto_start_forwards"
                        }, [scope.tr("connections:auto.auto_start_forwards")]), h("select", {
                            "id": "conn_autostart"
                        }, [h("option", {
                                "value": "0", "data-i18n": "common:auto.no"
                            }, [scope.tr("common:auto.no")]), h("option", {
                                "value": "1", "data-i18n": "common:auto.yes"
                            }, [scope.tr("common:auto.yes")])])])]), h("label", {
                    "data-i18n": "common:auto.label"
                }, [scope.tr("common:auto.label")]), h("input", {
                    "id": "conn_tags", "data-i18n-placeholder": "connections:auto.tags_example", "placeholder": scope.tr("connections:auto.tags_example")
                }, []), h("div", {
                    "class": "auth-switch"
                }, [h("label", {
                        "data-i18n": "connections:auto.login_method"
                    }, [scope.tr("connections:auto.login_method")]), h("select", {
                        "id": "conn_auth_type", "data-change-action": "static-auth-fields"
                    }, [h("option", {
                            "value": "key", "data-i18n": "connections:auto.key_login"
                        }, [scope.tr("connections:auto.key_login")]), h("option", {
                            "value": "password", "data-i18n": "connections:auto.password_login"
                        }, [scope.tr("connections:auto.password_login")])])]), h("div", {
                    "id": "keyAuthBox", "class": "grid"
                }, [h("div", {}, [h("label", {
                            "data-i18n": "common:auto.private_key"
                        }, [scope.tr("common:auto.private_key")]), h("div", {
                            "class": "key-picker"
                        }, [h("select", {
                                "id": "conn_key", "data-change-action": "static-key-status"
                            }), h(TermaButton, {
                                "type": "button", "data-action": "static-key-refresh", "data-i18n": "common:auto.refresh"
                            }, {
                                default: () => [scope.tr("common:auto.refresh")]
                            })]), h("div", {
                            "id": "keyStatus", "class": "key-status muted", "data-i18n-skip": "true",
                            onVnodeMounted: ({el}: VNode) => {
                                (el as HTMLElement).textContent = scope.tr("connections:auto.no_private_key_selected");
                            }
                        }), h("div", {
                            "class": "upload-line"
                        }, [h("label", {
                                "class": "file-picker"
                            }, [h("input", {
                                    "id": "key_upload", "type": "file", "accept": "*/*", "data-change-action": "static-file-picker"
                                }, []), h("span", {
                                    "class": "file-picker-button", "data-i18n": "common:auto.choose_file"
                                }, [scope.tr("common:auto.choose_file")]), h("span", {
                                    "class": "file-picker-name", "data-i18n": uploadName.key,
                                    "data-i18n-skip": uploadName.skip, "data-file-picker-count": uploadName.count
                                }, [uploadName.text])]), h(TermaButton, {
                                "type": "button", "data-action": "static-key-upload", "data-i18n": "connections:auto.upload_key"
                            }, {
                                default: () => [scope.tr("connections:auto.upload_key")]
                            })]), h("div", {
                            "class": "actions"
                        }, [h(TermaButton, {
                                "type": "button", "data-action": "static-key-status", "data-i18n": "connections:auto.check_permissions"
                            }, {
                                default: () => [scope.tr("connections:auto.check_permissions")]
                            }), h(TermaButton, {
                                "type": "button", "data-action": "static-key-repair", "data-i18n": "connections:auto.repair_permissions"
                            }, {
                                default: () => [scope.tr("connections:auto.repair_permissions")]
                            })]), h("div", {
                            "class": "grid connection-key-options"
                        }, [h("div", {}, [h("label", {
                                    "data-i18n": "connections:auto.key_passphrase"
                                }, [scope.tr("connections:auto.key_passphrase")]), h(SettingsPasswordField, {
                                    ...passwordProps(scope), "id": "conn_key_passphrase", "autocomplete": "new-password", "data-i18n-placeholder": "connections:auto.passphrase_placeholder", "placeholder": scope.tr("connections:auto.passphrase_placeholder")
                                }, [])]), h("div", {}, [h("label", {}, ["SSH Agent"]), h("select", {
                                    "id": "conn_agent_mode"
                                }, [h("option", {
                                        "value": "auto", "data-i18n": "connections:auto.agent_auto"
                                    }, [scope.tr("connections:auto.agent_auto")]), h("option", {
                                        "value": "off", "data-i18n": "connections:auto.agent_off"
                                    }, [scope.tr("connections:auto.agent_off")]), h("option", {
                                        "value": "required", "data-i18n": "connections:auto.agent_required"
                                    }, [scope.tr("connections:auto.agent_required")])])])]), h("label", {
                            "id": "connClearPassphraseLine", "class": "checkline", "hidden": true
                        }, [h("input", {
                                "id": "conn_clear_key_passphrase", "type": "checkbox"
                            }, []), h("span", {
                                "data-i18n": "connections:auto.clear_passphrase"
                            }, [scope.tr("connections:auto.clear_passphrase")])])])]), h("div", {
                    "id": "passwordAuthBox", "class": "auth-password", "hidden": true
                }, [h("label", {
                        "data-i18n": "connections:auto.ssh_password"
                    }, [scope.tr("connections:auto.ssh_password")]), h(SettingsPasswordField, {
                        ...passwordProps(scope), "id": "conn_password", "autocomplete": "new-password", "data-i18n-placeholder": "connections:auto.ssh_password_placeholder", "placeholder": scope.tr("connections:auto.ssh_password_placeholder")
                    }, []), h("div", {
                        "class": "muted", "data-i18n": "connections:auto.password_edit_hint"
                    }, [scope.tr("connections:auto.password_edit_hint")])]), h("details", {
                    "id": "connAdvancedOptions", "class": "connection-form-advanced"
                }, [h("summary", {}, [h("span", {
                            "class": "connection-form-advanced-title"
                        }, [connectionIcon("sliders-horizontal"), h("b", {
                                "data-i18n": "connections:auto.advanced"
                            }, [scope.tr("connections:auto.advanced")])]), h("span", {
                            "id": "connAdvancedStatus", "class": "connection-form-advanced-status", "data-i18n-skip": "true"
                        }, ["终端、跳板与连接调优"]), connectionIcon("chevron-down")]), h("div", {
                        "class": "connection-form-advanced-body"
                    }, [h("fieldset", {
                            "class": "terminal-startup-card"
                        }, [h("legend", {
                                "data-i18n": "connections:auto.terminal_config"
                            }, [scope.tr("connections:auto.terminal_config")]), h("div", {
                                "class": "terminal-startup-intro", "data-i18n": "connections:auto.terminal_intro"
                            }, [scope.tr("connections:auto.terminal_intro")]), h("div", {
                                "class": "grid terminal-startup-selectors"
                            }, [h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.startup_mode"
                                    }, [scope.tr("connections:auto.startup_mode")]), h("select", {
                                        "id": "conn_terminal_startup_mode", "data-change-action": "static-terminal-startup"
                                    }, [h("option", {
                                            "value": "default", "data-i18n": "connections:auto.startup_default"
                                        }, [scope.tr("connections:auto.startup_default")]), h("option", {
                                            "value": "program", "data-i18n": "connections:auto.startup_program"
                                        }, [scope.tr("connections:auto.startup_program")])])]), h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.quick_select"
                                    }, [scope.tr("connections:auto.quick_select")]), h("select", {
                                        "id": "conn_terminal_profile_select", "data-change-action": "static-terminal-profile"
                                    })])]), h("div", {
                                "id": "connTerminalDetectionStatus", "class": "terminal-startup-detection muted", "data-i18n-skip": "true", "aria-live": "polite"
                            }, ["尚未检测。填写连接信息后点击“测试 SSH”。"]), h("div", {
                                "id": "connTerminalProgramFields", "class": "terminal-startup-program", "hidden": true
                            }, [h("div", {
                                    "class": "grid3 terminal-startup-meta"
                                }, [h("div", {}, [h("label", {
                                            "data-i18n": "connections:auto.profile_name"
                                        }, [scope.tr("connections:auto.profile_name")]), h("input", {
                                            "id": "conn_terminal_profile_name", "maxlength": "80", "data-i18n-placeholder": "connections:auto.profile_example", "placeholder": scope.tr("connections:auto.profile_example")
                                        }, [])]), h("div", {}, [h("label", {
                                            "data-i18n": "common:auto.type"
                                        }, [scope.tr("common:auto.type")]), h("select", {
                                            "id": "conn_terminal_profile_kind"
                                        }, [h("option", {
                                                "value": "shell"
                                            }, ["Shell"]), h("option", {
                                                "value": "repl", "data-i18n": "connections:auto.interactive_language"
                                            }, [scope.tr("connections:auto.interactive_language")]), h("option", {
                                                "value": "session", "data-i18n": "connections:auto.session_tool"
                                            }, [scope.tr("connections:auto.session_tool")]), h("option", {
                                                "value": "tool", "data-i18n": "connections:auto.interactive_tool"
                                            }, [scope.tr("connections:auto.interactive_tool")]), h("option", {
                                                "value": "custom", "data-i18n": "connections:auto.custom"
                                            }, [scope.tr("connections:auto.custom")])])]), h("div", {}, [h("label", {
                                            "data-i18n": "connections:auto.remote_platform"
                                        }, [scope.tr("connections:auto.remote_platform")]), h("select", {
                                            "id": "conn_terminal_program_platform"
                                        }, [h("option", {
                                                "value": "auto", "data-i18n": "connections:auto.auto_detect"
                                            }, [scope.tr("connections:auto.auto_detect")]), h("option", {
                                                "value": "posix"
                                            }, ["Linux / macOS / Unix"]), h("option", {
                                                "value": "windows"
                                            }, ["Windows"])])])]), h("label", {
                                    "data-i18n": "connections:auto.program_path"
                                }, [scope.tr("connections:auto.program_path")]), h("input", {
                                    "id": "conn_terminal_program_path", "maxlength": "1024", "autocomplete": "off", "spellcheck": "false", "data-i18n-placeholder": "connections:auto.program_path_example", "placeholder": scope.tr("connections:auto.program_path_example")
                                }, []), h("div", {
                                    "class": "grid terminal-startup-command-options"
                                }, [h("div", {}, [h("label", {
                                            "data-i18n": "connections:auto.startup_args"
                                        }, [scope.tr("connections:auto.startup_args")]), h("input", {
                                            "id": "conn_terminal_program_args", "maxlength": "2048", "autocomplete": "off", "spellcheck": "false", "data-i18n-placeholder": "connections:auto.startup_args_example", "placeholder": scope.tr("connections:auto.startup_args_example")
                                        }, [])]), h("div", {}, [h("label", {
                                            "data-i18n": "connections:auto.working_directory"
                                        }, [scope.tr("connections:auto.working_directory")]), h("input", {
                                            "id": "conn_terminal_working_directory", "maxlength": "1024", "autocomplete": "off", "spellcheck": "false", "data-i18n-placeholder": "connections:auto.working_directory_example", "placeholder": scope.tr("connections:auto.working_directory_example")
                                        }, [])])]), h("div", {
                                    "class": "terminal-startup-warning", "data-i18n": "connections:auto.startup_secret_warning"
                                }, [scope.tr("connections:auto.startup_secret_warning")])]), h("div", {
                                "id": "connTerminalCapabilities", "class": "terminal-startup-capabilities", "hidden": true
                            }, [])]), h("fieldset", {
                            "class": "connection-advanced-card"
                        }, [h("legend", {
                                "data-i18n": "connections:auto.connection_jump"
                            }, [scope.tr("connections:auto.connection_jump")]), h("div", {
                                "class": "grid3"
                            }, [h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.jump_host"
                                    }, [scope.tr("connections:auto.jump_host")]), h("select", {
                                        "id": "conn_jump"
                                    }, [h("option", {
                                            "value": [].join(''), "data-i18n": "connections:auto.direct"
                                        }, [scope.tr("connections:auto.direct")])])]), h("div", {}, [h("label", {}, ["TCP KeepAlive"]), h("select", {
                                        "id": "conn_tcp_keepalive"
                                    }, [h("option", {
                                            "value": "1", "data-i18n": "common:auto.enable"
                                        }, [scope.tr("common:auto.enable")]), h("option", {
                                            "value": "0", "data-i18n": "connections:auto.off"
                                        }, [scope.tr("connections:auto.off")])])]), h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.x11_forwarding"
                                    }, [scope.tr("connections:auto.x11_forwarding")]), h("select", {
                                        "id": "conn_x11_mode"
                                    }, [h("option", {
                                            "value": "off", "data-i18n": "connections:auto.off"
                                        }, [scope.tr("connections:auto.off")]), h("option", {
                                            "value": "untrusted", "data-i18n": "connections:auto.x11_restricted"
                                        }, [scope.tr("connections:auto.x11_restricted")]), h("option", {
                                            "value": "trusted", "data-i18n": "connections:auto.x11_trusted"
                                        }, [scope.tr("connections:auto.x11_trusted")])])])]), h("div", {
                                "class": "grid3"
                            }, [h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.connect_timeout"
                                    }, [scope.tr("connections:auto.connect_timeout")]), h("input", {
                                        "id": "conn_connect_timeout", "type": "number", "min": "3", "max": "120", "defaultValue": "10"
                                    }, [])]), h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.keepalive_interval"
                                    }, [scope.tr("connections:auto.keepalive_interval")]), h("input", {
                                        "id": "conn_keepalive_interval", "type": "number", "min": "0", "max": "300", "defaultValue": "60", "data-i18n-title": "connections:auto.keepalive_off_title", "aria-describedby": "conn_keepalive_interval_help", "title": scope.tr("connections:auto.keepalive_off_title")
                                    }, []), h("small", {
                                        "id": "conn_keepalive_interval_help", "class": "field-help", "data-i18n": "connections:auto.keepalive_off"
                                    }, [scope.tr("connections:auto.keepalive_off")])]), h("div", {}, [h("label", {
                                        "data-i18n": "connections:auto.keepalive_count"
                                    }, [scope.tr("connections:auto.keepalive_count")]), h("input", {
                                        "id": "conn_keepalive_count", "type": "number", "min": "1", "max": "20", "defaultValue": "3"
                                    }, [])])])]), h("div", {
                            "class": "connection-extra-options"
                        }, [h("label", {
                                "for": "conn_extra", "data-i18n": "connections:auto.openssh_tuning"
                            }, [scope.tr("connections:auto.openssh_tuning")]), h("textarea", {
                                "id": "conn_extra", "aria-describedby": "connExtraDiagnostics", "data-i18n-placeholder": "connections:auto.openssh_tuning_placeholder", "placeholder": scope.tr("connections:auto.openssh_tuning_placeholder")
                            }, []), h("div", {
                                "id": "connExtraDiagnostics", "class": "ssh-extra-diagnostics", "role": "status", "aria-live": "polite", "hidden": true
                            }, [])])])]), h("div", {
                    "id": "connRemoteGenerationLine", "class": "grid connection-derived-options"
                }, [h("div", {}, [h("label", {
                            "data-i18n": "connections:auto.related_connections"
                        }, [scope.tr("connections:auto.related_connections")]), h("select", {
                            "id": "conn_remote_generation"
                        }, [h("option", {
                                "value": [].join(''), "data-i18n": "connections:auto.ssh_only"
                            }, [scope.tr("connections:auto.ssh_only")]), h("option", {
                                "value": "all", "data-i18n": "connections:auto.generate_all"
                            }, [scope.tr("connections:auto.generate_all")]), h("option", {
                                "value": "rdp", "data-i18n": "connections:auto.generate_rdp"
                            }, [scope.tr("connections:auto.generate_rdp")]), h("option", {
                                "value": "vnc", "data-i18n": "connections:auto.generate_vnc"
                            }, [scope.tr("connections:auto.generate_vnc")]), h("option", {
                                "value": "xdmcp", "data-i18n": "connections:auto.generate_xdmcp"
                            }, [scope.tr("connections:auto.generate_xdmcp")]), h("option", {
                                "value": "ftp", "data-i18n": "connections:auto.generate_ftp"
                            }, [scope.tr("connections:auto.generate_ftp")]), h("option", {
                                "value": "telnet", "data-i18n": "connections:auto.generate_telnet"
                            }, [scope.tr("connections:auto.generate_telnet")])]), h("small", {
                            "class": "field-help", "data-i18n": "connections:auto.related_hint"
                        }, [scope.tr("connections:auto.related_hint")])])]), h("div", {
                    "class": "actions"
                }, [h(TermaButton, {
                        "id": "connSaveOnly", "type": "submit", "hidden": !editing, "data-i18n": "connections:auto.save_only"
                    }, {
                        default: () => [scope.tr("connections:auto.save_only")]
                    }), h(TermaButton, {
                        "id": "connPrimarySave", "class": "primary", "type": "submit", "data-save-action": editing ? 'close' : null, "data-i18n": editing ? 'connections:auto.save_close' : 'connections:auto.save_connection'
                    }, {
                        default: () => [scope.tr(editing ? 'connections:auto.save_close' : 'connections:auto.save_connection')]
                    }), h(TermaButton, {
                        "id": "connSaveAndConnect", "type": "button", "data-action": "static-connection-save-connect", "data-close-after-save": editing ? '1' : null, "data-i18n": editing ? 'connections:auto.save_open' : 'connections:auto.save_connect'
                    }, {
                        default: () => [scope.tr(editing ? 'connections:auto.save_open' : 'connections:auto.save_connect')]
                    }), h(TermaButton, {
                        "id": "connSaveAndClear", "hidden": editing, "type": "button", "data-action": "static-connection-save-clear", "data-i18n": "connections:auto.save_clear"
                    }, {
                        default: () => [scope.tr("connections:auto.save_clear")]
                    }), h(TermaButton, {
                        "id": "connTestBtn", "type": "button", "data-action": "static-connection-test", "data-i18n": "connections:auto.test_ssh"
                    }, {
                        default: () => [scope.tr("connections:auto.test_ssh")]
                    }), h(TermaButton, {
                        "type": "button", "data-action": "static-connection-reset", "data-i18n": "common:auto.clear"
                    }, {
                        default: () => [scope.tr("common:auto.clear")]
                    })]), h("div", {
                    "id": "connTestStatus", "class": "connection-test-status", "hidden": true, "aria-live": "polite"
                }, [])])])];
}
