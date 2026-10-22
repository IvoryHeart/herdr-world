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

function fakeHerdr() {
  const state = {
    status: "blocked",
    screen: PROMPT,
    sent: [] as unknown[],
  };
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get")
      return {
        agent: {
          pane_id: "w1:p1",
          agent: "claude",
          agent_status: state.status,
          terminal_title: "claude",
          agent_session: {
            source: "herdr:claude",
            agent: "claude",
            kind: "path",
            value: transcript,
          },
        },
      };
    if (method === "pane.read")
      return { read: { pane_id: "w1:p1", text: state.screen } };
    if (method === "pane.send_input") {
      state.sent.push(params);
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

describe("answering a blocked agent's prompt", () => {
  test("a read of a blocked agent carries its prompt", async () => {
    const { source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt).toMatchObject({
      question: ["Do you want to proceed?"],
      command: "git push -u origin agent/demo",
      options: [
        { key: "1", label: "Yes" },
        { key: "2", label: "Yes, and don't ask again" },
        { key: "3", label: "No, and tell Claude what to do" },
      ],
    });
  });

  test("an answer presses that option's key, without Enter", async () => {
    const { state, source } = fakeHerdr();
    const read = await source.read({ pane_id: "w1:p1" });
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "2",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toEqual({
      status: "answered",
      key: "2",
      label: "Yes, and don't ask again",
    });
    expect(state.sent).toEqual([{ pane_id: "w1:p1", text: "2", keys: [] }]);
  });

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
    const read = await source.read({ pane_id: "w1:p1" });
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "9",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused", reason: "unknown_option" });
    expect(state.sent).toEqual([]);
  });

  test("a working agent's read has no prompt and reads no screen", async () => {
    const { state, source } = fakeHerdr();
    state.status = "working";
    state.screen = "should not be read";
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt).toBeNull();
  });
});
