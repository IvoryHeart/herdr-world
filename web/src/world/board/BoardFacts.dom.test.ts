import { expect, test } from "bun:test";

if (process.env.BOARD_FACTS_DOM !== "1") {
  test("Board's summary in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, BOARD_FACTS_DOM: "1" },
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
    HTMLButtonElement: browser.HTMLButtonElement,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { BoardSummary } = await import("./BoardFacts");
  type Summary = Parameters<typeof BoardSummary>[0]["summary"];

  const counts = {
    needsYou: 2,
    working: 5,
    finished: 1,
    quiet: 7,
    unknown: 0,
  };
  const summary = {
    counts: { ...counts, agents: 14, buildings: 1 },
    needsYou: [],
    asks: [],
    finished: [
      {
        agent: { key: "a1", nodeId: "node-a1", displayLabel: "review bot" },
        hostLabel: "atlas",
        roomKey: "r1",
        roomLabel: "orbit",
        since: Date.now() - 5 * 60_000,
      },
    ],
    hosts: [
      {
        key: "h1",
        connectionId: "scene-atlas",
        label: "atlas",
        stale: false,
        counts,
        rooms: [],
      },
    ],
    spend: { available: false },
  } as unknown as Summary;

  test("the chip shows Town's counts and opens the summary with its finishes and hosts", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selected: string[] = [];
    act(() =>
      root.render(
        createElement(BoardSummary, {
          summary,
          onSelectAgent: (id: string) => selected.push(id),
        }),
      ),
    );
    const chip = host.querySelector<HTMLButtonElement>(".board-facts-chip")!;
    expect(chip.getAttribute("aria-label")).toBe(
      "Board summary: 5 busy, 2 waiting, 1 done, 7 quiet",
    );
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".board-facts-panel")).toBeNull();
    act(() => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const panel = host.querySelector(".board-facts-panel")!;
    const text = panel.textContent!;
    for (const words of [
      "Busy5",
      "Waiting2",
      "Done1",
      "Quiet7",
      "14 agents on 1 host",
      "Today",
      "7 days",
      "Limits",
      "Done, not reviewed 1",
      "review bot",
      "orbit · atlas · last active 5 m ago",
      "5 busy · 2 waiting · 1 done · 7 quiet",
    ])
      expect(text).toContain(words);
    const item = panel.querySelector<HTMLButtonElement>(
      '[aria-label="Show review bot on the board"]',
    )!;
    act(() => item.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selected).toEqual(["node-a1"]);
    expect(host.querySelector(".board-facts-panel")).toBeNull();
    act(() => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".board-facts-panel")).toBeNull();
    act(() => root.unmount());
  });
}
