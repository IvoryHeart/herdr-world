/**
 * A test clock for browser fixtures. Installed before anything else loads,
 * it replaces the page's timers, animation frames and performance.now, so
 * time moves only when the fixture advances it: in fixed 16 ms frames. As in
 * a browser, each timer callback is its own task and each frame callback is
 * followed by a microtask checkpoint: a real task turn runs after every
 * callback, so promise continuations, React and the fixture's own fakes run
 * before the next one. Results then no longer depend on how fast the runner
 * is, and waits cost only the work they cause.
 *
 * Import it first (`import "./testing/installTestClock"`): React's scheduler
 * captures setTimeout when its module loads.
 *
 * By default time moves only in the fixture's own advance/until calls. A
 * fixture that awaits the app itself (store refreshes, commands with
 * deadlines) uses the running clock instead (`{ running: true }`, as the
 * Hosts filter fixture does in installHostsFilterClock.ts):
 * frames then follow one another as fast as the page handles them, and
 * advance/until wait on that clock rather than drive it. Steps stay 16 ms of
 * test time with real task turns between them, so this is only as
 * deterministic as the page's own work: use it where the page does no real
 * I/O after loading.
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
  /** Two animation frames: of test time, or real ones on real time. */
  frame(): Promise<void>;
  /** Advance until `done()` holds, or fail after `limit` ms of test time. */
  until(done: () => boolean, message: string, limit?: number): Promise<void>;
  /** The page's real timers, for the fixture's own reporting. */
  real: { setTimeout: typeof setTimeout; now: () => number };
};

export const FRAME_MS = 16;

/** Where the clock installs: the page, or a plain object in unit tests. */
export type ClockTarget = Pick<
  typeof globalThis,
  | "setTimeout"
  | "clearTimeout"
  | "setInterval"
  | "clearInterval"
  | "requestAnimationFrame"
  | "cancelAnimationFrame"
> & { scheduler?: unknown };

export function installTestClock(
  target: ClockTarget = window,
  clockOf: { now(): number } = performance,
  { running = false }: { running?: boolean } = {},
): TestClock {
  const real = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    now: clockOf.now.bind(clockOf),
    MessageChannel: globalThis.MessageChannel,
  };
  let now = real.now();
  let nextId = 1;
  const timers = new Map<number, Timer>();
  /** The running clock rests while nothing is scheduled; work wakes it. */
  let resting: (() => void) | null = null;
  const wake = () => {
    const resume = resting;
    resting = null;
    resume?.();
  };
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
    wake();
    return id;
  };
  const cancel = (id: number | undefined) => {
    if (id !== undefined) timers.delete(id);
  };

  Object.assign(target, {
    setTimeout: (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      schedule(handler, delay, args, false),
    setInterval: (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      schedule(handler, delay, args, true),
    clearTimeout: cancel,
    clearInterval: cancel,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, callback);
      wake();
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  clockOf.now = () => now;
  // The Prioritized Task Scheduling API is time too: World's model
  // preparation yields through it. A posted task becomes a timer (with its
  // delay), so it neither waits on real time nor starves under the clock.
  const tasks = (target as { scheduler?: Record<string, unknown> }).scheduler;
  if (tasks && typeof tasks.postTask === "function")
    Object.assign(tasks, {
      postTask: <T>(
        callback: () => T,
        options: { delay?: number; signal?: AbortSignal } = {},
      ) =>
        new Promise<T>((resolve, reject) => {
          if (options.signal?.aborted)
            return reject(options.signal.reason ?? new Error("aborted"));
          const id = schedule(
            () => {
              try {
                resolve(callback());
              } catch (error) {
                reject(error);
              }
            },
            options.delay,
            [],
            false,
          );
          options.signal?.addEventListener("abort", () => {
            cancel(id);
            reject(options.signal?.reason ?? new Error("aborted"));
          });
        }),
      yield: () =>
        new Promise<void>((resolve) => schedule(resolve, 0, [], false)),
    });

  /**
   * As in a browser, a callback that throws is reported (an uncaught error
   * event on the page) and later timers and frames still run.
   */
  const call = (run: () => void) => {
    try {
      run();
    } catch (error) {
      if (typeof globalThis.reportError === "function")
        globalThis.reportError(error);
      else
        real.setTimeout(() => {
          throw error;
        }, 0);
    }
  };

  /** A real task turn: React's scheduler and pending promises run. */
  const turn = () =>
    new Promise<void>((resolve) => {
      const channel = new real.MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });

  /**
   * Run every timer due by `now`, earliest first, including ones they add.
   * Each is a task of its own: its promise continuations run before the next.
   */
  const runTimers = async () => {
    for (let guard = 0; guard < 10_000; guard++) {
      let due: Timer | null = null;
      for (const timer of timers.values())
        if (
          timer.at <= now &&
          (!due ||
            timer.at < due.at ||
            (timer.at === due.at && timer.id < due.id))
        )
          due = timer;
      if (!due) return;
      if (due.every === null) timers.delete(due.id);
      else due.at = now + Math.max(1, due.every);
      call(due.run);
      await turn();
    }
    throw new Error("timers kept scheduling themselves at the same instant");
  };

  /** One step at a time, whoever asks: the driver, or an advance at rest. */
  let stepping: Promise<void> | null = null;
  const step = () =>
    (stepping ??= frameStep().finally(() => {
      stepping = null;
    }));
  const frameStep = async () => {
    now += FRAME_MS;
    await runTimers();
    const callbacks = [...frames.values()];
    frames.clear();
    // A microtask checkpoint after each frame callback, as in a browser.
    for (const callback of callbacks) {
      call(() => callback(now));
      await turn();
    }
    // A commit can schedule an effect that schedules more work.
    await turn();
    await runTimers();
  };

  // The running clock's one driver, for the page's life: frame after frame
  // while anything is scheduled, at rest while nothing is. It never skips
  // ahead, so the fixture's own advances stay close to what they ask for.
  let idle = false;
  if (running)
    void (async () => {
      for (;;) {
        if (!timers.size && !frames.size) {
          idle = true;
          await new Promise<void>((resolve) => {
            resting = resolve;
          });
          idle = false;
          continue;
        }
        await step();
      }
    })();
  /** One frame of progress: driven here, or waited for on the running clock. */
  const progress = async () => {
    if (!running) return step();
    const from = now;
    while (now === from) {
      // At rest (now, or since the last look), nothing will move time: an
      // advance or a deadline moves it.
      if (idle) return step();
      await turn();
    }
  };

  return {
    now: () => now,
    frame() {
      return this.advance(2 * FRAME_MS);
    },
    async advance(ms) {
      const end = now + ms;
      // Zero-delay timers first, as a real task turn would run them.
      if (!running) await runTimers();
      while (now < end) await progress();
    },
    async until(done, message, limit = 10_000) {
      const end = now + limit;
      if (!running) await runTimers();
      while (!done()) {
        if (now >= end) throw new Error(message);
        await progress();
      }
    },
    real: { setTimeout: real.setTimeout, now: real.now },
  };
}

/**
 * The same interface on real time, for a case that cannot yet run on test
 * time: advance sleeps and until polls. Each use names why, with its issue.
 */
export function realTimeClock(): TestClock {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    now: () => performance.now(),
    advance: sleep,
    frame: () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    // As fixtures waited before test time: on each DOM change, or the limit.
    until: (done, message, limit = 10_000) =>
      done()
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const observer = new MutationObserver(() => {
              if (!done()) return;
              clearTimeout(timeout);
              observer.disconnect();
              resolve();
            });
            const timeout = setTimeout(() => {
              observer.disconnect();
              if (done()) resolve();
              else reject(new Error(message));
            }, limit);
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
            });
          }),
    real: {
      setTimeout: window.setTimeout.bind(window),
      now: performance.now.bind(performance),
    },
  };
}
