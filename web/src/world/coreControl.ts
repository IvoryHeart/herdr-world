import { bridge } from "../api";
import type { CoreAlsoEnded } from "../../../shared/coreKill";

/**
 * World's control of a herdr-core connection (world.core.*): starting
 * agents and shells, World's own rooms of that core, and native kills.
 * Every call names the core connection and the runtime generation the
 * person saw; the service refuses it when the core has since reconnected.
 *
 * Core Chat uses coreDelivery.ts. Terminal and file controls keep their
 * separate availability; this module grants none of their authority.
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
