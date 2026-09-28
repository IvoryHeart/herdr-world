#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { readReleaseArchive } from "./release-archive";
import { npmPlatformName, RELEASE_PLATFORMS } from "./release-platforms";
import { RELEASE_VERSION_RE } from "./release-version";

const root = resolve(import.meta.dir, "..");
const version = process.argv[2];
const distDir = resolve(process.argv[3] ?? join(root, "dist"));
const outputDir = join(distDir, "npm");
if (!version || !RELEASE_VERSION_RE.test(version)) {
  throw new Error(
    "usage: bun scripts/stage-npm-release.ts X.Y.Z[-rc.N] [dist-dir]",
  );
}

const notices = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "DEPENDENCY_NOTICES.md",
  "DEPENDENCY_LICENSES.md",
  "UPSTREAM.md",
  "LICENSES",
] as const;
const archives = RELEASE_PLATFORMS.map((platform) => ({
  platform,
  ...readReleaseArchive(distDir, version, platform.id),
}));

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const optionalDependencies: Record<string, string> = {};

for (const { platform, archive } of archives) {
  const packageName = npmPlatformName(platform.id);
  const packageDir = join(outputDir, platform.id);
  const extracted = join(outputDir, `extract-${platform.id}`);
  mkdirSync(extracted, { recursive: true });
  execFileSync("tar", ["-xJf", archive, "-C", extracted]);
  const source = join(extracted, `herdr-world-${platform.id}`);
  const versionLine = readFileSync(join(source, "VERSION"), "utf8").trim();
  if (versionLine !== `herdr-world ${version} ${platform.id}`) {
    throw new Error(`incorrect archive VERSION for ${platform.id}`);
  }
  mkdirSync(join(packageDir, "bin"), { recursive: true });
  cpSync(
    join(source, platform.binary),
    join(packageDir, "bin", platform.binary),
  );
  chmodSync(join(packageDir, "bin", platform.binary), 0o755);
  for (const notice of notices) {
    cpSync(join(source, notice), join(packageDir, notice), { recursive: true });
  }
  writeFileSync(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        description: `Herdr World binary for ${platform.id}`,
        license: "MIT",
        os: [platform.os],
        cpu: [platform.cpu],
        repository: "https://github.com/IvoryHeart/herdr-world",
        files: ["bin", ...notices],
        publishConfig: { access: "public" },
      },
      null,
      2,
    )}\n`,
  );
  optionalDependencies[packageName] = version;
  rmSync(extracted, { recursive: true, force: true });
}

const launcherDir = join(outputDir, "launcher");
mkdirSync(join(launcherDir, "bin"), { recursive: true });
cpSync(
  join(root, "scripts", "npm-launcher.mjs"),
  join(launcherDir, "bin", "herdr-world.mjs"),
);
chmodSync(join(launcherDir, "bin", "herdr-world.mjs"), 0o755);
cpSync(join(root, "README.md"), join(launcherDir, "README.md"));
cpSync(join(root, "LICENSE"), join(launcherDir, "LICENSE"));
writeFileSync(
  join(launcherDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@ivoryheart/herdr-world",
      version,
      description:
        "Visualize Herdr agent work in Office and Graph across local and SSH hosts",
      license: "MIT",
      repository: "https://github.com/IvoryHeart/herdr-world",
      engines: { node: ">=22.14.0" },
      bin: { "herdr-world": "bin/herdr-world.mjs" },
      optionalDependencies,
      files: ["bin", "README.md", "LICENSE"],
      publishConfig: { access: "public" },
    },
    null,
    2,
  )}\n`,
);
console.log(`Staged npm packages for Herdr World ${version} in ${outputDir}`);
