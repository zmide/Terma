import { publicError } from '../public-error';

type RenameChannel = { lstat(path: string, done: (error: any, stats?: unknown) => void): void; rename(from: string, to: string, done: (error?: any) => void): void };
export async function renameSftpEntry(channel: RenameChannel, from: string, to: string) {
  if (!from || !to || from.includes('\0') || to.includes('\0')) throw publicError('sftp_invalid_path', '远程路径无效', {}, 400);
  if (from === to) return { ok: true };
  const conflict = () => publicError('sftp_rename_exists', '该名称已存在，请使用其他名称；已有文件和文件夹不会被覆盖', {}, 409);
  const exists = () => new Promise<boolean>((resolve, reject) => channel.lstat(to, error => {
    if (!error) resolve(true);
    else if (Number(error.code) === 2) resolve(false);
    else reject(error);
  }));
  if (await exists()) throw conflict();
  // SFTP v3 RENAME requires a new destination. Never use the overwriting OpenSSH extension.
  try { await new Promise<void>((resolve, reject) => channel.rename(from, to, error => error ? reject(error) : resolve())); }
  catch (error) { if (await exists().catch(() => false)) throw conflict(); throw error; }
  return { ok: true };
}
