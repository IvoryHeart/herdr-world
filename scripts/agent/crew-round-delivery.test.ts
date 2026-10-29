import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crewPass } from "./crew";
import type { Deps } from "./crew/deps";
import { config, input, NOW, SHA } from "./gate/cases";
import { evaluate } from "./gate/predicate";
import { SETTINGS_DEFAULTS } from "./crew/plan";
import { crewVerdict } from "./crew/round-readiness";
import {
  cycleForRun,
  evaluations,
  reviewCycles,
  saveCycle,
  saveEvaluation,
} from "./crew/round-policy-store";
import {
  actionsIn,
  activeRuns,
  getAction,
  getRun,
  openCrewStore,
  openLock,
  openRounds,
  roundFor,
  setMeta,
} from "./crew/store";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "crew-round-delivery-"));
  const dir = join(root, ".agents", "crew-gate");
  const configPath = join(root, "config.json");
  const settings = {
    ...SETTINGS_DEFAULTS,
    maxRuns: 1,
    authors: { "7": "builder" },
    roster: {
      rev2: { model: "gpt-6.1-sol" },
      evaluator: { model: "claude-opus-5-5", effort: "high" },
      visionary: { model: "claude-opus-5-5" },
    },
  };
  const gateConfig = { ...config, reviewers: { default: ["rev2"] } };
  writeFileSync(configPath, JSON.stringify({ ...gateConfig, crew: settings }));
  const crew = openCrewStore(":memory:");
  const lock = openLock(":memory:");
  cleanups.push(() => {
    crew.close();
    lock.close();
    rmSync(root, { recursive: true, force: true });
  });
  const round = roundFor(crew, 7, SHA.reviewed, NOW - 1_000_000);
  saveCycle(crew, {
    pr: 7,
    head: SHA.reviewed,
    round: round.round,
    ordinal: 2,
    reviewers: ["rev2"],
    trigger: {
      replies: [],
      quietSince: NOW - 1_000_000,
      reason: "synthetic round 2",
    },
  });
  let posts = [
    {
      id: 101,
      body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 1 new\nP2 src/widget.ts:10 incorrect recovery`,
      created_at: new Date(NOW - 60_000).toISOString(),
      html_url:
        "https://github.com/example-org/widgets/pull/7#pullrequestreview-101",
    },
  ];
  const spawned: string[][] = [];
  const killed: number[] = [];
  const calls: string[][] = [];
  const deps: Deps = {
    run: (argv) => {
      calls.push(argv);
      let stdout = "";
      if (argv.join(" ") === "herdr agent list")
        stdout = '{"result":{"agents":[]}}';
      else if (argv[0] === "gh" && argv.includes("--paginate"))
        stdout = JSON.stringify([
          argv.at(-1)!.includes("issues/7/comments") ? posts : [],
        ]);
      else if (argv[0] === "herdr-world")
        stdout = '{"ok":true,"result":{"id":"q-synthetic"}}';
      else if (argv.includes("rev-list"))
        stdout = `${SHA.fixed} ${SHA.reviewed}\n`;
      else if (argv.includes("diff")) stdout = "src/widget.ts\0";
      return { code: 0, stdout, stderr: "" };
    },
    spawn: (argv) => {
      spawned.push(argv);
      return { pid: 1000 + spawned.length, pane: null, tab: null };
    },
    alive: () => true,
    kill: (pid) => killed.push(pid),
    usage: () => null,
    closeTab: () => true,
    openTab: () => null,
    out: () => {},
  };
  const value = (head = SHA.reviewed, clear = false) =>
    input({
      head,
      posts: [
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: clear ? "1/1 resolved, 0 new" : "0/0 resolved, 1 new",
        },
      ],
      item: { branch: "agent/builder-7" },
    });
  const pass = (head = SHA.reviewed, now = NOW, clear = false) => {
    const item = value(head, clear);
    return crewPass({
      crew,
      lock,
      judge: () => ({
        verdicts: [evaluate(item, gateConfig, NOW)],
        inputs: [item],
      }),
      configPath,
      dir,
      prs: [],
      dryRun: false,
      now,
      deps,
      worker: ["bun", "crew.ts"],
    });
  };
  const comment = (body: string) => {
    posts = [
      ...posts,
      {
        id: 200 + posts.length,
        body,
        created_at: new Date(NOW + 1).toISOString(),
        html_url:
          "https://github.com/example-org/widgets/pull/7#issuecomment-201",
      },
    ];
  };
  return { crew, deps, spawned, killed, calls, pass, comment };
}

test("watcher starts one evaluator after round 2 and preserves it across pushes", () => {
  const f = setup();
  f.pass();
  f.pass(SHA.fixed, NOW + 60_000);
  f.pass(SHA.fixed, NOW + 120_000);
  expect(f.spawned).toHaveLength(1);
  expect(f.spawned[0]).toContain("evaluate");
  expect(f.spawned[0]).toContain("--evaluation");
  expect(activeRuns(f.crew)).toHaveLength(1);
  expect(f.killed).toEqual([]);
  expect(openRounds(f.crew)).toHaveLength(1);
  expect(evaluations(f.crew, 7)).toHaveLength(1);
});

test("go with only follow-ups opens a new same-head round, not completed by old results", () => {
  const f = setup();
  f.pass();
  f.comment(
    `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nRequired: none\nFollow-up: rev2:101:1 -> https://github.com/example-org/widgets/issues/9\nEVALUATION #7: go — confirm disposition`,
  );
  f.pass(SHA.reviewed, NOW + 600_000);
  expect(f.spawned).toHaveLength(2);
  expect(f.spawned[1]).toContain("review");
  const cycle = reviewCycles(f.crew, 7).at(-1)!;
  expect(cycle).toMatchObject({ ordinal: 3, head: SHA.reviewed, scope: [] });
  expect(
    cycleForRun(f.crew, 7, SHA.reviewed, getRun(f.crew, 2)!.round)?.scope,
  ).toEqual([]);
  expect(openRounds(f.crew)).toHaveLength(2);
  const action = actionsIn(f.crew, ["running"]).find(
    (action) => action.kind === "confirm",
  )!;
  expect(action.key).toEndWith(":round-3");
  f.pass(SHA.reviewed, NOW + 660_000);
  expect(getAction(f.crew, action.key)!.state).toBe("running");
  expect(f.spawned).toHaveLength(2);
  expect(getRun(f.crew, 1)!.result).toStartWith("EVALUATION #7: go");
});

test("no-go starts the selected process once, asks at reception and holds across pushes", () => {
  const f = setup();
  f.pass();
  f.comment(
    `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nProcess: visionary\nSeat: visionary\nReason: revisit the API contract\nEVALUATION #7: no-go — design first`,
  );
  f.pass();
  f.pass(SHA.fixed, NOW + 60_000);
  f.pass(SHA.fixed, NOW + 120_000);
  expect(f.spawned.map((argv) => argv[2])).toEqual(["evaluate", "process"]);
  expect(
    f.calls.some(
      (argv) =>
        argv[0] === "herdr-world" &&
        argv[1] === "ask" &&
        argv.includes("--owner-only"),
    ),
  ).toBe(true);
  expect(evaluations(f.crew, 7)[0]!.status).toBe("process");
  expect(activeRuns(f.crew)[0]!.reviewer).toBe("visionary");
  expect(f.killed).toEqual([]);
  f.comment(
    "[visionary]\nEvaluation: 2\nPROCESS #7: done — design posted on issue",
  );
  f.pass(SHA.fixed, NOW + 180_000);
  expect(evaluations(f.crew, 7)[0]!.status).toBe("reported");
  expect(activeRuns(f.crew)).toEqual([]);
});

test("an evaluator process hold revokes an already green crew merge-ready mark", () => {
  const f = setup();
  saveEvaluation(f.crew, {
    pr: 7,
    checkpoint: 2,
    head: SHA.reviewed,
    round: 1,
    status: "process",
    process: "owner",
    next: "choose the contract",
    findings: [],
  });
  setMeta(
    f.crew,
    `mark:7:${SHA.reviewed}:crew/merge-ready`,
    JSON.stringify({ state: "success", description: "was ready" }),
  );
  // The gate can become READY while the evaluator's process is still held.
  f.pass(SHA.reviewed, NOW, true);
  const statuses = f.calls.filter((argv) =>
    argv.some((arg) => arg === "context=crew/merge-ready"),
  );
  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toContain("state=pending");
  expect(f.spawned).toEqual([]);
});

test("a clean-reviewed PR carries review evidence over a CI-only push and waits for green checks", () => {
  const f = setup();
  const original = f.deps.run;
  f.deps.run = (argv) =>
    argv.includes("diff")
      ? { code: 0, stdout: ".github/workflows/ci.yml\0", stderr: "" }
      : original(argv);
  const clean = input({
    head: SHA.fixed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "1/1 resolved, 0 new" },
    ],
    checks: [{ name: "Delivery checks", state: "pending", required: true }],
  });
  const judge = () => ({
    verdicts: [
      evaluate(clean, { ...config, reviewers: { default: ["rev2"] } }, NOW),
    ],
    inputs: [clean],
  });
  const root = mkdtempSync(join(tmpdir(), "crew-carry-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      reviewers: { default: ["rev2"] },
      crew: {
        ...SETTINGS_DEFAULTS,
        roster: { rev2: { model: "gpt-6.1-sol" } },
      },
    }),
  );
  const lock = openLock(":memory:");
  cleanups.push(() => lock.close());
  const pass = () =>
    crewPass({
      crew: f.crew,
      lock,
      judge,
      configPath,
      dir: root,
      prs: [],
      dryRun: false,
      now: NOW,
      deps: f.deps,
      worker: ["bun", "crew.ts"],
    });
  pass();
  expect(crewVerdict(f.crew, judge().verdicts[0]!, clean).state).not.toBe(
    "READY",
  );
  clean.item!.checks = "pass";
  clean.item!.pr!.checks[0]!.state = "pass";
  const actions = pass();
  expect(actions.some((action) => action.kind === "ready")).toBe(true);
  expect(
    f.calls.some(
      (argv) =>
        argv.includes("context=crew/merge-ready") &&
        argv.includes("state=success"),
    ),
  ).toBe(true);
  expect(f.spawned).toEqual([]);
  // A new finding on this head invalidates the carried evidence immediately.
  clean.item!.pr!.reviewers[0]!.outcome = "open";
  expect(crewVerdict(f.crew, judge().verdicts[0]!, clean).state).not.toBe(
    "READY",
  );
});
