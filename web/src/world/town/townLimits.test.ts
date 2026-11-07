import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageLimit, WorldUsageSnapshot } from "../../../../shared/usage";
import {
  townFuelGauges,
  townFuelNotes,
  townLimits,
  townResetTime,
  townSeenAge,
  townWindowLabel,
} from "./townLimits";
import { TownFuel, townFuelDetails, townFuelLowest } from "./TownFuelGauge";
import { HostLimits } from "./TownSummaryPanel";
import type { TownUsageState } from "./townPlaceUsage";

const now = Date.parse("2026-11-03T12:00:00Z");
const codex = (
  connection: string,
  used: [number, number],
  state: UsageLimit["state"] = "available",
  observed = now - 3 * 60_000,
): UsageLimit => ({
  connection_id: connection,
  connection_generation: 1,
  harness: "codex",
  state,
  source: "codex-session-log",
  reason: null,
  observed_at: observed,
  windows: [
    { window_minutes: 300, used_percent: used[0], resets_at: now + 3_600_000 },
    {
      window_minutes: 10080,
      used_percent: used[1],
      resets_at: now + 86_400_000,
    },
  ],
  reached: null,
});
/** A harness that keeps no readable limits (the generic "not available" case). */
const claude = (connection: string): UsageLimit => ({
  connection_id: connection,
  connection_generation: 1,
  harness: "claude",
  state: "unsupported",
  source: null,
  reason: "Synthetic reason",
  observed_at: null,
  windows: [],
  reached: null,
});
const claudeTap = (connection: string, used: [number, number]): UsageLimit => ({
  ...codex(connection, used),
  harness: "claude",
  source: "claude-status-line",
});
const claudeReached = (
  connection: string,
  windowMinutes: number | null = 300,
  resetsAt = now + 2 * 3_600_000,
): UsageLimit => ({
  ...codex(connection, [0, 0]),
  harness: "claude",
  source: "claude-transcript",
  windows: [],
  reached: { window_minutes: windowMinutes, resets_at: resetsAt },
});
const missing = (connection: string): UsageLimit => ({
  ...codex(connection, [0, 0], "missing"),
  source: null,
  observed_at: null,
  windows: [],
});
const ready = (limits: UsageLimit[]): TownUsageState => ({
  status: "ready",
  snapshot: {
    version: 1,
    rollups: [],
    limits,
  } as unknown as WorldUsageSnapshot,
});

test("window lengths read as words", () => {
  expect(townWindowLabel(300)).toBe("5 h");
  expect(townWindowLabel(10080)).toBe("week");
  expect(townWindowLabel(1440)).toBe("day");
  expect(townWindowLabel(2880)).toBe("2 d");
  expect(townWindowLabel(45)).toBe("45 min");
  expect(townSeenAge(now - 3 * 60_000, now)).toBe("3 min ago");
});

test("the board shows one gauge per harness with data, the least left winning", () => {
  const gauges = townFuelGauges(
    [
      codex("alpha", [40, 50]),
      codex("beta", [10, 92]),
      claude("alpha"),
      missing("gamma"),
    ],
    now,
  );
  expect(gauges).toHaveLength(1);
  expect(gauges[0]).toMatchObject({
    harness: "codex",
    connectionId: "beta",
    stale: false,
    windows: [
      { label: "5 h", left: 90, low: false },
      { label: "week", left: 8, low: true },
    ],
  });
  expect(townFuelLowest(gauges)?.window).toMatchObject({ left: 8 });
  // Claude without a source and hosts without observations get no gauge.
  expect(townFuelGauges([claude("alpha"), missing("beta")], now)).toEqual([]);
  // A current observation beats a lower stale one.
  expect(
    townFuelGauges(
      [codex("alpha", [99, 99], "stale"), codex("beta", [40, 50])],
      now,
    )[0]?.connectionId,
  ).toBe("beta");
  // Usage that failed or is loading has no limits.
  expect(townLimits({ status: "failed" })).toEqual([]);
});

test("a gauge reads percent left, warns when low and explains itself", () => {
  const gauges = townFuelGauges([codex("alpha", [40, 92])], now);
  const html = renderToStaticMarkup(createElement(TownFuel, { gauges, now }));
  expect(html).toContain("Codex");
  expect(html).toContain("60%");
  expect(html).toContain("8%");
  expect(html).toContain('data-low="true"');
  expect(html).toContain("Codex limits: 5 h 60 % left; week 8 % left, low");
  expect(townFuelDetails(gauges[0]!, now)).toMatch(
    /^5 h resets .+ · week resets .+ · seen 3 min ago · Codex session log$/,
  );
  // Nothing to show renders nothing.
  expect(
    renderToStaticMarkup(createElement(TownFuel, { gauges: [], now })),
  ).toBe("");
});

test("a harness without readable limits shows as not available, never as a level", () => {
  const limits = [codex("alpha", [40, 92]), claude("alpha"), claude("beta")];
  const gauges = townFuelGauges(limits, now);
  const notes = townFuelNotes(limits, gauges);
  expect(notes).toEqual([
    { harness: "claude", name: "Claude", reason: "Synthetic reason" },
  ]);
  const html = renderToStaticMarkup(
    createElement(TownFuel, { gauges, notes, now }),
  );
  expect(html).toContain("Codex");
  expect(html).toContain("Claude");
  expect(html).toContain("not available");
  expect(html).toContain("Limits not available: Synthetic reason");
  expect(html).toContain("Claude limits not available: Synthetic reason");
  // Claude alone still gets the row, with no bar and no percent.
  const alone = renderToStaticMarkup(
    createElement(TownFuel, {
      gauges: [],
      notes: townFuelNotes([claude("alpha")], []),
      now,
    }),
  );
  expect(alone).toContain("FUEL");
  expect(alone).toContain("Claude");
  expect(alone).not.toContain("town-fuel-bar");
  expect(alone).not.toContain("%");
  // A missing Codex observation is not "not available"; it has no entry.
  expect(townFuelNotes([missing("alpha")], [])).toEqual([]);
});

test("stale or aged gauges say stale and never show a level", () => {
  for (const limit of [
    codex("alpha", [40, 92], "stale"),
    // Older than a few hours, or past a window's reset, ages on the client too.
    codex("alpha", [40, 92], "available", now - 4 * 3_600_000),
  ]) {
    const gauges = townFuelGauges([limit], now);
    expect(gauges[0]?.stale).toBe(true);
    expect(townFuelLowest(gauges)).toBeNull();
    const html = renderToStaticMarkup(createElement(TownFuel, { gauges, now }));
    expect(html).toContain("stale");
    expect(html).not.toContain("width:");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("100%");
  }
});

test("the summary lists each host's windows, source and age, and says why Claude has none", () => {
  const html = renderToStaticMarkup(
    createElement(HostLimits, {
      connectionId: "alpha",
      now,
      usage: ready([
        codex("alpha", [40, 92]),
        claude("alpha"),
        codex("beta", [1, 1]),
      ]),
    }),
  );
  expect(html).toContain("5 h: 40 % used");
  expect(html).toContain("week: 92 % used (low)");
  expect(html).toContain("resets ");
  expect(html).toContain("Codex session log · seen 3 min ago");
  expect(html).toContain("Limits not available: Synthetic reason");
  expect(html).not.toContain("1 % used");
  const other = renderToStaticMarkup(
    createElement(HostLimits, {
      connectionId: "gamma",
      now,
      usage: ready([missing("gamma"), codex("delta", [1, 1], "stale")]),
    }),
  );
  expect(other).toContain("Limits missing");
  const stale = renderToStaticMarkup(
    createElement(HostLimits, {
      connectionId: "delta",
      now,
      usage: ready([codex("delta", [1, 1], "stale")]),
    }),
  );
  expect(stale).toContain("stale");
  expect(stale).not.toContain("(low)");
  expect(
    renderToStaticMarkup(
      createElement(HostLimits, {
        connectionId: "alpha",
        now,
        usage: { status: "failed" },
      }),
    ),
  ).toContain("Limits are unavailable");
});

test("Claude's status line reading gets a gauge beside Codex", () => {
  const gauges = townFuelGauges(
    [codex("alpha", [40, 50]), claudeTap("alpha", [20, 90])],
    now,
  );
  expect(gauges.map((g) => g.name)).toEqual(["Claude", "Codex"]);
  expect(gauges[0]).toMatchObject({
    harness: "claude",
    windows: [
      { label: "5 h", left: 80, low: false, reached: false },
      { label: "week", left: 10, low: true, reached: false },
    ],
  });
  const html = renderToStaticMarkup(createElement(TownFuel, { gauges, now }));
  expect(html).toContain("Claude limits: 5 h 80 % left; week 10 % left, low");
  expect(townFuelDetails(gauges[0]!, now)).toMatch(
    /^5 h resets .+ · week resets .+ · seen 3 min ago · Claude status line$/,
  );
  expect(townFuelLowest(gauges)?.gauge.name).toBe("Claude");
});

test("a Claude refusal reads limit reached with its reset, never a level", () => {
  const resetsAt = now + 2 * 3_600_000;
  const gauges = townFuelGauges(
    [claudeTap("beta", [10, 10]), claudeReached("alpha", 300, resetsAt)],
    now,
  );
  // The refusal is the least left across hosts.
  expect(gauges).toHaveLength(1);
  expect(gauges[0]).toMatchObject({
    connectionId: "alpha",
    stale: false,
    windows: [{ label: "5 h", reached: true, resetsAt }],
  });
  const html = renderToStaticMarkup(createElement(TownFuel, { gauges, now }));
  const reset = townResetTime(resetsAt);
  expect(html).toContain(`reached, resets ${reset}`);
  expect(html).toContain(`Claude limits: 5 h limit reached, resets ${reset}`);
  expect(html).not.toContain("town-fuel-bar");
  expect(html).not.toContain("%");
  expect(townFuelDetails(gauges[0]!, now)).toBe(
    `5 h limit reached, resets ${reset} · seen 3 min ago · Claude transcript`,
  );
  expect(townFuelLowest(gauges)?.window.reached).toBe(true);
  // An unnamed window still reads "limit reached".
  expect(
    townFuelDetails(
      townFuelGauges([claudeReached("alpha", null)], now)[0]!,
      now,
    ),
  ).toMatch(/^limit reached, resets /);
  // Once its reset passes it is stale, with no level and no "reached".
  const passed = townFuelGauges([claudeReached("alpha", 300, now - 1000)], now);
  expect(passed[0]?.stale).toBe(true);
  expect(townFuelLowest(passed)).toBeNull();
  const stale = renderToStaticMarkup(
    createElement(TownFuel, { gauges: passed, now }),
  );
  expect(stale).toContain("stale");
  expect(stale).not.toContain("reached,");
  expect(stale).not.toContain("%");
  // The summary lists it under the host the same way.
  const summary = renderToStaticMarkup(
    createElement(HostLimits, {
      connectionId: "alpha",
      now,
      usage: ready([codex("alpha", [40, 92]), claudeReached("alpha")]),
    }),
  );
  expect(summary).toContain("5 h limit reached");
  expect(summary).toContain("Claude transcript · seen 3 min ago");
  expect(summary).not.toContain("100 % used");
});
