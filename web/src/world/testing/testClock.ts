/**
 * A test clock for browser fixtures. Installed before anything else loads,
 * it replaces the page's timers, animation frames and performance.now, so
 * time moves only when the fixture advances it: in fixed 16 ms frames, each
 * followed by a real task turn so that React, promises and the fixture's own
 * fakes run in between. Results then no longer depend on how fast the runner
 * is, and waits cost only the work they cause.
 *
 * Import it first (`import "./testing/installTestClock"`): React's scheduler
 * captures setTimeout when its module loads.
 */

type Timer = {
  id: number;
  at: number;
  run: () => void;
  every: number | null;
};

export type TestClock = {
  now(): number;
  /** Move time forward, frame by frame. */
  advance(ms: number): Promise<void>;
  /** Advance until `done()` holds, or fail after `limit` ms of test time. */
  until(done: () => boolean, message: string, limit?: number): Promise<void>;
  /** The page's real timers, for the fixture's own reporting. */
  real: { setTimeout: typeof setTimeout; now: () => number };
};

export const FRAME_MS = 16;

export function installTestClock(): TestClock {
  const real = {
    setTimeout: window.setTimeout.bind(window),
    now: performance.now.bind(performance),
    MessageChannel: window.MessageChannel,
  };
  let now = real.now();
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();

  const schedule = (
    handler: TimerHandler,
    delay: number | undefined,
    args: unknown[],
    every: boolean,
  ) => {
    const id = nextId++;
    const wait = Math.max(0, Number(delay) || 0);
    const run =
      typeof handler === "function"
        ? () => (handler as (...a: unknown[]) => void)(...args)
        : () => {
            throw new Error("string timers are not supported");
          };
    timers.set(id, { id, at: now + wait, run, every: every ? wait : null });
    return id;
  };
  const cancel = (id: number | undefined) => {
    if (id !== undefined) timers.delete(id);
  };

  Object.assign(window, {
    setTimeout: (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      schedule(handler, delay, args, false),
    setInterval: (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      schedule(handler, delay, args, true),
    clearTimeout: cancel,
    clearInterval: cancel,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  performance.now = () => now;

  /** A real task turn: React's scheduler and pending promises run. */
  const turn = () =>
    new Promise<void>((resolve) => {
      const channel = new real.MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });

  /** Run every timer due by `now`, earliest first, including new ones. */
  const runTimers = () => {
    for (let guard = 0; guard < 10_000; guard++) {
      let due: Timer | null = null;
      for (const timer of timers.values())
        if (timer.at <= now && (!due || timer.at < due.at)) due = timer;
      if (!due) return;
      if (due.every === null) timers.delete(due.id);
      else due.at = now + Math.max(1, due.every);
      due.run();
    }
    throw new Error("timers kept scheduling themselves at the same instant");
  };

  const step = async () => {
    now += FRAME_MS;
    runTimers();
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(now);
    // Twice: a commit can schedule an effect that schedules more work.
    await turn();
    await turn();
    runTimers();
  };

  return {
    now: () => now,
    async advance(ms) {
      const end = now + ms;
      // Zero-delay timers first, as a real task turn would run them.
      runTimers();
      await turn();
      while (now < end) await step();
    },
    async until(done, message, limit = 10_000) {
      const end = now + limit;
      runTimers();
      await turn();
      while (!done()) {
        if (now >= end) throw new Error(message);
        await step();
      }
    },
    real: { setTimeout: real.setTimeout, now: real.now },
  };
}
