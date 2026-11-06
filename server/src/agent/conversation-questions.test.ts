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

function fakeHerdr(
  options: { cacheFailure?: boolean; resolveFailure?: boolean } = {},
) {
  const state = {
    session: true,
    screen: QUESTION,
    sent: [] as string[],
    onRead: () => {},
  };
  let reads = 0;
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
    if (method === "pane.read") {
      reads += 1;
      state.onRead();
      return { read: { text: state.screen } };
    }
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
  const cache = createSessionProjectionCache(localAgentSessionFiles);
  const originalGet = cache.get;
  const originalInvalidate = cache.invalidate;
  let invalidations = 0;
  cache.get = async (...args) => {
    if (options.cacheFailure && reads > 0)
      throw new Error("synthetic cache failure");
    return originalGet(...args);
  };
  cache.invalidate = (...args) => {
    invalidations += 1;
    return originalInvalidate(...args);
  };
  const source = createHerdrConversationSource({
    herdrCall: call,
    files: options.resolveFailure
      ? {
          ...localAgentSessionFiles,
          statFile: async (
            ...args: Parameters<typeof localAgentSessionFiles.statFile>
          ) => {
            if (reads > 0) throw new Error("synthetic resolver failure");
            return localAgentSessionFiles.statFile(...args);
          },
        }
      : localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache,
  });
  return { state, source, invalidations: () => invalidations };
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
  // Claude appends: the first call gets its result and another is asked. (An
  // in-place rewrite of equal size within one mtime tick is not a change
  // the shared projection cache can see, and is not how transcripts change.)
  await writeFile(
    transcript,
    ask([COLOR]) +
      [
        {
          type: "user",
          timestamp: "2026-11-05T10:00:02.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_ask",
                content: "Interrupted",
              },
            ],
          },
        },
        {
          type: "assistant",
          timestamp: "2026-11-05T10:00:03.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_ask_2",
                name: "AskUserQuestion",
                input: { questions: [COLOR] },
              },
            ],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") +
      "\n",
  );
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
  expect(
    await source.send({
      pane_id: "w1:p1",
      text: "confirm",
      session_fingerprint: read.pending_prompt!.fingerprint,
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

test("rejected asks remain Terminal-only through the conversation source", async () => {
  for (const changed of [
    {
      ...COLOR,
      options: [
        { label: "Red", description: "x".repeat(2001) },
        COLOR.options[1],
      ],
    },
    { ...COLOR, question: "x".repeat(2001), multiSelect: true },
    { ...COLOR, header: "x".repeat(2001) },
    { ...COLOR, multiSelect: "true" },
  ]) {
    await writeFile(transcript, ask([changed]));
    const { source, state } = fakeHerdr();
    if (
      typeof changed.options?.[0]?.description === "string" &&
      changed.options[0].description.length > 2000
    )
      state.screen = QUESTION.replace("     Warm color\n", "");
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt!.options).toEqual([]);
    expect(read.pending_prompt!.unanswerable).toContain("limits");
    expect(
      await source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: read.pending_prompt!.fingerprint,
      }),
    ).toMatchObject({ status: "refused" });
    expect(state.sent).toEqual([]);
    source.dispose();
  }
});

test("a failed transcript join keeps the screen prompt and invalidates the cache", async () => {
  await writeFile(transcript, ask([COLOR]));
  for (const options of [{ cacheFailure: true }, { resolveFailure: true }]) {
    const { source, invalidations } = fakeHerdr(options);
    const read = await source.read({ pane_id: "w1:p1" });
    expect(read.pending_prompt!.question).toEqual([COLOR.question]);
    expect(read.pending_prompt!.options.map((option) => option.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    if (options.cacheFailure) expect(invalidations()).toBeGreaterThan(0);
    source.dispose();
  }
});

test("trust shares the source input lock with native answer, press and send", async () => {
  const { source, state } = fakeHerdr();
  state.session = false;
  state.screen = TRUST;
  const prompt = (await source.read({ pane_id: "w1:p1" })).pending_prompt!;
  const others: Promise<unknown>[] = [];
  state.onRead = () => {
    state.onRead = () => {};
    others.push(
      source.answer({
        pane_id: "w1:p1",
        key: "1",
        prompt_fingerprint: prompt.fingerprint,
      }),
      source.press({
        pane_id: "w1:p1",
        key: "enter",
        session_fingerprint: prompt.fingerprint,
      }),
      source.send({
        pane_id: "w1:p1",
        text: "confirm",
        session_fingerprint: prompt.fingerprint,
      }),
      source.trust!({
        pane_id: "w1:p1",
        choice: "confirm",
        prompt_fingerprint: prompt.fingerprint,
      }),
    );
  };
  expect(
    await source.trust!({
      pane_id: "w1:p1",
      choice: "cancel",
      prompt_fingerprint: prompt.fingerprint,
    }),
  ).toMatchObject({ status: "sent" });
  for (const result of await Promise.all(others))
    expect(result).toMatchObject({ status: "refused", reason: "busy" });
  expect(state.sent).toEqual(["enter"]);
  source.dispose();
});
