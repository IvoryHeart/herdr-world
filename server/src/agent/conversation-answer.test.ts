import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// A blocked agent's question is read from its screen, and Chat answers it by
// pressing one option's key, only while the agent still shows that question.

const PROMPT = [
  "╭────────────────────────────────────────╮",
  "│ Bash command                           │",
  "│                                        │",
  "│   git push -u origin agent/demo        │",
  "│                                        │",
  "│ Do you want to proceed?                │",
  "│ ❯ 1. Yes                               │",
  "│   2. Yes, and don't ask again          │",
  "│   3. No, and tell Claude what to do    │",
  "╰────────────────────────────────────────╯",
].join("\n");

let root = "";
let transcript = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-answer-"));
  transcript = join(root, "demo.jsonl");
  await writeFile(
    transcript,
    `${JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Push the branch" },
    })}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeHerdr(agent = "claude") {
  const state = {
    status: "blocked",
    screen: PROMPT,
    seq: 3,
    session: transcript,
    sent: [] as unknown[],
    /** Runs during each screen read, as a change racing Chat's check. */
    onRead: () => {},
    /** Runs when a key is pressed, as the agent reacting to it. */
    onSend: () => {},
  };
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get")
      return {
        agent: {
          pane_id: "w1:p1",
          agent,
          agent_status: state.status,
          state_change_seq: state.seq,
          terminal_title: agent,
          agent_session: {
            source: `herdr:${agent}`,
            agent,
            kind: "path",
            value: state.session,
          },
        },
      };
    if (method === "pane.read") {
      const text = state.screen;
      state.onRead();
      return { read: { pane_id: "w1:p1", text } };
    }
    if (method === "pane.send_input") {
      state.sent.push(params);
      state.onSend();
      return {};
    }
    throw new Error(`unexpected ${method}`);
  };
  const source = createHerdrConversationSource({
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  return { state, source };
}

const answer = async (
  source: ReturnType<typeof fakeHerdr>["source"],
  key: string,
) => {
  const read = await source.read({ pane_id: "w1:p1" });
  return source.answer({
    pane_id: "w1:p1",
    key,
    prompt_fingerprint: read.pending_prompt!.fingerprint,
  });
};

describe("answering a blocked agent's prompt", () => {
  test("a read of a blocked agent carries its whole request and options", async () => {
    const { source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt).toMatchObject({
      question: ["Do you want to proceed?"],
      request: ["Bash command", "git push -u origin agent/demo"],
      options: [
        { number: "1", label: "Yes", key: "1" },
        { number: "2", label: "Yes, and don't ask again", key: "2" },
        { number: "3", label: "No, and tell Claude what to do", key: "3" },
      ],
    });
  });

  test("an answer presses the key, and says whether the agent moved on", async () => {
    const { state, source } = fakeHerdr();
    expect(await answer(source, "2")).toMatchObject({
      status: "sent",
      number: "2",
      label: "Yes, and don't ask again",
      acknowledged: false,
      unconfirmed_reason: "still_showing",
    });
    expect(state.sent).toEqual([{ pane_id: "w1:p1", text: "2", keys: [] }]);
    const moving = fakeHerdr();
    moving.state.onSend = () => {
      moving.state.status = "working";
      moving.state.seq += 1;
    };
    expect(await answer(moving.source, "1")).toMatchObject({
      status: "sent",
      acknowledged: true,
      unconfirmed_reason: null,
    });
  });

  test("a next question after the key is the agent moving on", async () => {
    const { state, source } = fakeHerdr();
    state.onSend = () => {
      state.seq += 2;
      state.screen = PROMPT.replace("agent/demo", "agent/next");
    };
    expect(await answer(source, "1")).toMatchObject({
      acknowledged: true,
      unconfirmed_reason: null,
    });
  });

  // Without evidence that this agent left this prompt, a sent key is never
  // reported as answered.
  test.each([
    [
      "Herdr no longer reports the agent",
      "agent_missing",
      (state: ReturnType<typeof fakeHerdr>["state"]) => {
        state.status = "";
      },
    ],
    [
      "the pane has another session",
      "session_changed",
      (state: ReturnType<typeof fakeHerdr>["state"]) => {
        state.session = `${transcript}.replacement`;
        state.status = "working";
      },
    ],
    [
      "the screen cannot be read",
      "unreadable",
      (state: ReturnType<typeof fakeHerdr>["state"]) => {
        state.screen = "";
        state.seq += 1;
      },
    ],
    [
      "only Herdr's state changed",
      "still_showing",
      (state: ReturnType<typeof fakeHerdr>["state"]) => {
        state.seq += 1;
      },
    ],
  ] as const)(
    "%s: the answer stays unconfirmed",
    async (_name, reason, after) => {
      const { state, source } = fakeHerdr();
      state.onSend = () => after(state);
      expect(await answer(source, "1")).toMatchObject({
        status: "sent",
        acknowledged: false,
        unconfirmed_reason: reason,
      });
      expect(state.sent).toHaveLength(1);
    },
  );

  test("a question that changed since Chat showed it is not answered", async () => {
    const { state, source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    state.screen = PROMPT.replace("agent/demo", "agent/other");
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(state.sent).toEqual([]);
  });

  test("the same-looking prompt in a replacement session is not answered", async () => {
    const { state, source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    state.session = `${transcript}.replacement`;
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(state.sent).toEqual([]);
  });

  test("an agent that leaves the prompt while Chat checks it is not answered", async () => {
    const { state, source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    state.onRead = () => {
      state.status = "working";
      state.seq += 1;
    };
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(state.sent).toEqual([]);
  });

  test("an agent that is no longer waiting is not answered", async () => {
    const { state, source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    state.status = "working";
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "not_blocked" });
    expect(state.sent).toEqual([]);
  });

  test("only the prompt's own options are pressed", async () => {
    const { state, source } = fakeHerdr();
    expect(await answer(source, "9")).toMatchObject({
      status: "refused",
      reason: "unknown_option",
    });
    expect(state.sent).toEqual([]);
  });

  test("Codex's esc option presses Escape", async () => {
    const { state, source } = fakeHerdr("codex");
    state.screen = [
      "Would you like to run the following command?",
      "",
      "$ git push",
      "",
      "› 1. Yes, proceed (y)",
      "  2. No, and tell Codex what to do differently (esc)",
    ].join("\n");
    expect(await answer(source, "escape")).toMatchObject({ status: "sent" });
    expect(state.sent).toEqual([
      { pane_id: "w1:p1", text: "", keys: ["escape"] },
    ]);
  });

  test("a working agent's read has no prompt", async () => {
    const { state, source } = fakeHerdr();
    state.status = "working";
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt).toBeNull();
  });
});
