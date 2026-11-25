import { expect, test } from "bun:test";
import { worldSearchResults } from "../worldSearch";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";
import { boardSearchKey, boardSearchMatches } from "./boardSearch";

function world() {
  const host = fixtureHost("example-host", [
    {
      label: "Platform",
      tabs: [
        { label: "Builder", panes: [["working"]] },
        { label: "Docs", panes: [["idle"]] },
      ],
    },
  ]);
  const builder = host.spaces[0]!.children[0]!;
  builder.agentLabel = "Codex";
  builder.taskSummary = "Fix login redirect";
  return fixtureWorld([host]);
}

test("Board's cards match a task summary as its results list does", () => {
  const shared = world();
  const model = projectBoard(shared);
  const builder = model.tabs.find((tab) => tab.label === "Builder")!;
  for (const query of ["codex login", "LOGIN codex", "redirect builder"]) {
    expect(worldSearchResults(shared, query).length).toBeGreaterThan(0);
    const matches = boardSearchMatches(model, query)!;
    expect(matches.has(builder.key)).toBe(true);
    expect(matches.has(builder.workspaceKey)).toBe(true);
    expect(
      [...matches].filter((key) => model.tabs.some((tab) => tab.key === key)),
    ).toEqual([builder.key]);
  }
  expect(boardSearchMatches(model, "login nowhere")!.size).toBe(0);
  expect(boardSearchMatches(model, "  ")).toBeNull();
});

test("a chosen result goes to the card that draws it", () => {
  const shared = world();
  const model = projectBoard(shared);
  const builder = model.tabs.find((tab) => tab.label === "Builder")!;
  const leaf = builder.panes[0]!.leaf;
  const space = model.workspaceByKey.get(builder.workspaceKey)!;
  expect(boardSearchKey(model, leaf.id)).toBe(builder.key);
  expect(boardSearchKey(model, space.space.id)).toBe(space.key);
  // A host has no card: the board opens it as selecting does.
  expect(boardSearchKey(model, shared.hosts[0]!.id)).toBeNull();
});
