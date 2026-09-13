#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELEASE_BRANCH = "main";
const RELEASE_ARG = process.argv[2];
const VERSION_ARG = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const match = RELEASE_ARG?.match(VERSION_ARG);
if (!match) {
  console.error("Usage: node scripts/release.mjs <vX.Y.Z|X.Y.Z>");
  process.exit(1);
}

const version = match[1];
const tag = `v${version}`;
const today = new Date().toISOString().slice(0, 10);
const notesFile = join(process.cwd(), ".release-notes-tmp.md");
const androidBuildFile = "android/app/build.gradle";
const changelogSubsections = ["Breaking Changes", "Added", "Changed", "Fixed", "Removed"];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.silent ? "pipe" : "inherit",
  });
}

function output(command, args) {
  return run(command, args, { silent: true }).trim();
}

function commandSucceeds(command, args) {
  try {
    run(command, args, { silent: true });
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function validatePreflight() {
  if (output("git", ["status", "--porcelain"]) !== "") {
    fail("release requires a clean working tree");
  }

  const branch = output("git", ["branch", "--show-current"]);
  if (branch !== RELEASE_BRANCH) {
    fail(`release must run from ${RELEASE_BRANCH}; current branch is ${branch || "(detached)"}`);
  }

  run("git", ["fetch", "origin", RELEASE_BRANCH, "--tags"]);
  const local = output("git", ["rev-parse", RELEASE_BRANCH]);
  const remote = output("git", ["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    fail(`${RELEASE_BRANCH} must match origin/${RELEASE_BRANCH}; run git pull --ff-only first`);
  }

  if (commandSucceeds("git", ["rev-parse", "--verify", "--quiet", tag])) {
    fail(`tag already exists locally: ${tag}`);
  }
  if (commandSucceeds("git", ["ls-remote", "--exit-code", "--tags", "origin", tag])) {
    fail(`tag already exists on origin: ${tag}`);
  }
}

function readChangelogForRelease() {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const unreleased = changelog.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|$)/);
  if (!unreleased) {
    fail("CHANGELOG.md is missing an Unreleased section");
  }
  if (!removeEmptyChangelogSubsections(unreleased[1]).trim()) {
    fail("CHANGELOG.md has no release notes under Unreleased");
  }
  return changelog;
}

function stampChangelog(changelog) {
  const stamped = changelog.replace("## [Unreleased]", `## [${version}] - ${today}`);
  const released = removeEmptyReleaseSubsections(stamped);
  if (stamped === changelog) {
    fail("CHANGELOG.md is missing an Unreleased section");
  }
  writeFileSync("CHANGELOG.md", released);
  return released;
}

function prepareAndroidRelease() {
  const gradle = readFileSync(androidBuildFile, "utf8");
  const codePattern = /^([ \t]*versionCode[ \t]+)([1-9]\d*)([ \t]*)$/gm;
  const namePattern = /^([ \t]*versionName[ \t]+)"[^"\r\n]*"([ \t]*)$/gm;
  const codes = [...gradle.matchAll(codePattern)];
  if (codes.length !== 1 || [...gradle.matchAll(namePattern)].length !== 1) {
    fail(`${androidBuildFile} must contain exactly one literal versionCode and versionName`);
  }
  const nextCode = Number(codes[0][2]) + 1;
  if (!Number.isSafeInteger(nextCode) || nextCode > 2_100_000_000) {
    fail("Android versionCode increment would exceed 2100000000");
  }
  return gradle
    .replace(codePattern, (_match, prefix, _code, suffix) => `${prefix}${nextCode}${suffix}`)
    .replace(namePattern, (_match, prefix, suffix) => `${prefix}"${version}"${suffix}`);
}

function removeEmptyReleaseSubsections(changelog) {
  const releasePattern = new RegExp(
    `(## \\[${escapeRegex(version)}\\] - [^\\n]+\\n)([\\s\\S]*?)(?=\\n## \\[|$)`,
  );
  return changelog.replace(releasePattern, (_match, heading, body) => {
    return `${heading}${removeEmptyChangelogSubsections(body)}`;
  });
}

function removeEmptyChangelogSubsections(body) {
  let cleaned = body;
  for (const subsection of changelogSubsections) {
    cleaned = cleaned.replace(
      new RegExp(`(^|\\n)### ${escapeRegex(subsection)}\\n\\n*(?=### |$)`, "g"),
      "$1",
    );
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trimEnd();
  return cleaned ? `\n${cleaned.trimStart()}\n` : "\n";
}

function extractReleaseNotes(changelog) {
  const release = changelog.match(new RegExp(`## \\[${escapeRegex(version)}\\] - [^\\n]+\\n([\\s\\S]*?)(?=\\n## \\[|$)`));
  if (!release || !release[1].trim()) {
    fail(`could not extract release notes for ${tag}`);
  }
  return release[1].trim();
}

function openNextUnreleased(changelog) {
  const next = changelog.replace(
    "# Changelog\n\n",
    "# Changelog\n\n## [Unreleased]\n\n### Breaking Changes\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Removed\n\n",
  );
  if (next === changelog) {
    fail("could not open next Unreleased changelog section");
  }
  writeFileSync("CHANGELOG.md", next);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

try {
  validatePreflight();
  const changelog = readChangelogForRelease();
  const androidRelease = prepareAndroidRelease();

  run("npm", ["run", "check"]);

  const released = stampChangelog(changelog);
  writeFileSync(androidBuildFile, androidRelease);
  writeFileSync(notesFile, extractReleaseNotes(released));

  run("git", ["add", "CHANGELOG.md", androidBuildFile]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push", "--atomic", "origin", RELEASE_BRANCH, tag]);

  run("gh", ["release", "create", tag, "--notes-file", notesFile]);

  openNextUnreleased(released);
  run("git", ["add", "CHANGELOG.md"]);
  run("git", ["commit", "-m", "Prepare for next release"]);
  run("git", ["push", "origin", RELEASE_BRANCH]);
} finally {
  rmSync(notesFile, { force: true });
}
