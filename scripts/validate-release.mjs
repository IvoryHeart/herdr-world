#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertCurrentReleaseReferences,
  normalizeReleaseTag,
  releaseVersion,
} from "./release-version.mjs";

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
if (subject !== `Release ${tag}`) {
  fail(`tagged commit subject must be exactly Release ${tag}; found ${subject}`);
}

try {
  assertCurrentReleaseReferences(root);
} catch (error) {
  fail(error.message);
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const changelogHeading = new RegExp(`^## \\[${releaseVersion(tag).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\] - `, "m");
if (!changelogHeading.test(changelog)) {
  fail(`CHANGELOG.md has no released section for ${tag}`);
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
  const pluginVersion = plugin.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (pluginVersion !== releaseVersion(tag)) {
    fail(`herdr-plugin.toml version must be ${releaseVersion(tag)}`);
  }
} catch (error) {
  if (error.code !== "ENOENT") fail(`could not read herdr-plugin.toml: ${error.message}`);
}

console.log(`Validated protected release ${tag} at ${tagSha}`);
