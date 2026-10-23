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
