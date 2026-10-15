import { Transform, TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import crypto from "node:crypto";
import iconv from "iconv-lite";

const BLOCK = 512;
const MAX_PAX_BYTES = 16 * 1024 * 1024;
const UTF8_CHARSET = "ISO-IR 10646 2000 UTF-8";

function tarNumber(bytes: Buffer): number {
  let number: number;
  if (bytes[0] & 0x80) {
    let value = BigInt(bytes[0] & 0x7f);
    for (const byte of bytes.subarray(1)) value = value * 256n + BigInt(byte);
    number = Number(value);
  } else {
    const text = bytes.toString("ascii").replace(/\0.*$/, "").trim();
    if (text && !/^[0-7]+$/.test(text)) throw new Error("Invalid TAR size");
    number = text ? parseInt(text, 8) : 0;
  }
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid TAR size");
  return number;
}

function field(header: Buffer, offset: number, length: number) {
  const value = header.subarray(offset, offset + length);
  const end = value.indexOf(0);
  return end < 0 ? value : value.subarray(0, end);
}

function checksum(header: Buffer) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
}

function paxRecords(body: Buffer) {
  const records = new Map<string, Buffer>();
  for (let offset = 0; offset < body.length;) {
    const space = body.indexOf(32, offset);
    const digits = body.subarray(offset, space).toString("ascii");
    const length = Number(digits);
    if (space < offset || !/^[1-9][0-9]*$/.test(digits) || !Number.isSafeInteger(length)
      || length <= space - offset + 2 || offset + length > body.length || body[offset + length - 1] !== 10) {
      throw new Error("Invalid TAR PAX record");
    }
    const record = body.subarray(space + 1, offset + length - 1);
    const equal = record.indexOf(61);
    if (equal <= 0) throw new Error("Invalid TAR PAX key");
    records.set(record.subarray(0, equal).toString("ascii"), Buffer.from(record.subarray(equal + 1)));
    offset += length;
  }
  return records;
}

function encodePax(records: Map<string, Buffer>) {
  const chunks: Buffer[] = [];
  for (const [key, value] of records) {
    const body = Buffer.concat([Buffer.from(`${key}=`), value, Buffer.from("\n")]);
    let length = body.length + 2;
    while (String(length).length + 1 + body.length !== length) length = String(length).length + 1 + body.length;
    chunks.push(Buffer.from(`${length} `), body);
  }
  return Buffer.concat(chunks);
}

/** Rewrites names only; regular-file payloads pass through without buffering. */
export class TarFilenameTranscoder extends Transform {
  private pending = Buffer.alloc(0);
  private remaining = 0;
  private extensionHeader: Buffer | null = null;
  private extensionSize = 0;
  private extensionChunks: Buffer[] = [];
  private localPax = new Map<string, Buffer>();
  private currentEncoding: string;
  private localEncoding: string | null = null;
  private ended = false;

  constructor(private sourceEncoding: string) {
    super();
    this.currentEncoding = sourceEncoding;
  }

  private decode(bytes: Buffer, encoding: string) {
    const text = iconv.decode(bytes, encoding);
    if (!iconv.encode(text, encoding).equals(bytes) || text.includes("\0")) throw new Error("TAR filename cannot be decoded losslessly");
    return Buffer.from(text, "utf8");
  }

  private emitPax(header: Buffer, records: Map<string, Buffer>, global = false) {
    if (!records.size) return;
    const body = encodePax(records);
    if (body.length > MAX_PAX_BYTES) throw new Error("TAR metadata is too large");
    const output = Buffer.from(header);
    output.fill(0, 0, 100);
    output.write("PaxHeaders/terma", 0, "ascii");
    output.fill(0, 157, 257);
    output.fill(0, 265, 329);
    output.fill(0, 345, 500);
    output.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    output[156] = global ? 103 : 120;
    checksum(output);
    this.push(output);
    this.push(body);
    this.push(Buffer.alloc((BLOCK - body.length % BLOCK) % BLOCK));
  }

  private completeExtension() {
    const header = this.extensionHeader!;
    const records = paxRecords(Buffer.concat(this.extensionChunks).subarray(0, this.extensionSize));
    const global = header[156] === 103;
    const charset = records.get("hdrcharset")?.toString("ascii");
    const encoding = charset === "UTF-8" || charset === UTF8_CHARSET ? "utf8" : charset === "BINARY" ? this.sourceEncoding : this.currentEncoding;
    for (const key of ["path", "linkpath", "uname", "gname"]) {
      const value = records.get(key);
      if (value) records.set(key, this.decode(value, encoding));
    }
    if (charset) records.set("hdrcharset", Buffer.from(UTF8_CHARSET));
    if (global) {
      this.currentEncoding = encoding;
      this.emitPax(header, records, true);
    } else {
      this.localEncoding = encoding;
      for (const [key, value] of records) this.localPax.set(key, value);
    }
    this.extensionHeader = null;
    this.extensionChunks = [];
  }

  private header(header: Buffer) {
    if (!header.some(byte => byte !== 0)) { this.ended = true; this.push(header); return; }
    if (this.ended) throw new Error("Unexpected TAR data after end marker");
    const expected = tarNumber(header.subarray(148, 156));
    const actual = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (expected !== actual) throw new Error("Invalid TAR checksum");
    const size = tarNumber(header.subarray(124, 136));
    const type = header[156];
    if (type === 120 || type === 103) {
      if (size > MAX_PAX_BYTES) throw new Error("TAR metadata is too large");
      this.extensionHeader = header;
      this.extensionSize = size;
      this.remaining = Math.ceil(size / BLOCK) * BLOCK;
      if (!this.remaining) this.completeExtension();
      return;
    }
    // Downloads are explicitly created as POSIX/PAX, not GNU longname/sparse.
    if (![0, 48, 49, 50, 51, 52, 53, 54, 55].includes(type)) throw new Error("Unsupported TAR entry type");
    const encoding = this.localEncoding || this.currentEncoding;
    const prefix = field(header, 345, 155);
    const rawName = Buffer.concat([prefix, prefix.length ? Buffer.from("/") : Buffer.alloc(0), field(header, 0, 100)]);
    const name = this.localPax.get("path") || this.decode(rawName, encoding);
    const rawLink = field(header, 157, 100);
    const link = this.localPax.get("linkpath") || this.decode(rawLink, encoding);
    this.localPax.set("path", name);
    if (link.length) this.localPax.set("linkpath", link);
    this.localPax.set("hdrcharset", Buffer.from(UTF8_CHARSET));
    const output = Buffer.from(header);
    output.fill(0, 0, 100);
    output.fill(0, 157, 257);
    output.fill(0, 345, 500);
    for (const [key, offset] of [["uname", 265], ["gname", 297]] as const) {
      const value = this.localPax.get(key) || this.decode(field(header, offset, 32), encoding);
      if (value.length) this.localPax.set(key, value);
      output.fill(0, offset, offset + 32);
      if (value.length <= 32) value.copy(output, offset);
    }
    (name.length <= 100 ? name : Buffer.from("PaxEntry")).copy(output, 0);
    (link.length <= 100 ? link : Buffer.from("PaxLink")).copy(output, 157);
    this.emitPax(header, this.localPax);
    checksum(output);
    this.push(output);
    const paxSize = this.localPax.get("size");
    const actualSize = paxSize ? Number(paxSize.toString("ascii")) : size;
    if (!Number.isSafeInteger(actualSize) || actualSize < 0) throw new Error("Invalid TAR payload size");
    this.remaining = Math.ceil(actualSize / BLOCK) * BLOCK;
    this.localPax.clear();
    this.localEncoding = null;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      let input = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      this.pending = Buffer.alloc(0);
      while (input.length) {
        if (this.remaining) {
          const length = Math.min(this.remaining, input.length);
          const part = input.subarray(0, length);
          if (this.extensionHeader) this.extensionChunks.push(Buffer.from(part));
          else this.push(part);
          this.remaining -= length;
          input = input.subarray(length);
          if (!this.remaining && this.extensionHeader) this.completeExtension();
        } else if (input.length >= BLOCK) {
          this.header(Buffer.from(input.subarray(0, BLOCK)));
          input = input.subarray(BLOCK);
        } else { this.pending = Buffer.from(input); break; }
      }
      callback();
    } catch (error) { callback(error as Error); }
  }

  _flush(callback: TransformCallback) {
    callback(this.remaining || this.pending.length || this.extensionHeader || this.localPax.size || !this.ended
      ? new Error("Incomplete TAR archive") : undefined);
  }
}

export async function normalizeDownloadedTarFilenames(file: string, encoding: string, signal?: AbortSignal) {
  const temporary = `${file}.utf8-${crypto.randomUUID()}.part`;
  try {
    await pipeline(fs.createReadStream(file), createGunzip(), new TarFilenameTranscoder(encoding), createGzip(),
      fs.createWriteStream(temporary, {flags:"wx", mode:0o600}), {signal});
    signal?.throwIfAborted();
    await fsp.rename(temporary, file);
  } finally { await fsp.rm(temporary, {force:true}).catch(() => {}); }
}
