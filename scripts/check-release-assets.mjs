import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseAssetNames(version) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/.test(
      version,
    )
  )
    throw new Error("Invalid release version");
  return [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
  ].flatMap((platform) => [
    `herdr-world-v${version}-${platform}.tar.xz`,
    `herdr-world-v${version}-${platform}.tar.xz.sha256`,
    `herdr-world-${platform}.tar.xz`,
    `herdr-world-${platform}.tar.xz.sha256`,
    `herdr-world-${platform}.update.json`,
  ]);
}

/** A release must never accidentally reopen the legacy clients' update feed. */
export function verifyReleaseAssetNames(names, version) {
  const expected = releaseAssetNames(version);
  const unexpected = names.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !names.includes(name));
  if (unexpected.length || missing.length || names.length !== expected.length) {
    throw new Error(
      `Invalid release assets; unexpected: ${unexpected.join(", ")}; missing: ${missing.join(", ")}`,
    );
  }
}

/** Validate the actual GitHub release, including the update feed and installer. */
export async function verifyPublishedReleaseAssets(directory, version) {
  const names = await readdir(directory);
  const installer = "install-herdr-world.sh";
  verifyReleaseAssetNames(
    names.filter((name) => name !== installer),
    version,
  );
  if (names.filter((name) => name === installer).length !== 1) {
    throw new Error(`Missing published installer: ${installer}`);
  }
  const publishedInstaller = await readFile(join(directory, installer));
  const sourceInstaller = await readFile(
    new URL(`./${installer}`, import.meta.url),
  );
  if (!publishedInstaller.equals(sourceInstaller)) {
    throw new Error(
      `Published installer differs from ${installer} in the release tag`,
    );
  }

  for (const platform of [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
  ]) {
    const versioned = `herdr-world-v${version}-${platform}.tar.xz`;
    const latest = `herdr-world-${platform}.tar.xz`;
    const archive = await readFile(join(directory, versioned));
    const latestArchive = await readFile(join(directory, latest));
    if (!archive.equals(latestArchive)) {
      throw new Error(`Published archive alias differs: ${latest}`);
    }
    const digest = createHash("sha256").update(archive).digest("hex");
    for (const name of [versioned, latest]) {
      const checksum = await readFile(
        join(directory, `${name}.sha256`),
        "utf8",
      );
      if (checksum !== `${digest}  ${name}\n`) {
        throw new Error(`Published checksum differs: ${name}.sha256`);
      }
    }
    const manifestName = `herdr-world-${platform}.update.json`;
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(directory, manifestName), "utf8"),
      );
    } catch {
      throw new Error(`Invalid published update manifest: ${manifestName}`);
    }
    if (
      !isDeepStrictEqual(manifest, {
        schema: 1,
        name: "herdr-world",
        version,
        platform,
        archive: latest,
        sha256: digest,
      })
    ) {
      throw new Error(`Published update manifest differs: ${manifestName}`);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = process.argv[3] ?? "dist";
  const version = process.argv[2];
  if (process.argv[4] === "--published") {
    await verifyPublishedReleaseAssets(directory, version);
    process.stdout.write(
      "Verified published release archives, checksums, update manifests, and installer.\n",
    );
  } else {
    verifyReleaseAssetNames(await readdir(directory), version);
    process.stdout.write(
      "Verified Herdr World-only release assets; no legacy update or installer aliases.\n",
    );
  }
}
