import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parsePendingPrompt } from "./pending-prompt";
const context = { session: "fixture", seq: 7 };
const screen = (name: string) =>
  readFileSync(
    new URL(`./fixtures/pending-prompts/${name}.txt`, import.meta.url),
    "utf8",
  );

test("Codex 0.164 approval keeps the question above its reason and command", () => {
  const prompt = parsePendingPrompt(
    "codex",
    screen("codex-approval"),
    context,
  )!;
  expect(prompt.question).toEqual([
    "Would you like to run the following command?",
  ]);
  expect(prompt.request).toContain("Reason: May I print the fixture marker?");
  expect(prompt.options.map((option) => option.key)).toEqual([
    "y",
    "p",
    "escape",
  ]);
});
test("Codex 0.164 questions expose digit choices without approval key hints", () => {
  const prompt = parsePendingPrompt(
    "codex",
    screen("codex-question"),
    context,
  )!;
  expect(prompt.question).toEqual(["Which color should the badge use?"]);
  expect(prompt.options).toEqual([
    { number: "1", label: "Red", description: "Use a red badge.", key: "1" },
    { number: "2", label: "Blue", description: "Use a blue badge.", key: "2" },
    {
      number: "3",
      label: "None of the above",
      description: "Optionally, add details in notes (tab)",
      key: "3",
    },
  ]);
});
test("Claude 2.1.312 exposes inline and discussion text options", () => {
  const prompt = parsePendingPrompt(
    "claude",
    screen("claude-question"),
    context,
  )!;
  expect(prompt.options).toContainEqual({
    number: "3",
    label: "Type something.",
    key: "3",
    input: "text",
  });
  expect(prompt.options).toContainEqual({
    number: "4",
    label: "Chat about this",
    key: "4",
    input: "chat",
  });
});

test("only a complete live Codex question frame offers digit answers", () => {
  for (const changed of [
    screen("codex-question").replace("Question 1/1 (1 unanswered)", ""),
    screen("codex-question").replace(
      "tab to add notes | enter to submit answer | esc to interrupt",
      "",
    ),
    screen("codex-question").replace("› 1.", "  1."),
    screen("codex-question").replace("    2. Blue", "  › 2. Blue"),
    screen("codex-question").replace("    2. Blue", "    4. Blue"),
  ])
    expect(parsePendingPrompt("codex", changed, context)!.options).toEqual([]);
});
test("Codex descriptions can wrap and the dialog position changes its fingerprint", () => {
  const shown = screen("codex-question");
  const wrapped = shown.replace(
    "Use a red badge.",
    "Use a red\n                        badge.",
  );
  expect(
    parsePendingPrompt("codex", wrapped, context)!.options[0]!.description,
  ).toBe("Use a red badge.");
  expect(
    parsePendingPrompt(
      "codex",
      shown.replace("Question 1/1", "Question 2/2"),
      context,
    )!.fingerprint,
  ).not.toBe(parsePendingPrompt("codex", shown, context)!.fingerprint);
});
test("empty Claude editors are recognized and existing native drafts remain in the Terminal", () => {
  expect(
    parsePendingPrompt(
      "claude",
      screen("claude-text-entry"),
      context,
    )!.options.find((o) => o.key === "3"),
  ).toMatchObject({ input: "text", active: true });
  expect(
    parsePendingPrompt(
      "claude",
      screen("claude-plan-entry"),
      context,
    )!.options.find((o) => o.key === "3"),
  ).toMatchObject({ input: "text", active: true });
  for (const name of ["claude-text-typed", "claude-plan-typed"])
    expect(
      parsePendingPrompt("claude", screen(name), context)!.options,
    ).toEqual([]);
});

test("Codex notes being edited in the native dialog offer no digit actions", () => {
  expect(
    parsePendingPrompt("codex", screen("codex-question-notes"), context)!
      .options,
  ).toEqual([]);
});

test("native drafts remain non-actionable after the cursor moves to another choice", () => {
  for (const name of ["claude-draft-unfocused", "claude-plan-draft-unfocused"])
    expect(
      parsePendingPrompt("claude", screen(name), context)!.options,
    ).toEqual([]);
});

test("text-option prefixes inside native draft contents are not placeholders", () => {
  for (const draft of [
    "Chat about this later",
    "Type something. Keep this native draft",
    "Tell Claude what to change instead",
    "Type something. ✔",
    "Type something.\n     Wrapped native draft",
  ]) {
    expect(
      parsePendingPrompt(
        "claude",
        screen("claude-text-entry").replace("Type something.", draft),
        context,
      )!.options,
    ).toEqual([]);
  }
});
