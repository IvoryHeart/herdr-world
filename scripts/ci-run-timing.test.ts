import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectRunTiming,
  renderRunTiming,
  type TimingJob,
} from "./ci-run-timing";

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const job = (
  name: string,
  created: number,
  start: number,
  end: number | null,
  conclusion: string | null = "success",
): TimingJob => ({
  name,
  created_at: at(created),
  started_at: at(start),
  completed_at: end === null ? null : at(end),
  conclusion,
});
const workflow = {
  jobs: {
    scope: { name: "Scope" },
    units: { name: "Units (${{ matrix.shard }}/2)", needs: "scope" },
    models: { name: "Models", needs: "scope", uses: "./models.yml" },
    delivery: { name: "Delivery checks", needs: ["scope", "units", "models"] },
    preview: { name: "Preview", needs: "delivery" },
  },
};
const run = {
  created_at: at(0),
  html_url: "https://example.test/actions/runs/42",
};
const jobs = [
  job("Scope", 0, 5, 20),
  job("Units (1/2)", 20, 400, 450, "failure"),
  job("Units (2/2)", 20, 21, 40),
  job("Models / Model shard (1/2)", 20, 25, 350),
  job("Models / Model shard (2/2)", 20, 25, 300),
  job("Delivery checks", 450, 455, null, null),
  job("Preview", 470, 470, 469, "skipped"),
];

test("timings distinguish the critical dependency from the longest execution and exclude skipped jobs", () => {
  const report = renderRunTiming(run, jobs, workflow, at(470));
  expect(report).toContain(
    "Critical path (run created → Delivery report): **7m 50s**",
  );
  expect(report).toContain("Scope → Units (1/2) → Delivery checks");
  expect(report).toContain(
    "Longest job: **Models / Model shard (1/2)** — 5m 25s",
  );
  expect(report).toContain(
    "Runner waits: **6m 41s** across 6 jobs; longest **Units (1/2)** — 6m 20s",
  );
  expect(report).toContain("| Units (1/2) | failure | 50s | 6m 20s |");
  expect(report).toContain("in progress");
  expect(report).not.toContain("| Preview |");
  expect(report).toContain(
    "Final created_at → Delivery completed_at is available after this job exits",
  );
});

test("completed runs use Delivery completion rather than report time or downstream previews", () => {
  const complete = jobs.map((j) =>
    j.name === "Delivery checks" ? job(j.name, 450, 455, 480, "failure") : j,
  );
  complete.push(job("Preview", 480, 481, 900));
  const report = renderRunTiming(run, complete, workflow, at(1000));
  expect(report).toContain(
    "Critical path (run created → Delivery completed): **8m 0s**",
  );
  expect(report).toContain("Scope → Units (1/2) → Delivery checks");
  expect(report).not.toContain("Final created_at");
});

test("missing timestamps are reported as unknown instead of zero timings", () => {
  const report = renderRunTiming(
    run,
    [{ ...jobs[0]!, created_at: "invalid", started_at: null }],
    workflow,
    at(30),
  );
  expect(report).toContain("Critical path: unavailable");
  expect(report).toContain("| Scope | success | unknown | unknown |");
});

test("read-only timing collection paginates this exact attempt without including earlier attempts", async () => {
  const paths: string[] = [];
  const result = await collectRunTiming(
    "example/world",
    "42",
    "2",
    async (path) => {
      paths.push(path);
      if (!path.includes("/jobs?")) return run;
      return {
        jobs: path.endsWith("page=1")
          ? Array.from({ length: 100 }, () => jobs[0]!)
          : [jobs[1]!],
      };
    },
  );
  expect(result.jobs).toHaveLength(101);
  expect(paths).toEqual([
    "/repos/example/world/actions/runs/42/attempts/2",
    "/repos/example/world/actions/runs/42/attempts/2/jobs?per_page=100&page=1",
    "/repos/example/world/actions/runs/42/attempts/2/jobs?per_page=100&page=2",
  ]);
});

test("API failures and incomplete pagination never produce partial timing claims", async () => {
  await expect(
    collectRunTiming("example/world", "42", "1", async () => {
      throw new Error("403");
    }),
  ).rejects.toThrow("403");
  await expect(
    collectRunTiming("example/world", "42", "1", async (path) =>
      path.includes("/jobs?")
        ? { jobs: Array.from({ length: 100 }, () => jobs[0]!) }
        : run,
    ),
  ).rejects.toThrow("Timing job limit");
});

test("the actual reporter writes unavailable data and succeeds when GitHub identity is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-timing-"));
  const summary = join(directory, "summary.md");
  try {
    const child = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "ci-run-timing.ts")],
      {
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "",
          GITHUB_RUN_ID: "",
          GITHUB_RUN_ATTEMPT: "",
          GITHUB_STEP_SUMMARY: summary,
          GH_TOKEN: "synthetic-token-never-sent",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(child.exitCode).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain(
      "Timing data unavailable for this attempt",
    );
    expect(child.stdout.toString()).not.toContain("synthetic-token-never-sent");
    expect(child.stderr.toString()).not.toContain("synthetic-token-never-sent");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
