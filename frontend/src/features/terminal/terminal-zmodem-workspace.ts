import {terminalServices} from '@/features/terminal/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {tr,registerTermaI18nRenderer} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import {api} from '@/shared/api/workspace-request';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {currentTerminalPromptCommand} from '@/features/terminal/terminal-prompt';
import {loadRuntimeScript} from '../../shared/runtime-script-loader';
import { chooseModal } from '@/shared/workspace-prompts';
import { installTerminalZmodemService } from './terminal-zmodem-service';
import type { ZmodemLibrary, ZmodemRuntimePort, ZmodemRuntimeSession } from './terminal-zmodem-types';
import type { TerminalOutputFlowSession } from './terminal-output-flow-service';

export function installTerminalZmodemWorkspace() {
  installTerminalZmodemService({
    library: () => window.Zmodem || null,
    loadScript: loadRuntimeScript,
    tr: (key, options) => tr(key, options),
    output: (session, value) => {
      const owner = session.key ? terminalSessions.get(session.key) : undefined;
      if (owner === session) terminalServices.termaTerminalOutputFlow!.queue(owner, value);
    },
    notify: (message, level) => notify(message, level),
    promptCommand: session => currentTerminalPromptCommand(session),
    broadcastCount: () => sessionEfficiencyServices.termaTerminalBroadcastWorkspace?.keys().length ?? 0,
    focus: key => focusTerminalSession(key),
    current: session => !session.key || terminalSessions.get(session.key) === session,
    render: (session, view) => Boolean(terminalServices.termaTerminalZmodemView?.render(session, view)),
    releaseView: session => terminalServices.termaTerminalZmodemView?.release(session),
    uploadPlan: (id, directory, names) => api(`/api/connections/${id}/sftp/upload-plan`, {
      method: 'POST', body: JSON.stringify({path: directory, filenames: names})
    }),
    conflict: items => filesServices.termaSftpTransfers.conflicts.upload(items),
    choose: async (title, detail, actions) => await chooseModal(title, detail, actions) ?? ''
  });
  registerTermaI18nRenderer?.(() => terminalServices.termaTerminalZmodem.localize());
}

declare global {
  interface Window {
    Zmodem?: ZmodemLibrary;
  }
}
