/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandDraftContext, createCommandDraftStore } from "./commandDrafts";
import type { TerminalRenderer, TerminalSize } from "./terminalRenderer";
import { TerminalView } from "./TerminalView";
import type { PaneInfo } from "./types";

const MOUNTED_TERMINAL_SIZE: TerminalSize = { cols: 80, rows: 24 };
const REFRESHED_TERMINAL_SIZE: TerminalSize = { cols: 120, rows: 48 };

class FakeTerminalRenderer implements TerminalRenderer {
  readonly refreshedSizes: TerminalSize[] = [];
  private pendingMountCompletion: (() => void) | null = null;

  mount() {
    return new Promise<TerminalSize>((resolve) => {
      this.pendingMountCompletion = () => resolve(MOUNTED_TERMINAL_SIZE);
    });
  }

  completeMount() {
    const complete = this.pendingMountCompletion;
    if (!complete) {
      throw new Error("Fake terminal renderer has no pending mount");
    }
    this.pendingMountCompletion = null;
    complete();
  }

  write() {}

  setAccessibleScreenListener() {}

  onInput() {
    return () => {};
  }

  onScroll() {
    return () => {};
  }

  setTapFocusHandler() {}

  setMobileTouchSelection() {}

  fit() {
    return MOUNTED_TERMINAL_SIZE;
  }

  refreshMetrics() {
    this.refreshedSizes.push(REFRESHED_TERMINAL_SIZE);
    return REFRESHED_TERMINAL_SIZE;
  }

  setFontSize() {
    return null;
  }

  focus() {}

  focusTextInput() {}

  clearSelection() {}

  setScrollSensitivity() {}

  dispose() {}
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  binaryType: BinaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    if (this.readyState !== FakeWebSocket.CONNECTING) {
      throw new Error("Fake WebSocket can only open while connecting");
    }
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("Fake WebSocket cannot send before opening");
    }
    this.sent.push(data);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSING;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

const roots: Root[] = [];
const terminalRenderers: FakeTerminalRenderer[] = [];

function createFakeTerminalRenderer() {
  const renderer = new FakeTerminalRenderer();
  terminalRenderers.push(renderer);
  return renderer;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));

  FakeWebSocket.instances.length = 0;
  terminalRenderers.length = 0;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TerminalView mobile refitting", () => {
  it("starts refit retries only after the current terminal renderer mounts", async () => {
    const drafts = createCommandDraftStore();
    const root = await renderTerminalView(testPane("terminal-1"), drafts);
    const firstRenderer = terminalRenderers[0];
    if (!firstRenderer) {
      throw new Error("Expected the first terminal renderer");
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(firstRenderer.refreshedSizes).toEqual([]);

    await renderPane(root, testPane("terminal-2"), drafts);
    expect(terminalRenderers).toHaveLength(2);
    const currentRenderer = terminalRenderers[1];
    if (!currentRenderer) {
      throw new Error("Expected the current terminal renderer");
    }

    await act(async () => {
      firstRenderer.completeMount();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(firstRenderer.refreshedSizes).toEqual([]);
    expect(currentRenderer.refreshedSizes).toEqual([]);

    await act(async () => {
      currentRenderer.completeMount();
      await Promise.resolve();
    });
    const currentSocket = FakeWebSocket.instances.at(-1);
    if (!currentSocket) {
      throw new Error("Expected a terminal WebSocket");
    }
    expect(currentSocket.readyState).toBe(FakeWebSocket.CONNECTING);
    expect(currentSocket.sent).toEqual([]);
    expect(currentRenderer.refreshedSizes).toEqual([]);

    await act(async () => {
      currentSocket.open();
      await Promise.resolve();
    });
    expect(currentRenderer.refreshedSizes).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(currentRenderer.refreshedSizes).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(520);
    });
    expect(currentRenderer.refreshedSizes).toHaveLength(4);
    expect(currentSocket.sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 120, rows: 48 }));
  });

  it("does not schedule replacement refits from stale terminal readiness", async () => {
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const retryTimerDelays = () =>
      setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay) => delay === 80 || delay === 280 || delay === 520);
    const drafts = createCommandDraftStore();
    const root = await renderTerminalView(testPane("terminal-1"), drafts);
    const firstRenderer = terminalRenderers[0];
    if (!firstRenderer) {
      throw new Error("Expected the first terminal renderer");
    }

    await act(async () => {
      firstRenderer.completeMount();
      await Promise.resolve();
    });
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(retryTimerDelays()).toEqual([80, 280, 520]);

    await renderPane(root, testPane("terminal-2"), drafts);
    const currentRenderer = terminalRenderers[1];
    if (!currentRenderer) {
      throw new Error("Expected the current terminal renderer");
    }

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(retryTimerDelays()).toEqual([80, 280, 520]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(currentRenderer.refreshedSizes).toEqual([]);

    await act(async () => {
      currentRenderer.completeMount();
      await Promise.resolve();
    });
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
    expect(retryTimerDelays()).toEqual([80, 280, 520, 80, 280, 520]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(currentRenderer.refreshedSizes).toHaveLength(1);
  });
});

async function renderTerminalView(
  pane: PaneInfo,
  drafts: ReturnType<typeof createCommandDraftStore>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await renderPane(root, pane, drafts);
  return root;
}

async function renderPane(
  root: Root,
  pane: PaneInfo,
  drafts: ReturnType<typeof createCommandDraftStore>,
) {
  await act(async () => {
    root.render(
      <CommandDraftContext.Provider value={drafts}>
        <TerminalView
          bridgeId="bridge-1"
          pane={pane}
          connectionKey="test-connection"
          resumeToken={0}
          httpUrl={(path) => path}
          wsUrl={(path) => path}
          autoFocus={false}
          mobileControls
          terminalOutputCoalesceMs={0}
          selected
          createTerminalRenderer={createFakeTerminalRenderer}
        />
      </CommandDraftContext.Provider>,
    );
  });
}

function testPane(terminalId: string): PaneInfo {
  return {
    pane_id: "pane-1",
    terminal_id: terminalId,
    workspace_id: "workspace-1",
    tab_id: "tab-1",
    focused: true,
    agent_status: "idle",
    revision: 1,
  };
}
