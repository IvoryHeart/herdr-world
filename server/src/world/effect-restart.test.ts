import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import type { Conversation, ConversationSource } from "../agent/conversation";
import { openWorldLedger } from "../storage/world-storage";
import { createAttentionDispatcher } from "./attention-dispatch";
import { createAnswerDispatcher } from "./answer-dispatch";
import { createAnswerRecorder } from "./answer-record";
import { createAskRecipients, type AnswerLease } from "./ask-recipient";
import { askSessionFingerprint } from "./world-cli-actor";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const native = {
  pane_id: "w1:p1",
  terminal_id: "terminal-one",
  agent: "claude",
  agent_session: {
    source: "fixture",
    agent: "claude",
    kind: "id",
    value: "session-one",
  },
};
const fingerprint = askSessionFingerprint(native.agent_session)!;
const conversation: Conversation = {
  status: "ok",
  unavailable: null,
  conversation_version: 1,
  source: "herdr",
  pane_id: native.pane_id,
  agent: "claude",
  agent_status: "idle",
  session_binding: "reported",
  session_fingerprint: fingerprint,
  session_label: "Synthetic session",
  terminal_title: null,
  running_tool: null,
  updated_at: null,
  messages: [],
  latest: null,
  quest: null,
  deliveries: [],
  pending_prompt: null,
};
type Runtime = ConnectionRuntime & AnswerLease["runtime"];
async function receiver() {
  const sends: string[] = [];
  const reads: string[] = [];
  const call: AnswerLease["runtime"]["tui"]["call"] = async (
    method,
    _params,
    _timeout,
    beforeSend,
  ) => {
    beforeSend?.();
    if (method === "pane.get") {
      reads.push(method);
      return { pane: native };
    }
    sends.push(method);
    return { shown: true };
  };
  const source: ConversationSource = {
    id: "synthetic-recycled-session",
    read: async () => conversation,
    latest: async () => conversation,
    identity: async () => ({ key: "synthetic", paths: [] }),
    latestAll: async () => [],
    quests: async () => [],
    steps: async () => [],
    dismiss: () => false,
    answer: async () => {
      throw new Error("unused");
    },
    press: async () => {
      throw new Error("unused");
    },
    async send(target) {
      if (!(await target.beforeSubmit?.()) || !target.guard?.(native))
        return {
          status: "refused",
          reason: "changed",
          message: "Nothing submitted",
        };
      await call(
        "pane.send_text",
        { pane_id: native.pane_id, text: target.text },
        5000,
        () => {
          if (!target.guard?.(native))
            throw new Error("Retired input authority");
        },
      );
      target.submitted?.(fingerprint);
      return {
        status: "sent",
        delivery: {
          id: "receipt",
          state: "pending",
          text: target.text,
          sent_at: "2026-01-01T00:00:00Z",
          transcript_at: "2026-01-01T00:00:00Z",
          fingerprint,
          expected: "Synthetic session",
        },
      };
    },
  };
  const identity = { id: "studio", label: "Synthetic host", source: "fixture" };
  const manager = new ConnectionManager<Runtime>(identity.id);
  manager.register({
    identity,
    createRuntime: () => ({
      identity,
      async startTransport() {},
      startBackground() {},
      async stop() {},
      sshHost: () => null,
      ...herdrRuntimeFixture({ call }),
      agentSessions: { conversation: source },
    }),
  });
  await manager.start(identity.id);
  cleanups.push(() => manager.stopAll());
  return { manager, sends, reads };
}
type Receiver = Awaited<ReturnType<typeof receiver>>;
async function fixture(kind: "alert" | "answer") {
  const root = mkdtempSync(join(tmpdir(), "effect-restart-"));
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "legacy.json"),
  };
  let now = 1000;
  const clock = { now: () => now, monotonic: () => now };
  const scheduler = { schedule: () => ({ cancel() {} }) };
  const storagePorts = {
    clock,
    scheduler: {
      schedule(callback: () => void, delay: number) {
        const timer = setTimeout(callback, delay);
        return { cancel: () => clearTimeout(timer) };
      },
    },
  };
  let storage = await openWorldLedger(paths, storagePorts);
  cleanups.push(async () => {
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  });
  const original = await receiver();
  const recipients = (runtime: Receiver) =>
    createAskRecipients({
      connections: () => runtime.manager,
      clock,
      incarnation: storage.incarnation,
    });
  const actor = {
    label: "Synthetic asker",
    verified: true,
    connection_id: "studio",
    connection_generation:
      original.manager.readyRuntimeLease("studio")!.generation,
    pane_id: native.pane_id,
    terminal_id: native.terminal_id,
    agent_session_fingerprint: fingerprint,
  };
  const recipient = await recipients(original).capture(actor);
  expect(recipient).toBeDefined();
  await storage.ledger.update(
    (doc) =>
      doc.asks.push({
        id: "q-restart",
        at: now,
        actor,
        recipient,
        question: "Proceed?",
        options: [],
        owner_only: true,
      }),
    kind === "alert"
      ? [
          {
            kind: "ask.created",
            record_id: "q-restart",
            recovery: "repeatable",
            target: { connection_id: "studio" },
          },
        ]
      : [],
  );
  if (kind === "answer")
    await createAnswerRecorder({
      ledger: () => storage.ledger,
      recipients: recipients(original),
      now: clock.now,
    })("q-restart", "Yes", { kind: "owner" });
  now += 10_000;
  const effect = async () =>
    storage.effects.get((await storage.outbox.forRecord("q-restart"))[0]!.id);
  const dispatch = async (runtime: Receiver) => {
    const deps = {
      effects: () => storage.effects,
      ledger: () => storage.ledger,
      incarnation: storage.incarnation,
      clock,
      scheduler,
      changed() {},
      log() {},
    };
    const dispatcher =
      kind === "answer"
        ? createAnswerDispatcher({ ...deps, recipients: recipients(runtime) })
        : createAttentionDispatcher({
            ...deps,
            outbox: () => storage.outbox,
            hasConnection: (id) =>
              runtime.manager.list().some((entry) => entry.id === id),
            lease: (id) => {
              const lease = runtime.manager.readyRuntimeLease(id);
              return (
                lease && {
                  connectionId: lease.connectionId,
                  generation: lease.generation,
                  isCurrent: lease.isCurrent,
                  call: (method, params, beforeSend) =>
                    lease.runtime.tui.call(method, params, 5000, beforeSend),
                }
              );
            },
          });
    try {
      await dispatcher.wake();
    } finally {
      await dispatcher.stop();
    }
  };
  return {
    original,
    effect,
    dispatch,
    recipients,
    get storage() {
      return storage;
    },
    async restart(legacy?: "missing-authority" | "missing-contract") {
      const prior = storage.incarnation;
      await storage.close();
      await original.manager.stopAll();
      if (legacy) {
        const db = new Database(paths.database);
        try {
          db.exec(
            legacy === "missing-contract"
              ? "UPDATE outbox SET contract=NULL"
              : "UPDATE outbox SET contract=json_remove(contract,'$.authorization.service_incarnation')",
          );
        } finally {
          db.close();
        }
      }
      storage = await openWorldLedger(paths, storagePorts);
      now += 1_000_000;
      const replacement = await receiver();
      expect(storage.incarnation).not.toBe(prior);
      expect(replacement.manager.readyRuntimeLease("studio")!.generation).toBe(
        actor.connection_generation,
      );
      return replacement;
    },
    async pause(phase: "claimed" | "dispatching") {
      const entry = (await effect())!;
      const claimed = (await storage.effects.transition({
        action: "claim",
        id: entry.id,
        incarnation: storage.incarnation,
      }))!;
      expect(claimed.claimed).toBe(true);
      if (phase === "dispatching")
        await storage.effects.transition({
          action: "begin",
          id: entry.id,
          fence: claimed.attempt_fence!,
          targets: [
            {
              capture: entry.target!,
              fence: {
                connection_id: "studio",
                generation: actor.connection_generation,
                service_incarnation: storage.incarnation,
              },
            },
          ],
        });
    },
  };
}

for (const kind of ["alert", "answer"] as const) {
  test(`${kind}: same-run receiver still receives the committed effect`, async () => {
    const f = await fixture(kind);
    await f.dispatch(f.original);
    expect(f.original.sends).toEqual([
      kind === "alert" ? "notification.show" : "pane.send_text",
    ]);
    expect(await f.effect()).toMatchObject({
      state: "delivered",
      ever_dispatched: true,
      not_sent: false,
    });
    const receipt = (await f.effect())!.receipt;
    const replacement = await f.restart();
    await f.dispatch(replacement);
    expect(replacement.sends).toEqual([]);
    expect((await f.effect())!.receipt).toEqual(receipt);
  });
  for (const phase of ["pending", "claimed", "dispatching"] as const)
    test(`${kind}: ${phase} survives SQLite reopen without sending to recycled-generation replacement`, async () => {
      const f = await fixture(kind);
      if (phase !== "pending") await f.pause(phase);
      const replacement = await f.restart();
      await f.dispatch(replacement);
      expect(replacement.sends).toEqual([]);
      expect(await f.effect()).toMatchObject({
        state: phase === "dispatching" ? "uncertain" : "refused",
        ever_dispatched: phase === "dispatching",
        not_sent: phase !== "dispatching",
      });
      expect(f.storage.ledger.ask("q-restart")).toBeDefined();
      if (phase !== "pending") {
        const history = await f.storage.outbox.forRecord("q-restart");
        expect(history[0]!.attempt).toBeGreaterThanOrEqual(1);
        if (kind === "answer")
          expect(history[0]!.attempts?.length).toBeGreaterThanOrEqual(1);
      }
    });
}

test("an explicit duplicate decision cannot authorize an old saved-answer recipient", async () => {
  const f = await fixture("answer");
  await f.pause("dispatching");
  const replacement = await f.restart();
  const before = (await f.effect())!;
  await f.storage.effects.transition({
    action: "decide",
    id: before.id,
    attempt: before.attempt,
    actor: { kind: "browser", subject: "synthetic-owner", evidence: {} },
    reason: "Allow possible duplicate",
  });
  await f.dispatch(replacement);
  expect(replacement.sends).toEqual([]);
  expect(await f.effect()).toMatchObject({
    state: "uncertain",
    ever_dispatched: true,
    not_sent: false,
  });
  expect((await f.effect())!.decisions).toHaveLength(1);
  const after = (await f.effect())!;
  await f.storage.effects.transition({
    action: "decide",
    outcome: "close",
    id: after.id,
    attempt: after.attempt,
    actor: { kind: "browser", subject: "synthetic-owner", evidence: {} },
    reason: "Close tracking without claiming reversal",
  });
  expect(await f.effect()).toMatchObject({
    state: "cancelled",
    ever_dispatched: true,
    not_sent: false,
  });
  expect((await f.effect())!.decisions).toHaveLength(2);
});

for (const legacy of ["missing-authority", "missing-contract"] as const)
  test(`legacy alert ${legacy}: reopening never grants new World-run authority`, async () => {
    const f = await fixture("alert");
    expect(
      (await f.effect())!.contract!.authorization.service_incarnation,
    ).toBe(f.storage.incarnation);
    const replacement = await f.restart(legacy);
    expect(
      (await f.effect())!.contract!.authorization.service_incarnation,
    ).toBeUndefined();
    await f.dispatch(replacement);
    expect(replacement.sends).toEqual([]);
    expect(await f.effect()).toMatchObject({
      state: "refused",
      not_sent: true,
    });
  });
