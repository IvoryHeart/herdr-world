import { bridge } from "../api";
import type { WorldLeafObject } from "./worldObject";

/**
 * Messages, answers and answer keys to agents on herdr-core, through core's
 * own send and keys (world.core.send/keys). Each names the core connection
 * and generation the person saw and the recipient token of the program
 * they addressed: the service sends nothing unless that program still runs
 * there, and a reply that never comes is "uncertain", never retried.
 */
export type CoreDeliveryOutcome =
  | { status: "sent"; turn: number; started: boolean | null }
  | { status: "refused"; reason: string; message: string }
  | { status: "uncertain"; message: string };

/** Where a core agent's input goes, or null for anything else. */
export function coreRecipient(leaf: WorldLeafObject | null | undefined) {
  if (
    !leaf ||
    leaf.stale ||
    leaf.kind !== "agent" ||
    leaf.pane.runtime !== "herdr-core" ||
    typeof leaf.pane.core_recipient !== "string"
  )
    return null;
  return {
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    terminal: leaf.pane.pane_id,
    recipient: leaf.pane.core_recipient,
  };
}

/** Core sends wait for a person's draft (60 s) and quiet: longer than RPCs. */
const SEND_TIMEOUT_MS = 100_000;

function outcomeOf(value: unknown): CoreDeliveryOutcome {
  const result = (value ?? {}) as Record<string, unknown>;
  if (result.status === "sent")
    return {
      status: "sent",
      turn: typeof result.turn === "number" ? result.turn : 0,
      started: typeof result.started === "boolean" ? result.started : null,
    };
  if (result.status === "refused")
    return {
      status: "refused",
      reason: String(result.reason ?? ""),
      message: String(result.message ?? "Nothing was sent."),
    };
  return {
    status: "uncertain",
    message: String(
      result.message ?? "World did not hear back: it may have gone in.",
    ),
  };
}

async function call(
  method: "world.core.send" | "world.core.keys",
  params: Record<string, unknown>,
): Promise<CoreDeliveryOutcome> {
  try {
    return outcomeOf(await bridge.call(method, params, SEND_TIMEOUT_MS));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The service refused before sending (wrong generation, no core).
    if (/reconnected|not available|not a herdr-core/i.test(message))
      return { status: "refused", reason: "unavailable", message };
    return {
      status: "uncertain",
      message: `World did not hear back, so it may have gone in. It will not be sent again. (${message})`,
    };
  }
}

/**
 * Sends `text` to a core agent: a new message, or with `answer` a typed
 * answer to the question it is waiting on.
 */
export function sendToCoreAgent(
  leaf: WorldLeafObject,
  text: string,
  answer: boolean,
): Promise<CoreDeliveryOutcome> {
  const to = coreRecipient(leaf);
  if (!to)
    return Promise.resolve({
      status: "refused",
      reason: "unavailable",
      message: "World can't reach this agent now.",
    });
  return call("world.core.send", {
    ...to,
    text,
    ...(answer ? { answer } : {}),
  });
}

/** Presses an answer key (a menu option, y/n, enter) for a waiting agent. */
export function pressForCoreAgent(
  leaf: WorldLeafObject,
  key: string,
): Promise<CoreDeliveryOutcome> {
  const to = coreRecipient(leaf);
  if (!to)
    return Promise.resolve({
      status: "refused",
      reason: "unavailable",
      message: "World can't reach this agent now.",
    });
  return call("world.core.keys", { ...to, keys: [key] });
}

/** A core agent's screen (no history, no injected input), or null. */
export async function readCoreAgentScreen(
  leaf: WorldLeafObject,
): Promise<string | null> {
  const to = coreRecipient(leaf);
  if (!to) return null;
  const result = (await bridge.call(
    "world.core.screen",
    {
      connection_id: to.connection_id,
      connection_generation: to.connection_generation,
      terminal: to.terminal,
      recipient: to.recipient,
    },
    8_000,
  )) as { text?: unknown } | null;
  return typeof result?.text === "string" ? result.text : null;
}

/** One line for the person: what happened to their input. */
export function coreDeliveryText(
  outcome: CoreDeliveryOutcome,
  name: string,
): string {
  if (outcome.status === "sent")
    return outcome.started === false
      ? `Sent to ${name}; it has not started working on it yet.`
      : `Sent to ${name}.`;
  if (outcome.status === "refused")
    return `Not sent to ${name}: ${outcome.message}`;
  return `Uncertain for ${name}: ${outcome.message}`;
}
