const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("ssh2");
const { DATA_DIR } = require("./config");

const TRUST_STORE_FILE = path.join(DATA_DIR, "ssh-host-trust.json");
const KNOWN_HOSTS_FILE = path.join(DATA_DIR, "ssh-known-hosts");
const ONCE_DIRECTORY = path.join(DATA_DIR, "ssh-host-trust-once");
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const ONCE_TTL_MS = 5 * 60 * 1000;
const pendingChallenges = new Map();
const onceTrustedKeys = new Map();

class SshHostTrustError extends Error {
  code: string;
  statusCode: number;
  challenge: any;

  constructor(challenge) {
    const changed = challenge.state === "changed";
    super(changed ? "SSH 主机密钥已变化，请确认后再连接" : "需要确认 SSH 主机指纹");
    this.name = "SshHostTrustError";
    this.code = changed ? "SSH_HOST_KEY_CHANGED" : "SSH_HOST_KEY_UNKNOWN";
    this.statusCode = 409;
    this.challenge = challenge;
  }
}

function normalizedHost(value) {
  const host = String(value || "").trim().replace(/^\[|\]$/g, "");
  if (!host) throw new Error("缺少 SSH 主机地址");
  return host.toLowerCase();
}

function normalizedPort(value) {
  const port = Number(value || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH 端口无效");
  return port;
}

function connectionTarget(connection) {
  return {
    host: normalizedHost(connection?.ssh_host),
    port: normalizedPort(connection?.ssh_port)
  };
}

function hostLabel(host, port) {
  const value = String(host || "");
  return `${value.includes(":") ? `[${value}]` : value}:${port}`;
}

function knownHostsPattern(host, port) {
  const value = String(host || "");
  if (Number(port) === 22) return value;
  return `[${value}]:${port}`;
}

function keyTypeFromBlob(rawKey) {
  const key = Buffer.from(rawKey || []);
  if (key.length < 5) throw new Error("SSH 主机密钥格式无效");
  const length = key.readUInt32BE(0);
  if (!length || length > key.length - 4 || length > 256) throw new Error("SSH 主机密钥格式无效");
  const type = key.subarray(4, 4 + length).toString("ascii");
  if (!/^[a-z0-9@._+-]+$/i.test(type)) throw new Error("SSH 主机密钥算法无效");
  return type;
}

function describeHostKey(connection, rawKey) {
  const { host, port } = connectionTarget(connection);
  const key = Buffer.from(rawKey || []);
  return {
    host,
    port,
    host_label: hostLabel(host, port),
    key_type: keyTypeFromBlob(key),
    key_base64: key.toString("base64"),
    fingerprint: `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/g, "")}`
  };
}

function recordId(record) {
  return crypto.createHash("sha256")
    .update(`${record.host}\n${record.port}\n${record.key_type}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeRecord(record) {
  const host = normalizedHost(record?.host);
  const port = normalizedPort(record?.port);
  const keyType = String(record?.key_type || "").trim();
  const keyBase64 = String(record?.key_base64 || "").trim();
  const fingerprint = String(record?.fingerprint || "").trim();
  if (!keyType || !keyBase64 || !fingerprint) throw new Error("SSH 主机信任记录不完整");
  const normalized = {
    id: "",
    host,
    port,
    host_label: hostLabel(host, port),
    key_type: keyType,
    key_base64: keyBase64,
    fingerprint,
    trusted_at: Number(record?.trusted_at || Date.now()),
    updated_at: Number(record?.updated_at || record?.trusted_at || Date.now())
  };
  normalized.id = recordId(normalized);
  return normalized;
}

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(TRUST_STORE_FILE, "utf8"));
    const hosts = Array.isArray(value?.hosts)
      ? value.hosts.flatMap((record) => {
        try {
          return [normalizeRecord(record)];
        } catch {
          return [];
        }
      })
      : [];
    return { version: 1, hosts };
  } catch {
    return { version: 1, hosts: [] };
  }
}

function knownHostsLine(record) {
  return `${knownHostsPattern(record.host, record.port)} ${record.key_type} ${record.key_base64}`;
}

function writeKnownHosts(records, file = KNOWN_HOSTS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = records.map(knownHostsLine).join("\n");
  fs.writeFileSync(file, body ? `${body}\n` : "", { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const normalized = { version: 1, hosts: store.hosts.map(normalizeRecord) };
  const temporary = `${TRUST_STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(temporary, TRUST_STORE_FILE);
  } catch {
    fs.copyFileSync(temporary, TRUST_STORE_FILE);
    fs.rmSync(temporary, { force: true });
  }
  try { fs.chmodSync(TRUST_STORE_FILE, 0o600); } catch {}
  writeKnownHosts(normalized.hosts);
}

function ensureKnownHostsFile() {
  if (!fs.existsSync(KNOWN_HOSTS_FILE)) writeKnownHosts(readStore().hosts);
  return KNOWN_HOSTS_FILE;
}

function cleanupTransientState() {
  const now = Date.now();
  for (const [token, item] of pendingChallenges) {
    if (item.expires_at <= now) pendingChallenges.delete(token);
  }
  for (const [key, item] of onceTrustedKeys) {
    if (item.expires_at <= now || item.remaining <= 0) onceTrustedKeys.delete(key);
  }
  try {
    fs.mkdirSync(ONCE_DIRECTORY, { recursive: true });
    for (const name of fs.readdirSync(ONCE_DIRECTORY)) {
      const file = path.join(ONCE_DIRECTORY, name);
      try {
        if (now - fs.statSync(file).mtimeMs > ONCE_TTL_MS) fs.rmSync(file, { force: true });
      } catch {}
    }
  } catch {}
}

function trustKey(descriptor) {
  return `${descriptor.host}\n${descriptor.port}\n${descriptor.key_type}\n${descriptor.fingerprint}`;
}

function storedRecordFor(descriptor) {
  return readStore().hosts.find((item) => (
    item.host === descriptor.host
    && item.port === descriptor.port
    && item.key_type === descriptor.key_type
  )) || null;
}

function createChallenge(descriptor, saved) {
  cleanupTransientState();
  const token = crypto.randomUUID();
  const challenge = {
    token,
    state: saved ? "changed" : "unknown",
    host: descriptor.host,
    port: descriptor.port,
    host_label: descriptor.host_label,
    key_type: descriptor.key_type,
    fingerprint: descriptor.fingerprint,
    previous_fingerprint: saved?.fingerprint || "",
    previous_trusted_at: Number(saved?.trusted_at || 0)
  };
  pendingChallenges.set(token, {
    descriptor,
    challenge,
    expires_at: Date.now() + CHALLENGE_TTL_MS
  });
  return challenge;
}

function verifyHostKey(connection, rawKey, options: any = {}) {
  cleanupTransientState();
  const descriptor = describeHostKey(connection, rawKey);
  const saved = storedRecordFor(descriptor);
  if (saved?.fingerprint === descriptor.fingerprint && saved.key_base64 === descriptor.key_base64) return true;
  const once = onceTrustedKeys.get(trustKey(descriptor));
  if (once && once.expires_at > Date.now() && once.remaining > 0) {
    if (options.consume !== false) {
      once.remaining -= 1;
      if (once.remaining <= 0) onceTrustedKeys.delete(trustKey(descriptor));
    }
    return true;
  }
  throw new SshHostTrustError(createChallenge(descriptor, saved));
}

function acceptHostTrust(token, mode) {
  cleanupTransientState();
  const pending = pendingChallenges.get(String(token || ""));
  if (!pending || pending.expires_at <= Date.now()) throw new Error("SSH 主机指纹确认已过期，请重新连接");
  if (!new Set(["once", "persist"]).has(mode)) throw new Error("SSH 主机指纹确认方式无效");
  pendingChallenges.delete(String(token));
  const descriptor = pending.descriptor;
  if (mode === "once") {
    onceTrustedKeys.set(trustKey(descriptor), {
      descriptor,
      expires_at: Date.now() + ONCE_TTL_MS,
      remaining: 1
    });
    return { ok: true, mode, host: descriptor.host, port: descriptor.port, fingerprint: descriptor.fingerprint };
  }
  const store = readStore();
  const now = Date.now();
  const previous = store.hosts.find((item) => (
    item.host === descriptor.host && item.port === descriptor.port && item.key_type === descriptor.key_type
  ));
  const record = normalizeRecord({
    ...descriptor,
    trusted_at: previous?.trusted_at || now,
    updated_at: now
  });
  store.hosts = store.hosts.filter((item) => item.id !== record.id);
  store.hosts.push(record);
  writeStore(store);
  return { ok: true, mode, record };
}

function listTrustedHosts() {
  return readStore().hosts
    .slice()
    .sort((left, right) => left.host_label.localeCompare(right.host_label) || left.key_type.localeCompare(right.key_type))
    .map(({ key_base64, ...record }) => record);
}

function removeTrustedHost(id) {
  const store = readStore();
  const next = store.hosts.filter((item) => item.id !== String(id || ""));
  if (next.length === store.hosts.length) throw new Error("SSH 主机信任记录不存在");
  store.hosts = next;
  writeStore(store);
  return { ok: true };
}

function hostKeyProbeError(error, host, port) {
  const label = hostLabel(host, port);
  const code = String(error?.code || "").trim().toUpperCase();
  const detail = String(error?.message || error || "").trim();
  const searchable = `${code} ${detail}`.toLowerCase();
  let message = "";
  if (/enotfound|eai_again|getaddrinfo/.test(searchable)) {
    message = `无法解析 SSH 主机地址：${host}`;
  } else if (/econnrefused|connection refused/.test(searchable)) {
    message = `SSH 连接被拒绝：${label}`;
  } else if (/etimedout|timed out|timeout/.test(searchable)) {
    message = `SSH 主机密钥探测超时：${label}`;
  } else if (/ehostunreach|enetunreach|no route to host|network is unreachable/.test(searchable)) {
    message = `无法连接 SSH 主机：${label}`;
  } else if (/all configured authentication methods failed|authentication failed/.test(searchable)) {
    message = "SSH 认证失败，请检查用户名、密码、私钥或代理设置";
  } else if (/handshake failed|no matching (?:host key|cipher|mac|key exchange)|key exchange failed/.test(searchable)) {
    message = `SSH 握手失败，客户端与服务器没有可兼容的算法：${label}`;
  } else if (/econnreset|connection reset|connection lost|socket disconnected|client-socket/.test(searchable)) {
    message = `SSH 连接在主机密钥探测期间中断：${label}`;
  } else {
    message = `SSH 主机密钥探测失败：${label}`;
  }
  const normalized: any = new Error(message);
  normalized.name = "SshHostKeyProbeError";
  normalized.code = code || "SSH_HOST_KEY_PROBE_FAILED";
  Object.defineProperty(normalized, "cause", {value:error, enumerable:false, configurable:true});
  return normalized;
}

function probeHostKey(connection, options: any = {}) {
  const { host, port } = connectionTarget(connection);
  return new Promise((resolve, reject) => {
    const client = typeof options.clientFactory === "function" ? options.clientFactory() : new Client();
    let settled = false;
    const finish = (error = null, descriptor = null) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch {}
      if (error) reject(error);
      else resolve(descriptor);
    };
    // ssh2 can emit another error while client.end() tears down a failed
    // handshake. Keep this listener for the complete client lifetime so a
    // late socket error cannot become an uncaught EventEmitter error.
    client.on("error", (error) => {
      if (settled) return;
      finish(hostKeyProbeError(error, host, port));
    });
    try {
      client.connect({
        host,
        port,
        ...(options.sock ? { sock:options.sock } : {}),
        username: String(connection?.ssh_user || "terma-host-key-probe"),
        readyTimeout: 12000,
        keepaliveInterval: 0,
        authHandler: () => false,
        hostVerifier: (rawKey) => {
          try {
            finish(null, describeHostKey(connection, rawKey));
          } catch (error) {
            finish(error);
          }
          return false;
        }
      });
    } catch (error) {
      finish(hostKeyProbeError(error, host, port));
    }
  });
}

async function ensureHostTrusted(connection, options: any = {}) {
  const descriptor: any = await probeHostKey(connection, options);
  verifyHostKey(connection, Buffer.from(descriptor.key_base64, "base64"), { consume: false });
  return {
    ok: true,
    host: descriptor.host,
    port: descriptor.port,
    key_type: descriptor.key_type,
    fingerprint: descriptor.fingerprint
  };
}

function trustedRecordsFor(connection) {
  cleanupTransientState();
  const { host, port } = connectionTarget(connection);
  const persistent = readStore().hosts.filter((item) => item.host === host && item.port === port);
  const transient = [];
  for (const item of onceTrustedKeys.values()) {
    if (item.descriptor.host === host && item.descriptor.port === port && item.remaining > 0 && item.expires_at > Date.now()) {
      transient.push(normalizeRecord({ ...item.descriptor, trusted_at: Date.now(), updated_at: Date.now() }));
    }
  }
  return { persistent, transient };
}

function systemHostKeyArgs(connection, options: any = {}) {
  const connections = [connection, ...(options.additionalConnections || [])];
  const recordSets = connections.map(trustedRecordsFor);
  const persistent = recordSets.flatMap((item) => item.persistent);
  const transient = recordSets.flatMap((item) => item.transient);
  let knownHostsFile = ensureKnownHostsFile();
  if (transient.length) {
    fs.mkdirSync(ONCE_DIRECTORY, { recursive: true });
    knownHostsFile = path.join(ONCE_DIRECTORY, `${crypto.randomUUID()}.known_hosts`);
    writeKnownHosts([...readStore().hosts, ...transient], knownHostsFile);
    for (const record of transient) onceTrustedKeys.delete(trustKey(record));
  }
  const algorithms = [...new Set([...persistent, ...transient].map((item) => item.key_type).filter(Boolean))];
  const args = [
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsFile}`,
    "-o", `GlobalKnownHostsFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-o", "CheckHostIP=no",
    "-o", "UpdateHostKeys=no"
  ];
  if (algorithms.length) args.push("-o", `HostKeyAlgorithms=${algorithms.join(",")}`);
  return args;
}

function isHostTrustError(error) {
  return Boolean(error && new Set(["SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED"]).has(error.code));
}

function hostTrustErrorResponse(error) {
  if (!isHostTrustError(error)) return null;
  return {
    status: Number(error.statusCode || 409),
    body: {
      error: error.message,
      code: error.code,
      challenge: error.challenge
    }
  };
}

ensureKnownHostsFile();
cleanupTransientState();

module.exports = {
  SshHostTrustError,
  acceptHostTrust,
  describeHostKey,
  ensureHostTrusted,
  hostTrustErrorResponse,
  isHostTrustError,
  listTrustedHosts,
  probeHostKey,
  removeTrustedHost,
  systemHostKeyArgs,
  verifyHostKey
};
