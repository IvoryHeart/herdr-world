#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function recordDesktopArtifact({ root = process.cwd(), tag, platform, outputPath, sourceCommit = process.env.GITHUB_SHA ?? "unknown" }) {
  const name = `herdr-world-${tag}-${platform}`;
  const archive = join(root, "dist-packages", `${name}.tar.gz`);
  const checksumFile = `${archive}.sha256`;
  const expectedArchiveDigest = readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0];
  const archiveDigest = digest(readFileSync(archive));
  if (archiveDigest !== expectedArchiveDigest) {
    throw new Error(`archive checksum does not match its checksum file: ${archive}`);
  }
  const bridge = execFileSync(
    "tar",
    ["-xOf", archive, `${name}/bin/herdr-world-bridge`],
  );
  const metadata = {
    schema_version: 1,
    source_tag: tag,
    source_commit: sourceCommit,
    platform,
    archive: `${name}.tar.gz`,
    archive_sha256: archiveDigest,
    bridge_sha256: digest(bridge),
  };
  writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, platform, outputPath] = process.argv.slice(2);
  if (!tag || !platform || !outputPath) {
    console.error("Usage: node scripts/desktop-artifact-metadata.mjs TAG PLATFORM OUTPUT_JSON");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(recordDesktopArtifact({ tag, platform, outputPath })));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
