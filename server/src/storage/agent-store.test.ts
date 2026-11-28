import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import { worldMigrations } from "./world-schema";
import type { AgentStoreOperation, AgentWriteResult } from "./agent-store";
import { agentFields, setAgentFact } from "./agent-store";
import type { AgentObservation, AgentOccupant } from "../world/agent-resolver";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fresh() {
  const root = mkdtempSync(join(tmpdir(), "agent-store-"));
  roots.push(root);
  const database = join(root, "world.sqlite");
  const open = () =>
    openWorldWriter(database, join(root, "ledger.json"), 1000, "synthetic");
  return { database, open };
}
type Writer = ReturnType<ReturnType<typeof fresh>["open"]>;
function write(writer: Writer, operation: AgentStoreOperation, at = 2000) {
  const [result] = writer.batch(
    [{ ticket: 0, request: { type: "agents", operation } }],
    at,
  );
  expect(result!.error).toBeUndefined();
  return (result!.result as AgentWriteResult).changed;
}
const occupant = (
  terminal_id: string,
  conversation: string | null = null,
): AgentOccupant => ({
  terminal_id,
  harness: "claude",
  folder: "/work/synthetic",
  conversation,
  source: conversation ? "herdr:claude" : null,
});
const observe = (
  writer: Writer,
  terminals: string[],
  occupants: AgentOccupant[],
  at = 2000,
  generation = 1,
) =>
  write(
    writer,
    {
      type: "observe",
      adapter: "herdr",
      observation: {
        connection_id: "studio",
        generation,
        terminals,
        occupants,
      } satisfies AgentObservation,
    },
    at,
  );
const query = <T>(database: string, sql: string) => {
  const db = new Database(database, { readonly: true });
  try {
    return db.query(sql).all() as T[];
  } finally {
    db.close();
  }
};

test("the migration adds only entities and facts, at the next version", () => {
  const { database, open } = fresh();
  open().close();
  const tables = query<{ name: string }>(
    database,
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities','facts','agent_conversations')",
  ).map((row) => row.name);
  expect(tables.sort()).toEqual(["entities", "facts"]);
  expect(
    query<{ user_version: number }>(database, "PRAGMA user_version")[0]!
      .user_version,
  ).toBe(worldMigrations.length);
  expect(
    query<{ name: string }>(
      database,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='facts_field_item'",
    ),
  ).toHaveLength(1);
});

test("an observed agent keeps its ID across a writer restart and a new conversation", () => {
  const { database, open } = fresh();
  let writer = open();
  const [created] = observe(writer, ["t1"], [occupant("t1", "claude/c1")]);
  expect(created!.id).toMatch(/^a-[0-9a-z]{8}$/);
  expect(created!.seat).toMatchObject({
    connection_id: "studio",
    terminal_id: "t1",
  });
  writer.close();

  writer = open();
  expect(writer.read().agents!.map((agent) => agent.id)).toEqual([created!.id]);
  // Seen again after the restart: nothing to write.
  expect(observe(writer, ["t1"], [occupant("t1", "claude/c1")], 3000)).toEqual(
    [],
  );
  // /clear in place: same agent, the old conversation goes to history.
  const [same] = observe(writer, ["t1"], [occupant("t1", "claude/c2")], 4000);
  expect(same!.id).toBe(created!.id);
  expect(same!.conversation).toBe("claude/c2");
  writer.close();

  const history = query<{ item: string; value: string }>(
    database,
    "SELECT item,value FROM facts WHERE field='conversation' ORDER BY item",
  ).map((row) => ({ item: row.item, ...JSON.parse(row.value) }));
  expect(history).toEqual([
    {
      item: "claude/c1",
      connection_id: "studio",
      source: "herdr:claude",
      first_seen: 2000,
      last_seen: 4000,
    },
    {
      item: "claude/c2",
      connection_id: "studio",
      source: "herdr:claude",
      first_seen: 4000,
      last_seen: null,
    },
  ]);
  const seat = query<{ body: string }>(
    database,
    "SELECT body FROM world_bindings",
  ).map((row) => JSON.parse(row.body));
  expect(seat).toMatchObject([
    { policy: "seat", record_id: created!.id, state: "attached" },
  ]);
});

test("a closed terminal leaves an agent away, or ends it with nothing to resume; rows stay", () => {
  const { database, open } = fresh();
  const writer = open();
  const created = observe(
    writer,
    ["t1", "t2"],
    [occupant("t1", "claude/c1"), occupant("t2")],
  );
  expect(created).toHaveLength(2);
  const changed = observe(writer, [], [], 3000);
  const byTerminal = new Map(
    created.map((agent) => [agent.seat!.terminal_id, agent.id]),
  );
  const away = changed.find((agent) => agent.id === byTerminal.get("t1"))!;
  const ended = changed.find((agent) => agent.id === byTerminal.get("t2"))!;
  expect(away).toMatchObject({ ended_at: null, seat: null });
  expect(ended).toMatchObject({ ended_at: 3000, seat: null });
  expect(writer.read().agents!.map((agent) => agent.id)).toEqual([away.id]);
  // An ended agent never returns: the same terminal gets a new agent.
  const [next] = observe(writer, ["t2"], [occupant("t2")], 4000);
  expect(next!.id).not.toBe(ended.id);
  writer.close();
  expect(
    query<{ n: number }>(database, "SELECT count(*) AS n FROM entities")[0]!.n,
  ).toBe(3);
  expect(
    query<{ state: string }>(
      database,
      "SELECT json_extract(body,'$.state') AS state FROM world_bindings ORDER BY id",
    )
      .map((row) => row.state)
      .sort(),
  ).toEqual(["attached", "ended", "ended"]);
});

test("a duplicate listing binds, moves and ends nothing", () => {
  const { open } = fresh();
  const writer = open();
  observe(writer, ["t1"], [occupant("t1", "claude/c1")]);
  expect(observe(writer, ["t1", "t1"], [], 3000)).toEqual([]);
  expect(writer.read().agents![0]!.seat).not.toBeNull();
  writer.close();
});

test("End is final and keeps the record", () => {
  const { database, open } = fresh();
  const writer = open();
  const [created] = observe(writer, ["t1"], [occupant("t1", "claude/c1")]);
  const [ended] = write(writer, { type: "end", agent: created!.id }, 3000);
  expect(ended).toMatchObject({ ended_at: 3000, seat: null });
  expect(writer.read().agents).toEqual([]);
  // Still running in its terminal: World admits a new agent, never the ended one.
  const [next] = observe(writer, ["t1"], [occupant("t1", "claude/c1")], 4000);
  expect(next!.id).not.toBe(created!.id);
  writer.close();
  expect(
    query<{ id: string }>(
      database,
      "SELECT id FROM entities ORDER BY created_at",
    ).length,
  ).toBe(2);
});

test("facts refuse undeclared fields and values over the limit", () => {
  const { database, open } = fresh();
  const writer = open();
  const [created] = observe(writer, ["t1"], [occupant("t1")]);
  writer.close();
  const db = new Database(database);
  try {
    expect(() =>
      setAgentFact(db, created!.id, "colour" as never, "", "red", 1),
    ).toThrow("undeclared agent field");
    expect(() =>
      setAgentFact(db, created!.id, "folder", "", "x".repeat(5000), 1),
    ).toThrow("larger than");
  } finally {
    db.close();
  }
  expect(Object.values(agentFields).map((field) => field.owner)).toEqual([
    "observed",
    "observed",
    "observed",
    "observed",
  ]);
});
