#!/usr/bin/env bun
// Usage (from the repository root):
//   bun scripts/validate-prepared-release.ts X.Y.Z[-rc.N]
// Check the prepared working tree. Full product coverage belongs to the release
// PR's dispatched CI, where the browser suites have their normal shards.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFragment, readFragments } from "./changelog-fragments";
import { parseManifestVersion } from "./prepare-release";
import { isReleaseCandidate, RELEASE_VERSION_RE } from "./release-version";

/** @internal Release-file validation seam for fixture tests. */
export function validatePreparedRelease(root: string, version: string): void {
  if (!RELEASE_VERSION_RE.test(version))
    throw new Error("Invalid release version: expected X.Y.Z or X.Y.Z-rc.N");
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const plugin = parseManifestVersion(read("herdr-plugin.toml"));
  if (plugin !== version)
    throw new Error(
      `herdr-plugin.toml version is ${plugin}, expected ${version}`,
    );
  for (const file of [
    "package.json",
    "web/package.json",
    "server/package.json",
  ])
    if (JSON.parse(read(file)).version !== "0.0.0")
      throw new Error(`${file}: development version must remain 0.0.0`);

  const notesFile = `docs/releases/v${version}.md`;
  if (!existsSync(join(root, notesFile)))
    throw new Error(`Missing release notes: ${notesFile}`);
  const notes = read(notesFile).replace(/\r\n/g, "\n").trim();
  const [title, ...body] = notes.split("\n");
  if (
    ![
      `# Herdr World ${version}`,
      ...(isReleaseCandidate(version)
        ? [`# Herdr World ${version} release candidate`]
        : []),
    ].includes(title) ||
    !body.join("\n").trim()
  )
    throw new Error(
      `Malformed release notes: ${notesFile} needs a versioned Herdr World heading and nonempty body`,
    );

  const changelog = read("CHANGELOG.md").replace(/\r\n/g, "\n");
  const heading = "## [Unreleased]\n";
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error("CHANGELOG.md has no Unreleased section");
  const fragments = readFragments(root);
  if (!isReleaseCandidate(version)) {
    if (fragments.length)
      throw new Error("Stable release has unconsumed changelog fragments");
    const promoted = changelog.slice(start + heading.length);
    const release = /^\s*## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\n/.exec(
      promoted,
    );
    if (
      !release ||
      release[1] !== version ||
      new Date(release[2]).toJSON()?.slice(0, 10) !== release[2]
    )
      throw new Error(
        `CHANGELOG.md must promote Unreleased to a dated ${version} section`,
      );
    const section = promoted.slice(release[0].length).split(/\n## \[/, 1)[0];
    try {
      parseFragment("release.md", section);
    } catch (error) {
      throw new Error(
        `CHANGELOG.md: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

if (import.meta.main) {
  try {
    const version = process.argv[2];
    if (!version || process.argv.length !== 3)
      throw new Error(
        "Usage: bun scripts/validate-prepared-release.ts X.Y.Z[-rc.N]",
      );
    validatePreparedRelease(process.cwd(), version);
    console.log(
      `Prepared release ${version}: version, changelog, fragments and release notes passed.`,
    );
    const commands = [
      [
        "test",
        "scripts/prepare-release.test.ts",
        "scripts/validate-prepared-release.test.ts",
        "scripts/changelog-fragments.test.ts",
        "scripts/release-validation.test.ts",
      ],
      ["format:check"],
      ["lint"],
      ["typecheck:quick"],
    ];
    for (const command of commands) {
      console.log(`Validating prepared release: bun run ${command.join(" ")}`);
      const result = spawnSync(process.execPath, ["run", ...command], {
        stdio: "inherit",
        env: {
          ...process.env,
          HERDR_TEST_PARALLEL: "1",
          HERDR_TEST_MAX_CONCURRENCY: "2",
        },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
    console.log(
      `Prepared release ${version}: validation passed. Full product tests run in release PR CI.`,
    );
  } catch (error) {
    console.error(
      `validate-prepared-release: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
