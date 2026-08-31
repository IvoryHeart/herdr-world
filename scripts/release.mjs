#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { queryNpm } from "./npm-registry-query.mjs";
import { homebrewFormulaReleaseTag } from "./homebrew-formula.mjs";
import {
  assertPreparedReleaseChangelog,
  prepareReleaseChangelog,
} from "./release-changelog.mjs";
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
  assertCurrentReleaseReferences,
  isReleaseCommitSubject,
  normalizeReleaseTag,
  stampCurrentRelease,
} from "./release-version.mjs";

const RELEASE_BRANCH = "main";
const [RELEASE_MODE, RELEASE_ARG] = process.argv.slice(2);

if (!["prepare", "tag"].includes(RELEASE_MODE) || !RELEASE_ARG || process.argv.length !== 4) {
  console.error("Usage: node scripts/release.mjs <prepare|tag> <vX.Y.Z|X.Y.Z>");
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

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

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

function validateCleanWorkingTree() {
  if (output("git", ["status", "--porcelain"]) !== "") {
    fail("release requires a clean working tree");
  }
}

function validateRepositoryAccess() {
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
}

function fetchMainWithoutTags() {
  run("git", ["fetch", RELEASE_REMOTE, RELEASE_BRANCH, "--no-tags"]);
  return output("git", ["rev-parse", `${RELEASE_REMOTE}/${RELEASE_BRANCH}`]);
}

function validateRemoteReleaseTarget() {
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

function validatePreparationBase() {
  validateCleanWorkingTree();
  const branch = output("git", ["branch", "--show-current"]);
  if (!branch || branch === RELEASE_BRANCH) {
    fail("release preparation must run from a review branch, not main or detached HEAD");
  }
  validateRepositoryAccess();
  const remoteMain = fetchMainWithoutTags();
  const head = output("git", ["rev-parse", "HEAD"]);
  if (head !== remoteMain) {
    fail(
      `release preparation branch must start at ${RELEASE_REMOTE}/${RELEASE_BRANCH}; ` +
      "create a fresh branch from the current remote main",
    );
  }
  validateRemoteReleaseTarget();
  return head;
}

function validateSuccessfulDistributionPreflight(head) {
  let runs;
  try {
    runs = JSON.parse(output("gh", withReleaseRepository([
      "run",
      "list",
      "--workflow",
      "release.yml",
      "--event",
      "workflow_dispatch",
      "--commit",
      head,
      "--status",
      "success",
      "--limit",
      "10",
      "--json",
      "databaseId,headSha,status,conclusion,url",
    ])) || "[]");
  } catch (error) {
    fail(`could not verify the distribution preflight: ${error.message}`);
  }
  const successful = runs.find((run) =>
    run.headSha === head && run.status === "completed" && run.conclusion === "success"
  );
  if (!successful) {
    fail(
      `no successful workflow-dispatch release preflight exists for ${head}; ` +
      `run gh workflow run release.yml --ref ${RELEASE_BRANCH} and wait for it to pass`,
    );
  }
  return successful;
}

function validatePreparedChangelogForTag() {
  assertPreparedReleaseChangelog(
    readFileSync("CHANGELOG.md", "utf8"),
    tag,
    readFileSync("UPSTREAM.md", "utf8"),
    currentUtcDate(),
  );
}

function validateTaggingBase() {
  validateCleanWorkingTree();
  const branch = output("git", ["branch", "--show-current"]);
  if (branch !== RELEASE_BRANCH) {
    fail(`release tagging must run from ${RELEASE_BRANCH}; current branch is ${branch || "(detached)"}`);
  }
  validateRepositoryAccess();
  const remoteMain = fetchMainWithoutTags();
  const head = output("git", ["rev-parse", "HEAD"]);
  if (head !== remoteMain) {
    fail(
      `${RELEASE_BRANCH} must match ${RELEASE_REMOTE}/${RELEASE_BRANCH}; run git pull --ff-only first`,
    );
  }
  if (commandSucceeds("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`])) {
    fail(
      `tag already exists locally: ${tag}; use a clean origin-only release clone so an ` +
      "inherited upstream tag cannot be mistaken for the Herdr World release",
    );
  }
  validateRemoteReleaseTarget();

  let current;
  try {
    current = assertCurrentReleaseReferences();
  } catch (error) {
    fail(error.message);
  }
  if (current !== tag) {
    fail(`public release references point to ${current}, not ${tag}`);
  }
  try {
    validatePreparedChangelogForTag();
  } catch (error) {
    fail(error.message);
  }
  const subject = output("git", ["show", "-s", "--format=%s", "HEAD"]);
  if (!isReleaseCommitSubject(subject, tag)) {
    fail(`release commit must be the reviewed squash merge Release ${tag} (#<number>); found ${subject}`);
  }
  const preflight = validateSuccessfulDistributionPreflight(head);
  return { head, preflight };
}

function prepareRelease() {
  const head = validatePreparationBase();
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const upstream = readFileSync("UPSTREAM.md", "utf8");
  run("npm", ["run", "check"]);
  if (fetchMainWithoutTags() !== head) {
    fail(`${RELEASE_REMOTE}/${RELEASE_BRANCH} advanced during release preparation; start again`);
  }
  validateRemoteReleaseTarget();
  const releaseDate = currentUtcDate();

  try {
    stampCurrentRelease(tag);
    writeFileSync("CHANGELOG.md", prepareReleaseChangelog(changelog, tag, releaseDate, upstream));
  } catch (error) {
    fail(error.message);
  }

  run("npm", ["run", "test:release"]);
  run("npm", ["run", "test:pages"]);
  run("git", ["diff", "--check"]);
  console.log(
    `Prepared ${tag}. Review the generated diff, commit it as Release ${tag}, ` +
    "and deliver it through an independently reviewed pull request.",
  );
}

function tagRelease() {
  const { head, preflight } = validateTaggingBase();
  run("npm", ["run", "check"]);
  if (fetchMainWithoutTags() !== head) {
    fail(`${RELEASE_REMOTE}/${RELEASE_BRANCH} advanced during release validation; do not tag`);
  }
  validateRemoteReleaseTarget();
  try {
    validatePreparedChangelogForTag();
  } catch (error) {
    fail(error.message);
  }
  run("git", [
    "push",
    RELEASE_REMOTE,
    `${head}:refs/tags/${tag}`,
  ]);
  console.log(
    `Tagged ${tag} at ${head} after distribution preflight ${preflight.url}. ` +
    "Monitor Release distribution and Deploy GitHub Pages before announcing the release.",
  );
}

if (RELEASE_MODE === "prepare") {
  prepareRelease();
} else {
  tagRelease();
}
