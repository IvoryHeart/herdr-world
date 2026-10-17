/**
 * Live screen reads and replies for the Town peek and chat dock. Every call is
 * qualified by the leaf's own connection and runtime generation; a pane whose
 * owner changed is never read or written through another connection.
 */

import { useEffect, useState } from "react";
import { bridge, type ConnectionClient } from "../../api";
import { terminalComposerRequest } from "../../terminalComposer";
import { deskClient } from "../handoffs";
import { questionFromScreen } from "../paneScreen";
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

/** The visible screen of one pane, refreshed while `active`. */
export function useTownScreen(
  leaf: WorldLeafObject | null,
  active: boolean,
  intervalMs = 2_000,
): string | null {
  const [screen, setScreen] = useState<{ id: string; text: string } | null>(
    null,
  );
  const identity = leaf
    ? `${leaf.connectionId}\u0000${leaf.generation}\u0000${leaf.pane.pane_id}`
    : null;
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
                source: "visible",
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

const NUMBERED = /^\s*(?:[›❯>]\s*)?(\d)[.)]\s+(.{1,60}?)\s*$/;
const YES_NO = /\((y)\/(n)\)|\[(y)\/(n)\]/i;

/** Numbered menu entries, or y/n, from the bottom of a question. */
export function townChoices(lines: readonly string[]): TownChoice[] {
  const choices: TownChoice[] = [];
  for (const line of lines) {
    const match = NUMBERED.exec(line);
    if (match && !choices.some((choice) => choice.key === match[1]))
      choices.push({ key: match[1]!, label: match[2]! });
  }
  if (choices.length >= 2) return choices.slice(0, 6);
  const last = lines.slice(-3).join(" ");
  return YES_NO.test(last)
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
