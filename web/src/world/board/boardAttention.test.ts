import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";
import { nextBoardAttention } from "./boardAttention";

test("Next cycles qualified waiting agents and shared asks, excluding stale hosts and shells", () => {
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
