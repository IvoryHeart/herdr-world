/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandDraftContext, createCommandDraftStore } from "./commandDrafts";
import { TerminalView } from "./TerminalView";

const renderer = vi.hoisted(() => ({
  mount: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  fit: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  refreshMetrics: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  clearSelection: vi.fn(),
  setFontSize: vi.fn(),
  setScrollSensitivity: vi.fn(),
  setTapFocusHandler: vi.fn(),
  setMobileTouchSelection: vi.fn(),
  setAccessibleScreenListener: vi.fn(),
  onInput: vi.fn(),
  onScroll: vi.fn(),
}));
vi.mock("./terminalRenderer", () => ({
  GhosttyRenderer: class { constructor() { return renderer; } },
}));
vi.mock("./native", () => ({ addNativeResumeHandler: () => () => {} }));

class TestSocket extends EventTarget {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    super();
    TestSocket.instances.push(this);
  }
}
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  TestSocket.instances = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps Backspace repeating while screen-reader output rerenders the terminal", async () => {
  await act(async () => root.render(
    <CommandDraftContext.Provider value={createCommandDraftStore()}>
      <TerminalView bridgeId="bridge" connectionKey="bridge" resumeToken={0}
        pane={{ pane_id: "pane", terminal_id: "terminal", workspace_id: "workspace",
          tab_id: "tab", focused: true, agent_status: "idle", revision: 1 }}
        httpUrl={(path) => `http://localhost${path}`}
        wsUrl={(path) => `ws://localhost${path}`}
        mobileControls terminalScreenReaderText autoFocus={false} />
    </CommandDraftContext.Provider>,
  ));
  const socket = TestSocket.instances.at(-1)!;
  await act(async () => socket.dispatchEvent(new Event("open")));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show more keys"]')!.click());
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Send Backspace"]')!;
  expect(button.disabled).toBe(false);
  button.setPointerCapture = vi.fn();
  const outputListener = renderer.setAccessibleScreenListener.mock.calls.at(-1)![0] as (text: string) => void;
  const inputs = () => socket.send.mock.calls
    .map(([data]) => JSON.parse(data as string) as { type: string; data?: string })
    .filter((frame) => frame.type === "input");
  await act(async () => button.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0,
  })));
  expect(inputs()).toEqual([{ type: "input", data: "\x7F" }]);
  await act(async () => outputListener("output after first key"));
  await act(async () => vi.advanceTimersByTime(400));
  await act(async () => outputListener("output after second key"));
  await act(async () => vi.advanceTimersByTime(120));
  expect(inputs()).toHaveLength(4);
  await act(async () => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(inputs()).toHaveLength(4);
});
