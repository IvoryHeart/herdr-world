import type { Database } from "bun:sqlite";
import {
  createLegacyBindingWriter,
  legacyBindingsSchema,
  type LegacyBindingCapture,
  type LegacyBindingOperation,
} from "./legacy-bindings";
import {
  bindingPolicies,
  type BindingEvent,
  type BindingFence,
  type BindingIdentity,
  type BindingInput,
  type BindingResolution,
  type SourceBinding,
} from "../world/binding-types";
import { resolveBinding } from "../world/binding-resolution";
import type { createWorldIds } from "./world-ids";

export const worldBindingsMigration = `
CREATE TABLE world_bindings (
 id TEXT PRIMARY KEY REFERENCES world_ids(id), record_id TEXT NOT NULL REFERENCES world_ids(id),
 slot TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(record_id,slot)
);
CREATE INDEX world_bindings_record ON world_bindings(record_id,id);
${legacyBindingsSchema}
`;
export type BindingPage = {
  record_id?: string;
  after?: string;
  limit?: number;
};
export type BindingOperation =
  | { type: "legacy"; operation: LegacyBindingOperation }
  | { type: "create"; input: BindingInput }
  | { type: "get"; id: string }
  | { type: "list"; page: BindingPage }
  | {
      type: "resolve";
      id: string;
      event: BindingEvent;
      current: BindingFence | null;
      expectedRevision: number;
    }
  | { type: "remove"; id: string };
export type WorldBindings = {
  settled(): Promise<void>;
  captureLegacy(captures: LegacyBindingCapture[]): Promise<void>;
  create(input: BindingInput): Promise<SourceBinding>;
  /** Durable captures are unresolved until freshly resolved, never action authority. */
  get(id: string): Promise<SourceBinding | null>;
  list(page?: BindingPage): Promise<SourceBinding[]>;
  resolve(
    id: string,
    event: BindingEvent,
    current: BindingFence | null,
    expectedRevision: number,
  ): Promise<BindingResolution | null>;
  remove(id: string): Promise<void>;
};
const fail = (): never => {
  throw new Error("invalid source binding identity or observation");
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1024;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
function identity(value: unknown): asserts value is BindingIdentity {
  if (
    !object(value) ||
    !text(value.adapter) ||
    !text(value.instance) ||
    !text(value.native_id) ||
    !["pane", "tab", "workspace", "terminal", "session"].includes(
      String(value.kind),
    ) ||
    !object(value.evidence) ||
    !keys(value.evidence, ["terminals", "session"]) ||
    !Array.isArray(value.evidence.terminals) ||
    value.evidence.terminals.length > 64 ||
    !value.evidence.terminals.every(text) ||
    new Set(value.evidence.terminals).size !==
      value.evidence.terminals.length ||
    (value.evidence.session !== undefined && !text(value.evidence.session))
  )
    fail();
}
export function validateBindingInput(
  value: unknown,
): asserts value is BindingInput {
  identity(value);
  const input = value as unknown as Record<string, unknown>;
  if (
    !keys(input, [
      "record_id",
      "slot",
      "policy",
      "adapter",
      "instance",
      "kind",
      "native_id",
      "evidence",
    ]) ||
    !text(input.record_id) ||
    !text(input.slot) ||
    !Object.hasOwn(bindingPolicies, String(input.policy)) ||
    (!value.evidence.terminals.length &&
      !(input.policy === "board-string" && !value.evidence.session))
  )
    fail();
}
function fence(value: unknown): asserts value is BindingFence {
  if (
    !object(value) ||
    !keys(value, [
      "adapter",
      "instance",
      "service_incarnation",
      "generation",
    ]) ||
    !text(value.adapter) ||
    !text(value.instance) ||
    !text(value.service_incarnation) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1
  )
    fail();
}
function entity(value: unknown): boolean {
  return (
    object(value) &&
    keys(value, ["native_id", "terminals", "session"]) &&
    text(value.native_id) &&
    Array.isArray(value.terminals) &&
    value.terminals.every(text) &&
    (value.session === undefined || text(value.session))
  );
}
function validateEvent(event: BindingEvent, current: BindingFence | null) {
  if (current !== null) fence(current);
  if (!object(event)) fail();
  switch (event.type) {
    case "offline":
    case "user-detach":
      return;
    case "user-keep":
      identity(event.target);
      if (
        !keys(event.target, [
          "adapter",
          "instance",
          "kind",
          "native_id",
          "evidence",
        ])
      )
        fail();
      return;
    case "listing":
      fence(event.fence);
      if (
        typeof event.complete !== "boolean" ||
        !Array.isArray(event.entities) ||
        !event.entities.every(entity)
      )
        fail();
      return;
    case "world-move":
      fence(event.fence);
      if (!text(event.from) || !entity(event.target)) fail();
      return;
    case "absence":
      fence(event.fence);
      if (!text(event.native_id) || !["close", "not-found"].includes(event.via))
        fail();
      return;
    default:
      fail();
  }
}

/** All mutations execute inside the existing worker transaction/savepoint. */
export function createBindingWriter(
  db: Database,
  ids: ReturnType<typeof createWorldIds>,
) {
  const read = (id: string): SourceBinding | null => {
    const row = db
      .query("SELECT body FROM world_bindings WHERE id=?")
      .get(id) as { body: string } | null;
    return row ? (JSON.parse(row.body) as SourceBinding) : null;
  };
  const capture = (saved: SourceBinding | null) =>
    saved && {
      ...saved,
      state:
        saved.state === "ended" ? ("ended" as const) : ("unresolved" as const),
    };
  const create = (value: BindingInput): SourceBinding => {
    validateBindingInput(value);
    const input = structuredClone(value);
    if (
      db
        .query("SELECT 1 FROM world_bindings WHERE record_id=? AND slot=?")
        .get(input.record_id, input.slot)
    )
      throw new Error("source binding record slot already exists");
    db.query("INSERT OR IGNORE INTO world_ids(id) VALUES(?)").run(
      input.record_id,
    );
    const binding: SourceBinding = {
      ...input,
      id: ids.issue("b"),
      revision: 0,
      state: "unresolved",
      checked_at: null,
    };
    db.query(
      "INSERT INTO world_bindings(id,record_id,slot,body) VALUES(?,?,?,?)",
    ).run(binding.id, input.record_id, input.slot, JSON.stringify(binding));
    return binding;
  };
  const legacy = createLegacyBindingWriter(
    db,
    ids,
    create,
    validateBindingInput,
  );
  return {
    execute(operation: BindingOperation, at: number): unknown {
      switch (operation.type) {
        case "legacy":
          return legacy(operation.operation);
        case "create":
          return create(operation.input);
        case "get":
          return capture(read(operation.id));
        case "list": {
          const { record_id, after = "", limit = 100 } = operation.page;
          if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            typeof after !== "string" ||
            (record_id !== undefined && !text(record_id))
          )
            fail();
          const rows = (
            record_id
              ? db
                  .query(
                    "SELECT body FROM world_bindings WHERE record_id=? AND id>? ORDER BY id LIMIT ?",
                  )
                  .all(record_id, after, limit)
              : db
                  .query(
                    "SELECT body FROM world_bindings WHERE id>? ORDER BY id LIMIT ?",
                  )
                  .all(after, limit)
          ) as { body: string }[];
          return rows.map((row) => capture(JSON.parse(row.body)));
        }
        case "resolve": {
          validateEvent(operation.event, operation.current);
          const saved = read(operation.id);
          if (!saved) return null;
          if (
            !Number.isSafeInteger(operation.expectedRevision) ||
            operation.expectedRevision < 0
          )
            fail();
          if (operation.expectedRevision !== saved.revision)
            return { binding: capture(saved), target: null };
          if (
            db
              .query(
                "SELECT 1 FROM world_binding_sync s JOIN world_binding_legacy l ON l.binding_id=? WHERE s.active=1",
              )
              .get(operation.id)
          )
            return { binding: capture(saved), target: null };
          const result = resolveBinding(
            saved,
            operation.event,
            operation.current,
            at,
          );
          result.binding.revision = saved.revision + 1;
          db.query("UPDATE world_bindings SET body=? WHERE id=?").run(
            JSON.stringify(result.binding),
            operation.id,
          );
          return result;
        }
        case "remove":
          db.query("DELETE FROM world_bindings WHERE id=?").run(operation.id);
      }
    },
  };
}
