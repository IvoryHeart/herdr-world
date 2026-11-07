import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ConnectionSummary } from "./api";
import type { Pane } from "./types";

if (process.env.DRAFT_SCOPE_DOM_TEST !== "1") {
  test("unsent drafts survive a reconnect in this document only, in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DRAFT_SCOPE_DOM_TEST: "1" },
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
  }, 15000);
} else {
  test("a reconnect keeps drafts on the same pane and terminal of the same destination", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      localStorage: browser.localStorage,
      sessionStorage: browser.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    const { createRoot } = await import("react-dom/client");
    const { useTerminalComposerDraftScopes } = await import(
      "./useTerminalComposerDraftScopes"
    );
    const {
      readTerminalComposerDraft,
      terminalComposerDraftKey,
      writeTerminalComposerDraft,
    } = await import("./terminalComposer");

    const connection = (
      generation: number,
      socket = "/run/example/herdr.sock",
    ): ConnectionSummary =>
      ({
        id: "alpha",
        label: "Alpha",
        source: "test",
        type: "local",
        state: "ready",
        generation,
        is_default: true,
        control_socket_path: socket,
      }) as ConnectionSummary;
    const pane = (paneId: string, terminalId: string) =>
      ({ pane_id: paneId, terminal_id: terminalId }) as Pane;
    type Snapshot = Parameters<typeof useTerminalComposerDraftScopes>[0];
    const snapshot = (
      generation: number,
      panes: Pane[],
      lastRefresh: number,
      socket?: string,
    ): Snapshot => ({
      activeConnectionId: "alpha",
      connectionGeneration: generation,
      serverRuntimeGeneration: generation,
      connections: [connection(generation, socket)],
      catalogueReady: true,
      status: "connected",
      panes,
      lastRefresh,
    });
    function Probe({ value }: { value: Snapshot }) {
      useTerminalComposerDraftScopes(value);
      return null;
    }
    const container = browser.document.createElement("div");
    browser.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    const render = (value: Snapshot) =>
      act(async () => root.render(createElement(Probe, { value })));
    const key = (generation: number, paneId: string) =>
      terminalComposerDraftKey("alpha", generation, paneId);

    await render(snapshot(1, [pane("p1", "t1"), pane("p2", "t2")], 1));
    writeTerminalComposerDraft(key(1, "p1"), "unsent text");
    writeTerminalComposerDraft(key(1, "p2"), "other terminal");

    // The new generation is admitted before its topology: nothing is lost yet.
    await render(snapshot(2, [], 0));
    expect(readTerminalComposerDraft(key(1, "p1"))).toBe("unsent text");
    // Its topology arrives: p1 is the same terminal, p2 now hosts another.
    await render(snapshot(2, [pane("p1", "t1"), pane("p2", "t9")], 2));
    expect(readTerminalComposerDraft(key(2, "p1"))).toBe("unsent text");
    expect(readTerminalComposerDraft(key(2, "p2"))).toBe("");
    expect(readTerminalComposerDraft(key(1, "p1"))).toBe("");

    // A reconnect to another destination is another runtime: nothing moves.
    await render(snapshot(3, [], 0, "/run/example/other.sock"));
    await render(snapshot(3, [pane("p1", "t1")], 3, "/run/example/other.sock"));
    expect(readTerminalComposerDraft(key(3, "p1"))).toBe("");

    // Drafts never reach browser storage.
    expect(browser.localStorage.length).toBe(0);
    expect(browser.sessionStorage.length).toBe(0);
    await act(async () => root.unmount());
    await browser.happyDOM.close();
  });
}
