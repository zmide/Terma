const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { PUBLIC_DIR } = require("./config");
const { PACKAGE_VERSION } = require("./services/app-metadata-service");
const { authRequired, isAuthenticated, secureHeaders } = require("./security");
const { send, sendJson } = require("./http-response");
const { isFnosDistribution } = require("./infrastructure/distribution-policy");

const VUE_DIST_DIR = path.resolve(__dirname, "../frontend/dist");
const VUE_PAGE_CONFIGS = [
  {page: "login.html", assetPrefix: "/login-vue-assets/", manifestKey: "login.html"},
  {page: "about.html", assetPrefix: "/about-vue-assets/", manifestKey: "about.html"},
  {page: "about-embed.html", assetPrefix: "/about-vue-assets/", manifestKey: "about-embed.html"}
];
const VUE_MANIFEST_PATH = path.join(VUE_DIST_DIR, ".vite", "manifest.json");
const STATIC_CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"]
]);
const RESOURCE_DIRECTORIES = ["/assets", "/fonts", "/locales", "/vendor"];

function vendorFile(packageName, relativePath) {
  const local = path.resolve(__dirname, "../node_modules", packageName, relativePath);
  if (fs.existsSync(local)) return local;
  try {
    return require.resolve(`${packageName}/${relativePath}`);
  } catch {
    return local;
  }
}

const VENDOR_FILES = new Map([
  ["/vendor/i18next/i18next.min.js", vendorFile("i18next", "dist/umd/i18next.min.js")],
  ["/vendor/lucide/lucide.min.js", vendorFile("lucide", "dist/umd/lucide.min.js")],
  ["/vendor/diff/diff.min.js", vendorFile("diff", "dist/diff.min.js")],
  ["/vendor/jspdf/jspdf.umd.min.js", vendorFile("jspdf", "dist/jspdf.umd.min.js")],
  ["/vendor/svg2pdf/svg2pdf.umd.min.js", vendorFile("svg2pdf.js", "dist/svg2pdf.umd.min.js")],
  ["/vendor/xterm/xterm.css", vendorFile("@xterm/xterm", "css/xterm.css")],
  ["/vendor/xterm/xterm.js", vendorFile("@xterm/xterm", "lib/xterm.js")],
  ["/vendor/xterm/xterm.mjs", vendorFile("@xterm/xterm", "lib/xterm.mjs")],
  ["/vendor/xterm/addon-fit.js", vendorFile("@xterm/addon-fit", "lib/addon-fit.js")],
  ["/vendor/xterm/addon-fit.mjs", vendorFile("@xterm/addon-fit", "lib/addon-fit.mjs")]
]);
const ACE_VENDOR_DIR = vendorFile("ace-builds", "src-min-noconflict");
VENDOR_FILES.set("/vendor/ace/ace.css", vendorFile("ace-builds", "css/ace.css"));
VENDOR_FILES.set("/vendor/ace/theme-textmate.css", vendorFile("ace-builds", "css/theme/textmate.css"));
VENDOR_FILES.set("/vendor/ace/theme-tomorrow_night.css", vendorFile("ace-builds", "css/theme/tomorrow_night.css"));
const NOVNC_VENDOR_DIR = vendorFile("@novnc/novnc", "core/..");

function loginPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title data-login-i18n="title">Terma 登录</title><link rel="stylesheet" href="/login.css"><script src="/login.js" defer></script></head><body><button id="languageToggle" class="language-toggle" type="button" title="切换到 English" aria-label="切换到 English">文/A</button><div class="card"><h1>Terma</h1><div class="muted" data-login-i18n="description">请输入 Web 访问密码；仅配置 Token 时也可直接输入 Token。</div><label for="password" data-login-i18n="credential">密码或 Token</label><div class="password-field"><input id="password" type="password" autocomplete="current-password" autofocus><button id="passwordToggle" class="password-toggle" type="button" title="显示密码" aria-label="显示密码" aria-pressed="false"><svg id="passwordShowIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg id="passwordHideIcon" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-2.3 3.5"></path><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 5.4-1.4"></path></svg></button></div><button id="loginButton" class="login-button" type="button" data-login-i18n="submit">登录</button><div id="err" class="err" role="alert" aria-live="polite"></div><p class="setup-hint" data-login-i18n="setup_hint"${isFnosDistribution() ? " hidden" : ""}>首次使用时，请先在运行 Terma 的设备上设置 Web 密码；登录后可在“设置 → 安全”中修改。</p><p class="setup-hint" data-login-i18n="fnos_setup_hint"${isFnosDistribution() ? "" : " hidden"}>请输入安装时设置的 Web 密码。如需设置或重置，请进入“飞牛应用中心 → Terma → 应用设置”。这里使用 Terma 自己的密码，无需用户名。</p></div></body></html>`;
}

function mainAppContentSecurityPolicy(nonce) {
  return `default-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'self'; script-src-attr 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
}

function loginContentSecurityPolicy() {
  return "default-src 'self'; style-src 'self'; style-src-attr 'none'; script-src 'self'; script-src-attr 'none'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
}

function vuePageHtml(pageName) {
  const config = VUE_PAGE_CONFIGS.find(item => item.page === pageName);
  if (!config) return null;
  const file = path.join(VUE_DIST_DIR, config.page);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return fs.readFileSync(file, "utf8").replaceAll("./assets/", config.assetPrefix);
}

function vueManifest() {
  if (!fs.existsSync(VUE_MANIFEST_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(VUE_MANIFEST_PATH, "utf8")); }
  catch { return null; }
}

function manifestAssetPaths(manifest, entryKey, files = new Set(), visited = new Set()) {
  if (!manifest || visited.has(entryKey)) return files;
  visited.add(entryKey);
  const entry = manifest[entryKey];
  if (!entry) return files;
  if (entry.file) files.add(entry.file);
  for (const css of entry.css || []) files.add(css);
  for (const imported of entry.imports || []) manifestAssetPaths(manifest, imported, files, visited);
  return files;
}

function aboutEmbedHtmlTags() {
  const file = path.join(VUE_DIST_DIR, "about-embed.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return "";
  const html = fs.readFileSync(file, "utf8");
  const tags = Array.from(html.matchAll(/<(?:script type="module" crossorigin src="\.\/assets\/[A-Za-z0-9._-]+\.js"><\/script>|link rel="(?:modulepreload|stylesheet)" crossorigin href="\.\/assets\/[A-Za-z0-9._-]+\.(?:js|css)">)/g), match => match[0]);
  return tags.map(tag => tag.replaceAll("./assets/", "/about-vue-assets/")).join("\n  ");
}

function vuePageAsset(pathname) {
  const config = VUE_PAGE_CONFIGS.find(item => pathname.startsWith(item.assetPrefix));
  if (!config) return null;
  const relative = pathname.slice(config.assetPrefix.length);
  if (!relative || relative.includes("/") || !/^[A-Za-z0-9._-]+$/.test(relative)) return {invalid: true};
  const manifest = vueManifest();
  const allowed = new Set();
  for (const pageConfig of VUE_PAGE_CONFIGS.filter(item => item.assetPrefix === config.assetPrefix)) {
    for (const file of manifestAssetPaths(manifest, pageConfig.manifestKey)) allowed.add(path.basename(file));
    const page = path.join(VUE_DIST_DIR, pageConfig.page);
    if (fs.existsSync(page) && !fs.statSync(page).isDirectory()) {
      for (const match of fs.readFileSync(page, "utf8").matchAll(/\.\/assets\/([A-Za-z0-9._-]+)/g)) allowed.add(match[1]);
    }
  }
  if (!allowed.has(relative)) return {invalid: true};
  const root = path.resolve(VUE_DIST_DIR, "assets");
  const file = path.resolve(root, relative);
  return file.startsWith(root + path.sep) ? {file} : {invalid: true};
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, secureHeaders());
    res.end();
    return;
  }
  if (pathname === "/login") {
    if (isAuthenticated(req)) return send(res, 302, "", {Location:"/"});
    const page = vuePageHtml("login.html")?.replace("<html ", `<html data-terma-distribution="${isFnosDistribution() ? "fnos" : "standard"}" `);
    return send(res, 200, page || loginPage(), {
      "Content-Type":"text/html; charset=utf-8",
      "Content-Security-Policy":loginContentSecurityPolicy(),
      "Cache-Control":"no-cache"
    });
  }
  if (pathname === "/about") {
    if (!isAuthenticated(req) && authRequired(req)) return send(res, 302, "", {Location:"/login"});
    const page = vuePageHtml("about.html");
    if (!page) return sendJson(res, {error:"Vue about page is not built"}, 503);
    return send(res, 200, page, {
      "Content-Type":"text/html; charset=utf-8",
      "Content-Security-Policy":loginContentSecurityPolicy(),
      "Cache-Control":"no-cache"
    });
  }
  if (VUE_PAGE_CONFIGS.some(item => pathname.startsWith(item.assetPrefix))) {
    const vueAsset = vuePageAsset(pathname);
    const vueAssetFile = vueAsset?.file;
    if (!vueAssetFile || !fs.existsSync(vueAssetFile) || fs.statSync(vueAssetFile).isDirectory()) return sendJson(res, {error:"Vue page asset not found"}, 404);
    const extension = path.extname(vueAssetFile).toLowerCase();
    const body = fs.readFileSync(vueAssetFile);
    res.writeHead(200, secureHeaders({
      "Content-Type":STATIC_CONTENT_TYPES.get(extension) || "application/octet-stream",
      "Cache-Control":"public, max-age=31536000, immutable",
      "Content-Length":body.length
    }));
    res.end(body);
    return;
  }
  const loginAsset = pathname === "/login.css"
    || pathname === "/login.js"
    || pathname === "/locales/zh-CN/login.json"
    || pathname === "/locales/en-US/login.json";
  if (!loginAsset && !isAuthenticated(req) && authRequired(req)) return send(res, 302, "", {Location:"/login"});
  let file;
  let isVendorFile = VENDOR_FILES.has(pathname);
  if (isVendorFile) {
    file = VENDOR_FILES.get(pathname);
  } else if (pathname.startsWith("/vendor/ace/")) {
    const name = pathname.slice("/vendor/ace/".length);
    if (!/^(?:ace|mode-[a-z0-9_-]+|theme-[a-z0-9_-]+|worker-[a-z0-9_-]+|ext-[a-z0-9_-]+)\.js$/i.test(name)) return sendJson(res, {error:"Not found"}, 404);
    file = path.resolve(ACE_VENDOR_DIR, name);
    isVendorFile = file.startsWith(path.resolve(ACE_VENDOR_DIR) + path.sep);
  } else if (pathname.startsWith("/vendor/novnc/")) {
    const name = pathname.slice("/vendor/novnc/".length);
    if (!/^(?:core|vendor)\/[a-z0-9_./-]+\.js$/i.test(name)) return sendJson(res, {error:"Not found"}, 404);
    file = path.resolve(NOVNC_VENDOR_DIR, name);
    const root = path.resolve(NOVNC_VENDOR_DIR) + path.sep;
    isVendorFile = file.startsWith(root) && (name.startsWith("core/") || name.startsWith("vendor/"));
  } else {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    file = path.resolve(PUBLIC_DIR, relative);
  }
  if (!isVendorFile && !file.startsWith(PUBLIC_DIR)) return sendJson(res, {error:"Not found"}, 404);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (isVendorFile) return sendJson(res, {error:"Vendor file not found"}, 404);
    const appAsset = /^\/app(?:-[a-z0-9-]+)?\.(?:css|js)$/i.test(pathname);
    if (loginAsset || appAsset || RESOURCE_DIRECTORIES.some(directory => pathname === directory || pathname.startsWith(`${directory}/`))) {
      return sendJson(res, {error:"Not found"}, 404);
    }
    file = path.join(PUBLIC_DIR, "index.html");
  }
  const extension = path.extname(file).toLowerCase();
  let body = fs.readFileSync(file);
  const responseHeaders = {"Content-Type":STATIC_CONTENT_TYPES.get(extension) || "application/octet-stream", "Cache-Control":"no-cache"};
  if (extension === ".html" && path.basename(file) === "index.html") {
    const nonce = crypto.randomBytes(18).toString("base64");
    body = Buffer.from(body.toString("utf8")
      .replaceAll("__TERMA_CSP_NONCE__", nonce)
      .replaceAll("__TERMA_VERSION__", encodeURIComponent(PACKAGE_VERSION))
      .replaceAll("<!-- TERMA_ABOUT_VUE_ASSETS -->", aboutEmbedHtmlTags()), "utf8");
    responseHeaders["Content-Security-Policy"] = mainAppContentSecurityPolicy(nonce);
  }
  responseHeaders["Content-Length"] = body.length;
  res.writeHead(200, secureHeaders(responseHeaders));
  res.end(body);
}

module.exports = {
  mainAppContentSecurityPolicy,
  serveStatic
};
