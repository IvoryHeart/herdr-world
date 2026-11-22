import type { BridgeControlMsg, ConnectionStatus } from "../../api";
import {
  APARTMENT_MOVE_OUTS,
  type ApartmentHistory,
  type ApartmentLink,
  type ApartmentMoveOut,
  type ApartmentResident,
  type ApartmentState,
  EMPTY_APARTMENTS,
  parseApartmentAppearance,
} from "../../../../shared/apartments";

/** The service's apartments as this page last read them. */
export type WorldApartmentsState = ApartmentState & { verified: boolean };

export type ApartmentsClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const time = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;

function linkOf(value: unknown): ApartmentLink | null {
  if (!record(value)) return null;
  if (value.kind !== "pr" && value.kind !== "issue") return null;
  if (!Number.isSafeInteger(value.number) || (value.number as number) <= 0)
    return null;
  const url = text(value.url);
  return {
    kind: value.kind,
    number: value.number as number,
    ...(text(value.repo) ? { repo: text(value.repo)! } : {}),
    ...(url && /^https:\/\//.test(url) ? { url } : {}),
    ...(text(value.title) ? { title: text(value.title)! } : {}),
  };
}

function residentOf(value: unknown): ApartmentResident | null {
  if (!record(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  const connection = text(value.connection_id);
  const terminal = text(value.terminal_id);
  const first = time(value.first_seen_at);
  const moved = time(value.moved_out_at);
  if (
    !id ||
    !name ||
    !connection ||
    !terminal ||
    first === null ||
    moved === null ||
    (value.runtime !== "herdr" && value.runtime !== "herdr-core") ||
    !APARTMENT_MOVE_OUTS.includes(value.move_out as ApartmentMoveOut)
  )
    return null;
  return {
    id,
    name,
    harness: text(value.harness),
    cwd: text(value.cwd),
    room: text(value.room),
    tab: text(value.tab),
    connection_id: connection,
    connection_label: text(value.connection_label) ?? connection,
    runtime: value.runtime,
    terminal_id: terminal,
    first_seen_at: first,
    moved_out_at: moved,
    move_out: value.move_out as ApartmentMoveOut,
    summary: text(value.summary),
    last_report: text(value.last_report),
    links: (Array.isArray(value.links) ? value.links : [])
      .map(linkOf)
      .filter((link): link is ApartmentLink => link !== null),
    session_id: text(value.session_id),
    appearance: parseApartmentAppearance(value.appearance),
  };
}

/** A service reply, or null when it is not an apartments state. */
export function parseApartmentState(value: unknown): ApartmentState | null {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.revision) ||
    !Array.isArray(value.residents)
  )
    return null;
  return {
    revision: value.revision as number,
    residents: value.residents
      .map(residentOf)
      .filter((item): item is ApartmentResident => item !== null),
    capacity: time(value.capacity) ?? EMPTY_APARTMENTS.capacity,
  };
}

export function parseApartmentHistory(value: unknown): ApartmentHistory {
  if (
    !record(value) ||
    (value.status !== "ok" && value.status !== "unavailable")
  )
    return {
      status: "unavailable",
      detail: "World sent an unreadable history.",
      messages: [],
      truncated: false,
      report: null,
    };
  return {
    status: value.status,
    detail: typeof value.detail === "string" ? value.detail : "",
    messages: (Array.isArray(value.messages) ? value.messages : []).filter(
      (message): message is ApartmentHistory["messages"][number] =>
        record(message) &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string" &&
        typeof message.sent_at === "string",
    ),
    truncated: value.truncated === true,
    report: text(value.report),
  };
}

/**
 * Apartments as every view shows them: refreshed on the service's revision
 * notices and on reconnect. Town's building and Board's list read this one
 * store.
 */
export class WorldApartmentsStore {
  private state: WorldApartmentsState = {
    ...EMPTY_APARTMENTS,
    verified: false,
  };
  private listeners = new Set<() => void>();
  private users = 0;
  private generation = 0;
  private unlisten: (() => void)[] = [];

  constructor(private readonly client: ApartmentsClient) {}

  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Counted: the last user to stop ends the subscription. */
  start() {
    this.users += 1;
    if (this.users > 1) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (control.type === "world_apartments_changed") void this.refresh();
      }),
      this.client.onStatus((status) => {
        if (status === "connected") void this.refresh();
        if (status === "disconnected")
          this.set({ ...this.state, verified: false });
      }),
    ];
    void this.refresh();
  }

  stop() {
    this.users = Math.max(0, this.users - 1);
    if (this.users) return;
    this.generation += 1;
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }

  async refresh() {
    const generation = this.generation;
    try {
      const next = parseApartmentState(
        await this.client.call("world.apartments.list"),
      );
      if (next && generation === this.generation) this.accept(next);
    } catch {
      if (generation === this.generation)
        this.set({ ...this.state, verified: false });
    }
  }

  async history(id: string): Promise<ApartmentHistory> {
    return parseApartmentHistory(
      await this.client.call("world.apartments.history", { id }),
    );
  }

  /** Removes these residents' records; the error's text, or null. */
  async evict(ids: readonly string[]): Promise<string | null> {
    try {
      const next = parseApartmentState(
        await this.client.call("world.apartments.evict", { ids: [...ids] }),
      );
      if (next) this.accept(next);
      return null;
    } catch (error) {
      return error instanceof Error && error.message
        ? error.message
        : "Could not evict";
    }
  }

  private accept(next: ApartmentState) {
    if (this.state.verified && next.revision < this.state.revision) return;
    this.set({ ...next, verified: true });
  }

  private set(next: WorldApartmentsState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const WORLD_APARTMENTS_EVENT = "herdr-world:apartments";

/** What Apartments opens on: a search, or one resident's apartment. */
export type ApartmentsRequest = { query?: string; resident?: string };

/**
 * Open Apartments (Town's building, Town center, Board), optionally on a
 * search or on one resident's detail (a Board agent log's Open apartment).
 */
export function openApartments(request?: string | ApartmentsRequest) {
  window.dispatchEvent(
    new CustomEvent<ApartmentsRequest>(WORLD_APARTMENTS_EVENT, {
      detail: typeof request === "string" ? { query: request } : request,
    }),
  );
}
