import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { codexUsage, reconcileEvents, snapshotId } from "./usage-reconcile";

export type Family = "codex" | "claude";
export type Seat = {
  seat: string;
  family: Family;
  session: string;
  path?: string;
};
export type Tokens = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  responses: number;
};
export type UsageEvent = Tokens & {
  id: string;
  session: string;
  seat: string;
  family: Family;
  model: string;
  effort: string;
  at: string;
  snapshot?: string;
  replaces?: string[];
  dedicatedFrom?: string;
};
export type Turn = { at: string; text: string };
export type ParsedSession = {
  events: UsageEvent[];
  turns: Turn[];
  incompleteRecords: number;
};
type RecordValue = Record<string, any>;

export function discoverSeats(value: any): Seat[] {
  const agents = value?.result?.agents ?? value?.agents ?? value;
  if (!Array.isArray(agents))
    throw new Error("Invalid Herdr agent list response");
  return agents.flatMap((agent) => {
    const family = agent.agent ?? agent.agent_session?.agent;
    const session = agent.agent_session?.value;
    return (family === "codex" || family === "claude") &&
      typeof session === "string" &&
      session
      ? [
          {
            seat: typeof agent.name === "string" ? agent.name : "unknown",
            family,
            session,
          },
        ]
      : [];
  });
}

function number(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Invalid recorded token count");
  return value as number;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value
        .filter((part) => part?.type === "text" || part?.type === "input_text")
        .map((part) => part.text ?? "")
        .join("\n")
    : "";
}

/** Parse a whole session before attribution so streamed chunks cannot cross windows. */
export function parseSession(seat: Seat, lines: string): ParsedSession {
  const records: RecordValue[] = [];
  const pieces = lines.split("\n");
  let incompleteRecords = 0;
  let precedingTimestamp: string | undefined;
  for (let index = 0; index < pieces.length; index++) {
    const line = pieces[index]!;
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record))
        throw new Error("Invalid JSONL object");
      records.push(record);
      if (Number.isFinite(Date.parse(record.timestamp)))
        precedingTimestamp = new Date(record.timestamp).toISOString();
    } catch {
      // A running harness may not have finished its final JSONL line yet.
      if (index === pieces.length - 1) continue;
      if (seat.family !== "claude")
        throw new Error("Malformed session JSONL record");
      incompleteRecords++;
      // Unknown content could be a new prompt. End the preceding estimate at
      // the last known timestamp rather than attributing across a damaged gap.
      if (precedingTimestamp)
        records.push({ type: "usage_gap", timestamp: precedingTimestamp });
    }
  }
  const events = new Map<string, UsageEvent>();
  const turns: Turn[] = [];
  const firstDedicatedIndex = records.findIndex(
    (r) => r.type === "token_usage_record",
  );
  const dedicatedFrom =
    firstDedicatedIndex >= 0
      ? records[firstDedicatedIndex]!.timestamp
      : undefined;
  if (dedicatedFrom && !Number.isFinite(Date.parse(dedicatedFrom)))
    throw new Error("Invalid usage timestamp");
  const userEvents = records.some(
    (r) => r.type === "event_msg" && r.payload?.type === "user_message",
  );
  let model = "unknown";
  let effort = "unknown";
  for (const [recordIndex, record] of records.entries()) {
    if (record.type === "usage_gap") {
      turns.push({ at: record.timestamp, text: "" });
      continue;
    }
    const payload = record.payload ?? {};
    if (record.type === "turn_context" || record.type === "session_meta") {
      model = payload.model ?? model;
      effort =
        payload.effort ??
        payload.reasoning_effort ??
        payload.reasoning?.effort ??
        effort;
    }
    const message = record.message;
    const user =
      seat.family === "claude"
        ? record.type === "user" && !record.isMeta
          ? textContent(message?.content)
          : ""
        : record.type === "event_msg" && payload.type === "user_message"
          ? textContent(payload.message)
          : !userEvents &&
              record.type === "response_item" &&
              payload.role === "user"
            ? textContent(payload.content)
            : "";
    if (user && Number.isFinite(Date.parse(record.timestamp)))
      turns.push({ at: new Date(record.timestamp).toISOString(), text: user });
    let id: string;
    let usage: RecordValue;
    if (seat.family === "claude") {
      if (record.type !== "assistant" || !message?.usage) continue;
      if (typeof message.id !== "string" || !message.id)
        throw new Error("Missing Claude message ID");
      id = message.id;
      usage = message.usage;
    } else if (record.type === "token_usage_record") {
      id = payload.response_id;
      usage = payload.usage;
      if (!id || !usage) throw new Error("Incomplete Codex response usage");
      if (events.has(id)) throw new Error("Duplicate Codex response usage");
    } else {
      if (
        (firstDedicatedIndex >= 0 && recordIndex >= firstDedicatedIndex) ||
        record.type !== "event_msg" ||
        payload.type !== "token_count" ||
        !payload.info?.last_token_usage
      )
        continue;
      usage = payload.info.last_token_usage;
      const cumulative = payload.info.total_token_usage;
      // Token-count notifications can repeat without a new response.
      id = cumulative
        ? snapshotId(cumulative)
        : `count:${record.timestamp}:${JSON.stringify(codexUsage(usage))}`;
      if (events.has(id)) continue;
    }
    if (!Number.isFinite(Date.parse(record.timestamp)))
      throw new Error("Invalid usage timestamp");
    const codex = seat.family === "codex" ? codexUsage(usage) : null;
    const cached = number(
      seat.family === "codex"
        ? usage.cached_input_tokens
        : usage.cache_read_input_tokens,
    );
    const rawInput = number(usage.input_tokens);
    const output = number(usage.output_tokens);
    if (
      seat.family === "codex" &&
      (cached > rawInput ||
        (usage.total_tokens !== undefined &&
          number(usage.total_tokens) !== rawInput + output))
    )
      throw new Error("Incomplete Codex token accounting");
    const event: UsageEvent = {
      ...seat,
      id,
      at: new Date(record.timestamp).toISOString(),
      model: message?.model ?? payload.model ?? model,
      effort: payload.effort ?? payload.reasoning_effort ?? effort,
      input:
        seat.family === "codex" ? rawInput - cached - codex!.write : rawInput,
      cacheRead: cached,
      cacheWrite: codex?.write ?? number(usage.cache_creation_input_tokens),
      output,
      responses: 1,
      ...(record.type === "token_usage_record"
        ? { dedicatedFrom: new Date(dedicatedFrom!).toISOString() }
        : {}),
      ...(record.type === "token_usage_record" && payload.thread_token_usage
        ? { snapshot: snapshotId(payload.thread_token_usage) }
        : {}),
    };
    const prior = events.get(id);
    if (prior) {
      for (const field of [
        "input",
        "cacheRead",
        "cacheWrite",
        "output",
      ] as const)
        prior[field] = Math.max(prior[field], event[field]);
      if (event.at < prior.at) prior.at = event.at;
      if (event.model !== "unknown") prior.model = event.model;
    } else events.set(id, event);
  }
  return {
    events: reconcileEvents([...events.values()]),
    turns: turns.sort((a, b) => a.at.localeCompare(b.at)),
    incompleteRecords,
  };
}

export async function resolveLogs(
  seats: Seat[],
  roots: Record<Family, string>,
  onMissing?: (seat: Seat) => void,
): Promise<{ seat: Seat; parsed: ParsedSession }[]> {
  const paths = new Map<string, string[]>();
  for (const family of ["codex", "claude"] as const) {
    const requested = seats.filter(
      (s) => s.family === family && !isAbsolute(s.session),
    );
    if (!requested.length) continue;
    try {
      for await (const path of new Bun.Glob("**/*.jsonl").scan({
        cwd: roots[family],
        absolute: true,
        onlyFiles: true,
      })) {
        const name = basename(path);
        for (const seat of requested) {
          if (
            name === `${seat.session}.jsonl` ||
            name.endsWith(`-${seat.session}.jsonl`)
          ) {
            const key = `${family}:${seat.session}`;
            paths.set(key, [...(paths.get(key) ?? []), path]);
          }
        }
      }
    } catch {
      if (!onMissing) throw new Error("A session directory is unavailable");
    }
  }
  const result: { seat: Seat; parsed: ParsedSession }[] = [];
  const seenPaths = new Set<string>();
  for (const seat of seats) {
    let resolved: Seat;
    let parsed: ParsedSession;
    const consumed: string[] = [];
    try {
      const matches = isAbsolute(seat.session)
        ? [seat.session]
        : [...new Set(paths.get(`${seat.family}:${seat.session}`) ?? [])];
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? "Multiple logs match a session; use its absolute path"
            : "A session log is unavailable; accounting was not refreshed",
        );
      resolved = { ...seat, path: await realpath(matches[0]!) };
      parsed = parseSession(resolved, await readFile(resolved.path!, "utf8"));
      consumed.push(resolved.path!);
      if (seat.family === "claude") {
        const companionRoot = join(
          dirname(resolved.path!),
          basename(resolved.path!, ".jsonl"),
          "subagents",
        );
        if (existsSync(companionRoot))
          for await (const child of new Bun.Glob("**/*.jsonl").scan({
            cwd: companionRoot,
            absolute: true,
            onlyFiles: true,
          })) {
            const childPath = await realpath(child);
            consumed.push(childPath);
            const childParsed = parseSession(
              resolved,
              await readFile(childPath, "utf8"),
            );
            parsed.events.push(...childParsed.events);
            parsed.incompleteRecords += childParsed.incompleteRecords;
          }
        parsed.events = reconcileEvents(parsed.events);
      }
    } catch (error) {
      if (!onMissing) throw error;
      onMissing(seat);
      continue;
    }
    if (consumed.some((path) => seenPaths.has(path)))
      throw new Error(
        "Two session identifiers resolve to the same log; select one canonical session",
      );
    consumed.forEach((path) => seenPaths.add(path));
    result.push({ seat: resolved, parsed });
  }
  return result;
}
