import {
  APARTMENT_CAPACITY,
  type ApartmentResident,
  apartmentSessionKey,
} from "../../../shared/apartments";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import type { CensusFile, CensusHarness } from "../agent/session-census-files";
import { readSessionProjection } from "../agent/session-projection-cache";
import type { ApartmentMoveIn } from "../storage/apartments";

type Row = Record<string, unknown>;

/** What a transcript's first bytes tell of the agent that wrote it. */
export type FoundSession = {
  harness: CensusHarness;
  session_id: string;
  cwd: string | null;
  started_at: number;
  summary: string | null;
};

/**
 * How much of a transcript is read: Codex writes its instructions, tools
 * and workspace state before the first thing the person asked.
 */
export const CENSUS_PREFIX_BYTES: Record<CensusHarness, number> = {
  claude: 64 * 1024,
  codex: 256 * 1024,
  pi: 64 * 1024,
  omp: 64 * 1024,
};
const SUMMARY_CHARS = 300;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const record = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const timeOf = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
};

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The session a transcript is named for, before reading it: Claude names
 * the file for its session, Codex ends the name with it, Pi after "_".
 */
export function censusSessionFromName(file: CensusFile): string | null {
  const name = baseName(file.path).replace(/\.jsonl(\.zst)?$/, "");
  if (file.harness === "claude") return UUID.test(name) ? name : null;
  if (file.harness === "codex")
    return (
      /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(name)?.[1] ?? null
    );
  const id = name.slice(name.lastIndexOf("_") + 1);
  return SESSION.test(id) ? id : null;
}

/** Whole JSON lines of a prefix; a cut last line is dropped. */
function lines(prefix: Uint8Array): { text: string; records: Row[] } {
  const decoded = new TextDecoder().decode(prefix);
  const text = decoded.slice(0, decoded.lastIndexOf("\n") + 1);
  const records: Row[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (record(parsed)) records.push(parsed);
    } catch {
      // Not a record.
    }
  }
  return { text, records };
}

/**
 * The agent a transcript's first bytes describe, or null when they name no
 * session, or the session is another agent's helper (a Codex subagent;
 * Claude's sidechains live deeper and are never listed).
 */
export async function describeCensusFile(
  file: CensusFile,
  prefix: Uint8Array,
  files: AgentSessionFileAccess,
): Promise<FoundSession | null> {
  const { text, records } = lines(prefix);
  const named = censusSessionFromName(file);
  let session: string | null;
  let cwd: string | null;
  let started: number | null;
  if (file.harness === "codex") {
    const meta = records.find((item) => item.type === "session_meta");
    const payload = record(meta?.payload) ? meta.payload : null;
    if (!payload) return null;
    if (record(payload.source) && "subagent" in payload.source) return null;
    session = string(payload.id) ?? named;
    cwd = string(payload.cwd);
    started = timeOf(payload.timestamp) ?? timeOf(meta?.timestamp);
  } else if (file.harness === "claude") {
    session = named;
    const user = records.find((item) => item.type === "user");
    if (user?.isSidechain === true) return null;
    cwd = string(records.find((item) => string(item.cwd))?.cwd);
    started = timeOf(records.find((item) => timeOf(item.timestamp))?.timestamp);
    // A file of summaries or snapshots only is no conversation.
    if (!user) return null;
  } else {
    const head = records.find((item) => item.type === "session");
    if (!head) return null;
    session = string(head.id) ?? named;
    cwd = string(head.cwd);
    started = timeOf(head.timestamp);
  }
  if (!session || !SESSION.test(session)) return null;
  let summary: string | null = null;
  try {
    const projection = await readSessionProjection(
      file.harness,
      { path: file.path, mtimeMs: file.mtimeMs, size: file.size },
      files,
      started ?? file.mtimeMs,
      text,
    );
    const first = projection.messages.find((item) => item.role === "user");
    const plain = first?.text.replace(/\s+/g, " ").trim();
    summary = plain
      ? plain.length > SUMMARY_CHARS
        ? `${plain.slice(0, SUMMARY_CHARS - 1)}…`
        : plain
      : null;
  } catch {
    // The facts above still stand without a summary.
  }
  return {
    harness: file.harness,
    session_id: session,
    cwd,
    started_at: Math.min(started ?? file.mtimeMs, Math.floor(file.mtimeMs)),
    summary,
  };
}

/** A found session as the asleep resident it becomes. */
export function foundResident(
  found: FoundSession,
  file: CensusFile,
  host: {
    connection_id: string;
    label: string;
    runtime: "herdr" | "herdr-core";
  },
): ApartmentMoveIn {
  return {
    name: found.harness,
    harness: found.harness,
    cwd: found.cwd,
    room: null,
    tab: null,
    connection_id: host.connection_id,
    connection_label: host.label,
    runtime: host.runtime,
    terminal_id: `session:${found.session_id}`,
    first_seen_at: found.started_at,
    moved_out_at: Math.max(found.started_at, Math.floor(file.mtimeMs)),
    move_out: "found",
    summary: found.summary,
    last_report: null,
    links: [],
    session_id: found.session_id,
  };
}

/** How often a host's histories are looked through again. */
export const CENSUS_INTERVAL_MS = 15 * 60 * 1000;
/** A transcript written this recently may belong to a running agent. */
export const CENSUS_QUIET_MS = 10 * 60 * 1000;
/** Transcripts read per pass; a longer history continues next pass. */
export const CENSUS_READS_PER_PASS = 400;
const CONTINUE_MS = 60 * 1000;
const READ_BATCH = 25;
const WRITE_BATCH = 100;

type CensusDeps = {
  /** The host's transcript files, while it is connected. */
  files(connectionId: string): AgentSessionFileAccess | null;
  host(connectionId: string): {
    label: string;
    runtime: "herdr" | "herdr-core";
  };
  /** Current residents. */
  residents(): readonly ApartmentResident[];
  /** Sessions running now, by apartmentSessionKey. */
  live(): ReadonlySet<string>;
  found(residents: readonly ApartmentMoveIn[]): Promise<void>;
  now(): number;
  log?(message: string): void;
};

/**
 * Apartments' census: on each connected host it lists the transcripts the
 * harnesses keep and moves every agent that is not running now into an
 * apartment, asleep (move_out "found"). Each host is looked through at
 * most every CENSUS_INTERVAL_MS, one host at a time, newest first, at most
 * CENSUS_READS_PER_PASS transcripts read per pass. A transcript is read
 * once: later passes only list files and refresh when a found agent last
 * wrote. Only reads: nothing is asked of Herdr or written on the host.
 */
export class ApartmentCensus {
  private readonly hosts = new Map<
    string,
    { due: number; done: Map<string, number> }
  >();
  private readonly queue: string[] = [];
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly deps: CensusDeps) {}

  /** The host was observed: look through its histories when due. */
  request(connectionId: string) {
    if (this.stopped || this.queue.includes(connectionId)) return;
    const host = this.hosts.get(connectionId);
    if (host && host.due > this.deps.now()) return;
    this.queue.push(connectionId);
    if (!this.running) this.running = this.drain();
  }

  /** Waits for the passes queued so far. */
  async settled() {
    while (this.running) await this.running;
  }

  async stop() {
    this.stopped = true;
    this.queue.length = 0;
    await this.settled();
  }

  private async drain() {
    try {
      for (
        let next = this.queue.shift();
        next !== undefined && !this.stopped;
        next = this.queue.shift()
      ) {
        try {
          await this.pass(next);
        } catch (error) {
          this.deps.log?.(
            `Apartments could not read past agents on ${this.deps.host(next).label}: ${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.running = null;
    }
  }

  private async pass(connectionId: string) {
    const now = this.deps.now();
    let host = this.hosts.get(connectionId);
    if (!host) {
      host = { due: 0, done: new Map() };
      this.hosts.set(connectionId, host);
    }
    host.due = now + CENSUS_INTERVAL_MS;
    const files = this.deps.files(connectionId);
    if (!files?.listCensusFiles || !files.readPrefixes) return;
    const listed = (await files.listCensusFiles()).sort(
      (a, b) => b.mtimeMs - a.mtimeMs,
    );
    const label = this.deps.host(connectionId);
    const target = {
      connection_id: connectionId,
      label: label.label,
      runtime: label.runtime,
    };
    const known = new Map<string, ApartmentResident>();
    for (const resident of this.deps.residents()) {
      const key = apartmentSessionKey(resident);
      if (key) known.set(key, resident);
    }
    const live = this.deps.live();
    const quiet = now - CENSUS_QUIET_MS;
    const updates: ApartmentMoveIn[] = [];
    const unread: CensusFile[] = [];
    for (const file of listed.slice(0, APARTMENT_CAPACITY)) {
      if (file.mtimeMs > quiet) continue;
      const named = censusSessionFromName(file);
      const key = named
        ? apartmentSessionKey({ harness: file.harness, session_id: named })
        : null;
      if (key && live.has(key)) continue;
      const resident = key ? known.get(key) : undefined;
      if (resident) {
        // Resumed elsewhere since: the found record follows its last write.
        if (
          resident.move_out === "found" &&
          file.mtimeMs - resident.moved_out_at > 1000
        ) {
          const update: Partial<ApartmentResident> = { ...resident };
          delete update.id;
          updates.push({
            ...(update as ApartmentMoveIn),
            moved_out_at: Math.floor(file.mtimeMs),
          });
        }
        host.done.set(file.path, file.mtimeMs);
        continue;
      }
      if (host.done.has(file.path)) continue;
      unread.push(file);
    }
    if (updates.length) await this.deps.found(updates);
    const reading = unread.slice(0, CENSUS_READS_PER_PASS);
    if (unread.length > reading.length) host.due = now + CONTINUE_MS; // The rest of a long history next.
    let batch: ApartmentMoveIn[] = [];
    for (let at = 0; at < reading.length && !this.stopped; at += READ_BATCH) {
      const group = reading.slice(at, at + READ_BATCH);
      const limit = Math.max(
        ...group.map((file) => CENSUS_PREFIX_BYTES[file.harness]),
      );
      const prefixes = await files.readPrefixes(
        group.map((file) => file.path),
        limit,
      );
      for (const file of group) {
        const prefix = prefixes.get(file.path);
        if (!prefix) continue;
        host.done.set(file.path, file.mtimeMs);
        const found = await describeCensusFile(file, prefix, files);
        const key = found ? apartmentSessionKey(found) : null;
        if (!found || !key || live.has(key)) continue;
        batch.push(foundResident(found, file, target));
      }
      if (batch.length >= WRITE_BATCH) {
        await this.deps.found(batch);
        batch = [];
      }
    }
    if (batch.length && !this.stopped) await this.deps.found(batch);
  }
}
