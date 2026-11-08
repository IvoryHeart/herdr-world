/**
 * Town's thought bubbles: what each working agent is doing now, projected
 * from the conversation summary Chat's Now bar reads (its running tool,
 * plan, latest request and terminal title). A step is a small set of kinds, each with a
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
  /**
   * What the agent is doing now, in a few words (townStepDoing): the running
   * step's own detail, its current plan item, its latest request, or, last,
   * its terminal title.
   */
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

/** Programs that run tests themselves. */
const RUNNERS = new Set([
  "pytest",
  "vitest",
  "jest",
  "mocha",
  "playwright",
  "cypress",
  "rspec",
  "phpunit",
  "ctest",
  "tox",
  "nox",
]);
/** Programs that run a test runner or a test script by name. */
const LAUNCHERS = new Set([
  "bun",
  "bunx",
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "deno",
  "cargo",
  "go",
  "make",
  "dotnet",
  "mvn",
  "gradle",
  "gradlew",
  "python",
  "python3",
  "uv",
  "poetry",
  "mix",
]);
/** A launcher's words that hand on to the script or module named next. */
const HAND_ON = new Set(["run", "exec", "x", "dlx", "-m"]);
/** A test script or subcommand: `test`, `tests`, `test:unit`. */
const TEST_SCRIPT = /^tests?(?::\S*)?$/;
/** Programs that only read or search files (`sed` only with `-n`). */
const READERS = new Set([
  "cat",
  "head",
  "tail",
  "rg",
  "grep",
  "ugrep",
  "ls",
  "find",
  "fd",
  "wc",
  "tree",
  "less",
  "bat",
]);
/** Words before the program that do not change what it does. */
const WRAPPERS = new Set(["env", "time", "nice", "command"]);
/** A description (Claude's) that says it runs tests: "Run the unit tests". */
const RUNS_TESTS =
  /^(?:re-?)?(?:run|runs|running|execute|executing)\b.*\b(?:tests?|specs?)\b/i;

/** A shell segment's program and its arguments, past wrappers. */
function program(segment: string): string[] {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    if (/^[A-Za-z_]\w*=/.test(word) || WRAPPERS.has(word)) index += 1;
    else if (word === "timeout") index += 2;
    else break;
  }
  const rest = words.slice(index);
  if (rest.length) rest[0] = rest[0]!.replace(/^.*\//, "");
  return rest;
}

/** Whether a shell segment runs tests: a runner, or a launcher's test script. */
function runsTests([name, ...args]: string[]) {
  if (!name) return false;
  if (RUNNERS.has(name)) return true;
  if (!LAUNCHERS.has(name)) return false;
  // The launcher's first word past its flags, or the one after `run`.
  const words = args.filter((word) => word === "-m" || !word.startsWith("-"));
  const first = words[0];
  if (!first) return false;
  if (TEST_SCRIPT.test(first) || RUNNERS.has(first)) return true;
  if (!HAND_ON.has(first)) return false;
  const next = words[1]?.replace(/^.*\//, "");
  return !!next && (TEST_SCRIPT.test(next) || RUNNERS.has(next));
}

/**
 * A shell step's kind from its summary, by the operation it runs, not by the
 * words in its arguments: `cat login.test.ts` reads, `bun test` tests. A
 * description, such as Claude writes, tests when it says it runs tests.
 */
function shellKind(summary: string | null): TownStepKind {
  if (!summary) return "command";
  const text = summary.trim();
  if (RUNS_TESTS.test(text)) return "test";
  const segments = text
    .split(/&&|\|\||;|\|/)
    .map(program)
    .filter((words) => words.length && words[0] !== "cd");
  if (segments.some(runsTests)) return "test";
  const [name, flag] = segments[0] ?? [];
  if (name && READERS.has(name)) return "read";
  if (name === "sed" && flag === "-n") return "read";
  return "command";
}

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
  if (COMMAND.has(name)) return shellKind(summary);
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
  latest_request?: string | null;
  quest?: {
    steps: readonly { text: string; status: string }[];
  } | null;
};

/** A step's detail in a few words: a path's file name, a URL's address. */
function detailWords(summary: string | null | undefined) {
  const text = summary?.trim();
  if (!text) return null;
  if (/^[a-z][\w+.-]*:\/\//i.test(text))
    return text.replace(/^[a-z][\w+.-]*:\/\//i, "");
  if (!/\s/.test(text) && text.includes("/"))
    return text.replace(/\/+$/, "").replace(/^.*\//, "") || text;
  return text;
}

/**
 * What the agent is doing now, in a few words, newest fact first: the
 * running step's own detail (a command's description, the file it edits, the
 * search query), then the plan item it marked in progress, then the latest
 * request it was given. The terminal title comes last: Claude Code names the
 * session's first topic there and does not change it, so on a long session
 * it says what the agent did first, not what it does now.
 */
export function townStepDoing(conversation: TownStepConversation) {
  return (
    detailWords(conversation.running_tool?.summary) ??
    (conversation.quest?.steps
      .find((step) => step.status === "active")
      ?.text.trim() ||
      null) ??
    (conversation.latest_request?.trim() || null) ??
    titleTask(conversation.terminal_title)
  );
}

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
  const task = townStepDoing(conversation);
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

/** A bubble's words at desk zoom: "Run the login tests · tests 3m". */
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
