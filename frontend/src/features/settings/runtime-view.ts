import { defineComponent, h, nextTick, ref, type PropType, type Ref, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { useRuntimeListener, type RuntimeListener } from './runtime-listener';
import { loopbackHost, wildcardHost, runtimePortValue, type ListenHost } from './runtime-settings-model';

export const RuntimeSettingsPanel = defineComponent({
    props: { scope: { type: Object as PropType<SettingsViewPort>, required: true } },
    setup(props) {
        const listener = useRuntimeListener(() => props.scope.runtimeSettings, (key, options) => props.scope.tr(key, options));
        const portInput = ref<HTMLInputElement>();
        function useSuggestedPort(port: number) {
            listener.changePort(String(port));
            void nextTick(() => portInput.value?.focus());
        }
        return () => runtimeSettingsPanelView(props.scope, listener, portInput, useSuggestedPort);
    }
});

function runtimeSettingsPanelView(scope: SettingsViewPort, listener: RuntimeListener,
    portInput: Ref<HTMLInputElement | undefined>, useSuggestedPort: (port: number) => void): VNodeChild {
    const data = listener.data.value;
    const saved = data?.saved || {
        listen_hosts: [loopbackHost], listen_port: runtimePortValue(undefined)
    };
    const effective = data?.effective || saved;
    const savedText = `${(saved.listen_hosts || []).join("、")}:${saved.listen_port}`;
    const effectiveText = `${(effective.listen_hosts || []).join("、")}:${effective.listen_port}`;
    const overridden = data?.sources?.listen_hosts === "env" || data?.sources?.listen_port === "env" || effective.sources?.listen_hosts === "env" || effective.sources?.listen_port === "env";
    const disabled = data?.listen_locked || listener.busy.value === 'save' || listener.busy.value === 'reload';
    return [h("div", {
            "class": "runtime-settings-panel", "data-terma-managed-fields": ""
        }, [" ", data?.error ? [h("div", {
                    "class": "runtime-feedback error"
                }, [settingsIcon("circle-alert"), h("span", {}, [scope.tr("settings:auto.listener_load_failed", {
                            error: data.error, defaultValue: `监听配置加载失败：${data.error}。其他设置不受影响，可以稍后重新加载。`
                        })]), h(TermaButton, {
                        type: 'button', disabled: Boolean(listener.busy.value),
                        loading: listener.busy.value === 'reload', onClick: () => { void listener.reload(); }
                    }, {
                        default: () => [scope.tr("settings:auto.reload", {
                                defaultValue: "重新加载"
                            })]
                    })])] : "", " ", h("div", {
                "class": "runtime-config-summary"
            }, [h("div", {}, [h("span", {}, [scope.tr("settings:auto.actual_listener", {
                            defaultValue: "当前实际监听"
                        })]), h("strong", {}, [effectiveText])]), h("div", {}, [h("span", {}, [scope.tr("settings:auto.saved_config", {
                            defaultValue: "已保存配置"
                        })]), h("strong", {}, [savedText])]), " ", data?.restart_required ? [h("span", {
                        "class": "status-pill reconnecting"
                    }, [scope.tr("settings:auto.restart_pending", {
                            defaultValue: "等待重启"
                        })])] : [h("span", {
                        "class": "status-pill running"
                    }, [scope.tr("settings:auto.effective", {
                            defaultValue: "已生效"
                        })])], " "]), " ", overridden ? [h("div", {
                    "class": "warning"
                }, [scope.tr("settings:auto.runtime_override_warning", {
                        defaultValue: "当前进程使用环境变量或启动参数覆盖监听配置。保存仍会写入配置文件，但重启时若继续传入覆盖项，将优先使用覆盖值。"
                    })])] : "", " ", data?.listen_locked ? [h("p", {
                    "class": "muted"
                }, [scope.tr("settings:updates.fnos_listener_managed")])] : "", " ", h("fieldset", {
                class: 'runtime-host-fieldset', disabled
            }, [h("legend", {}, [scope.tr("settings:auto.listen_addresses", {
                        defaultValue: "监听地址（可多选）"
                    })]), h("div", {
                    "class": "runtime-host-options"
                }, [runtimeHostOptionsView(scope, listener)]), h("div", {
                    "id": "runtimeWildcardHint", "class": "muted", "hidden": !listener.wildcard.value
                }, [scope.tr("settings:auto.wildcard_selected_hint", {
                        defaultValue: "已选择所有 IPv4 网卡；其他地址已折叠，取消勾选后可按网卡选择。"
                    })])]), h("div", {
                "class": "runtime-port-field"
            }, [h("label", {
                    "for": "runtimeListenPort"
                }, [scope.tr("settings:auto.listen_port", {
                        defaultValue: "监听端口"
                    })]), h("input", {
                    id: 'runtimeListenPort', type: 'number', inputmode: 'numeric', min: '1', max: '65535', step: '1', disabled,
                    ref: portInput, value: listener.port.value,
                    onInput: (event: Event) => listener.changePort((event.currentTarget as HTMLInputElement).value)
                }), h("span", {}, [scope.tr("settings:auto.listen_port_hint", {
                        defaultValue: "允许填写 1-65535。保存不会中断当前连接，重启 Terma 后生效。"
                    })])]), h("div", {
                "class": "runtime-security-note"
            }, [settingsIcon("shield-alert"), h("div", {}, [h("strong", {}, [scope.tr("settings:auto.lan_auth_warning_title", {
                            defaultValue: "局域网访问前先确认认证策略"
                        })]), h("span", {}, [scope.tr("settings:auto.lan_auth_warning", {
                            defaultValue: "选择指定网卡 IP 或 0.0.0.0 后，同一网络中的设备可能访问 Terma。建议保留 Web 密码并使用“仅非本机访问时校验密码”或“所有浏览器访问都校验密码”。0.0.0.0 表示所有 IPv4 网卡，不只代表某一个局域网地址。"
                        })])])]), h("div", {
                "class": "actions runtime-config-actions"
            }, [h(TermaButton, {
                    id: 'runtimeCheckBtn', type: 'button', disabled: Boolean(disabled || listener.busy.value),
                    loading: listener.busy.value === 'check', onClick: () => { void listener.check(); }
                }, {
                    default: () => [settingsIcon("scan-search"), h("span", {}, [scope.tr("settings:auto.check_port", {
                                defaultValue: "检查占用"
                            })])]
                }), h(TermaButton, {
                    id: 'runtimeSaveBtn', class: 'primary', type: 'button', disabled: Boolean(disabled || listener.busy.value),
                    loading: listener.busy.value === 'save', onClick: () => { void listener.save(); }
                }, {
                    default: () => [settingsIcon("save"), h("span", {}, [scope.tr("settings:auto.save_listener", {
                                defaultValue: "保存监听配置"
                            })])]
                })]), h("div", {
                "id": "runtimeSettingsFeedback", "aria-live": "polite"
            }, [runtimeFeedbackView(scope, listener, useSuggestedPort)])])];
}
function runtimeInterfaceLabel(scope: SettingsViewPort, value?: string) {
    const name = (value || '').trim();
    if (/^(?:以太网|ethernet)$/i.test(name)) return scope.tr('settings:auto.ethernet');
    if (/^(?:无线网络连接|无线局域网|wi-?fi|wlan)$/i.test(name)) return scope.tr('settings:auto.wifi');
    return name;
}

function runtimeHostEntryLabel(scope: SettingsViewPort, entry: ListenHost, address: string) {
    if (address === loopbackHost || entry.kind === 'loopback' || entry.interface === 'loopback') return scope.tr('settings:auto.local_only');
    if (address === wildcardHost || entry.kind === 'all' || entry.interface === 'all') return scope.tr('settings:auto.all_ipv4');
    if (entry.kind === 'saved' || entry.interface === 'saved') return scope.tr('settings:auto.current_config_address', {address});
    const label = runtimeInterfaceLabel(scope, entry.interface);
    return label ? `${label} · ${address}` : entry.label || address;
}

function runtimeHostOptionsView(scope: SettingsViewPort, listener: RuntimeListener): VNodeChild {
    const selected = new Set(listener.hosts.value);
    return (listener.data.value?.available_hosts || []).map(entry => {
        const address = entry.address;
        const wildcard = address === wildcardHost;
        const interfaceLabel = runtimeInterfaceLabel(scope, entry.interface);
        const detail = wildcard
            ? scope.tr("settings:auto.all_ipv4_hint", {
                defaultValue: "包含当前及以后出现的所有 IPv4 网卡"
            })
            : address === loopbackHost
                ? scope.tr("settings:auto.local_only_hint", {
                    defaultValue: "仅本机可访问（只能从运行 Terma 的本机访问）"
                })
                : entry.interface && entry.interface !== "saved"
                    ? scope.tr("settings:auto.interface_binding", {
                        interface: interfaceLabel, defaultValue: `${interfaceLabel} · 仅绑定此网卡地址`
                    })
                    : scope.tr("settings:auto.address_binding", {
                        defaultValue: "仅绑定此网卡地址"
                    });
        return [h("label", {
                class: ['runtime-host-option', {wildcard}], key: address, 'data-runtime-host-option': address,
                hidden: !wildcard && listener.wildcard.value
            }, [h("input", {
                    type: 'checkbox', name: 'runtimeListenHost', value: address, checked: selected.has(address),
                    onChange: (event: Event) => listener.selectHost(address, (event.currentTarget as HTMLInputElement).checked)
                }), h("span", {}, [h("strong", {}, [runtimeHostEntryLabel(scope, entry, address)]), h("small", {}, [detail])]), h("code", {}, [address])])];
    });
}
function runtimeFeedbackView(scope: SettingsViewPort, listener: RuntimeListener, useSuggestedPort: (port: number) => void): VNodeChild {
    const feedback = listener.feedback.value;
    if (feedback) {
        const type = feedback.type;
        const symbol = type === 'success' ? 'check-circle-2' : 'circle-alert';
        const text = feedback.type === 'success' ? scope.tr('settings:auto.listener_saved_detail') : feedback.text;
        return [h("div", {
                "class": ["runtime-feedback ", type].join('')
            }, [settingsIcon(symbol), h("span", {}, [text])])];
    }
    const result = listener.checkResult.value;
    if (!result)
        return "";
    const requestedPort = result.requested_port || result.listen_port || listener.port.value;
    if (result.error && result.available !== false)
        return [h("div", {
                "class": "runtime-feedback error"
            }, [settingsIcon("circle-alert"), h("span", {}, [result.error])])];
    if (result.available && (result.occupied_by_current || result.current)) {
        return [h("div", {
                "class": "runtime-feedback info"
            }, [settingsIcon("info"), h("span", {}, [scope.tr("settings:auto.port_current", {
                        port: requestedPort, defaultValue: `端口 ${requestedPort} 正由当前 Terma 使用；保存后仍需重启才能应用新的监听地址。`
                    })])])];
    }
    if (result.available)
        return [h("div", {
                "class": "runtime-feedback success"
            }, [settingsIcon("check-circle-2"), h("span", {}, [scope.tr("settings:auto.port_available", {
                        port: requestedPort, defaultValue: `端口 ${requestedPort} 可用，可以保存此监听配置。`
                    })])])];
    const suggestion = runtimePortValue(result.suggested_port, 0);
    const reason = result.code === "EADDRINUSE" || /address already in use|eaddrinuse/i.test(result.error || "")
        ? scope.tr("settings:auto.port_in_use_reason", {
            defaultValue: "该端口已被其他程序占用。"
        })
        : result.code === "EACCES" || /permission denied|eacces/i.test(result.error || "")
            ? scope.tr("settings:auto.port_denied_reason", {
                defaultValue: "当前账号无权绑定该端口。"
            })
            : result.error
                ? scope.tr("settings:auto.port_check_reason", {
                    error: result.error, defaultValue: `检查失败：${result.error}`
                })
                : scope.tr("settings:auto.port_unbindable_reason", {
                    defaultValue: "该端口无法绑定。"
                });
    const suggestionText = suggestion
        ? scope.tr("settings:auto.port_suggestion", {
            port: suggestion, defaultValue: ` 可尝试端口 ${suggestion}。`
        })
        : scope.tr("settings:auto.port_try_another", {
            defaultValue: " 请换一个端口后重试。"
        });
    const unavailable = scope.tr("settings:auto.port_unavailable", {
        port: requestedPort, reason, suggestion: suggestionText, defaultValue: `端口 ${requestedPort} 不可用。${reason}${suggestionText}`
    });
    return [h("div", {
            "class": "runtime-feedback error"
        }, [settingsIcon("circle-alert"), h("span", {}, [unavailable]), suggestion ? [h(TermaButton, {
                    type: 'button', onClick: () => useSuggestedPort(suggestion)
                }, {
                    default: () => [scope.tr("settings:auto.use_port", {
                            port: suggestion, defaultValue: `使用 ${suggestion}`
                        })]
                })] : ""])];
}
