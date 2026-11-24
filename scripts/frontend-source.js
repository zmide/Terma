const fs = require("node:fs");
const path = require("node:path");

const LEGACY_BUNDLE = "public/app-legacy-adapters.js";
const LEGACY_INPUTS = Object.freeze([
]);
const legacyInputNames = new Set(LEGACY_INPUTS);

function frontendSourcePath(file) {
  return path.posix.join(legacyInputNames.has(file) ? "frontend/legacy" : "public", file);
}

function frontendJavaScriptSources(root) {
  const publicSources = fs.readdirSync(path.join(root, "public"), {withFileTypes:true})
    .filter(entry => entry.isFile() && /\.js$/i.test(entry.name))
    .map(entry => path.posix.join("public", entry.name));
  return [...publicSources.filter(file => file !== LEGACY_BUNDLE), ...LEGACY_INPUTS.map(frontendSourcePath)];
}

function legacyBundleSource(root) {
  return "// Built from frontend/legacy. Edit the individual source files.\n" + LEGACY_INPUTS.map(file => {
    const relative = frontendSourcePath(file);
    const source = fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
    return `// ${relative}\n${source}\n;\n`;
  }).join("\n");
}

const FRONTEND_DOMAINS = Object.freeze({
  docking: [],
  settings: [
    "app-theme-settings.js"
  ],
  logs: [],
  connections: [],
  terminal: [
      ],
  sftp: [],
  productivity: [],
  remote: []
});

function indexScriptFiles(root, options = {}) {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const files = [...html.matchAll(/<script\s+src="\/([^"?]+\.js)(?:\?[^"#]*)?"/g)]
    .map(match => match[1])
    .filter(file => !file.startsWith("vendor/"));
  const entries = files
    .filter(file => options.includeBootstrap || file !== "csp-bootstrap.js")
    .map(file => path.posix.join("public", file));
  return options.expandLegacy
    ? entries.flatMap(file => file === LEGACY_BUNDLE ? LEGACY_INPUTS.map(frontendSourcePath) : [file])
    : entries;
}

function readFrontendFiles(root, files) {
  return files.map(file => fs.readFileSync(path.join(root, frontendSourcePath(file)), "utf8")).join("\n");
}

function readFrontendDomain(root, domain) {
  if(domain==="utilities")return ["frontend/src/shared/browser-ui.ts","frontend/src/shared/theme-runtime.ts","frontend/src/features/connections/identity-labels.ts","frontend/src/features/settings/encryption-guard.ts","frontend/src/shared/expanded-groups.ts","frontend/src/shared/i18n/ui-phrase.ts","frontend/src/shared/action-menu.ts","frontend/src/features/efficiency/notification-actions.ts","frontend/src/shared/html-escape.ts","frontend/src/shared/api/public-errors.ts","frontend/src/shared/api/workspace-request.ts","frontend/src/shared/ui/icon-service.ts","frontend/src/shared/form-controls.ts","frontend/src/shared/ui-action-service.ts","frontend/src/shared/ui-snapshot-service.ts","frontend/src/shared/clipboard-service.ts","frontend/src/shared/viewport-service.ts","frontend/src/entries/about-embed.ts"]
    .map(file=>require("typescript-legacy").transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{compilerOptions:{target:9,module:99}}).outputText).join("\n");
  const files = FRONTEND_DOMAINS[domain];
  if (!files) throw new Error(`未知前端领域：${domain}`);
  if(domain==="terminal")return [
    "terminal-page","terminal-surface-workspace","terminal-transport-workspace",
    "terminal-input-workspace","terminal-input-actions",
    "terminal-image-workspace","terminal-connection-runtime","terminal-authentication-workspace",
    "terminal-drop-workspace","terminal-engine-view","terminal-metadata"
  ].map(name=>require("typescript-legacy").transpileModule(fs.readFileSync(path.join(root,"frontend/src/features/terminal",name+".ts"),"utf8"),
    {compilerOptions:{target:9,module:99}}).outputText).join("\n");
  return readFrontendFiles(root, files);
}

module.exports = {
  LEGACY_BUNDLE,
  LEGACY_INPUTS,
  frontendSourcePath,
  frontendJavaScriptSources,
  legacyBundleSource,
  FRONTEND_DOMAINS,
  indexScriptFiles,
  readFrontendDomain,
  readFrontendFiles
};

module.exports.frontendExportSource=function(file,name){
 const ts=require('typescript-legacy'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,99,true);
 for(const node of tree.statements){
  if(ts.isFunctionDeclaration(node)&&node.name?.text===name)return node.getText(tree);
  if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations)
    if(declaration.name.getText(tree)===name)return declaration.getText(tree);
 }
 throw new Error('Missing actual typed export '+name+' in '+file);
};
