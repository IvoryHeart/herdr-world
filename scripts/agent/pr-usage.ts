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

export function summarizeUsage(
  logs: readonly { sessionId: string; lines: string }[],
  from?: string,
  until?: string,
): UsageSummary {
  const start = from ? Date.parse(from) : -Infinity;
  const end = until ? Date.parse(until) : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    throw new Error(
      "Use valid ISO timestamps with --from earlier than --until",
    );
  }
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
};

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    sessions: [],
    sessionsDir: join(
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      "sessions",
    ),
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
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
    const summary = summarizeUsage(
      await readSessionLogs(options),
      options.from,
      options.until,
    );
    if (summary.responses === 0) {
      throw new Error("No per-response usage records in the selected interval");
    }
    if (options.json) {
      console.log(
        JSON.stringify({ pr: options.pr ?? null, ...summary }, null, 2),
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
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
