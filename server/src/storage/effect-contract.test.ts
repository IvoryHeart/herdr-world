import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openWorldWriter } from "./world-writer";
import type { EffectContract } from "../effects/types";
import { effectContract } from "../effects/contracts";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import type { EffectReply } from "../effects/types";

test.each([2, 3])(
  "v%s alert attempts and reserved IDs survive the effects migration",
  (version) => {
    const root = mkdtempSync(join(tmpdir(), "legacy-effect-"));
    const path = join(root, "world.sqlite");
    const old = new Database(path);
    migrateWorldDatabase(old, path, worldMigrations.slice(0, version));
    const ask = {
      id: "q-legacy",
      at: 1000,
      actor: { label: "Synthetic asker", verified: false },
      question: "Continue?",
      options: [],
      owner_only: true,
    };
    old
      .query("INSERT INTO asks(id,created_at,body) VALUES(?,?,?)")
      .run(ask.id, 1000, JSON.stringify(ask));
    old
      .query(
        "INSERT INTO outbox(id,operation_id,kind,record_id,target,recovery,state,due_at,attempt,created_at) VALUES('e-legacy','o-legacy','ask.created','q-legacy',?,'repeatable','pending',1000,1,1000)",
      )
      .run(JSON.stringify({ connection_id: "example" }));
    if (version === 3)
      old.query("INSERT INTO world_ids(id) VALUES(?)").run("r-00000000");
    old.close();
    const writer = openWorldWriter(
      path,
      join(root, "legacy.json"),
      1000,
      "current-incarnation",
    );
    const call = (request: import("./world-protocol").StorageRequest) =>
      writer.batch([{ ticket: 1, request }], 1000)[0]!;
    const effect = () =>
      (call({ type: "effect-read", id: "e-legacy" }).result as EffectReply)
        .effect;
    try {
      expect(effect()).toMatchObject({
        state: "pending",
        ever_dispatched: true,
        not_sent: false,
      });
      expect(call({ type: "claim", id: "e-legacy" }).error).toBeUndefined();
      expect(effect()).toMatchObject({
        state: "dispatching",
        ever_dispatched: true,
        attempt_fence: {
          service_incarnation: "current-incarnation",
          attempt: 2,
        },
      });
      call({
        type: "finish",
        id: "e-legacy",
        attempt: 2,
        state: "refused",
        reason: "The captured target ended after a possible send",
      });
      expect(effect()).toMatchObject({
        state: "refused",
        ever_dispatched: true,
        not_sent: false,
      });
      writer.close();
      const upgraded = new Database(path, { readonly: true });
      try {
        expect(
          upgraded.query("SELECT id FROM world_ids WHERE id=?").get("e-legacy"),
        ).toEqual({ id: "e-legacy" });
        if (version === 3)
          expect(
            upgraded
              .query("SELECT id FROM world_ids WHERE id=?")
              .get("r-00000000"),
          ).toEqual({ id: "r-00000000" });
      } finally {
        upgraded.close();
      }
    } finally {
      writer.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("the domain transaction durably stores the complete versioned intent before dispatch", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-contract-"));
  const path = join(root, "world.sqlite");
  const writer = openWorldWriter(
    path,
    join(root, "legacy.json"),
    1000,
    "incarnation-one",
  );
  const contract: EffectContract = {
    verb: "notification.show",
    version: 1,
    params: { ask_id: "q-example" },
    targets: [{ connection_id: "example" }],
    actor: { kind: "cli_unverified", subject: "Example actor", evidence: {} },
    authorization: { policy: "owner-alert" },
    idempotency_key: "example-key",
    preconditions: { ask_open: "q-example" },
    origin: "example-origin",
  };
  try {
    const reply = writer.batch(
      [
        {
          ticket: 1,
          request: {
            type: "write",
            write: {
              at: 1000,
              revision: 0,
              asks: {
                put: [
                  {
                    id: "q-example",
                    at: 1000,
                    actor: { label: "Example actor", verified: false },
                    question: "Continue?",
                    options: [],
                    owner_only: true,
                  },
                ],
                remove: [],
              },
              changes: { put: [], remove: [] },
              results: { put: [], remove: [] },
              effects: [
                {
                  kind: "ask.created",
                  record_id: "q-example",
                  recovery: "repeatable",
                  target: { connection_id: "example" },
                  contract,
                },
              ],
            },
          },
        },
      ],
      1000,
    );
    expect(reply[0]?.error).toBeUndefined();
    writer.close();
    const stored = new Database(path, { readonly: true });
    try {
      expect(stored.query("SELECT id FROM asks").all()).toEqual([
        { id: "q-example" },
      ]);
      const row = stored.query("SELECT * FROM outbox").get() as Record<
        string,
        unknown
      >;
      expect(row.contract).toBe(JSON.stringify(contract));
      expect(row.state).toBe("pending");
      expect(row.ever_dispatched).toBe(0);
    } finally {
      stored.close();
    }
  } finally {
    writer.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("only captured binding fields and private queueable verbs enter the durable contract", () => {
  const contract: EffectContract = {
    verb: "notification.show",
    version: 1,
    params: { ask_id: "q-example" },
    targets: [{ connection_id: "example" }],
    actor: { kind: "cli_unverified", subject: "Synthetic asker", evidence: {} },
    authorization: {},
    idempotency_key: "example-key",
    preconditions: {},
    origin: "example-origin",
  };
  const capture = (value: unknown) =>
    effectContract(
      {
        kind: "ask.created",
        record_id: "q-example",
        recovery: "repeatable",
        target: (value as EffectContract).targets[0]!,
        contract: value as EffectContract,
      },
      "e-example",
      null,
    );
  expect(() =>
    capture({
      ...contract,
      targets: [{ connection_id: "example", generation: 1 }],
    }),
  ).toThrow("invalid durable effect contract");
  expect(() => capture({ ...contract, verb: "terminal.send" })).toThrow(
    "unregistered or nonqueueable",
  );
  expect(() =>
    capture({
      ...contract,
      targets: [
        {
          adapter: "herdr",
          connection_id: "example",
          kind: "pane",
          native_id: "pane-one",
          evidence: { terminal_id: "terminal-one" },
        },
      ],
    }),
  ).toThrow("owner alerts capture only");
});
