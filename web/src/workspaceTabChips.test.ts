import { describe, expect, test } from "bun:test";
import type { Tab } from "./types";
import {
  MAX_WORKSPACE_TAB_CHIPS,
  visibleWorkspaceTabChips,
  workspaceTabChips,
} from "./workspaceTabChips";

const tab = (tab_id: string, workspace_id: string, number: number): Tab => ({
  tab_id,
  workspace_id,
  number,
  label: "",
  focused: false,
  pane_count: 1,
  agent_status: "unknown",
});

const pane = (
  pane_id: string,
  tab_id: string,
  agent_status: string,
  agent: string | undefined = "claude",
  focused = false,
) => ({ pane_id, tab_id, agent_status, agent, focused });

describe("workspace tab chips", () => {
  test("groups tabs per workspace with the most urgent agent state", () => {
    const chips = workspaceTabChips(
      [tab("t1", "w1", 1), tab("t2", "w1", 2), tab("t3", "w2", 1)],
      [
        pane("p1", "t1", "idle"),
        pane("p2", "t1", "working", "codex", true),
        pane("p3", "t2", "done"),
        pane("p4", "t2", "blocked", ""),
        pane("p5", "t2", "working"),
      ],
    );
    expect(chips.get("w1")?.map((chip) => [chip.number, chip.status])).toEqual([
      [1, "working"],
      [2, "done"],
    ]);
    expect(chips.get("w1")?.[0].paneId).toBe("p2");
    expect(chips.get("w1")?.[1].paneId).toBe("p3");
    expect(chips.get("w2")?.[0]).toMatchObject({
      status: "unknown",
      paneId: undefined,
    });
  });

  test("shows up to the limit and folds the rest into a +N marker", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      tab(`t${index}`, "w1", index + 1),
    );
    const chips = workspaceTabChips(many, []).get("w1") ?? [];
    const exact = visibleWorkspaceTabChips(
      chips.slice(0, MAX_WORKSPACE_TAB_CHIPS),
    );
    expect(exact).toMatchObject({ hidden: 0 });
    expect(exact.visible).toHaveLength(MAX_WORKSPACE_TAB_CHIPS);
    const folded = visibleWorkspaceTabChips(chips);
    expect(folded.visible).toHaveLength(MAX_WORKSPACE_TAB_CHIPS - 1);
    expect(folded.hidden).toBe(9 - (MAX_WORKSPACE_TAB_CHIPS - 1));
  });

  test("folds chips into +N as the row narrows, down to one chip", () => {
    const five = Array.from({ length: 5 }, (_, index) =>
      tab(`t${index}`, "w1", index + 1),
    );
    const chips = workspaceTabChips(five, []).get("w1") ?? [];
    const shown = (width: number) =>
      visibleWorkspaceTabChips(chips, width).visible.length;
    expect(shown(88)).toBe(5);
    expect(shown(87)).toBe(3);
    expect(shown(60)).toBe(2);
    expect(shown(40)).toBe(1);
    expect(shown(10)).toBe(1);
    expect(visibleWorkspaceTabChips(chips, 10).hidden).toBe(4);
  });
});
