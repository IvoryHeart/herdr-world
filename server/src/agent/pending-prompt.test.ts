import { describe, expect, test } from "bun:test";
import { parsePendingPrompt } from "./pending-prompt";

// Synthetic screens in the shapes each harness draws; no real output.
const context = { session: "s1", seq: 7 };

const box = (inner: string[]) => {
  const width = 64;
  return [
    `╭${"─".repeat(width)}╮`,
    ...inner.map((line) => `│ ${line.padEnd(width - 1)}│`),
    `╰${"─".repeat(width)}╯`,
  ].join("\n");
};

const claudeBash = (command: string[]) =>
  `● Tests pass: 13 of 13.\n\n${box([
    "Bash command",
    "",
    ...command.map((line) => `  ${line}`),
    "  Push the branch",
    "",
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again for git push commands in",
    "     /work/harbor",
    "  3. No, and tell Claude what to do differently (esc)",
  ])}\n`;

const CODEX_APPROVAL = `
  Would you like to run the following command?

  $ git push -u origin agent/retry-backoff

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;

describe("Claude Code's permission box", () => {
  test("gives the whole request, the question and digit keys", () => {
    const prompt = parsePendingPrompt(
      "claude",
      claudeBash(["git push -u origin agent/retry-backoff"]),
      context,
    )!;
    expect(prompt.question).toEqual(["Do you want to proceed?"]);
    expect(prompt.request).toEqual([
      "Bash command",
      "git push -u origin agent/retry-backoff",
      "Push the branch",
    ]);
    expect(prompt.options).toEqual([
      { number: "1", label: "Yes", key: "1" },
      {
        number: "2",
        label: "Yes, and don't ask again for git push commands in /work/harbor",
        key: "2",
      },
      {
        number: "3",
        label: "No, and tell Claude what to do differently",
        key: "3",
      },
    ]);
  });

  test("two multi-line commands that share a first line differ", () => {
    const safe = parsePendingPrompt(
      "claude",
      claudeBash(["echo safe", "echo first"]),
      context,
    )!;
    const risky = parsePendingPrompt(
      "claude",
      claudeBash(["echo safe", "rm -rf /work/example"]),
      context,
    )!;
    expect(risky.request).toContain("rm -rf /work/example");
    expect(risky.fingerprint).not.toBe(safe.fingerprint);
  });

  test("a box cut off by the capture offers no answers", () => {
    const cut = claudeBash(["git push"]).split("\n").slice(4).join("\n");
    expect(parsePendingPrompt("claude", cut, context)!.options).toEqual([]);
  });

  test("a request the harness shortened offers no answers", () => {
    const prompt = parsePendingPrompt(
      "claude",
      claudeBash(["for f in *.log; do", "… +12 lines (ctrl+r to expand)"]),
      context,
    )!;
    expect(prompt.options).toEqual([]);
  });

  test("a menu without the cursor is not a live menu", () => {
    const screen = claudeBash(["git push"]).replace("❯ 1. Yes", "  1. Yes");
    expect(parsePendingPrompt("claude", screen, context)!.options).toEqual([]);
  });

  test("numbered output is not a menu", () => {
    const prompt = parsePendingPrompt(
      "claude",
      "Here is the plan:\n1. Inspect the repository\n2. Run the tests",
      context,
    )!;
    expect(prompt.options).toEqual([]);
    expect(prompt.question).toContain("2. Run the tests");
  });

  test("a y/n line is not a menu Chat answers", () => {
    expect(
      parsePendingPrompt("claude", "Overwrite notes.md? (y/n)", context)!
        .options,
    ).toEqual([]);
  });
});

// Claude Code's question forms and plan approval, in the shapes it draws
// below a rule (wording synthetic, layout from real screens).
const RULE = "─".repeat(72);
const FOOTER = "Enter to select · ↑/↓ to navigate · Esc to cancel";
const askForm = (header: string, cursorOn = 1) =>
  [
    "● Reading the banner styles.",
    RULE,
    header,
    "",
    "Which colour should the demo banner be?",
    "",
    `${cursorOn === 1 ? "❯" : " "} 1. Red`,
    "     Set the demo banner to red.",
    `${cursorOn === 2 ? "❯" : " "} 2. Green`,
    "     Set the demo banner to green.",
    "  3. Type something.",
    RULE,
    "  4. Chat about this",
    "",
    FOOTER,
    "",
  ].join("\n");

describe("Claude Code's questions", () => {
  test("a question form offers its choices, with descriptions, not its text boxes", () => {
    const prompt = parsePendingPrompt(
      "claude",
      askForm(" ☐ Banner colour"),
      context,
    )!;
    expect(prompt.question).toEqual([
      "Which colour should the demo banner be?",
    ]);
    expect(prompt.request).toEqual(["☐ Banner colour"]);
    expect(prompt.options).toEqual([
      {
        number: "1",
        label: "Red",
        key: "1",
        description: "Set the demo banner to red.",
      },
      {
        number: "2",
        label: "Green",
        key: "2",
        description: "Set the demo banner to green.",
      },
    ]);
  });

  test("each tab of a multi-question form is its own question", () => {
    const first = parsePendingPrompt(
      "claude",
      askForm("←  ☐ Banner colour  ☐ Sticky  ✔ Submit  →"),
      context,
    )!;
    const moved = parsePendingPrompt(
      "claude",
      askForm("←  ☐ Banner colour  ☐ Sticky  ✔ Submit  →", 2),
      context,
    )!;
    expect(first.options.map((option) => option.key)).toEqual(["1", "2"]);
    // The cursor moving is a different screen, so a different prompt.
    expect(moved.fingerprint).not.toBe(first.fingerprint);
  });

  test("the review before submitting shows the answers as its request", () => {
    const prompt = parsePendingPrompt(
      "claude",
      [
        RULE,
        "←  ☒ Banner colour  ☒ Sticky  ✔ Submit  →",
        "",
        "Review your answers",
        "",
        " ● Which colour should the demo banner be?",
        "   → Green",
        "",
        "Ready to submit your answers?",
        "",
        "❯ 1. Submit answers",
        "  2. Cancel",
        "",
        FOOTER,
      ].join("\n"),
      context,
    )!;
    expect(prompt.question).toEqual(["Ready to submit your answers?"]);
    expect(prompt.request).toContain("→ Green");
    expect(prompt.options.map((option) => option.label)).toEqual([
      "Submit answers",
      "Cancel",
    ]);
  });

  const EDGE = "  " + "╌".repeat(40);
  const planScreen = (plan: string[]) =>
    [
      `  ${RULE}`,
      "   Ready to code?",
      "",
      "   Here is Claude's plan:",
      EDGE,
      ...plan.map((line) => (line ? `   ${line}` : "")),
      EDGE,
      "",
      "",
      `  ${RULE}`,
      "   Claude has written up a plan and is ready to execute. Would you like to proceed?",
      "",
      "   ❯ 1. Yes, and use auto mode",
      "     2. Yes, manually approve edits",
      "     3. Tell Claude what to change",
      "        shift+tab to approve with this feedback",
      "",
      "   ctrl+g to edit in your editor · ~/plans/example.md",
    ].join("\n");
  const PLAN = [
    "Plan: create banner.txt",
    "",
    "1. Write banner.txt with the word hi.",
    "2. Read it back.",
  ];

  test("plan approval shows the whole plan, and offers its answers but not the feedback box", () => {
    const prompt = parsePendingPrompt("claude", planScreen(PLAN), context)!;
    expect(prompt.question).toEqual([
      "Claude has written up a plan and is ready to execute. Would you like to proceed?",
    ]);
    expect(prompt.request).toEqual([
      "Plan: create banner.txt",
      "1. Write banner.txt with the word hi.",
      "2. Read it back.",
    ]);
    expect(prompt.options.map((option) => option.label)).toEqual([
      "Yes, and use auto mode",
      "Yes, manually approve edits",
    ]);
  });

  test("two plans behind the same menu are different prompts", () => {
    const other = [...PLAN.slice(0, 3), "2. Delete the old banners."];
    expect(
      parsePendingPrompt("claude", planScreen(other), context)!.fingerprint,
    ).not.toBe(
      parsePendingPrompt("claude", planScreen(PLAN), context)!.fingerprint,
    );
  });

  test("a plan cut off by the capture is not approved from Chat", () => {
    const clipped = planScreen(PLAN).split("\n").slice(5).join("\n");
    const prompt = parsePendingPrompt("claude", clipped, context)!;
    expect(prompt.options).toEqual([]);
    // Without its plan at all, the menu offers nothing either.
    const bare = planScreen(PLAN).split("\n").slice(11).join("\n");
    expect(parsePendingPrompt("claude", bare, context)!.options).toEqual([]);
  });

  test("an unnumbered menu, or one without its opening rule, is left to the Terminal", () => {
    expect(
      parsePendingPrompt(
        "claude",
        [
          RULE,
          " Is this a project you trust?",
          "",
          " ❯ No, exit",
          "   Yes, I trust this folder",
          "",
          " Enter to confirm · Esc to cancel",
        ].join("\n"),
        context,
      )!.options,
    ).toEqual([]);
    const cut = askForm(" ☐ Banner colour").split("\n").slice(2).join("\n");
    expect(parsePendingPrompt("claude", cut, context)!.options).toEqual([]);
  });

  test("a numbered list above a footer that is not a menu offers nothing", () => {
    expect(
      parsePendingPrompt(
        "claude",
        [RULE, "Steps:", "1. Build", "2. Test", "", FOOTER].join("\n"),
        context,
      )!.options,
    ).toEqual([]);
  });
});

describe("Codex's approval menu", () => {
  test("gives the $ command and answers with the hint keys", () => {
    const prompt = parsePendingPrompt("codex", CODEX_APPROVAL, context)!;
    expect(prompt.question).toEqual([
      "Would you like to run the following command?",
    ]);
    expect(prompt.request).toEqual([
      "$ git push -u origin agent/retry-backoff",
    ]);
    expect(prompt.options).toEqual([
      { number: "1", label: "Yes, proceed", key: "y" },
      {
        number: "2",
        label: "Yes, and don't ask again for this command",
        key: "a",
      },
      {
        number: "3",
        label: "No, and tell Codex what to do differently",
        key: "escape",
      },
    ]);
  });

  test("plain numbered lines without hints are not Codex's menu", () => {
    expect(
      parsePendingPrompt("codex", "Proceed?\n› 1. Yes\n  2. No", context)!
        .options,
    ).toEqual([]);
  });

  test("a Codex menu on a Claude pane is not read", () => {
    expect(
      parsePendingPrompt("claude", CODEX_APPROVAL, context)!.options,
    ).toEqual([]);
  });
});

describe("the prompt's fingerprint", () => {
  test("is the same for the same prompt, session and state", () => {
    const screen = claudeBash(["git push"]);
    expect(parsePendingPrompt("claude", screen, context)!.fingerprint).toBe(
      parsePendingPrompt("claude", `\n\n${screen}`, context)!.fingerprint,
    );
  });

  test("changes with the session or Herdr's state sequence", () => {
    const screen = claudeBash(["git push"]);
    const base = parsePendingPrompt("claude", screen, context)!.fingerprint;
    expect(
      parsePendingPrompt("claude", screen, { ...context, seq: 8 })!.fingerprint,
    ).not.toBe(base);
    expect(
      parsePendingPrompt("claude", screen, { ...context, session: "s2" })!
        .fingerprint,
    ).not.toBe(base);
  });

  test("an empty screen is no prompt", () => {
    expect(parsePendingPrompt("claude", "\n\n  \n", context)).toBeNull();
  });
});
