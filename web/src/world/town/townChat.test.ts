import { expect, spyOn, test } from "bun:test";
import { bridge, type ConnectionClient } from "../../api";
import type { WorldLeafObject } from "../worldObject";
import { sendTownReply, townChoices, townQuestion } from "./townChat";

test("Town and Board replies use guarded input on only the leaf's current owner", async () => {
  const leaf = {
    connectionId: "peek-owner",
    generation: 7,
    pane: { pane_id: "w1:p1" },
  } as WorldLeafObject;
  const calls: unknown[] = [];
  let current = true;
  let failure: Error | null = null;
  const client = {
    connectionId: leaf.connectionId,
    serverRuntimeGeneration: leaf.generation,
    isCurrent: () => current,
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (failure) throw failure;
      return {};
    },
  } as ConnectionClient;
  const owner = spyOn(bridge, "connection").mockImplementation(
    (id, generation) => {
      expect([id, generation]).toEqual([leaf.connectionId, leaf.generation]);
      return client;
    },
  );
  try {
    await sendTownReply(leaf, "rm the tmp dir\nplease", true);
    await sendTownReply(leaf, "1", false);
    expect(calls).toEqual([
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p1",
          text: "rm the tmp dir\rplease",
          keys: ["enter"],
          agent_input: true,
        },
      },
      {
        method: "pane.send_input",
        params: {
          pane_id: "w1:p1",
          text: "1",
          keys: [],
          agent_input: true,
        },
      },
    ]);
    failure = new Error(
      "agent_not_ready: It is a shell now. Nothing was sent.",
    );
    await expect(sendTownReply(leaf, "unsent reply", true)).rejects.toBe(
      failure,
    );
    expect(calls).toHaveLength(3); // no raw-input fallback or retry
    current = false;
    await expect(sendTownReply(leaf, "retired reply", true)).rejects.toThrow(
      "host changed",
    );
    expect(calls).toHaveLength(3);
  } finally {
    owner.mockRestore();
  }
});

const screen = [
  "● Updated the queue so the oldest agent waits first.",
  "  src/queue.ts  +18 -6",
  "Do you want to make this edit to",
  "src/queue.ts?",
  "❯ 1. Yes",
  "  2. No, and tell the agent what to do differently (esc)",
];

test("a waiting agent's question is split from its earlier chatter", () => {
  expect(townQuestion(screen, true)).toEqual({
    chatter: screen.slice(0, 2),
    question: ["Do you want to make this edit to", "src/queue.ts?"],
  });
  expect(townQuestion(screen, false).question).toEqual(screen.slice(2));
});

test("chatter without a question has no question box", () => {
  const lines = ["● Reading src/rooms.ts", "✻ Thinking…"];
  expect(townQuestion(lines, true)).toEqual({ chatter: lines, question: [] });
});

test("answers come only from the active menu at the bottom", () => {
  expect(
    townChoices([
      "Do you want to make this edit?",
      "❯ 1. Yes",
      "  2. No, and tell the agent what to do differently (esc)",
      "Esc to cancel",
    ]).map((choice) => choice.key),
  ).toEqual(["1", "2"]);
  // A later question supersedes an earlier menu.
  expect(
    townChoices([
      "1. Delete files",
      "2. Keep files",
      "What branch name should I use?",
    ]),
  ).toEqual([]);
  // Later prompts that are indented or use a key word are not menu chrome.
  for (const later of [
    "Please select a branch name?",
    "  What branch name should I use?",
    "Enter a branch name:",
    "Enter a name to continue",
    "     Type a branch name",
    "     Reading src/queue.ts",
  ])
    expect(townChoices(["1. Delete files", "2. Keep files", later])).toEqual(
      [],
    );
  // An earlier option's wrap and a key hint keep the menu active.
  expect(
    townChoices([
      "❯ 1. Yes, and don't ask again for edits in",
      "     this project",
      "  2. No",
      "↑/↓ to navigate · Enter to select",
    ]).map((choice) => choice.key),
  ).toEqual(["1", "2"]);
  // A later prompt or output supersedes a y/n question too.
  for (const later of [
    "What branch name should I use?",
    "Reading src/queue.ts",
    "     Type a branch name",
  ])
    expect(townChoices(["Overwrite the file? (y/n)", later])).toEqual([]);
  expect(
    townChoices(["Overwrite the file? (y/n)", "Esc to cancel"]).map(
      (c) => c.key,
    ),
  ).toEqual(["y", "n"]);
  expect(townChoices(["Overwrite the file? (y/n)"]).map((c) => c.key)).toEqual([
    "y",
    "n",
  ]);
});
