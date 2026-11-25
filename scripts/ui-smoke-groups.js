// The full local run and CI shards share one scenario inventory.
const groups = Object.freeze({
  base: ["base", "m8-efficiency", "m6-automations"],
  workspace: ["system-notification", "application-lifecycle", "ui-interaction",
    "notification-presentation", "form-controls", "ssh-host-trust", "workspace-shell"],
  terminal: ["terminal-transport", "terminal-viewport", "terminal-persistence",
    "terminal-startup", "terminal-settings", "terminal-toolbar", "terminal-image-paste"],
  files: ["tasks", "sftp-dialogs", "image-preview", "sftp-vue", "sftp-global-settings"],
  operations: ["m6-operations", "m6-running", "m6-forward-pages", "m6-batch",
    "m6-log-list", "m6-log-reader", "m6-exchange"],
  remote: ["m7-management", "m7-list", "m7-profile", "m7-x11", "m8-assistant",
    "m8-session-efficiency", "m8-snippets", "vnc-clipboard-flow", "connections", "remote-management"]
});

const offscreen = new Set([
  "m8-efficiency", "m6-automations", "system-notification", "application-lifecycle",
  "terminal-transport", "ui-interaction", "notification-presentation", "terminal-viewport",
  "form-controls", "ssh-host-trust", "terminal-startup", "m6-operations", "m6-running",
  "m6-forward-pages", "m6-batch", "m6-log-list", "m6-log-reader", "m6-exchange",
  "m7-management", "m7-list", "m7-profile", "m7-x11", "m8-assistant",
  "m8-session-efficiency", "m8-snippets", "vnc-clipboard-flow"
]);

function smokeScenarios({group = "", scenario = "", baseOnly = false} = {}) {
  if (group) {
    if (!Object.hasOwn(groups, group)) throw new Error(`Unknown UI smoke group: ${group}`);
    if (scenario) throw new Error("Select a UI smoke group or a scenario, not both");
    return [...groups[group]];
  }
  if (scenario && scenario !== "base") return [scenario];
  return baseOnly || scenario === "base" ? [...groups.base] : Object.values(groups).flat();
}

module.exports = {groups, offscreen, smokeScenarios};
