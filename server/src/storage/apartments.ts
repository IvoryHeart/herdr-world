import type { Database } from "bun:sqlite";
import {
  APARTMENT_CAPACITY,
  APARTMENT_LIMITS,
  APARTMENT_RETENTION_MS,
  type ApartmentLink,
  type ApartmentResident,
} from "../../../shared/apartments";
import { newWorldId } from "./world-identifiers";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";

/**
 * Durable apartment residents (shared/apartments.ts). Each row is one
 * finished agent; writes add one resident or evict some, and every write
 * applies retention (age, then capacity) in the same transaction.
 */
export const apartmentsMigration = `CREATE TABLE apartment_residents (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 moved_out_at INTEGER NOT NULL CHECK(moved_out_at>=0),
 body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE INDEX apartment_residents_age ON apartment_residents(moved_out_at);`;

export type ApartmentMoveIn = Omit<ApartmentResident, "id">;

export type ApartmentOperation =
  | { type: "move-in"; resident: ApartmentMoveIn }
  | { type: "evict"; ids: string[] };

export type ApartmentWriteResult = {
  residents: ApartmentResident[];
};

export type ApartmentsPort = {
  list(): ApartmentResident[];
  get(id: string): ApartmentResident | undefined;
  moveIn(resident: ApartmentMoveIn): Promise<ApartmentResident>;
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
  if (value.move_out !== "ended" && value.move_out !== "retired")
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
    move_out: value.move_out,
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

/** Age, then capacity: the oldest residents move out first. */
function retain(db: Database, at: number, capacity: number, retention: number) {
  db.query("DELETE FROM apartment_residents WHERE moved_out_at<?").run(
    at - retention,
  );
  db.query(
    "DELETE FROM apartment_residents WHERE id IN (SELECT id FROM apartment_residents ORDER BY moved_out_at DESC,id DESC LIMIT -1 OFFSET ?)",
  ).run(capacity);
}

/** Runs inside the sole writer's transaction. */
export function writeApartments(
  db: Database,
  operation: ApartmentOperation,
  at: number,
  bounds: { capacity?: number; retention_ms?: number } = {},
): ApartmentWriteResult {
  if (operation.type === "move-in") {
    const resident = parseApartmentMoveIn(operation.resident);
    const id = newWorldId(
      "r",
      (candidate) =>
        !!db
          .query("SELECT 1 FROM apartment_residents WHERE id=?")
          .get(candidate),
    );
    db.query("INSERT INTO apartment_residents VALUES(?,?,?)").run(
      id,
      resident.moved_out_at,
      JSON.stringify(resident),
    );
  } else if (operation.type === "evict") {
    if (!Array.isArray(operation.ids) || operation.ids.length > 1000)
      throw new Error("invalid apartment eviction");
    const remove = db.query("DELETE FROM apartment_residents WHERE id=?");
    for (const id of operation.ids) {
      if (typeof id !== "string") throw new Error("invalid apartment eviction");
      remove.run(id);
    }
  } else throw new Error("unknown apartment operation");
  retain(
    db,
    at,
    bounds.capacity ?? APARTMENT_CAPACITY,
    bounds.retention_ms ?? APARTMENT_RETENTION_MS,
  );
  return { residents: readApartments(db) };
}

/** The cached port the service reads; every write returns the whole list. */
export function createApartmentsPort(
  initial: readonly ApartmentResident[],
  request: <T>(operation: StorageRequest) => Promise<T>,
): ApartmentsPort {
  let residents = structuredClone([...initial]);
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
      return result;
    };
    const task = queue.then(run, run);
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    list: () => structuredClone(residents),
    get: (id) => {
      const found = residents.find((resident) => resident.id === id);
      return found && structuredClone(found);
    },
    async moveIn(resident) {
      const before = new Set(residents.map((item) => item.id));
      const result = await write({ type: "move-in", resident });
      const added = result.residents.find((item) => !before.has(item.id));
      if (!added) throw new Error("The resident moved out at once");
      return structuredClone(added);
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
  bounds: { capacity?: number; retention_ms?: number } = {},
): ApartmentsPort {
  let rows = structuredClone([...initial]);
  let next = 1;
  return createApartmentsPort(initial, async <T>(op: StorageRequest) => {
    if (op.type !== "apartments") throw new Error("unexpected request");
    const operation = op.operation;
    if (operation.type === "move-in") {
      const resident = parseApartmentMoveIn(operation.resident);
      rows.push({ ...resident, id: `r-memory${next++}` });
    } else {
      const evicted = new Set(operation.ids);
      rows = rows.filter((row) => !evicted.has(row.id));
    }
    const at = now();
    rows = rows
      .filter(
        (row) =>
          row.moved_out_at >=
          at - (bounds.retention_ms ?? APARTMENT_RETENTION_MS),
      )
      .sort(
        (a, b) => b.moved_out_at - a.moved_out_at || b.id.localeCompare(a.id),
      )
      .slice(0, bounds.capacity ?? APARTMENT_CAPACITY)
      .reverse();
    return { residents: structuredClone(rows) } as T;
  });
}
