#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { escapeRegex, normalizeReleaseTag, releaseVersion } from "./release-version.mjs";

export function extractReleaseNotes(changelog, tag) {
  const version = escapeRegex(releaseVersion(normalizeReleaseTag(tag)));
  const match = changelog.match(
    new RegExp(`^## \\[${version}\\] - [^\\n]+\\n([\\s\\S]*?)(?=\\n## \\[|$)`, "m"),
  );
  if (!match || !match[1].trim()) {
    throw new Error(`CHANGELOG.md has no release notes for ${tag}`);
  }
  return match[1].trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, changelogPath, outputPath] = process.argv.slice(2);
  if (!tag || !changelogPath || !outputPath) {
    console.error("Usage: node scripts/release-notes.mjs TAG CHANGELOG_PATH OUTPUT_MD");
    process.exit(2);
  }
  try {
    writeFileSync(outputPath, `${extractReleaseNotes(readFileSync(changelogPath, "utf8"), tag)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
