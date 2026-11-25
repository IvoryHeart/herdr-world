import type {
  RuntimeReader,
  RuntimeRow,
  TerminalRow,
  WorkspaceRow,
} from "../adapters/runtime-ports";
import { CoreUnavailableError } from "./client";
import {
  harnessInvocation,
  harnessName,
  mayWrapHarness,
  type HarnessInvocation,
} from "./harness";
import type { ForegroundGroupReader } from "./process-group";
import type { CoreMirror, CoreMirrorTerminal } from "./mirror";
import {
  CORE_UNNAMED_SPACE_LABEL,
  coreSpawnedBy,
  coreSummaryOf,
} from "./labels";
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
import {
  coreTurn,
  isFavourite,
  sharedSeen,
  waitsWithoutResult,
} from "./shared-state";

/**
 * World's read model of one core: the same rows the TUI runtime lists, so
 * Town, Desk, Board and Needs you show core agents with no second code path.
 *
 * - Rooms follow Herdr's desktop app: terminals it placed (`herdr.space`,
 *   `herdr.tab`) share its spaces and tabs, named from its `where` caption;
 *   everything else shares one room. Sub-agents join their parent's room.
 * - Only live terminals on this core. Linked machines' terminals (`m/tN`)
 *   are discovery only and never become actionable rows.
 * - Status is core's OSC 7501 word, with Herdr's shared seen rule
 *   (`herdr.seen`) deciding done versus idle, checked against the process
 *   (`coreDeskStatus`): a live headless run works, and a report whose
 *   harness has gone from the terminal is stale.
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
/** The name of an app space core gives no name and World can derive none for. */
export const CORE_UNNAMED_SPACE = "Herdr space";

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
 * One exception: a harness that says `done` when a turn has a result and
 * now says idle has none (`waitsWithoutResult`). Codex's start ends a turn
 * that way, and a desk World just started (`herdr.seen=0`) is idle, ready
 * for its first message, not done.
 */
export function coreAgentStatus(
  record: CoreMirrorTerminal,
  firstSight: number | null = null,
): CoreAgentStatus {
  const word = coreStatusReport(record)?.word;
  if (!word) return "unknown";
  if (word === "working") return "working";
  if (word === "blocked" || word === "error") return "blocked";
  if (waitsWithoutResult(record)) return "idle";
  const turn = coreTurn(record);
  const seen = sharedSeen(record) ?? firstSight ?? turn;
  return turn > seen ? "done" : "idle";
}

/**
 * The harness in a terminal: what runs in it now (or, while its group
 * cannot be read, what World last saw run there), else its report's, else
 * (World's memory of the desk) the one that just left it. A process that
 * runs there outranks a report, and a report a departed process left
 * (`seen.stale`) names nobody: the agent that left keeps the desk's
 * identity for its walk away, never an older reporter.
 */
export function coreHarness(
  record: CoreMirrorTerminal,
  group: readonly (readonly string[])[] | null = null,
  seen: CoreDeskSeen = NOTHING_SEEN,
): string | null {
  const running =
    coreDeskProcess(record, group).running?.harness ?? seen.held?.harness;
  if (running) return running;
  const report = seen.stale ? null : coreStatusReport(record);
  const reported = harnessName(report?.app);
  if (reported) return reported;
  if (seen.left) return seen.left;
  // A program that speaks 7501 is an agent even if no list names it.
  return report ? (report.app?.toLowerCase() ?? "agent") : null;
}

/** What the terminal's processes show of an agent, as evidence. */
export type CoreDeskProcess = {
  /** The harness running in the foreground: its leader, else the group member nearest it. */
  running: HarnessInvocation | null;
  /**
   * No harness runs there, for certain: the group was read, or its leader
   * (not a shell or interpreter) cannot be hiding one.
   */
  gone: boolean;
};

/**
 * The agent process in a terminal's foreground, as Herdr's TUI finds it
 * (the job's leader first, then its other processes): `group` lists the
 * leader's group members, nearest first, when the host could read them.
 */
export function coreDeskProcess(
  record: CoreMirrorTerminal,
  group: readonly (readonly string[])[] | null = null,
): CoreDeskProcess {
  const foreground = object(record.foreground);
  if (!foreground) {
    const running = harnessInvocation(record.argv);
    return { running, gone: false };
  }
  const leader =
    harnessInvocation(foreground.argv) ??
    (harnessName(foreground.name)
      ? { harness: harnessName(foreground.name)!, headless: false }
      : null);
  if (leader) return { running: leader, gone: false };
  for (const argv of group ?? []) {
    const member = harnessInvocation(argv);
    if (member) return { running: member, gone: false };
  }
  return {
    running: null,
    gone: group !== null || !mayWrapHarness(foreground, record.pid),
  };
}

/** What World remembers of one desk (`CoreDeskMemory.observe`). */
export type CoreDeskSeen = {
  /**
   * The harness World saw running here, now gone while the same foreground
   * leader (its wrapper) stays in front: the agent between headless calls.
   */
  left: string | null;
  /** The report is the one a departed process left: it speaks for nobody now. */
  stale: boolean;
  /**
   * The harness World last saw run here, while the host cannot read the
   * foreground group now: no evidence it left, so it still runs there.
   */
  held: HarnessInvocation | null;
};
const NOTHING_SEEN: CoreDeskSeen = { left: null, stale: false, held: null };

/** The desk's process evidence, with a harness `seen` holds through an unread group. */
export function coreDeskHeld(
  desk: CoreDeskProcess,
  seen: CoreDeskSeen,
): CoreDeskProcess {
  return !desk.running && seen.held
    ? { running: seen.held, gone: false }
    : desk;
}

/**
 * What World saw of each desk's agent process, so a process that leaves
 * neither drops its agent at once nor lends its report to the next one.
 *
 * - While a wrapper (`bash run.sh`) stays in front, a harness World saw run
 *   inside it stays the desk's agent after it exits: the agent walks to the
 *   bar instead of vanishing, and is there between headless calls. A new
 *   foreground leader (the wrapper ended, a shell is back) forgets it, as a
 *   directly started agent is forgotten when it exits.
 * - A process leaves only on evidence (`desk.gone`): a foreground group the
 *   host could not read keeps what World last saw, harness and headless
 *   alike (`held`), ahead of any report.
 * - The report standing when World saw the process leave is that process's:
 *   it is stale until the report changes, so a replacement that never
 *   reports is unknown (or, headless, working), never the departed one's
 *   word.
 *
 * Observation is process evidence only, read at each projection; a process
 * that starts and ends between two reads is never seen.
 */
export class CoreDeskMemory {
  private readonly desks = new Map<
    string,
    {
      leader: number | null;
      invocation: HarnessInvocation;
      present: boolean;
      staleReport: string | null;
    }
  >();

  observe(record: CoreMirrorTerminal, desk: CoreDeskProcess): CoreDeskSeen {
    const pid = object(record.foreground)?.pid;
    const leader = typeof pid === "number" ? pid : null;
    const report = JSON.stringify(record.status ?? null);
    let seen = this.desks.get(record.address);
    if (seen && seen.leader !== leader) {
      this.desks.delete(record.address);
      seen = undefined;
    }
    if (seen && seen.staleReport !== null && seen.staleReport !== report)
      seen.staleReport = null;
    const running = desk.running;
    if (running) {
      if (seen) {
        seen.invocation = running;
        seen.present = true;
      } else
        this.desks.set(record.address, {
          leader,
          invocation: running,
          present: true,
          staleReport: null,
        });
    } else if (seen?.present && desk.gone) {
      // Only confirmed absence: a group World could not read is no evidence.
      seen.present = false;
      seen.staleReport = report;
    }
    if (!seen) return NOTHING_SEEN;
    return {
      left: seen.present ? null : seen.invocation.harness,
      stale: seen.staleReport === report,
      held: seen.present && !running ? seen.invocation : null,
    };
  }

  /** Forgets desks that are no longer live terminals. */
  retain(addresses: ReadonlySet<string>): void {
    for (const address of this.desks.keys())
      if (!addresses.has(address)) this.desks.delete(address);
  }
}

/**
 * A desk's status: its program's report checked against the process. A
 * headless run (`claude -p`, `codex exec`) works for as long as it lives,
 * report or none. A report speaks only for the harness that runs there: one
 * a departed process left (`seen.stale`), or one naming another harness
 * than the one running, is no report. With nothing running, a known
 * harness's working or waiting report is stale and reads idle, as does the
 * agent World saw leave: the agent leaves its desk. Otherwise the report
 * decides, and with none the status is unknown.
 */
export function coreDeskStatus(
  record: CoreMirrorTerminal,
  desk: CoreDeskProcess,
  firstSight: number | null = null,
  seen: CoreDeskSeen = NOTHING_SEEN,
): CoreAgentStatus {
  const reportedHarness = harnessName(coreStatusReport(record)?.app);
  const foreign =
    desk.running !== null &&
    reportedHarness !== null &&
    reportedHarness !== desk.running.harness;
  const reported =
    seen.stale || foreign ? "unknown" : coreAgentStatus(record, firstSight);
  if (desk.running?.headless && reported !== "blocked") return "working";
  if (
    desk.gone &&
    (seen.left || reportedHarness) &&
    (reported === "working" ||
      reported === "blocked" ||
      (seen.left && reported === "unknown"))
  )
    return "idle";
  return reported;
}

/**
 * Whether a terminal's foreground leader is a shell or interpreter that may
 * run an agent in its group, out of core's sight: World then reads the
 * group on the host, and again while it leads.
 */
export function coreHidesAgent(record: CoreMirrorTerminal): boolean {
  const foreground = object(record.foreground);
  return Boolean(
    foreground &&
      mayWrapHarness(foreground, record.pid) &&
      !coreDeskProcess(record).running,
  );
}

type Placement =
  | { kind: "world"; room: CoreTopologyRoom; tab: CoreTopologyTab }
  | {
      kind: "app";
      space: string;
      tab: string | null;
      where: string;
      /** `where` is World's placeholder caption (`CORE_UNNAMED_SPACE_LABEL`). */
      placeholder: boolean;
    }
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
        placeholder: worldPlaceholder(current),
      };
    const parent: unknown = current.parent;
    current = typeof parent === "string" ? byAddress.get(parent) : undefined;
  }
  return { kind: "unplaced" };
}

/** World wrote this terminal's caption for a space with no name. */
function worldPlaceholder(record: CoreMirrorTerminal): boolean {
  return record.labels?.[CORE_UNNAMED_SPACE_LABEL] === "1";
}

/**
 * `where` is the app's "<space> / <tab>" caption; it only names rooms. The
 * placeholder World writes when it starts an agent in an unnamed space
 * (marked `placeholder`) names nothing; the same words from the app are
 * its name.
 */
function whereParts(
  where: string,
  placeholder = false,
): [string | null, string | null] {
  const cut = where.lastIndexOf(" / ");
  const space = text(cut < 0 ? where : where.slice(0, cut));
  return [
    placeholder && space === CORE_UNNAMED_SPACE ? null : space,
    cut < 0 ? null : text(where.slice(cut + 3)),
  ];
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
  /** The host's read of a foreground group, for a core on this machine. */
  foregroundGroup?: ForegroundGroupReader;
  /** World's memory of each desk's agent process, kept by the runtime. */
  desks?: CoreDeskMemory;
  /** World's derived names for unnamed spaces, kept by the runtime. */
  roomNames?: CoreRoomNames;
};

export function coreTopology(
  terminals: readonly CoreMirrorTerminal[],
  name: string,
  options: CoreTopologyOptions | Pick<CoreFirstSight, "turn"> = {},
): CoreTopology {
  // The main room is named after its core: never an empty name.
  const coreName = name.trim() || "herdr-core";
  const {
    firstSight = { turn: () => null },
    world = null,
    coreId = world?.core_id ?? "",
    now = Date.now(),
    occupancy,
    foregroundGroup,
    desks,
    roomNames,
  }: CoreTopologyOptions = "turn" in options
    ? { firstSight: options }
    : options;
  const local = terminals
    .filter(
      (record) =>
        !record.remote &&
        record.state === "live" &&
        record.labels?.[CORE_FLOAT_LABEL] === undefined,
    )
    .sort((a, b) => addressOrder(a.address, b.address));
  const byAddress = new Map(local.map((record) => [record.address, record]));
  desks?.retain(new Set(byAddress.keys()));
  const worldTabs = worldTabsOf(world, byAddress);
  const workspaces = new Map<string, WorkspaceRow>();
  const tabs = new Map<string, RuntimeRow>();
  // World's rooms come first, in its order, even when empty. An app space
  // World keeps terminals in, and has not named itself, is named by the
  // app's caption once a terminal gives one.
  const appNamed = new Set<string>();
  // App spaces with no name yet, and what their terminals show, oldest first.
  const unnamed = new Set<string>();
  const evidence = new Map<string, SpaceEvidence>();
  for (const room of world?.rooms ?? []) {
    const id = coreRoomWorkspaceId(room);
    workspaces.set(id, {
      workspace_id: id,
      label:
        room.label ||
        (room.app_space
          ? CORE_UNNAMED_SPACE
          : room.id === CORE_MAIN_ROOM
            ? coreName
            : "Room"),
      focused: false,
      ...(room.checkout
        ? coreCheckoutFields(room.checkout)
        : room.folder
          ? { cwd: room.folder }
          : {}),
    });
    if (room.app_space && !room.label) unnamed.add(id);
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
      const [spaceName, tabName] = whereParts(place.where, place.placeholder);
      workspaceId = SPACE_PREFIX + place.space;
      tabId = `${workspaceId}${TAB_SUFFIX}${place.tab ?? DEFAULT_TAB}`;
      workspaceLabel = spaceName ?? CORE_UNNAMED_SPACE;
      tabLabel = tabName ?? spaceName ?? "Tab";
    } else {
      workspaceId = CORE_UNPLACED_WORKSPACE;
      tabId = `${workspaceId}${TAB_SUFFIX}${DEFAULT_TAB}`;
      workspaceLabel = coreName;
      tabLabel = coreName;
    }
    const caption =
      place.kind === "app"
        ? place.where
        : place.kind === "world" && place.room.app_space && !place.room.label
          ? (label(record, "where") ?? "")
          : null;
    const known = workspaces.get(workspaceId);
    if (!known) {
      workspaces.set(workspaceId, {
        workspace_id: workspaceId,
        label: workspaceLabel,
        focused: false,
      });
      if (
        place.kind === "app" &&
        !whereParts(place.where, place.placeholder)[0]
      )
        unnamed.add(workspaceId);
    } else if (caption !== null && !appNamed.has(workspaceId)) {
      const [spaceName] = whereParts(
        caption,
        place.kind === "app" ? place.placeholder : worldPlaceholder(record),
      );
      if (spaceName) {
        known.label = spaceName;
        unnamed.delete(workspaceId);
      }
    }
    if (caption !== null) appNamed.add(workspaceId);
    if (!tabs.has(tabId))
      tabs.set(tabId, {
        tab_id: tabId,
        workspace_id: workspaceId,
        label: tabLabel,
        focused: false,
      });
    const report = coreStatusReport(record);
    const foreground = object(record.foreground);
    const group =
      foregroundGroup && typeof foreground?.pid === "number"
        ? foregroundGroup(
            foreground.pid,
            Array.isArray(foreground.argv) &&
              typeof foreground.argv[0] === "string"
              ? foreground.argv[0]
              : undefined,
          )
        : null;
    const read = coreDeskProcess(record, group);
    const seen = desks?.observe(record, read) ?? NOTHING_SEEN;
    const desk = coreDeskHeld(read, seen);
    const harness = coreHarness(record, group, seen);
    const cwd = text(record.cwd, 4096);
    const foregroundCwd = text(foreground?.cwd, 4096);
    // The space's oldest terminal that shows anything speaks for it alone:
    // a newer terminal never outranks it (`CoreRoomNames`).
    if (unnamed.has(workspaceId) && !evidence.has(workspaceId)) {
      const facts: SpaceEvidence = {
        folder: folderName(cwd),
        tab:
          place.kind === "world"
            ? text(place.tab.label)
            : place.kind === "app"
              ? whereParts(place.where, place.placeholder)[1]
              : null,
        agent: harness ? (text(record.name, 64) ?? harness) : null,
      };
      if (facts.folder || facts.tab || facts.agent)
        evidence.set(workspaceId, facts);
    }
    // Spawn stamps (M7): core's own parent for a child it started, else
    // World's display stamp. Both are display relations.
    const parent =
      typeof record.parent === "string" && byAddress.has(record.parent)
        ? record.parent
        : coreSpawnedBy(record);
    const summary = coreId ? coreSummaryOf(coreId, record, now) : null;
    // The terminal's own name in core ("build shell"): World's views label a
    // plain terminal with it (#1390); an agent's name comes with its row below.
    const name = text(record.name, 64);
    const pane: TerminalRow = {
      pane_id: record.address,
      terminal_id: record.address,
      workspace_id: workspaceId,
      tab_id: tabId,
      focused: false,
      runtime: "herdr-core",
      ...(name ? { label: name } : {}),
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
        ? coreDeskStatus(record, desk, firstSight.turn(record.address), seen)
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
  (roomNames ?? new CoreRoomNames()).name(
    coreId,
    workspaces,
    unnamed,
    evidence,
  );
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

type SpaceEvidence = {
  folder: string | null;
  tab: string | null;
  agent: string | null;
};

/** A folder's last path segment, or null for a root or an empty path. */
function folderName(path: string | null): string | null {
  if (!path) return null;
  return text(
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop(),
  );
}

type DerivedFrom = "folder" | "tab" | "agent";

/**
 * World's display names for the app spaces core gives no name (#1103), kept
 * for one core while each space lasts, so a name holds as agents come and
 * go, in its room or another.
 *
 * - A space is named once, from its oldest terminal that shows anything:
 *   that terminal's folder, else its tab's name, else its agent. With no
 *   evidence yet it stays `Herdr space` and is named when evidence comes.
 * - A name already taken in this core gets a number (`api`, `api 2`), in
 *   room order, so plates stay distinct. A space keeps its number when
 *   another room leaves; it is named again only when a room's own name
 *   comes to read the same.
 * - A space that is gone, or now has a name of its own, is forgotten.
 *
 * Display only: the row says where its name came from (`label_derived_from`)
 * and core's space stays unnamed and the app's.
 */
export class CoreRoomNames {
  private readonly names = new Map<
    string,
    { label: string; from: DerivedFrom }
  >();
  private coreId: string | null = null;

  name(
    coreId: string,
    workspaces: ReadonlyMap<string, WorkspaceRow>,
    unnamed: ReadonlySet<string>,
    evidence: ReadonlyMap<string, SpaceEvidence>,
  ): void {
    // Another core (or a restarted one) has spaces of its own.
    if (coreId !== this.coreId) this.names.clear();
    this.coreId = coreId;
    for (const id of this.names.keys())
      if (!unnamed.has(id) || !workspaces.has(id)) this.names.delete(id);
    const key = (label: string) => label.toLocaleLowerCase();
    const taken = new Set<string>();
    for (const [id, row] of workspaces)
      if (!unnamed.has(id) && typeof row.label === "string")
        taken.add(key(row.label));
    // Names already given hold first, unless a room's own name now reads
    // the same.
    for (const [id, name] of this.names)
      if (taken.has(key(name.label))) this.names.delete(id);
      else taken.add(key(name.label));
    for (const [id, row] of workspaces) {
      if (!unnamed.has(id)) continue;
      let name = this.names.get(id);
      if (!name) {
        const seen = evidence.get(id);
        const from: DerivedFrom | null = seen?.folder
          ? "folder"
          : seen?.tab
            ? "tab"
            : seen?.agent
              ? "agent"
              : null;
        if (!from || !seen) continue;
        const base = seen[from]!;
        let label = base;
        for (let n = 2; taken.has(key(label)); n += 1) label = `${base} ${n}`;
        taken.add(key(label));
        name = { label, from };
        this.names.set(id, name);
      }
      row.label = name.label;
      row.label_derived_from = name.from;
    }
  }
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
  foregroundGroup?: ForegroundGroupReader;
  desks?: CoreDeskMemory;
  roomNames?: CoreRoomNames;
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
    foregroundGroup: source.foregroundGroup,
    desks: source.desks,
    roomNames: source.roomNames,
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
