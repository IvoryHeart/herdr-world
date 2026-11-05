import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// Chat reads Claude's question from its transcript and answers it only on the
// matching screen; before Claude has a session, only its trust question is
// offered, under the pre-session witness. Synthetic transcript and screens.
const QUESTION = readFileSync(
  new URL("./fixtures/pending-prompts/claude-question.txt", import.meta.url),
  "utf8",
);
const TRUST = [
  "────────────────────────────────",
  " Accessing workspace:",
  "",
  " /work/example",
  "",
  " Quick safety check: Is this a project you created or one you trust?",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
].join("\n");

let root = "";
let transcript = "";
const ask = (questions: unknown) =>
  [
    {
      type: "user",
      timestamp: "2026-11-05T10:00:00.000Z",
      message: { role: "user", content: "Make the badge" },
    },
    {
      type: "assistant",
      timestamp: "2026-11-05T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_ask",
            name: "AskUserQuestion",
            input: { questions },
          },
        ],
      },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n") + "\n";
const COLOR = {
  question: "Which color should the badge use?",
  header: "Color",
  options: [
    { label: "Red", description: "Warm color" },
    { label: "Blue", description: "Cool color" },
  ],
  multiSelect: false,
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-questions-"));
  transcript = join(root, "demo.jsonl");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeHerdr() {
  const state = {
    session: true,
    screen: QUESTION,
    sent: [] as string[],
  };
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get")
      return {
        agent: {
          pane_id: "w1:p1",
          agent: "claude",
          agent_status: "blocked",
          terminal_id: "t1",
          state_change_seq: 3,
          terminal_title: "claude",
          ...(state.session
            ? {
                agent_session: {
                  source: "herdr:claude",
                  agent: "claude",
                  kind: "path",
                  value: transcript,
                },
              }
            : {}),
        },
      };
    if (method === "pane.read") return { read: { text: state.screen } };
    if (method === "pane.process_info")
      return {
        process_info: {
          foreground_process_group_id: 77,
          foreground_processes: [{ pid: 77, name: "claude" }],
        },
      };
    if (method === "pane.send_input") {
      state.sent.push(...(params as { keys: string[] }).keys);
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

test("a matching screen answers the transcript's question with its key", async () => {
  await writeFile(transcript, ask([COLOR]));
  const { state, source } = fakeHerdr();
  const read = await source.read({ pane_id: "w1:p1" });
  expect(read.pending_prompt).toMatchObject({
    question: ["Which color should the badge use?"],
    asked: { call_id: "toolu_ask", current: 0 },
  });
  expect(read.pending_prompt!.options.map((option) => option.key)).toEqual([
    "1",
    "2",
    "3",
    "4",
  ]);
  const result = await source.answer({
    pane_id: "w1:p1",
    key: "2",
    prompt_fingerprint: read.pending_prompt!.fingerprint,
  });
  expect(result).toMatchObject({ status: "sent", label: "Blue" });
  expect(state.sent).toEqual(["2"]);
});

test("a question the screen does not show is read whole and never answered", async () => {
  await writeFile(
    transcript,
    ask([{ ...COLOR, options: [...COLOR.options, { label: "Gold" }] }]),
  );
  const { state, source } = fakeHerdr();
  const read = await source.read({ pane_id: "w1:p1" });
  expect(read.pending_prompt).toMatchObject({
    options: [],
    asked: { current: 0 },
  });
  expect(read.pending_prompt!.unanswerable).toBeString();
  // A key the screen offered is refused: the question Chat showed has none.
  expect(
    await source.answer({
      pane_id: "w1:p1",
      key: "1",
      prompt_fingerprint: read.pending_prompt!.fingerprint,
    }),
  ).toMatchObject({ status: "refused" });
  // The transcript changing under a matched prompt refuses its answer too.
  await writeFile(transcript, ask([COLOR]));
  const matched = await source.read({ pane_id: "w1:p1" });
  await writeFile(transcript, ask([{ ...COLOR, header: "Shade" }]));
  expect(
    await source.answer({
      pane_id: "w1:p1",
      key: "1",
      prompt_fingerprint: matched.pending_prompt!.fingerprint,
    }),
  ).toMatchObject({ status: "refused", reason: "changed" });
  expect(state.sent).toEqual([]);
});

test("the trust question is offered before a session, and never after", async () => {
  const { state, source } = fakeHerdr();
  state.session = false;
  state.screen = TRUST;
  const read = await source.read({ pane_id: "w1:p1" });
  expect(read.status).toBe("unavailable");
  expect(read.pending_prompt).toMatchObject({ trust: { cursor: "cancel" } });
  // Neither the question path nor the session-bound key path takes it.
  expect(
    await source.answer({
      pane_id: "w1:p1",
      key: "cancel",
      prompt_fingerprint: read.pending_prompt!.fingerprint,
    }),
  ).toMatchObject({ status: "refused" });
  expect(
    await source.press({
      pane_id: "w1:p1",
      key: "enter",
      session_fingerprint: "",
      menu_fingerprint: read.pending_prompt!.fingerprint,
    }),
  ).toMatchObject({ status: "refused" });
  expect(state.sent).toEqual([]);
  expect(
    await source.trust!({
      pane_id: "w1:p1",
      prompt_fingerprint: read.pending_prompt!.fingerprint,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "sent", label: "No, exit" });
  expect(state.sent).toEqual(["enter"]);
  // With a session, the same screen is not a pre-session question.
  state.session = true;
  await writeFile(transcript, ask([COLOR]));
  expect(
    (await source.read({ pane_id: "w1:p1" })).pending_prompt?.trust,
  ).toBeUndefined();
});
