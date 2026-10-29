import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./gate";
import { CASES, config, confirm, input, NOW, SHA } from "./gate/cases";
import type { Run } from "./gate/observe";
import { evaluate } from "./gate/predicate";
import {
  addDecision,
  latestVerdict,
  openStore,
  passConfig,
  passInputs,
  recordPass,
  transitions,
} from "./gate/store";

let root: string;
let work: string;
let remote: string;
let dbPath: string;
let configPath: string;
let reviewed: string;
let fixed: string;

/** A synthetic GitHub: what the gate's reads see, changeable between calls. */
type World = {
  state: "OPEN" | "MERGED";
  head: string;
  listRollup: "SUCCESS" | "FAILURE";
  checks: {
    name: string;
    status: string;
    conclusion: string | null;
    completedAt?: string;
    detailsUrl?: string;
  }[];
  reviews: { reviewer: string | null; commit: string; result: string }[];
  /** null: the rules endpoint fails. */
  rules: string[] | null;
  retried: boolean;
  /** Workflow runs on the head: id, run number and latest attempt. */
  runs: { id: number; run_number: number; run_attempt: number }[];
  /** Job ID → the run and attempt it belongs to. */
  jobs: Record<number, { run_id: number; run_attempt: number }>;
  /** History pages never end. */
  endless: boolean;
};
let world: World;

function git(...args: string[]) {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=Example",
      "-c",
      "user.email=dev@example.com",
      ...args,
    ],
    { cwd: work, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString().trim();
}

/** Move the remote's pull request ref, as a push to the PR branch would. */
function publish(head: string) {
  world.head = head;
  git("push", "--quiet", "--force", remote, `${head}:refs/pull/7/head`);
}

const iso = (offset: number) => new Date(NOW + offset).toISOString();
const json = (value: unknown) => ({
  code: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});

function listNode() {
  return {
    number: 7,
    title: "Synthetic batch",
    url: "https://github.com/example-org/widgets/pull/7",
    isDraft: false,
    state: world.state,
    updatedAt: iso(0),
    mergedAt: world.state === "MERGED" ? iso(0) : null,
    headRefName: "batch/town-9",
    headRefOid: world.head,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    repository: { nameWithOwner: "example-org/widgets" },
    headRepository: { nameWithOwner: "example-org/widgets" },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: world.listRollup } } }],
    },
    labels: { nodes: [{ name: "pod:town" }] },
  };
}

/** One page of the gate's paginated review or comment history. */
function historyPage(kind: string, page: number) {
  const all =
    kind === "reviews"
      ? world.reviews.map((entry, index) => ({
          id: `review-${index + 1}`,
          author: { login: "shared-owner" },
          authorAssociation: "OWNER",
          body: `${entry.reviewer ? `Reviewer: ${entry.reviewer}\nReviewed commit: ${entry.commit}\n` : ""}RESULT #7: ${entry.result}`,
          url: `https://github.com/example-org/widgets/pull/7#pullrequestreview-${index + 1}`,
          submittedAt: iso(-100_000 + index),
          commit: { oid: entry.commit },
        }))
      : [];
  return {
    pageInfo: {
      hasNextPage: world.endless || all.length > (page + 1) * 100,
      endCursor: `c${page + 1}`,
    },
    nodes: all.slice(page * 100, page * 100 + 100),
  };
}

/** World's detail query; its bounded review window is deliberately empty. */
function detail() {
  return {
    headRefOid: world.head,
    body: "Synthetic batch",
    author: { login: "shared-owner" },
    headRef: { compare: { aheadBy: 2 } },
    files: { totalCount: 1, nodes: [{ path: "server/src/example.ts" }] },
    commits: {
      nodes: [...new Set([reviewed, fixed, world.head])].map((oid, index) => ({
        commit: { oid, committedDate: iso(-300_000 + index) },
      })),
    },
    latest: {
      nodes: [
        {
          commit: {
            oid: world.head,
            statusCheckRollup: {
              contexts: {
                totalCount: world.checks.length,
                nodes: world.checks.map((check) => ({
                  ...check,
                  isRequired: true,
                })),
              },
            },
          },
        },
      ],
    },
    reviews: { nodes: [] },
    comments: { nodes: [] },
  };
}

const fakeGitHub: Run = (argv) => {
  const [, , path = "", , query = ""] = argv;
  if (path === "graphql") {
    if (query.includes("search("))
      return json({
        data: {
          open: {
            issueCount: world.state === "OPEN" ? 1 : 0,
            nodes: world.state === "OPEN" ? [listNode()] : [],
          },
        },
      });
    if (query.includes("labels(first"))
      return json({ data: { repository: { p0: listNode() } } });
    const history =
      /(reviews|comments)\(first: \d+(?:, after: "c(\d+)")?/u.exec(query);
    if (history)
      return json({
        data: {
          repository: {
            pullRequest: {
              [history[1]!]: historyPage(history[1]!, Number(history[2] ?? 0)),
            },
          },
        },
      });
    return json({ data: { p0: { pullRequest: detail() } } });
  }
  if (path.includes("/rules/branches/"))
    return world.rules
      ? json([
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: world.rules.map((context) => ({
                context,
              })),
            },
          },
        ])
      : { code: 1, stdout: "", stderr: "HTTP 403" };
  if (path.includes("/protection/"))
    return { code: 1, stdout: "", stderr: "Branch not protected (HTTP 404)" };
  if (path.includes("/attempts/1/jobs"))
    return json({
      jobs: [
        {
          name: "Browser tests",
          conclusion: "failure",
          completed_at: iso(-600_000),
        },
      ],
    });
  if (path.includes("actions/runs?head_sha="))
    return json({
      workflow_runs: [
        ...world.runs,
        ...(world.retried
          ? [{ id: 41, run_attempt: 2, workflow_id: 9, run_number: 5 }]
          : []),
      ].map((entry) => ({ workflow_id: 9, ...entry })),
    });
  const job = /actions\/jobs\/(\d+)$/u.exec(path);
  if (job && world.jobs[Number(job[1])])
    return json(world.jobs[Number(job[1])]);
  return { code: 1, stdout: "", stderr: `unexpected ${argv.join(" ")}` };
};

const trio = (commit: string) =>
  ["rev2", "rev-astra", "rev-opus"].map((name) => confirm(name, commit));

/** Run the CLI against the fake and capture what it printed. */
async function cli(args: string[], now = NOW, run: Run = fakeGitHub) {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation(
    (text: string) => void lines.push(text),
  );
  const error = spyOn(console, "error").mockImplementation(
    (text: string) => void lines.push(text),
  );
  try {
    const code = await main(
      [...args, "--db", dbPath, "--config", configPath],
      now,
      run,
    );
    return { code, text: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

let databases = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "agent-gate-cli-"));
  work = join(root, "work");
  remote = join(root, "remote.git");
  configPath = join(root, "config.json");
  Bun.spawnSync(["git", "init", "--quiet", "--bare", remote]);
  Bun.spawnSync(["git", "init", "--quiet", "-b", "main", work]);
  writeFileSync(join(work, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "base");
  git("push", "--quiet", remote, "HEAD:refs/heads/main");
  git("checkout", "--quiet", "-b", "pr");
  writeFileSync(join(work, "a.txt"), "reviewed\n");
  git("commit", "--quiet", "-am", "reviewed");
  reviewed = git("rev-parse", "HEAD");
  writeFileSync(join(work, "a.txt"), "fixed\n");
  git("commit", "--quiet", "-am", "fixed");
  fixed = git("rev-parse", "HEAD");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  dbPath = join(root, `gate-${++databases}.sqlite`);
  writeFileSync(configPath, JSON.stringify({ ...config, remote }));
  world = {
    state: "OPEN",
    head: fixed,
    listRollup: "SUCCESS",
    checks: [
      { name: "Delivery checks", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "Browser tests", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    reviews: trio(fixed),
    rules: ["Delivery checks"],
    retried: false,
    runs: [],
    jobs: {},
    endless: false,
  };
  publish(fixed);
});

describe("pass", () => {
  test("reads GitHub and git and records READY from full review history", async () => {
    world.retried = true;
    const first = await cli(["pass"]);
    expect(first.text).toContain("pass 1: 1 pull request(s)");
    expect(first.text).toMatch(/#7\tREADY/u);
    const explain = await cli(["explain", "7"]);
    expect(explain.text).toContain("Browser tests: 1 failed attempt retained");
    expect(explain.text).toContain("native approval");
    expect(explain.text).toContain("claim    rev-opus confirmed");
    expect((await cli(["pass"], NOW + 60_000)).code).toBe(0);
    expect((await cli(["diff"])).text).toBe("");
    expect((await cli(["diff", "--since", "0"])).text).toContain(
      "pass 1\t#7\tREADY",
    );
  });

  test("a failing check in the newer detail beats a green list summary", async () => {
    world.checks[0]!.conclusion = "FAILURE";
    const { text } = await cli(["pass"]);
    expect(text).toMatch(/#7\tNOT_READY/u);
    expect(text).toContain("Delivery checks");
  });

  test("a failed run superseded by a newer green run is a retained attempt, not a failure", async () => {
    world.checks = [
      {
        name: "Delivery checks",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: iso(-900_000),
        detailsUrl:
          "https://github.com/example-org/widgets/actions/runs/1/job/101",
      },
      {
        name: "Delivery checks",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: iso(-300_000),
        detailsUrl:
          "https://github.com/example-org/widgets/actions/runs/2/job/102",
      },
    ];
    world.runs = [
      { id: 1, run_number: 1, run_attempt: 1 },
      { id: 2, run_number: 2, run_attempt: 1 },
    ];
    world.jobs = {
      101: { run_id: 1, run_attempt: 1 },
      102: { run_id: 2, run_attempt: 1 },
    };
    const { text } = await cli(["pass"]);
    expect(text).toMatch(/#7\tNEEDS_JUDGMENT/u);
    expect(text).toContain("Delivery checks: 1 failed attempt retained");
  });

  test("a newer run's failure beats an older run's pass queued later (higher job ID)", async () => {
    world.checks = [
      {
        name: "Delivery checks",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl:
          "https://github.com/example-org/widgets/actions/runs/1/job/202",
      },
      {
        name: "Delivery checks",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl:
          "https://github.com/example-org/widgets/actions/runs/2/job/201",
      },
    ];
    world.runs = [
      { id: 1, run_number: 1, run_attempt: 1 },
      { id: 2, run_number: 2, run_attempt: 1 },
    ];
    world.jobs = {
      202: { run_id: 1, run_attempt: 1 },
      201: { run_id: 2, run_attempt: 1 },
    };
    expect((await cli(["pass"])).text).toMatch(/#7\tNOT_READY/u);
    // Without the jobs' executions, which run is newest is unknown.
    world.jobs = {};
    const unknown = await cli(["pass"]);
    expect(unknown.text).toMatch(/#7\tNOT_READY/u);
    expect(unknown.text).toContain("no way to tell the newest");
  });

  test("an old finding beyond the PR card's review window still blocks", async () => {
    world.reviews = [
      { reviewer: "rev5", commit: reviewed, result: "0/1 resolved, 1 new" },
      ...Array.from({ length: 140 }, () => confirm("rev2", fixed)),
      ...trio(fixed),
    ];
    const { text } = await cli(["pass"]);
    expect(text).toMatch(/#7\tNOT_READY/u);
    expect(text).toContain("rev5: 0/1 resolved, 1 new");
  });

  test("history that never ends is UNKNOWN, not complete", async () => {
    world.endless = true;
    const { text } = await cli(["pass"]);
    expect(text).toMatch(/#7\tUNKNOWN/u);
    expect(text).toContain("older findings may be missed");
  });

  test("required checks come from GitHub's rules; unreadable rules are UNKNOWN", async () => {
    world.rules = ["Delivery checks", "macOS lifecycle"];
    expect((await cli(["pass"])).text).toContain(
      "Required but not reported: macOS lifecycle",
    );
    world.rules = null;
    expect((await cli(["pass"])).text).toContain("Required checks unknown");
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        remote,
        requiredChecks: ["Delivery checks"],
      }),
    );
    expect((await cli(["pass"])).text).toMatch(/#7\tREADY/u);
  });

  test("a failed GitHub read records no pass", async () => {
    const failing: Run = () => ({ code: 1, stdout: "", stderr: "HTTP 502" });
    await expect(cli(["pass"], NOW, failing)).rejects.toThrow(
      "GitHub request failed",
    );
    const db = openStore(dbPath);
    try {
      expect(db.query("SELECT COUNT(*) AS n FROM pass").get()).toEqual({
        n: 0,
      });
    } finally {
      db.close();
    }
  });
});

describe("merge-line", () => {
  test("prints a head-pinned merge command for READY, never --admin", async () => {
    const { code, text } = await cli(["merge-line", "7"]);
    expect(code).toBe(0);
    expect(text).toBe(
      `gh pr merge 7 --repo example-org/widgets --merge --match-head-commit ${fixed}`,
    );
    expect(text).not.toContain("--admin");
  });

  test("a hold refuses the merge line at once, without a pass between (#390)", async () => {
    expect((await cli(["merge-line", "7"])).code).toBe(0);
    const hold = await cli([
      "hold",
      "7",
      "--reason",
      "owner repro",
      "--actor",
      "firstmate",
    ]);
    expect(hold.text).toContain("held: owner repro");
    const held = await cli(["merge-line", "7"]);
    expect(held.code).toBe(2);
    expect(held.text).toContain("Held: owner repro");
    expect((await cli(["check-claim", "7", fixed])).code).toBe(2);
    await cli(["release", "7"]);
    expect((await cli(["merge-line", "7"])).code).toBe(0);
  });

  test("refuses a missing confirmation, an outdated claim and a merged PR", async () => {
    world.reviews = [confirm("rev-opus", reviewed), ...trio(fixed).slice(0, 2)];
    const missing = await cli(["merge-line", "7"]);
    expect(missing.code).toBe(2);
    expect(missing.text).toContain("rev-opus");
    world.reviews = trio(reviewed);
    expect((await cli(["merge-line", "7"])).text).toContain("outdated");
    world.reviews = trio(fixed);
    world.state = "MERGED";
    const merged = await cli(["merge-line", "7"]);
    expect(merged.code).toBe(2);
    expect(merged.text).toContain("MERGED");
  });
});

describe("check-claim", () => {
  test("a READY claim is STALE once the head moves, with no pass between (A5)", async () => {
    world.reviews = trio(reviewed);
    publish(reviewed);
    const short = reviewed.slice(0, 7);
    expect((await cli(["check-claim", "7", short])).code).toBe(0);
    publish(fixed);
    const stale = await cli(["check-claim", "7", short], NOW + 86_400_000);
    expect(stale.code).toBe(2);
    expect(stale.text).toContain("STALE");
  });

  test("a claim on a PR that merged since is not READY", async () => {
    expect((await cli(["check-claim", "#7", fixed])).code).toBe(0);
    world.state = "MERGED";
    const merged = await cli(["check-claim", "7", fixed]);
    expect(merged.code).toBe(2);
    expect(merged.text).toContain("MERGED");
  });
});

describe("waive", () => {
  test("an unattributed finding blocks until waived by its source ID", async () => {
    world.reviews = [
      { reviewer: null, commit: reviewed, result: "1 new P2" },
      ...trio(fixed),
    ];
    expect((await cli(["pass"])).text).toMatch(/#7\tNEEDS_JUDGMENT/u);
    expect((await cli(["explain", "7"])).text).toContain("[review-1]");
    await expect(cli(["waive", "7", "review-1"])).rejects.toThrow(
      "waive needs --reason",
    );
    await cli(["waive", "7", "review-1", "--reason", "author confirmed fixed"]);
    expect((await cli(["merge-line", "7"])).code).toBe(0);
  });
});

describe("replay", () => {
  test("a recorded pass replays with its own config and fails on any difference", async () => {
    await cli(["pass"]);
    const same = await cli(["replay", "--pass", "1"]);
    expect(same.code).toBe(0);
    expect(same.text).toContain("0 verdict(s) differ from pass 1");
    writeFileSync(
      configPath,
      JSON.stringify({ ...config, remote, reviewers: { default: ["rev9"] } }),
    );
    const drift = await cli(["replay", "--pass", "1"]);
    expect(drift.code).toBe(0);
    expect(drift.text).toContain("config.json changed since pass 1");
    const db = openStore(dbPath);
    try {
      db.query("UPDATE verdict SET notes_json = '[]'").run();
    } finally {
      db.close();
    }
    const changed = await cli(["replay", "--pass", "1"]);
    expect(changed.code).toBe(1);
    expect(changed.text).toContain("1 verdict(s) differ from pass 1");
  });

  test("every acceptance case replays from fixture files", async () => {
    const dir = join(root, `fixtures-${databases}`);
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

describe("store", () => {
  const ready = () => input({ head: SHA.fixed, posts: trio(SHA.fixed) });
  const seed = (...inputs: ReturnType<typeof input>[]) => {
    const db = openStore(dbPath);
    try {
      recordPass(db, {
        trigger: "test",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs,
        verdicts: inputs.map((entry) => evaluate(entry, config, NOW)),
      });
    } finally {
      db.close();
    }
  };

  test("an identical recomputation writes no new verdict; a change is one transition (A8)", () => {
    seed(ready());
    seed(ready());
    seed(CASES.find((entry) => entry.name.startsWith("A1 "))!.input);
    seed(ready());
    const db = openStore(dbPath);
    try {
      expect(transitions(db, 0).map((entry) => entry.state)).toEqual([
        "READY",
        "NOT_READY",
        "READY",
      ]);
      expect(latestVerdict(db, 7)!.passId).toBe(4);
    } finally {
      db.close();
    }
  });

  test("deduplicates unchanged observations while preserving their read times", () => {
    const first = { ...ready(), readAt: NOW };
    const second = {
      ...ready(),
      readAt: NOW + 1_000,
      item: {
        ...ready().item!,
        prObservation: {
          ...ready().item!.prObservation!,
          readAt: NOW + 1_000,
          expiresAt: NOW + 1_000 + 60_000,
        },
      },
    };
    const firstWithFreshness = {
      ...first,
      item: {
        ...first.item!,
        prObservation: {
          ...first.item!.prObservation!,
          readAt: NOW,
          expiresAt: NOW + 60_000,
        },
      },
    };
    const db = openStore(dbPath);
    try {
      for (const entry of [firstWithFreshness, second])
        recordPass(db, {
          trigger: "test",
          config,
          startedAt: entry.readAt,
          finishedAt: entry.readAt,
          inputs: [entry],
          verdicts: [evaluate(entry, config, entry.readAt)],
        });
      expect(
        db.query("SELECT COUNT(*) AS n FROM observation_body").get(),
      ).toEqual({ n: 1 });
      expect(passInputs(db, 1)[0].readAt).toBe(NOW);
      expect(passInputs(db, 2)[0].readAt).toBe(NOW + 1_000);
      expect(passInputs(db, 1)[0].item?.prObservation?.readAt).toBe(NOW);
      expect(passInputs(db, 2)[0].item?.prObservation?.readAt).toBe(
        NOW + 1_000,
      );
      expect(passInputs(db, 2)[0].item?.prObservation?.expiresAt).toBe(
        NOW + 61_000,
      );
    } finally {
      db.close();
    }
  });

  test("migrates inline legacy observations and restores both freshness times", () => {
    const entry = {
      ...ready(),
      readAt: NOW - 1_000,
      item: {
        ...ready().item!,
        prObservation: {
          ...ready().item!.prObservation!,
          readAt: NOW - 2_000,
          expiresAt: NOW + 58_000,
        },
      },
    };
    let db = openStore(dbPath);
    db.query(
      "INSERT INTO pass (id, started_at, finished_at, trigger, parser_version, config_hash, config_json) VALUES (1, ?, ?, 'open', 1, 'legacy', ?)",
    ).run(NOW - 1_000, NOW - 1_000, JSON.stringify(config));
    db.query(
      "INSERT INTO observation (pass_id, pr, kind, head_sha, fetched_at, body_hash, body_json) VALUES (1, ?, 'input', ?, ?, 'legacy-hash', ?)",
    ).run(
      entry.number,
      entry.item!.headSha ?? "",
      entry.readAt,
      JSON.stringify(entry),
    );
    db.query(
      "DELETE FROM gate_meta WHERE key = 'deduplicated_observations'",
    ).run();
    db.close();

    db = openStore(dbPath);
    try {
      expect(
        db.query("SELECT COUNT(*) AS n FROM observation_body").get(),
      ).toEqual({ n: 1 });
      expect(passInputs(db, 1)[0].readAt).toBe(entry.readAt);
      expect(passInputs(db, 1)[0].item?.prObservation).toEqual(
        entry.item?.prObservation,
      );
    } finally {
      db.close();
    }
  });

  test("keeps verdict replay snapshots and check attempts indefinitely", () => {
    const db = openStore(dbPath);
    try {
      const old = NOW - 16 * 24 * 60 * 60 * 1000;
      const entry = { ...ready(), readAt: old };
      const verdict = evaluate(entry, config, NOW);
      for (const finishedAt of [old, NOW - 8 * 24 * 60 * 60 * 1000])
        recordPass(db, {
          trigger: "open",
          config,
          startedAt: finishedAt,
          finishedAt,
          inputs: [entry],
          verdicts: [verdict],
        });
      db.query(
        "INSERT INTO check_attempt (run_id, attempt, check_name, pr, head_sha, conclusion, completed_at) VALUES (1, 1, 'old', 7, ?, 'failure', ?)",
      ).run(SHA.fixed, old);
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs: [entry],
        verdicts: [verdict],
      });
      expect(passInputs(db, 1)).toHaveLength(1);
      expect(passConfig(db, 1)).toEqual(config);
      expect(passInputs(db, 2)).toHaveLength(1);
      expect(passInputs(db, 3)).toHaveLength(1);
      expect(db.query("SELECT COUNT(*) AS n FROM check_attempt").get()).toEqual(
        { n: 1 },
      );
    } finally {
      db.close();
    }
  });

  test("keeps decision history and all snapshots indefinitely", () => {
    const db = openStore(dbPath);
    try {
      const old = NOW - 16 * 24 * 60 * 60 * 1000;
      const original = { ...ready(), readAt: old };
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: old,
        finishedAt: old,
        inputs: [original],
        verdicts: [],
      });
      addDecision(db, {
        pr: original.number,
        kind: "hold",
        reason: "synthetic hold",
        actor: "owner",
        createdAt: old + 100,
      });
      const middleAt = NOW - 8 * 24 * 60 * 60 * 1000;
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: middleAt,
        finishedAt: middleAt,
        inputs: [{ ...original, readAt: middleAt }],
        verdicts: [],
      });
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs: [{ ...original, readAt: NOW }],
        verdicts: [],
      });
      expect(passInputs(db, 1)).toHaveLength(1);
      expect(passInputs(db, 2)).toHaveLength(1);
      expect(passInputs(db, 3)).toHaveLength(1);
      expect(db.query("SELECT id FROM pass WHERE id = 1").get()).not.toBeNull();
    } finally {
      db.close();
    }
  });

  test("retains closed and missing PR history beyond the former retention window", () => {
    const db = openStore(dbPath);
    try {
      const observedAt = NOW - 20 * 24 * 60 * 60 * 1000;
      const entry = { ...ready(), readAt: observedAt };
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: observedAt,
        finishedAt: observedAt,
        inputs: [entry],
        verdicts: [],
      });
      const absentAt = NOW - 19 * 24 * 60 * 60 * 1000;
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: absentAt,
        finishedAt: absentAt,
        inputs: [],
        verdicts: [],
      });
      db.query(
        "INSERT INTO check_attempt (run_id, attempt, check_name, pr, head_sha, conclusion, completed_at) VALUES (2, 1, 'old', 7, ?, 'failure', ?)",
      ).run(SHA.fixed, observedAt);
      recordPass(db, {
        trigger: "open",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs: [{ ...entry, number: 8, readAt: NOW }],
        verdicts: [],
      });
      expect(passInputs(db, 1)).toHaveLength(1);
      expect(db.query("SELECT id FROM pass WHERE id = 1").get()).not.toBeNull();
      expect(db.query("SELECT COUNT(*) AS n FROM check_attempt").get()).toEqual(
        { n: 1 },
      );
    } finally {
      db.close();
    }
  });

  test("retains every active PR pass after the former retention window", () => {
    const db = openStore(dbPath);
    try {
      const old = NOW - 16 * 24 * 60 * 60 * 1000;
      const entry = { ...ready(), readAt: old };
      recordPass(db, {
        trigger: "test",
        config,
        startedAt: old,
        finishedAt: old,
        inputs: [entry],
        verdicts: [],
      });
      const middleAt = NOW - 8 * 24 * 60 * 60 * 1000;
      const middle = { ...entry, readAt: middleAt };
      recordPass(db, {
        trigger: "test",
        config,
        startedAt: middleAt,
        finishedAt: middleAt,
        inputs: [middle],
        verdicts: [],
      });
      const current = { ...entry, readAt: NOW };
      recordPass(db, {
        trigger: "test",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs: [current],
        verdicts: [],
      });
      expect(db.query("SELECT COUNT(*) AS n FROM observation").get()).toEqual({
        n: 3,
      });
      expect(passInputs(db, 1)[0].readAt).toBe(old);
      expect(passInputs(db, 2)[0].readAt).toBe(middleAt);
      expect(passInputs(db, 3)[0].readAt).toBe(NOW);
    } finally {
      db.close();
    }
  });

  test("a pass that fails mid-write leaves nothing behind (A8)", () => {
    seed(ready());
    const db = openStore(dbPath);
    try {
      // The second verdict violates NOT NULL after the pass and its first
      // rows were written: the whole transaction must roll back.
      expect(() =>
        recordPass(db, {
          trigger: "test",
          config,
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

  test("a check listed as both a flake and an aggregate is refused", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        remote,
        flakes: ["Delivery checks"],
        aggregateChecks: ["Delivery checks"],
      }),
    );
    await expect(cli(["pass"])).rejects.toThrow(
      "Delivery checks as both a flake and an aggregate",
    );
  });

  test("hold needs a reason", async () => {
    await expect(cli(["hold", "7"])).rejects.toThrow("hold needs --reason");
  });
});
