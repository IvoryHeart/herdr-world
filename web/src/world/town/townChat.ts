/**
 * Live screen reads and replies for the Town peek and chat dock. Every call is
 * qualified by the leaf's own connection and runtime generation; a pane whose
 * owner changed is never read or written through another connection.
 */

import { useEffect, useState } from "react";
import { bridge, type ConnectionClient } from "../../api";
import {
  mergeAgentHistory,
  type AgentHistory,
  type AgentHistoryResponse,
  type HistoryEntry,
} from "../../components/agentHistory";
import { terminalComposerRequest } from "../../terminalComposer";
import { deskClient } from "../handoffs";
import { questionFromScreen, screenIdentity } from "../paneScreen";
import type { WorldLeafObject, WorldObject } from "../worldObject";

export type TownChoice = { key: string; label: string };

/** The pane's own current connection, or null if its owner changed. */
export const townOwner = (leaf: WorldLeafObject): ConnectionClient | null =>
  deskClient(
    (candidate: WorldLeafObject) =>
      bridge.connection(candidate.connectionId, candidate.generation),
    leaf,
  );

export function townLeaf(
  world: WorldObject,
  nodeId: string | null | undefined,
): WorldLeafObject | null {
  const node = nodeId ? world.nodeById.get(nodeId) : undefined;
  return node && (node.kind === "agent" || node.kind === "terminal")
    ? (node as WorldLeafObject)
    : null;
}

function textOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  for (const value of Object.values(record))
    if (value && typeof value === "object") {
      const nested = textOf(value);
      if (nested !== null) return nested;
    }
  return null;
}

/**
 * The screen a peek shows: one pane in one runtime generation running one
 * agent session. A new session on the same pane never inherits the old
 * session's screen, messages or answer buttons.
 */
export const townPaneIdentity = (leaf: WorldLeafObject) => screenIdentity(leaf);

/** Lines of recent output the peek reads, as the agent's latest chatter. */
const PEEK_LINES = 150;

/** One pane's recent output, refreshed while `active`. */
export function useTownScreen(
  leaf: WorldLeafObject | null,
  active: boolean,
  intervalMs = 2_000,
): string | null {
  const [screen, setScreen] = useState<{ id: string; text: string } | null>(
    null,
  );
  const identity = leaf ? townPaneIdentity(leaf) : null;
  useEffect(() => {
    if (!leaf || !active || !identity) return;
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      const client = townOwner(leaf);
      if (client && document.visibilityState !== "hidden")
        try {
          const text = textOf(
            await client.call(
              "pane.read",
              {
                pane_id: leaf.pane.pane_id,
                source: "recent",
                lines: PEEK_LINES,
                format: "text",
                strip_ansi: true,
              },
              8_000,
            ),
          );
          if (!cancelled && client.isCurrent() && text !== null)
            setScreen((current) =>
              current?.id === identity && current.text === text
                ? current
                : { id: identity, text },
            );
        } catch {
          // An unreadable pane keeps its last screen until it can be read.
        }
      if (!cancelled) timer = window.setTimeout(read, intervalMs);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // identity captures the leaf's owner and pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, active, intervalMs]);
  return screen?.id === identity ? screen.text : null;
}

/** Messages the peek shows from the agent's session history. */
const HISTORY_MESSAGES = 24;

/**
 * The agent's recent conversation from its session history, as the
 * Inspector's History shows it, refreshed while `active`. A small pane holds
 * little on screen, so this is the peek's chatter whenever the agent has a
 * readable session; null until it does.
 */
export function useTownHistory(
  leaf: WorldLeafObject | null,
  active: boolean,
  intervalMs = 4_000,
): HistoryEntry[] | null {
  const [history, setHistory] = useState<{
    id: string;
    value: AgentHistory;
  } | null>(null);
  const agent = leaf?.pane.agent;
  const identity =
    leaf && agent ? `${townPaneIdentity(leaf)}\u0000${agent}` : null;
  useEffect(() => {
    if (!leaf || !agent || !active || !identity) return;
    let cancelled = false;
    let timer: number | undefined;
    let current: AgentHistory | null = null;
    const read = async () => {
      const client = townOwner(leaf);
      if (client && document.visibilityState !== "hidden")
        try {
          const requested = current?.cursor ?? null;
          const response = (await client.call(
            "agent_history.get",
            {
              history_version: 2,
              cursor: requested,
              pane_id: leaf.pane.pane_id,
              workspace_id: leaf.pane.workspace_id,
              tab_id: leaf.pane.tab_id,
              agent,
            },
            8_000,
          )) as AgentHistoryResponse;
          const merged = mergeAgentHistory(current, response, requested);
          if (
            !cancelled &&
            client.isCurrent() &&
            merged &&
            merged !== current
          ) {
            current = merged;
            setHistory({ id: identity, value: merged });
          }
        } catch {
          // Without a readable session the peek shows the screen instead.
        }
      if (!cancelled) timer = window.setTimeout(read, intervalMs);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // identity captures the leaf's owner, pane and agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, active, intervalMs]);
  if (history?.id !== identity) return null;
  const messages = history.value.messages.filter(
    (entry) => entry.kind !== "tool_result" || entry.is_error,
  );
  return messages.length ? messages.slice(-HISTORY_MESSAGES) : null;
}

/**
 * The agent's recent messages, as Desk's cards show them: the last lines of
 * its screen without terminal chrome. The peek scrolls back through them.
 */
export function townScreenLines(
  screen: string | null,
  maxLines = 40,
): string[] {
  return screen ? questionFromScreen(screen, maxLines) : [];
}

export type TownLineKind = "text" | "tool" | "ok" | "busy";

/** How the peek colours one line, as the agent's TUI marks it. */
export function townLineKind(line: string): TownLineKind {
  const head = line.trimStart();
  if (/^[✓✔]|^(done|tests? pass)/i.test(head)) return "ok";
  if (/^[✻✳✶✢✽·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏*]\s*\S.*(…|\.\.\.)/.test(head)) return "busy";
  if (
    /^[⏺●•⎿└]|^(Read|Edit|Write|Bash|Update|Search|Ran|Explored|Edited)\b/.test(
      head,
    )
  )
    return "tool";
  return "text";
}

/**
 * Split a waiting agent's lines into its earlier chatter and the question at
 * the bottom. With answer buttons shown, the menu lines are left out of the
 * question so the card stays small.
 */
export function townQuestion(
  lines: readonly string[],
  hideChoices: boolean,
): { chatter: string[]; question: string[] } {
  const first = lines.findIndex(
    (line, index) => index >= lines.length - 12 && NUMBERED.test(line),
  );
  const end = first < 0 ? lines.length : first;
  // The question ends at the last line ending "?" above the menu, and starts
  // where its sentence starts (a wrapped line begins in lower case).
  let start = -1;
  for (let index = end - 1; index >= Math.max(0, end - 4); index -= 1)
    if (/\?\s*$/.test(lines[index]!)) {
      start = index;
      break;
    }
  if (start < 0) return { chatter: [...lines], question: [] };
  while (start > 0 && start > end - 6 && !/^\s*[A-Z]/.test(lines[start]!))
    start -= 1;
  const question = hideChoices ? lines.slice(start, end) : lines.slice(start);
  return { chatter: lines.slice(0, start), question };
}

const NUMBERED = /^\s*(?:[›❯>]\s*)?(\d)[.)]\s+(.{1,60}?)\s*$/;
const YES_NO = /\((y)\/(n)\)|\[(y)\/(n)\]/i;

/**
 * Key hints an agent draws under its menu, such as "Esc to cancel" or
 * "↑/↓ to navigate · Enter to select": a line that starts with a key and
 * tells what it does, never a question or a request for text.
 */
const MENU_KEY = String.raw`(?:esc|enter|return|tab|space|ctrl\+\w|shift\+\w|↑|↓|←|→)`;
const MENU_HINT = new RegExp(
  String.raw`^\s*${MENU_KEY}(?:\s*/\s*${MENU_KEY})*\s+to\s+(?:navigate|select|confirm|cancel|choose|go back|exit|move)\b[^?:]*$`,
  "i",
);

/**
 * Numbered menu entries, or y/n, from the active prompt at the bottom of a
 * question. A menu followed by other output or a later question is no longer
 * active and yields no answers.
 */
export function townChoices(lines: readonly string[]): TownChoice[] {
  let last = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1)
    if (NUMBERED.test(lines[index]!)) {
      last = index;
      break;
    }
  if (last >= 0) {
    // Fail closed: after the last option only blank lines and key hints may
    // follow. Any other text, even indented, may be a newer prompt, so the
    // old answers are withdrawn (a wrapped last option loses its buttons).
    const active = lines
      .slice(last + 1)
      .every((line) => !line.trim() || MENU_HINT.test(line));
    if (!active) return [];
    // The menu block: numbered entries and their indented continuations.
    const choices: TownChoice[] = [];
    for (let index = last; index >= 0; index -= 1) {
      const line = lines[index]!;
      const match = NUMBERED.exec(line);
      if (match) {
        if (!choices.some((choice) => choice.key === match[1]))
          choices.unshift({ key: match[1]!, label: match[2]! });
      } else if (!/^\s/.test(line) || !line.trim()) break;
    }
    return choices.length >= 2 ? choices.slice(0, 6) : [];
  }
  const tail = lines.slice(-3).join(" ");
  return YES_NO.test(tail)
    ? [
        { key: "y", label: "Yes" },
        { key: "n", label: "No" },
      ]
    : [];
}

export class TownReplyError extends Error {}

/**
 * Send text to a pane. `submit` presses Enter after it; a menu choice is a
 * single key and is sent without Enter, as an agent's menu expects.
 */
export async function sendTownReply(
  leaf: WorldLeafObject,
  text: string,
  submit: boolean,
) {
  const client = townOwner(leaf);
  if (!client)
    throw new TownReplyError(
      "This agent's host changed; refresh before replying.",
    );
  const request = terminalComposerRequest(leaf.pane.pane_id, text, submit);
  await client.call(request.method, request.params);
}
