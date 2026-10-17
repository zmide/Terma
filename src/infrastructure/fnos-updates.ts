import type { UpdateAsset } from "../update-installer";
import { updateDownloadLinks } from "./update-download-routes";

export function selectFnosUpdateAsset(release: any, arch: string = process.arch): UpdateAsset | null {
  const version = String(release?.latest_version || "").replace(/^v/i, "");
  if (!["x64", "arm64"].includes(arch) || !/^\d+(?:\.\d+)+$/.test(version)) return null;
  const tag = String(release?.release_url || "");
  if (![version, `v${version}`].some(value => tag === `https://github.com/zmide/Terma/releases/tag/${value}`)) return null;
  const name = `Terma-${version}-fnos-${arch}.fpk`;
  const url = `${tag.replace("/tag/", "/download/")}/${name}`;
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset: UpdateAsset) => asset?.name === name && asset.url === url) || null;
}

export function fnosUpdateStatus(release?: unknown, arch: string = process.arch) {
  const asset = selectFnosUpdateAsset(release, arch);
  return {state:"managed", managed_by:"fnos", platform:process.platform, arch,
    package_type:"fpk", can_open:false, can_open_directory:false,
    download_asset_name:asset?.name || "", download_links:asset ? updateDownloadLinks(asset.url) : []};
}
