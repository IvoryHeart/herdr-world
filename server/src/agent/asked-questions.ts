import { createHash } from "node:crypto";
import { newestOpenCall } from "./conversation";
import type { PendingPrompt } from "./pending-prompt";
import type { HistoryEntry } from "./session-history";

/**
 * Claude Code's ask-the-user tool records its questions in the transcript
 * before the user answers: each question, its header, its options with their
 * descriptions, and whether several may be picked. Chat shows those, and
 * offers the screen's keys only when the live screen shows the same question
 * and the same options.
 */
export type AskedQuestion = {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multi_select: boolean;
  /** Claude's newer forms also ask for typed text or a number. */
  kind: "choice" | "text" | "number";
};

export type AskedQuestions = {
  /** The open tool call these questions came from. */
  call_id: string;
  questions: AskedQuestion[];
  /** The question the screen shows and Chat matched, or null. */
  current: number | null;
};

const TOOL = "AskUserQuestion";
const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 8;
const MAX_TEXT = 2000;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= MAX_TEXT
    ? value.trim()
    : null;

function question(value: unknown): AskedQuestion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const asked = text(item.question);
  const kind = item.kind === undefined ? "choice" : item.kind;
  if (!asked || (kind !== "choice" && kind !== "text" && kind !== "number"))
    return null;
  if (
    (item.header !== undefined && !text(item.header)) ||
    (item.multiSelect !== undefined && typeof item.multiSelect !== "boolean")
  )
    return null;
  const options = item.options === undefined ? [] : item.options;
  if (!Array.isArray(options) || options.length > MAX_OPTIONS) return null;
  const parsed: AskedQuestion["options"] = [];
  for (const option of options) {
    const label = text((option as Record<string, unknown> | null)?.label);
    if (!label) return null;
    const description = text((option as Record<string, unknown>).description);
    if (
      (option as Record<string, unknown>).description !== undefined &&
      !description
    )
      return null;
    parsed.push({ label, ...(description ? { description } : {}) });
  }
  if (kind === "choice" && parsed.length < 2) return null;
  const header = text(item.header);
  return {
    question: asked,
    ...(header ? { header } : {}),
    options: parsed,
    multi_select: item.multiSelect === true,
    kind,
  };
}

/**
 * The questions of the newest ask-the-user call with no result yet, when that
 * is the newest open call: an answered or interrupted ask has its result.
 * Rejected input stays pending without keys, so bounds failures cannot
 * bypass the transcript check or show a partial question as the whole one.
 */
export type PendingAsk =
  | Omit<AskedQuestions, "current">
  | { call_id: string; rejected: string };

export function askedQuestions(
  entries: readonly HistoryEntry[],
): PendingAsk | null {
  const entry = newestOpenCall(entries);
  if (!entry || entry.tool_name !== TOOL) return null;
  // A rejected pending ask is different from no ask: never retain screen keys.
  const rejected = {
    call_id: entry.source_call_id!,
    rejected: createHash("sha256").update(entry.text).digest("hex"),
  };
  try {
    const input = JSON.parse(entry.text);
    const list = input?.questions;
    if (!Array.isArray(list) || !list.length || list.length > MAX_QUESTIONS)
      return rejected;
    const questions = list.map(question);
    if (questions.some((item) => item === null)) return rejected;
    return {
      call_id: entry.source_call_id!,
      questions: questions as AskedQuestion[],
    };
  } catch {
    return rejected;
  }
}

/** Normalize paired rendering markup; keep literal wildcard and code contents. */
const plain = (value: string): string =>
  value
    .split(/(`+[^`]+`+)/g)
    .map((part) =>
      part.startsWith("`") && /^(`+)([^`]+)\1$/.test(part)
        ? part.replace(/^(`+)([^`]+)\1$/, "$2")
        : part
            .replace(
              /(^|[\s(])\*\*([^\s*](?:[^*]*[^\s*])?)\*\*(?=$|[\s).,!?])/g,
              "$1$2",
            )
            .replace(
              /(^|[\s(])\*([^\s*](?:[^*]*[^\s*])?)\*(?=$|[\s).,!?])/g,
              "$1$2",
            ),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
const optionText = (label: string, description?: string) =>
  `${plain(label)} ${plain(description ?? "")}`.trim();

export const UNMATCHED =
  "Chat could not match this question to what the terminal shows (it may be cut off, still drawing or changed), so it does not press a key.";
export const MULTI_SELECT =
  "Chat cannot pick several options safely yet. Answer this question in the Terminal.";
export const TYPED =
  "This question takes typed text or a number, which Chat cannot enter safely yet. Answer it in the Terminal.";

/**
 * Join the transcript's questions with the prompt read from the screen. The
 * screen's keys stay only when it shows one of these questions with exactly
 * its options (wrapping aside) and, for a form, the same header chips, or the
 * form's own review of those questions. Otherwise every question is shown
 * with no keys and the reason. The fingerprint covers both, so an answer is
 * refused if either changes.
 */
export function withAskedQuestions(
  screen: PendingPrompt | null,
  asked: PendingAsk | null,
): PendingPrompt | null {
  if (!asked) return screen;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([screen?.fingerprint ?? null, asked]))
    .digest("hex")
    .slice(0, 32);
  if ("rejected" in asked)
    return {
      question: screen?.question ?? [
        "Claude is waiting on a question Chat cannot read safely.",
      ],
      request: screen?.request ?? [],
      options: [],
      fingerprint,
      unanswerable:
        "Claude's recorded question is unsupported or exceeds Chat's limits. Answer it in the Terminal.",
      ...(screen?.screen ? { screen: screen.screen } : {}),
    };
  const { questions } = asked;
  const headers = questions.map((item) => plain(item.header ?? ""));
  const steps = screen?.steps?.map((step) => plain(step.label));
  const sameForm =
    questions.length > 1
      ? JSON.stringify(steps) === JSON.stringify(headers)
      : steps === undefined;
  const shown = plain(screen?.question.join(" ") ?? "");
  const current = questions.findIndex((item) => plain(item.question) === shown);
  const match = current >= 0 ? questions[current]! : null;
  const choices = screen?.options.filter((option) => !option.input) ?? [];
  const sameOptions =
    match !== null &&
    choices.length === match.options.length &&
    choices.every(
      (option, index) =>
        optionText(option.label, option.description) ===
        optionText(
          match.options[index]!.label,
          match.options[index]!.description,
        ),
    );
  // The review's full ordered question list must belong to this call.
  const reviewed = screen?.review
    ? screen.request
        .join(" ")
        .split(/(?:^|\s)●\s+/)
        .slice(1)
        .map((part) => plain(part.split(/\s+→\s+/)[0]!))
    : [];
  const sameReview =
    reviewed.length === questions.length &&
    reviewed.every((item, index) => item === plain(questions[index]!.question));
  const reason = match?.multi_select
    ? MULTI_SELECT
    : match && match.kind !== "choice"
      ? TYPED
      : null;
  if (
    screen &&
    !screen.menu &&
    screen.options.length &&
    sameForm &&
    ((sameOptions && !reason) ||
      // A form's review submits the answers to these same questions.
      (screen.review && sameReview && match === null && questions.length > 1))
  )
    return {
      ...screen,
      asked: { ...asked, current: match ? current : null },
      fingerprint,
    };
  const unanswered = match ? [match] : questions;
  return {
    question: unanswered.map((item) => item.question),
    request: [],
    options: [],
    asked: { ...asked, current: match ? current : null },
    unanswerable:
      reason ??
      (match
        ? UNMATCHED
        : questions.some((item) => item.multi_select)
          ? MULTI_SELECT
          : questions.some((item) => item.kind !== "choice")
            ? TYPED
            : UNMATCHED),
    ...(screen?.screen ? { screen: screen.screen } : {}),
    fingerprint,
  };
}
