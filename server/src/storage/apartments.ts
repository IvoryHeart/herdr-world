import type { Database } from "bun:sqlite";
import {
  APARTMENT_CAPACITY,
  APARTMENT_LIMITS,
  APARTMENT_MOVE_OUTS,
  type ApartmentLink,
  parseApartmentAppearance,
  type ApartmentResident,
  apartmentSessionKey,
  apartmentUsageAgentIds,
} from "../../../shared/apartments";

import { newWorldId } from "./world-identifiers";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";

/**
 * Durable apartment residents (shared/apartments.ts). Each row is one
 * finished agent; writes add one resident, add residents found in harness
 * histories, add the last report one left (read after it moved in), or
 * evict some, and every write applies capacity in the same transaction.
 * One harness session is one resident: a move-in replaces a record of the
 * same session, and an eviction is remembered so history never brings
 * that session back (a later observed end does).
 */
export const apartmentsMigration = `CREATE TABLE apartment_residents (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 moved_out_at INTEGER NOT NULL CHECK(moved_out_at>=0),
 body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE INDEX apartment_residents_age ON apartment_residents(moved_out_at);`;

/** Residents keyed by session, and the sessions evicted. */
export const apartmentSessionsMigration = `ALTER TABLE apartment_residents ADD COLUMN session_key TEXT;
UPDATE apartment_residents SET session_key=coalesce(json_extract(body,'$.harness'),'')||'/'||json_extract(body,'$.session_id') WHERE json_extract(body,'$.session_id') IS NOT NULL;
CREATE INDEX apartment_residents_session ON apartment_residents(session_key);
CREATE TABLE apartment_evictions (
 session_key TEXT PRIMARY KEY NOT NULL CHECK(length(session_key)>0),
 at INTEGER NOT NULL
);
CREATE INDEX apartment_evictions_age ON apartment_evictions(at);`;

/** How many evicted sessions World remembers; the oldest are forgotten. */
const EVICTION_MEMORY = 20_000;
/** At most this many found residents per write. */
export const APARTMENT_FOUND_BATCH = 500;

export type ApartmentMoveIn = Omit<ApartmentResident, "id">;

export type ApartmentOperation =
  | { type: "move-in"; resident: ApartmentMoveIn }
  /** Asleep residents from harness histories; known or evicted ones skip. */
  | { type: "found"; residents: ApartmentMoveIn[] }
  | { type: "report"; id: string; last_report: string }
  | { type: "evict"; ids: string[] };

export type ApartmentWriteResult = {
  residents: ApartmentResident[];
  /** A move-in's new resident ID, so concurrent move-ins keep their own. */
  id?: string;
};

export type ApartmentsPort = {
  list(): ApartmentResident[];
  get(id: string): ApartmentResident | undefined;
  /** Residents' sessions (apartmentSessionKey), without copying them. */
  sessionKeys(): ReadonlySet<string>;
  moveIn(resident: ApartmentMoveIn): Promise<ApartmentResident>;
  /**
   * Residents found in harness histories. A session already resident or
   * evicted is skipped; a found one written since is brought up to date.
   */
  found(residents: readonly ApartmentMoveIn[]): Promise<void>;
  /** Adds the last report a resident left; a resident gone since is skipped. */
  report(id: string, lastReport: string): Promise<void>;
  evict(ids: readonly string[]): Promise<void>;
  close(): void;
};

const fail = (why: string): never => {
  throw new Error(`invalid apartment resident: ${why}`);
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown, field: string) =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fail(field);
/** One bounded line or paragraph; control characters other than newlines go. */
function text(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return fail(field);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips them
  const clean = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  const trimmed = clean.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function link(value: unknown): ApartmentLink {
  if (!record(value)) return fail("link");
  if (value.kind !== "pr" && value.kind !== "issue") return fail("link kind");
  if (!Number.isSafeInteger(value.number) || (value.number as number) <= 0)
    return fail("link number");
  const repo = text(value.repo, "link repo", APARTMENT_LIMITS.label);
  const url = text(value.url, "link url", APARTMENT_LIMITS.url);
  const title = text(value.title, "link title", APARTMENT_LIMITS.label);
  if (url && !/^https:\/\//.test(url)) return fail("link url");
  return {
    kind: value.kind,
    number: value.number as number,
    ...(repo ? { repo } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

/** Validates and bounds one resident (without its ID). */
export function parseApartmentMoveIn(value: unknown): ApartmentMoveIn {
  if (!record(value)) return fail("not an object");
  const name = text(value.name, "name", APARTMENT_LIMITS.name) ?? fail("name");
  const connectionId =
    text(value.connection_id, "connection", APARTMENT_LIMITS.label) ??
    fail("connection");
  const terminalId =
    text(value.terminal_id, "terminal", APARTMENT_LIMITS.label) ??
    fail("terminal");
  if (value.runtime !== "herdr" && value.runtime !== "herdr-core")
    return fail("runtime");
  if (!APARTMENT_MOVE_OUTS.includes(value.move_out as never))
    return fail("move_out");
  const links = Array.isArray(value.links) ? value.links : [];
  const seen = new Set<string>();
  return {
    name,
    harness: text(value.harness, "harness", APARTMENT_LIMITS.harness),
    cwd: text(value.cwd, "cwd", APARTMENT_LIMITS.path),
    room: text(value.room, "room", APARTMENT_LIMITS.label),
    tab: text(value.tab, "tab", APARTMENT_LIMITS.label),
    connection_id: connectionId,
    connection_label:
      text(
        value.connection_label,
        "connection label",
        APARTMENT_LIMITS.label,
      ) ?? connectionId,
    runtime: value.runtime,
    terminal_id: terminalId,
    first_seen_at: time(value.first_seen_at, "first_seen_at"),
    moved_out_at: time(value.moved_out_at, "moved_out_at"),
    move_out: value.move_out as ApartmentResident["move_out"],
    summary: text(value.summary, "summary", APARTMENT_LIMITS.text),
    last_report: text(value.last_report, "last report", APARTMENT_LIMITS.text),
    links: links
      .map(link)
      .filter((item) => {
        const key = `${item.kind}:${item.repo ?? ""}#${item.number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, APARTMENT_LIMITS.links),
    session_id: text(value.session_id, "session", APARTMENT_LIMITS.session),
    appearance: parseApartmentAppearance(value.appearance),
    usage_agent_ids: apartmentUsageAgentIds(value.usage_agent_ids),
  };
}

export function readApartments(db: Database): ApartmentResident[] {
  return (
    db
      .query("SELECT id,body FROM apartment_residents ORDER BY moved_out_at,id")
      .all() as { id: string; body: string }[]
  ).map((row) => ({
    ...parseApartmentMoveIn(JSON.parse(row.body)),
    id: row.id,
  }));
}

/** Capacity: the residents that moved out longest ago go first. */
function retain(db: Database, capacity: number) {
  db.query(
    "DELETE FROM apartment_residents WHERE id IN (SELECT id FROM apartment_residents ORDER BY moved_out_at DESC,id DESC LIMIT -1 OFFSET ?)",
  ).run(capacity);
  db.query(
    "DELETE FROM apartment_evictions WHERE session_key IN (SELECT session_key FROM apartment_evictions ORDER BY at DESC,session_key DESC LIMIT -1 OFFSET ?)",
  ).run(EVICTION_MEMORY);
}

function insert(db: Database, resident: ApartmentMoveIn): string {
  const id = newWorldId(
    "r",
    (candidate) =>
      !!db.query("SELECT 1 FROM apartment_residents WHERE id=?").get(candidate),
  );
  db.query("INSERT INTO apartment_residents VALUES(?,?,?,?)").run(
    id,
    resident.moved_out_at,
    JSON.stringify(resident),
    apartmentSessionKey(resident),
  );
  return id;
}

/** Runs inside the sole writer's transaction. */
export function writeApartments(
  db: Database,
  operation: ApartmentOperation,
  at: number,
  bounds: { capacity?: number } = {},
): ApartmentWriteResult {
  let added: string | undefined;
  if (operation.type === "move-in") {
    const resident = parseApartmentMoveIn(operation.resident);
    const key = apartmentSessionKey(resident);
    if (key) {
      // The same session moving in again (resumed and ended) is one agent,
      // and keeps the usage it was counted under before.
      const before = (
        db
          .query(
            "SELECT body FROM apartment_residents WHERE session_key=? ORDER BY moved_out_at,id",
          )
          .all(key) as { body: string }[]
      ).flatMap(
        ({ body }) =>
          (JSON.parse(body) as ApartmentMoveIn).usage_agent_ids ?? [],
      );
      resident.usage_agent_ids = apartmentUsageAgentIds([
        ...before,
        ...(resident.usage_agent_ids ?? []),
      ]);
      db.query("DELETE FROM apartment_residents WHERE session_key=?").run(key);
      db.query("DELETE FROM apartment_evictions WHERE session_key=?").run(key);
    }
    added = insert(db, resident);
  } else if (operation.type === "found") {
    if (
      !Array.isArray(operation.residents) ||
      operation.residents.length > APARTMENT_FOUND_BATCH
    )
      throw new Error("invalid apartment residents");
    for (const value of operation.residents) {
      const resident = parseApartmentMoveIn(value);
      const key = apartmentSessionKey(resident);
      if (!key || resident.move_out !== "found") continue;
      if (
        db
          .query("SELECT 1 FROM apartment_evictions WHERE session_key=?")
          .get(key)
      )
        continue;
      const known = db
        .query(
          "SELECT id,moved_out_at,body FROM apartment_residents WHERE session_key=?",
        )
        .get(key) as { id: string; moved_out_at: number; body: string } | null;
      if (!known) {
        insert(db, resident);
        continue;
      }
      // Only a found record follows its transcript's later writes.
      const before = JSON.parse(known.body) as ApartmentMoveIn;
      if (
        before.move_out === "found" &&
        resident.moved_out_at > known.moved_out_at
      )
        db.query(
          "UPDATE apartment_residents SET moved_out_at=?,body=? WHERE id=?",
        ).run(
          resident.moved_out_at,
          JSON.stringify({
            ...resident,
            summary: before.summary ?? resident.summary,
            // Usage World counted for the session is kept (#1101).
            usage_agent_ids: apartmentUsageAgentIds([
              ...(before.usage_agent_ids ?? []),
              ...(resident.usage_agent_ids ?? []),
            ]),
          }),
          known.id,
        );
    }
  } else if (operation.type === "report") {
    const row =
      typeof operation.id === "string"
        ? (db
            .query("SELECT body FROM apartment_residents WHERE id=?")
            .get(operation.id) as { body: string } | null)
        : null;
    if (row) {
      const resident = parseApartmentMoveIn({
        ...JSON.parse(row.body),
        last_report: operation.last_report,
      });
      db.query("UPDATE apartment_residents SET body=? WHERE id=?").run(
        JSON.stringify(resident),
        operation.id,
      );
    }
  } else if (operation.type === "evict") {
    if (!Array.isArray(operation.ids) || operation.ids.length > 1000)
      throw new Error("invalid apartment eviction");
    const find = db.query(
      "SELECT session_key FROM apartment_residents WHERE id=?",
    );
    const remember = db.query(
      "INSERT OR REPLACE INTO apartment_evictions VALUES(?,?)",
    );
    const remove = db.query("DELETE FROM apartment_residents WHERE id=?");
    for (const id of operation.ids) {
      if (typeof id !== "string") throw new Error("invalid apartment eviction");
      const key = (find.get(id) as { session_key: string | null } | null)
        ?.session_key;
      if (key) remember.run(key, at);
      remove.run(id);
    }
  } else throw new Error("unknown apartment operation");
  retain(db, bounds.capacity ?? APARTMENT_CAPACITY);
  return { residents: readApartments(db), ...(added ? { id: added } : {}) };
}

/** The cached port the service reads; every write returns the whole list. */
export function createApartmentsPort(
  initial: readonly ApartmentResident[],
  request: <T>(operation: StorageRequest) => Promise<T>,
): ApartmentsPort {
  let residents = structuredClone([...initial]);
  const keysOf = (list: readonly ApartmentResident[]) =>
    new Set(
      list.map(apartmentSessionKey).filter((key): key is string => !!key),
    );
  let keys = keysOf(residents);
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const write = (operation: ApartmentOperation) => {
    const run = async () => {
      if (closed) throw new StorageWriteRejected("World storage is closed");
      const result = await request<ApartmentWriteResult>({
        type: "apartments",
        operation,
      });
      residents = result.residents;
      keys = keysOf(residents);
      return result;
    };
    const task = queue.then(run, run);
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    list: () => structuredClone(residents),
    sessionKeys: () => keys,
    get: (id) => {
      const found = residents.find((resident) => resident.id === id);
      return found && structuredClone(found);
    },
    async moveIn(resident) {
      // The writer names the row it added: a list diff taken before the
      // queued write would also see a concurrent move-in's row.
      const result = await write({ type: "move-in", resident });
      const added = result.id
        ? result.residents.find((item) => item.id === result.id)
        : undefined;
      if (!added) throw new Error("The resident moved out at once");
      return structuredClone(added);
    },
    async found(found) {
      for (let at = 0; at < found.length; at += APARTMENT_FOUND_BATCH)
        await write({
          type: "found",
          residents: found.slice(at, at + APARTMENT_FOUND_BATCH),
        });
    },
    async report(id, lastReport) {
      await write({ type: "report", id, last_report: lastReport });
    },
    async evict(ids) {
      await write({ type: "evict", ids: [...ids] });
    },
    close: () => {
      closed = true;
    },
  };
}

/** The same rules in memory, for tests and the preview fixture. */
export function memoryApartmentsPort(
  initial: readonly ApartmentResident[] = [],
  now: () => number,
  bounds: { capacity?: number } = {},
): ApartmentsPort {
  let rows = structuredClone([...initial]);
  const evicted = new Set<string>();
  let next = 1;
  const add = (resident: ApartmentMoveIn) => {
    const id = `r-memory${next++}`;
    rows.push({ ...resident, id });
    return id;
  };
  return createApartmentsPort(initial, async <T>(op: StorageRequest) => {
    if (op.type !== "apartments") throw new Error("unexpected request");
    const operation = op.operation;
    let added: string | undefined;
    if (operation.type === "move-in") {
      const resident = parseApartmentMoveIn(operation.resident);
      const key = apartmentSessionKey(resident);
      if (key) {
        resident.usage_agent_ids = apartmentUsageAgentIds([
          ...rows
            .filter((row) => apartmentSessionKey(row) === key)
            .sort((a, b) => a.moved_out_at - b.moved_out_at)
            .flatMap((row) => row.usage_agent_ids ?? []),
          ...(resident.usage_agent_ids ?? []),
        ]);
        rows = rows.filter((row) => apartmentSessionKey(row) !== key);
        evicted.delete(key);
      }
      added = add(resident);
    } else if (operation.type === "found") {
      for (const value of operation.residents) {
        const resident = parseApartmentMoveIn(value);
        const key = apartmentSessionKey(resident);
        if (!key || resident.move_out !== "found" || evicted.has(key)) continue;
        const known = rows.find((row) => apartmentSessionKey(row) === key);
        if (!known) add(resident);
        else if (
          known.move_out === "found" &&
          resident.moved_out_at > known.moved_out_at
        )
          Object.assign(known, resident, {
            summary: known.summary ?? resident.summary,
            usage_agent_ids: apartmentUsageAgentIds([
              ...(known.usage_agent_ids ?? []),
              ...(resident.usage_agent_ids ?? []),
            ]),
          });
      }
    } else if (operation.type === "report") {
      rows = rows.map((row) =>
        row.id === operation.id
          ? {
              ...parseApartmentMoveIn({
                ...row,
                last_report: operation.last_report,
              }),
              id: row.id,
            }
          : row,
      );
    } else {
      const ids = new Set(operation.ids);
      for (const row of rows) {
        const key = ids.has(row.id) ? apartmentSessionKey(row) : null;
        if (key) evicted.add(key);
      }
      rows = rows.filter((row) => !ids.has(row.id));
    }
    void now;
    rows = rows
      .sort(
        (a, b) => b.moved_out_at - a.moved_out_at || b.id.localeCompare(a.id),
      )
      .slice(0, bounds.capacity ?? APARTMENT_CAPACITY)
      .reverse();
    return {
      residents: structuredClone(rows),
      ...(added ? { id: added } : {}),
    } as T;
  });
}
