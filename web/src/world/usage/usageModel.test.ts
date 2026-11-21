import { expect, test } from "bun:test";
import { usageFixture } from "./usageFixture";
import {
  usageAgentFacts,
  usageAgentRows,
  usageDuration,
  usageSumRows,
  usageByItem,
  usageByRole,
  usageConcurrency,
  usageCount,
  usagePaces,
  usagePeakAtOnce,
  usageRunFacts,
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
  // Three log runs and a Cursor agent World sees at work.
  expect(runs.filter((r) => r.live)).toHaveLength(4);
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

test("runs at once: the busiest moment of each hour, split by harness and work", () => {
  const data = usageFixture(now, "busy", { group_by: "run", window: "7d" });
  const runs = usageRuns(data);
  const at = usageConcurrency(runs, data);
  expect(at.hours).toHaveLength(24);
  expect(at.harnesses).toEqual(["claude", "codex", "cursor", "opencode"]);
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
  expect(current.counts.get("cursor")).toEqual({
    building: 0,
    checking: 0,
    other: 1,
  });
  expect(at.max).toBeGreaterThanOrEqual(2);
});

test("runs at once counts overlap, not runs that answered somewhere in the hour", () => {
  const h = Date.parse("2026-11-20T12:00:00Z");
  const run = (from: number, to: number, work = "building" as const) => ({
    spans: [[h + from * 60_000, h + to * 60_000]] as [number, number][],
    work,
  });
  // 12:05–12:06 and 12:30–12:31 never overlap: one at once, not two.
  expect(usagePeakAtOnce([run(5, 6), run(30, 31)], h, h + HOUR)).toEqual({
    building: 1,
    checking: 0,
    other: 0,
  });
  // Overlapping runs count together; one touching the next counts too.
  expect(
    usagePeakAtOnce(
      [run(5, 40), run(40, 50, "checking" as never)],
      h,
      h + HOUR,
    ),
  ).toEqual({ building: 1, checking: 1, other: 0 });
  expect(usagePeakAtOnce([run(5, 40), run(30, 31)], h, h + HOUR)).toEqual({
    building: 2,
    checking: 0,
    other: 0,
  });
  // A long run is going in every hour it spans, not only where it answered.
  const long = [run(-90, 70)];
  expect(usagePeakAtOnce(long, h - HOUR, h)?.building).toBe(1);
  expect(usagePeakAtOnce(long, h, h + HOUR)?.building).toBe(1);
  expect(usagePeakAtOnce(long, h + HOUR, h + 2 * HOUR)).toEqual({
    building: 1,
    checking: 0,
    other: 0,
  });
  expect(usagePeakAtOnce(long, h + 2 * HOUR, h + 3 * HOUR)).toBeNull();
});

test("a harness World reads no log of shows its time; tokens are not available, never zero", () => {
  const data = usageFixture(now, "busy", { group_by: "run", window: "7d" });
  const runs = usageRuns(data);
  const cursor = runs.find((r) => r.harness === "cursor")!;
  expect(cursor).toMatchObject({
    source: "world",
    tokensReadable: false,
    tokens: null,
    calls: null,
    waitingMs: 25 * 60_000,
    live: true,
  });
  expect(cursor.activeMs).toBeGreaterThan(0);
  expect(usageRunFacts(cursor)).toContain(
    "tokens and cost not available for this harness",
  );
  expect(usageRunFacts(cursor)).not.toMatch(/\b0 tokens/);
  // An agent of a harness World reads whose log has no run yet (before its
  // first response, or an unreadable log) is still a run World measured.
  const claude = {
    ...data,
    rows: data.rows.map((row) =>
      row.run?.harness === "cursor"
        ? { ...row, run: { ...row.run, harness: "claude" } }
        : row,
    ),
  };
  const early = usageRuns(claude).find(
    (r) => r.source === "world" && r.harness === "claude",
  )!;
  expect(early).toMatchObject({ tokensReadable: true, live: true });
  expect(usageRunFacts(early)).toContain("tokens unknown");
  // A log run World could not tie to the agent (its pane is gone) that went
  // at the same time on the same connection counts that work: not twice.
  const world = claude.rows.find((r) => r.key === early.key)!;
  const log = claude.rows.find((r) => r.run?.source === "session-log")!;
  const unjoined = {
    ...claude,
    rows: [
      ...claude.rows,
      {
        ...log,
        key: `run_${"f".repeat(64)}`,
        dimension: `run_${"f".repeat(64)}`,
        identity: { ...world.identity!, pane_id: null, agent_id: null },
        run: { ...log.run!, harness: "claude", spans: world.run!.spans },
      },
    ],
  };
  expect(usageRuns(unjoined).some((r) => r.key === early.key)).toBe(false);
  const added = unjoined.rows[unjoined.rows.length - 1]!.identity!;
  // Another pane's or agent's log run is someone else's work: it stays.
  added.pane_id = "another-pane";
  expect(usageRuns(unjoined).some((r) => r.key === early.key)).toBe(true);
  added.pane_id = null;
  added.agent_id = "another-agent";
  expect(usageRuns(unjoined).some((r) => r.key === early.key)).toBe(true);
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

test("one agent's week: its rows by agent ID, summed, in the card line's words", () => {
  const data = usageFixture(now, "busy", { group_by: "agent", window: "7d" });
  // Linus ran twice: a 3 h worker and a 2 h fixer, 9.4M + 4.8M tokens.
  const rows = usageAgentRows(data, ["fixture-agent-0", "fixture-agent-2"]);
  expect(rows.map((row) => row.dimension)).toEqual([
    "fixture-agent-0",
    "fixture-agent-2",
  ]);
  const sum = usageSumRows(rows);
  expect(sum.active_ms).toEqual({ value: 5 * HOUR, coverage: "partial" });
  expect(sum.total_tokens.value).toBe(14_200_000);
  expect(usageAgentFacts(sum, "claude")).toBe(
    "This week: at work 5 h · waited on you 0 min · 14M tokens",
  );
  // A harness World reads no log of: tokens are not available, never 0.
  const logless = usageSumRows(usageAgentRows(data, ["fixture-agent-14"]));
  expect(usageAgentFacts(logless, "cursor")).toBe(
    "This week: at work 4.6 h · waited on you 25 min · tokens and cost not available for this harness",
  );
  // No row this week, or rows of another grouping: unknown.
  expect(usageAgentRows(data, ["agent_gone"])).toEqual([]);
  expect(
    usageAgentRows(
      usageFixture(now, "busy", { group_by: "run", window: "7d" }),
      ["fixture-agent-0"],
    ),
  ).toEqual([]);
  expect(usageAgentFacts(null, "claude")).toBe("This week: usage unknown");
  // Sums are honest: all unknown stays unknown; a mix is partly read.
  const unknown = usageSumRows(
    usageAgentRows(
      usageFixture(now, "busy", { group_by: "agent", window: "7d" }),
      ["fixture-agent-14"],
    ),
  ).total_tokens;
  expect(unknown).toEqual({ value: null, coverage: "unknown" });
  const observed = {
    ...sum,
    total_tokens: { value: 5, coverage: "observed" as const },
  };
  expect(usageSumRows([observed, observed]).total_tokens).toEqual({
    value: 10,
    coverage: "observed",
  });
  expect(usageSumRows([observed, logless]).total_tokens).toEqual({
    value: 5,
    coverage: "partial",
  });
  expect(usageAgentFacts(usageSumRows([logless]), "claude")).toContain(
    "tokens unknown",
  );
});
