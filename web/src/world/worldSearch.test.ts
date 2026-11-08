import { describe, expect, test } from "bun:test";
import type { Pane } from "../types";
import { matchesQuery } from "./deskAgentLabels";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject } from "./worldObject";
import {
  worldSearchExcerpt,
  worldSearchMatches,
  worldSearchResults,
} from "./worldSearch";

function pane(
  id: string,
  tab: string,
  agent: string | undefined,
  taskSummary?: string,
): Pane {
  return {
    pane_id: id,
    terminal_id: `${id}-terminal`,
    workspace_id: "studio",
    tab_id: tab,
    focused: false,
    agent,
    agent_status: agent ? "working" : "unknown",
    task_summary: taskSummary,
    revision: 1,
  } as Pane;
}

function connection(
  connectionId: string,
  label: string,
  room: string,
  panes: Pane[],
): WorldRuntimeConnection {
  const tabs = [...new Set(panes.map((entry) => entry.tab_id))];
  return {
    connectionId,
    label,
    source: "saved-profile",
    isDefault: connectionId === "alpha",
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [
        {
          workspace_id: "studio",
          number: 1,
          label: room,
          focused: true,
          pane_count: panes.length,
          tab_count: tabs.length,
          agent_status: "working",
        },
      ],
      tabs: tabs.map((tab, index) => ({
        tab_id: tab,
        workspace_id: "studio",
        number: index + 1,
        label: tab,
        focused: index === 0,
        pane_count: panes.filter((entry) => entry.tab_id === tab).length,
        agent_status: "working",
      })),
      panes,
      agents: [],
    },
  };
}

const world = buildWorldObject(
  [
    connection("alpha", "Synthetic Alpha", "Harbor", [
      pane("builder", "release", "codex", "Fix the login redirect for admins"),
      pane("shell", "release", undefined),
      pane("reviewer", "billing", "claude", "Review the invoice export"),
    ]),
    connection("beta", "Synthetic Beta", "Harbor", [
      pane("builder", "release", "codex", "Publish the docs site"),
    ]),
  ],
  "alpha",
);

describe("World search", () => {
  test("every word matches, in any order and any case", () => {
    const forward = worldSearchMatches(world, "codex LOGIN");
    const backward = worldSearchMatches(world, "  login   Codex ");
    expect(forward.map((node) => node.id)).toEqual(
      backward.map((node) => node.id),
    );
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({ connectionId: "alpha", kind: "agent" });
    // A word nothing has matches nothing, though the others match.
    expect(worldSearchMatches(world, "codex nowhere")).toEqual([]);
    expect(worldSearchMatches(world, "   ")).toEqual([]);
  });

  test("a harness and a room name find the same agents either way", () => {
    const ids = (query: string) =>
      worldSearchResults(world, query).map((result) => result.id);
    expect(ids("codex harbor")).toEqual(ids("harbor codex"));
    expect(ids("codex harbor")).toHaveLength(2);
  });

  test("results say what each match is and where, hosts telling twins apart", () => {
    const results = worldSearchResults(world, "codex");
    expect(results.map((result) => result.kind)).toEqual(["agent", "agent"]);
    expect(results.map((result) => result.place)).toEqual([
      ["Synthetic Alpha", "Harbor", "release"],
      ["Synthetic Beta", "Harbor", "release"],
    ]);
    expect(results[0]!.status).toBe("working");
    const [table] = worldSearchResults(world, "billing");
    expect(table).toMatchObject({
      kind: "table",
      label: "billing",
      place: ["Synthetic Alpha", "Harbor"],
      rank: 0,
    });
    const terminal = worldSearchResults(world, "terminal");
    expect(terminal.map((result) => result.kind)).toEqual(["terminal"]);
    const rooms = worldSearchResults(world, "harbor room");
    expect(rooms.map((result) => [result.kind, result.place])).toEqual([
      ["room", ["Synthetic Alpha"]],
      ["room", ["Synthetic Beta"]],
    ]);
  });

  test("names come before places and task summaries", () => {
    const results = worldSearchResults(world, "release");
    // The tables are named release; their panes are only at one.
    expect(results.map((result) => [result.kind, result.rank])).toEqual([
      ["table", 0],
      ["table", 0],
      ["agent", 1],
      ["terminal", 1],
      ["agent", 1],
    ]);
    const summary = worldSearchResults(world, "invoice");
    expect(summary).toHaveLength(1);
    expect(summary[0]!.rank).toBe(2);
  });

  test("a task summary match has an excerpt with the words picked out", () => {
    const [result] = worldSearchResults(world, "redirect codex");
    expect(result!.excerpt).toEqual([
      { text: "Fix the login ", match: false },
      { text: "redirect", match: true },
      { text: " for admins", match: false },
    ]);
    // A name match has none.
    expect(worldSearchResults(world, "codex")[0]!.excerpt).toBeNull();
  });

  test("a long summary is cut around its first matched word", () => {
    const summary = `${"a ".repeat(60)}needle ${"b ".repeat(60)}`;
    const parts = worldSearchExcerpt(summary, ["needle"], 40);
    const text = parts.map((part) => part.text).join("");
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(42);
    expect(parts.filter((part) => part.match)).toEqual([
      { text: "needle", match: true },
    ]);
  });

  test("Desk matches with the same words", () => {
    const leaf = world.leaves.find(
      (entry) => entry.pane.pane_id === "builder",
    )!;
    expect(matchesQuery(leaf, null, "LOGIN codex")).toBe(true);
    expect(matchesQuery(leaf, null, "codex nowhere")).toBe(false);
  });
});
