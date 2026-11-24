import {settingsServices} from '@/features/settings/installed-services';
import { SettingsPasswordField } from './SettingsPasswordField';
import { h, mergeProps, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import { securityIntegrationPresentation } from './security-settings-actions';
import type { SettingsViewPort } from './settings-port';
export function sshHostTrustPanelView(scope: SettingsViewPort): VNodeChild {
    const trusted = settingsServices.termaTrustedHosts;
    const {hosts, page, total, totalPages, query} = trusted.snapshot();
    const removeLabel = scope.tr("settings:trust.remove_record");
    const previousLabel = scope.tr("settings:trust.previous_page");
    const nextLabel = scope.tr("settings:trust.next_page");
    const searchLabel = scope.tr("settings:trust.search");
    const searchPlaceholder = scope.tr("settings:trust.search_placeholder");
    const rows = hosts.map((item) => [h("div", {
            "class": "ssh-trust-record"
        }, [h("div", {
                "class": "ssh-trust-record-main"
            }, [h("strong", {}, [item.host_label || `${item.host}:${item.port}`]), h("span", {}, [item.key_type || scope.tr("settings:trust.unknown_algorithm")]), h("code", {}, [item.fingerprint || ""])]), h("div", {
                "class": "ssh-trust-record-side"
            }, [h("span", {}, [item.updated_at ? new Date(item.updated_at).toLocaleString(document.documentElement.lang || undefined, {
                        hour12: false
                    }) : ""]), h(TermaButton, {
                    "class": "icon-button danger", "type": "button", "title": removeLabel, "aria-label": removeLabel, "onClick": (event: any) => { void trusted.remove(item); }
                }, {
                    default: () => [settingsIcon("trash-2")]
                })])])]);
    const pager = totalPages > 1 ? [h("div", {
            "class": "ssh-trust-pager", "aria-label": scope.tr("settings:trust.pagination")
        }, [h(TermaButton, mergeProps({
                "class": "icon-button", "type": "button", "title": previousLabel, "aria-label": previousLabel, "onClick": (event: any) => { void trusted.changePage(page - 1); }
            }, (page <= 1 ? {
                "disabled": true
            } : {})), {
                default: () => [settingsIcon("chevron-left")]
            }), h("span", {}, [scope.tr("settings:trust.page_summary", {
                    page: page, pages: totalPages, total: total
                })]), h(TermaButton, mergeProps({
                "class": "icon-button", "type": "button", "title": nextLabel, "aria-label": nextLabel, "onClick": (event: any) => { void trusted.changePage(page + 1); }
            }, (page >= totalPages ? {
                "disabled": true
            } : {})), {
                default: () => [settingsIcon("chevron-right")]
            })])] : (total ? [h("div", {
            "class": "ssh-trust-pager"
        }, [h("span", {}, [scope.tr("settings:trust.total", {
                    total: total
                })])])] : "");
    return [h("section", {
            "id": "sshHostTrustPanel", "class": "ssh-trust-settings-section"
        }, [h("h3", {}, [scope.tr("settings:auto.ssh_host_trust")]), h("div", {
                "class": "muted"
            }, [scope.tr("settings:auto.ssh_host_trust_hint")]), h("div", {
                "class": "ssh-trust-search"
            }, [h("input", {
                    "id": "sshHostTrustSearch", "type": "search", "value": query, "placeholder": searchPlaceholder, "aria-label": searchLabel, "onKeydown": (event: KeyboardEvent) => {
                        if (event.key === 'Enter')
                            void trusted.search((event.currentTarget as HTMLInputElement).value);
                    }
                }, []), h(TermaButton, {
                    "class": "icon-button", "type": "button", "title": searchLabel, "aria-label": searchLabel, "onClick": (event: MouseEvent) => {
                        const input = (event.currentTarget as HTMLElement).closest('.ssh-trust-search')?.querySelector('input');
                        if (input) void trusted.search(input.value);
                    }
                }, {
                    default: () => [settingsIcon("search")]
                })]), h("div", {
                "class": "ssh-trust-records"
            }, [rows.length ? rows : [h("div", {
                        "class": "ui-state empty compact"
                    }, [h("span", {
                            "class": "ui-state-icon", "aria-hidden": "true"
                        }, []), h("strong", {}, [scope.tr("settings:auto.no_trusted_hosts")]), h("span", {}, [scope.tr("settings:auto.trusted_hosts_hint")])])]]), " ", pager, " "])];
}
export function localDirectDesktopIntegrationStatusView(scope: SettingsViewPort, settings: any = scope.securitySettings || {}): VNodeChild {
    const presentation = securityIntegrationPresentation(scope.settingsRoot, settings, scope.tr);
    return [h("div", {
            "id": "securityLocalDirectDesktopIntegrationState", "class": ["connection-test-status ", presentation.className].join('')
        }, [presentation.text])];
}
