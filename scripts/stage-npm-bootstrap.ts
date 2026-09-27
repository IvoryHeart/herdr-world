#!/usr/bin/env bun
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { npmPlatformName, RELEASE_PLATFORMS } from "./release-platforms";

const root = resolve(import.meta.dir, "..");
const output = join(root, "dist", "npm-bootstrap");
for (const platform of RELEASE_PLATFORMS) {
  const directory = join(output, platform.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: npmPlatformName(platform.id),
        version: "0.0.0-seed.0",
        description: `One-time trusted-publisher bootstrap for Herdr World ${platform.id}`,
        license: "MIT",
        os: [platform.os],
        cpu: [platform.cpu],
        publishConfig: { access: "public" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(directory, "README.md"),
    `# ${npmPlatformName(platform.id)}\n\nThis bootstrap version contains no executable. Install @ivoryheart/herdr-world instead when a release is available.\n`,
  );
  cpSync(join(root, "LICENSE"), join(directory, "LICENSE"));
}
console.log(`Staged six npm bootstrap packages in ${output}`);
