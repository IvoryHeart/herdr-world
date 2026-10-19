/**
 * Which agent a Board string is for. A pane can outlive its agent: one agent
 * exits and another starts in the same shell, keeping the pane and terminal.
 * The service records the recipient when a string is made, and Send compares
 * it with the pane's agent before and after prompting, so a note is never
 * carried silently to a replacement.
 *
 * A recipient is the agent's kind, the agent session Herdr reports (hashed)
 * and its foreground process group. Two recipients are the same agent when
 * their kinds match and their sessions match, or, when either has no
 * session (an agent may report one only after it starts), their process
 * groups match.
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

/** Whether two recipient tokens name the same agent. */
export function sameRecipient(a: unknown, b: unknown): boolean {
  const x = decodeRecipient(a),
    y = decodeRecipient(b);
  if (!x || !y || x.agent !== y.agent) return false;
  if (x.session && y.session) return x.session === y.session;
  return x.group !== undefined && x.group === y.group;
}

function sessionOf(value: unknown): string | undefined {
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
 * The service's records of which agent each pane end strung (or
 * re-witnessed) by these operations is for. `read` asks the anchor's host on
 * its current runtime, or answers null when that host is not ready.
 */
export async function recipientOps(
  doc: BoardDocument,
  ops: readonly BoardOp[],
  read: (
    connectionId: string,
    paneId: string,
  ) => Promise<PaneRecipient | NoRecipient | null>,
): Promise<BoardOp[]> {
  const wanted: { string_id: string; end: "from" | "to" }[] = [];
  for (const op of ops) {
    if (op.op === "string.put")
      for (const end of ["from", "to"] as const) {
        const side = op.string[end];
        if ("anchor" in side && side.anchor.kind === "pane")
          wanted.push({ string_id: op.string.id, end });
      }
    if (op.op === "anchor.witness")
      wanted.push({ string_id: op.string_id, end: op.end });
  }
  const recorded: BoardOp[] = [];
  for (const { string_id, end } of wanted) {
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
    // The op itself checks the end still names this pane and terminal.
    recorded.push({
      op: "anchor.recipient",
      string_id,
      end,
      pane_id: anchor.native_id,
      terminal_id: found.terminal_id,
      recipient: found.token,
    });
  }
  return recorded;
}
