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
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const text = readFileSync(join(directory, file), "utf8");
      assert(text.length <= 5_000_000, "Oversized flake report");
      return validateReport(JSON.parse(text));
    });
}

/** Trusted post-run enforcement; injectable API permits interruption/reordering checks. @internal */
export async function publishTracking(
  api: GitHubAPI,
  repo: string,
  reports: FlakeReport[],
  run: number,
  attempt: number,
  pending = false,
  now = new Date().toISOString(),
) {
  assert(Number.isSafeInteger(run) && run > 0, "Invalid source run");
  const source = (await api(`actions/runs/${run}`)) as {
    path: string;
    head_sha: string;
    head_repository?: { full_name?: string } | null;
    created_at: string;
    conclusion: string | null;
    run_attempt: number;
  };
  assert(
    source.path === ".github/workflows/ci.yml" &&
      /^[a-f0-9]{40}$/.test(source.head_sha),
    "Unexpected source workflow",
  );
  // Default-branch code must not turn fork-controlled artifacts into repository writes.
  assert(
    source.head_repository?.full_name === repo,
    "Unexpected source repository",
  );
  assert(source.run_attempt === attempt, "Source attempt superseded");
  const statuses = (await api(
    `commits/${source.head_sha}/statuses?per_page=100`,
  )) as Array<{ context: string; description: string }>;
  const newer = statuses.some(
    (status) =>
      status.context === "Delivery checks" &&
      Number(/Flaky history run (\d+)/.exec(status.description || "")?.[1]) >
        run,
  );
  if (pending) {
    // A very short run may have completed before this requested event ran.
    if (source.conclusion === null && !newer)
      await api(`statuses/${source.head_sha}`, {
        context: "Delivery checks",
        state: "pending",
        description: `Flaky history run ${run}: awaiting trusted accounting`,
        target_url: `https://github.com/${repo}/actions/runs/${run}`,
      });
    return;
  }
  const occurrence = { run, at: source.created_at };
  const issues = await trackFlakes(api, repo, reports, occurrence);
  const blocked = blockedFlakes(issues, reports, occurrence, now);
  // A status and check with the same required name must both pass. This trusted
  // post-run verdict also closes concurrent-run races in the read-only job gate.
  // Older runs for one SHA must never overwrite newer run evidence.
  if (!newer || blocked.length)
    await api(`statuses/${source.head_sha}`, {
      context: "Delivery checks",
      state:
        source.conclusion === "success" && !blocked.length
          ? "success"
          : "failure",
      description: `Flaky history run ${run}: ${blocked.length ? "frequency limit exceeded" : source.conclusion === "success" ? "recorded" : "source run failed"}`,
      target_url: `https://github.com/${repo}/actions/runs/${run}`,
    });
  assert(
    !blocked.length,
    `Flaky frequency limit exceeded: ${blocked.map((item) => `#${item.issue}`).join(", ")}`,
  );
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
  const reports = readFlakeReports(".agents/delivery/flakes");
  if (process.argv[2] === "gate") {
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
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, flakeSummary(reports));
  await publishTracking(
    api,
    repo,
    reports,
    Number(process.env.SOURCE_RUN),
    Number(process.env.SOURCE_ATTEMPT),
    process.argv[2] === "pending",
  );
}

if (import.meta.main) await run();
