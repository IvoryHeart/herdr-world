import { randomBytes } from "node:crypto";
import { agentNameFor, AGENT_KIND } from "../../../shared/agentProfile";
import type { ReadyRuntimeLease } from "../connections/manager";
import {
  type CoreRoomCheckout,
  type CoreTopologyDocument,
  type CoreTopologyRoom,
  type CoreTopologyPort,
  CORE_TOPOLOGY_LIMITS,
} from "./layout";
import {
  CoreRpcError,
  type CoreTerminalRecord,
  CoreUnsupportedError,
  CoreWriteUncertainError,
  type CoreWriteMethod,
} from "./client";
import { CoreFenceError, CoreOperationFence } from "./fence";
import {
  type CoreKillConfirmation,
  type CoreKillEntry,
  type CoreKillPlan,
  coreEndedKeys,
  coreKillPlan,
  coreKillRefusal,
  coreKillUnconfirmed,
} from "./kill-plan";
import { CORE_SPAWNED_BY_LABEL } from "./labels";
import type { CoreMirrorTerminal } from "./mirror";
import type { CoreConnectionRuntime } from "./runtime";
import {
  CORE_MAIN_ROOM,
  coreHarness,
  coreRoomOfWorkspace,
  coreRoomWorkspaceId,
} from "./topology";

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;

/** A refusal that sent nothing to core; its message is for the person. */
export class CoreOperationRefused extends Error {
  constructor(
    message: string,
    /** The kill as it stands now, when a confirmation fell out of date. */
    readonly plan?: CoreKillPlanView,
  ) {
    super(message);
    this.name = "CoreOperationRefused";
  }
}

function admit(lease: Lease, method: CoreWriteMethod, address?: string) {
  if (!lease.runtime.offers(method))
    throw new CoreOperationRefused(
      `This host's herdr-core does not offer ${method}.`,
    );
  try {
    return CoreOperationFence.admit(lease, address);
  } catch (error) {
    if (error instanceof CoreFenceError)
      throw new CoreOperationRefused(
        address && error.reason === "occupant-gone"
          ? "It has already ended."
          : "The host's herdr-core is not connected right now.",
      );
    throw error;
  }
}

function coreIdOf(lease: Lease): string {
  const coreId = lease.runtime.core.epoch?.coreId;
  if (!coreId)
    throw new CoreOperationRefused(
      "The host's herdr-core is not connected right now.",
    );
  return coreId;
}

/** A short ID World gives its rooms and tabs (also their app-space IDs). */
export function newCoreLayoutId(prefix: "r" | "b"): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

/** Drops terminals core no longer runs, and tabs left with none. */
function pruned(
  doc: CoreTopologyDocument,
  live: ReadonlySet<string>,
): CoreTopologyDocument {
  return {
    ...doc,
    rooms: doc.rooms
      .map((room) => ({
        ...room,
        tabs: room.tabs
          .map((tab) => ({
            ...tab,
            terminals: tab.terminals.filter((a) => live.has(a)),
          }))
          .filter((tab) => tab.terminals.length > 0),
      }))
      // A room standing for an app space exists only while World keeps
      // terminals there; World's own rooms stay, even empty.
      .filter((room) => !room.app_space || room.tabs.length > 0),
  };
}

function liveLocal(lease: Lease): Set<string> {
  return new Set(
    lease.runtime.core.mirror
      .terminals()
      .filter((t) => !t.remote && t.state === "live")
      .map((t) => t.address),
  );
}

// --- Launch (M2, M3) ---------------------------------------------------------

/**
 * How a harness takes its first message on its command line, when it
 * documents one: the program receives it at start, so no input is typed
 * into a terminal that might by then hold something else. Others start
 * without it (the delivery item sends messages through core).
 */
const PROMPT_ARGUMENT: Record<string, (text: string) => string[]> = {
  claude: (text) => [text.startsWith("-") ? ` ${text}` : text],
  codex: (text) => [text.startsWith("-") ? ` ${text}` : text],
};

export type CoreLaunchRequest = {
  /** The read-model room (`workspace_id`) to start it in. */
  workspaceId: string;
  /** A harness kind, or null for the host's plain shell. */
  kind: string | null;
  label: string;
  /** Native arguments after the executable, given the agent's name. */
  args?: string[] | ((agentName: string) => string[]);
  text: string;
  /** The terminal whose agent asked for this one: a display stamp only. */
  spawnedBy?: string;
};

export type CoreLaunchOutcome =
  | {
      status: "sent" | "started";
      runtime: "herdr-core";
      workspace_id: string;
      tab_id: string;
      pane_id: string;
      terminal_id: string;
      agent_name?: string;
      /** Shown placed in Herdr's apps (agents), and kept running by them. */
      placed: boolean;
      message?: string;
    }
  | {
      status: "uncertain" | "failed";
      runtime: "herdr-core";
      message: string;
    };

export type CoreLaunchDeps = {
  topology: CoreTopologyPort;
  /** The absolute executable for a harness on the core's host. */
  resolveExecutable(kind: string): Promise<string>;
};

function folderOf(
  lease: Lease,
  doc: CoreTopologyDocument,
  workspaceId: string,
): string | undefined {
  // A worktree room's checkout; else the folder of a terminal already in
  // that room, like a new TUI tab.
  const terminals = lease.runtime.core.mirror.terminals();
  for (const room of doc.rooms) {
    if (coreRoomWorkspaceId(room) !== workspaceId) continue;
    if (room.checkout) return room.checkout.path;
    for (const tab of room.tabs)
      for (const address of tab.terminals) {
        const record = terminals.find((t) => t.address === address);
        const foreground = record?.foreground as { cwd?: unknown } | undefined;
        const cwd = foreground?.cwd ?? record?.cwd;
        if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
      }
  }
  return undefined;
}

/** The name World shows a read-model room by (the app's for its spaces). */
async function roomLabelOf(lease: Lease, workspaceId: string): Promise<string> {
  const { workspaces } = await lease.runtime.operations.listWorkspaces();
  const room = (
    workspaces as Array<{ workspace_id: string; label?: unknown }>
  ).find((w) => w.workspace_id === workspaceId);
  return typeof room?.label === "string" && room.label ? room.label : "World";
}

/**
 * Starts an agent (placed in Herdr's apps, kept running) or a plain shell
 * (unplaced) in core, and records it in World's layout of that core.
 *
 * The run carries no `caller`, no parent and no notes; `keep` is explicit.
 * The executable is absolute, so no core template of the same name can
 * shadow it. A lost reply is uncertain and is never retried: the program
 * may be running. A name another terminal took meanwhile is refused by
 * core with nothing started, so the next free name is tried.
 */
export async function launchCore(
  lease: Lease,
  request: CoreLaunchRequest,
  deps: CoreLaunchDeps,
): Promise<CoreLaunchOutcome> {
  const runtime = "herdr-core" as const;
  const kind = request.kind;
  if (kind !== null && !AGENT_KIND.test(kind))
    return { status: "failed", runtime, message: "Unknown agent kind." };
  let fence: CoreOperationFence<CoreConnectionRuntime>;
  try {
    fence = admit(lease, "terminal.run");
  } catch (error) {
    return { status: "failed", runtime, message: (error as Error).message };
  }
  const coreId = coreIdOf(lease);
  const doc = deps.topology.get(coreId);
  const room = coreRoomOfWorkspace(doc, request.workspaceId);
  if (!room)
    return {
      status: "failed",
      runtime,
      message: "That room no longer exists.",
    };
  const label = request.label.trim().slice(0, CORE_TOPOLOGY_LIMITS.label);
  const tabId = newCoreLayoutId("b");
  const placed = kind !== null;
  const space =
    room.kind === "app"
      ? room.space
      : `world-${room.kind === "main" ? CORE_MAIN_ROOM : room.room.id}`;
  const spawnedBy =
    request.spawnedBy && liveLocal(lease).has(request.spawnedBy)
      ? request.spawnedBy
      : undefined;
  const tabLabel = label || (kind ?? "Shell");
  const labels: Record<string, string> = {
    ...(placed
      ? {
          "herdr.space": space,
          "herdr.tab": `world-${tabId}`,
          // A terminal a client starts has seen nothing yet (labels.md).
          "herdr.seen": "0",
          // The app's caption: the IDs above are not names a person reads.
          where:
            `${await roomLabelOf(lease, request.workspaceId)} / ${tabLabel}`.slice(
              0,
              2 * CORE_TOPOLOGY_LIMITS.label + 3,
            ),
        }
      : {}),
    ...(spawnedBy ? { [CORE_SPAWNED_BY_LABEL]: spawnedBy } : {}),
  };
  const text = request.text.trim();
  const promptArgument = kind ? PROMPT_ARGUMENT[kind] : undefined;
  let executable: string | null = null;
  if (kind) {
    try {
      executable = await deps.resolveExecutable(kind);
    } catch (error) {
      return {
        status: "failed",
        runtime,
        message: `${kind} is not installed where this herdr-core runs: ${(error as Error).message}`,
      };
    }
  }
  const cwd = folderOf(lease, doc, request.workspaceId);
  const taken = new Set(
    lease.runtime.core.mirror
      .terminals()
      .filter((t) => !t.remote && t.state === "live")
      .map((t) => (typeof t.name === "string" ? t.name : ""))
      .filter(Boolean),
  );
  let name = kind ? agentNameFor(label || kind, taken) : undefined;
  let record: CoreTerminalRecord | null = null;
  for (let attempt = 0; attempt < 8 && !record; attempt += 1) {
    const args =
      typeof request.args === "function"
        ? request.args(name ?? "")
        : (request.args ?? []);
    try {
      record = await lease.runtime.run(fence, {
        argv: executable
          ? [
              executable,
              ...args,
              ...(text && promptArgument ? promptArgument(text) : []),
            ]
          : [],
        ...(cwd ? { cwd } : {}),
        labels,
        keep: placed,
        ...(name ? { name } : {}),
      });
    } catch (error) {
      if (error instanceof CoreFenceError)
        return {
          status: "failed",
          runtime,
          message:
            "The host's herdr-core changed before the agent was started; nothing was started.",
        };
      if (error instanceof CoreWriteUncertainError)
        return {
          status: "uncertain",
          runtime,
          message:
            "herdr-core did not answer: the agent may have started. Check the room before trying again.",
        };
      if (error instanceof CoreUnsupportedError)
        return { status: "failed", runtime, message: error.message };
      // core: `name_taken`, "a live terminal is already named …".
      if (
        error instanceof CoreRpcError &&
        name &&
        error.kind === "name_taken"
      ) {
        taken.add(name);
        name = agentNameFor(label || kind || "agent", taken);
        continue;
      }
      return {
        status: "failed",
        runtime,
        message: `herdr-core did not start it: ${(error as Error).message}`,
      };
    }
  }
  if (!record || typeof record.address !== "string")
    return {
      status: "failed",
      runtime,
      message: "herdr-core did not confirm the new terminal.",
    };
  const address = record.address;
  // World's layout is keyed by the durable core ID, and core never reuses
  // an address: recording it is right even if the connection changed.
  const live = liveLocal(lease);
  live.add(address);
  await deps.topology.update(coreId, (current) => {
    const next = pruned(current, live);
    let target = next.rooms.find((r) =>
      room.kind === "app"
        ? r.app_space === room.space
        : r.id === (room.kind === "main" ? CORE_MAIN_ROOM : room.room.id),
    );
    if (!target) {
      target =
        room.kind === "app"
          ? {
              id: newCoreLayoutId("r"),
              label: "",
              app_space: room.space,
              tabs: [],
            }
          : { id: CORE_MAIN_ROOM, label: "", tabs: [] };
      // The main room leads, as it did while it held only unplaced terminals.
      if (room.kind === "main") next.rooms.unshift(target);
      else next.rooms.push(target);
    }
    target.tabs.push({ id: tabId, label: tabLabel, terminals: [address] });
    return next;
  });
  lease.runtime.layoutChanged();
  const workspaceId = request.workspaceId;
  return {
    status: text && promptArgument ? "sent" : "started",
    runtime,
    workspace_id: workspaceId,
    tab_id: `${workspaceId}:tab:world-${tabId}`,
    pane_id: address,
    terminal_id: address,
    ...(name ? { agent_name: name } : {}),
    placed,
    ...(text && !promptArgument
      ? {
          message:
            "Started in herdr-core. World can't send its first message to this harness yet: type it in the agent.",
        }
      : {}),
  };
}

// --- Kills (M7) --------------------------------------------------------------

export type CoreKillPlanEntryView = CoreKillEntry & {
  /** What a person recognises it by: its tab, name or program. */
  label: string;
  /** The room it shows in, when World shows it. */
  room?: string;
};
export type CoreKillPlanView = {
  core_id: string;
  roots: CoreKillPlanEntryView[];
  descendants: CoreKillPlanEntryView[];
};

function describe(
  plan: CoreKillPlan,
  terminals: readonly CoreMirrorTerminal[],
  rooms: (address: string) => { room: string; tab: string } | null,
): CoreKillPlanView {
  const view = (entry: CoreKillEntry): CoreKillPlanEntryView => {
    const record = terminals.find(
      (t) => t.address === entry.address && t.remote === entry.remote,
    );
    const place = entry.remote ? null : rooms(entry.address);
    const harness = record ? coreHarness(record) : null;
    return {
      ...entry,
      // Its own name first: a sub-agent shows in its parent's tab.
      label:
        entry.name ||
        place?.tab ||
        harness ||
        (entry.remote ? `${entry.address} (another machine)` : entry.address),
      ...(place?.room ? { room: place.room } : {}),
    };
  };
  return {
    core_id: plan.coreId,
    roots: plan.roots.map(view),
    descendants: plan.descendants.map(view),
  };
}

/** Where the read model shows each terminal: for naming them in a plan. */
async function placesOf(lease: Lease) {
  const [{ workspaces }, { tabs }, { panes }] = await Promise.all([
    lease.runtime.operations.listWorkspaces(),
    lease.runtime.operations.listTabs(),
    lease.runtime.operations.listTerminals(),
  ]);
  const roomLabel = new Map(
    (workspaces as Array<{ workspace_id: string; label: string }>).map((w) => [
      w.workspace_id,
      w.label,
    ]),
  );
  const tabLabel = new Map(
    (tabs as Array<{ tab_id: string; label?: unknown }>).map((t) => [
      t.tab_id,
      typeof t.label === "string" ? t.label : "",
    ]),
  );
  const byAddress = new Map(
    (panes as Array<{ pane_id: string; workspace_id: string; tab_id: string }>)
      .filter((p) => typeof p.pane_id === "string")
      .map((p) => [
        p.pane_id,
        {
          workspace: p.workspace_id,
          room: roomLabel.get(p.workspace_id) ?? "",
          tab: tabLabel.get(p.tab_id) ?? "",
        },
      ]),
  );
  return (address: string) => byAddress.get(address) ?? null;
}

/** What killing `addresses` ends, named for a confirmation. */
export async function planCoreKill(
  lease: Lease,
  addresses: readonly string[],
): Promise<CoreKillPlanView> {
  admit(lease, "terminal.kill");
  const coreId = coreIdOf(lease);
  const terminals = lease.runtime.core.mirror.terminals();
  return describe(
    coreKillPlan(coreId, terminals, addresses),
    terminals,
    await placesOf(lease),
  );
}

/** A confirmation as the browser sends it back. */
export function parseCoreKillConfirmation(
  value: unknown,
): CoreKillConfirmation {
  const input = (value ?? {}) as Record<string, unknown>;
  if (typeof input.core_id !== "string" || !Array.isArray(input.terminals))
    throw new CoreOperationRefused("Confirm which terminals will end.");
  if (input.terminals.length > 512)
    throw new CoreOperationRefused("Too many terminals in one confirmation.");
  return {
    coreId: input.core_id,
    terminals: input.terminals.map((t) => {
      const entry = (t ?? {}) as Record<string, unknown>;
      if (typeof entry.address !== "string")
        throw new CoreOperationRefused("Confirm which terminals will end.");
      return {
        address: entry.address,
        pid: typeof entry.pid === "number" ? entry.pid : null,
        occupant: typeof entry.occupant === "string" ? entry.occupant : null,
        remote: entry.remote === true,
      };
    }),
  };
}

export type CoreKillOutcome = {
  /** Terminals World asked core to end. */
  killed: string[];
  /** Asked, but the reply never came: they may still be running. */
  uncertain: string[];
  /**
   * Ended by core's cascade without confirmation: started under a dying
   * terminal after World's last check (core has no conditional kill, Q11).
   */
  alsoEnded: Array<{ address: string; name: string | null; remote: boolean }>;
};

/**
 * Kills `addresses` only if everything that will end with them is within
 * what the person confirmed, each still the program they saw. The plan is
 * taken again right before each kill, so a child started meanwhile refuses
 * the kill (with the new plan) instead of ending unconfirmed. Core's own
 * cascade then ends the confirmed descendants.
 */
/**
 * Refuses, with the plan as it is now, unless `confirmation` names exactly
 * the terminals that ending `addresses` would end. Nothing is ended.
 */
export async function assertCoreKillConfirmed(
  lease: Lease,
  addresses: readonly string[],
  confirmation: CoreKillConfirmation,
): Promise<void> {
  const coreId = coreIdOf(lease);
  const terminals = lease.runtime.core.mirror.terminals();
  const plan = coreKillPlan(coreId, terminals, addresses);
  const refusal = coreKillRefusal(plan, confirmation);
  if (refusal)
    throw new CoreOperationRefused(
      `${refusal} Nothing was ended.`,
      describe(plan, terminals, await placesOf(lease)),
    );
}

export async function killCore(
  lease: Lease,
  addresses: readonly string[],
  confirmation: CoreKillConfirmation,
): Promise<CoreKillOutcome> {
  const outcome: CoreKillOutcome = { killed: [], uncertain: [], alsoEnded: [] };
  const endedBefore = coreEndedKeys(lease.runtime.core.mirror.terminals());
  const refuseIfChanged = async () => {
    const coreId = coreIdOf(lease);
    const terminals = lease.runtime.core.mirror.terminals();
    const plan = coreKillPlan(coreId, terminals, addresses);
    const refusal = coreKillRefusal(plan, confirmation);
    if (refusal)
      throw new CoreOperationRefused(
        outcome.killed.length
          ? `${refusal} The rest was not ended.`
          : `${refusal} Nothing was ended.`,
        describe(plan, terminals, await placesOf(lease)),
      );
    return plan;
  };
  const first = await refuseIfChanged();
  for (const root of first.roots) {
    await refuseIfChanged();
    // Ended meanwhile, for example with an earlier root: nothing to do.
    if (lease.runtime.core.mirror.terminal(root.address)?.state !== "live")
      continue;
    const fence = admit(lease, "terminal.kill", root.address);
    // The program confirmed must be the one killed.
    if (fence.occupant?.pid !== root.pid)
      throw new CoreOperationRefused(
        `${root.name ?? root.address} is running a different program now. Nothing more was ended.`,
      );
    try {
      await lease.runtime.kill(fence);
      outcome.killed.push(root.address);
    } catch (error) {
      if (error instanceof CoreWriteUncertainError) {
        outcome.uncertain.push(root.address);
        continue;
      }
      if (error instanceof CoreFenceError && error.stage === "publication") {
        // Sent and answered; World only lost the right to say more.
        outcome.killed.push(root.address);
        continue;
      }
      if (error instanceof CoreFenceError)
        throw new CoreOperationRefused(
          "The host's herdr-core changed; nothing more was ended.",
        );
      throw error;
    }
  }
  // Core's cascade is its own (Q11): name anything it ended beyond the
  // confirmation rather than report a clean kill.
  if (outcome.killed.length)
    outcome.alsoEnded = coreKillUnconfirmed(
      coreIdOf(lease),
      lease.runtime.core.mirror.terminals(),
      outcome.killed,
      confirmation,
      endedBefore,
    ).map(({ address, name, remote }) => ({ address, name, remote }));
  return outcome;
}

// --- Rooms (M1) --------------------------------------------------------------

export async function createCoreRoom(
  lease: Lease,
  topology: CoreTopologyPort,
  label: string,
): Promise<{ workspace_id: string; label: string }> {
  const coreId = coreIdOf(lease);
  const name = label.trim().slice(0, CORE_TOPOLOGY_LIMITS.label) || "Room";
  const id = newCoreLayoutId("r");
  const live = liveLocal(lease);
  await topology.update(coreId, (current) => {
    const next = pruned(current, live);
    if (next.rooms.length >= CORE_TOPOLOGY_LIMITS.rooms)
      throw new CoreOperationRefused("This host has too many rooms.");
    next.rooms.push({ id, label: name, tabs: [] });
    return next;
  });
  lease.runtime.layoutChanged();
  return { workspace_id: coreRoomWorkspaceId({ id }), label: name };
}

export async function renameCoreRoom(
  lease: Lease,
  topology: CoreTopologyPort,
  workspaceId: string,
  label: string,
): Promise<void> {
  const coreId = coreIdOf(lease);
  const name = label.trim().slice(0, CORE_TOPOLOGY_LIMITS.label);
  if (!name) throw new CoreOperationRefused("A room needs a name.");
  const room = coreRoomOfWorkspace(topology.get(coreId), workspaceId);
  if (!room) throw new CoreOperationRefused("That room no longer exists.");
  if (room.kind === "app")
    throw new CoreOperationRefused(
      "This room is a Herdr app space: rename it in the app.",
    );
  const live = liveLocal(lease);
  await topology.update(coreId, (current) => {
    const next = pruned(current, live);
    const id = room.kind === "main" ? CORE_MAIN_ROOM : room.room.id;
    let target = next.rooms.find((r) => r.id === id && !r.app_space);
    if (!target) {
      if (room.kind !== "main")
        throw new CoreOperationRefused("That room no longer exists.");
      next.rooms.unshift((target = { id, label: name, tabs: [] }));
    }
    target.label = name;
    return next;
  });
  lease.runtime.layoutChanged();
}

/**
 * The room World shows a checkout as (P4): the room already standing for
 * that checkout (`opened: false`), else a new one at the end.
 */
export async function coreCheckoutRoom(
  lease: Lease,
  topology: CoreTopologyPort,
  checkout: CoreRoomCheckout,
  label: string,
): Promise<{ workspace_id: string; label: string; opened: boolean }> {
  const coreId = coreIdOf(lease);
  const name = label.trim().slice(0, CORE_TOPOLOGY_LIMITS.label) || "Worktree";
  const live = liveLocal(lease);
  let room: CoreTopologyRoom | undefined;
  let opened = false;
  await topology.update(coreId, (current) => {
    const next = pruned(current, live);
    room = next.rooms.find((r) => r.checkout?.path === checkout.path);
    if (room) return null;
    if (next.rooms.length >= CORE_TOPOLOGY_LIMITS.rooms)
      throw new CoreOperationRefused("This host has too many rooms.");
    room = { id: newCoreLayoutId("r"), label: name, checkout, tabs: [] };
    next.rooms.push(room);
    opened = true;
    return next;
  });
  if (opened) lease.runtime.layoutChanged();
  return {
    workspace_id: coreRoomWorkspaceId(room!),
    label: room!.label,
    opened,
  };
}

/** World's worktree room a read-model workspace ID names, if it is one. */
export function coreCheckoutOf(
  lease: Lease,
  topology: CoreTopologyPort,
  workspaceId: string,
): { roomId: string; checkout: CoreRoomCheckout } | null {
  const room = coreRoomOfWorkspace(topology.get(coreIdOf(lease)), workspaceId);
  return room?.kind === "world" && room.room.checkout
    ? { roomId: room.room.id, checkout: room.room.checkout }
    : null;
}

/** Drops one of World's rooms from its layout (its terminals have ended). */
export async function dropCoreRoom(
  lease: Lease,
  topology: CoreTopologyPort,
  roomId: string,
): Promise<void> {
  const coreId = coreIdOf(lease);
  const live = liveLocal(lease);
  await topology.update(coreId, (current) => {
    const next = pruned(current, live);
    next.rooms = next.rooms.filter((r) => r.app_space || r.id !== roomId);
    return next;
  });
  lease.runtime.layoutChanged();
}

/** The live terminals a read-model room shows, for closing it. */
export async function coreRoomTerminals(
  lease: Lease,
  workspaceId: string,
): Promise<string[]> {
  const { panes } = await lease.runtime.operations.listTerminals();
  return (panes as Array<{ pane_id: string; workspace_id: string }>)
    .filter((p) => p.workspace_id === workspaceId)
    .map((p) => p.pane_id);
}

/**
 * Closes one of World's rooms: every terminal it shows ends (under the same
 * confirmation rule as a kill), then the room leaves World's layout. An app
 * space is the app's to close.
 */
export async function closeCoreRoom(
  lease: Lease,
  topology: CoreTopologyPort,
  workspaceId: string,
  confirmation: CoreKillConfirmation,
): Promise<CoreKillOutcome> {
  const coreId = coreIdOf(lease);
  const room = coreRoomOfWorkspace(topology.get(coreId), workspaceId);
  if (!room) throw new CoreOperationRefused("That room no longer exists.");
  if (room.kind === "app")
    throw new CoreOperationRefused(
      "This room is a Herdr app space: close it in the app.",
    );
  const addresses = await coreRoomTerminals(lease, workspaceId);
  const outcome = addresses.length
    ? await killCore(lease, addresses, confirmation)
    : { killed: [], uncertain: [], alsoEnded: [] };
  if (outcome.uncertain.length) return outcome;
  const live = liveLocal(lease);
  for (const address of outcome.killed) live.delete(address);
  await topology.update(coreId, (current) => {
    const next = pruned(current, live);
    const id = room.kind === "main" ? CORE_MAIN_ROOM : room.room.id;
    next.rooms = next.rooms.filter((r) => r.app_space || r.id !== id);
    return next;
  });
  lease.runtime.layoutChanged();
  return outcome;
}
