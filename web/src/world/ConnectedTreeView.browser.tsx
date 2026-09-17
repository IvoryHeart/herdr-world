import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import type { Pane, Tab, Workspace } from "../types";
import ConnectedTreeView from "./ConnectedTreeView";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { TREE_PREFERENCES_KEY } from "./treePreferences";
import { buildWorldObject } from "./worldObject";
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
  const world = buildWorldObject(
    [connection("local", "Forge"), connection("remote", "Review host")],
    "local",
  );
  const agent = world.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "agent",
  )!;
  const terminal = world.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "terminal",
  )!;
  const inactiveTerminal = world.leaves.find(
    (node) => node.connectionId === "remote" && node.kind === "terminal",
  )!;
  const worldHost = world.hosts[0]!;
  let terminalOpens = 0;
  let selectedAnchor = false;
  let conversationAnchor = false;

  function Fixture() {
    const [selectedId, setSelectedId] = useState<string | null>(agent.id);
    return (
      <ConnectedTreeView
        world={world}
        selectedId={selectedId}
        conversationNodeIds={[terminal.id]}
        onSelect={setSelectedId}
        onOpenTerminal={() => {
          terminalOpens += 1;
        }}
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
    const diagram = host.querySelector<HTMLElement>(".world-connected-tree")!;
    const outline = host.querySelector<HTMLElement>(".world-tree-outline")!;
    check(
      compact
        ? getComputedStyle(diagram).display === "none"
        : getComputedStyle(diagram).display !== "none",
      "Tree did not choose the expected viewport presentation",
    );
    check(
      compact
        ? getComputedStyle(outline).display !== "none"
        : getComputedStyle(outline).display === "none",
      "Tree outline visibility did not match the viewport",
    );
    if (compact) {
      const rowTarget = outline.querySelector<HTMLElement>(
        ".world-tree-outline-select",
      );
      check(
        (rowTarget?.getBoundingClientRect().height ?? 0) >= 48,
        "Compact Tree target is smaller than 48px",
      );
    }

    const activePresentation = compact ? outline : diagram;
    check(
      hasAnchor(activePresentation, inactiveTerminal.id),
      "Tree omitted the inactive host's read-only hierarchy",
    );
    check(
      activePresentation.querySelectorAll(
        `[aria-label="Open ${inactiveTerminal.label} terminal"]`,
      ).length === 1,
      "Tree exposed an inactive-host terminal action",
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

    const search = host.querySelector<HTMLInputElement>("input[type=search]")!;
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
  } finally {
    root.unmount();
    host.remove();
  }
}

run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() => {
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    });
  });
