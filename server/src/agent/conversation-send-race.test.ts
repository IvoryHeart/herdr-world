import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
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

function chat(call: HerdrCall) {
  return createHerdrConversationSource({
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
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
      text: "Run   the tests",
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
});
