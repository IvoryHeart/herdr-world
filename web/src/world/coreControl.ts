import { bridge } from "../api";
import type { CoreAlsoEnded } from "../../../shared/coreKill";

/**
 * World's control of a herdr-core connection (world.core.*): starting
 * agents and shells, World's own rooms of that core, and native kills.
 * Every call names the core connection and the runtime generation the
 * person saw; the service refuses it when the core has since reconnected.
 *
 * Opening a core terminal and chatting with its agent are not here yet:
 * those nodes keep their view-only reason.
 */
export type CoreTarget = { connectionId: string; generation: number };

export { CORE_APP_SPACE_REASON, isCoreAppSpace } from "./coreRooms";

const fenced = (target: CoreTarget) => ({
  connection_id: target.connectionId,
  connection_generation: target.generation,
});

export type CoreKillPlanEntry = {
  address: string;
  pid: number | null;
  /** The program's print, confirmed with it (a replacement is refused). */
  occupant: string | null;
  /** The terminal whose end ends this one. */
  parent?: string;
  name: string | null;
  /** On a machine linked to this core: it ends there too. */
  remote: boolean;
  /** What a person recognises it by: its name, tab or program. */
  label: string;
  room?: string;
};
export type CoreKillPlan = {
  core_id: string;
  roots: CoreKillPlanEntry[];
  descendants: CoreKillPlanEntry[];
};
export type CoreKillConfirmation = {
  core_id: string;
  terminals: Array<{
    address: string;
    pid: number | null;
    occupant: string | null;
    remote?: boolean;
  }>;
};

function parseEntry(value: unknown): CoreKillPlanEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.address !== "string") return null;
  return {
    address: e.address,
    pid: typeof e.pid === "number" ? e.pid : null,
    occupant: typeof e.occupant === "string" ? e.occupant : null,
    ...(typeof e.parent === "string" ? { parent: e.parent } : {}),
    name: typeof e.name === "string" ? e.name : null,
    remote: e.remote === true,
    label:
      typeof e.label === "string" && e.label
        ? e.label.slice(0, 100)
        : e.address,
    ...(typeof e.room === "string" && e.room
      ? { room: e.room.slice(0, 100) }
      : {}),
  };
}

export function parseCoreKillPlan(value: unknown): CoreKillPlan {
  const plan = (value ?? {}) as Record<string, unknown>;
  const list = (items: unknown) =>
    (Array.isArray(items) ? items : [])
      .map(parseEntry)
      .filter((entry): entry is CoreKillPlanEntry => entry !== null);
  if (typeof plan.core_id !== "string")
    throw new Error("herdr-core sent no kill plan");
  return {
    core_id: plan.core_id,
    roots: list(plan.roots),
    descendants: list(plan.descendants),
  };
}

/** Everything the plan names: what the person confirms by confirming it. */
export function coreKillConfirmation(plan: CoreKillPlan): CoreKillConfirmation {
  return {
    core_id: plan.core_id,
    terminals: [...plan.roots, ...plan.descendants].map((entry) => ({
      address: entry.address,
      pid: entry.pid,
      occupant: entry.occupant,
      ...(entry.remote ? { remote: true } : {}),
    })),
  };
}

/** What would end with these terminals (or with everything in a room). */
export async function coreKillPlan(
  target: CoreTarget,
  what: { terminals: string[] } | { workspaceId: string },
): Promise<CoreKillPlan> {
  return parseCoreKillPlan(
    await bridge.call(
      "world.core.kill_plan",
      {
        ...fenced(target),
        ...("workspaceId" in what
          ? { workspace_id: what.workspaceId }
          : { terminals: what.terminals }),
      },
      30_000,
    ),
  );
}

export type CoreKillOutcome = {
  killed: string[];
  uncertain: string[];
  /** Ended by core's cascade without confirmation (started too late). */
  alsoEnded?: CoreAlsoEnded[];
};

export async function closeCoreRoom(
  target: CoreTarget,
  workspaceId: string,
  confirmation: CoreKillConfirmation,
): Promise<CoreKillOutcome> {
  return (await bridge.call(
    "world.core.room.close",
    { ...fenced(target), workspace_id: workspaceId, confirmation },
    60_000,
  )) as CoreKillOutcome;
}

export async function createCoreRoom(
  target: CoreTarget,
  label: string,
): Promise<{ workspace_id: string; label: string }> {
  return (await bridge.call(
    "world.core.room.create",
    { ...fenced(target), label },
    30_000,
  )) as { workspace_id: string; label: string };
}

export async function renameCoreRoom(
  target: CoreTarget,
  workspaceId: string,
  label: string,
) {
  await bridge.call(
    "world.core.room.rename",
    { ...fenced(target), workspace_id: workspaceId, label },
    30_000,
  );
}

export async function coreCatalog(target: CoreTarget) {
  return bridge.call("world.core.catalog", fenced(target), 30_000);
}

export type CoreLaunchOutcome = {
  status: "sent" | "started" | "uncertain" | "failed";
  message?: string;
  tab_id?: string;
  pane_id?: string;
  terminal_id?: string;
  agent_name?: string;
  /** Shown in Herdr's apps, which keep it running. */
  placed?: boolean;
};

export async function launchInCore(
  target: CoreTarget & { workspaceId: string },
  choice: {
    profileId?: string;
    kind?: string;
    label: string;
    text: string;
    /** A plain shell: unplaced in Herdr's apps. */
    shell?: boolean;
    parentPaneId?: string;
  },
): Promise<CoreLaunchOutcome> {
  return (await bridge.call(
    "world.core.launch",
    {
      ...fenced(target),
      workspace_id: target.workspaceId,
      profile_id: choice.profileId ?? "",
      kind: choice.kind ?? "",
      label: choice.label,
      text: choice.text,
      ...(choice.shell ? { shell: true } : {}),
      ...(choice.parentPaneId ? { parent_pane_id: choice.parentPaneId } : {}),
    },
    90_000,
  )) as CoreLaunchOutcome;
}

/** The sentence a confirmation shows for everything else that ends. */
export function coreKillDescendantsText(plan: CoreKillPlan): string[] {
  return plan.descendants.map((entry) => {
    const where = entry.remote
      ? "on a linked machine"
      : entry.room
        ? `in ${entry.room}`
        : "";
    return where ? `${entry.label} (${where})` : entry.label;
  });
}

/* ---------- Worktrees of a core room (P4) ---------- */

/** A Paseo/World worktree hook's outcome, as the service reports it. */
export type CoreWorktreeHookResult = {
  event:
    | "worktree.created"
    | "worktree.opened"
    | "worktree.before_remove"
    | "worktree.removed";
  status: "skipped" | "succeeded" | "failed";
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export type CoreWorktreeEntry = {
  path: string;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
  /** Already one of World's rooms. */
  open: boolean;
  workspaceId: string | null;
};

export function parseCoreWorktrees(value: unknown): CoreWorktreeEntry[] {
  const list = (value as { worktrees?: unknown } | null)?.worktrees;
  if (!Array.isArray(list)) throw new Error("herdr-core sent no worktree list");
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const e = item as Record<string, unknown>;
    if (typeof e.path !== "string" || !e.path.startsWith("/")) return [];
    return [
      {
        path: e.path,
        branch: typeof e.branch === "string" && e.branch ? e.branch : null,
        bare: e.is_bare === true,
        prunable: e.is_prunable === true,
        open: e.open === true,
        workspaceId: typeof e.workspace_id === "string" ? e.workspace_id : null,
      },
    ];
  });
}

export async function listCoreWorktrees(
  target: CoreTarget,
  workspaceId: string,
): Promise<CoreWorktreeEntry[]> {
  return parseCoreWorktrees(
    await bridge.call(
      "world.core.worktree.list",
      { ...fenced(target), workspace_id: workspaceId },
      30_000,
    ),
  );
}

export type CoreWorktreeCreated = {
  workspace_id: string;
  label: string;
  checkout_path: string;
  branch: string;
  base_sync?: { base?: string; commit?: string };
  setup_hook?: CoreWorktreeHookResult;
  command_fallback?: string;
};

/** A new linked worktree as a room; the service runs Git and the setup hook. */
export async function createCoreWorktree(
  target: CoreTarget,
  workspaceId: string,
  branch: string,
): Promise<CoreWorktreeCreated> {
  return (await bridge.call(
    "world.core.worktree.create",
    { ...fenced(target), workspace_id: workspaceId, branch },
    // A worktree command may run for minutes; the service bounds it.
    null,
  )) as CoreWorktreeCreated;
}

export type CoreWorktreeOpened = {
  workspace_id: string;
  label: string;
  checkout_path: string;
  already_open?: boolean;
  opened_hook?: CoreWorktreeHookResult;
};

export async function openCoreWorktree(
  target: CoreTarget,
  workspaceId: string,
  path: string,
): Promise<CoreWorktreeOpened> {
  return (await bridge.call(
    "world.core.worktree.open",
    { ...fenced(target), workspace_id: workspaceId, path },
    120_000,
  )) as CoreWorktreeOpened;
}

export type CoreWorktreeRemoved =
  | {
      ok: true;
      checkout_path: string;
      killed: string[];
      alsoEnded?: Array<{ address: string; name: string | null }>;
      before_remove_hook?: CoreWorktreeHookResult;
      removed_hook?: CoreWorktreeHookResult;
      command_fallback?: string;
    }
  | {
      ok: false;
      skipped_remove: true;
      checkout_path: string;
      killed: string[];
      alsoEnded?: Array<{ address: string; name: string | null }>;
      uncertain?: string[];
      before_remove_hook?: CoreWorktreeHookResult;
      message: string;
    };

/**
 * Removes a worktree room's checkout. `confirmation` names every terminal
 * that ends with it (the plan of `world.core.kill_plan` for the room).
 */
export async function removeCoreWorktree(
  target: CoreTarget,
  workspaceId: string,
  confirmation: CoreKillConfirmation | null,
  force = false,
): Promise<CoreWorktreeRemoved> {
  return (await bridge.call(
    "world.core.worktree.remove",
    {
      ...fenced(target),
      workspace_id: workspaceId,
      ...(force ? { force: true } : {}),
      ...(confirmation ? { confirmation } : {}),
    },
    null,
  )) as CoreWorktreeRemoved;
}
