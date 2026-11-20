import { expect, test } from "bun:test";
import { usageFixture } from "./usageFixture";
import {
  usageDuration,
  usageByItem,
  usageByRole,
  usageConcurrency,
  usageCount,
  usagePaces,
  usageRunForPane,
  usageRuns,
  usageWindowPace,
} from "./usageModel";

const now = Date.parse("2026-11-20T15:20:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

test("pace: early, on track, unused, too soon, reached and unknown are told apart", () => {
  const week = 10080;
  const seen = now;
  const at = (used: number, resetIn: number) =>
    usageWindowPace(
      { window_minutes: week, used_percent: used, resets_at: seen + resetIn },
      seen,
    );
  // 4 of 7 days gone, 71% used: 124% by the reset, out ~1.3 days early.
  const early = at(71, 3 * DAY);
  expect(early.verdict).toBe("early");
  expect(Math.round(early.projected!)).toBe(124);
  expect(early.runsOutAt! - seen).toBeCloseTo(((100 - 71) * 4 * DAY) / 71, -3);
  expect(at(52, 3 * DAY).verdict).toBe("on-track");
  expect(at(18, 2 * DAY).verdict).toBe("unused");
  expect(at(3, 6.5 * DAY).verdict).toBe("too-soon");
  expect(at(100, DAY).verdict).toBe("reached");
  expect(
    usageWindowPace(
      { window_minutes: week, used_percent: 50, resets_at: null },
      seen,
    ).verdict,
  ).toBe("unknown");
});

test("pace reads the Town sign's observation, week first, and stale readings claim nothing", () => {
  const data = usageFixture(now, "busy", { group_by: "run", window: "7d" });
  const paces = usagePaces(data.limits, now);
  expect(paces.map((p) => [p.name, p.label, p.verdict])).toEqual([
    ["Claude", "week", "early"],
    ["Claude", "5 h", "unused"],
    ["Codex", "week", "unused"],
    ["Codex", "5 h", "too-soon"],
  ]);
  const later = usagePaces(data.limits, now + 4 * HOUR);
  expect(later.every((p) => p.verdict === "unknown" && p.stale)).toBe(true);
  const reached = usageFixture(now, "reached", { group_by: "run" });
  expect(usagePaces(reached.limits, now)[0]).toMatchObject({
    name: "Claude",
    verdict: "reached",
    used: null,
  });
});

test("runs: items, fixer rounds, near-full context and heavy calls stand out", () => {
  const data = usageFixture(now, "busy", { group_by: "run", window: "7d" });
  const runs = usageRuns(data);
  expect(runs[0]).toMatchObject({
    role: "fixer",
    item: { label: "#101" },
    round: 3,
    live: true,
    context: { percent: 86 },
  });
  expect(runs[0]!.flags).toContain("fixer round 3 on #101");
  expect(runs[0]!.flags).toContain("context 86% full");
  expect(runs.filter((r) => r.live)).toHaveLength(3);
  const items = usageByItem(runs);
  expect(items[0]).toMatchObject({ item: { label: "#101" }, fixerRounds: 3 });
  expect(items[items.length - 1]?.item.label).not.toBe("#101");
  const roles = usageByRole(runs);
  expect(roles.map((r) => r.label)).toEqual([
    "Worker",
    "Fixer",
    "Reviewer",
    "Checker",
    "Scout",
    "Unknown role",
  ]);
  expect(roles.find((r) => r.role === "fixer")?.runs).toBe(3);
  expect(
    usageRunForPane(runs, {
      connectionId: "fixture",
      generation: 1,
      paneId: runs[0]!.identity!.pane_id!,
    })?.key,
  ).toBe(runs[0]!.key);
});

test("runs at once: each run counts once per hour, split by harness and work", () => {
  const data = usageFixture(now, "busy", { group_by: "run", window: "7d" });
  const runs = usageRuns(data);
  const at = usageConcurrency(runs, data);
  expect(at.hours).toHaveLength(24);
  expect(at.harnesses).toEqual(["claude", "codex"]);
  const current = at.hours[at.hours.length - 1]!;
  expect(current.counts.get("claude")).toEqual({
    building: 1,
    checking: 1,
    other: 0,
  });
  expect(current.counts.get("codex")).toEqual({
    building: 1,
    checking: 0,
    other: 0,
  });
  expect(at.max).toBeGreaterThanOrEqual(2);
});

test("empty reads are unknown, never zero", () => {
  const data = usageFixture(now, "empty", { group_by: "run", window: "7d" });
  expect(usageRuns(data)).toEqual([]);
  expect(data.total.total_tokens.value).toBeNull();
  expect(usageCount(data.total.total_tokens.value)).toBe("unknown");
  expect(usageCount(0)).toBe("0");
  expect(usageCount(1_234_567)).toBe("1.2M");
  expect(usageCount(56_400)).toBe("56k");
});

test("time spent reads in minutes, then hours", () => {
  expect(usageDuration(45 * 60_000)).toBe("45 min");
  expect(usageDuration(90 * 60_000)).toBe("1.5 h");
  expect(usageDuration(3 * 3_600_000)).toBe("3 h");
  expect(usageDuration(30 * 3_600_000)).toBe("30 h");
});
