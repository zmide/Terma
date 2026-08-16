const termaActions = new Map();

function registerAppAction(action) {
  if (!action?.id || typeof action.run !== "function") {
    throw new Error(tr("errors:actions.invalid_definition", {defaultValue:"动作必须提供 id 和 run"}));
  }
  termaActions.set(String(action.id), Object.freeze({...action}));
  return action;
}

function listAppActions(context={}) {
  return [...termaActions.values()].filter(action => typeof action.visible !== "function" || action.visible(context));
}

function appAction(id) {
  return termaActions.get(String(id || "")) || null;
}

function runAppAction(id, context={}) {
  const action = appAction(id);
  if (!action) throw new Error(tr("errors:actions.unknown", {id, defaultValue:`未知动作：${id}`}));
  if (typeof action.enabled === "function" && !action.enabled(context)) return false;
  return action.run(context);
}
