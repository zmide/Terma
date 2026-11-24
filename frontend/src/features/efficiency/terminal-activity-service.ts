import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import { workspaceTabByKey, workspaceVisiblePanes } from '@/features/workspace/workspace-dock-state';
import type { TerminalSurfaceSession } from '../terminal/terminal-surface-service';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';

export interface TerminalActivityRecord {
  tail: string;
  sensitiveInput: boolean;
  decoder?: TextDecoder;
}

export function createTerminalActivityService() {
  const records = new Map<string, TerminalActivityRecord>();
  const sensitivePattern = /(?:password|passphrase|口令|密码)\s*[:：]?\s*$/i;
  function recordFor(key: string) {
    const id = String(key || '');
    let record = records.get(id);
    if (!record) { record = {tail: '', sensitiveInput: false}; records.set(id, record); }
    return record;
  }
  function observe(key: string, chunk: string | Uint8Array | ArrayBuffer) {
    const record = recordFor(key);
    let text = typeof chunk === 'string' ? chunk : '';
    let hasOutput = text.length > 0;
    const bytes = chunk instanceof Uint8Array ? chunk : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : null;
    if (bytes) {
      hasOutput = bytes.byteLength > 0;
      if (hasOutput) {
        try { record.decoder ||= new TextDecoder('utf-8', {fatal: false}); text = record.decoder.decode(bytes, {stream: true}); } catch { text = ''; }
      }
    }
    record.tail = `${record.tail}${text}`.slice(-500);
    record.sensitiveInput = sensitivePattern.test(record.tail);
    return {text, hasOutput, tail: record.tail, sensitiveInput: record.sensitiveInput};
  }
  function isSensitive(key: string) { return records.get(String(key || ''))?.sensitiveInput === true; }
  function tail(key: string) { return records.get(String(key || ''))?.tail || ''; }
  function markViewed(key: string) { return String(key || ''); }
  function clear(key: string) { records.delete(String(key || '')); }
  function clearAll() { records.clear(); }
  return {records, observe, isSensitive, tail, markViewed, clear, clearAll};
}

export function installTerminalActivityService() {
  if (efficiencyServices.termaTerminalActivity) return;
  const activity = createTerminalActivityService();
  function updateWorkspace(key: string, chunk: Parameters<typeof activity.observe>[1]) {
    const session = terminalSessions.get(key);
    if (!session) return;
    const analyzed = activity.observe(key, chunk);
    session.sensitiveInput = analyzed.sensitiveInput;
    if (!analyzed.hasOutput || workspaceVisiblePanes().some(pane => pane.activeTabKey === key)) return;
    const tab = workspaceTabByKey(key);
    if (!tab || tab.activityState === 'output') return;
    tab.activityState = 'output';
    sessionEfficiencyServices.termaTerminalBroadcastWorkspace?.renderTabsPreservingFocus();
  }
  efficiencyServices.termaTerminalActivity = {...activity, updateWorkspace};
}

type WorkspaceActivity = ReturnType<typeof createTerminalActivityService> & {
  updateWorkspace(key: string, chunk: Parameters<ReturnType<typeof createTerminalActivityService>['observe']>[1]): void;
};


export interface InstalledFeaturesEfficiencyTerminalActivityServiceServices {
  termaTerminalActivity?: WorkspaceActivity;
}
