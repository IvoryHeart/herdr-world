import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { registerWorldFrames } from "./worldFrameScheduler";

const globals = [
  "window",
  "document",
  "Element",
  "setTimeout",
  "clearTimeout",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;
let saved: (PropertyDescriptor | undefined)[] = [];
let browser: Window;
let timers: { run: () => void; ms: number }[];
let frames: ((now: number) => void)[];

beforeEach(() => {
  saved = globals.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  browser = new Window();
  timers = [];
  frames = [];
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    Element: browser.Element,
    setTimeout: (run: () => void, ms: number) => timers.push({ run, ms }),
    clearTimeout: (id: number) => {
      if (timers[id - 1]) timers[id - 1]!.run = () => {};
    },
    requestAnimationFrame: (run: (now: number) => void) => frames.push(run),
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => {};
    },
  });
});

afterEach(async () => {
  globals.forEach((name, index) => {
    const descriptor = saved[index];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
  await browser.happyDOM.close();
});

/** Runs the scheduler's next task turn, then its animation frame. */
function nextFrame(now: number) {
  const timer = timers.shift();
  if (!timer) return false;
  expect(timer.ms).toBe(0);
  timer.run();
  frames.shift()?.(now);
  return true;
}

test("a canvas draws on every animation frame, after one task turn", () => {
  const drawn: number[] = [];
  const canvas = browser.document.createElement("canvas");
  const frames = registerWorldFrames(canvas as unknown as Element, (now) => {
    drawn.push(now);
    // Keeps moving.
    frames.request("state");
  });
  try {
    frames.request("state");
    // A 16 ms wait before each frame held canvases near 30 fps (#1248).
    for (let frame = 1; frame <= 3; frame++) nextFrame(frame * 16);
    expect(drawn).toEqual([16, 32, 48]);
  } finally {
    frames.dispose();
  }
});

test.each([".xterm textarea", ".terminal-composer-input"])(
  "typing into %s pauses continuing motion",
  (target) => {
    browser.document.body.innerHTML = `<div class="xterm"><textarea></textarea></div><textarea class="terminal-composer-input"></textarea><input class="search">`;
    const pauses: boolean[] = [];
    const canvas = browser.document.createElement("canvas");
    const frames = registerWorldFrames(
      canvas as unknown as Element,
      () => {},
      (paused) => pauses.push(paused),
    );
    try {
      const key = (selector: string) =>
        browser.document
          .querySelector(selector)!
          .dispatchEvent(
            new browser.KeyboardEvent("keydown", { key: "a", bubbles: true }),
          );
      key(".search");
      expect(frames.motionAllowed).toBe(true);
      key(target);
      expect(pauses).toEqual([false, true]);
      expect(frames.motionAllowed).toBe(false);
    } finally {
      frames.dispose();
    }
  },
);
