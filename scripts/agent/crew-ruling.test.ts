import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { fixture, cleanupFixtures } from "./crew-round-fixture";
import { input, NOW, SHA } from "./gate/cases";
import { QUIET_MS } from "./crew/round-policy";
import { reviewCycles } from "./crew/round-policy-store";
import { getRun, getMeta, setMeta, setRunSession } from "./crew/store";
import { retainedReviewer } from "./crew/reviewer-session";
import { SETTINGS_DEFAULTS } from "./crew/plan";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchRun } from "./crew/launch";
import { roundFor } from "./crew/store";
afterEach(() => {
  cleanupDeliveries();
  cleanupFixtures();
});
test("a fourth physical container displays the third review ordinal without rewriting history", () => {
  const f = fixture();
  const dir = mkdtempSync(join(tmpdir(), "crew-cycle-label-"));
  try {
    for (const head of ["b", "c", "d"]) roundFor(f.db, 7, head.repeat(40), NOW);
    const round = roundFor(f.db, 7, "d".repeat(40), NOW);
    let label = "";
    const deps = {
      ...f.deps,
      spawn: (_argv: string[], _log: string, place: { label: string }) => {
        label = place.label;
        return { pid: 1000, pane: null, tab: null };
      },
    };
    const launched = launchRun(
      f.db,
      { dir, now: NOW, deps },
      {
        keys: ["review-current"],
        pr: 7,
        head: "d".repeat(40),
        name: "rev2",
        branch: "agent/feature",
        round,
        reviewOrdinal: 3,
      },
      () => ["bun", "crew.ts"],
    );
    expect(label).toEndWith("r3");
    expect(getRun(f.db, launched.id)?.round).toBe(4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("historical clean current-head evidence cannot finish a fresh full review or produce a Try", () => {
  const f = setup({
    seedCycle: false,
    settings: {
      convergingReviews: true,
      readyAsk: false,
      readySeat: "steward",
    },
  });
  const v = input({
    head: SHA.fixed,
    posts: [
      { reviewer: "rev2", commit: SHA.fixed, result: "0/0 resolved, 0 new" },
    ],
  });
  v.item!.pr!.uiChange = true;
  v.item!.pr!.images = 2;
  f.passInput(v, NOW);
  f.passInput(v, NOW + 1);
  expect(f.spawned).toHaveLength(1);
  expect(f.spawned[0]).not.toContain("--since");
  expect(getRun(f.crew, 1)?.finishedAt).toBeNull();
  expect(() => f.passInput({ ...v, item: undefined }, NOW + 2)).not.toThrow();
  expect(
    f.calls.some((a) => a.join(" ").startsWith("herdr agent prompt steward ")),
  ).toBe(false);
  setRunSession(f.crew, 1, "codex", "gpt-6.1-sol", "fresh-managed-session");
  // A configured old manual pin is not adopted into the new managed cohort.
  const selected = retainedReviewer(
    f.crew,
    {
      ...SETTINGS_DEFAULTS,
      roster: { rev2: { model: "gpt-6.1-sol" } },
      reviewerSessions: { "7": { rev2: "historical-session" } },
    },
    7,
    "rev2",
  );
  // Selection happens after completion, never by silently reusing the old pin.
  expect(selected.session).toBeUndefined();
  expect(reviewCycles(f.crew, 7)).toHaveLength(1);
});
test("an explicit scoped-confirm exception consumes one cycle and cannot authorize cycle five", () => {
  const f = fixture(3, {
    convergingReviews: true,
    reviewerSessions: { "7": { rev2: "retained-session" } },
  });
  setMeta(
    f.db,
    "confirmation-exception:7:3",
    JSON.stringify({
      authorizedBy: "firstmate-2",
      permission: "one-scoped-confirmation",
      afterOrdinal: 3,
      reviewedHead: SHA.reviewed,
      targetHead: SHA.fixed,
      reviewers: ["rev2"],
      usedCycle: null,
    }),
  );
  f.reply();
  f.pass();
  const actions = f.pass(undefined, NOW + QUIET_MS);
  expect(actions.find((a) => a.kind === "confirm")).toMatchObject({
    since: SHA.reviewed,
    target: "rev2",
  });
  expect(reviewCycles(f.db, 7).at(-1)?.ordinal).toBe(4);
  expect(
    JSON.parse(getMeta(f.db, "confirmation-exception:7:3")!).usedCycle,
  ).toBe(4);
  const after = input({
    head: SHA.other,
    posts: [
      { reviewer: "rev2", commit: SHA.fixed, result: "0/1 resolved, 0 new" },
    ],
  });
  const next = f.pass(after, NOW + 2 * QUIET_MS);
  expect(
    next.some(
      (a) =>
        a.kind === "confirm" || a.kind === "review" || a.kind === "evaluate",
    ),
  ).toBe(false);
  expect(next.some((a) => a.target === "firstmate-2")).toBe(true);
  expect(reviewCycles(f.db, 7).at(-1)?.ordinal).toBe(4);
});
test("zero slots under an owner hold admits no new first or later review cycle", () => {
  const f = fixture(2, {
    convergingReviews: true,
    maxRuns: 0,
    reviewerSessions: { "7": { rev2: "retained-session" } },
  });
  f.reply();
  f.pass();
  f.pass(undefined, NOW + QUIET_MS);
  expect(reviewCycles(f.db, 7)).toHaveLength(1);
  f.db.exec("DELETE FROM review_cycle");
  f.pass();
  expect(reviewCycles(f.db, 7)).toHaveLength(0);
});
