import { expect, test } from "bun:test";
import { Window } from "happy-dom";

// Things that follow a view's drawn frames (the Inspector connector, Town's
// badge popover) move in place: frames that move them commit nothing.
if (process.env.FRAME_FOLLOWERS_DOM_TEST !== "1") {
  test("frame followers move without React commits", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, FRAME_FOLLOWERS_DOM_TEST: "1" },
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
  const browser = new Window({
    url: "https://world.example.test",
    width: 1280,
    height: 800,
  });
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
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });

  test("a walking anchor moves its Inspector connector without a commit", async () => {
    const { act, createElement: h, Profiler } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { createWorldAnchorFeed, useWorldAnchorPresent } = await import(
      "./worldAnchorFeed"
    );
    const { default: WorldIntentConnector } = await import(
      "./WorldIntentConnector"
    );
    const feed = createWorldAnchorFeed();
    const target = { left: 900, top: 100, right: 1200, bottom: 500 };
    // As World mounts it: shown while the node has an anchor.
    const Connector = () =>
      useWorldAnchorPresent(feed, "agent")
        ? h(WorldIntentConnector, { feed, nodeId: "agent", target })
        : null;
    const anchor = (x: number) => ({
      agent: { x, y: 200, visible: true, edge: null },
    });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let commits = 0;
    await act(async () =>
      root.render(
        h(
          Profiler,
          { id: "connector", onRender: () => commits++ },
          h(Connector),
        ),
      ),
    );
    expect(host.querySelector("svg")).toBeNull();
    await act(async () => feed.set(anchor(100)));
    expect(host.querySelector("svg")).not.toBeNull();
    const shown = commits;
    const path = () => host.querySelector("path")!.getAttribute("d");
    const drawn = path();
    // Three frames of a walking agent: the line moves, World does not commit.
    for (const x of [110, 120, 130]) await act(async () => feed.set(anchor(x)));
    expect(commits).toBe(shown);
    expect(path()).not.toBe(drawn);
    expect(host.querySelector("circle")!.getAttribute("cx")).toBe("130");
    // An unchanged report is no change at all.
    await act(async () => feed.set(anchor(130)));
    expect(commits).toBe(shown);
    // Losing the anchor hides the connector: one commit.
    await act(async () => feed.set(null));
    expect(host.querySelector("svg")).toBeNull();
    expect(commits).toBe(shown + 1);
    await act(async () => root.unmount());
  });

  test("a badge popover follows a moving camera without a commit", async () => {
    const { act, createElement: h, Profiler } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BadgePopover } = await import("./town/DeskWorkBadge");
    const { TownHud } = await import("./town/scene/townHud");
    const { manualClock } = await import("./town/scene/townScene.fixture");
    const { TownHudContext } = await import("./town/useTownHud");
    const hud = new TownHud(manualClock().clock);
    let left = 300;
    const button = document.body.appendChild(document.createElement("button"));
    button.getBoundingClientRect = () =>
      new browser.DOMRect(left, 200, 40, 20) as unknown as DOMRect;
    browser.HTMLElement.prototype.getBoundingClientRect = function () {
      return new browser.DOMRect(0, 0, 320, 180);
    };
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let commits = 0;
    await act(async () =>
      root.render(
        h(
          Profiler,
          { id: "popover", onRender: () => commits++ },
          h(
            TownHudContext.Provider,
            { value: hud },
            h(BadgePopover, {
              anchor: { current: button },
              onClose() {},
              children: h("a", { href: "https://example.com/pr" }, "PR"),
            }),
          ),
        ),
      ),
    );
    const panel = document.querySelector<HTMLElement>(".town-badge-popover")!;
    expect(panel.dataset.placed).toBe("");
    expect(panel.style.left).toBe("300px");
    const placed = commits;
    // Three frames of a panning camera move the badge, and the popover with it.
    for (const x of [320, 340, 360]) {
      left = x;
      await act(async () => hud.framed());
    }
    expect(panel.style.left).toBe("360px");
    expect(panel.style.top).toBe("226px");
    expect(commits).toBe(placed);
    await act(async () => root.unmount());
  });
}
