import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolveNextVersion, parseManifestVersion } from "./prepare-release";

const repository = "IvoryHeart/herdr-world";
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.[1-9]\d*)?$/;
const marker = /<!-- daily-patch-release (\{[^\n]+\}) -->/;
export type Publication =
  | "missing"
  | "pending"
  | "success"
  | "failure"
  | "blocked";
export type Decision = {
  action: "none" | "prepare" | "publish";
  version: string;
  reason: string;
  pull?: ReleasePull;
};

export function unreleasedChanges(changelog: string): string {
  const match = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/m.exec(
    changelog,
  );
  assert(match, "Missing Unreleased changelog section");
  // Standing known issues alone must never generate an otherwise empty release.
  return match[1]!
    .replace(/^### Known issues\s*\n[\s\S]*?(?=^### |$(?![\s\S]))/gim, "")
    .trim();
}

export function dailyDecision(input: {
  current: string;
  latest: string;
  changes: boolean;
  openRelease: boolean;
  publication: Publication;
}): Decision {
  const none = (reason: string): Decision => ({
    action: "none",
    version: input.current,
    reason,
  });
  assert(stable.test(input.latest), "Latest published release must be stable");
  if (!stable.test(input.current)) return none("Prereleases remain manual");
  if (input.publication === "pending")
    return none("Current publication is still running");
  if (input.publication === "blocked")
    return none(
      "Cancelled or indeterminate publication needs operator attention",
    );
  if (input.current !== input.latest) {
    if (input.current !== resolveNextVersion(input.latest, "patch"))
      return none(
        "Pending minor/major or nonconsecutive version remains manual",
      );
    return {
      action: "publish",
      version: input.current,
      reason: "Reviewed patch is awaiting publication",
    };
  }
  if (input.publication === "failure")
    return {
      action: "publish",
      version: input.current,
      reason:
        "Finish the existing publication before preparing another version",
    };
  if (input.publication !== "success")
    return none(
      "Published version has no successful Release workflow evidence",
    );
  if (input.openRelease) return none("An existing release PR owns preparation");
  if (!input.changes) return none("No unreleased changes");
  return {
    action: "prepare",
    version: resolveNextVersion(input.current, "patch"),
    reason: "Prepare one reviewed patch release",
  };
}

export type ReleasePull = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  user: { login: string };
  base: { ref: string };
  head: { sha: string; ref: string; repo: { full_name: string } | null };
};

export function reviewedReleasePull(
  pulls: ReleasePull[],
  sha: string,
  version: string,
  automatic: boolean,
): ReleasePull {
  assert(/^[a-f0-9]{40}$/.test(sha), "Invalid release SHA");
  const matches = pulls.filter(
    (pr) =>
      pr.merged_at &&
      pr.merge_commit_sha === sha &&
      pr.base.ref === "main" &&
      pr.head.repo?.full_name === repository,
  );
  assert.equal(
    matches.length,
    1,
    "Release commit must belong to one merged release PR",
  );
  const pr = matches[0]!;
  if (automatic) {
    assert(
      stable.test(version),
      "Automatic publication supports stable patches only",
    );
    assert.equal(
      pr.user.login,
      "github-actions[bot]",
      "Manually prepared releases must be published manually",
    );
    const match = marker.exec(pr.body ?? "");
    assert(match, "Missing daily patch preparation record");
    const record = JSON.parse(match[1]!) as { from: string; version: string };
    assert(stable.test(record.from), "Invalid daily release baseline");
    assert.equal(
      record.version,
      version,
      "Preparation record has another version",
    );
    assert.equal(
      resolveNextVersion(record.from, "patch"),
      version,
      "Automatic publication cannot advance minor or major",
    );
  }
  return pr;
}

export function stableNotes(
  version: string,
  changes: string,
  upstream: string,
  knownIssues: string,
): string {
  assert(stable.test(version), "Daily notes require a stable version");
  assert(/^[-*] /m.test(changes), "No release changes to describe");
  const source = /Roamgate source: (v[\d.]+), `([a-f0-9]{40})`/.exec(upstream);
  const runtime = /Herdr compatibility: Herdr ([\d.]+)/.exec(upstream);
  assert(source && runtime, "Missing exact source/runtime lineage");
  const known = knownIssues.replace(/^# [^\n]+\n/, "").trim();
  return `# Herdr World ${version}\n\nDerived from Roamgate ${source[1]} at \`${source[2]}\`; compatible with Herdr ${runtime[1]}. Herdr remains a separate runtime.\n\n## Changes\n\n${changes}\n\n## Upgrade\n\nUse your existing installation channel and preserve World configuration. See the [deployment guide](https://github.com/${repository}/blob/v${version}/docs/DEPLOYMENT.md) for upgrade, authentication and plugin guidance. Homebrew availability follows review and merge of its tap PR.\n${known ? `\n## Known issues\n\n${known}\n` : ""}`;
}

function command(name: string, args: string[]): string {
  return execFileSync(name, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}
const git = (...args: string[]) => command("git", args);
function api<T>(path: string): T {
  return JSON.parse(command("gh", ["api", `repos/${repository}/${path}`])) as T;
}
function list<T>(path: string): T[] {
  return (
    JSON.parse(
      command("gh", [
        "api",
        `repos/${repository}/${path}`,
        "--paginate",
        "--slurp",
      ]),
    ) as T[][]
  ).flat();
}
function output(name: string, value: string): void {
  assert(!/[\r\n]/.test(value), "Invalid workflow output");
  assert(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function summary(message: string): void {
  console.info(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}
type ReleaseRun = {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
};
function publication(version: string): {
  state: Publication;
  run?: ReleaseRun;
} {
  const result = api<{ workflow_runs: ReleaseRun[] }>(
    `actions/workflows/release.yml/runs?branch=v${version}&per_page=1`,
  );
  const run = result.workflow_runs[0];
  if (!run) return { state: "missing" };
  if (run.status !== "completed") return { state: "pending", run };
  return {
    state:
      run.conclusion === "success"
        ? "success"
        : run.conclusion === "failure"
          ? "failure"
          : "blocked",
    run,
  };
}
function currentVersion(): string {
  return parseManifestVersion(readFileSync("herdr-plugin.toml", "utf8"));
}
function plan(): Decision {
  const current = currentVersion();
  const latest = api<{ tag_name: string }>("releases/latest").tag_name.replace(
    /^v/,
    "",
  );
  const pulls = list<ReleasePull>("pulls?state=open&base=main&per_page=100");
  const releasePulls = pulls.filter(
    (pr) =>
      pr.head.repo?.full_name === repository &&
      (pr.head.ref.startsWith("release/") ||
        /^Release\s+\d+\.\d+\.\d+\b/i.test(pr.title)),
  );
  const decision = dailyDecision({
    current,
    latest,
    changes: /^[-*] /m.test(
      unreleasedChanges(readFileSync("CHANGELOG.md", "utf8")),
    ),
    publication: publication(current).state,
    openRelease: releasePulls.length > 0,
  });
  if (
    decision.action === "none" &&
    decision.reason === "An existing release PR owns preparation" &&
    releasePulls.length === 1
  ) {
    const pr = releasePulls[0]!;
    const target = resolveNextVersion(current, "patch");
    if (rollingPull(pr, current, target)) {
      const review = pullStatus(pr.number);
      if (review.reviewDecision === "APPROVED") {
        summary(
          `none: #${pr.number} is approved; leave its reviewed head ready to merge`,
        );
        return {
          action: "none",
          version: target,
          reason: "Approved release is frozen",
        };
      }
      const comparison = api<{ ahead_by: number }>(
        `compare/${pr.head.sha}...${git("rev-parse", "origin/main")}`,
      );
      if (comparison.ahead_by > 0) {
        const refresh: Decision = {
          action: "prepare",
          version: target,
          reason: `Refresh existing release PR #${pr.number}`,
          pull: pr,
        };
        summary(`${refresh.action}: ${target} — ${refresh.reason}`);
        return refresh;
      }
      summary(`none: #${pr.number} already includes current main`);
      return {
        action: "none",
        version: target,
        reason: "Release PR is current",
      };
    }
  }
  summary(`${decision.action}: ${decision.version} — ${decision.reason}`);
  return decision;
}
export function rollingPull(
  pr: ReleasePull,
  from: string,
  version: string,
): boolean {
  if (
    pr.merged_at ||
    pr.user.login !== "github-actions[bot]" ||
    pr.base.ref !== "main" ||
    pr.head.repo?.full_name !== repository ||
    pr.head.ref !== `release/v${version}`
  )
    return false;
  const match = marker.exec(pr.body ?? "");
  if (!match) return false;
  try {
    const record = JSON.parse(match[1]!);
    return (
      record.from === from &&
      record.version === version &&
      resolveNextVersion(from, "patch") === version
    );
  } catch {
    return false;
  }
}

type PullStatus = { state: string; headRefOid: string; reviewDecision: string };
function pullStatus(number: number): PullStatus {
  return JSON.parse(
    command("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "state,headRefOid,reviewDecision",
    ]),
  ) as PullStatus;
}

function ownedPreparation(pr: ReleasePull): boolean {
  git("fetch", "origin", `refs/heads/${pr.head.ref}`);
  assert.equal(
    git("rev-parse", "FETCH_HEAD"),
    pr.head.sha,
    "Release branch changed during preparation; retry later",
  );
  const emails = git(
    "log",
    "--first-parent",
    "--format=%ae",
    `origin/main..${pr.head.sha}`,
  ).split("\n");
  if (
    !emails.length ||
    emails.some(
      (email) =>
        email !== "41898282+github-actions[bot]@users.noreply.github.com",
    )
  ) {
    summary(
      `none: #${pr.number} has human-authored branch changes; preserve them for manual preparation`,
    );
    return false;
  }
  return true;
}

function releaseCommit(version: string): string {
  for (const sha of git(
    "rev-list",
    "--first-parent",
    "origin/main",
    "--",
    "herdr-plugin.toml",
  ).split("\n")) {
    if (
      parseManifestVersion(git("show", `${sha}:herdr-plugin.toml`)) !== version
    )
      continue;
    const parents = git("rev-list", "--parents", "-n", "1", sha).split(" ");
    if (
      !parents[1] ||
      parseManifestVersion(git("show", `${parents[1]}:herdr-plugin.toml`)) !==
        version
    )
      return sha;
  }
  throw new Error(`No release commit for ${version} on main`);
}

function publicationPlan(): void {
  const version = process.env.VERSION ?? "";
  const automatic = process.env.AUTOMATIC === "true";
  assert(versionPattern.test(version), "Invalid publication version");
  if (automatic) {
    const decision = plan();
    if (decision.action !== "publish" || decision.version !== version) {
      output("mode", "none");
      return;
    }
  }
  const sha = releaseCommit(version);
  const pulls = list<ReleasePull>(`commits/${sha}/pulls?per_page=100`);
  const pr = reviewedReleasePull(pulls, sha, version, false);
  if (
    automatic &&
    (pr.user.login !== "github-actions[bot]" || !marker.test(pr.body ?? ""))
  ) {
    output("mode", "none");
    summary(
      `${version} was prepared manually; publish it through the manual path`,
    );
    return;
  }
  if (automatic) {
    reviewedReleasePull(pulls, sha, version, true);
    assert.equal(
      pr.head.ref,
      `release/v${version}`,
      "Unexpected automatic release branch",
    );
    const record = JSON.parse(marker.exec(pr.body!)![1]!) as { from: string };
    assert.equal(
      parseManifestVersion(git("show", `${sha}^1:herdr-plugin.toml`)),
      record.from,
      "Reviewed baseline differs from the preparation record",
    );
  }
  const checks = JSON.parse(
    command("gh", [
      "pr",
      "checks",
      String(pr.number),
      "--repo",
      repository,
      "--required",
      "--json",
      "bucket",
    ]),
  ) as { bucket: string }[];
  assert(
    checks.length > 0 && checks.every((check) => check.bucket === "pass"),
    "Required release PR checks must pass",
  );
  assert(
    git("show", `${sha}:docs/releases/v${version}.md`).trim(),
    "Missing reviewed release notes",
  );
  for (const path of [
    "package.json",
    "web/package.json",
    "server/package.json",
  ])
    assert.equal(JSON.parse(git("show", `${sha}:${path}`)).version, "0.0.0");
  const tag = `v${version}`;
  const existing = git("tag", "--list", tag);
  if (existing) {
    assert.equal(
      git("cat-file", "-t", `refs/tags/${tag}`),
      "tag",
      "Release tags must be annotated",
    );
    assert.equal(
      git("rev-parse", `${tag}^{commit}`),
      sha,
      "Existing tag belongs to another commit",
    );
  }
  const state = publication(version);
  if (state.run)
    assert.equal(
      state.run.head_sha,
      sha,
      "Release workflow belongs to another revision",
    );
  if (
    state.state === "pending" ||
    state.state === "success" ||
    state.state === "blocked"
  ) {
    output("mode", "none");
    summary(`Keep ${tag}: publication is ${state.state}`);
    return;
  }
  if (state.state === "failure") {
    assert(existing, "Failed publication has no immutable tag");
    assert(
      Number.isSafeInteger(state.run!.id) && state.run!.id > 0,
      "Invalid Release run ID",
    );
    output("mode", "retry");
    output("run_id", String(state.run!.id));
  } else if (existing && automatic) {
    output("mode", "none");
    summary(
      `${tag} exists without a Release run; inspect it and dispatch Publish Release manually rather than creating a duplicate run`,
    );
    return;
  } else output("mode", existing ? "dispatch" : "tag");
  output("sha", sha);
  output("tag", tag);
  output("version", version);
}

function automaticPrepare(): void {
  assert.equal(
    process.env.VERSION_INPUT,
    "patch",
    "Automatic preparation supports patch only",
  );
  const decision = plan();
  if (decision.action !== "prepare") {
    output("ready", "false");
    return;
  }
  const branch = `release/v${decision.version}`;
  if (decision.pull) {
    if (!ownedPreparation(decision.pull)) {
      output("ready", "false");
      return;
    }
    output("pull", String(decision.pull.number));
    output("head", decision.pull.head.sha);
  } else
    assert(
      !git("ls-remote", "origin", `refs/heads/${branch}`),
      "Release branch already exists; inspect or reopen its PR",
    );
  const path = `docs/releases/v${decision.version}.md`;
  if (!existsSync(path))
    writeFileSync(
      path,
      stableNotes(
        decision.version,
        unreleasedChanges(readFileSync("CHANGELOG.md", "utf8")),
        readFileSync("UPSTREAM.md", "utf8"),
        readFileSync("docs/known-issues.md", "utf8"),
      ),
    );
  output("ready", "true");
  output("from", currentVersion());
}

// Validation runs on the freshly prepared main tree. Refresh uses the same tree
// in one normal merge commit, preserving branch ancestry and avoiding force-pushes.
function commitPreparation(): void {
  const version = process.env.VERSION ?? "";
  assert(versionPattern.test(version), "Invalid prepared version");
  const branch = `release/v${version}`;
  const pull = process.env.RELEASE_PR;
  if (!pull) git("checkout", "-b", branch);
  else {
    assert(/^\d+$/.test(pull), "Invalid release PR number");
    const head = process.env.RELEASE_HEAD ?? "";
    assert(/^[a-f0-9]{40}$/.test(head), "Invalid preparation head");
    const review = pullStatus(Number(pull));
    if (
      review.state !== "OPEN" ||
      review.reviewDecision === "APPROVED" ||
      review.headRefOid !== head
    ) {
      output("committed", "false");
      summary(
        "Release PR was approved, closed or changed during validation; preserve it",
      );
      return;
    }
    const paths = [
      "herdr-plugin.toml",
      "CHANGELOG.md",
      `docs/releases/v${version}.md`,
    ];
    const prepared = paths.map((path) => readFileSync(path));
    git("restore", "--staged", "--worktree", "--", ...paths.slice(0, 2));
    if (git("ls-files", paths[2]!))
      git("restore", "--staged", "--worktree", "--", paths[2]!);
    else unlinkSync(paths[2]!);
    git("checkout", "-b", branch, head);
    git("merge", "--no-commit", "--no-ff", "-s", "ours", "origin/main");
    git("restore", "--source", "origin/main", "--staged", "--worktree", ".");
    paths.forEach((path, index) => writeFileSync(path, prepared[index]!));
  }
  git(
    "add",
    "herdr-plugin.toml",
    "CHANGELOG.md",
    `docs/releases/v${version}.md`,
  );
  git(
    "commit",
    "-m",
    pull
      ? `Refresh release ${version} from reviewed main`
      : `Release ${version}`,
  );
  output("committed", "true");
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === "prepare") automaticPrepare();
  else if (mode === "commit-preparation") commitPreparation();
  else if (mode === "publication") publicationPlan();
  else if (mode === "dispatch") {
    const decision = plan();
    if (decision.action === "prepare" && process.env.PUBLISH_ONLY !== "true")
      command("gh", [
        "workflow",
        "run",
        "prepare-release.yml",
        "--repo",
        repository,
        "--ref",
        "main",
        "-f",
        "version=patch",
        "-F",
        "automatic=true",
      ]);
    else if (decision.action === "publish")
      command("gh", [
        "workflow",
        "run",
        "publish-release.yml",
        "--repo",
        repository,
        "--ref",
        "main",
        "-f",
        `version=${decision.version}`,
        "-F",
        "automatic=true",
      ]);
  } else throw new Error("Expected dispatch, prepare or publication");
}
