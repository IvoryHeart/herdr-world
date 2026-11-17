import { isLocalCoreAddress } from "../../../shared/coreAddress";
import type { Database } from "bun:sqlite";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";
import {
  CORE_TOPOLOGY_LIMITS,
  type CoreRoomCheckout,
  type CoreTopologyDocument,
  type CoreTopologyPort,
} from "../herdr-core/layout";

export {
  CORE_TOPOLOGY_LIMITS,
  type CoreTopologyDocument,
  type CoreTopologyPort,
  type CoreTopologyRoom,
  type CoreTopologyTab,
} from "../herdr-core/layout";

export class CoreTopologyConflict extends Error {
  constructor() {
    super("World's layout of this core changed; try again");
    this.name = "CoreTopologyConflict";
  }
}

export const coreTopologyMigration = `CREATE TABLE core_topology (
 core_id TEXT PRIMARY KEY NOT NULL CHECK(length(core_id)>0),
 revision INTEGER NOT NULL CHECK(revision>=1),
 body TEXT NOT NULL CHECK(json_valid(body))
);`;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CORE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** An absolute path on the core's host, one line, bounded. */
const HOST_PATH = /^\/[^\0\r\n]{0,4095}$/;

export function emptyCoreTopology(coreId: string): CoreTopologyDocument {
  return { core_id: coreId, revision: 0, rooms: [] };
}

/** Validates a whole document; every write replaces the last. */
export function parseCoreTopology(value: unknown): CoreTopologyDocument {
  const fail = (why: string): never => {
    throw new Error(`invalid core topology: ${why}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("not an object");
  const doc = value as Record<string, unknown>;
  if (typeof doc.core_id !== "string" || !CORE_ID.test(doc.core_id))
    fail("core_id");
  if (!Number.isSafeInteger(doc.revision) || (doc.revision as number) < 0)
    fail("revision");
  if (!Array.isArray(doc.rooms)) fail("rooms");
  const rooms = doc.rooms as unknown[];
  if (rooms.length > CORE_TOPOLOGY_LIMITS.rooms) fail("too many rooms");
  const ids = new Set<string>();
  const placed = new Set<string>();
  const spaces = new Set<string>();
  const checkouts = new Set<string>();
  let tabs = 0;
  const parsed = rooms.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("room");
    const room = value as Record<string, unknown>;
    if (typeof room.id !== "string" || !ID.test(room.id) || ids.has(room.id))
      fail("room id");
    ids.add(room.id as string);
    if (
      typeof room.label !== "string" ||
      room.label.length > CORE_TOPOLOGY_LIMITS.label
    )
      fail("room label");
    if (room.app_space !== undefined) {
      if (
        typeof room.app_space !== "string" ||
        !room.app_space ||
        room.app_space.length > 128 ||
        spaces.has(room.app_space)
      )
        fail("app space");
      spaces.add(room.app_space as string);
    }
    let checkout: CoreRoomCheckout | undefined;
    if (room.checkout !== undefined) {
      const value = (
        room.checkout && typeof room.checkout === "object" ? room.checkout : {}
      ) as Record<string, unknown>;
      if (
        Array.isArray(room.checkout) ||
        room.app_space !== undefined ||
        typeof value.path !== "string" ||
        !HOST_PATH.test(value.path) ||
        typeof value.source !== "string" ||
        !HOST_PATH.test(value.source) ||
        checkouts.has(value.path) ||
        (value.branch !== undefined &&
          (typeof value.branch !== "string" ||
            !value.branch ||
            value.branch.length > 255 ||
            /[\0\r\n]/.test(value.branch)))
      )
        fail("checkout");
      checkouts.add(value.path as string);
      checkout = {
        path: value.path as string,
        source: value.source as string,
        ...(value.branch !== undefined
          ? { branch: value.branch as string }
          : {}),
      };
    }
    if (!Array.isArray(room.tabs)) fail("tabs");
    return {
      id: room.id as string,
      label: room.label as string,
      ...(room.app_space !== undefined
        ? { app_space: room.app_space as string }
        : {}),
      ...(checkout ? { checkout } : {}),
      tabs: (room.tabs as unknown[]).map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          fail("tab");
        const tab = value as Record<string, unknown>;
        if (typeof tab.id !== "string" || !ID.test(tab.id) || ids.has(tab.id))
          fail("tab id");
        ids.add(tab.id as string);
        if (
          typeof tab.label !== "string" ||
          tab.label.length > CORE_TOPOLOGY_LIMITS.label
        )
          fail("tab label");
        if (++tabs > CORE_TOPOLOGY_LIMITS.tabs) fail("too many tabs");
        if (!Array.isArray(tab.terminals)) fail("terminals");
        const terminals = (tab.terminals as unknown[]).map((address) => {
          if (
            typeof address !== "string" ||
            !isLocalCoreAddress(address) ||
            placed.has(address)
          )
            fail("terminal");
          placed.add(address as string);
          return address as string;
        });
        if (placed.size > CORE_TOPOLOGY_LIMITS.terminals)
          fail("too many terminals");
        return { id: tab.id as string, label: tab.label as string, terminals };
      }),
    };
  });
  const result = {
    core_id: doc.core_id as string,
    revision: doc.revision as number,
    rooms: parsed,
  };
  if (JSON.stringify(result).length > CORE_TOPOLOGY_LIMITS.bytes)
    fail("too large");
  return result;
}

export function readCoreTopologies(db: Database): CoreTopologyDocument[] {
  return (
    db.query("SELECT body FROM core_topology ORDER BY core_id").all() as {
      body: string;
    }[]
  ).map((row) => parseCoreTopology(JSON.parse(row.body)));
}

/** Compare-and-set: `expected` is the revision the change was made from. */
export function writeCoreTopology(
  db: Database,
  expected: number,
  value: unknown,
): CoreTopologyDocument {
  const next = parseCoreTopology(value);
  const row = db
    .query("SELECT revision FROM core_topology WHERE core_id=?")
    .get(next.core_id) as { revision: number } | null;
  if ((row?.revision ?? 0) !== expected) throw new CoreTopologyConflict();
  const saved = { ...next, revision: expected + 1 };
  db.query(
    `INSERT INTO core_topology VALUES(?,?,?) ON CONFLICT(core_id) DO UPDATE SET revision=excluded.revision, body=excluded.body`,
  ).run(saved.core_id, saved.revision, JSON.stringify(saved));
  return saved;
}

export function createCoreTopologyPort(
  initial: readonly CoreTopologyDocument[],
  request: <T>(operation: StorageRequest) => Promise<T>,
): CoreTopologyPort {
  const cache = new Map(initial.map((doc) => [doc.core_id, doc]));
  const queues = new Map<string, Promise<unknown>>();
  let closed = false;
  const get = (coreId: string) =>
    structuredClone(cache.get(coreId) ?? emptyCoreTopology(coreId));
  return {
    get,
    update(coreId, change) {
      const run = async () => {
        if (closed) throw new StorageWriteRejected("World storage is closed");
        const current = get(coreId);
        const next = change(structuredClone(current));
        if (!next) return current;
        const saved = await request<CoreTopologyDocument>({
          type: "core-topology",
          expected: current.revision,
          document: { ...next, core_id: coreId },
        });
        cache.set(coreId, saved);
        return structuredClone(saved);
      };
      const previous = queues.get(coreId) ?? Promise.resolve();
      const task = previous.then(run, run);
      queues.set(
        coreId,
        task.catch(() => undefined),
      );
      return task;
    },
    close: () => {
      closed = true;
    },
  };
}

/** An in-memory port with the same rules, for tests and the preview fixture. */
export function memoryCoreTopologyPort(
  initial: readonly CoreTopologyDocument[] = [],
): CoreTopologyPort {
  const rows = new Map(initial.map((doc) => [doc.core_id, doc]));
  return createCoreTopologyPort(initial, async <T>(op: StorageRequest) => {
    if (op.type !== "core-topology") throw new Error("unexpected request");
    const next = parseCoreTopology(op.document);
    const current = rows.get(next.core_id)?.revision ?? 0;
    if (current !== op.expected) throw new CoreTopologyConflict();
    const saved = { ...next, revision: current + 1 };
    rows.set(saved.core_id, saved);
    return structuredClone(saved) as T;
  });
}
