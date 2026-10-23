import { expect, test } from "bun:test";
import { Window } from "happy-dom";

if (process.env.HERDR_TOWN_PENNANT_DOM_TEST !== "1") {
  test("quest pennant mount lifecycle in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_TOWN_PENNANT_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const browser = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TownQuestPennant } = await import("./townQuestPennant");

  test("only mounted pennants remain registered across remove and remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pennants = new Set<HTMLElement>();
    const props = {
      quest: {
        title: "Synthetic quest",
        progress: "1/2",
        done: 1,
        total: 2,
        status: "active" as const,
      },
      agentKey: "synthetic-agent",
      agentLabel: "Synthetic agent",
      top: false,
      x: 0,
      renderer: { current: null },
      pennants,
    };
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await act(async () => root.render(h(TownQuestPennant, props)));
        const mounted = container.querySelector("button")!;
        expect([...pennants]).toEqual([mounted]);
        await act(async () => root.render(null));
        expect(mounted.isConnected).toBe(false);
        expect(pennants.size).toBe(0);
      }
      await act(async () => root.render(h(TownQuestPennant, props)));
      expect(pennants.size).toBe(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      await browser.happyDOM.close();
    }
    expect(pennants.size).toBe(0);
  });
}
