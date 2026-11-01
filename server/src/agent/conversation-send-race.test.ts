import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import {
  appendFile,
  chmod,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDeliveryLedger,
  DELIVERY_CHECK_MS,
  RECEIPTS_PER_PANE,
} from "./conversation-delivery";
import { createHerdrConversationSource } from "./herdr-conversation";
import {
  localAgentSessionFiles,
  type AgentSessionFileAccess,
} from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";
import { isSlashCommand } from "../../../shared/conversationInput";

test("slash commands include custom names while pasted paths stay ordinary messages", () => {
  for (const text of [
    "/",
    "/compact",
    " /custom.plugin anything",
    "/review:fast",
    "/🦀",
  ])
    expect(isSlashCommand(text)).toBe(true);
  for (const text of [
    "/var/log/app.log is missing",
    "Read /compact",
    "!ls",
    "# note",
  ])
    expect(isSlashCommand(text)).toBe(false);
});

test("unchecked commands match literal transcript words only and never treat a deliberate session switch as misdelivery", () => {
  const ledger = createDeliveryLedger();
  const time = Date.UTC(2026, 0, 1);
  ledger.record("pane", {
    text: "/compact",
    fingerprint: "old",
    expected: "Claude",
    kind: "command",
    queued: true,
    baseline: [],
    clock: { offsetMs: 0, uncertaintyMs: 0 },
    startedAt: time,
    endedAt: time + 1,
    switchedTo: "new",
  });
  const message = (id: string, text: string) => ({
    id,
    text,
    role: "user" as const,
    kind: "message" as const,
    sent_at: new Date(time + 2000).toISOString(),
  });
  ledger.evaluate(
    "pane",
    "new",
    [
      {
        fingerprint: "old",
        label: "Claude",
        messages: [message("rewritten", "[Pasted text #1]")],
      },
      {
        fingerprint: "new",
        label: "New Claude",
        messages: [message("another", "/compact")],
      },
    ],
    time + 3000,
  );
  expect(ledger.list("pane")[0]).toMatchObject({
    state: "pending",
    kind: "command",
    queued: true,
  });
  ledger.evaluate(
    "pane",
    "new",
    [
      {
        fingerprint: "old",
        label: "Claude",
        messages: [message("literal", "/compact")],
      },
    ],
    time + 4000,
  );
  expect(ledger.list("pane")[0]).toMatchObject({
    state: "matched",
    matched_id: "literal",
    matched_by: "words",
  });
  expect(ledger.list("pane")[0]!.delivered_to).toBeUndefined();
});

// Herdr 0.9.3's agent.prompt takes only {target, text} and ignores any
// precondition field, so a session switch between Chat's last check and the
// prompt cannot be prevented. These tests drive a fake Herdr that switches
// the pane's session in that window and check that Chat never reports the
// message as delivered to the session it showed.

let root = "";
const line = (role: "user" | "assistant", text: string, second: number) =>
  `${JSON.stringify({
    type: role,
    timestamp: new Date(Date.now() + second * 1000).toISOString(),
    message:
      role === "user"
        ? { role, content: text }
        : { role, content: [{ type: "text", text }] },
  })}\n`;

async function transcript(name: string) {
  const path = join(root, `${name}.jsonl`);
  await writeFile(
    path,
    line("user", "Earlier question", -60) +
      line("assistant", "Earlier answer", -59) +
      // An identical message from before the send must not confirm it.
      line("user", "Run the tests", -58) +
      line("assistant", "Done before.", -57),
  );
  return path;
}

function claude(path: string) {
  return {
    pane_id: "w1:p1",
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent: "claude",
    agent_status: "idle",
    terminal_title: "claude",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: path,
    },
  };
}

function fakeHerdr(initial: Record<string, unknown>) {
  const state = {
    current: initial,
    /** Herdr's view of the pane when it submits the prompt. */
    onPrompt: (() => {}) as () => void,
    replyWith: null as Record<string, unknown> | null,
    prompts: [] as unknown[],
  };
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get") return { agent: state.current };
    if (method === "agent.prompt") {
      state.prompts.push(params);
      state.onPrompt();
      return {
        type: "agent_prompted",
        agent: state.replyWith ?? state.current,
      };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { state, call };
}

function chat(call: HerdrCall, files = localAgentSessionFiles) {
  return createHerdrConversationSource({
    herdrCall: call,
    files,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(files),
  });
}

// The fingerprint a pending receipt carries differs from the shown one.
const otherThan = (conversation: { session_fingerprint: string | null }) =>
  expect.not.stringMatching(`^${conversation.session_fingerprint}$`);

async function sendTo(
  source: ReturnType<typeof chat>,
  text = "Run the tests",
  extra: { baseline?: string[] } = {},
) {
  const read = await source.read({ pane_id: "w1:p1" });
  return source.send({
    pane_id: "w1:p1",
    text,
    session_fingerprint: read.session_fingerprint!,
    ...extra,
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-send-race-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a session switch between Chat's check and Herdr's prompt", () => {
  test("Herdr's reply names the other session: Chat says where it went", async () => {
    const shown = await transcript("shown-a");
    const other = await transcript("other-a");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    // The switch happens after Chat's final agent.get, inside Herdr.
    state.onPrompt = () => {
      state.current = claude(other);
    };
    const result = await source.send({
      pane_id: "w1:p1",
      text: "Run the tests",
      session_fingerprint: read.session_fingerprint!,
    });
    expect(state.prompts).toHaveLength(1);
    expect(result).toMatchObject({
      status: "sent",
      delivery: {
        state: "misdelivered",
        expected: "claude session shown-a.jsonl",
        delivered_to: "claude session other-a.jsonl",
      },
    });
    // The notice stays on the pane until the user dismisses it.
    const after = await source.read({ pane_id: "w1:p1" });
    expect(after.deliveries).toMatchObject([
      { state: "misdelivered", delivered_to: "claude session other-a.jsonl" },
    ]);
    expect(
      source.dismiss({
        pane_id: "w1:p1",
        delivery_id: after.deliveries[0]!.id,
      }),
    ).toBe(true);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toEqual([]);
  });

  test("Herdr's reply lags: the other transcript shows where it went", async () => {
    const shown = await transcript("shown-b");
    const other = await transcript("other-b");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    // Herdr still reports the shown session in its reply, but the text
    // reaches the replacement's transcript.
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    const result = await source.send({
      pane_id: "w1:p1",
      text: "Run the tests",
      session_fingerprint: read.session_fingerprint!,
    });
    // Never called delivered: it is only sent, and not yet seen.
    expect(result).toMatchObject({
      status: "sent",
      delivery: { state: "pending" },
    });
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "pending", text: "Run the tests" },
    ]);
    await appendFile(other, line("user", "Run the tests", 1));
    state.current = claude(other);
    const after = await source.read({ pane_id: "w1:p1" });
    expect(after.deliveries).toMatchObject([
      {
        state: "misdelivered",
        expected: "claude session shown-b.jsonl",
        delivered_to: "claude session other-b.jsonl",
      },
    ]);
  });

  test("no switch: pending until the shown transcript has the words, then matched", async () => {
    const shown = await transcript("shown-c");
    const { call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    const result = await source.send({
      pane_id: "w1:p1",
      text: "Run the tests",
      session_fingerprint: read.session_fingerprint!,
    });
    expect(result).toMatchObject({
      status: "sent",
      delivery: { state: "pending" },
    });
    // The identical message from before the send does not confirm it.
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toHaveLength(
      1,
    );
    await appendFile(shown, line("user", "Run the tests", 1));
    // Matched by its words, never settled or called delivered.
    const matched = await source.read({ pane_id: "w1:p1" });
    expect(matched.deliveries).toMatchObject([
      { state: "matched", matched_id: matched.messages.at(-1)!.id },
    ]);
  });

  test("two identical sends each need their own transcript message", async () => {
    const shown = await transcript("shown-d");
    const { call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    for (let index = 0; index < 2; index += 1)
      await source.send({
        pane_id: "w1:p1",
        text: "Again",
        session_fingerprint: read.session_fingerprint!,
      });
    const states = async () =>
      (await source.read({ pane_id: "w1:p1" })).deliveries.map(
        (delivery) => delivery.state,
      );
    await appendFile(shown, line("user", "Again", 1));
    expect(await states()).toEqual(["matched", "pending"]);
    await appendFile(shown, line("user", "Again", 2));
    expect(await states()).toEqual(["matched", "matched"]);
  });

  test("an older Herdr reply without the session settles nothing by itself", async () => {
    const shown = await transcript("shown-e");
    const other = await transcript("other-e");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    state.onPrompt = () => {
      state.current = claude(other);
      state.replyWith = { pane_id: "w1:p1" };
    };
    expect(
      await source.send({
        pane_id: "w1:p1",
        text: "Run the tests",
        session_fingerprint: read.session_fingerprint!,
      }),
    ).toMatchObject({ status: "sent", delivery: { state: "pending" } });
  });
  test("an old identical message flushed late does not settle a raced send", async () => {
    const shown = await transcript("shown-f");
    const other = await transcript("other-f");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    expect(await sendTo(source)).toMatchObject({
      delivery: { state: "pending" },
    });
    // The shown transcript gets the same words, written before the send.
    await appendFile(shown, line("user", "Run the tests", -60));
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "pending" },
    ]);
    await appendFile(other, line("user", "Run the tests", 1));
    state.current = claude(other);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "misdelivered", evidence: "transcript" },
    ]);
  });

  test("the same words already in the next session are not a misdelivery", async () => {
    const shown = await transcript("shown-g");
    const other = await transcript("other-g");
    await appendFile(other, line("user", "Run the tests", -2));
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    await sendTo(source);
    state.current = claude(other);
    const after = await source.read({ pane_id: "w1:p1" });
    // Still pending for the shown session, with its fingerprint, so Chat
    // shows it as a pane notice here rather than in this conversation.
    expect(after.deliveries).toMatchObject([
      { state: "pending", fingerprint: otherThan(after) },
    ]);
    // It is still checked in its own session after the pane moved on.
    await appendFile(shown, line("user", "Run the tests", 1));
    await source.read({ pane_id: "w1:p1" });
    state.current = claude(shown);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "matched" },
    ]);
  });

  test("the same words typed later in the next session are not a misdelivery", async () => {
    const shown = await transcript("shown-h");
    const other = await transcript("other-h");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    await sendTo(source, "continue");
    state.current = claude(other);
    await appendFile(other, line("user", "continue", 30));
    await source.read({ pane_id: "w1:p1" });
    state.current = claude(shown);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "pending" },
    ]);
  });

  test("a reply that identifies no session is uncertain, not a misdelivery", async () => {
    const shown = await transcript("shown-i");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = { ...claude(shown), agent_session: null };
    };
    expect(await sendTo(source)).toMatchObject({
      delivery: { state: "pending" },
    });
  });

  test("a session the pane passed through is still checked", async () => {
    const shown = await transcript("shown-j");
    const second = await transcript("second-j");
    const third = await transcript("third-j");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    await sendTo(source);
    state.current = claude(second);
    await source.read({ pane_id: "w1:p1" });
    // The pane moves on before the second session's transcript is written.
    state.current = claude(third);
    await source.read({ pane_id: "w1:p1" });
    await appendFile(second, line("user", "Run the tests", 1));
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "misdelivered", delivered_to: "claude session second-j.jsonl" },
    ]);
  });

  test("all slash commands use native admission and retain unchecked receipts across intentional session switches", async () => {
    const shown = await transcript("shown-k");
    const switched = await transcript("command-switch-k");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(switched);
    };
    for (const text of [
      "/compact",
      "  /clear",
      "/review:fast now",
      "/custom.plugin anything",
    ])
      expect(await sendTo(source, text)).toMatchObject({
        status: "sent",
        delivery: { kind: "command", state: "pending" },
      });
    expect(state.prompts).toHaveLength(4);
    expect(
      (await source.read({ pane_id: "w1:p1" })).deliveries?.every(
        (delivery) => delivery.state !== "misdelivered",
      ),
    ).toBe(true);
    const refused = fakeHerdr(claude(shown));
    const ordinary = chat(refused.call);
    for (const text of ["!ls", "# remember this"])
      expect(await sendTo(ordinary, text)).toMatchObject({
        status: "refused",
        reason: "command",
      });
    expect(refused.state.prompts).toEqual([]);
    // A pasted path is a message, not a command word.
    expect(
      await sendTo(ordinary, "/var/log/app.log shows an error; why?"),
    ).toMatchObject({ status: "sent" });
  });

  test("a message admitted while working records native queue provenance", async () => {
    const shown = await transcript("working-queue");
    const { call } = fakeHerdr({ ...claude(shown), agent_status: "working" });
    expect(await sendTo(chat(call), "Next, review the changes")).toMatchObject({
      status: "sent",
      delivery: { queued: true, state: "pending" },
    });
  });

  test("a full pane refuses the next send instead of dropping a notice", async () => {
    const shown = await transcript("shown-l");
    const other = await transcript("other-l");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(other);
    };
    for (let index = 0; index < RECEIPTS_PER_PANE; index += 1)
      await sendTo(source, `Message ${index}`);
    expect(await sendTo(source, "One more")).toMatchObject({
      status: "refused",
      reason: "unsettled",
    });
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.deliveries).toHaveLength(RECEIPTS_PER_PANE);
    expect(read.deliveries[0]).toMatchObject({ text: "Message 0" });
  });

  test("an unreadable transcript is the refusal's reason", async () => {
    const shown = await transcript("shown-m");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    const read = await source.read({ pane_id: "w1:p1" });
    await chmod(shown, 0o000);
    try {
      // A fresh source has nothing cached to fall back on.
      const source = chat(call);
      const result = await source.send({
        pane_id: "w1:p1",
        text: "Run the tests",
        session_fingerprint: read.session_fingerprint!,
      });
      expect(result).toMatchObject({
        status: "refused",
        reason: "unavailable",
      });
      expect(result.status === "refused" && result.message).toContain(
        "Could not read the claude transcript",
      );
    } finally {
      await chmod(shown, 0o644);
    }
    expect(state.prompts).toEqual([]);
  });

  test("over SSH the browser's baseline is used instead of reading again", async () => {
    const shown = await transcript("shown-n");
    const { call } = fakeHerdr(claude(shown));
    const reads: string[] = [];
    const files: AgentSessionFileAccess = {
      ...localAgentSessionFiles,
      remote: true,
      readText: (path) => {
        reads.push(path);
        return localAgentSessionFiles.readText(path);
      },
      clockOffset: async () => ({ offsetMs: 0, uncertaintyMs: 50 }),
    };
    const source = chat(call, files);
    const read = await source.read({ pane_id: "w1:p1" });
    reads.length = 0;
    const result = await source.send({
      pane_id: "w1:p1",
      text: "Run the tests",
      session_fingerprint: read.session_fingerprint!,
      baseline: read.messages
        .filter((message) => message.role === "user")
        .map((message) => message.id),
    });
    expect(result).toMatchObject({ delivery: { state: "pending" } });
    expect(reads).toEqual([]);
  });
});

describe("a copy at about the time of the send", () => {
  test("in the shown session it is uncertain, not settled", async () => {
    const shown = await transcript("shown-o");
    const { call } = fakeHerdr(claude(shown));
    const source = chat(call);
    await sendTo(source);
    // Same words, absent from what Chat showed, stamped 500 ms before.
    await appendFile(shown, line("user", "Run the tests", -0.5));
    const after = await source.read({ pane_id: "w1:p1" });
    expect(after.deliveries).toMatchObject([
      { state: "uncertain", detail: expect.stringContaining("cannot tell") },
    ]);
  });

  test("in the next session it is uncertain, not a misdelivery", async () => {
    const shown = await transcript("shown-p");
    const other = await transcript("other-p");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    await sendTo(source);
    await appendFile(other, line("user", "Run the tests", -0.5));
    state.current = claude(other);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "uncertain" },
    ]);
  });

  test("just after the send it settles or is evidence", async () => {
    const shown = await transcript("shown-q");
    const other = await transcript("other-q");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    await sendTo(source);
    await appendFile(other, line("user", "Run the tests", 0.05));
    state.current = claude(other);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "misdelivered", evidence: "transcript" },
    ]);
  });
});

describe("rev1's probes", () => {
  test("words typed in the shown session after a raced send never settle it", async () => {
    const shown = await transcript("shown-u");
    const other = await transcript("other-u");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    // The text races to the other session while Herdr still reports this one.
    state.onPrompt = () => {
      state.replyWith = claude(shown);
    };
    await sendTo(source);
    // Someone types the same words here 500 ms later.
    await appendFile(shown, line("user", "Run the tests", 0.5));
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "matched" },
    ]);
    // The raced copy is still looked for, and the two cannot be told apart.
    await appendFile(other, line("user", "Run the tests", 0.05));
    state.current = claude(other);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "uncertain", detail: expect.stringContaining("cannot tell") },
    ]);
  });

  test("a check that ends after the agent exits still reaches the browser", async () => {
    const shown = await transcript("shown-v");
    const { state, call } = fakeHerdr(claude(shown));
    jest.useFakeTimers();
    try {
      let ended = false;
      const source = createHerdrConversationSource({
        herdrCall: call,
        files: localAgentSessionFiles,
        context: createAgentSessionResolverContext(),
        cache: createSessionProjectionCache(localAgentSessionFiles),
        onDeliveriesChanged: () => {
          ended = true;
        },
      });
      await sendTo(source);
      // The agent exits: Herdr sees no agent in the pane.
      state.current = { pane_id: "w1:p1" };
      const before = await source.identity({ pane_id: "w1:p1" });
      jest.advanceTimersByTime(DELIVERY_CHECK_MS + 2000);
      for (let tick = 0; tick < 5000 && !ended; tick += 1)
        await new Promise((resolve) => setImmediate(resolve));
      expect(ended).toBe(true);
      const after = await source.identity({ pane_id: "w1:p1" });
      expect(after.key).not.toBe(before.key);
      source.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("when Chat can no longer check", () => {
  test("a departed session whose transcript is gone is unverified", async () => {
    const shown = await transcript("shown-r");
    const other = await transcript("other-r");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    await sendTo(source);
    state.current = claude(other);
    await rename(shown, `${shown}.moved`);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toMatchObject([
      { state: "unverified", detail: expect.stringContaining("cannot read") },
    ]);
  });

  test("the deadline ends the check with no read, and tells watchers", async () => {
    const shown = await transcript("shown-s");
    const { call } = fakeHerdr(claude(shown));
    let changed = 0;
    jest.useFakeTimers();
    try {
      const source = createHerdrConversationSource({
        herdrCall: call,
        files: localAgentSessionFiles,
        context: createAgentSessionResolverContext(),
        cache: createSessionProjectionCache(localAgentSessionFiles),
        onDeliveriesChanged: () => {
          changed += 1;
        },
      });
      await sendTo(source);
      jest.advanceTimersByTime(DELIVERY_CHECK_MS + 2000);
      for (let tick = 0; tick < 5000 && changed === 0; tick += 1)
        await new Promise((resolve) => setImmediate(resolve));
      expect(changed).toBe(1);
      expect(
        (await source.read({ pane_id: "w1:p1" })).deliveries,
      ).toMatchObject([{ state: "unverified" }]);
      source.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a failed SSH clock reading refuses in plain words", async () => {
    const shown = await transcript("shown-t");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call, {
      ...localAgentSessionFiles,
      remote: true,
      clockOffset: async () => {
        throw new Error("ssh: connect timed out");
      },
    });
    expect(await sendTo(source)).toMatchObject({
      status: "refused",
      message: expect.stringContaining("clock"),
    });
    expect(state.prompts).toEqual([]);
  });
});

describe("the delivery ledger", () => {
  const send = {
    text: "yes",
    fingerprint: "A",
    expected: "session A",
    baseline: [],
    clock: { offsetMs: 0, uncertaintyMs: 0 },
    startedAt: 1_000_000,
    endedAt: 1_000_100,
  };
  const said = (text: string, at: number) => ({
    id: `${text}:${at}`,
    role: "user" as const,
    kind: "message" as const,
    text,
    sent_at: new Date(at).toISOString(),
  });

  test("a session Chat cannot read after the pane left it is unverified", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", send);
    ledger.evaluate("p", "B", [
      { fingerprint: "A", label: "", messages: null },
    ]);
    expect(ledger.list("p")).toMatchObject([
      { state: "unverified", detail: expect.stringContaining("session A") },
    ]);
  });

  test("a full pane of matched receipts still being checked refuses, then keeps checking", () => {
    const ledger = createDeliveryLedger();
    const sends = Array.from({ length: RECEIPTS_PER_PANE }, (_, index) => ({
      ...send,
      text: `Message ${index}`,
      startedAt: send.startedAt + index,
      endedAt: send.endedAt + index,
    }));
    for (const each of sends) ledger.record("p", each);
    // Every message appears in its own session: all matched, still checked.
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: sends.map((each) => said(each.text, each.endedAt + 50)),
        },
      ],
      send.endedAt + 1000,
    );
    expect(ledger.list("p").every((item) => item.state === "matched")).toBe(
      true,
    );
    expect(ledger.full("p", send.endedAt + 1000)).toBe(true);
    // The first message then turns up first thing in the next session.
    ledger.evaluate(
      "p",
      "B",
      [
        {
          fingerprint: "B",
          label: "session B",
          messages: [said("Message 0", send.endedAt + 60)],
        },
      ],
      send.endedAt + 2000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      text: "Message 0",
      state: "uncertain",
    });
    // Once their window ends, matched receipts make room.
    expect(ledger.full("p", send.startedAt + DELIVERY_CHECK_MS + 1000)).toBe(
      false,
    );
    ledger.record("p", {
      ...send,
      text: "Later",
      startedAt: send.startedAt + DELIVERY_CHECK_MS + 1000,
      endedAt: send.startedAt + DELIVERY_CHECK_MS + 1100,
    });
    expect(ledger.list("p")).toHaveLength(RECEIPTS_PER_PANE);
    expect(ledger.list("p")[0]).toMatchObject({ text: "Message 0" });
    expect(ledger.list("p").at(-1)).toMatchObject({ text: "Later" });
  });

  test("a sent attachment matches the harness's record of it", () => {
    const upload = "/tmp/herdr-world-uploads-test/upload-ab12/img-1-x.png";
    const cases = [
      // Claude Code records an image path as a placeholder.
      [`Look at this ${upload} `, "[Image #16]Look at this"],
      [`Look at ${upload} and fix it`, "Look at [Image #2] and fix it"],
      // A quoted path, kept as typed by a harness that does not convert it.
      [`Read '${upload}' please`, `Read '${upload}' please`],
      // An attachment alone.
      [`${upload} `, "[Image #3]"],
      // Multi-line input, rewrapped by the harness.
      ["First line\nsecond line\n\nthird", "First line\r\nsecond line third"],
      // Long input Claude Code records as a paste placeholder, with words.
      [
        `Please review\n${"x".repeat(10)}`,
        `Please review [Pasted text #1 +1 lines] ${"x".repeat(10)}`,
      ],
    ];
    for (const [sent, recorded] of cases) {
      const ledger = createDeliveryLedger();
      ledger.record("p", { ...send, text: sent! });
      ledger.evaluate(
        "p",
        "A",
        [
          {
            fingerprint: "A",
            label: "session A",
            messages: [said(recorded!, send.endedAt + 50)],
          },
        ],
        send.endedAt + 1000,
      );
      expect([sent, ledger.list("p")[0]?.state]).toEqual([sent, "matched"]);
    }
    // Different words: no match by words; see the order tests below.
    const ledger = createDeliveryLedger();
    ledger.record("p", { ...send, text: `Look at this ${upload}` });
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: [said("[Image #1]Look at that", send.endedAt + 50)],
        },
      ],
      send.endedAt + 1000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      state: "matched",
      matched_by: "order",
    });
  });

  test("a multi-line send to an idle agent matches its turn even when the harness rewrites it", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", { ...send, text: "Line one\nline two\nline three" });
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: [
            said("Earlier, before the send", send.startedAt - 5000),
            said("[Pasted text #1 +2 lines]", send.endedAt + 50),
          ],
        },
      ],
      send.endedAt + 1000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      state: "matched",
      matched_by: "order",
      matched_id: `[Pasted text #1 +2 lines]:${send.endedAt + 50}`,
    });
  });

  test("a send queued while the agent works waits, then matches when the turn is written", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", { ...send, text: "Also check the docs" });
    // Mid-turn: the agent keeps replying, but the queued message is not in
    // the transcript yet. Replies are not user turns, so it stays pending.
    const reply = {
      id: "r1",
      role: "assistant" as const,
      kind: "message" as const,
      text: "Still working on the first task",
      sent_at: new Date(send.endedAt + 2000).toISOString(),
    };
    ledger.evaluate(
      "p",
      "A",
      [{ fingerprint: "A", label: "session A", messages: [reply] }],
      send.endedAt + 3000,
    );
    expect(ledger.list("p")[0]?.state).toBe("pending");
    // The agent takes it up: the turn is written then, after the replies.
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: [reply, said("Also check the docs", send.endedAt + 60_000)],
        },
      ],
      send.endedAt + 61_000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      state: "matched",
      matched_by: "words",
    });
  });

  test("a multi-line send matches Claude Code's pasted_content record of it by its words", () => {
    const ledger = createDeliveryLedger();
    const sent = "Please check:\n- the build\n- the docs";
    ledger.record("p", { ...send, text: sent });
    const recorded = `<pasted_content id="4821">\n${sent}\n</pasted_content id="4821">`;
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: [said(recorded, send.endedAt + 50)],
        },
      ],
      send.endedAt + 1000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      state: "matched",
      matched_by: "words",
    });
  });

  test("a send carries its time on the transcript host's clock", () => {
    for (const offsetMs of [-60_000, 60_000]) {
      const ledger = createDeliveryLedger();
      ledger.record("p", { ...send, clock: { offsetMs, uncertaintyMs: 0 } });
      expect(ledger.list("p")[0]).toMatchObject({
        sent_at: new Date(send.startedAt).toISOString(),
        transcript_at: new Date(send.startedAt + offsetMs).toISOString(),
      });
    }
  });

  test("an unrelated later prompt never settles a send by order", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", { ...send, text: "Run all tests" });
    const view = (messages: ReturnType<typeof said>[]) => [
      { fingerprint: "A", label: "session A", messages },
    ];
    // Another client types something else in the same session.
    ledger.evaluate(
      "p",
      "A",
      view([said("Summarize the README instead", send.endedAt + 2000)]),
      send.endedAt + 3000,
    );
    expect(ledger.list("p")[0]?.state).toBe("pending");
    // A harness that trims or wraps the words still matches, by order.
    ledger.evaluate(
      "p",
      "A",
      view([
        said("Summarize the README instead", send.endedAt + 2000),
        said("Please: Run all tests now", send.endedAt + 4000),
      ]),
      send.endedAt + 5000,
    );
    expect(ledger.list("p")[0]).toMatchObject({
      state: "matched",
      matched_by: "order",
      matched_id: `Please: Run all tests now:${send.endedAt + 4000}`,
    });
  });

  test("two sends take their turns by words first, then in order", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", { ...send, text: "first\nmulti" });
    ledger.record("p", {
      ...send,
      text: "second",
      startedAt: send.startedAt + 10,
      endedAt: send.endedAt + 10,
    });
    ledger.evaluate(
      "p",
      "A",
      [
        {
          fingerprint: "A",
          label: "session A",
          messages: [
            said("[Pasted text #1 +1 lines]", send.endedAt + 50),
            said("second", send.endedAt + 60),
          ],
        },
      ],
      send.endedAt + 1000,
    );
    expect(ledger.list("p").map((item) => item.matched_by)).toEqual([
      "order",
      "words",
    ]);
  });

  test("the check ends after its window", () => {
    const ledger = createDeliveryLedger();
    ledger.record("p", send);
    ledger.evaluate("p", "A", [], send.startedAt + DELIVERY_CHECK_MS + 1);
    expect(ledger.list("p")).toMatchObject([{ state: "unverified" }]);
  });

  test("the transcript host's clock is used, not ours", () => {
    // The host runs a minute behind: its copy is stamped before our send.
    const ledger = createDeliveryLedger();
    ledger.record("p", {
      ...send,
      clock: { offsetMs: -60_000, uncertaintyMs: 200 },
    });
    ledger.evaluate(
      "p",
      "B",
      [
        {
          fingerprint: "B",
          label: "session B",
          messages: [said("yes", 940_200)],
        },
      ],
      1_000_200,
    );
    expect(ledger.list("p")).toMatchObject([
      { state: "misdelivered", delivered_to: "session B" },
    ]);
  });
});

describe("durable record submission uses Chat's existing guarded path", () => {
  test("a denied durable admission sends no input", async () => {
    const path = await transcript("durable-denied");
    const { state, call } = fakeHerdr(claude(path));
    const source = chat(call);
    try {
      const read = await source.read({ pane_id: "w1:p1" });
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "Answer to q-fixture: Proceed",
          session_fingerprint: read.session_fingerprint!,
          beforeSubmit: async () => false,
        }),
      ).toMatchObject({ status: "refused", reason: "changed" });
      expect(state.prompts).toEqual([]);
    } finally {
      source.dispose();
    }
  });
  test("the native session is checked again after awaiting durable admission", async () => {
    const path = await transcript("durable-before");
    const other = await transcript("durable-after");
    const { state, call } = fakeHerdr(claude(path));
    const source = chat(call);
    try {
      const read = await source.read({ pane_id: "w1:p1" });
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "Answer to q-fixture: Proceed",
          session_fingerprint: read.session_fingerprint!,
          beforeSubmit: async () => {
            await Promise.resolve();
            state.current = claude(other);
            return true;
          },
        }),
      ).toMatchObject({ status: "refused", reason: "changed" });
      expect(state.prompts).toEqual([]);
    } finally {
      source.dispose();
    }
  });
  test("final lease guard and actual native queued-recipient evidence stay distinct", async () => {
    const path = await transcript("durable-queued");
    const { state, call } = fakeHerdr(claude(path));
    const source = chat(call);
    try {
      const read = await source.read({ pane_id: "w1:p1" });
      let admitted = false;
      let evidence: string | null | undefined;
      const target = {
        pane_id: "w1:p1",
        text: "Answer to q-fixture: /compact\n!pwd\n# remember",
        session_fingerprint: read.session_fingerprint!,
        beforeSubmit: async () => {
          admitted = true;
          return true;
        },
      };
      expect(
        await source.send({ ...target, guard: () => false }),
      ).toMatchObject({ status: "refused", reason: "changed" });
      expect(state.prompts).toEqual([]);
      state.onPrompt = () => {
        expect(admitted).toBe(true);
      };
      expect(
        await source.send({
          ...target,
          guard: (info) => info.pane_id === "w1:p1",
          submitted: (fingerprint) => {
            evidence = fingerprint;
          },
        }),
      ).toMatchObject({ status: "sent" });
      expect(evidence).toBe(read.session_fingerprint);
      expect(state.prompts).toHaveLength(1);
    } finally {
      source.dispose();
    }
  });
});
