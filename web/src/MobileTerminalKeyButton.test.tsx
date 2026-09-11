/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileTerminalKeyButton } from "./MobileTerminalKeyButton";
import { MOBILE_TERMINAL_SPECIAL_KEYS } from "./mobileTerminalControls";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MobileTerminalKeyButton", () => {
  it("sends immediately, repeats after 400ms, and never adds a release click", async () => {
    const input = vi.fn();
    const button = await renderKey(input);
    pointer(button, "pointerdown");
    expect(input.mock.calls).toEqual([["\x7F"]]);
    vi.advanceTimersByTime(399);
    expect(input).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(121);
    expect(input.mock.calls).toEqual(Array.from({ length: 4 }, () => ["\x7F"]));
    pointer(button, "pointerup");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(1000);
    expect(input).toHaveBeenCalledTimes(4);
  });

  it("sends a short tap once and supports keyboard or assistive clicks", async () => {
    const input = vi.fn();
    const button = await renderKey(input);
    pointer(button, "pointerdown");
    pointer(button, "pointerup");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(1000);
    expect(input).toHaveBeenCalledTimes(1);
    button.click();
    expect(input).toHaveBeenCalledTimes(2);
  });

  for (const event of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) {
    it(`stops repeats on ${event}`, async () => {
      const input = vi.fn();
      const button = await renderKey(input);
      pointer(button, "pointerdown");
      vi.advanceTimersByTime(400);
      pointer(button, event);
      vi.advanceTimersByTime(1000);
      expect(input).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("stops when a captured finger moves off the key", async () => {
    const input = vi.fn();
    const button = await renderKey(input);
    pointer(button, "pointerdown");
    pointer(button, "pointermove", { clientX: 101 });
    vi.advanceTimersByTime(1000);
    expect(input).toHaveBeenCalledTimes(1);
  });

  it("ignores secondary touches and releases from other pointers", async () => {
    const input = vi.fn();
    const button = await renderKey(input);
    pointer(button, "pointerdown", { isPrimary: false, pointerId: 2 });
    pointer(button, "pointerdown", { button: 2 });
    expect(input).not.toHaveBeenCalled();
    pointer(button, "pointerdown");
    pointer(button, "pointerup", { pointerId: 2 });
    vi.advanceTimersByTime(400);
    expect(input).toHaveBeenCalledTimes(2);
    pointer(button, "pointerup");
    vi.advanceTimersByTime(1000);
    expect(input).toHaveBeenCalledTimes(2);
  });

  for (const event of ["blur", "pagehide", "visibilitychange"]) {
    it(`stops repeats when the page receives ${event}`, async () => {
      const input = vi.fn();
      const button = await renderKey(input);
      pointer(button, "pointerdown");
      if (event === "visibilitychange") {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event(event));
      } else {
        window.dispatchEvent(new Event(event));
      }
      vi.advanceTimersByTime(1000);
      expect(input).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("cancels on disabling and never resumes an old hold after reconnect", async () => {
    const input = vi.fn();
    const button = await renderKey(input);
    pointer(button, "pointerdown");
    await renderKey(input, true);
    vi.advanceTimersByTime(1000);
    button.click();
    expect(input).toHaveBeenCalledTimes(1);
    await renderKey(input);
    vi.advanceTimersByTime(1000);
    expect(input).toHaveBeenCalledTimes(1);
  });

  it("cancels on unmount or a change of input destination", async () => {
    const firstInput = vi.fn();
    const secondInput = vi.fn();
    const button = await renderKey(firstInput);
    pointer(button, "pointerdown");
    await renderKey(secondInput);
    vi.advanceTimersByTime(1000);
    expect(firstInput).toHaveBeenCalledTimes(1);
    expect(secondInput).not.toHaveBeenCalled();
    pointer(button, "pointerdown");
    await act(async () => root.render(null));
    vi.advanceTimersByTime(1000);
    expect(secondInput).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not repeat single-shot keys", async () => {
    const input = vi.fn();
    const button = await renderKey(input, false, false);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(2000);
    expect(input).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function renderKey(onInput: (data: string) => void, disabled = false, repeat = true) {
  const terminalKey = MOBILE_TERMINAL_SPECIAL_KEYS.find((key) => key.id === "backspace");
  if (!terminalKey) {
    throw new Error("Missing Backspace terminal key fixture");
  }
  await act(async () => {
    root.render(
      <MobileTerminalKeyButton
        terminalKey={terminalKey}
        disabled={disabled}
        repeat={repeat}
        onInput={onInput}
      />,
    );
  });
  const button = container.querySelector("button");
  if (!button) {
    throw new Error("Missing direct terminal key button");
  }
  // jsdom has pointer events, but no layout or browser pointer capture implementation.
  button.setPointerCapture = vi.fn();
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 40));
  return button;
}

function pointer(button: HTMLButtonElement, type: string, options: PointerEventInit = {}) {
  button.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      ...options,
    }),
  );
}
