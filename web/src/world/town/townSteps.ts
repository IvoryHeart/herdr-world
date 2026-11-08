/**
 * Town's thought bubbles: what each working agent is doing now, projected
 * from the facts Chat's Now bar reads (the conversation summary's running
 * tool and the terminal title). A step is a small set of kinds, each with a
 * glyph; a harness or tool Town does not know is just "working", with no
 * glyph, and keeps its typing dots.
 */

import { titleTask } from "../../components/chat/blocks/now";

export type TownStepKind =
  | "edit"
  | "test"
  | "command"
  | "read"
  | "web"
  | "think"
  | "agent";

export const TOWN_STEP_KINDS: readonly TownStepKind[] = [
  "edit",
  "test",
  "command",
  "read",
  "web",
  "think",
  "agent",
];

/** What a working agent's bubble shows. */
export type TownStep = {
  kind: TownStepKind;
  /** When the step started (ms), or null when the read does not say. */
  since: number | null;
  /** The task its harness names in the terminal title, as Chat shows it. */
  task: string | null;
};

/** Harnesses whose steps Chat already reads; others get no glyph. */
export const TOWN_STEP_HARNESSES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "pi",
]);

const EDIT = new Set([
  "edit",
  "multiedit",
  "write",
  "notebookedit",
  "apply_patch",
  "str_replace",
  "create",
  "write_file",
]);
const COMMAND = new Set([
  "bash",
  "bashoutput",
  "killshell",
  "killbash",
  "shell",
  "local_shell",
  "exec_command",
  "unified_exec",
  "write_stdin",
  "run",
]);
const READ = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "find",
  "search",
  "view",
  "read_file",
  "view_image",
]);
const WEB = new Set(["webfetch", "websearch", "web_search", "fetch"]);
const AGENT = new Set(["task", "agent", "spawn_agent", "wait_agent"]);
const THINK = new Set(["todowrite", "update_plan", "exitplanmode"]);

/** A command that runs tests, by its runner or its description. */
const TESTS =
  /\b(?:tests?|testing|pytest|vitest|jest|mocha|playwright|cypress|rspec|phpunit)\b/i;
/** A command that only reads or searches files. */
const READS =
  /^(?:cd\s+\S+\s*&&\s*)?(?:cat|sed\s+-n|head|tail|rg|grep|ugrep|ls|find|fd|wc|tree|less|bat)\b/;

/**
 * The kind of step a harness's tool call is: its tool name, and for a shell
 * command its summary (Claude's description or the command itself). An
 * unknown tool is null: the agent is working, with no glyph.
 */
export function townStepKind(
  tool: string,
  summary: string | null,
): TownStepKind | null {
  const name = tool.trim().toLowerCase();
  if (EDIT.has(name)) return "edit";
  if (READ.has(name)) return "read";
  if (WEB.has(name)) return "web";
  if (AGENT.has(name)) return "agent";
  if (THINK.has(name)) return "think";
  if (COMMAND.has(name)) {
    if (summary && TESTS.test(summary)) return "test";
    if (summary && READS.test(summary.trim())) return "read";
    return "command";
  }
  return null;
}

/** The parts of Chat's conversation summary a bubble reads. */
export type TownStepConversation = {
  status: string;
  agent: string | null;
  agent_status: string | null;
  terminal_title?: string | null;
  running_tool?: {
    name: string;
    summary: string | null;
    started_at: string;
  } | null;
};

/**
 * A working agent's step from its conversation summary, as Chat's Now bar
 * reads it: the open tool call is the step running now; with none, a known
 * harness is thinking or writing. Null when there is nothing to show: the
 * harness's steps are not read, the transcript is unavailable, or the tool
 * is not one Town knows.
 */
export function townStepOf(
  conversation: TownStepConversation,
  harness?: string,
): TownStep | null {
  const agent = (conversation.agent ?? harness ?? "").toLowerCase();
  if (!TOWN_STEP_HARNESSES.has(agent) || conversation.status !== "ok")
    return null;
  const task = titleTask(conversation.terminal_title);
  const tool = conversation.running_tool;
  if (!tool) return { kind: "think", since: null, task };
  const kind = townStepKind(tool.name, tool.summary);
  if (!kind) return null;
  const started = Date.parse(tool.started_at);
  return { kind, since: Number.isFinite(started) ? started : null, task };
}

const MINUTE = 60_000;

/**
 * How long a step may run before its bubble shows its time in amber. A test
 * run or command over ten minutes, an edit over three, a read or fetch over
 * five, a subagent over twenty. Thinking has no timer.
 */
export const TOWN_STEP_LONG_MS: Readonly<Record<TownStepKind, number>> = {
  edit: 3 * MINUTE,
  test: 10 * MINUTE,
  command: 10 * MINUTE,
  read: 5 * MINUTE,
  web: 5 * MINUTE,
  think: Infinity,
  agent: 20 * MINUTE,
};

/** Whether a step has run unusually long for its kind. */
export function townStepLong(step: TownStep, now: number) {
  return (
    step.since !== null && now - step.since >= TOWN_STEP_LONG_MS[step.kind]
  );
}

/** A step's age in whole minutes, "14m" or "1h 05m"; null under a minute. */
export function townStepAge(step: TownStep, now: number) {
  if (step.since === null) return null;
  const minutes = Math.floor((now - step.since) / MINUTE);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The step's word in a bubble, as short as Chat's Now bar. */
export const TOWN_STEP_WORDS: Readonly<Record<TownStepKind, string>> = {
  edit: "editing",
  test: "tests",
  command: "command",
  read: "reading",
  web: "web",
  think: "thinking",
  agent: "subagent",
};

/** The step with its timer: "tests 3m", or "editing" in its first minute. */
export function townStepLabel(step: TownStep, now: number) {
  const age = townStepAge(step, now);
  return age
    ? `${TOWN_STEP_WORDS[step.kind]} ${age}`
    : TOWN_STEP_WORDS[step.kind];
}

/** A bubble's words at desk zoom: "Fix login redirect · tests 3m". */
export function townStepWords(step: TownStep, now: number) {
  const label = townStepLabel(step, now);
  return step.task ? `${step.task} · ${label}` : label;
}

/** The agent's step for screen readers and tests: "Running tests, 14m". */
export const TOWN_STEP_NAMES: Readonly<Record<TownStepKind, string>> = {
  edit: "Editing files",
  test: "Running tests",
  command: "Running a command",
  read: "Reading code",
  web: "Browsing the web",
  think: "Thinking",
  agent: "Waiting on a subagent",
};
