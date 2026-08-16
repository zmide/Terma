const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");

const NOTIFICATION_FILE = path.join(DATA_DIR, "notifications.json");
const STATE_FILE = path.join(DATA_DIR, "notification-state.json");
const MAX_EVENTS = 300;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const NOTIFICATION_LANGUAGES = new Set(["zh-CN", "en-US"]);
const LOCALE_NAMESPACES = ["common", "navigation", "settings", "connections", "terminal", "sftp", "tasks", "remote", "errors"];

let seq = 0;
const lastSent = new Map();
const activeIssues = new Set(readJson(STATE_FILE, { active: [] }).active || []);
let notificationLocaleCatalog: any = null;

function appendNotificationSystemLog(message: string): void {
  const { appendSystemLog } = require("./logs");
  appendSystemLog(message);
}

function normalizeNotificationLanguage(value) {
  const language = String(value || "").trim();
  return NOTIFICATION_LANGUAGES.has(language) ? language : "zh-CN";
}

function flattenLocaleValues(value, prefix = "", result = new Map()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flattenLocaleValues(child, next, result);
    else if (typeof child === "string") result.set(next, child);
  }
  return result;
}

function compileNotificationTemplate(source, target) {
  const literalText = String(source || "").replace(/{{-?\s*[a-z0-9_.-]+\s*}}/gi, "");
  if (!/[\u3400-\u9fff]/.test(literalText)) return null;
  const names = [];
  let expression = "";
  let offset = 0;
  const tokenPattern = /{{-?\s*([a-z0-9_.-]+)\s*}}/gi;
  for (const match of String(source || "").matchAll(tokenPattern)) {
    expression += String(source).slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expression += "([\\s\\S]+?)";
    names.push(match[1]);
    offset = Number(match.index) + match[0].length;
  }
  if (!names.length) return null;
  expression += String(source).slice(offset).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {expression:new RegExp(`^${expression}$`), names, target:String(target || "")};
}

function readNotificationLocaleCatalog() {
  if (notificationLocaleCatalog) return notificationLocaleCatalog;
  const localeRoot = path.resolve(__dirname, "..", "public", "locales");
  const exact = new Map();
  const templates = [];
  for (const namespace of LOCALE_NAMESPACES) {
    const chinese = flattenLocaleValues(readJson(path.join(localeRoot, "zh-CN", `${namespace}.json`), {}));
    const english = flattenLocaleValues(readJson(path.join(localeRoot, "en-US", `${namespace}.json`), {}));
    for (const [key, source] of chinese) {
      const target = english.get(key);
      if (!target) continue;
      const normalizedSource = String(source).trim();
      if (!normalizedSource) continue;
      exact.set(normalizedSource, target);
      const template = compileNotificationTemplate(normalizedSource, target);
      if (template) templates.push(template);
    }
  }
  templates.sort((left, right) => right.expression.source.length - left.expression.source.length);
  notificationLocaleCatalog = {exact, templates};
  return notificationLocaleCatalog;
}

function renderNotificationTemplate(template, match) {
  const values = new Map(template.names.map((name, index) => [name, match[index + 1]]));
  return template.target.replace(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi, (_token, name) => String(values.get(name) ?? ""));
}

function localizeBatchLogLabel(value) {
  return String(value || "").replace(/批量执行-(\d{1,2})月(\d{1,2})日 (\d{2}:\d{2}:\d{2})(?:（轮转 (\d+)）)?/g, (_all, month, day, time, rotation) => (
    `Batch execution - ${Number(month)}/${Number(day)} ${time}${rotation ? ` (rotation ${rotation})` : ""}`
  ));
}

function localizeUpdateVersionMessage(value) {
  const match = String(value || "").match(/^当前版本 (.+?)，最新版本 (.+?)(?:（(.+?)）)?。$/);
  if (!match) return String(value || "");
  return `Current version: ${match[1]}; latest version: ${match[2]}${match[3] ? ` (${match[3]})` : ""}.`;
}

function localizeNotificationSegment(value, language) {
  const source = String(value || "");
  if (normalizeNotificationLanguage(language) !== "en-US" || !source) return source;
  const catalog = readNotificationLocaleCatalog();
  const updateMessage = localizeUpdateVersionMessage(source);
  if (updateMessage !== source) return updateMessage;
  const prepared = localizeBatchLogLabel(source);
  if (prepared !== source && !/[\u3400-\u9fff]/.test(prepared)) return prepared;
  const exact = catalog.exact.get(prepared) || catalog.exact.get(source);
  if (exact) return exact;
  for (const template of catalog.templates) {
    const match = prepared.match(template.expression);
    if (match) return renderNotificationTemplate(template, match);
  }
  return prepared;
}

function localizeNotificationText(value, language) {
  const source = String(value || "");
  if (normalizeNotificationLanguage(language) !== "en-US" || !source) return source;
  const whole = localizeNotificationSegment(source, language);
  if (whole !== source && !/[\u3400-\u9fff]/.test(whole)) return whole;
  return source.split("\n").map(line => localizeNotificationSegment(line, language)).join("\n");
}

function localizeNotificationEvent(event, language) {
  const normalized = normalizeNotificationLanguage(language);
  if (normalized === "zh-CN") return {...event};
  const action = event?.action && typeof event.action === "object"
    ? {...event.action, ...(event.action.title ? {title:localizeNotificationText(event.action.title, normalized)} : {})}
    : event?.action;
  return {
    ...event,
    title:localizeNotificationText(event?.title, normalized),
    message:localizeNotificationText(event?.message, normalized),
    action
  };
}

function readJson(file, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readEvents() {
  const data = readJson(NOTIFICATION_FILE, { events: [] });
  return Array.isArray(data.events) ? data.events : [];
}

function writeEvents(events) {
  writeJson(NOTIFICATION_FILE, { events: events.slice(-MAX_EVENTS) });
}

function saveState() {
  writeJson(STATE_FILE, { active: [...activeIssues] });
}

function nextId() {
  seq = (seq + 1) % 100000;
  return Date.now() * 100000 + seq;
}

function addNotification(event) {
  const item = {
    id: nextId(),
    time: Date.now(),
    type: event.type || "system",
    level: event.level || "info",
    title: String(event.title || "Terma"),
    message: String(event.message || ""),
    key: event.key || "",
    action: event.action || null
  };
  const events = readEvents();
  events.push(item);
  writeEvents(events);
  appendNotificationSystemLog(`通知：${item.title}${item.message ? `：${item.message}` : ""}`);
  return item;
}

function notifyEvent(event, options: any = {}) {
  const key = event.key || `${event.type || "system"}:${event.title || ""}`;
  const cooldownMs = Number(options.cooldown_ms ?? event.cooldown_ms ?? DEFAULT_COOLDOWN_MS);
  const now = Date.now();
  const last = Number(lastSent.get(key) || 0);
  if (cooldownMs > 0 && now - last < cooldownMs) return null;
  lastSent.set(key, now);
  return addNotification({ ...event, key });
}

function notifyIssue(key, event, options: any = {}) {
  activeIssues.add(key);
  saveState();
  return notifyEvent({ ...event, key }, options);
}

function notifyRecovery(key, event, options: any = {}) {
  if (!activeIssues.has(key)) return null;
  activeIssues.delete(key);
  saveState();
  return notifyEvent({ level: "success", ...event, key: `${key}:recovered` }, { cooldown_ms: options.cooldown_ms ?? 0 });
}

function listNotifications(since = 0, language = "zh-CN") {
  const minId = Number(since || 0);
  return readEvents()
    .filter((event) => Number(event.id) > minId)
    .map((event) => localizeNotificationEvent(event, language));
}

module.exports = {
  listNotifications,
  localizeNotificationEvent,
  localizeNotificationText,
  normalizeNotificationLanguage,
  notifyEvent,
  notifyIssue,
  notifyRecovery
};
