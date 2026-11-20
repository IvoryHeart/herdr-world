import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RELEASE_VERSION_RE } from "./release-version";

// Dispatches are rehearsals unless a maintainer explicitly selects publication on a tag.
const dryRun =
  process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
  process.env.DRY_RUN !== "false";
const plugin = readFileSync("herdr-plugin.toml", "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
const version = dryRun
  ? process.env.VERSION_INPUT || plugin
  : process.env.GITHUB_REF_NAME?.replace(/^v/, "");
if (!version || !RELEASE_VERSION_RE.test(version))
  throw new Error("Invalid release version");
for (const file of [
  "package.json",
  "web/package.json",
  "server/package.json",
]) {
  if (JSON.parse(readFileSync(file, "utf8")).version !== "0.0.0")
    throw new Error(`Unexpected development version: ${file}`);
}
if (!dryRun) {
  if (process.env.GITHUB_REF !== `refs/tags/v${version}` || version !== plugin)
    throw new Error("Publication requires the reviewed version's tag");
  execFileSync("git", [
    "merge-base",
    "--is-ancestor",
    process.env.GITHUB_SHA!,
    "origin/main",
  ]);
  if (!readFileSync(`docs/releases/v${version}.md`, "utf8").trim())
    throw new Error("Missing release notes");
  if (
    !version.includes("-rc.") &&
    !readFileSync("CHANGELOG.md", "utf8").includes(`## [${version}] - `)
  )
    throw new Error("Missing stable changelog");
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\ntag=v${version}\ndry_run=${dryRun}\n`,
  );
console.log(`${dryRun ? "Dry run (no publication)" : "Publish"}: v${version}`);
