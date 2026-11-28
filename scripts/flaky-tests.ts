import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { FlakeReport, TestCase } from "./test-retry";
import {
  flakeSummary,
  markdown,
  testKey,
  validateReport,
} from "./flaky-test-policy";

/** @internal */
export type GitHubAPI = (path: string, body?: unknown) => Promise<unknown>;
type SourceRun = {
  id: number;
  path: string;
  head_repository?: { full_name?: string } | null;
  head_branch: string;
  created_at: string;
  conclusion: string | null;
};
type TrackingIssue = { number: number; body: string; pull_request?: unknown };
const START = "<!-- daily-flaky-tests:start -->";
const END = "<!-- daily-flaky-tests:end -->";
const DAY = 86400_000;

/** Read runner evidence or downloaded shard reports, never unrelated JSON. @internal */
export function readFlakeReports(directory: string): FlakeReport[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (file): FlakeReport[] => {
      const path = join(directory, file.name);
      // The output folder must not feed back into another summary.
      if (file.isDirectory())
        return file.name === "flaky" ? [] : readFlakeReports(path);
      if (file.name !== "flaky.json" && !/^flakes-.+\.json$/.test(file.name))
        return [];
      assert(file.isFile(), "Invalid flake report file");
      const text = readFileSync(path, "utf8");
      assert(text.length <= 5_000_000, "Oversized flake report");
      return [validateReport(JSON.parse(text))];
    },
  );
}

/** Local reporting has no token, history lookup or merge verdict. @internal */
export function summarizeRetries(
  directory: string,
  output: string,
  summary?: string,
) {
  const reports = readFlakeReports(directory);
  const unique = (tests: TestCase[]) => [
    ...new Map(tests.map((test) => [testKey(test), test])).values(),
  ];
  const retried = unique(
    reports.flatMap((report) => report.retried || report.flaky),
  );
  const flaky = unique(reports.flatMap((report) => report.flaky));
  const combined = {
    files: [...new Set(retried.map((test) => test.file))],
    flaky,
    retried,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(combined));
  if (summary) appendFileSync(summary, flakeSummary([combined]));
  return combined;
}

/** Decode only the small report as data; never extract or execute artifact paths. @internal */
const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

/**
 * The parsed `flaky.json` entries of an artifact zip, read in process; no
 * path in the archive is ever extracted. @internal
 */
export function archiveFlakyJson(archive: Uint8Array): unknown[] {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const word = (at: number) => {
    assert(at >= 0 && at + 4 <= archive.byteLength, "Invalid flaky archive");
    return view.getUint32(at, true);
  };
  const half = (at: number) => {
    assert(at >= 0 && at + 2 <= archive.byteLength, "Invalid flaky archive");
    return view.getUint16(at, true);
  };
  let end = -1;
  for (
    let at = archive.byteLength - 22;
    at >= Math.max(0, archive.byteLength - 22 - 0xffff);
    at--
  )
    if (view.getUint32(at, true) === ZIP_END) {
      end = at;
      break;
    }
  assert(end >= 0, "Invalid flaky archive");
  const reports: unknown[] = [];
  let at = word(end + 16);
  for (let entry = half(end + 10); entry > 0; entry--) {
    assert(word(at) === ZIP_ENTRY, "Invalid flaky archive");
    const method = half(at + 10);
    const compressed = word(at + 20);
    const size = word(at + 24);
    const nameLength = half(at + 28);
    const local = word(at + 42);
    const name = new TextDecoder().decode(
      archive.subarray(at + 46, at + 46 + nameLength),
    );
    at += 46 + nameLength + half(at + 30) + half(at + 32);
    if (name !== "flaky.json") continue;
    assert(size <= 5_000_000, "Oversized flake report");
    assert(word(local) === ZIP_LOCAL, "Invalid flaky archive");
    const start = local + 30 + half(local + 26) + half(local + 28);
    assert(start + compressed <= archive.byteLength, "Invalid flaky archive");
    const data = archive.subarray(start, start + compressed);
    assert(method === 0 || method === 8, "Unsupported flaky archive entry");
    const bytes =
      method === 0
        ? data
        : inflateRawSync(data, { maxOutputLength: Math.max(1, size) });
    assert(bytes.byteLength === size, "Invalid flaky archive");
    reports.push(JSON.parse(new TextDecoder().decode(bytes)));
    assert(reports.length === 1, "Duplicate flaky report");
  }
  return reports;
}

export async function downloadReports(api: GitHubAPI, run: number) {
  const reports: Array<{ attempt: number; report: FlakeReport }> = [];
  for (let page = 1; ; page++) {
    const batch = (await api(
      `actions/runs/${run}/artifacts?per_page=100&page=${page}`,
    )) as {
      artifacts: Array<{ id: number; name: string; expired: boolean }>;
    };
    assert(Array.isArray(batch.artifacts), "Missing source artifacts");
    for (const artifact of batch.artifacts) {
      const match = /^flaky-tests-delivery-([1-9]\d*)$/.exec(artifact.name);
      if (!match) continue;
      const attempt = Number(match[1]);
      assert(
        Number.isSafeInteger(attempt) &&
          Number.isSafeInteger(artifact.id) &&
          artifact.id > 0,
        "Invalid artifact identity",
      );
      assert(!artifact.expired, `Expired flaky evidence for run ${run}`);
      const archive = (await api(
        `actions/artifacts/${artifact.id}/zip`,
      )) as Uint8Array;
      assert(archive.byteLength <= 20_000_000, "Oversized flaky archive");
      let entries: unknown[];
      try {
        entries = archiveFlakyJson(archive);
      } catch (error) {
        throw new Error(
          `Cannot read flaky evidence for run ${run}: ${(error as Error).message}`,
          { cause: error },
        );
      }
      // Old delivery inventory archives have no flaky.json during rollout.
      for (const value of entries)
        reports.push({ attempt, report: validateReport(value as FlakeReport) });
    }
    if (batch.artifacts.length < 100) return reports;
  }
}

async function trackingIssue(api: GitHubAPI) {
  for (let page = 1; ; page++) {
    const issues = (await api(
      `issues?labels=flaky&state=all&per_page=100&page=${page}`,
    )) as TrackingIssue[];
    assert(Array.isArray(issues), "Missing tracking issues");
    const issue = issues.find(
      (item) => !item.pull_request && item.body?.includes(START),
    );
    if (issue) return issue;
    if (issues.length < 100) return undefined;
  }
}

/** One serialized trusted snapshot; identical inputs produce identical counts. @internal */
export async function reportDailyFlakes(
  api: GitHubAPI,
  repo: string,
  now = new Date().toISOString(),
) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo), "Missing repository");
  const end = Date.parse(now);
  assert(Number.isFinite(end), "Invalid report time");
  const since = new Date(end - DAY).toISOString();
  const runs = new Map<number, SourceRun>();
  for (let page = 1; ; page++) {
    const batch = (await api(
      `actions/workflows/ci.yml/runs?status=completed&created=${encodeURIComponent(`${since}..${now}`)}&per_page=100&page=${page}`,
    )) as { workflow_runs: SourceRun[] };
    assert(Array.isArray(batch.workflow_runs), "Missing completed CI runs");
    // Actions can return a short intermediate page with more results following.
    if (!batch.workflow_runs.length) break;
    for (const source of batch.workflow_runs) {
      if (
        source.head_repository?.full_name !== repo ||
        source.path !== ".github/workflows/ci.yml" ||
        !source.head_branch ||
        !source.conclusion ||
        ["cancelled", "skipped"].includes(source.conclusion)
      )
        continue;
      assert(
        Number.isSafeInteger(source.id) &&
          source.id > 0 &&
          Number.isFinite(Date.parse(source.created_at)),
        "Invalid source run",
      );
      if (
        Date.parse(source.created_at) >= end - DAY &&
        Date.parse(source.created_at) <= end
      )
        runs.set(source.id, source);
    }
  }
  const tests = new Map<
    string,
    {
      test: TestCase;
      occurrences: Map<string, { run: number; attempt: number; at: string }>;
    }
  >();
  const errors: string[] = [];
  let artifacts = 0;
  for (const source of runs.values()) {
    try {
      const reports = await downloadReports(api, source.id);
      artifacts += reports.length;
      for (const { attempt, report } of reports) {
        for (const test of report.retried || report.flaky) {
          const key = testKey(test);
          const item = tests.get(key) || { test, occurrences: new Map() };
          item.occurrences.set(`${source.id}:${attempt}`, {
            run: source.id,
            attempt,
            at: source.created_at,
          });
          tests.set(key, item);
        }
      }
    } catch {
      errors.push(
        `- Could not read retry evidence: https://github.com/${repo}/actions/runs/${source.id}`,
      );
    }
  }
  const body = [
    START,
    "## Last 24 hours",
    "",
    `${since} to ${now}. ${runs.size} completed same-repository CI runs; ${artifacts} retry reports. Cancelled, skipped and fork runs are excluded.`,
    "",
    "Reporting is informational and never gates CI or merges. Counts are distinct run attempts per test; duplicate shard evidence counts once.",
    "",
    ...(tests.size
      ? [
          "| File | Test | Retries | Last run |",
          "| --- | --- | ---: | --- |",
          ...[...tests.values()]
            .sort(
              (a, b) =>
                a.test.file.localeCompare(b.test.file) ||
                a.test.name.localeCompare(b.test.name),
            )
            .map(({ test, occurrences }) => {
              const last = [...occurrences.values()].sort(
                (a, b) =>
                  Date.parse(b.at) - Date.parse(a.at) ||
                  b.run - a.run ||
                  b.attempt - a.attempt,
              )[0]!;
              return `| ${markdown(test.file)} | ${markdown(test.name)} | ${occurrences.size} | [${last.run} (attempt ${last.attempt})](https://github.com/${repo}/actions/runs/${last.run}/attempts/${last.attempt}) |`;
            }),
        ]
      : ["No tests needed a retry in the available reports."]),
    ...(errors.length ? ["", "### Incomplete evidence", "", ...errors] : []),
    "",
    END,
  ].join("\n");
  const existing = await trackingIssue(api);
  let updated = body;
  if (existing) {
    const start = existing.body.indexOf(START),
      finish = existing.body.indexOf(END);
    assert(finish > start, "Missing managed report boundary");
    updated =
      existing.body.slice(0, start) +
      body +
      existing.body.slice(finish + END.length);
  }
  assert(
    updated.length < 65000,
    "Daily flaky report exceeds GitHub body limit",
  );
  if (existing) {
    if (updated !== existing.body)
      await api(`issues/${existing.number}`, { body: updated });
  } else {
    await api("labels", {
      name: "flaky",
      color: "FBCA04",
      description: "Tests that needed an in-job retry",
    });
    await api("issues", {
      title: "Flaky tests",
      body: updated,
      labels: ["flaky"],
    });
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  assert(
    !errors.length,
    "Daily flaky report has incomplete evidence; rerun manually after resolving artifact/API errors",
  );
  return body;
}

async function run() {
  if (process.argv[2] === "summarize") {
    summarizeRetries(
      process.argv[3] || ".agents/delivery",
      ".agents/delivery/flaky/flaky.json",
      process.env.GITHUB_STEP_SUMMARY,
    );
    return;
  }
  assert(process.argv[2] === "daily", "Use summarize or daily");
  const repo = process.env.GITHUB_REPOSITORY!;
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo), "Missing repository");
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  assert(token, "Missing GitHub token for daily reporting");
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
    assert(response.ok, `Daily flaky API failed (${response.status})`);
    return path.endsWith("/zip")
      ? new Uint8Array(await response.arrayBuffer())
      : response.json();
  };
  await reportDailyFlakes(api, repo);
}
if (import.meta.main) await run();
