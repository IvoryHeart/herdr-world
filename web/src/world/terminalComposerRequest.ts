/**
 * World views (Town) can ask the next terminal that shows a pane to open its
 * composer, so messages and uploads use the same composer window everywhere.
 * A request waits until that pane's terminal mounts, and expires after a while.
 */

export const TERMINAL_COMPOSER_REQUEST_EVENT =
  "herdr-world:terminal-composer-request";

const REQUEST_TTL_MS = 15_000;
const pending = new Map<string, number>();

export function requestTerminalComposer(paneId: string) {
  pending.set(paneId, Date.now());
  window.dispatchEvent(
    new CustomEvent(TERMINAL_COMPOSER_REQUEST_EVENT, { detail: paneId }),
  );
}

/** Consume a pending request for this pane, if one is still fresh. */
export function takeTerminalComposerRequest(paneId: string) {
  const at = pending.get(paneId);
  if (at === undefined) return false;
  pending.delete(paneId);
  return Date.now() - at <= REQUEST_TTL_MS;
}
