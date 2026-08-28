#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeReleaseTag, releaseVersion } from "./release-version.mjs";

function tarEntries(tarball) {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}
function tarFile(tarball, path) {
  return execFileSync("tar", ["-xOf", tarball, path], { encoding: "utf8" });
}

export function inspectNpmPackage({ tarball, tag, sourceCommit = process.env.GITHUB_SHA ?? "unknown" }) {
  const normalizedTag = normalizeReleaseTag(tag);
  const entries = tarEntries(tarball);
  for (const entry of entries) {
    if (!entry.startsWith("package/") || entry.includes("../") || entry.startsWith("/")) {
      throw new Error(`npm tarball contains an unsafe or unexpected entry: ${entry}`);
    }
  }

  const packageJson = JSON.parse(tarFile(tarball, "package/package.json"));
  if (packageJson.name !== "@ivoryheart/herdr-world") {
    throw new Error(`unexpected npm package name: ${packageJson.name}`);
  }
  if (packageJson.version !== releaseVersion(normalizedTag)) {
    throw new Error(`npm package version does not match ${normalizedTag}`);
  }
  if (packageJson.private === true || packageJson.publishConfig?.access !== "public") {
    throw new Error("npm package must be public and publishable");
  }
  if (packageJson.engines?.node !== ">=22.14.0") {
    throw new Error("npm package must require Node.js 22.14.0 or newer");
  }
  if (JSON.stringify(packageJson.bin) !== JSON.stringify({ "herdr-world": "bin/herdr-world" })) {
    throw new Error("npm package must expose only the herdr-world command");
  }

  const relativeEntries = entries
    .map((entry) => entry.slice("package/".length))
    .filter((entry) => entry && !entry.endsWith("/"))
    .sort();
  const forbidden = relativeEntries.filter((entry) =>
    ["install", "bin/herdr-world-installer", "package-lock.json", ".npmrc"].includes(entry),
  );
  if (forbidden.length > 0) {
    throw new Error(`npm package contains forbidden files: ${forbidden.join(", ")}`);
  }

  for (const target of ["linux-x64", "macos-arm64", "macos-x64"]) {
    if (!relativeEntries.includes(`lib/bridges/${target}/herdr-world-bridge`)) {
      throw new Error(`npm package is missing the ${target} bridge`);
    }
  }
  for (const required of [
    "bin/herdr-world",
    "lib/herdr-world-launcher.sh",
    "share/herdr-world/web/index.html",
    "share/herdr-world/web/legal/manifest.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "UPSTREAM.md",
  ]) {
    if (!relativeEntries.includes(required)) {
      throw new Error(`npm package is missing ${required}`);
    }
  }

  const bytes = readFileSync(tarball);
  return {
    schema_version: 1,
    name: packageJson.name,
    version: packageJson.version,
    source_tag: normalizedTag,
    source_commit: sourceCommit,
    tarball: tarball,
    files: relativeEntries,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tarball, tag, metadataPath] = process.argv.slice(2);
  if (!tarball || !tag || !metadataPath) {
    console.error("Usage: node scripts/npm-package-inspect.mjs TARBALL TAG METADATA_JSON");
    process.exit(2);
  }
  try {
    const metadata = inspectNpmPackage({ tarball, tag });
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify(metadata));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
