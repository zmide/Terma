"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { decodeRgbaPng, verifyMacIconPadding } = require("./mac-icon-padding-check");

const CANVAS_SIZE = 1024;
const CONTENT_SIZE = 768;
const INSET = (CANVAS_SIZE - CONTENT_SIZE) / 2;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function encodeRgbaPng(width, height, pixels) {
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    scanlines[offset] = 0;
    pixels.copy(scanlines, offset + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function sample(source, x, y) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(source.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(source.height - 1, y0 + 1));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const points = [
    [y0 * source.width + x0, (1 - fx) * (1 - fy)],
    [y0 * source.width + x1, fx * (1 - fy)],
    [y1 * source.width + x0, (1 - fx) * fy],
    [y1 * source.width + x1, fx * fy]
  ];
  let alpha = 0;
  const premultiplied = [0, 0, 0];
  for (const [index, weight] of points) {
    const offset = index * 4;
    const pointAlpha = source.pixels[offset + 3] / 255;
    alpha += pointAlpha * weight;
    for (let channel = 0; channel < 3; channel += 1) {
      premultiplied[channel] += source.pixels[offset + channel] * pointAlpha * weight;
    }
  }
  return [
    alpha ? premultiplied[0] / alpha : 0,
    alpha ? premultiplied[1] / alpha : 0,
    alpha ? premultiplied[2] / alpha : 0,
    alpha * 255
  ];
}

function resizePremultiplied(source, width, height) {
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * source.height / height - 0.5;
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * source.width / width - 0.5;
      const value = sample(source, sourceX, sourceY);
      const offset = (y * width + x) * 4;
      output[offset] = Math.round(value[0]);
      output[offset + 1] = Math.round(value[1]);
      output[offset + 2] = Math.round(value[2]);
      output[offset + 3] = Math.round(value[3]);
    }
  }
  return output;
}

function generate(inputPath, outputPath) {
  const source = decodeRgbaPng(inputPath);
  if (source.width !== source.height) throw new Error("macOS icon source must be square");
  const resized = resizePremultiplied(source, CONTENT_SIZE, CONTENT_SIZE);
  const canvas = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 4);
  const rowBytes = CONTENT_SIZE * 4;
  for (let y = 0; y < CONTENT_SIZE; y += 1) {
    resized.copy(canvas, ((y + INSET) * CANVAS_SIZE + INSET) * 4, y * rowBytes, (y + 1) * rowBytes);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, encodeRgbaPng(CANVAS_SIZE, CANVAS_SIZE, canvas));
  const result = verifyMacIconPadding(outputPath);
  console.log(`Generated macOS icon: content=${result.contentWidth}x${result.contentHeight}, margins=${Object.values(result.margins).join("/")}`);
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  generate(
    path.resolve(process.argv[2] || path.join(root, "desktop", "assets", "terma-icon-source.png")),
    path.resolve(process.argv[3] || path.join(root, "desktop", "assets", "icon-macos.png"))
  );
}

module.exports = { generate };
