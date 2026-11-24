import {connectionsServices} from '@/features/connections/installed-services';
import {repairSshCredentials} from '@/features/connections/ssh-credential-runtime';
import {sshAuthenticationFailure} from '@/features/connections/connection-credential-model';
import { createConnectionHealthActionsService, type ConnectionHealthActionOptions } from './connection-health-actions-service';
import { createConnectionHealthBatchService } from './connection-health-batch-service';
import { bindConnectionHealthFormatting } from './connection-health-service';
import type { ConnectionViewPort } from './connection-port';

export function installConnectionHealthRuntime(port: ConnectionViewPort) {
  if (connectionsServices.termaConnectionHealthActions) return;
  const authenticationFailure = (value: unknown) => sshAuthenticationFailure(value);
  const formatting = bindConnectionHealthFormatting({
    tr: port.tr,
    localizedPhrase: port.localizedTermaUiPhrase,
    structuredExtraArgs: details => connectionsServices.termaConnectionValidationService?.formatError(details) ?? '',
  }, authenticationFailure);
  connectionsServices.termaConnectionHealthActions = createConnectionHealthActionsService(Object.assign(Object.create(port) as ConnectionViewPort, {
    authenticationFailure,
    repairSshCredentials: (id: number, options: ConnectionHealthActionOptions) => repairSshCredentials(id, options),
  }), formatting);
  connectionsServices.termaConnectionHealthBatch = createConnectionHealthBatchService({
    connections: () => port.connections,
    healthResults: port.healthResults,
    api: port.api,
    tr: port.tr,
    createProgressToast: port.createProgressToast,
    setButtonBusy: port.setButtonBusy,
    renderConnections: port.renderConnections,
    formatAllHealthMessage: results => formatting.summary(results, port.connections),
  });
}
