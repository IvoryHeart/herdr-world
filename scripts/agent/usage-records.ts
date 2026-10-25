import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { codexUsage, reconcileEvents, snapshotId } from "./usage-reconcile";
import { parseClaudeSession } from "./usage-claude";
import {
  decodeRecords,
  isoTimestamp,
  prMentions,
  textContent,
  type RawRecord,
} from "./usage-content";

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
  estimateBlocked?: boolean;
};
export type Turn = { at: string; text: string };
export type UsageGap = { from: string; until?: string };
export type ParsedSession = {
  events: UsageEvent[];
  turns: Turn[];
  incompleteRecords: number;
  gaps: UsageGap[];
  claimedPrs: number[];
};

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

/** Parse a whole session before attribution so chunks and mirrors have one owner. */
export function parseSession(seat: Seat, lines: string): ParsedSession {
  if (seat.family === "claude") return parseClaudeSession(seat, lines);
  const records = decodeRecords(lines, "codex") as RawRecord[];
  const events = new Map<string, UsageEvent>();
  const turns: Turn[] = [];
  const claimedPrs = new Set<number>();
  const firstDedicatedIndex = records.findIndex(
    (r) => r.type === "token_usage_record",
  );
  const dedicatedFrom =
    firstDedicatedIndex >= 0
      ? isoTimestamp(records[firstDedicatedIndex]!.timestamp)
      : undefined;
  const userEvents = records.some(
    (r) => r.type === "event_msg" && r.payload?.type === "user_message",
  );
  let model = "unknown",
    effort = "unknown";
  for (const [recordIndex, record] of records.entries()) {
    const payload = record.payload ?? {};
    if (record.type === "turn_context" || record.type === "session_meta") {
      model = payload.model ?? model;
      effort =
        payload.effort ??
        payload.reasoning_effort ??
        payload.reasoning?.effort ??
        effort;
    }
    const user =
      record.type === "event_msg" && payload.type === "user_message"
        ? textContent(payload.message)
        : !userEvents &&
            record.type === "response_item" &&
            payload.role === "user"
          ? textContent(payload.content)
          : "";
    if (user && Number.isFinite(Date.parse(record.timestamp))) {
      turns.push({ at: new Date(record.timestamp).toISOString(), text: user });
      for (const pr of prMentions(user)) claimedPrs.add(pr);
    }
    let id: string, usage: RawRecord;
    if (record.type === "token_usage_record") {
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
      id = cumulative
        ? snapshotId(cumulative)
        : `count:${record.timestamp}:${JSON.stringify(codexUsage(usage))}`;
      if (events.has(id)) continue;
    }
    const at = isoTimestamp(record.timestamp);
    const tokens = codexUsage(usage);
    events.set(id, {
      ...seat,
      id,
      at,
      model: record.message?.model ?? payload.model ?? model,
      effort: payload.effort ?? payload.reasoning_effort ?? effort,
      input: tokens.input - tokens.read - tokens.write,
      cacheRead: tokens.read,
      cacheWrite: tokens.write,
      output: tokens.output,
      responses: 1,
      ...(record.type === "token_usage_record" ? { dedicatedFrom } : {}),
      ...(record.type === "token_usage_record" && payload.thread_token_usage
        ? { snapshot: snapshotId(payload.thread_token_usage) }
        : {}),
    });
  }
  return {
    events: reconcileEvents([...events.values()]),
    turns: turns.sort((a, b) => a.at.localeCompare(b.at)),
    incompleteRecords: 0,
    gaps: [],
    claimedPrs: [...claimedPrs],
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
