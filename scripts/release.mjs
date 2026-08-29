#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { queryNpm } from "./npm-registry-query.mjs";
import { homebrewFormulaReleaseTag } from "./homebrew-formula.mjs";
import {
  HOMEBREW_TAP_REPOSITORY,
  NPM_PACKAGE_NAME,
} from "./release-publication.mjs";
import {
  RELEASE_REMOTE,
  RELEASE_REPOSITORY,
  assertReleaseRemoteUrls,
  withReleaseRepository,
} from "./release-target.mjs";
import {
  compareReleaseTags,
  escapeRegex,
  normalizeReleaseTag,
  releaseReferencePaths,
  stampCurrentRelease,
} from "./release-version.mjs";

const RELEASE_BRANCH = "main";
const RELEASE_ARG = process.argv[2];

if (!RELEASE_ARG || process.argv.length !== 3) {
  console.error("Usage: node scripts/release.mjs <vX.Y.Z|X.Y.Z>");
  process.exit(1);
}

let tag;
try {
  tag = normalizeReleaseTag(RELEASE_ARG);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
const version = tag.slice(1);
const today = new Date().toISOString().slice(0, 10);
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

function queryNpmOrFail(args, description) {
  try {
    return queryNpm(args);
  } catch (error) {
    fail(`could not ${description}: ${error.message}`);
  }
}

function readGhApiOrMissing(args, description) {
  try {
    return JSON.parse(output("gh", args));
  } catch (error) {
    const stdout = String(error.stdout ?? "").trim();
    const stderr = String(error.stderr ?? "").trim();
    let response;
    try {
      response = JSON.parse(stdout);
    } catch {
      response = null;
    }
    if (response?.status === 404 || response?.status === "404" || /HTTP 404\b/.test(stderr)) {
      return null;
    }
    const detail = stderr || stdout || error.message;
    fail(`could not ${description}: ${detail}`);
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readNpmChannelVersion(channel) {
  const result = queryNpmOrFail(
    ["view", NPM_PACKAGE_NAME, `dist-tags.${channel}`, "--json"],
    `read npm ${channel} for ${NPM_PACKAGE_NAME}`,
  );
  if (
    !result.present ||
    !result.raw ||
    result.raw === "null" ||
    result.raw === "undefined"
  ) return null;

  let value;
  try {
    value = JSON.parse(result.raw);
  } catch (error) {
    fail(`npm ${channel} returned invalid version data: ${error.message}`);
  }
  if (value === null || value === "") return null;
  try {
    return normalizeReleaseTag(value);
  } catch (error) {
    fail(`npm ${channel} returned an invalid release version: ${error.message}`);
  }
}

function checkExternalVersionAvailability() {
  const exactVersion = queryNpmOrFail(
    ["view", `${NPM_PACKAGE_NAME}@${version}`, "version", "--json"],
    `check npm version ${NPM_PACKAGE_NAME}@${version}`,
  );
  if (exactVersion.present) {
    fail(`npm version already exists: ${NPM_PACKAGE_NAME}@${version}`);
  }

  const npmPackageExists = queryNpmOrFail(
    ["view", NPM_PACKAGE_NAME, "name", "--json"],
    `check whether npm package ${NPM_PACKAGE_NAME} exists`,
  ).present;
  if (!npmPackageExists && !tag.includes("-rc.")) {
    fail(
      `the first npm publication must be an RC; publish a unique release candidate before ${tag}`,
    );
  }
  if (npmPackageExists) {
    const channel = tag.includes("-rc.") ? "next" : "latest";
    const currentChannelVersion = readNpmChannelVersion(channel);
    if (
      currentChannelVersion &&
      compareReleaseTags(tag, currentChannelVersion) <= 0
    ) {
      fail(
        `npm ${channel} already reaches ${currentChannelVersion}; candidate ${tag} must be a higher release`,
      );
    }
  }

  if (
    !commandSucceeds("gh", [
      "repo",
      "view",
      HOMEBREW_TAP_REPOSITORY,
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ])
  ) {
    fail(
      `Homebrew tap ${HOMEBREW_TAP_REPOSITORY} is missing; create it before releasing ${tag}`,
    );
  }

  const formula = tag.includes("-rc.") ? "herdr-world-rc.rb" : "herdr-world.rb";
  const formulaPath = `Formula/${formula}`;
  const endpoint = `repos/${HOMEBREW_TAP_REPOSITORY}/contents/${formulaPath}`;
  const response = readGhApiOrMissing(
    ["api", endpoint],
    `check Homebrew Formula ${formulaPath}`,
  );
  if (response) {
    const contents = Buffer.from(response.content, "base64").toString("utf8");
    let currentTag;
    try {
      currentTag = homebrewFormulaReleaseTag(contents);
    } catch (error) {
      fail(`Homebrew Formula ${formulaPath} has no parseable version: ${error.message}`);
    }
    if (compareReleaseTags(tag, currentTag) <= 0) {
      fail(`Homebrew Formula ${formulaPath} already reaches ${currentTag}`);
    }
  }
}

function validatePreflight() {
  if (output("git", ["status", "--porcelain"]) !== "") {
    fail("release requires a clean working tree");
  }

  const branch = output("git", ["branch", "--show-current"]);
  if (branch !== RELEASE_BRANCH) {
    fail(`release must run from ${RELEASE_BRANCH}; current branch is ${branch || "(detached)"}`);
  }

  try {
    const fetchUrls = output("git", ["remote", "get-url", "--all", RELEASE_REMOTE])
      .split("\n")
      .filter(Boolean);
    const pushUrls = output("git", ["remote", "get-url", "--push", "--all", RELEASE_REMOTE])
      .split("\n")
      .filter(Boolean);
    assertReleaseRemoteUrls(fetchUrls, "fetch");
    assertReleaseRemoteUrls(pushUrls, "push");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  let accessibleRepository;
  try {
    accessibleRepository = output("gh", [
      "repo",
      "view",
      RELEASE_REPOSITORY,
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
  } catch {
    fail(`GitHub CLI cannot access ${RELEASE_REPOSITORY}`);
  }
  if (accessibleRepository.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase()) {
    fail(`GitHub CLI resolved the release repository as ${accessibleRepository}`);
  }

  run("git", ["fetch", RELEASE_REMOTE, RELEASE_BRANCH, "--no-tags"]);
  const local = output("git", ["rev-parse", RELEASE_BRANCH]);
  const remote = output("git", ["rev-parse", `${RELEASE_REMOTE}/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    fail(
      `${RELEASE_BRANCH} must match ${RELEASE_REMOTE}/${RELEASE_BRANCH}; run git pull --ff-only first`,
    );
  }

  if (commandSucceeds("git", ["rev-parse", "--verify", "--quiet", tag])) {
    fail(`tag already exists locally: ${tag}`);
  }
  if (
    commandSucceeds("git", ["ls-remote", "--exit-code", "--tags", RELEASE_REMOTE, `refs/tags/${tag}`])
  ) {
    fail(`tag already exists on ${RELEASE_REMOTE}: ${tag}`);
  }
  if (commandSucceeds("gh", withReleaseRepository(["release", "view", tag]))) {
    fail(`GitHub release already exists in ${RELEASE_REPOSITORY}: ${tag}`);
  }

  checkExternalVersionAvailability();
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

validatePreflight();
const changelog = readChangelogForRelease();

run("npm", ["run", "check"]);

stampCurrentRelease(tag);
const released = stampChangelog(changelog);

run("npm", ["run", "test:release"]);
run("npm", ["run", "test:pages"]);

run("git", ["add", "CHANGELOG.md", ...releaseReferencePaths()]);
run("git", ["commit", "-m", `Release ${tag}`]);
run("git", ["tag", tag]);
run("git", ["push", "--atomic", RELEASE_REMOTE, RELEASE_BRANCH, tag]);

openNextUnreleased(released);
run("git", ["add", "CHANGELOG.md"]);
run("git", ["commit", "-m", "Prepare for next release"]);
run("git", ["push", RELEASE_REMOTE, RELEASE_BRANCH]);
