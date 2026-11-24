export interface UpdateLink {
  id?: string;
  label?: string;
  url?: string;
}

export interface UpdateProbeResult {
  id?: string;
  available?: boolean;
  bytes_per_second?: number;
  elapsed_ms?: number;
  error?: string;
}

interface LinkAsset { name?: string; url?: string }
interface LinkRelease<T extends LinkAsset> {
  assets?: T[];
  download_status?: { download_asset_name?: string; download_links?: UpdateLink[] };
}

export function matchingUpdateDownloadAsset<T extends LinkAsset>(update: LinkRelease<T> | null): T | undefined {
  const download = update?.download_status;
  const routes = download?.download_links;
  if (!Array.isArray(routes) || !Array.isArray(update?.assets) || !download?.download_asset_name) return undefined;
  return update.assets.find(asset => asset?.url && asset.name === download.download_asset_name &&
    routes.some(link => link?.id === 'direct' && link.url === asset.url));
}

export function updateManualLinksAllowed(update: LinkRelease<LinkAsset> | null): boolean {
  const routes = update?.download_status?.download_links;
  return Array.isArray(routes) && routes.length > 0 && (!Array.isArray(update?.assets) || Boolean(matchingUpdateDownloadAsset(update)));
}

export function safeUpdateDownloadUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function updateDownloadLinkRows(routes: UpdateLink[], results: UpdateProbeResult[]) {
  const fastest = results.reduce<UpdateProbeResult | undefined>((current, item) => (
    item?.available && Number(item.bytes_per_second) > Number(current?.bytes_per_second || 0) ? item : current
  ), undefined);
  return routes.flatMap((link, index) => {
    const url = safeUpdateDownloadUrl(link?.url);
    if (!url) return [];
    const result = results.find(item => item?.id === link.id);
    return [{link, index, url, result, fastest: Boolean(result && result === fastest)}];
  });
}
