import { describe, expect, test } from "bun:test";
import {
  createMoveQueue,
  leavesOf,
  moveDesk,
  movePane,
  planDeskMove,
  type HerdrCall,
  type LayoutNode,
} from "./desk-move";

type Pane = { terminal: string; tab: string; workspace: string };

/**
 * A fake Herdr with the pane-move behaviour observed on a live 0.9 session:
 * a pane moved to another workspace gets a new pane ID and keeps its
 * terminal; an emptied tab closes, and an emptied workspace disappears.
 */
function fakeHerdr(options: {
  failAt?: number;
  uncertainAt?: number;
  noLayoutExport?: boolean;
  /** pane.list fails once this many pane moves have been attempted. */
  listFailsAfterMoves?: number;
}) {
  const panes = new Map<string, Pane>();
  const tabs = new Map<string, { workspace: string; label: string }>();
  const counters = new Map<string, number>();
  const next = (workspace: string, kind: string) => {
    const key = `${workspace}:${kind}`;
    const value = (counters.get(key) ?? 0) + 1;
    counters.set(key, value);
    return `${workspace}:${kind}${value}`;
  };
  let tree: LayoutNode | null = null;
  let moves = 0;
  const calls: string[] = [];
  const addTab = (workspace: string, label: string, count: number) => {
    const tab = next(workspace, "t");
    tabs.set(tab, { workspace, label });
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = next(workspace, "p");
      panes.set(id, { terminal: `term-${id}`, tab, workspace });
      ids.push(id);
    }
    return { tab, ids };
  };
  const call: HerdrCall = async (method, params) => {
    if (method === "layout.export") {
      if (options.noLayoutExport) throw new Error("unknown method");
      const tabId = params.tab_id as string;
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("tab not found");
      const ids = [...panes]
        .filter(([, pane]) => pane.tab === tabId)
        .map(([id]) => id);
      // The configured desk tree while it is intact, else a row of panes.
      const intact =
        tree !== null &&
        leavesOf(tree).every((id) => panes.get(id)?.tab === tabId);
      const chain = (rest: string[]): LayoutNode =>
        rest.length === 1
          ? { type: "pane", pane_id: rest[0]! }
          : {
              type: "split",
              direction: "right",
              ratio: 0.5,
              first: { type: "pane", pane_id: rest[0]! },
              second: chain(rest.slice(1)),
            };
      return {
        type: "layout_export",
        layout: {
          workspace_id: tab.workspace,
          tab_id: tabId,
          root: intact ? tree : chain(ids),
        },
      };
    }
    if (
      method === "pane.list" &&
      options.listFailsAfterMoves !== undefined &&
      moves >= options.listFailsAfterMoves
    )
      throw new Error("list unavailable");
    if (method === "pane.list")
      return {
        panes: [...panes].map(([pane_id, pane]) => ({
          pane_id,
          terminal_id: pane.terminal,
          tab_id: pane.tab,
          workspace_id: pane.workspace,
        })),
      };
    if (method === "tab.list")
      return {
        tabs: [...tabs]
          .filter(([, tab]) => tab.workspace === params.workspace_id)
          .map(([tab_id, tab]) => ({
            tab_id,
            label: tab.label,
            workspace_id: tab.workspace,
          })),
      };
    if (method === "pane.move") {
      moves += 1;
      calls.push(params.pane_id as string);
      if (moves === options.failAt) throw new Error("rejected");
      const id = params.pane_id as string;
      const pane = panes.get(id);
      if (!pane) throw new Error("pane not found");
      const destination = params.destination as Record<string, string>;
      let tab: string;
      let workspace: string;
      if (destination.type === "new_tab") {
        workspace = destination.workspace_id!;
        tab = next(workspace, "t");
        tabs.set(tab, { workspace, label: destination.label ?? "" });
      } else {
        tab = destination.tab_id!;
        const target = panes.get(destination.target_pane_id!);
        if (!tabs.has(tab) || target?.tab !== tab)
          throw new Error("target not found");
        workspace = tabs.get(tab)!.workspace;
      }
      const from = pane.tab;
      const newId = workspace === pane.workspace ? id : next(workspace, "p");
      panes.delete(id);
      panes.set(newId, { terminal: pane.terminal, tab, workspace });
      if (![...panes.values()].some((p) => p.tab === from)) {
        const emptied = tabs.get(from)!.workspace;
        tabs.delete(from);
        if (![...tabs.values()].some((t) => t.workspace === emptied))
          counters.set(`${emptied}:gone`, 1);
      }
      const result = {
        type: "pane_move",
        move_result: {
          previous_pane_id: id,
          pane: { pane_id: newId, tab_id: tab, workspace_id: workspace },
        },
      };
      if (moves === options.uncertainAt) throw new Error("timeout");
      return result;
    }
    throw new Error(`unexpected ${method}`);
  };
  return {
    call,
    panes,
    tabs,
    addTab,
    setTree: (root: LayoutNode) => (tree = root),
    roomGone: (workspace: string) => counters.has(`${workspace}:gone`),
    moves: () => moves,
    calls,
  };
}

/** A three-pane desk: p1 | (p2 / p3), as in the probe. */
function threePaneDesk(herdr: ReturnType<typeof fakeHerdr>, keepRoom = true) {
  const desk = herdr.addTab("w1", "api", 3);
  if (keepRoom) herdr.addTab("w1", "other", 1);
  herdr.addTab("w2", "target", 1);
  const [p1, p2, p3] = desk.ids as [string, string, string];
  herdr.setTree({
    type: "split",
    direction: "right",
    ratio: 0.6,
    first: { type: "pane", pane_id: p1 },
    second: {
      type: "split",
      direction: "down",
      ratio: 0.3,
      first: { type: "pane", pane_id: p2 },
      second: { type: "pane", pane_id: p3 },
    },
  });
  return { ...desk, p1, p2, p3 };
}

const current = () => true;

describe("desk move planning", () => {
  test("replays the tree: anchor, then carve each second side from the first", () => {
    const herdr = fakeHerdr({});
    const { p1, p2, p3 } = threePaneDesk(herdr);
    const tree: LayoutNode = {
      type: "split",
      direction: "right",
      ratio: 0.6,
      first: { type: "pane", pane_id: p1 },
      second: {
        type: "split",
        direction: "down",
        ratio: 0.3,
        first: { type: "pane", pane_id: p2 },
        second: { type: "pane", pane_id: p3 },
      },
    };
    expect(leavesOf(tree)).toEqual([p1, p2, p3]);
    expect(planDeskMove(tree)).toEqual([
      { pane: p1, kind: "anchor" },
      { pane: p2, kind: "split", target: p1, direction: "right", ratio: 0.6 },
      { pane: p3, kind: "split", target: p2, direction: "down", ratio: 0.3 },
    ]);
  });
});

describe("desk moves", () => {
  test("moves every live pane into one new tab in the target room", async () => {
    const herdr = fakeHerdr({});
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome.status).toBe("moved");
    if (outcome.status !== "moved") return;
    expect(herdr.tabs.get(outcome.tab_id)).toEqual({
      workspace: "w2",
      label: "api",
    });
    // Same terminals, new pane IDs, all in the new tab.
    for (const { previous, current: now } of outcome.panes) {
      expect(now).not.toBe(previous);
      expect(herdr.panes.get(now)).toEqual({
        terminal: `term-${previous}`,
        tab: outcome.tab_id,
        workspace: "w2",
      });
    }
    expect(herdr.tabs.has(desk.tab)).toBe(false);
  });

  test("refuses without moving anything when a pane closes after the layout is captured", async () => {
    const herdr = fakeHerdr({});
    const desk = threePaneDesk(herdr);
    // The pane closes between layout.export and the pane check.
    const call: HerdrCall = async (method, params) => {
      const result = await herdr.call(method, params);
      if (method === "layout.export") herdr.panes.delete(desk.p3);
      return result;
    };
    const outcome = await moveDesk(call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "desk_changed",
    });
    expect(herdr.moves()).toBe(0);
  });

  test("refuses a move into the desk's own room", async () => {
    const herdr = fakeHerdr({});
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w1",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "same_room" });
  });

  test("asks before moving a room's last desk, and closes the room when allowed", async () => {
    const herdr = fakeHerdr({});
    const desk = threePaneDesk(herdr, false);
    const refused = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(refused).toMatchObject({
      status: "refused",
      reason: "room_would_close",
    });
    expect(herdr.moves()).toBe(0);
    const moved = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      allow_close_room: true,
      isCurrent: current,
    });
    expect(moved.status).toBe("moved");
    expect(herdr.roomGone("w1")).toBe(true);
  });

  test("refuses on a Herdr without layout export", async () => {
    const herdr = fakeHerdr({ noLayoutExport: true });
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "unsupported" });
  });

  for (const failAt of [1, 2, 3])
    test(`rolls back every moved pane when step ${failAt} fails`, async () => {
      const herdr = fakeHerdr({ failAt });
      const desk = threePaneDesk(herdr);
      const outcome = await moveDesk(herdr.call, {
        tab_id: desk.tab,
        workspace_id: "w2",
        isCurrent: current,
      });
      expect(outcome).toMatchObject({ status: "failed", rolled_back: true });
      if (outcome.status === "failed" && failAt > 1) {
        // Panes moved back; Herdr cannot always rebuild the split layout.
        expect(outcome.layout_restored).toBe(false);
        expect(outcome.message).toContain("layout may differ");
      }
      // All three terminals are back in the original tab.
      const home = [...herdr.panes.values()].filter((p) => p.tab === desk.tab);
      expect(home.map((p) => p.terminal).sort()).toEqual(
        desk.ids.map((id) => `term-${id}`).sort(),
      );
      // The emptied new tab closed; nothing is left in the target room.
      expect(
        [...herdr.tabs.values()].filter((t) => t.workspace === "w2").length,
      ).toBe(1);
    });

  test("an uncertain step that did move its pane is rolled back too", async () => {
    const herdr = fakeHerdr({ uncertainAt: 2 });
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({ status: "failed", rolled_back: true });
    const home = [...herdr.panes.values()].filter((p) => p.tab === desk.tab);
    expect(home.length).toBe(3);
  });

  test("a host reconnect mid-move stops and reports where each pane is", async () => {
    const herdr = fakeHerdr({});
    const desk = threePaneDesk(herdr);
    let calls = 0;
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      // Current for the checks and the first step, then the generation changes.
      isCurrent: () => (calls += 1) <= 2,
    });
    expect(outcome).toMatchObject({ status: "failed", rolled_back: false });
    if (outcome.status === "failed")
      expect(outcome.topology.map((p) => p.terminal_id).sort()).toEqual(
        desk.ids.map((id) => `term-${id}`).sort(),
      );
  });
});

describe("rollback evidence and ordering", () => {
  test("rollback stops when the runtime retires between compensating moves", async () => {
    const herdr = fakeHerdr({ failAt: 3 });
    const desk = threePaneDesk(herdr);
    let retired = false;
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      // Retire as soon as the first compensating move (move 4) was sent.
      isCurrent: () => {
        if (herdr.moves() >= 4) retired = true;
        return !retired;
      },
    });
    expect(outcome).toMatchObject({ status: "failed", rolled_back: false });
    // Two forward moves, the failed third, and exactly one compensation.
    expect(herdr.moves()).toBe(4);
  });

  test("a move back whose reply is lost still reports that the layout may differ", async () => {
    // Move 1 succeeds, move 2 is rejected, compensation (move 3) succeeds
    // but its reply is lost.
    const herdr = fakeHerdr({ failAt: 2, uncertainAt: 3 });
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      rolled_back: true,
      layout_restored: false,
    });
    if (outcome.status === "failed")
      expect(outcome.message).toContain("layout may differ");
  });

  test("a move that failed before anything left reports the layout intact", async () => {
    const herdr = fakeHerdr({ failAt: 1 });
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      rolled_back: true,
      layout_restored: true,
    });
  });

  test("an unreadable topology never counts as rolled back", async () => {
    const herdr = fakeHerdr({ uncertainAt: 1, listFailsAfterMoves: 1 });
    const desk = threePaneDesk(herdr);
    const outcome = await moveDesk(herdr.call, {
      tab_id: desk.tab,
      workspace_id: "w2",
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      rolled_back: false,
      topology_known: false,
    });
  });

  test("queued moves re-check the last desk: a room's two desks never both leave silently", async () => {
    const herdr = fakeHerdr({});
    const first = herdr.addTab("w1", "one", 1);
    const second = herdr.addTab("w1", "two", 1);
    herdr.addTab("w2", "target", 1);
    const queue = createMoveQueue();
    const move = (tab: string) =>
      queue(() =>
        moveDesk(herdr.call, {
          tab_id: tab,
          workspace_id: "w2",
          isCurrent: current,
        }),
      );
    const outcomes = await Promise.all([move(first.tab), move(second.tab)]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["moved", "refused"]);
    expect(outcomes.find((o) => o.status === "refused")).toMatchObject({
      reason: "room_would_close",
    });
    expect(herdr.roomGone("w1")).toBe(false);
  });
});

describe("agent moves", () => {
  test("joins a crowded desk next to its last pane, across the table for an odd count", async () => {
    const herdr = fakeHerdr({});
    const source = herdr.addTab("w1", "a", 2);
    const target = herdr.addTab("w1", "b", 5);
    let sent: Record<string, unknown> | undefined;
    const call: HerdrCall = (method, params) => {
      if (method === "pane.move") sent = params;
      return herdr.call(method, params);
    };
    const outcome = await movePane(call, {
      pane_id: source.ids[1]!,
      tab_id: target.tab,
      isCurrent: current,
    });
    expect(outcome.status).toBe("moved");
    // The fifth pane, not the fourth Town draws; five panes split down.
    expect(sent?.destination).toMatchObject({
      target_pane_id: target.ids[4],
      split: "down",
    });
  });

  test("asks before moving the only pane of a room's last desk", async () => {
    const herdr = fakeHerdr({});
    const source = herdr.addTab("w1", "a", 1);
    const target = herdr.addTab("w2", "b", 1);
    const outcome = await movePane(herdr.call, {
      pane_id: source.ids[0]!,
      tab_id: target.tab,
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "room_would_close",
    });
    expect(herdr.moves()).toBe(0);
  });

  test("a failed agent move whose location cannot be read is not called rolled back", async () => {
    const herdr = fakeHerdr({ failAt: 1, listFailsAfterMoves: 1 });
    const source = herdr.addTab("w1", "a", 2);
    const target = herdr.addTab("w1", "b", 1);
    const outcome = await movePane(herdr.call, {
      pane_id: source.ids[1]!,
      tab_id: target.tab,
      isCurrent: current,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      rolled_back: false,
      topology_known: false,
    });
  });
});
