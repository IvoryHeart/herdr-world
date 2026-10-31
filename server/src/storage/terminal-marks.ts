import type { Database } from "bun:sqlite";
import { DESK_IDLE_WINDOW_MS, parseDeskState } from "../../../shared/deskState";
import { WorldWatchlistRegistry } from "../world/watchlist";
import type {
  BindingEvent,
  BindingFence,
  BindingIdentity,
  BindingResolution,
  SourceBinding,
} from "../world/binding-types";
import type { createBindingWriter } from "./world-bindings";
import type { createWorldIds } from "./world-ids";
import type { StorageRequest } from "./world-protocol";

export type MarkKind = "desk" | "watchlist" | "completion-seen";
export type MarkBody = {
  reviewed_stop?: string | null;
  stopped_at?: number | null;
  observed_stop_id?: string | null;
  opened_at?: number | null;
  stateChangeSeq?: number;
  label?: string;
};
export type SavedTerminalMark = {
  id: string;
  revision: number;
  kind: MarkKind;
  binding: SourceBinding;
  body: MarkBody;
};
export type TerminalMarkPut = {
  id?: string;
  revision?: number;
  kind: MarkKind;
  body: MarkBody;
  target: BindingIdentity;
  event: BindingEvent;
  current: BindingFence;
};
export type TerminalMarkOperation =
  | { type: "expire"; at: number }
  | { type: "put"; input: TerminalMarkPut }
  | { type: "remove"; id: string; revision: number };
export type TerminalMarksPort = {
  list(): SavedTerminalMark[];
  put(input: TerminalMarkPut): Promise<SavedTerminalMark>;
  remove(id: string, revision: number): Promise<void>;
  expire(at: number): Promise<void>;
};
export const terminalMarksMigration = `CREATE TABLE terminal_marks (
 id TEXT PRIMARY KEY REFERENCES world_ids(id),
 kind TEXT NOT NULL CHECK(kind IN ('desk','watchlist','completion-seen')),
 binding_id TEXT NOT NULL UNIQUE REFERENCES world_bindings(id),
 revision INTEGER NOT NULL CHECK(revision>=0), body TEXT NOT NULL CHECK(json_valid(body)), open_order INTEGER NOT NULL DEFAULT 0
);`;
export function readTerminalMarks(
  db: Database,
  id?: string,
): SavedTerminalMark[] {
  return (
    db
      .query(
        "SELECT m.id,m.kind,m.revision,m.body,b.body AS binding FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id " +
          (id ? "WHERE m.id=?" : "ORDER BY m.open_order,m.rowid"),
      )
      .all(...(id ? [id] : [])) as {
      id: string;
      kind: MarkKind;
      revision: number;
      body: string;
      binding: string;
    }[]
  ).map((row) => {
    const binding = JSON.parse(row.binding) as SourceBinding;
    binding.state = binding.state === "ended" ? "ended" : "unresolved";
    return { ...row, body: JSON.parse(row.body), binding };
  });
}
function body(kind: MarkKind, input: MarkBody): MarkBody {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid terminal mark body");
  const allowed =
    kind === "desk"
      ? [
          "reviewed_stop",
          "stopped_at",
          "observed_stop_id",
          "opened_at",
          "stateChangeSeq",
        ]
      : kind === "watchlist"
        ? ["label"]
        : ["stateChangeSeq"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("invalid terminal mark field");
  if (
    input.stateChangeSeq !== undefined &&
    (!Number.isSafeInteger(input.stateChangeSeq) || input.stateChangeSeq < 0)
  )
    throw new Error("invalid terminal mark sequence");
  if (
    kind === "desk" &&
    !parseDeskState({
      revision: 0,
      records: [
        {
          connection_id: "synthetic",
          connection_generation: 1,
          terminal_id: "synthetic",
          agent_session_fingerprint: null,
          ...input,
        },
      ],
    })
  )
    throw new Error("invalid Desk mark");
  if (kind === "watchlist") {
    const registry = new WorldWatchlistRegistry();
    registry.pin({
      connection_id: "synthetic",
      connection_generation: 1,
      terminal_id: "synthetic",
      label: input.label ?? "Watch",
    });
    return { label: registry.list().records[0]!.label };
  }
  return structuredClone(input);
}
/** Runs inside the sole writer's transaction. Record and binding commit together. */
export function createTerminalMarkWriter(
  db: Database,
  ids: ReturnType<typeof createWorldIds>,
  bindings: ReturnType<typeof createBindingWriter>,
) {
  return (operation: TerminalMarkOperation, at: number): unknown => {
    if (operation.type === "expire") {
      if (!Number.isFinite(operation.at) || operation.at < 0)
        throw new Error("invalid Desk expiry time");
      const trimmed: SavedTerminalMark[] = [],
        removed: string[] = [];
      for (const row of readTerminalMarks(db)) {
        if (
          row.kind !== "desk" ||
          row.body.stopped_at == null ||
          operation.at - row.body.stopped_at <= DESK_IDLE_WINDOW_MS
        )
          continue;
        row.body.stopped_at = null;
        if (row.body.reviewed_stop == null && row.body.opened_at == null) {
          db.query("DELETE FROM terminal_marks WHERE id=?").run(row.id);
          bindings.execute({ type: "remove", id: row.binding.id }, at);
          removed.push(row.id);
        } else {
          row.revision++;
          db.query(
            "UPDATE terminal_marks SET revision=?,body=? WHERE id=?",
          ).run(row.revision, JSON.stringify(row.body), row.id);
          trimmed.push(row);
        }
      }
      return { trimmed, removed };
    }

    const id = operation.type === "put" ? operation.input.id : operation.id;
    const existing = id ? readTerminalMarks(db, id)[0] : undefined;
    const revision =
      operation.type === "put" ? operation.input.revision : operation.revision;
    if (id && (!existing || revision !== existing.revision))
      throw new Error("terminal mark revision conflict");
    if (operation.type === "remove") {
      db.query("DELETE FROM terminal_marks WHERE id=?").run(id!);
      bindings.execute({ type: "remove", id: existing!.binding.id }, at);
      return;
    }
    const input = operation.input;
    if (
      !["desk", "watchlist", "completion-seen"].includes(input.kind) ||
      (existing && existing.kind !== input.kind)
    )
      throw new Error("invalid terminal mark kind");
    const value = body(input.kind, input.body);
    if (
      !existing &&
      db
        .query(
          "SELECT 1 FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id WHERE m.kind=? AND json_extract(b.body,'$.instance')=? AND json_extract(b.body,'$.evidence.terminals[0]')=?",
        )
        .get(
          input.kind,
          input.target.instance,
          input.target.evidence.terminals[0]!,
        )
    )
      throw new Error("terminal mark target already has a record");

    if (
      input.target.kind !== "pane" ||
      input.target.evidence.terminals.length !== 1 ||
      (input.kind === "watchlist" &&
        input.target.evidence.session !== undefined)
    )
      throw new Error("invalid terminal mark target");
    if (input.event.type !== "listing" || !input.event.complete)
      throw new Error("terminal mark requires a complete current listing");
    const recordId =
      existing?.id ??
      ids.issue(
        input.kind === "watchlist" ? "w" : input.kind === "desk" ? "d" : "c",
      );
    const binding =
      existing?.binding ??
      (bindings.execute(
        {
          type: "create",
          input: {
            ...input.target,
            record_id: recordId,
            slot: "target",
            policy: input.kind,
          },
        },
        at,
      ) as SourceBinding);
    const resolved = bindings.execute(
      {
        type: "resolve",
        id: binding.id,
        event: input.event,
        current: input.current,
        expectedRevision: binding.revision,
      },
      at,
    ) as BindingResolution;
    if (!resolved?.target)
      throw new Error("terminal mark binding is not attached");
    if (
      JSON.stringify(resolved.target.evidence) !==
        JSON.stringify(input.target.evidence) ||
      resolved.target.native_id !== input.target.native_id ||
      resolved.target.instance !== input.target.instance
    )
      throw new Error("terminal mark target changed");
    const count = (
      db
        .query("SELECT count(*) AS count FROM terminal_marks WHERE kind=?")
        .get(input.kind) as { count: number }
    ).count;
    const limit =
      input.kind === "watchlist" ? 128 : input.kind === "desk" ? 500 : 4096;
    if (!existing && count >= limit)
      throw new Error("terminal mark store is full");
    const next = {
      id: recordId,
      kind: input.kind,
      revision: (existing?.revision ?? -1) + 1,
      binding: resolved.binding,
      body: value,
    };
    const opening =
      input.kind === "desk" &&
      value.opened_at != null &&
      value.opened_at !== existing?.body.opened_at;
    const openOrder = opening
      ? (
          db
            .query(
              "SELECT coalesce(max(open_order),0)+1 AS n FROM terminal_marks",
            )
            .get() as { n: number }
        ).n
      : ((
          db
            .query("SELECT open_order AS n FROM terminal_marks WHERE id=?")
            .get(next.id) as { n: number } | null
        )?.n ?? 0);
    db.query(
      "INSERT INTO terminal_marks(id,kind,binding_id,revision,body,open_order) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body,open_order=excluded.open_order",
    ).run(
      next.id,
      next.kind,
      next.binding.id,
      next.revision,
      JSON.stringify(value),
      openOrder,
    );
    const trimmed: SavedTerminalMark[] = [],
      removed: string[] = [];
    if (opening) {
      const excess = db
        .query(
          "SELECT id FROM terminal_marks WHERE kind='desk' AND json_extract(body,'$.opened_at') IS NOT NULL ORDER BY json_extract(body,'$.opened_at') DESC,open_order DESC LIMIT -1 OFFSET 40",
        )
        .all() as { id: string }[];
      for (const { id } of excess) {
        const row = readTerminalMarks(db, id)[0]!;
        row.body.opened_at = null;
        if (row.body.reviewed_stop == null && row.body.stopped_at == null) {
          db.query("DELETE FROM terminal_marks WHERE id=?").run(id);
          bindings.execute({ type: "remove", id: row.binding.id }, at);
          removed.push(id);
        } else {
          row.revision++;
          db.query(
            "UPDATE terminal_marks SET revision=?,body=? WHERE id=?",
          ).run(row.revision, JSON.stringify(row.body), id);
          trimmed.push(row);
        }
      }
    }
    return { row: next, trimmed, removed };
  };
}
export function createTerminalMarksPort(
  initial: SavedTerminalMark[],
  request: <T>(request: StorageRequest) => Promise<T>,
): TerminalMarksPort {
  const rows = new Map(initial.map((row) => [row.id, row]));
  return {
    list: () => structuredClone([...rows.values()]),
    async put(input) {
      const commit = await request<{
        row: SavedTerminalMark;
        trimmed: SavedTerminalMark[];
        removed: string[];
      }>({ type: "terminal-mark", operation: { type: "put", input } });
      rows.delete(commit.row.id);
      rows.set(commit.row.id, commit.row);
      for (const row of commit.trimmed) rows.set(row.id, row);
      for (const id of commit.removed) rows.delete(id);
      return structuredClone(commit.row);
    },
    async expire(at) {
      const commit = await request<{
        trimmed: SavedTerminalMark[];
        removed: string[];
      }>({ type: "terminal-mark", operation: { type: "expire", at } });
      for (const row of commit.trimmed) rows.set(row.id, row);
      for (const id of commit.removed) rows.delete(id);
    },
    async remove(id, revision) {
      await request<void>({
        type: "terminal-mark",
        operation: { type: "remove", id, revision },
      });
      rows.delete(id);
    },
  };
}
