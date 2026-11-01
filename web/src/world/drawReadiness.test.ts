import { expect, test } from "bun:test";
import { DrawReadiness } from "./drawReadiness";

function deferred() {
  return Promise.withResolvers<void>();
}
function fixture() {
  let assets = deferred(),
    visible = true,
    wakes = 0,
    loads = 0;
  const frames: (() => void)[] = [],
    deadlines: (() => void)[] = [];
  const markers: unknown[] = [];
  const signals: AbortSignal[] = [];
  const gate = new DrawReadiness({
    view: "town",
    owner: 1,
    assets: (signal) => {
      signals.push(signal);
      loads++;
      return assets.promise;
    },
    active: () => visible,
    viewport: () => ({ width: 390, height: 844 }),
    wake: () => {
      wakes++;
    },
    frame: (fn) => {
      frames.push(fn);
      return () => {};
    },
    deadline: (fn) => {
      deadlines.push(fn);
      return () => {};
    },
    publish: (receipt) => markers.push(receipt),
  });
  return {
    gate,
    frames,
    deadlines,
    markers,
    assets: () => assets,
    replace: () => (assets = deferred()),
    hide: () => (visible = false),
    wakes: () => wakes,
    loads: () => loads,
    signals,
  };
}
const microtasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const paint = (f: ReturnType<typeof fixture>) => {
  f.frames.shift()?.();
  f.frames.shift()?.();
};

test("assets, semantic layout and actual draw precede paint readiness; motion need not stop", async () => {
  const f = fixture(),
    done = f.gate.wait(100);
  f.gate.drawn();
  paint(f);
  expect(f.markers.filter(Boolean)).toHaveLength(0);
  f.assets().resolve();
  await microtasks();
  expect(f.wakes()).toBe(1);
  f.gate.drawn("reflow");
  paint(f);
  expect(f.markers.filter(Boolean)).toHaveLength(0);
  f.gate.drawn();
  expect(f.markers.filter(Boolean)).toHaveLength(0);
  paint(f);
  const receipt = await done;
  expect(f.gate.matches(receipt)).toBe(true);
  f.gate.drawn("materialization became pending");
  expect(f.gate.matches(receipt)).toBe(false);
});

test.each(["revision", "resize"])(
  "%s fences obsolete resources and paint callbacks",
  async (reason) => {
    const f = fixture(),
      done = f.gate.wait(100);
    const oldAssets = f.assets();
    await microtasks();
    f.replace();
    f.gate.invalidate(reason);
    oldAssets.resolve();
    await microtasks();
    f.gate.drawn();
    paint(f);
    expect(f.markers.filter(Boolean)).toHaveLength(0);
    f.assets().resolve();
    await microtasks();
    f.gate.drawn();
    f.gate.invalidate(reason);
    paint(f);
    expect(f.markers.filter(Boolean)).toHaveLength(0);
    await microtasks();
    f.gate.drawn();
    paint(f);
    const receipt = await done;
    expect(receipt.revision).toBe(2);
    f.gate.invalidate(reason);
    expect(f.gate.matches(receipt)).toBe(false);
  },
);

test.each(["hidden", "unmount"])(
  "%s cannot publish late readiness",
  async (reason) => {
    const f = fixture(),
      done = f.gate.wait(100);
    const rejected = done.catch((error: Error) => error);
    f.assets().resolve();
    await microtasks();
    f.gate.drawn();
    if (reason === "hidden") f.hide();
    else f.gate.dispose();
    paint(f);
    f.deadlines[0]!();
    expect(String(await rejected)).toMatch(/capture|retired/i);
    expect(f.markers.filter(Boolean)).toHaveLength(0);
  },
);

test("never-ready fails on the injected deadline with bounded stage diagnostics", async () => {
  const f = fixture(),
    done = f.gate.wait(100);
  const rejected = done.catch((error: Error) => error);
  f.deadlines[0]!();
  expect(String(await rejected)).toMatch(/town.*revision=0.*assets/);
  f.assets().resolve();
  await microtasks();
  f.gate.drawn();
  paint(f);
  expect(f.markers.filter(Boolean)).toHaveLength(0);
});

test("revision bursts coalesce and retain only one active resource check", async () => {
  const f = fixture(),
    first = f.gate.wait(100);
  const failed = first.catch((error: Error) => error);
  await microtasks();
  expect(f.loads()).toBe(1);
  for (let i = 0; i < 100; i++) f.gate.invalidate("commit");
  expect(f.signals[0]!.aborted).toBe(true);
  await microtasks();
  expect(f.loads()).toBe(2);
  expect(f.signals.filter((signal) => !signal.aborted)).toHaveLength(1);
  f.deadlines[0]!();
  expect(String(await failed)).toContain("deadline");
  expect(f.signals.every((signal) => signal.aborted)).toBe(true);
});

test.each(["commit", "timeout"])(
  "a valid replacement captures while the obsolete %s asset remains unresolved",
  async (change) => {
    const f = fixture();
    let completed = false;
    const first = f.gate.wait(100);
    const firstResult = first.catch((error: Error) => error);
    await microtasks();
    let current = first;
    if (change === "timeout") {
      f.deadlines[0]!();
      expect(String(await firstResult)).toContain("deadline");
      f.replace();
      current = f.gate.wait(100);
    } else {
      f.replace();
      f.gate.invalidate("remove obsolete image");
    }
    const result = current.then(
      () => {
        completed = true;
      },
      () => {},
    );
    try {
      f.assets().resolve();
      await microtasks();
      f.gate.drawn();
      paint(f);
      await microtasks();
      expect(completed).toBe(true);
    } finally {
      f.gate.dispose();
      await result;
    }
  },
);
