const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const languages = ["zh-CN", "en-US"];
const namespaces = ["common", "navigation", "settings", "connections", "terminal", "sftp", "tasks", "remote", "errors", "login"];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function flatten(value, prefix="", result=new Map()) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `locale node ${prefix || "<root>"} must be an object`);
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, next, result);
    else {
      assert.equal(typeof child, "string", `locale leaf ${next} must be a string`);
      assert.equal(/<\/?[a-z][^>]*>/i.test(child), false, `locale leaf ${next} must not contain HTML`);
      result.set(next, child);
    }
  }
  return result;
}

function interpolationKeys(value) {
  return [...value.matchAll(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi)].map(match => match[1]).sort();
}

const resources = new Map();
for (const language of languages) {
  for (const namespace of namespaces) {
    const relative = path.join("public", "locales", language, `${namespace}.json`);
    const flattened = flatten(JSON.parse(read(relative)));
    assert.ok(flattened.size > 0, `${language}/${namespace} must not be empty`);
    resources.set(`${language}/${namespace}`, flattened);
  }
}

for (const namespace of namespaces) {
  const chinese = resources.get(`zh-CN/${namespace}`);
  const english = resources.get(`en-US/${namespace}`);
  assert.deepEqual([...english.keys()].sort(), [...chinese.keys()].sort(), `${namespace} locale keys must match`);
  for (const key of chinese.keys()) {
    assert.deepEqual(interpolationKeys(english.get(key)), interpolationKeys(chinese.get(key)), `${namespace}:${key} interpolation parameters must match`);
    assert.equal(/[\u3400-\u9fff]/.test(english.get(key)), false, `en-US ${namespace}:${key} must not contain Chinese UI text`);
  }
}

function sourceLineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function localeHasLiteralKey(namespace, key) {
  const chinese = resources.get(`zh-CN/${namespace}`);
  const english = resources.get(`en-US/${namespace}`);
  if (!chinese || !english) return false;
  if (chinese.has(key) && english.has(key)) return true;
  return chinese.has(`${key}_one`) && chinese.has(`${key}_other`)
    && english.has(`${key}_one`) && english.has(`${key}_other`);
}

const literalTrErrors = [];
for (const entry of fs.readdirSync(path.join(root, "public"), {withFileTypes:true})) {
  if (!entry.isFile() || !/^app(?:-[a-z0-9-]+)?\.js$/i.test(entry.name)) continue;
  const relative = path.posix.join("public", entry.name);
  const source = read(relative);
  const expression = /\btr\(\s*(["'`])([a-z][a-z0-9_-]*):([a-z0-9_.-]+)\1/gi;
  for (const match of source.matchAll(expression)) {
    const [, , namespace, key] = match;
    if (localeHasLiteralKey(namespace, key)) continue;
    literalTrErrors.push(`${relative}:${sourceLineAt(source, match.index)} ${namespace}:${key}`);
  }
}
assert.deepEqual(literalTrErrors, [], `literal tr() keys missing from bilingual locale resources:\n${literalTrErrors.join("\n")}`);

const expectedDirectFetchCounts = new Map([
  ["public/app-api.js", 1],
  ["public/app-connection-form.js", 1],
  ["public/app-i18n.js", 1],
  ["public/app-import.js", 5],
  ["public/app-remote-ftp.js", 1],
  ["public/app-settings-storage.js", 1],
  ["public/app-sftp-open.js", 1],
  ["public/login.js", 2]
]);
const actualDirectFetchCounts = new Map();
for (const entry of fs.readdirSync(path.join(root, "public"), {withFileTypes:true})) {
  if (!entry.isFile() || !/\.js$/i.test(entry.name)) continue;
  const relative = path.posix.join("public", entry.name);
  const count = [...read(relative).matchAll(/\bfetch\s*\(/g)].length;
  if (count) actualDirectFetchCounts.set(relative, count);
}
assert.deepEqual(
  [...actualDirectFetchCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  [...expectedDirectFetchCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  "public direct fetch inventory changed; review every non-2xx path and register its structured error boundary"
);
for (const relative of [
  "public/app-connection-form.js",
  "public/app-import.js",
  "public/app-remote-ftp.js",
  "public/app-settings-storage.js",
  "public/app-sftp-open.js"
]) {
  const source = read(relative);
  const fetchCount = expectedDirectFetchCounts.get(relative);
  const structuredErrorCount = [...source.matchAll(/\bapiErrorFromResponse\s*\(/g)].length;
  assert.ok(
    structuredErrorCount >= fetchCount,
    `${relative} direct fetch non-2xx paths must use apiErrorFromResponse()`
  );
  assert.match(source, /if\s*\(\s*!\s*(?:res|response)\.ok\s*\)/, `${relative} must check the direct fetch response status`);
}
const apiTransportSource = read("public/app-api.js");
assert.match(apiTransportSource, /if\s*\(\s*!res\.ok\s*\)[\s\S]*?localizedBackendPublicError\(data, rawMessage\)/, "api() must localize structured non-2xx responses");
assert.match(apiTransportSource, /async function apiErrorFromResponse\([\s\S]*?localizedBackendPublicError\(data, rawMessage\)/, "binary, stream, and multipart fetches need the shared structured error parser");
const i18nTransportSource = read("public/app-i18n.js");
assert.match(i18nTransportSource, /fetch\(`\/locales\/[\s\S]*?if\s*\(\s*!response\.ok\s*\)/, "locale resource fetches must reject non-2xx responses explicitly");

const loginScriptRelative = "public/login.js";
const loginScript = read(loginScriptRelative);
assert.match(loginScript, /async function loginErrorFromResponse\([\s\S]*?response\.text\(\)/, "the standalone login page must parse non-2xx response bodies");
assert.match(loginScript, /function localizedLoginError\([\s\S]*?data\.error_code/, "the standalone login page must localize stable backend error codes");
assert.match(loginScript, /const failure = await loginErrorFromResponse\(response\)/, "login fetch failures must use the standalone structured error parser");
const loginLiteralKeys = new Map();
for (const match of loginScript.matchAll(/\bloginTr\(\s*(["'`])([a-z0-9_.-]+)\1/gi)) {
  loginLiteralKeys.set(match[2], match.index);
}
for (const match of loginScript.matchAll(/\bloginTr\(\s*[^?,()]+\?\s*(["'`])([a-z0-9_.-]+)\1\s*:\s*(["'`])([a-z0-9_.-]+)\3/gi)) {
  loginLiteralKeys.set(match[2], match.index);
  loginLiteralKeys.set(match[4], match.index);
}
const loginLiteralErrors = [];
for (const [key, offset] of loginLiteralKeys) {
  if (localeHasLiteralKey("login", key)) continue;
  loginLiteralErrors.push(`${loginScriptRelative}:${sourceLineAt(loginScript, offset)} login:${key}`);
}
assert.deepEqual(loginLiteralErrors, [], `literal loginTr() keys missing from bilingual login resources:\n${loginLiteralErrors.join("\n")}`);

const chinesePhrases = new Set();
const chineseTemplates = [];
for (const namespace of namespaces) {
  for (const value of resources.get(`zh-CN/${namespace}`).values()) {
    const source = value.trim();
    chinesePhrases.add(source);
    if (!source.includes("{{")) continue;
    const expression = source
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{\\\{-?\s*[a-z0-9_.-]+\s*\\\}\\\}/gi, ".+?");
    chineseTemplates.push(new RegExp(`^${expression}$`));
  }
}
assert.ok(chinesePhrases.size >= 300, "the bilingual UI phrase catalog is unexpectedly small");

function phraseSkeleton(value) {
  return String(value || "")
    .trim()
    .replace(/{{-?\s*[a-z0-9_.-]+\s*}}/gi, "{{}}")
    .replace(/\s+/g, " ");
}

function sourceLiteralText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return `${node.head.text}${node.templateSpans.map(span => `{{}}${span.literal.text}`).join("")}`;
}

function sourceCallName(call) {
  if (!ts.isCallExpression(call)) return "";
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return "";
}

function sourceLiteralInsideTranslation(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && ["tr", "loginTr"].includes(sourceCallName(current))) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

function sourcePropertyName(property) {
  if (!property?.name) return "";
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return "";
}

function sourceLiteralIsSearchAlias(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isPropertyAssignment(current) && sourcePropertyName(current) === "search") return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

function sourceLiteralIsCompatibilityMapEntry(node) {
  const property = ts.isPropertyAssignment(node.parent) && node.parent.name === node ? node.parent : null;
  const array = property?.initializer && ts.isArrayLiteralExpression(property.initializer)
    ? property.initializer
    : ts.isArrayLiteralExpression(node.parent)
      ? node.parent
      : null;
  if (!array) return false;
  const localeKey = array.elements[0];
  if (!localeKey || !ts.isStringLiteral(localeKey)) return false;
  const match = /^([a-z][a-z0-9_-]*):([a-z0-9_.-]+)$/i.exec(localeKey.text);
  return Boolean(match && localeHasLiteralKey(match[1], match[2]));
}

function sourceLiteralIsFallbackCompatibilityEntry(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isVariableDeclaration(current)
      && ts.isIdentifier(current.name)
      && current.name.text === "TERMA_I18N_FALLBACK_REPLACEMENTS") return true;
    if (ts.isStatement(current) && !ts.isVariableStatement(current)) return false;
  }
  return false;
}

const chinesePhraseSkeletons = new Set([...chinesePhrases].map(phraseSkeleton));
const frontendLiteralErrors = [];
const frontendSourceEntries = fs.readdirSync(path.join(root, "public"), {withFileTypes:true})
  .filter(entry => entry.isFile() && (/^app(?:-[a-z0-9-]+)?\.js$/i.test(entry.name) || ["login.js", "sftp-open-worker.js"].includes(entry.name)));
for (const entry of frontendSourceEntries) {
  const relative = path.posix.join("public", entry.name);
  const sourceText = read(relative);
  const source = ts.createSourceFile(relative, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    const value = sourceLiteralText(node);
    if (value && /[\u3400-\u9fff]/.test(value) && !sourceLiteralInsideTranslation(node)) {
      const covered = chinesePhrases.has(value.trim()) || chinesePhraseSkeletons.has(phraseSkeleton(value));
      if (!covered
        && !sourceLiteralIsSearchAlias(node)
        && !sourceLiteralIsCompatibilityMapEntry(node)
        && !sourceLiteralIsFallbackCompatibilityEntry(node)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        frontendLiteralErrors.push(`${relative}:${position.line + 1} ${phraseSkeleton(value)}`);
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(
  frontendLiteralErrors,
  [],
  `frontend Chinese source literals must have bilingual locale resources or an audited non-UI compatibility boundary:\n${frontendLiteralErrors.join("\n")}`
);

const i18nRuntimeSource = read("public/app-i18n.js");
const i18nRuntimeAst = ts.createSourceFile("public/app-i18n.js", i18nRuntimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let fallbackReplacementArray = null;
const fallbackReplacementLiteral = initializer => {
  let value = initializer;
  if (ts.isCallExpression(value)
    && ts.isPropertyAccessExpression(value.expression)
    && ts.isIdentifier(value.expression.expression)
    && value.expression.expression.text === "Object"
    && value.expression.name.text === "freeze"
    && value.arguments.length === 1) {
    value = value.arguments[0];
  }
  if (ts.isCallExpression(value)
    && ts.isPropertyAccessExpression(value.expression)
    && value.expression.name.text === "sort"
    && ts.isArrayLiteralExpression(value.expression.expression)) {
    return value.expression.expression;
  }
  return null;
};
const findFallbackReplacements = node => {
  if (ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "TERMA_I18N_FALLBACK_REPLACEMENTS") {
    fallbackReplacementArray = fallbackReplacementLiteral(node.initializer);
  }
  ts.forEachChild(node, findFallbackReplacements);
};
findFallbackReplacements(i18nRuntimeAst);
assert.ok(fallbackReplacementArray, "the legacy phrase compatibility table must remain a statically auditable array");
const fallbackChinesePhrases = new Set();
for (const entry of fallbackReplacementArray.elements) {
  assert.ok(ts.isArrayLiteralExpression(entry) && entry.elements.length === 2, "each legacy phrase compatibility row must contain a Chinese and English pair");
  const [chinese, english] = entry.elements;
  assert.ok(ts.isStringLiteral(chinese) && ts.isStringLiteral(english), "legacy phrase compatibility pairs must use literal strings");
  assert.match(chinese.text, /[\u3400-\u9fff\uff01-\uff60]/, "legacy phrase compatibility sources must contain Chinese text or full-width Chinese punctuation");
  assert.doesNotMatch(english.text, /[\u3400-\u9fff]/, `legacy phrase compatibility English text must not contain Chinese: ${chinese.text}`);
  assert.equal(fallbackChinesePhrases.has(chinese.text), false, `duplicate legacy phrase compatibility source: ${chinese.text}`);
  fallbackChinesePhrases.add(chinese.text);
}

function sourceNodeLiteralValues(node, result=[]) {
  if (!node) return result;
  const value = sourceLiteralText(node);
  if (value !== null) {
    result.push(value);
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) sourceNodeLiteralValues(span.expression, result);
    }
    return result;
  }
  ts.forEachChild(node, child => { sourceNodeLiteralValues(child, result); });
  return result;
}

function sourceContainingCallArgument(call, node) {
  return call.arguments.find(argument => node.pos >= argument.pos && node.end <= argument.end) || null;
}

function sourceLiteralInsideNamedFunction(node, name) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) && current.name?.text === name) return true;
  }
  return false;
}

const desktopTextSelectors = new Set([
  "desktopUiText",
  "desktopNotificationText",
  "migrationText",
  "storageMigrationText",
  "windowsRdpCredentialText",
  "text"
]);
const desktopLiteralErrors = [];
for (const entry of fs.readdirSync(path.join(root, "desktop"), {withFileTypes:true})) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const relative = path.posix.join("desktop", entry.name);
  const sourceText = read(relative);
  const source = ts.createSourceFile(relative, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    const value = sourceLiteralText(node);
    if (value && /[\u3400-\u9fff]/.test(value)) {
      let selectorCall = null;
      for (let current = node.parent; current; current = current.parent) {
        if (ts.isCallExpression(current) && desktopTextSelectors.has(sourceCallName(current))) {
          selectorCall = current;
          break;
        }
        if (ts.isStatement(current)) break;
      }
      const chineseArgument = selectorCall ? sourceContainingCallArgument(selectorCall, node) : null;
      const hasEnglishPair = Boolean(selectorCall && selectorCall.arguments.some(argument => (
        argument !== chineseArgument
        && sourceNodeLiteralValues(argument).some(candidate => candidate && !/[\u3400-\u9fff]/.test(candidate) && /[a-z]/i.test(candidate))
      )));
      const legacyDataPattern = relative === "desktop/brand-data-migration.js"
        && sourceLiteralInsideNamedFunction(node, "isLegacyCopyName");
      if ((!selectorCall || !hasEnglishPair) && !legacyDataPattern) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        desktopLiteralErrors.push(`${relative}:${position.line + 1} ${phraseSkeleton(value)}`);
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(
  desktopLiteralErrors,
  [],
  `desktop Chinese source literals must use a bilingual selector with an English pair:\n${desktopLiteralErrors.join("\n")}`
);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.dependencies?.i18next, "26.3.6", "i18next must use the reviewed exact runtime version");
assert.equal(fs.existsSync(path.join(root, "node_modules", "i18next", "dist", "umd", "i18next.min.js")), true);
function assertServedVendorAssetWithoutChinese(relative) {
  assert.equal(/[\u3400-\u9fff]/.test(read(relative)), false, `${relative} must not contain bundled Chinese UI text`);
}

const staticContentSource = read("src/static-content-handler.ts");
const mappedVendorAssets = [
  ...staticContentSource.matchAll(/\[\s*"\/vendor\/[^"]+"\s*,\s*vendorFile\("([^"]+)",\s*"([^"]+)"\)\s*\]/g),
  ...staticContentSource.matchAll(/VENDOR_FILES\.set\(\s*"\/vendor\/[^"]+"\s*,\s*vendorFile\("([^"]+)",\s*"([^"]+)"\)\s*\)/g)
].map(match => path.join("node_modules", match[1], match[2]));
const servedVendorAssets = [...mappedVendorAssets, path.join("public", "vendor", "zmodem.js")];
assert.equal(servedVendorAssets.length, 12, "the static content handler vendor file map changed; review the served i18n scan boundary");
servedVendorAssets.forEach(assertServedVendorAssetWithoutChinese);

const aceVendorDirectory = path.join("node_modules", "ace-builds", "src-min-noconflict");
const servedAceAssets = fs.readdirSync(path.join(root, aceVendorDirectory), {withFileTypes:true})
  .filter(entry => entry.isFile() && /^(?:ace|mode-[a-z0-9_-]+|theme-[a-z0-9_-]+|worker-[a-z0-9_-]+|ext-[a-z0-9_-]+)\.js$/i.test(entry.name))
  .map(entry => path.join(aceVendorDirectory, entry.name));
assert.ok(servedAceAssets.length > 0, "the served Ace asset allowlist must not be empty");
servedAceAssets.forEach(assertServedVendorAssetWithoutChinese);
const sftpOpenWorker = read("public/sftp-open-worker.js");
assert.equal(/[\u3400-\u9fff]/.test(sftpOpenWorker), false, "SFTP text decoder worker must return stable error codes instead of Chinese UI text");
for (const errorCode of ["binary_content", "unsupported_encoding", "decode_failed"]) {
  assert.ok(sftpOpenWorker.includes(errorCode), `SFTP text decoder worker is missing ${errorCode}`);
}
const sftpOpenFrontend = read("public/app-sftp-open.js");
for (const resourceKey of ["binary_content", "unsupported_encoding", "parse_failed"]) {
  assert.ok(sftpOpenFrontend.includes(resourceKey), `SFTP text decoder UI is missing the ${resourceKey} translation mapping`);
}
const x11Frontend = read("public/app-x11.js");
for (const resourceKey of ["install_terminal_finished", "manual_install_terminal_prompt", "config_terminal_finished"]) {
  assert.ok(x11Frontend.includes(`common:x11.${resourceKey}`), `X11 terminal prompt is missing common:x11.${resourceKey}`);
}
assert.match(x11Frontend, /function x11ShellSingleQuote\(/, "X11 terminal prompts must use POSIX-safe single-quote escaping");
assert.match(x11Frontend, /x11ShellPrintfLine\(finishedMessage/, "X11 terminal completion prompts must not be embedded as shell source literals");
assert.match(x11Frontend, /function xServerReasonText\(/, "X Server diagnostics must resolve stable reason codes in the active UI language");
assert.doesNotMatch(x11Frontend, /notify\(diagnostics\.reason\s*\|\|/, "X Server notifications must not insert a raw fixed reason");
assert.doesNotMatch(x11Frontend, /reason:\s*diagnostics\.reason/, "X Server confirmation text must not insert a raw fixed reason");
assert.doesNotMatch(x11Frontend, /translatedTermaPhrase\(rawStateReason\)/, "X Server status must use reason_code instead of phrase guessing");
const desktopIntegrationRoutes = read("src/routes/desktop-integration-routes.ts");
assert.match(desktopIntegrationRoutes, /function withXServerDiagnosticsReasonContract\(/, "the X Server API must expose a stable reason contract");
assert.match(desktopIntegrationRoutes, /reason_code:reasonCode[\s\S]*?reason_params:\{\}[\s\S]*?reason_preserve_message:false/, "desktop integration fallback diagnostics must expose reason_code and params");
assert.match(read("desktop/xserver-runtime.js"), /reason_preserve_message:Boolean\(lastError\)/, "desktop X Server diagnostics must mark raw startup errors for preservation");
const x11ManagementService = read("src/services/x11-management-service.ts");
assert.match(x11ManagementService, /reason_code:platform !== "linux"[\s\S]*?x11_clipboard_not_installed/, "X11 clipboard diagnostics must expose stable reason codes");
for (const directory of [path.join("node_modules", "@novnc", "novnc", "core"), path.join("node_modules", "@novnc", "novnc", "vendor")]) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(path.join(root, current), {withFileTypes:true})) {
      const relative = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(relative);
      else if (/\.js$/i.test(entry.name)) assertServedVendorAssetWithoutChinese(relative);
    }
  }
}
const html = read("public/index.html");
const staticContent = staticContentSource;
const loginPageMatch = staticContent.match(/function loginPage\(\)\s*\{\s*return\s*`([\s\S]*?)`;\s*\}/);
assert.ok(loginPageMatch, "src/static-content-handler.ts must contain a static loginPage() template");
const loginHtml = loginPageMatch[1];
const loginHtmlOffset = loginPageMatch.index + loginPageMatch[0].indexOf(loginHtml);
const loginSourceLineAt = offset => sourceLineAt(staticContent, loginHtmlOffset + offset);

function htmlAttributeMap(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) attributes.set(match[1].toLowerCase(), match[2]);
  return attributes;
}

const loginHtmlLocaleKeyErrors = [];
const loginTemplateKeys = new Set();
for (const match of loginHtml.matchAll(/\bdata-login-i18n="([^"]+)"/gi)) {
  const key = match[1].trim();
  loginTemplateKeys.add(key);
  if (/^[a-z0-9_.-]+$/i.test(key) && localeHasLiteralKey("login", key)) continue;
  loginHtmlLocaleKeyErrors.push(`src/static-content-handler.ts:${loginSourceLineAt(match.index)} data-login-i18n=${key}`);
}
assert.deepEqual(loginHtmlLocaleKeyErrors, [], `login HTML i18n keys missing from bilingual login resources:\n${loginHtmlLocaleKeyErrors.join("\n")}`);
const uncoveredLoginLocaleKeys = [...resources.get("zh-CN/login").keys()]
  .filter(key => !loginLiteralKeys.has(key) && !loginTemplateKeys.has(key));
assert.deepEqual(uncoveredLoginLocaleKeys, [], `login locale keys must be referenced by loginTr() or data-login-i18n: ${uncoveredLoginLocaleKeys.join(" | ")}`);

const loginFallbackErrors = [];
for (const match of loginHtml.matchAll(/<([a-z][a-z0-9-]*)\b([^<>]*?)>([^<]*)<\/\1>/gi)) {
  const attributes = htmlAttributeMap(match[2]);
  const key = attributes.get("data-login-i18n");
  if (!key) continue;
  const value = match[3].replace(/&[^;]+;/g, " ").trim();
  const expected = resources.get("zh-CN/login").get(key);
  if (value === expected) continue;
  loginFallbackErrors.push(`src/static-content-handler.ts:${loginSourceLineAt(match.index)} login:${key}=${value}`);
}
assert.deepEqual(loginFallbackErrors, [], `login HTML Chinese fallbacks must match their locale keys:\n${loginFallbackErrors.join("\n")}`);

const loginTextErrors = [];
for (const match of loginHtml.matchAll(/<([a-z][a-z0-9-]*)\b([^<>]*?)>([^<]*[\u3400-\u9fff][^<]*)<\/\1>/gi)) {
  const attributes = htmlAttributeMap(match[2]);
  const value = match[3].replace(/&[^;]+;/g, " ").trim();
  if (attributes.has("data-login-i18n") || (attributes.get("id") === "languageToggle" && value === "文/A")) continue;
  loginTextErrors.push(`src/static-content-handler.ts:${loginSourceLineAt(match.index)} <${match[1]}> ${value}`);
}
assert.deepEqual(loginTextErrors, [], `static login HTML text requires explicit data-login-i18n keys:\n${loginTextErrors.join("\n")}`);

const loginDynamicAttributes = new Map([
  ["languageToggle", ["title", "aria-label"]],
  ["passwordToggle", ["title", "aria-label"]]
]);
const loginControlTags = new Map();
const loginAttributeErrors = [];
for (const match of loginHtml.matchAll(/<([a-z][a-z0-9-]*)\b([^<>]*?)>/gi)) {
  const attributes = htmlAttributeMap(match[2]);
  const id = attributes.get("id");
  if (loginDynamicAttributes.has(id)) loginControlTags.set(id, {attributes, offset:match.index});
  for (const attribute of ["title", "aria-label", "placeholder"]) {
    const value = String(attributes.get(attribute) || "");
    if (!/[\u3400-\u9fff]/.test(value)) continue;
    if (loginDynamicAttributes.get(id)?.includes(attribute)) continue;
    loginAttributeErrors.push(`src/static-content-handler.ts:${loginSourceLineAt(match.index)} ${attribute}=${value}`);
  }
}
assert.deepEqual(loginAttributeErrors, [], `static translatable login HTML attributes require a runtime translation boundary:\n${loginAttributeErrors.join("\n")}`);
for (const [id, dynamicAttributes] of loginDynamicAttributes) {
  const control = loginControlTags.get(id);
  assert.ok(control, `login HTML must contain #${id}`);
  for (const attribute of dynamicAttributes) {
    assert.ok(/[\u3400-\u9fff]/.test(String(control.attributes.get(attribute) || "")), `#${id} must provide a Chinese ${attribute} fallback`);
    const expression = attribute === "title"
      ? new RegExp(`\\b${id}\\.title\\s*=`)
      : new RegExp(`\\b${id}\\.setAttribute\\(\\s*["']aria-label["']\\s*,`);
    assert.match(loginScript, expression, `public/login.js must update #${id} ${attribute} when the language changes`);
  }
}

const htmlLocaleKeyErrors = [];
for (const match of html.matchAll(/\b(data-i18n(?:-(?:title|placeholder|aria-label))?)="([^"]+)"/gi)) {
  const attribute = match[1];
  const value = match[2].trim();
  const keyMatch = value.match(/^([a-z][a-z0-9_-]*):([a-z0-9_.-]+)$/i);
  if (!keyMatch || !localeHasLiteralKey(keyMatch[1], keyMatch[2])) {
    htmlLocaleKeyErrors.push(`public/index.html:${sourceLineAt(html, match.index)} ${attribute}=${value}`);
  }
}
assert.deepEqual(htmlLocaleKeyErrors, [], `HTML i18n keys missing from bilingual locale resources:\n${htmlLocaleKeyErrors.join("\n")}`);

const htmlAttributeErrors = [];
for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^<>]*?)>/gi)) {
  const attributes = htmlAttributeMap(match[2]);
  for (const [attribute, keyAttribute] of [
    ["title", "data-i18n-title"],
    ["placeholder", "data-i18n-placeholder"],
    ["aria-label", "data-i18n-aria-label"]
  ]) {
    const value = String(attributes.get(attribute) || "");
    if (!/[\u3400-\u9fff]/.test(value) || attributes.has(keyAttribute) || attributes.has("data-i18n-skip")) continue;
    htmlAttributeErrors.push(`public/index.html:${sourceLineAt(html, match.index)} ${attribute}=${value}`);
  }
}
assert.deepEqual(htmlAttributeErrors, [], `static translatable HTML attributes require explicit data-i18n-* keys:\n${htmlAttributeErrors.join("\n")}`);

const htmlWithoutExecutableContent = html
  .replace(/<!--([\s\S]*?)-->/g, "")
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "");
const htmlTextErrors = [];
for (const match of htmlWithoutExecutableContent.matchAll(/<([a-z][a-z0-9-]*)\b([^<>]*?)>([^<]*[\u3400-\u9fff][^<]*)<\/\1>/gi)) {
  const attributes = htmlAttributeMap(match[2]);
  if (attributes.has("data-i18n") || attributes.has("data-i18n-skip")) continue;
  const value = match[3].replace(/&[^;]+;/g, " ").trim();
  if (value) htmlTextErrors.push(`public/index.html:${sourceLineAt(htmlWithoutExecutableContent, match.index)} <${match[1]}> ${value}`);
}
assert.deepEqual(htmlTextErrors, [], `static HTML text requires explicit data-i18n keys:\n${htmlTextErrors.join("\n")}`);

const vendorAt = html.indexOf('/vendor/i18next/i18next.min.js');
const bootstrapAt = html.indexOf('/app-i18n.js');
const apiAt = html.indexOf('/app-api.js');
assert.ok(vendorAt >= 0 && bootstrapAt > vendorAt && apiAt > bootstrapAt, "i18next vendor and bootstrap scripts must load before application modules");
assert.ok(staticContent.includes('["/vendor/i18next/i18next.min.js", vendorFile("i18next", "dist/umd/i18next.min.js")]'));
const runtimeSettings = read("src/runtime-settings.ts");
assert.ok(runtimeSettings.includes("schema_version: 15") && runtimeSettings.includes("language: normalizeLanguage") && runtimeSettings.includes("language_onboarding_version") && runtimeSettings.includes("vnc_fullscreen_toolbar"));
const i18nBootstrap = read("public/app-i18n.js");
const frontend = `${i18nBootstrap}\n${read("public/app-settings-runtime.js")}\n${read("public/app-settings.js")}`;
for (const token of ["setTermaLanguage", "registerTermaI18nRenderer", "toggleTermaLanguage", "syncTermaLanguageControls", "termaI18nPhraseTemplates"]) {
  assert.ok(frontend.includes(token), `i18n frontend boundary is missing ${token}`);
}
assert.equal(html.includes('id="interfaceLanguage"'), false, "the removed settings-page language selector must not return");
assert.match(html, /id="languageToggle"[^>]*data-action="static-language-toggle"/);
assert.match(html, /id="mobileLanguageToggle"[^>]*data-action="static-language-toggle"/);
assert.ok(html.indexOf('id="languageToggle"') < html.indexOf('id="themeToggle"'), "desktop language toggle must be above the theme toggle");
assert.ok(html.indexOf('id="mobileLanguageToggle"') < html.indexOf('class="mobile-brand-action theme-toggle'), "mobile language toggle must precede the theme toggle");
assert.match(read("public/app-static-actions.js"), /registerTermaAction\("static-language-toggle", \(\) => toggleTermaLanguage\(\)\)/);
assert.match(read("public/app-i18n.js"), /roots\.includes\(document\) \|\| roots\.length > 32/);
assert.match(read("public/app-i18n.js"), /termaI18nSkipped\(candidate\)/);
assert.match(read("public/app-i18n.js"), /\[data-i18n-aria-label\]/, "explicit aria-label translations must be supported");
assert.match(i18nBootstrap, /async function ensureTermaI18nResourceBundles\(/, "native language choices must be able to load a missing locale bundle on demand");
assert.match(read("public/app-settings-runtime.js"), /ensureTermaI18nResourceBundles\(\["en-US", "zh-CN"\], \["common", "settings"\]\)/, "language onboarding must load both native choice resources before rendering");
assert.match(i18nBootstrap, /right\.literalLength - left\.literalLength/, "parameterized phrases must prefer the most specific template");
assert.match(i18nBootstrap, /return \/\[\\u3400-\\u9fff\]\/\.test\(output\) \? source : output;/, "word fallback must not emit mixed Chinese-English text");
assert.match(i18nBootstrap, /tab\.kind === "welcome"[\s\S]*common:workspace\.welcome_subtitle/, "the open welcome tab subtitle must refresh when the language changes");
const themeFrontend = read("public/app-utils.js");
assert.match(themeFrontend, /function syncThemeToggleControls\(/, "theme toggle labels must have a dedicated live localization boundary");
assert.match(themeFrontend, /registerTermaI18nRenderer\(\(\) => syncThemeToggleControls\(\)\)/, "theme toggle labels must refresh when the language changes");
assert.doesNotMatch(html, /class="file-picker-name"[^>]*data-i18n-skip/, "empty static file pickers must remain translatable");
assert.match(themeFrontend, /else if \(files\.length === 1\)[\s\S]*?removeAttribute\("data-i18n"\)[\s\S]*?setAttribute\("data-i18n-skip", "true"\)[\s\S]*?files\[0\]\.name/, "selected user filenames must be excluded from translation");
assert.match(themeFrontend, /data\.filePickerCount|dataset\.filePickerCount/, "multi-file selections must retain their count for live localization");
assert.match(themeFrontend, /registerTermaI18nRenderer\(\(\) => syncFilePickerLabels\(\)\)/, "multi-file selection counts must refresh when the language changes");
assert.match(themeFrontend, /else \{[\s\S]*?removeAttribute\("data-i18n-skip"\)[\s\S]*?setAttribute\("data-i18n", "common:auto\.not_selected"\)/, "cleared file pickers must restore the bilingual empty-state key");
const connectionHealthFrontend = read("public/app-connection-health.js");
assert.match(connectionHealthFrontend, /diagnosis\.reason_code/, "connection health must localize SSH failures by stable diagnosis code");
assert.match(connectionHealthFrontend, /ssh\.preserve_raw_output === true/, "connection health must preserve only explicitly marked raw SSH output");
assert.equal(connectionHealthFrontend.includes("diagnosis.display"), false, "connection health must not render the backend's fixed Chinese SSH diagnosis display directly");
const aceFrontend = read("public/app-sftp.js");
assert.ok(aceFrontend.includes("function syncTermaAceEditorChrome("), "Ace instances must expose a live localization refresh boundary");
assert.ok(aceFrontend.includes("renderer?.updateFull?.(true)"), "Ace localization must redraw existing fold and annotation chrome");
assert.ok(aceFrontend.includes("editor.textInput?.setAriaOptions?.({setLabel:true})"), "Ace localization must refresh existing accessibility labels");
const zmodemFrontend = read("public/app-terminal-zmodem.js");
assert.ok(zmodemFrontend.includes("function syncTerminalZmodemLocalization("), "ZMODEM panels must expose a live localization refresh boundary");
assert.ok(zmodemFrontend.includes("registerTermaI18nRenderer(() => syncTerminalZmodemLocalization())"), "ZMODEM panels must refresh when the language changes");
assert.ok(zmodemFrontend.includes("function terminalZmodemViewText("), "ZMODEM live localization must retain structured translation keys and parameters");
assert.equal(zmodemFrontend.includes("translatedTermaPhrase"), false, "ZMODEM live localization must not translate rendered user filenames or paths heuristically");
const uiSmoke = read("scripts/ui-smoke-electron.js");
assert.match(uiSmoke, /\['title','aria-label','placeholder'\]/, "English UI smoke must inspect translatable attributes");
assert.match(uiSmoke, /collectVisibleHan\('document', true\)/, "English UI smoke must inspect hidden rendered DOM as well as visible pages");
assert.ok(uiSmoke.includes("scenario:'third-party-live-language-switch'"), "English UI smoke must create third-party components in Chinese before switching to English");
assert.ok(uiSmoke.includes("['title','aria-label','placeholder','aria-roledescription']"), "third-party live-switch smoke must inspect accessibility chrome directly");
assert.ok(uiSmoke.includes("zmodemUserTextPreserved"), "third-party live-switch smoke must preserve Chinese ZMODEM filenames as user content");
assert.ok(uiSmoke.includes("coldStartNativeChoice"), "language onboarding smoke must simulate an English cold start without cached Chinese resources");
for (const scenario of ["file-picker-language-switch", "connection-health-diagnosis", "third-party-components", "welcome", "sftp-view", "sftp-settings", "connected-tab-close", "workspace-tab-menu", "sftp-context-menu", "sftp-clipboard-actions", "local-files-shortcuts", "remote-explorer-menu", "terminal-startup-dialog", "connection-terminal-startup-form", "terminal-x11-menu", "terminal-context-menu", "command-snippet-manager", "ssh-extra-args-validation", "command-complete-notification", "download-complete-notification", "progress-notification-controls", "forward-runtime", "task-confirmations", "batch-log-label", "quick-open-notice", "quick-panel", "ssh-key-wizard", "rdp-form", "remote-protocol-forms", "xclip-local-offline", "xclip-no-plan-notification", "named-workspaces", "forward-list", "connection-controls", "connection-row-menu", "remote-profile-menu", "quick-connection", "linux-desktop-empty", "migration-snapshots", "storage-update-status"]) {
  assert.ok(uiSmoke.includes(`runI18nScenario('${scenario}'`), `English UI smoke is missing the ${scenario} scenario`);
}
const notificationSource = read("src/notifications.ts");
assert.match(notificationSource, /function localizeNotificationEvent\(/);
assert.match(notificationSource, /function normalizeNotificationLanguage\(/);
assert.match(read("src/routes/system-routes.ts"), /listNotifications\(Number\(url\.searchParams\.get\("since"\).*language\)/s);
assert.match(read("public/app-utils.js"), /\/api\/notifications\?since=.*&language=/);
assert.match(read("desktop/main.js"), /\/api\/notifications\?since=.*&language=/);
assert.match(read("desktop/main.js"), /Management interface: \$\{webUrl\}/);
assert.match(read("desktop/main.js"), /terma:set-interface-language/);
assert.match(read("desktop/preload.js"), /setInterfaceLanguage\(language\)/);
assert.match(read("public/app-i18n.js"), /termaDesktop\?\.setInterfaceLanguage\?\.\(language\)/);
for (const nativeText of ["Open in browser", "Start all forwarding", "Stop all forwarding", "Open .ssh directory", "Open log directory", "Export logs", "Select log export directory", "Select SFTP automatic save directory", "Select local sync directory"]) {
  assert.ok(read("desktop/main.js").includes(nativeText), `desktop native UI is missing English text: ${nativeText}`);
}
for (const [relative, helper] of [
  ["desktop/brand-data-migration.js", "migrationText"],
  ["desktop/storage-migration.js", "storageMigrationText"],
  ["desktop/windows-rdp-credentials.js", "windowsRdpCredentialText"]
]) {
  const source = read(relative);
  assert.ok(source.includes(`function ${helper}(`), `${relative} must expose a bilingual desktop text boundary`);
  assert.doesNotMatch(
    source,
    /throw new Error\(\s*["'`][^"'`\r\n]*[\u3400-\u9fff]/,
    `${relative} must not throw a directly embedded Chinese desktop error`
  );
}
for (const mixed of ["根Directory", "SFTP Connection已断开", "Save当前Workspace为预设", "Automatic跟随窗口", "当前SystemNo 可用的 xclip Install方案"]) {
  assert.ok(uiSmoke.includes(`'${mixed}'`), `English UI smoke is missing the mixed-language regression sample ${mixed}`);
}

const staticPhrases = new Set();
for (const match of html.matchAll(/(?:title|aria-label|placeholder)="([^"]*[\u3400-\u9fff][^"]*)"/g)) {
  staticPhrases.add(match[1].replace(/&#10;/g, "\n").trim());
}
const htmlText = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, "\n");
for (const line of htmlText.split(/\r?\n/)) {
  const value = line.replace(/&[^;]+;/g, " ").trim();
  if (/[\u3400-\u9fff]/.test(value)) staticPhrases.add(value);
}
const uncoveredStaticPhrases = [...staticPhrases].filter(value => (
  !chinesePhrases.has(value) && !chineseTemplates.some(expression => expression.test(value))
));
assert.deepEqual(uncoveredStaticPhrases, [], `static UI phrases missing from locale resources: ${uncoveredStaticPhrases.join(" | ")}`);
assert.ok(read("src/third-party-components.ts").includes('name:"i18next", version:"26.3.6"'));
assert.ok(read("src/third-party-components.ts").includes('name:"node-x11", version:"3.9.1"'));
assert.doesNotMatch(read("src/third-party-components.ts"), /\buse:\s*["'`][^"'`]*[\u3400-\u9fff]/, "third-party component purposes must use stable locale-independent codes");
assert.ok(read("THIRD_PARTY_NOTICES.md").includes("## i18next\n\n- Project: https://github.com/i18next/i18next\n- Version: 26.3.6"));
require("./sftp-job-i18n-check");
console.log(`Internationalization resource check passed: ${languages.length} languages, ${namespaces.length} namespaces.`);
