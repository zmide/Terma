const assert = require("node:assert/strict");
const {
  DETECT_SCRIPT,
  SSHD_CONFIG_PATH,
  buildConfigureScript,
  buildInteractiveConfigureCommand,
  parseDetectionOutput
} = require("../dist/x11-sshd-config");
const {
  BUILTIN_X11_PROBE_COMMAND,
  BUILTIN_X11_PROBE_EXEC_COMMAND,
  parseBuiltinX11ProbeOutput
} = require("../dist/ssh2-client");
const legacyPrefix = ["T", "D"].join("");

assert.equal(SSHD_CONFIG_PATH, "/etc/ssh/sshd_config");
assert.match(DETECT_SCRIPT, /sshd -T/);
assert.match(DETECT_SCRIPT, /command -v xauth/);
assert.match(DETECT_SCRIPT, /\/usr\/sbin\/sshd[\s\S]*\[ -e "\$td_candidate" \]/);
assert.match(DETECT_SCRIPT, /\/opt\/X11\/bin\/xauth/);
assert.match(DETECT_SCRIPT, /CAN_TERMINAL_MANAGE/);
assert.match(DETECT_SCRIPT, /awk 'tolower\(\$1\) == "match"/);
assert.doesNotMatch(DETECT_SCRIPT, /\\\+/);
assert.match(BUILTIN_X11_PROBE_COMMAND, /command -v xauth/);
assert.match(BUILTIN_X11_PROBE_COMMAND, /\/opt\/X11\/bin\/xauth/);
assert.match(BUILTIN_X11_PROBE_EXEC_COMMAND, /^\/bin\/sh -c '/);
const builtinProbePayload = /terma_payload=([A-Za-z0-9+/=]+);/.exec(BUILTIN_X11_PROBE_EXEC_COMMAND)?.[1] || "";
assert.equal(Buffer.from(builtinProbePayload, "base64").toString("utf8"), BUILTIN_X11_PROBE_COMMAND);

const macosSession = parseBuiltinX11ProbeOutput([
  "TERMA_X11_DISPLAY=localhost:10.0",
  "TERMA_X11_XAUTH=/opt/X11/bin/xauth"
].join("\n"));
assert.equal(macosSession.available, true);
assert.equal(macosSession.xauth_path, "/opt/X11/bin/xauth");
assert.equal(macosSession.reason, "SSH X11 转发已建立");

const missingXauthSession = parseBuiltinX11ProbeOutput([
  "TERMA_X11_DISPLAY=localhost:10.0",
  "TERMA_X11_XAUTH="
].join("\n"));
assert.equal(missingXauthSession.available, true);
assert.match(missingXauthSession.reason, /缺少 xauth/);

const legacySession = parseBuiltinX11ProbeOutput([
  `${legacyPrefix}_X11_DISPLAY=localhost:10.0`,
  `${legacyPrefix}_X11_XAUTH=/opt/X11/bin/xauth`
].join("\n"));
assert.equal(legacySession.available, true);

const detected = parseDetectionOutput([
  "TERMA_SSH_X11_PLATFORM=Darwin",
  "TERMA_SSH_X11_SSHD_PRESENT=1",
  "TERMA_SSH_X11_SSHD_PATH=/usr/sbin/sshd",
  "TERMA_SSH_X11_CONFIG_FILE=/etc/ssh/sshd_config",
  "TERMA_SSH_X11_CONFIG_PRESENT=1",
  "TERMA_SSH_X11_X11_FORWARDING=yes",
  "TERMA_SSH_X11_X11_USE_LOCALHOST=yes",
  "TERMA_SSH_X11_X11_DISPLAY_OFFSET=10",
  "TERMA_SSH_X11_XAUTH_PATH=/opt/X11/bin/xauth",
  "TERMA_SSH_X11_XAUTH_LOCATION=/opt/X11/bin/xauth",
  "TERMA_SSH_X11_XAUTH_LOCATION_VALID=1",
  "TERMA_SSH_X11_XQUARTZ_INSTALLED=1",
  "TERMA_SSH_X11_CAN_MANAGE=1",
  "TERMA_SSH_X11_CAN_TERMINAL_MANAGE=1"
].join("\n"));

assert.equal(detected.enabled, true);
assert.equal(detected.ready, true);
assert.equal(detected.x11_display_offset, "10");
assert.equal(detected.can_manage, true);
assert.equal(detected.platform, "macos");
assert.equal(detected.xquartz_installed, true);
assert.equal(detected.can_terminal_manage, true);

const legacyDetected = parseDetectionOutput([
  `${legacyPrefix}_SSH_X11_PLATFORM=Darwin`,
  `${legacyPrefix}_SSH_X11_SSHD_PRESENT=1`,
  `${legacyPrefix}_SSH_X11_CONFIG_PRESENT=1`,
  `${legacyPrefix}_SSH_X11_X11_FORWARDING=yes`,
  `${legacyPrefix}_SSH_X11_X11_USE_LOCALHOST=yes`,
  `${legacyPrefix}_SSH_X11_X11_DISPLAY_OFFSET=10`
].join("\n"));
assert.equal(legacyDetected.enabled, true);
assert.equal(legacyDetected.platform, "macos");

for (const [action, expected] of [["enable", "yes"], ["disable", "no"]]) {
  const wrapped = buildConfigureScript(action);
  const payload = /td_payload='([^']+)'/.exec(wrapped)?.[1] || "";
  const script = Buffer.from(payload, "base64").toString("utf8");
  assert.match(script, new RegExp(`Setting X11Forwarding ${expected}`));
  assert.match(script, /sshd_config\.terma\.bak/);
  assert.match(script, /sshd_config\.tunneldesk\.bak/);
  assert.match(script, /if \[ -e "\$td_legacy_backup" \]; then[\s\S]*\[ -e "\$td_terma_backup" \] \|\| cp -p "\$td_legacy_backup" "\$td_terma_backup"/);
  assert.match(script, /td_backup="\$td_terma_backup"/);
  assert.match(script, /print "X11Forwarding " value/);
  if (action === "enable") assert.match(script, /print "XAuthLocation " xauth/);
  assert.match(script, /global_scope && tolower\(\$1\) == "match"/);
  assert.match(script, /"\$td_sshd" -t -f/);
  assert.match(script, /original configuration restored/);
  assert.match(script, /systemctl reload sshd/);
  assert.match(script, /systemctl reload ssh/);
}

assert.match(buildInteractiveConfigureCommand("enable"), /sudo sh -c/);

assert.throws(() => buildConfigureScript("toggle"), /Invalid SSH X11 forwarding action/);
console.log("SSH X11 转发配置检查通过：状态解析、启停、Match 边界、校验回滚和服务重载标记正常");
