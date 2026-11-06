import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { fixture, cleanupFixtures } from "./crew-round-fixture";
import { NOW, SHA, input } from "./gate/cases";
import { QUIET_MS } from "./crew/round-policy";
import { reviewCycles } from "./crew/round-policy-store";
import { usageSince } from "./crew/worker";
import { runSession } from "./crew/review";
import {
  addRun,
  getRun,
  finishRun,
  setRunUsageBaseline,
  setRunSession,
} from "./crew/store";
import { completeManualReviews } from "./crew/run-lifecycle";
import { spend } from "./crew/status";

afterEach(() => {
  cleanupDeliveries();
  cleanupFixtures();
});

test("crewPass holds a legacy adoption boundary without hiding an earlier open RESULT or launching a replacement", () => {
  const f = setup({
    seedCycle: false,
    settings: {
      convergingReviews: true,
      readyAsk: false,
      reviewJudgmentSeat: "steward",
      reviewStarts: { "7": { head: SHA.reviewed, at: NOW - 100 } },
      reviewerSessions: { "7": { rev2: "original-session" } },
    },
  });
  const actions = f.pass(SHA.fixed, NOW + QUIET_MS);
  expect(f.spawned).toHaveLength(0);
  expect(
    actions.some((action) => ["review", "confirm"].includes(action.kind)),
  ).toBe(false);
  expect(
    actions.some(
      (action) =>
        action.kind === "judgment" &&
        action.text.includes("legacy reviewStarts"),
    ),
  ).toBe(true);
  expect(reviewCycles(f.crew, 7)).toHaveLength(0);
});

test.each([false, true])(
  "three same-head manual rounds stay held even with an already undercounted cycle: %s",
  (existing) => {
    const f = fixture(1, {
      convergingReviews: true,
      reviewerSessions: { "7": { rev2: "original-session" } },
    });
    if (!existing) f.db.exec("DELETE FROM review_cycle");
    const value = input({
      head: SHA.reviewed,
      posts: [
        "0/0 resolved, 1 new",
        "0/1 resolved, 0 new",
        "0/1 resolved, 0 new",
      ].map((result) => ({ reviewer: "rev2", commit: SHA.reviewed, result })),
    });
    const actions = f.pass(value, NOW + QUIET_MS);
    expect(
      actions.some((action) =>
        ["review", "confirm", "evaluate"].includes(action.kind),
      ),
    ).toBe(false);
    expect(
      actions.some(
        (action) =>
          action.kind === "judgment" && action.text.includes("round count"),
      ),
    ).toBe(true);
    expect(reviewCycles(f.db, 7)).toHaveLength(existing ? 1 : 0);
  },
);

test("worker resumes persist a baseline and report only the session increment", async () => {
  const f = fixture();
  const id = addRun(
    f.db,
    {
      actionKey: "worker",
      pr: 7,
      head: SHA.fixed,
      reviewer: "rev2",
      log: "stdout",
    },
    NOW,
  );
  let total = 100;
  const result = await runSession(
    f.db,
    id,
    { model: "gpt-6.1-sol", harness: "codex" },
    "confirm",
    "/synthetic/review",
    () => {},
    {
      resume: "saved-session",
      baselineCwd: "/synthetic/earlier-review",
      usage: ({ cwd }) => {
        expect(cwd).toBe(
          total === 100 ? "/synthetic/earlier-review" : "/synthetic/review",
        );
        return JSON.stringify({ total_tokens: total });
      },
      spawn: () => {
        expect(getRun(f.db, id)?.usageBaseline).toBe('{"total_tokens":100}');
        total = 150;
        return { exited: Promise.resolve(0), kill: () => {} };
      },
    },
  );
  expect(JSON.parse(result.usage!)).toEqual({ total_tokens: 50 });
  finishRun(f.db, id, result.code, result.usage, NOW + 1);
  expect(JSON.parse(getRun(f.db, id)!.usage!)).toEqual({ total_tokens: 50 });
});

test("watcher completion and reporting windows keep repeated-session totals at 150, not 250", () => {
  const f = fixture();
  const first = addRun(
    f.db,
    {
      actionKey: "first",
      pr: 7,
      head: SHA.reviewed,
      reviewer: "rev2",
      log: "stdout",
    },
    0,
  );
  finishRun(f.db, first, 0, '{"total_tokens":100}', 1);
  const second = addRun(
    f.db,
    {
      actionKey: `manual:7:${SHA.fixed}:rev2`,
      pr: 7,
      head: SHA.fixed,
      reviewer: "rev2",
      log: "stdout",
    },
    1,
  );
  setRunUsageBaseline(f.db, second, '{"total_tokens":100}');
  setRunSession(f.db, second, "codex", "gpt-6.1-sol", "saved-session");
  f.deps.usage = (run) => usageSince('{"total_tokens":150}', run.usageBaseline);
  const value = input({
    head: SHA.fixed,
    posts: [
      { reviewer: "rev2", commit: SHA.fixed, result: "0/0 resolved, 0 new" },
    ],
  });
  completeManualReviews(f.db, [value], "/synthetic/gate", NOW, f.deps);
  const runs = [getRun(f.db, first)!, getRun(f.db, second)!];
  expect(JSON.parse(runs[1]!.usage!)).toEqual({ total_tokens: 50 });
  const output: string[] = [];
  spend(
    runs,
    () => [],
    24,
    (line) => output.push(line),
  );
  expect(output[0]).toContain("150");
  expect(output[0]).not.toContain("250");
  const later: string[] = [];
  spend(
    [runs[1]!],
    () => [],
    1,
    (line) => later.push(line),
  );
  expect(later[0]).toContain("50");
});

test("unknown or reset baselines cannot be charged as whole-session usage", () => {
  expect(usageSince('{"total_tokens":150}', "null")).toBeNull();
  expect(usageSince('{"total_tokens":90}', '{"total_tokens":100}')).toBeNull();
  expect(
    usageSince('{"total_tokens":150}', '{"total_tokens":"unknown"}'),
  ).toBeNull();
});

test("legacy active confirmations retain raw receipts while missing resume baselines are explicitly unknown", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { Database } = await import("bun:sqlite");
  const { openCrewStore, addAction } = await import("./crew/store");
  const path = mkdtempSync(join(tmpdir(), "crew-usage-migration-"));
  const file = join(path, "crew.sqlite");
  let db = openCrewStore(file);
  try {
    const key = "legacy-confirm";
    addAction(
      db,
      {
        pr: 7,
        head: SHA.fixed,
        key,
        kind: "confirm",
        target: "rev2",
        text: "confirm",
      },
      NOW,
    );
    const id = addRun(
      db,
      {
        actionKey: key,
        reviewer: "rev2",
        pr: 7,
        head: SHA.fixed,
        log: "stdout",
      },
      NOW,
    );
    setRunSession(db, id, "codex", "gpt-6.1-sol", "saved-session");
    const first = addRun(
      db,
      {
        actionKey: "first-finished",
        reviewer: "rev2",
        pr: 7,
        head: SHA.reviewed,
        log: "stdout",
      },
      1,
    );
    setRunSession(db, first, "codex", "gpt-6.1-sol", "other-saved-session");
    finishRun(db, first, 0, '{"total_tokens":100}', 2);
    const repeated = addRun(
      db,
      {
        actionKey: "repeated-finished",
        reviewer: "rev2",
        pr: 7,
        head: SHA.fixed,
        log: "stdout",
      },
      3,
    );
    setRunSession(db, repeated, "codex", "gpt-6.1-sol", "other-saved-session");
    finishRun(db, repeated, 0, '{"total_tokens":150}', 4);
    db.close();
    const old = new Database(file);
    old.exec("ALTER TABLE run DROP COLUMN usage_baseline");
    old.close();
    db = openCrewStore(file);
    expect(getRun(db, id)?.usageBaseline).toBe("null");
    expect(getRun(db, first)?.usageBaseline).toBeUndefined();
    expect(getRun(db, repeated)?.usageBaseline).toBe("null");
    expect(getRun(db, repeated)?.usage).toBe('{"total_tokens":150}');
    const known: string[] = [];
    spend(
      [getRun(db, first)!, getRun(db, repeated)!],
      () => [],
      24,
      (line) => known.push(line),
    );
    expect(known[0]).toContain("100 known");
    const laterWindow: string[] = [];
    spend(
      [getRun(db, repeated)!],
      () => [],
      1,
      (line) => laterWindow.push(line),
    );
    expect(laterWindow[0]).toContain("0 known");
    finishRun(db, id, 0, '{"total_tokens":150}', NOW + 1);
    expect(getRun(db, id)?.usage).toBe('{"total_tokens":150}');
    const output: string[] = [];
    spend(
      [getRun(db, id)!],
      () => [],
      1,
      (line) => output.push(line),
    );
    expect(output[0]).toContain("0 known");
    expect(output.join("\n")).toContain("usage unknown");
  } finally {
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test("a retained legacy boundary on a merged PR cannot create a new reconciliation ask", () => {
  const f = setup({
    seedCycle: false,
    settings: {
      convergingReviews: true,
      readyAsk: false,
      reviewJudgmentSeat: "steward",
      reviewStarts: { "7": { head: SHA.reviewed, at: NOW - 100 } },
    },
  });
  const actions = f.passInput(
    input({ head: SHA.reviewed, state: "MERGED", posts: [] }),
  );
  expect(actions).toEqual([]);
  expect(f.spawned).toHaveLength(0);
});
