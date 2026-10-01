import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReleaseArchive } from "./release-archive";

test("release archive admission requires the matching checksum and filename", () => {
  const directory = mkdtempSync(join(tmpdir(), "world-release-archive-"));
  try {
    const name = "herdr-world-v0.2.0-linux-x64.tar.xz";
    const archive = join(directory, name);
    const contents = "synthetic archive";
    const digest = createHash("sha256").update(contents).digest("hex");
    writeFileSync(archive, contents);
    writeFileSync(`${archive}.sha256`, `${digest}  ${name}\n`);

    expect(readReleaseArchive(directory, "0.2.0", "linux-x64")).toEqual({
      archive,
      digest,
      name,
    });

    writeFileSync(`${archive}.sha256`, `${digest}  wrong-name.tar.xz\n`);
    expect(() => readReleaseArchive(directory, "0.2.0", "linux-x64")).toThrow(
      "checksum mismatch",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
