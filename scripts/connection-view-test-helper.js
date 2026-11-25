"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const vue = require(path.join(root, "frontend/node_modules/vue"));
const { renderToString } = require(path.join(root, "frontend/node_modules/@vue/server-renderer"));
const ts = require("typescript-legacy");
const { loadFrontendService } = require("./frontend-service-test-helper");
const formControls = loadFrontendService("frontend/src/shared/form-controls.ts", {
  require: name => {
    if (name === "vue") return vue;
    if (name === "@/shared/installed-services") return {sharedServices:{}};
    if (name === "@/shared/i18n/workspace-bootstrap") return {tr:key=>key,registerTermaI18nRenderer(){}};
    if (name === "@/shared/viewport-service") return {settleNativeFileDialogViewport(){}};
    if (name.includes("SettingsPasswordField")) return {};
    throw new Error("Unexpected form control view dependency: " + name);
  }
});

// Render the migrated view itself; controllers remain exercised in their VM sandbox.
function loadConnectionViews() {
  const filename = path.join(root, "frontend/src/features/connections/connection-views.ts");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, require:name => {
    const installed=require('./frontend-service-test-helper').installedServiceFixture(name,{});
    if(installed)return installed;
    if (name === "vue") return vue;
    if (name === "../../shared/form-controls") return formControls;
    if (name === "../settings/quick-open-preference") return loadFrontendService("frontend/src/features/settings/quick-open-preference.ts", {
      tr:key=>key,notify(){},api:async()=>({})
    });
    if (name === "../data-exchange/exchange-model") return loadFrontendService("frontend/src/features/data-exchange/exchange-model.ts");
    if (name.includes("TermaButton")) return {TermaButton:(_props, {attrs, slots}) => vue.h("button", attrs, slots.default?.())};
    if (name.includes("connection-mount")) return {connectionIcon:() => vue.h("i"), connectionEmptyState:(_, title) => vue.h("span", title)};
    if (name.includes("RemoteProfileForm")) return {RemoteProfileForm:vue.defineComponent({render:() => null})};
    if (name === "./ConnectionBulkFields") return {ConnectionBulkFields:vue.defineComponent({render:() => null})};
    if (name === "../remote/profile-host-groups") return loadFrontendService("frontend/src/features/remote/profile-host-groups.ts");
    if (name.includes("SettingsPasswordField")) return {};
    throw new Error("Unexpected view dependency: " + name);
  }}, {filename, timeout:5000});
  return exports;
}

const views = loadConnectionViews();
async function connectionViewHtml(name, scope, ...args) {
  return renderToString(vue.h("div", null, views[name](scope, ...args)));
}

module.exports = {connectionViewHtml};
