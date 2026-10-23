import { basename } from "node:path";
import { redactSecrets } from "../herdr/task-summary";
import type { HistoryEntry } from "./session-history";

/**
 * One tool call as a step: what the agent did, with its evidence. Steps are
 * keyed by the harness's tool-call ID, so other views (Quests' objectives, a
 * Flight Recorder timeline) can point at the same step. A call without an ID
 * gets `entry:<entry id>`, which nothing else links to.
 */
export type ConversationStep = {
  id: string;
  /** The harness's tool-call ID, or null when the transcript has none. */
  call_id: string | null;
  tool: string;
  /** A short label, such as "Read reconnect.ts" or "Run tests". */
  label: string;
  /** The command, file, pattern or URL the call names. */
  input_summary: string | null;
  state: "running" | "ok" | "failed" | "interrupted";
  started_at: string;
  ended_at: string | null;
  /** The end of the result, bounded and with credentials redacted. */
  result_tail: string | null;
  /** For a file edit: the lines removed and added. */
  diff: StepDiff | null;
  /** For a test run: passed and failed counts. */
  test: TestStrip | null;
};

export type StepDiff = {
  file: string;
  removed: string[];
  added: string[];
  /** More lines changed than are shown. */
  truncated: boolean;
  /** How many changed lines are not shown. */
  omitted: number;
};

export type TestStrip = {
  runner: "bun" | "vitest" | "jest" | "pytest" | "cargo";
  passed: number;
  failed: number;
  /** The first failing test's name, when the output names one. */
  first_failure: string | null;
};

const TAIL_LINES = 12;
const TAIL_CHARS = 1500;
const DIFF_LINES = 40;

function argumentsOf(entry: HistoryEntry): Record<string, unknown> {
  try {
    const value = JSON.parse(entry.text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

function oneLine(value: string, limit = 160) {
  const line = value.split("\n")[0]!.trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

const fileName = (value: string) => basename(value) || value;

/** A label and summary from the tool's own arguments, by fixed rules. */
function describe(tool: string, input: Record<string, unknown>) {
  const name = tool.toLowerCase();
  const file =
    text(input.file_path) ?? text(input.path) ?? text(input.notebook_path);
  const command = text(input.command) ?? text(input.cmd);
  const description = text(input.description);
  if (["read", "view", "read_file"].includes(name) && file)
    return { label: `Read ${fileName(file)}`, summary: file };
  if (["edit", "multiedit", "str_replace", "apply_patch"].includes(name))
    return { label: file ? `Edit ${fileName(file)}` : "Edit", summary: file };
  if (["write", "create", "write_file"].includes(name))
    return { label: file ? `Write ${fileName(file)}` : "Write", summary: file };
  if (["bash", "shell", "exec_command", "run"].includes(name) && command)
    return {
      label: description
        ? oneLine(description, 80)
        : `Run ${oneLine(command, 60)}`,
      summary: oneLine(command),
    };
  if (["grep", "search"].includes(name) && text(input.pattern))
    return {
      label: `Search ${oneLine(String(input.pattern), 60)}`,
      summary: file,
    };
  if (name === "glob" && text(input.pattern))
    return {
      label: `Find ${oneLine(String(input.pattern), 60)}`,
      summary: file,
    };
  if (["webfetch", "fetch"].includes(name) && text(input.url))
    return { label: "Fetch", summary: oneLine(String(input.url)) };
  if (name === "task" || name === "agent")
    return {
      label: description ? `Agent: ${oneLine(description, 70)}` : "Agent",
      summary: null,
    };
  return {
    label: description ? oneLine(description, 80) : tool,
    summary: command ? oneLine(command) : file,
  };
}

function lines(value: unknown) {
  return typeof value === "string" && value ? value.split("\n") : [];
}

/** The lines an Edit, MultiEdit or Write call removes and adds. */
export function stepDiff(
  tool: string,
  input: Record<string, unknown>,
): StepDiff | null {
  const file = text(input.file_path) ?? text(input.path);
  if (!file) return null;
  const name = tool.toLowerCase();
  let removed: string[] = [];
  let added: string[] = [];
  if (name === "edit") {
    removed = lines(input.old_string);
    added = lines(input.new_string);
  } else if (name === "multiedit" && Array.isArray(input.edits)) {
    for (const edit of input.edits as Record<string, unknown>[]) {
      removed.push(...lines(edit?.old_string));
      added.push(...lines(edit?.new_string));
    }
  } else if (name === "write") {
    added = lines(input.content);
  } else return null;
  if (!removed.length && !added.length) return null;
  // One budget for both sides: a side that needs less leaves the rest to
  // the other, and any line left out marks the diff truncated.
  const half = Math.floor(DIFF_LINES / 2);
  const keepRemoved = Math.min(
    removed.length,
    Math.max(half, DIFF_LINES - added.length),
  );
  const keepAdded = Math.min(added.length, DIFF_LINES - keepRemoved);
  const omitted = removed.length - keepRemoved + added.length - keepAdded;
  return {
    file,
    removed: removed.slice(0, keepRemoved).map(redactSecrets),
    added: added.slice(0, keepAdded).map(redactSecrets),
    truncated: omitted > 0,
    omitted,
  };
}

/**
 * Pass and fail counts from a test runner's summary line, by fixed patterns
 * for bun, vitest, jest, pytest and cargo. Null when none matches.
 */
export function parseTestStrip(output: string): TestStrip | null {
  const firstFailure = (pattern: RegExp) =>
    pattern.exec(output)?.[1]?.trim() ?? null;
  // bun: " 12 pass" / " 1 fail" on their own lines.
  const bunPass = /^\s*(\d+) pass\s*$/m.exec(output);
  const bunFail = /^\s*(\d+) fail\s*$/m.exec(output);
  if (bunPass || bunFail)
    return {
      runner: "bun",
      passed: Number(bunPass?.[1] ?? 0),
      failed: Number(bunFail?.[1] ?? 0),
      first_failure: firstFailure(/^\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$/m),
    };
  // vitest: "Tests  1 failed | 12 passed (13)".
  const vitest = /Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/.exec(output);
  if (vitest)
    return {
      runner: "vitest",
      passed: Number(vitest[2]),
      failed: Number(vitest[1] ?? 0),
      first_failure: firstFailure(/^\s*(?:FAIL|×)\s+(.+)$/m),
    };
  // jest: "Tests:       1 failed, 12 passed, 13 total".
  const jest =
    /Tests:\s+(?:(\d+) failed,\s*)?(?:\d+ skipped,\s*)?(\d+) passed/.exec(
      output,
    );
  if (jest)
    return {
      runner: "jest",
      passed: Number(jest[2]),
      failed: Number(jest[1] ?? 0),
      first_failure: firstFailure(/^\s*●\s+(.+)$/m),
    };
  // pytest: "=== 1 failed, 12 passed in 0.84s ===".
  const pytest =
    /=+\s+(?:(\d+) failed,?\s*)?(?:(\d+) passed)?[^=\n]*\bin [\d.]+s\s*=+/.exec(
      output,
    );
  if (pytest && (pytest[1] || pytest[2]))
    return {
      runner: "pytest",
      passed: Number(pytest[2] ?? 0),
      failed: Number(pytest[1] ?? 0),
      first_failure: firstFailure(/^FAILED\s+(\S+)/m),
    };
  // cargo: "test result: FAILED. 12 passed; 1 failed;".
  const cargo = /test result: \w+\. (\d+) passed; (\d+) failed;/.exec(output);
  if (cargo)
    return {
      runner: "cargo",
      passed: Number(cargo[1]),
      failed: Number(cargo[2]),
      first_failure: firstFailure(/^test (\S+) \.\.\. FAILED$/m),
    };
  return null;
}

function tail(value: string) {
  const kept = value.split("\n").slice(-TAIL_LINES).join("\n");
  const bounded =
    kept.length > TAIL_CHARS ? `…${kept.slice(-(TAIL_CHARS - 1))}` : kept;
  return redactSecrets(bounded.trimEnd()) || null;
}

/**
 * The transcript's tool calls as steps, in order. A call with a result is ok,
 * or failed when the result is an error or its tests failed; a call with no
 * result is running if nothing came after it, else interrupted. Reads the
 * whole projection, not the visible window.
 */
export function stepsFromEntries(
  entries: readonly HistoryEntry[],
): ConversationStep[] {
  const results = new Map<string, HistoryEntry>();
  for (const entry of entries)
    if (entry.kind === "tool_result" && entry.source_call_id)
      results.set(entry.source_call_id, entry);
  const steps: ConversationStep[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind !== "tool_call") return;
    const tool = entry.tool_name || "tool";
    const input = argumentsOf(entry);
    const { label, summary } = describe(tool, input);
    const result = entry.source_call_id
      ? results.get(entry.source_call_id)
      : undefined;
    const later = entries
      .slice(index + 1)
      .some(
        (other) =>
          other.kind === "message" ||
          (other.kind === "tool_call" && other.sent_at > entry.sent_at),
      );
    const output = result?.text ?? "";
    const test =
      result && /\btest\b|pytest|vitest|jest|cargo/i.test(summary ?? "")
        ? parseTestStrip(output)
        : null;
    steps.push({
      id: entry.source_call_id ?? `entry:${entry.id}`,
      call_id: entry.source_call_id ?? null,
      tool,
      // A label can quote the command or its description, so it is redacted
      // like the summary.
      label: redactSecrets(label),
      input_summary: summary ? redactSecrets(summary) : null,
      state: result
        ? result.is_error || (test?.failed ?? 0) > 0
          ? "failed"
          : "ok"
        : later
          ? "interrupted"
          : "running",
      started_at: entry.sent_at,
      ended_at: result?.sent_at ?? null,
      result_tail: result ? tail(output) : null,
      diff: stepDiff(tool, input),
      test,
    });
  });
  return steps;
}
