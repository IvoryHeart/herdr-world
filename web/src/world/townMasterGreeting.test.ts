import { expect, test } from "bun:test";
import {
  greetingCovered,
  greetingPlacement,
  greetingStep,
  lastHere,
  TownMasterGreeting,
} from "./townMasterGreeting";

const MIN = 60_000;

function greeting(showOnStart = true) {
  const clock = { now: 1_000 * MIN, on: showOnStart };
  const subject = new TownMasterGreeting({
    now: () => clock.now,
    showOnStart: () => clock.on,
  });
  return { clock, subject };
}

test("World opening is a visit: the greeting opens once, when shown", () => {
  const { clock, subject } = greeting();
  subject.visit({ from: clock.now, before: clock.now - 5 * MIN });
  expect(subject.get()).toMatchObject({ open: false, pending: true });
  subject.show();
  expect(subject.get()).toMatchObject({ open: true, pending: false });
  subject.close();
  // Once per visit: closed, it does not come back by itself.
  subject.show();
  expect(subject.get()).toMatchObject({ open: false, pending: false });
});

test("coming back on screen after 30 minutes hidden is a new visit; sooner is not", () => {
  const { clock, subject } = greeting();
  subject.visit({ from: clock.now, before: null });
  subject.close();
  subject.hidden();
  clock.now += 29 * MIN;
  subject.visible();
  expect(subject.get().pending).toBe(false);
  subject.hidden();
  const hiddenAt = clock.now;
  clock.now += 30 * MIN;
  subject.visible();
  expect(subject.get()).toMatchObject({
    pending: true,
    visit: { from: hiddenAt, before: hiddenAt },
  });
});

test("Show this on start off: a visit does not greet, the figure still opens it", () => {
  const { clock, subject } = greeting(false);
  subject.visit({ from: clock.now, before: clock.now - MIN });
  subject.show();
  expect(subject.get().open).toBe(false);
  subject.toggle();
  expect(subject.get().open).toBe(true);
  subject.toggle();
  expect(subject.get().open).toBe(false);
});

test("the very first visit, with no last time known, greets too", () => {
  const { clock, subject } = greeting();
  subject.visit({ from: clock.now, before: null });
  expect(greetingStep(subject.get(), { covered: false, placed: true })).toBe(
    "show",
  );
  subject.show();
  expect(subject.get().open).toBe(true);
});

test("Show this on start turned off while a greeting waits stops it", () => {
  const { clock, subject } = greeting();
  subject.visit({ from: clock.now, before: clock.now - MIN });
  expect(subject.get().pending).toBe(true);
  clock.on = false;
  subject.show();
  expect(subject.get()).toMatchObject({ open: false, pending: false });
  // Stepped aside, a visit's greeting rechecks the setting too.
  const second = greeting();
  second.subject.visit({ from: second.clock.now, before: null });
  second.subject.show();
  second.subject.stepAside();
  second.clock.on = false;
  second.subject.show();
  expect(second.subject.get().open).toBe(false);
  // One the figure opened comes back once uncovered.
  second.subject.toggle();
  second.subject.stepAside();
  second.subject.show();
  expect(second.subject.get().open).toBe(true);
});

test("a window opening over the greeting puts it back to wait", () => {
  const { clock, subject } = greeting();
  subject.visit({ from: clock.now, before: clock.now - MIN });
  subject.show();
  subject.stepAside();
  expect(subject.get()).toMatchObject({ open: false, pending: true });
  subject.show();
  expect(subject.get().open).toBe(true);
});

test("last here: a return begun in this visit, else the visit's last seen", () => {
  const visit = { from: 100 * MIN, before: 90 * MIN };
  expect(lastHere(null, null)).toBeNull();
  expect(lastHere(visit, null)).toBe(90 * MIN);
  // An older return is not this visit's.
  expect(lastHere(visit, { since: 10 * MIN, at: 50 * MIN })).toBe(90 * MIN);
  expect(lastHere(visit, { since: 20 * MIN, at: 101 * MIN })).toBe(20 * MIN);
  expect(lastHere({ from: 100 * MIN, before: null }, null)).toBeNull();
});

test("the card opens below its anchor, above it when there is no room, on screen", () => {
  const card = { width: 300, height: 200 };
  const viewport = { width: 1280, height: 800 };
  expect(
    greetingPlacement({ left: 260, top: 16, bottom: 56 }, card, viewport),
  ).toEqual({ left: 260, top: 64 });
  expect(
    greetingPlacement({ left: 1200, top: 740, bottom: 776 }, card, viewport),
  ).toEqual({ left: 972, top: 532 });
});

test("the greeting waits while a window or sheet is open, and for its place", () => {
  const waiting = { open: false, pending: true };
  const ready = { covered: false, placed: true };
  expect(greetingStep(waiting, ready)).toBe("show");
  expect(greetingStep(waiting, { ...ready, covered: true })).toBeNull();
  expect(greetingStep(waiting, { ...ready, placed: false })).toBeNull();
  expect(greetingStep({ open: false, pending: false }, ready)).toBeNull();
  expect(
    greetingStep({ open: true, pending: false }, { ...ready, covered: true }),
  ).toBe("step-aside");
  expect(greetingStep({ open: true, pending: false }, ready)).toBeNull();
});

test("on a wide screen only a window over the figure or its card holds the greeting back", () => {
  const figure = { left: 260, top: 16, right: 300, bottom: 56 };
  const card = { width: 300, height: 280 };
  const viewport = { width: 1600, height: 900 };
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });
  // An intent window or Chat docked on the right leaves the place free.
  expect(
    greetingCovered(figure, card, viewport, [box(948, 12, 640, 876)]),
  ).toBe(false);
  // A closed context rail measures nothing.
  expect(greetingCovered(figure, card, viewport, [box(0, 0, 0, 0)])).toBe(
    false,
  );
  // Over the card's place (below the figure), or over the figure itself.
  expect(
    greetingCovered(figure, card, viewport, [box(400, 200, 500, 400)]),
  ).toBe(true);
  expect(greetingCovered(figure, card, viewport, [box(0, 0, 320, 900)])).toBe(
    true,
  );
});
