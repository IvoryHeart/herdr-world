import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  test("no switch: the message is pending until the shown transcript has it", async () => {
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
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toEqual([]);
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
    await appendFile(shown, line("user", "Again", 1));
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toHaveLength(
      1,
    );
    await appendFile(shown, line("user", "Again", 2));
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toEqual([]);
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
    // Pending belongs to the shown session, so the next one lists nothing.
    expect(after.deliveries).toEqual([]);
    // It is still checked in its own session after the pane moved on.
    await appendFile(shown, line("user", "Run the tests", 1));
    await source.read({ pane_id: "w1:p1" });
    state.current = claude(shown);
    expect((await source.read({ pane_id: "w1:p1" })).deliveries).toEqual([]);
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

  test("commands Chat cannot check are refused before Herdr sees them", async () => {
    const shown = await transcript("shown-k");
    const { state, call } = fakeHerdr(claude(shown));
    const source = chat(call);
    for (const text of ["/compact", "  /clear", "!ls", "# remember this"])
      expect(await sendTo(source, text)).toMatchObject({
        status: "refused",
        reason: "command",
      });
    expect(state.prompts).toEqual([]);
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
