import {h,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {quickIcon,quickEmptyState,paintQuickView} from '../quick/quick-mount';
import type {createPaletteService} from './palette-service';
import type {Forward,Profile} from './palette-model';
export interface PaletteViewPort {state:ReturnType<typeof createPaletteService>['state'];tr:(key:string,params?:Record<string,unknown>)=>string;scheduleQuickPanelRender(query:string):void;refresh(query:string,reset?:boolean):void;runQuickPanelItem(index:number):void;closeQuickPanel():void;quickForwardIsActive(forward:Forward):boolean;quickForwardAccessUrl(forward:Forward):string;remoteProtocolAction(protocol:string):string;REMOTE_PROTOCOL_META:Record<string,{icon:string}>;refreshIcons():void}
export function ensureQuickPanel(scope: PaletteViewPort): any {
    let panel: any = document.getElementById("quickPanel");
    if (panel) {
        syncQuickPanelLocalization(scope, panel);
        return panel;
    }
    panel = document.createElement("div");
    panel.id = "quickPanel";
    panel.className = "quick-panel";
    panel.hidden = true;
    paintQuickView(panel, [h("div", {
            "class": "quick-panel-dialog", "role": "dialog", "aria-modal": "true", "aria-label": scope.tr("navigation:auto.command_window", {
                defaultValue: "命令窗口"
            })
        }, [h("div", {
                "class": "quick-panel-search"
            }, [quickIcon("search"), h("input", {
                    "id": "quickPanelInput", "autocomplete": "off", "spellcheck": "false", "aria-label": scope.tr("common:command_palette.search_placeholder", {
                        defaultValue: "搜索内容，或输入 用户名@主机:端口"
                    }), "placeholder": scope.tr("common:command_palette.search_placeholder", {
                        defaultValue: "搜索内容，或输入 用户名@主机:端口"
                    })
                }, [])]), h("div", {
                "id": "quickPanelResults", "class": "quick-panel-results", "role": "listbox"
            }, [])])]);
    document.body.appendChild(panel);
    syncQuickPanelLocalization(scope, panel);
    const input: any = panel.querySelector("#quickPanelInput");
    input.addEventListener("input", () => scope.scheduleQuickPanelRender(input.value));
    input.addEventListener("keydown", (event: any) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step: any = event.key === "ArrowDown" ? 1 : -1;
            scope.state.quickIndex = Math.max(0, Math.min(scope.state.quickItems.length - 1, scope.state.quickIndex + step));
            scope.refresh(input.value, false);
        }
        else if (event.key === "Enter") {
            event.preventDefault();
            scope.runQuickPanelItem(scope.state.quickIndex);
        }
        else if (event.key === "Escape")
            scope.closeQuickPanel();
    });
    panel.addEventListener("pointerdown", (event: any) => {
        if (event.target === panel)
            scope.closeQuickPanel();
    });
    panel.querySelector("#quickPanelResults")?.addEventListener("pointermove", (event: any) => {
        const item: any = event.target.closest?.(".quick-result[data-index]");
        if (!item)
            return;
        const index: any = Number(item.dataset.index);
        if (Number.isInteger(index) && scope.state.quickIndex !== index) {
            scope.state.quickIndex = index;
            scope.refresh(input?.value || "", false);
        }
    });
    return panel;
}
export function syncQuickPanelLocalization(scope: PaletteViewPort, panel: any = document.getElementById("quickPanel")): any {
    if (!panel)
        return;
    const title: any = scope.tr("navigation:auto.command_window", {
        defaultValue: "命令窗口"
    });
    const search: any = scope.tr("common:command_palette.search_placeholder", {
        defaultValue: "搜索内容，或输入 用户名@主机:端口"
    });
    panel.querySelector(".quick-panel-dialog")?.setAttribute("aria-label", title);
    const input: any = panel.querySelector("#quickPanelInput");
    if (input) {
        input.placeholder = search;
        input.setAttribute("aria-label", search);
    }
}
export function renderQuickPanel(scope: PaletteViewPort, query: any = "", reset: any = true): any {
    const panel: any = ensureQuickPanel(scope);
    
    if (reset)
        scope.state.quickIndex = 0;
    scope.state.quickIndex = Math.min(scope.state.quickIndex, Math.max(0, scope.state.quickItems.length - 1));
    const results: any = panel.querySelector("#quickPanelResults");
    paintQuickView(results, scope.state.quickItems.length ? scope.state.quickItems.map((item: any, index: any) => {
        const actions: any = item.kind === "connection" ? [h("span", {
                "class": "quick-result-actions"
            }, [h(TermaButton, {
                    "data-action": "quick-panel-connection-terminal", "data-connection-id": Number(item.connection.id), "title": scope.tr("common:command_palette.open_terminal", {
                        defaultValue: "打开终端"
                    }), "aria-label": scope.tr("common:command_palette.open_terminal", {
                        defaultValue: "打开终端"
                    })
                }, {
                    default: () => [quickIcon("square-terminal")]
                }), h(TermaButton, {
                    "data-action": "quick-panel-connection-sftp", "data-connection-id": Number(item.connection.id), "title": scope.tr("common:command_palette.open_sftp", {
                        defaultValue: "打开 SFTP"
                    }), "aria-label": scope.tr("common:command_palette.open_sftp", {
                        defaultValue: "打开 SFTP"
                    })
                }, {
                    default: () => [quickIcon("folder-open")]
                }), h(TermaButton, {
                    "data-action": "quick-panel-connection-forward", "data-connection-id": Number(item.connection.id), "title": scope.tr("common:command_palette.manage_forwards", {
                        defaultValue: "管理转发"
                    }), "aria-label": scope.tr("common:command_palette.manage_forwards", {
                        defaultValue: "管理转发"
                    })
                }, {
                    default: () => [quickIcon("route")]
                })])] : item.kind === "forward" ? (() => {
            const active = scope.quickForwardIsActive(item.forward);
            const accessUrl = scope.quickForwardAccessUrl(item.forward);
            const toggleLabel: any = active ? scope.tr("connections:quick_open.stop_forward", {
                defaultValue: "停止转发"
            }) : scope.tr("connections:quick_open.start_forward", {
                defaultValue: "启动转发"
            });
            return [h("span", {
                    "class": "quick-result-actions"
                }, [accessUrl ? [h("a", {
                            "href": accessUrl, "target": "_blank", "rel": "noopener", "data-action": "quick-panel-stop-propagation", "title": scope.tr("connections:quick_open.open_forward_url", {
                                defaultValue: "打开访问地址"
                            }), "aria-label": scope.tr("connections:quick_open.open_forward_url", {
                                defaultValue: "打开访问地址"
                            })
                        }, [quickIcon("external-link")])] : "", h(TermaButton, {
                        "data-action": "quick-forward-toggle", "data-forward-id": Number(item.forward.id), "title": toggleLabel, "aria-label": toggleLabel
                    }, {
                        default: () => [quickIcon(active ? "square" : "play")]
                    }), h(TermaButton, {
                        "data-action": "quick-panel-forward-open", "data-connection-id": Number(item.connection.id), "data-forward-id": Number(item.forward.id), "title": scope.tr("connections:quick_open.open_forward", {
                            defaultValue: "打开转发规则"
                        }), "aria-label": scope.tr("connections:quick_open.open_forward", {
                            defaultValue: "打开转发规则"
                        })
                    }, {
                        default: () => [quickIcon("route")]
                    })])];
        })() : item.remoteProfile ? (() => {
            const openLabel: any = typeof scope.remoteProtocolAction === "function"
                ? scope.remoteProtocolAction(item.remoteProfile.protocol)
                : scope.tr("common:auto.open", {
                    defaultValue: "打开"
                });
            return [h("span", {
                    "class": "quick-result-actions"
                }, [h(TermaButton, {
                        "data-action": "quick-panel-remote-open", "data-index": index, "title": openLabel, "aria-label": openLabel
                    }, {
                        default: () => [quickIcon(scope.REMOTE_PROTOCOL_META[item.remoteProfile.protocol]?.icon || "plug")]
                    }), h(TermaButton, {
                        "data-action": "quick-panel-remote-edit", "data-remote-profile-id": Number(item.remoteProfile.id), "title": scope.tr("common:command_palette.edit_connection", {
                            defaultValue: "编辑连接"
                        }), "aria-label": scope.tr("common:command_palette.edit_connection", {
                            defaultValue: "编辑连接"
                        })
                    }, {
                        default: () => [quickIcon("pencil")]
                    })])];
        })() : "";
        const accessibleLabel: any = [item.title, item.detail].filter(Boolean).join(" · ");
        return [h("div", {
                "class": ["quick-result", index === scope.state.quickIndex ? " active" : ""].join(''), "role": "option", "aria-selected": index === scope.state.quickIndex, "aria-label": accessibleLabel, "title": accessibleLabel, "data-i18n-skip": true, "data-index": index, "data-action": "quick-panel-run"
            }, [h("span", {
                    "class": "quick-result-icon"
                }, [quickIcon(item.icon)]), h("span", {
                    "class": "quick-result-copy"
                }, [h("strong", {}, [item.title]), h("small", {}, [item.detail || ""])]), actions, " "])];
    }) : quickEmptyState("empty", scope.tr("common:auto.no_matches", {
        defaultValue: "没有匹配结果"
    }), scope.tr("common:command_palette.try_another", {
        defaultValue: "换一个关键词试试。"
    })));
    results.querySelector(".quick-result.active")?.scrollIntoView({
        block: "nearest"
    });
    scope.refreshIcons();
}
