// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorldConversationLayer } from "./WorldConversationLayer";

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
