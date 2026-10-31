import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { inspectorFocusBlocked } from "./inspectorTerminalFocus";

test("an open popover, such as the title's pane map, keeps the deferred terminal focus out", () => {
  const { document } = new Window();
  expect(inspectorFocusBlocked(document)).toBe(false);
  document.body.innerHTML =
    '<div data-radix-popper-content-wrapper><div role="dialog" aria-label="Panes in this tab"></div></div>';
  expect(inspectorFocusBlocked(document)).toBe(true);
  for (const layer of [
    '<div class="world-hosts-menu"></div>',
    '<div class="command-popover"></div>',
    '<div class="modal-backdrop"></div>',
    '<div role="menu"></div>',
  ]) {
    document.body.innerHTML = layer;
    expect(inspectorFocusBlocked(document)).toBe(true);
  }
});

if (process.env.HERDR_INSPECTOR_FOCUS_DOM_TEST !== "1") {
  test("the deferred focuser in an isolated DOM runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_INSPECTOR_FOCUS_DOM_TEST: "1" },
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
  test("a pick's late terminal focus leaves a reopened pane map open; the next pick still focuses", async () => {
    const browser = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      Event: browser.Event,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    // Hold animation frames, as a busy page does, and release them on demand.
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    // The panes' inputs exist, so the focuser acts inside the frame itself.
    const releaseFrames = () => {
      for (const callback of frames.splice(0)) callback(0);
    };
    const { createInspectorTerminalFocuser } = await import(
      "./inspectorTerminalFocus"
    );
    const { __storeTesting, store } = await import("../store");
    const { worldInspectorWindowId } = await import(
      "./worldTerminalPresentation"
    );
    const pane = (id: string) => ({
      pane_id: id,
      terminal_id: `${id}-terminal`,
      workspace_id: "studio",
      tab_id: "work",
    });
    const select = (paneId: string) =>
      __storeTesting.replaceState({
        ...store.get(),
        activeConnectionId: "local",
        serverRuntimeGeneration: 7,
        selectedPaneId: paneId,
        panes: [pane("builder"), pane("sibling")] as never,
      });
    const conversation = (paneId: string) =>
      ({
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        tabId: "work",
        nodeId: "node",
        paneId,
        terminalId: `${paneId}-terminal`,
        view: "terminal",
      }) as never;
    const windowId = worldInspectorWindowId(conversation("builder"));
    const portal = document.createElement("div");
    portal.innerHTML = ["builder", "sibling"]
      .map(
        (id) =>
          `<div class="pane-layout-cell" data-pane-id="${id}"><textarea class="xterm-helper-textarea"></textarea></div>`,
      )
      .join("");
    document.body.append(portal);
    const textarea = (id: string) =>
      portal.querySelector<HTMLElement>(
        `[data-pane-id="${id}"] .xterm-helper-textarea`,
      )!;
    const conversations = { current: [conversation("builder")] };
    const focus = createInspectorTerminalFocuser(
      { current: 0 },
      conversations,
      { current: { [windowId]: portal } },
    );

    // Picking builder defers its terminal focus by a frame.
    select("builder");
    focus(windowId);
    // The pane map reopens before that frame arrives.
    const map = document.createElement("div");
    map.setAttribute("data-radix-popper-content-wrapper", "");
    map.innerHTML = '<div role="dialog"><button>sibling</button></div>';
    document.body.append(map);
    map.querySelector("button")!.focus();
    releaseFrames();
    expect(document.activeElement).toBe(map.querySelector("button"));

    // Picking sibling closes the map; its own deferred focus still lands.
    map.remove();
    select("sibling");
    conversations.current = [conversation("sibling")];
    focus(windowId);
    releaseFrames();
    expect(document.activeElement).toBe(textarea("sibling"));
  });
}
