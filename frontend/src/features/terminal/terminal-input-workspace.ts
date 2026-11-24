import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {copyText} from '@/shared/clipboard-service';
import {notify} from '@/features/efficiency/notification-actions';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {focusTerminalSession,showTerminalContextMenu,changeTerminalFont} from '@/features/terminal/terminal-page';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {captureTerminalSessionInput} from './terminal-input-target';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { createTerminalClipboardService } from './terminal-clipboard-service';
import { createTerminalCursorCopyMount } from './terminal-cursor-copy-mount';
import { createTerminalInteractionService, type TerminalInteractionPort, type TerminalInteractionSession } from './terminal-interaction-service';

export function installTerminalInputWorkspace() {
  const settings = terminalServices.termaTerminalSettings;
  if (!settings || terminalServices.termaTerminalInteraction) return;
  const isForeground = (key: string) => applicationState.activeTabKey === key && $('modal')?.hidden !== false;
  const restoreFocus = (key: string) => { if (isForeground(key)) focusTerminalSession(key); };
  const imageAvailable = () => typeof (window.termaDesktop as {readClipboardImage?: unknown} | undefined)?.readClipboardImage === 'function';
  const clipboard = terminalServices.termaTerminalClipboard = createTerminalClipboardService({
    settings: settings.current,
    capture(key) {
      const owner = captureTerminalSessionInput(key);
      return {
        isCurrent: owner.isCurrent,
        send: data => sendTerminalData(key, data, {trackCommand: true, focus: isForeground(key) ? undefined : false}),
        focus: () => restoreFocus(key)
      };
    },
    selection(key) {
      const session = terminalSessions.get(key);
      return session ? (session.term.hasSelection?.() ? session.term.getSelection() : '') : null;
    },
    copy: text => copyText(text),
    async readText() {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
      return navigator.clipboard.readText();
    },
    imageAvailable,
    pasteImage: async key => terminalServices.termaTerminalImagePaste?.handleImage(key),
    prompt: options => terminalServices.termaTerminalViews?.promptPaste(options),
    notify: (message, type) => notify(message, type), tr: (key, params) => tr(key, params)
  });
  const cursorCopy = terminalServices.termaTerminalCursorCopy = createTerminalCursorCopyMount({
    session: key => terminalSessions.get(key),
    mount: (key, session) => session.term.element?.closest('.terminal-box') || terminalServices.termaTerminalSurface?.element(key, '#terminalMount') || null,
    capture: key => captureTerminalSessionInput(key), focus: restoreFocus, mobile: () => isMobileLayout(),
    copy: text => copyText(text), format: clipboard.format, tr: key => tr(key),
    notify: (message, type) => notify(message, type)
  });
  terminalServices.termaTerminalInteraction = createTerminalInteractionService({
    settings: settings.current,
    current: session => [...terminalSessions.values()].some(current=>current===session),
    tab: key => workspaceTabByKey(key) ?? undefined, apply: settings.apply, mobile: () => isMobileLayout(),
    open: url => { window.open(url, '_blank', 'noopener'); }, send: (key, text) => sendTerminalData(key, text),
    focus: key => focusTerminalSession(key), format: clipboard.format,
    async autoCopy(text) {
      // Selection copying is optional when browser clipboard permission is unavailable.
      try { await navigator.clipboard?.writeText(text); } catch { return; }
    },
    paste: clipboard.paste, pasteText: clipboard.send, contextMenu: (event, key, id) => showTerminalContextMenu(event, key, id),
    showSettings: settings.open,
    image: event => terminalServices.termaTerminalImagePaste?.imageFromPasteEvent(event) || null,
    mayContainImage: (event, file) => Boolean(terminalServices.termaTerminalImagePaste?.mayContainImage(event, file, imageAvailable())),
    pasteImage: (key, id, file) => terminalServices.termaTerminalImagePaste?.handleImage(key, id, file),
    cancelCopy: (session, key, focus) => cursorCopy.cancel(session, key, true, focus),
    flushViewportFit: session => terminalViewport.flushSession(session),
    scheduleViewportTask: callback => terminalViewport.scheduleTask(callback), cancelViewportTask: task => terminalViewport.cancelTask(task),
    changeFont: (key, delta) => changeTerminalFont(key, delta)
  });
}
