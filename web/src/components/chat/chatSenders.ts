import type { HistoryChatItem } from "../agentHistoryView";
import { unwrapPastedContent } from "../pastedContent";

/** Who a Chat row is from, as the wide transcript names it. */
export type ChatSender =
  | { kind: "agent" }
  | { kind: "user" }
  /** Typed into this pane as "name: …" by a live agent World knows. */
  | { kind: "relayed"; name: string };

export type ChatRow = { sender: ChatSender; continued: boolean };

// The name a relayed message starts with: what `herdr agent prompt` callers
// put before their report, such as "alpha: Phase 2 done".
const RELAY_PREFIX = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):\s/;

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

/**
 * Each message's sender and whether it continues the previous sender's run,
 * so the transcript names a sender and shows the time once per run. A tool
 * block is the agent's; a notice divider starts a new run.
 */
export function chatRows(
  items: readonly HistoryChatItem[],
  agents: ReadonlySet<string>,
): Map<string, ChatRow> {
  const rows = new Map<string, ChatRow>();
  let previous: string | null = null;
  for (const item of items) {
    if (item.type !== "message") {
      previous = "agent";
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
    rows.set(entry.id, { sender, continued: key === previous });
    previous = key;
  }
  return rows;
}
