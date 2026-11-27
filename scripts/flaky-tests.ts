import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FlakeReport } from "./test-retry";
import {
  addOccurrence,
  blockedFlakes,
  FLAKY,
  flakeSummary,
  issueBody,
  ledgerOf,
  markdown,
  testKey,
  validateReport,
  type FlakyIssue,
  type Occurrence,
} from "./flaky-test-policy";

/** @internal */
export type GitHubAPI = (path: string, body?: unknown) => Promise<unknown>;

const ACCOUNTING = "Flaky accounting";
type SourceRun = {
  id: number;
  path: string;
  head_sha: string;
  head_repository?: { full_name?: string } | null;
  created_at: string;
  conclusion: string | null;
  run_attempt: number;
};
type AccountingStatus = { context: string; description: string; state: string };

async function sourceRun(api: GitHubAPI, repo: string, run: number) {
  assert(Number.isSafeInteger(run) && run > 0, "Invalid source run");
  const source = (await api(`actions/runs/${run}`)) as SourceRun;
  assert(
    source.path === ".github/workflows/ci.yml" &&
      /^[a-f0-9]{40}$/.test(source.head_sha),
    "Unexpected source workflow",
  );
  assert(
    source.head_repository?.full_name === repo,
    "Unexpected source repository",
  );
  return source;
}

async function accountingStatuses(api: GitHubAPI, sha: string) {
  const statuses: AccountingStatus[] = [];
  for (let page = 1; ; page++) {
    const batch = (await api(
      `commits/${sha}/statuses?per_page=100&page=${page}`,
    )) as AccountingStatus[];
    assert(Array.isArray(batch), "Missing accounting statuses");
    statuses.push(...batch.filter((status) => status.context === ACCOUNTING));
    if (batch.length < 100) return statuses;
  }
}

const receipt = (run: number, attempt: number) =>
  `Flaky history run ${run} attempt ${attempt}:`;

async function openFlakyIssues(api: GitHubAPI): Promise<FlakyIssue[]> {
  const issues: FlakyIssue[] = [];
  for (let page = 1; ; page++) {
    const batch = (await api(
      `issues?labels=${FLAKY}&state=open&per_page=100&page=${page}`,
    )) as FlakyIssue[];
    assert(Array.isArray(batch), "Missing issue history");
    issues.push(...batch);
    if (batch.length < 100) return issues;
  }
}

/** Serialized by the trusted workflow; repeated deliveries add one run at most. @internal */
export async function trackFlakes(
  api: GitHubAPI,
  repo: string,
  reports: FlakeReport[],
  occurrence: Occurrence,
): Promise<FlakyIssue[]> {
  const issues = await openFlakyIssues(api);
  const tests = new Map(
    reports
      .flatMap((report) => report.flaky)
      .map((test) => [testKey(test), test]),
  );
  if (tests.size) {
    // Creating an existing label returns 422. The API adapter handles that one case.
    await api("labels", {
      name: FLAKY,
      color: "FBCA04",
      description: "Test passed only on its in-job retry",
    });
  }
  for (const [key, test] of tests) {
    const existing = issues.find((issue) => {
      const ledger = ledgerOf(issue.body);
      return ledger && testKey(ledger.test) === key;
    });
    const ledger = addOccurrence(
      existing ? ledgerOf(existing.body)! : { test, occurrences: [] },
      occurrence,
    );
    const body = issueBody(ledger, repo, existing?.body);
    assert(
      body.length < 65000,
      "Flaky issue history exceeds GitHub body limit",
    );
    if (existing) {
      if (body !== existing.body)
        await api(`issues/${existing.number}`, { body });
      existing.body = body;
    } else {
      const created = (await api("issues", {
        title: `Flaky: ${test.file} — ${test.name}`.slice(0, 250),
        body,
        labels: [FLAKY],
      })) as FlakyIssue;
      issues.push({ ...created, body, labels: [{ name: FLAKY }] });
    }
  }
  return issues;
}

/** @internal */
export function readFlakeReports(directory: string): FlakeReport[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (file): FlakeReport[] => {
      const path = join(directory, file.name);
      if (file.isDirectory()) return readFlakeReports(path);
      if (!file.name.endsWith(".json")) return [];
      assert(file.isFile(), "Invalid flake report file");
      const text = readFileSync(path, "utf8");
      assert(text.length <= 5_000_000, "Oversized flake report");
      return [validateReport(JSON.parse(text))];
    },
  );
}

/** Trusted advisory accounting; merge verdicts belong to the source Delivery job. @internal */
export async function publishTracking(
  api: GitHubAPI,
  repo: string,
  reports: FlakeReport[],
  run: number,
  attempt: number,
  pending = false,
  now = new Date().toISOString(),
) {
  const source = await sourceRun(api, repo, run);
  assert(source.run_attempt === attempt, "Source attempt superseded");
  const statuses = await accountingStatuses(api, source.head_sha);
  const newer = statuses.some(
    (status) =>
      Number(/Flaky history run (\d+)/.exec(status.description || "")?.[1]) >
      run,
  );
  if (pending) {
    // A very short run may have completed before this requested event ran.
    if (source.conclusion === null && !newer)
      await api(`statuses/${source.head_sha}`, {
        context: ACCOUNTING,
        state: "pending",
        description: `${receipt(run, attempt)} awaiting trusted accounting`,
        target_url: `https://github.com/${repo}/actions/runs/${run}`,
      });
    return;
  }
  const occurrence = { run, at: source.created_at };
  const issues = await trackFlakes(api, repo, reports, occurrence);
  const blocked = blockedFlakes(issues, reports, occurrence, now);
  // Every completed attempt gets a durable receipt, even if a newer run on this
  // SHA was accounted first. This optional status never changes the merge gate.
  await api(`statuses/${source.head_sha}`, {
    context: ACCOUNTING,
    state:
      source.conclusion === "success" && !blocked.length
        ? "success"
        : "failure",
    description: `${receipt(run, attempt)} ${blocked.length ? "frequency limit exceeded" : source.conclusion === "success" ? "recorded" : "source run failed"}`,
    target_url: `https://github.com/${repo}/actions/runs/${run}`,
  });
  assert(
    !blocked.length,
    `Flaky frequency limit exceeded: ${blocked.map((item) => `#${item.issue}`).join(", ")}`,
  );
}

/** Reconcile retained completed runs; final statuses acknowledge durable issue writes. @internal */
export async function catchUpTracking(
  api: GitHubAPI,
  repo: string,
  run: number,
  loadReports: (run: number) => Promise<FlakeReport[]>,
  now = new Date().toISOString(),
) {
  // Reject an untrusted trigger before even discovering other runs or artifacts.
  await sourceRun(api, repo, run);
  const since = new Date(Date.parse(now) - 7 * 86400_000).toISOString();
  const runs = new Set([run]);
  for (let page = 1; ; page++) {
    const batch = (await api(
      `actions/workflows/ci.yml/runs?status=completed&created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
    )) as { workflow_runs: SourceRun[] };
    assert(Array.isArray(batch.workflow_runs), "Missing completed CI runs");
    for (const source of batch.workflow_runs)
      if (source.head_repository?.full_name === repo) runs.add(source.id);
    if (batch.workflow_runs.length < 100) break;
  }
  const errors: unknown[] = [];
  for (const id of [...runs].sort((a, b) => a - b)) {
    try {
      const source = await sourceRun(api, repo, id);
      if (source.conclusion === null) continue;
      const statuses = await accountingStatuses(api, source.head_sha);
      if (
        statuses.some(
          (status) =>
            status.state !== "pending" &&
            status.description.startsWith(receipt(id, source.run_attempt)),
        )
      )
        continue;
      const reports = await loadReports(id);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n## CI run ${id}\n${flakeSummary(reports)}`,
        );
      await publishTracking(
        api,
        repo,
        reports,
        id,
        source.run_attempt,
        false,
        now,
      );
    } catch (error) {
      // A bad/missing artifact must not starve other completed runs. No receipt
      // is written on interruption, so the next completion retries the work.
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Flaky accounting needs attention");
}

async function downloadReports(api: GitHubAPI, repo: string, run: number) {
  let found = false;
  for (let page = 1; ; page++) {
    const batch = (await api(
      `actions/runs/${run}/artifacts?per_page=100&page=${page}`,
    )) as { artifacts: Array<{ name: string; expired: boolean }> };
    assert(Array.isArray(batch.artifacts), "Missing source artifacts");
    for (const artifact of batch.artifacts.filter((item) =>
      item.name.startsWith("flaky-tests-"),
    )) {
      assert(!artifact.expired, `Expired flaky evidence for run ${run}`);
      found = true;
    }
    if (batch.artifacts.length < 100) break;
  }
  // Runs that failed before reaching tests have no recovery evidence.
  if (!found) return [];
  const directory = mkdtempSync(join(tmpdir(), "flaky-accounting-"));
  try {
    const child = Bun.spawn(
      [
        "gh",
        "run",
        "download",
        String(run),
        "--repo",
        repo,
        "--pattern",
        "flaky-tests-*",
        "--dir",
        directory,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    assert(
      code === 0,
      `Cannot download flaky evidence for run ${run}: ${stderr}`,
    );
    const reports = readFlakeReports(directory);
    assert(reports.length, `Missing flaky reports for run ${run}`);
    return reports;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function run() {
  const repo = process.env.GITHUB_REPOSITORY!;
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo), "Missing repository");
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  assert(token, "Missing GitHub token for flaky history");
  const api: GitHubAPI = async (path, body) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/${path}`,
      {
        method:
          body === undefined
            ? "GET"
            : path.startsWith("issues/")
              ? "PATCH"
              : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (path === "labels" && response.status === 422) return undefined;
    assert(response.ok, `Flaky history API failed (${response.status})`);
    return response.json();
  };
  if (process.argv[2] === "gate") {
    const reports = readFlakeReports(".agents/delivery/flakes");
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, flakeSummary(reports));
    const selection = JSON.parse(process.env.HERDR_CI_SELECTION || "null");
    if (selection) {
      const inventory = validateReport({
        files: [...selection.unit, ...selection.world, ...selection.web],
        flaky: [],
      });
      mkdirSync(".agents/delivery/flakes", { recursive: true });
      // Reused evidence still selects files: an open breached cause cannot be
      // made green by a metadata-only run without executing tests again.
      writeFileSync(
        `.agents/delivery/flakes/inventory-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
        JSON.stringify(inventory),
      );
    }
    if (
      selection &&
      !["reuse", "hold"].includes(process.env.VALIDATION_MODE || "")
    ) {
      const files = new Set(reports.flatMap((report) => report.files));
      for (const file of [
        ...selection.unit,
        ...selection.world,
        ...selection.web,
      ])
        assert(files.has(file), `Missing test retry evidence: ${file}`);
    }
    if (selection)
      reports.push({
        files: [...selection.unit, ...selection.world, ...selection.web],
        flaky: [],
      });
    if (!reports.some((report) => report.files.length)) return;
    const occurrence = {
      run: Number(process.env.GITHUB_RUN_ID),
      at: new Date().toISOString(),
    };
    const blocked = blockedFlakes(
      await openFlakyIssues(api),
      reports,
      occurrence,
    );
    const message = blocked
      .map(
        (item) =>
          `${markdown(item.test.file)} — ${markdown(item.test.name)}: ${item.runs} flaky runs in a 7-day window (#${item.issue})`,
      )
      .join("\n");
    if (message && process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\nFrequency limit exceeded:\n\n${message}\n`,
      );
    assert(!blocked.length, message);
    return;
  }
  assert(
    ["track", "pending"].includes(process.argv[2]!),
    "Use gate, pending or track",
  );
  if (process.argv[2] === "track") {
    await catchUpTracking(api, repo, Number(process.env.SOURCE_RUN), (run) =>
      downloadReports(api, repo, run),
    );
    return;
  }
  await publishTracking(
    api,
    repo,
    [],
    Number(process.env.SOURCE_RUN),
    Number(process.env.SOURCE_ATTEMPT),
    process.argv[2] === "pending",
  );
}

if (import.meta.main) await run();
