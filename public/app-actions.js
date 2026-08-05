const tunnelDeskActions = new Map();

function registerAppAction(action) {
  if (!action?.id || typeof action.run !== "function") throw new Error("动作必须提供 id 和 run");
  tunnelDeskActions.set(String(action.id), Object.freeze({...action}));
  return action;
}

function listAppActions(context={}) {
  return [...tunnelDeskActions.values()].filter(action => typeof action.visible !== "function" || action.visible(context));
}

function appAction(id) {
  return tunnelDeskActions.get(String(id || "")) || null;
}

function runAppAction(id, context={}) {
  const action = appAction(id);
  if (!action) throw new Error(`未知动作：${id}`);
  if (typeof action.enabled === "function" && !action.enabled(context)) return false;
  return action.run(context);
}
