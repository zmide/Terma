type CacheInfo = {
  bytes?: number;
  files?: number;
  reclaimable_bytes?: number;
  reclaimable_files?: number;
  busy?: boolean;
  [key: string]: unknown;
};

type ProgramCacheDependencies = {
  sftpCacheInfo(): any;
  clearSftpCache(category?: string): any;
  updateCacheInfo(): CacheInfo;
  clearUpdateCache(): any;
  remoteComponentCacheInfo(): CacheInfo;
  clearRemoteComponentCache(): any;
  desktopCacheInfo(): { local_installers?: CacheInfo } | null;
  clearDesktopCache(category: string): any;
};

const CACHE_CATEGORIES = new Set([
  "sftp_downloads",
  "sftp_uploads",
  "sftp_drag",
  "updates",
  "remote_components",
  "local_installers"
]);

function normalizedInfo(value: CacheInfo = {}): CacheInfo {
  const bytes = Math.max(0, Number(value.bytes || 0));
  const files = Math.max(0, Number(value.files || 0));
  const reclaimableBytes = Math.max(0, Math.min(bytes, Number(value.reclaimable_bytes ?? bytes)));
  const reclaimableFiles = Math.max(0, Math.min(files, Number(value.reclaimable_files ?? files)));
  return {
    ...value,
    bytes,
    files,
    reclaimable_bytes:reclaimableBytes,
    reclaimable_files:reclaimableFiles,
    busy:Boolean(value.busy)
  };
}

export function createProgramCacheManager(dependencies: ProgramCacheDependencies) {
  function categories() {
    const sftp = dependencies.sftpCacheInfo() || {};
    const updates = dependencies.updateCacheInfo() || {};
    const remoteComponents = dependencies.remoteComponentCacheInfo() || {};
    const desktop = dependencies.desktopCacheInfo() || {};
    return {
      sftp_downloads:normalizedInfo(sftp.downloads),
      sftp_uploads:normalizedInfo(sftp.uploads),
      sftp_drag:normalizedInfo(sftp.drag),
      updates:normalizedInfo({
        ...updates,
        reclaimable_bytes:updates.busy ? 0 : updates.bytes,
        reclaimable_files:updates.busy ? 0 : updates.files
      }),
      remote_components:normalizedInfo(remoteComponents),
      local_installers:normalizedInfo(desktop.local_installers)
    };
  }

  function view() {
    const items = categories();
    const values = Object.values(items);
    const bytes = values.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    const files = values.reduce((sum, item) => sum + Number(item.files || 0), 0);
    const reclaimableBytes = values.reduce((sum, item) => sum + Number(item.reclaimable_bytes || 0), 0);
    const reclaimableFiles = values.reduce((sum, item) => sum + Number(item.reclaimable_files || 0), 0);
    return {
      bytes,
      files,
      reclaimable_bytes:reclaimableBytes,
      reclaimable_files:reclaimableFiles,
      retained_bytes:Math.max(0, bytes - reclaimableBytes),
      retained_files:Math.max(0, files - reclaimableFiles),
      categories:items
    };
  }

  function clear(category = "") {
    const requested = String(category || "").trim();
    if (requested && !CACHE_CATEGORIES.has(requested)) {
      const error: any = new Error("未知的缓存分类");
      error.statusCode = 400;
      throw error;
    }
    const selected = requested ? new Set([requested]) : CACHE_CATEGORIES;
    const sftpCategories = ["sftp_downloads", "sftp_uploads", "sftp_drag"];
    const selectedSftp = sftpCategories.filter(name => selected.has(name));
    if (selectedSftp.length === sftpCategories.length) dependencies.clearSftpCache();
    else {
      for (const name of selectedSftp) dependencies.clearSftpCache(name);
    }
    if (selected.has("updates") && !dependencies.updateCacheInfo()?.busy) dependencies.clearUpdateCache();
    if (selected.has("remote_components")) dependencies.clearRemoteComponentCache();
    if (selected.has("local_installers")) dependencies.clearDesktopCache("local_installers");
    return view();
  }

  return { clear, view };
}
