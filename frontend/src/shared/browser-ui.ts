import {escapeHtml as esc} from './html-escape';
export function isLoopbackHost(host:unknown) {
  return ["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(String(host || "").toLowerCase());
}

export function currentPageHostForForward(bindHost:string) {
  const currentHost = location.hostname;
  if (isLoopbackHost(currentHost)) return bindHost;
  if (["0.0.0.0", "::", ""].includes(String(bindHost || ""))) return currentHost;
  return bindHost;
}

export function cssEscape(value:unknown) {
  if (typeof CSS!=="undefined" && CSS.escape) return CSS.escape(String(value??""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

export function isMobileLayout() {
  return window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)").matches;
}

export function keepTerminalKeyboardClosed(event?:Pick<Event,"preventDefault">) {
  event?.preventDefault?.();
}

export function stateView(kind:string,title:unknown,detail:unknown="",actionHtml="") {
  const type = ["loading", "error", "empty", "success"].includes(kind) ? kind : "empty";
  return `<div class="ui-state ${type}"><span class="ui-state-icon" aria-hidden="true"></span><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}${actionHtml ? `<div class="actions">${actionHtml}</div>` : ""}</div>`;
}

export function toggleCheckGroup(box:HTMLInputElement,cls:string) { (box?.closest?.(".workspace-pane") || document).querySelectorAll<HTMLInputElement>(`.${cls}-check`).forEach(x=>x.checked=box.checked); }

