import { defineComponent, h, mergeProps, type PropType, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { normalizeAiSettingsResponse } from './ai-settings-model';
import { AiProviderSettings } from './AiProviderSettings';
import { aiSettingsBusy, aiTestResult, runAiSettingsAction, syncAiSettingsDetails } from './ai-settings-actions';
import { AiPermission, AiUserSkills } from './AiPermissionSkills';
import { AiMcpSettings } from './AiMcpSettings';
import { aiPermissionSkills } from './ai-permission-skills-draft';
import { mcpDraft } from './ai-mcp-draft';

const SettingsWithSaveLock = defineComponent({
    props:{component:{type:Object,required:true}, scope:{type:Object as PropType<SettingsViewPort>,required:true}},
    setup:props => () => {
        const {scope} = props;
        return h(props.component,{tr:(key:string,options?:Record<string,unknown>) => scope.tr(key,options),saving:aiSettingsBusy.save});
    }
});

const AiSettingsActions = defineComponent({
    props: { scope: {type:Object as PropType<SettingsViewPort>, required:true} },
    setup(props) {
        const tr = (key: string) => props.scope.tr('settings:ai.' + key);
        return () => [h('pre',{id:'terminalAiTestResult',class:'terminal-ai-test-result',hidden:!aiTestResult.visible},aiTestResult.text),
            h('div',{class:'actions terminal-ai-settings-actions'},[
                h(TermaButton,{id:'terminalAiSaveBtn',class:'primary',loading:aiSettingsBusy.save,disabled:aiSettingsBusy.save || Boolean(mcpDraft.busy) || aiPermissionSkills.confirming,
                    onClick:(event:MouseEvent)=>runAiSettingsAction('save',event,props.scope.tr)},()=>[settingsIcon('save'),h('span',tr('save'))]),
                h(TermaButton,{id:'terminalAiTestBtn',loading:aiSettingsBusy.test,disabled:aiSettingsBusy.test||aiSettingsBusy.save,
                    onClick:(event:MouseEvent)=>runAiSettingsAction('test',event,props.scope.tr)},()=>[settingsIcon('message-circle'),h('span',tr('test'))])
            ])];
    }
});
export function aiSettingsPanelView(scope: SettingsViewPort): VNodeChild {
    const source = scope.runtimeSettings?.saved?.ai || scope.runtimeSettings?.ai;
    const ai = normalizeAiSettingsResponse(source, scope.tr);
    syncAiSettingsDetails(source, ai);
    const contextUnit = ai.context_tokens >= 1000000 ? 'M' : 'K';
    const contextDisplay = (ai.context_tokens / (contextUnit === 'M' ? 1000000 : 1000))
        .toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return [h("section", {
            "class": "terminal-ai-settings"
        }, [h("div", {
                "class": "settings-subsection-head"
            }, [h("div", {}, [h("h3", {}, [scope.tr("settings:ai.title", {
                            defaultValue: "终端 AI"
                        })])]), h("span", {
                    "class": ["status-pill ", ai.enabled ? "running" : "muted"].join('')
                }, [scope.tr(ai.enabled ? "settings:ai.enabled" : "settings:ai.disabled", {
                        defaultValue: ai.enabled ? "已启用" : "未启用"
                    })])]), h("label", {
                "class": "check-row"
            }, [h("input", mergeProps({
                    "id": "terminalAiEnabled", "type": "checkbox"
                }, (ai.enabled ? {
                    "checked": true
                } : {})), []), " ", scope.tr("settings:ai.enable", {
                    defaultValue: "启用终端 AI"
                })]), h("div", {
                "class": "muted"
            }, [scope.tr("settings:ai.safe_hint", {
                    defaultValue: "未启用、服务不可用或请求失败时，终端和日志仍按原流程工作。只发送你明确选择的上下文。"
                })]), h(AiProviderSettings, {scope}), h("div", {
                "class": "grid terminal-ai-settings-grid"
            }, [h("div", {}, [h("label", {
                        "for": "terminalAiTimeout"
                    }, [scope.tr("settings:ai.timeout", {
                            defaultValue: "请求超时（秒）"
                        })]), h("input", {
                        "id": "terminalAiTimeout", "type": "number", "min": "5", "max": "300", "step": "1", "value": ai.timeout_seconds
                    }, [])]), h("div", {}, [h("label", {
                        "for": "terminalAiContextValue"
                    }, [scope.tr("settings:ai.context_limit", {
                            defaultValue: "Terma 上下文预算"
                        })]), h("div", {
                        "class": "terminal-ai-context-row"
                    }, [h("input", {
                            "id": "terminalAiContextValue", "type": "number", "min": "1", "max": "1000", "step": "0.01", "value": contextDisplay
                        }, []), h("select", {
                            "id": "terminalAiContextUnit", value: contextUnit
                        }, [h('option', {value: 'K'}, 'K'), h('option', {value: 'M'}, 'M')]), h("span", {}, ["tokens"])]), h("div", {
                        "class": "muted terminal-ai-context-settings-hint"
                    }, [scope.tr("settings:ai.context_limit_hint", {
                            defaultValue: "Terma 按约 4 个字符折算 1 token 限制发送的终端和附件上下文；服务商实际上下文窗口以接口为准。"
                        })])])]), h("div", {
                "class": "grid terminal-ai-settings-grid terminal-ai-reasoning-settings"
            }, [h("div", {}, [h("label", {
                        "for": "terminalAiReasoningEffort"
                    }, [scope.tr("settings:ai.reasoning_effort", {
                            defaultValue: "推理强度"
                        })]), h("select", {
                        "id": "terminalAiReasoningEffort"
                    }, [h("option", mergeProps({
                            "value": "none"
                        }, (ai.reasoning_effort === "none" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_none", {
                                defaultValue: "关闭"
                            })]), h("option", mergeProps({
                            "value": "minimal"
                        }, (ai.reasoning_effort === "minimal" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_minimal", {
                                defaultValue: "最低"
                            })]), h("option", mergeProps({
                            "value": "low"
                        }, (ai.reasoning_effort === "low" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_low", {
                                defaultValue: "低"
                            })]), h("option", mergeProps({
                            "value": "medium"
                        }, (ai.reasoning_effort === "medium" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_medium", {
                                defaultValue: "中"
                            })]), h("option", mergeProps({
                            "value": "high"
                        }, (ai.reasoning_effort === "high" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_high", {
                                defaultValue: "高"
                            })]), h("option", mergeProps({
                            "value": "xhigh"
                        }, (ai.reasoning_effort === "xhigh" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_xhigh", {
                                defaultValue: "极高"
                            })]), h("option", mergeProps({
                            "value": "max"
                        }, (ai.reasoning_effort === "max" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.reasoning_max", {
                                defaultValue: "最大"
                            })])]), h("small", {
                        "class": "muted"
                    }, [scope.tr("settings:ai.reasoning_current", {
                            effort: ai.reasoning_effort, defaultValue: `当前：${ai.reasoning_effort}`
                        })])]), h("div", {}, [h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "id": "terminalAiDeepThinking", "type": "checkbox"
                        }, (ai.deep_thinking ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.deep_thinking", {
                            defaultValue: "深度思考"
                        })]), h("small", {
                        "class": "muted"
                    }, [scope.tr("settings:ai.deep_thinking_hint", {
                            defaultValue: "开启后未选择推理强度时会使用高；已选择极高或最大时不会被降级。是否生效取决于服务商；界面只显示服务商返回的推理摘要，不显示隐藏思维链。"
                        })])])]), h("div", {
                "class": "grid terminal-ai-settings-grid"
            }, [h("div", {}, [h("label", {
                        "for": "terminalAiPlacement"
                    }, [scope.tr("settings:ai.placement", {
                            defaultValue: "终端 AI 位置"
                        })]), h("select", {
                        "id": "terminalAiPlacement"
                    }, [h("option", mergeProps({
                            "value": "right"
                        }, (ai.terminal_ai_placement === "right" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.placement_right", {
                                defaultValue: "右侧（默认）"
                            })]), h("option", mergeProps({
                            "value": "bottom"
                        }, (ai.terminal_ai_placement === "bottom" ? {
                            "selected": true
                        } : {})), [scope.tr("settings:ai.placement_bottom", {
                                defaultValue: "下方"
                            })])])]), h(SettingsWithSaveLock, {component:AiPermission,scope})]), h("div", {
                "class": "muted"
            }, [scope.tr("settings:ai.permission_hint", {
                    defaultValue: "受控自动只会自动运行明确的只读命令；写入、删除、提权、安装、网络和服务变更仍需实时确认。"
                })]), h("fieldset", {
                "class": "terminal-ai-skills"
            }, [h("legend", {}, [scope.tr("settings:ai.skills", {
                        defaultValue: "内置 Skills"
                    })]), h("div", {
                    "class": "terminal-ai-skills-grid"
                }, [h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "linux-diagnostics"
                        }, (ai.skills_enabled.includes("linux-diagnostics") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_linux", {
                            defaultValue: "Linux 诊断"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "security-audit"
                        }, (ai.skills_enabled.includes("security-audit") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_security", {
                            defaultValue: "安全审计"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "log-analysis"
                        }, (ai.skills_enabled.includes("log-analysis") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_logs", {
                            defaultValue: "日志分析"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "service-troubleshooting"
                        }, (ai.skills_enabled.includes("service-troubleshooting") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_services", {
                            defaultValue: "服务排障"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "network-diagnostics"
                        }, (ai.skills_enabled.includes("network-diagnostics") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_network", {
                            defaultValue: "网络排障"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "performance-analysis"
                        }, (ai.skills_enabled.includes("performance-analysis") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_performance", {
                            defaultValue: "性能分析"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "container-troubleshooting"
                        }, (ai.skills_enabled.includes("container-troubleshooting") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_containers", {
                            defaultValue: "容器排障"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "git-workflow"
                        }, (ai.skills_enabled.includes("git-workflow") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_git", {
                            defaultValue: "Git 工作流"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "incident-response"
                        }, (ai.skills_enabled.includes("incident-response") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_incident", {
                            defaultValue: "故障应急"
                        })]), h("label", {
                        "class": "check-row"
                    }, [h("input", mergeProps({
                            "type": "checkbox", "data-terminal-ai-skill": "web-research"
                        }, (ai.skills_enabled.includes("web-research") ? {
                            "checked": true
                        } : {})), []), " ", scope.tr("settings:ai.skill_web", {
                            defaultValue: "联网检索"
                        })])]), h("div", {
                    "class": "muted"
                }, [scope.tr("settings:ai.skills_hint", {
                        defaultValue: "选中的 Skills 会作为受信任的系统工作流参与每次终端与日志 AI 请求。"
                    })])]), h(SettingsWithSaveLock, {component:AiUserSkills,scope}), h(SettingsWithSaveLock, {component:AiMcpSettings,scope}), h(AiSettingsActions, {scope})])];
}
