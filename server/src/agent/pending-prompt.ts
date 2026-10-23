import { createHash } from "node:crypto";

/**
 * The question a blocked agent is asking, read from the bottom of its screen.
 * Only the menu shapes of supported harnesses are recognised, with the keys
 * those menus accept:
 *
 * - Claude Code: a whole permission box whose question ends in "?", with
 *   numbered options and the ❯ cursor on exactly one. A digit selects.
 * - Claude Code's questions and plan approval: a numbered menu below a rule,
 *   above its footer of controls ("Enter to select · … · Esc to cancel", or
 *   the plan's "ctrl+g to edit"), with the ❯ cursor on exactly one option.
 *   A digit selects. Options that open a text box ("Type something.", "Chat
 *   about this", "Tell Claude what to change") are left to the Terminal.
 * - Codex: numbered options each ending in its key hint, such as "(y)",
 *   "(a)" or "(esc)", with the › cursor on exactly one, below a question that
 *   ends in "?". The hint key selects.
 *
 * Anything else, a box cut off by the capture, or a request the harness shows
 * shortened gives the question with no options, and Chat points to the
 * Terminal: it never guesses.
 */
export type PendingPrompt = {
  /** The question lines, without the menu. */
  question: string[];
  /** The complete request asked about: a command, or a file and its edit. */
  request: string[];
  options: PromptOption[];
  /** Identifies this exact prompt, in this session, at this Herdr state. */
  fingerprint: string;
};

export type PromptOption = {
  /** What the menu shows, such as "1". */
  number: string;
  label: string;
  /** What to press: one character, or "escape". */
  key: string;
  /** The line a question form shows under the option, if any. */
  description?: string;
};

/** Lines of recent output read for a blocked agent's prompt. */
export const PROMPT_SCREEN_LINES = 80;

/** What the prompt was read under: the pane's session and state sequence. */
export type PromptContext = { session: string | null; seq: number | null };

const BOX_TOP = /^\s*╭─+╮\s*$/;
const BOX_BOTTOM = /^\s*╰─+╯\s*$/;
const BOX_LINE = /^\s*│(.*)│\s*$/;
const CLAUDE_OPTION =
  /^\s*(❯\s*)?(\d)\.\s+(.{1,200}?)\s*(?:\((?:esc|shift\+tab)\))?\s*$/i;
const RULE = /^\s*─{3,}\s*$/;
const MENU_FOOTER =
  /^\s*(?:enter to (?:select|confirm)\b.*\besc to cancel\b|ctrl\+g to edit\b)/i;
const MENU_OPTION = /^\s*(❯\s*)?(\d)\.\s+(.{1,200}?)\s*$/;
// Options that open a text box in the terminal rather than answer.
const FREE_TEXT =
  /^(?:type something|chat about this|tell claude what to change)\b/i;
const CODEX_OPTION = /^\s*(›\s*)?(\d)\.\s+(.{1,200}?)\s+\(([a-z]|esc)\)\s*$/i;
// Signs that the harness shortened the request it shows.
const ABBREVIATED =
  /^(?:…|\.\.\.)|\(\+?\d+ (?:more )?lines?\)|\+\d+ more lines?|ctrl\+r to expand/i;

const trimEnd = (line: string) => line.replace(/\s+$/, "");

function fingerprint(context: PromptContext, shown: readonly string[]) {
  return createHash("sha256")
    .update(JSON.stringify([context.session, context.seq, shown]))
    .digest("hex")
    .slice(0, 32);
}

/** Split lines into paragraphs separated by blank lines. */
function paragraphs(lines: readonly string[]) {
  const result: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) result.push(current);
  return result;
}

type Parsed = {
  shown: string[];
  question: string[];
  request: string[];
  options: PromptOption[];
};

/** A Claude Code permission box at the bottom of the screen. */
function claudePrompt(lines: string[]): Parsed | "incomplete" | null {
  let bottom = lines.length - 1;
  while (bottom >= 0 && !lines[bottom]!.trim()) bottom -= 1;
  if (bottom < 0 || !BOX_BOTTOM.test(lines[bottom]!)) return null;
  let top = bottom - 1;
  while (top >= 0 && !BOX_TOP.test(lines[top]!)) {
    // Every line inside must be a box line; anything else is a cut capture.
    if (!BOX_LINE.test(lines[top]!)) return "incomplete";
    top -= 1;
  }
  if (top < 0) return "incomplete";
  const inner = lines
    .slice(top + 1, bottom)
    .map((line) => trimEnd(BOX_LINE.exec(line)![1]!));
  // The menu: a run of options at the end of the box. A line indented
  // further continues the label of the option above it.
  const options: PromptOption[] = [];
  let menuStart = inner.length;
  let cursor = 0;
  let continued: string[] = [];
  for (let index = inner.length - 1; index >= 0; index -= 1) {
    const line = inner[index]!;
    if (!line.trim() && !options.length && !continued.length) continue;
    const match = CLAUDE_OPTION.exec(line);
    if (match) {
      if (match[1]) cursor += 1;
      options.unshift({
        number: match[2]!,
        label: [match[3]!.trim(), ...continued].join(" "),
        key: match[2]!,
      });
      continued = [];
      menuStart = index;
      continue;
    }
    if (/^\s{4,}\S/.test(line)) {
      continued.unshift(line.trim());
      continue;
    }
    break;
  }
  const above = paragraphs(inner.slice(0, menuStart));
  const question = above[above.length - 1] ?? [];
  const valid =
    options.length >= 2 &&
    options.every((option, index) => option.number === String(index + 1)) &&
    cursor === 1 &&
    continued.length === 0 &&
    question.length > 0 &&
    /\?\s*$/.test(question[question.length - 1]!);
  return {
    shown: inner,
    question: question.map((line) => line.trim()),
    request: above
      .slice(0, -1)
      .flat()
      .map((line) => line.trim()),
    options: valid ? options : [],
  };
}

/**
 * A Claude Code question form or plan approval at the bottom of the screen:
 * a footer of controls, a numbered menu above it (options, their indented
 * descriptions, and rules between them), and above that, up to the rule that
 * opens the form, the question and what it is about.
 */
function claudeMenuPrompt(lines: string[]): Parsed | null {
  let end = lines.length - 1;
  while (end >= 0 && !lines[end]!.trim()) end -= 1;
  if (end < 0 || !MENU_FOOTER.test(lines[end]!)) return null;
  const all: PromptOption[] = [];
  let cursor = 0;
  let menuStart = -1;
  let described: string[] = [];
  for (let index = end - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (!line.trim() || RULE.test(line)) continue;
    const match = MENU_OPTION.exec(line);
    if (match) {
      if (match[1]) cursor += 1;
      all.unshift({
        number: match[2]!,
        label: match[3]!.trim(),
        key: match[2]!,
        ...(described.length ? { description: described.join(" ") } : {}),
      });
      described = [];
      if (match[2] === "1") {
        menuStart = index;
        break;
      }
      continue;
    }
    // A description sits indented under its option.
    if (/^\s{4,}\S/.test(line)) {
      described.unshift(line.trim());
      continue;
    }
    return null;
  }
  if (menuStart < 0) return null;
  let top = menuStart - 1;
  while (top >= 0 && !RULE.test(lines[top]!)) top -= 1;
  const above = paragraphs(lines.slice(Math.max(0, top + 1), menuStart));
  const question = above[above.length - 1] ?? [];
  const valid =
    top >= 0 &&
    all.length >= 2 &&
    all.every((option, index) => option.number === String(index + 1)) &&
    cursor === 1 &&
    described.length === 0 &&
    question.length > 0 &&
    /\?\s*$/.test(question[question.length - 1]!);
  return {
    shown: lines.slice(Math.max(0, top), end + 1),
    question: question.map((line) => line.trim()),
    request: above
      .slice(0, -1)
      .flat()
      .map((line) => line.trim()),
    options: valid ? all.filter((option) => !FREE_TEXT.test(option.label)) : [],
  };
}

/** A Codex approval menu at the bottom of the screen. */
function codexPrompt(lines: string[]): Parsed | null {
  let end = lines.length;
  while (
    end > 0 &&
    (!lines[end - 1]!.trim() ||
      /^\s*press\s+enter\s+to\s+confirm/i.test(lines[end - 1]!))
  )
    end -= 1;
  const options: PromptOption[] = [];
  let menuStart = end;
  let cursor = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const match = CODEX_OPTION.exec(lines[index]!);
    if (!match) break;
    if (match[1]) cursor += 1;
    const hint = match[4]!.toLowerCase();
    options.unshift({
      number: match[2]!,
      label: match[3]!.trim(),
      key: hint === "esc" ? "escape" : hint,
    });
    menuStart = index;
  }
  if (!options.length) return null;
  const from = Math.max(0, menuStart - 24);
  const above = paragraphs(lines.slice(from, menuStart));
  // The question is the nearest paragraph ending in "?"; what lies between
  // it and the menu is the request.
  let asked = -1;
  for (let index = above.length - 1; index >= 0; index -= 1) {
    const paragraph = above[index]!;
    if (/\?\s*$/.test(paragraph[paragraph.length - 1]!)) {
      asked = index;
      break;
    }
  }
  const valid =
    options.length >= 2 &&
    options.every((option, index) => option.number === String(index + 1)) &&
    cursor === 1 &&
    asked >= 0;
  return {
    shown: lines.slice(from, end),
    question: asked >= 0 ? above[asked]!.map((line) => line.trim()) : [],
    request:
      asked >= 0
        ? above
            .slice(asked + 1)
            .flat()
            .map((line) => line.trim())
        : [],
    options: valid ? options : [],
  };
}

/**
 * Parse the bottom of a blocked agent's screen for `agent`'s own menu.
 * Returns null when the screen is empty.
 */
export function parsePendingPrompt(
  agent: string,
  screen: string,
  context: PromptContext,
): PendingPrompt | null {
  const lines = screen.split("\n").map(trimEnd);
  const text = lines.filter((line) => line.trim());
  if (!text.length) return null;
  const parsed =
    agent === "claude"
      ? (claudePrompt(lines) ?? claudeMenuPrompt(lines))
      : agent === "codex"
        ? codexPrompt(lines)
        : null;
  if (parsed && parsed !== "incomplete") {
    // A request the harness shortened is not one Chat can approve.
    const abbreviated = parsed.request.some((line) => ABBREVIATED.test(line));
    return {
      question: parsed.question,
      request: parsed.request,
      options: abbreviated ? [] : parsed.options,
      fingerprint: fingerprint(context, parsed.shown),
    };
  }
  // Not a supported, complete menu: the end of the screen is shown as the
  // question, with no answers.
  const tail = text.slice(-6).map((line) => line.trim());
  return {
    question: tail,
    request: [],
    options: [],
    fingerprint: fingerprint(context, tail),
  };
}
