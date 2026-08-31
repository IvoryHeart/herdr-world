#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  assertCurrentReleaseReferences,
  isReleaseCommitSubject,
  normalizeReleaseTag,
  releaseVersion,
} from "./release-version.mjs";
import { assertPreparedReleaseChangelog } from "./release-changelog.mjs";
import { assertPluginManifest, parsePluginManifest } from "./herdr-world-plugin.mjs";

const root = process.cwd();
const suppliedTag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

function fail(message) {
  console.error(`Release validation failed: ${message}`);
  process.exit(1);
}

function output(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail(`${command} ${args.join(" ")} failed: ${error.message}`);
  }
}

if (!suppliedTag) fail("a release tag is required");
let tag;
try {
  tag = normalizeReleaseTag(suppliedTag);
} catch (error) {
  fail(error.message);
}
if (suppliedTag !== tag) {
  fail(`workflow release refs must use the canonical tag ${tag}`);
}

const tagSha = output("git", ["rev-list", "-n", "1", `refs/tags/${tag}`]);
const expectedSha = process.env.GITHUB_SHA;
if (expectedSha && tagSha !== expectedSha) {
  fail(`tag ${tag} resolves to ${tagSha}, not GITHUB_SHA ${expectedSha}`);
}
if (output("git", ["tag", "--points-at", tagSha, "--list", tag]) !== tag) {
  fail(`tag ${tag} does not point at the workflow commit`);
}

try {
  execFileSync("git", ["merge-base", "--is-ancestor", tagSha, "origin/main"], {
    cwd: root,
    stdio: "ignore",
  });
} catch {
  fail(`tagged commit ${tagSha} is not reachable from fetched protected origin/main`);
}

const subject = output("git", ["show", "-s", "--format=%s", tagSha]);
if (!isReleaseCommitSubject(subject, tag)) {
  fail(`tagged commit subject must be the reviewed squash merge Release ${tag} (#<number>); found ${subject}`);
}

try {
  assertCurrentReleaseReferences(root);
} catch (error) {
  fail(error.message);
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
try {
  assertPreparedReleaseChangelog(
    changelog,
    tag,
    readFileSync(join(root, "UPSTREAM.md"), "utf8"),
  );
} catch (error) {
  fail(error.message);
}

for (const relativePath of ["package.json", "web/package.json"]) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  } catch (error) {
    fail(`could not read ${relativePath}: ${error.message}`);
  }
  if (manifest.private !== true || manifest.version !== "0.0.0") {
    fail(`${relativePath} must remain the private development manifest at version 0.0.0`);
  }
}

const pluginPath = join(root, "herdr-plugin.toml");
try {
  const plugin = readFileSync(pluginPath, "utf8");
  const manifest = assertPluginManifest(parsePluginManifest(plugin));
  if (manifest.version !== releaseVersion(tag)) fail(`herdr-plugin.toml version must be ${releaseVersion(tag)}`);
  for (const entrypoint of ["scripts/herdr-world-plugin.sh", "scripts/herdr-world-plugin.mjs"]) {
    const pathname = join(root, entrypoint);
    try {
      const mode = statSync(pathname).mode;
      if ((mode & 0o111) === 0) fail(`${entrypoint} must be executable`);
    } catch (error) {
      fail(`${entrypoint} is missing or unreadable: ${error.message}`);
    }
  }
} catch (error) {
  if (error.code === "ENOENT") fail("herdr-plugin.toml is required for plugin-enabled releases");
  fail(`could not read herdr-plugin.toml: ${error.message}`);
}

console.log(`Validated protected release ${tag} at ${tagSha}`);
