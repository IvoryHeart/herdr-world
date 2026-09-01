// @vitest-environment jsdom

import { act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorldConversationLayout, WorldConversationLayer } from "./WorldConversationLayer";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("WorldConversationLayer", () => {
  it("publishes a new panel rect only after its default geometry is rendered", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1440);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let positionedLayoutCommitted = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("world-theme-layer")) {
        return new DOMRect(0, 0, 1440, 900);
      }
      if (this.classList.contains("world-conversation-slot")) {
        const positioned = this.dataset.positioned === "true" && positionedLayoutCommitted;
        return new DOMRect(
          positioned ? Number.parseFloat(this.style.left) : 240,
          positioned ? Number.parseFloat(this.style.top) : 180,
          positioned ? Number.parseFloat(this.style.width) : 960,
          positioned ? Number.parseFloat(this.style.height) : 540,
        );
      }
      return new DOMRect();
    });
    const publishedLefts: number[] = [];
    function LayoutProbe() {
      const { rects } = useWorldConversationLayout();
      useLayoutEffect(() => {
        const rect = rects["conversation-1"];
        if (rect) publishedLefts.push(rect.left);
      }, [rects]);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(
      <WorldConversationLayer
        activeThemeId="graph"
        panels={[{
          id: "conversation-1",
          targetKey: "pane-1",
          selectedKey: "pane-1",
          content: <div>terminal</div>,
        }]}
        compact={false}
        onFocus={() => {}}
        onClose={() => {}}
      >
        <LayoutProbe />
      </WorldConversationLayer>,
    ));

    expect(container.querySelector(".world-conversation-slot")?.getAttribute("data-positioned"))
      .toBe("true");
    expect(publishedLefts).toEqual([]);
    expect(animationFrames).toHaveLength(1);

    await act(async () => {
      animationFrames.shift()?.(performance.now());
    });
    expect(publishedLefts).toEqual([]);
    expect(animationFrames).toHaveLength(1);

    positionedLayoutCommitted = true;
    await act(async () => {
      animationFrames.shift()?.(performance.now());
    });

    expect(publishedLefts).toEqual([468]);
  });

  it("preserves the conversation owner and resize affordance across theme changes", async () => {
    const lifecycle = { mounts: 0, unmounts: 0 };
    function TerminalProbe() {
      useEffect(() => {
        lifecycle.mounts += 1;
        return () => { lifecycle.unmounts += 1; };
      }, []);
      return <div data-testid="terminal-probe">terminal</div>;
    }
    const panel = {
      id: "conversation-1",
      targetKey: "pane-1",
      selectedKey: "pane-1",
      content: <TerminalProbe />,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <WorldConversationLayer
          activeThemeId="office"
          panels={[panel]}
          compact={false}
          onFocus={() => {}}
          onClose={() => {}}
        >
          <main>Office</main>
        </WorldConversationLayer>,
      );
    });
    const terminal = container.querySelector("[data-testid='terminal-probe']");
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
    expect(container.querySelector("[aria-label='Resize agent conversation']")).not.toBeNull();

    await act(async () => {
      root.render(
        <WorldConversationLayer
          activeThemeId="graph"
          panels={[{ ...panel, content: <TerminalProbe /> }]}
          compact={false}
          onFocus={() => {}}
          onClose={() => {}}
        >
          <main>Graph</main>
        </WorldConversationLayer>,
      );
    });

    expect(container.textContent).toContain("Graph");
    expect(container.querySelector("[data-testid='terminal-probe']")).toBe(terminal);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
    expect(container.querySelector("[aria-label='Resize agent conversation']")).not.toBeNull();
    expect(terminal?.parentElement?.classList.contains("graph-conversation-slot")).toBe(true);
  });
});
