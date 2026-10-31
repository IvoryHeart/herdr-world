/**
 * The ports through which Town's scene model reads time and defers work.
 * Nothing under `town/scene/` touches the browser's clocks or timers directly
 * (a lint rule enforces it), so the scene runs headless on a test clock.
 */
export type TownClock = {
  /** Monotonic milliseconds, as `performance.now()`. */
  now(): number;
  /** Run `run` after `ms`; the returned function cancels it. */
  after(ms: number, run: () => void): () => void;
  /** Epoch milliseconds, only for ages shown to the user. */
  wall(): number;
};
