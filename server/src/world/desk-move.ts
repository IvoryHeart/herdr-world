/**
 * Moves a Town desk (a Herdr tab) to another workspace of the same host, or one
 * agent pane to another desk, by relocating the live panes with `pane.move`.
 * Panes are never respawned, so agents and shells keep running.
 *
 * Herdr has no cross-workspace tab move, so a desk move is several pane moves.
 * The replay order is derived from herdr-drovr (MIT, Copyright (c) 2026
 * Bassim Shahidy; see THIRD_PARTY_NOTICES.md):
 * the first pane opens a new tab, then for each split the second region is
 * carved out of the pane currently filling the split's region, with the
 * captured direction and ratio, and both sides recurse. World captures the
 * tree with `layout.export`, checks it accounts for every pane, follows the
 * pane IDs that each move replaces, rolls back on failure (drovr does not) and
 * never retries an uncertain step.
 */

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type SplitDirection = "right" | "down";

export type LayoutNode =
  | { type: "pane"; pane_id: string }
  | {
      type: "split";
      direction: SplitDirection;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

/** One pane move of a desk replay, addressed by the pane's original ID. */
export type DeskMoveStep =
  | { pane: string; kind: "anchor" }
  | {
      pane: string;
      kind: "split";
      /** Original ID of the pane whose region this pane is carved out of. */
      target: string;
      direction: SplitDirection;
      ratio: number;
    };

export type MovedPane = { previous: string; current: string };

export type MoveOutcome =
  | {
      status: "moved";
      tab_id: string;
      workspace_id: string;
      panes: MovedPane[];
    }
  | { status: "refused"; reason: MoveRefusal; message: string }
  | {
      status: "failed";
      message: string;
      rolled_back: boolean;
      /** Where each of the desk's panes is now, by terminal. */
      topology: { terminal_id: string; pane_id: string; tab_id: string }[];
    };

export type MoveRefusal =
  | "unsupported"
  | "same_room"
  | "desk_changed"
  | "room_would_close"
  | "not_found"
  | "stale";

type PaneRecord = {
  pane_id: string;
  terminal_id: string;
  tab_id: string;
  workspace_id: string;
};

export function leavesOf(node: LayoutNode, out: string[] = []): string[] {
  if (node.type === "pane") out.push(node.pane_id);
  else {
    leavesOf(node.first, out);
    leavesOf(node.second, out);
  }
  return out;
}

const anchorOf = (node: LayoutNode): string =>
  node.type === "pane" ? node.pane_id : anchorOf(node.first);

/** The ordered pane moves that rebuild `root` in a new tab. */
export function planDeskMove(root: LayoutNode): DeskMoveStep[] {
  const steps: DeskMoveStep[] = [{ pane: anchorOf(root), kind: "anchor" }];
  const place = (node: LayoutNode) => {
    if (node.type === "pane") return;
    // The first side's anchor fills this region; carve the second side out
    // of it before subdividing either side.
    steps.push({
      pane: anchorOf(node.second),
      kind: "split",
      target: anchorOf(node.first),
      direction: node.direction,
      ratio: node.ratio,
    });
    place(node.first);
    place(node.second);
  };
  place(root);
  return steps;
}

function parseLayout(value: unknown): LayoutNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  if (node.type === "pane")
    return typeof node.pane_id === "string"
      ? { type: "pane", pane_id: node.pane_id }
      : null;
  if (
    node.type !== "split" ||
    (node.direction !== "right" && node.direction !== "down") ||
    typeof node.ratio !== "number"
  )
    return null;
  const first = parseLayout(node.first);
  const second = parseLayout(node.second);
  return first && second
    ? {
        type: "split",
        direction: node.direction,
        ratio: node.ratio,
        first,
        second,
      }
    : null;
}

async function listPanes(call: HerdrCall): Promise<PaneRecord[]> {
  const result = (await call("pane.list", {})) as {
    panes?: Partial<PaneRecord>[];
  };
  return (result?.panes ?? []).filter(
    (pane): pane is PaneRecord =>
      typeof pane.pane_id === "string" &&
      typeof pane.terminal_id === "string" &&
      typeof pane.tab_id === "string" &&
      typeof pane.workspace_id === "string",
  );
}

async function listTabs(call: HerdrCall, workspaceId: string) {
  const result = (await call("tab.list", { workspace_id: workspaceId })) as {
    tabs?: { tab_id?: string; label?: string; workspace_id?: string }[];
  };
  return (result?.tabs ?? []).filter(
    (tab) => tab.workspace_id === undefined || tab.workspace_id === workspaceId,
  );
}

/** The moved pane reported by a `pane.move` result, or null if malformed. */
function movedPane(
  result: unknown,
): { previous: string; pane_id: string; tab_id: string } | null {
  const moved = (result as { move_result?: Record<string, unknown> })
    ?.move_result;
  const pane = moved?.pane as Record<string, unknown> | undefined;
  return typeof moved?.previous_pane_id === "string" &&
    typeof pane?.pane_id === "string" &&
    typeof pane?.tab_id === "string"
    ? {
        previous: moved.previous_pane_id,
        pane_id: pane.pane_id,
        tab_id: pane.tab_id,
      }
    : null;
}

const refuse = (reason: MoveRefusal, message: string): MoveOutcome => ({
  status: "refused",
  reason,
  message,
});

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export type DeskMoveRequest = {
  tab_id: string;
  workspace_id: string;
  /** The source room closes when its last desk leaves; the user agreed. */
  allow_close_room?: boolean;
  /** False once the connection's runtime generation has changed. */
  isCurrent: () => boolean;
};

export async function moveDesk(
  call: HerdrCall,
  request: DeskMoveRequest,
): Promise<MoveOutcome> {
  let exported: unknown;
  try {
    exported = await call("layout.export", { tab_id: request.tab_id });
  } catch (error) {
    return /unknown|not found|unsupported|method/i.test(errorText(error))
      ? refuse("unsupported", "Moving desks needs the latest Herdr.")
      : refuse("not_found", `This desk could not be read: ${errorText(error)}`);
  }
  const layout = (exported as { layout?: Record<string, unknown> })?.layout;
  const root = parseLayout(layout?.root);
  const sourceWorkspace = layout?.workspace_id;
  if (!root || typeof sourceWorkspace !== "string")
    return refuse("not_found", "This desk's layout could not be read.");
  if (sourceWorkspace === request.workspace_id)
    return refuse("same_room", "The desk is already in that room.");

  const leaves = leavesOf(root);
  const panes = await listPanes(call);
  const tabPanes = panes.filter((pane) => pane.tab_id === request.tab_id);
  const byId = new Map(tabPanes.map((pane) => [pane.pane_id, pane]));
  if (
    leaves.length !== tabPanes.length ||
    new Set(leaves).size !== leaves.length ||
    leaves.some((id) => !byId.has(id))
  )
    return refuse(
      "desk_changed",
      "The desk changed before it could move. Try again.",
    );

  const sourceTabs = await listTabs(call, sourceWorkspace);
  const label =
    sourceTabs.find((tab) => tab.tab_id === request.tab_id)?.label ?? null;
  if (sourceTabs.length <= 1 && !request.allow_close_room)
    return refuse(
      "room_would_close",
      "This is the room's last desk; moving it closes the room.",
    );
  if (!request.isCurrent())
    return refuse("stale", "The host reconnected. Try again.");

  // Every step addresses panes by their current ID; terminals identify them
  // across replacements.
  const terminalOf = new Map(
    leaves.map((id) => [id, byId.get(id)!.terminal_id]),
  );
  const current = new Map(leaves.map((id) => [id, id]));
  const moved: string[] = [];
  let targetTab: string | null = null;
  const steps = planDeskMove(root);
  for (const step of steps) {
    if (!request.isCurrent())
      return rollBack(call, request, terminalOf, moved, current, targetTab, {
        message: "The host reconnected during the move.",
      });
    const destination =
      step.kind === "anchor"
        ? {
            type: "new_tab",
            workspace_id: request.workspace_id,
            ...(label ? { label } : {}),
          }
        : {
            type: "tab",
            tab_id: targetTab,
            split: step.direction,
            target_pane_id: current.get(step.target),
            ratio: step.ratio,
          };
    let result: ReturnType<typeof movedPane> = null;
    let failure: string | null = null;
    try {
      result = movedPane(
        await call("pane.move", {
          pane_id: current.get(step.pane),
          destination,
          focus: false,
        }),
      );
      if (!result) failure = "Herdr did not confirm the pane move.";
    } catch (error) {
      failure = errorText(error);
    }
    if (failure || !result) {
      // Never retry an uncertain step: find where the pane really is, then
      // roll back whatever moved.
      return rollBack(call, request, terminalOf, moved, current, targetTab, {
        message: `Moving the desk failed: ${failure}`,
        uncertain: step.pane,
      });
    }
    current.set(step.pane, result.pane_id);
    moved.push(step.pane);
    if (step.kind === "anchor") targetTab = result.tab_id;
  }
  return {
    status: "moved",
    tab_id: targetTab!,
    workspace_id: request.workspace_id,
    panes: leaves.map((id) => ({ previous: id, current: current.get(id)! })),
  };
}

/**
 * Move the panes that reached the new tab back into the original tab, next to
 * a pane still there, then report where every pane of the desk is.
 */
async function rollBack(
  call: HerdrCall,
  request: DeskMoveRequest,
  terminalOf: Map<string, string>,
  moved: string[],
  current: Map<string, string>,
  targetTab: string | null,
  failure: { message: string; uncertain?: string },
): Promise<MoveOutcome> {
  const locate = async () => {
    const live = await listPanes(call).catch(() => [] as PaneRecord[]);
    const byTerminal = new Map(live.map((pane) => [pane.terminal_id, pane]));
    return { live, byTerminal };
  };
  let { byTerminal } = await locate();
  // An uncertain step may still have moved its pane.
  if (failure.uncertain) {
    const pane = byTerminal.get(terminalOf.get(failure.uncertain)!);
    if (pane) {
      current.set(failure.uncertain, pane.pane_id);
      if (targetTab && pane.tab_id === targetTab) moved.push(failure.uncertain);
      else if (!targetTab && pane.tab_id !== request.tab_id) {
        targetTab = pane.tab_id;
        moved.push(failure.uncertain);
      }
    }
  }
  let rolledBack = moved.length === 0;
  if (moved.length && request.isCurrent()) {
    rolledBack = true;
    for (const original of moved) {
      const pane = byTerminal.get(terminalOf.get(original)!);
      const home = [...byTerminal.values()].find(
        (candidate) => candidate.tab_id === request.tab_id,
      );
      if (!pane || pane.tab_id === request.tab_id) continue;
      if (!home) {
        rolledBack = false;
        break;
      }
      try {
        const result = movedPane(
          await call("pane.move", {
            pane_id: pane.pane_id,
            destination: {
              type: "tab",
              tab_id: request.tab_id,
              split: "right",
              target_pane_id: home.pane_id,
            },
            focus: false,
          }),
        );
        if (!result) rolledBack = false;
      } catch {
        rolledBack = false;
      }
      ({ byTerminal } = await locate());
    }
  } else if (moved.length) rolledBack = false;
  const topology = [...terminalOf.values()].flatMap((terminal) => {
    const pane = byTerminal.get(terminal);
    return pane
      ? [{ terminal_id: terminal, pane_id: pane.pane_id, tab_id: pane.tab_id }]
      : [];
  });
  return {
    status: "failed",
    message: rolledBack
      ? `${failure.message} The desk was moved back.`
      : `${failure.message} Some panes could not be moved back.`,
    rolled_back: rolledBack,
    topology,
  };
}

export type PaneMoveRequest = {
  pane_id: string;
  tab_id: string;
  target_pane_id: string;
  split: SplitDirection;
  allow_close_room?: boolean;
  isCurrent: () => boolean;
};

/** Move one pane into another desk, next to the pane nearest its new seat. */
export async function movePane(
  call: HerdrCall,
  request: PaneMoveRequest,
): Promise<MoveOutcome> {
  const panes = await listPanes(call);
  const pane = panes.find((candidate) => candidate.pane_id === request.pane_id);
  const target = panes.find(
    (candidate) => candidate.pane_id === request.target_pane_id,
  );
  if (!pane || !target || target.tab_id !== request.tab_id)
    return refuse("desk_changed", "The desks changed. Try again.");
  if (pane.tab_id === request.tab_id)
    return refuse("same_room", "The agent is already at that desk.");
  const alone =
    panes.filter((candidate) => candidate.tab_id === pane.tab_id).length === 1;
  if (alone) {
    const tabs = await listTabs(call, pane.workspace_id);
    if (tabs.length <= 1 && !request.allow_close_room)
      return refuse(
        "room_would_close",
        "This is the room's last desk; moving its only pane closes the room.",
      );
  }
  if (!request.isCurrent())
    return refuse("stale", "The host reconnected. Try again.");
  try {
    const result = movedPane(
      await call("pane.move", {
        pane_id: pane.pane_id,
        destination: {
          type: "tab",
          tab_id: request.tab_id,
          split: request.split,
          target_pane_id: target.pane_id,
        },
        focus: false,
      }),
    );
    if (!result) throw new Error("Herdr did not confirm the pane move.");
    return {
      status: "moved",
      tab_id: result.tab_id,
      workspace_id: target.workspace_id,
      panes: [{ previous: pane.pane_id, current: result.pane_id }],
    };
  } catch (error) {
    const live = await listPanes(call).catch(() => [] as PaneRecord[]);
    const now = live.find(
      (candidate) => candidate.terminal_id === pane.terminal_id,
    );
    return {
      status: "failed",
      message: `Moving the agent failed: ${errorText(error)}`,
      rolled_back: !now || now.tab_id === pane.tab_id,
      topology: now
        ? [
            {
              terminal_id: now.terminal_id,
              pane_id: now.pane_id,
              tab_id: now.tab_id,
            },
          ]
        : [],
    };
  }
}
