#!/usr/bin/env bun
// Prepare a release PR by bumping the public Herdr plugin version. Development
// package manifests stay private at 0.0.0; tagged builds inject the reviewed
// plugin/tag version into the standalone binary and archive metadata.
//
// Usage:
//   bun scripts/prepare-release.ts <X.Y.Z | X.Y.Z-rc.N | patch | minor | major>
//   bun scripts/prepare-release.ts 0.4.6
//   bun scripts/prepare-release.ts 0.4.6-rc.1
//   bun scripts/prepare-release.ts patch

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseCandidate, RELEASE_VERSION_RE } from "./release-version";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_FILES = [
  "package.json",
  "web/package.json",
  "server/package.json",
];
const PLUGIN_MANIFEST_FILE = "herdr-plugin.toml";
const CHANGELOG_FILE = "CHANGELOG.md";
const RELEASE_FILES = [...PACKAGE_FILES, PLUGIN_MANIFEST_FILE, CHANGELOG_FILE];

export function parsePackageVersion(packageJsonText: string): string {
  const match = /^(\s*)"version": "([^"]+)"/m.exec(packageJsonText);
  if (!match) {
    throw new Error('package.json has no top-level "version" field');
  }
  return match[2];
}

export function replacePackageVersion(
  packageJsonText: string,
  expectedCurrent: string,
  next: string,
): string {
  const match = /^(\s*)"version": "([^"]+)"/m.exec(packageJsonText);
  if (!match || match.index === undefined) {
    throw new Error('package.json has no top-level "version" field');
  }
  if (match[2] !== expectedCurrent) {
    throw new Error(
      `package.json version is ${match[2]}, expected ${expectedCurrent}`,
    );
  }
  return `${packageJsonText.slice(0, match.index)}${match[1]}"version": "${next}"${packageJsonText.slice(
    match.index + match[0].length,
  )}`;
}

export function parseManifestVersion(manifestText: string): string {
  const match = /^(\s*)version = "([^"]+)"/m.exec(manifestText);
  if (!match) {
    throw new Error('herdr-plugin.toml has no top-level "version" field');
  }
  return match[2];
}

export function replaceManifestVersion(
  manifestText: string,
  expectedCurrent: string,
  next: string,
): string {
  const match = /^(\s*)version = "([^"]+)"/m.exec(manifestText);
  if (!match || match.index === undefined) {
    throw new Error('herdr-plugin.toml has no top-level "version" field');
  }
  if (match[2] !== expectedCurrent) {
    throw new Error(
      `herdr-plugin.toml version is ${match[2]}, expected ${expectedCurrent}`,
    );
  }
  return `${manifestText.slice(0, match.index)}${match[1]}version = "${next}"${manifestText.slice(
    match.index + match[0].length,
  )}`;
}

export function resolveNextVersion(current: string, input: string): string {
  const currentMatch = RELEASE_VERSION_RE.exec(current);
  if (!currentMatch) {
    throw new Error(
      `Current version "${current}" is not in X.Y.Z or X.Y.Z-rc.N form`,
    );
  }
  const currentTuple = [
    Number(currentMatch[1]),
    Number(currentMatch[2]),
    Number(currentMatch[3]),
  ];
  if (input === "patch") {
    return `${currentTuple[0]}.${currentTuple[1]}.${currentTuple[2] + 1}`;
  }
  if (input === "minor") {
    return `${currentTuple[0]}.${currentTuple[1] + 1}.0`;
  }
  if (input === "major") {
    return `${currentTuple[0] + 1}.0.0`;
  }
  const nextMatch = RELEASE_VERSION_RE.exec(input);
  if (!nextMatch) {
    throw new Error(
      `Version "${input}" must be X.Y.Z, X.Y.Z-rc.N, or patch|minor|major`,
    );
  }
  const candidate = [
    Number(nextMatch[1]),
    Number(nextMatch[2]),
    Number(nextMatch[3]),
  ];
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] > currentTuple[index]) return input;
    if (candidate[index] < currentTuple[index]) {
      throw new Error(
        `Version ${input} must be greater than the current ${current}`,
      );
    }
  }
  if (currentMatch[4] !== undefined) {
    if (
      nextMatch[4] === undefined ||
      Number(nextMatch[4]) > Number(currentMatch[4])
    ) {
      return input;
    }
  }
  throw new Error(
    `Version ${input} must be greater than the current ${current}`,
  );
}

export function promoteChangelog(
  changelog: string,
  version: string,
  date: string,
): string {
  const heading = "## [Unreleased]\n";
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error("CHANGELOG.md has no Unreleased section");
  const next = changelog.indexOf("\n## [", start + heading.length);
  if (next < 0) throw new Error("CHANGELOG.md has no previous release section");
  const notes = changelog.slice(start + heading.length, next).trim();
  if (!notes.includes("- ")) {
    throw new Error("CHANGELOG.md has no Unreleased changes to publish");
  }
  return (
    changelog.slice(0, start) +
    `${heading}\n## [${version}] - ${date}\n\n` +
    changelog.slice(start + heading.length).replace(/^\n+/u, "")
  );
}

export function draftCandidateNotes(version: string, stableNotes: string) {
  if (!isReleaseCandidate(version)) {
    throw new Error(`not a release candidate: ${version}`);
  }
  const body = stableNotes.replace(/^# [^\n]+\n/u, "").trim();
  if (!body) throw new Error("stable release notes are empty");
  return `# Herdr World ${version} release candidate\n\nThis candidate needs cross-platform validation before the stable release. Install this exact version; report defects against tag \`v${version}\`. A correction receives the next RC number.\n\n${body}\n`;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function originTagExists(tag: string): boolean {
  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.error) {
    throw new Error(
      `could not run git while inspecting origin tag ${tag}: ${result.error.message}`,
    );
  }
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(
    result.stderr.trim() || `could not inspect origin tag ${tag}`,
  );
}

function abort(message: string): never {
  console.error(`prepare-release: ${message}`);
  process.exit(1);
}

function main() {
  const input = process.argv[2];
  if (!input || input === "--help") {
    console.log(
      "Usage: bun scripts/prepare-release.ts <X.Y.Z | X.Y.Z-rc.N | patch | minor | major>",
    );
    process.exit(input ? 0 : 1);
  }
  if (process.argv.length > 3) {
    abort("unexpected extra arguments");
  }

  const dirty = git("status", "--porcelain", "--", ...RELEASE_FILES);
  if (dirty) {
    abort(
      `release files have uncommitted changes, commit or stash them first:\n${dirty}`,
    );
  }

  const packageSources = PACKAGE_FILES.map((file) => {
    const path = join(REPO_ROOT, file);
    const text = readFileSync(path, "utf8");
    return { file, path, text, version: parsePackageVersion(text) };
  });
  const developmentVersion = packageSources[0].version;
  const mismatchedPackage = packageSources.find(
    ({ version }) => version !== developmentVersion,
  );
  if (mismatchedPackage) {
    abort(
      `${mismatchedPackage.file} version is ${mismatchedPackage.version}, expected ${developmentVersion}`,
    );
  }
  if (developmentVersion !== "0.0.0") {
    abort(
      `development package versions must remain 0.0.0, found ${developmentVersion}`,
    );
  }
  const manifestPath = join(REPO_ROOT, PLUGIN_MANIFEST_FILE);
  const manifestText = readFileSync(manifestPath, "utf8");
  const current = parseManifestVersion(manifestText);
  const changelogPath = join(REPO_ROOT, CHANGELOG_FILE);
  const changelogText = readFileSync(changelogPath, "utf8");

  const version = resolveNextVersion(current, input);
  const tag = `v${version}`;
  if (originTagExists(tag)) {
    abort(`tag ${tag} already exists on origin`);
  }
  const notesPath = join(REPO_ROOT, "docs", "releases", `${tag}.md`);
  const candidate = isReleaseCandidate(version);
  const notesExist = existsSync(notesPath);
  const releaseNotes = notesExist
    ? readFileSync(notesPath, "utf8")
    : candidate
      ? draftCandidateNotes(
          version,
          readFileSync(
            join(
              REPO_ROOT,
              "docs",
              "releases",
              `v${version.replace(/-rc\.[1-9]\d*$/u, "")}.md`,
            ),
            "utf8",
          ),
        )
      : "";
  if (!releaseNotes.trim()) abort(`release notes for ${tag} are empty`);

  // Compute every output before writing anything so a validation failure
  // leaves the worktree untouched.
  const manifestWrite = replaceManifestVersion(manifestText, current, version);
  const changelogWrite = candidate
    ? changelogText
    : promoteChangelog(
        changelogText,
        version,
        new Date().toISOString().slice(0, 10),
      );
  writeFileSync(manifestPath, manifestWrite);
  if (!notesExist) writeFileSync(notesPath, releaseNotes);
  if (changelogWrite !== changelogText) {
    writeFileSync(changelogPath, changelogWrite);
  }

  console.log(
    `Prepared release ${version}. Review the changes and submit them as a release PR.`,
  );

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\ntag=${tag}\n`,
    );
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    abort(error instanceof Error ? error.message : String(error));
  }
}
