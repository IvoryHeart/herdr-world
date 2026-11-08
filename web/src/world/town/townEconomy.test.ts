import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { townUsageFixture } from "../testing/usageFixture";
import { TownBoard } from "./TownBoard";
import { townEconomyPreview } from "./townEconomyPreview";
import {
  townCityExpenses,
  townExpenseText,
  townHostExpenses,
} from "./townExpenses";
import { TownUsageStore, townUsageCurrent } from "./townPlaceUsage";

test("Town boards share one observation across windows, refreshes, prices and a UTC day turn", async () => {
  let now = 0;
  let calls = 0;
  let mode = "busy";
  const week = new TownUsageStore(
    {
      call: async (_method, params) => {
        expect(params).toEqual({ window: "7d" });
        calls++;
        return townEconomyPreview(townUsageFixture(), mode);
      },
    },
    () => now,
    "7d",
  );
  const today = new TownUsageStore(
    {
      call: async () => {
        throw new Error("separate read");
      },
    },
    () => now,
    "today",
    week,
  );
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  for (const next of ["busy", "unpriced", "no-table"]) {
    mode = next;
    now += 30_000;
    today.request();
    week.request();
    await settle();
    const city = townCityExpenses(today.get());
    const seven = townCityExpenses(week.get());
    const studio = townHostExpenses(today.get(), "studio");
    const lab = townHostExpenses(today.get(), "lab");
    if (
      city.status !== "ready" ||
      seven.status !== "ready" ||
      studio.status !== "ready" ||
      lab.status !== "ready"
    )
      throw new Error("missing fixture");
    expect(city.total.tokens).toBe(1_200_000);
    expect(seven.total.tokens).toBe(1_800_000);
    expect(studio.total.tokens).toBe(900_000);
    expect(lab.total.tokens).toBe(300_000);
    // Unattributed is part of the building and city totals, never an extra city charge.
    expect(studio.total.tokens + lab.total.tokens).toBe(city.total.tokens);
    expect(studio.unattributed.tokens).toBe(180_000);
    expect(city.unattributed.tokens).toBe(studio.unattributed.tokens);
    expect(city.total.price).toBe(
      next === "busy"
        ? "priced"
        : next === "no-table"
          ? "no-table"
          : "unpriced",
    );
    const html = renderToStaticMarkup(
      createElement(TownBoard, {
        counts: {
          agents: 0,
          buildings: 2,
          working: 0,
          needsYou: 0,
          finished: 0,
          quiet: 0,
          unknown: 0,
        },
        usageStore: today,
      }),
    );
    expect(html).toContain("ECONOMY TODAY · UTC · HARNESS LOGS");
    if (city.total.price === "priced") {
      expect(city.total.costUsd).toBeCloseTo(1.328);
      expect(html).toContain("<b>$1.33 est.</b>");
      expect(html).toContain("1.2M tokens");
    } else expect(html).toContain(townExpenseText(city.total));
    expect(html).toContain("TEST DATA");
    expect(html).toContain("unattributed (included)");
    // All consumers observe the same stable state object for React subscriptions.
    expect(today.get()).toBe(today.get());
  }
  expect(calls).toBe(3);
  mode = "midnight";
  now += 30_000;
  week.request();
  await settle();
  now += 1;
  expect(townUsageCurrent(today.get(), now).status).toBe("stale");
  expect(townUsageCurrent(week.get(), now).status).toBe("stale");
});

test("limited detail retains the full host unattributed balance and pricing reason", () => {
  const snapshot = townUsageFixture();
  const before = townHostExpenses(
    { status: "ready", snapshot, receivedAt: 0 },
    "studio",
  );
  // The public details can omit every entity without altering aggregate balances.
  snapshot.details_truncated = true;
  snapshot.entities = [];
  const after = townHostExpenses(
    { status: "ready", snapshot, receivedAt: 0 },
    "studio",
  );
  if (before.status !== "ready" || after.status !== "ready")
    throw new Error("missing host");
  expect(after.total).toEqual(before.total);
  expect(after.unattributed).toEqual(before.unattributed);
  expect(after.coverage.detailsLimited).toBe(true);
});

test("a service response without the paired summary has a stable unavailable state", async () => {
  const source = new TownUsageStore(
    { call: async () => townUsageFixture({ window: "7d" }) },
    () => 0,
    "7d",
  );
  const today = new TownUsageStore(
    { call: async () => null },
    () => 0,
    "today",
    source,
  );
  source.request();
  await Promise.resolve();
  expect(today.get()).toEqual({ status: "failed" });
  expect(today.get()).toBe(today.get());
});
