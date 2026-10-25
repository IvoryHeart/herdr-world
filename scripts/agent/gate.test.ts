import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./gate";
import { CASES, config, confirm, input, NOW, SHA } from "./gate/cases";
import type { Run } from "./gate/observe";
import { evaluate } from "./gate/predicate";
import {
  latestVerdict,
  openStore,
  recordPass,
  transitions,
} from "./gate/store";

let root: string;
let dbPath: string;
let configPath: string;
const paths = () => ["--db", dbPath, "--config", configPath];

/** Run the CLI and capture what it printed. */
async function cli(args: string[], now = NOW, run?: Run) {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation(
    (text: string) => void lines.push(text),
  );
  const error = spyOn(console, "error").mockImplementation(
    (text: string) => void lines.push(text),
  );
  try {
    const code = await main([...args, ...paths()], now, run);
    return { code, text: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function fresh(name: string) {
  dbPath = join(root, `${name}.sqlite`);
  configPath = join(root, "config.json");
}

function seed(...verdictInputs: ReturnType<typeof input>[]) {
  const db = openStore(dbPath);
  try {
    recordPass(db, {
      trigger: "test",
      configHash: "x",
      startedAt: NOW,
      finishedAt: NOW,
      inputs: verdictInputs,
      verdicts: verdictInputs.map((entry) => evaluate(entry, config, NOW)),
    });
  } finally {
    db.close();
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "agent-gate-cli-"));
  writeFileSync(join(root, "config.json"), JSON.stringify(config));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ready = () =>
  input({
    head: SHA.fixed,
    posts: ["rev2", "rev-astra", "rev-opus"].map((name) =>
      confirm(name, SHA.fixed),
    ),
  });

describe("merge-line", () => {
  test("prints a head-pinned merge command for a fresh READY, never --admin", async () => {
    fresh("merge-ready");
    seed(ready());
    const { code, text } = await cli(["merge-line", "7"], NOW + 60_000);
    expect(code).toBe(0);
    expect(text).toBe(
      `gh pr merge 7 --repo example-org/widgets --merge --match-head-commit ${SHA.fixed}`,
    );
    expect(text).not.toContain("--admin");
  });

  test("refuses with exit 2 when not READY, stale or unknown", async () => {
    fresh("merge-refuse");
    seed(CASES.find((entry) => entry.name.startsWith("A1 "))!.input);
    const missing = await cli(["merge-line", "7"]);
    expect(missing.code).toBe(2);
    expect(missing.text).toContain("NOT_READY");
    expect(missing.text).toContain("rev-opus");

    fresh("merge-stale");
    seed(ready());
    const stale = await cli(["merge-line", "7"], NOW + 11 * 60_000);
    expect(stale.code).toBe(2);
    expect(stale.text).toContain("older than 10 min");

    expect((await cli(["merge-line", "8"])).code).toBe(2);
  });
});

describe("check-claim", () => {
  test("a READY claim naming an old head is STALE (A5)", async () => {
    fresh("claim");
    seed(ready());
    const stale = await cli(["check-claim", "7", SHA.reviewed.slice(0, 7)]);
    expect(stale.code).toBe(2);
    expect(stale.text).toContain("STALE");
    const current = await cli(["check-claim", "#7", SHA.fixed]);
    expect(current.code).toBe(0);
    expect(current.text).toContain("READY");
  });
});

describe("store", () => {
  test("an identical recomputation writes no new verdict; a change is one transition (A8)", () => {
    fresh("idempotent");
    seed(ready());
    seed(ready());
    const db = openStore(dbPath);
    try {
      expect(transitions(db, 0)).toHaveLength(1);
      expect(latestVerdict(db, 7)!.passId).toBe(1);
    } finally {
      db.close();
    }
    seed(CASES.find((entry) => entry.name.startsWith("A1 "))!.input);
    seed(ready());
    const again = openStore(dbPath);
    try {
      // READY → NOT_READY → READY: three transitions, the last one READY.
      expect(transitions(again, 0).map((entry) => entry.state)).toEqual([
        "READY",
        "NOT_READY",
        "READY",
      ]);
    } finally {
      again.close();
    }
  });

  test("a pass that fails mid-write leaves nothing behind (A8)", () => {
    fresh("crash");
    seed(ready());
    const db = openStore(dbPath);
    try {
      // The second verdict violates NOT NULL after the pass and its first
      // rows were written: the whole transaction must roll back.
      expect(() =>
        recordPass(db, {
          trigger: "test",
          configHash: "x",
          startedAt: NOW,
          finishedAt: NOW,
          inputs: [ready()],
          verdicts: [
            evaluate(ready(), config, NOW),
            { ...evaluate(ready(), config, NOW), state: null as never },
          ],
        }),
      ).toThrow();
      expect(db.query("SELECT COUNT(*) AS n FROM pass").get()).toEqual({
        n: 1,
      });
      expect(db.query("SELECT COUNT(*) AS n FROM observation").get()).toEqual({
        n: 1,
      });
    } finally {
      db.close();
    }
  });
});

describe("holds", () => {
  test("hold and release are recorded decisions", async () => {
    fresh("hold");
    await expect(cli(["hold", "7"])).rejects.toThrow("hold needs --reason");
    const held = await cli([
      "hold",
      "7",
      "--reason",
      "owner repro",
      "--actor",
      "firstmate",
    ]);
    expect(held.code).toBe(0);
    expect(held.text).toContain("held: owner repro");
    expect((await cli(["release", "7"])).code).toBe(0);
  });
});

describe("replay", () => {
  test("every acceptance case replays from fixture files", async () => {
    fresh("replay");
    const dir = join(root, "fixtures");
    mkdirSync(dir, { recursive: true });
    CASES.forEach((entry, index) =>
      writeFileSync(
        join(dir, `${String(index).padStart(2, "0")}.json`),
        JSON.stringify(entry),
      ),
    );
    const { code, text } = await cli(["replay", dir]);
    expect(text).not.toContain("FAIL");
    expect(code).toBe(0);
    writeFileSync(
      join(dir, "zz.json"),
      JSON.stringify({
        ...CASES[0],
        name: "wrong expectation",
        expect: { state: "NOT_READY" },
      }),
    );
    const failed = await cli(["replay", dir]);
    expect(failed.code).toBe(1);
    expect(failed.text).toContain("FAIL wrong expectation");
  });
});

/** Fake gh: World's list and detail queries, plus one Actions run with a retried attempt. */
function fakeGitHub(remoteHead: string): Run {
  const listNode = {
    number: 7,
    title: "Synthetic batch",
    url: "https://github.com/example-org/widgets/pull/7",
    isDraft: false,
    state: "OPEN",
    updatedAt: new Date(NOW).toISOString(),
    mergedAt: null,
    headRefName: "batch/town-9",
    headRefOid: remoteHead,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    repository: { nameWithOwner: "example-org/widgets" },
    headRepository: { nameWithOwner: "example-org/widgets" },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
    },
    labels: { nodes: [{ name: "pod:town" }] },
  };
  const review = (reviewer: string, id: number) => ({
    id: `review-${id}`,
    author: { login: "shared-owner" },
    authorAssociation: "OWNER",
    body: `Reviewer: ${reviewer}\nReviewed commit: ${remoteHead}\nRESULT #7: 1/1 resolved, 0 new`,
    url: `https://github.com/example-org/widgets/pull/7#pullrequestreview-${id}`,
    submittedAt: new Date(NOW - 60_000).toISOString(),
    commit: { oid: remoteHead },
  });
  const detail = {
    headRefOid: remoteHead,
    body: "Synthetic batch",
    author: { login: "shared-owner" },
    headRef: { compare: { aheadBy: 2 } },
    files: { totalCount: 1, nodes: [{ path: "server/src/example.ts" }] },
    commits: {
      nodes: [
        {
          commit: {
            oid: remoteHead,
            committedDate: new Date(NOW - 120_000).toISOString(),
          },
        },
      ],
    },
    latest: {
      nodes: [
        {
          commit: {
            oid: remoteHead,
            statusCheckRollup: {
              contexts: {
                totalCount: 1,
                nodes: [
                  {
                    name: "Browser tests",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                    isRequired: true,
                  },
                ],
              },
            },
          },
        },
      ],
    },
    reviews: {
      nodes: [review("rev2", 1), review("rev-astra", 2), review("rev-opus", 3)],
    },
    comments: { nodes: [] },
  };
  const json = (value: unknown) => ({
    code: 0,
    stdout: JSON.stringify(value),
    stderr: "",
  });
  return (argv) => {
    const [, , kind, , query] = argv;
    if (kind === "graphql" && query?.includes("search("))
      return json({ data: { open: { issueCount: 1, nodes: [listNode] } } });
    if (kind === "graphql")
      return json({ data: { p0: { pullRequest: detail } } });
    if (kind?.includes("/attempts/1/jobs"))
      return json({
        jobs: [
          {
            name: "Browser tests",
            conclusion: "failure",
            completed_at: new Date(NOW - 600_000).toISOString(),
          },
        ],
      });
    if (kind?.includes("actions/runs?head_sha="))
      return json({ workflow_runs: [{ id: 41, run_attempt: 2 }] });
    return { code: 1, stdout: "", stderr: `unexpected ${argv.join(" ")}` };
  };
}

test("pass reads GitHub and git, records verdicts and survives a refetch unchanged", async () => {
  fresh("pass");
  const work = join(root, "pass-work");
  const remote = join(root, "pass-remote.git");
  const git = (...args: string[]) =>
    Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=Example",
        "-c",
        "user.email=dev@example.com",
        ...args,
      ],
      {
        cwd: work,
        stdout: "pipe",
      },
    )
      .stdout.toString()
      .trim();
  Bun.spawnSync(["git", "init", "--quiet", "-b", "main", work]);
  writeFileSync(join(work, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "base");
  const head = git("rev-parse", "HEAD");
  Bun.spawnSync(["git", "init", "--quiet", "--bare", remote]);
  git(
    "push",
    "--quiet",
    remote,
    "HEAD:refs/heads/main",
    "HEAD:refs/pull/7/head",
  );
  writeFileSync(configPath, JSON.stringify({ ...config, remote }));
  try {
    const first = await cli(["pass"], NOW, fakeGitHub(head));
    expect(first.text).toContain("pass 1: 1 pull request(s)");
    expect(first.text).toMatch(/#7\tREADY/u);
    const explain = await cli(["explain", "7"], NOW);
    expect(explain.text).toContain("Browser tests: 1 failed attempt retained");
    expect(explain.text).toContain("native approval");
    expect(explain.text).toContain("claim    rev-opus confirmed");
    const second = await cli(["pass"], NOW + 60_000, fakeGitHub(head));
    expect(second.code).toBe(0);
    expect((await cli(["diff"], NOW)).text).toBe("");
    expect((await cli(["diff", "--since", "0"], NOW)).text).toContain(
      "pass 1\t#7\tREADY",
    );
    const replayed = await cli(["replay", "--pass", "2"], NOW);
    expect(replayed.text).toContain("0 verdict(s) differ from pass 2");
  } finally {
    writeFileSync(configPath, JSON.stringify(config));
  }
});

test("a failed GitHub read records no pass", async () => {
  fresh("pass-fail");
  const failing: Run = () => ({ code: 1, stdout: "", stderr: "HTTP 502" });
  await expect(cli(["pass"], NOW, failing)).rejects.toThrow(
    "GitHub request failed",
  );
  const db = openStore(dbPath);
  try {
    expect(db.query("SELECT COUNT(*) AS n FROM pass").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});
