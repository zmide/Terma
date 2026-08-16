"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const compiledModule = path.join(root, "dist", "public-error.js");
assert.ok(fs.existsSync(compiledModule), "请先运行 npm run build 生成 dist/public-error.js");

const {
  normalizePublicErrorCode,
  publicError,
  publicErrorBody,
  publicErrorDetails,
  remoteOutputError,
  sanitizePublicErrorParams
} = require(compiledModule);

assert.equal(normalizePublicErrorCode("SSH_AUTHENTICATION_FAILED"), "ssh_authentication_failed");
assert.equal(normalizePublicErrorCode("desktop.auth-expired"), "desktop_auth_expired");
assert.equal(normalizePublicErrorCode("../../backend.request_failed"), "request_failed");
assert.equal(normalizePublicErrorCode("x".repeat(81)), "request_failed");
assert.equal(normalizePublicErrorCode("constructor"), "request_failed");

const sanitized = sanitizePublicErrorParams({
  subject:"  示例\n对象  ",
  count:3,
  enabled:true,
  missing:null,
  password:"must-not-leak",
  api_token:"must-not-leak",
  private_key:"must-not-leak",
  nested:{value:"must-not-leak"},
  list:["must-not-leak"],
  camelCase:"not-a-stable-placeholder",
  long_value:"x".repeat(300)
});
assert.deepEqual(sanitized, {
  subject:"示例 对象",
  count:3,
  enabled:true,
  missing:null,
  long_value:"x".repeat(256)
});

const created = publicError("CONFIG_PASSWORD_TOO_SHORT", "主密码至少 12 位", {min:12, password:"secret"}, 422);
assert.equal(created.message, "主密码至少 12 位");
assert.equal(created.code, "CONFIG_PASSWORD_TOO_SHORT");
assert.equal(created.publicCode, "config_password_too_short");
assert.equal(created.statusCode, 422);
assert.deepEqual(created.publicParams, {min:12});
assert.deepEqual(publicErrorDetails(created), {code:"config_password_too_short", params:{min:12}, preserveMessage:false});
assert.deepEqual(publicErrorDetails({code:"SSH_AUTHENTICATION_FAILED"}), {code:"ssh_authentication_failed", params:{}, preserveMessage:false});
const remoteOutput = remoteOutputError("远端原始 stderr");
assert.equal(remoteOutput.message, "远端原始 stderr");
assert.deepEqual(publicErrorDetails(remoteOutput), {code:"remote_output", params:{}, preserveMessage:true});

assert.deepEqual(publicErrorBody("CONTRACT_EXAMPLE", "无法处理对象", {subject:"文件", token:"secret"}), {
  error:"无法处理对象",
  code:"CONTRACT_EXAMPLE",
  error_code:"contract_example",
  error_params:{subject:"文件"}
});

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function interpolationKeys(value) {
  return [...String(value || "").matchAll(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi)].map(match => match[1]).sort();
}

const chineseErrors = JSON.parse(read("public/locales/zh-CN/errors.json"));
const englishErrors = JSON.parse(read("public/locales/en-US/errors.json"));
assert.ok(chineseErrors.backend && englishErrors.backend, "中英文 errors 资源必须包含 backend 容器");
assert.deepEqual(Object.keys(englishErrors.backend).sort(), Object.keys(chineseErrors.backend).sort(), "backend 错误码必须中英文一一对应");
for (const key of Object.keys(chineseErrors.backend)) {
  assert.deepEqual(
    interpolationKeys(englishErrors.backend[key]),
    interpolationKeys(chineseErrors.backend[key]),
    `errors:backend.${key} 的插值参数必须中英文一致`
  );
  assert.doesNotMatch(englishErrors.backend[key], /[\u3400-\u9fff]/, `errors:backend.${key} 的英文资源不得包含中文`);
}

function sourceFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) result.push(absolute);
  }
  return result;
}

function publicErrorCodeVariants(node, depth = 0) {
  if (!node || depth > 8) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return publicErrorCodeVariants(node.expression, depth + 1);
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...publicErrorCodeVariants(node.whenTrue, depth + 1),
      ...publicErrorCodeVariants(node.whenFalse, depth + 1)
    ];
  }
  if (ts.isBinaryExpression(node)
    && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    return [
      ...publicErrorCodeVariants(node.left, depth + 1),
      ...publicErrorCodeVariants(node.right, depth + 1)
    ];
  }
  return [];
}

const publicErrorCodeLocations = new Map();
for (const file of sourceFiles(path.join(root, "src"))) {
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && ["publicError", "publicErrorBody"].includes(node.expression.text)
      && node.arguments.length) {
      for (const rawCode of publicErrorCodeVariants(node.arguments[0])) {
        const code = normalizePublicErrorCode(rawCode);
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const locations = publicErrorCodeLocations.get(code) || [];
        locations.push(`${path.relative(root, file)}:${position.line + 1}`);
        publicErrorCodeLocations.set(code, locations);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const missingPublicErrorResources = [...publicErrorCodeLocations]
  .filter(([code]) => !Object.prototype.hasOwnProperty.call(chineseErrors.backend, code))
  .map(([code, locations]) => `${code} (${locations.join(", ")})`)
  .sort();
assert.deepEqual(
  missingPublicErrorResources,
  [],
  `公开错误码缺少中英文 errors:backend 资源：\n${missingPublicErrorResources.join("\n")}`
);

const migratedPublicErrorFiles = [
  "src/auth-protection.ts",
  "src/crypto-store.ts",
  "src/database/productivity-repository.ts",
  "src/routes/desktop-integration-routes.ts",
  "src/routes/sftp-transfer-routes.ts",
  "src/services/x11-management-service.ts",
  "src/vnc-server-manager.ts",
  "src/xdmcp-manager.ts"
];
const legacyPublicErrorLeaks = [];
for (const relative of migratedPublicErrorFiles) {
  const file = path.join(root, relative);
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isThrowStatement(node)
      && ts.isNewExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "Error") {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      legacyPublicErrorLeaks.push(`${relative}:${position.line + 1} 仍直接 throw new Error`);
    }
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "sendJson"
      && ts.isObjectLiteralExpression(node.arguments[1])) {
      const directError = node.arguments[1].properties.some(property => ts.isPropertyAssignment(property)
        && ((ts.isIdentifier(property.name) && property.name.text === "error")
          || (ts.isStringLiteral(property.name) && property.name.text === "error")));
      if (directError) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        legacyPublicErrorLeaks.push(`${relative}:${position.line + 1} 仍直接 sendJson({error:...})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual(
  legacyPublicErrorLeaks,
  [],
  `已迁移高风险后端文件不得绕过公开错误契约：\n${legacyPublicErrorLeaks.join("\n")}`
);

const frontendSource = read("public/app-api.js");
const i18nSource = read("public/app-i18n.js");
const serverSource = read("src/server.ts");
assert.match(serverSource, /publicErrorDetails\(error, body\.code\)/, "统一异常出口必须生成公开错误详情");
assert.match(serverSource, /body\.error_code\s*=\s*publicDetails\.code/, "统一异常出口必须返回 error_code");
assert.match(serverSource, /body\.error_params\s*=\s*publicDetails\.params/, "统一异常出口必须返回经过清洗的 error_params");
assert.match(serverSource, /body\.preserve_error_message\s*=\s*true/, "显式远端输出异常必须携带保留原文标记");
assert.match(frontendSource, /`errors:backend\.\$\{code\}`/, "前端必须优先按公开错误码查询 errors:backend 资源");
assert.match(frontendSource, /errors:backend\.request_failed/, "英文缺少具体错误资源时必须回退统一英文错误");
assert.match(frontendSource, /exists\?\.\(key, \{lng:language, fallbackLng:false\}\)/, "具体错误资源查询不得回退到另一种语言");
assert.match(frontendSource, /rememberTermaRawUiPhrase\(source\)/, "显式远端输出必须登记为前端自动翻译豁免文本");
assert.match(i18nSource, /function rememberTermaRawUiPhrase\(value\)/, "i18n 运行时必须提供远端原文登记入口");
assert.match(i18nSource, /if \(isTermaRawUiPhrase\(source\)\) return ""/, "自动翻译必须跳过已登记的远端原文");

function rawPhraseRegistryContext() {
  const initializationOffset = i18nSource.indexOf("window.termaI18nReady = (async () => {");
  assert.ok(initializationOffset > 0, "无法定位 i18n 运行时初始化边界");
  let now = 1_000_000;
  const context = {console, window:{}, Date:{now:() => now}};
  context.advanceTime = milliseconds => { now += milliseconds; };
  vm.createContext(context);
  vm.runInContext(i18nSource.slice(0, initializationOffset), context, {filename:"public/app-i18n.js"});
  return context;
}

const rawRegistry = rawPhraseRegistryContext();
const multilineRemoteOutput = "远端第一行\nremote second line";
assert.equal(rawRegistry.rememberTermaRawUiPhrase(multilineRemoteOutput), multilineRemoteOutput);
assert.equal(rawRegistry.isTermaRawUiPhrase(multilineRemoteOutput), true, "完整远端输出必须登记");
assert.equal(rawRegistry.isTermaRawUiPhrase("远端第一行"), true, "远端输出每一行也必须登记");
assert.equal(rawRegistry.isTermaRawUiPhrase("remote second line"), true, "非中文远端输出行也必须保持同一原样契约");
assert.equal(rawRegistry.translatedTermaPhrase("远端第一行"), "", "已登记远端输出不得进入短语或词级翻译");
rawRegistry.advanceTime(30_001);
assert.equal(rawRegistry.isTermaRawUiPhrase("远端第一行"), false, "远端原文翻译豁免必须按时过期，避免影响后续同文案界面");

const boundedRawRegistry = rawPhraseRegistryContext();
boundedRawRegistry.rememberTermaRawUiPhrase("oldest remote output");
for (let index = 0; index < 512; index += 1) boundedRawRegistry.rememberTermaRawUiPhrase(`remote output ${index}`);
assert.equal(boundedRawRegistry.isTermaRawUiPhrase("oldest remote output"), false, "远端原文登记表必须淘汰最旧条目");
assert.equal(boundedRawRegistry.isTermaRawUiPhrase("remote output 511"), true, "远端原文登记表必须保留最新条目");

function localeValue(resources, key) {
  const match = /^errors:backend\.([a-z0-9_]+)$/.exec(String(key || ""));
  return match ? resources.backend?.[match[1]] : undefined;
}

function interpolate(value, options) {
  return String(value).replace(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi, (_match, key) => String(options?.[key] ?? ""));
}

function frontendContext(language, resources) {
  const preservedRawPhrases = [];
  const context = {
    console,
    document:{documentElement:{lang:language}},
    normalizeTermaLanguage:value => value === "en-US" ? "en-US" : "zh-CN",
    rememberTermaRawUiPhrase(value) {
      preservedRawPhrases.push(String(value));
      return String(value);
    },
    localizedTermaUiPhrase:value => String(value || ""),
    tr(key, options = {}) {
      const translated = localeValue(resources, key);
      return translated === undefined ? String(options.defaultValue || key) : interpolate(translated, options);
    }
  };
  context.window = {
    i18next:{
      resolvedLanguage:language,
      exists:key => localeValue(resources, key) !== undefined
    }
  };
  vm.createContext(context);
  vm.runInContext(frontendSource, context, {filename:"public/app-api.js"});
  context.preservedRawPhrases = preservedRawPhrases;
  return context;
}

const englishFrontend = frontendContext("en-US", englishErrors);
assert.equal(
  englishFrontend.localizedBackendPublicError({error_code:"REMOTE_OUTPUT", preserve_error_message:true}, "远端原始中文 stderr"),
  "远端原始中文 stderr",
  "英文界面必须原样保留显式标记的远端输出"
);
assert.deepEqual(englishFrontend.preservedRawPhrases, ["远端原始中文 stderr"]);
assert.equal(
  englishFrontend.localizedBackendPublicError({error_code:"CONTRACT_EXAMPLE", error_params:{subject:"fixture"}}, "后端原始中文"),
  "Could not process fixture"
);
assert.equal(
  englishFrontend.localizedBackendPublicError({error_code:"UNMIGRATED_INTERNAL_ERROR"}, "包含敏感细节的中文错误"),
  englishErrors.backend.request_failed,
  "英文模式不得在缺少具体资源键时回显后端中文"
);
assert.equal(
  englishFrontend.localizedBackendPublicError({}, "Connection refused"),
  "Connection refused",
  "旧后端返回的纯英文错误仍可保留"
);
assert.equal(
  englishFrontend.localizedBackendPublicError({}, "旧后端中文错误"),
  englishErrors.backend.request_failed,
  "旧后端未提供错误码时也不得让中文漏入英文界面"
);

const chineseFrontend = frontendContext("zh-CN", chineseErrors);
assert.equal(
  chineseFrontend.localizedBackendPublicError({error_code:"REMOTE_OUTPUT", preserve_error_message:true}, "remote stderr: permission denied"),
  "remote stderr: permission denied",
  "中文界面也必须原样保留显式标记的远端输出"
);
assert.equal(
  chineseFrontend.localizedBackendPublicError({error_code:"UNMIGRATED_INTERNAL_ERROR"}, "保留后端中文详情"),
  "保留后端中文详情",
  "中文模式在尚未迁移具体错误码时应保留诊断详情"
);

console.log("后端公开错误契约检查通过：稳定错误码、参数脱敏、中英文资源和英文安全回退均有效");
