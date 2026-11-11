import type {
  RuntimeReader,
  RuntimeRow,
  TerminalRow,
  WorkspaceRow,
} from "../adapters/runtime-ports";
import { CoreUnavailableError } from "./client";
import { harnessName, harnessOfArgv } from "./harness";
import type { CoreMirror, CoreMirrorTerminal } from "./mirror";

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

type Placement = { space: string | null; tab: string | null; where: string };

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
      this.turns.set(record.address, turnOf(record.turn));
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

function turnOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
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
  const seenText = label(record, "herdr.seen");
  const shared =
    seenText && /^\d{1,15}$/.test(seenText) ? Number(seenText) : null;
  const seen = shared ?? firstSight ?? turnOf(record.turn);
  return turnOf(record.turn) > seen ? "done" : "idle";
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

function placementOf(
  record: CoreMirrorTerminal,
  byAddress: ReadonlyMap<string, CoreMirrorTerminal>,
): Placement {
  let current: CoreMirrorTerminal | undefined = record;
  for (let depth = 0; current && depth < 32; depth += 1) {
    const space = label(current, "herdr.space");
    if (space)
      return {
        space,
        tab: label(current, "herdr.tab"),
        where: label(current, "where") ?? "",
      };
    const parent: unknown = current.parent;
    current = typeof parent === "string" ? byAddress.get(parent) : undefined;
  }
  return { space: null, tab: null, where: "" };
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

export type CoreTopology = {
  workspaces: WorkspaceRow[];
  tabs: RuntimeRow[];
  panes: TerminalRow[];
  agents: RuntimeRow[];
};

export function coreTopology(
  terminals: readonly CoreMirrorTerminal[],
  coreName: string,
  firstSight: Pick<CoreFirstSight, "turn"> = { turn: () => null },
): CoreTopology {
  const local = terminals
    .filter((record) => !record.remote && record.state === "live")
    .sort((a, b) => addressOrder(a.address, b.address));
  const byAddress = new Map(local.map((record) => [record.address, record]));
  const workspaces = new Map<string, WorkspaceRow>();
  const tabs = new Map<string, RuntimeRow>();
  const panes: TerminalRow[] = [];
  const agents: RuntimeRow[] = [];
  for (const record of local) {
    const place = placementOf(record, byAddress);
    const [spaceName, tabName] = whereParts(place.where);
    const workspaceId = place.space
      ? SPACE_PREFIX + place.space
      : CORE_UNPLACED_WORKSPACE;
    const tabId = `${workspaceId}${TAB_SUFFIX}${place.space ? (place.tab ?? DEFAULT_TAB) : DEFAULT_TAB}`;
    if (!workspaces.has(workspaceId))
      workspaces.set(workspaceId, {
        workspace_id: workspaceId,
        label: place.space ? (spaceName ?? "Herdr space") : coreName,
        focused: false,
      });
    if (!tabs.has(tabId))
      tabs.set(tabId, {
        tab_id: tabId,
        workspace_id: workspaceId,
        label: place.space ? (tabName ?? spaceName ?? "Tab") : coreName,
        focused: false,
      });
    const report = coreStatusReport(record);
    const harness = coreHarness(record);
    const foreground = object(record.foreground);
    const cwd = text(record.cwd, 4096);
    const foregroundCwd = text(foreground?.cwd, 4096);
    const pane: TerminalRow = {
      pane_id: record.address,
      terminal_id: record.address,
      workspace_id: workspaceId,
      tab_id: tabId,
      focused: false,
      runtime: "herdr-core",
      ...(cwd ? { cwd } : {}),
      ...(foregroundCwd ? { foreground_cwd: foregroundCwd } : {}),
      agent_status: harness
        ? coreAgentStatus(record, firstSight.turn(record.address))
        : "unknown",
    };
    panes.push(pane);
    if (!harness) continue;
    pane.agent = harness;
    // The program's own words for why it waits: Needs you shows them.
    if (report?.word === "blocked" && report.kind)
      pane.blocked_kind = report.kind;
    if (report?.message) pane.status_message = report.message;
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
  return {
    workspaces: [...workspaces.values()],
    tabs: [...tabs.values()],
    panes,
    agents,
  };
}

export type CoreReadModelSource = {
  readonly mirror: CoreMirror;
  readonly actionable: boolean;
  coreName(): string;
  firstSight?: Pick<CoreFirstSight, "turn">;
};

/**
 * World's rows for one core, only while its observation is current. A
 * retired or unbaselined mirror refuses: World then shows the last
 * observation as stale and never as current (the model's `ready`).
 */
export function coreReadModel(source: CoreReadModelSource): CoreTopology {
  if (!source.actionable)
    throw new CoreUnavailableError("herdr-core observation is not current");
  return coreTopology(
    source.mirror.terminals(),
    source.coreName(),
    source.firstSight,
  );
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
