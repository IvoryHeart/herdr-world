import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Pane, Tab, Workspace } from "../../types";
import {
  createOfficeProjector,
  prepareWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import {
  EMPTY_OFFICE_OBSERVABILITY,
  type OfficeObservability,
} from "../officeObservability";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import type { TownRoomActions } from "./TownCanvas";
import { TownBoard, TownPlaceSummaryCard } from "./TownBoard";
import { TownDeskTitle } from "./TownDeskTitle";
import { townCalls } from "./TownRail";
import { TownRoomPlaque } from "./TownRoomPlaque";
import { townPlaceSummary, townSummary } from "./townSummary";
import {
  TownUsageStore,
  townPlaceEconomy,
  type TownUsageState,
} from "./townPlaceUsage";
import type { UsageEntity, WorldUsageSnapshot } from "../../../../shared/usage";

const NO_METRICS: OfficeObservability = {
  ...EMPTY_OFFICE_OBSERVABILITY,
  health: "unavailable",
};

/** One synthetic host: rooms of tables, one agent per table. */
function host(id: string, rooms: Record<string, string[]>) {
  const workspaces: Workspace[] = Object.keys(rooms).map((room, index) => ({
    workspace_id: room,
    number: index + 1,
    label: room,
    focused: index === 0,
    pane_count: rooms[room]!.length,
    tab_count: rooms[room]!.length,
    active_tab_id: `${room}:t0`,
    agent_status: "working",
  }));
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  for (const [room, statuses] of Object.entries(rooms))
    statuses.forEach((status, index) => {
      const tabId = `${room}:t${index}`;
      tabs.push({
        tab_id: tabId,
        workspace_id: room,
        number: index + 1,
        label: `${room} table ${index + 1}`,
        focused: index === 0,
        pane_count: 1,
        agent_status: status,
      });
      panes.push({
        pane_id: `${tabId}:p`,
        terminal_id: `term-${tabId}`,
        workspace_id: room,
        tab_id: tabId,
        focused: index === 0,
        agent: "claude",
        agent_status: status,
        last_activity_at: 1_000,
        revision: 1,
      });
    });
  const connection: WorldRuntimeConnection = {
    connectionId: id,
    label: id,
    source: "saved-profile",
    isDefault: id === "studio",
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
  return connection;
}

/**
 * A two-building town, prepared and projected as Town does: the studio has
 * someone working and someone waiting, the lab only quiet agents.
 */
async function twoBuildings() {
  const world = buildWorldObject(
    [
      host("studio", { alpha: ["working", "blocked"] }),
      host("lab", { beta: ["idle", "idle", "idle"] }),
    ],
    "studio",
  );
  await prepareWorldOffice(world);
  const office = createOfficeProjector(TOWN_PRESENTATION_BOUNDS)(
    world,
    1,
    null,
  );
  const calls = townCalls(
    office.roster,
    new Map(),
    [],
    (key) => office.roster.find(({ agent }) => agent.key === key),
    500,
  );
  return { office, summary: townSummary(office, calls, NO_METRICS) };
}

test("the Town board counts every agent in every building, quiet ones too", async () => {
  const { office, summary } = await twoBuildings();
  expect(office.hosts).toHaveLength(2);
  expect(summary.counts).toEqual({
    needsYou: 1,
    working: 1,
    finished: 0,
    quiet: 3,
    unknown: 0,
    agents: 5,
    buildings: 2,
  });
  const html = renderToStaticMarkup(
    createElement(TownBoard, {
      counts: summary.counts,
      observability: NO_METRICS,
    }),
  );
  // The lab's quiet agents count on the board, not only the studio's.
  expect(html).toContain("<dt>Quiet</dt><dd>3</dd>");
  expect(html).toContain("<dt>Busy</dt><dd>1</dd>");
  expect(html).toContain("<dt>Waiting</dt><dd>1</dd>");
  expect(html).toContain("5 agents in 2 buildings");
  expect(html).toContain(
    'aria-label="Town board: 1 working, 1 need you, 0 done, 3 quiet; 5 agents in 2 buildings"',
  );
});

test("a room's and a table's summaries are their parts of the Town summary", async () => {
  const { office, summary } = await twoBuildings();
  const room = (label: string) =>
    office.roomRoster.find((entry) => entry.displayLabel === label)!.key;
  expect(
    townPlaceSummary(summary, office, { kind: "room", key: room("alpha") })
      .counts,
  ).toEqual({
    needsYou: 1,
    working: 1,
    finished: 0,
    quiet: 0,
    unknown: 0,
    agents: 2,
  });
  expect(
    townPlaceSummary(summary, office, { kind: "room", key: room("beta") })
      .counts,
  ).toMatchObject({ quiet: 3, agents: 3 });

  const waiting = summary.needsYou[0]!.agent;
  expect(
    townPlaceSummary(summary, office, {
      kind: "desk",
      key: waiting.deskKey!,
    }).counts,
  ).toEqual({
    needsYou: 1,
    working: 0,
    finished: 0,
    quiet: 0,
    unknown: 0,
    agents: 1,
  });
  const working = office.roster.find(
    ({ agent }) => agent.semanticStatus === "working",
  )!.agent;
  expect(
    townPlaceSummary(summary, office, {
      kind: "desk",
      key: working.deskKey!,
    }).counts,
  ).toMatchObject({ working: 1, needsYou: 0, agents: 1 });
  expect(
    townPlaceSummary(summary, office, { kind: "desk", key: "missing" }).counts,
  ).toEqual({
    needsYou: 0,
    working: 0,
    finished: 0,
    quiet: 0,
    unknown: 0,
    agents: 0,
  });
});

const TOKENS = {
  input: 0,
  cache_read: 0,
  cache_write: 0,
  output: 0,
  reasoning: 0,
};

/** Today's usage in the studio: two models at one alpha table, one at another. */
function usage(): WorldUsageSnapshot {
  const entity = (
    tab: string,
    model: string,
    total: number,
    cost: number | null,
  ): UsageEntity => ({
    id: `${tab}-${model}`,
    kind: "usage",
    connector: "harness-log",
    harness: "claude",
    model,
    day: "2026-11-06",
    tokens: { ...TOKENS, output: total },
    total_tokens: total,
    responses: 1,
    first_at: 0,
    last_at: 0,
    observation_span_ms: 0,
    estimated_cost_usd: cost,
    price_table_version: cost === null ? null : "example",
    state: "available",
    connection_id: "studio",
    connection_generation: 1,
    workspace_id: "alpha",
    tab_id: tab,
    pane_id: `${tab}:p`,
  });
  const entities = [
    entity("alpha:t0", "claude-sonnet-4-5", 2_000, 0.5),
    entity("alpha:t0", "claude-opus-4-1", 8_000, 2),
    entity("alpha:t1", "claude-haiku-4-5", 1_500, 0.25),
  ];
  const total = (rows: UsageEntity[]) => ({
    tokens: TOKENS,
    total_tokens: rows.reduce((sum, row) => sum + row.total_tokens, 0),
    estimated_cost_usd: rows.reduce(
      (sum, row) => sum + (row.estimated_cost_usd ?? 0),
      0,
    ),
    unpriced_records: 0,
    records: rows.length,
  });
  const rollup = (
    level: "workspace" | "tab",
    tab: string | null,
    rows: UsageEntity[],
  ) => ({
    level,
    connection_id: "studio",
    connection_generation: 1,
    workspace_id: "alpha",
    tab_id: tab,
    pane_id: null,
    ...total(rows),
  });
  return {
    version: 1,
    incarnation: "example",
    observed_at: 0,
    window: { kind: "today", from: 0, until: 1 },
    retention_days: 7,
    truncated: false,
    entities,
    sources: [
      {
        connection_id: "studio",
        connection_generation: 1,
        harness: "claude",
        state: "available",
        checked_at: 0,
        last_success_at: 0,
        refreshing: false,
      },
      {
        connection_id: "lab",
        connection_generation: 1,
        harness: "claude",
        state: "available",
        checked_at: 0,
        last_success_at: 0,
        refreshing: false,
      },
    ],
    limits: [],
    total: total(entities),
    unattributed: total([]),
    rollups: [
      rollup("workspace", null, entities),
      rollup("tab", "alpha:t0", entities.slice(0, 2)),
      rollup("tab", "alpha:t1", entities.slice(2)),
    ],
    telemetry: {
      role: "comparison",
      included_in_totals: false,
      window_seconds: null,
      state: "unavailable",
      observed_at: 0,
      total_tokens: 0,
    },
  };
}

test("a room's and a table's economy is today's usage of its workspace or tab", async () => {
  const { office } = await twoBuildings();
  const alpha = office.roomRoster.find((r) => r.displayLabel === "alpha")!;
  const beta = office.roomRoster.find((r) => r.displayLabel === "beta")!;
  const desk = office.deskRoster.find(
    ({ desk }) => desk.tabRef.nativeId === "alpha:t0",
  )!.desk;
  const ready: TownUsageState = { status: "ready", snapshot: usage() };

  expect(
    townPlaceEconomy(ready, { kind: "room", target: alpha.workspaceRef }),
  ).toEqual({
    status: "ready",
    costUsd: 2.75,
    price: "priced",
    tokens: 11_500,
    models: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"],
    partial: false,
  });
  expect(
    townPlaceEconomy(ready, { kind: "desk", target: desk.tabRef }),
  ).toEqual({
    status: "ready",
    costUsd: 2.5,
    price: "priced",
    tokens: 10_000,
    models: ["claude-opus-4-1", "claude-sonnet-4-5"],
    partial: false,
  });
  // The lab's room used nothing today; another generation is another
  // runtime, which the read has no data for.
  expect(
    townPlaceEconomy(ready, { kind: "room", target: beta.workspaceRef }),
  ).toEqual({ status: "none" });
  expect(
    townPlaceEconomy(ready, {
      kind: "room",
      target: { ...alpha.workspaceRef, generation: 2 },
    }),
  ).toEqual({ status: "no-data" });
  expect(
    townPlaceEconomy(
      { status: "failed" },
      { kind: "room", target: alpha.workspaceRef },
    ),
  ).toEqual({ status: "unavailable" });
  // A host whose harness could not be read has no data, which is not zero.
  const missing = usage();
  missing.sources = missing.sources.map((source) =>
    source.connection_id === "lab" ? { ...source, state: "missing" } : source,
  );
  expect(
    townPlaceEconomy(
      { status: "ready", snapshot: missing },
      { kind: "room", target: beta.workspaceRef },
    ),
  ).toEqual({ status: "no-data" });
});

test("a room card says why its cost is missing rather than showing $0", async () => {
  const { office, summary } = await twoBuildings();
  const alpha = office.roomRoster.find((r) => r.displayLabel === "alpha")!;
  const snapshot = usage();
  // No price table: every entity is unpriced, so every total cost is null.
  snapshot.entities = snapshot.entities.map((entity) => ({
    ...entity,
    estimated_cost_usd: null,
    price_table_version: null,
  }));
  snapshot.rollups = snapshot.rollups.map((rollup) => ({
    ...rollup,
    estimated_cost_usd: null,
    unpriced_records: rollup.records,
  }));
  const economy = townPlaceEconomy(
    { status: "ready", snapshot },
    { kind: "room", target: alpha.workspaceRef },
  );
  expect(economy).toMatchObject({ costUsd: null, price: "no-table" });
  const html = renderToStaticMarkup(
    createElement(TownPlaceSummaryCard, {
      place: townPlaceSummary(summary, office, {
        kind: "room",
        key: alpha.key,
      }),
      economy,
    }),
  );
  expect(html).toContain("11.5k tokens");
  expect(html).toContain("no price table");
  expect(html).not.toContain("$");
  expect(html).not.toContain("—");
});

test("a place card is the Town board's numbers without its agents list", async () => {
  const { office, summary } = await twoBuildings();
  const waiting = summary.needsYou[0]!;
  const place = townPlaceSummary(summary, office, {
    kind: "room",
    key: waiting.roomKey,
  });
  const html = renderToStaticMarkup(
    createElement(TownPlaceSummaryCard, {
      place,
      economy: {
        status: "ready",
        costUsd: 2.75,
        price: "priced",
        tokens: 11_500,
        models: ["claude-opus-4-1", "claude-sonnet-4-5"],
        partial: false,
      },
    }),
  );
  expect(html).toContain("<dt>Busy</dt><dd>1</dd>");
  expect(html).toContain("<dt>Waiting</dt><dd>1</dd>");
  expect(html).toContain("<dt>Done</dt><dd>0</dd>");
  expect(html).toContain("<dt>Quiet</dt><dd>0</dd>");
  expect(html).toContain("2 agents");
  expect(html).toContain("<span>ECONOMY TODAY</span><b>~$2.75</b>");
  expect(html).toContain("11.5k tokens · Opus 4.1 · Sonnet 4.5");
  // No agents list: the summary window keeps who needs you and what finished.
  expect(html).not.toContain(waiting.agent.displayLabel);
  expect(html).not.toContain("town-summary-item");
  expect(
    renderToStaticMarkup(
      createElement(TownPlaceSummaryCard, {
        place,
        economy: { status: "none" },
      }),
    ),
  ).toContain("No usage recorded here today.");
});

test("place cards read today's usage once per refresh interval", async () => {
  const calls: unknown[] = [];
  let resolve: (value: unknown) => void = () => {};
  let now = 0;
  const store = new TownUsageStore(
    {
      call: (method, params) => {
        calls.push([method, params]);
        return new Promise((done) => (resolve = done));
      },
    },
    () => now,
  );
  store.request();
  store.request();
  expect(calls).toEqual([["world.usage.get", { window: "today" }]]);
  expect(store.get()).toEqual({ status: "loading" });
  const snapshot = usage();
  resolve(snapshot);
  await Promise.resolve();
  expect(store.get()).toEqual({ status: "ready", snapshot });
  now = 29_999;
  store.request();
  expect(calls).toHaveLength(1);
  now = 30_000;
  store.request();
  expect(calls).toHaveLength(2);
  // A failed refresh keeps the numbers the cards already show.
  resolve(null);
  await Promise.resolve();
  expect(store.get()).toEqual({ status: "ready", snapshot });
});

test("room and table cards build their summaries only once opened", () => {
  let built = 0;
  const card = {
    summary: () => {
      built += 1;
      throw new Error("a closed card built its summary");
    },
    usage: {
      kind: "room" as const,
      target: {
        connectionId: "studio",
        generation: 1,
        kind: "workspace" as const,
        nativeId: "room",
        worldId: "room",
      },
    },
  };
  const actions = {
    canRenameRoom: () => true,
    onRenameRoom() {},
    canCloseRoom: () => true,
    onCloseRoom() {},
  } as unknown as TownRoomActions;
  const plaque = renderToStaticMarkup(
    createElement(TownRoomPlaque, {
      room: { key: "room" } as never,
      label: "Studio",
      width: 176,
      counts: { agents: 2, working: 1, blocked: 1 },
      color: null,
      actions,
      card,
    }),
  );
  // Rename and Close share the room's card, ready before it opens.
  expect(plaque).toContain('class="town-place-card town-room-plaque-card"');
  expect(plaque).toContain('aria-label="Rename room Studio"');
  expect(plaque).toContain('aria-label="Close room Studio"');
  const title = renderToStaticMarkup(
    createElement(
      TownDeskTitle,
      {
        deskKey: "desk",
        label: "Desk one",
        card,
        onSelect: () => {},
        onActivate: () => {},
      },
      "Desk one",
    ),
  );
  expect(title).toContain('aria-label="Table Desk one"');
  expect(title).toContain('class="town-place-card town-desk-card"');
  expect(built).toBe(0);
});
