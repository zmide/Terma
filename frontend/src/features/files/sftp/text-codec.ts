export interface DecodedText { ok: true; content: string; encoding: string; bom: boolean; line_count: number; line_ending: 'crlf' | 'cr' | 'lf'; final_newline: boolean }
export type DecodeResult = DecodedText | { ok: false; error_code: 'binary_content' | 'unsupported_encoding' | 'decode_failed' };
export const openFileLimit = 50 * 1024 * 1024;
export function decodeRemoteText(request: unknown): DecodeResult {
  try {
    const input = request as { buffer?: unknown; encoding?: unknown };
    if (!(input?.buffer instanceof ArrayBuffer) || input.buffer.byteLength > openFileLimit) return { ok: false, error_code: 'decode_failed' };
    const bytes = new Uint8Array(input.buffer);
    if (bytes.includes(0)) return { ok: false, error_code: 'binary_content' };
    let encoding = String(input.encoding || 'auto').toLowerCase();
    if (!['auto', 'utf8', 'utf8bom', 'gb18030', 'gbk', 'big5', 'shift_jis', 'euc-kr', 'latin1'].includes(encoding)) return { ok: false, error_code: 'unsupported_encoding' };
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (encoding === 'auto') {
      if (bom) encoding = 'utf8bom';
      else { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf8'; } catch { encoding = 'gb18030'; } }
    }
    const source = encoding === 'utf8bom' && bom ? bytes.subarray(3) : bytes;
    let content: string;
    if (encoding === 'latin1') {
      const parts: string[] = [];
      for (let offset = 0; offset < source.length; offset += 32768) parts.push(String.fromCharCode(...source.subarray(offset, offset + 32768)));
      content = parts.join('');
    } else content = new TextDecoder(encoding === 'utf8' || encoding === 'utf8bom' ? 'utf-8' : encoding).decode(source);
    let crlf = 0, lf = 0, cr = 0;
    for (let index = 0; index < content.length; index++) {
      if (content[index] === '\r' && content[index + 1] === '\n') { crlf++; index++; }
      else if (content[index] === '\n') lf++;
      else if (content[index] === '\r') cr++;
    }
    return { ok: true, content, encoding, bom, line_count: crlf + lf + cr + 1, line_ending: crlf >= lf && crlf >= cr && crlf > 0 ? 'crlf' : cr > lf && cr > 0 ? 'cr' : 'lf', final_newline: /[\r\n]$/.test(content) };
  } catch { return { ok: false, error_code: 'decode_failed' }; }
}
