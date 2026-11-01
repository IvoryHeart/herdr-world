import type { HistoryChatItem } from "../agentHistoryView";
import { unwrapPastedContent } from "../pastedContent";

/** Who a Chat row is from, as the wide transcript names it. */
export type ChatSender =
  | { kind: "agent" }
  | { kind: "user" }
  /** Typed into this pane as "name: …" by a live agent World knows. */
  | { kind: "relayed"; name: string };

export type ChatRow = { sender: ChatSender; continued: boolean };

// An agent name a relay can carry: what `herdr agent prompt` callers put
// before their report, such as "alpha: Phase 2 done".
const AGENT_NAME = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
const VALID_NAME = new RegExp(`^${AGENT_NAME}$`);
const RELAY_PREFIX = new RegExp(`^(${AGENT_NAME}):\\s`);

/**
 * The names a relay in `ownPaneId`'s Chat may carry: other live agents in
 * the same Herdr session whose name is valid and unique there. A name two
 * panes share, or that the pane itself has, names no one agent.
 */
export function relayNames(
  panes: readonly { pane_id: string; agent?: string; agent_name?: string }[],
  ownPaneId: string,
): string[] {
  const count = new Map<string, number>();
  for (const pane of panes)
    if (pane.agent && pane.agent_name)
      count.set(pane.agent_name, (count.get(pane.agent_name) ?? 0) + 1);
  return panes
    .flatMap((pane) =>
      pane.agent &&
      pane.agent_name &&
      pane.pane_id !== ownPaneId &&
      count.get(pane.agent_name) === 1 &&
      VALID_NAME.test(pane.agent_name)
        ? [pane.agent_name]
        : [],
    )
    .sort();
}

/**
 * The live agent a message typed into this pane names as its sender, or null.
 * Only a name in `agents` counts, so ordinary text such as "Note: …" stays
 * the owner's; the row is marked relayed and its text is unchanged.
 */
export function relayedSender(
  text: string,
  agents: ReadonlySet<string>,
): string | null {
  const name = RELAY_PREFIX.exec(text)?.[1];
  return name && agents.has(name) ? name : null;
}

const senderKey = (sender: ChatSender) =>
  sender.kind === "relayed" ? `relayed:${sender.name}` : sender.kind;

/** The local calendar day Chat shows a time on, or null when unreadable. */
function shownDay(at: string): string | null {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date.toDateString();
}

/**
 * Each message's sender and whether it continues the previous sender's run,
 * so the transcript names a sender and shows the time once per run. Tools
 * continue an agent run but never start one: the agent's first message
 * after another sender's (or at the top) names the agent. A notice divider,
 * a new day or an unreadable time starts a new run.
 */
export function chatRows(
  items: readonly HistoryChatItem[],
  agents: ReadonlySet<string>,
): Map<string, ChatRow> {
  const rows = new Map<string, ChatRow>();
  let previous: string | null = null;
  let previousDay: string | null = null;
  for (const item of items) {
    if (item.type !== "message") {
      if (previous !== "agent") previous = null;
      continue;
    }
    const { entry } = item;
    if (entry.notice) {
      previous = null;
      continue;
    }
    const relayed =
      entry.role === "user"
        ? relayedSender(unwrapPastedContent(entry.text).text, agents)
        : null;
    const sender: ChatSender = relayed
      ? { kind: "relayed", name: relayed }
      : entry.role === "user"
        ? { kind: "user" }
        : { kind: "agent" };
    const key = senderKey(sender);
    const day = shownDay(entry.sent_at);
    rows.set(entry.id, {
      sender,
      continued: key === previous && day !== null && day === previousDay,
    });
    previous = key;
    previousDay = day;
  }
  return rows;
}
