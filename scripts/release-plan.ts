import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseManifestVersion, releaseNotes } from "./prepare-release";
import { RELEASE_VERSION_RE } from "./release-version";

/** @internal */
export function releasePlan() {
  const version = parseManifestVersion(
    readFileSync("herdr-plugin.toml", "utf8"),
  );
  if (!RELEASE_VERSION_RE.test(version))
    throw new Error("Invalid release version");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (process.env.GITHUB_REF !== `refs/tags/v${version}`)
    throw new Error("Publication requires the reviewed version's tag");
  execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  const previous = execFileSync("git", ["show", `${sha}^1:herdr-plugin.toml`], {
    encoding: "utf8",
  });
  if (parseManifestVersion(previous) === version)
    throw new Error("Tag must select the version commit on main");
  for (const file of [
    "package.json",
    "web/package.json",
    "server/package.json",
  ])
    if (JSON.parse(readFileSync(file, "utf8")).version !== "0.0.0")
      throw new Error(`Unexpected development version: ${file}`);
  releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\ncommit=${sha}\n`,
    );
  return { version, sha };
}

if (import.meta.main) {
  try {
    releasePlan();
  } catch (error) {
    console.error(
      `::error::${(error as Error).message}; re-run this tag after correcting its release input.`,
    );
    process.exitCode = 1;
  }
}
