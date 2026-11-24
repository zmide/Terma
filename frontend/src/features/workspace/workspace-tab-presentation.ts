import {remoteServices} from '@/features/remote/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {icon} from '@/shared/ui/icon-service';
import {applicationState} from '@/shared/application-state';
import { escapeHtml } from '../../shared/html-escape';
import type { WorkspaceTab } from './workspace-tab-runtime';

// Docked tabs, the fallback workspace and the window title use the same title rules.
type TabPresentation = Partial<WorkspaceTab> | Record<string, unknown>;

const terminalMarker = /\s*·\s*(?:终端|Terminal)(?=\s*(?:#\d+|·|$))/i;
const sftpMarker = /\s*·\s*SFTP(?=\s*(?:#\d+|·|$))/i;
const protocolMarker = /\s*·\s*(RDP|VNC|XDMCP)\s*$/i;
const desktopProtocols = new Set(['rdp', 'vnc', 'xdmcp']);
const glyphs = new Map([
  ['remote-terminal','square-terminal'], ['remote-desktop','monitor'], ['ftp','folder-sync'],
  ['local-files','hard-drive'], ['forward-manager','route'], ['terminal','square-terminal'],
  ['quick-terminal','square-terminal'], ['sftp','folder-open']
]);

export function workspaceTabProtocol(tab: TabPresentation) {
  return String(tab.protocol || String(tab.title || '').match(protocolMarker)?.[1] || '').toLowerCase();
}

export function workspaceTabIcon(kind: string, protocol: string) {
  if (kind === 'remote-desktop' && desktopProtocols.has(protocol)) {
    return { glyph: 'monitor', classes: `tab-kind-icon remote-desktop remote-protocol-${protocol}`, badge: protocol[0].toUpperCase() };
  }
  const glyph = glyphs.get(kind);
  if (!glyph) return null;
  return { glyph, classes: `tab-kind-icon ${kind}${kind === 'quick-terminal' ? ' terminal' : ''}`, badge: '' };
}

export function compactWorkspaceTabTitle(tab: TabPresentation) {
  const title = String(tab.title || tr('navigation:auto.tab', {defaultValue:'标签'}));
  if (tab.kind === 'remote-desktop') {
    const protocol = workspaceTabProtocol(tab);
    return desktopProtocols.has(protocol) && title.match(protocolMarker)?.[1].toLowerCase() === protocol
      ? title.replace(protocolMarker, '').trim() || title
      : title;
  }
  if (tab.kind === 'terminal' || tab.kind === 'quick-terminal') return title.replace(terminalMarker, '').trim();
  if (tab.kind === 'sftp') return title.replace(sftpMarker, '').trim();
  return title;
}

function fallbackTabPresentation(tab: TabPresentation) {
  const title = compactWorkspaceTabTitle(tab);
  const glyph = workspaceTabIcon(String(tab.kind || ''), workspaceTabProtocol(tab));
  if (!glyph) return {title, icon: ''};
  const badge = glyph.badge ? `<span class="tab-protocol-letter">${escapeHtml(glyph.badge)}</span>` : '';
  return {title, icon: `<span class="${escapeHtml(glyph.classes)}" aria-hidden="true">${icon(glyph.glyph)}${badge}</span>`};
}

export function localizedWorkspaceTabTitle(tab?: TabPresentation) {
  const title = String(tab?.title || "");
  if (tab?.key === "welcome") return tr("common:workspace.welcome_title", {defaultValue:"开始使用"});
  if (tab?.kind === "import") return tr("navigation:auto.import_export", {defaultValue:"导入导出"});
  if (tab?.kind === "settings") return tr("settings:title", {defaultValue:"设置"});
  if (tab?.kind === "command") return tr("terminal:batch.title", {defaultValue:"批量执行"});
  if (tab?.kind === "forward-manager") return tr("connections:forward_manager.title", {defaultValue:"转发列表"});
  if (tab?.kind === "linux-desktop") return tr("remote:linux_desktop.title", {defaultValue:"Linux 桌面管理"});
  if (tab?.kind === "remote-edit" && !Number(tab.id)) {
    const protocol = remoteServices.termaRemoteProfiles.presentation.label(tab.protocol || "rdp");
    return tr("remote:auto.add_protocol_short", {protocol, defaultValue:`添加 ${protocol}`});
  }
  if ((tab?.kind === "edit" || !tab?.kind && tab?.viewName === "edit") && !Number(tab.id)) return tr("connections:list.add_ssh", {defaultValue:"添加 SSH"});
  const quickTerminalMarker = /\s*·\s*(?:快速终端|Quick terminal)(?=\s*(?:#\d+|·|$))/i;
  const editMarker = /\s*·\s*(?:编辑|Edit)$/i;
  const forwardsMarker = /\s*·\s*(?:转发列表|Forwarding list)$/i;
  const dashboardMarker = /\s*·\s*(?:仪表盘|Dashboard)$/i;
  if (tab?.kind === "quick-terminal" && quickTerminalMarker.test(title)) {
    return title.replace(quickTerminalMarker, ` · ${tr("terminal:tabs.quick_generic", {defaultValue:"快速终端"})}`);
  }
  if (["terminal", "quick-terminal", "remote-terminal"].includes(String(tab?.kind || "")) && terminalMarker.test(title)) {
    return title.replace(terminalMarker, ` · ${tr("navigation:auto.terminal", {defaultValue:"终端"})}`);
  }
  if (["edit", "remote-edit"].includes(String(tab?.kind || "")) && editMarker.test(title)) {
    return title.replace(editMarker, ` · ${tr("common:actions.edit", {defaultValue:"编辑"})}`);
  }
  if (tab?.kind === "forwards" && forwardsMarker.test(title)) {
    return title.replace(forwardsMarker, ` · ${tr("navigation:auto.forward_list", {defaultValue:"转发列表"})}`);
  }
  if (tab?.kind === "dashboard" && dashboardMarker.test(title)) {
    const name = title.replace(dashboardMarker, "").trim();
    return tr("connections:health.dashboard_title", {name, defaultValue:`${name} · 仪表盘`});
  }
  return title;
}

export function localizedWorkspaceTabSubtitle(tab?: TabPresentation) {
  const subtitle = String(tab?.subtitle || "");
  return typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(subtitle) : subtitle;
}

export function activeWorkspaceSubtitle(tab: TabPresentation) {
  if (tab.kind === "settings" && applicationState.activeView === "settings") return settingsServices.termaSettingsNavigation.label();
  if (tab.kind === "import" && applicationState.activeView === "import") return dataExchangeServices.termaExchange.feature().label();
  return localizedWorkspaceTabSubtitle(tab);
}

export function workspaceTabConnectionStateText(status: unknown) {
  if (!status) return "";
  const normalized = status === "connected" ? "connected" : status === "disconnected" ? "disconnected" : "connecting";
  return tr(`common:auto.${normalized}`, {
    defaultValue:normalized === "connected" ? "已连接" : normalized === "disconnected" ? "已断开" : "连接中"
  });
}

function workspaceDocumentEndpoint(subtitle="") {
  const value = String(subtitle || "").trim();
  if (!value) return "";
  const resource = value.includes("·") ? value.split("·").at(-1)!.trim() : value;
  const address = resource.includes("@") ? resource.slice(resource.lastIndexOf("@") + 1) : resource;
  return address.replace(/^\w+:\/\//, "").replace(/\/$/, "");
}

function workspaceDocumentResourceIdentity(value="") {
  let identity = String(value || "").trim().toLowerCase().replace(/^\w+:\/\//, "").replace(/\/$/, "");
  if (identity.includes("@")) identity = identity.slice(identity.lastIndexOf("@") + 1);
  if (/^\[[^\]]+\](?::\d+)?$/.test(identity)) return identity.replace(/^\[|\](?::\d+)?$/g, "");
  if ((identity.match(/:/g) || []).length === 1) identity = identity.replace(/:\d+$/, "");
  return identity;
}

export function syncWorkspaceDocumentTitle(title: unknown, subtitle: unknown, viewName: unknown, key = viewName, meta: TabPresentation = {}) {
  const tab: TabPresentation = applicationState.tabs.find(item => item.key === key) || {};
  const kind = String(meta.kind || tab.kind || viewName || "");
  const protocol = String(meta.protocol || tab.protocol || "").toUpperCase();
  const label = ({
    terminal:tr("navigation:auto.terminal", {defaultValue:"终端"}),
    "remote-terminal":tr("navigation:auto.terminal", {defaultValue:"终端"}),
    sftp:"SFTP",
    ftp:"FTP",
    "forward-manager":tr("connections:forward_manager.title", {defaultValue:"转发列表"}),
    "remote-desktop":protocol || tr("remote:auto.remote_desktop", {defaultValue:"远程桌面"})
  } as Record<string, string>)[kind] || "";
  const endpoint = workspaceDocumentEndpoint(String(subtitle || tab.subtitle || ""));
  const resource = compactWorkspaceTabTitle({...tab, ...meta, kind, protocol:protocol.toLowerCase(), title:String(title || tab.title || "").trim()}).trim();
  const uniqueResource = resource
    && workspaceDocumentResourceIdentity(resource) !== workspaceDocumentResourceIdentity(endpoint)
    && resource.toLowerCase() !== label.toLowerCase()
    ? resource
    : "";
  const parts = [endpoint, label, uniqueResource, "Terma"].filter(Boolean);
  document.title = parts.join(" · ");
  const desktop = window.termaDesktop as {setWindowTitle?(title: string): void} | undefined;
  desktop?.setWindowTitle?.(document.title);
}

export const workspaceTabPresentation = {
  compact: compactWorkspaceTabTitle,
  fallback: fallbackTabPresentation,
  protocol: workspaceTabProtocol,
  title: localizedWorkspaceTabTitle,
  subtitle: localizedWorkspaceTabSubtitle,
  activeSubtitle: activeWorkspaceSubtitle,
  status: workspaceTabConnectionStateText,
  syncTitle: syncWorkspaceDocumentTitle
};
