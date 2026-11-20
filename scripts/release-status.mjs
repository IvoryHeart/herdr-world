import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const {
  RELEASE_VERSION: version,
  DRY_RUN: dryRun,
  GITHUB_RUN_ID: run,
  GITHUB_REPOSITORY: repository,
} = process.env;
const lines = [];
function query(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/E404|HTTP 404|release not found/i.test(result.stderr)) return null;
  throw new Error(`${command} lookup failed`);
}
function report(label, inspect) {
  try {
    lines.push(`- ${label}: ${inspect()}`);
  } catch {
    lines.push(
      `- ${label}: UNKNOWN (lookup failed; inspect the publish job log before recovery)`,
    );
  }
}
if (dryRun === "true") {
  lines.push(
    "Dry run: GitHub, npm and Homebrew publishers were disabled. No release, package, tag, tap branch or PR was published.",
  );
  lines.push(`Verification: ${process.env.VERIFY_RESULT}.`);
  if (process.env.VERIFY_RESULT === "success")
    lines.push(
      "The verified-release artifact contains the formula, tap patch and exact PR body.",
    );
} else if (process.env.VERIFY_RESULT !== "success") {
  lines.push(
    "Verification did not pass. No publisher was allowed to start in this run.",
  );
} else {
  report("GitHub", () => {
    const release = query("gh", [
      "release",
      "view",
      `v${version}`,
      "--json",
      "isDraft,assets,url",
    ]);
    return release
      ? `${release.isDraft ? "draft (not public)" : "PUBLIC"}; ${release.assets.length}/31 assets; ${release.url}`
      : "not published";
  });
  for (const platform of [
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "windows-x64",
    "windows-arm64",
    "",
  ]) {
    const name = `@ivoryheart/herdr-world${platform ? `-${platform}` : ""}@${version}`;
    report(`npm ${name}`, () =>
      query("npm", ["view", name, "dist.integrity", "--json"])
        ? "PUBLIC"
        : "not published",
    );
  }
  report("Homebrew", () => {
    const pulls = query("gh", [
      "api",
      `repos/IvoryHeart/homebrew-tap/pulls?state=all&head=IvoryHeart:release/herdr-world-v${version}&base=main`,
    ]);
    const pull = pulls?.find(
      (item) =>
        item.head.repo?.full_name === "IvoryHeart/homebrew-tap" &&
        item.head.ref === `release/herdr-world-v${version}`,
    );
    if (pull)
      return `${pull.merged_at ? "MERGED" : `PR ${pull.state}`} (${pull.html_url}); tap merge requires independent review`;
    const branch = query("gh", [
      "api",
      `repos/IvoryHeart/homebrew-tap/git/ref/heads/release/herdr-world-v${version}`,
    ]);
    return branch ? "public branch exists; PR not opened" : "not proposed";
  });
  lines.push(
    "",
    "If any publish job failed, finish the remaining channels from this run's retained verified bundle, without rebuilding:",
    "",
    "```bash",
    `gh run rerun ${run} --failed --repo ${repository}`,
    "```",
    "",
    "Use Re-run failed jobs only. Do not re-run all jobs. Retained artifacts expire after 30 days.",
  );
}
if (process.env.BUNDLE_DIGEST)
  lines.push("", `Verified artifact SHA-256: ${process.env.BUNDLE_DIGEST}`);
const summary = `## Release ${version ?? "(validation failed)"}\n\n${lines.join("\n")}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
