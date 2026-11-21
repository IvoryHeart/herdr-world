import { agentListRecord } from "../../../shared/agentMetadata";
import type {
  ApartmentAppearance,
  ApartmentLink,
  ApartmentResident,
  ApartmentState,
} from "../../../shared/apartments";
import {
  APARTMENT_CAPACITY,
  apartmentSessionKey,
  apartmentUsageAgentIds,
} from "../../../shared/apartments";
import type { BinEntry } from "../../../shared/bin";
import { readTerminalSettings } from "../agent/terminal-tokens";
import { analyticsAgentId } from "../usage/activity";
import type { ApartmentMoveIn, ApartmentsPort } from "../storage/apartments";

type Row = Record<string, unknown>;

/** One agent World saw at a desk, kept in memory until it moves out. */
export type ApartmentTenant = {
  connection_id: string;
  generation: number;
  terminal_id: string;
  pane_id: string;
  name: string;
  harness: string | null;
  cwd: string | null;
  room: string | null;
  tab: string | null;
  summary: string | null;
  session_id: string | null;
  /** Which program the runtime read `session_id` for (core), when it did. */
  session_holder: string | null;
  first_seen_at: number;
  last_seen_at: number;
  /**
   * Its program has left the terminal (a shell is all that remains): not
   * running, so its session no longer hides a resident. It still moves out
   * when the terminal ends.
   */
  away?: boolean;
  /** Its look in World as last seen live; null when World could not read it. */
  appearance: ApartmentAppearance | null;
  /**
   * The usage agent IDs it was counted under while live, newest last: only
   * those of its current harness session (`usage_session`).
   */
  usage_agent_ids: string[];
  /** The harness session `usage_agent_ids` belong to; null until known. */
  usage_session?: string | null;
};

/** What World needs to read a live agent's look (its pane, room and table). */
export type ApartmentPane = {
  pane_id: string;
  terminal_id: string;
  workspace_id: string | null;
  tab_id: string | null;
  /** The host's room IDs, which qualify a tab's colour key. */
  workspace_ids: ReadonlySet<string>;
  /** The profile World launched it from (its pane's World tokens). */
  profile_id: string | null;
};

/**
 * One pane of the observation the looks are read from: where it sits and its
 * Herdr metadata, so a spawned agent's colour can come from its parent's
 * table, as Town draws it.
 */
export type ApartmentHostPane = {
  pane_id: string;
  terminal_id: string;
  workspace_id: string | null;
  tab_id: string | null;
  tokens?: unknown;
};

/** The observation the looks are read from. */
export type ApartmentHost = {
  generation: number;
  panes: readonly ApartmentHostPane[];
  /** The host's room IDs, which qualify a tab's colour key. */
  workspace_ids: ReadonlySet<string>;
};

/**
 * What a runtime knows of a live agent's session now: its ID, or none, and
 * which program in the terminal it was read for. No evidence at all (the
 * host is not ready, a read failed) is null.
 */
export type ApartmentSessionEvidence = {
  id: string | null;
  holder: string | null;
};

/** The labels a fresh observation carries beside its panes. */
export type ApartmentTopology = {
  workspaces?: readonly Row[];
  tabs?: readonly Row[];
};

const MAX_TENANTS_PER_HOST = 512;
const MAX_RETIRING = 256;

const text = (value: unknown, max = 2000): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** The observation's panes as the look reader reads them. */
const hostPanes = (panes: readonly Row[]): ApartmentHostPane[] =>
  panes.flatMap((pane) => {
    const paneId = text(pane.pane_id, 200);
    const terminal = text(pane.terminal_id, 200);
    return paneId && terminal
      ? [
          {
            pane_id: paneId,
            terminal_id: terminal,
            workspace_id: text(pane.workspace_id, 200),
            tab_id: text(pane.tab_id, 200),
            tokens: pane.tokens,
          },
        ]
      : [];
  });

/** The harness session ID the pane or its agent record reports. */
function sessionId(pane: Row, agent: Row | null): string | null {
  for (const value of [pane.agent_session, agent?.agent_session]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const session = value as Row;
    const id = text(session.value, 200);
    if (id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) return id;
  }
  return null;
}

function summaryOf(pane: Row, agent: Row | null): string | null {
  const tokens = pane.tokens;
  const token =
    tokens && typeof tokens === "object" && !Array.isArray(tokens)
      ? (tokens as Row).task_summary
      : undefined;
  return text(token ?? pane.task_summary ?? agent?.task_summary, 500);
}

/**
 * Apartments' observer: it keeps the agents each host shows, and when a
 * complete pane list of the same host and runtime generation no longer has
 * an agent's terminal, that agent moves into an apartment (one durable
 * resident). A host that disconnects or restarts witnesses nothing: its
 * agents are forgotten, never recorded, because their end was not seen.
 * Agents the bin's bus took are recorded as retired. Agents found in the
 * harnesses' histories (world/apartment-census.ts) move in asleep; a
 * resident whose session runs again at a desk is hidden while it runs.
 *
 * A resident is written as soon as its end is seen; its last report, an
 * optional transcript read, is added to the written record afterwards, so a
 * restart during a slow read loses only that report.
 */
export class WorldApartments {
  private revision = 0;
  private readonly hosts = new Map<
    string,
    { generation: number; tenants: Map<string, ApartmentTenant> }
  >();
  /** connection:generation:terminal of agents the bus has taken. */
  private readonly retiring = new Set<string>();
  /** Move-ins and report reads still running. */
  private readonly pending = new Set<Promise<unknown>>();
  /** Session reads still running, by connection:generation:terminal. */
  private readonly probing = new Map<string, Promise<unknown>>();
  /** Residents hidden because their session runs now, as last published. */
  private hidden = "";
  private stopped = false;

  constructor(
    private readonly deps: {
      port: ApartmentsPort | undefined;
      now(): number;
      /** The host's label and runtime, as Town shows it. */
      host(connectionId: string): {
        label: string;
        runtime: "herdr" | "herdr-core";
      };
      /**
       * Reads live agents' looks on one host: the avatar chosen for the
       * pane, its profile's look and its colour (inherited from its
       * spawning parent's table like Town's, so it is given every pane of
       * the observation). Asked once per observation and read while the
       * agent lives, because closing a terminal clears its saved avatar
       * before the move-in is seen.
       */
      appearance?(
        connectionId: string,
        host: ApartmentHost,
      ): ((pane: ApartmentPane) => ApartmentAppearance) | null;
      /** Pull requests and issues linked to the agent, when sources know. */
      links?(tenant: ApartmentTenant): ApartmentLink[];
      /**
       * The harness session of a live agent whose rows carry none (core),
       * asked on every observation: the runtime bounds its own reads.
       */
      session?(
        connectionId: string,
        terminalId: string,
        harness: string,
      ):
        | Promise<ApartmentSessionEvidence | null>
        | ApartmentSessionEvidence
        | null
        | undefined;
      /** The agent's last report (herdr-world result), when it left one. */
      lastReport?(
        tenant: ApartmentTenant,
      ): Promise<string | null> | string | null;
      publish(revision: number): void;
      log?(message: string): void;
    },
  ) {}

  get available() {
    return !!this.deps.port;
  }

  /** Residents not running now: one whose session runs again is hidden. */
  list(): ApartmentState {
    const live = this.liveSessions();
    return {
      revision: this.revision,
      residents: (this.deps.port?.list() ?? []).filter((resident) => {
        const key = apartmentSessionKey(resident);
        return !key || !live.has(key);
      }),
      capacity: APARTMENT_CAPACITY,
    };
  }

  /** Sessions agents at a desk hold now, by apartmentSessionKey. */
  liveSessions(): Set<string> {
    const live = new Set<string>();
    for (const host of this.hosts.values())
      for (const tenant of host.tenants.values()) {
        if (tenant.away) continue;
        const key = apartmentSessionKey(tenant);
        if (key) live.add(key);
      }
    return live;
  }

  /** Residents found in the harnesses' histories move in asleep. */
  async found(residents: readonly ApartmentMoveIn[]) {
    const port = this.deps.port;
    if (!port || this.stopped || !residents.length) return;
    await port.found(residents);
    this.changed();
  }

  get(id: string): ApartmentResident | undefined {
    return this.deps.port?.get(id);
  }

  /** What a fresh (possibly bounded) observation shows of each agent. */
  fresh(
    connectionId: string,
    generation: number,
    panes: readonly Row[],
    observedAt: number,
    agents: readonly Row[],
    topology: ApartmentTopology = {},
  ) {
    const host = this.host(connectionId, generation);
    const rooms = new Map(
      (topology.workspaces ?? []).map((row) => [
        row.workspace_id,
        text(row.label, 200),
      ]),
    );
    const tabs = new Map(
      (topology.tabs ?? []).map((row) => [row.tab_id, text(row.label, 200)]),
    );
    const workspaceIds = new Set(
      (topology.workspaces ?? [])
        .map((row) => text(row.workspace_id, 200))
        .filter((id): id is string => !!id),
    );
    let lookOf:
      | ((pane: ApartmentPane) => ApartmentAppearance)
      | null
      | undefined;
    // As usage's observeFresh joins them, so the agent IDs are the same.
    const agentByPane = new Map(agents.map((row) => [row.pane_id, row]));
    for (const pane of panes) {
      const harness = text(pane.agent, 40);
      const terminal = text(pane.terminal_id, 200);
      const paneId = text(pane.pane_id, 200);
      if (!harness || !terminal || !paneId) {
        // A terminal shown without its agent: that agent is no longer running.
        const left = terminal ? host.tenants.get(terminal) : undefined;
        if (left && !harness) left.away = true;
        continue;
      }
      const agent = agentListRecord(agents, { ...pane, pane_id: pane.pane_id });
      const before = host.tenants.get(terminal);
      // Another program in the same terminal is another agent.
      const same = before && before.harness === harness;
      if (!same && host.tenants.size >= MAX_TENANTS_PER_HOST) continue;
      const reported = sessionId(pane, agent);
      // The ID usage counts this agent under, read as usage reads it.
      const usageAgent = analyticsAgentId(connectionId, generation, {
        ...pane,
        ...agentByPane.get(pane.pane_id),
      });
      // Usage is kept for one harness session: another session in the same
      // terminal (a /clear, or a new run after the program left) is another
      // agent, and its time and tokens are not this resident's.
      const session = reported ?? (same ? before.session_id : null);
      const bound = same ? (before.usage_session ?? null) : null;
      const usage =
        same && !(session && bound && session !== bound)
          ? before.usage_agent_ids
          : [];
      if (lookOf === undefined)
        lookOf = safe(
          () =>
            this.deps.appearance?.(connectionId, {
              generation,
              panes: hostPanes(panes),
              workspace_ids: workspaceIds,
            }) ?? null,
          null,
        );
      const look = lookOf
        ? safe<ApartmentAppearance | null>(
            () =>
              lookOf!({
                pane_id: paneId,
                terminal_id: terminal,
                workspace_id: text(pane.workspace_id, 200),
                tab_id: text(pane.tab_id, 200),
                workspace_ids: workspaceIds,
                profile_id: readTerminalSettings(pane).profile_id ?? null,
              }),
            null,
          )
        : null;
      const seen: ApartmentTenant = {
        connection_id: connectionId,
        generation,
        terminal_id: terminal,
        pane_id: paneId,
        name:
          text(agent?.name, 100) ??
          text(pane.display_agent ?? agent?.display_agent, 100) ??
          harness,
        harness,
        cwd:
          text(agent?.cwd ?? pane.cwd ?? agent?.foreground_cwd, 1024) ??
          (same ? before.cwd : null),
        room: rooms.get(pane.workspace_id) ?? (same ? before.room : null),
        tab: tabs.get(pane.tab_id) ?? (same ? before.tab : null),
        summary: summaryOf(pane, agent) ?? (same ? before.summary : null),
        // Kept from before until the runtime's current answer replaces it.
        session_id: session,
        session_holder: reported ? null : same ? before.session_holder : null,
        first_seen_at: same ? before.first_seen_at : observedAt,
        last_seen_at: observedAt,
        away: false,
        appearance: look ?? (same ? before.appearance : null),
        usage_agent_ids:
          usageAgent && usage.at(-1) !== usageAgent
            ? apartmentUsageAgentIds([...usage, usageAgent])
            : usage,
        usage_session: session ?? bound,
      };
      // The same agent stays one object, so a session read still running
      // when it leaves lands on the record it leaves.
      const tenant = same ? Object.assign(before, seen) : seen;
      host.tenants.set(terminal, tenant);
      if (!reported) this.probe(tenant);
    }
    this.liveChanged();
  }

  /**
   * A complete pane list of the host: every agent whose terminal it no
   * longer has has ended, and moves out.
   */
  complete(connectionId: string, generation: number, panes: readonly Row[]) {
    const host = this.hosts.get(connectionId);
    if (!host || host.generation !== generation) return;
    const present = new Set(
      panes
        .map((pane) => pane.terminal_id)
        .filter((id) => typeof id === "string"),
    );
    const leaving: ApartmentTenant[] = [];
    for (const [terminal, tenant] of host.tenants)
      if (!present.has(terminal)) {
        host.tenants.delete(terminal);
        leaving.push(tenant);
      }
    for (const tenant of leaving) this.moveOut(tenant);
    if (leaving.length) this.liveChanged();
  }

  /** The bus has left with these riders. */
  retire(entries: readonly BinEntry[]) {
    for (const entry of entries) {
      this.retiring.add(
        `${entry.connection_id}\0${entry.connection_generation}\0${entry.terminal_id}`,
      );
      if (this.retiring.size > MAX_RETIRING) {
        const oldest = this.retiring.values().next().value;
        if (oldest !== undefined) this.retiring.delete(oldest);
      }
    }
  }

  /** A connection's runtime changed: its agents' ends can no longer be seen. */
  connectionStatus(status: { id: string; generation: number; state: string }) {
    const host = this.hosts.get(status.id);
    if (host && host.generation !== status.generation) {
      this.hosts.delete(status.id);
      this.liveChanged();
    }
  }

  async evict(ids: readonly string[]) {
    if (!this.deps.port) throw new Error("Apartments need World storage");
    await this.deps.port.evict(ids);
    this.changed();
    return this.list();
  }

  /** Waits for every move-in and report read so far. */
  async settled() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /**
   * Before World's storage closes: ends seen so far are written; a report
   * still being read is dropped, and nothing more is written.
   */
  async stop() {
    this.stopped = true;
    await this.settled();
  }

  /**
   * Asks the runtime which session the agent in `terminal` has now. Its
   * answer replaces the remembered one; an answer of no session clears it
   * only when another program holds the terminal (a failed read of the
   * same program is no evidence).
   */
  private probe(tenant: ApartmentTenant) {
    const read = this.deps.session;
    const harness = tenant.harness;
    if (!read || !harness) return;
    const key = tenantKey(tenant);
    if (this.probing.has(key)) return;
    const apply = (evidence: unknown) => {
      if (!evidence || typeof evidence !== "object") return;
      const { id, holder } = evidence as Row;
      const found = validSession(id);
      const by = typeof holder === "string" ? holder : null;
      if (found) {
        // Another session than the usage was kept for: only the current
        // program's newest usage ID can be this session's.
        if (tenant.usage_session && tenant.usage_session !== found)
          tenant.usage_agent_ids = tenant.usage_agent_ids.slice(-1);
        tenant.usage_session = found;
        tenant.session_id = found;
        tenant.session_holder = by;
      } else if (by !== tenant.session_holder) {
        tenant.session_id = null;
        tenant.session_holder = by;
      }
      this.liveChanged();
    };
    let answer: unknown;
    try {
      answer = read(tenant.connection_id, tenant.terminal_id, harness);
    } catch {
      return;
    }
    if (!(answer instanceof Promise)) return apply(answer);
    const task = answer
      .then(apply, () => undefined)
      .finally(() => this.probing.delete(key));
    this.probing.set(key, task);
  }

  private host(connectionId: string, generation: number) {
    let host = this.hosts.get(connectionId);
    if (!host || host.generation !== generation) {
      host = { generation, tenants: new Map() };
      this.hosts.set(connectionId, host);
    }
    return host;
  }

  private moveOut(tenant: ApartmentTenant) {
    const port = this.deps.port;
    if (!port || this.stopped) return;
    const key = tenantKey(tenant);
    const retired = this.retiring.delete(key);
    const reading = this.probing.get(key);
    const host = this.deps.host(tenant.connection_id);
    const resident: ApartmentMoveIn = {
      name: tenant.name,
      harness: tenant.harness,
      cwd: tenant.cwd,
      room: tenant.room,
      tab: tenant.tab,
      connection_id: tenant.connection_id,
      connection_label: host.label,
      runtime: host.runtime,
      terminal_id: tenant.terminal_id,
      first_seen_at: tenant.first_seen_at,
      moved_out_at: Math.max(tenant.first_seen_at, this.deps.now()),
      move_out: retired ? "retired" : "ended",
      summary: tenant.summary,
      last_report: null,
      links: safe(() => this.deps.links?.(tenant) ?? [], []),
      session_id: tenant.session_id,
      appearance: tenant.appearance,
      usage_agent_ids: tenant.usage_agent_ids,
    };
    const task = (async () => {
      let saved: ApartmentResident;
      try {
        // A session read that started while the agent lived still counts.
        if (reading) {
          await within(reading, SESSION_WAIT_MS);
          resident.session_id = tenant.session_id;
          resident.usage_agent_ids = tenant.usage_agent_ids;
        }
        saved = await port.moveIn(resident);
        this.changed();
      } catch (error) {
        this.deps.log?.(
          `Apartments could not record ${tenant.name}: ${(error as Error).message}`,
        );
        return;
      }
      if (this.stopped || !this.deps.lastReport) return;
      const lastReport = await report(() => this.deps.lastReport?.(tenant));
      if (!lastReport || this.stopped) return;
      try {
        await port.report(saved.id, lastReport);
        this.changed();
      } catch (error) {
        this.deps.log?.(
          `Apartments could not add ${tenant.name}'s last report: ${(error as Error).message}`,
        );
      }
    })();
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /**
   * A resident's session started or stopped running at a desk: the list
   * every view shows changed, though no record did.
   */
  private liveChanged() {
    const port = this.deps.port;
    if (!port) return;
    const live = this.liveSessions();
    const keys = port.sessionKeys();
    const hidden = [...live]
      .filter((key) => keys.has(key))
      .sort()
      .join("\n");
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.changed();
  }

  private changed() {
    this.revision += 1;
    this.deps.publish(this.revision);
  }
}

const REPORT_WAIT_MS = 10_000;
const SESSION_WAIT_MS = 5_000;

const tenantKey = (tenant: ApartmentTenant) =>
  `${tenant.connection_id}\0${tenant.generation}\0${tenant.terminal_id}`;

/** Waits for `task`, for at most `ms`. */
async function within(task: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

/** The last report, or null when it fails or takes too long. */
async function report(
  read: () => Promise<string | null> | string | null | undefined,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(read),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REPORT_WAIT_MS);
      }),
    ]);
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function validSession(id: unknown): string | null {
  return typeof id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)
    ? id
    : null;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
