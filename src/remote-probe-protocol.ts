const CURRENT_REMOTE_PROBE_PREFIX = "TERMA";
const LEGACY_REMOTE_PROBE_PREFIX = "TD";

function probeLines(value: unknown) {
  return String(value || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
}

function selectRemoteProbeLines(value: unknown, scope = "") {
  const lines = probeLines(value);
  const currentPrefix = `${CURRENT_REMOTE_PROBE_PREFIX}_${scope}`;
  const legacyPrefix = `${LEGACY_REMOTE_PROBE_PREFIX}_${scope}`;
  const prefix = lines.some((line) => line.startsWith(currentPrefix)) ? currentPrefix : legacyPrefix;
  return lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}

function remoteProbeValue(value: unknown, key: string, scope = "") {
  const marker = `${key}=`;
  const line = selectRemoteProbeLines(value, scope).find((item) => item.startsWith(marker));
  return line === undefined ? "" : line.slice(marker.length);
}

function remoteProbeMarker(value: unknown, marker: string) {
  const lines = probeLines(value);
  const current = `${CURRENT_REMOTE_PROBE_PREFIX}_${marker}`;
  if (lines.some((line) => line.split("\t", 1)[0] === current)) return current;
  const legacy = `${LEGACY_REMOTE_PROBE_PREFIX}_${marker}`;
  return lines.some((line) => line.split("\t", 1)[0] === legacy) ? legacy : "";
}

module.exports = {
  CURRENT_REMOTE_PROBE_PREFIX,
  LEGACY_REMOTE_PROBE_PREFIX,
  remoteProbeMarker,
  remoteProbeValue,
  selectRemoteProbeLines
};
