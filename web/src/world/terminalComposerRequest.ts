import {
  readTerminalComposerDraft,
  writeTerminalComposerDraft,
} from "../terminalComposer";

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
const pending = new Map<string, { at: number; text?: string }>();

/** The request key: the same owner-qualified identity as the composer draft. */
export const terminalComposerRequestKey = (target: TerminalComposerTarget) =>
  JSON.stringify([target.connectionId, target.generation, target.paneId]);

export function requestTerminalComposer(
  target: TerminalComposerTarget,
  text?: string,
) {
  const key = terminalComposerRequestKey(target);
  pending.set(key, { at: Date.now(), text });
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TERMINAL_COMPOSER_REQUEST_EVENT, { detail: key }),
  );
}

/** Consume a pending request for this exact terminal, if one is still fresh. */
export function takeTerminalComposerRequest(target: TerminalComposerTarget) {
  const key = terminalComposerRequestKey(target);
  const request = pending.get(key);
  if (request === undefined) return false;
  pending.delete(key);
  if (Date.now() - request.at > REQUEST_TTL_MS) return false;
  if (request.text) {
    const draft = readTerminalComposerDraft(key);
    writeTerminalComposerDraft(
      key,
      draft ? `${draft}\n${request.text}` : request.text,
    );
  }
  return true;
}

/** Both terminal runtimes consume the same qualified, draft-only request. */
export function subscribeTerminalComposerRequest(
  target: TerminalComposerTarget,
  open: () => void,
): () => void {
  const key = terminalComposerRequestKey(target);
  const take = () => {
    if (takeTerminalComposerRequest(target)) open();
  };
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === key) take();
  };
  window.addEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, listener);
  take();
  return () =>
    window.removeEventListener(TERMINAL_COMPOSER_REQUEST_EVENT, listener);
}
