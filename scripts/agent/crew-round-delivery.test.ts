import {
  setup,
  cleanups,
  cleanupDeliveries,
} from "./crew-round-delivery-fixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crewPass } from "./crew";
import { config, input, NOW, SHA } from "./gate/cases";
import { evaluate } from "./gate/predicate";
import { SETTINGS_DEFAULTS } from "./crew/plan";
import { crewVerdict } from "./crew/round-readiness";
import {
  cycleForRun,
  evaluations,
  reviewCycles,
  saveEvaluation,
} from "./crew/round-policy-store";
import {
  actionsIn,
  activeRuns,
  getAction,
  getRun,
  openLock,
  openRounds,
  setMeta,
} from "./crew/store";

afterEach(cleanupDeliveries);

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
  f.pass(SHA.reviewed, NOW + 600_001);
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

test("a clean-reviewed PR carries review evidence over a synthetic-fixture-only push and waits for green checks", () => {
  const f = setup();
  const original = f.deps.run;
  f.deps.run = (argv) =>
    argv.includes("diff")
      ? {
          code: 0,
          stdout: "web/src/world/testing/pullRequestFixture.ts\0",
          stderr: "",
        }
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
