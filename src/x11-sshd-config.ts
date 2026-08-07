const SSHD_CONFIG_PATH = "/etc/ssh/sshd_config";
const TERMA_SSHD_BACKUP_PATH = `${SSHD_CONFIG_PATH}.terma.bak`;
const LEGACY_SSHD_BACKUP_PATH = `${SSHD_CONFIG_PATH}.tunneldesk.bak`;
const { selectRemoteProbeLines } = require("./remote-probe-protocol");

const DETECT_SCRIPT = String.raw`set +e
terma_emit() { printf 'TERMA_SSH_X11_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
td_platform=$(uname -s 2>/dev/null || printf unknown)
td_sshd=$(command -v sshd 2>/dev/null || true)
[ -n "$td_sshd" ] || for td_candidate in /usr/sbin/sshd /sbin/sshd /usr/local/sbin/sshd /usr/lib/openssh/sshd; do [ -e "$td_candidate" ] && td_sshd="$td_candidate" && break; done
td_sshd_runnable=0
[ -n "$td_sshd" ] && [ -x "$td_sshd" ] && td_sshd_runnable=1
td_xauth=$(command -v xauth 2>/dev/null || true)
[ -n "$td_xauth" ] || for td_candidate in /opt/X11/bin/xauth /usr/X11/bin/xauth /usr/bin/xauth; do [ -x "$td_candidate" ] && td_xauth="$td_candidate" && break; done
td_config="/etc/ssh/sshd_config"
td_forward="unknown"
td_localhost="unknown"
td_offset="unknown"
td_xauth_location=""
if [ "$td_sshd_runnable" = "1" ]; then
  td_effective=$($td_sshd -T 2>/dev/null || true)
  td_forward=$(printf '%s\n' "$td_effective" | sed -n 's/^x11forwarding //p' | head -n 1)
  td_localhost=$(printf '%s\n' "$td_effective" | sed -n 's/^x11uselocalhost //p' | head -n 1)
  td_offset=$(printf '%s\n' "$td_effective" | sed -n 's/^x11displayoffset //p' | head -n 1)
  td_xauth_location=$(printf '%s\n' "$td_effective" | sed -n 's/^xauthlocation //p' | head -n 1)
fi
[ -n "$td_forward" ] || td_forward=unknown
[ -n "$td_localhost" ] || td_localhost=unknown
[ -n "$td_offset" ] || td_offset=unknown
if [ "$td_forward" = "unknown" ] && [ -r "$td_config" ]; then
  td_forward=$(awk 'tolower($1) == "match" { exit } tolower($1) == "x11forwarding" { print tolower($2); exit }' "$td_config")
  [ -n "$td_forward" ] || td_forward=unknown
fi
if [ -z "$td_xauth_location" ] && [ -r "$td_config" ]; then
  td_xauth_location=$(awk 'tolower($1) == "match" { exit } tolower($1) == "xauthlocation" { print $2; exit }' "$td_config")
fi
[ "$td_platform" != "Darwin" ] || [ "$td_forward" != "unknown" ] || td_forward=no
td_xquartz=0
[ -d /Applications/Utilities/XQuartz.app ] || [ -d /Applications/XQuartz.app ] || [ -x /opt/X11/bin/xauth ] && td_xquartz=1
td_manage=0
[ "$(id -u 2>/dev/null)" = "0" ] && td_manage=1
[ "$td_manage" = "1" ] || sudo -n true >/dev/null 2>&1 && td_manage=1
terma_emit PLATFORM "$td_platform"
terma_emit SSHD_PRESENT "$( [ -n "$td_sshd" ] && printf 1 || printf 0 )"
terma_emit SSHD_PATH "$td_sshd"
terma_emit CONFIG_FILE "$td_config"
terma_emit CONFIG_PRESENT "$( [ -r "$td_config" ] && printf 1 || printf 0 )"
terma_emit X11_FORWARDING "$td_forward"
terma_emit X11_USE_LOCALHOST "$td_localhost"
terma_emit X11_DISPLAY_OFFSET "$td_offset"
terma_emit XAUTH_PATH "$td_xauth"
terma_emit XAUTH_LOCATION "$td_xauth_location"
terma_emit XAUTH_LOCATION_VALID "$( [ -n "$td_xauth_location" ] && [ -x "$td_xauth_location" ] && printf 1 || printf 0 )"
terma_emit XQUARTZ_INSTALLED "$td_xquartz"
terma_emit CAN_MANAGE "$td_manage"
terma_emit CAN_TERMINAL_MANAGE "$( [ -r "$td_config" ] && [ -n "$td_sshd" ] && printf 1 || printf 0 )"
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function rootWrapper(script) {
  const payload = Buffer.from(script, "utf8").toString("base64");
  const decoder = `if command -v openssl >/dev/null 2>&1; then openssl base64 -d -A; else base64 -d; fi`;
  return `td_payload=${shellQuote(payload)}; if [ "$(id -u 2>/dev/null)" = "0" ]; then printf '%s' "$td_payload" | (${decoder}) | sh; elif sudo -n true >/dev/null 2>&1; then printf '%s' "$td_payload" | (${decoder}) | sudo -n sh; else echo 'Terma requires root or passwordless sudo' >&2; exit 77; fi`;
}

function interactiveRootWrapper(script) {
  const payload = Buffer.from(script, "utf8").toString("base64");
  const runner = `if command -v openssl >/dev/null 2>&1; then printf '%s' "$1" | openssl base64 -d -A | sh; else printf '%s' "$1" | base64 -d | sh; fi`;
  return `td_payload=${shellQuote(payload)}; if [ "$(id -u 2>/dev/null)" = "0" ]; then sh -c ${shellQuote(runner)} sh "$td_payload"; else sudo sh -c ${shellQuote(runner)} sh "$td_payload"; fi`;
}

function parseDetectionOutput(output) {
  const values: any = {};
  for (const line of selectRemoteProbeLines(output, "SSH_X11_")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1].toLowerCase()] = match[2];
  }
  return {
    platform: values.platform === "Darwin" ? "macos" : values.platform === "Linux" ? "linux" : (values.platform || "unknown").toLowerCase(),
    sshd_present: values.sshd_present === "1",
    sshd_path: values.sshd_path || "",
    config_file: values.config_file || SSHD_CONFIG_PATH,
    config_present: values.config_present === "1",
    x11_forwarding: ["yes", "no"].includes(values.x11_forwarding) ? values.x11_forwarding : "unknown",
    x11_use_localhost: ["yes", "no"].includes(values.x11_use_localhost) ? values.x11_use_localhost : "unknown",
    x11_display_offset: values.x11_display_offset || "unknown",
    xauth_path: values.xauth_path || "",
    xauth_location: values.xauth_location || "",
    xauth_location_valid: values.xauth_location_valid === "1",
    xquartz_installed: values.xquartz_installed === "1",
    can_manage: values.can_manage === "1",
    can_terminal_manage: values.can_terminal_manage === "1",
    enabled: values.x11_forwarding === "yes",
    ready: values.x11_forwarding === "yes"
      && Boolean(values.xauth_path)
      && (values.platform !== "Darwin" || values.xauth_location_valid === "1")
  };
}

function configurePayload(mode) {
  const enabled = mode === "enable";
  if (!enabled && mode !== "disable") throw new Error("Invalid SSH X11 forwarding action");
  const value = enabled ? "yes" : "no";
  return String.raw`set -eu
terma_emit() { printf 'TERMA_SSH_X11_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
td_config=${shellQuote(SSHD_CONFIG_PATH)}
td_terma_backup=${shellQuote(TERMA_SSHD_BACKUP_PATH)}
td_legacy_backup=${shellQuote(LEGACY_SSHD_BACKUP_PATH)}
td_backup="$td_terma_backup"
td_platform=$(uname -s 2>/dev/null || printf unknown)
td_sshd=$(command -v sshd 2>/dev/null || true)
[ -n "$td_sshd" ] || [ ! -x /usr/sbin/sshd ] || td_sshd=/usr/sbin/sshd
td_xauth=$(command -v xauth 2>/dev/null || true)
[ -n "$td_xauth" ] || for td_candidate in /opt/X11/bin/xauth /usr/X11/bin/xauth /usr/bin/xauth; do [ -x "$td_candidate" ] && td_xauth="$td_candidate" && break; done
if [ ! -r "$td_config" ]; then echo "sshd_config not found: $td_config" >&2; exit 2; fi
terma_emit STAGE prepare
terma_emit LOG "Backing up sshd_config"
# A previous TunnelDesk deployment may already have captured the original
# sshd_config. Preserve that history before touching the current file, which
# may already contain its managed X11 settings.
if [ -e "$td_legacy_backup" ]; then
  [ -e "$td_terma_backup" ] || cp -p "$td_legacy_backup" "$td_terma_backup"
  td_backup="$td_terma_backup"
fi
if [ ! -e "$td_backup" ]; then cp -p "$td_config" "$td_backup"; fi
td_rollback=$(mktemp)
cp -p "$td_config" "$td_rollback"
terma_emit STAGE configure
terma_emit LOG "Setting X11Forwarding ${value}"
td_tmp=$(mktemp)
awk -v value=${shellQuote(value)} -v xauth="$td_xauth" -v configure_xauth=${enabled ? "1" : "0"} '
  BEGIN { print "X11Forwarding " value; if (configure_xauth == 1 && xauth != "") print "XAuthLocation " xauth; global_scope=1 }
  /^[[:space:]]*#/ { print; next }
  global_scope && tolower($1) == "match" { global_scope=0; print; next }
  global_scope && tolower($1) == "x11forwarding" { next }
  global_scope && configure_xauth == 1 && tolower($1) == "xauthlocation" { next }
  { print }
' "$td_config" > "$td_tmp"
cat "$td_tmp" > "$td_config"
rm -f "$td_tmp"
terma_emit STAGE validate
if [ -n "$td_sshd" ] && ! "$td_sshd" -t -f "$td_config" >/dev/null 2>&1; then
  cp -p "$td_rollback" "$td_config"
  rm -f "$td_rollback"
  echo "sshd_config validation failed; original configuration restored" >&2
  exit 3
fi
rm -f "$td_rollback"
terma_emit STAGE reload
if [ "$td_platform" = "Darwin" ]; then
  terma_emit LOG "macOS will use the updated SSH configuration for new sessions"
elif command -v systemctl >/dev/null 2>&1 && systemctl reload sshd >/dev/null 2>&1; then :
elif command -v systemctl >/dev/null 2>&1 && systemctl reload ssh >/dev/null 2>&1; then :
elif command -v service >/dev/null 2>&1 && service ssh reload >/dev/null 2>&1; then :
elif command -v service >/dev/null 2>&1 && service sshd reload >/dev/null 2>&1; then :
else echo "SSH configuration changed, but the service could not be reloaded automatically" >&2; fi
terma_emit STAGE done
terma_emit LOG "X11 forwarding ${enabled ? "enabled" : "disabled"}"
`;
}

function buildConfigureScript(mode) {
  return rootWrapper(configurePayload(mode));
}

function buildInteractiveConfigureCommand(mode) {
  return interactiveRootWrapper(configurePayload(mode));
}

module.exports = { DETECT_SCRIPT, SSHD_CONFIG_PATH, buildConfigureScript, buildInteractiveConfigureCommand, parseDetectionOutput };
