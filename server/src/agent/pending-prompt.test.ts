import { describe, expect, test } from "bun:test";
import { parsePendingPrompt } from "./pending-prompt";

// Synthetic screens in the shapes each harness draws; no real output.
const CLAUDE_BASH = `
● Tests pass: 13 of 13.

╭──────────────────────────────────────────────────────────────╮
│ Bash command                                                 │
│                                                              │
│   git push -u origin agent/retry-backoff                     │
│   Push the branch                                            │
│                                                              │
│ Do you want to proceed?                                      │
│ ❯ 1. Yes                                                     │
│   2. Yes, and don't ask again for git push commands in       │
│      /work/harbor                                            │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
`;

const CLAUDE_EDIT = `
╭──────────────────────────────────────────────────────────────╮
│ Edit file                                                    │
│ src/notes/ListHeader.tsx                                     │
│                                                              │
│ Do you want to make this edit to ListHeader.tsx?             │
│ ❯ 1. Yes                                                     │
│   2. Yes, allow all edits during this session (shift+tab)    │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
`;

const CODEX_APPROVAL = `
  Would you like to run the following command?

  $ git push -u origin agent/retry-backoff

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;

describe("a blocked agent's prompt", () => {
  test("Claude's command permission: question, command and three options", () => {
    const prompt = parsePendingPrompt(CLAUDE_BASH)!;
    expect(prompt.question).toEqual(["Do you want to proceed?"]);
    expect(prompt.command).toBe("git push -u origin agent/retry-backoff");
    expect(prompt.options).toEqual([
      { key: "1", label: "Yes" },
      {
        key: "2",
        label: "Yes, and don't ask again for git push commands in /work/harbor",
      },
      { key: "3", label: "No, and tell Claude what to do differently" },
    ]);
  });

  test("Claude's edit permission names the file", () => {
    const prompt = parsePendingPrompt(CLAUDE_EDIT)!;
    expect(prompt.question).toEqual([
      "Do you want to make this edit to ListHeader.tsx?",
    ]);
    expect(prompt.command).toBe("src/notes/ListHeader.tsx");
    expect(prompt.options.map((option) => option.key)).toEqual(["1", "2", "3"]);
    expect(prompt.options[1]!.label).toBe(
      "Yes, allow all edits during this session",
    );
  });

  test("Codex's approval: the $ command and its options", () => {
    const prompt = parsePendingPrompt(CODEX_APPROVAL)!;
    expect(prompt.command).toBe("git push -u origin agent/retry-backoff");
    expect(prompt.question).toEqual([
      "Would you like to run the following command?",
    ]);
    expect(prompt.options).toEqual([
      { key: "1", label: "Yes, proceed" },
      { key: "2", label: "Yes, and don't ask again for this command" },
      { key: "3", label: "No, and tell Codex what to do differently" },
    ]);
  });

  test("a y/n prompt answers with the letters", () => {
    const prompt = parsePendingPrompt(
      "Writing notes.md\nOverwrite notes.md? (y/n)",
    )!;
    expect(prompt.question).toEqual([
      "Writing notes.md",
      "Overwrite notes.md?",
    ]);
    expect(prompt.options).toEqual([
      { key: "y", label: "Yes" },
      { key: "n", label: "No" },
    ]);
  });

  test("a question with no menu offers no answers, never a guess", () => {
    const prompt = parsePendingPrompt(
      "Which database should the migration target?\n> ",
    )!;
    expect(prompt.options).toEqual([]);
    expect(prompt.question.join(" ")).toContain("Which database");
  });

  test("an old menu with output after it is not the current prompt", () => {
    const prompt = parsePendingPrompt(
      `${CLAUDE_EDIT}\n● Updated ListHeader.tsx\nWhat next?`,
    )!;
    expect(prompt.options).toEqual([]);
    expect(prompt.question).toContain("What next?");
  });

  test("the same prompt has the same fingerprint; another does not", () => {
    expect(parsePendingPrompt(CLAUDE_BASH)!.fingerprint).toBe(
      parsePendingPrompt(`\n\n${CLAUDE_BASH}`)!.fingerprint,
    );
    expect(parsePendingPrompt(CLAUDE_BASH)!.fingerprint).not.toBe(
      parsePendingPrompt(CLAUDE_EDIT)!.fingerprint,
    );
  });

  test("an empty screen is no prompt", () => {
    expect(parsePendingPrompt("\n\n  \n")).toBeNull();
  });
});
