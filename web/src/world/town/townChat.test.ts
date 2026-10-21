import { expect, test } from "bun:test";
import { townChoices, townLineKind, townQuestion } from "./townChat";

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

test("lines are coloured as the agent marks them", () => {
  expect(townLineKind("● Reading src/rooms.ts")).toBe("tool");
  expect(townLineKind("  ✓ 13 passed")).toBe("ok");
  expect(townLineKind("✻ Thinking…")).toBe("busy");
  expect(townLineKind("The queue now keeps its order.")).toBe("text");
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
