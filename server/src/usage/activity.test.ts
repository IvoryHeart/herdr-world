import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageActivity } from "./activity";
const at = Date.parse("2026-11-19T23:59:55Z");
const pane = {
  pane_id: "p1",
  terminal_id: "t1",
  workspace_id: "w1",
  agent: "claude",
  agent_session: { kind: "id", value: "synthetic" },
  agent_status: "working",
};
test("observed time splits UTC days, does not double count and stops at invalidation", () => {
  const activity = new UsageActivity();
  activity.observe("host-a", 1, [pane], at);
  expect(activity.read(at + 10_000).map((r) => r.active_ms)).toEqual([
    5000, 5000,
  ]);
  expect(activity.read(at + 10_000).map((r) => r.active_ms)).toEqual([
    5000, 5000,
  ]);
  activity.invalidate("host-a", at + 11_000);
  expect(activity.read(at + 100_000).reduce((s, r) => s + r.active_ms, 0)).toBe(
    11_000,
  );
});
test("unobserved gaps, idle and limit stops are never waiting on a person", () => {
  const activity = new UsageActivity();
  for (const [i, status] of ["working", "idle", "blocked"].entries()) {
    activity.observe(
      "a",
      1,
      [{ ...pane, agent_status: status }],
      at + i * 60_000,
    );
    activity.invalidate("a", at + i * 60_000 + 20_000);
  }
  const rows = activity.read(at + 180_000);
  expect(rows.reduce((s, r) => s + r.active_ms, 0)).toBe(15_000);
  expect(rows.reduce((s, r) => s + r.waiting_on_you_ms, 0)).toBe(15_000);
  const limited = new UsageActivity();
  limited.observe(
    "a",
    1,
    [{ ...pane, agent_status: "blocked", blocked_kind: "usage_limit" }],
    at,
  );
  expect(limited.read(at + 1000)[0]?.waiting_on_you_ms ?? 0).toBe(0);
});
test("numeric history survives restart but open intervals never resume", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-history-"));
  try {
    const path = join(dir, "history.json"),
      first = new UsageActivity(path);
    first.observe("a", 1, [pane], at);
    first.close(at + 1000);
    const second = new UsageActivity(path);
    expect(second.read(at + 60_000).reduce((s, r) => s + r.active_ms, 0)).toBe(
      1000,
    );
    expect(JSON.stringify(second.read(at + 60_000))).not.toContain("synthetic");
    expect(second.read(at + 8 * 86_400_000)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("clock rollback cannot count an observed interval twice", () => {
  const activity = new UsageActivity();
  activity.observe("a", 1, [pane], at);
  activity.read(at + 2000);
  activity.observe("a", 1, [pane], at + 1000);
  const rows = activity.read(at + 3000);
  expect(rows.reduce((s, r) => s + r.active_ms, 0)).toBe(3000);
});
test("invalid numeric history is explicit and never leaks its contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-history-"));
  try {
    const path = join(dir, "history.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        rows: [{ content: "PRIVATE_HISTORY_SENTINEL" }],
      }),
    );
    const activity = new UsageActivity(path);
    expect(activity.history).toBe("unavailable");
    expect(activity.read(at)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("rows keep the harness and when it worked; run and item links survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-history-"));
  const day = Date.parse("2026-11-19T10:00:00Z");
  const run = `run_${"b".repeat(64)}`;
  try {
    const path = join(dir, "history.json"),
      first = new UsageActivity(path);
    // Working 10:00–10:00:31, idle, then 10:00:40–10:01:00: two spans. The
    // observed idle gap is not working time, however short.
    for (const t of [0, 10_000, 20_000, 30_000])
      first.observe("a", 1, [{ ...pane, agent: "cursor" }], day + t);
    first.observe(
      "a",
      1,
      [{ ...pane, agent: "cursor", agent_status: "idle" }],
      day + 31_000,
    );
    for (const t of [40_000, 50_000, 60_000])
      first.observe("a", 1, [{ ...pane, agent: "cursor" }], day + t);
    first.invalidate("a", day + 60_000);
    const [row] = first.read(day + 120_000);
    expect(row).toMatchObject({
      harness: "cursor",
      spans: [
        [day, day + 31_000],
        [day + 40_000, day + 60_000],
      ],
    });
    first.linkRun(row!.agent_id!, run);
    first.linkRun(row!.agent_id!, "run_not-a-digest");
    first.linkItem(run, "github:pr:example/web#3");
    first.close(day + 120_000);
    const second = new UsageActivity(path);
    expect(second.history).toBe("available");
    expect(second.runOf(row!.agent_id!)).toBe(run);
    expect(second.itemOf(run)).toBe("github:pr:example/web#3");
    expect(second.read(day + 120_000)[0]).toMatchObject({
      harness: "cursor",
      spans: [
        [day, day + 31_000],
        [day + 40_000, day + 60_000],
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("malformed spans, harness names or links make history unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-history-"));
  try {
    const path = join(dir, "history.json");
    const row = {
      connection_id: "a",
      connection_generation: 1,
      agent_id: `agent_${"c".repeat(64)}`,
      pane_id: "p1",
      workspace_id: "w1",
      project_id: null,
      day: "2026-11-19",
      active_ms: 1,
      waiting_on_you_ms: 0,
      observed_ms: 1,
    };
    for (const bad of [
      { rows: [{ ...row, spans: [[2, 1]] }] },
      { rows: [{ ...row, harness: "PRIVATE HISTORY SENTINEL" }] },
      { rows: [row], links: { runs: [["x", "y"]], items: [] } },
      {
        rows: [row],
        links: { runs: [], items: [[`run_${"d".repeat(64)}`, 7]] },
      },
    ]) {
      writeFileSync(path, JSON.stringify({ version: 1, ...bad }));
      const activity = new UsageActivity(path);
      expect(activity.history).toBe("unavailable");
      expect(activity.read(Date.parse("2026-11-19T12:00:00Z"))).toEqual([]);
    }
    writeFileSync(path, JSON.stringify({ version: 1, rows: [row] }));
    expect(new UsageActivity(path).history).toBe("available");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a short observed idle gap never becomes overlap with another agent", () => {
  const activity = new UsageActivity();
  const day = Date.parse("2026-11-19T12:00:00Z");
  const a = { ...pane, agent: "cursor" };
  const b = { ...pane, pane_id: "p2", terminal_id: "t2", agent: "cursor" };
  const state = (p: typeof a, working: boolean) => ({
    ...p,
    agent_status: working ? "working" : "idle",
  });
  // A works 0–15 s and 45–60 s; B works 20–35 s in between.
  for (let t = 0; t <= 60_000; t += 5_000)
    activity.observe(
      "a",
      1,
      [
        state(a, t < 15_000 || t >= 45_000),
        state(b, t >= 20_000 && t < 35_000),
      ],
      day + t,
    );
  activity.invalidate("a", day + 60_000);
  const spans = activity.read(day + 120_000).flatMap((row) => row.spans ?? []);
  expect(spans.sort((x, y) => x[0] - y[0])).toEqual([
    [day, day + 15_000],
    [day + 20_000, day + 35_000],
    [day + 45_000, day + 60_000],
  ]);
});
test("a full history with full links still saves within the size it reloads under", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-history-"));
  const now = Date.parse("2026-11-19T12:00:00Z");
  try {
    const path = join(dir, "history.json");
    const rows = Array.from({ length: 8192 }, (_, i) => ({
      connection_id: "a",
      connection_generation: 1,
      agent_id: `agent_${i.toString(16).padStart(64, "0")}`,
      pane_id: `p${i}`,
      workspace_id: "w1",
      project_id: null,
      day: "2026-11-19",
      active_ms: 1,
      waiting_on_you_ms: 0,
      observed_ms: 1,
    }));
    writeFileSync(path, JSON.stringify({ version: 1, rows }));
    const activity = new UsageActivity(path);
    expect(activity.history).toBe("available");
    for (let i = 0; i < 4096; i++) {
      const run = `run_${i.toString(16).padStart(64, "0")}`;
      activity.linkRun(`agent_${i.toString(16).padStart(64, "0")}`, run);
      activity.linkItem(run, `github:pr:example/${"r".repeat(480)}#${i}`);
    }
    activity.save(now);
    const saved = new UsageActivity(path);
    expect(saved.history).toBe("available");
    expect(saved.truncated).toBe(true);
    expect(saved.read(now).length).toBeGreaterThan(0);
    // The newest links are kept.
    const last = `run_${(4095).toString(16).padStart(64, "0")}`;
    expect(saved.itemOf(last)).toBe(
      `github:pr:example/${"r".repeat(480)}#4095`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
