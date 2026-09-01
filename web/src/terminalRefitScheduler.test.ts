import { describe, expect, it, vi } from "vitest";

import {
  createTerminalRefitScheduler,
  TERMINAL_REFIT_INTERVAL_MS,
} from "./terminalRefitScheduler";

describe("terminal refit scheduler", () => {
  it("bounds a resize burst and applies its trailing observation", () => {
    let time = 0;
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, () => void>();
    const refit = vi.fn();
    const scheduler = createTerminalRefitScheduler(refit, {
      now: () => time,
      requestAnimationFrame: (callback) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => { frames.delete(id); },
      setTimeout: (callback) => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => { timers.delete(id); },
    });

    for (let index = 0; index < 300; index += 1) scheduler.request();
    expect(frames.size).toBe(1);
    runFirst(frames, time);
    expect(refit).toHaveBeenCalledTimes(1);

    time = 1;
    for (let index = 0; index < 300; index += 1) scheduler.request();
    expect(frames.size).toBe(1);
    runFirst(frames, time);
    expect(refit).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(1);

    time = TERMINAL_REFIT_INTERVAL_MS;
    runFirstTimer(timers);
    expect(frames.size).toBe(1);
    runFirst(frames, time);
    expect(refit).toHaveBeenCalledTimes(2);
  });

  it("cancels both frame-aligned and trailing work", () => {
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, () => void>();
    const canceledFrames: number[] = [];
    const canceledTimers: number[] = [];
    const refit = vi.fn();
    let time = 0;
    const scheduler = createTerminalRefitScheduler(refit, {
      now: () => time,
      requestAnimationFrame: (callback) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => {
        canceledFrames.push(id);
        frames.delete(id);
      },
      setTimeout: (callback) => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => {
        canceledTimers.push(id);
        timers.delete(id);
      },
    });

    scheduler.request();
    const firstFrame = frames.keys().next().value as number;
    scheduler.cancel();
    expect(canceledFrames).toEqual([firstFrame]);

    scheduler.request();
    runFirst(frames, time);
    time = 1;
    scheduler.request();
    runFirst(frames, time);
    const trailingTimer = timers.keys().next().value as number;
    scheduler.cancel();
    expect(canceledTimers).toEqual([trailingTimer]);
    expect(refit).toHaveBeenCalledTimes(1);
  });
});

function runFirst(frames: Map<number, FrameRequestCallback>, time: number) {
  const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!entry) throw new Error("Expected a queued animation frame");
  frames.delete(entry[0]);
  entry[1](time);
}

function runFirstTimer(timers: Map<number, () => void>) {
  const entry = timers.entries().next().value as [number, () => void] | undefined;
  if (!entry) throw new Error("Expected a queued timer");
  timers.delete(entry[0]);
  entry[1]();
}
