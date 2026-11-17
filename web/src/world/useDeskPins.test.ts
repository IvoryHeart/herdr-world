import { describe, expect, test } from "bun:test";
import type { Tab } from "../types";
import { leafPinnedBy, worldTabPin } from "./useDeskPins";
import type { WorldLeafObject, WorldSpaceObject } from "./worldObject";
import { terminalColorKey } from "./terminalColor";

const owner = { connectionId: "conn-a", workspaceIds: ["w1"] };
const tab: Tab = {
  tab_id: "w1:t2",
  workspace_id: "w1",
  number: 2,
  label: "docs",
  focused: true,
  pane_count: 1,
  agent_status: "idle",
};
const key = terminalColorKey({
  connectionId: "conn-a",
  workspaceId: "w1",
  tabId: "w1:t2",
  workspaceIds: new Set(["w1"]),
});

describe("the phone terminal's pin", () => {
  test("pins the tab's Town desk while Board is not showing", () => {
    const calls: [string, boolean][] = [];
    const pin = worldTabPin(
      {},
      { pinned: new Set(), toggle: null },
      (target, pinned) => {
        calls.push([terminalColorKey(target), pinned]);
        return Promise.resolve(null);
      },
    );
    expect(pin.label.pin).toBe("Pin desk in Town");
    expect(pin.pinnedOf(owner, tab)).toBe(false);
    pin.onPin(owner, tab, true);
    expect(calls).toEqual([[key, true]]);
    const pinned = worldTabPin(
      { [key]: { cell: null } },
      { pinned: new Set(), toggle: null },
    );
    expect(pinned.pinnedOf(owner, tab)).toBe(true);
  });

  test("pins the tab's card while Board shows", () => {
    const toggled: string[] = [];
    const pin = worldTabPin(
      { [key]: { cell: null } },
      { pinned: new Set([key]), toggle: (card) => toggled.push(card) },
    );
    expect(pin.label.unpin).toBe("Unpin card on Board");
    expect(pin.pinnedOf(owner, tab)).toBe(true);
    pin.onPin(owner, tab, false);
    expect(toggled).toEqual([key]);
  });
});

describe("whether a leaf is pinned", () => {
  const spaces = [
    { connectionId: "conn-a", nativeId: "w1" },
  ] as WorldSpaceObject[];
  const herdr = (tabId: string) =>
    ({
      runtime: "herdr",
      connectionId: "conn-a",
      workspaceId: "w1",
      tabId,
      pane: {},
    }) as unknown as WorldLeafObject;
  const core = (favourite: boolean) =>
    ({
      runtime: "herdr-core",
      connectionId: "conn-a",
      workspaceId: "w1",
      tabId: "w1:t2",
      pane: { favourite },
    }) as unknown as WorldLeafObject;

  test("a Herdr leaf follows its tab's desk pin", () => {
    const pinned = leafPinnedBy({ [key]: { cell: null } }, spaces);
    expect(pinned(herdr("w1:t2"))).toBe(true);
    expect(pinned(herdr("w1:t3"))).toBe(false);
  });

  test("a herdr-core leaf follows its own label, not its desk", () => {
    expect(leafPinnedBy({}, spaces)(core(true))).toBe(true);
    expect(leafPinnedBy({ [key]: { cell: null } }, spaces)(core(false))).toBe(
      false,
    );
  });
});
