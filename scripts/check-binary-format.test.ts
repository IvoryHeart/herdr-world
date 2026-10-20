import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBinaryFormat, readBinaryHeader } from "./check-binary-format";

function elf(machine: number, elfClass = 2) {
  const bytes = Buffer.alloc(64);
  bytes.write("\x7fELF", 0, "latin1");
  bytes[4] = elfClass;
  bytes[5] = 1;
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

function machO(cpu: number) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  return bytes;
}

function pe(machine: number, magic = 0x20b) {
  const offset = 0x80;
  const bytes = Buffer.alloc(offset + 0x100);
  bytes.write("MZ", 0, "latin1");
  bytes.writeUInt32LE(offset, 0x3c);
  bytes.write("PE\0\0", offset, "latin1");
  bytes.writeUInt16LE(machine, offset + 4);
  bytes.writeUInt16LE(magic, offset + 24);
  return bytes;
}

test.each([
  ["linux-x64", elf(0x3e)],
  ["linux-arm64", elf(0xb7)],
  ["darwin-x64", machO(0x01000007)],
  ["darwin-arm64", machO(0x0100000c)],
  ["windows-x64", pe(0x8664)],
  ["windows-arm64", pe(0xaa64)],
] as const)("%s accepts its native executable header", (platform, bytes) => {
  expect(checkBinaryFormat(platform, bytes)).toStartWith(`${platform}: `);
});

test.each([
  ["windows-x64", pe(0xaa64), /expects PE32\+ machine 0x8664/],
  ["windows-arm64", pe(0x8664), /expects PE32\+ machine 0xaa64/],
  ["windows-x64", pe(0x14c), /found PE32\+ machine 0x14c/],
  ["windows-x64", pe(0x8664, 0x10b), /not PE32\+/],
  ["windows-x64", elf(0x3e), /found ELF64/],
  ["linux-arm64", elf(0x3e), /expects ELF64 machine 0xb7/],
  ["linux-x64", elf(0x3e, 1), /not 64-bit/],
  ["darwin-arm64", machO(0x01000007), /machine 0x100000c/],
  ["darwin-x64", Buffer.from("#!/bin/sh\n"), /not an ELF, Mach-O or PE/],
  ["freebsd-x64", elf(0x3e), /unsupported platform/],
] as const)("%s rejects a mismatched header (%#)", (platform, bytes, error) => {
  expect(() => checkBinaryFormat(platform, bytes)).toThrow(error);
});

test("PE headers reject malformed and truncated input", () => {
  const unsigned = pe(0x8664);
  unsigned.write("NO", 0x80, "latin1");
  expect(() => readBinaryHeader(unsigned)).toThrow("missing PE signature");
  expect(() => readBinaryHeader(Buffer.from("MZ"))).toThrow(
    "truncated DOS header",
  );
  expect(() => readBinaryHeader(pe(0x8664).subarray(0, 0x90))).toThrow(
    "truncated PE header",
  );
  const farOffset = pe(0x8664);
  farOffset.writeUInt32LE(0xffff_fff0, 0x3c);
  expect(() => readBinaryHeader(farOffset)).toThrow("truncated PE header");
});

test("release package verification checks a packaged Windows header", () => {
  const root = mkdtempSync(join(tmpdir(), "world-release-verify-"));
  const script = new URL("./verify-release-package.sh", import.meta.url)
    .pathname;
  const repo = new URL("..", import.meta.url).pathname;
  const version = "1.2.3";
  const platform = "windows-x64";
  function verifyPackaged(binary: Buffer) {
    const dist = join(root, "dist");
    const packageDir = join(dist, `herdr-world-${platform}`);
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(join(packageDir, "LICENSES"), { recursive: true });
    writeFileSync(join(packageDir, "herdr-world.exe"), binary);
    writeFileSync(
      join(packageDir, "VERSION"),
      `herdr-world ${version} ${platform}\n`,
    );
    for (const legal of [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md",
      "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md",
      "LICENSES/CLAW-EMPIRE-APACHE-2.0.txt",
    ]) {
      cpSync(join(repo, legal), join(packageDir, legal));
    }
    const versioned = `herdr-world-v${version}-${platform}.tar.xz`;
    const latest = `herdr-world-${platform}.tar.xz`;
    const tar = Bun.spawnSync(
      [
        "tar",
        "-C",
        dist,
        "-cJf",
        join(dist, versioned),
        `herdr-world-${platform}`,
      ],
      { stderr: "pipe" },
    );
    expect(tar.exitCode).toBe(0);
    cpSync(join(dist, versioned), join(dist, latest));
    const digest = createHash("sha256")
      .update(readFileSync(join(dist, latest)))
      .digest("hex");
    for (const archive of [versioned, latest]) {
      writeFileSync(join(dist, `${archive}.sha256`), `${digest}  ${archive}\n`);
    }
    writeFileSync(
      join(dist, `herdr-world-${platform}.update.json`),
      `${JSON.stringify({ schema: 1, name: "herdr-world", version, platform, archive: latest, sha256: digest })}\n`,
    );
    return Bun.spawnSync(["bash", script, version, platform], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: root },
      stdout: "pipe",
      stderr: "pipe",
    });
  }
  try {
    const accepted = verifyPackaged(pe(0x8664));
    expect(accepted.exitCode).toBe(0);
    expect(accepted.stdout.toString()).toContain(
      "windows-x64: PE32+ machine 0x8664",
    );
    const rejected = verifyPackaged(pe(0xaa64));
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr.toString()).toContain(
      "windows-x64 expects PE32+ machine 0x8664, found PE32+ machine 0xaa64",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
