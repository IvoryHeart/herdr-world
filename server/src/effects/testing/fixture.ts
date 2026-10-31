import { Database } from "bun:sqlite";
import { join } from "node:path";
import { Type } from "typebox";
import { declare, object, policies } from "../../verbs/declaration";
import { productionEffectVerb } from "../contracts";
import { createEffectStore } from "../../storage/effect-client";
import { openWorldWriter } from "../../storage/world-writer";
import type {
  StorageRequest,
  EffectRecovery,
} from "../../storage/world-protocol";
import { createEffectRunner, type EffectDriver } from "../runner";
import type { EffectContract } from "../types";

export const OWNER = {
  kind: "browser" as const,
  subject: "synthetic-owner",
  evidence: { source: "fixture" },
};
export function effectFixture(
  root: string,
  recovery: EffectRecovery,
  options: {
    incarnation?: string;
    version?: number;
    seed?: boolean;
    now?: number;
    checkpoint?: Parameters<typeof createEffectRunner>[0]["checkpoint"];
    commit?: (phase: "before-commit" | "after-commit") => void;
    runner?: typeof createEffectRunner;
    writer?: typeof openWorldWriter;
  } = {},
) {
  const incarnation = options.incarnation ?? "effect-incarnation-one";
  const verb = declare(
    "effect",
    `synthetic.${recovery}`,
    object({ value: Type.String() }),
    object(),
    recovery,
    policies({ browser: "allow" }),
    ["runtime"],
    ["fixture state is current"],
    [],
    { queueable: true, version: options.version ?? 1 },
  );
  const lookup = (name: string) =>
    name === verb.name ? verb : productionEffectVerb(name);
  let now = options.now ?? 1000;
  const clock = { now: () => now, monotonic: () => now };
  const jobs = new Map<() => void, number>();
  const scheduler = {
    schedule(callback: () => void, delay: number) {
      jobs.set(callback, delay);
      return { cancel: () => jobs.delete(callback) };
    },
  };
  const writer = (options.writer ?? openWorldWriter)(
    join(root, "world.sqlite"),
    join(root, "legacy.json"),
    now,
    incarnation,
    undefined,
    undefined,
    undefined,
    undefined,
    lookup,
  );
  const request = async <T>(request: StorageRequest): Promise<T> => {
    const result = writer.batch([{ ticket: 1, request }], clock.now())[0]!;
    if (result.error) throw new Error(result.error);
    return result.result as T;
  };
  const store = createEffectStore(request, () => {});
  const source = new Database(join(root, "receiver.sqlite"), { strict: true });
  source.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS applied(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,handle TEXT,status TEXT NOT NULL)",
  );
  for (const [key, value] of Object.entries({
    authorized: "1",
    authorizations: "0",
    precondition: "1",
    binding: "attached",
    terminal: "terminal-one",
    generation: "1",
    calls: "0",
    probes: "0",
    finds: "0",
    attaches: "0",
    permanent: "0",
  }))
    source
      .query("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO NOTHING")
      .run(key, value);
  const read = (key: string) =>
    (
      source.query("SELECT value FROM settings WHERE key=?").get(key) as {
        value: string;
      }
    ).value;
  const set = (key: string, value: string) =>
    source.query("UPDATE settings SET value=? WHERE key=?").run(value, key);
  const increment = (key: string) => set(key, String(Number(read(key)) + 1));
  const captured = {
    adapter: "synthetic",
    connection_id: "example",
    kind: "pane",
    native_id: "pane-one",
    evidence: {
      terminal_id: "terminal-one",
      session_fingerprint: "session-one",
    },
  };
  const contract: EffectContract = {
    verb: verb.name,
    version: 1,
    params: { value: "example" },
    targets: [captured],
    actor: OWNER,
    authorization: { initially_allowed: true, creation_generation: 999 },
    idempotency_key: "matrix-key",
    preconditions: { fixture: "unchanged" },
    origin: "matrix-origin",
  };
  if (options.seed !== false && !writer.read().attention.length) {
    const write = writer.batch(
      [
        {
          ticket: 1,
          request: {
            type: "write",
            write: {
              at: now,
              revision: writer.read().document.revision,
              results: {
                put: [
                  {
                    id: "r-matrix",
                    at: now,
                    actor: { label: "Synthetic owner", verified: false },
                    task: "matrix",
                    summary: "Synthetic effect",
                    status: "done",
                  },
                ],
                remove: [],
              },
              asks: { put: [], remove: [] },
              changes: { put: [], remove: [] },
              effects: [
                {
                  kind: "synthetic.delivery",
                  record_id: "r-matrix",
                  recovery,
                  target: captured,
                  contract,
                },
              ],
            },
          },
        },
      ],
      now,
      options.commit,
    );
    if (write[0]?.error) throw new Error(write[0].error);
  }
  const id =
    writer.read().attention.find((entry) => entry.kind === "synthetic.delivery")
      ?.id ?? "missing-intent";
  const applied = () =>
    source
      .query("SELECT * FROM applied WHERE key=? ORDER BY id")
      .all(contract.idempotency_key) as {
      id: number;
      key: string;
      handle: string | null;
      status: string;
    }[];
  const driver: EffectDriver = {
    authorize: () => {
      increment("authorizations");
      return read("authorized") === "1" ? "allowed" : "refused";
    },
    preconditions: () => (read("precondition") === "1" ? "allowed" : "refused"),
    resolve: () => {
      const state = read("binding");
      if (state !== "attached")
        return {
          state: state as "unresolved" | "ended" | "unconfirmed",
          reason: "Synthetic binding is " + state,
        };
      if (read("terminal") !== captured.evidence.terminal_id)
        return {
          state: "unconfirmed",
          reason: "Synthetic terminal was replaced",
        };
      return {
        state: "attached",
        targets: [
          {
            capture: captured,
            fence: {
              connection_id: "example",
              generation: Number(read("generation")),
              service_incarnation: incarnation,
            },
          },
        ],
      };
    },
    guard: (_entry, targets) =>
      read("authorized") === "1" &&
      read("precondition") === "1" &&
      read("binding") === "attached" &&
      targets.every(
        (target) =>
          target.fence.service_incarnation === incarnation &&
          target.fence.generation === Number(read("generation")) &&
          read("terminal") === "terminal-one",
      ),
    invoke: async (entry, context) => {
      const binding = await driver.resolve(entry);
      if (binding.state !== "attached")
        return {
          state: binding.state === "unresolved" ? "wait" : "refused",
          reason: binding.reason,
        };
      if (recovery === "reattachable" && !entry.external_handle)
        await context.handle({ run: "run-matrix-key" });
      if (!(await context.beforeSubmit()))
        return { state: "wait", reason: "Submission was not admitted" };
      if (!context.guard())
        throw new Error("Final source guard refused dispatch");
      increment("calls");
      if (read("permanent") === "1")
        return { state: "refused", reason: "Synthetic permanent refusal" };
      const received = () =>
        source
          .query("SELECT * FROM applied WHERE key=? ORDER BY id DESC LIMIT 1")
          .get(context.idempotency_key) as {
          id: number;
          key: string;
          handle: string | null;
        } | null;
      if (recovery !== "keyed" || !received())
        source
          .query("INSERT INTO applied(key,handle,status) VALUES(?,?,?)")
          .run(
            context.idempotency_key,
            recovery === "reattachable" ? "run-matrix-key" : null,
            "running",
          );
      const row = received()!;
      return {
        state: "delivered",
        receipt: { source: "synthetic", id: row.id, key: row.key },
        ...(row.handle ? { external_handle: { run: row.handle } } : {}),
      };
    },
    reconcile: async () => {
      increment("probes");
      const row = applied()[0];
      return row
        ? {
            state: "happened",
            receipt: { source: "synthetic", id: row.id, key: row.key },
          }
        : { state: "not-happened" };
    },
    find: async () => {
      increment("finds");
      const row = applied()[0];
      return row?.handle ? { handle: { run: row.handle } } : null;
    },
    reattach: async (_entry, handle) => {
      increment("attaches");
      const row = applied().find((row) => row.handle === handle.run);
      if (!row) return { state: "uncertain", reason: "Original run not found" };
      return {
        state: "delivered",
        receipt: { source: "synthetic", run: row.handle, observed: row.status },
        external_handle: handle,
      };
    },
  };
  const runner = (options.runner ?? createEffectRunner)({
    store,
    clock,
    scheduler,
    incarnation,
    verbs: lookup,
    driver: () => driver,
    checkpoint: options.checkpoint,
  });
  return {
    id,
    writer,
    store,
    driver,
    runner,
    clock,
    jobs,
    incarnation,
    contract,
    source,
    set,
    read,
    applied,
    advance: (time: number) => {
      now = time;
    },
    async close() {
      await runner.stop();
      source.close();
      writer.close();
    },
  };
}
