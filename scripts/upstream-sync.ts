import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

export const upstream = "powerfooI/roamgate";
export const branch = "upstream/roamgate";
const marker = /<!-- upstream-sync (\{[^\n]+\}) -->/;

export type Sync = {
  base: string;
  target: string;
  tag: string;
  repair: number;
  pr?: number;
  head?: string;
};

export function validateSync(value: unknown): Sync {
  const sync = value as Sync;
  if (
    !sync ||
    !/^[a-f0-9]{40}$/.test(sync.base) ||
    !/^[a-f0-9]{40}$/.test(sync.target) ||
    !/^v?\d+\.\d+\.\d+$/.test(sync.tag) ||
    ![0, 1].includes(sync.repair) ||
    (sync.pr !== undefined &&
      (!Number.isSafeInteger(sync.pr) || sync.pr < 1)) ||
    (sync.head !== undefined && !/^[a-f0-9]{40}$/.test(sync.head))
  ) {
    throw new Error("Invalid upstream synchronization metadata");
  }
  return sync;
}

export function parseSync(body: string): Sync {
  const match = body.match(marker);
  if (!match) throw new Error("Missing upstream synchronization metadata");
  return validateSync(JSON.parse(match[1]));
}

export function recordedSource(text: string): string {
  const match = text.match(/Roamgate source:[^\n]*`([a-f0-9]{40})`/);
  if (!match) throw new Error("Missing recorded Roamgate source SHA");
  return match[1];
}

// These paths can alter who approves, what is executed, or what evidence is required.
// Integrations may change them, but require human review and never auto-approval.
export function requiresHumanReview(paths: string[]): boolean {
  return paths.some(
    (path) =>
      /(^|\/)AGENTS\.md$/.test(path) ||
      /^(\.github\/|\.agents\/|\.githooks\/|verification\/|quint\/|tools\/quint\/|openspec\/)/.test(
        path,
      ) ||
      /^(CONTRIBUTING\.md|scripts\/)/.test(path) ||
      /(^|\/)package\.json$/.test(path) ||
      /(^|\/)(tsconfig[^/]*\.json|bunfig\.toml|biome\.jsonc?|\.oxlintrc\.json|[^/]*(?:vitest|jest|playwright|vite)\.config\.[^/]+)$/.test(
        path,
      ) ||
      /^(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|\.gitignore|\.gitmodules)$/.test(
        path,
      ),
  );
}

export function validatePublishPaths(paths: string[]): void {
  if (paths.some((path) => /^(\.github|\.codex)(\/|$)/.test(path))) {
    throw new Error(
      "Workflow or Codex configuration changes require manual integration before any candidate CI executes",
    );
  }
}

export type Verdict = {
  decision: "approve" | "request_changes";
  summary: string;
};
type Review = { state: string; commit_id: string; user?: { login: string } };

export function shouldRepair(
  sync: Sync,
  head: string,
  reviews: Review[],
  ci?: { head_sha: string; status: string; conclusion: string },
): boolean {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      latest.set(review.user?.login ?? "reviewer", review);
    }
  }
  return (
    sync.repair === 0 &&
    ([...latest.values()].some(
      (item) => item.commit_id === head && item.state === "CHANGES_REQUESTED",
    ) ||
      (ci?.head_sha === head &&
        ci.status === "completed" &&
        ci.conclusion === "failure"))
  );
}

export function validateVerdict(value: unknown): Verdict {
  const verdict = value as Verdict;
  if (
    !verdict ||
    !["approve", "request_changes"].includes(verdict.decision) ||
    typeof verdict.summary !== "string" ||
    verdict.summary.trim().length < 20 ||
    verdict.summary.length > 30000
  ) {
    throw new Error("Invalid independent review verdict");
  }
  return verdict;
}

export function validateSubmittedHead(
  submitted: unknown,
  current: string,
): void {
  if (
    typeof submitted !== "string" ||
    submitted !== current ||
    !/^[a-f0-9]{40}$/.test(submitted)
  )
    throw new Error("Submitted review is stale or missing its exact head");
}

function run(command: string, args: string[], input?: string): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).replace(/\n$/, "");
}

function git(...args: string[]): string {
  return run("git", ["-c", "core.hooksPath=/dev/null", ...args]);
}

export function reconstructMerge(
  target: string,
  patch: string,
  cwd = process.cwd(),
): void {
  const execute = (...args: string[]) =>
    run("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args]);
  execute("merge", "--strategy=ours", "--no-commit", "--no-ff", target);
  execute("apply", "--index", patch);
}

function repository(): string {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("Missing repository");
  return repo;
}

export function parseApiResponse<T>(response: string): T {
  // workflow_dispatch returns HTTP 204 with no body; success must not become a retry.
  return (response.trim() ? JSON.parse(response) : undefined) as T;
}

function api<T>(path: string, body?: unknown): T {
  return parseApiResponse<T>(
    run(
      "gh",
      ["api", path, ...(body ? ["--method", "POST", "--input", "-"] : [])],
      body ? JSON.stringify(body) : undefined,
    ),
  );
}

function apiList<T>(path: string): T[] {
  return (
    JSON.parse(run("gh", ["api", path, "--paginate", "--slurp"])) as T[][]
  ).flat();
}

function output(key: string, value: string): void {
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GITHUB_OUTPUT");
  if (/[\r\n]/.test(value)) throw new Error("Multiline workflow output");
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

type Pull = {
  number: number;
  body: string;
  state: string;
  draft: boolean;
  user: { login: string };
  head: { ref: string; sha: string; repo: { full_name: string } };
  base: { ref: string; sha: string; repo: { full_name: string } };
};

export function checkPull(pr: Pull, sync?: Sync, repo = repository()): void {
  if (
    pr.state !== "open" ||
    pr.draft ||
    pr.head.ref !== branch ||
    pr.head.repo.full_name !== repo ||
    pr.base.repo.full_name !== repo ||
    pr.base.ref !== "main" ||
    pr.user.login !== "github-actions[bot]" ||
    (sync?.head && pr.head.sha !== sync.head)
  ) {
    throw new Error("PR identity, state or reviewed revision changed");
  }
}

function fetchTarget(sync: Sync): void {
  git("fetch", "--no-tags", `https://github.com/${upstream}.git`, sync.target);
  git("merge-base", "--is-ancestor", sync.base, "HEAD");
}

function refreshSourceBaseline(sync: Sync): string {
  git("fetch", "origin", "main");
  const main = git("rev-parse", "origin/main");
  if (recordedSource(git("show", `${main}:UPSTREAM.md`)) !== sync.base) {
    throw new Error(
      "Frozen source baseline changed on main; reconcile obsolete upstream work",
    );
  }
  return main;
}

function validateReviewedBase(reviewed: unknown, pr: Pull): string {
  const main = api<{ object: { sha: string } }>(
    `repos/${repository()}/git/ref/heads/main`,
  ).object.sha;
  if (
    typeof reviewed !== "string" ||
    !/^[a-f0-9]{40}$/.test(reviewed) ||
    reviewed !== pr.base.sha ||
    reviewed !== main
  ) {
    throw new Error(
      "The reviewed base changed or is missing; update the branch and obtain fresh CI and independent review",
    );
  }
  return reviewed;
}

export function validateIntegrationReport(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 20 ||
    Buffer.byteLength(value, "utf8") > 12000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) {
    throw new Error(
      "Integration report must contain 20–12000 UTF-8 bytes of readable evidence",
    );
  }
  return value;
}

function bodyFor(sync: Sync): string {
  return (
    `Synchronize Roamgate ${sync.tag} (${sync.target}).\n\n` +
    `The upstream target is frozen until this PR merges or closes. Repair pass: ${sync.repair}/1.\n\n` +
    `Independent Codex review and all protected delivery/platform checks are required. ` +
    `Changes to workflow, agent, verification or script controls require human review.\n\n` +
    `Behavioral evidence: integration follows verification/coverage.json; full CI remains mandatory. ` +
    `See the integration report below for affected contracts and focused evidence.\n\n` +
    `Agent execution: separate ephemeral Codex implementation and review sessions; model defaults; billed cost unknown.\n\n` +
    `<!-- upstream-sync ${JSON.stringify(sync)} -->\n`
  );
}

type Issue = {
  number: number;
  title: string;
  body: string;
  user: { login: string };
  pull_request?: unknown;
};

function trustedBlocker(issue: Issue): boolean {
  return (
    !issue.pull_request &&
    issue.title === "Upstream automation blocked" &&
    ["github-actions[bot]", repository().split("/")[0]].includes(
      issue.user.login,
    )
  );
}

function validateBlockerCreator(): void {
  const login =
    process.env.GITHUB_ACTIONS === "true"
      ? "github-actions[bot]"
      : api<{ login: string }>("user").login;
  if (!["github-actions[bot]", repository().split("/")[0]].includes(login))
    throw new Error(
      "The local worker must sign into GitHub as the repository owner so its failure blockers are recognized",
    );
}
function queueIssues(): Issue[] {
  return apiList<Issue>(`repos/${repository()}/issues?state=open&per_page=100`);
}

function queue(title: string, sync: Sync, extra = ""): void {
  const existing = queueIssues().find(
    (issue) =>
      issue.title === title && issue.user.login === "github-actions[bot]",
  );
  const body = bodyFor(sync) + extra;
  if (existing) {
    if (existing.body !== body)
      run(
        "gh",
        [
          "api",
          `repos/${repository()}/issues/${existing.number}`,
          "--method",
          "PATCH",
          "--input",
          "-",
        ],
        JSON.stringify({ body }),
      );
  } else api(`repos/${repository()}/issues`, { title, body });
}

function closeQueue(title: string): void {
  for (const issue of queueIssues()) {
    if (issue.title === title && issue.user.login === "github-actions[bot]") {
      run(
        "gh",
        [
          "api",
          `repos/${repository()}/issues/${issue.number}`,
          "--method",
          "PATCH",
          "--input",
          "-",
        ],
        JSON.stringify({ state: "closed" }),
      );
    }
  }
}

async function detect(): Promise<void> {
  const repo = repository();
  const issues = queueIssues();
  if (issues.some(trustedBlocker)) {
    console.info(
      "Upstream automation is blocked; resolve and close its tracking issue before retrying.",
    );
    return;
  }
  const pulls = api<Pull[]>(
    `repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}&per_page=100`,
  );
  if (pulls.length > 1)
    throw new Error("Multiple upstream PRs require operator attention");
  let sync: Sync;
  if (pulls.length) {
    const pr = pulls[0];
    checkPull(pr);
    sync = parseSync(pr.body);
    // Never absorb another release into an open PR. At most one repair of this target.
    if (sync.repair === 1) return;
    const reviews = apiList<Review>(
      `repos/${repo}/pulls/${pr.number}/reviews?per_page=100`,
    );
    const runs = api<{
      workflow_runs: Array<{
        head_sha: string;
        status: string;
        conclusion: string;
      }>;
    }>(
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
    ).workflow_runs;
    const ci = runs.find((item) => item.head_sha === pr.head.sha);
    if (!shouldRepair(sync, pr.head.sha, reviews, ci)) return;
    sync = { ...sync, repair: 1, pr: pr.number, head: pr.head.sha };
  } else {
    const release = api<{
      tag_name: string;
      draft: boolean;
      prerelease: boolean;
    }>(`repos/${upstream}/releases/latest`);
    if (release.draft || release.prerelease)
      throw new Error("Expected stable release");
    if (!/^v?\d+\.\d+\.\d+$/.test(release.tag_name))
      throw new Error("Unsupported release tag");
    git(
      "fetch",
      "--no-tags",
      `https://github.com/${upstream}.git`,
      `refs/tags/${release.tag_name}`,
    );
    const target = git("rev-parse", "FETCH_HEAD^{commit}");
    const base = recordedSource(readFileSync("UPSTREAM.md", "utf8"));
    if (target === base) return;
    git("merge-base", "--is-ancestor", base, target);
    sync = { base, target, tag: release.tag_name, repair: 0 };
  }
  validateSync(sync);
  queue("Upstream integration pending", sync);
}

async function prepare(sync: Sync): Promise<void> {
  refreshSourceBaseline(sync);
  fetchTarget(sync);
  mkdirSync(".agents/upstream", { recursive: true });
  if (sync.head) {
    git("fetch", "origin", sync.head);
    git("checkout", "--detach", sync.head);
    const feedback = apiList<Review>(
      `repos/${repository()}/pulls/${sync.pr}/reviews?per_page=100`,
    );
    writeFileSync(".agents/upstream/feedback.json", JSON.stringify(feedback));
    const runs = api<{
      workflow_runs: Array<{
        id: number;
        head_sha: string;
        conclusion: string;
      }>;
    }>(
      `repos/${repository()}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
    ).workflow_runs;
    const failed = runs.find(
      (item) => item.head_sha === sync.head && item.conclusion === "failure",
    );
    if (failed) {
      const logs = run("gh", [
        "run",
        "view",
        String(failed.id),
        "--repo",
        repository(),
        "--log-failed",
      ]);
      writeFileSync(".agents/upstream/ci-failure.log", logs.slice(-40000));
    }
  }
  const start = git("rev-parse", "HEAD");
  writeFileSync(".agents/upstream/start", start);
  if (!sync.head) {
    try {
      git("merge", "--no-commit", "--no-ff", sync.target);
    } catch {
      if (!git("diff", "--name-only", "--diff-filter=U"))
        throw new Error("Upstream merge failed without resolvable conflicts");
    }
  }
}

function exportPatch(sync: Sync): void {
  const report = validateIntegrationReport(
    readFileSync(".agents/upstream/report.md", "utf8"),
  );
  const start = readFileSync(".agents/upstream/start", "utf8");
  if (git("rev-parse", "HEAD") !== start) throw new Error("Agent changed HEAD");
  if (git("diff", "--name-only", "--diff-filter=U"))
    throw new Error("Unresolved merge conflicts");
  if (recordedSource(readFileSync("UPSTREAM.md", "utf8")) !== sync.target)
    throw new Error("UPSTREAM.md must record exact target");
  git("add", "--all");
  const paths = git("diff", "--cached", "--name-only", "-z", start)
    .split("\0")
    .filter(Boolean);
  validatePublishPaths(paths);
  if (!sync.repair && !paths.includes("CHANGELOG.md"))
    throw new Error("Missing changelog entry");
  if (
    paths.some((path) =>
      /^(web\/dist\/|server\/public\/|dist\/|\.pages-dist\/|\.agents\/upstream\/)/.test(
        path,
      ),
    )
  )
    throw new Error("Generated files cannot be published");
  mkdirSync(".agents/upstream/export", { recursive: true });
  writeFileSync(".agents/upstream/export/report.md", report);
  writeFileSync(
    ".agents/upstream/export/candidate.patch",
    git("diff", "--cached", "--binary", "--full-index", start) + "\n",
  );
}

function publishLocal(sync: Sync): void {
  const repo = repository();
  refreshSourceBaseline(sync);
  const report = validateIntegrationReport(
    readFileSync(".agents/upstream/export/report.md", "utf8"),
  );
  fetchTarget(sync);
  if (sync.head) {
    checkPull(api<Pull>(`repos/${repo}/pulls/${sync.pr}`), sync);
    git("fetch", "origin", branch);
    git("checkout", "--detach", sync.head);
  } else {
    const existing = api<Pull[]>(
      `repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`,
    );
    if (existing.length) throw new Error("An upstream PR already exists");
    // Reconstruct the adapted merge tree before the local commit/push hooks run.
    reconstructMerge(sync.target, ".agents/upstream/export/candidate.patch");
  }
  if (sync.head)
    git("apply", "--index", ".agents/upstream/export/candidate.patch");
  validatePublishPaths(
    git("diff", "--cached", "--name-only", "-z", "HEAD")
      .split("\0")
      .filter(Boolean),
  );
  const record = git("show", ":UPSTREAM.md");
  if (recordedSource(record) !== sync.target)
    throw new Error("Candidate source record does not match target");
  run("git", [
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    `Synchronize Roamgate ${sync.tag}${sync.repair ? " review repairs" : ""}`,
  ]);
  run("gh", ["auth", "setup-git"]);
  // A frozen branch is only replaced after the previous PR closed, with an exact lease.
  const remote = git("ls-remote", "origin", `refs/heads/${branch}`).split(
    /\s/,
  )[0];
  if (sync.head && remote !== sync.head)
    throw new Error("Upstream branch advanced during repair");
  run("git", [
    "push",
    `--force-with-lease=refs/heads/${branch}:${sync.head ?? remote}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  ]);
  const published = { ...sync, head: git("rev-parse", "HEAD") };
  api(`repos/${repo}/actions/workflows/upstream-publish.yml/dispatches`, {
    ref: "main",
    inputs: { sync: JSON.stringify(published), report },
  });
}

function publishHead(sync: Sync): void {
  const repo = repository();
  const main = refreshSourceBaseline(sync);
  const report = validateIntegrationReport(process.env.REPORT);
  if (!sync.head) throw new Error("Missing published head");
  git("fetch", "origin", branch);
  if (git("rev-parse", "FETCH_HEAD") !== sync.head)
    throw new Error("Published branch advanced");
  git("merge-base", "--is-ancestor", sync.target, sync.head);
  git("merge-base", "--is-ancestor", main, sync.head);
  const paths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${main}...${sync.head}`,
  )
    .split("\0")
    .filter(Boolean);
  validatePublishPaths(paths);
  if (recordedSource(git("show", `${sync.head}:UPSTREAM.md`)) !== sync.target)
    throw new Error("Published source record differs");
  const body = bodyFor(sync) + "\nIntegration report:\n\n" + report;
  if (sync.pr) {
    const pr = api<Pull>(`repos/${repo}/pulls/${sync.pr}`);
    checkPull(pr, sync);
    const previous = parseSync(pr.body);
    validatePublication(previous, sync);
    run(
      "gh",
      [
        "api",
        `repos/${repo}/pulls/${sync.pr}`,
        "--method",
        "PATCH",
        "--input",
        "-",
      ],
      JSON.stringify({ body }),
    );
  } else {
    const existing = api<Pull[]>(
      `repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`,
    );
    if (existing.length) {
      if (existing.length !== 1) throw new Error("Multiple upstream PRs");
      checkPull(existing[0], sync);
      validatePublication(parseSync(existing[0].body), sync);
      run(
        "gh",
        [
          "api",
          `repos/${repo}/pulls/${existing[0].number}`,
          "--method",
          "PATCH",
          "--input",
          "-",
        ],
        JSON.stringify({ body }),
      );
    } else {
      if (sync.repair !== 0) throw new Error("Cannot repair a missing PR");
      api(`repos/${repo}/pulls`, {
        title: `Synchronize Roamgate ${sync.tag}`,
        head: branch,
        base: "main",
        body,
      });
    }
  }
  run("gh", ["workflow", "run", "ci.yml", "--repo", repo, "--ref", branch]);
  closeQueue("Upstream integration pending");
}

export function validatePublication(previous: Sync, incoming: Sync): void {
  if (
    previous.base !== incoming.base ||
    previous.target !== incoming.target ||
    previous.tag !== incoming.tag ||
    !(
      (previous.repair === 0 && incoming.repair === 1) ||
      (previous.repair === incoming.repair && previous.head === incoming.head)
    )
  ) {
    throw new Error(
      "Frozen target, publication revision or bounded repair changed",
    );
  }
}

async function reviewPlan(): Promise<void> {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"),
  );
  const runId = event.workflow_run?.id ?? Number(event.inputs?.run_id);
  if (!Number.isSafeInteger(runId) || runId < 1)
    throw new Error("Missing CI run ID");
  const repo = repository();
  const ci = api<{
    name: string;
    path: string;
    head_sha: string;
    head_branch: string;
    status: string;
    conclusion: string;
    head_repository: { full_name: string };
  }>(`repos/${repo}/actions/runs/${runId}`);
  if (
    ci.path !== ".github/workflows/ci.yml" ||
    ci.name !== "CI" ||
    ci.head_branch !== branch ||
    ci.head_repository.full_name !== repo ||
    ci.status !== "completed" ||
    ci.conclusion !== "success"
  )
    return;
  const pulls = api<Pull[]>(
    `repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`,
  );
  if (pulls.length !== 1) return;
  const pr = pulls[0];
  checkPull(pr);
  if (pr.head.sha !== ci.head_sha) return;
  if (!event.workflow_run)
    validateSubmittedHead(event.inputs?.head, pr.head.sha);
  const sync = { ...parseSync(pr.body), pr: pr.number, head: pr.head.sha };
  validateSync(sync);
  git("fetch", "origin", sync.head!);
  git("merge-base", "--is-ancestor", sync.target, sync.head!);
  git("fetch", "origin", "main");
  const base = git("rev-parse", "origin/main");
  if (!event.workflow_run) {
    validateReviewedBase(event.inputs?.base, pr);
    if (event.inputs.base !== base)
      throw new Error("The reviewed base changed during validation");
  } else if (pr.base.sha !== base)
    throw new Error("PR comparison base changed while queueing review");
  const paths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${base}...${sync.head}`,
  )
    .split("\0")
    .filter(Boolean);
  output("human", String(requiresHumanReview(paths)));
  output("sync", JSON.stringify(sync));
  output("base", base);
  output("start", "true");
  if (event.workflow_run)
    queue(
      "Upstream review pending",
      sync,
      `\n<!-- upstream-ci ${runId} -->\n<!-- upstream-review-base ${base} -->\n`,
    );
}

function postReview(sync: Sync): void {
  const verdict = validateVerdict(JSON.parse(process.env.VERDICT!));
  const repo = repository();
  const pr = api<Pull>(`repos/${repo}/pulls/${sync.pr}`);
  checkPull(pr, sync);
  const reviewedBase = validateReviewedBase(process.env.REVIEW_BASE, pr);
  const human = process.env.HUMAN_REVIEW === "true";
  api(`repos/${repo}/pulls/${sync.pr}/reviews`, {
    commit_id: sync.head,
    event:
      verdict.decision === "request_changes"
        ? "REQUEST_CHANGES"
        : human
          ? "COMMENT"
          : "APPROVE",
    body: `${verdict.summary}\n\nReviewed revision: ${sync.head}; reviewed base: ${reviewedBase}.${human ? "\nHuman approval required: this integration changes delivery, agent or verification controls." : ""}`,
  });
  if (
    verdict.decision === "approve" &&
    !human &&
    process.env.AUTO_MERGE === "true"
  ) {
    // Branch rules enforce stale-review dismissal, last-push approval and required checks.
    // A merge commit preserves Roamgate ancestry; squash/rebase would lose it.
    output("approved", "true");
  }
}

function localPlan(): void {
  const repo = repository();
  const enabled = api<{ value: string }>(
    `repos/${repo}/actions/variables/UPSTREAM_SYNC_ENABLED`,
  );
  if (enabled.value !== "true")
    throw new Error("Upstream automation is disabled");
  validateBlockerCreator();
  const issues = queueIssues();
  if (issues.some(trustedBlocker))
    throw new Error("Resolve the upstream blocker issue before retrying");
  const pending = issues.filter(
    (issue) =>
      issue.user.login === "github-actions[bot]" &&
      ["Upstream review pending", "Upstream integration pending"].includes(
        issue.title,
      ),
  );
  const fresh = pending.filter((issue) => {
    const sync = parseSync(issue.body);
    if (!sync.pr) return true;
    const pr = api<Pull>(`repos/${repo}/pulls/${sync.pr}`);
    if (
      issue.title === "Upstream review pending" &&
      (pr.state !== "open" || pr.head.sha !== sync.head)
    ) {
      run(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${issue.number}`,
          "--method",
          "PATCH",
          "--input",
          "-",
        ],
        JSON.stringify({ state: "closed" }),
      );
      return false;
    }
    if (pr.state !== "open" || pr.head.sha !== sync.head) return false;
    return true;
  });
  const issue =
    fresh.find((item) => item.title === "Upstream review pending") ?? fresh[0];
  if (!issue) {
    console.info("No upstream work queued.");
    return;
  }
  const sync = parseSync(issue.body);
  if (sync.pr) checkPull(api<Pull>(`repos/${repo}/pulls/${sync.pr}`), sync);
  const kind =
    issue.title === "Upstream review pending" ? "review" : "integrate";
  const runId = Number(issue.body.match(/<!-- upstream-ci (\d+) -->/)?.[1]);
  const reviewBase = issue.body.match(
    /<!-- upstream-review-base ([a-f0-9]{40}) -->/,
  )?.[1];
  if (kind === "review" && (!Number.isSafeInteger(runId) || !reviewBase))
    throw new Error("Invalid review queue metadata");
  mkdirSync(".agents/upstream-local", { recursive: true });
  writeFileSync(
    ".agents/upstream-local/plan.json",
    JSON.stringify({
      kind,
      sync,
      issue: issue.number,
      runId: kind === "review" ? runId : null,
      reviewBase,
    }),
  );
  console.info(
    `Queued ${kind} work written to .agents/upstream-local/plan.json`,
  );
}

function submitReview(sync: Sync): void {
  const verdict = validateVerdict(
    JSON.parse(readFileSync(process.argv[3], "utf8")),
  );
  if (!sync.pr || !sync.head) throw new Error("Missing reviewed PR/head");
  const pr = api<Pull>(`repos/${repository()}/pulls/${sync.pr}`);
  checkPull(pr, sync);
  const base = validateReviewedBase(process.env.REVIEW_BASE, pr);
  const runId = Number(process.env.REVIEW_RUN_ID);
  if (!Number.isSafeInteger(runId) || runId < 1)
    throw new Error("Missing successful CI run");
  api(
    `repos/${repository()}/actions/workflows/upstream-review.yml/dispatches`,
    {
      ref: "main",
      inputs: {
        run_id: String(runId),
        head: sync.head,
        base,
        verdict: JSON.stringify(verdict),
      },
    },
  );
}

function block(): void {
  const title = "Upstream automation blocked";
  if (!queueIssues().some(trustedBlocker)) {
    validateBlockerCreator();
    api(`repos/${repository()}/issues`, {
      title,
      body: "The local Codex worker stopped unsuccessfully. Inspect its local run output, pending queue issues and upstream PR. Resolve the cause and close this issue before starting another worker run. No approval or merge may be assumed.",
    });
  }
}

if (import.meta.main) {
  const mode = process.argv[2];
  const sync = () => validateSync(JSON.parse(process.env.SYNC!));
  if (mode === "detect") await detect();
  else if (mode === "prepare") await prepare(sync());
  else if (mode === "export") exportPatch(sync());
  else if (mode === "publish-local") publishLocal(sync());
  else if (mode === "publish-head") publishHead(sync());
  else if (mode === "review-plan") await reviewPlan();
  else if (mode === "post-review") postReview(sync());
  else if (mode === "close-review") closeQueue("Upstream review pending");
  else if (mode === "local-plan") localPlan();
  else if (mode === "submit-review") submitReview(sync());
  else if (mode === "block") block();
  else throw new Error("Unknown upstream-sync command");
}
