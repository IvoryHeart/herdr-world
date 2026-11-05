import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  askedQuestions,
  MULTI_SELECT,
  TYPED,
  UNMATCHED,
  withAskedQuestions,
} from "./asked-questions";
import { parsePendingPrompt } from "./pending-prompt";
import type { HistoryEntry } from "./session-history";

// Synthetic transcripts: Claude Code's ask-the-user call, as the shared
// projection records it, and the captured question screen it draws.
const context = { session: "fixture", seq: 7 };
const screen = readFileSync(
  new URL("./fixtures/pending-prompts/claude-question.txt", import.meta.url),
  "utf8",
);
const COLOR = {
  question: "Which color should the badge use?",
  header: "Color",
  options: [
    { label: "Red", description: "Warm color" },
    { label: "Blue", description: "Cool color" },
  ],
  multiSelect: false,
};
const call = (input: unknown, id = "call-1", name = "AskUserQuestion") =>
  ({
    id: `${id}:call`,
    role: "tool",
    kind: "tool_call",
    tool_name: name,
    source_call_id: id,
    text: JSON.stringify(input, null, 2),
    sent_at: "2026-11-05T10:00:00.000Z",
  }) satisfies HistoryEntry;
const result = (id = "call-1") =>
  ({
    id: `${id}:result`,
    role: "tool",
    kind: "tool_result",
    source_call_id: id,
    text: "answered",
    sent_at: "2026-11-05T10:01:00.000Z",
  }) satisfies HistoryEntry;
const shown = (text = screen) => parsePendingPrompt("claude", text, context);

test("the open ask-the-user call gives every question, option and description", () => {
  expect(askedQuestions([call({ questions: [COLOR] })])).toEqual({
    call_id: "call-1",
    questions: [
      {
        question: COLOR.question,
        header: "Color",
        options: COLOR.options,
        multi_select: false,
        kind: "choice",
      },
    ],
  });
  // Answered, another open call, or out-of-bounds input gives nothing.
  expect(askedQuestions([call({ questions: [COLOR] }), result()])).toBeNull();
  expect(
    askedQuestions([
      call({ questions: [COLOR] }),
      call({ command: "ls" }, "call-2", "Bash"),
    ]),
  ).toBeNull();
  for (const questions of [
    [],
    [{ ...COLOR, question: "" }],
    [{ ...COLOR, options: [COLOR.options[0]] }],
    [{ ...COLOR, options: Array(9).fill(COLOR.options[0]) }],
    Array(9).fill(COLOR),
    [{ ...COLOR, kind: "slider" }],
  ])
    expect(askedQuestions([call({ questions })])).toBeNull();
  expect(
    askedQuestions([{ ...call({ questions: [COLOR] }), text: "{" }]),
  ).toBeNull();
});

test("the screen keeps its keys only when it shows the same question and options", () => {
  const asked = askedQuestions([call({ questions: [COLOR] })]);
  const plain = shown()!;
  const joined = withAskedQuestions(plain, asked)!;
  expect(joined.options.map((option) => option.key)).toEqual([
    "1",
    "2",
    "3",
    "4",
  ]);
  expect(joined.asked).toMatchObject({ call_id: "call-1", current: 0 });
  expect(joined.unanswerable).toBeUndefined();
  // The transcript is part of what an answer is checked against.
  expect(joined.fingerprint).not.toBe(plain.fingerprint);
  const other = withAskedQuestions(
    plain,
    askedQuestions([call({ questions: [COLOR] }, "call-9")]),
  )!;
  expect(other.fingerprint).not.toBe(joined.fingerprint);
});

test("a different option, description or question shows everything without keys", () => {
  for (const changed of [
    { ...COLOR, options: [COLOR.options[0], { label: "Green" }] },
    {
      ...COLOR,
      options: [COLOR.options[0], { label: "Blue", description: "Cold" }],
    },
    { ...COLOR, question: "Which color should the button use?" },
    { ...COLOR, options: [...COLOR.options, { label: "Gold" }] },
  ]) {
    const joined = withAskedQuestions(
      shown(),
      askedQuestions([call({ questions: [changed] })]),
    )!;
    expect(joined.options).toEqual([]);
    expect(joined.unanswerable).toBe(UNMATCHED);
    expect(joined.question).toEqual([changed.question]);
    expect(joined.asked!.questions[0]!.options).toEqual(changed.options);
  }
});

test("wrapped descriptions on a narrow screen still match", () => {
  const long = {
    ...COLOR,
    options: [
      {
        label: "Red",
        description: "Warm color that stands out against the page header",
      },
      COLOR.options[1],
    ],
  };
  const narrow = screen.replace(
    "     Warm color",
    "     Warm color that stands out against\n     the page header",
  );
  const joined = withAskedQuestions(
    shown(narrow),
    askedQuestions([call({ questions: [long] })]),
  )!;
  expect(joined.options.length).toBe(4);
  expect(joined.asked!.current).toBe(0);
});

test("multi-select and typed questions are shown but answered in the Terminal", () => {
  const multi = withAskedQuestions(
    shown(),
    askedQuestions([call({ questions: [{ ...COLOR, multiSelect: true }] })]),
  )!;
  expect(multi.options).toEqual([]);
  expect(multi.unanswerable).toBe(MULTI_SELECT);
  expect(multi.asked!.questions[0]!.multi_select).toBe(true);
  const typed = withAskedQuestions(
    null,
    askedQuestions([
      call({ questions: [{ question: "How many seats?", kind: "number" }] }),
    ]),
  )!;
  expect(typed.unanswerable).toBe(TYPED);
  expect(typed.asked!.questions[0]).toMatchObject({
    kind: "number",
    options: [],
  });
});

test("an unreadable screen still shows the whole question, and the screen", () => {
  const cut = parsePendingPrompt(
    "claude",
    "  4. Type something.\n\nEnter to select · Esc",
    context,
  )!;
  const joined = withAskedQuestions(
    cut,
    askedQuestions([call({ questions: [COLOR] })]),
  )!;
  expect(joined.question).toEqual([COLOR.question]);
  expect(joined.options).toEqual([]);
  expect(joined.asked!.current).toBeNull();
  expect(joined.screen).toEqual(cut.screen);
});

test("a form keeps keys for its review, never for an unmatched question", () => {
  const SIZE = {
    question: "Which size should the badge be?",
    header: "Size",
    options: [{ label: "Small" }, { label: "Large" }],
  };
  const asked = askedQuestions([call({ questions: [COLOR, SIZE] })]);
  const steps = [
    { label: "Color", answered: true },
    { label: "Size", answered: true },
  ];
  const review = {
    question: ["Ready to submit your answers?"],
    request: [],
    options: [
      { number: "1", label: "Submit answers", key: "1" },
      { number: "2", label: "Cancel", key: "2" },
    ],
    steps,
    review: true as const,
    fingerprint: "review",
  };
  expect(withAskedQuestions(review, asked)!.options.length).toBe(2);
  const notReview = { ...review, review: undefined };
  expect(withAskedQuestions(notReview, asked)!.options).toEqual([]);
  // Another form's header chips do not match.
  expect(
    withAskedQuestions(
      { ...review, steps: [steps[0]!, { label: "Shape", answered: false }] },
      asked,
    )!.options,
  ).toEqual([]);
});
