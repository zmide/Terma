const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// TypeScript 7 keeps the compiler API behind an unstable module while this
// repository's source-audit needs the stable AST helpers. Keep a small
// TypeScript 6 alias for this checker; the production compiler remains TS 7.
const ts = require("typescript-legacy");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const languages = ["zh-CN", "en-US"];
assert.ok(fs.readFileSync(path.join(__dirname,'ui-smoke-electron.js'),'utf8').includes('runWorkspaceShellUiScenario(window)'), 'workspace shell browser matrix must remain available');
assert.ok(fs.readFileSync(path.join(__dirname,'terminal-panel-content-ui-scenario.js'),'utf8').includes('return keeps terminal group'), 'dual panel docking language/theme matrix must remain available');
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

for (const language of languages) {
  for (const key of ['automation.start_time_format','automation.choose_start_time']) {
    assert.ok(resources.get(`${language}/sftp`).has(key), `${language} automation date controls need localized labels`);
  }
}
assert.ok(read('scripts/m6-automations-ui-scenario.js').includes('date draft node focus and caret survive language switch'), 'automation date live-language coverage must remain available');
assert.ok(read('scripts/m6-exchange-ui-scenario.js').includes('error language updates without losing the file'), 'private key error live-language coverage must remain available');

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

const jsSources = require('./frontend-source').frontendJavaScriptSources(root);
const appSources = jsSources.filter(file => /^app(?:-[a-z0-9-]+)?\.js$/i.test(path.basename(file)));
const literalTrErrors = [];
for (const relative of appSources) {
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


  // Assistant HTTP port: assistant-runtime checks Response.ok and delegates structured requestError.
  ["public/login.js", 2]
]);
const actualDirectFetchCounts = new Map();
for (const relative of jsSources) {
  const count = [...read(relative).matchAll(/\bfetch\s*\(/g)].length;
  if (count) actualDirectFetchCounts.set(relative, count);
}
assert.deepEqual(
  [...actualDirectFetchCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  [...expectedDirectFetchCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  "public direct fetch inventory changed; review every non-2xx path and register its structured error boundary"
);
for (const [relative, implementation] of [
  ["frontend/src/features/assistant/assistant-runtime-host.ts", "frontend/src/features/assistant/assistant-runtime.ts"],
  ["frontend/src/entries/about-embed.ts", "frontend/src/features/files/sftp/file-open-service.ts"]
]) {
  const entry = read(relative);
  const wiring = relative.endsWith("about-embed.ts") ? entry.match(/filesServices\.termaFileOpen = createFileOpenService\(\{[\s\S]*?^\}\);/m)?.[0] : entry;
  assert.ok(wiring, `${relative} must configure the streaming file opener`);
  const fetchCount = expectedDirectFetchCounts.get(relative) ?? 1;
  assert.equal([...wiring.matchAll(/\bfetch\s*\(/g)].length, fetchCount);
  const source = wiring + read(implementation);
  const structuredErrorCount = [...source.matchAll(/\b(?:apiErrorFromResponse|termaPublicErrors\.fromResponse)\s*\(/g)].length;
  assert.ok(
    structuredErrorCount >= fetchCount,
    `${relative} direct fetch non-2xx paths must use apiErrorFromResponse()`
  );
  assert.match(source, /if\s*\(\s*!\s*(?:res|response)\.ok\s*\)/, `${relative} must check the direct fetch response status`);
}
const fileWorkspaceActions = read('frontend/src/features/files/file-workspace-actions.ts');
const fileWorkspaceEntry = read('frontend/src/entries/about-embed.ts');
const fileTransferService = read('frontend/src/features/files/file-transfer-service.ts');
assert.match(fileWorkspaceActions, /fetch\(['"]\/api\/server-files\/upload-content[^;]+;\s*if \(!response\.ok\) throw await host\.responseError/);
assert.match(fileTransferService, /if\s*\(!response\.ok\)\s*throw await port\.responseError/);
assert.match(fileWorkspaceEntry, /responseError: response => sharedServices\.termaPublicErrors\.fromResponse\(response/);
const exchangeWorkspace = read('frontend/src/features/data-exchange/exchange-workspace.ts');
const exchangeService = read('frontend/src/features/data-exchange/exchange-service.ts');
assert.match(exchangeWorkspace, /responseError:.*apiErrorFromResponse/);
assert.match(exchangeService, /if\(!response\.ok\)throw await port\.responseError/);
const apiTransportSource = read("frontend/src/shared/api/workspace-request.ts");
assert.match(apiTransportSource, /throw errors\.create\(data, localized \|\| errors\.message\(data, data\.error \|\| response\.statusText\)/, "api() must localize structured non-2xx responses");
const ftpTransportSource = read("frontend/src/features/remote/transport-runtime.ts");
assert.match(ftpTransportSource, /await fetch\(`\/api\/remote-profiles\/\$\{id\}\/ftp\/upload`[^;]+;\s*if \(!response\.ok\) \{\s*const error = await sharedServices\.termaPublicErrors\.fromResponse\(response,[\s\S]*?throw error;/, "FTP upload must keep localized structured non-2xx errors after moving to TypeScript");
assert.match(require('./frontend-source').readFrontendDomain(process.cwd(),'utilities'), /apiErrorFromResponse[\s\S]*?termaPublicErrors\.fromResponse/, "binary, stream, and multipart fetches need the shared TS error parser");
const publicErrorServiceSource = read("frontend/src/shared/api/public-errors.ts");
assert.match(publicErrorServiceSource, /async function fromResponse[\s\S]*?JSON\.parse\(text\)[\s\S]*?message\(data, rawMessage\)/, "shared TS parser must localize structured response errors");
const i18nTransportSource = read("frontend/src/shared/i18n/resource-loader.ts");
assert.match(i18nTransportSource, /const url = `\/locales\/[\s\S]*?\.fetch\(url, \{cache: 'no-store'\}\)/, "locale resource requests must use the local no-store URL");
assert.match(i18nTransportSource, /if\s*\(\s*!response\.ok\s*\)[\s\S]*?I18N_RESOURCE_LOAD_FAILED/, "locale resource fetches must reject non-2xx responses explicitly");
assert.match(i18nTransportSource, /finally\(\(\) => \{[\s\S]*?inFlight\.delete\(key\)/, "failed and completed locale requests must release their in-flight entry");

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
const frontendSourceEntries = [...appSources, ...jsSources.filter(file => file === "public/login.js" || file === "public/sftp-open-worker.js")];
for (const relative of frontendSourceEntries) {
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

const phraseTranslationFile = "frontend/src/shared/i18n/phrase-translation.ts";
const phraseTranslationSource = read(phraseTranslationFile);
const i18nRuntimeAst = ts.createSourceFile(phraseTranslationFile, phraseTranslationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
      if (!selectorCall || !hasEnglishPair) {
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
assert.equal(packageJson.dependencies?.i18next, "26.5.5", "i18next must use the reviewed exact runtime version");
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
assert.equal(servedVendorAssets.length, 14, "the static content handler vendor file map changed; review the served i18n scan boundary");
servedVendorAssets.forEach(assertServedVendorAssetWithoutChinese);

const aceVendorDirectory = path.join("node_modules", "ace-builds", "src-min-noconflict");
const servedAceAssets = fs.readdirSync(path.join(root, aceVendorDirectory), {withFileTypes:true})
  .filter(entry => entry.isFile() && /^(?:ace|mode-[a-z0-9_-]+|theme-[a-z0-9_-]+|worker-[a-z0-9_-]+|ext-[a-z0-9_-]+)\.js$/i.test(entry.name))
  .map(entry => path.join(aceVendorDirectory, entry.name));
assert.ok(servedAceAssets.length > 0, "the served Ace asset allowlist must not be empty");
servedAceAssets.forEach(assertServedVendorAssetWithoutChinese);
const sftpOpenWorker = read("frontend/src/features/files/sftp/text-codec.ts");
assert.equal(/[\u3400-\u9fff]/.test(sftpOpenWorker), false, "SFTP text decoder worker must return stable error codes instead of Chinese UI text");
for (const errorCode of ["binary_content", "unsupported_encoding", "decode_failed"]) {
  assert.ok(sftpOpenWorker.includes(errorCode), `SFTP text decoder worker is missing ${errorCode}`);
}
const sftpOpenFrontend = read("frontend/src/features/files/sftp/file-open-service.ts");
for (const resourceKey of ["binary_content", "unsupported_encoding", "parse_failed"]) {
  assert.ok(sftpOpenFrontend.includes(resourceKey), `SFTP text decoder UI is missing the ${resourceKey} translation mapping`);
}
const x11Frontend = read("frontend/src/features/x11/x11-host.ts");
const connectionMenu = read("frontend/src/features/connections/connection-menu-service.ts");
const connectionActions = read("frontend/src/shared/static-action-registry.ts");
for (const key of ["sftp_files", "server_dashboard", "health_check", "x11_terminal_enabled", "x11_terminal", "open_other_connections", "generate_other_connections", "duplicate", "edit", "delete"]) {
  assert.ok(connectionMenu.includes(`connections:actions.${key}`), `connection menu is missing the ${key} translation mapping`);
}
for (const key of ["rename", "move_up", "move_down"]) {
  assert.ok(connectionMenu.includes(`connections:groups.${key}`), `connection group menu is missing the ${key} translation mapping`);
}
assert.match(connectionActions, /termaConnectionMenu\?\.open\(event, connectionId\(dataset\)\)/, "row menu delegates to the typed owner");
assert.match(connectionActions, /termaConnectionMenu\?\.openGroup\(event, connectionGroup\(dataset\)\)/, "group menu delegates to the typed owner");
const x11Manual=read('frontend/src/features/x11/manual-terminal.ts');
for (const resourceKey of ["install_terminal_finished", "manual_install_terminal_prompt", "config_terminal_finished"]) {
  assert.ok(x11Manual.includes(`common:x11.${resourceKey}`), `X11 terminal prompt is missing common:x11.${resourceKey}`);
}
assert.ok(x11Manual.includes('const quote=')&&x11Manual.includes('value.replace(/\'/g'),'X11 terminal prompts must use POSIX-safe single-quote escaping');
assert.ok(x11Manual.includes('quote(finished)')&&x11Manual.includes('quote(finished.slice(0,marker))'),'X11 terminal completion prompts stay outside shell source');
const x11Presentation = read('frontend/src/features/x11/presentation-service.ts');
assert.match(x11Frontend, /reason: x11Presentation\.reason/, "X11 diagnostics use the shared presentation owner");
assert.match(x11Presentation, /backendPublicErrorParams\(diagnostics\?\.reason_params\)/, "X11 reason parameters reuse the shared sanitizer");
assert.match(x11Presentation, /reason_preserve_message === true[\s\S]*port\.preserve\(raw\)/, "explicit remote error text retains its raw phrase contract");
assert.match(read('frontend/src/features/x11/LauncherView.ts'), /actions\.warning\(state\.discovery\)/, "launcher warnings share the presentation owner");
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

assert.ok(vendorAt>=0&&html.includes('<!-- TERMA_ABOUT_VUE_ASSETS -->'),'synchronous local i18next vendor is available to the deferred module application');
for(const retired of ['resources','observer','phrases','translation','bootstrap'])
 assert.equal(html.includes('/app-i18n-'+retired+'.js'),false,'classic language scripts remain retired');
assert.ok(staticContent.includes('["/vendor/i18next/i18next.min.js", vendorFile("i18next", "dist/umd/i18next.min.js")]'));
const runtimeSettings = read("src/runtime-settings.ts");
assert.ok(runtimeSettings.includes("schema_version: 22") && runtimeSettings.includes("language: normalizeLanguage") && runtimeSettings.includes("language_onboarding_version") && runtimeSettings.includes("vnc_fullscreen_toolbar") && runtimeSettings.includes("vnc_remote_image_poll_interval_ms") && runtimeSettings.includes("scrollback_lines") && runtimeSettings.includes("desktop_notifications_enabled") && runtimeSettings.includes("ai: normalizeAiSettings"));
const i18nBootstrap = read("frontend/src/shared/i18n/workspace-bootstrap.ts");
const languageSettings = read("frontend/src/features/settings/language-settings-controller.ts");
const frontend = `${i18nBootstrap}\n${languageSettings}\n${read("frontend/src/features/settings/settings-workspace.ts")}`;
for (const token of ["setTermaLanguage", "registerTermaI18nRenderer", "installLanguageSettingsController", "syncTermaLanguageControls"]) {
  assert.ok(frontend.includes(token), `i18n frontend boundary is missing ${token}`);
}
assert.equal(html.includes('id="interfaceLanguage"'), false, "the removed settings-page language selector must not return");
assert.match(html, /id="languageToggle"[^>]*data-action="static-language-toggle"/);
assert.match(html, /id="mobileLanguageToggle"[^>]*data-action="static-language-toggle"/);
assert.ok(html.indexOf('id="languageToggle"') < html.indexOf('id="themeToggle"'), "desktop language toggle must be above the theme toggle");
assert.ok(html.indexOf('id="mobileLanguageToggle"') < html.indexOf('class="mobile-brand-action theme-toggle'), "mobile language toggle must precede the theme toggle");
assert.match(read("frontend/src/shared/static-action-registry.ts"), /'static-language-toggle': \(\) => settingsServices\.termaLanguageSettings\.toggle\(\)/);
const translationObserver = read("frontend/src/shared/i18n/translation-observer.ts");
assert.match(translationObserver, /roots\.length > 128\) apply\(document\)/);
assert.match(translationObserver, /\.vnc-screen[\s\S]*\.vnc-viewport[\s\S]*\.vnc-rfb/, "automatic translation must skip the VNC rendering subtree");
assert.match(translationObserver, /element\?\.isConnected && !shouldSkip\(element\)/);
assert.match(i18nBootstrap, /shouldSkip: termaI18nSkipped, apply: applyTermaAutomaticTranslations/);
assert.match(i18nBootstrap, /addEventListener\("pagehide", observer\.stop\)/);
assert.match(translationObserver, /'aria-label'[\s\S]*?`data-i18n-\$\{attribute\}`/, "explicit aria-label translations must be supported");
assert.match(i18nBootstrap, /async function ensureTermaI18nResourceBundles\(/, "native language choices must be able to load a missing locale bundle on demand");
assert.match(languageSettings, /ensureTermaI18nResourceBundles\(\['en-US', 'zh-CN'\], \['common', 'settings'\]\)/, "language onboarding must load both native choice resources before rendering");
const phraseIndexSource = read("frontend/src/shared/i18n/phrase-index.ts");
assert.match(phraseIndexSource, /right\.literalLength - left\.literalLength/, "parameterized phrases must prefer the most specific template");
assert.match(phraseIndexSource, /function candidates\(source: string\)/, "automatic translation must preselect parameterized templates");
assert.match(phraseIndexSource, /source\.includes\(template\.anchor\)/, "parameterized template candidates must pass a literal-anchor filter before regex matching");
assert.match(phraseIndexSource, /const cacheLimit = 2048/, "automatic phrase lookup cache must remain bounded");
assert.match(phraseTranslationSource, /return \/\[\\u3400-\\u9fff\]\/\.test\(output\) \? source : output;/, "word fallback must not emit mixed Chinese-English text");
assert.match(read("frontend/src/features/workspace/workspace-language.ts"), /tab\.kind === "welcome"[\s\S]*common:workspace\.welcome_subtitle/, "the open welcome tab subtitle must refresh when the language changes");


function automaticTranslationRuntime() {
 const {loadFrontendService}=require('./frontend-service-test-helper'),cache=new Map();
 const runtimeResources=Object.fromEntries(languages.map(language=>[language,Object.fromEntries(namespaces.map(namespace=>[namespace,JSON.parse(read(path.join('public','locales',language,namespace+'.json')))]))]));
 let language='en-US';
 const index=loadFrontendService('frontend/src/shared/i18n/phrase-index.ts',{window:{}},cache).TERMA_I18N_PHRASE_INDEX;
 index.rebuild(runtimeResources);
 const translate=(name,options={})=>{
  const separator=String(name||'').indexOf(':'),namespace=separator>=0?name.slice(0,separator):'common',resourcePath=separator>=0?name.slice(separator+1):name;
  let output=runtimeResources[language]?.[namespace];
  for(const segment of String(resourcePath||'').split('.'))output=output?.[segment];
  if(typeof output!=='string')return String(options.defaultValue||name);
  return output.replace(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi,(_match,key)=>String(options[key]??''));
 };
 const factory=loadFrontendService('frontend/src/shared/i18n/phrase-translation.ts',{window:{},Date},cache).createTermaPhraseTranslation;
 const phrases=factory(()=>language,translate,index);
 return {index,context:{},evaluate(expression,values={}){
  assert.equal(expression,'rememberTermaRawUiPhrase(rawCapture)');return phrases.remember(values.rawCapture);
 },translate(value,nextLanguage='en-US'){language=nextLanguage;return phrases.translate(value);}};
}

const automaticRuntime = automaticTranslationRuntime();
const indexedTemplateCount = automaticRuntime.index.templateCount;
const unrelatedCandidateCount = automaticRuntime.index.candidateCount("2048 KB");
const dynamicCandidateCount = automaticRuntime.index.candidateCount("server · 转发列表");
const automaticTemplateSamples = [];
const referenceTemplates = [];
for (const namespace of namespaces) {
  const chinese = resources.get(`zh-CN/${namespace}`);
  const english = resources.get(`en-US/${namespace}`);
  for (const [path, chineseValue] of chinese) {
    for (const value of [chineseValue, english.get(path)]) {
      if (!value.includes("{{")) continue;
      const sample = value.trim().replace(/{{-?\s*[a-z0-9_.-]+\s*}}/gi, "sample");
      automaticTemplateSamples.push(sample);
      const tokenPattern = /{{-?\s*([a-z0-9_.-]+)\s*}}/gi;
      const literals = [];
      let expression = "";
      let offset = 0;
      for (const match of value.trim().matchAll(tokenPattern)) {
        const literal = value.trim().slice(offset, match.index);
        literals.push(literal);
        expression += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(.+?)";
        offset = Number(match.index) + match[0].length;
      }
      const trailing = value.trim().slice(offset);
      literals.push(trailing);
      expression += trailing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const literalLength = literals.reduce((total, literal) => total + literal.length, 0);
      if (literalLength >= 2 && literals.some(literal => literal.trim())) referenceTemplates.push({key:`${namespace}:${path}`, literalLength, expression:new RegExp(`^${expression}$`)});
    }
  }
}
referenceTemplates.sort((left, right) => right.literalLength - left.literalLength || right.expression.source.length - left.expression.source.length);
const indexedTemplateMismatchCount = automaticTemplateSamples.filter(sample => {
  const expected = referenceTemplates.find(template => sample.match(template.expression));
  return automaticRuntime.index.lookup(sample).template?.key !== expected?.key;
}).length;
assert.ok(indexedTemplateCount > 1000, "the runtime fixture must cover the full parameterized phrase catalog");
assert.equal(indexedTemplateMismatchCount, 0, "literal-anchor indexing must preserve full-catalog template matching order");
assert.ok(unrelatedCandidateCount < indexedTemplateCount / 20, "unknown table text must not scan the full parameterized phrase catalog");
assert.ok(dynamicCandidateCount < indexedTemplateCount / 20, "dynamic UI text must use a narrow literal-anchor candidate set");
assert.equal(automaticRuntime.translate("server · 转发列表"), "server · Forwarding list", "Chinese parameterized text must still translate to English");
assert.equal(automaticRuntime.translate("server · Forwarding list", "zh-CN"), "server · 转发列表", "English parameterized text must still translate to Chinese");
assert.equal(
  automaticRuntime.translate("目标目录已存在同名项目：秘密文件"),
  "The target directory already contains an item with the same name: 秘密文件",
  "the runtime fixture must cache a parameterized phrase lookup before testing its raw capture boundary"
);
automaticRuntime.evaluate("rememberTermaRawUiPhrase(rawCapture)", {rawCapture:"秘密文件"});
assert.equal(
  automaticRuntime.translate("目标目录已存在同名项目：秘密文件"),
  "The target directory already contains an item with the same name: 秘密文件",
  "cached template lookup must continue honoring newly registered raw captured text"
);
for (const raw of ['Fixture save failure', 'Terma requires base64 or openssl on the remote host']) {
  assert.equal(automaticRuntime.index.lookup(raw).kind, 'miss', 'whitespace-only templates must not match unrecognized English messages');
  assert.equal(automaticRuntime.translate(raw, 'zh-CN'), '', 'Chinese fallback must leave unrecognized English text alone');
}
assert.ok(automaticRuntime.translate('Save failed: Fixture save failure', 'zh-CN').includes('Fixture save failure'),
  'translating a recognized message must keep spaces in its unknown reason');
for (let index = 0; index < 2112; index += 1) automaticRuntime.index.lookup(`uncached automatic phrase ${index}`);
const boundedPhraseCacheSize = automaticRuntime.index.cacheSize;
assert.equal(boundedPhraseCacheSize, 2048, "automatic phrase lookup cache must evict its oldest entries");
const cacheSizeBeforeLongPhrase = automaticRuntime.index.cacheSize;
automaticRuntime.index.lookup("x".repeat(513));
assert.equal(automaticRuntime.index.cacheSize, cacheSizeBeforeLongPhrase, "very long UI strings must bypass the phrase cache");
automaticRuntime.index.rebuild(automaticRuntime.context.runtimeResources);
assert.equal(automaticRuntime.index.cacheSize, 0, "loading locale bundles rebuilds the phrase index and clears stale lookups");

const themeFrontend = require('./frontend-source').readFrontendDomain(process.cwd(),'utilities');
assert.match(themeFrontend, /function syncThemeToggleControls\(/, "theme toggle labels must have a dedicated live localization boundary");
assert.match(themeFrontend, /registerTermaI18nRenderer[\s\S]*?syncThemeToggleControls\(\)/, "theme toggle labels must refresh when the language changes");
assert.doesNotMatch(html, /class="file-picker-name"[^>]*data-i18n-skip/, "empty static file pickers must remain translatable");
const formControlsFrontend = read('frontend/src/shared/form-controls.ts');
assert.ok(formControlsFrontend.includes('files![0].name') && formControlsFrontend.includes("skip: count ? 'true' : undefined"), 'selected user filenames must be excluded from translation');
assert.match(formControlsFrontend, /dataset\.filePickerCount/, 'multi-file selections must retain their count for live localization');
assert.match(formControlsFrontend, /registerTermaI18nRenderer[\s\S]*service\.syncFilePickerLabels\(\)/, 'multi-file selection counts must refresh when the language changes');
assert.ok(formControlsFrontend.includes("'common:auto.not_selected'") && formControlsFrontend.includes("name.removeAttribute('data-i18n-skip')"), 'cleared file pickers must restore the bilingual empty-state key');
const connectionHealthFrontend = read("frontend/src/features/connections/connection-health-service.ts");
assert.match(connectionHealthFrontend, /diagnosis\.reason_code/, "connection health must localize SSH failures by stable diagnosis code");
assert.match(connectionHealthFrontend, /ssh\?\.preserve_raw_output === true/, "connection health must preserve only explicitly marked raw SSH output");
assert.equal(connectionHealthFrontend.includes("diagnosis.display"), false, "connection health must not render the backend's fixed Chinese SSH diagnosis display directly");
const aceFrontend = read("frontend/src/features/files/sftp/editor-ace-localization.ts");
assert.ok(aceFrontend.includes("function syncTermaAceEditorChrome("), "Ace instances must expose a live localization refresh boundary");
assert.ok(aceFrontend.includes("renderer?.updateFull?.(true)"), "Ace localization must redraw existing fold and annotation chrome");
assert.ok(aceFrontend.includes("editor.textInput?.setAriaOptions?.({setLabel:true})"), "Ace localization must refresh existing accessibility labels");
const zmodemFrontend = read("frontend/src/features/terminal/terminal-transport-workspace.ts");
const zmodemRuntime = read("frontend/src/features/terminal/terminal-zmodem-runtime-service.ts");
const zmodemTransfer = read("frontend/src/features/terminal/terminal-zmodem-transfer-service.ts");
const zmodemView = read("frontend/src/features/terminal/TerminalZmodemView.ts");
const zmodemWorkspace = read("frontend/src/features/terminal/terminal-zmodem-workspace.ts");
assert.ok(!zmodemFrontend.includes("function syncTerminalZmodemLocalization("), "classic scripts must not retain a duplicate ZMODEM refresh entry");
assert.ok(zmodemWorkspace.includes("registerTermaI18nRenderer?.(() => terminalServices.termaTerminalZmodem.localize())"), "ZMODEM panels must refresh when the language changes");
assert.ok(zmodemRuntime.includes("function syncTerminalZmodemLocalization("), "the ZMODEM runtime must rerender active panels on language changes");
assert.ok(zmodemView.includes("return tr(key, options);"), "ZMODEM views must preserve structured translation keys and parameters");
assert.ok(zmodemTransfer.includes("titleOptions:{name, defaultValue:"), "received remote filenames must remain translation parameters");
assert.ok(zmodemTransfer.includes("titleOptions:{name:file.name, defaultValue:"), "sent local filenames must remain translation parameters");
assert.equal([zmodemFrontend, zmodemRuntime, zmodemTransfer, zmodemView].some(source => source.includes("translatedTermaPhrase")), false, "ZMODEM live localization must not translate rendered user filenames or paths heuristically");
const uiSmoke = read("scripts/ui-smoke-electron.js");
assert.ok(uiSmoke.includes('runApplicationLifecycleUiScenario'), 'Application lifecycle acceptance is registered');
const applicationLifecycleScenario = read('scripts/application-lifecycle-ui-scenario.js');
const terminalTransportScenario = read('scripts/terminal-transport-ui-scenario.js');
const terminalStartupScenario = read('scripts/terminal-startup-ui-scenario.js');
assert.ok(uiSmoke.includes('runTerminalStartupUiScenario'), 'Terminal startup settings acceptance is registered');
for (const marker of ['live locale preserves draft focus selection and scroll', 'error follows live locale',
  'live refresh preserves disabled save controls', 'late detection cannot reclaim replacement',
  'save failure restores controls and draft', '[1200,390]', "['light','dark']", "['zh-CN','en-US']"]) {
  assert.ok(terminalStartupScenario.includes(marker), `Terminal startup settings coverage missing ${marker}`);
}
for (const marker of ['component language preserves draft focus selection and scroll', 'confirmation follows locale immediately',
  'authorization cancel restores draft', 'task drawer is visible and unobscured',
  'pending component request blocks form actions', 'authorization replacement never restores startup',
  'closing before identities never opens a late authorization', 'task logs remain escaped in visible drawer',
  'local preparation acceptance keeps exact task action', 'leaves startup controls usable',
  'task center translates real component labels immediately']) {
  assert.ok(terminalStartupScenario.includes(marker), `Terminal session component coverage missing ${marker}`);
}
for (const marker of ['preflight wait stays visible', 'cancelled preflight never requests a ticket',
  'startup failure notification is localized', 'X11 fallback feedback uses the current language',
  'explicit X11 authorization hint is localized']) {
  assert.ok(terminalTransportScenario.includes(marker), `Terminal startup browser coverage missing ${marker}`);
}
assert.ok(uiSmoke.includes('runTerminalTransportUiScenario'), 'Terminal transport browser acceptance is registered');
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'English scans hidden terminal UI and attributes', 'live language retains terminal draft focus selection and scroll', 'composer language retains draft focus selection and scroll', 'shortcut mount replaces all legacy buttons', 'cached surface retains and translates the same composer', 'mobile send hover retains the flat primary color in both themes', 'real Tab shows the mobile send keyboard focus']) {
  assert.ok(terminalTransportScenario.includes(marker), `Terminal transport acceptance is missing ${marker}`);
}
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'live language retains draft focus and scroll', 'live English scans hidden text and attributes', 'native drag fallback uses the current language']) {
  assert.ok(applicationLifecycleScenario.includes(marker), `Application lifecycle acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes('runSystemNotificationUiScenario'), 'System notification browser acceptance is registered');
const systemNotificationScenario = read('scripts/system-notification-ui-scenario.js');
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'pending permission label translates live', 'live language retains notification draft focus and scroll', 'live English scans hidden notification settings and attributes']) {
  assert.ok(systemNotificationScenario.includes(marker), `System notification acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes('runUiInteractionUiScenario'), 'UI action and snapshot browser acceptance is registered');
const interactionScenario = read('scripts/ui-interaction-ui-scenario.js');
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'busy default text translates live', 'live language retains snapshot focus draft and scroll', 'live English scans hidden text and attributes']) {
  assert.ok(interactionScenario.includes(marker), `UI action and snapshot acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes('runNotificationPresentationUiScenario'), 'Notification presentation browser acceptance is registered');
const notificationPresentationScenario = read('scripts/notification-presentation-ui-scenario.js');
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'open progress controls translate immediately', 'live language retains notification node and focus', 'live English scans hidden progress controls', 'task action fixed labels translate']) {
  assert.ok(notificationPresentationScenario.includes(marker), `Notification presentation acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes('runSshHostTrustUiScenario'), 'SSH host trust dialog matrix is registered');
const hostTrustScenario = read('scripts/ssh-host-trust-ui-scenario.js');
assert.ok(uiSmoke.includes('runMobileLayoutUiScenario'), 'Mobile headers and credential dialog acceptance is registered');
const mobileLayoutScenario=read('scripts/mobile-layout-ui-scenario.js');
for (const marker of ['[1200,390,320]', "['light','dark']", "['zh-CN','en-US']", 'live language retains credential draft and focus', 'buttonsReachable', 'translated']) {
  assert.ok(mobileLayoutScenario.includes(marker), `Mobile layout acceptance is missing ${marker}`);
}
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'open dialog and attributes translate immediately', 'live language preserves dialog and focus', 'cancelled challenge never grants trust']) {
  assert.ok(hostTrustScenario.includes(marker), `SSH host trust acceptance is missing ${marker}`);
}
const protocolStates=read("scripts/m7-protocol-ui-states.js");
for(const marker of ['confirmation live language','exact scope authorization','task visible in viewport','pending language','unlinked language','request error','retry'])assert.ok(protocolStates.includes(marker),`Remote protocol acceptance is missing ${marker}`);
assert.ok(uiSmoke.includes("runConnectionsUiScenario"), "UI smoke must include the complete SSH explorer, forms, welcome and host directory picker");
const connectionScenario = read("scripts/connections-ui-scenario.js");
for (const marker of ["[1200,390]", "['light','dark']", "['zh-CN','en-US']", "preserves fields and password visibility", "translates hidden content and attributes", "keyboard focus remains visible"]) {
  assert.ok(connectionScenario.includes(marker), `Connection UI acceptance is missing ${marker}`);
}
assert.ok(read("scripts/remote-ui-scenario.js").includes("runRemoteGraphicsUiScenario(browser"), "Remote UI smoke must include graphical and clipboard dialogs");
const clipboardScenario = read("scripts/remote-graphics-ui-scenario.js");
assert.ok(uiSmoke.includes('runFormControlsUiScenario'), 'Shared form controls browser acceptance is registered');
const formControlsScenario = read('scripts/form-controls-ui-scenario.js');
assert.ok(uiSmoke.includes('runTerminalViewportUiScenario'), 'Terminal viewport browser acceptance is registered');
const viewportScenario = read('scripts/terminal-viewport-ui-scenario.js');
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'live language preserves scrollback', 'pointer returns the terminal', 'cancelled picker recovers on focus return', 'hidden attributes use the current language']) {
  assert.ok(viewportScenario.includes(marker), `Terminal viewport acceptance is missing ${marker}`);
}
for (const marker of ['[1200,390]', "['light','dark']", "['zh-CN','en-US']", 'selected count translates live', 'live language preserves password focus and draft', 'Vue locale keeps the selected FileList']) {
  assert.ok(formControlsScenario.includes(marker), `Form controls acceptance is missing ${marker}`);
}
assert.ok(read('scripts/remote-ui-scenario.js').includes('ftpOwnershipStates')&&read('scripts/remote-runtime-ui-scenario.js').includes('terminalOwnershipStates'),'Remote UI acceptance includes transport ownership states');
const transportOwnership=read('scripts/m7-transport-ui-states.js');
assert.ok(uiSmoke.includes('runX11UiScenario'),'X11 lifecycle matrix is registered');
const x11Scenario=read('scripts/m7-x11-ui-scenario.js');
for(const marker of ['[1200,390]',"['light','dark']","['zh-CN','en-US']",'language does not probe again','launcher locale keeps draft and caret','authorization language retains secret and caret','task visible and uncovered','exact clipboard grant','closed plan does not reopen'])assert.ok(x11Scenario.includes(marker),`X11 acceptance is missing ${marker}`);
for(const marker of ['typed application and category labels','shared discovery warning','empty discovery retains custom option','manager entry uses active saved session','manager entry uses active quick session','manager entry resolves remote management association','unrelated active tab cannot inherit selected SSH','preserved diagnostic remains text','live translation'])assert.ok(x11Scenario.includes(marker),`X11 presentation acceptance is missing ${marker}`);
for(const marker of ['FTP open language keeps input and caret','FTP close clears owned repair password','FTP dialog buttons stay within viewport','hidden reconnect keeps serial focus and status','terminal close and reopen creates one live engine'])assert.ok(transportOwnership.includes(marker),`Transport acceptance is missing ${marker}`);
assert.ok(clipboardScenario.includes('vncLifecycleStates'),'VNC UI acceptance must include lifecycle controls');
const vncLifecycle=read('scripts/m7-vnc-ui-states.js');
for(const marker of ['browser fullscreen retains screen','fullscreen language keeps exit action','retry language preserves secret and caret','closing session clears its password window'])assert.ok(vncLifecycle.includes(marker),`VNC lifecycle acceptance is missing ${marker}`);
assert.ok(read('scripts/remote-management-ui-scenario.js').includes('vncManagementStates'),'Management UI acceptance must include VNC operations');
assert.ok(read('scripts/remote-management-ui-scenario.js').includes('Linux desktop tab follows the current language'),'Management UI acceptance must check Linux desktop tab language changes');
for(const marker of ['source-pending','source-readonly','conflict','entry renders through the typed model'])assert.ok(read('scripts/remote-management-ui-scenario.js').includes(marker),`Management model acceptance is missing ${marker}`);
const vncManagement=read('scripts/m7-vnc-management-ui-states.js');
for(const marker of ['VNC password language keeps draft and caret','VNC task visible and uncovered','VNC exact server grant','VNC request failure'])assert.ok(vncManagement.includes(marker),`VNC management acceptance is missing ${marker}`);
for (const marker of ["[1200,390]", "['light','dark']", "['zh-CN','en-US']", "chrome and hidden manual text translate", "preserves connection selection, focus, expanded guide and scroll", "manual clipboard draft and caret survive locale change"]) {
  assert.ok(clipboardScenario.includes(marker), `VNC clipboard UI acceptance is missing ${marker}`);
}
assert.ok(clipboardScenario.includes("[title],[aria-label],[placeholder]"), "VNC clipboard smoke must inspect translatable attributes");
assert.ok(uiSmoke.includes("runTerminalSettingsUiScenario"), "UI smoke must include terminal settings and multiline paste");
for (const marker of ["settings use shared defaults", "mouse options translate from the shared IDs", "saved shortcut dispatch uses canonical sequences"]) {
  assert.ok(read("scripts/terminal-settings-ui-scenario.js").includes(marker), `Terminal configuration browser acceptance is missing ${marker}`);
}
for (const marker of ["typed keys live locale retains nodes state focus and scroll", "typed keys translate visible and hidden attributes", "typed shortcut consumes Ctrl once in the requested pane"]) {
  assert.ok(read("scripts/terminal-toolbar-ui-scenario.js").includes(marker), `Terminal keys browser acceptance is missing ${marker}`);
}
for (const marker of ["combined locale and theme match the typed toolbar model", "hidden temporary toolbar keeps its node and current model", "screenshotContexts", "empty temporary host mounts through the Vue owner"]) {
  assert.ok(read("scripts/terminal-toolbar-ui-scenario.js").includes(marker), `Terminal toolbar browser acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes("runSftpDialogUiScenario"), "UI smoke must include SFTP operation and recycle dialogs");
for (const marker of ["X11 scope live language retains focus scroll and translated attributes", "temporary X11 menu translates while open", "connection X11 nested scope uses the same typed actions"]) {
  assert.ok(read("scripts/terminal-toolbar-ui-scenario.js").includes(marker), `X11 menu browser acceptance is missing ${marker}`);
}
const sftpDialogScenario = read("scripts/sftp-dialog-ui-scenario.js");
for (const marker of ['open account choices translate immediately', 'resolved principals display remote names with IDs', 'closed dialog cannot overwrite a new account list']) {
  assert.ok(sftpDialogScenario.includes(marker), `SFTP identity browser acceptance is missing ${marker}`);
}
const sftpEditorScenario = read("scripts/sftp-editor-ui-scenario.js");
for (const marker of ['upload chooser captures target','stale chooser creates no upload','cancelled chooser retries on the captured folder']) {
  assert.ok(read('scripts/sftp-picker-ui-scenario.js').includes(marker), `SFTP upload picker browser acceptance is missing ${marker}`);
}
for(const marker of ['pointer cancellation clears the queue','queue-cancelled']){
  assert.ok(read('scripts/sftp-copy-ui-scenario.js').includes(marker),`SFTP clipboard cancellation acceptance is missing ${marker}`);
}
assert.ok(read('scripts/web-files-ui-scenario.js').includes('dropRouting:true'),'File page browser matrix must verify the typed drop adapter');
for (const marker of ["['light','dark']", "['zh-CN','en-US']", "live language retains draft and caret", "translated DOM and attributes", "busy survives language change", "closing one editor leaves the other usable"]) {
  assert.ok(sftpEditorScenario.includes(marker), `SFTP editor UI acceptance is missing ${marker}`);
}
for (const marker of ["['light','dark']", "['zh-CN','en-US']", "live language retains draft and caret", "theme text contrast", "translated DOM and attributes", "expanded directory chooser live locale keeps state", "recycle locale preserves page and focus without reload", "runtime replacement invalidates pending mutation"]) {
  assert.ok(sftpDialogScenario.includes(marker), `SFTP dialog UI acceptance is missing ${marker}`);
}
const terminalSettingsScenario = read("scripts/terminal-settings-ui-scenario.js");
const terminalInteractionScenario = read("scripts/terminal-viewport-ui-scenario.js");
for (const marker of ["[1200,390]", "['light','dark']", "['zh-CN','en-US']", "cursor copy live locale keeps phase selection focus and scroll", "cursor copy translates visible and hidden attributes"]) {
  assert.ok(terminalInteractionScenario.includes(marker), `Terminal interaction UI acceptance is missing ${marker}`);
}
for (const marker of ["[1200,390]", "['light','dark']", "['zh-CN','en-US']", "locale preserves input, focus and selection", "paste live locale preserves draft and selection", "translated:", "el.title,el.getAttribute('aria-label'),el.placeholder"]) {
  assert.ok(terminalSettingsScenario.includes(marker), `Terminal settings UI acceptance is missing ${marker}`);
}
assert.ok(uiSmoke.includes("runFnosUpdatesUiScenario(mobileNavigationWindow)"), "UI smoke must cover fnOS release notes and package links in both languages and themes");
assert.ok(uiSmoke.includes("runOriginProtocolUiScenario(mobileNavigationWindow)"), "UI smoke must cover protocol settings and login errors in both languages and themes");
assert.ok(uiSmoke.includes("runI18nScenario('fnos-managed-settings'"), "English UI smoke must cover fnOS managed update and listener controls");
assert.ok(uiSmoke.includes("runI18nScenario('desktop-notification-toggle'"), "English UI smoke must exercise saved desktop notification toggles, including busy-label restoration");
assert.match(uiSmoke, /\['title','aria-label','placeholder'\]/, "English UI smoke must inspect translatable attributes");
assert.match(uiSmoke, /collectVisibleHan\('document', true\)/, "English UI smoke must inspect hidden rendered DOM as well as visible pages");
assert.ok(uiSmoke.includes("scenario:'third-party-live-language-switch'"), "English UI smoke must create third-party components in Chinese before switching to English");
assert.ok(uiSmoke.includes("['title','aria-label','placeholder','aria-roledescription']"), "third-party live-switch smoke must inspect accessibility chrome directly");
assert.ok(uiSmoke.includes("zmodemUserTextPreserved"), "third-party live-switch smoke must preserve Chinese ZMODEM filenames as user content");
assert.ok(read("scripts/language-onboarding-ui-scenario.js").includes("coldStartNativeChoice"), "language onboarding smoke must simulate an English cold start without cached Chinese resources");
for (const scenario of ["file-picker-language-switch", "connection-health-diagnosis", "third-party-components", "welcome", "sftp-view", "sftp-settings", "connected-tab-close", "workspace-tab-menu", "sftp-context-menu", "sftp-clipboard-actions", "local-files-shortcuts", "remote-explorer-menu", "terminal-startup-dialog", "connection-terminal-startup-form", "terminal-x11-menu", "terminal-context-menu", "command-snippet-manager", "ssh-extra-args-validation", "download-complete-notification", "progress-notification-controls", "forward-runtime", "task-confirmations", "batch-log-label", "quick-open-notice", "quick-panel", "ssh-key-wizard", "rdp-form", "remote-protocol-forms", "xclip-local-offline", "xclip-no-plan-notification", "named-workspaces", "forward-list", "connection-controls", "connection-row-menu", "remote-profile-menu", "quick-connection", "linux-desktop-empty", "migration-snapshots", "storage-update-status"]) {
  assert.ok(uiSmoke.includes(`runI18nScenario('${scenario}'`), `English UI smoke is missing the ${scenario} scenario`);
}
const notificationSource = read("src/notifications.ts");
assert.match(notificationSource, /function localizeNotificationEvent\(/);
assert.match(notificationSource, /function normalizeNotificationLanguage\(/);
assert.match(read("src/routes/system-routes.ts"), /listNotifications\(Number\(url\.searchParams\.get\("since"\).*language\)/s);
assert.match(read("frontend/src/features/efficiency/notification-polling-service.ts"), /\/api\/notifications\?since=.*&language=/);
assert.match(read("desktop/main.js"), /\/api\/notifications\?since=.*&language=/);
assert.match(read("desktop/main.js"), /Management interface: \$\{webUrl\}/);
assert.match(read("desktop/main.js"), /terma:set-interface-language/);
assert.match(read("desktop/preload.js"), /setInterfaceLanguage\(language\)/);
assert.match(read("frontend/src/shared/i18n/workspace-bootstrap.ts"), /termaDesktop\?\.setInterfaceLanguage\?\.\(language\)/);
for (const nativeText of ["Open in browser", "Start all forwarding", "Stop all forwarding", "Open .ssh directory", "Open log directory", "Export logs", "Select log export directory", "Select SFTP automatic save directory", "Select local sync directory"]) {
  assert.ok(read("desktop/main.js").includes(nativeText), `desktop native UI is missing English text: ${nativeText}`);
}
for (const [relative, helper] of [
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
assert.ok(read("src/third-party-components.ts").includes('name:"i18next", version:"26.5.5"'));
assert.ok(read("src/third-party-components.ts").includes('name:"node-x11", version:"4.3.1"'));
assert.doesNotMatch(read("src/third-party-components.ts"), /\buse:\s*["'`][^"'`]*[\u3400-\u9fff]/, "third-party component purposes must use stable locale-independent codes");
assert.ok(read("THIRD_PARTY_NOTICES.md").includes("## i18next\n\n- Project: https://github.com/i18next/i18next\n- Version: 26.5.5"));
require("./sftp-job-i18n-check");
console.log(`Internationalization resource check passed: ${languages.length} languages, ${namespaces.length} namespaces.`);
