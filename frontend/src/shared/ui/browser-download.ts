export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try { link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
