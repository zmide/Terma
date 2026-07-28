"use strict";

const fs = require("node:fs");

const CPU_ARCH_ABI64 = 0x01000000;
const MACH_CPU_NAMES = new Map([
  [CPU_ARCH_ABI64 | 7, "x64"],
  [CPU_ARCH_ABI64 | 12, "arm64"]
]);
const PE_MACHINE_NAMES = new Map([
  [0x014c, "ia32"],
  [0x8664, "x64"],
  [0xaa64, "arm64"]
]);
const ELF_MACHINE_NAMES = new Map([
  [3, "ia32"],
  [40, "armv7l"],
  [62, "x64"],
  [183, "arm64"]
]);

function machArchitectures(buffer) {
  const first = buffer.readUInt32BE(0);
  const result = new Set();
  if (first === 0xcafebabe || first === 0xcafebabf) {
    const count = buffer.readUInt32BE(4);
    const stride = first === 0xcafebabf ? 32 : 20;
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * stride;
      if (offset + 4 > buffer.length) break;
      const name = MACH_CPU_NAMES.get(buffer.readUInt32BE(offset));
      if (name) result.add(name);
    }
    return result;
  }
  if (first === 0xbebafeca || first === 0xbfbafeca) {
    const count = buffer.readUInt32LE(4);
    const stride = first === 0xbfbafeca ? 32 : 20;
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * stride;
      if (offset + 4 > buffer.length) break;
      const name = MACH_CPU_NAMES.get(buffer.readUInt32LE(offset));
      if (name) result.add(name);
    }
    return result;
  }
  if (first === 0xfeedfacf || first === 0xfeedface) {
    const name = MACH_CPU_NAMES.get(buffer.readUInt32BE(4));
    if (name) result.add(name);
    return result;
  }
  if (first === 0xcffaedfe || first === 0xcefaedfe) {
    const name = MACH_CPU_NAMES.get(buffer.readUInt32LE(4));
    if (name) result.add(name);
    return result;
  }
  return result;
}

function binaryArchitectures(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 20) return new Set();

  if (buffer[0] === 0x4d && buffer[1] === 0x5a && buffer.length >= 64) {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (
      peOffset + 6 <= buffer.length &&
      buffer.subarray(peOffset, peOffset + 4).toString("binary") === "PE\u0000\u0000"
    ) {
      const name = PE_MACHINE_NAMES.get(buffer.readUInt16LE(peOffset + 4));
      return new Set(name ? [name] : []);
    }
  }

  if (
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    const littleEndian = buffer[5] === 1;
    const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
    const name = ELF_MACHINE_NAMES.get(machine);
    return new Set(name ? [name] : []);
  }

  return machArchitectures(buffer);
}

function assertNativeArchitecture(file, expectedArchitecture, label = "Native binary") {
  const architectures = binaryArchitectures(file);
  if (!architectures.has(expectedArchitecture)) {
    throw new Error(
      `${label} has architecture ${[...architectures].join(", ") || "unknown"}, ` +
      `expected ${expectedArchitecture}: ${file}`
    );
  }
  console.log(
    `Verified ${label} architecture ${expectedArchitecture}: ${file}`
  );
  return architectures;
}

module.exports = { assertNativeArchitecture, binaryArchitectures };
