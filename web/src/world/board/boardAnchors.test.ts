import { describe, expect, test } from "bun:test";
import { anchorFor, confirmed, followMove, targetOf } from "./boardAnchors";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";

const board = () =>
  projectBoard(
    fixtureWorld([
      fixtureHost("alpha", [
        {
          label: "web",
          tabs: [{ label: "pair", panes: [["working"], ["idle", false]] }],
        },
      ]),
    ]),
  );

describe("Board anchors", () => {
  test("a pane anchor names the exact pane and witnesses its terminal", () => {
    const model = board();
    const anchor = anchorFor(model, "alpha:w1:t1", "alpha:w1:p2")!;
    expect(anchor).toEqual({
      connection_id: "alpha",
      kind: "pane",
      native_id: "w1:p2",
      witness: ["term_alpha_w1:p2"],
    });
    expect(targetOf(model, anchor)).toEqual({
      cardKey: "alpha:w1:t1",
      paneKey: "alpha:w1:p2",
      terminals: ["term_alpha_w1:p2"],
    });
  });

  test("tab and workspace anchors witness every terminal they hold", () => {
    const model = board();
    expect(anchorFor(model, "alpha:w1:t1")).toMatchObject({
      kind: "tab",
      native_id: "w1:t1",
      witness: ["term_alpha_w1:p1", "term_alpha_w1:p2"],
    });
    expect(anchorFor(model, "alpha:w1")).toMatchObject({
      kind: "workspace",
      native_id: "w1",
    });
  });

  test("an anchor is confirmed only while a witnessed terminal survives", () => {
    const model = board();
    const anchor = anchorFor(model, "alpha:w1:t1", "alpha:w1:p1")!;
    expect(confirmed(anchor, targetOf(model, anchor))).toBe(true);
    // Herdr restarted: same IDs, new terminals.
    expect(
      confirmed(
        { ...anchor, witness: ["term_before_restart"] },
        targetOf(model, anchor),
      ),
    ).toBe(false);
    // Not on the board (host offline, filtered or closed): no target.
    expect(targetOf(model, { ...anchor, native_id: "w9:p9" })).toBeNull();
    expect(confirmed(anchor, null)).toBe(false);
  });
  test("strings follow a moved tab: new pane and tab IDs, same witnesses", () => {
    const pane = (native_id: string) => ({
      anchor: {
        connection_id: "alpha",
        kind: "pane" as const,
        native_id,
        witness: ["term_1"],
      },
    });
    const strings = [
      { id: "a", from: { note: "n1" }, to: pane("w1:p2") },
      {
        id: "b",
        from: { note: "n1" },
        to: {
          anchor: {
            connection_id: "alpha",
            kind: "tab" as const,
            native_id: "w1:t1",
            witness: [],
          },
        },
      },
      { id: "c", from: { note: "n1" }, to: pane("w1:p9") },
      {
        id: "d",
        from: { note: "n1" },
        to: { anchor: { ...pane("w1:p2").anchor, connection_id: "beta" } },
      },
    ];
    const changed = followMove(strings, "alpha", "w1:t1", {
      tab_id: "w2:t4",
      panes: [{ previous: "w1:p2", current: "w2:p7" }],
    });
    expect(changed.map((string) => string.id)).toEqual(["a", "b"]);
    expect(changed[0]!.to).toEqual({
      anchor: {
        connection_id: "alpha",
        kind: "pane",
        native_id: "w2:p7",
        witness: ["term_1"],
      },
    });
    expect(changed[1]!.to).toMatchObject({
      anchor: { kind: "tab", native_id: "w2:t4" },
    });
  });
});
