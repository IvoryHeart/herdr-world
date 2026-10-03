import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import type { Pane, Tab, Workspace } from "../types";
import ConnectedTreeView from "./ConnectedTreeView";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { TREE_PREFERENCES_KEY } from "./treePreferences";
import { buildWorldObject, worldObjectForConnection } from "./worldObject";
import "./world.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(condition: () => boolean, message: string) {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(message);
}

function hasAnchor(root: ParentNode, id: string) {
  return [
    ...root.querySelectorAll<HTMLElement>("[data-world-node-anchor]"),
  ].some((element) => element.dataset.worldNodeAnchor === id);
}

function enterSearch(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function collapsedIds() {
  return JSON.parse(worldLocalStorage.getItem(TREE_PREFERENCES_KEY) ?? "{}")
    .collapsedIds as string[] | undefined;
}

function connection(
  connectionId: string,
  label: string,
): WorldRuntimeConnection {
  const workspace: Workspace = {
    workspace_id: "studio",
    number: 1,
    label: "Platform Studio",
    focused: true,
    pane_count: 2,
    tab_count: 1,
    active_tab_id: "delivery",
    agent_status: "working",
  };
  const tab: Tab = {
    tab_id: "delivery",
    workspace_id: "studio",
    number: 1,
    label: "Delivery",
    focused: true,
    pane_count: 2,
    agent_status: "working",
  };
  const panes: Pane[] = [
    {
      pane_id: "builder",
      terminal_id: "terminal-builder",
      workspace_id: "studio",
      tab_id: "delivery",
      focused: true,
      agent: "Codex",
      agent_status: "working",
      task_summary: "Running release checks",
      revision: 1,
    },
    {
      pane_id: "shell",
      terminal_id: "terminal-shell",
      workspace_id: "studio",
      tab_id: "delivery",
      focused: false,
      agent_status: "idle",
      revision: 1,
    },
  ];
  return {
    connectionId,
    label,
    source: "saved-profile",
    isDefault: connectionId === "local",
    state: "ready",
    generation: 4,
    snapshotGeneration: 4,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs: [tab], panes, agents: [] },
  };
}

async function run() {
  worldLocalStorage.removeItem(TREE_PREFERENCES_KEY);
  document.body.style.margin = "0";
  const host = document.createElement("main");
  host.style.cssText = "width:100vw;height:100vh;overflow:hidden";
  document.body.append(host);
  const root = createRoot(host);
  const aggregateWorld = buildWorldObject(
    [connection("local", "Forge"), connection("remote", "Review host")],
    "local",
  );
  const world = worldObjectForConnection(aggregateWorld, "local");
  const agent = world.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "agent",
  )!;
  const terminal = world.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "terminal",
  )!;
  const inactiveTerminal = aggregateWorld.leaves.find(
    (node) => node.connectionId === "remote" && node.kind === "terminal",
  )!;
  const inactiveHost = aggregateWorld.hosts.find(
    (node) => node.connectionId === "remote",
  )!;
  const worldHost = world.hosts[0]!;
  let terminalOpens = 0;
  let selectedAnchor = false;
  let conversationAnchor = false;
  let setInlineInspectorNodeId: (id: string | null) => void = () => {};

  function Fixture() {
    const [selectedId, setSelectedId] = useState<string | null>(agent.id);
    const [inlineInspectorNodeId, setInlineInspector] = useState<string | null>(
      null,
    );
    setInlineInspectorNodeId = setInlineInspector;
    return (
      <ConnectedTreeView
        world={world}
        selectedId={selectedId}
        conversationNodeIds={[terminal.id]}
        inlineInspectorNodeId={inlineInspectorNodeId}
        onSelect={setSelectedId}
        onOpenTerminal={() => {
          terminalOpens += 1;
        }}
        onInlineInspectorPortalChange={() => undefined}
        onSelectedAnchorChange={(anchor) => {
          selectedAnchor = anchor !== null;
        }}
        onNodeAnchorsChange={(anchors) => {
          conversationAnchor = Boolean(anchors?.[terminal.id]);
        }}
      />
    );
  }

  try {
    root.render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    );
    await waitFor(
      () => selectedAnchor && conversationAnchor,
      "Tree did not publish selected and conversation anchors",
    );

    const compact = window.innerWidth <= 720;
    const diagram = host.querySelector<HTMLElement>(".world-connected-tree");
    const outline = host.querySelector<HTMLElement>(".world-tree-outline");
    check(
      compact
        ? diagram === null && outline !== null
        : diagram !== null && outline === null,
      "Tree mounted the inactive viewport presentation",
    );
    const activePresentation = compact ? outline : diagram;
    if (!activePresentation)
      throw new Error("Tree did not mount the active viewport presentation");
    check(
      getComputedStyle(activePresentation).display !== "none",
      "Tree hid its active viewport presentation",
    );
    if (compact) {
      const rowTarget = activePresentation.querySelector<HTMLElement>(
        ".world-tree-outline-select",
      );
      check(
        (rowTarget?.getBoundingClientRect().height ?? 0) >= 48,
        "Compact Tree target is smaller than 48px",
      );
    }

    check(
      !hasAnchor(activePresentation, inactiveTerminal.id),
      "Tree mixed an excluded host into the explicit connection projection",
    );
    const inactiveBranch = [
      ...activePresentation.querySelectorAll<HTMLElement>(
        "[data-tree-host-id]",
      ),
    ].find((element) => element.dataset.treeHostId === inactiveHost.id);
    check(
      inactiveBranch === undefined,
      "Tree retained an excluded host branch",
    );
    const hostToggle = activePresentation.querySelector<HTMLButtonElement>(
      `[aria-label="Collapse ${worldHost.label}"]`,
    );
    hostToggle?.click();
    await waitFor(
      () => !hasAnchor(activePresentation, agent.id),
      "Collapsed Tree branch remained visible",
    );
    await waitFor(
      () => collapsedIds()?.includes(worldHost.id) === true,
      "Tree disclosure was not persisted",
    );

    if (compact) {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Search Tree"]')
        ?.click();
      await waitFor(
        () =>
          document.querySelector(".world-view-search-overlay input") !== null,
        "Compact Tree search did not open",
      );
    }
    const search = (compact ? document : host).querySelector<HTMLInputElement>(
      "input[type=search]",
    )!;
    enterSearch(search, "release checks");
    await waitFor(
      () => hasAnchor(activePresentation, agent.id),
      "Search did not restore the matching entity with ancestor context",
    );
    enterSearch(search, "");
    await waitFor(
      () => !hasAnchor(activePresentation, agent.id),
      "Clearing search did not restore persisted disclosure",
    );

    activePresentation
      .querySelector<HTMLButtonElement>(
        `[aria-label="Expand ${worldHost.label}"]`,
      )
      ?.click();
    await waitFor(
      () =>
        activePresentation.querySelector(
          `[aria-label="Open ${terminal.label} terminal"]`,
        ) !== null,
      "Expanded Tree branch did not restore its terminal action",
    );
    activePresentation
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open ${terminal.label} terminal"]`,
      )
      ?.click();
    check(terminalOpens === 1, "Tree terminal action did not activate once");
    setInlineInspectorNodeId(agent.id);
    await waitFor(
      () =>
        activePresentation.querySelector(
          `[data-inline-inspector-node-id='${CSS.escape(agent.id)}']`,
        ) !== null,
      "Tree did not expand the exact selected leaf as its inline Inspector target",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

async function checkProgressiveTreeReuse() {
  const nativeFrame = window.requestAnimationFrame;
  const nativeCancel = window.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const element = document.createElement("main");
  document.body.append(element);
  const root = createRoot(element);
  const world = buildWorldObject(
    Array.from({ length: 12 }, (_, index) =>
      connection(`reuse-${index}`, `Host ${index}`),
    ),
  );
  const leaf = world.leaves[0]!;
  const label = leaf.label;
  let labelReads = 0;
  Object.defineProperty(leaf, "label", {
    get: () => {
      labelReads++;
      return label;
    },
  });
  try {
    root.render(
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
      />,
    );
    await waitFor(
      () => hasAnchor(element, leaf.id),
      "First progressive Tree space did not mount",
    );
    const mountedReads = labelReads;
    check(
      mountedReads > 0,
      "Tree render reuse probe did not observe its initial leaf",
    );
    check(
      element.querySelector('[aria-busy="true"]') !== null,
      "Tree reuse fixture did not defer any spaces",
    );
    for (
      let turn = 0;
      turn < 10 && element.querySelector('[aria-busy="true"]');
      turn++
    ) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
      await settle();
    }
    check(
      element.querySelector('[aria-busy="false"]') !== null,
      "Progressive Tree did not admit every space",
    );
    check(
      world.leaves.every((node) => hasAnchor(element, node.id)),
      "Progressive Tree omitted observed leaves",
    );
    check(
      labelReads === mountedReads,
      "Progressive admission rerendered a previously mounted, unchanged Tree space",
    );
  } finally {
    root.unmount();
    element.remove();
    window.requestAnimationFrame = nativeFrame;
    window.cancelAnimationFrame = nativeCancel;
  }
}

run()
  .then(checkProgressiveTreeReuse)
  .catch((error: unknown) =>
    failures.push(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
  )
  .finally(() => {
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    });
  });
