import type { BoardProjectSource } from "../../../../../shared/boardElements";
import type { WorldObject } from "../../worldObject";

/**
 * Where a project element reads from, as World sees it now: the saved
 * connection's host and workspace labels and its current generation. A read
 * names exactly this connection; an offline or stale host is never swapped
 * for another one (AGENTS.md, connection identity).
 */
export type SourcePlace = {
  hostLabel: string;
  workspaceLabel: string;
  /** Set only while the saved connection is live; reads must name it. */
  generation: number | null;
};

export function sourcePlace(
  world: Pick<WorldObject, "hosts">,
  source: Pick<BoardProjectSource, "connection_id" | "workspace_id">,
): SourcePlace {
  const host = world.hosts.find(
    (entry) => entry.connectionId === source.connection_id,
  );
  const space = host?.spaces.find(
    (entry) => entry.nativeId === source.workspace_id,
  );
  return {
    hostLabel: host?.label ?? source.connection_id,
    workspaceLabel: space?.label ?? source.workspace_id,
    generation: host && !host.stale ? host.generation : null,
  };
}

/** A project a new element can read from: a live host's workspace. */
export type ProjectChoice = {
  value: string;
  connectionId: string;
  workspaceId: string;
  label: string;
};
export function projectChoices(
  world: Pick<WorldObject, "hosts">,
): ProjectChoice[] {
  return world.hosts
    .filter((host) => !host.stale)
    .flatMap((host) =>
      host.spaces
        .filter((space) => !space.stale)
        .map((space) => ({
          value: JSON.stringify([host.connectionId, space.nativeId]),
          connectionId: host.connectionId,
          workspaceId: space.nativeId,
          label: `${space.label} · ${host.label}`,
        })),
    );
}

export type TranscriptTurn = {
  who: "you" | "agent" | "tool" | "note";
  text: string;
};

const MAX_TURN = 2000;
/** Text from a message's content: a string, or text parts of an array. */
function contentText(content: unknown): { text: string; tool?: string } {
  if (typeof content === "string") return { text: content };
  if (!Array.isArray(content)) return { text: "" };
  const texts: string[] = [];
  let tool: string | undefined;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === "string") texts.push(p.text);
    else if (p.type === "tool_use" && typeof p.name === "string")
      tool ??= p.name;
    else if (p.type === "tool_result") tool ??= "result";
  }
  return { text: texts.join("\n"), tool };
}
function roleOf(role: unknown): TranscriptTurn["who"] | null {
  if (role === "user" || role === "human") return "you";
  if (role === "assistant" || role === "agent" || role === "model")
    return "agent";
  if (role === "tool") return "tool";
  if (role === "system" || role === "developer") return "note";
  return null;
}
/**
 * One JSONL line as a turn, for the shapes harnesses save: a message with a
 * role (`{role, content}`), wrapped once (`{message: {...}}`,
 * `{payload: {...}}`), or a typed event (`{type: "user"|"assistant"}`).
 * Anything else stays visible as raw text under "note".
 */
function turnOf(line: unknown): TranscriptTurn | null {
  if (!line || typeof line !== "object") return null;
  const entry = line as Record<string, unknown>;
  const inner = [entry.message, entry.payload, entry].find(
    (candidate): candidate is Record<string, unknown> =>
      !!candidate && typeof candidate === "object" && "role" in candidate,
  );
  const who = roleOf(inner?.role) ?? roleOf(entry.type);
  if (!who) return null;
  const body = contentText(inner?.content ?? entry.content ?? entry.text);
  if (body.tool && !body.text.trim())
    return { who: "tool", text: body.tool === "result" ? "…" : body.tool };
  if (!body.text.trim()) return null;
  const text =
    body.text.length > MAX_TURN
      ? `${body.text.slice(0, MAX_TURN)}…`
      : body.text;
  return { who, text };
}

/**
 * A saved transcript as turns, when it is JSON lines; null for plain text,
 * which the reader shows as it is. A last line cut by the read limit is left
 * out (the reader says the log was cut).
 */
export function transcriptTurns(text: string): TranscriptTurn[] | null {
  const lines = text.split("\n").filter((line) => line.trim());
  if (!lines.length || !lines[0]!.trim().startsWith("{")) return null;
  const turns: TranscriptTurn[] = [];
  let parsed = 0;
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    parsed += 1;
    const turn = turnOf(value);
    if (!turn) continue;
    const last = turns[turns.length - 1];
    // Tool calls in a row fold into one line.
    if (turn.who === "tool" && last?.who === "tool")
      last.text = `${last.text}, ${turn.text}`;
    else turns.push(turn);
  }
  return parsed >= Math.max(1, lines.length - 1) ? turns : null;
}

/** Plain words for a read that did not produce content. */
export function readProblem(reason: string, hostLabel: string): string {
  switch (reason) {
    case "missing_element":
      return "This was removed from Board.";
    case "not_a_file":
      return "That path is a folder, not a file. Edit it to choose a file.";
    case "not_text":
      return "That file is not text, so Board cannot show it.";
    case "source_unavailable":
      return "The file is not there. Check the path, or create it in the project.";
    case "busy":
      return "World is reading several sources already. Try again in a moment.";
    case "generation_required":
    case "changed_or_unavailable":
      return `${hostLabel} reconnected or went offline while reading. Try again.`;
    default:
      return "Board could not read this.";
  }
}
