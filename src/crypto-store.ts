const crypto = require("node:crypto");
const { readSecuritySettings, writeSecuritySettings } = require("./security");

let activeKey = null;
let activeLegacyKey = null;

const CURRENT_ENCRYPTION_VERSION = 2;
const CURRENT_ENCRYPTED_PREFIX = "termaenc:v2:";
const V1_ENCRYPTED_PREFIX = "termaenc:v1:";
const LEGACY_ENCRYPTED_PREFIX = "tdenc:v1:";
const V2_ENCRYPTION_INFO = Buffer.from("terma-config-encryption-v2", "utf8");
const V2_VERIFIER_INFO = Buffer.from("terma-config-verifier-v2", "utf8");
const V2_VERIFIER_MESSAGE = Buffer.from("Terma configuration encryption v2", "utf8");
const V2_CIPHERTEXT_AAD = Buffer.from("Terma configuration secret v2", "utf8");

function encryptionVersion(settings = readSecuritySettings()) {
  if (!settings.encryption_enabled) return CURRENT_ENCRYPTION_VERSION;
  const version = Number(settings.encryption_version || 1);
  return version === CURRENT_ENCRYPTION_VERSION ? CURRENT_ENCRYPTION_VERSION : 1;
}

function encryptionStatus(settings = readSecuritySettings()) {
  const value = String(settings.encryption_state || "");
  if (["disabled", "enabling", "enabled", "disabling"].includes(value)) return value;
  return settings.encryption_enabled ? "enabled" : "disabled";
}

function isEncryptedText(value) {
  const text = String(value || "");
  return text.startsWith(CURRENT_ENCRYPTED_PREFIX)
    || text.startsWith(V1_ENCRYPTED_PREFIX)
    || text.startsWith(LEGACY_ENCRYPTED_PREFIX);
}

function isCurrentEncryptedText(value) {
  return String(value || "").startsWith(CURRENT_ENCRYPTED_PREFIX);
}

function isLegacyEncryptedText(value) {
  const text = String(value || "");
  return text.startsWith(V1_ENCRYPTED_PREFIX) || text.startsWith(LEGACY_ENCRYPTED_PREFIX);
}

function deriveRootKey(password, salt) {
  return crypto.scryptSync(String(password || ""), String(salt || ""), 32);
}

function deriveSubkey(rootKey, info) {
  return Buffer.from(crypto.hkdfSync("sha256", rootKey, Buffer.alloc(0), info, 32));
}

function v2KeyMaterial(rootKey) {
  const verifyKey = deriveSubkey(rootKey, V2_VERIFIER_INFO);
  return {
    encryptionKey: deriveSubkey(rootKey, V2_ENCRYPTION_INFO),
    verifier: crypto.createHmac("sha256", verifyKey).update(V2_VERIFIER_MESSAGE).digest("base64url")
  };
}

function safeEqualText(actual, expected) {
  const left = Buffer.from(String(actual || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function legacyRootKeyFromCheck(value) {
  const text = String(value || "");
  if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error("旧版配置加密校验值无效，无法自动升级");
  return Buffer.from(text, "hex");
}

function unlockEncryption(password) {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return { ok: true, enabled: false, state: "disabled", version:CURRENT_ENCRYPTION_VERSION };
  const rootKey = deriveRootKey(password, settings.encryption_salt);
  const version = encryptionVersion(settings);
  if (version === 1) {
    if (!safeEqualText(rootKey.toString("hex"), settings.encryption_check)) throw new Error("主密码不正确");
    activeLegacyKey = rootKey;
    activeKey = null;
  } else {
    const material = v2KeyMaterial(rootKey);
    if (!safeEqualText(material.verifier, settings.encryption_check)) throw new Error("主密码不正确");
    activeKey = material.encryptionKey;
    activeLegacyKey = rootKey;
  }
  return { ok: true, enabled: true, state:encryptionStatus(settings), version };
}

function enableEncryption(password) {
  const settings = readSecuritySettings();
  if (settings.encryption_enabled || encryptionStatus(settings) !== "disabled") {
    throw new Error("配置加密已启用或正在切换，请先完成当前操作");
  }
  if (String(password || "").length < 8) throw new Error("主密码至少 8 位");
  const salt = crypto.randomBytes(16).toString("hex");
  const rootKey = deriveRootKey(password, salt);
  const material = v2KeyMaterial(rootKey);
  activeKey = material.encryptionKey;
  activeLegacyKey = null;
  writeSecuritySettings({
    encryption_enabled: true,
    encryption_state: "enabling",
    encryption_version: CURRENT_ENCRYPTION_VERSION,
    encryption_salt: salt,
    encryption_check: material.verifier,
    encryption_legacy_check: ""
  });
  return { ok: true, state:"enabling", version:CURRENT_ENCRYPTION_VERSION };
}

function beginDisableEncryption() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return { ok:true, state:"disabled" };
  if (!activeKey && !activeLegacyKey) throw new Error("配置加密已锁定，请先解锁");
  writeSecuritySettings({ encryption_enabled:true, encryption_state:"disabling" });
  return { ok:true, state:"disabling", version:encryptionVersion(settings) };
}

function completeEncryptionEnable() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled || encryptionVersion(settings) !== CURRENT_ENCRYPTION_VERSION) {
    throw new Error("配置加密升级状态无效");
  }
  writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabled",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_legacy_check:""
  });
  activeLegacyKey = null;
  return { ok:true, state:"enabled", version:CURRENT_ENCRYPTION_VERSION };
}

function disableEncryption() {
  activeKey = null;
  activeLegacyKey = null;
  writeSecuritySettings({
    encryption_enabled:false,
    encryption_state:"disabled",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_salt:"",
    encryption_check:"",
    encryption_legacy_check:""
  });
  return { ok:true, state:"disabled", version:CURRENT_ENCRYPTION_VERSION };
}

function beginLegacyEncryptionUpgrade() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled || encryptionVersion(settings) !== 1) return false;
  const rootKey = legacyRootKeyFromCheck(settings.encryption_check);
  const material = v2KeyMaterial(rootKey);
  activeLegacyKey = rootKey;
  activeKey = material.encryptionKey;
  writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabling",
    encryption_version:CURRENT_ENCRYPTION_VERSION,
    encryption_salt:String(settings.encryption_salt || ""),
    encryption_check:material.verifier,
    encryption_legacy_check:String(settings.encryption_check || "")
  });
  return true;
}

function resumeAutomaticLegacyUpgrade() {
  const settings = readSecuritySettings();
  if (
    !settings.encryption_enabled
    || encryptionStatus(settings) !== "enabling"
    || encryptionVersion(settings) !== CURRENT_ENCRYPTION_VERSION
    || !settings.encryption_legacy_check
  ) return false;
  const rootKey = legacyRootKeyFromCheck(settings.encryption_legacy_check);
  const material = v2KeyMaterial(rootKey);
  if (!safeEqualText(material.verifier, settings.encryption_check)) {
    throw new Error("配置加密升级校验不一致，已停止自动修复");
  }
  activeLegacyKey = rootKey;
  activeKey = material.encryptionKey;
  return true;
}

function prepareAutomaticEncryptionUpgrade() {
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return false;
  if (encryptionVersion(settings) === 1) return beginLegacyEncryptionUpgrade();
  return resumeAutomaticLegacyUpgrade();
}

function lockEncryption() {
  activeKey = null;
  activeLegacyKey = null;
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
    transition_pending:state === "enabling" || state === "disabling"
  };
}

function requireEncryptionUnlocked() {
  const state = encryptionState();
  if (state.ready) return state;
  const transition = state.transition_pending
    ? "配置加密切换尚未完成，请先在设置 > 安全中输入主密码继续修复"
    : "配置加密已锁定，请先在设置 > 安全中输入主密码解锁";
  const error: any = new Error(transition);
  error.code = state.transition_pending ? "ENCRYPTION_TRANSITION_PENDING" : "ENCRYPTION_LOCKED";
  error.statusCode = 423;
  throw error;
}

function encryptText(value) {
  if (value == null || value === "") return value;
  const settings = readSecuritySettings();
  if (!settings.encryption_enabled) return value;
  if (!activeKey) throw new Error("配置加密尚未解锁或升级未完成");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", activeKey, iv);
  cipher.setAAD(V2_CIPHERTEXT_AAD);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURRENT_ENCRYPTED_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

function decryptWithKey(text, key, aad = null) {
  const [, , ivText, tagText, dataText] = text.split(":");
  if (!ivText || !tagText || typeof dataText !== "string") throw new Error("配置加密字段格式无效");
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
      const error: any = new Error(transitionPending
        ? "配置加密切换尚未完成，敏感字段已暂停使用"
        : "配置加密状态与数据库敏感字段不一致，请先修复配置加密");
      error.code = transitionPending ? "ENCRYPTION_TRANSITION_PENDING" : "ENCRYPTION_INCONSISTENT";
      error.statusCode = 423;
      throw error;
    }
    return value;
  }
  if (isCurrentEncryptedText(text)) {
    if (!activeKey) return "";
    return decryptWithKey(text, activeKey, V2_CIPHERTEXT_AAD);
  }
  if (!activeLegacyKey) return "";
  return decryptWithKey(text, activeLegacyKey);
}

module.exports = {
  CURRENT_ENCRYPTED_PREFIX,
  CURRENT_ENCRYPTION_VERSION,
  beginDisableEncryption,
  beginLegacyEncryptionUpgrade,
  completeEncryptionEnable,
  decryptText,
  disableEncryption,
  enableEncryption,
  encryptionReady,
  encryptionState,
  encryptText,
  isCurrentEncryptedText,
  isEncryptedText,
  isLegacyEncryptedText,
  lockEncryption,
  prepareAutomaticEncryptionUpgrade,
  requireEncryptionUnlocked,
  unlockEncryption
};
