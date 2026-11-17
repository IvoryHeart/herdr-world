import type { Pane } from "../types";

/**
 * Seen and favourite shared with Herdr's apps for herdr-core agents (desktop
 * app `docs/labels.md`). The World service writes the labels; this module
 * decides when a person is looking.
 *
 * Looking means a World page in front of someone (visible and focused) with
 * the agent drawn in a peek for a moment. While that lasts, each turn is
 * shared once: an agent that stays on screen does not undo a "mark unread"
 * from another client, and looking again later raises it again. Writes are
 * best effort and never wait in front of the interface.
 */

/** One core agent as a World view shows it. */
export type CoreShared = {
  connectionId: string;
  generation: number;
  terminal: string;
  /** Core's turn counter for the agent. */
  turn: number;
  /** The shared `herdr.seen`, or null when no client has written one. */
  seen: number | null;
  favourite: boolean;
  /**
   * The host is not current (offline, reconnecting): the look goes on but
   * nothing is written, so a flicker is not a new look.
   */
  stale?: boolean;
};

/** What World shares for a pane: only herdr-core agents with turns. */
export function coreSharedOf(
  connectionId: string,
  generation: number,
  pane: Pane,
): CoreShared | null {
  if (pane.runtime !== "herdr-core") return null;
  const turn = pane.turn;
  return {
    connectionId,
    generation,
    terminal: pane.pane_id,
    turn: typeof turn === "number" && Number.isSafeInteger(turn) ? turn : -1,
    seen:
      typeof pane.seen_turn === "number" && Number.isSafeInteger(pane.seen_turn)
        ? pane.seen_turn
        : null,
    favourite: pane.favourite === true,
  };
}

const keyOf = (target: CoreShared) =>
  JSON.stringify([target.connectionId, target.terminal]);

/**
 * The once-per-turn rule, independent of React and of the network. Each
 * `update` gets everything drawn now and whether the page is in front of
 * someone; it returns the writes it started. A write carries the label it
 * was decided on, and the service writes only while the label still holds
 * it. A write that fails is not retried: a later "mark unread" from another
 * client must not be overruled by an old look, and the next turn or the next
 * look shares it again. While the host is not current (stale) nothing is
 * decided, so a look that spans a reconnect shares its turn once it is back.
 */
export class CoreSeenSharer {
  /** Agents being looked at, and the turn each look decided on. */
  private readonly looked = new Map<string, number>();

  constructor(
    private readonly send: (target: CoreShared) => Promise<unknown>,
  ) {}

  update(looking: readonly CoreShared[], foreground: boolean): CoreShared[] {
    const now = new Map<string, CoreShared>();
    if (foreground)
      for (const target of looking)
        if (target.turn >= 0) now.set(keyOf(target), target);
    for (const key of [...this.looked.keys()])
      if (!now.has(key)) this.looked.delete(key);
    const writes: CoreShared[] = [];
    for (const [key, target] of now) {
      if (target.stale || this.looked.get(key) === target.turn) continue;
      this.looked.set(key, target.turn);
      if (target.seen !== null && target.seen >= target.turn) continue;
      writes.push(target);
    }
    // Best effort: a refusal or failure changes nothing here.
    for (const target of writes) this.send(target).catch(() => {});
    return writes;
  }
}
