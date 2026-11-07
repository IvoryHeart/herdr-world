import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Pane, Tab, Workspace } from "../../types";
import type { AgentUsageStop } from "../../../../shared/usageStop";
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
import { townCalls } from "./TownRail";
import { TownRoomPlaque } from "./TownRoomPlaque";
import { townBubbleKind } from "./townBubbleKind";
import { townModelFromProjection, townRoomCounts } from "./townModel";
import {
  currentUsageStops,
  nextUsageStopReset,
  withTownOutOfFuel,
} from "./townOutOfFuel";
import { townPlaceSummary, townSummary } from "./townSummary";

const NO_METRICS: OfficeObservability = {
  ...EMPTY_OFFICE_OBSERVABILITY,
  health: "unavailable",
};

/** One synthetic host with one room: a table per agent. */
async function studio(statuses: string[]) {
  const workspace: Workspace = {
    workspace_id: "alpha",
    number: 1,
    label: "alpha",
    focused: true,
    pane_count: statuses.length,
    tab_count: statuses.length,
    active_tab_id: "alpha:t0",
    agent_status: "working",
  };
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  statuses.forEach((status, index) => {
    const tabId = `alpha:t${index}`;
    tabs.push({
      tab_id: tabId,
      workspace_id: "alpha",
      number: index + 1,
      label: `table ${index + 1}`,
      focused: index === 0,
      pane_count: 1,
      agent_status: status,
    });
    panes.push({
      pane_id: `${tabId}:p`,
      terminal_id: `term-${tabId}`,
      workspace_id: "alpha",
      tab_id: tabId,
      focused: index === 0,
      agent: "codex",
      agent_status: status,
      revision: 1,
    });
  });
  const connection: WorldRuntimeConnection = {
    connectionId: "studio",
    label: "studio",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs, panes, agents: [] },
  };
  const world = buildWorldObject([connection], "studio");
  await prepareWorldOffice(world);
  return createOfficeProjector(TOWN_PRESENTATION_BOUNDS)(world, 1, null);
}

const resets = new Date(2026, 10, 7, 15, 0).getTime();
const stop: AgentUsageStop = { harness: "codex", at: 0, resets_at: resets };

test("an agent stopped on its usage limit is quiet, out of fuel and never waiting on you", async () => {
  const observed = await studio(["blocked", "done", "working", "idle"]);
  const keys = observed.roster.map(({ agent }) => agent.key);
  // Every agent's session ends with a stop; the working one has fuel again.
  const office = withTownOutOfFuel(
    observed,
    new Map(keys.map((key) => [key, stop])),
  );
  const agents = office.roster.map(({ agent }) => agent);
  expect(agents.map((agent) => agent.semanticStatus)).toEqual([
    "idle",
    "idle",
    "working",
    "idle",
  ]);
  expect(agents.map((agent) => Boolean(agent.usageStop))).toEqual([
    true,
    true,
    false,
    true,
  ]);
  // Nothing goes to reception or the call rail.
  const calls = townCalls(
    office.roster,
    new Map(),
    [],
    (key) => office.roster.find(({ agent }) => agent.key === key),
    500,
  );
  expect(calls).toEqual([]);

  // The room plate and the Town summary count them apart.
  const model = townModelFromProjection(office);
  const room = office.rooms[0]!;
  const counts = townRoomCounts(model, room);
  expect(counts).toMatchObject({
    agents: 4,
    working: 1,
    idle: 0,
    outOfFuel: 3,
  });
  const summary = townSummary(office, calls, NO_METRICS);
  expect(summary.counts).toMatchObject({
    working: 1,
    needsYou: 0,
    quiet: 0,
    outOfFuel: 3,
    agents: 4,
  });
  expect(summary.hosts[0]!.rooms[0]!.counts.outOfFuel).toBe(3);
  const browser = new Window();
  try {
    browser.document.body.innerHTML = renderToStaticMarkup(
      createElement(TownRoomPlaque, {
        room,
        label: "alpha",
        width: 176,
        counts,
        color: null,
        actions: {
          canRenameRoom: () => true,
          onRenameRoom() {},
          canCloseRoom: () => true,
          onCloseRoom() {},
        } as unknown as TownRoomActions,
      }),
    );
    expect(
      browser.document
        .querySelector(".town-room-plaque-count")!
        .getAttribute("title"),
    ).toBe("1 of 4 agents active: 1 working, 0 waiting on you, 3 out of fuel");
  } finally {
    await browser.happyDOM.close();
  }
  expect(
    renderToStaticMarkup(
      createElement(TownBoard, {
        counts: summary.counts,
        observability: NO_METRICS,
      }),
    ),
  ).toContain("4 agents in 1 building · 3 out of fuel");

  // The table's card names the stop and its reset.
  const desk = agents[0]!.deskKey!;
  const place = townPlaceSummary(summary, office, { kind: "desk", key: desk });
  expect(place.counts.outOfFuel).toBe(1);
  expect(place.fuel).toEqual([{ label: agents[0]!.displayLabel, stop }]);
  const card = renderToStaticMarkup(
    createElement(TownPlaceSummaryCard, {
      place,
      economy: { status: "none" },
    }),
  );
  expect(card).toContain("Usage limit reached · resets ");
  expect(card).toContain("(Codex)");
});

test("without stops, or with only a working agent stopped, the projection is unchanged", async () => {
  const observed = await studio(["working", "idle"]);
  expect(withTownOutOfFuel(observed, new Map())).toBe(observed);
  const working = observed.roster[0]!.agent.key;
  expect(withTownOutOfFuel(observed, new Map([[working, stop]]))).toBe(
    observed,
  );
  expect(townSummary(observed, [], NO_METRICS).counts.outOfFuel).toBe(0);
});

test("a stop ends by itself once its reset time passes", () => {
  const timeless: AgentUsageStop = { ...stop, resets_at: null };
  const stops = new Map([
    ["a", stop],
    ["b", timeless],
  ]);
  expect(currentUsageStops(stops, resets - 1)).toBe(stops);
  expect([...currentUsageStops(stops, resets).keys()]).toEqual(["b"]);
  expect(nextUsageStopReset(stops)).toBe(resets);
  expect(nextUsageStopReset(new Map([["b", timeless]]))).toBeNull();
});

test("an agent out of fuel shows an empty fuel can and a clock at every distance", () => {
  expect(
    townBubbleKind(
      "idle",
      false,
      false,
      "building",
      "seat",
      false,
      0,
      null,
      true,
    ),
  ).toBe("fuel");
  expect(townBubbleKind("idle", false, false, "room", "seat", false, 0)).toBe(
    "sleep",
  );
  expect(
    townBubbleKind("idle", false, false, "desk", "seat", false, 0, null, true),
  ).toBe("fuel");
});
