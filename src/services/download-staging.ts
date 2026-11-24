import fs from 'node:fs';
import path from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function allocateDownloadStage(id: string, basename: string, fallback: string, options: any) {
  if (!uuid.test(id)) throw new Error('Invalid download identifier');
  const desktop = options.deliveryMode === 'desktop';
  const requested = String(options.autoSaveDirectory || '').trim();
  if (desktop && (!requested || !path.isAbsolute(requested) || requested.includes('\0'))) throw new Error('Invalid download directory');
  fs.mkdirSync(desktop ? requested : fallback, {recursive:true});
  const directory = fs.realpathSync(desktop ? requested : fallback);
  const filename = desktop ? `.terma-download-${id}.part` : `${id}-${basename}`;
  const tempPath = path.join(directory, filename);
  const handle = fs.openSync(tempPath, 'wx', 0o600);
  fs.closeSync(handle);
  return {tempPath, directory:desktop ? directory : '', external:desktop};
}

export function managedExternalDownload(job: any) {
  if (!job?.download_stage_directory || !uuid.test(String(job.id || '')) || !job.temp_path) return false;
  const root = String(job.download_stage_directory);
  return path.isAbsolute(root) && path.resolve(job.temp_path) === path.join(path.resolve(root), `.terma-download-${job.id}.part`);
}

export function assertDownloadStage(job: any) {
  if (!job.download_stage_directory) return;
  if (!managedExternalDownload(job)) throw new Error('Invalid download staging path');
  const stat = fs.lstatSync(job.temp_path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid download staging file');
  if (fs.realpathSync(path.dirname(job.temp_path)) !== path.resolve(job.download_stage_directory)) throw new Error('Download directory changed');
}
