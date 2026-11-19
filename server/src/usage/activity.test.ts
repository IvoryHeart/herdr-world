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
