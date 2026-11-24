import { matchingUpdateDownloadAsset, type UpdateLink, type UpdateProbeResult } from './update-link-model';
import type { ReleaseNoteSource } from './release-notes-model';

export interface UpdateAsset {
  name?: string;
  url?: string;
  digest?: string;
}

export interface UpdateProbe {
  running?: boolean;
  results?: UpdateProbeResult[];
  error?: string;
}

export interface UpdateDownloadStatus {
  state?: string;
  phase?: string;
  progress_percent?: number;
  bytes_downloaded?: number;
  size?: number;
  selected_asset_size?: number;
  selected_asset_name?: string;
  asset_name?: string;
  download_asset_name?: string;
  package_type?: string;
  platform?: string;
  arch?: string;
  can_open?: boolean;
  can_open_directory?: boolean;
  version?: string;
  digest?: string;
  source_id?: string;
  source_label?: string;
  source_speed_bytes_per_second?: number;
  download_links?: UpdateLink[];
  managed_by?: string;
  error?: string;
  [key: string]: unknown;
}

export interface UpdateRecord {
  current_version?: string;
  latest_version?: string;
  checked_at?: string;
  release_notes?: ReleaseNoteSource[];
  notes?: string;
  published_at?: string;
  release_url?: string;
  update_available?: boolean;
  republished_available?: boolean;
  release_revision?: number;
  update_ignored?: boolean;
  error?: string;
  check_error?: string;
  assets?: UpdateAsset[];
  download_status?: UpdateDownloadStatus;
  [key: string]: unknown;
}

export interface UpdateViewSnapshot {
  update: UpdateRecord | null;
  checking: boolean;
  fnos: boolean;
  releaseUrl: string;
  probe?: UpdateProbe | null;
  deferNotes?: boolean;
  statusError?: string;
  checkError?: string;
  downloadError?: string;
  probeError?: string;
  ignoreSaving?: boolean;
  downloadActionPending?: boolean;
}

export type UpdateTranslate = (key: string, options?: Record<string, unknown>) => string;
export type UpdateConfirmation = (message: string, title: string, confirm: string, cancel: string) => Promise<boolean>;

export function updateReleaseIdentity(update: UpdateRecord | null) {
  return JSON.stringify([update?.latest_version, update?.republished_available, update?.release_revision]);
}

export function isVerifiedUpdatePackage(update: UpdateRecord, download: UpdateDownloadStatus): boolean {
  if (download.state !== 'downloaded' || !download.asset_name || download.asset_name !== download.selected_asset_name
    || String(download.version || '').replace(/^v/i, '') !== String(update.latest_version || '').replace(/^v/i, '')) return false;
  const selected = update.assets?.find(asset => asset.name === download.selected_asset_name);
  return !update.republished_available || !selected?.digest || !download.digest || selected.digest === download.digest;
}

export function selectedFnosUpdateAsset(update: UpdateRecord): UpdateAsset | null {
  const selected = matchingUpdateDownloadAsset(update);
  const arch = update.download_status?.arch;
  const version = String(update.latest_version || '').replace(/^v/i, '');
  if (!selected || (arch !== 'x64' && arch !== 'arm64') || !/^\d+(?:\.\d+)+$/.test(version)) return null;
  const releaseBase = 'https://github.com/zmide/Terma/releases/';
  const tag = ['v' + version, version].find(value => update.release_url === releaseBase + 'tag/' + value);
  const name = 'Terma-' + version + '-fnos-' + arch + '.fpk';
  return tag && selected.name === name && selected.url === releaseBase + 'download/' + tag + '/' + name ? selected : null;
}
