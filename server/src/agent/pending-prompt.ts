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
 *   A digit selects. Text options identify their inline editor or composer.
 *   A form of several questions shows one at a time under a row of header
 *   chips ("←  ☐ Color  ☒ Size  ✔ Submit  →"): a digit answers the question
 *   shown and moves to the next. Its review ("Review your answers", then
 *   "Submit answers" and "Cancel") is drawn with no footer.
 * - Codex: numbered options each ending in its key hint, such as "(y)",
 *   "(a)" or "(esc)", with the › cursor on exactly one, below a question that
 *   ends in "?". The hint key selects. Question dialogs instead show a
 *   Question X/Y counter and notes/submit footer; digit shortcuts select.
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
  /**
   * A multi-question form's questions, by their headers, in order: Claude
   * Code shows one at a time, then a review that submits them all.
   */
  steps?: PromptStep[];
  /** Identifies this exact prompt, in this session, at this Herdr state. */
  fingerprint: string;
};

export type PromptStep = { label: string; answered: boolean };

export type PromptOption = {
  /** What the menu shows, such as "1". */
  number: string;
  label: string;
  /** What to press: one character, or "escape". */
  key: string;
  /** The line a question form shows under the option, if any. */
  description?: string;
  /** A choice that needs text after selection, rather than a digit alone. */
  input?: "text" | "chat";
  /** The empty inline editor is already selected on this screen. */
  active?: boolean;
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
// A multi-question form's header chips, ☐ unanswered and ☒ answered.
const FORM_STEPS = /^\s*←\s+(.*?)\s+✔\s*Submit\s+→\s*$/;
const FORM_REVIEW = /^\s*Review your answers\s*$/i;
// Plan approval's footer, and the dashed edges Claude draws around the plan.
const PLAN_FOOTER = /^\s*ctrl\+g to edit\b/i;
const PLAN_EDGE = /^\s*╌{3,}\s*$/;
const MENU_FOOTER =
  /^\s*(?:enter to (?:select|confirm)\b.*\besc to cancel\b|ctrl\+g to edit\b)/i;
const MENU_OPTION = /^\s*(❯\s*)?(\d)\.\s+(.{1,200}?)\s*$/;
// Options that open a text box in the terminal rather than answer.
const FREE_TEXT =
  /^(?:type something|chat about this|tell claude what to change)\b/i;
const INLINE_EDITOR = /^\s*enter to (?:select|confirm)\b.*ctrl\+g to edit\b/i;
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
  steps?: PromptStep[];
};

/** A form's header chips, or null for any other line. */
function formSteps(line: string): PromptStep[] | null {
  const row = FORM_STEPS.exec(line)?.[1];
  if (row === undefined) return null;
  const steps: PromptStep[] = [];
  for (const chip of row.split(/\s*(?=[☐☒])/u)) {
    const match = /^([☐☒])\s+(\S.*?)\s*$/u.exec(chip);
    if (!match) return null;
    steps.push({ label: match[2]!, answered: match[1] === "☒" });
  }
  return steps.length ? steps : null;
}

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
  if (end < 0) return null;
  // A form's review has no footer: its menu ends the screen.
  const footer = MENU_FOOTER.test(lines[end]!);
  if (!footer && !MENU_OPTION.test(lines[end]!)) return null;
  if (!footer) end += 1;
  const all: PromptOption[] = [];
  let cursor = 0;
  let menuStart = -1;
  let described: string[] = [];
  let selected: PromptOption | undefined;
  for (let index = end - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (!line.trim() || RULE.test(line)) continue;
    const match = MENU_OPTION.exec(line);
    if (match) {
      if (match[1]) cursor += 1;
      all.unshift({
        number: match[2]!,
        // A form marks the answer already chosen on a revisited question.
        label: match[3]!.replace(/\s+✔$/u, "").trim(),
        key: match[2]!,
        ...(described.length ? { description: described.join(" ") } : {}),
      });
      if (match[1]) selected = all[0];
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
  let above = paragraphs(lines.slice(Math.max(0, top + 1), menuStart));
  // A multi-question form opens with its header chips.
  const steps = above[0]?.length === 1 ? formSteps(above[0][0]!) : null;
  if (steps) above = above.slice(1);
  const review = FORM_REVIEW.test(above[0]?.[0] ?? "");
  // A review lists each question and its answer: those are its request.
  if (review && above.length >= 2)
    above = [above.slice(1, -1).flat(), above[above.length - 1]!];
  if (!footer && !(steps && review)) return null;
  const question = above[above.length - 1] ?? [];
  // Plan approval approves the plan drawn above it, between dashed edges.
  // The whole plan is the request, and part of what the fingerprint covers;
  // a plan cut off by the capture is not one Chat can approve.
  let plan: string[] | null = null;
  let from = top;
  if (PLAN_FOOTER.test(lines[end]!)) {
    let bottom = top - 1;
    while (bottom >= 0 && !lines[bottom]!.trim()) bottom -= 1;
    let start = bottom - 1;
    while (start >= 0 && !PLAN_EDGE.test(lines[start]!)) start -= 1;
    if (bottom >= 0 && PLAN_EDGE.test(lines[bottom]!) && start >= 0) {
      plan = lines
        .slice(start + 1, bottom)
        .map((line) => line.trim())
        .filter(Boolean);
      from = start;
    }
  }
  const valid =
    top >= 0 &&
    (!PLAN_FOOTER.test(lines[end]!) || (plan !== null && plan.length > 0)) &&
    all.length >= 2 &&
    all.every((option, index) => option.number === String(index + 1)) &&
    cursor === 1 &&
    described.length === 0 &&
    question.length > 0 &&
    /\?\s*$/.test(question[question.length - 1]!);
  const editing =
    INLINE_EDITOR.test(lines[end] ?? "") ||
    (PLAN_FOOTER.test(lines[end] ?? "") &&
      selected?.description?.includes(
        "shift+tab to approve with this feedback",
      ));
  const readableEditor =
    !editing || (selected && FREE_TEXT.test(selected.label));
  return {
    shown: lines.slice(Math.max(0, from), footer ? end + 1 : end),
    question: question.map((line) => line.trim()),
    request:
      plan ??
      above
        .slice(0, -1)
        .flat()
        .map((line) => line.trim()),
    options:
      valid && readableEditor
        ? all.map((option) =>
            FREE_TEXT.test(option.label)
              ? {
                  ...option,
                  input: /^chat about this\b/i.test(option.label)
                    ? ("chat" as const)
                    : ("text" as const),
                  ...(option === selected &&
                  !/^chat about this\b/i.test(option.label)
                    ? { active: true }
                    : {}),
                }
              : option,
          )
        : [],
    ...(steps ? { steps } : {}),
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
    if (
      /^Would you like to\b/.test(paragraph[0]!.trim()) &&
      /\?\s*$/.test(paragraph[paragraph.length - 1]!)
    ) {
      asked = index;
      break;
    }
    if (
      asked < 0 &&
      !/^(?:Reason|Environment|Justification):/i.test(paragraph[0]!.trim()) &&
      /\?\s*$/.test(paragraph[paragraph.length - 1]!)
    )
      asked = index;
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

/** Codex's request_user_input dialog uses digit shortcuts without key hints. */
function codexQuestion(lines: string[]): Parsed | null {
  let end = lines.length - 1;
  while (end >= 0 && !lines[end]!.trim()) end -= 1;
  if (
    !/^\s*tab to add notes \| enter to submit answer \| esc to interrupt\s*$/i.test(
      lines[end] ?? "",
    )
  )
    return null;
  let start = end - 1;
  while (
    start >= 0 &&
    !/^\s*Question \d+\/\d+ \(\d+ unanswered\)\s*$/.test(lines[start]!)
  )
    start -= 1;
  if (start < 0) return null;
  const header = /^\s*Question (\d+)\/(\d+) \((\d+) unanswered\)\s*$/.exec(
    lines[start]!,
  )!;
  const content = lines.slice(start + 1, end);
  const first = content.findIndex((line) => /^\s*›?\s*1\.\s+/.test(line));
  if (first < 0) return null;
  const question = content
    .slice(0, first)
    .map((line) => line.trim())
    .filter(Boolean);
  const options: PromptOption[] = [];
  let cursor = 0;
  let valid =
    Number(header[1]) > 0 &&
    Number(header[1]) <= Number(header[2]) &&
    Number(header[3]) <= Number(header[2]);
  for (const line of content.slice(first)) {
    if (!line.trim()) continue;
    const match =
      /^\s*(›\s*)?(\d)\.\s+(.{1,200}?)(?:\s{2,}(\S.{0,400}))?\s*$/.exec(line);
    if (match) {
      if (match[1]) cursor += 1;
      options.push({
        number: match[2]!,
        label: match[3]!.trim(),
        key: match[2]!,
        ...(match[4] ? { description: match[4].trim() } : {}),
      });
    } else if (/^\s{4,}\S/.test(line) && options.length) {
      const option = options[options.length - 1]!;
      option.description = [option.description, line.trim()]
        .filter(Boolean)
        .join(" ");
    } else valid = false;
  }
  valid =
    valid &&
    question.length > 0 &&
    options.length >= 2 &&
    cursor === 1 &&
    options.every((option, index) => option.number === String(index + 1));
  return {
    shown: lines.slice(start, end + 1),
    question,
    request: [],
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
        ? (codexQuestion(lines) ?? codexPrompt(lines))
        : null;
  if (parsed && parsed !== "incomplete") {
    // A request the harness shortened is not one Chat can approve.
    const abbreviated = parsed.request.some((line) => ABBREVIATED.test(line));
    return {
      question: parsed.question,
      request: parsed.request,
      options: abbreviated ? [] : parsed.options,
      ...(parsed.steps ? { steps: parsed.steps } : {}),
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
