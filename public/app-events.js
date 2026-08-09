const termaActionHandlers = new Map();

function registerTermaAction(name, handler) {
  const key = String(name || "").trim();
  if (!key) throw new Error("事件委托 action 名称不能为空");
  if (typeof handler !== "function") throw new Error(`事件委托 ${key} 缺少处理函数`);
  if (termaActionHandlers.has(key)) throw new Error(`事件委托 action 重复注册：${key}`);
  termaActionHandlers.set(key, handler);
}

function delegatedActionElement(event, attribute) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const element = target.closest(`[${attribute}]`);
  if (!element || !document.documentElement.contains(element)) return null;
  return element;
}

function dispatchTermaAction(event, attribute) {
  const element = delegatedActionElement(event, attribute);
  if (!element) return;
  const action = String(element.getAttribute(attribute) || "").trim();
  const handler = termaActionHandlers.get(action);
  if (!handler) {
    console.error(`未注册的 Terma 界面 action：${action}`);
    return;
  }
  try {
    const result = handler({ event, element, action, dataset:element.dataset });
    if (event.cancelBubble) event.stopImmediatePropagation();
    Promise.resolve(result).catch(error => {
      if (typeof notify === "function") notify(error?.message || String(error), "error");
      else console.error(error);
    });
  } catch (error) {
    if (typeof notify === "function") notify(error?.message || String(error), "error");
    else console.error(error);
  }
}

document.addEventListener("click", event => dispatchTermaAction(event, "data-action"));
document.addEventListener("change", event => dispatchTermaAction(event, "data-change-action"));
document.addEventListener("input", event => dispatchTermaAction(event, "data-input-action"));
document.addEventListener("dblclick", event => dispatchTermaAction(event, "data-dblclick-action"));
document.addEventListener("contextmenu", event => dispatchTermaAction(event, "data-contextmenu-action"));
document.addEventListener("pointerdown", event => dispatchTermaAction(event, "data-pointerdown-action"));
document.addEventListener("keydown", event => dispatchTermaAction(event, "data-keydown-action"));
document.addEventListener("submit", event => dispatchTermaAction(event, "data-submit-action"));
document.addEventListener("dragstart", event => dispatchTermaAction(event, "data-dragstart-action"));
document.addEventListener("dragover", event => dispatchTermaAction(event, "data-dragover-action"));
document.addEventListener("dragleave", event => dispatchTermaAction(event, "data-dragleave-action"));
document.addEventListener("drop", event => dispatchTermaAction(event, "data-drop-action"));
document.addEventListener("dragend", event => dispatchTermaAction(event, "data-dragend-action"));

window.TermaEvents = Object.freeze({
  register:registerTermaAction,
  registeredActions:() => [...termaActionHandlers.keys()].sort()
});
