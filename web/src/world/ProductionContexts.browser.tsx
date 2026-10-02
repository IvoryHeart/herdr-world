import { Profiler } from "react";
import { Application } from "pixi.js";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "../api";
import { TerminalEndpointPresentation } from "../terminalEndpointPresentation";
import { TerminalView } from "../components/TerminalView";
import { PopupOverlay } from "../components/PopupOverlay";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import {
  __storeTesting,
  emptyServerSessionState,
  OperationalContext,
  store,
  useStore,
} from "../store";
import type { Pane, Tab, Workspace } from "../types";
import ConnectedTreeView from "./ConnectedTreeView";
import SpatialGraphView from "./SpatialGraphView";
import PixelOfficeView from "./PixelOfficeView";
import { WorldRuntimeStore } from "./runtimeStore";
import { buildWorldObject, type WorldObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import "./world.css";

const view = new URL(location.href).searchParams.get("view")!;
const failures: string[] = [];
const check = (value: unknown, message: string) => {
  if (!value) failures.push(message);
};
const acknowledgements: {
  id: string;
  phase: string;
  receivedAt: number;
  host: string;
}[] = [];
const phases: Record<string, number> = {};
const parse = JSON.parse;
JSON.parse = function (
  text: string,
  reviver?: (this: any, key: string, value: any) => any,
) {
  const began = performance.now();
  const value = parse(text, reviver);
  if (text.length > 1000000)
    phases["parse-" + (phase ?? "none")] = performance.now() - began;
  return value;
};
let phase: string | null = null,
  paints = 0,
  notices = 0;
let receivedFrames = 0,
  presentedFrames = 0;
bridge.onTerminal((frame) => {
  if (frame.connection_id === "alpha") receivedFrames++;
});
const present = TerminalEndpointPresentation.prototype.update;
TerminalEndpointPresentation.prototype.update = function (...args) {
  presentedFrames++;
  return present.apply(this, args);
};
const pendingInputs = new Set<Promise<unknown>>();
const attached = new Set<string>();
let lastInputRequestId = "";
const socketSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  if (typeof data === "string" && data.length < 10000) {
    const request = JSON.parse(data);
    if (request.method === "terminal.input") lastInputRequestId = request.id;
  }
  return socketSend.call(this, data);
};
// Transparent instrumentation: every call and acknowledgement uses the original
// production Bridge client, socket, lease and JSON admission.
const connection = bridge.connection.bind(bridge);
bridge.connection = (...args) => {
  const client = connection(...args);
  return {
    ...client,
    call(method, params) {
      const ownerPhase = phase;
      const promise = client.call(
        method,
        params,
        method === "terminal.input" ? 5000 : undefined,
      );
      const requestId = lastInputRequestId;
      if (method === "terminal.attach")
        void promise
          .then(() => attached.add(client.connectionId))
          .catch(() => {});
      if (method === "terminal.input" && ownerPhase) {
        const admitted = promise.then(() => {
          acknowledgements.push({
            id: requestId,
            phase: ownerPhase,
            receivedAt: Date.now(),
            host: client.connectionId,
          });
        });
        pendingInputs.add(admitted);
        void admitted
          .finally(() => pendingInputs.delete(admitted))
          .catch(() => {});
      }
      return promise;
    },
  } as ConnectionClient;
};
for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
  const clear = context.prototype.clear;
  context.prototype.clear = function (mask: number) {
    if (
      this.canvas instanceof HTMLCanvasElement &&
      this.canvas.closest("[data-scene]")
    )
      paints++;
    return clear.call(this, mask);
  };
}
const applicationRender = Application.prototype.render;
Application.prototype.render = function () {
  const began = performance.now();
  const result = applicationRender.call(this);
  if (phase)
    phases["paint-" + phase] = Math.max(
      phases["paint-" + phase] ?? 0,
      performance.now() - began,
    );
  return result;
};
const originalClear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function (...args) {
  if (this.canvas.closest("[data-scene]")) paints++;
  return originalClear.apply(this, args);
};
function waitFor(
  condition: () => boolean,
  message: string,
  timeout = 10000,
): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(Error(message));
    }, timeout);
    const observer = new MutationObserver(() => {
      if (condition()) {
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    // Store notices and canvas callbacks do not necessarily mutate DOM.
    const unsubscribe = store.subscribe(() => {
      if (condition()) {
        clearTimeout(timer);
        observer.disconnect();
        unsubscribe();
        resolve();
      }
    });
    setTimeout(unsubscribe, timeout + 1);
  });
}
const frames = async (count = 2) => {
  for (let index = 0; index < count; index++)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
};
const workspace: Workspace = {
  workspace_id: "shared",
  number: 1,
  label: "Synthetic workspace",
  focused: true,
  agent_status: "idle",
  pane_count: 1,
  tab_count: 1,
};
const tab: Tab = {
  workspace_id: "shared",
  tab_id: "shared",
  number: 1,
  label: "Synthetic tab",
  focused: true,
  agent_status: "idle",
  pane_count: 1,
};
const pane: Pane = {
  workspace_id: "shared",
  tab_id: "shared",
  pane_id: "shared",
  terminal_id: "shared",
  focused: true,
  agent_status: "idle",
  revision: 1,
};
function seed(popup = false) {
  const session = () => ({
    ...emptyServerSessionState(7),
    navigationMode: "browser-local" as const,
    workspaces: [workspace],
    tabs: [tab],
    panes: [pane],
    selectedPaneId: "shared",
    layout: {
      workspace_id: "shared",
      tab_id: "shared",
      zoomed: false,
      area: { x: 0, y: 0, width: 80, height: 24 },
      focused_pane_id: "shared",
      panes: [
        {
          pane_id: "shared",
          focused: true,
          rect: { x: 0, y: 0, width: 80, height: 24 },
        },
      ],
      splits: [],
    },
  });
  const alpha = session(),
    beta = session();
  if (popup)
    alpha.popup = {
      terminal_id: "popup",
      title: "Synthetic alpha popup",
      width: null,
      height: null,
    };
  __storeTesting.replaceState({
    ...store.get(),
    ...alpha,
    status: "connected",
    connectionPaused: false,
    activeConnectionId: "alpha",
    serverRuntimeGeneration: 7,
    connectionGeneration: store.get().connectionGeneration + 1,
    notice: null,
    connections: [
      "alpha",
      "beta",
      ...Array.from({ length: 62 }, (_, index) => "synthetic-" + index),
    ].map((id) => ({
      id,
      label: "Synthetic " + id,
      source: "fixture",
      is_default: id === "alpha",
      state: "ready" as const,
      generation: 7,
    })),
    sessionsByConnectionId: { alpha, beta },
  });
}
function Notice() {
  const state = useStore();
  return (
    <output role="status">
      {state.notice?.message} {state.notice?.detail}
    </output>
  );
}
function Terminals({ revision }: { revision: number }) {
  return (
    <>
      <Notice />
      {["alpha", "beta"].map((host) => (
        <OperationalContext.Provider
          key={host + revision}
          value={{ connectionId: host, runtimeGeneration: 7 }}
        >
          <section
            data-host={host}
            style={{ width: "min(450px, 100vw)", height: 320 }}
          >
            <TerminalView
              paneId="shared"
              terminalTheme={{}}
              terminalFontScale={1}
              showMobileKeys={false}
            />
          </section>
          <PopupOverlay terminalTheme={{}} terminalFontScale={1} />
        </OperationalContext.Provider>
      ))}
    </>
  );
}
async function connect() {
  const ready = Promise.withResolvers<void>();
  const off = bridge.onStatus((status) => {
    if (status === "connected") ready.resolve();
  });
  bridge.connect();
  await ready.promise;
  off();
}
function input(selector: string, key: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(selector)!;
  textarea.focus();
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: "Key" + key.toUpperCase(),
      keyCode: key.toUpperCase().charCodeAt(0),
      which: key.toUpperCase().charCodeAt(0),
      bubbles: true,
    }),
  );
}
async function run() {
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  await connect();
  seed();
  const terminals = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  terminals.render(<Terminals revision={0} />);
  await waitFor(
    () => document.querySelectorAll(".xterm-helper-textarea").length === 2,
    "Terminals not mounted",
  );
  await waitFor(
    () => attached.has("alpha") && attached.has("beta"),
    "Both terminal attachments were not admitted",
  );
  await frames(4);
  if (view === "uncertain") {
    for (const [revision, kind] of [
      new URL(location.href).searchParams.get("entry")!,
    ].entries()) {
      if (kind === "popup") {
        seed(true);
        terminals.render(<Terminals revision={1} />);
        await frames(6);
      }
      await fetch("/drop-next");
      if (kind === "fallback") {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-host="alpha"] .xterm-helper-textarea',
        )!;
        textarea.focus();
        // A cancellable punctuation beforeinput is handled by TerminalView's
        // explicit textarea fallback/sendText path, without xterm onData.
        textarea.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: "。",
            cancelable: true,
            bubbles: true,
          }),
        );
      } else
        input(
          kind === "popup"
            ? ".popup-overlay-backdrop .xterm-helper-textarea"
            : '[data-host="alpha"] .xterm-helper-textarea',
          "a",
        );
      await waitFor(
        () => !!store.get().notice?.message.includes("uncertain"),
        kind + " input has no visible uncertainty notice",
        3000,
      );
      notices++;
      check(
        document
          .querySelector("output")
          ?.textContent?.includes("Synthetic alpha"),
        kind + " notice lost original owner",
      );
      check(
        store.get().notice?.detail?.toLowerCase().includes("refresh"),
        kind + " notice lacks refresh-before-retry",
      );
      check(
        !store.get().notice?.actionPaneId,
        kind + " notice exposes replacement navigation",
      );
      bridge.disconnect();
      await connect();
      seed();
      terminals.render(<Terminals revision={revision + 100} />);
      await frames(6);
      await bridge
        .connection("beta", 7)
        .call("terminal.input", { terminal_id: "shared", data: btoa("b") });
      check(
        bridge.connection("beta", 7).isCurrent(),
        "Sibling unavailable after reconnect",
      );
      bridge.disconnect();
    }
  } else {
    const runtime = new WorldRuntimeStore(bridge);
    const scene = document.body.appendChild(document.createElement("div"));
    scene.dataset.scene = view;
    scene.className = "world-stage-scroll";
    scene.style.cssText = "width:100%;height:700px;position:relative";
    const root = createRoot(scene);
    const render = root.render.bind(root);
    root.render = (node) =>
      render(
        <Profiler
          id={view}
          onRender={(_id, _renderPhase, duration) => {
            if (phase)
              phases["react-" + phase] = Math.max(
                phases["react-" + phase] ?? 0,
                duration,
              );
          }}
        >
          {node}
        </Profiler>,
      );
    for (const stage of ["initial", "refresh"]) {
      phase = stage;
      await fetch("/input-ready?phase=" + stage);
      const began = performance.now();
      await runtime.refresh();
      const world: WorldObject = buildWorldObject(runtime.get().connections);
      check(world.hosts.length === 64, "Actual Bridge lost catalogue roots");
      if (stage === "refresh") {
        check(
          runtime.get().connections.filter((connection) => connection.stale)
            .length === 3,
          "Stalled owners did not retain stale cached coverage",
        );
        check(
          world.leaves
            .filter((leaf) => leaf.connectionId === "alpha")
            .some((leaf) => leaf.status === "working"),
          "Attention refresh was not observed",
        );
      }
      const selectedId = world.leaves[0]?.id ?? null;
      let anchored = false;
      if (view === "tree")
        root.render(
          <ConnectedTreeView
            world={world}
            selectedId={selectedId}
            conversationNodeIds={[]}
            inlineInspectorNodeId={null}
            onSelect={() => {}}
            onOpenTerminal={async () => {}}
            onSelectedAnchorChange={(anchor) => {
              anchored = !!anchor;
            }}
            onNodeAnchorsChange={() => {}}
            onInlineInspectorPortalChange={() => {}}
          />,
        );
      if (view === "graph")
        root.render(
          <SpatialGraphView
            world={world}
            selectedId={selectedId}
            conversationNodeIds={selectedId ? [selectedId] : []}
            onSelect={() => {}}
            onOpenTerminal={async () => {}}
            onSelectedAnchorChange={(anchor) => {
              anchored = !!anchor;
            }}
            onNodeAnchorsChange={() => {}}
          />,
        );
      if (view === "office")
        root.render(
          <PixelOfficeView
            world={world}
            selectedId={selectedId}
            floatingTerminals={selectedId ? [{ nodeId: selectedId }] : []}
            onSelect={async () => true}
            onOpenTerminal={async () => {}}
            onSelectedAnchorChange={(anchor) => {
              anchored = !!anchor;
            }}
            onConversationNodeAnchorsChange={() => {}}
          />,
        );
      await frames(4);
      if (view === "tree")
        await waitFor(
          () =>
            !!scene.querySelector(
              '.world-connected-tree-shell[aria-busy="false"]',
            ),
          "Tree did not finish progressive mount",
        );
      if (view === "office")
        await waitFor(
          () =>
            !!scene.querySelector(
              '.world-semantic-targets-overlay[aria-busy="false"]',
            ),
          "Office did not finish progressive controls",
        );
      if (view === "graph")
        await waitFor(
          () =>
            !!scene.querySelector(
              '.world-spatial-graph-shell[aria-busy="false"]',
            ),
          "Graph did not finish progressive mount",
        );
      // Keep input and real pushes running throughout layout, canvas paints and
      // a bounded graph simulation window, rather than stopping at first DOM.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await frames(4);
      check(anchored, view + " did not publish its selected rendered anchor");
      phases[stage] = performance.now() - began;
      const { count } = await (
        await fetch("/input-complete?phase=" + stage)
      ).json();
      await Promise.all([...pendingInputs]);
      check(
        acknowledgements.filter((ack) => ack.phase === stage).length === count,
        "Missing admitted input acknowledgement",
      );
      phase = null;
    }
    root.unmount();
    runtime.stop();
  }
  terminals.unmount();
  bridge.disconnect();
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({
      failures,
      acknowledgements,
      phases,
      paints,
      notices,
      receivedFrames,
      presentedFrames,
    }),
  });
}
void run().catch(async (error) => {
  failures.push(String(error));
  bridge.disconnect();
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify({
      failures,
      acknowledgements,
      phases,
      paints,
      notices,
      receivedFrames,
      presentedFrames,
    }),
  });
});
