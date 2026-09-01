// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CoreNavigationProvider,
  resolveCoreRoute,
  useCoreNavigation,
} from "./CoreNavigation";
import { coreSurfaceRegistry } from "./surfaceRegistry";
import { worldThemeRegistry } from "./world/worldThemeRegistry";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/");
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("core route contract", () => {
  it.each([
    ["/", "", "world", "office", "/", false],
    ["/", "?theme=office", "world", "office", "/", true],
    ["/", "?theme=graph", "world", "graph", "/?theme=graph", false],
    ["/spaces", "", "spaces", "office", "/spaces", false],
    ["/world", "", "world", "office", "/", true],
    ["/world", "?theme=graph", "world", "graph", "/?theme=graph", true],
    ["/missing", "?theme=graph", "world", "office", "/", true],
    ["/", "?theme=mindcraft", "world", "office", "/", true],
    ["/", "?theme=unknown", "world", "office", "/", true],
  ])(
    "%s%s resolves to %s/%s",
    (pathname, search, surfaceId, worldThemeId, canonicalUrl, needsReplace) => {
      expect(resolveCoreRoute(
        coreSurfaceRegistry,
        worldThemeRegistry,
        pathname,
        search,
      )).toEqual({ surfaceId, worldThemeId, canonicalUrl, needsReplace });
    },
  );

  it("adds one entry per user destination, makes active destinations no-ops, and restores history", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry}>
          <NavigationHarness />
        </CoreNavigationProvider>,
      );
    });

    expect(container.querySelector("output")?.textContent).toBe("world:office");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-theme='graph']")?.click());
    expect(window.location.pathname + window.location.search).toBe("/?theme=graph");
    expect(container.querySelector("output")?.textContent).toBe("world:graph");
    expect(push).toHaveBeenCalledTimes(1);

    await act(async () => container.querySelector<HTMLButtonElement>("[data-theme='graph']")?.click());
    expect(push).toHaveBeenCalledTimes(1);

    await act(async () => container.querySelector<HTMLButtonElement>("[data-surface='spaces']")?.click());
    expect(window.location.pathname).toBe("/spaces");
    expect(container.querySelector("output")?.textContent).toBe("spaces:graph");
    expect(push).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.history.back();
      await popstate();
    });
    expect(window.location.pathname + window.location.search).toBe("/?theme=graph");
    expect(container.querySelector("output")?.textContent).toBe("world:graph");

    await act(async () => {
      window.history.back();
      await popstate();
    });
    expect(window.location.pathname + window.location.search).toBe("/");
    expect(container.querySelector("output")?.textContent).toBe("world:office");
  });

  it("canonicalizes the compatibility alias with replacement", async () => {
    window.history.replaceState({}, "", "/world?theme=graph");
    const replace = vi.spyOn(window.history, "replaceState");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry}>
          <NavigationHarness />
        </CoreNavigationProvider>,
      );
    });
    expect(window.location.pathname + window.location.search).toBe("/?theme=graph");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("world:graph");
  });

  it("composes caller-owned state into the single theme history entry", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry}>
          <NavigationHarness />
        </CoreNavigationProvider>,
      );
    });

    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-theme-state='graph']")?.click()
    );

    expect(push).toHaveBeenCalledTimes(1);
    expect(window.history.state).toMatchObject({
      __herdrWorldTheme: "graph",
      callerMarker: "detail",
    });
  });
});

function NavigationHarness() {
  const navigation = useCoreNavigation();
  return (
    <>
      <output>{navigation.activeSurface.id}:{navigation.activeWorldTheme.id}</output>
      <button data-theme="graph" onClick={() => navigation.navigateWorldTheme("graph")}>Graph</button>
      <button
        data-theme-state="graph"
        onClick={() => navigation.navigateWorldTheme("graph", { callerMarker: "detail" })}
      >
        Graph with state
      </button>
      <button data-surface="spaces" onClick={() => navigation.navigate("spaces")}>Spaces</button>
    </>
  );
}

function popstate() {
  return new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
}
