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
      /** True only when every pane was confirmed back where it started. */
      rolled_back: boolean;
      /** False when panes were moved back: Herdr cannot always rebuild a layout. */
      layout_restored?: boolean;
      /** False when the panes' locations could not be read. */
      topology_known?: boolean;
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
      return rollBack(
        call,
        request,
        terminalOf,
        "The host reconnected during the move.",
      );
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
      return rollBack(
        call,
        request,
        terminalOf,
        `Moving the desk failed: ${failure}`,
      );
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
 * Move the desk's panes back into the original tab, next to a pane still
 * there. Success is claimed only after every captured terminal is found back
 * in that tab; an unreadable topology, a reconnect or a failed move leaves
 * the outcome uncertain rather than restored. Herdr can only split a target
 * rightward or downward, so the original layout cannot always be rebuilt:
 * a desk that had panes moved back reports that its layout may differ.
 */
async function rollBack(
  call: HerdrCall,
  request: DeskMoveRequest,
  terminalOf: Map<string, string>,
  failure: string,
): Promise<MoveOutcome> {
  const locate = async (): Promise<Map<string, PaneRecord> | null> => {
    try {
      const live = await listPanes(call);
      return new Map(live.map((pane) => [pane.terminal_id, pane]));
    } catch {
      return null;
    }
  };
  let where = await locate();
  let stopped: string | null = null;
  let movedBack = 0;
  for (const terminal of terminalOf.values()) {
    if (!where) break;
    const pane = where.get(terminal);
    // A pane that cannot be found stays unknown; it is never assumed home.
    if (!pane || pane.tab_id === request.tab_id) continue;
    const home = [...where.values()].find(
      (candidate) => candidate.tab_id === request.tab_id,
    );
    if (!home) {
      stopped = "The original desk has no pane left to return to.";
      break;
    }
    // Every compensating move needs the same runtime the move started on.
    if (!request.isCurrent()) {
      stopped = "The host reconnected before the desk could be moved back.";
      break;
    }
    try {
      if (
        movedPane(
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
        )
      )
        movedBack += 1;
    } catch {
      // The next observation shows where the pane really is.
    }
    where = await locate();
  }
  const restored =
    where !== null &&
    [...terminalOf.values()].every(
      (terminal) => where!.get(terminal)?.tab_id === request.tab_id,
    );
  const topology = where
    ? [...terminalOf.values()].flatMap((terminal) => {
        const pane = where!.get(terminal);
        return pane
          ? [
              {
                terminal_id: terminal,
                pane_id: pane.pane_id,
                tab_id: pane.tab_id,
              },
            ]
          : [];
      })
    : [];
  const message = restored
    ? movedBack
      ? `${failure} The desk was moved back to its room; its pane layout may differ.`
      : `${failure} Nothing was moved.`
    : `${failure} ${stopped ?? (where ? "Some panes could not be moved back." : "Where its panes are now could not be read.")}`;
  return {
    status: "failed",
    message,
    rolled_back: restored,
    layout_restored: restored && movedBack === 0,
    topology_known: where !== null,
    topology,
  };
}

export type PaneMoveRequest = {
  pane_id: string;
  /** The destination desk (tab). */
  tab_id: string;
  allow_close_room?: boolean;
  isCurrent: () => boolean;
};

/**
 * Move one pane into another desk. The service reads the destination's full
 * layout, so a crowded desk (more panes than Town draws) is handled: the pane
 * joins next to the desk's last pane, across the table (down) when the desk
 * has an odd number of panes and beside it (right) otherwise.
 */
export async function movePane(
  call: HerdrCall,
  request: PaneMoveRequest,
): Promise<MoveOutcome> {
  let exported: unknown;
  try {
    exported = await call("layout.export", { tab_id: request.tab_id });
  } catch (error) {
    return /unknown|not found|unsupported|method/i.test(errorText(error))
      ? refuse("unsupported", "Moving agents needs the latest Herdr.")
      : refuse("not_found", `That desk could not be read: ${errorText(error)}`);
  }
  const layout = (exported as { layout?: Record<string, unknown> })?.layout;
  const root = parseLayout(layout?.root);
  if (!root)
    return refuse("not_found", "That desk's layout could not be read.");
  const destination = leavesOf(root);
  const neighbour = destination[destination.length - 1]!;
  const split: SplitDirection = destination.length % 2 === 1 ? "down" : "right";

  const panes = await listPanes(call);
  const pane = panes.find((candidate) => candidate.pane_id === request.pane_id);
  const target = panes.find((candidate) => candidate.pane_id === neighbour);
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
          split,
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
    // Never retry: report where the pane is, and claim it stayed home only
    // when it is positively found there.
    let now: PaneRecord | undefined;
    let known = true;
    try {
      now = (await listPanes(call)).find(
        (candidate) => candidate.terminal_id === pane.terminal_id,
      );
    } catch {
      known = false;
    }
    const home = Boolean(now && now.tab_id === pane.tab_id);
    return {
      status: "failed",
      message: home
        ? `Moving the agent failed: ${errorText(error)}`
        : known && now
          ? `Moving the agent may have partly happened: ${errorText(error)}`
          : `Moving the agent failed, and where it is now could not be read: ${errorText(error)}`,
      rolled_back: home,
      topology_known: known,
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

/**
 * Runs moves for one connection one at a time. A move reads the source room
 * (for example the last-desk check) and then mutates over several calls; two
 * overlapping moves could otherwise both pass the check and close a room no
 * one agreed to close. Each queued move re-reads the topology when it starts.
 */
export function createMoveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
