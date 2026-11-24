import { expect, test } from "bun:test";
import type { FunctionComponent } from "react";
import type { ConnectionClient } from "./api";

// A terminal World opens in Spaces (#1329) shows even when an expanded
// Inspector covered Spaces: the production App in an isolated React DOM, a
// synthetic Herdr workspace, no service, sockets or runtime.
const layout = process.env.FOUND_TERMINAL_REVEAL_DOM;
if (layout !== "desktop" && layout !== "mobile") {
  for (const mode of ["desktop", "mobile"] as const)
    test(`a found terminal shows over an expanded Inspector (${mode})`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "test",
          "--preload",
          new URL("./testing/reactDomPreload.ts", import.meta.url).pathname,
          import.meta.path,
        ],
        {
          env: { ...process.env, FOUND_TERMINAL_REVEAL_DOM: mode },
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
    }, 30_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  browser.history.replaceState(null, "", `/?layout=${layout}`);
  for (const [key, value] of Object.entries({
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    NodeFilter: browser.NodeFilter,
    MutationObserver: browser.MutationObserver,
    FocusEvent: browser.FocusEvent,
    PointerEvent: browser.PointerEvent,
    location: browser.location,
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
    matchMedia: browser.matchMedia.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    getComputedStyle: browser.getComputedStyle.bind(browser),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    // Nothing here reaches a service.
    fetch: async () => new Response("{}", { status: 503 }),
    WebSocket: class {
      readyState = 3;
      addEventListener() {}
      removeEventListener() {}
      close() {}
      send() {}
    },
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { __storeTesting, store } = await import("./store");
  const { initializeLayoutPreferences } = await import("./layoutPreferences");
  const { WORKSPACE_INSPECTOR_REQUEST_EVENT, writeInspectorPreferences } =
    await import("./workspaceResource");
  const { worldLocalStorage } = await import("./browserStorage");
  const { ResourceConnectionClientContext } = await import(
    "./useConnectionClient"
  );
  // App's props are optional; createElement wants them named as a component.
  const App = (await import("./App")).default as FunctionComponent<
    NonNullable<Parameters<typeof import("./App").default>[0]>
  >;

  test(`an expanded Inspector gives way to a found terminal (${layout})`, async () => {
    initializeLayoutPreferences();
    const connectionId = "synthetic-reveal";
    __storeTesting.replaceState({
      ...store.get(),
      status: "connected",
      connections: [
        {
          id: connectionId,
          label: "Synthetic",
          source: "fixture",
          is_default: true,
          state: "ready",
          generation: 7,
        },
      ],
      defaultConnectionId: connectionId,
      activeConnectionId: connectionId,
      serverRuntimeGeneration: 7,
      workspaces: [
        {
          workspace_id: "workspace",
          number: 1,
          label: "Synthetic",
          focused: true,
          pane_count: 1,
          tab_count: 1,
          agent_status: "idle",
        },
      ],
    });
    // The Inspector opens expanded, as its saved layout asks.
    const scope = {
      kind: "workspace" as const,
      connectionId,
      workspaceId: "workspace",
    };
    writeInspectorPreferences(worldLocalStorage, {
      scope,
      open: true,
      view: "files",
      dock: "right",
      size: 520,
      expanded: true,
    });

    // The current Herdr connection, answering nothing.
    const client: ConnectionClient = {
      connectionId,
      generation: 3,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      acceptsServerGeneration: (value) => value === 7,
      call: () => new Promise<never>(() => {}),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const coreTerminal = createElement(
      "div",
      { "data-found": "core" },
      createElement("button", null, "Close"),
    );
    const render = (opened: number) =>
      act(async () => {
        const app = createElement(App, {
          spacesSurface: opened
            ? { key: String(opened), content: coreTerminal }
            : null,
          revealTerminal: opened,
        });
        root.render(
          createElement(
            ResourceConnectionClientContext.Provider,
            { value: client },
            app,
          ),
        );
      });
    await render(0);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_INSPECTOR_REQUEST_EVENT, {
          detail: {
            connectionId,
            generation: client.generation,
            view: "files",
            workspaceId: "workspace",
          },
        }),
      );
    });
    const stage = () =>
      document.querySelector<HTMLElement>(".workspace-stage")!;
    expect(stage().className).toContain("is-inspector-expanded");

    // Enter on a found herdr-core agent: Spaces shows its terminal.
    await render(1);
    const found = document.querySelector('[data-found="core"]')!;
    expect(found).not.toBeNull();
    expect(stage().className).not.toContain("is-inspector-expanded");
    expect(stage().className).not.toContain("has-inspector");
    expect(found.closest(".workspace-terminal-surface")).not.toBeNull();
    if (layout === "mobile")
      expect(document.querySelector(".body")?.className ?? "").toContain(
        "mobile-view-session",
      );
    await act(async () => root.unmount());
  });
}
