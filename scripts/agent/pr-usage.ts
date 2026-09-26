import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

type UsageRecord = {
  timestamp: string;
  type: string;
  payload?: {
    response_id?: string;
    usage?: Usage;
  };
};

export type UsageSummary = {
  responses: number;
  input: number;
  cachedInput: number;
  uncachedInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
  first: string | null;
  last: string | null;
};

export type ToolingSummary = {
  outerCalls: number;
  execWrappers: number;
  singleNestedExecWrappers: number;
  nestedCalls: number;
  testCommands: number;
  quickTypechecks: number;
  fullChecks: number;
  githubCommands: number;
  outputChars: number;
  largeOutputs: number;
};

function timeBounds(from?: string, until?: string) {
  const start = from ? Date.parse(from) : -Infinity;
  const end = until ? Date.parse(until) : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    throw new Error(
      "Use valid ISO timestamps with --from earlier than --until",
    );
  }
  return { start, end };
}

export function summarizeUsage(
  logs: readonly { sessionId: string; lines: string }[],
  from?: string,
  until?: string,
): UsageSummary {
  const { start, end } = timeBounds(from, until);
  const summary: UsageSummary = {
    responses: 0,
    input: 0,
    cachedInput: 0,
    uncachedInput: 0,
    output: 0,
    reasoningOutput: 0,
    total: 0,
    first: null,
    last: null,
  };
  const seen = new Set<string>();
  for (const log of logs) {
    for (const line of log.lines.split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as UsageRecord;
      if (record.type !== "token_usage_record") continue;
      const timestamp = Date.parse(record.timestamp);
      if (Number.isNaN(timestamp)) throw new Error("Invalid usage timestamp");
      if (timestamp < start || timestamp >= end) continue;
      const { response_id: responseId, usage } = record.payload ?? {};
      if (!responseId || !usage || !validUsage(usage)) {
        throw new Error("Incomplete token_usage_record in selected interval");
      }
      const key = `${log.sessionId}:${responseId}`;
      if (seen.has(key)) throw new Error("Duplicate response usage record");
      seen.add(key);
      summary.responses++;
      summary.input += usage.input_tokens;
      summary.cachedInput += usage.cached_input_tokens;
      summary.output += usage.output_tokens;
      summary.reasoningOutput += usage.reasoning_output_tokens;
      summary.total += usage.total_tokens;
      if (!summary.first || record.timestamp < summary.first) {
        summary.first = record.timestamp;
      }
      if (!summary.last || record.timestamp > summary.last) {
        summary.last = record.timestamp;
      }
    }
  }
  summary.uncachedInput = summary.input - summary.cachedInput;
  return summary;
}

type ToolRecord = {
  timestamp: string;
  type: string;
  payload?: {
    type?: string;
    name?: string;
    input?: string;
    output?: Array<{ text?: string }> | string;
  };
};

function commandLiterals(input: string): string[] {
  const commands: string[] = [];
  for (const match of input.matchAll(/\bcmd\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    try {
      commands.push(JSON.parse(match[1]) as string);
    } catch {
      // Dynamically constructed commands cannot be classified from the rollout.
    }
  }
  return commands;
}

/** Read executable shell words, leaving quoted arguments and heredoc bodies opaque. */
function shellCommands(script: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: "'" | '"' | null = null;
  const heredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
  let inHeredocBody = false;
  const flushWord = () => {
    if (!wordStarted) return;
    words.push(word);
    word = "";
    wordStarted = false;
  };
  const flushCommand = () => {
    flushWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < script.length; ) {
    if (inHeredocBody) {
      const end = script.indexOf("\n", index);
      const line = script
        .slice(index, end < 0 ? undefined : end)
        .replace(/\r$/, "");
      const next = heredocs[0];
      if (
        next &&
        (next.stripTabs ? line.replace(/^\t+/, "") : line) === next.delimiter
      ) {
        heredocs.shift();
        inHeredocBody = heredocs.length > 0;
      }
      index = end < 0 ? script.length : end + 1;
      continue;
    }
    const char = script[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === "\\" && index + 1 < script.length) {
        word += script[++index];
      } else word += char;
      index++;
      continue;
    }
    if (char === "\\" && index + 1 < script.length) {
      const next = script[++index]!;
      if (next !== "\n") {
        word += next;
        wordStarted = true;
      }
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      wordStarted = true;
      index++;
      continue;
    }
    if (char === "#" && !wordStarted) {
      const end = script.indexOf("\n", index);
      index = end < 0 ? script.length : end;
      continue;
    }
    if (
      char === "<" &&
      script[index + 1] === "<" &&
      script[index + 2] !== "<"
    ) {
      flushWord();
      index += 2;
      const stripTabs = script[index] === "-";
      if (stripTabs) index++;
      while (script[index] === " " || script[index] === "\t") index++;
      let delimiter = "";
      let delimiterQuote: "'" | '"' | null = null;
      while (index < script.length) {
        const next = script[index]!;
        if (delimiterQuote) {
          if (next === delimiterQuote) delimiterQuote = null;
          else delimiter += next;
        } else if (next === "'" || next === '"') delimiterQuote = next;
        else if (/\s|[;&|()]/.test(next)) break;
        else delimiter += next;
        index++;
      }
      if (delimiter) heredocs.push({ delimiter, stripTabs });
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      flushWord();
      index++;
      continue;
    }
    if (char === "\n") {
      flushCommand();
      index++;
      inHeredocBody = heredocs.length > 0;
      continue;
    }
    if (";&|()".includes(char)) {
      flushCommand();
      index++;
      continue;
    }
    word += char;
    wordStarted = true;
    index++;
  }
  flushCommand();
  return commands;
}

function executableWords(words: readonly string[]): readonly string[] {
  let index = 0;
  while (
    ["if", "then", "while", "until", "do", "!"].includes(words[index] ?? "")
  )
    index++;
  if (words[index] === "env") {
    index++;
    while (/^[-\w]+=|^-/.test(words[index] ?? "")) index++;
  }
  while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[index] ?? "")) index++;
  if (words[index] === "npm" && words[index + 1] === "exec") {
    const separator = words.indexOf("--", index + 2);
    if (
      separator > index + 2 &&
      words.slice(index + 2, separator).some((word) => /^bun(?:@|$)/.test(word))
    )
      return ["bun", ...words.slice(separator + 1)];
  }
  return words.slice(index);
}

export function summarizeTooling(
  logs: readonly { sessionId: string; lines: string }[],
  from?: string,
  until?: string,
): ToolingSummary {
  const { start, end } = timeBounds(from, until);
  const summary: ToolingSummary = {
    outerCalls: 0,
    execWrappers: 0,
    singleNestedExecWrappers: 0,
    nestedCalls: 0,
    testCommands: 0,
    quickTypechecks: 0,
    fullChecks: 0,
    githubCommands: 0,
    outputChars: 0,
    largeOutputs: 0,
  };
  for (const log of logs) {
    for (const line of log.lines.split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as ToolRecord;
      if (record.type !== "response_item") continue;
      const timestamp = Date.parse(record.timestamp);
      if (Number.isNaN(timestamp)) throw new Error("Invalid tool timestamp");
      if (timestamp < start || timestamp >= end) continue;
      const payload = record.payload;
      if (
        payload?.type === "custom_tool_call" ||
        payload?.type === "function_call"
      ) {
        summary.outerCalls++;
        if (payload.name !== "exec") continue;
        summary.execWrappers++;
        const input = payload.input ?? "";
        const nested = input.match(/\btools\.[a-zA-Z_]\w*\s*\(/g) ?? [];
        summary.nestedCalls += nested.length;
        if (nested.length === 1) summary.singleNestedExecWrappers++;
        for (const command of commandLiterals(input)) {
          for (const shellWords of shellCommands(command)) {
            const words = executableWords(shellWords);
            if (words[0] === "bun" && words[1] === "test")
              summary.testCommands++;
            if (words[0] === "bun" && words[1] === "run") {
              if (words[2] === "typecheck:quick") summary.quickTypechecks++;
              if (words[2] === "check") summary.fullChecks++;
            }
            if (words[0] === "gh") summary.githubCommands++;
          }
        }
      } else if (
        payload?.type === "custom_tool_call_output" ||
        payload?.type === "function_call_output"
      ) {
        const output = payload.output;
        const chars =
          typeof output === "string"
            ? output.length
            : Array.isArray(output)
              ? output.reduce(
                  (total, block) => total + (block.text?.length ?? 0),
                  0,
                )
              : 0;
        summary.outputChars += chars;
        if (chars >= 10_000) summary.largeOutputs++;
      }
    }
  }
  return summary;
}

function validUsage(value: Usage): boolean {
  const fields = [
    value.input_tokens,
    value.cached_input_tokens,
    value.output_tokens,
    value.reasoning_output_tokens,
    value.total_tokens,
  ];
  return (
    fields.every((field) => Number.isSafeInteger(field) && field >= 0) &&
    value.cached_input_tokens <= value.input_tokens &&
    value.reasoning_output_tokens <= value.output_tokens &&
    value.total_tokens === value.input_tokens + value.output_tokens
  );
}

type Options = {
  pr?: string;
  sessions: string[];
  from?: string;
  until?: string;
  sessionsDir: string;
  json: boolean;
  tooling: boolean;
};

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    sessions: [],
    sessionsDir: join(
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      "sessions",
    ),
    json: false,
    tooling: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--tooling") {
      options.tooling = true;
      continue;
    }
    if (
      !["--pr", "--session", "--from", "--until", "--sessions-dir"].includes(
        flag,
      )
    ) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--pr") options.pr = value;
    if (flag === "--session") options.sessions.push(value);
    if (flag === "--from") options.from = value;
    if (flag === "--until") options.until = value;
    if (flag === "--sessions-dir") options.sessionsDir = value;
  }
  if (options.sessions.length === 0 && process.env.CODEX_SESSION_ID) {
    options.sessions.push(process.env.CODEX_SESSION_ID);
  }
  if (options.sessions.length === 0) {
    throw new Error("Pass --session for each contributing Codex session");
  }
  if (options.sessions.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error("--session must be a Codex UUID");
  }
  if (options.pr && !/^[1-9]\d*$/.test(options.pr)) {
    throw new Error("--pr must be a pull request number");
  }
  return options;
}

async function readSessionLogs(options: Options) {
  const files = new Map<string, string>();
  for await (const path of new Bun.Glob("**/*.jsonl").scan({
    cwd: options.sessionsDir,
    absolute: true,
    onlyFiles: true,
  })) {
    for (const id of options.sessions) {
      if (basename(path).endsWith(`-${id}.jsonl`)) {
        if (files.has(id)) throw new Error("Multiple logs match one session");
        files.set(id, path);
      }
    }
  }
  for (const id of options.sessions) {
    if (!files.has(id))
      throw new Error("A requested Codex session log was not found");
  }
  return Promise.all(
    options.sessions.map(async (sessionId) => ({
      sessionId,
      lines: await readFile(files.get(sessionId)!, "utf8"),
    })),
  );
}

if (import.meta.main) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const logs = await readSessionLogs(options);
    const summary = summarizeUsage(logs, options.from, options.until);
    const tooling = options.tooling
      ? summarizeTooling(logs, options.from, options.until)
      : null;
    if (summary.responses === 0) {
      throw new Error("No per-response usage records in the selected interval");
    }
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            pr: options.pr ?? null,
            ...summary,
            ...(tooling ? { tooling } : {}),
          },
          null,
          2,
        ),
      );
    } else {
      const label = options.pr ? `PR #${options.pr}` : "Codex usage";
      console.log(
        `${label}: ${summary.responses} model responses across ${options.sessions.length} session(s)`,
      );
      console.log(
        `Boundary: ${options.from ?? "session start"} to ${options.until ?? "latest recorded response"} (end exclusive)`,
      );
      console.log(`Recorded: ${summary.first} to ${summary.last}`);
      console.log(
        `Input ${summary.input} (cached ${summary.cachedInput}, uncached ${summary.uncachedInput}); output ${summary.output} (reasoning ${summary.reasoningOutput}, included in output); total ${summary.total}.`,
      );
      console.log(
        "These are recorded tokens, not billed cost. The caller defines which sessions and interval belong to the PR.",
      );
      if (tooling) {
        console.log(
          `Tools: ${tooling.outerCalls} outer calls, ${tooling.execWrappers} exec wrappers (${tooling.singleNestedExecWrappers} with one nested call), ${tooling.nestedCalls} nested calls.`,
        );
        console.log(
          `Recognized commands: ${tooling.testCommands} tests, ${tooling.quickTypechecks} quick typechecks, ${tooling.fullChecks} full checks, ${tooling.githubCommands} GitHub commands.`,
        );
        console.log(
          `Tool output: ${tooling.outputChars} characters; ${tooling.largeOutputs} results at least 10000 characters. Command counts are best effort for literal exec_command arguments.`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
