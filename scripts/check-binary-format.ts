import type { RELEASE_PLATFORMS } from "./release-platforms";

type Platform = (typeof RELEASE_PLATFORMS)[number]["id"];
type Format = "ELF64" | "Mach-O 64" | "PE32+";

// Release checks read native machine IDs from executable headers rather than
// matching file(1) prose, whose wording changes between file versions.
const EXPECTED: Record<Platform, { format: Format; machine: number }> = {
  "linux-x64": { format: "ELF64", machine: 0x3e },
  "linux-arm64": { format: "ELF64", machine: 0xb7 },
  "darwin-x64": { format: "Mach-O 64", machine: 0x01000007 },
  "darwin-arm64": { format: "Mach-O 64", machine: 0x0100000c },
  "windows-x64": { format: "PE32+", machine: 0x8664 },
  "windows-arm64": { format: "PE32+", machine: 0xaa64 },
};

// Enough for every header field read below in any binary Bun produces.
export const HEADER_BYTES = 64 * 1024;

const hex = (value: number) => `0x${value.toString(16)}`;

export function readBinaryHeader(bytes: Uint8Array): {
  format: Format;
  machine: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (end: number) => end <= bytes.byteLength;
  if (has(4) && view.getUint32(0) === 0x7f454c46) {
    if (!has(20)) throw new Error("truncated ELF header");
    if (bytes[4] !== 2 || bytes[5] !== 1) {
      throw new Error("ELF binary is not 64-bit little-endian");
    }
    return { format: "ELF64", machine: view.getUint16(18, true) };
  }
  if (has(4) && view.getUint32(0, true) === 0xfeedfacf) {
    if (!has(8)) throw new Error("truncated Mach-O header");
    return { format: "Mach-O 64", machine: view.getUint32(4, true) };
  }
  if (has(2) && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    if (!has(0x40)) throw new Error("truncated DOS header");
    const pe = view.getUint32(0x3c, true);
    if (!has(pe + 26)) throw new Error("truncated PE header");
    if (view.getUint32(pe) !== 0x50450000) {
      throw new Error("missing PE signature");
    }
    const magic = view.getUint16(pe + 24, true);
    if (magic !== 0x20b) {
      throw new Error(`PE optional header ${hex(magic)} is not PE32+`);
    }
    return { format: "PE32+", machine: view.getUint16(pe + 4, true) };
  }
  throw new Error("not an ELF, Mach-O or PE executable");
}

export function checkBinaryFormat(platform: string, bytes: Uint8Array) {
  const expected = EXPECTED[platform as Platform];
  if (!expected) throw new Error(`unsupported platform: ${platform}`);
  const actual = readBinaryHeader(bytes);
  if (
    actual.format !== expected.format ||
    actual.machine !== expected.machine
  ) {
    throw new Error(
      `${platform} expects ${expected.format} machine ${hex(expected.machine)}, ` +
        `found ${actual.format} machine ${hex(actual.machine)}`,
    );
  }
  return `${platform}: ${actual.format} machine ${hex(actual.machine)}`;
}

if (import.meta.main) {
  const [platform, binary] = process.argv.slice(2);
  if (!platform || !binary) {
    throw new Error("usage: check-binary-format.ts <platform> <binary>");
  }
  const bytes = new Uint8Array(
    await Bun.file(binary).slice(0, HEADER_BYTES).arrayBuffer(),
  );
  console.log(checkBinaryFormat(platform, bytes));
}
