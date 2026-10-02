import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { decodeWorldSnapshot } from "../worldSnapshotDecode";
import {
  bridge,
  type ConnectionClient,
  type TerminalClipboardPush,
  type TerminalPush,
} from "../api";
import { PopupOverlay } from "../components/PopupOverlay";
import { TerminalView } from "../components/TerminalView";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import {
  __storeTesting,
  emptyServerSessionState,
  OperationalContext,
  store,
} from "../store";
import type { Pane, PaneLayout, Tab, Workspace } from "../types";
import ConnectedTreeView from "./ConnectedTreeView";
import { projectWorldGraph } from "./graph/graphProjection";
import {
  prepareWorldOffice,
  projectWorldOffice,
} from "./herdrOfficeProjection";
import { parseWorldSnapshotResult } from "./runtimeStore";
import { projectWorldTree } from "./treeProjection";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import {
  buildWorldObject,
  prepareWorldObject,
  yieldWorldTask,
} from "./worldObject";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import "./world.css";

const failures: string[] = [];
let alphaRefreshes = 0;
const refreshTerminal = Terminal.prototype.refresh;
Terminal.prototype.refresh = function (...args) {
  if (this.element?.closest('[data-host="alpha"]')) alphaRefreshes++;
  return refreshTerminal.apply(this, args);
};
const measurements = {
  outputFrames: 0,
  outputBytes: 0,
  healthyInputMs: 0,
  snapshotBytes: 0,
  snapshotTransportMs: 0,
  projectionMs: 0,
  renderMs: 0,
  longestTaskMs: 0,
  decodeMs: 0,
  validationMs: 0,
  worldBuildMs: 0,
  worldBuildSliceCount: 0,
  worldBuildMaxSliceNodes: 0,
  worldBuildMaxSliceDurationMs: 0,
  treeProjectionMs: 0,
  graphProjectionMs: 0,
  officeProjectionMs: 0,
};
let stressPhase: string | null = null;
let trustedStressKey = false;
const stressReceipts: {
  phase: string;
  host: string;
  generation: number | null;
  receivedAt: number;
  data: string;
  trusted: boolean;
}[] = [];
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "z") trustedStressKey = event.isTrusted;
  },
  true,
);
const longTasks = new PerformanceObserver((list) => {
  for (const task of list.getEntries())
    measurements.longestTaskMs = Math.max(
      measurements.longestTaskMs,
      task.duration,
    );
});
longTasks.observe({ type: "longtask", buffered: true });
async function beginStress(phase: string) {
  stressPhase = phase;
  await fetch(`/input-ready?phase=${phase}`);
}
async function finishStress() {
  const { count } = await (
    await fetch(`/input-complete?phase=${stressPhase}`)
  ).json();
  await waitForDom(
    () =>
      stressReceipts.filter((receipt) => receipt.phase === stressPhase)
        .length === count,
  );
  stressPhase = null;
}
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const calls: {
  host: string;
  method: string;
  params: Record<string, unknown>;
  stressPhase: string | null;
}[] = [];
const frames = new Set<(push: TerminalPush) => void>();
const clipboards = new Set<(push: TerminalClipboardPush) => void>();
const attached = new Set<string>();
const bothAttached = Promise.withResolvers<void>();
const filesStarted = Promise.withResolvers<void>();
const files = Promise.withResolvers<unknown>();
const inputs = new Map<
  string,
  ReturnType<typeof Promise.withResolvers<void>>
>();
const resizes = new Map<
  string,
  ReturnType<typeof Promise.withResolvers<void>>
>();
const clipboardWrites: string[] = [];
const clipboardWritten = Promise.withResolvers<void>();
const popupClosed = Promise.withResolvers<void>();

const workspace: Workspace = {
  workspace_id: "same-space",
  number: 1,
  label: "Synthetic space",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: "same-tab",
  agent_status: "idle",
  cwd: "/synthetic",
};
const tab: Tab = {
  tab_id: "same-tab",
  workspace_id: workspace.workspace_id,
  number: 1,
  label: "Synthetic tab",
  focused: true,
  pane_count: 1,
  agent_status: "idle",
};
const pane: Pane = {
  pane_id: "same-pane",
  terminal_id: "same-terminal",
  workspace_id: workspace.workspace_id,
  tab_id: tab.tab_id,
  focused: true,
  agent_status: "idle",
  revision: 1,
};
const layout: PaneLayout = {
  workspace_id: workspace.workspace_id,
  tab_id: tab.tab_id,
  zoomed: false,
  area: { x: 0, y: 0, width: 80, height: 24 },
  focused_pane_id: pane.pane_id,
  panes: [
    {
      pane_id: pane.pane_id,
      focused: true,
      rect: { x: 0, y: 0, width: 80, height: 24 },
    },
  ],
  splits: [],
};
const session = () => ({
  ...emptyServerSessionState(7),
  workspaces: [workspace],
  tabs: [tab],
  panes: [pane],
  selectedPaneId: pane.pane_id,
  layout,
});

function client(host: string, generation: number | null): ConnectionClient {
  const current = () =>
    store.get().status === "connected" &&
    store
      .get()
      .connections.some(
        (connection) =>
          connection.id === host &&
          connection.state === "ready" &&
          connection.generation === generation,
      );
  return {
    connectionId: host,
    generation: 2,
    serverRuntimeGeneration: generation,
    isCurrent: current,
    acceptsServerGeneration: (value) => value === generation,
    call: async (method, params = {}) => {
      if (!current()) throw new Error("retired synthetic runtime");
      calls.push({ host, method, params, stressPhase });
      if (method === "terminal.attach") {
        attached.add(host);
        queueMicrotask(() => {
          for (const listener of frames)
            listener({
              connection_id: host,
              connection_generation: 7,
              terminal_id: pane.terminal_id,
              width: Number(params.cols),
              height: Number(params.rows),
              full: true,
              bytes: btoa(`${host}\r\n`),
            });
          if (attached.size === 2) bothAttached.resolve();
        });
        return {
          endpoint: {
            methods: ["pane.focus", "pane.scroll"],
            capabilities: [],
          },
        };
      }
      if (method === "terminal.input") {
        if (stressPhase)
          stressReceipts.push({
            phase: stressPhase,
            host,
            generation,
            receivedAt: Date.now(),
            data: atob(String(params.data)),
            trusted: trustedStressKey,
          });
        inputs.get(host)?.resolve();
      }
      if (method === "popup.close") popupClosed.resolve();
      if (method === "terminal.resize") resizes.get(host)?.resolve();
      if (method === "file.list") {
        filesStarted.resolve();
        return files.promise;
      }
      if (method === "git.diff_summary")
        return {
          workspace_id: workspace.workspace_id,
          entries: [],
          counts: {},
        };
      if (method === "workspace.list") return { workspaces: [workspace] };
      if (method === "tab.list") return { tabs: [tab] };
      if (method === "pane.list") return { panes: [pane] };
      if (method === "pane.layout") return { layout };
      return {};
    },
  };
}

function waitForDom(predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (predicate()) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Synthetic component admission timed out"));
    }, 10_000);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

async function run() {
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  bridge.connection = (host = "alpha", generation = null) =>
    client(host, generation);
  bridge.onTerminal = (listener) => {
    frames.add(listener);
    return () => frames.delete(listener);
  };
  bridge.onTerminalClipboard = (listener) => {
    clipboards.add(listener);
    return () => clipboards.delete(listener);
  };
  bridge.onTerminalClosed = () => () => {};
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        clipboardWrites.push(value);
        clipboardWritten.resolve();
      },
    },
  });
  __storeTesting.replaceState({
    ...store.get(),
    ...session(),
    activeConnectionId: "alpha",
    connectionGeneration: 40,
    status: "connected",
    connectionPaused: false,
    connections: ["alpha", "beta"].map((id) => ({
      id,
      label: id,
      source: "synthetic",
      is_default: id === "alpha",
      state: "ready",
      generation: 7,
    })),
    sessionsByConnectionId: { alpha: session(), beta: session() },
  });
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  const fileHost = document.body.appendChild(document.createElement("div"));
  fileHost.style.cssText =
    "position:fixed;right:0;top:0;width:350px;height:500px";
  const fileConversation: WorldInspectorConversation = {
    nodeId: "alpha-pane",
    connectionId: "alpha",
    runtimeGeneration: 7,
    resourceIdentity: "alpha-files",
    workspaceId: workspace.workspace_id,
    tabId: tab.tab_id,
    paneId: pane.pane_id,
    terminalId: pane.terminal_id,
    label: "Alpha Files",
    hostLabel: "Alpha",
    spaceLabel: workspace.label!,
    context: {
      kind: "terminal",
      label: "Alpha Files",
      locationLabel: "Alpha",
      stateLabel: "Ready",
    },
    availableViews: ["terminal", "files", "changes"],
    view: "files",
    dock: "right",
    expanded: false,
    size: 350,
  };
  root.render(
    <div style={{ display: "flex", flexWrap: "wrap", minHeight: 600 }}>
      {["alpha", "beta"].map((host) => (
        <OperationalContext.Provider
          key={host}
          value={{ connectionId: host, runtimeGeneration: 7 }}
        >
          <section
            data-host={host}
            style={{ width: "min(500px, 100vw)", height: 500 }}
          >
            <TerminalView
              paneId={pane.pane_id}
              terminalTheme={{}}
              terminalFontScale={1}
              showMobileKeys={false}
            />
          </section>
          <PopupOverlay terminalTheme={{}} terminalFontScale={1} />
        </OperationalContext.Provider>
      ))}
      <WorldInspectorConversationView
        conversation={fileConversation}
        target={fileHost}
        floating={false}
        terminalActive={false}
        onChange={() => {}}
        onClose={() => {}}
        onResourceFocus={() => {}}
        onTerminalPortalChange={() => {}}
      />
    </div>,
  );
  await Promise.all([bothAttached.promise, filesStarted.promise]);
  await waitForDom(
    () => document.querySelectorAll(".xterm-helper-textarea").length === 2,
  );
  const alphaMount = document.querySelector('[data-host="alpha"] .xterm');
  const identicalFrame = () => {
    for (const listener of frames)
      listener({
        connection_id: "alpha",
        connection_generation: 7,
        terminal_id: pane.terminal_id,
        width: 1,
        height: 1,
        full: true,
        mouse_reporting: false,
        bytes: btoa("\x1b[H\x1b[2Jsynthetic unchanged surface"),
      });
  };
  identicalFrame();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const stableRefreshes = alphaRefreshes;
  for (let index = 0; index < 8; index++) {
    identicalFrame();
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  check(
    alphaRefreshes === stableRefreshes,
    "identical endpoint surfaces unnecessarily redraw the full terminal",
  );
  const snapshotStart = performance.now();
  const dense = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/dense-snapshot`,
    );
    socket.onmessage = (event) => {
      resolve(String(event.data));
      socket.send("received");
    };
    socket.onerror = () =>
      reject(new Error("same-origin dense snapshot transport failed"));
  });
  measurements.snapshotTransportMs = performance.now() - snapshotStart;
  measurements.snapshotBytes = new TextEncoder().encode(dense).length;
  await beginStress("projection");
  const projectionStart = performance.now();
  const decoded = await decodeWorldSnapshot(
    [dense],
    new AbortController().signal,
  );
  measurements.decodeMs = performance.now() - projectionStart;
  const validationStart = performance.now();
  const observed = parseWorldSnapshotResult(decoded);
  measurements.validationMs = performance.now() - validationStart;
  if (!observed) throw new Error("dense snapshot admission failed");
  const buildStart = performance.now();
  const recordWorldBuildSlice = (
    _checkpoint: string,
    count: number,
    durationMs: number,
  ) => {
    measurements.worldBuildSliceCount += 1;
    measurements.worldBuildMaxSliceNodes = Math.max(
      measurements.worldBuildMaxSliceNodes,
      count,
    );
    measurements.worldBuildMaxSliceDurationMs = Math.max(
      measurements.worldBuildMaxSliceDurationMs,
      durationMs,
    );
  };
  const prepared = await prepareWorldObject(observed.connections, undefined, {
    onWorkSlice: recordWorldBuildSlice,
  });
  if (!prepared) throw new Error("dense world preparation retired");
  await prepareWorldOffice(prepared);
  const world = buildWorldObject(observed.connections);
  measurements.worldBuildMs = performance.now() - buildStart;
  const treeStart = performance.now();
  const tree = projectWorldTree(world);
  measurements.treeProjectionMs = performance.now() - treeStart;
  await yieldWorldTask();
  const graphStart = performance.now();
  const graph = projectWorldGraph(world);
  measurements.graphProjectionMs = performance.now() - graphStart;
  await yieldWorldTask();
  const officeStart = performance.now();
  projectWorldOffice(world, Date.now());
  measurements.officeProjectionMs = performance.now() - officeStart;
  check(world.hosts.length === 64, "dense transport lost catalogue roots");
  check(
    tree.hosts.length === 64 &&
      graph.nodes.filter((node) => node.kind === "host").length === 64,
    "dense projection lost qualified host roots",
  );
  measurements.projectionMs = performance.now() - projectionStart;
  await finishStress();
  const scene = document.createElement("div");
  scene.style.height = "500px";
  document.body.appendChild(scene);
  const denseRoot = createRoot(scene);
  await beginStress("render");
  const renderStart = performance.now();
  denseRoot.render(
    <div data-dense-revision={1}>
      <ConnectedTreeView
        world={world}
        selectedId={null}
        conversationNodeIds={[]}
        inlineInspectorNodeId={null}
        onSelect={() => {}}
        onOpenTerminal={() => {}}
        onInlineInspectorPortalChange={() => {}}
        onSelectedAnchorChange={() => {}}
        onNodeAnchorsChange={() => {}}
      />
    </div>,
  );
  await waitForDom(
    () =>
      !!scene.querySelector('.world-connected-tree-shell[aria-busy="false"]') &&
      !!scene.querySelector("[data-world-node-anchor]"),
  );
  measurements.renderMs = performance.now() - renderStart;
  await finishStress();
  await beginStress("refresh");
  const refreshedConnections = observed.connections.map((connection) => ({
    ...connection,
    snapshot: connection.snapshot && {
      ...connection.snapshot,
      panes: connection.snapshot.panes.map((pane) => ({
        ...pane,
        agent_status: "working" as const,
      })),
    },
  }));
  const refreshedWorld = await prepareWorldObject(
    refreshedConnections,
    undefined,
    {
      onWorkSlice: recordWorldBuildSlice,
    },
  );
  if (!refreshedWorld) throw new Error("dense refresh retired");
  await prepareWorldOffice(refreshedWorld);
  denseRoot.render(
    <div data-dense-revision={2}>
      <ConnectedTreeView
        world={refreshedWorld}
        selectedId={null}
        conversationNodeIds={[]}
        inlineInspectorNodeId={null}
        onSelect={() => {}}
        onOpenTerminal={() => {}}
        onInlineInspectorPortalChange={() => {}}
        onSelectedAnchorChange={() => {}}
        onNodeAnchorsChange={() => {}}
      />
    </div>,
  );
  await yieldWorldTask();
  await waitForDom(
    () =>
      !!scene.querySelector(
        '[data-dense-revision="2"] .world-connected-tree-shell[aria-busy="false"]',
      ),
  );
  await finishStress();
  const attachesBeforeFocus = calls.filter(
    (call) => call.method === "terminal.attach",
  ).length;
  const emitNoise = () => {
    // Keep alpha producing output while real mounted terminal input targets alternate.
    // The native terminal ID intentionally collides with beta's ID.
    for (let index = 0; index < 512; index++) {
      const output = `synthetic noisy alpha ${index}\r\n`;
      measurements.outputFrames++;
      measurements.outputBytes += output.length;
      for (const listener of frames)
        listener({
          connection_id: "alpha",
          connection_generation: 7,
          terminal_id: pane.terminal_id,
          width: 80,
          height: 24,
          full: false,
          bytes: btoa(output),
        });
    }
  };
  await beginStress("noisy-output");
  emitNoise();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await finishStress();
  for (const [turn, host] of ["alpha", "beta", "alpha"].entries()) {
    if (turn > 0) emitNoise();
    const response = Promise.withResolvers<void>();
    inputs.set(host, response);
    const input = document.querySelector<HTMLTextAreaElement>(
      `[data-host="${host}"] .xterm-helper-textarea`,
    )!;
    input.focus();
    const began = performance.now();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        keyCode: 65,
        which: 65,
        bubbles: true,
      }),
    );
    await response.promise;
    if (host === "beta")
      measurements.healthyInputMs = performance.now() - began;
  }
  check(
    calls
      .filter((call) => call.method === "terminal.input" && !call.stressPhase)
      .map((call) => call.host)
      .join(",") === "alpha,beta,alpha",
    "interleaved input crossed hosts",
  );
  store.selectConnection("beta");
  files.resolve({
    workspace_id: workspace.workspace_id,
    root: "/synthetic",
    checkout_path: "/synthetic",
    path: "",
    entries: [
      {
        name: "alpha.txt",
        path: "alpha.txt",
        type: "file",
        size: 1,
        mtime_ms: 1,
        hidden: false,
      },
    ],
    truncated: false,
  });
  await waitForDom(
    () => document.body.textContent?.includes("alpha.txt") ?? false,
  );
  check(
    document.querySelector('[data-host="alpha"] .xterm') === alphaMount,
    "sibling focus remounted alpha terminal",
  );
  check(
    calls
      .filter((call) => call.method === "file.list")
      .every((call) => call.host === "alpha"),
    "Files followed sibling focus",
  );
  check(
    calls.filter((call) => call.method === "terminal.attach").length ===
      attachesBeforeFocus,
    "focus change reattached a live terminal",
  );
  document
    .querySelector<HTMLTextAreaElement>(
      '[data-host="beta"] .xterm-helper-textarea',
    )!
    .focus();
  for (const listener of clipboards) {
    listener({
      connection_id: "beta",
      connection_generation: 6,
      terminal_id: pane.terminal_id,
      data: btoa("retired"),
    });
    listener({
      connection_id: "beta",
      connection_generation: 7,
      terminal_id: pane.terminal_id,
      data: btoa("beta clipboard"),
    });
  }
  await clipboardWritten.promise;
  check(
    clipboardWrites.join(",") === "beta clipboard",
    "clipboard accepted a retired or sibling stream",
  );
  const popupSnapshot = store.get();
  __storeTesting.replaceState({
    ...popupSnapshot,
    sessionsByConnectionId: {
      ...popupSnapshot.sessionsByConnectionId,
      alpha: {
        ...popupSnapshot.sessionsByConnectionId.alpha,
        popup: {
          terminal_id: "synthetic-popup",
          title: "Alpha popup",
          width: null,
          height: null,
        },
      },
    },
  });
  await waitForDom(
    () => document.body.textContent?.includes("Alpha popup") ?? false,
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close popup"]')!
    .click();
  await popupClosed.promise;
  check(
    calls
      .filter((call) => call.method === "popup.close")
      .every((call) => call.host === "alpha"),
    "popup close followed beta focus",
  );
  const popupCleared = store.get();
  __storeTesting.replaceState({
    ...popupCleared,
    sessionsByConnectionId: {
      ...popupCleared.sessionsByConnectionId,
      alpha: { ...popupCleared.sessionsByConnectionId.alpha, popup: null },
    },
  });
  const resize = Promise.withResolvers<void>();
  resizes.set("beta", resize);
  document.querySelector<HTMLElement>('[data-host="beta"]')!.style.width =
    "400px";
  await resize.promise;
  const betaBefore = calls.filter(
    (call) => call.method === "terminal.input" && call.host === "beta",
  ).length;
  const retirementStartedAt = calls.length;
  __storeTesting.applyCatalog(
    store
      .get()
      .connections.map((connection) =>
        connection.id === "alpha"
          ? { ...connection, generation: 8 }
          : connection,
      ),
    "alpha",
  );
  const response = Promise.withResolvers<void>();
  inputs.set("beta", response);
  const input = document.querySelector<HTMLTextAreaElement>(
    '[data-host="beta"] .xterm-helper-textarea',
  )!;
  input.focus();
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      keyCode: 66,
      which: 66,
      bubbles: true,
    }),
  );
  await response.promise;
  check(
    calls.filter(
      (call) => call.method === "terminal.input" && call.host === "beta",
    ).length ===
      betaBefore + 1,
    "alpha replacement interrupted beta input",
  );
  check(
    !calls
      .slice(retirementStartedAt)
      .some(
        (call) => call.host === "alpha" && call.method === "terminal.detach",
      ),
    "retired alpha detached replacement runtime",
  );
  const beforeDisconnect = calls.filter(
    (call) => call.method === "terminal.input",
  ).length;
  const oldBeta = document.querySelector<HTMLTextAreaElement>(
    '[data-host="beta"] .xterm-helper-textarea',
  );
  __storeTesting.replaceState({ ...store.get(), status: "disconnected" });
  oldBeta?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      keyCode: 88,
      which: 88,
      bubbles: true,
    }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  check(
    calls.filter((call) => call.method === "terminal.input").length ===
      beforeDisconnect,
    "whole-World disconnect dispatched retained terminal input",
  );
  root.unmount();
  denseRoot.unmount();
  scene.remove();
  fileHost.remove();
}

void run()
  .catch((error) =>
    failures.push(error instanceof Error ? error.message : String(error)),
  )
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify({ failures, measurements, stressReceipts }),
    }),
  );
