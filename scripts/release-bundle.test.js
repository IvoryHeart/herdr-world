import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealBundle, verifyBundle } from "./release-bundle.mjs";

test("publish input rejects changed, missing, extra and symlink files and wrong provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "release-bundle-"));
  try {
    mkdirSync(join(root, "tap/.github/workflows"), { recursive: true });
    const file = join(root, "tap/.github/workflows/herdr-world.yml");
    writeFileSync(file, "verified acceptance\n");
    sealBundle(root, "0.3.6", "fixture-sha");
    expect(
      Object.keys(verifyBundle(root, "0.3.6", "fixture-sha").files),
    ).toContain("tap/.github/workflows/herdr-world.yml");
    expect(() => verifyBundle(root, "0.3.7", "fixture-sha")).toThrow(
      "version or source",
    );
    expect(() => verifyBundle(root, "0.3.6", "other-sha")).toThrow(
      "version or source",
    );
    writeFileSync(file, "drifted acceptance\n");
    expect(() => verifyBundle(root, "0.3.6", "fixture-sha")).toThrow(
      "digests differ",
    );
    rmSync(file);
    expect(() => verifyBundle(root, "0.3.6", "fixture-sha")).toThrow(
      "digests differ",
    );
    writeFileSync(file, "verified acceptance\n");
    writeFileSync(join(root, "extra"), "unexpected");
    expect(() => verifyBundle(root, "0.3.6", "fixture-sha")).toThrow(
      "digests differ",
    );
    rmSync(join(root, "extra"));
    symlinkSync(file, join(root, "link"));
    expect(() => verifyBundle(root, "0.3.6", "fixture-sha")).toThrow(
      "regular release file",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
