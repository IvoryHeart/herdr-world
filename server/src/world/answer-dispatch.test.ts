import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Conversation,
  ConversationSource,
  ConversationSendResult,
} from "../agent/conversation";
import { openWorldLedger } from "../storage/world-storage";
import { createAskRecipients } from "./ask-recipient";
import { askSessionFingerprint } from "./world-cli-actor";
import { createAnswerRecorder } from "./answer-record";
import { createAnswerDispatcher } from "./answer-dispatch";
import {
  ANSWER_DELIVERY_VERB,
  answeringAgent,
  type AnswerActor,
} from "./ask-delivery-types";
import type { CliActor, LedgerAsk } from "./world-ledger";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const session = (value: string) => ({
  source: "fixture:claude",
  agent: "claude",
  kind: "id",
  value,
});
async function fixture(
  options: { legacy?: boolean; ownerOnly?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "ask-delivery-"));
  let now = 1000;
  const clock = { now: () => now, monotonic: () => now };
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    {
      clock,
      scheduler: {
        schedule(callback, delay) {
          const timer = setTimeout(callback, delay);
          return { cancel: () => clearTimeout(timer) };
        },
      },
    },
  );
  const state = {
    online: true,
    registered: true,
    generation: 1,
    session: session("original"),
    speakerSession: session("answerer"),
    scheme: "reported" as "reported" | "title" | "guessed",
    agent: "claude",
    fingerprint: undefined as string | undefined,
    blocked: false,
    prepareError: false,
    submitError: false,
    holdPreparation: false,
    holdSubmission: false,
    readHook: undefined as (() => void) | undefined,
  };
  const preparing = Promise.withResolvers<void>();
  const prepareGate = Promise.withResolvers<void>();
  const submitted = Promise.withResolvers<void>();
  const sendGate = Promise.withResolvers<void>();
  const prompts: string[] = [];
  const delays: number[] = [];
  const info = (id: string) => ({
    pane_id: id === "studio" ? "w1:p1" : "w1:p2",
    terminal_id: id === "studio" ? "term-original" : "term-answerer",
    agent: state.agent,
    agent_status: "idle",
    agent_session: id === "studio" ? state.session : state.speakerSession,
  });
  const actor = (id = "studio"): CliActor => ({
    label: id,
    verified: true,
    connection_id: id,
    connection_generation: state.generation,
    pane_id: info(id).pane_id,
    terminal_id: info(id).terminal_id,
    agent_session_fingerprint: askSessionFingerprint(info(id).agent_session),
  });
  const view = (): Conversation => ({
    status: "ok",
    unavailable: null,
    conversation_version: 1,
    source: "herdr",
    pane_id: "w1:p1",
    agent: state.agent,
    agent_status: "idle",
    session_binding: state.scheme,
    session_fingerprint:
      state.fingerprint ?? askSessionFingerprint(state.session)!,
    session_label: "Fixture session",
    terminal_title: "Fixture",
    running_tool: null,
    updated_at: null,
    messages: [],
    latest: null,
    quest: null,
    deliveries: [],
    pending_prompt: null,
  });
  const source: ConversationSource = {
    id: "synthetic-herdr-chat",
    latest: async () => view(),
    identity: async () => ({ key: "fixture", paths: [] }),
    latestAll: async () => [],
    quests: async () => [],
    steps: async () => [],
    answer: async () => ({
      status: "refused",
      reason: "not_blocked",
      message: "Fixture is not blocked",
      pending_prompt: null,
    }),
    dismiss: () => false,
    read: async () => {
      const observed = view();
      state.readHook?.();
      return observed;
    },
    async send(
      target: Parameters<ConversationSource["send"]>[0],
    ): Promise<ConversationSendResult> {
      preparing.resolve();
      if (state.holdPreparation) await prepareGate.promise;
      if (state.prepareError) throw new Error("Transcript preparation failed");
      if (!(await target.beforeSubmit?.()) || !target.guard?.(info("studio")))
        return {
          status: "refused",
          reason: "changed",
          message: "Nothing submitted",
        };
      if (state.blocked)
        return {
          status: "refused",
          reason: "blocked",
          message: "Herdr rejected input before submission",
        };
      prompts.push(target.text);
      submitted.resolve();
      if (state.holdSubmission) await sendGate.promise;
      if (state.submitError)
        throw new Error("Connection lost after possible submission");
      target.submitted?.(view().session_fingerprint);
      return {
        status: "sent",
        delivery: {
          id: "receipt",
          state: "pending",
          text: target.text,
          sent_at: "2026-01-01T00:00:00Z",
          transcript_at: "2026-01-01T00:00:00Z",
          fingerprint: target.session_fingerprint,
          expected: "Fixture",
        },
      };
    },
  };
  const connections = () => ({
    list: () =>
      state.registered
        ? [{ id: "studio" }, { id: "speaker" }]
        : [{ id: "speaker" }],
    readyRuntimeLease(id: string) {
      if (
        (id !== "studio" && id !== "speaker") ||
        !state.online ||
        (id === "studio" && !state.registered)
      )
        return null;
      const generation = state.generation;
      return {
        connectionId: id,
        generation,
        isCurrent: () =>
          state.online &&
          generation === state.generation &&
          (id !== "studio" || state.registered),
        runtime: {
          sshHost: () => null,
          agentSessions: { conversation: source },
          herdr: {
            async call(_method: string, params: Record<string, unknown>) {
              if (params.pane_id !== info(id).pane_id)
                throw new Error("pane_not_found: fixture");
              return { pane: info(id) };
            },
          },
        },
      };
    },
  });
  const recipients = createAskRecipients({
    connections,
    clock,
    incarnation: storage.incarnation,
  });
  const askingActor = actor();
  const recipient = options.legacy
    ? undefined
    : await recipients.capture(askingActor);
  const ask: LedgerAsk = {
    id: "q-fixture",
    at: now,
    actor: askingActor,
    recipient,
    question: "Proceed?",
    options: [],
    owner_only: options.ownerOnly ?? true,
  };
  await storage.ledger.update((document) => document.asks.push(ask));
  const record = createAnswerRecorder({
    ledger: () => storage.ledger,
    recipients,
    now: clock.now,
  });
  const dispatcher = createAnswerDispatcher({
    ledger: () => storage.ledger,
    outbox: () => storage.outbox,
    recipients,
    clock,
    scheduler: {
      schedule(_callback, delay) {
        delays.push(delay);
        return { cancel() {} };
      },
    },
    changed() {},
    log() {},
  });
  cleanups.push(async () => {
    prepareGate.resolve();
    sendGate.resolve();
    await dispatcher.stop();
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    state,
    storage,
    recipients,
    dispatcher,
    prompts,
    delays,
    preparing,
    prepareGate,
    submitted,
    sendGate,
    askingActor,
    actor,
    answer: (text = "Proceed", by: AnswerActor = { kind: "owner" }) =>
      record(ask.id, text, by),
    time(at: number) {
      now = at;
    },
    entry: async () =>
      (await storage.outbox.forRecord(ask.id)).find(
        (entry) => entry.kind === ANSWER_DELIVERY_VERB.name,
      )!,
  };
}

test("an answer without wait queues one plain-text prompt after its durable deadline", async () => {
  const f = await fixture();
  await f.answer("/compact\n!pwd\n# remember");
  await f.dispatcher.wake();
  expect(f.prompts).toEqual([]);
  expect(f.delays.at(-1)).toBe(3000);
  f.time(4000);
  await f.dispatcher.wake();
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0]).toBe(
    "Answer to q-fixture:\nQuestion: Proceed?\nAnswer from owner: /compact\n!pwd\n# remember",
  );
  expect(await f.entry()).toMatchObject({
    state: "delivered",
    attempt: 1,
    claimed: false,
  });
  expect(f.storage.ledger.ask("q-fixture")?.answer?.text).toBe(
    "/compact\n!pwd\n# remember",
  );
  expect(f.storage.ledger.openAsks().asks).toEqual([]);
});

test("offline answers remain pending and attach to the original session after a new runtime generation", async () => {
  const f = await fixture();
  f.state.online = false;
  await f.answer();
  f.time(4000);
  await f.dispatcher.wake();
  expect((await f.entry()).state).toBe("pending");
  expect(f.prompts).toEqual([]);
  f.state.online = true;
  f.state.generation = 20;
  f.time(100_000);
  await f.dispatcher.wake();
  expect(f.prompts).toHaveLength(1);
  expect((await f.entry()).evidence?.fence?.generation).toBe(20);
});

test("a changed session or fingerprint scheme refuses delivery and leaves ask get readable", async () => {
  const changed = await fixture();
  await changed.answer();
  changed.state.session = session("replacement");
  changed.time(4000);
  await changed.dispatcher.wake();
  expect((await changed.entry()).state).toBe("refused");
  expect(changed.prompts).toEqual([]);
  expect(changed.storage.ledger.ask("q-fixture")?.answer?.text).toBe("Proceed");
  const scheme = await fixture();
  await scheme.answer();
  scheme.state.scheme = "title";
  scheme.state.agent = "codex";
  scheme.time(4000);
  await scheme.dispatcher.wake();
  expect((await scheme.entry()).state).toBe("refused");
  expect(scheme.prompts).toEqual([]);
});

test("legacy asks are not rebound when answered and generate final not-sent evidence", async () => {
  const f = await fixture({ legacy: true });
  await f.answer();
  f.time(4000);
  await f.dispatcher.wake();
  expect(await f.entry()).toMatchObject({
    state: "refused",
    target: null,
    attempt: 0,
  });
  expect(f.prompts).toEqual([]);
});

test("a native blocked refusal may retry, but a possible submission never automatically replays", async () => {
  const blocked = await fixture();
  await blocked.answer();
  blocked.state.blocked = true;
  blocked.time(4000);
  await blocked.dispatcher.wake();
  expect((await blocked.entry()).state).toBe("pending");
  expect(blocked.prompts).toEqual([]);
  blocked.state.blocked = false;
  blocked.time(34_000);
  await blocked.dispatcher.wake();
  expect(blocked.prompts).toHaveLength(1);
  const uncertain = await fixture();
  await uncertain.answer();
  uncertain.state.submitError = true;
  uncertain.time(4000);
  await uncertain.dispatcher.wake();
  expect((await uncertain.entry()).state).toBe("uncertain");
  expect(uncertain.prompts).toHaveLength(1);
  uncertain.state.submitError = false;
  uncertain.time(1_000_000);
  await uncertain.dispatcher.wake();
  expect(uncertain.prompts).toHaveLength(1);
  const entry = await uncertain.entry();
  await uncertain.storage.outbox.decide(
    entry.id,
    entry.intent!.params.answer_occurrence,
    entry.attempt,
    "resend",
  );
  await uncertain.dispatcher.wake();
  expect(uncertain.prompts).toHaveLength(2);
  expect((await uncertain.entry()).prior_uncertainty).toBe(true);
});

test("preparation errors before durable submission remain safely pending", async () => {
  const f = await fixture();
  await f.answer();
  f.state.prepareError = true;
  f.time(4000);
  await f.dispatcher.wake();
  expect(await f.entry()).toMatchObject({
    state: "pending",
    attempts: [{ state: "pending" }],
  });
  expect(f.prompts).toEqual([]);
});

test("a CLI read while Chat is preparing fences its claim before any possible input", async () => {
  const f = await fixture();
  await f.answer();
  f.state.holdPreparation = true;
  f.time(4000);
  const sending = f.dispatcher.wake();
  await f.preparing.promise;
  const entry = await f.entry();
  expect(entry.claimed).toBe(true);
  await f.storage.outbox.acknowledge(
    entry.id,
    entry.intent!.params.answer_occurrence,
    entry.attempt,
    f.askingActor,
  );
  f.prepareGate.resolve();
  await sending;
  expect(f.prompts).toEqual([]);
  expect((await f.entry()).state).toBe("delivered");
});

test("a CLI read cannot retract input already submitted, but both evidence paths remain", async () => {
  const f = await fixture();
  await f.answer();
  f.state.holdSubmission = true;
  f.time(4000);
  const sending = f.dispatcher.wake();
  await f.submitted.promise;
  const entry = await f.entry();
  expect(entry.state).toBe("dispatching");
  await f.storage.outbox.acknowledge(
    entry.id,
    entry.intent!.params.answer_occurrence,
    entry.attempt,
    f.askingActor,
  );
  f.sendGate.resolve();
  await sending;
  expect(await f.entry()).toMatchObject({
    state: "delivered",
    cli_received_at: 4000,
  });
  expect(f.prompts).toHaveLength(1);
});

test("current answering-agent policy is checked again before dispatch, and owner-only stays owner-only", async () => {
  const f = await fixture({ ownerOnly: false });
  await f.answer("Proceed", answeringAgent(f.actor("speaker")));
  f.state.speakerSession = session("new-answerer");
  f.time(4000);
  await f.dispatcher.wake();
  expect((await f.entry()).state).toBe("refused");
  expect(f.prompts).toEqual([]);
  const ownerOnly = await fixture();
  await expect(
    ownerOnly.answer("No", answeringAgent(ownerOnly.actor("speaker"))),
  ).rejects.toThrow("could not be verified");
  expect(ownerOnly.storage.ledger.ask("q-fixture")?.answer).toBeUndefined();
});

test("creation does not bind a replacement that appears during conversation lookup", async () => {
  const f = await fixture();
  f.state.readHook = () => {
    f.state.session = session("replacement");
  };
  expect(await f.recipients.capture(f.askingActor)).toBeUndefined();
});

test("stop drains a started submission without scheduling another attempt", async () => {
  const f = await fixture();
  await f.answer();
  f.state.holdSubmission = true;
  f.time(4000);
  const sending = f.dispatcher.wake();
  await f.submitted.promise;
  const stopping = f.dispatcher.stop();
  f.sendGate.resolve();
  await stopping;
  await sending;
  expect((await f.entry()).state).toBe("delivered");
  const count = f.prompts.length;
  f.time(1_000_000);
  await f.dispatcher.wake();
  expect(f.prompts).toHaveLength(count);
});

test("durable deadlines reject early wakes and cap re-arming after a backwards wall clock jump", async () => {
  const f = await fixture();
  await f.answer();
  f.time(-1_000_000);
  await f.dispatcher.wake();
  expect(f.delays.at(-1)).toBe(60_000);
  expect(f.prompts).toEqual([]);
  f.time(3999);
  await f.dispatcher.wake();
  expect(f.delays.at(-1)).toBe(1);
  expect(f.prompts).toEqual([]);
  f.time(10_000_000);
  await f.dispatcher.wake();
  expect(f.prompts).toHaveLength(1);
});

test("answer and its new unresolved intent survive retention in one mutation at an overfull open backlog", async () => {
  const f = await fixture();
  await f.storage.ledger.update((doc) => {
    const original = doc.asks[0]!;
    for (let index = 0; index < 501; index++)
      doc.asks.push({
        ...structuredClone(original),
        id: `q-overflow-${index}`,
      });
  });
  await f.answer();
  expect(f.storage.ledger.ask("q-fixture")?.answer?.text).toBe("Proceed");
  expect((await f.entry()).state).toBe("pending");
  await f.storage.ledger.update((doc) => {
    doc.asks.at(-1)!.question = "Still retained";
  });
  expect(f.storage.ledger.ask("q-fixture")?.answer?.occurrence).toBeDefined();
  f.time(4000);
  await f.dispatcher.wake();
  expect(f.prompts).toHaveLength(1);
});
