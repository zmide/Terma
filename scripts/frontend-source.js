const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DOMAINS = Object.freeze({
  docking: [
    "app-workspace-groups.js",
    "app-workspace-chrome.js",
    "app-docking.js",
    "app-workspace-drag.js",
    "app-workspace-persistence.js"
  ],
  settings: [
    "app-settings-core.js",
    "app-theme-settings.js",
    "app-settings-cache.js",
    "app-settings-storage.js",
    "app-settings-runtime.js",
    "app-settings-integrations.js",
    "app-settings.js",
    "app-settings-updates.js",
    "app-settings-security.js"
  ],
  logs: ["app-logs.js", "app-log-viewer.js", "app-log-maintenance.js"],
  connections: [
    "app-connections-list.js",
    "app-connection-terminal.js",
    "app-connection-validation.js",
    "app-connection-form.js",
    "app-connection-health.js",
    "app-connections.js",
    "app-quick-connect.js"
  ],
  terminal: [
    "app-terminal-core.js",
    "app-terminal-output.js",
    "app-terminal-zmodem.js",
    "app-terminal-settings.js",
    "app-terminal-startup.js",
    "app-terminal-ai-render.js",
    "app-terminal-ai-mcp.js",
    "app-terminal-ai-layout.js",
    "app-terminal-ai.js",
    "app-terminal-ai-actions.js",
    "app-terminal-ai-tasks.js",
    "app-terminal.js",
    "app-terminal-command-tracking.js",
    "app-ssh-credentials.js",
    "app-terminal-image-paste.js"
  ],
  sftp: [
    "app-sftp-core.js",
    "app-sftp-columns.js",
    "app-sftp-diff.js",
    "app-sftp-open.js",
    "app-sftp.js",
    "app-sftp-editor.js",
    "app-sftp-preview.js",
    "app-sftp-generated-tasks.js",
    "app-sftp-drag-payload.js",
    "app-sftp-drag.js",
    "app-sftp-operations.js",
    "app-sftp-transfer.js",
    "app-sftp-menus.js",
    "app-sftp-tasks.js"
  ],
  productivity: [
    "app-sftp-sync.js",
    "app-external-tools.js",
    "app-command-palette.js",
    "app-command-snippets.js",
    "app-terminal-quick-commands.js",
    "app-named-workspaces.js",
    "app-terminal-productivity.js",
    "app-productivity.js"
  ],
  remote: [
    "app-desktop-integration.js",
    "app-remote.js",
    "app-linux-desktop.js",
    "app-remote-profiles.js",
    "app-remote-rdp.js",
    "app-remote-xdmcp.js",
    "app-vnc-core.js",
    "app-vnc-clipboard.js",
    "app-vnc-management.js",
    "app-vnc.js",
    "app-vnc-window.js",
    "app-remote-credentials.js",
    "app-remote-ftp.js",
    "app-remote-terminal.js",
    "app-x11.js"
  ]
});

function indexScriptFiles(root, options = {}) {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const files = [...html.matchAll(/<script\s+src="\/([^"?]+\.js)(?:\?[^"#]*)?"/g)]
    .map(match => match[1])
    .filter(file => !file.startsWith("vendor/"));
  return files
    .filter(file => options.includeBootstrap || file !== "csp-bootstrap.js")
    .map(file => path.posix.join("public", file));
}

function readFrontendFiles(root, files) {
  return files.map(file => fs.readFileSync(path.join(root, "public", file), "utf8")).join("\n");
}

function readFrontendDomain(root, domain) {
  const files = FRONTEND_DOMAINS[domain];
  if (!files) throw new Error(`未知前端领域：${domain}`);
  return readFrontendFiles(root, files);
}

module.exports = {
  FRONTEND_DOMAINS,
  indexScriptFiles,
  readFrontendDomain,
  readFrontendFiles
};
