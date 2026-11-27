import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadReports,
  readFlakeReports,
  reportDailyFlakes,
  summarizeRetries,
  type GitHubAPI,
} from "./flaky-tests";
import type { FlakeReport } from "./test-retry";

const now = "2026-11-27T12:00:00.000Z";
const flaky = { file: "scripts/example.test.ts", name: "nested case | <safe>" };
const report: FlakeReport = {
  files: [flaky.file],
  flaky: [flaky],
  retried: [flaky],
};
const source = (id: number, extra = {}) => ({
  id,
  path: ".github/workflows/ci.yml",
  head_repository: { full_name: "example/repo" },
  head_branch: "example-branch",
  created_at: "2026-11-27T11:00:00.000Z",
  conclusion: "success",
  ...extra,
});

async function zip(files: Record<string, unknown>) {
  const child = Bun.spawn(
    [
      "python3",
      "-c",
      `
import io, json, sys, zipfile
out = io.BytesIO()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, value in json.load(sys.stdin).items():
        archive.writestr(name, json.dumps(value))
sys.stdout.buffer.write(out.getvalue())
`,
    ],
    {
      stdin: new TextEncoder().encode(JSON.stringify(files)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, bytes, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ]);
  expect(error).toBe("");
  expect(code).toBe(0);
  return new Uint8Array(bytes);
}

function fakeAPI(archive: Uint8Array) {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const issues: Array<{ number: number; body: string }> = [];
  let pages: unknown[][] = [[source(1)]];
  const artifacts = new Map<
    number,
    Array<{ id: number; name: string; expired: boolean }>
  >();
  const archives = new Map<number, Uint8Array>();
  const failures = new Set<number>();
  let loseCreateReply = false;
  const api: GitHubAPI = async (path, value) => {
    const body = value as Record<string, unknown> | undefined;
    calls.push({ path, body });
    const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
    if (path.startsWith("actions/workflows/ci.yml/runs?"))
      return { workflow_runs: pages[page - 1] || [] };
    if (path.startsWith("actions/runs/")) {
      const run = Number(path.split("/")[2]);
      if (failures.has(run)) throw new Error("unavailable");
      return {
        artifacts:
          page === 1
            ? artifacts.get(run) || [
                { id: run, name: "flaky-tests-delivery-1", expired: false },
              ]
            : [],
      };
    }
    if (path.endsWith("/zip"))
      return archives.get(Number(path.split("/")[2])) || archive;
    if (path.startsWith("issues?"))
      return issues.slice((page - 1) * 100, page * 100);
    if (path === "labels") return {};
    if (path === "issues") {
      const issue = { number: issues.length + 1, body: body!.body as string };
      issues.push(issue);
      if (loseCreateReply) {
        loseCreateReply = false;
        throw new Error("lost creation reply");
      }
      return issue;
    }
    if (path.startsWith("issues/")) {
      const issue = issues.find(
        (item) => item.number === Number(path.split("/")[1]),
      )!;
      issue.body = body!.body as string;
      return issue;
    }
    throw new Error(`Unexpected API ${path}`);
  };
  return {
    api,
    calls,
    issues,
    artifacts,
    archives,
    failures,
    setPages: (value: unknown[][]) => {
      pages = value;
    },
    loseCreate: () => {
      loseCreateReply = true;
    },
  };
}

test("existing jobs write a compact artifact and summary without any GitHub credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "flaky-local-"));
  try {
    const input = join(directory, "evidence");
    mkdirSync(input);
    writeFileSync(join(input, "flakes-unit.json"), JSON.stringify(report));
    writeFileSync(join(input, "flakes-web.json"), JSON.stringify(report));
    writeFileSync(join(input, "unrelated.json"), "not a report");
    const summary = join(directory, "summary.md"),
      output = join(input, "flaky", "flaky.json");
    const combined = summarizeRetries(input, output, summary);
    expect(combined.retried).toEqual([flaky]);
    expect(combined.files).toEqual([flaky.file]);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(combined);
    expect(readFileSync(summary, "utf8")).toContain(
      "nested case \\| \\<safe\\>",
    );
    expect(readFlakeReports(input)).toHaveLength(2);
    const empty = summarizeRetries(
      join(directory, "missing"),
      join(directory, "empty", "flaky.json"),
    );
    expect(empty).toEqual({ files: [], flaky: [], retried: [] });
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "flaky-tests.ts"),
        "summarize",
        input,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          GH_TOKEN: "",
          GITHUB_TOKEN: "",
          GITHUB_REPOSITORY: "",
          GITHUB_STEP_SUMMARY: summary,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, error] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(code).toBe(0);
    expect(
      existsSync(join(directory, ".agents/delivery/flaky/flaky.json")),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("daily report lists tests, retry counts and the latest run, once across duplicate artifacts", async () => {
  const fake = fakeAPI(await zip({ "flaky.json": report }));
  fake.setPages([[source(2)], [source(1), source(2)]]); // Short pages are nonterminal.
  fake.artifacts.set(2, [
    { id: 2, name: "flaky-tests-delivery-1", expired: false },
    { id: 3, name: "flaky-tests-delivery-2", expired: false },
    { id: 3, name: "flaky-tests-delivery-2", expired: false },
    { id: 999, name: "flaky-tests-unit-1-2", expired: false },
  ]);
  const body = await reportDailyFlakes(fake.api, "example/repo", now);
  expect(body).toContain(
    "| 3 | [2 (attempt 2)](https://github.com/example/repo/actions/runs/2/attempts/2)",
  );
  expect(body).toContain("2 completed same-repository CI runs");
  expect(fake.issues).toHaveLength(1);
  const writes = fake.calls.filter((call) => call.body);
  expect(writes.map((call) => call.path)).toEqual(["labels", "issues"]);
  expect(writes[1]!.body!.title).toBe("Flaky tests");
  expect(
    fake.calls.some((call) =>
      /statuses|commits|actions\/artifacts\/999/.test(call.path),
    ),
  ).toBe(false);
  const count = fake.calls.length;
  expect(await reportDailyFlakes(fake.api, "example/repo", now)).toBe(body);
  expect(fake.calls.slice(count).some((call) => call.body)).toBe(false);
  expect(fake.calls[0]!.path).toContain(
    encodeURIComponent("2026-11-26T12:00:00.000Z.." + now),
  );
});

test("exclude cancelled, skipped, fork, missing identity, unrelated workflow and out-of-window runs before artifact reads", async () => {
  const fake = fakeAPI(await zip({ "flaky.json": report }));
  fake.setPages([
    [
      source(1),
      source(2, { conclusion: "cancelled" }),
      source(3, { conclusion: "skipped" }),
      source(4, { head_repository: { full_name: "fork/repo" } }),
      source(5, { head_repository: null }),
      source(6, { path: ".github/workflows/other.yml" }),
      source(7, { head_branch: "" }),
      source(8, { created_at: "2026-11-26T11:59:59.999Z" }),
      source(9, { created_at: "2026-11-27T12:00:00.001Z" }),
      source(10, { conclusion: null }),
      source(11, { conclusion: "failure" }),
      source(12, { created_at: "2026-11-26T12:00:00.000Z" }),
    ],
  ]);
  const body = await reportDailyFlakes(fake.api, "example/repo", now);
  expect(body).toContain("3 completed same-repository CI runs");
  expect(
    fake.calls
      .filter((call) => call.path.startsWith("actions/runs/"))
      .map((call) => Number(call.path.split("/")[2])),
  ).toEqual([1, 11, 12]);
});

test("one issue survives lost creation replies and preserves owner prose and closed state", async () => {
  const fake = fakeAPI(await zip({ "flaky.json": report }));
  fake.loseCreate();
  await expect(
    reportDailyFlakes(fake.api, "example/repo", now),
  ).rejects.toThrow("lost creation reply");
  fake.issues[0]!.body = `Owner note\n${fake.issues[0]!.body}\nOwner ending`;
  fake.setPages([[source(1), source(2)]]);
  await reportDailyFlakes(fake.api, "example/repo", now);
  expect(fake.issues).toHaveLength(1);
  expect(fake.issues[0]!.body).toStartWith("Owner note\n");
  expect(fake.issues[0]!.body).toEndWith("\nOwner ending");
  expect(fake.issues[0]!.body).toContain("| 2 | [2 (attempt 1)]");
  expect(
    fake.calls.filter((call) => call.path === "issues/1")[0]!.body,
  ).not.toHaveProperty("state");
});

test("all subsets of four artifact failures report other runs and a manual retry converges without duplication", async () => {
  const archive = await zip({ "flaky.json": report });
  for (let failures = 0; failures < 16; failures++) {
    const fake = fakeAPI(archive);
    fake.setPages([[1, 2, 3, 4].map((run) => source(run))]);
    for (let run = 1; run <= 4; run++)
      if (failures & (1 << (run - 1))) fake.failures.add(run);
    if (failures)
      await expect(
        reportDailyFlakes(fake.api, "example/repo", now),
      ).rejects.toThrow("incomplete evidence");
    else await reportDailyFlakes(fake.api, "example/repo", now);
    expect(fake.issues).toHaveLength(1);
    expect(fake.issues[0]!.body.includes("Incomplete evidence")).toBe(
      failures !== 0,
    );
    const successes = 4 - fake.failures.size;
    if (successes) expect(fake.issues[0]!.body).toContain(`| ${successes} |`);
    fake.failures.clear();
    const body = await reportDailyFlakes(fake.api, "example/repo", now);
    expect(body).toContain("| 4 | [4 (attempt 1)]");
    expect(body).not.toContain("Incomplete evidence");
    expect(fake.issues).toHaveLength(1);
  }
});

test("archive decoding never extracts paths; invalid, oversized and expired evidence is visible", async () => {
  const fake = fakeAPI(
    await zip({
      "flaky.json": report,
      "../../escape.json": { executable: true },
    }),
  );
  expect(await downloadReports(fake.api, 1)).toEqual([{ attempt: 1, report }]);
  fake.archives.set(
    1,
    await zip({ "inventory-1.json": { files: [], flaky: [] } }),
  );
  expect(await downloadReports(fake.api, 1)).toEqual([]); // Old schema, first-day rollout.
  fake.archives.set(
    1,
    await zip({ "flaky.json": { files: [], flaky: [flaky] } }),
  );
  await expect(downloadReports(fake.api, 1)).rejects.toThrow(
    "Flake outside executed inventory",
  );
  fake.artifacts.set(1, [
    { id: 1, name: "flaky-tests-delivery-1", expired: true },
  ]);
  await expect(downloadReports(fake.api, 1)).rejects.toThrow(
    "Expired flaky evidence",
  );
  fake.artifacts.set(1, [
    { id: 1, name: "flaky-tests-delivery-1", expired: false },
  ]);
  fake.archives.set(1, await zip({ "flaky.json": "x".repeat(5_000_001) }));
  await expect(downloadReports(fake.api, 1)).rejects.toThrow(
    "Oversized flake report",
  );
});

test("empty daily windows still update the single informational tracking issue", async () => {
  const fake = fakeAPI(
    await zip({ "flaky.json": { files: [], flaky: [], retried: [] } }),
  );
  const body = await reportDailyFlakes(fake.api, "example/repo", now);
  expect(body).toContain("No tests needed a retry");
  expect(body).toContain("never gates CI or merges");
});
