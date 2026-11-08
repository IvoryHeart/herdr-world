import { expect, test } from "bun:test";

if (process.env.TOWN_LENS_DOM !== "1") {
  test("Town's lens legend and keys in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_LENS_DOM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLElement: browser.HTMLElement,
    HTMLButtonElement: browser.HTMLButtonElement,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement, useRef } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TownLensLegend, useTownLensKeys, useTownLensState } = await import(
    "./TownLenses"
  );

  function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Probe() {
      const state = useTownLensState();
      const shell = useRef<HTMLDivElement | null>(null);
      useTownLensKeys(state, shell, false);
      return createElement(
        "div",
        { ref: shell, "data-lens": state.lens },
        state.shown
          ? createElement(TownLensLegend, { state, view: null, readout: null })
          : createElement("p", { className: "board" }, "TOWN BOARD"),
      );
    }
    act(() => root.render(createElement(Probe)));
    const shell = () => host.firstElementChild as HTMLElement;
    const click = (selector: string) =>
      act(() =>
        (host.querySelector(selector) as HTMLButtonElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        ),
      );
    const key = (keyName: string, shiftKey = false) =>
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: keyName,
            shiftKey,
            bubbles: true,
          }),
        );
      });
    return { host, root, shell, click, key };
  }

  test("L turns on a lens, steps it, and Escape brings the board back", () => {
    const { host, root, shell, key } = mount();
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".board")).not.toBeNull();
    key("l");
    expect(shell().dataset.lens).toBe("idle");
    expect(host.querySelector(".town-lens-legend")).not.toBeNull();
    expect(host.querySelector(".board")).toBeNull();
    key("L");
    expect(shell().dataset.lens).toBe("spend");
    key("L", true);
    expect(shell().dataset.lens).toBe("idle");
    key("Escape");
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".board")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  test("the legend's chooser, ‹ › and ✕", () => {
    const { host, root, shell, key, click } = mount();
    key("l");
    click(".town-lens-name");
    const choices = [
      ...host.querySelectorAll<HTMLButtonElement>(".town-lens-choices button"),
    ].map((button) => button.textContent);
    expect(choices).toEqual([
      "Attention",
      "Idle time",
      "Spend",
      "Pull requests",
      "Quests",
      "Harness",
    ]);
    click(".town-lens-choices button:nth-child(4)");
    expect(shell().dataset.lens).toBe("pulls");
    // Picking closes the chooser.
    expect(host.querySelector(".town-lens-choices")).toBeNull();
    click('[aria-label="Next lens"]');
    expect(shell().dataset.lens).toBe("quests");
    click('[aria-label="Previous lens"]');
    expect(shell().dataset.lens).toBe("pulls");
    click('[aria-label="Leave the lens"]');
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".town-lens-legend")).toBeNull();
    // The last lens chosen comes back with L.
    key("l");
    expect(shell().dataset.lens).toBe("pulls");
    act(() => root.unmount());
    host.remove();
  });

  test("typing in a field never switches lenses", () => {
    const { host, root, shell } = mount();
    const input = document.createElement("input");
    shell().append(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "l", bubbles: true }),
      );
    });
    expect(shell().dataset.lens).toBe("attention");
    act(() => root.unmount());
    host.remove();
  });
}
