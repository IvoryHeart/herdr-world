import { expect, test } from "bun:test";
import {
  type FixturePane,
  fixtureHost,
  fixtureWorld,
} from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { townModelFromProjection, townAttention } from "./townModel";
import {
  inspectTownTerminal,
  townDeskCardOpens,
  townDeskOpenKey,
  townDeskOpensAtOnce,
  townTargetActionable,
} from "./townOpen";

function office(stale: boolean) {
  return projectWorldOffice(
    fixtureWorld([
      fixtureHost(
        "synthetic-a",
        [{ label: "Room", tabs: [{ label: "Desk", panes: [["working"]] }] }],
        { stale },
      ),
    ]),
    0,
  );
}

test("cached agents, panes and desks cannot dispatch a live terminal action", async () => {
  for (const stale of [true, false]) {
    const projection = office(stale);
    const calls: string[] = [];
    const keys = [
      projection.roster[0]!.agent.key,
      projection.paneRoster[0]!.device.key,
      projection.deskRoster[0]!.desk.key,
    ];
    for (const key of keys) {
      expect(townTargetActionable(projection, key)).toBe(!stale);
      await inspectTownTerminal(projection, key, (id) => {
        calls.push(id);
      });
    }
    expect(calls).toHaveLength(stale ? 0 : 3);
    // A live desk opens on the first touch; a cached one shows its card.
    expect(townDeskOpensAtOnce(projection, keys[2]!)).toBe(!stale);
  }
});

test("a live herdr-core agent opens in the Inspector though World cannot review it", async () => {
  for (const stale of [false, true]) {
    const projection = office(false);
    const entry = projection.roster[0]!;
    // As officeAgent projects one: World only watches it, coreChat while live.
    projection.roster[0] = {
      ...entry,
      agent: {
        ...entry.agent,
        canOpenInSpaces: false,
        stale,
        coreChat: stale ? undefined : true,
      },
    };
    const key = entry.agent.key;
    // Every Town open admits it while live (#1006).
    expect(townTargetActionable(projection, key)).toBe(!stale);
    const calls: string[] = [];
    await inspectTownTerminal(projection, key, (id) => {
      calls.push(id);
    });
    expect(calls).toEqual(stale ? [] : [entry.agent.nodeId]);
  }
});

test("Town keeps cached agents without presenting current work or urgent reception", () => {
  const projection = office(true);
  const model = townModelFromProjection(projection);
  const agent = [...model.agents.values()][0]!;
  expect(agent.stale).toBe(true);
  expect(agent.semanticStatus).toBe("unknown");
  expect(townAttention(model, new Map())).toHaveLength(0);
  expect([...model.roomCounts.values()][0]!.working).toBe(0);
  expect([...model.roomCounts.values()][0]!.unknown).toBe(1);
  expect(projection.roster[0]!.agent.semanticStatus).toBe("working");
});

function deskOffice(panes: FixturePane[]) {
  return projectWorldOffice(
    fixtureWorld([
      fixtureHost("synthetic-a", [
        { label: "Room", tabs: [{ label: "Desk", panes }] },
      ]),
    ]),
    0,
  );
}

function withPane(
  projection: ReturnType<typeof deskOffice>,
  index: number,
  patch: Partial<ReturnType<typeof deskOffice>["paneRoster"][number]["device"]>,
) {
  const entry = projection.paneRoster[index]!;
  projection.paneRoster[index] = {
    ...entry,
    device: { ...entry.device, ...patch },
  };
  return entry.device;
}

test("a desk opens its one pane, else the focused, else the latest active one", () => {
  const single = deskOffice([["unknown", false]]);
  const deskKey = single.deskRoster[0]!.desk.key;
  expect(townDeskOpenKey(single, deskKey)).toBe(
    single.paneRoster[0]!.device.key,
  );

  const two = deskOffice([
    ["unknown", false],
    ["unknown", false],
  ]);
  const twoDesk = two.deskRoster[0]!.desk.key;
  const [first, second] = two.paneRoster.map(({ device }) => device);
  // Nothing to go by: the first pane, as before.
  expect(townDeskOpenKey(two, twoDesk)).toBe(first!.key);
  withPane(two, 1, { focused: true });
  expect(townDeskOpenKey(two, twoDesk)).toBe(second!.key);
  withPane(two, 1, { focused: undefined, lastActivityAt: 5 });
  withPane(two, 0, { lastActivityAt: 9 });
  expect(townDeskOpenKey(two, twoDesk)).toBe(first!.key);
});

test("the focused pane wins a desk tap, then an agent that needs you; a crowded desk with nothing focused asks", () => {
  for (const status of ["blocked", "done"] as const) {
    const mixed = deskOffice([
      ["unknown", false],
      [status, true],
    ]);
    const deskKey = mixed.deskRoster[0]!.desk.key;
    const shellIndex = mixed.paneRoster.findIndex(
      ({ device }) => !device.agentKey,
    );
    // Nothing focused: the agent that needs you, though the shell was
    // active last.
    const shell = withPane(mixed, shellIndex, { lastActivityAt: 9 });
    expect(townDeskOpenKey(mixed, deskKey)).toBe(mixed.roster[0]!.agent.key);
    // The focused shell wins over the unfocused agent.
    withPane(mixed, shellIndex, { focused: true });
    expect(townDeskOpenKey(mixed, deskKey)).toBe(shell.key);
  }

  const crowded = deskOffice([
    ["unknown", false],
    ["unknown", false],
  ]);
  const desk = crowded.deskRoster[0]!;
  crowded.deskRoster[0] = {
    ...desk,
    desk: { ...desk.desk, observedPaneCount: 5 },
  };
  expect(townDeskOpenKey(crowded, desk.desk.key)).toBe(null);
  const focused = withPane(crowded, 1, { focused: true });
  expect(townDeskOpenKey(crowded, desk.desk.key)).toBe(focused.key);
});

test("only a shown table that opens nothing at once takes a card, and a second tap closes it", () => {
  const cached = office(true);
  const deskKey = cached.deskRoster[0]!.desk.key;
  const shown = new Set(["room"]);
  expect(townDeskCardOpens(cached, deskKey, null, "room", shown)).toBe(true);
  expect(townDeskCardOpens(cached, deskKey, deskKey, "room", shown)).toBe(
    false,
  );
  expect(townDeskCardOpens(cached, deskKey, null, "other", shown)).toBe(false);
  expect(townDeskCardOpens(cached, null, null, "room", shown)).toBe(false);
  const live = office(false);
  const liveDesk = live.deskRoster[0]!.desk.key;
  expect(townDeskCardOpens(live, liveDesk, null, "room", shown)).toBe(false);
});
