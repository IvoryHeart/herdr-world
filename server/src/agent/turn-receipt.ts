import { isConversationStep } from "./session-messages";
import type { AtifStep, AtifTrajectory, SessionFile } from "./session-types";
import { stableMessageId } from "./session-utils";

const MAX_ASK_CHARS = 600;
const MAX_REPORT_CHARS = 2_400;
const MAX_FILES = 24;
const EDIT_TOOL = /edit|write|patch|create|replace|notebook|insert/i;
const COMMAND_TOOL = /bash|shell|exec|command|terminal|run/i;
const PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "notebook_path",
  "target_file",
  "filename",
];
const PATCH_HEADER = /\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g;
// Projections label some non-text agent records with these placeholders.
const PLACEHOLDER = /^(?:Reasoning|Token usage)$/;

/**
 * The latest agent turn: everything the agent did after the most recent user
 * message. It is the unit a person reviews when an agent stops, so it carries
 * the request, the agent's closing report and what the agent's tools touched.
 */
export type TurnReceipt = {
  turn_id: string;
  ask: string | null;
  report: string | null;
  /** The closing message was longer than this receipt carries. */
  report_truncated: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  tool_calls: number;
  commands: number;
  files: string[];
  files_truncated: boolean;
};

// Harnesses wrap pasted or injected text in XML-like tags; keep the words.
const WRAPPER_TAG = /<\/?[a-z][\w-]*(?:\s[^<>]*)?>/gi;

function clip(value: string, max: number) {
  const text = value
    .replace(WRAPPER_TAG, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const points = [...text];
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : text;
}

function time(step: AtifStep | undefined) {
  if (!step?.timestamp) return null;
  const ms = Date.parse(step.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function editedPaths(step: AtifStep, into: Set<string>) {
  for (const call of step.tool_calls ?? []) {
    const args = call.arguments ?? {};
    if (EDIT_TOOL.test(call.function_name)) {
      for (const key of PATH_KEYS) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) into.add(value.trim());
      }
    }
    // apply_patch reaches transcripts both as its own tool and inside shell
    // commands, so read patch headers wherever they appear.
    const raw = JSON.stringify(args);
    if (raw.includes("*** ")) {
      for (const match of raw.matchAll(PATCH_HEADER)) into.add(match[1].trim());
    }
  }
}

export const FULL_REPORT_CHARS = 32_000;

export function latestTurnReceipt(
  file: SessionFile,
  trajectory: AtifTrajectory,
  reportChars = MAX_REPORT_CHARS,
): TurnReceipt | null {
  const steps = trajectory.steps;
  if (!steps.length) return null;
  let start = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.source === "user" && isConversationStep(step)) {
      start = index;
      break;
    }
  }
  const askStep = start >= 0 ? steps[start] : undefined;
  const turn = steps.slice(start + 1);
  let report: AtifStep | undefined;
  const files = new Set<string>();
  let toolCalls = 0;
  let commands = 0;
  for (const step of turn) {
    if (
      step.source === "agent" &&
      isConversationStep(step) &&
      !PLACEHOLDER.test(step.message.trim())
    )
      report = step;
    toolCalls += step.tool_calls?.length ?? 0;
    for (const call of step.tool_calls ?? [])
      if (COMMAND_TOOL.test(call.function_name)) commands += 1;
    editedPaths(step, files);
  }
  const started = time(askStep) ?? time(turn[0]);
  // Later system records (hooks, resumes) do not extend the agent's work.
  let ended: number | null = null;
  for (let index = turn.length - 1; index >= 0 && ended === null; index -= 1)
    if (turn[index].source === "agent") ended = time(turn[index]);
  const listed = [...files];
  const fullReport = report
    ? clip(report.message, Number.MAX_SAFE_INTEGER)
    : null;
  return {
    // A blocked agent can resume within the same user turn, so the id also
    // names the agent's latest step: each stop is a separate handoff. Trailing
    // system records (hooks, resumes) are bookkeeping and must not reopen a
    // reviewed stop.
    turn_id: `${stableMessageId(file.path, askStep?.step_id ?? -1)}..${
      turn.findLast((step) => step.source === "agent")?.step_id ?? "start"
    }`,
    ask: askStep ? clip(askStep.message, MAX_ASK_CHARS) : null,
    report: fullReport === null ? null : clip(fullReport, reportChars),
    report_truncated:
      fullReport !== null && [...fullReport].length > reportChars,
    started_at: started === null ? null : new Date(started).toISOString(),
    ended_at: ended === null ? null : new Date(ended).toISOString(),
    duration_ms:
      started !== null && ended !== null ? Math.max(0, ended - started) : null,
    tool_calls: toolCalls,
    commands,
    files: listed.slice(0, MAX_FILES),
    files_truncated: listed.length > MAX_FILES,
  };
}
