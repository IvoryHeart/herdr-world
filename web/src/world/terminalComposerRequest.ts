/**
 * World views (Town) can ask the next terminal that shows a pane to open its
 * composer, so messages and uploads use the same composer window everywhere.
 * A request names the pane's owner (connection and runtime generation) as
 * well as the pane, since two hosts can use the same pane ID. It waits until
 * that terminal mounts, and expires after a while.
 */

export const TERMINAL_COMPOSER_REQUEST_EVENT =
  "herdr-world:terminal-composer-request";

export type TerminalComposerTarget = {
  connectionId: string;
  generation: number;
  paneId: string;
};

const REQUEST_TTL_MS = 15_000;
const pending = new Map<string, number>();

/** The request key: the same owner-qualified identity as the composer draft. */
export const terminalComposerRequestKey = (target: TerminalComposerTarget) =>
  JSON.stringify([target.connectionId, target.generation, target.paneId]);

export function requestTerminalComposer(target: TerminalComposerTarget) {
  const key = terminalComposerRequestKey(target);
  pending.set(key, Date.now());
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TERMINAL_COMPOSER_REQUEST_EVENT, { detail: key }),
  );
}

/** Consume a pending request for this exact terminal, if one is still fresh. */
export function takeTerminalComposerRequest(target: TerminalComposerTarget) {
  const key = terminalComposerRequestKey(target);
  const at = pending.get(key);
  if (at === undefined) return false;
  pending.delete(key);
  return Date.now() - at <= REQUEST_TTL_MS;
}
