import {efficiencyServices} from '@/features/efficiency/installed-services';
export interface NotificationState {
  lastId: number;
  cursorInitialized: boolean;
  pollInFlight: boolean;
}

function notificationId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function createNotificationStateService(initialId = 0) {
  const state: NotificationState = {
    lastId: notificationId(initialId),
    cursorInitialized: false,
    pollInFlight: false
  };
  let cursorInFlight = false;

  function accept(event: { id?: number | string } | null | undefined) {
    const id = notificationId(event?.id);
    if (!id || id <= state.lastId) return false;
    state.lastId = id;
    return true;
  }

  function initialize(events: readonly { id?: number | string }[]) {
    for (const event of events) state.lastId = Math.max(state.lastId, notificationId(event?.id));
    state.cursorInitialized = true;
    return state.lastId;
  }

  function beginCursor() {
    if (state.cursorInitialized || cursorInFlight) return false;
    cursorInFlight = true;
    return true;
  }

  function finishCursor(events: readonly { id?: number | string }[]) {
    initialize(events);
    cursorInFlight = false;
  }

  function cancelCursor() { cursorInFlight = false; }

  function beginPoll() {
    if (state.pollInFlight) return false;
    state.pollInFlight = true;
    return true;
  }

  function endPoll() { state.pollInFlight = false; }

  return { state, accept, initialize, beginCursor, finishCursor, cancelCursor, beginPoll, endPoll };
}

export function installNotificationStateService() {
  if (!efficiencyServices.termaNotificationState) {
    const stored = Number(localStorage.getItem('lastNotificationId') || 0);
    efficiencyServices.termaNotificationState = createNotificationStateService(stored);
  }
}



export interface InstalledFeaturesEfficiencyNotificationStateServiceServices {
  termaNotificationState?: ReturnType<typeof createNotificationStateService>;
}
