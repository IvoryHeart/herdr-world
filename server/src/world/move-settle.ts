/**
 * One move per agent until it settles. After a move lands, the agent's new
 * desk (connection + tab) and terminal refuse another runtime move for a
 * short window: the browser still shows the old address for a few seconds,
 * both copies may show, and Board's keys are being rewritten. A chained move
 * in that window would act on an address that no longer exists.
 */

export const MOVE_SETTLE_MS = 20_000;

export type MoveSettleKey = {
  connection_id: string;
  tab_id?: string;
  terminal_id?: string;
};

export type MoveSettle = {
  /** The agent at `at` just moved there. */
  mark(at: MoveSettleKey): void;
  /** Seconds left before `at` may move again, or 0. */
  wait(at: MoveSettleKey): number;
};

const keysOf = (at: MoveSettleKey) =>
  [
    at.tab_id ? `tab\u0000${at.connection_id}\u0000${at.tab_id}` : "",
    at.terminal_id
      ? `terminal\u0000${at.connection_id}\u0000${at.terminal_id}`
      : "",
  ].filter(Boolean);

export function createMoveSettle(
  now: () => number = Date.now,
  windowMs = MOVE_SETTLE_MS,
): MoveSettle {
  const until = new Map<string, number>();
  return {
    mark(at) {
      const time = now();
      for (const [key, end] of until) if (end <= time) until.delete(key);
      for (const key of keysOf(at)) until.set(key, time + windowMs);
    },
    wait(at) {
      const time = now();
      const end = Math.max(0, ...keysOf(at).map((key) => until.get(key) ?? 0));
      return end > time ? Math.ceil((end - time) / 1000) : 0;
    },
  };
}

/** The refusal a settling agent gets. */
export const settlingMessage = (name: string, seconds: number) =>
  `${name} just moved. Give it ${seconds} s to settle, then move it again.`;
