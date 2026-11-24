import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';
import type { ConnectionCredentialIdentity } from './ConnectionCredentialDialog';

export type ConnectionFormActionsService = {
  rememberIdentityOptions(select: HTMLSelectElement, identities: ConnectionCredentialIdentity[]): void;
  refreshIdentityOptions(form: HTMLFormElement): void;
  refreshKeys(form: HTMLFormElement, path?: string): Promise<void>;
  upload(form: HTMLFormElement): Promise<unknown>;
  renderKeyStatus(form: HTMLFormElement): Promise<void>;
  repairKey(form: HTMLFormElement): Promise<unknown>;
  test(form: HTMLFormElement, button?: HTMLElement | null): Promise<unknown>;
};

function field(port: ConnectionViewPort, form: HTMLFormElement, id: string): any {
  return port.field(form, id);
}

export function createConnectionFormActionsService(port: ConnectionViewPort): ConnectionFormActionsService {
  const identityOptions = new WeakMap<HTMLSelectElement, Map<string, ConnectionCredentialIdentity>>();

  function rememberIdentityOptions(select: HTMLSelectElement, identities: ConnectionCredentialIdentity[]) {
    identityOptions.set(select, new Map(identities.map(identity => [String(identity.path || ''), identity])));
  }

  function refreshIdentityOptions(form: HTMLFormElement) {
    const select = field(port, form, 'conn_key') as HTMLSelectElement | null;
    if (!select) return;
    const identities = identityOptions.get(select);
    for (const option of select.options) {
      const key = option.dataset.i18n;
      if (key) {
        option.textContent = port.tr(key);
        continue;
      }
      const identity = identities?.get(option.value);
      if (identity) option.textContent = port.localizedIdentityFileLabel(identity, {permission: true});
    }
    if (select.selectedOptions[0]?.dataset.legacyUnsafe === '1') {
      const status = field(port, form, 'keyStatus');
      if (status) status.textContent = port.connectionFormIdentityWarning(form) || port.connectionIdentityUnsafeFallback();
    } else if (!select.value) {
      void renderKeyStatus(form);
    }
  }

  async function refreshKeys(form: HTMLFormElement, path?: string) {
    const select = field(port, form, 'conn_key') as HTMLSelectElement | null;
    if (select) await port.loadKeys(path, select);
  }

  async function upload(form: HTMLFormElement) {
    const input = field(port, form, 'key_upload') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      port.notify(port.tr('connections:form.select_key_file', {defaultValue: '请选择密钥文件'}), 'error');
      return null;
    }
    const data = await port.uploadOneKey(file);
    await refreshKeys(form, data.path);
    form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0) + 1;
    port.markConnectionTerminalDetectionStale(form);
    port.notify(port.tr('connections:form.key_uploaded', {defaultValue: '密钥已上传'}), 'success');
    return data;
  }

  async function renderKeyStatus(form: HTMLFormElement) {
    const select = field(port, form, 'conn_key') as HTMLSelectElement | null;
    const box = field(port, form, 'keyStatus') as HTMLElement | null;
    if (!box) return;
    if (select?.selectedOptions?.[0]?.dataset.legacyUnsafe === '1') {
      box.textContent = port.connectionFormIdentityWarning(form) || port.connectionIdentityUnsafeFallback();
      box.className = 'key-status warning';
      return;
    }
    const key = select?.value || '';
    if (!key) {
      port.setConnectionLocalizedText(box, 'connections:auto.no_private_key_selected', {defaultValue: '未选择私钥'});
      box.className = 'key-status muted';
      return;
    }
    try {
      const status = await port.api('/api/identity-files/check', {method: 'POST', body: JSON.stringify({path: key})});
      box.textContent = status.ok
        ? port.tr('connections:form.permission_ok', {detail: status.label, defaultValue: `权限正常：${status.label}`})
        : port.tr('connections:form.permission_repair_needed', {detail: status.details, defaultValue: `需要修复权限：${status.details}`});
      box.className = `key-status ${status.ok ? 'success' : 'error'}`;
    } catch (error) {
      box.textContent = port.localizedTermaUiPhrase(error instanceof Error ? error.message : String(error));
      box.className = 'key-status error';
    }
  }

  async function repairKey(form: HTMLFormElement) {
    const select = field(port, form, 'conn_key') as HTMLSelectElement | null;
    const key = select?.value || '';
    if (!key) {
      port.notify(port.tr('connections:form.select_key_first', {defaultValue: '请先选择私钥'}), 'info');
      return null;
    }
    try {
      const status = await port.api('/api/identity-files/repair', {method: 'POST', body: JSON.stringify({path: key})});
      await refreshKeys(form, key);
      port.notify(status.ok
        ? port.tr('connections:form.permission_repaired', {defaultValue: '私钥权限已修复'})
        : port.tr('connections:form.permission_repair_attempted', {detail: status.details, defaultValue: `已尝试修复：${status.details}`}), status.ok ? 'success' : 'error');
      return status;
    } catch (error) {
      port.notify(port.localizedTermaUiPhrase(error instanceof Error ? error.message : String(error)), 'error');
      return null;
    }
  }

  async function test(form: HTMLFormElement, button: HTMLElement | null = null) {
    if (!await port.ensureConnectionExtraArgsValid(form)) return null;
    const status = field(port, form, 'connTestStatus') as HTMLElement | null;
    const detectionStatus = field(port, form, 'connTerminalDetectionStatus') as HTMLElement | null;
    const startRevision = Number(form._terminalCredentialRevision || 0);
    port.setButtonBusy(button, true, port.tr('connections:form.testing', {defaultValue: '测试中...'}));
    if (status) {
      status.hidden = false;
      status.className = 'connection-test-status busy';
      port.setConnectionLocalizedText(status, 'connections:form.testing_wait', {defaultValue: '正在测试 SSH 连接，请稍候...'});
    }
    if (detectionStatus) {
      detectionStatus.className = 'terminal-startup-detection busy';
      port.setConnectionLocalizedText(detectionStatus, 'connections:form.detecting_environment', {defaultValue: '正在连接并检测远端平台、默认 Shell 和可用程序...'});
    }
    port.notify(port.tr('connections:form.testing_wait', {defaultValue: '正在测试 SSH 连接，请稍候...'}), 'info');
    try {
      const payload = {...port.connectionPayload(form), discover_terminal: true};
      const result = await port.api('/api/test-ssh', {method: 'POST', body: JSON.stringify(payload)});
      const message = result.ok
        ? port.tr('connections:form.test_success', {elapsed: result.elapsed_ms, defaultValue: `SSH 测试成功，用时 ${result.elapsed_ms}ms`})
        : port.tr('connections:form.test_failed', {error: result.output || result.error || port.tr('connections:form.check_connection', {defaultValue: '请检查连接信息'}), defaultValue: `SSH 测试失败：${result.output || result.error || '请检查连接信息'}`});
      if (status) {
        status.className = `connection-test-status ${result.ok ? 'success' : 'error'}`;
        status.textContent = message;
      }
      if (result.ok && Number(form._terminalCredentialRevision || 0) !== startRevision) {
        form._terminalCapabilitiesChecked = true;
        form._terminalProbeStale = true;
        field(port, form, 'connTerminalCapabilities')?.classList.add('is-stale');
        if (detectionStatus) {
          detectionStatus.className = 'terminal-startup-detection stale';
          port.setConnectionLocalizedText(detectionStatus, 'connections:form.test_changed', {defaultValue: '测试期间连接信息发生了变化，本次检测结果未应用。请重新测试 SSH。'});
        }
      } else if (result.ok) {
        const rawCapabilities = result.capabilities || result.terminal_capabilities || result.discovery;
        form._terminalCapabilitiesChecked = true;
        form._terminalProbeStale = false;
        if (rawCapabilities && typeof rawCapabilities === 'object') {
          const capabilities = port.renderConnectionTerminalProfiles(form, rawCapabilities);
          if (detectionStatus) {
            const defaultShell = capabilities.default_shell?.label || capabilities.default_shell?.path || port.tr('connections:form.unidentified', {defaultValue: '未识别'});
            detectionStatus.className = 'terminal-startup-detection success';
            port.setConnectionLocalizedText(detectionStatus, 'connections:form.detection_complete', {
              platform: capabilities.platform_label,
              shell: defaultShell,
              count: capabilities.profiles.length,
              defaultValue: `检测完成：${capabilities.platform_label}，默认 Shell 为 ${defaultShell}，可快速选择 ${capabilities.profiles.length} 个启动配置。`
            });
          }
        } else if (detectionStatus) {
          form._terminalCapabilities = null;
          port.resetConnectionTerminalProfileSelect(form, true);
          const summary = field(port, form, 'connTerminalCapabilities');
          if (summary) {
            summary.hidden = true;
            summary.className = 'terminal-startup-capabilities';
            summary.replaceChildren();
          }
          detectionStatus.className = 'terminal-startup-detection warning';
          port.setConnectionLocalizedText(detectionStatus, 'connections:form.environment_unavailable', {defaultValue: 'SSH 连接正常，但未能读取远端启动环境。仍可使用默认 Shell 或手动填写程序路径。'});
        }
      } else if (detectionStatus) {
        detectionStatus.className = 'terminal-startup-detection error';
        port.setConnectionLocalizedText(detectionStatus, 'connections:form.startup_not_updated', {defaultValue: 'SSH 测试失败，未更新终端启动选项。'});
      }
      port.notify(message, result.ok ? 'success' : 'error');
      return result;
    } catch (error: any) {
      if (Array.isArray(error?.details?.issues)) port.renderConnectionExtraArgsDiagnostics(form, error.details.issues);
      const message = port.tr('connections:form.test_unable', {error: error?.message || String(error), defaultValue: `SSH 测试无法完成：${error?.message || String(error)}`});
      if (status) {
        status.className = 'connection-test-status error';
        status.textContent = message;
      }
      if (detectionStatus) {
        detectionStatus.className = 'terminal-startup-detection error';
        port.setConnectionLocalizedText(detectionStatus, 'connections:form.detection_failed', {defaultValue: '无法检测远端启动环境，请检查连接信息后重试。'});
      }
      port.notify(message, 'error');
      return null;
    } finally {
      port.updateConnectionAdvancedStatus(form);
      port.setButtonBusy(button, false);
    }
  }

  return {rememberIdentityOptions, refreshIdentityOptions, refreshKeys, upload, renderKeyStatus, repairKey, test};
}

export function installConnectionFormActionsService(port: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionFormActions) {
    connectionsServices.termaConnectionFormActions = createConnectionFormActionsService(port);
  }
}



export interface InstalledFeaturesConnectionsConnectionFormActionsServiceServices {
  termaConnectionFormActions?: ConnectionFormActionsService;
}
