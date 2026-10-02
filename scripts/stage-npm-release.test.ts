import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_PLATFORMS } from "./release-platforms";

test("staged public npm packages advertise the production website", () => {
  const directory = mkdtempSync(join(tmpdir(), "world-npm-stage-"));
  const version = "9.8.7";
  try {
    for (const platform of RELEASE_PLATFORMS) {
      const packageName = `herdr-world-${platform.id}`;
      const source = join(directory, packageName);
      mkdirSync(join(source, "LICENSES"), { recursive: true });
      for (const name of [
        platform.binary,
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "DEPENDENCY_NOTICES.md",
        "DEPENDENCY_LICENSES.md",
        "UPSTREAM.md",
        "LICENSES/synthetic.txt",
      ]) {
        writeFileSync(join(source, name), "synthetic fixture\n");
      }
      writeFileSync(
        join(source, "VERSION"),
        `herdr-world ${version} ${platform.id}\n`,
      );
      const archiveName = `herdr-world-v${version}-${platform.id}.tar.xz`;
      const archive = join(directory, archiveName);
      const packed = Bun.spawnSync([
        "tar",
        "-cJf",
        archive,
        "-C",
        directory,
        packageName,
      ]);
      expect(packed.exitCode).toBe(0);
      const digest = createHash("sha256")
        .update(readFileSync(archive))
        .digest("hex");
      writeFileSync(`${archive}.sha256`, `${digest}  ${archiveName}\n`);
    }
    const staged = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "stage-npm-release.ts"),
      version,
      directory,
    ]);
    expect(staged.stderr.toString()).toBe("");
    expect(staged.exitCode).toBe(0);
    for (const name of [
      "launcher",
      ...RELEASE_PLATFORMS.map((platform) => platform.id),
    ]) {
      const manifest = JSON.parse(
        readFileSync(join(directory, "npm", name, "package.json"), "utf8"),
      );
      expect(manifest.homepage).toBe("https://herdr.world/");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
