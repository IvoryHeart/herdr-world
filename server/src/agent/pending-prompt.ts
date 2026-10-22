import { createHash } from "node:crypto";

/**
 * The question a blocked agent is asking, read from the bottom of its screen
 * with fixed patterns: the numbered menus Claude Code, Codex and other
 * harnesses draw, or a y/n prompt. Chat shows it as an ask card and answers
 * by pressing the option's key in the pane. When no menu parses, `options` is
 * empty and Chat shows the question with a way to the Terminal: it never
 * guesses an answer.
 */
export type PendingPrompt = {
  /** The question lines, without the menu. */
  question: string[];
  /** The command or file the agent asks about, when the prompt names one. */
  command: string | null;
  options: { key: string; label: string }[];
  /** Identifies this exact prompt, so an answer is checked against it. */
  fingerprint: string;
};

/** Lines of recent output read for a blocked agent's prompt. */
export const PROMPT_SCREEN_LINES = 60;

// Box-drawing frames and the cursor markers harnesses draw beside options.
const FRAME_EDGE = /^\s*[│┃║|]\s?|\s?[│┃║|]\s*$/g;
const FRAME_ONLY = /^[\s╭╮╰╯─━═┌┐└┘├┤┬┴┼╔╗╚╝]*$/;
const OPTION =
  /^\s*(?:[❯›>▶]\s*)?(\d)[.)]\s+(.{1,120}?)(?:\s+\((?:[a-z]|esc|shift\+tab)\))?\s*$/i;
const YES_NO = /\((y)\/(n)\)|\[(y)\/(n)\]/i;
// Key hints under a menu, such as "Esc to cancel" or "↑/↓ to navigate".
const KEY_HINT =
  /^\s*(?:press\s+)?(?:esc|enter|return|tab|↑|↓|←|→)(?:\s*\/\s*(?:esc|enter|return|tab|↑|↓|←|→))*\s+to\s+\w+/i;
// A line that introduces the thing asked about, in Claude's and Codex's
// permission prompts.
const SUBJECT =
  /^(?:Bash command|Edit file|Write file|Create file|Read file|Fetch|Run command|Command|Would you like to run the following command\??)$/i;

function cleanLine(line: string) {
  return line.replace(FRAME_EDGE, "").replace(/\s+$/, "");
}

/**
 * Parse the bottom of a blocked agent's screen. Returns null when the screen
 * shows no question at all.
 */
export function parsePendingPrompt(screen: string): PendingPrompt | null {
  const lines = screen
    .split("\n")
    .map(cleanLine)
    .filter((line) => !FRAME_ONLY.test(line) || line === "");
  // Trim blank and key-hint lines from the bottom.
  let end = lines.length;
  while (end > 0 && (!lines[end - 1]!.trim() || KEY_HINT.test(lines[end - 1]!)))
    end -= 1;
  if (end === 0) return null;

  // The menu: the last run of numbered options at the bottom.
  const options: PendingPrompt["options"] = [];
  let menuStart = end;
  // Lines below an option that are indented further continue its label.
  let continued: string[] = [];
  for (let index = end - 1; index >= 0 && index >= end - 16; index -= 1) {
    const line = lines[index]!;
    const match = OPTION.exec(line);
    if (match) {
      const label = [match[2]!.trim(), ...continued].join(" ");
      options.unshift({
        key: match[1]!,
        label: label.replace(/\s+\((?:[a-z]|esc|shift\+tab)\)$/i, ""),
      });
      continued = [];
      menuStart = index;
      continue;
    }
    if (/^\s{3,}\S/.test(line) && (options.length || index === end - 1)) {
      continued.unshift(line.trim());
      continue;
    }
    // Anything else ends the menu, or shows there is none at the bottom.
    break;
  }
  const numbered =
    options.length >= 2 &&
    options.every((option, index) => option.key === String(index + 1));
  if (!numbered) options.length = 0;

  // Above the menu (or the y/n line): paragraphs, nearest first, within a
  // dozen lines. The question is the nearest one with a line ending in "?",
  // else the nearest one.
  const above = numbered ? menuStart : end;
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (let index = above - 1; index >= 0 && index >= above - 12; index -= 1) {
    const line = lines[index]!.trim();
    if (!line) {
      if (current.length) paragraphs.push(current);
      current = [];
      continue;
    }
    current.unshift(line);
  }
  if (current.length) paragraphs.push(current);
  let asked = paragraphs.findIndex((paragraph) =>
    paragraph.some((line) => /\?\s*(?:\([yn]\/[yn]\))?$/i.test(line)),
  );
  if (asked < 0) asked = 0;
  let question = [...(paragraphs[asked] ?? [])];
  // A y/n prompt has no numbered menu; its two answers are the letters.
  if (!numbered) {
    const last = lines[end - 1]!.trim();
    if (YES_NO.test(last)) {
      options.push({ key: "y", label: "Yes" }, { key: "n", label: "No" });
      question = question.map((line) =>
        line === last ? line.replace(YES_NO, "").trim() : line,
      );
    }
  }
  if (!question.length && !options.length) return null;

  // The thing asked about, in two fixed shapes only: Codex's "$ command"
  // between the question and the menu, or the line under a known title such
  // as "Bash command" or "Edit file" above the question, as Claude draws it.
  let command: string | null = null;
  const shell = paragraphs
    .slice(0, asked)
    .flat()
    .find((line) => line.startsWith("$ "));
  if (shell) command = shell.slice(2).trim();
  for (
    let index = asked + 1;
    !command && index < paragraphs.length;
    index += 1
  ) {
    const paragraph = paragraphs[index]!;
    if (!SUBJECT.test(paragraph[0]!)) continue;
    command =
      paragraph[1] ?? (index > asked + 1 ? paragraphs[index - 1]![0]! : null);
  }
  return {
    question,
    command,
    options,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([question, command, options]))
      .digest("hex")
      .slice(0, 32),
  };
}
