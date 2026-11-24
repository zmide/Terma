import { createBrowserDragRuntime, type BrowserDrag, type FileDragEvent } from './browser-drag-runtime';
import { createDragDestinations } from './drag-destinations';
import { createDragFeedback, createDragVisuals } from './drag-feedback';
import { hasInternalPayload } from './drag-payload';
import { createDragPreview } from './drag-preview';
import { createDragSource, nativeDragRequestIsActive } from './drag-source';
import { createNativeDragAdapter, createNativeDragPresentation, stageNativeDrag } from './native-drag-adapter';
import { createNativeDragPointer } from './native-drag-pointer';
import { createNativeDragRuntime, type NativeDragRequest } from './native-drag-runtime';
import { createNativeDragTarget } from './native-drag-target';
import { createSftpDragFeedbackView } from './SftpDragFeedbackView';

type SourcePort = Parameters<typeof createDragSource>[0];
type PreviewPort = Parameters<typeof createDragPreview>[0];
type BrowserPort = Parameters<typeof createBrowserDragRuntime>[0];
type DestinationPort = Parameters<typeof createDragDestinations>[0];
type AdapterPort = Parameters<typeof createNativeDragAdapter>[0];
type TargetPort = Parameters<typeof createNativeDragTarget>[0];
type NativePort = Parameters<typeof createNativeDragRuntime>[0];
type FeedbackPort = Parameters<typeof createSftpDragFeedbackView>[0];
type VisualPort = Parameters<typeof createDragVisuals>[0];

interface SftpDragPort extends Pick<SourcePort, 'state' | 'selected' | 'select' | 'tab'>,
  Pick<PreviewPort, 'active' | 'activate' | 'view' | 'terminalKey' | 'text'>,
  Pick<BrowserPort, 'mobile' | 'notify' | 'path' | 'external'>,
  Pick<DestinationPort, 'localPayload' | 'localUpload' | 'terminalUpload' | 'localCopy' | 'session' | 'initializeTerminal' | 'copy'>,
  Pick<TargetPort, 'tabs' | 'localState' | 'localRoot' | 'sessions' | 'terminalState' | 'terminalLabel'>,
  Pick<NativePort, 'refresh' | 'startTimer' | 'target' | 'clearTerminal'>,
  Pick<AdapterPort, 'bridge' | 'stage'>, Pick<FeedbackPort, 'host'>, Pick<VisualPort, 'cancelLeave' | 'clearTerminals'> {
  sourceState: SourcePort["state"];
  sourceKey(node: EventTarget | null | undefined, fallback?: string): string;
}

/** Coordinates renderer and desktop drag behavior for the whole workspace. */
export function createSftpDragRuntime(port: SftpDragPort) {
  const { active, text, notify, external } = port;
  const dragCache: AdapterPort['cache'] = new Map();
  const state = {
    internal: null as BrowserDrag | null,
    preparing: null as symbol | null,
    depth: 0,
    requests: new Map<string, NativeDragRequest>(),
    armed: new Set<string>(),
    cache: dragCache
  };
  const { requests, armed, cache } = state;
  const feedbackView = createSftpDragFeedbackView({ host: port.host, text });
  const hint: typeof feedbackView.showHint = (message, target, action, key = active()) =>
    feedbackView.showHint(message, target, action, key);
  const source = createDragSource({
    state: port.sourceState, selected: port.selected, select: port.select, tab: port.tab,
    internal: () => state.internal, requests: () => requests.values(), expired: () => external(false, {})
  });
  const adapter = createNativeDragAdapter({ bridge: port.bridge, stage: port.stage, cache, armed, ttl: 9 * 60 * 1000 });
  const presentation = createNativeDragPresentation({ bridge: port.bridge, mode: adapter.mode, text, notify: message => notify(message, 'info') });
  const preview = createDragPreview({
    active, tabs: port.tabs, payload: source.active, activate: port.activate,
    view: port.view, terminalKey: port.terminalKey, hint, text
  });
  const visuals = createDragVisuals({
    cancelLeave: port.cancelLeave, clearTabPreview: preview.clear, resetDropDepth: () => { state.depth = 0; },
    clearExternalDrop: () => external(false, {}), removePointerPreview: feedbackView.removePreview, clearTerminals: port.clearTerminals
  });
  const feedback = createDragFeedback({
    drag: () => state.internal, visible: visuals.visible, clearVisuals: visuals.clear, restore: preview.restore,
    nativeActive: () => [...requests.values()].some(request => nativeDragRequestIsActive(request)),
    reset: row => browser.reset(row instanceof HTMLElement ? row : null)
  });
  const stage = (id: number, entries: Parameters<typeof stageNativeDrag>[2]) => stageNativeDrag(adapter, id, entries, text);
  const pointer: ReturnType<typeof createNativeDragPointer> = createNativeDragPointer({
    mobile: port.mobile, mode: adapter.mode, timing: adapter.timing, entries: source.entries,
    start: (row, id, entries, sourceTabKey): string => native.start(row, id, entries, null, 'streaming', { armed: true, sourceTabKey }),
    activated(id) { const request = requests.get(id); if (request) request.activated = true; },
    cancel(id) {
      const request = requests.get(id);
      if (request) { request.released = true; request.cancelled = true; requests.delete(id); }
      adapter.cancel(id);
    },
    activate: adapter.activate, stage, clear: visuals.clear, hint: key => hint(presentation.sourceHint(), false, '', key),
    preview: feedbackView.showPreview, error: error => notify(error instanceof Error ? error.message : text('sftp:drag.prepare_failed'), 'error')
  });
  const select = (path: string, name: string, type: string, key = active()) => source.entries(path, name, type, key, true);
  const browser: ReturnType<typeof createBrowserDragRuntime> = createBrowserDragRuntime({
    drag: () => state.internal, setDrag: drag => { state.internal = drag; },
    preparing: () => state.preparing, setPreparing: value => { state.preparing = value; },
    requests, armed, nativeActive: nativeDragRequestIsActive, mode: adapter.mode, mobile: port.mobile,
    preview: () => preview, pointer: () => pointer, select, cache: adapter.cached, stage,
    start: (row, id, entries, cached, mode, sourceTabKey) => native.start(row, id, entries, cached, mode, { sourceTabKey }),
    clearHandoff: source.handoff.clear, remember: source.handoff.remember, clearVisuals: visuals.clear,
    fallback: presentation.reportFallback, sourceHint: presentation.sourceHint, text, hint, notify, active,
    tab: port.tab, path: port.path, depth: () => state.depth, external, hasInternal: hasInternalPayload
  });
  const target = createNativeDragTarget({
    tabs: port.tabs, active, sourceKey: port.sourceKey, state: port.state, localState: port.localState,
    localRoot: port.localRoot, sessions: port.sessions, terminalState: port.terminalState, terminalLabel: port.terminalLabel,
    send: (id, hit, final) => adapter.target(id, hit ? { ...hit } : null, final), preview: preview.preview, clearPreview: preview.clear, external, hint, sourceHint: presentation.sourceHint, text
  });
  const destinations = createDragDestinations({
    tab: port.tab, active, activate: port.activate, localPayload: port.localPayload, payload: source.active,
    preview: () => preview, inside: browser.inside, hint, text, notify,
    prepareClear: () => { state.preparing = null; }, finish: browser.finishPayload,
    localUpload: port.localUpload, terminalUpload: port.terminalUpload, localCopy: port.localCopy,
    session: port.session, initializeTerminal: port.initializeTerminal, path: port.path, requests,
    nativeTarget: (id, request, tab) => target.update(id, request, { ...tab }, true),
    copy: port.copy, hintNode: feedbackView.hint, removeHint: feedbackView.removeHint
  });
  const native: ReturnType<typeof createNativeDragRuntime> = createNativeDragRuntime({
    requests, armed, cache, adapter: () => adapter, sourceKey: port.sourceKey, internal: () => state.internal,
    clearInternal: browser.detach, clearVisuals: visuals.clear, hint: key => hint(presentation.sourceHint, false, '', key),
    activity: feedback.activity, preview: (entries, x, y) => feedbackView.showPreview(entries, Number(x), Number(y)),
    move: feedbackView.movePreview, pointer: () => pointer, hit: (id, request, x, y, final) => target.hit(id, request, x, y, { final }),
    refresh: port.refresh, startTimer: port.startTimer, target: port.target, clearTerminal: port.clearTerminal,
    local: port.localCopy, remote: async (request, tab) => destinations.remote(request, tab),
    terminal(request, id, path, title, key) {
      const session = port.session(key);
      return destinations.directory(request, id, path, {
        title, tabKey: key, valid: () => Boolean(session && port.session(key) === session && session.connected && session.currentDirectory === path)
      });
    }, text, notify
  });

  function begin(event: FileDragEvent, id: number, path: string, name: string, type: string, key = port.sourceKey(event.currentTarget)) {
    return browser.begin(event, Number(id), path, name, type, key);
  }
  function prime(event: Parameters<typeof pointer.prime>[0], id: number, path: string, name: string, type: string, key = port.sourceKey(event.currentTarget)) {
    return pointer.prime(event, Number(id), String(path || ''), String(name || ''), String(type || 'file'), String(key || ''));
  }
  return {
    state, source, preview, browser, destinations, native, target, pointer, feedback, visuals, feedbackView,
    mode: adapter.mode, sourceHint: presentation.sourceHint, hint, select, begin, prime,
    crossTarget: (drag = source.active(), key = active()) => source.crossTarget(drag, key), nativeRequestIsActive: nativeDragRequestIsActive
  };
}
