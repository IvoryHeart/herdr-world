import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { townModelFromProjection, townAttention } from "./townModel";
import { inspectTownTerminal, townTargetActionable } from "./townOpen";

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
  }
});

test("a live herdr-core agent opens in the Inspector but never takes a Herdr reply", async () => {
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
    // Town's reply path is Herdr-only; the Inspector path admits the agent.
    expect(townTargetActionable(projection, key)).toBe(false);
    expect(townTargetActionable(projection, key, true)).toBe(!stale);
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
