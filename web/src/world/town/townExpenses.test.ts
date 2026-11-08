import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorldUsageSnapshot } from "../../../../shared/usage";
import { townUsageFixture, usageFixture } from "../testing/usageFixture";
import {
  townCityExpenses,
  townCoverageNotes,
  townExpenseText,
  townHostExpenses,
  townUsd,
} from "./townExpenses";
import { TownCityBillboard, TownReceptionExpenses } from "./TownExpenseBoards";
import { TOWN_CITY_BOARD_GAP } from "./townCenter";
import {
  TOWN_USAGE_MAX_AGE_MS,
  TownUsageStore,
  townPlaceEconomy,
  townUsageCurrent,
  type TownUsageState,
} from "./townPlaceUsage";

const ready = (snapshot: WorldUsageSnapshot): TownUsageState => ({
  status: "ready",
  snapshot,
  receivedAt: 0,
});

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test("the city board shows the service's total, with stale numbers left out", () => {
  const snapshot = townUsageFixture();
  const city = townCityExpenses(ready(snapshot));
  if (city.status !== "ready") throw new Error(city.status);
  const counted = snapshot.entities.filter((e) => e.state === "available");
  const stale = snapshot.entities.filter((e) => e.state === "stale");
  expect(stale.length).toBe(1);
  expect(city.total.tokens).toBe(sum(counted.map((e) => e.total_tokens)));
  expect(city.total.tokens).toBe(snapshot.total.total_tokens);
  expect(city.total.costUsd).toBeCloseTo(
    sum(counted.map((e) => e.estimated_cost_usd!)),
  );
  expect(city.total.price).toBe("priced");
  // Usage tied to no pane is shown as such.
  expect(city.unattributed.tokens).toBe(
    sum(counted.filter((e) => !e.pane_id).map((e) => e.total_tokens)),
  );
  expect(city.coverage).toEqual({
    partial: false,
    stale: true,
    noDataHosts: 1,
  });
  expect(townCoverageNotes(city.coverage, city.unattributed)).toEqual([
    "45.5k unattributed",
    "stale data left out",
    "no data from 1 host",
  ]);
});

test("a building's board is its host rollup and its rooms, never levels added together", () => {
  const snapshot = townUsageFixture();
  const studio = townHostExpenses(ready(snapshot), "studio");
  if (studio.status !== "ready") throw new Error(studio.status);
  const host = snapshot.rollups.find(
    (r) => r.level === "host" && r.connection_id === "studio",
  )!;
  expect(studio.total.tokens).toBe(host.total_tokens);
  expect(studio.total.costUsd).toBe(host.estimated_cost_usd);
  // Every level projects the same rows: adding them would count them again.
  const allLevels = sum(
    snapshot.rollups
      .filter((r) => r.connection_id === "studio")
      .map((r) => r.total_tokens),
  );
  expect(allLevels).toBeGreaterThan(studio.total.tokens);
  // The three costliest rooms, and how many more there are.
  expect(studio.rooms.map((room) => room.workspaceId)).toEqual([
    "alpha",
    "beta",
    "gamma",
  ]);
  expect(studio.moreRooms).toBe(1);
  for (const room of studio.rooms) {
    const rollup = snapshot.rollups.find(
      (r) => r.level === "workspace" && r.workspace_id === room.workspaceId,
    )!;
    expect(room.total.tokens).toBe(rollup.total_tokens);
    expect(room.total.costUsd).toBe(rollup.estimated_cost_usd);
  }
  // The studio's session tied to no room.
  const loose = snapshot.entities.find(
    (e) => e.connection_id === "studio" && !e.workspace_id,
  )!;
  expect(studio.unattributed.tokens).toBe(loose.total_tokens);
  expect(studio.coverage.stale).toBe(false);
  // The lab's stale row is not in its total, and the board says so.
  const lab = townHostExpenses(ready(snapshot), "lab");
  if (lab.status !== "ready") throw new Error(lab.status);
  expect(lab.total.tokens).toBe(
    snapshot.entities.find(
      (e) => e.connection_id === "lab" && e.state === "available",
    )!.total_tokens,
  );
  expect(lab.unattributed.records).toBe(0);
  expect(lab.coverage.stale).toBe(true);
});

test("a null cost stays null and says why; it is never $0", () => {
  const noTable = townUsageFixture({ prices: null });
  const city = townCityExpenses(ready(noTable));
  if (city.status !== "ready") throw new Error(city.status);
  expect(city.total.costUsd).toBeNull();
  expect(city.total.price).toBe("no-table");
  expect(townExpenseText(city.total)).toBe("1.0M tokens · no price table");
  const studio = townHostExpenses(ready(noTable), "studio");
  if (studio.status !== "ready") throw new Error(studio.status);
  expect(studio.rooms.every((room) => room.total.costUsd === null)).toBe(true);
  // Unpriced rooms rank by tokens: a null cost is not the cheapest.
  expect(studio.rooms.map((room) => room.workspaceId)).toEqual([
    "alpha",
    "beta",
    "gamma",
  ]);

  // A table without one of the models: the total is unpriced, not partial.
  const partlyPriced = usageFixture({
    rows: [
      { connection: "studio", workspace: "alpha", input: 10_000 },
      {
        connection: "studio",
        workspace: "alpha",
        model: "example-unlisted",
        input: 10_000,
      },
    ],
    sources: [{ connection: "studio", state: "available" }],
  });
  const host = townHostExpenses(ready(partlyPriced), "studio");
  if (host.status !== "ready") throw new Error(host.status);
  expect(host.total.costUsd).toBeNull();
  expect(host.total.price).toBe("unpriced");
  expect(townExpenseText(host.total)).toBe(
    "151.7k tokens · some models unpriced",
  );
});

test("missing, partial and failed reads say so instead of zero", () => {
  const snapshot = townUsageFixture();
  // Its only harness is missing: no data, not zero.
  expect(townHostExpenses(ready(snapshot), "archive")).toEqual({
    status: "no-data",
  });
  // A host the read does not mention at all.
  expect(townHostExpenses(ready(snapshot), "elsewhere")).toEqual({
    status: "no-data",
  });
  expect(townHostExpenses({ status: "failed" }, "studio")).toEqual({
    status: "unavailable",
  });
  expect(townCityExpenses({ status: "loading" })).toEqual({
    status: "loading",
  });
  expect(
    townCityExpenses(
      ready(
        usageFixture({
          rows: [],
          sources: [{ connection: "studio", state: "missing" }],
        }),
      ),
    ),
  ).toEqual({ status: "no-data" });

  // A readable host with nothing today reads "none recorded".
  const quiet = townHostExpenses(
    ready(
      usageFixture({
        rows: [],
        sources: [{ connection: "studio", state: "available" }],
      }),
    ),
    "studio",
  );
  if (quiet.status !== "ready") throw new Error(quiet.status);
  expect(townExpenseText(quiet.total)).toBe("none recorded");

  const partial = usageFixture({
    rows: [{ connection: "studio", workspace: "alpha", input: 1_000 }],
    sources: [{ connection: "studio", state: "partial" }],
  });
  const host = townHostExpenses(ready(partial), "studio");
  if (host.status !== "ready") throw new Error(host.status);
  expect(townCoverageNotes(host.coverage, host.unattributed)).toEqual([
    "partial",
  ]);
  const truncated = townCityExpenses(
    ready(
      usageFixture({
        rows: [{ connection: "studio", input: 1_000 }],
        sources: [{ connection: "studio", state: "available" }],
        truncated: true,
      }),
    ),
  );
  if (truncated.status !== "ready") throw new Error(truncated.status);
  expect(truncated.coverage.partial).toBe(true);
});

test("a host's board reads only its own connection's newest runtime", () => {
  const snapshot = usageFixture({
    rows: [
      { connection: "studio", generation: 1, workspace: "alpha", input: 5_000 },
      { connection: "studio", generation: 2, workspace: "alpha", input: 1_000 },
      { connection: "lab", generation: 3, workspace: "alpha", input: 9_000 },
    ],
    sources: [
      { connection: "studio", generation: 1, state: "available" },
      { connection: "studio", generation: 2, state: "available" },
      { connection: "lab", generation: 3, state: "available" },
    ],
  });
  const studio = townHostExpenses(ready(snapshot), "studio");
  if (studio.status !== "ready") throw new Error(studio.status);
  expect(studio.rooms).toHaveLength(1);
  expect(studio.rooms[0]!.generation).toBe(2);
  expect(studio.total.tokens).toBe(snapshot.entities[1]!.total_tokens);
});

test("dollar estimates", () => {
  expect(townUsd(3.4)).toBe("$3.40");
  expect(townUsd(0.004)).toBe("<$0.01");
  expect(townUsd(0)).toBe("$0.00");
  expect(townUsd(1234.5)).toBe("$1,235");
});

/** A store already holding `snapshot`, as after a read. */
async function storeWith(snapshot: WorldUsageSnapshot) {
  const store = new TownUsageStore(
    { call: async () => snapshot },
    () => 0,
    snapshot.window.kind,
  );
  store.request();
  await Promise.resolve();
  await Promise.resolve();
  expect(store.get().status).toBe("ready");
  return store;
}

test("the boards render the figures, rooms and what they leave out", async () => {
  const today = await storeWith(townUsageFixture());
  const center = { x: 40, y: 14, w: 34, h: 15, street: 34 };
  const billboard = renderToStaticMarkup(
    createElement(TownCityBillboard, {
      center,
      folded: false,
      stores: () => today,
    }),
  );
  expect(billboard).toContain("CITY EXPENSES");
  // It stands above the center's flag (its foot), never over the building.
  expect(billboard).toContain(
    `left:${(40 + 34 / 2) * 16}px;top:${14 * 16 - TOWN_CITY_BOARD_GAP}px`,
  );
  expect(billboard).toContain('aria-pressed="true">Today</button>');
  expect(billboard).toContain('aria-pressed="false">7 days</button>');
  expect(billboard).toMatch(
    /Today<\/span> · <b>1\.0M tokens · \$[\d.]+ est\.<\/b>/,
  );
  expect(billboard).toContain("no data from 1 host");

  const board = renderToStaticMarkup(
    createElement(TownReceptionExpenses, {
      connectionId: "studio",
      hostLabel: "Studio",
      roomLabel: (id) => (id === "gamma" ? null : id.toUpperCase()),
      folded: false,
      store: today,
    }),
  );
  expect(board).toContain('aria-label="Studio expenses"');
  // Part of the reception board: a section under its queue, not a board of its own.
  expect(board).toContain('class="town-reception-expenses"');
  expect(board).toContain("EXPENSES TODAY");
  expect(board).not.toContain("town-expenses-posts");
  expect(board).toContain("<span>ALPHA</span>");
  expect(board).toContain("<span>BETA</span>");
  expect(board).toContain("<span>closed room</span>");
  expect(board).toContain("+1 more room");
  expect(board).toContain("45.5k unattributed");

  const missing = renderToStaticMarkup(
    createElement(TownReceptionExpenses, {
      connectionId: "archive",
      hostLabel: "Archive",
      roomLabel: () => null,
      folded: true,
      store: today,
    }),
  );
  // Folded on a phone: a sign that opens the board, reading "no data".
  expect(missing).toContain('aria-label="Archive expenses: no data. Open"');
  expect(missing).not.toContain("$0");
});

test("a read kept through failed refreshes goes stale, and never past UTC midnight", async () => {
  // One good read at 23:58 UTC, then the service goes away.
  const snapshot = usageFixture({
    rows: [{ connection: "studio", workspace: "alpha", input: 10_000 }],
    sources: [{ connection: "studio", state: "available" }],
    observedAt: Date.UTC(2026, 10, 7, 23, 58),
  });
  let now = 1_000_000;
  let fail = false;
  const store = new TownUsageStore(
    {
      call: async () => {
        if (fail) throw new Error("disconnected");
        return snapshot;
      },
    },
    () => now,
  );
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  store.request();
  await settle();
  expect(townCityExpenses(townUsageCurrent(store.get(), now)).status).toBe(
    "ready",
  );

  // Refreshes fail; the kept read is still current a minute later...
  fail = true;
  now += 60_000;
  store.request();
  await settle();
  expect(store.get().status).toBe("ready");
  expect(townCityExpenses(townUsageCurrent(store.get(), now)).status).toBe(
    "ready",
  );
  // ...but not once the service's UTC day has turned: no figures at all.
  now += 60_000;
  const current = townUsageCurrent(store.get(), now);
  expect(townCityExpenses(current)).toEqual({ status: "stale" });
  expect(townHostExpenses(current, "studio")).toEqual({ status: "stale" });
  expect(
    townPlaceEconomy(current, {
      kind: "room",
      target: {
        connectionId: "studio",
        generation: 1,
        kind: "workspace",
        nativeId: "alpha",
        worldId: "example",
      },
    }),
  ).toEqual({ status: "stale" });

  const center = { x: 40, y: 14, w: 34, h: 15, street: 34 };
  const billboard = renderToStaticMarkup(
    createElement(TownCityBillboard, {
      center,
      folded: false,
      stores: () => store,
    }),
  );
  expect(billboard).toContain("Today</span> · <b>out of date</b>");
  expect(billboard).not.toContain("tokens");
  const sign = renderToStaticMarkup(
    createElement(TownReceptionExpenses, {
      connectionId: "studio",
      hostLabel: "Studio",
      roomLabel: () => "ALPHA",
      folded: true,
      store,
    }),
  );
  expect(sign).toContain('aria-label="Studio expenses: out of date. Open"');
  expect(sign).not.toContain("ALPHA");

  // Within the same day, a kept read goes stale after a few minutes.
  const midday = {
    status: "ready",
    snapshot: townUsageFixture(),
    receivedAt: 0,
  } as const;
  expect(townUsageCurrent(midday, TOWN_USAGE_MAX_AGE_MS).status).toBe("ready");
  expect(townUsageCurrent(midday, TOWN_USAGE_MAX_AGE_MS + 1).status).toBe(
    "stale",
  );

  // A fresh read brings the figures back.
  fail = false;
  store.request();
  await settle();
  expect(townCityExpenses(townUsageCurrent(store.get(), now)).status).not.toBe(
    "stale",
  );
});
