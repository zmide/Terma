const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = require(path.join(root, "dist", "services", "x11-management-service"));
const route = fs.readFileSync(path.join(root, "src", "routes", "x11-forwarding-routes.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "public", "app-x11.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const englishCommon = JSON.parse(fs.readFileSync(path.join(root, "public", "locales", "en-US", "common.json"), "utf8"));
const chineseCommon = JSON.parse(fs.readFileSync(path.join(root, "public", "locales", "zh-CN", "common.json"), "utf8"));

assert.match(service.X11_CLIPBOARD_DETECT_SCRIPT, /command -v xclip/);
const missing = service.parseX11ClipboardHelperDetection([
  "TERMA_X11_CLIPBOARD_PLATFORM=linux",
  "TERMA_X11_CLIPBOARD_PACKAGE_MANAGER=apt",
  "TERMA_X11_CLIPBOARD_INSTALLED=false",
  "TERMA_X11_CLIPBOARD_ROOT=false",
  "TERMA_X11_CLIPBOARD_DISPLAY=",
  ""
].join("\n"), {id:7,name:"Linux",ssh_host:"192.0.2.7",ssh_user:"root"});
assert.equal(missing.installed, false);
assert.equal(missing.install_plan.online.available, true);
assert.equal(missing.install_plan.offline.available, true);
assert.equal(missing.install_plan.local_offline.available, true);
assert.deepEqual(missing.install_plan.local_offline.package_names, ["xclip"]);
assert.equal(missing.uninstall_plan.available, false);
assert.deepEqual(missing.guide.summary, {i18n_key:"common:x11.clipboard_guide_summary", params:{}});
assert.match(englishCommon.x11.clipboard_guide_summary, /xclip/i);
assert.match(chineseCommon.x11.clipboard_guide_summary, /xclip/i);
assert.equal(missing.guide.steps.length, 4);
assert.ok(missing.guide.steps.every(step => /^common:x11\.clipboard_guide_/.test(step.i18n_key)));
assert.doesNotThrow(() => service.validateX11ClipboardInstallSelection(missing, "local-offline", {command:""}, false));
assert.throws(() => service.validateX11ClipboardInstallSelection(missing, "online", {command:""}, false), /没有可用的 xclip 安装方案/);

const installed = service.parseX11ClipboardHelperDetection([
  "TERMA_X11_CLIPBOARD_PLATFORM=linux",
  "TERMA_X11_CLIPBOARD_PACKAGE_MANAGER=apt",
  "TERMA_X11_CLIPBOARD_INSTALLED=true",
  "TERMA_X11_CLIPBOARD_ROOT=true",
  "TERMA_X11_CLIPBOARD_DISPLAY=:0",
  ""
].join("\n"), {id:7,name:"Linux",ssh_host:"192.0.2.7",ssh_user:"root"});
assert.equal(installed.installed, true);
assert.equal(installed.uninstall_plan.available, true);
assert.match(installed.uninstall_plan.command, /apt-get purge -y xclip/);

assert.match(route, /x11-clipboard.*helper/);
assert.match(ui, /runX11ClipboardHelperAction/);
assert.match(ui, /renderX11ClipboardHelperPanel/);
assert.match(ui, /remote-service-head xserver-clipboard-head/);
assert.doesNotMatch(ui, /diagnostics\.reason && !installed/);
assert.match(css, /\.xserver-clipboard-panel \.remote-install-modes \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
console.log("X11 图片剪贴板辅助检查通过：Linux 检测、在线/缓存/本机离线安装、卸载和 X Server 管理入口均存在");
