import { leavesOf, type HerdrCall, type LayoutNode } from "../desk-move";

type Pane = { terminal: string; tab: string; workspace: string };

/**
 * A fake Herdr with the pane-move behaviour observed on a live 0.9 session:
 * a pane moved to another workspace gets a new pane ID and keeps its
 * terminal; an emptied tab closes, and an emptied workspace disappears.
 */
export function fakeHerdr(options: {
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
