#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOMEBREW_ARCHIVE_TARGETS = ["linux-x86_64", "macos-arm64", "macos-x86_64"];

export function readDesktopChecksums({ root = process.cwd(), tag }) {
  const result = {};
  for (const platform of HOMEBREW_ARCHIVE_TARGETS) {
    const checksumPath = join(root, "dist-packages", `herdr-world-${tag}-${platform}.tar.gz.sha256`);
    const value = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`invalid desktop archive checksum for ${platform}`);
    }
    result[platform] = value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, outputPath] = process.argv.slice(2);
  if (!tag || !outputPath) {
    console.error("Usage: node scripts/homebrew-checksums.mjs TAG OUTPUT_JSON");
    process.exit(2);
  }
  try {
    const checksums = readDesktopChecksums({ tag });
    writeFileSync(outputPath, `${JSON.stringify(checksums, null, 2)}\n`);
    console.log(JSON.stringify(checksums));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
