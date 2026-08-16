"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const namespaces = ["common", "navigation", "settings", "connections", "terminal", "sftp", "tasks", "remote", "errors"];
const placeholder = "{{value}}";

function localeEntries(language) {
  const entries = new Map();
  const visit = (value, prefix) => {
    if (typeof value === "string") entries.set(prefix, value.trim());
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  for (const namespace of namespaces) {
    const file = path.join(root, "public", "locales", language, `${namespace}.json`);
    visit(JSON.parse(fs.readFileSync(file, "utf8")), namespace);
  }
  return entries;
}

function compileTemplate(sourceValue, targetValue) {
  const source = String(sourceValue || "").trim();
  const tokenPattern = /{{-?\s*([a-z0-9_.-]+)\s*}}/gi;
  const names = [];
  let expression = "";
  let offset = 0;
  for (const match of source.matchAll(tokenPattern)) {
    expression += source.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expression += "([\\s\\S]+?)";
    names.push(match[1]);
    offset = Number(match.index) + match[0].length;
  }
  if (!names.length) return null;
  expression += source.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    expression:new RegExp(`^${expression}$`),
    literalLength:source.replace(tokenPattern, "").length,
    names,
    target:String(targetValue || "")
  };
}

const chineseEntries = localeEntries("zh-CN");
const englishEntries = localeEntries("en-US");
assert.deepEqual([...englishEntries.keys()].sort(), [...chineseEntries.keys()].sort(), "Chinese and English locale keys must match");
const chineseValues = [...chineseEntries.values()];
const exactTranslations = new Map();
const phraseTemplates = [];
for (const [key, source] of chineseEntries) {
  const target = englishEntries.get(key);
  if (!exactTranslations.has(source)) exactTranslations.set(source, target);
  const template = compileTemplate(source, target);
  if (template) phraseTemplates.push(template);
}
phraseTemplates.sort((left, right) => right.literalLength - left.literalLength || right.expression.source.length - left.expression.source.length);

function fallbackReplacements() {
  const file = path.join(root, "public", "app-i18n.js");
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let replacements = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "TERMA_I18N_FALLBACK_REPLACEMENTS"
      && ts.isCallExpression(node.initializer)
      && node.initializer.arguments.length) {
      const argument = node.initializer.arguments[0];
      const list = ts.isCallExpression(argument)
        && ts.isPropertyAccessExpression(argument.expression)
        && argument.expression.name.text === "sort"
        ? argument.expression.expression
        : argument;
      if (!ts.isArrayLiteralExpression(list)) return;
      replacements = list.elements.flatMap(element => {
        if (!ts.isArrayLiteralExpression(element) || element.elements.length !== 2) return [];
        const [sourceValue, targetValue] = element.elements;
        if (!ts.isStringLiteral(sourceValue) || !ts.isStringLiteral(targetValue)) return [];
        return [[sourceValue.text, targetValue.text]];
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(replacements.length > 100, "notification audit could not read the runtime fallback phrase catalog");
  return replacements;
}

const runtimeFallbackReplacements = fallbackReplacements();

function translatePhrase(value, depth=0) {
  const source = String(value || "").trim();
  const exact = exactTranslations.get(source);
  if (exact) return exact;
  for (const template of phraseTemplates) {
    const match = source.match(template.expression);
    if (!match) continue;
    const values = new Map();
    template.names.forEach((name, index) => {
      const captured = match[index + 1];
      values.set(name, depth < 3 ? translatePhrase(captured, depth + 1) : captured);
    });
    return template.target.replace(/{{-?\s*([a-z0-9_.-]+)\s*}}/gi, (_token, name) => String(values.get(name) ?? ""));
  }
  let translated = source;
  for (const [needle, target] of runtimeFallbackReplacements) translated = translated.split(needle).join(target);
  return translated;
}

function phraseCovered(value) {
  return !/[\u3400-\u9fff]/.test(translatePhrase(value));
}

function combine(left, right) {
  const result = [];
  for (const prefix of left) {
    for (const suffix of right) {
      result.push(`${prefix}${suffix}`);
      if (result.length >= 32) return result;
    }
  }
  return result;
}

function expressionVariants(node, depth=0) {
  if (!node || depth > 12) return [placeholder];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return expressionVariants(node.expression, depth + 1);
  }
  if (ts.isConditionalExpression(node)) {
    return [...expressionVariants(node.whenTrue, depth + 1), ...expressionVariants(node.whenFalse, depth + 1)];
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combine(expressionVariants(node.left, depth + 1), expressionVariants(node.right, depth + 1));
    }
    if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      return [...expressionVariants(node.left, depth + 1), ...expressionVariants(node.right, depth + 1)];
    }
  }
  if (ts.isTemplateExpression(node)) {
    let result = [node.head.text];
    for (const span of node.templateSpans) {
      result = combine(result, combine(expressionVariants(span.expression, depth + 1), [span.literal.text]));
    }
    return result;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "tr") return [""];
  return [placeholder];
}

const findings = new Map();
const publicRoot = path.join(root, "public");
for (const name of fs.readdirSync(publicRoot).filter(file => /^app.*\.js$/.test(file))) {
  const sourceText = fs.readFileSync(path.join(publicRoot, name), "utf8");
  const source = ts.createSourceFile(name, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "notify"
      && node.arguments.length) {
      const values = [...new Set(expressionVariants(node.arguments[0]))]
        .filter(value => /[\u3400-\u9fff]/.test(value));
      for (const value of values) {
        if (phraseCovered(value)) continue;
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const locations = findings.get(value) || [];
        locations.push(`${name}:${position.line + 1}`);
        findings.set(value, locations);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const uncovered = [...findings.entries()].map(([value, locations]) => `${locations.join(", ")} ${value}`);
if (process.env.TERMA_I18N_AUDIT_REPORT === "1") {
  console.log(uncovered.join("\n"));
  console.log(`Uncovered notification phrases: ${uncovered.length}`);
  process.exit(0);
}
assert.deepEqual(uncovered, [], `notification phrases missing from locale resources:\n${uncovered.join("\n")}`);
console.log(`Notification source internationalization check passed: ${chineseValues.length} localized phrases.`);
