import { expect, test } from "bun:test";
import { Window } from "happy-dom";

if (process.env.BOARD_CONTROLS_DOM_TEST !== "1") {
  test("unchanged Board control measurements do not commit", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BOARD_CONTROLS_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  test("initial observer delivery after phone layout adds no commit", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    let deliver = () => {};
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          deliver = callback;
        }
        observe() {}
        disconnect() {}
      },
    });
    let available = 366;
    Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => available,
    });
    browser.HTMLElement.prototype.getBoundingClientRect = function () {
      const width = this.classList.contains("board-control-work") ? 76 : 36;
      return new browser.DOMRect(0, 0, width, 36);
    };
    const { act, createElement: h, Profiler } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BoardControls } = await import("./BoardControls");
    const host = document.body.appendChild(document.createElement("div"));
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = ".board-controls-space { --board-control-phone: 1; }";
    const root = createRoot(host);
    let commits = 0;
    await act(async () =>
      root.render(
        h(
          Profiler,
          {
            id: "controls",
            onRender: () => commits++,
          },
          h(BoardControls, {
            workRef: { current: null },
            workOpen: false,
            count: 0,
            onWork() {},
            onHome() {},
            onZoom() {},
            onFit() {},
            onTidy() {},
            tidyLabel: "Tidy",
            pulses: false,
            onPulses() {},
            tracing: false,
          }),
        ),
      ),
    );
    const mountedCommits = commits;
    await act(async () => deliver());
    expect(commits).toBe(mountedCommits);
    await act(async () => deliver());
    expect(commits).toBe(mountedCommits);
    const inline = () =>
      host.querySelector(".board-controls:not(.board-controls-measure)")!;
    expect(
      inline().querySelector('[aria-label="Fit everything"]'),
    ).not.toBeNull();
    available = 128;
    await act(async () => {
      deliver();
      deliver();
    });
    expect(commits).toBe(mountedCommits + 1);
    expect(inline().querySelector('[aria-label="Fit everything"]')).toBeNull();
    await act(async () => deliver());
    expect(commits).toBe(mountedCommits + 1);
    available = 366;
    await act(async () => deliver());
    expect(commits).toBe(mountedCommits + 2);
    expect(
      inline().querySelector('[aria-label="Fit everything"]'),
    ).not.toBeNull();
    await act(async () => deliver());
    expect(commits).toBe(mountedCommits + 2);
    await act(async () => root.unmount());
    await browser.happyDOM.close();
  });
}
