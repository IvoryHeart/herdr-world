import type { Database } from "bun:sqlite";
import { declareData } from "./catalog";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";
import type { createBindingWriter } from "./world-bindings";
import type { createWorldIds } from "./world-ids";
import {
  resolveAgentObservation,
  type AgentObservation,
  type AgentRecord,
} from "../world/agent-resolver";
import type {
  BindingEvent,
  BindingFence,
  BindingResolution,
  SourceBinding,
} from "../world/binding-types";

/**
 * The agent record (openspec world-agent-identity, design §4): one
 * `entities` row per agent and one `facts` row per field and item. Rows are
 * never deleted or trimmed; an agent ends by `ended_at`. Its seat is a
 * `seat` binding in `world_bindings`, and its ID comes from `world_ids`.
 */
export const agentStoreMigration = `CREATE TABLE entities (
 id TEXT PRIMARY KEY NOT NULL REFERENCES world_ids(id),
 kind TEXT NOT NULL CHECK(kind IN ('agent')),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 ended_at INTEGER CHECK(ended_at IS NULL OR ended_at>=created_at)
);
CREATE TABLE facts (
 entity_id TEXT NOT NULL REFERENCES entities(id),
 field TEXT NOT NULL CHECK(length(field)>0),
 item TEXT NOT NULL DEFAULT '',
 value TEXT NOT NULL CHECK(json_valid(value) AND length(value)<=4096),
 revision INTEGER NOT NULL CHECK(revision>=1),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(entity_id,field,item)
) WITHOUT ROWID;
CREATE INDEX facts_field_item ON facts(field,item);`;

/** A fact value's largest JSON text, in bytes (the `facts` check). */
const FACT_VALUE_LIMIT = 4096;

const text = (body: unknown) => {
  if (typeof body !== "string" || !body) throw new Error("expected text");
  return body;
};
const optionalText = (body: unknown) => (body === null ? null : text(body));
const observed = (name: string, validate: (body: unknown) => unknown) =>
  declareData({
    feature: "agents",
    name,
    kind: "fact",
    owner: "observed",
    source: "runtime",
    validate,
    limit: null,
    lifetime: "native",
    syncScope: ["world"],
  });

/**
 * Every field an agent fact may hold, each with its one owner. A field is
 * declared by the World-as-one step that moves it, never ahead of it.
 * @internal exported for the store test.
 */
export const agentFields = {
  /** The harness kind seen in its seat. A label, never identity. */
  harness: observed("harness", text),
  /** The folder its harness runs in, last known. */
  folder: observed("folder", optionalText),
  /** One item per conversation, keyed `<harness>/<conversation ID>`. */
  conversation: {
    ...observed("conversation", (body) => {
      const value = body as Record<string, unknown> | null;
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.connection_id !== "string" ||
        typeof value.first_seen !== "number"
      )
        throw new Error("expected a conversation entry");
      return value;
    }),
    source: "harness",
  },
  /** The conversation item it runs now, or null. */
  "conversation.current": {
    ...observed("conversation.current", optionalText),
    source: "harness",
  },
} as const;
type AgentField = keyof typeof agentFields;

export type AgentStoreOperation =
  /** A complete, current listing of one connection, read by `adapter`. */
  | { type: "observe"; adapter: string; observation: AgentObservation }
  /** The user's End: final, the record stays. */
  | { type: "end"; agent: string };

export type AgentWriteResult = {
  /** Every record this write changed, ended ones included. */
  changed: AgentRecord[];
};

type Stores = {
  ids: ReturnType<typeof createWorldIds>;
  bindings: ReturnType<typeof createBindingWriter>;
  incarnation: string;
};

function factRows(db: Database, id: string) {
  return db
    .query("SELECT field,item,value FROM facts WHERE entity_id=?")
    .all(id) as { field: string; item: string; value: string }[];
}

function seatOf(db: Database, id: string): AgentRecord["seat"] {
  const rows = db
    .query(
      "SELECT body FROM world_bindings WHERE record_id=? AND json_extract(body,'$.policy')='seat' AND json_extract(body,'$.state')<>'ended' ORDER BY id",
    )
    .all(id) as { body: string }[];
  const [binding] = rows.map((row) => JSON.parse(row.body) as SourceBinding);
  return binding
    ? {
        binding_id: binding.id,
        connection_id: binding.instance,
        terminal_id: binding.native_id,
      }
    : null;
}

function readAgent(db: Database, id: string): AgentRecord | null {
  const row = db
    .query(
      "SELECT id,created_at,ended_at FROM entities WHERE id=? AND kind='agent'",
    )
    .get(id) as Pick<AgentRecord, "id" | "created_at" | "ended_at"> | null;
  if (!row) return null;
  const facts = new Map(
    factRows(db, id)
      .filter((fact) => fact.item === "")
      .map((fact) => [fact.field, JSON.parse(fact.value) as unknown]),
  );
  return {
    ...row,
    harness: String(facts.get("harness") ?? ""),
    folder: (facts.get("folder") as string | null | undefined) ?? null,
    conversation:
      (facts.get("conversation.current") as string | null | undefined) ?? null,
    seat: row.ended_at === null ? seatOf(db, id) : null,
  };
}

/** Agents not ended, oldest first; ended records stay in the store. */
export function readAgents(db: Database): AgentRecord[] {
  return (
    db
      .query(
        "SELECT id FROM entities WHERE kind='agent' AND ended_at IS NULL ORDER BY created_at,id",
      )
      .all() as { id: string }[]
  ).flatMap((row) => readAgent(db, row.id) ?? []);
}

/**
 * Sets one declared fact; an unchanged value writes nothing.
 * @internal exported for the store test.
 */
export function setAgentFact(
  db: Database,
  agent: string,
  field: AgentField,
  item: string,
  value: unknown,
  at: number,
) {
  const declared = agentFields[field];
  if (!declared) throw new Error(`undeclared agent field: ${String(field)}`);
  declared.validate(value);
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > FACT_VALUE_LIMIT)
    throw new Error(`agent ${field} is larger than ${FACT_VALUE_LIMIT} bytes`);
  db.query(
    `INSERT INTO facts(entity_id,field,item,value,revision,updated_at) VALUES(?,?,?,?,1,?)
     ON CONFLICT(entity_id,field,item) DO UPDATE SET value=excluded.value,
     revision=facts.revision+1, updated_at=excluded.updated_at
     WHERE facts.value IS NOT excluded.value`,
  ).run(agent, field, item, body, at);
}

/** An observed label (harness kind or folder), last known. */
function setAgentLabel(
  db: Database,
  agent: string,
  field: "harness" | "folder",
  value: string | null,
  at: number,
) {
  setAgentFact(db, agent, field, "", value, at);
}

/**
 * Makes `item` the agent's current conversation. A new item joins its
 * history; the one it leaves keeps its entry, closed by `last_seen`.
 */
function appendConversation(
  db: Database,
  agent: string,
  item: string | null,
  connectionId: string,
  source: string | null,
  at: number,
) {
  const previous = readAgent(db, agent)?.conversation ?? null;
  if (previous === item) return;
  const entry = (key: string) => {
    const row = db
      .query(
        "SELECT value FROM facts WHERE entity_id=? AND field='conversation' AND item=?",
      )
      .get(agent, key) as { value: string } | null;
    return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
  };
  if (previous) {
    const left = entry(previous);
    if (left)
      setAgentFact(
        db,
        agent,
        "conversation",
        previous,
        { ...left, last_seen: at },
        at,
      );
  }
  if (item) {
    const known = entry(item);
    setAgentFact(
      db,
      agent,
      "conversation",
      item,
      known
        ? { ...known, last_seen: null }
        : {
            connection_id: connectionId,
            source,
            first_seen: at,
            last_seen: null,
          },
      at,
    );
  }
  setAgentFact(db, agent, "conversation.current", "", item, at);
}

/** A new agent seated in `terminal`; its ID is never reused. */
function createAgent(
  db: Database,
  stores: Stores,
  seat: { adapter: string; connection_id: string; terminal_id: string },
  labels: { harness: string; folder: string | null },
  at: number,
): string {
  const id = stores.ids.issue("a");
  db.query(
    "INSERT INTO entities(id,kind,created_at,ended_at) VALUES(?,'agent',?,NULL)",
  ).run(id, at);
  setAgentLabel(db, id, "harness", labels.harness, at);
  setAgentLabel(db, id, "folder", labels.folder, at);
  stores.bindings.execute(
    {
      type: "create",
      input: {
        record_id: id,
        slot: "seat/1",
        policy: "seat",
        adapter: seat.adapter,
        instance: seat.connection_id,
        kind: "terminal",
        native_id: seat.terminal_id,
        evidence: { terminals: [seat.terminal_id] },
      },
    },
    at,
  );
  return id;
}

/** Applies a binding event to an agent's seat binding. */
function resolveSeat(
  db: Database,
  stores: Stores,
  agent: string,
  event: BindingEvent,
  current: BindingFence | null,
  at: number,
) {
  const seat = seatOf(db, agent);
  if (!seat) return null;
  const saved = stores.bindings.execute(
    { type: "get", id: seat.binding_id },
    at,
  ) as SourceBinding;
  return stores.bindings.execute(
    {
      type: "resolve",
      id: saved.id,
      event,
      current,
      expectedRevision: saved.revision,
    },
    at,
  ) as BindingResolution | null;
}

/** Final: the record stays, its seat binding ends, it never returns. */
function endAgent(db: Database, stores: Stores, agent: string, at: number) {
  const record = readAgent(db, agent);
  if (!record) throw new Error(`unknown agent: ${agent}`);
  if (record.ended_at !== null) return;
  resolveSeat(db, stores, agent, { type: "user-detach" }, null, at);
  closeConversation(db, record, at);
  db.query("UPDATE entities SET ended_at=? WHERE id=?").run(at, agent);
}

function closeConversation(db: Database, record: AgentRecord, at: number) {
  if (!record.conversation) return;
  const row = db
    .query(
      "SELECT value FROM facts WHERE entity_id=? AND field='conversation' AND item=?",
    )
    .get(record.id, record.conversation) as { value: string } | null;
  if (row)
    setAgentFact(
      db,
      record.id,
      "conversation",
      record.conversation,
      { ...JSON.parse(row.value), last_seen: at },
      at,
    );
}

/**
 * One complete listing, resolved against the stored agents in the writer's
 * transaction. The seat bindings take the same listing, so a seat attaches
 * and ends by its declared policy, in agreement with the resolver.
 */
function observe(
  db: Database,
  stores: Stores,
  operation: Extract<AgentStoreOperation, { type: "observe" }>,
  at: number,
): string[] {
  const { adapter, observation } = operation;
  const changes = resolveAgentObservation(readAgents(db), observation);
  if (!changes.length) return [];
  const fence: BindingFence = {
    adapter,
    instance: observation.connection_id,
    service_incarnation: stores.incarnation,
    generation: observation.generation,
  };
  const occupant = new Map(
    observation.occupants.map((each) => [each.terminal_id, each]),
  );
  const listing = (harness: string): BindingEvent => ({
    type: "listing",
    fence,
    complete: true,
    entities: observation.occupants
      .filter((each) => each.harness === harness)
      .map((each) => ({
        native_id: each.terminal_id,
        terminals: [each.terminal_id],
      })),
  });
  const touched: string[] = [];
  for (const change of changes) {
    if (change.type === "create") {
      const id = createAgent(
        db,
        stores,
        {
          adapter,
          connection_id: observation.connection_id,
          terminal_id: change.terminal_id,
        },
        { harness: change.harness, folder: change.folder },
        at,
      );
      const seat = resolveSeat(
        db,
        stores,
        id,
        listing(change.harness),
        fence,
        at,
      );
      if (seat?.binding.state !== "attached")
        throw new Error("a new agent's seat did not attach");
      appendConversation(
        db,
        id,
        change.conversation,
        observation.connection_id,
        occupant.get(change.terminal_id)?.source ?? null,
        at,
      );
      touched.push(id);
      continue;
    }
    const record = readAgent(db, change.agent);
    if (!record) continue;
    touched.push(record.id);
    if (change.type === "folder")
      setAgentLabel(db, record.id, "folder", change.folder, at);
    else if (change.type === "conversation")
      appendConversation(
        db,
        record.id,
        change.conversation,
        observation.connection_id,
        occupant.get(record.seat!.terminal_id)?.source ?? null,
        at,
      );
    else {
      const seat = resolveSeat(
        db,
        stores,
        record.id,
        listing(record.harness),
        fence,
        at,
      );
      if (seat?.binding.state !== "ended")
        throw new Error("an agent's seat did not end with its terminal");
      closeConversation(db, record, at);
      if (change.type === "end")
        db.query("UPDATE entities SET ended_at=? WHERE id=?").run(
          at,
          record.id,
        );
    }
  }
  return touched;
}

/** The single writer's entry: every operation is one transaction. */
export function writeAgents(
  db: Database,
  stores: Stores,
  operation: AgentStoreOperation,
  at: number,
): AgentWriteResult {
  const touched =
    operation.type === "observe"
      ? observe(db, stores, operation, at)
      : (endAgent(db, stores, operation.agent, at), [operation.agent]);
  return {
    changed: [...new Set(touched)].flatMap((id) => readAgent(db, id) ?? []),
  };
}

export type AgentsPort = {
  /** Agents not ended, as last committed. */
  list(): AgentRecord[];
  /** Resolves one listing; the changed records, or none. */
  observe(
    adapter: string,
    observation: AgentObservation,
  ): Promise<AgentRecord[]>;
  end(agent: string): Promise<AgentRecord[]>;
  close(): void;
};

export function createAgentsPort(
  initial: readonly AgentRecord[],
  request: <T>(operation: StorageRequest) => Promise<T>,
): AgentsPort {
  const agents = new Map(initial.map((agent) => [agent.id, agent]));
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const write = (operation: AgentStoreOperation) => {
    const run = async () => {
      if (closed) throw new StorageWriteRejected("World storage is closed");
      const { changed } = await request<AgentWriteResult>({
        type: "agents",
        operation,
      });
      for (const agent of changed)
        if (agent.ended_at === null) agents.set(agent.id, agent);
        else agents.delete(agent.id);
      return changed;
    };
    const task = queue.then(run, run);
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    list: () => structuredClone([...agents.values()]),
    observe: (adapter, observation) =>
      write({ type: "observe", adapter, observation }),
    end: (agent) => write({ type: "end", agent }),
    close: () => {
      closed = true;
    },
  };
}
