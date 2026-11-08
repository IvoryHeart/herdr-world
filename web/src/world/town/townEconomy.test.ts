import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { townUsageFixture } from "../testing/usageFixture";
import { TownBoard } from "./TownBoard";
import {
  townEconomyPreview,
  townEconomyPreviewClient,
} from "./townEconomyPreview";
import { TownCityBillboard, TownReceptionExpenses } from "./TownExpenseBoards";
import { formatOfficeUsage } from "../officeObservability";
import { townScaleUsageClient } from "./townScaleUsage";
import { townScaleConnections } from "./townScaleScene";
import {
  townCityExpenses,
  townExpenseText,
  townHostExpenses,
  townCostText,
} from "./townExpenses";
import {
  TownUsageStore,
  townUsageCurrent,
  townPlaceEconomy,
} from "./townPlaceUsage";

test("town-scale replaces live economy for the city, buildings, cards and Town board", async () => {
  const now = Date.UTC(2026, 10, 8, 12);
  let liveCalls = 0;
  const client = {
    call: async () => {
      liveCalls++;
      return { ...townUsageFixture(), total: { total_tokens: 401_600_000 } };
    },
  };
  expect(townScaleUsageClient(client, "")).toBe(client);
  const week = new TownUsageStore(
    townScaleUsageClient(client, "?scene=town-scale", () => now),
    () => now,
    "7d",
  );
  const today = new TownUsageStore(client, () => now, "today", week);
  await new Promise<void>((resolve) => {
    const unsubscribe = week.subscribe(() => {
      if (week.get().status !== "ready") return;
      unsubscribe();
      resolve();
    });
    today.request();
  });
  expect(liveCalls).toBe(0);
  const city = townCityExpenses(today.get());
  const seven = townCityExpenses(week.get());
  if (city.status !== "ready" || seven.status !== "ready")
    throw new Error("missing scene economy");
  expect(city.coverage.testData).toBe(true);
  expect(city.total.price).toBe("priced");
  expect(city.total.tokens).toBeGreaterThan(0);
  expect(seven.total.tokens).toBeGreaterThan(city.total.tokens);
  expect(city.unattributed.tokens).toBe(0);
  expect(city.coverage.noDataHosts).toBe(1);
  let buildingTokens = 0;
  let buildingCost = 0;
  for (const host of townScaleConnections()) {
    const expenses = townHostExpenses(today.get(), host.connectionId);
    if (host.connectionId === "scene-zephyr") {
      expect(expenses.status).toBe("no-data");
      continue;
    }
    if (expenses.status !== "ready") throw new Error("missing building");
    expect(expenses.total.tokens).toBeLessThanOrEqual(city.total.tokens);
    buildingTokens += expenses.total.tokens;
    buildingCost += expenses.total.costUsd!;
    let roomTokens = 0;
    for (const room of host.snapshot!.workspaces) {
      const economy = townPlaceEconomy(today.get(), {
        kind: "room",
        target: {
          kind: "workspace",
          worldId: `workspace_${room.workspace_id}`,
          connectionId: host.connectionId,
          generation: host.generation!,
          nativeId: room.workspace_id,
        },
      });
      if (economy.status !== "ready") throw new Error("missing room");
      roomTokens += economy.tokens;
    }
    expect(roomTokens).toBe(expenses.total.tokens);
  }
  expect(buildingTokens).toBe(city.total.tokens);
  expect(buildingCost).toBeCloseTo(city.total.costUsd!);
  const html = renderToStaticMarkup(
    createElement(TownBoard, {
      counts: {
        agents: 0,
        buildings: 3,
        working: 0,
        needsYou: 0,
        finished: 0,
        quiet: 0,
        unknown: 0,
      },
      usageStore: today,
    }),
  );
  expect(html).toContain("TEST DATA");
  expect(html).toContain(`<b>${townCostText(city.total)}</b>`);
  expect(html).toContain(`${formatOfficeUsage(city.total.tokens)} tokens`);
  expect(html).not.toContain("401.6M");
  const billboard = renderToStaticMarkup(
    createElement(TownCityBillboard, {
      center: { x: 0, y: 0, w: 34, h: 15, street: 17 },
      folded: false,
      stores: (span) => (span === "today" ? today : week),
    }),
  );
  expect(billboard).toContain(townExpenseText(city.total));
  for (const connectionId of ["scene-atlas", "scene-nova", "scene-zephyr"]) {
    const reception = renderToStaticMarkup(
      createElement(TownReceptionExpenses, {
        connectionId,
        hostLabel: connectionId,
        folded: false,
        roomLabel: (id) => id,
        store: today,
      }),
    );
    const expenses = townHostExpenses(today.get(), connectionId);
    expect(reception).toContain(
      expenses.status === "ready" ? townExpenseText(expenses.total) : "no data",
    );
  }
});

test("the production usage client selects town-scale before any live or preview read", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const client: {
    call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  } = {
    call: async () => {
      throw new Error("live usage leaked");
    },
  };
  let sceneClient: Pick<typeof client, "call">;
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { href: "https://example.com/?scene=town-scale" } },
    });
    sceneClient = townEconomyPreviewClient(client);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
  const snapshot = await sceneClient.call("world.usage.get", { window: "7d" });
  expect(snapshot).toMatchObject({ incarnation: "town-scale" });
});

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
    expect(html).toContain("ECONOMY TODAY · UTC · TEST DATA");
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
