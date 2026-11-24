import {applicationState} from './application-state';
export function saveGroupState() {
  localStorage.setItem("openGroups", JSON.stringify([...applicationState.groupOpen]));
}

export function saveRemoteGroupState() {
  localStorage.setItem("openRemoteGroups", JSON.stringify([...applicationState.remoteGroupOpen]));
}

export function saveRunningState() {
  localStorage.setItem("openRunningGroups", JSON.stringify([...applicationState.runningOpen]));
}

export function saveLogState() {
  localStorage.setItem("openLogs", JSON.stringify([...applicationState.logOpen]));
}

