import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import type {
  AttentionEntry,
  DispatchFence,
  StorageRequest,
} from "./world-protocol";
import type { AnswerActor, AnswerRecipient } from "../world/ask-delivery-types";
import type { CliActor, LedgerAsk } from "../world/world-ledger";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});
const recipient: AnswerRecipient = {
  adapter: "herdr",
  connection_id: "studio",
  pane_id: "w1:p1",
  terminal_id: "term-fixture",
  reported: { scheme: "herdr-reported-v1", fingerprint: "a".repeat(64) },
  conversation: { scheme: "reported-v1", fingerprint: "b".repeat(64) },
  captured_at: 1000,
  service_incarnation: "first",
  connection_generation: 1,
};
const actor: CliActor = {
  label: "Fixture",
  verified: true,
  connection_id: "studio",
  pane_id: "w1:p1",
  terminal_id: "term-fixture",
  connection_generation: 9,
  agent_session_fingerprint: "a".repeat(64),
};
const fence: DispatchFence = {
  connection_id: "studio",
  generation: 2,
  service_incarnation: "first",
};
function fixture(
  options: {
    version?: number;
    answering?: AnswerActor;
    ownerOnly?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "answer-outbox-"));
  const database = join(root, "world.sqlite");
  const legacy = join(root, "legacy.json");
  let now = 1000;
  let writer = openWorldWriter(database, legacy, now, "first");
  cleanups.push(() => {
    writer.close();
    rmSync(root, { recursive: true, force: true });
  });
  function call<T = AttentionEntry | null>(request: StorageRequest): T {
    const reply = writer.batch([{ ticket: 1, request }], now)[0]!;
    if (reply.error) throw new Error(reply.error);
    return reply.result as T;
  }
  const ask: LedgerAsk = {
    id: "q-answer",
    at: now,
    actor,
    recipient,
    question: "Proceed?",
    options: [],
    owner_only: options.ownerOnly ?? true,
    answer: { text: "Proceed", by: "owner", at: now, occurrence: "a-answer" },
  };
  call({
    type: "write",
    write: {
      at: now,
      revision: 0,
      asks: { put: [ask], remove: [] },
      changes: { put: [], remove: [] },
      results: { put: [], remove: [] },
      effects: [
        {
          kind: "world.ask.deliver-answer",
          record_id: ask.id,
          recovery: "opaque",
          due_at: 4000,
          target: {
            adapter: "herdr",
            connection_id: "studio",
            kind: "pane",
            native_id: "w1:p1",
            evidence: {
              terminal_id: "term-fixture",
              session_fingerprint: "a".repeat(64),
            },
          },
          intent: {
            verb: "world.ask.deliver-answer",
            version: options.version ?? 1,
            origin: "world.ask.answer",
            params: { ask_id: ask.id, answer_occurrence: "a-answer" },
            actor: options.answering ?? { kind: "owner" },
            condition: { awaiting_delivery: true, recipient },
          },
        },
      ],
    },
  });
  const entry = call<AttentionEntry[]>({
    type: "outbox",
    record_id: ask.id,
  })[0]!;
  return {
    call,
    entry,
    ask,
    root,
    time(at: number) {
      now = at;
    },
    restart() {
      writer.close();
      writer = openWorldWriter(database, legacy, now, "second");
    },
    change(change: (ask: LedgerAsk) => void) {
      const document = writer.read().document;
      change(document.asks[0]!);
      call({
        type: "write",
        write: {
          at: now,
          revision: document.revision,
          asks: { put: document.asks, remove: [] },
          changes: { put: [], remove: [] },
          results: { put: [], remove: [] },
          effects: [],
        },
      });
    },
  };
}
const claim = (f: ReturnType<typeof fixture>) => {
  f.time(4000);
  return f.call({ type: "claim", id: f.entry.id, fence })!;
};
const begin = (f: ReturnType<typeof fixture>, entry: AttentionEntry) =>
  f.call({
    type: "begin-dispatch",
    id: entry.id,
    attempt: entry.attempt,
    fence,
  })!;

test("reference-only answer intent persists delay and claims separately from dispatching", () => {
  const f = fixture();
  expect(f.entry.due_at).toBe(4000);
  expect(f.entry.intent?.params).toEqual({
    ask_id: "q-answer",
    answer_occurrence: "a-answer",
  });
  expect(JSON.stringify(f.entry.intent)).not.toContain("Proceed");
  expect(f.call({ type: "claim", id: f.entry.id, fence })).toBeNull();
  const claimed = claim(f);
  expect(claimed).toMatchObject({
    state: "pending",
    claimed: true,
    attempt: 1,
  });
  expect(f.call({ type: "claim", id: claimed.id, fence })).toBeNull();
  expect(
    f.call<AttentionEntry[]>({
      type: "outbox",
      kind: "world.ask.deliver-answer",
      ready_only: true,
    }),
  ).toEqual([]);
  expect(begin(f, claimed)).toMatchObject({
    state: "dispatching",
    claimed: false,
  });
});

test("restart reclaims an unsent claim but never replays opaque dispatch uncertainty", () => {
  const f = fixture();
  claim(f);
  f.restart();
  const renewed = f.call({
    type: "claim",
    id: f.entry.id,
    fence: { ...fence, service_incarnation: "second" },
  })!;
  expect(renewed.attempt).toBe(2);
  expect(
    f.call({
      type: "begin-dispatch",
      id: renewed.id,
      attempt: renewed.attempt,
      fence,
    }),
  ).toBeNull();
  expect(
    f.call({
      type: "begin-dispatch",
      id: renewed.id,
      attempt: renewed.attempt,
      fence: { ...fence, service_incarnation: "second" },
    })?.state,
  ).toBe("dispatching");
  f.restart();
  f.time(1_000_000);
  expect(f.call({ type: "claim", id: f.entry.id, fence })).toBeNull();
  expect(f.call({ type: "outbox", id: f.entry.id })?.state).toBe("uncertain");
});

test("only the original verified asker can acknowledge this exact answer, even after a generation change", () => {
  const f = fixture();
  const request = {
    type: "acknowledge" as const,
    id: f.entry.id,
    occurrence: "a-answer",
    attempt: 0,
    actor,
  };
  expect(f.call({ ...request, occurrence: "a-old" })).toBeNull();
  expect(
    f.call({ ...request, actor: { ...actor, verified: false } }),
  ).toBeNull();
  expect(
    f.call({
      ...request,
      actor: { ...actor, agent_session_fingerprint: "c".repeat(64) },
    }),
  ).toBeNull();
  expect(f.call(request)).toMatchObject({
    state: "delivered",
    cli_received_at: 1000,
  });
  expect(f.call(request)?.state).toBe("delivered");
  f.time(4000);
  expect(f.call({ type: "claim", id: f.entry.id, fence })).toBeNull();
});

test("a CLI acknowledgement fences a claim before any dispatch begins", () => {
  const f = fixture();
  const claimed = claim(f);
  expect(
    f.call({
      type: "acknowledge",
      id: f.entry.id,
      occurrence: "a-answer",
      attempt: claimed.attempt,
      actor,
    })?.state,
  ).toBe("delivered");
  expect(
    f.call({
      type: "begin-dispatch",
      id: f.entry.id,
      attempt: claimed.attempt,
      fence,
    }),
  ).toBeNull();
});

test("a CLI read during dispatch keeps both evidence paths and survives restart", () => {
  const f = fixture();
  const claimed = claim(f);
  begin(f, claimed);
  expect(
    f.call({
      type: "acknowledge",
      id: f.entry.id,
      occurrence: "a-answer",
      attempt: claimed.attempt,
      actor,
    }),
  ).toMatchObject({ state: "dispatching", cli_received_at: 4000 });
  f.restart();
  expect(f.call({ type: "outbox", id: f.entry.id })).toMatchObject({
    state: "delivered",
    cli_received_at: 4000,
  });
});

test("owner resend and close fence stale receipts and decisions, preserving the same recipient", () => {
  const f = fixture();
  const claimed = claim(f);
  begin(f, claimed);
  f.call({
    type: "finish",
    id: claimed.id,
    attempt: claimed.attempt,
    state: "uncertain",
    reason: "Possible send",
  });
  expect(
    f.call({
      type: "decide",
      id: claimed.id,
      occurrence: "a-answer",
      attempt: claimed.attempt - 1,
      action: "resend",
    }),
  ).toBeNull();
  const renewed = f.call({
    type: "decide",
    id: claimed.id,
    occurrence: "a-answer",
    attempt: claimed.attempt,
    action: "resend",
  })!;
  expect(renewed).toMatchObject({
    state: "pending",
    attempt: 2,
    target: f.entry.target,
    prior_uncertainty: true,
  });
  expect(renewed.attempts).toMatchObject([
    { attempt: 1, state: "uncertain", fence },
  ]);
  expect(
    f.call({
      type: "acknowledge",
      id: renewed.id,
      occurrence: "a-answer",
      attempt: claimed.attempt,
      actor,
    }),
  ).toBeNull();
  expect(
    f.call({
      type: "finish",
      id: claimed.id,
      attempt: claimed.attempt,
      state: "delivered",
      reason: "Old receipt",
    }),
  ).toBeNull();
  expect(
    f.call({
      type: "decide",
      id: renewed.id,
      occurrence: "a-answer",
      attempt: renewed.attempt,
      action: "close",
    }),
  ).toMatchObject({ state: "cancelled", attempt: 3 });
  expect(
    f.call<import("./world-protocol").AttentionNotices>({
      type: "notices",
      kind: "world.ask.deliver-answer",
      limit: 60,
    }).entries,
  ).toEqual([]);
});

test("withdrawal cancels an unsent claim but preserves uncertainty after a possible send", () => {
  const f = fixture();
  const claimed = claim(f);
  f.change((ask) => {
    ask.withdrawn = { at: 4000 };
  });
  expect(
    f.call({
      type: "begin-dispatch",
      id: claimed.id,
      attempt: claimed.attempt,
      fence,
    }),
  ).toBeNull();
  expect(f.call({ type: "outbox", id: claimed.id })?.state).toBe("cancelled");
  const sent = fixture();
  const active = claim(sent);
  begin(sent, active);
  sent.call({
    type: "finish",
    id: active.id,
    attempt: active.attempt,
    state: "uncertain",
    reason: "Possible send",
  });
  sent.change((ask) => {
    ask.withdrawn = { at: 4000 };
  });
  expect(sent.call({ type: "outbox", id: active.id })?.state).toBe("uncertain");
});

test("unsupported operation versions and changed conditions are refused before dispatch", () => {
  const f = fixture();
  const claimed = claim(f);
  f.change((ask) => {
    ask.recipient = { ...ask.recipient!, terminal_id: "replacement" };
  });
  expect(begin(f, claimed)).toMatchObject({ state: "refused" });
});

test("unsupported operation versions and revoked answering policy never dispatch", () => {
  const unsupported = fixture({ version: 2 });
  const claimed = claim(unsupported);
  expect(begin(unsupported, claimed)).toMatchObject({ state: "refused" });
  const revoked = fixture({
    ownerOnly: false,
    answering: {
      kind: "agent",
      actor: {
        ...actor,
        pane_id: "w1:p2",
        terminal_id: "term-other",
        agent_session_fingerprint: "c".repeat(64),
      },
    },
  });
  const active = claim(revoked);
  revoked.change((ask) => {
    ask.owner_only = true;
  });
  expect(begin(revoked, active)).toMatchObject({ state: "refused" });
});

test("answer occurrence immutability and reference-only intent validation reject partial domain edits", () => {
  const f = fixture();
  expect(() =>
    f.change((ask) => {
      ask.answer!.text = "Replacement text";
    }),
  ).toThrow("immutable");
  expect(
    f.call<{ document: { asks: LedgerAsk[] } }>({ type: "load" }).document
      .asks[0]?.answer?.text,
  ).toBe("Proceed");
  const snapshot = f.call<{ document: { revision: number } }>({ type: "load" });
  expect(() =>
    f.call({
      type: "write",
      write: {
        at: 1000,
        revision: snapshot.document.revision,
        asks: { put: [], remove: [] },
        changes: { put: [], remove: [] },
        results: { put: [], remove: [] },
        effects: [
          {
            kind: "world.ask.deliver-answer",
            record_id: "q-answer",
            recovery: "repeatable",
            target: null,
          },
        ],
      },
    }),
  ).toThrow("without copied text");
});

for (const state of [
  "pending",
  "claimed",
  "dispatching",
  "uncertain",
  "refused",
  "delivered",
  "cancelled",
] as const)
  for (const action of ["resend", "close"] as const)
    test(`owner ${action} at ${state} obeys the allowed recovery matrix and rejects stale witnesses`, () => {
      const f = fixture();
      let entry = f.entry;
      if (state !== "pending") entry = claim(f);
      if (!["pending", "claimed"].includes(state)) entry = begin(f, entry);
      if (["uncertain", "refused", "delivered", "cancelled"].includes(state))
        entry = f.call({
          type: "finish",
          id: entry.id,
          attempt: entry.attempt,
          state: state as "uncertain" | "refused" | "delivered" | "cancelled",
          reason: "Matrix setup",
        })!;
      const request = {
        type: "decide" as const,
        id: entry.id,
        occurrence: "a-answer",
        attempt: entry.attempt,
        action,
      };
      expect(f.call({ ...request, attempt: entry.attempt + 1 })).toBeNull();
      const allowed =
        action === "resend"
          ? ["uncertain", "refused"].includes(state)
          : ["pending", "claimed", "uncertain", "refused"].includes(state);
      const result = f.call(request);
      expect(Boolean(result)).toBe(allowed);
      if (result)
        expect(result.state).toBe(
          action === "resend" ? "pending" : "cancelled",
        );
    });

test("a reference intent cannot smuggle copied text through actor metadata", () => {
  const f = fixture();
  const document = f.call<{ document: { revision: number } }>({
    type: "load",
  }).document;
  const intent = {
    ...f.entry.intent!,
    actor: { kind: "owner", text: "FORBIDDEN COPIED ANSWER" },
  } as unknown as import("../world/ask-delivery-types").AnswerIntent;
  expect(() =>
    f.call({
      type: "write",
      write: {
        at: 4000,
        revision: document.revision,
        asks: { put: [], remove: [] },
        changes: { put: [], remove: [] },
        results: { put: [], remove: [] },
        effects: [
          {
            kind: "world.ask.deliver-answer",
            record_id: f.ask.id,
            recovery: "opaque",
            target: f.entry.target,
            intent,
          },
        ],
      },
    }),
  ).toThrow("without copied text");
  expect(
    JSON.stringify(f.call({ type: "outbox", id: f.entry.id })),
  ).not.toContain("FORBIDDEN COPIED ANSWER");
});

test("notice pages remain bounded while actionable and host counts include older pages", () => {
  const f = fixture(),
    claimed = claim(f);
  begin(f, claimed);
  f.call({
    type: "finish",
    id: f.entry.id,
    attempt: claimed.attempt,
    state: "uncertain",
    reason: "Older possible send",
  });
  const asks = Array.from({ length: 65 }, (_, index) => ({
    ...structuredClone(f.ask),
    id: `q-page-${index}`,
    answer: { ...f.ask.answer!, occurrence: `a-page-${index}` },
  }));
  const document = f.call<{ document: { revision: number } }>({
    type: "load",
  }).document;
  f.call({
    type: "write",
    write: {
      at: 4000,
      revision: document.revision,
      asks: { put: asks, remove: [] },
      changes: { put: [], remove: [] },
      results: { put: [], remove: [] },
      effects: asks.map((ask) => ({
        kind: "world.ask.deliver-answer",
        record_id: ask.id,
        recovery: "opaque",
        target: f.entry.target,
        intent: {
          ...structuredClone(f.entry.intent!),
          params: { ask_id: ask.id, answer_occurrence: ask.answer.occurrence },
        },
      })),
    },
  });
  const page = f.call<import("./world-protocol").AttentionNotices>({
    type: "notices",
    kind: "world.ask.deliver-answer",
    limit: 60,
  });
  expect(page.entries).toHaveLength(60);
  expect(page.entries.some((entry) => entry.id === f.entry.id)).toBe(false);
  expect(page.checks).toBe(1);
  expect(page.waiting).toBe(65);
  expect(page.connections).toEqual({ studio: 66 });
  const older = f.call<import("./world-protocol").AttentionNotices>({
    type: "notices",
    kind: "world.ask.deliver-answer",
    after: page.entries.at(-1)!.id,
    limit: 60,
  });
  expect(older.entries).toHaveLength(6);
  expect(older.checks).toBe(1);
});
