import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";
import { nextBoardAttention } from "./boardAttention";

test("Next cycles qualified waiting agents and shared asks, excluding stale hosts and shells without asks", () => {
  const spaces = [
    {
      label: "Synthetic room",
      tabs: [
        {
          label: "Synthetic desk",
          panes: [["blocked"], ["idle"], ["blocked", false]] as [
            "blocked" | "idle",
            boolean?,
          ][],
        },
      ],
    },
  ];
  const model = projectBoard(
    fixtureWorld([
      fixtureHost("alpha", spaces),
      fixtureHost("beta", spaces, { stale: true }),
    ]),
  );
  const [first, second] = model.tabs[0]!.panes;
  const asks = new Set([second!.leaf.id]);
  expect(nextBoardAttention(model.tabs, null, asks)?.pane.leaf.id).toBe(
    first!.leaf.id,
  );
  expect(
    nextBoardAttention(model.tabs, first!.leaf.id, asks)?.pane.leaf.id,
  ).toBe(second!.leaf.id);
  expect(
    nextBoardAttention(model.tabs, second!.leaf.id, asks)?.pane.leaf.id,
  ).toBe(first!.leaf.id);
  expect(nextBoardAttention(model.tabs.slice(1), null, asks)).toBeNull();
});

test("Next keeps its native position after the selected pane stops qualifying", () => {
  const model = projectBoard(
    fixtureWorld([
      fixtureHost("alpha", [
        {
          label: "Room",
          tabs: [
            { label: "A", panes: [["blocked"]] },
            { label: "B answered", panes: [["idle"]] },
            { label: "C", panes: [["blocked"]] },
          ],
        },
      ]),
    ]),
  );
  const [a, b, c] = model.tabs.map((tab) => tab.panes[0]!);
  expect(
    nextBoardAttention(model.tabs, b!.leaf.id, new Set())?.pane.leaf.id,
  ).toBe(c!.leaf.id);
  expect(
    nextBoardAttention(model.tabs, c!.leaf.id, new Set())?.pane.leaf.id,
  ).toBe(a!.leaf.id);
});

test("Next includes shared questions placed on shells and skips shells without asks", () => {
  const model = projectBoard(
    fixtureWorld([
      fixtureHost("alpha", [
        {
          label: "Room",
          tabs: [
            {
              label: "Shells",
              panes: [
                ["blocked", false],
                ["idle", false],
              ],
            },
          ],
        },
      ]),
    ]),
  );
  const [withoutAsk, asking] = model.tabs[0]!.panes;
  expect(
    nextBoardAttention(model.tabs, null, new Set([asking!.leaf.id]))?.pane.leaf
      .id,
  ).toBe(asking!.leaf.id);
  expect(
    nextBoardAttention(model.tabs, withoutAsk!.leaf.id, new Set()),
  ).toBeNull();
});
