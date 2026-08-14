const LINUX_IDS = new Set([
  "almalinux", "alpine", "amzn", "arch", "centos", "debian", "fedora", "gentoo",
  "kali", "linux", "linuxmint", "manjaro", "nixos", "opensuse", "oracle", "raspbian",
  "rhel", "rocky", "sles", "ubuntu"
]);
const TERMA_VNC_PREFIX = "terma";
const LEGACY_VNC_PREFIX = "tunneldesk";

function shellQuote(value: any) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function numericPort(value: any, fallback = 5900) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function platformFor(osId: string, kernel: string, osLike = "") {
  const id = String(osId || "").toLowerCase();
  const rawKernel = String(kernel || "").toLowerCase();
  const like = String(osLike || "").toLowerCase();
  if (rawKernel.includes("darwin") || id === "macos" || id === "darwin" || like.includes("darwin")) return "macos";
  if (rawKernel.includes("linux") || LINUX_IDS.has(id) || like.includes("linux")) return "linux";
  return "unknown";
}

function commandList(values: Map<string, string>, key: string) {
  return String(values.get(key) || "").split(",").map(item => item.trim()).filter(Boolean);
}

function normalizeTigerVncWrapperCommand(value: any) {
  const command = String(value || "").trim();
  return command === "vncserver" || command === "tigervncserver" ? command : "";
}

function managedVncUnitInfo(value: any) {
  const unit = String(value || "").trim();
  const match = /^(terma|tunneldesk)-(x11vnc|tigervnc-([1-9][0-9]*))\.service$/.exec(unit);
  if (!match) return null;
  return {
    unit,
    brand:match[1],
    component:match[2] === "x11vnc" ? "x11vnc" : "tigervnc",
    display:match[3] ? Number(match[3]) : 0
  };
}

function isManagedVncUnit(value: any) {
  return Boolean(managedVncUnitInfo(value));
}

function isLegacyManagedVncUnit(value: any) {
  return managedVncUnitInfo(value)?.brand === LEGACY_VNC_PREFIX;
}

function managedVncUnitFor(component: string, displayNumber = 0, brand = TERMA_VNC_PREFIX) {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  if (key === "x11vnc") return `${brand}-x11vnc.service`;
  const value = Number(displayNumber);
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error("VNC 显示编号无效");
  return `${brand}-tigervnc-${value}.service`;
}

function tigerVncRunnerPathFor(displayNumber: any, brand = TERMA_VNC_PREFIX) {
  const value = Number(displayNumber);
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error("VNC 显示编号无效");
  return `/usr/local/libexec/${brand}-tigervnc-${value}`;
}

function boolValue(values: Map<string, string>, key: string) {
  return values.get(key) === "1";
}

function validPosixName(value: any) {
  const text = String(value || "").trim();
  return /^[a-z_][a-z0-9_-]*[$]?$/i.test(text) ? text : "";
}

function systemdEscape(value: any, label = "systemd 值") {
  const text = String(value ?? "");
  if (!text || /[\0\r\n]/.test(text)) throw new Error(`${label}无效`);
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
}

function tigerVncServiceName(displayNumber: any) {
  return managedVncUnitFor("tigervnc", displayNumber);
}

function tigerVncRunnerPath(displayNumber: any) {
  return tigerVncRunnerPathFor(displayNumber);
}

function tigerVncDisplayNumber(portValue: any) {
  const candidate = numericPort(portValue) - 5899;
  return candidate >= 1 && candidate <= 99 ? candidate : 1;
}

function systemctlExecutable(diagnostics: any = {}) {
  const candidate = String(diagnostics.systemctl_path || "").trim();
  return /^\/(?:[A-Za-z0-9._+-]+\/)*systemctl$/.test(candidate) ? shellQuote(candidate) : "systemctl";
}

function managedVncUnits(diagnostics: any = {}) {
  const values = [
    diagnostics.service_unit,
    ...(Array.isArray(diagnostics.service_candidates) ? diagnostics.service_candidates.map((item: any) => item?.unit) : [])
  ];
  return [...new Set(values.map(value => String(value || "").trim()).filter(isManagedVncUnit))];
}

function managedVncConflictCommands(diagnostics: any = {}, targetComponent = "", keepUnit = "", preserveUnit = "") {
  const key = targetComponent === "x11vnc" ? "x11vnc" : targetComponent === "tigervnc" ? "tigervnc" : "";
  if (!key) return [];
  const systemctl = systemctlExecutable(diagnostics);
  return managedVncUnits(diagnostics)
    .filter(unit => unit !== keepUnit && unit !== preserveUnit && (key === "x11vnc" ? unit.includes("tigervnc") : unit.includes("x11vnc") || unit.includes("tigervnc-")))
    .map(unit => `${systemctl} disable --now ${shellQuote(unit)} 2>/dev/null || true`);
}

module.exports = {
  LEGACY_VNC_PREFIX,
  TERMA_VNC_PREFIX,
  boolValue,
  commandList,
  isLegacyManagedVncUnit,
  isManagedVncUnit,
  managedVncConflictCommands,
  managedVncUnitFor,
  managedVncUnitInfo,
  managedVncUnits,
  normalizeTigerVncWrapperCommand,
  numericPort,
  platformFor,
  shellQuote,
  systemctlExecutable,
  systemdEscape,
  tigerVncDisplayNumber,
  tigerVncRunnerPath,
  tigerVncRunnerPathFor,
  tigerVncServiceName,
  validPosixName
};
