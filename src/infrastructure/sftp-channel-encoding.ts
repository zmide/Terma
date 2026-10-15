import iconv from "iconv-lite";
import path from "node:path";
import { filenameEncoding } from "../sftp-encoding";

const boundChannels = new WeakSet<object>();
const MAX_RAW_PATHS = 20000;

/** One byte-path map belongs to one SSH session/encoding, never to another host. */
export function bindSftpChannelEncoding(channel: any, connection: any, rawPaths = new Map<string, Buffer>()) {
  if (boundChannels.has(channel)) return channel;
  boundChannels.add(channel);
  const encoding = filenameEncoding(connection);
  const key = (value: string) => path.posix.normalize(value);
  const remember = (value: string, bytes: Buffer) => {
    rawPaths.delete(key(value));
    rawPaths.set(key(value), bytes);
    while (rawPaths.size > MAX_RAW_PATHS) rawPaths.delete(rawPaths.keys().next().value!);
  };
  const wirePath = (value: unknown): string | Buffer => {
    if (Buffer.isBuffer(value)) {
      if (value.includes(0)) throw new Error("远程路径无效");
      return value;
    }
    const text = String(value ?? "");
    if (text.includes("\0")) throw new Error("远程路径无效");
    const cached = rawPaths.get(key(text));
    if (cached) return encoding === "utf8" && cached.equals(Buffer.from(text, "utf8")) ? text : cached;
    if (encoding === "utf8") return text;
    const bytes = iconv.encode(text, encoding);
    if (iconv.decode(bytes, encoding) !== text) throw new Error(`文件名包含 ${encoding} 无法表示的字符`);
    return bytes;
  };
  const methods: Record<string, number[]> = {
    open:[0], opendir:[0], stat:[0], lstat:[0], setstat:[0], unlink:[0],
    mkdir:[0], rmdir:[0], rename:[0, 1], symlink:[0, 1],
    ext_openssh_rename:[0, 1], ext_openssh_hardlink:[0, 1],
    ext_openssh_statvfs:[0], ext_openssh_lsetstat:[0]
  };
  for (const [name, positions] of Object.entries(methods)) {
    const original = channel[name];
    if (typeof original !== "function") continue;
    channel[name] = function (...args: any[]) {
      for (const position of positions) args[position] = wirePath(args[position]);
      return original.apply(this, args);
    };
  }
  for (const name of ["realpath", "readlink"]) {
    const original = channel[name];
    if (typeof original !== "function") continue;
    channel[name] = function (requested: string, callback: (...args: any[]) => void) {
      return original.call(this, wirePath(requested), (error: any, text: string, bytes: Buffer) => {
        if (error) return callback(error);
        const decoded = Buffer.isBuffer(bytes) ? iconv.decode(bytes, encoding) : text;
        if (name === "readlink" && Buffer.isBuffer(bytes) && !iconv.encode(decoded, encoding).equals(bytes)) {
          return callback(new Error("远程文件名无效"));
        }
        if (name === "realpath" && Buffer.isBuffer(bytes)) remember(decoded, bytes);
        callback(null, decoded);
      });
    };
  }
  const readdir = channel.readdir;
  if (typeof readdir === "function") {
    channel.readdir = function (requested: string | Buffer, options: any, callback?: (...args: any[]) => void) {
      if (typeof options === "function") { callback = options; options = undefined; }
      const done = (error: any, entries: any[]) => {
        if (error) return callback?.(error);
        try {
          const seen = new Map<string, Buffer>();
          const parentBytes = typeof requested === "string" ? wirePath(requested) : null;
          for (const entry of entries || []) {
            if (!Buffer.isBuffer(entry.filename_bytes)) continue;
            const bytes = entry.filename_bytes;
            const decoded = iconv.decode(bytes, encoding);
            if (decoded.includes("/") || decoded.includes("\0")) throw new Error("远程文件名无效");
            const previous = seen.get(decoded);
            if (previous && !previous.equals(bytes)) throw new Error("远程文件名无效");
            seen.set(decoded, bytes);
            entry.filename = decoded;
            if (typeof requested === "string" && decoded !== "." && decoded !== "..") {
              const prefix = Buffer.isBuffer(parentBytes) ? parentBytes : iconv.encode(String(parentBytes), encoding);
              const separator = prefix.length && prefix[prefix.length - 1] === 47 ? Buffer.alloc(0) : Buffer.from("/");
              remember(path.posix.join(requested, decoded), Buffer.concat([prefix, separator, bytes]));
            }
          }
        } catch (error) { callback?.(error); return; }
        callback?.(null, entries || []);
      };
      // A Buffer here is an SFTP directory handle, not a filename. opendir()
      // handles path encoding when ssh2 recursively implements readdir(string).
      return options === undefined ? readdir.call(this, requested, done) : readdir.call(this, requested, options, done);
    };
  }
  return channel;
}
