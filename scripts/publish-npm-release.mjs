#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const version = process.argv[2];
const packageDir = resolve(process.argv[3] ?? "npm-packages");
if (
  !version ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/.test(version)
) {
  throw new Error(
    "usage: node scripts/publish-npm-release.mjs X.Y.Z[-rc.N] [package-dir]",
  );
}
const distTag = version.includes("-rc.") ? "next" : "latest";

const packages = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "",
];

for (const platform of packages) {
  const suffix = platform ? `-${platform}` : "";
  const name = `@ivoryheart/herdr-world${suffix}`;
  const archive = join(
    packageDir,
    `ivoryheart-herdr-world${suffix}-${version}.tgz`,
  );
  const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  const lookup = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "dist.integrity", "--json"],
    {
      encoding: "utf8",
    },
  );
  if (lookup.error) throw lookup.error;
  if (lookup.status === 0) {
    const published = JSON.parse(lookup.stdout);
    if (published !== integrity) {
      throw new Error(
        `${name}@${version} exists with different package contents`,
      );
    }
    console.log(`Already published: ${name}@${version}`);
    continue;
  }
  if (!lookup.stderr.includes("E404")) {
    throw new Error(
      `could not inspect ${name}@${version}: ${lookup.stderr.trim()}`,
    );
  }
  const publish = spawnSync(
    "npm",
    ["publish", archive, "--access", "public", "--tag", distTag],
    {
      stdio: "inherit",
    },
  );
  if (publish.error) throw publish.error;
  if (publish.status !== 0) {
    throw new Error(`npm publish failed for ${name}@${version}`);
  }
}
