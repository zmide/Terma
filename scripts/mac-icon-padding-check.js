"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXPECTED_SIZE = 1024;
const MIN_SAFE_INSET = 124;
const MAX_SAFE_INSET = 132;

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodeRgbaPng(filePath) {
  const png = fs.readFileSync(filePath);
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`Expected a non-interlaced 8-bit RGBA PNG: ${filePath}`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || !idat.length) throw new Error(`Incomplete PNG data: ${filePath}`);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  if (inflated.length !== height * (stride + 1)) {
    throw new Error(`Unexpected PNG scanline size: ${filePath}`);
  }

  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    const previousOffset = rowOffset - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[previousOffset + x - bytesPerPixel] : 0;
      let value;
      if (filterType === 0) value = raw;
      else if (filterType === 1) value = raw + left;
      else if (filterType === 2) value = raw + up;
      else if (filterType === 3) value = raw + Math.floor((left + up) / 2);
      else if (filterType === 4) value = raw + paeth(left, up, upperLeft);
      else throw new Error(`Unsupported PNG filter ${filterType}: ${filePath}`);
      pixels[rowOffset + x] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, pixels };
}

function verifyMacIconPadding(filePath) {
  const { width, height, pixels } = decodeRgbaPng(filePath);
  if (width !== EXPECTED_SIZE || height !== EXPECTED_SIZE) {
    throw new Error(`macOS icon must be ${EXPECTED_SIZE}x${EXPECTED_SIZE}: ${filePath}`);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error(`macOS icon has no visible pixels: ${filePath}`);

  const margins = {
    left: minX,
    top: minY,
    right: width - maxX - 1,
    bottom: height - maxY - 1
  };
  const values = Object.values(margins);
  if (values.some(value => value < MIN_SAFE_INSET || value > MAX_SAFE_INSET)) {
    throw new Error(
      `macOS icon must keep ${MIN_SAFE_INSET}-${MAX_SAFE_INSET}px transparent margins; ` +
      `got ${margins.left}/${margins.top}/${margins.right}/${margins.bottom}: ${filePath}`
    );
  }

  return {
    width,
    height,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1,
    margins
  };
}

if (require.main === module) {
  const filePath = path.resolve(process.argv[2] || path.join(__dirname, "..", "desktop", "assets", "icon-macos.png"));
  const result = verifyMacIconPadding(filePath);
  console.log(
    `Verified macOS icon safe area: ${result.width}x${result.height}, ` +
    `content=${result.contentWidth}x${result.contentHeight}, ` +
    `margins=${Object.values(result.margins).join("/")}`
  );
}

module.exports = { decodeRgbaPng, verifyMacIconPadding };
