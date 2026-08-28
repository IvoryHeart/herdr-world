#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeReleaseTag, releaseVersion } from "./release-version.mjs";

export const NPM_TARGETS = ["linux-x64", "macos-arm64", "macos-x64"];
const ARCHIVE_TARGETS = {
  "linux-x64": "linux-x86_64",
  "macos-arm64": "macos-arm64",
  "macos-x64": "macos-x86_64",
};

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyRequired(sourceRoot, relativePath, destinationRoot) {
  const source = join(sourceRoot, relativePath);
  const destination = join(destinationRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function archiveBundleName(tag, platform) {
  return `herdr-world-${tag}-${platform}`;
}

function extractArchive(archive, destination) {
  execFileSync("tar", ["-xzf", archive, "-C", destination], { stdio: "ignore" });
}

function findBundle(extractionRoot, name) {
  const bundle = join(extractionRoot, name);
  try {
    if (readFileSync(join(bundle, "VERSION"), "utf8").trim()) return bundle;
  } catch {
    throw new Error(`archive did not contain expected bundle ${name}`);
  }
  return bundle;
}

export function createNpmPackage({ root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), tag, archivesDir, outputDir }) {
  const normalizedTag = normalizeReleaseTag(tag);
  const packageRoot = resolve(outputDir);
  const archiveRoot = resolve(archivesDir);
  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(packageRoot, { recursive: true });

  const extractionRoot = join(packageRoot, ".archives");
  mkdirSync(extractionRoot);
  const bundles = {};
  for (const [target, archivePlatform] of Object.entries(ARCHIVE_TARGETS)) {
    const archive = join(
      archiveRoot,
      `${archiveBundleName(normalizedTag, archivePlatform)}.tar.gz`,
    );
    const checksum = `${archive}.sha256`;
    const actualDigest = sha256File(archive);
    const expectedDigest = readFileSync(checksum, "utf8").trim().split(/\s+/)[0];
    if (actualDigest !== expectedDigest) {
      throw new Error(`desktop archive checksum mismatch for ${archivePlatform}`);
    }
    const targetRoot = join(extractionRoot, target);
    mkdirSync(targetRoot);
    extractArchive(archive, targetRoot);
    const bundle = findBundle(targetRoot, archiveBundleName(normalizedTag, archivePlatform));
    if (readFileSync(join(bundle, "VERSION"), "utf8").trim() !== normalizedTag) {
      throw new Error(`desktop archive VERSION does not match ${normalizedTag}: ${archive}`);
    }
    bundles[target] = { bundle, archive, archiveDigest: actualDigest };
  }

  const commonBundle = bundles["linux-x64"].bundle;
  const commonPaths = [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "UPSTREAM.md",
    "docs/world-assets.md",
    "vendor/herdr-compat/VENDOR-MANIFEST.toml",
    "third_party/licenses",
    "third_party/dependencies",
    "share/herdr-world/web",
  ];
  for (const relativePath of commonPaths) {
    copyRequired(commonBundle, relativePath, packageRoot);
  }

  const launcherDirectory = join(packageRoot, "lib");
  const bridgeDirectory = join(launcherDirectory, "bridges");
  mkdirSync(join(packageRoot, "bin"), { recursive: true });
  mkdirSync(bridgeDirectory, { recursive: true });
  cpSync(join(root, "scripts/npm-launcher.mjs"), join(packageRoot, "bin", "herdr-world"));
  cpSync(
    join(root, "scripts/herdr-world-launcher.sh"),
    join(launcherDirectory, "herdr-world-launcher.sh"),
  );
  chmodSync(join(packageRoot, "bin", "herdr-world"), 0o755);
  chmodSync(join(launcherDirectory, "herdr-world-launcher.sh"), 0o755);

  for (const [target, { bundle }] of Object.entries(bundles)) {
    const destination = join(bridgeDirectory, target);
    mkdirSync(destination, { recursive: true });
    cpSync(join(bundle, "bin/herdr-world-bridge"), join(destination, "herdr-world-bridge"));
    chmodSync(join(destination, "herdr-world-bridge"), 0o755);
  }

  const packageJson = {
    name: "@ivoryheart/herdr-world",
    version: releaseVersion(normalizedTag),
    description: "Browser and mobile client for monitoring and controlling Herdr agents.",
    type: "module",
    bin: { "herdr-world": "bin/herdr-world" },
    engines: { node: ">=22.14.0" },
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/IvoryHeart/herdr-world.git",
    },
    bugs: { url: "https://github.com/IvoryHeart/herdr-world/issues" },
    homepage: "https://ivoryheart.github.io/herdr-world/",
    files: [
      "bin/herdr-world",
      "lib/herdr-world-launcher.sh",
      "lib/bridges",
      "share/herdr-world/web",
      "docs",
      "vendor",
      "third_party",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "UPSTREAM.md",
    ],
    publishConfig: { access: "public" },
  };
  writeFileSync(join(packageRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  cpSync(join(root, "docs/npm-readme.md"), join(packageRoot, "README.md"));

  rmSync(extractionRoot, { recursive: true, force: true });
  return {
    packageRoot,
    version: packageJson.version,
    archives: Object.fromEntries(
      Object.entries(bundles).map(([target, value]) => [target, value.archiveDigest]),
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, archivesDir, outputDir] = process.argv.slice(2);
  if (!tag || !archivesDir || !outputDir) {
    console.error("Usage: node scripts/npm-package.mjs TAG ARCHIVES_DIR OUTPUT_DIR");
    process.exit(2);
  }
  try {
    const result = createNpmPackage({ tag, archivesDir, outputDir });
    console.log(`Staged npm package ${result.version} at ${result.packageRoot}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
