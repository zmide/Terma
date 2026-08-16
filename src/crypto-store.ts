const crypto = require("node:crypto");
const { readSecuritySettings, writeSecuritySettings } = require("./security");
const { publicError } = require("./public-error");

let activeKey = null;
let activeLegacyKey = null;
let activeLegacyVersion = 0;

const CURRENT_ENCRYPTION_VERSION = 3;
const CURRENT_ENCRYPTED_PREFIX = "termaenc:v3:";
const V2_ENCRYPTED_PREFIX = "termaenc:v2:";
const V1_ENCRYPTED_PREFIX = "termaenc:v1:";
const LEGACY_ENCRYPTED_PREFIX = "tdenc:v1:";
const V2_ENCRYPTION_INFO = Buffer.from("terma-config-encryption-v2", "utf8");
const V2_VERIFIER_INFO = Buffer.from("terma-config-verifier-v2", "utf8");
const V2_VERIFIER_MESSAGE = Buffer.from("Terma configuration encryption v2", "utf8");
const V2_CIPHERTEXT_AAD = Buffer.from("Terma configuration secret v2", "utf8");
const V3_ENCRYPTION_INFO = Buffer.from("terma-config-encryption-v3", "utf8");
const V3_VERIFIER_INFO = Buffer.from("terma-config-verifier-v3", "utf8");
const V3_VERIFIER_MESSAGE = Buffer.from("Terma configuration encryption v3", "utf8");
const V3_CIPHERTEXT_AAD = Buffer.from("Terma configuration secret v3", "utf8");

function encryptionVersion(settings = readSecuritySettings()) {
  if (!settings.encryption_enabled) return CURRENT_ENCRYPTION_VERSION;
  const version = Number(settings.encryption_version || 1);
  return [1, 2, CURRENT_ENCRYPTION_VERSION].includes(version) ? version : 1;
}

function encryptionStatus(settings = readSecuritySettings()) {
  const value = String(settings.encryption_state || "");
  if (["disabled", "enabling", "enabled", "disabling"].includes(value)) return value;
  return settings.encryption_enabled ? "enabled" : "disabled";
}

function isEncryptedText(value) {
  const text = String(value || "");
  return text.startsWith(CURRENT_ENCRYPTED_PREFIX)
    || text.startsWith(V2_ENCRYPTED_PREFIX)
    || text.startsWith(V1_ENCRYPTED_PREFIX)
    || text.startsWith(LEGACY_ENCRYPTED_PREFIX);
}

function isCurrentEncryptedText(value) {
  return String(value || "").startsWith(CURRENT_ENCRYPTED_PREFIX);
}

function encryptedTextVersion(value) {
  const text = String(value || "");
  if (text.startsWith(CURRENT_ENCRYPTED_PREFIX)) return CURRENT_ENCRYPTION_VERSION;
  if (text.startsWith(V2_ENCRYPTED_PREFIX)) return 2;
  if (text.startsWith(V1_ENCRYPTED_PREFIX) || text.startsWith(LEGACY_ENCRYPTED_PREFIX)) return 1;
  return 0;
}

function deriveRootKey(password, salt) {
  return crypto.scryptSync(String(password || ""), String(salt || ""), 32);
}

function deriveSubkey(rootKey, info) {
  return Buffer.from(crypto.hkdfSync("sha256", rootKey, Buffer.alloc(0), info, 32));
}

function keyMaterial(rootKey, version) {
  const encryptionInfo = version === 2 ? V2_ENCRYPTION_INFO : V3_ENCRYPTION_INFO;
  const verifierInfo = version === 2 ? V2_VERIFIER_INFO : V3_VERIFIER_INFO;
  const verifierMessage = version === 2 ? V2_VERIFIER_MESSAGE : V3_VERIFIER_MESSAGE;
  const verifyKey = deriveSubkey(rootKey, verifierInfo);
  return {
    encryptionKey: deriveSubkey(rootKey, encryptionInfo),
    verifier: crypto.createHmac("sha256", verifyKey).update(verifierMessage).digest("base64url")
  };
}

function safeEqualText(actual, expected) {
  const left = Buffer.from(String(actual || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function unlockDescriptor(password, descriptor) {
  const version = Number(descriptor.version || 1);
  const rootKey = deriveRootKey(password, descriptor.salt);
  if (version === 1) {
    if (!safeEqualText(rootKey.toString("hex"), descriptor.check)) throw publicError("CONFIG_PASSWORD_INCORRECT", "主密码不正确");
    return { version, rootKey, encryptionKey:rootKey };
  }
  if (![2, CURRENT_ENCRYPTION_VERSION].includes(version)) throw publicError("CONFIG_ENCRYPTION_VERSION_UNSUPPORTED", "配置加密版本不受支持");
  const material = keyMaterial(rootKey, version);
  if (!safeEqualText(material.verifier, descriptor.check)) throw publicError("CONFIG_PASSWORD_INCORRECT", "主密码不正确");
  return { version, rootKey, encryptionKey:material.encryptionKey };
}

function currentDescriptor(settings) {
  return {
    version:encryptionVersion(settings),
    salt:String(settings.encryption_salt || ""),
    check:String(settings.encryption_check || "")
  };
}

function legacyDescriptor(settings) {
  const version = Number(settings.encryption_legacy_version || 0);
  if (![1, 2].includes(version)) return null;
  return {
    version,
    salt:String(settings.encryption_legacy_salt || ""),
    check:String(settings.encryption_legacy_check || "")
  };
}

function unlockEncryption(password) {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return { ok: true, enabled: false, state: "disabled", version:CURRENT_ENCRYPTION_VERSION };
  const unlocked = unlockDescriptor(password, currentDescriptor(settings));
  if (unlocked.version === CURRENT_ENCRYPTION_VERSION) {
    activeKey = unlocked.encryptionKey;
    const legacy = legacyDescriptor(settings);
    if (legacy) {
      const legacyUnlocked = unlockDescriptor(password, legacy);
      activeLegacyKey = legacyUnlocked.encryptionKey;
      activeLegacyVersion = legacyUnlocked.version;
    } else {
      activeLegacyKey = null;
      activeLegacyVersion = 0;
    }
  } else {
    activeKey = null;
    activeLegacyKey = unlocked.encryptionKey;
    activeLegacyVersion = unlocked.version;
  }
  return { ok: true, enabled: true, state:encryptionStatus(settings), version:unlocked.version };
}

function enableEncryption(password) {
  const settings = readSecuritySettings();
  if (settings.encryption_enabled || encryptionStatus(settings) !== "disabled") {
    throw publicError("CONFIG_ENCRYPTION_BUSY", "配置加密已启用或正在切换，请先完成当前操作");
  }
  if (String(password || "").length < 12) throw publicError("CONFIG_PASSWORD_TOO_SHORT", "主密码至少 12 位", { min:12 });
  const salt = crypto.randomBytes(16).toString("hex");
  const rootKey = deriveRootKey(password, salt);
  const material = keyMaterial(rootKey, CURRENT_ENCRYPTION_VERSION);
  activeKey = material.encryptionKey;
  activeLegacyKey = null;
  activeLegacyVersion = 0;
  writeSecuritySettings({
    encryption_enabled: true,
    encryption_state: "enabling",
    encryption_version: CURRENT_ENCRYPTION_VERSION,
    encryption_salt: salt,
    encryption_check: material.verifier,
    encryption_legacy_version:0,
    encryption_legacy_salt:"",
    encryption_legacy_check:""
  });
  return { ok: true, state:"enabling", version:CURRENT_ENCRYPTION_VERSION };
}

function beginDisableEncryption() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return { ok:true, state:"disabled" };
  if (!activeKey && !activeLegacyKey) throw publicError("CONFIG_ENCRYPTION_LOCKED", "配置加密已锁定，请先解锁", {}, 423);
  writeSecuritySettings({ encryption_enabled:true, encryption_state:"disabling" });
  return { ok:true, state:"disabling", version:encryptionVersion(settings) };
}

function completeEncryptionEnable() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled || encryptionVersion(settings) !== CURRENT_ENCRYPTION_VERSION) {
    throw publicError("CONFIG_ENCRYPTION_UPGRADE_STATE_INVALID", "配置加密升级状态无效");
  }
  writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabled",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_legacy_version:0,
    encryption_legacy_salt:"",
    encryption_legacy_check:""
  });
  activeLegacyKey = null;
  activeLegacyVersion = 0;
  return { ok:true, state:"enabled", version:CURRENT_ENCRYPTION_VERSION };
}

function disableEncryption() {
  activeKey = null;
  activeLegacyKey = null;
  activeLegacyVersion = 0;
  writeSecuritySettings({
    encryption_enabled:false,
    encryption_state:"disabled",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_salt:"",
    encryption_check:"",
    encryption_legacy_version:0,
    encryption_legacy_salt:"",
    encryption_legacy_check:""
  });
  return { ok:true, state:"disabled", version:CURRENT_ENCRYPTION_VERSION };
}

function prepareEncryptionUpgrade(password) {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return false;
  const state = encryptionStatus(settings);
  const version = encryptionVersion(settings);
  if (version === CURRENT_ENCRYPTION_VERSION) return state === "enabling";
  if (state !== "enabled") return false;
  if (!activeLegacyKey || activeLegacyVersion !== version) throw publicError("CONFIG_ENCRYPTION_ROTATION_LOCKED", "配置加密尚未解锁，无法轮换密钥", {}, 423);
  const salt = crypto.randomBytes(16).toString("hex");
  const rootKey = deriveRootKey(password, salt);
  const material = keyMaterial(rootKey, CURRENT_ENCRYPTION_VERSION);
  activeKey = material.encryptionKey;
  writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabling",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_salt:salt,
    encryption_check:material.verifier,
    encryption_legacy_version:version,
    encryption_legacy_salt:String(settings.encryption_salt || ""),
    encryption_legacy_check:String(settings.encryption_check || "")
  });
  return true;
}

function lockEncryption() {
  activeKey = null;
  activeLegacyKey = null;
  activeLegacyVersion = 0;
}

function encryptionReady() {
  const settings = readSecuritySettings();
  const state = encryptionStatus(settings);
  if (!settings.encryption_enabled || state === "disabled") return true;
  return state === "enabled" && Boolean(activeKey || activeLegacyKey);
}

function encryptionState() {
  const settings = readSecuritySettings();
  const state = encryptionStatus(settings);
  return {
    enabled:Boolean(settings.encryption_enabled),
    unlocked:!settings.encryption_enabled || Boolean(activeKey || activeLegacyKey),
    ready:encryptionReady(),
    state,
    version:encryptionVersion(settings),
    upgrade_required:Boolean(settings.encryption_enabled && encryptionVersion(settings) < CURRENT_ENCRYPTION_VERSION),
    transition_pending:state === "enabling" || state === "disabling"
  };
}

function requireEncryptionUnlocked() {
  const state = encryptionState();
  if (state.ready) return state;
  const transition = state.transition_pending
    ? "配置加密切换尚未完成，请先在设置 > 安全中输入主密码继续修复"
    : "配置加密已锁定，请先在设置 > 安全中输入主密码解锁";
  const error: any = publicError(
    state.transition_pending ? "CONFIG_ENCRYPTION_TRANSITION_PENDING" : "CONFIG_ENCRYPTION_LOCKED",
    transition,
    {},
    423
  );
  error.code = state.transition_pending ? "ENCRYPTION_TRANSITION_PENDING" : "ENCRYPTION_LOCKED";
  error.statusCode = 423;
  throw error;
}

function encryptText(value) {
  if (value == null || value === "") return value;
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return value;
  if (!activeKey) throw publicError("CONFIG_ENCRYPTION_NOT_READY", "配置加密尚未解锁或升级未完成", {}, 423);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", activeKey, iv);
  cipher.setAAD(V3_CIPHERTEXT_AAD);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURRENT_ENCRYPTED_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

function decryptWithKey(text, key, aad = null) {
  const [, , ivText, tagText, dataText] = text.split(":");
  if (!ivText || !tagText || typeof dataText !== "string") throw publicError("CONFIG_ENCRYPTION_FIELD_INVALID", "配置加密字段格式无效");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

function decryptText(value) {
  const text = String(value || "");
  if (!isEncryptedText(text)) {
    const settings = readSecuritySettings();
    if (text && settings.encryption_enabled) {
      const transitionPending = ["enabling", "disabling"].includes(encryptionStatus(settings));
      const fallbackMessage = transitionPending
        ? "配置加密切换尚未完成，敏感字段已暂停使用"
        : "配置加密状态与数据库敏感字段不一致，请先修复配置加密";
      const error: any = publicError(
        transitionPending ? "CONFIG_ENCRYPTION_TRANSITION_PENDING" : "CONFIG_ENCRYPTION_INCONSISTENT",
        fallbackMessage,
        {},
        423
      );
      error.code = transitionPending ? "ENCRYPTION_TRANSITION_PENDING" : "ENCRYPTION_INCONSISTENT";
      error.statusCode = 423;
      throw error;
    }
    return value;
  }
  if (isCurrentEncryptedText(text)) {
    if (!activeKey) return "";
    return decryptWithKey(text, activeKey, V3_CIPHERTEXT_AAD);
  }
  const version = encryptedTextVersion(text);
  if (!activeLegacyKey || activeLegacyVersion !== version) return "";
  return decryptWithKey(text, activeLegacyKey, version === 2 ? V2_CIPHERTEXT_AAD : null);
}

module.exports = {
  CURRENT_ENCRYPTED_PREFIX,
  CURRENT_ENCRYPTION_VERSION,
  beginDisableEncryption,
  completeEncryptionEnable,
  decryptText,
  disableEncryption,
  enableEncryption,
  encryptionReady,
  encryptionState,
  encryptText,
  isCurrentEncryptedText,
  isEncryptedText,
  lockEncryption,
  prepareEncryptionUpgrade,
  requireEncryptionUnlocked,
  unlockEncryption
};
