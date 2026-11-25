import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { WorldLeafObject } from "./worldObject";

// Choosing a tab in Spaces' herdr-core strip (#1390) shows its terminal over
// an expanded Inspector, as opening one from a find does: both ask App to
// reveal the terminal. Synthetic World leaves, no service or runtime.
if (process.env.SPACES_CORE_DOM_TEST !== "1") {
  test("a strip choice reveals its terminal as an open does", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SPACES_CORE_DOM_TEST: "1" },
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
  const browser = new Window({ url: "https://world.example.test" });
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });

  test("opening and choosing each reveal; only an open is a new choice", async () => {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useSpacesCore } = await import("./useSpacesCore");
    const { spacesCoreChoice } = await import("./spacesCore");
    let state!: ReturnType<typeof useSpacesCore>;
    const Probe = () => {
      state = useSpacesCore();
      return null;
    };
    const leaf = (address: string) =>
      ({
        id: `core:terminal:${address}`,
        connectionId: "core",
        generation: 4,
        label: address,
      }) as WorldLeafObject;
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(state.shown).toBeNull();

    await act(async () => state.show(leaf("t1")));
    expect(state.shown?.nodeId).toBe("core:terminal:t1");
    const opened = state.shown!.opened;
    expect(state.reveals).toBe(1);

    // A strip tab, by click or tab key: the terminal shows over an Inspector.
    await act(async () => state.choose(spacesCoreChoice(leaf("t2"))));
    expect(state.shown?.nodeId).toBe("core:terminal:t2");
    expect(state.shown?.opened).toBe(opened);
    expect(state.reveals).toBe(2);

    await act(async () => state.close());
    expect(state.shown).toBeNull();
    // With nothing shown, a strip choice changes nothing.
    await act(async () => state.choose(spacesCoreChoice(leaf("t3"))));
    expect(state.shown).toBeNull();
    await act(async () => root.unmount());
  });
}
