// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoreNavigationProvider } from "./CoreNavigation";
import { HerdrClientFrame, HerdrMainStage } from "./HerdrClientFrame";
import { coreSurfaceRegistry } from "./surfaceRegistry";

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

describe("collapsed-sidebar theme switcher", () => {
  it("renders only in the closed, non-compact shared stage", async () => {
    const rendered = await renderFrame({ sidebarOpen: true, compact: false });
    expect(themeSwitcher(rendered.container)).toBeNull();

    await rendered.rerender({ sidebarOpen: false, compact: true });
    expect(themeSwitcher(rendered.container)).toBeNull();

    await rendered.rerender({ sidebarOpen: false, compact: false });
    const switcher = themeSwitcher(rendered.container);
    expect(switcher).not.toBeNull();
    expect(switcher?.closest(".stage")).not.toBeNull();
  });

  it("orders and names every destination and identifies the active view", async () => {
    const { container } = await renderFrame({ sidebarOpen: false, compact: false });
    const buttons = themeButtons(container);

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Switch to Spaces",
      "Switch to Office",
      "Switch to Graph",
      "Switch to Tree",
    ]);
    expect(buttons.map((button) => button.title)).toEqual([
      "Spaces",
      "Office",
      "Graph",
      "Tree",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(buttons.map((button, index) => button.querySelector("svg")?.classList.contains([
      "lucide-square-terminal",
      "lucide-building-2",
      "lucide-network",
      "lucide-git-branch",
    ][index]!))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("routes each destination through the existing canonical navigation actions", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const { container } = await renderFrame({ sidebarOpen: false, compact: false });

    for (const [label, url] of [
      ["Switch to Spaces", "/spaces"],
      ["Switch to Office", "/"],
      ["Switch to Graph", "/?theme=graph"],
      ["Switch to Tree", "/?theme=tree"],
    ] as const) {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[aria-label='${label}']`)?.click();
      });
      expect(window.location.pathname + window.location.search).toBe(url);
      expect(
        container.querySelector<HTMLButtonElement>(`[aria-label='${label}']`)
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
    }

    expect(push).toHaveBeenCalledTimes(4);
  });
});

async function renderFrame({ sidebarOpen, compact }: { sidebarOpen: boolean; compact: boolean }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = async (next: { sidebarOpen: boolean; compact: boolean }) => {
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry}>
          <HerdrClientFrame
            style={{}}
            sidebarOpen={next.sidebarOpen}
            notesOpen={false}
            resizingSidebar={false}
            resizingNotes={false}
            resizingNotesList={false}
            compact={next.compact}
            touch={false}
            detail={false}
            primaryView="world"
          >
            <HerdrMainStage label="World Graph">
              <header className="graph-stage-bar">Graph controls</header>
            </HerdrMainStage>
          </HerdrClientFrame>
        </CoreNavigationProvider>,
      );
    });
  };
  await render({ sidebarOpen, compact });
  return { container, rerender: render };
}

function themeSwitcher(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[aria-label='Theme switcher']");
}

function themeButtons(container: HTMLElement) {
  return [...(themeSwitcher(container)?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
}
