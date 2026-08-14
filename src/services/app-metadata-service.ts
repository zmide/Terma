const fs = require("node:fs");
const path = require("node:path");

const { PUBLIC_DIR } = require("../config");
const { listThirdPartyComponents } = require("../third-party-components");

const PACKAGE_ROOT = path.resolve(PUBLIC_DIR, "..");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const PACKAGE_VERSION = String(JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")).version || "");

function aboutInfo() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  const licenseCandidates = [
    resourcesPath ? path.join(resourcesPath, "LICENSE") : "",
    path.join(PACKAGE_ROOT, "LICENSE")
  ].filter(Boolean);
  const licensePath = licenseCandidates.find(candidate => fs.existsSync(candidate));
  const noticesCandidates = [
    resourcesPath ? path.join(resourcesPath, "THIRD_PARTY_NOTICES.md") : "",
    path.join(PACKAGE_ROOT, "THIRD_PARTY_NOTICES.md")
  ].filter(Boolean);
  const noticesPath = noticesCandidates.find(candidate => fs.existsSync(candidate));
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const author = typeof packageJson.author === "string"
    ? packageJson.author.replace(/\s*<[^>]+>\s*$/, "").trim()
    : String(packageJson.author?.name || "").trim();
  return {
    product_name:"Terma",
    version:packageJson.version,
    author,
    license:packageJson.license,
    license_name:"GNU General Public License v3.0 only",
    repository_url:String(packageJson.homepage || repository || "").replace(/^git\+/, "").replace(/\.git$/, ""),
    license_available:Boolean(licensePath),
    license_error:licensePath ? "" : "未找到随程序提供的开源许可正文",
    license_text:licensePath ? fs.readFileSync(licensePath, "utf8") : "",
    third_party_components:listThirdPartyComponents(),
    third_party_notices_available:Boolean(noticesPath),
    third_party_notices_error:noticesPath ? "" : "未找到随程序提供的第三方组件声明"
  };
}

module.exports = {
  PACKAGE_ROOT,
  PACKAGE_VERSION,
  aboutInfo
};
