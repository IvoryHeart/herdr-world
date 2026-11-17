import { describe, expect, test } from "bun:test";
import { isValidElement } from "react";
import { AgentMark } from "../components/AgentMark";
import { townScaleConnections } from "./town/townScaleScene";
import {
  WORLD_COMMAND_FINDS,
  withWorldViews,
  worldFindGroup,
  worldViewGroup,
} from "./worldCommandBox";
import { buildWorldObject } from "./worldObject";
import { worldSearchResults } from "./worldSearch";

const scene = townScaleConnections();
const world = buildWorldObject(scene, scene[0]!.connectionId);

describe("the command box finds what the views' search finds", () => {
  test("an empty search or no match finds nothing", () => {
    expect(worldFindGroup(world, "  ", () => {})).toBeNull();
    expect(
      worldFindGroup(world, "no-such-place-anywhere", () => {}),
    ).toBeNull();
  });

  test("names first, at most a page, and choosing selects the node", () => {
    const chosen: string[] = [];
    const group = worldFindGroup(world, "harbor", (id) => chosen.push(id))!;
    const results = worldSearchResults(world, "harbor");
    expect(results.length).toBeGreaterThan(WORLD_COMMAND_FINDS);
    expect(group.heading).toBe("In World");
    // A page of finds, then how many more a narrower search would show.
    expect(group.actions).toHaveLength(WORLD_COMMAND_FINDS + 1);
    const more = group.actions[WORLD_COMMAND_FINDS]!;
    expect(more.title).toBe(
      `${results.length - WORLD_COMMAND_FINDS} more in World`,
    );
    expect(more.disabledReason).toBe("Add a word to narrow the search");
    const [room] = group.actions;
    expect(room!.title).toBe("harbor");
    expect(room!.detail).toBe("Room · atlas");
    expect(room!.score).toBe(0.95);
    // The rest match by place: below names, above summaries.
    expect(group.actions[1]!.score).toBe(0.8);
    room!.run();
    expect(chosen).toEqual([results[0]!.nodeId]);
  });

  test("an agent shows its mark, its place and the summary it matched", () => {
    const group = worldFindGroup(world, "harbor migration", () => {})!;
    const agent = group.actions[0]!;
    expect(isValidElement(agent.icon) && agent.icon.type).toBe(AgentMark);
    expect(agent.detail).toMatch(
      /^Agent · Needs you · atlas › harbor › \w+ · .*migration/,
    );
    expect(agent.score).toBe(0.6);
  });
});

describe("the command box's views", () => {
  test("goes to every view but the current one", () => {
    const went: string[] = [];
    const group = worldViewGroup("town", (view) => went.push(view));
    expect(group.actions.map((action) => action.title)).toEqual([
      "Go to Board",
      "Go to Desk",
      "Go to Spaces",
    ]);
    group.actions[0]!.run();
    expect(went).toEqual(["board"]);
  });

  test("join the view's actions, never replacing an empty set", () => {
    const empty = { captureKey: null, groups: [] };
    expect(withWorldViews(empty, "town", () => {})).toBe(empty);
    const actions = {
      captureKey: null,
      groups: [{ heading: "Create", actions: [] }],
    };
    expect(
      withWorldViews(actions, "board", () => {}).groups.map(
        (group) => group.heading,
      ),
    ).toEqual(["Create", "Views"]);
  });
});
