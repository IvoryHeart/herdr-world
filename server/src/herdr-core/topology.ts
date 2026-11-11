import type {
  RuntimeReader,
  RuntimeRow,
  TerminalRow,
  WorkspaceRow,
} from "../adapters/runtime-ports";
import { CoreUnavailableError } from "./client";
import { harnessName, harnessOfArgv } from "./harness";
import type { CoreMirror, CoreMirrorTerminal } from "./mirror";
import { coreSpawnedBy, coreSummaryOf } from "./labels";
import { coreRecipientToken } from "./recipient";
import { coreOccupantFingerprint } from "./occupant";
import type {
  CoreRoomCheckout,
  CoreTopologyDocument,
  CoreTopologyRoom,
  CoreTopologyTab,
} from "./layout";
import {
  SPAWNED_BY_TERMINAL_TOKEN,
  SPAWNED_BY_TOKEN,
} from "../../../shared/relations";
import { coreTurn, isFavourite, sharedSeen } from "./shared-state";

/**
 * World's read model of one core: the same rows the TUI runtime lists, so
 * Town, Desk, Board and Needs you show core agents with no second code path.
 *
 * - Rooms follow Herdr's desktop app: terminals it placed (`herdr.space`,
 *   `herdr.tab`) share its spaces and tabs, named from its `where` caption;
 *   everything else shares one room. Sub-agents join their parent's room.
 * - Only live terminals on this core. Linked machines' terminals (`m/tN`)
 *   are discovery only and never become actionable rows.
 * - Status is core's, never inferred: a program's OSC 7501 word, with
 *   Herdr's shared seen rule (`herdr.seen`) deciding done versus idle.
 */
export const CORE_UNPLACED_WORKSPACE = "hc:unplaced";
/** World's main room of a core: where unplaced terminals show. */
export const CORE_MAIN_ROOM = "main";
const WORLD_ROOM_PREFIX = "hc:room:";
const WORLD_TAB_PREFIX = "world-";
/**
 * World's own float shells carry this label (its value is their room). They
 * are a view's scratch shell, not a desk: they never join the read model.
 */
export const CORE_FLOAT_LABEL = "world.float";
const SPACE_PREFIX = "hc:space:";
const TAB_SUFFIX = ":tab:";
const DEFAULT_TAB = "main";
const MAX_LABEL = 120;

export type CoreAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";

function text(value: unknown, max = MAX_LABEL): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function label(record: CoreMirrorTerminal, key: string): string | null {
  return text(record.labels?.[key], 512);
}

/** The program's own 7501 root report, or null when it reports none. */
export function coreStatusReport(record: CoreMirrorTerminal) {
  const status = object(record.status);
  const word = text(status?.state, 32);
  if (!status || !word) return null;
  return {
    word,
    kind: text(status.kind, 32),
    app: text(status.app, 64),
    title: text(status.title),
    message: text(status.msg, 240),
  };
}

/**
 * World's own seen rule for terminals no Herdr client has labelled yet
 * (`herdr.seen` absent, which is not 0): every turn that had already ended
 * when this World first saw the terminal counts as seen, as Herdr's desktop
 * app treats an agent it first lists. It is kept per core across reconnects
 * of one World service, so a turn that ends while World is disconnected is
 * still news. World never raises it: looking is shared through
 * `herdr.seen`.
 */
export class CoreFirstSight {
  private coreId: string | null = null;
  private readonly turns = new Map<string, number>();

  /** Records terminals seen in a snapshot or a `created`/`restarted` event. */
  observe(coreId: string, records: readonly unknown[]): void {
    if (coreId !== this.coreId) {
      this.coreId = coreId;
      this.turns.clear();
    }
    for (const value of records) {
      const record = object(value);
      if (typeof record?.address !== "string" || this.turns.has(record.address))
        continue;
      this.turns.set(record.address, coreTurn(record));
    }
  }

  /** A removed address is never reused by core. */
  forget(address: string): void {
    this.turns.delete(address);
  }

  turn(address: string): number | null {
    return this.turns.get(address) ?? null;
  }
}

/**
 * Herdr's display rule (desktop app `docs/labels.md`): blocked or error
 * needs you; working is working; otherwise done when the turn is above the
 * shared `herdr.seen`, else idle. Without a shared seen, World's own first
 * sight stands in for it. No word at all is unknown: core never guesses.
 */
export function coreAgentStatus(
  record: CoreMirrorTerminal,
  firstSight: number | null = null,
): CoreAgentStatus {
  const word = coreStatusReport(record)?.word;
  if (!word) return "unknown";
  if (word === "working") return "working";
  if (word === "blocked" || word === "error") return "blocked";
  const turn = coreTurn(record);
  const seen = sharedSeen(record) ?? firstSight ?? turn;
  return turn > seen ? "done" : "idle";
}

/** The harness in a terminal: its report, else what runs in it now. */
export function coreHarness(record: CoreMirrorTerminal): string | null {
  const report = coreStatusReport(record);
  const reported = harnessName(report?.app);
  if (reported) return reported;
  const foreground = object(record.foreground);
  const running = foreground
    ? (harnessOfArgv(foreground.argv) ?? harnessName(foreground.name))
    : harnessOfArgv(record.argv);
  if (running) return running;
  // A program that speaks 7501 is an agent even if no list names it.
  return report ? (report.app?.toLowerCase() ?? "agent") : null;
}

type Placement =
  | { kind: "world"; room: CoreTopologyRoom; tab: CoreTopologyTab }
  | { kind: "app"; space: string; tab: string | null; where: string }
  | { kind: "unplaced" };

/**
 * Where a terminal shows. World's own layout (M1) first; then the Herdr
 * app's placement labels; a sub-agent joins its nearest placed ancestor;
 * anything else is in the core's main room.
 */
function placementOf(
  record: CoreMirrorTerminal,
  byAddress: ReadonlyMap<string, CoreMirrorTerminal>,
  worldTabs: ReadonlyMap<
    string,
    { room: CoreTopologyRoom; tab: CoreTopologyTab }
  >,
): Placement {
  let current: CoreMirrorTerminal | undefined = record;
  for (let depth = 0; current && depth < 32; depth += 1) {
    const world = worldTabs.get(current.address);
    if (world) return { kind: "world", ...world };
    const space = label(current, "herdr.space");
    if (space)
      return {
        kind: "app",
        space,
        tab: label(current, "herdr.tab"),
        where: label(current, "where") ?? "",
      };
    const parent: unknown = current.parent;
    current = typeof parent === "string" ? byAddress.get(parent) : undefined;
  }
  return { kind: "unplaced" };
}

/** `where` is the app's "<space> / <tab>" caption; it only names rooms. */
function whereParts(where: string): [string | null, string | null] {
  const cut = where.lastIndexOf(" / ");
  if (cut < 0) return [text(where), null];
  return [text(where.slice(0, cut)), text(where.slice(cut + 3))];
}

function addressOrder(a: string, b: string) {
  return Number(a.slice(1)) - Number(b.slice(1));
}

/**
 * The room (World workspace) a live local terminal sits in, as the read model
 * places it, or null when it is not one of its rows.
 */
export function coreRoomOf(
  terminals: readonly CoreMirrorTerminal[],
  address: string,
  world: CoreTopologyDocument | null = null,
): string | null {
  const local = terminals.filter(
    (record) =>
      !record.remote &&
      record.state === "live" &&
      record.labels?.[CORE_FLOAT_LABEL] === undefined,
  );
  const record = local.find((candidate) => candidate.address === address);
  if (!record) return null;
  const byAddress = new Map(local.map((each) => [each.address, each]));
  const place = placementOf(record, byAddress, worldTabsOf(world, byAddress));
  return place.kind === "world"
    ? coreRoomWorkspaceId(place.room)
    : place.kind === "app"
      ? SPACE_PREFIX + place.space
      : CORE_UNPLACED_WORKSPACE;
}

/** The World tab each live terminal sits in, by World's layout (M1). */
function worldTabsOf(
  world: CoreTopologyDocument | null,
  byAddress: ReadonlyMap<string, CoreMirrorTerminal>,
) {
  const worldTabs = new Map<
    string,
    { room: CoreTopologyRoom; tab: CoreTopologyTab }
  >();
  for (const room of world?.rooms ?? [])
    for (const tab of room.tabs)
      for (const address of tab.terminals)
        if (byAddress.has(address) && !worldTabs.has(address))
          worldTabs.set(address, { room, tab });
  return worldTabs;
}

/**
 * A worktree room's folder, in the TUI's workspace shape: Files, Git,
 * hooks and Ranger read a room's checkout from `worktree`, as they read a
 * Herdr workspace's.
 */
export function coreCheckoutFields(
  checkout: CoreRoomCheckout | undefined,
): Pick<WorkspaceRow, "cwd" | "worktree"> {
  if (!checkout) return {};
  const repoName = checkout.source.replace(/\/+$/, "").split("/").pop() || "";
  return {
    cwd: checkout.path,
    worktree: {
      checkout_path: checkout.path,
      repo_root: checkout.source,
      ...(repoName ? { repo_name: repoName } : {}),
      ...(checkout.branch ? { branch: checkout.branch } : {}),
      // The repository's own checkout opened as a room is not a linked one.
      is_linked_worktree: checkout.path !== checkout.source,
    },
  };
}

export type CoreTopology = {
  workspaces: WorkspaceRow[];
  tabs: RuntimeRow[];
  panes: TerminalRow[];
  agents: RuntimeRow[];
};

/** The workspace ID World's read model gives a room of its own layout. */
export function coreRoomWorkspaceId(room: {
  id: string;
  app_space?: string;
}): string {
  if (room.app_space) return SPACE_PREFIX + room.app_space;
  return room.id === CORE_MAIN_ROOM
    ? CORE_UNPLACED_WORKSPACE
    : WORLD_ROOM_PREFIX + room.id;
}

/** The room of World's layout a read-model workspace ID names, if any. */
export function coreRoomOfWorkspace(
  world: CoreTopologyDocument,
  workspaceId: string,
):
  | { kind: "world"; room: CoreTopologyRoom }
  | { kind: "main" }
  | { kind: "app"; space: string }
  | null {
  if (workspaceId === CORE_UNPLACED_WORKSPACE) return { kind: "main" };
  if (workspaceId.startsWith(SPACE_PREFIX)) {
    const space = workspaceId.slice(SPACE_PREFIX.length);
    return space ? { kind: "app", space } : null;
  }
  if (!workspaceId.startsWith(WORLD_ROOM_PREFIX)) return null;
  const id = workspaceId.slice(WORLD_ROOM_PREFIX.length);
  const room = world.rooms.find((r) => r.id === id && !r.app_space);
  return room ? { kind: "world", room } : null;
}

export type CoreTopologyOptions = {
  occupancy?(address: string): number | null;
  firstSight?: Pick<CoreFirstSight, "turn">;
  /** World's own layout of this core (M1). */
  world?: CoreTopologyDocument | null;
  coreId?: string;
  occupancy?(address: string): number | null;
  now?: number;
};

export function coreTopology(
  terminals: readonly CoreMirrorTerminal[],
  coreName: string,
  options: CoreTopologyOptions | Pick<CoreFirstSight, "turn"> = {},
): CoreTopology {
  const {
    firstSight = { turn: () => null },
    world = null,
    coreId = world?.core_id ?? "",
    now = Date.now(),
    occupancy,
  } = "turn" in options ? { firstSight: options } : options;
  const local = terminals
    .filter(
      (record) =>
        !record.remote &&
        record.state === "live" &&
        record.labels?.[CORE_FLOAT_LABEL] === undefined,
    )
    .sort((a, b) => addressOrder(a.address, b.address));
  const byAddress = new Map(local.map((record) => [record.address, record]));
  const worldTabs = worldTabsOf(world, byAddress);
  const workspaces = new Map<string, WorkspaceRow>();
  const tabs = new Map<string, RuntimeRow>();
  // World's rooms come first, in its order, even when empty. An app space
  // World keeps terminals in is named by the app once a terminal says so.
  const appNamed = new Set<string>();
  for (const room of world?.rooms ?? []) {
    const id = coreRoomWorkspaceId(room);
    workspaces.set(id, {
      workspace_id: id,
      label: room.label || (room.id === CORE_MAIN_ROOM ? coreName : "Room"),
      focused: false,
      ...coreCheckoutFields(room.checkout),
    });
  }
  const panes: TerminalRow[] = [];
  const agents: RuntimeRow[] = [];
  for (const record of local) {
    const place = placementOf(record, byAddress, worldTabs);
    let workspaceId: string;
    let tabId: string;
    let workspaceLabel: string;
    let tabLabel: string;
    if (place.kind === "world") {
      workspaceId = coreRoomWorkspaceId(place.room);
      tabId = `${workspaceId}${TAB_SUFFIX}${WORLD_TAB_PREFIX}${place.tab.id}`;
      workspaceLabel = place.room.label || coreName;
      tabLabel = place.tab.label || workspaceLabel;
    } else if (place.kind === "app") {
      const [spaceName, tabName] = whereParts(place.where);
      workspaceId = SPACE_PREFIX + place.space;
      tabId = `${workspaceId}${TAB_SUFFIX}${place.tab ?? DEFAULT_TAB}`;
      workspaceLabel = spaceName ?? "Herdr space";
      tabLabel = tabName ?? spaceName ?? "Tab";
    } else {
      workspaceId = CORE_UNPLACED_WORKSPACE;
      tabId = `${workspaceId}${TAB_SUFFIX}${DEFAULT_TAB}`;
      workspaceLabel = coreName;
      tabLabel = coreName;
    }
    const known = workspaces.get(workspaceId);
    if (!known)
      workspaces.set(workspaceId, {
        workspace_id: workspaceId,
        label: workspaceLabel,
        focused: false,
      });
    else if (
      place.kind === "app" &&
      workspaceLabel !== "Herdr space" &&
      !appNamed.has(workspaceId)
    )
      known.label = workspaceLabel;
    if (place.kind === "app") appNamed.add(workspaceId);
    if (!tabs.has(tabId))
      tabs.set(tabId, {
        tab_id: tabId,
        workspace_id: workspaceId,
        label: tabLabel,
        focused: false,
      });
    const report = coreStatusReport(record);
    const harness = coreHarness(record);
    const foreground = object(record.foreground);
    const cwd = text(record.cwd, 4096);
    const foregroundCwd = text(foreground?.cwd, 4096);
    // Spawn stamps (M7): core's own parent for a child it started, else
    // World's display stamp. Both are display relations.
    const parent =
      typeof record.parent === "string" && byAddress.has(record.parent)
        ? record.parent
        : coreSpawnedBy(record);
    const summary = coreId ? coreSummaryOf(coreId, record, now) : null;
    const pane: TerminalRow = {
      pane_id: record.address,
      terminal_id: record.address,
      workspace_id: workspaceId,
      tab_id: tabId,
      focused: false,
      runtime: "herdr-core",
      ...(cwd ? { cwd } : {}),
      ...(foregroundCwd ? { foreground_cwd: foregroundCwd } : {}),
      ...(parent && parent !== record.address
        ? {
            tokens: {
              [SPAWNED_BY_TOKEN]: parent,
              [SPAWNED_BY_TERMINAL_TOKEN]: parent,
            },
          }
        : {}),
      agent_status: harness
        ? coreAgentStatus(record, firstSight.turn(record.address))
        : "unknown",
    };
    // The program at this address, as a verified core caller's asks name it
    // (ask-caller.ts): Town puts a question on the desk of that program only.
    const occupant = coreId
      ? coreOccupantFingerprint(
          coreId,
          record,
          occupancy?.(record.address) ?? 1,
        )
      : null;
    if (occupant) pane.core_occupant_fingerprint = occupant;
    panes.push(pane);
    if (!harness) continue;
    pane.agent = harness;
    // The program a person addresses when they reply (delivery.ts): World
    // sends only while this still names what runs there.
    const recipient = coreId
      ? coreRecipientToken(
          coreId,
          record,
          "occupancy" in options ? options.occupancy?.(record.address) : null,
        )
      : null;
    if (recipient) pane.core_recipient = recipient;
    if (summary) pane.task_summary = summary.text;
    // The program's own words for why it waits: Needs you shows them.
    if (report?.word === "blocked" && report.kind)
      pane.blocked_kind = report.kind;
    if (report?.message) pane.status_message = report.message;
    // What a World view needs to share seen and favourite with Herdr's apps.
    if (report) {
      pane.turn = coreTurn(record);
      const seen = sharedSeen(record);
      if (seen !== null) pane.seen_turn = seen;
    }
    if (isFavourite(record)) pane.favourite = true;
    const name = text(record.name, 64);
    const title = text(record.title);
    agents.push({
      pane_id: record.address,
      terminal_id: record.address,
      agent: harness,
      ...(name ? { name } : {}),
      ...(title ? { terminal_title: title } : {}),
      agent_status: pane.agent_status,
    });
  }
  // A core always offers a room to start in: with nothing else, its main
  // room, empty, so a new agent can start in core on first sight.
  if (workspaces.size === 0)
    workspaces.set(CORE_UNPLACED_WORKSPACE, {
      workspace_id: CORE_UNPLACED_WORKSPACE,
      label: coreName,
      focused: false,
    });
  return {
    workspaces: [...workspaces.values()],
    tabs: [...tabs.values()],
    panes,
    agents,
  };
}

/** When the next shown summary expires: the read model changes then. */
export function nextCoreSummaryExpiry(
  coreId: string,
  terminals: readonly CoreMirrorTerminal[],
  now: number,
): number | null {
  let next: number | null = null;
  for (const record of terminals) {
    if (record.remote || record.state !== "live") continue;
    const summary = coreSummaryOf(coreId, record, now);
    if (summary && (next === null || summary.expiresMs < next))
      next = summary.expiresMs;
  }
  return next;
}

export type CoreReadModelSource = {
  readonly mirror: CoreMirror;
  readonly actionable: boolean;
  coreName(): string;
  firstSight?: Pick<CoreFirstSight, "turn">;
  /** World's own layout of this core and the core's ID, when known. */
  world?(): CoreTopologyDocument | null;
  coreId?(): string | null;
  now?(): number;
};

/**
 * World's rows for one core, only while its observation is current. A
 * retired or unbaselined mirror refuses: World then shows the last
 * observation as stale and never as current (the model's `ready`).
 */
export function coreReadModel(source: CoreReadModelSource): CoreTopology {
  if (!source.actionable)
    throw new CoreUnavailableError("herdr-core observation is not current");
  return coreTopology(source.mirror.terminals(), source.coreName(), {
    firstSight: source.firstSight,
    world: source.world?.() ?? null,
    coreId: source.coreId?.() ?? undefined,
    now: source.now?.(),
    occupancy: (address) => source.mirror.occupancy(address),
  });
}

/** The TUI runtime's list operations, answered by `coreReadModel`. */
export function coreRuntimeReader(source: CoreReadModelSource): RuntimeReader {
  // World reads the four lists together, synchronously: one cut serves all.
  let cut: CoreTopology | null = null;
  const read = () => {
    if (!cut) {
      cut = coreReadModel(source);
      queueMicrotask(() => {
        cut = null;
      });
    }
    return cut;
  };
  return {
    listWorkspaces: async () => ({ workspaces: read().workspaces }),
    listTabs: async () => ({ tabs: read().tabs }),
    listTerminals: async () => ({ panes: read().panes }),
    listAgents: async () => ({ agents: read().agents }),
  };
}
