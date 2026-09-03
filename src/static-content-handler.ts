const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { PUBLIC_DIR } = require("./config");
const { PACKAGE_VERSION } = require("./services/app-metadata-service");
const { authRequired, isAuthenticated, secureHeaders } = require("./security");
const { send, sendJson } = require("./http-response");

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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title data-login-i18n="title">Terma 登录</title><link rel="stylesheet" href="/login.css"><script src="/login.js" defer></script></head><body><button id="languageToggle" class="language-toggle" type="button" title="切换到 English" aria-label="切换到 English">文/A</button><div class="card"><h1>Terma</h1><div class="muted" data-login-i18n="description">请输入 Web 访问密码；仅配置 Token 时也可直接输入 Token。</div><label for="password" data-login-i18n="credential">密码或 Token</label><div class="password-field"><input id="password" type="password" autocomplete="current-password" autofocus><button id="passwordToggle" class="password-toggle" type="button" title="显示密码" aria-label="显示密码" aria-pressed="false"><svg id="passwordShowIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg id="passwordHideIcon" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-2.3 3.5"></path><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 5.4-1.4"></path></svg></button></div><button id="loginButton" class="login-button" type="button" data-login-i18n="submit">登录</button><div id="err" class="err" role="alert" aria-live="polite"></div></div></body></html>`;
}

function mainAppContentSecurityPolicy(nonce) {
  return `default-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'self'; script-src-attr 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, secureHeaders());
    res.end();
    return;
  }
  if (pathname === "/login") {
    if (isAuthenticated(req)) return send(res, 302, "", {Location:"/"});
    return send(res, 200, loginPage(), {
      "Content-Type":"text/html; charset=utf-8",
      "Content-Security-Policy":"default-src 'self'; style-src 'self'; style-src-attr 'none'; script-src 'self'; script-src-attr 'none'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
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
  if (isVendorFile && (!fs.existsSync(file) || fs.statSync(file).isDirectory())) return sendJson(res, {error:"Vendor file not found"}, 404);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, "index.html");
  const extension = path.extname(file).toLowerCase();
  const types = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8"};
  let body = fs.readFileSync(file);
  const responseHeaders = {"Content-Type":types[extension] || "application/octet-stream", "Cache-Control":"no-cache"};
  if (extension === ".html" && path.basename(file) === "index.html") {
    const nonce = crypto.randomBytes(18).toString("base64");
    body = Buffer.from(body.toString("utf8")
      .replaceAll("__TERMA_CSP_NONCE__", nonce)
      .replaceAll("__TERMA_VERSION__", encodeURIComponent(PACKAGE_VERSION)), "utf8");
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
