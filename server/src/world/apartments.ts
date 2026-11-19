import { agentListRecord } from "../../../shared/agentMetadata";
import type {
  ApartmentLink,
  ApartmentResident,
  ApartmentState,
} from "../../../shared/apartments";
import {
  APARTMENT_CAPACITY,
  APARTMENT_RETENTION_MS,
} from "../../../shared/apartments";
import type { BinEntry } from "../../../shared/bin";
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
  first_seen_at: number;
  last_seen_at: number;
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
 * Agents the bin's bus took are recorded as retired.
 */
export class WorldApartments {
  private revision = 0;
  private readonly hosts = new Map<
    string,
    { generation: number; tenants: Map<string, ApartmentTenant> }
  >();
  /** connection:generation:terminal of agents the bus has taken. */
  private readonly retiring = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: {
      port: ApartmentsPort | undefined;
      now(): number;
      /** The host's label and runtime, as Town shows it. */
      host(connectionId: string): {
        label: string;
        runtime: "herdr" | "herdr-core";
      };
      /** Pull requests and issues linked to the agent, when sources know. */
      links?(tenant: ApartmentTenant): ApartmentLink[];
      /** The harness session of a live agent whose rows carry none (core). */
      session?(
        connectionId: string,
        terminalId: string,
        harness: string,
      ): string | null | undefined;
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

  list(): ApartmentState {
    return {
      revision: this.revision,
      residents: this.deps.port?.list() ?? [],
      capacity: APARTMENT_CAPACITY,
      retention_ms: APARTMENT_RETENTION_MS,
    };
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
    for (const pane of panes) {
      const harness = text(pane.agent, 40);
      const terminal = text(pane.terminal_id, 200);
      const paneId = text(pane.pane_id, 200);
      if (!harness || !terminal || !paneId) continue;
      const agent = agentListRecord(agents, { ...pane, pane_id: pane.pane_id });
      const before = host.tenants.get(terminal);
      // Another program in the same terminal is another agent.
      const same = before && before.harness === harness;
      if (!same && host.tenants.size >= MAX_TENANTS_PER_HOST) continue;
      const tenant: ApartmentTenant = {
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
        session_id:
          sessionId(pane, agent) ??
          (same ? before.session_id : null) ??
          safeSession(() =>
            this.deps.session?.(connectionId, terminal, harness),
          ),
        first_seen_at: same ? before.first_seen_at : observedAt,
        last_seen_at: observedAt,
      };
      host.tenants.set(terminal, tenant);
    }
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
    if (host && host.generation !== status.generation)
      this.hosts.delete(status.id);
  }

  async evict(ids: readonly string[]) {
    if (!this.deps.port) throw new Error("Apartments need World storage");
    await this.deps.port.evict(ids);
    this.changed();
    return this.list();
  }

  /** Waits for every move-in so far (tests). */
  settled() {
    return this.queue;
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
    if (!port) return;
    const key = `${tenant.connection_id}\0${tenant.generation}\0${tenant.terminal_id}`;
    const retired = this.retiring.delete(key);
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
    };
    const run = async () => {
      try {
        resident.last_report = await report(() =>
          this.deps.lastReport?.(tenant),
        );
        await port.moveIn(resident);
        this.changed();
      } catch (error) {
        this.deps.log?.(
          `Apartments could not record ${tenant.name}: ${(error as Error).message}`,
        );
      }
    };
    this.queue = this.queue.then(run, run);
  }

  private changed() {
    this.revision += 1;
    this.deps.publish(this.revision);
  }
}

const REPORT_WAIT_MS = 10_000;

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

function safeSession(read: () => string | null | undefined): string | null {
  const id = safe(read, null);
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
