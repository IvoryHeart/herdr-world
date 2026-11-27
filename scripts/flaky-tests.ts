import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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
const INDEX_LABEL = "flaky-accounting";
const INDEX_MARKER = /<!-- flaky-accounting-v1: (.+) -->/;
const TRACKING_REQUEST_LIMIT = 80;
const TRACKING_RUN_LIMIT = 8;
type AccountingIndex = {
  number: number;
  body: string;
  receipts: Map<number, number>;
  after: number;
};
type AccountingStatus = { context: string; description: string; state: string };

async function sourceRun(api: GitHubAPI, repo: string, run: number) {
  assert(Number.isSafeInteger(run) && run > 0, "Invalid source run");
  const source = (await api(`actions/runs/${run}`)) as SourceRun;
  validateSource(source, repo);
  return source;
}

function validateSource(source: SourceRun, repo: string) {
  assert(
    source.path === ".github/workflows/ci.yml" &&
      /^[a-f0-9]{40}$/.test(source.head_sha) &&
      Number.isSafeInteger(source.id) &&
      source.id > 0 &&
      Number.isSafeInteger(source.run_attempt) &&
      source.run_attempt > 0 &&
      Number.isFinite(Date.parse(source.created_at)),
    "Unexpected source workflow",
  );
  assert(
    source.head_repository?.full_name === repo,
    "Unexpected source repository",
  );
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
  if (pending) {
    const statuses = await accountingStatuses(api, source.head_sha);
    const newer = statuses.some(
      (status) =>
        Number(/Flaky history run (\d+)/.exec(status.description || "")?.[1]) >
        run,
    );
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
  const blocked = await recordTracking(api, repo, reports, source, now);
  assert(
    !blocked.length,
    `Flaky frequency limit exceeded: ${blocked.map((item) => `#${item.issue}`).join(", ")}`,
  );
}

async function recordTracking(
  api: GitHubAPI,
  repo: string,
  reports: FlakeReport[],
  source: SourceRun,
  now: string,
) {
  const { id: run, run_attempt: attempt } = source;
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
  return blocked;
}

async function accountingIndex(api: GitHubAPI): Promise<AccountingIndex> {
  const issues = (await api(
    `issues?labels=${INDEX_LABEL}&state=open&per_page=100`,
  )) as FlakyIssue[];
  assert(Array.isArray(issues), "Missing accounting index");
  const existing = issues.find((issue) => INDEX_MARKER.test(issue.body));
  if (existing) {
    const { receipts: entries, after } = JSON.parse(
      INDEX_MARKER.exec(existing.body)![1]!,
    );
    assert(
      Array.isArray(entries) && Number.isSafeInteger(after) && after >= 0,
      "Invalid accounting index",
    );
    for (const entry of entries)
      assert(
        Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((value) => Number.isSafeInteger(value) && value > 0),
        "Invalid accounting receipt",
      );
    return { ...existing, receipts: new Map(entries), after };
  }
  await api("labels", {
    name: INDEX_LABEL,
    color: "EDEDED",
    description: "Trusted CI accounting receipt cache",
  });
  const body =
    'Trusted CI accounting receipt cache. Rebuilding it replays retained evidence idempotently.\n\n<!-- flaky-accounting-v1: {"receipts":[],"after":0} -->';
  const created = (await api("issues", {
    title: "CI flaky accounting receipts",
    body,
    labels: [INDEX_LABEL],
  })) as FlakyIssue;
  return { ...created, body, receipts: new Map(), after: 0 };
}

async function saveAccountingIndex(api: GitHubAPI, index: AccountingIndex) {
  const body = index.body.replace(
    INDEX_MARKER,
    `<!-- flaky-accounting-v1: ${JSON.stringify({ receipts: [...index.receipts], after: index.after })} -->`,
  );
  assert(body.length < 65000, "Accounting index exceeds GitHub body limit");
  await api(`issues/${index.number}`, { body });
  index.body = body;
}

/** Bounded reconciliation; the issue index caches durable attempt receipts. @internal */
export async function catchUpTracking(
  api: GitHubAPI,
  repo: string,
  run: number,
  loadReports: (run: number, api: GitHubAPI) => Promise<FlakeReport[]>,
  now = new Date().toISOString(),
) {
  let requests = 0;
  const boundedAPI: GitHubAPI = (path, body) => {
    assert(
      requests++ < TRACKING_REQUEST_LIMIT,
      "Accounting request budget reached",
    );
    return api(path, body);
  };
  // Reject an untrusted trigger before history, discovery or artifact reads.
  const trigger = await sourceRun(boundedAPI, repo, run);
  const index = await accountingIndex(boundedAPI);
  const errors: unknown[] = [];
  let processed = 0;
  const statusCache = new Map<string, AccountingStatus[]>();
  const account = async (source: SourceRun, advance = false) => {
    if (
      source.conclusion === null ||
      index.receipts.get(source.id) === source.run_attempt ||
      processed >= TRACKING_RUN_LIMIT
    )
      return;
    processed++;
    try {
      validateSource(source, repo);
      // Cache loss must not resurrect an owner-closed flaky cause: existing
      // durable status receipts acknowledge its original history writes.
      let statuses = statusCache.get(source.head_sha);
      if (!statuses) {
        statuses = await accountingStatuses(boundedAPI, source.head_sha);
        statusCache.set(source.head_sha, statuses);
      }
      const recorded = statuses.some(
        (status) =>
          status.state !== "pending" &&
          status.description.startsWith(receipt(source.id, source.run_attempt)),
      );
      if (!recorded) {
        const reports = await loadReports(source.id, boundedAPI);
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `\n## CI run ${source.id}\n${flakeSummary(reports)}`,
          );
        const blocked = await recordTracking(
          boundedAPI,
          repo,
          reports,
          source,
          now,
        );
        if (blocked.length)
          errors.push(new Error("Flaky frequency limit exceeded"));
      }
      // History/status precede the cache acknowledgement. Lost replies replay
      // idempotently, including a final advisory frequency failure.
      index.receipts.set(source.id, source.run_attempt);
    } catch (error) {
      errors.push(error);
    }
    // Rotate failed batches too, so unavailable artifacts cannot pin catch-up.
    if (advance) index.after = source.id;
    try {
      await saveAccountingIndex(boundedAPI, index);
    } catch (error) {
      index.receipts.delete(source.id);
      errors.push(error);
    }
  };
  // Always prioritize the event, even during a cold-start backlog.
  await account(trigger);
  const since = new Date(Date.parse(now) - 7 * 86400_000).toISOString();
  const runs = new Map<number, SourceRun>();
  for (let page = 1; ; page++) {
    const batch = (await boundedAPI(
      `actions/workflows/ci.yml/runs?status=completed&created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
    )) as { workflow_runs: SourceRun[] };
    assert(Array.isArray(batch.workflow_runs), "Missing completed CI runs");
    if (!batch.workflow_runs.length) break;
    for (const source of batch.workflow_runs)
      if (source.head_repository?.full_name === repo)
        runs.set(source.id, source);
  }
  // Metadata discovery costs one request per page, including short pages. Settled
  // runs need no per-run or per-commit GET. Drain oldest missed evidence first.
  const ordered = [...runs.values()].sort((a, b) => a.id - b.id);
  const pending = [
    ...ordered.filter((source) => source.id > index.after),
    ...ordered.filter((source) => source.id <= index.after),
  ];
  for (const source of pending)
    if (source.id !== run) await account(source, true);
  // This is a rebuildable cache of the retained evidence, not flaky history.
  // Occurrence ledgers and commit-status receipts are never trimmed.
  const retained = new Set([run, ...runs.keys()]);
  if ([...index.receipts.keys()].some((id) => !retained.has(id))) {
    for (const id of index.receipts.keys())
      if (!retained.has(id)) index.receipts.delete(id);
    await saveAccountingIndex(boundedAPI, index);
  }
  if (errors.length)
    throw new AggregateError(errors, "Flaky accounting needs attention");
}

async function downloadReports(api: GitHubAPI, run: number) {
  const reports: FlakeReport[] = [];
  for (let page = 1; ; page++) {
    const batch = (await api(
      `actions/runs/${run}/artifacts?per_page=100&page=${page}`,
    )) as { artifacts: Array<{ id: number; name: string; expired: boolean }> };
    assert(Array.isArray(batch.artifacts), "Missing source artifacts");
    for (const artifact of batch.artifacts.filter((item) =>
      item.name.startsWith("flaky-tests-"),
    )) {
      assert(!artifact.expired, `Expired flaky evidence for run ${run}`);
      assert(
        Number.isSafeInteger(artifact.id) && artifact.id > 0,
        "Invalid artifact identity",
      );
      // Download through the same budget as discovery/history/status calls.
      // Decode JSON members as data without extracting candidate archive paths.
      const archive = (await api(
        `actions/artifacts/${artifact.id}/zip`,
      )) as Uint8Array;
      const child = Bun.spawn(
        [
          "python3",
          "-c",
          `
import io, json, sys, zipfile
reports = []
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    for item in archive.infolist():
        if item.is_dir() or not item.filename.endswith(".json"):
            continue
        if item.file_size > 5_000_000:
            raise ValueError("Oversized flake report")
        reports.append(json.loads(archive.read(item)))
if not reports:
    raise ValueError("Missing flaky reports")
json.dump(reports, sys.stdout)
`,
        ],
        { stdin: archive, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      assert(
        code === 0,
        `Cannot read flaky evidence for run ${run}: ${stderr}`,
      );
      reports.push(...JSON.parse(stdout).map(validateReport));
    }
    if (batch.artifacts.length < 100) return reports;
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
    return path.endsWith("/zip")
      ? new Uint8Array(await response.arrayBuffer())
      : response.json();
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
    await catchUpTracking(
      api,
      repo,
      Number(process.env.SOURCE_RUN),
      (run, boundedAPI) => downloadReports(boundedAPI, run),
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
