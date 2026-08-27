import { describe, expect, it, vi } from "vitest";
import {
  createTerminalResizeScheduler,
  sameTerminalResize,
  TERMINAL_RESIZE_SEND_INTERVAL_MS,
} from "./terminalResizeTransport";

describe("terminal resize transport", () => {
  it("compares terminal cell sizes rather than host pixels", () => {
    expect(sameTerminalResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(true);
    expect(sameTerminalResize({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(false);
    expect(sameTerminalResize(null, { cols: 80, rows: 24 })).toBe(false);
  });

  it("sends the latest dimensions at a bounded rate", () => {
    let time = 100;
    const timerRef: { current: (() => void) | null } = { current: null };
    const sent: Array<{ cols: number; rows: number }> = [];
    const scheduler = createTerminalResizeScheduler(
      (size) => {
        sent.push(size);
      },
      {
        now: () => time,
        setTimeout: (callback) => {
          timerRef.current = callback;
          return 1;
        },
        clearTimeout: () => {
          timerRef.current = null;
        },
      },
    );

    scheduler.submit({ cols: 80, rows: 24 });
    time += 10;
    scheduler.submit({ cols: 81, rows: 24 });
    time += 10;
    scheduler.submit({ cols: 82, rows: 24 });
    expect(sent).toEqual([{ cols: 80, rows: 24 }]);
    expect(timerRef.current).not.toBeNull();

    time += TERMINAL_RESIZE_SEND_INTERVAL_MS - 20;
    timerRef.current?.();
    expect(sent).toEqual([
      { cols: 80, rows: 24 },
      { cols: 82, rows: 24 },
    ]);
  });

  it("drops duplicates and clears stale pending work on reset", () => {
    let time = 0;
    const scheduled = vi.fn<(callback: () => void, delayMs: number) => number>(() => 1);
    const canceled = vi.fn<(timer: number) => void>();
    const sent: Array<{ cols: number; rows: number }> = [];
    const scheduler = createTerminalResizeScheduler(
      (size) => {
        sent.push(size);
      },
      {
        now: () => time,
        setTimeout: scheduled,
        clearTimeout: canceled,
      },
    );

    scheduler.submit({ cols: 80, rows: 24 });
    time = 1;
    scheduler.submit({ cols: 81, rows: 24 });
    scheduler.submit({ cols: 80, rows: 24 });
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(canceled).toHaveBeenCalledTimes(1);

    scheduler.submit({ cols: 82, rows: 24 });
    scheduler.reset();
    expect(canceled).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ cols: 80, rows: 24 }]);
  });
});
