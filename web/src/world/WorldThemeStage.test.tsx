// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoreNavigationProvider } from "../CoreNavigation";
import { coreSurfaceRegistry } from "../surfaceRegistry";
import { WorldThemeOutlet } from "./WorldThemeStage";
import { WorldThemeRegistry } from "./worldThemeRegistry";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/?theme=graph");
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("World theme failure containment", () => {
  it("keeps the shell alive and returns to Office after a Graph chunk failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const themes = new WorldThemeRegistry([
      {
        id: "office",
        label: "Office",
        semanticIcon: "office",
        load: async () => ({ default: () => <main>Office survived</main> }),
      },
      {
        id: "graph",
        label: "Graph",
        semanticIcon: "graph",
        load: async () => { throw new Error("chunk unavailable"); },
      },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry} themeRegistry={themes}>
          <div data-testid="persistent-shell">Runtime observation remains mounted</div>
          <WorldThemeOutlet themeRegistry={themes} />
        </CoreNavigationProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Graph unavailable");
    expect(container.textContent).toContain("Runtime observation remains mounted");
    const recover = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Return to Office");
    await act(async () => {
      recover?.click();
      await Promise.resolve();
    });
    expect(window.location.pathname + window.location.search).toBe("/");
    expect(container.textContent).toContain("Office survived");
    expect(container.textContent).toContain("Runtime observation remains mounted");
  });
});
