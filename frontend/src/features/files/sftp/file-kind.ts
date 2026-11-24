import {filesServices} from '@/features/files/installed-services';
const kinds: Record<string, string> = {
  sh: 'script', bash: 'script', zsh: 'script', fish: 'script', bat: 'script', cmd: 'script', ps1: 'script',
  json: 'config', yaml: 'config', yml: 'config', toml: 'config', xml: 'config', ini: 'config', conf: 'config', cfg: 'config', env: 'config', properties: 'config',
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', css: 'code', html: 'code', py: 'code', go: 'code', rs: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', sql: 'code', php: 'code', rb: 'code',
  md: 'text', txt: 'text', rtf: 'text', log: 'log', out: 'log',
  zip: 'archive', gz: 'archive', tgz: 'archive', tar: 'archive', rar: 'archive', '7z': 'archive', xz: 'archive', bz2: 'archive',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', svgz: 'image', ico: 'image',
  mp4: 'media', mkv: 'media', avi: 'media', mov: 'media', mp3: 'media', wav: 'media', flac: 'media',
  csv: 'data', tsv: 'data', db: 'data', sqlite: 'data', sqlite3: 'data',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document'
};

export function sftpFileKind(name: string) {
  const lower = String(name || '').toLowerCase();
  if (['.bashrc', '.profile', '.zshrc'].includes(lower)) return 'script';
  const extension = lower.replace(/^\./, '').split('.').pop() || '';
  return kinds[extension] || 'file';
}

export function installSftpFileKind() {
  filesServices.termaSftpFileKind = sftpFileKind;
  filesServices.termaSftpFilePresentation = sftpFilePresentation;
}

export function sftpFilePresentation(name: string, type: string) {
  const kind = type === 'dir' ? 'dir' : sftpFileKind(name);
  const icons: Record<string, string> = {dir: 'folder', script: 'terminal-square', config: 'braces', code: 'file-code-2', text: 'file-text', log: 'scroll-text', archive: 'file-archive', image: 'image', media: 'file-play', data: 'database', document: 'file-text'};
  const extension = name.replace(/^\./, '').split('.').pop()?.toUpperCase() || 'FILE';
  return {kind, glyph: icons[kind] || 'file', badge: type === 'dir' ? '' : extension.length > 5 ? 'FILE' : extension};
}



export interface InstalledFeaturesFilesSftpFileKindServices {
  termaSftpFileKind: typeof sftpFileKind;
  termaSftpFilePresentation: typeof sftpFilePresentation
}
