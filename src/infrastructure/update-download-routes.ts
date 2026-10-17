export interface UpdateDownloadRoute {
  id: string;
  label: string;
  prefix: string;
}

export const UPDATE_DOWNLOAD_ROUTES: readonly UpdateDownloadRoute[] = Object.freeze([
  { id:"direct", label:"直连", prefix:"" },
  { id:"ghfast", label:"ghfast.top", prefix:"https://ghfast.top/" },
  { id:"gh-proxy-v6", label:"v6.gh-proxy.org", prefix:"https://v6.gh-proxy.org/" },
  { id:"gh-proxy-hk", label:"hk.gh-proxy.org", prefix:"https://hk.gh-proxy.org/" },
  { id:"gh-proxy-cdn", label:"cdn.gh-proxy.org", prefix:"https://cdn.gh-proxy.org/" },
  { id:"gh-proxy-edgeone", label:"edgeone.gh-proxy.org", prefix:"https://edgeone.gh-proxy.org/" }
]);

export const TRUSTED_GITHUB_ASSET_HOSTS = new Set([
  "github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com", "release-assets.githubusercontent.com"
]);

export function trustedGitHubAssetUrl(value: string): URL {
  const source = new URL(value);
  if (source.protocol !== "https:" || !TRUSTED_GITHUB_ASSET_HOSTS.has(source.hostname)
    || source.username || source.password || source.search || source.hash) {
    throw new Error("更新下载地址不是受信任的 GitHub HTTPS 地址");
  }
  if (source.hostname === "github.com") {
    const segments = source.pathname.split("/").filter(Boolean);
    if (segments.length < 6 || segments[2] !== "releases" || segments[3] !== "download") {
      throw new Error("更新下载地址不是有效的 GitHub Release 产物地址");
    }
  }
  return source;
}

export function routeDownloadUrl(route: UpdateDownloadRoute, source: URL): string {
  if (!route.prefix) return source.href;
  const prefix = new URL(route.prefix);
  if (prefix.protocol !== "https:" || prefix.username || prefix.password || prefix.search || prefix.hash) {
    throw new Error(`更新加速线路 ${route.label} 配置无效`);
  }
  return `${prefix.href}${source.href}`;
}

export function updateDownloadLinks(value: string) {
  const source = trustedGitHubAssetUrl(value);
  return UPDATE_DOWNLOAD_ROUTES.map(route => ({id:route.id, label:route.label, url:routeDownloadUrl(route, source)}));
}
