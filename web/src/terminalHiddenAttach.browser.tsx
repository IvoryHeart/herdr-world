// A terminal that is not shown (World parks the selected pane's terminal for
// creation readiness; a window on Chat hides its terminal) must not resize
// the Herdr pane: Herdr applies every attach's size for every viewer. Once
// shown, the terminal fits its container and resizes as before.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge, type ConnectionClient, type TerminalPush } from "./api";
import { __storeTesting, store, type State } from "./store";
import { TerminalView } from "./components/TerminalView";
import type { Pane, PaneLayout } from "./types";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout/app.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const until = async (condition: () => boolean, message: string) => {
  const deadline = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${message}`);
    await frame();
  }
};

const calls: { method: string; params: Record<string, unknown> }[] = [];
// What Herdr answers to `pane.layout` in the current scenario.
let paneLayoutReply: () => Promise<unknown> = async () => ({});
let clientCurrent = true;
const client: ConnectionClient = {
  connectionId: "hidden-attach-test",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => clientCurrent,
  acceptsServerGeneration: () => true,
  call: async (method, params = {}) => {
    calls.push({ method, params: params as Record<string, unknown> });
    if (method === "pane.layout") return paneLayoutReply();
    // An endpoint attach advertises pane focus, which claims the size.
    if (method === "terminal.attach")
      return { endpoint: { methods: ["pane.focus"], capabilities: [] } };
    return {};
  },
};
let current = client;
bridge.connection = () => current;
const terminalListeners = new Set<(frame: TerminalPush) => void>();
bridge.onTerminal = (listener) => {
  terminalListeners.add(listener);
  return () => terminalListeners.delete(listener);
};
/** A frame from Herdr at the terminal's actual size. */
const push = (width: number, height: number) =>
  flushSync(() => {
    for (const listener of terminalListeners)
      listener({
        connection_id: client.connectionId,
        connection_generation: 1,
        terminal_id: pane.terminal_id,
        width,
        height,
        full: true,
        mouse_reporting: false,
        bytes: btoa("x"),
      });
  });

const pane: Pane = {
  pane_id: "pane",
  terminal_id: "terminal",
  workspace_id: "workspace",
  tab_id: "tab",
  focused: true,
  agent_status: "idle",
  revision: 1,
};
// Herdr's current geometry: another viewer sized the tab to 160×45.
const layout: PaneLayout = {
  workspace_id: pane.workspace_id,
  tab_id: pane.tab_id,
  zoomed: false,
  splits: [],
  area: { x: 0, y: 0, width: 160, height: 45 },
  focused_pane_id: pane.pane_id,
  panes: [
    {
      pane_id: pane.pane_id,
      focused: true,
      rect: { x: 0, y: 0, width: 160, height: 45 },
    },
  ],
};

const host = document.createElement("div");
host.className = "workspace-terminal-surface";
// Parked like `.world-terminal-parking`: mounted, but not displayed.
host.style.cssText = "position:fixed;inset:0;display:none";
document.body.append(host);
const root = createRoot(host);
const of = (method: string) => calls.filter((call) => call.method === method);

const sized = (width: number, height: number): PaneLayout => ({
  ...layout,
  area: { x: 0, y: 0, width, height },
  panes: [{ ...layout.panes[0]!, rect: { x: 0, y: 0, width, height } }],
});
let mountId = 0;
const mountHidden = (storeLayout: PaneLayout | null) => {
  calls.length = 0;
  mountId += 1;
  host.style.cssText = "position:fixed;inset:0;display:none";
  flushSync(() => {
    __storeTesting.replaceState({
      ...store.get(),
      status: "connected" as const,
      connectionPaused: false,
      activeConnectionId: client.connectionId,
      connectionGeneration: 1,
      serverRuntimeGeneration: 1,
      connections: [
        {
          id: client.connectionId,
          label: "Synthetic terminal",
          source: "test",
          is_default: true,
          state: "ready",
          generation: 1,
        },
      ],
      panes: [pane],
      selectedPaneId: pane.pane_id,
      error: null,
      pendingFocusWorkspaceId: null,
      layout: storeLayout,
    } satisfies State);
    root.render(
      <TerminalView
        key={mountId}
        paneId={pane.pane_id}
        terminalTheme={{ background: "#171922", foreground: "#dddddd" }}
        terminalFontScale={100}
        showMobileKeys={false}
      />,
    );
  });
};
const hiddenAttach = async (label: string) => {
  await until(
    () => of("terminal.attach").length > 0,
    `${label}: hidden attach`,
  ).catch((error) => {
    throw new Error(
      `${error} after ${calls.map((call) => call.method).join(", ")}`,
    );
  });
  return of("terminal.attach")[0]!.params;
};

try {
  // The store has the tab's layout: no read, and the pane keeps its size. A
  // single pane reserves its right-edge column, so the xterm size is 159×45
  // and the tab surface stays exactly 160×45.
  mountHidden(layout);
  let attach = await hiddenAttach("store layout");
  check(
    attach.cols === 159 && attach.rows === 45,
    `hidden attach used the pane's size, got ${attach.cols}×${attach.rows}`,
  );
  check(
    attach.surface_cols === 160 && attach.surface_rows === 45,
    `hidden attach kept the tab surface, got ${attach.surface_cols}×${attach.surface_rows}`,
  );
  check(
    attach.relay_cols === undefined ||
      (attach.relay_cols === 160 && attach.relay_rows === 45),
    `hidden attach kept the relay size, got ${attach.relay_cols}×${attach.relay_rows}`,
  );
  check(of("pane.layout").length === 0, "a known layout was read again");
  for (let index = 0; index < 10; index += 1) await frame();
  check(of("terminal.resize").length === 0, "a hidden terminal sent a resize");

  // The read and failure orderings are unit tests (terminalAttachSize.test.ts);
  // this checks TerminalView wires its own client and pane into them.

  // The transport reconnects while a read is in flight: the old client's
  // read fails as stale, and the retained view attaches again through a
  // healthy client. That client reads the layout itself; the old failure is
  // not its fallback.
  const held = Promise.withResolvers<unknown>();
  paneLayoutReply = () => held.promise;
  mountHidden(null);
  await until(() => of("pane.layout").length === 1, "old client read");
  clientCurrent = false;
  held.reject(new Error("connection changed during request"));
  await frame();
  let replacementReads = 0;
  current = {
    ...client,
    generation: 2,
    isCurrent: () => true,
    call: async (method, params = {}) => {
      calls.push({ method, params: params as Record<string, unknown> });
      if (method !== "pane.layout") return {};
      replacementReads += 1;
      return { layout: sized(160, 45) };
    },
  };
  calls.length = 0;
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      terminalAttachEpoch: store.get().terminalAttachEpoch + 1,
    }),
  );
  attach = await hiddenAttach("replacement client");
  check(
    replacementReads === 1,
    `the replacement client made ${replacementReads} layout reads`,
  );
  check(
    attach.cols === 159 &&
      attach.rows === 45 &&
      attach.surface_cols === 160 &&
      attach.surface_rows === 45,
    `the reconnected hidden attach shrank the pane, got ${attach.cols}×${attach.rows} (${attach.surface_cols}×${attach.surface_rows})`,
  );
  current = client;
  clientCurrent = true;

  // An old World page pinned the pane at 13×1. A (re)loaded hidden view does
  // not adopt that squeeze: it attaches at this browser's last good size.
  mountHidden(sized(13, 1));
  attach = await hiddenAttach("squeezed layout");
  check(
    attach.cols === 159 && attach.rows === 45,
    `a reload re-pinned the squeezed size, got ${attach.cols}×${attach.rows}`,
  );
  for (let index = 0; index < 10; index += 1) await frame();
  calls.length = 0;

  // Shown: it fits its container, resizes the pane to what is visible and
  // then claims that size, so a pane another client squeezed recovers.
  host.style.display = "flex";
  host.style.inset = "auto";
  host.style.width = "60vw";
  host.style.height = "50vh";
  await until(() => of("terminal.resize").length > 0, "shown resize");
  const resizes = of("terminal.resize");
  const resize = resizes[resizes.length - 1]!.params;
  const screen = host.querySelector(".xterm-screen")!.getBoundingClientRect();
  check(
    typeof resize.cols === "number" &&
      typeof resize.rows === "number" &&
      resize.cols < 159 &&
      resize.rows < 45 &&
      resize.cols > 4 &&
      resize.rows > 2,
    `the shown terminal did not fit its container, got ${resize.cols}×${resize.rows}`,
  );
  check(
    screen.width <= host.getBoundingClientRect().width + 1,
    "the shown terminal overflows its container",
  );
  await until(() => of("terminal.focus").length > 0, "shown claim");
  // The claim itself, not a later re-attach (the watchdog's, as frames
  // never arrive here), is what follows the resize.
  const order = calls.map((call) => call.method);
  const claimed = order.indexOf("terminal.focus");
  check(
    order.indexOf("terminal.resize") < claimed &&
      !order.slice(0, claimed).includes("terminal.attach"),
    `the shown terminal did not claim its size: ${order.join(", ")}`,
  );

  // While it stays shown, another client (an older World page) attaches at
  // 13×1: Herdr's frames arrive squeezed. The view claims its size back once,
  // not per frame, and re-arms only after an unsqueezed frame.
  calls.length = 0;
  push(12, 2);
  push(12, 2);
  push(12, 2);
  await frame();
  check(
    of("terminal.focus").length === 1,
    `a shown terminal did not reclaim a squeeze exactly once: ${of("terminal.focus").length}`,
  );
  push(80, 24);
  push(12, 2);
  await frame();
  check(
    of("terminal.focus").length === 2,
    "a later squeeze, after a healthy frame, was not reclaimed",
  );
  push(40, 12);
  await frame();
  check(
    of("terminal.focus").length === 2,
    "a usable smaller size from another viewer was fought over",
  );

  // Hidden now: a background page keeps its geometry, and a container can be
  // hidden before ResizeObserver runs. Neither claims (rev-sol on #650).
  push(80, 24);
  calls.length = 0;
  const visibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  push(12, 2);
  await frame();
  check(of("terminal.focus").length === 0, "a background page claimed");
  if (visibility)
    Object.defineProperty(document, "visibilityState", visibility);
  else delete (document as { visibilityState?: unknown }).visibilityState;
  const shownStyle = host.style.cssText;
  host.style.display = "none";
  push(12, 2);
  await frame();
  check(
    of("terminal.focus").length === 0,
    "a container hidden before ResizeObserver claimed",
  );
  host.style.cssText = shownStyle;
  // Shown again it claims as any reveal does; then the squeeze is still
  // claimed once, since the hidden frames spent nothing.
  await until(() => of("terminal.focus").length > 0, "claim on reveal");
  for (let index = 0; index < 3; index += 1) await frame();
  calls.length = 0;
  push(12, 2);
  await frame();
  check(
    of("terminal.focus").length === 1,
    "a squeeze after being hidden was not claimed",
  );

  // A split tab shown after Chat: every pane fits, but only the selected
  // pane claims, or Herdr's focus (the tab's cursor) lands on the last pane.
  const second: Pane = {
    ...pane,
    pane_id: "pane-2",
    terminal_id: "terminal-2",
    focused: false,
  };
  const splitLayout: PaneLayout = {
    ...layout,
    panes: [
      {
        pane_id: pane.pane_id,
        focused: true,
        rect: { x: 0, y: 0, width: 80, height: 45 },
      },
      {
        pane_id: second.pane_id,
        focused: false,
        rect: { x: 80, y: 0, width: 80, height: 45 },
      },
    ],
  };
  calls.length = 0;
  mountId += 1;
  host.style.cssText = "position:fixed;inset:0;display:none";
  flushSync(() => {
    __storeTesting.replaceState({
      ...store.get(),
      panes: [pane, second],
      selectedPaneId: pane.pane_id,
      layout: splitLayout,
    });
    root.render(
      <>
        {[pane, second].map((view) => (
          <div
            key={`${mountId}-${view.pane_id}`}
            style={{ flex: 1, display: "flex" }}
          >
            <TerminalView
              paneId={view.pane_id}
              terminalTheme={{ background: "#171922", foreground: "#dddddd" }}
              terminalFontScale={100}
              showMobileKeys={false}
            />
          </div>
        ))}
      </>,
    );
  });
  await until(() => of("terminal.attach").length >= 2, "split hidden attaches");
  for (let index = 0; index < 10; index += 1) await frame();
  calls.length = 0;
  host.style.cssText =
    "position:fixed;inset:0;display:flex;width:80vw;height:60vh";
  await until(() => of("terminal.resize").length >= 2, "split shown resizes");
  for (let index = 0; index < 10; index += 1) await frame();
  const claims = of("terminal.focus").map((call) => call.params.terminal_id);
  check(
    claims.length === 1 && claims[0] === pane.terminal_id,
    `a shown split claimed for ${JSON.stringify(claims)}, not only the selected pane`,
  );
} catch (error) {
  failures.push(String(error));
} finally {
  flushSync(() => root.unmount());
  await fetch("/result", { method: "POST", body: JSON.stringify(failures) });
}
