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
import { TownBoard } from "./TownBoard";
import { TownDeskTitle } from "./TownDeskTitle";
import { townCalls } from "./TownRail";
import { TownRoomPlaque } from "./TownRoomPlaque";
import { TownPlaceSummaryCard } from "./TownSummaryPanel";
import { townPlaceSummary, townSummary } from "./townSummary";

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
  expect(html).toContain("<dt>Working</dt><dd>1</dd>");
  expect(html).toContain("<dt>Need you</dt><dd>1</dd>");
  expect(html).toContain("5 agents in 2 buildings");
  expect(html).toContain(
    'aria-label="Town board: 1 working, 1 need you, 0 done, 3 quiet; 5 agents in 2 buildings"',
  );
});

test("a room's and a table's summaries are their parts of the Town summary", async () => {
  const { office, summary } = await twoBuildings();
  const room = (label: string) =>
    office.roomRoster.find((entry) => entry.displayLabel === label)!.key;
  const alpha = townPlaceSummary(summary, office, {
    kind: "room",
    key: room("alpha"),
  });
  expect(alpha.counts).toEqual({
    needsYou: 1,
    working: 1,
    finished: 0,
    quiet: 0,
    unknown: 0,
  });
  expect(alpha.needsYou.map((item) => item.agent.key)).toEqual(
    summary.needsYou.map((item) => item.agent.key),
  );
  expect(
    townPlaceSummary(summary, office, { kind: "room", key: room("beta") })
      .counts.quiet,
  ).toBe(3);

  const waiting = summary.needsYou[0]!.agent;
  const table = townPlaceSummary(summary, office, {
    kind: "desk",
    key: waiting.deskKey!,
  });
  expect(table.counts).toEqual({
    needsYou: 1,
    working: 0,
    finished: 0,
    quiet: 0,
    unknown: 0,
  });
  expect(table.needsYou.map((item) => item.agent.key)).toEqual([waiting.key]);
  const working = office.roster.find(
    ({ agent }) => agent.semanticStatus === "working",
  )!.agent;
  const other = townPlaceSummary(summary, office, {
    kind: "desk",
    key: working.deskKey!,
  });
  expect(other.counts.working).toBe(1);
  expect(other.needsYou).toEqual([]);
  expect(
    townPlaceSummary(summary, office, { kind: "desk", key: "missing" }).counts,
  ).toEqual({ needsYou: 0, working: 0, finished: 0, quiet: 0, unknown: 0 });
});

test("a place card shows the summary's counts and items with their actions", async () => {
  const { office, summary } = await twoBuildings();
  const waiting = summary.needsYou[0]!;
  const html = renderToStaticMarkup(
    createElement(TownPlaceSummaryCard, {
      place: townPlaceSummary(summary, office, {
        kind: "room",
        key: waiting.roomKey,
      }),
      now: 500 + 5 * 60_000,
      onOpenAgent: () => {},
    }),
  );
  expect(html).toContain('data-count="needsYou">1 need you');
  expect(html).toContain('data-count="working">1 working');
  expect(html).toContain("waiting 5 m");
  // The card is in the room: it does not repeat the room and host.
  expect(html).not.toContain(`${waiting.roomLabel} · `);
  expect(html).toContain(`aria-label="Answer ${waiting.agent.displayLabel}"`);
  const many = renderToStaticMarkup(
    createElement(TownPlaceSummaryCard, {
      place: {
        counts: { needsYou: 5, working: 0, finished: 0, quiet: 0, unknown: 0 },
        needsYou: Array.from({ length: 5 }, (_, index) => ({
          ...waiting,
          agent: { ...waiting.agent, key: `agent-${index}` },
        })),
        finished: [],
      },
      now: 500,
      onOpenAgent: () => {},
    }),
  );
  expect(many.match(/town-summary-item/g)).toHaveLength(3);
  expect(many).toContain("2 more in the Town summary");
});

test("room and table cards build their summaries only once opened", () => {
  let built = 0;
  const card = {
    summary: () => {
      built += 1;
      throw new Error("a closed card built its summary");
    },
    now: 0,
    onOpenAgent: () => {},
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
