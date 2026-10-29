/**
 * Which agent a Board string is for. A pane can outlive its agent: one agent
 * exits and another starts in the same shell, keeping the pane and terminal.
 * The service records the recipient when a string is made, and Send compares
 * it with the pane's agent before and after prompting, so a note is never
 * carried silently to a replacement.
 *
 * A recipient is the agent's kind, the agent session Herdr reports (hashed)
 * and its foreground process group. An observed recipient must retain the
 * kind and session already witnessed. A group-only witness may learn a
 * session (an agent may report one only after it starts), but a witnessed
 * session must never fall back to a process group if the session disappears.
 */

import { createHash } from "node:crypto";
import type { BoardDocument, BoardOp } from "./board-store";

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type Recipient = { agent: string; session?: string; group?: number };

export type PaneRecipient = {
  /** The recipient, encoded for the saved board and the browser. */
  token: string;
  /** What to call the agent when asking the user. */
  label: string;
  terminal_id: string;
};

/** No agent, or one whose identity cannot be verified. */
export type NoRecipient = { none: "no_agent" | "unverified" };

export const RECIPIENT_MAX = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function encodeRecipient(recipient: Recipient): string {
  return JSON.stringify([
    recipient.agent,
    recipient.session ?? null,
    recipient.group ?? null,
  ]);
}

export function decodeRecipient(token: unknown): Recipient | null {
  if (typeof token !== "string" || token.length > RECIPIENT_MAX) return null;
  try {
    const [agent, session, group] = JSON.parse(token) as unknown[];
    if (typeof agent !== "string" || !agent) return null;
    if (session !== null && typeof session !== "string") return null;
    if (group !== null && !Number.isSafeInteger(group)) return null;
    if (session === null && group === null) return null;
    return {
      agent,
      ...(session ? { session } : {}),
      ...(group !== null ? { group: group as number } : {}),
    };
  } catch {
    return null;
  }
}

/** Whether the observed agent continues the expected recipient's identity. */
export function matchesRecipient(
  expected: unknown,
  observed: unknown,
): boolean {
  const x = decodeRecipient(expected),
    y = decodeRecipient(observed);
  if (!x || !y || x.agent !== y.agent) return false;
  if (x.session) return x.session === y.session;
  return x.group !== undefined && x.group === y.group;
}

/** What the browser showed in a pane when the user strung a note to it. */
export type ObservedAgent = {
  agent: string;
  session?: { source?: unknown; kind?: unknown; value?: unknown };
};

/** A Herdr agent session, hashed as recipients store it. */
export function sessionOf(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.value !== "string") return undefined;
  const id = value.value.trim();
  if (!id) return undefined;
  return createHash("sha256")
    .update(JSON.stringify([value.source ?? null, value.kind ?? null, id]))
    .digest("hex")
    .slice(0, 32);
}

export async function readPaneRecipient(
  call: HerdrCall,
  paneId: string,
): Promise<PaneRecipient | NoRecipient> {
  const paneResult = await call("pane.get", { pane_id: paneId });
  const pane = isRecord(paneResult) ? paneResult.pane : undefined;
  if (!isRecord(pane) || pane.pane_id !== paneId) return { none: "unverified" };
  if (!pane.agent) return { none: "no_agent" };
  const agentResult = await call("agent.get", { target: paneId });
  const agent = isRecord(agentResult) ? agentResult.agent : undefined;
  if (
    !isRecord(agent) ||
    agent.pane_id !== paneId ||
    typeof pane.terminal_id !== "string" ||
    !pane.terminal_id ||
    agent.terminal_id !== pane.terminal_id
  )
    return { none: "unverified" };
  const processResult = await call("pane.process_info", { pane_id: paneId });
  const process = isRecord(processResult)
    ? processResult.process_info
    : undefined;
  const group =
    isRecord(process) &&
    process.pane_id === paneId &&
    Number.isSafeInteger(process.foreground_process_group_id) &&
    Number(process.foreground_process_group_id) > 0
      ? Number(process.foreground_process_group_id)
      : undefined;
  const session = sessionOf(agent.agent_session);
  if (!session && group === undefined) return { none: "unverified" };
  const kind = String(agent.agent ?? pane.agent);
  return {
    token: encodeRecipient({ agent: kind, session, group }),
    label: String(agent.name || kind),
    terminal_id: pane.terminal_id,
  };
}

/**
 * The service's records of which agent each newly strung pane end is for.
 * A recipient is recorded only when the agent `read` finds in the pane (on
 * its host's current runtime) is the one the browser showed when the user
 * made the string: the same kind and the same Herdr session. Anything else
 * (no session to compare, a replacement in the meantime, no answer) leaves
 * the string unbound, and Send asks the user which agent to send to.
 */
export async function recipientOps(
  doc: BoardDocument,
  ops: readonly BoardOp[],
  observed: ReadonlyMap<string, ObservedAgent>,
  read: (
    connectionId: string,
    paneId: string,
  ) => Promise<PaneRecipient | NoRecipient | null>,
): Promise<BoardOp[]> {
  const wanted: { string_id: string; end: "from" | "to" }[] = [];
  for (const op of ops)
    if (op.op === "string.put")
      for (const end of ["from", "to"] as const) {
        const side = op.string[end];
        if ("anchor" in side && side.anchor.kind === "pane")
          wanted.push({ string_id: op.string.id, end });
      }
  const recorded: BoardOp[] = [];
  for (const { string_id, end } of wanted) {
    const seen = observed.get(`${string_id}:${end}`);
    const seenSession = seen && sessionOf(seen.session);
    if (!seen || !seenSession) continue;
    const side = doc.strings.find((entry) => entry.id === string_id)?.[end];
    if (!side || !("anchor" in side) || side.anchor.kind !== "pane") continue;
    const { anchor } = side;
    let found: PaneRecipient | NoRecipient | null;
    try {
      found = await read(anchor.connection_id, anchor.native_id);
    } catch {
      found = null; // Host not ready or the pane is gone: Send will ask.
    }
    if (
      !found ||
      "none" in found ||
      !anchor.witness.includes(found.terminal_id)
    )
      continue;
    const now = decodeRecipient(found.token);
    if (!now || now.agent !== seen.agent || now.session !== seenSession)
      continue;
    // The op itself checks the end still names this host, pane and terminal.
    recorded.push({
      op: "anchor.recipient",
      string_id,
      end,
      connection_id: anchor.connection_id,
      pane_id: anchor.native_id,
      terminal_id: found.terminal_id,
      recipient: found.token,
    });
  }
  return recorded;
}
