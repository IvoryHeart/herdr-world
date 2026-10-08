import { expect, jest, mock, spyOn, test } from "bun:test";
import * as React from "react";
import { Window } from "happy-dom";
import { useTabReorderDrag } from "./useTabReorderDrag";

type DragHarness = {
  hook: ReturnType<typeof useTabReorderDrag>;
  pointer: (
    index: number,
    x: number,
    buttons?: number,
  ) => React.PointerEvent<HTMLElement>;
  elements: HTMLElement[];
  drops: Array<[string, string[]]>;
  finish: () => void;
  key: (key: string) => void;
};

function withDrag(widths: number[], run: (h: DragHarness) => void, scale = 1) {
  const browser = new Window();
  const globals = ["document", "DOMRect", "requestAnimationFrame"] as const;
  const previous = globals.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: browser.document },
    DOMRect: { configurable: true, value: browser.DOMRect },
    requestAnimationFrame: { configurable: true, value: () => 1 },
  });
  const effects: React.EffectCallback[] = [];
  const spies = [
    spyOn(React, "useRef").mockImplementation((current) => ({ current })),
    spyOn(React, "useEffect").mockImplementation((effect) => {
      effects.push(effect);
    }),
    spyOn(React, "useLayoutEffect").mockImplementation(() => {}),
  ];
  const cleanups: Array<() => void> = [];
  jest.useFakeTimers();
  try {
    const ids = widths.map((_, i) => String(i));
    const drops: Array<[string, string[]]> = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Hooks are mocked for this pointer lifecycle check.
    const hook = useTabReorderDrag({
      groupOf: () => ids,
      orderKey: ids.join(" "),
      onDrop: (id, order) => drops.push([id, order]),
    });
    const parent = browser.document.createElement("div");
    const barWidth = widths.reduce((sum, width) => sum + width + 4, 0);
    Object.defineProperty(parent, "offsetWidth", { value: barWidth });
    parent.getBoundingClientRect = () =>
      new browser.DOMRect(0, 0, barWidth * scale, 30 * scale);
    let left = 0;
    const elements = widths.map((width, i) => {
      const el = browser.document.createElement("div");
      const rect = new browser.DOMRect(
        left * scale,
        0,
        width * scale,
        30 * scale,
      );
      left += width + 4;
      el.getBoundingClientRect = () => rect;
      el.setPointerCapture = mock(() => {});
      parent.append(el);
      const element = el as unknown as HTMLElement;
      hook.register(ids[i])(element);
      return element;
    });
    for (const effect of effects) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
    const pointer = (i: number, x: number, buttons = 1) =>
      ({
        target: elements[i],
        currentTarget: elements[i],
        pointerType: "mouse",
        pointerId: 1,
        button: 0,
        buttons,
        clientX: x,
      }) as unknown as React.PointerEvent<HTMLElement>;
    run({
      hook,
      pointer,
      elements,
      drops,
      finish: () => jest.advanceTimersByTime(180),
      key: (key) => {
        browser.document.dispatchEvent(
          new browser.KeyboardEvent("keydown", { key }),
        );
      },
    });
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
    jest.useRealTimers();
    for (const spy of spies.reverse()) spy.mockRestore();
    globals.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
    void browser.happyDOM.abort();
  }
}

for (const scale of [0.8, 1, 1.25, 1.5]) {
  test(`drag, neighbor shift and settle use CSS coordinates at ${scale * 100}% UI scale`, () =>
    withDrag(
      [100, 100],
      ({ hook, pointer, elements, drops, finish }) => {
        const events = hook.handlers("0");
        const start = 50 * scale;
        const physicalTranslation = (el: HTMLElement) =>
          Number.parseFloat(el.style.transform.slice("translateX(".length)) *
          scale;
        events.onPointerDown(pointer(0, start));
        // The threshold is in viewport pixels, independent of UI scale.
        events.onPointerMove(pointer(0, start + 3));
        expect(elements[0].style.transform).toBe("");
        events.onPointerMove(pointer(0, start + 20));
        expect(physicalTranslation(elements[0])).toBeCloseTo(20);
        events.onPointerMove(pointer(0, start + 80 * scale));
        expect(physicalTranslation(elements[1])).toBeCloseTo(-104 * scale);
        events.onPointerUp(pointer(0, start + 80 * scale, 0));
        expect(physicalTranslation(elements[0])).toBeCloseTo(104 * scale);
        finish();
        expect(drops).toEqual([["0", ["1", "0"]]]);
      },
      scale,
    ));
}

for (const widths of [
  [100, 100],
  [200, 50],
  [50, 200],
]) {
  test(`moves tabs to both ends with widths ${widths}`, () => {
    for (const index of [0, 1])
      withDrag(widths, ({ hook, pointer, drops, finish }) => {
        const events = hook.handlers(String(index));
        const start = (index ? widths[0] + 4 : 0) + widths[index] / 2;
        const direction = index ? -1 : 1;
        events.onPointerDown(pointer(index, start));
        events.onPointerMove(pointer(index, start + direction * 5));
        events.onPointerMove(pointer(index, direction * 500));
        events.onPointerUp(pointer(index, direction * 500, 0));
        finish();
        expect(drops).toEqual([[String(index), ["1", "0"]]]);
      });
  });
}

test("captures the press and recovers from a missed release before the threshold", () =>
  withDrag([100, 100], ({ hook, pointer, elements, drops, finish }) => {
    const events = hook.handlers("0");
    events.onPointerDown(pointer(0, 50));
    expect(elements[0].setPointerCapture).toHaveBeenCalledWith(1);
    events.onPointerMove(pointer(0, 50));
    // Also recover if release delivery was missed: hovering must not drag.
    events.onPointerMove(pointer(0, 70, 0));
    expect(elements[0].classList.contains("is-dragging")).toBe(false);
    expect(elements[0].style.transform).toBe("");
    // A fresh press must work after the abandoned press.
    events.onPointerDown(pointer(0, 50));
    events.onPointerMove(pointer(0, 200));
    events.onPointerUp(pointer(0, 200, 0));
    finish();
    expect(drops).toEqual([["0", ["1", "0"]]]);
  }));

for (const cancel of [
  "pointercancel",
  "lostpointercapture",
  "Escape",
] as const) {
  test(`${cancel} cancels without committing and allows a fresh drag`, () =>
    withDrag([100, 100], ({ hook, pointer, elements, drops, finish, key }) => {
      const events = hook.handlers("0");
      events.onPointerDown(pointer(0, 50));
      events.onPointerMove(pointer(0, 200));
      if (cancel === "Escape") key(cancel);
      else if (cancel === "pointercancel")
        events.onPointerCancel(pointer(0, 200, 0));
      else events.onLostPointerCapture(pointer(0, 200, 0));
      finish();
      expect(drops).toEqual([]);
      expect(elements.map((el) => el.style.transform)).toEqual(["", ""]);
      events.onPointerDown(pointer(0, 50));
      events.onPointerMove(pointer(0, 200));
      events.onPointerUp(pointer(0, 200, 0));
      // Browsers release capture after pointerup; this must not cancel the drop.
      events.onLostPointerCapture(pointer(0, 200, 0));
      finish();
      expect(drops).toEqual([["0", ["1", "0"]]]);
    }));
}

test("a click still focuses, while a drag suppresses its compatibility click once", () =>
  withDrag([100, 100], ({ hook, pointer }) => {
    const events = hook.handlers("0");
    const click = {
      preventDefault: mock(() => {}),
      stopPropagation: mock(() => {}),
    } as unknown as React.MouseEvent<HTMLElement>;
    events.onPointerDown(pointer(0, 50));
    events.onPointerUp(pointer(0, 50, 0));
    events.onClickCapture(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
    events.onPointerDown(pointer(0, 50));
    events.onPointerMove(pointer(0, 200));
    events.onPointerUp(pointer(0, 200, 0));
    events.onClickCapture(click);
    events.onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    expect(click.stopPropagation).toHaveBeenCalledTimes(1);
  }));
