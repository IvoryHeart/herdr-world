import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject } from "./worldObject";
import PixelOfficeView from "./PixelOfficeView";
import "./world.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(condition: () => boolean, message: string) {
  for (let index = 0; index < 300; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(message);
}

function workspace(id: string, label: string, paneCount: number): Workspace {
  return {
    workspace_id: id,
    number: 1,
    label,
    focused: true,
    pane_count: paneCount,
    tab_count: 2,
    active_tab_id: `${id}-working`,
    agent_status: "working",
  };
}

function tab(workspaceId: string, suffix: string, number: number): Tab {
  return {
    tab_id: `${workspaceId}-${suffix}`,
    workspace_id: workspaceId,
    number,
    label: suffix === "working" ? "Launch room" : "Review room",
    focused: number === 1,
    pane_count: 2,
    agent_status: suffix === "working" ? "working" : "blocked",
  };
}

function pane(
  workspaceId: string,
  suffix: string,
  index: number,
  status: string,
  agent: string,
): Pane {
  return {
    pane_id: `${workspaceId}-${suffix}-pane-${index}`,
    terminal_id: `${workspaceId}-${suffix}-terminal-${index}`,
    workspace_id: workspaceId,
    tab_id: `${workspaceId}-${suffix}`,
    focused: index === 0,
    agent,
    agent_status: status,
    revision: 1,
  };
}

function connection(
  connectionId: string,
  label: string,
  workspaceId: string,
  statuses: readonly [string, string, string, string],
): WorldRuntimeConnection {
  const tabs = [tab(workspaceId, "working", 1), tab(workspaceId, "review", 2)];
  const panes = [
    pane(workspaceId, "working", 0, statuses[0], `${label} Builder`),
    pane(workspaceId, "working", 1, statuses[1], `${label} Pair`),
    pane(workspaceId, "review", 0, statuses[2], `${label} Reviewer`),
    pane(workspaceId, "review", 1, statuses[3], `${label} Observer`),
  ];
  return {
    connectionId,
    label,
    source: "saved-profile",
    isDefault: connectionId === "local",
    state: "ready",
    generation: 7,
    snapshotGeneration: 7,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [workspace(workspaceId, `${label} Studio`, panes.length)],
      tabs,
      panes,
      agents: [],
    },
  };
}

async function run() {
  document.body.style.margin = "0";
  const layoutShell = document.createElement("div");
  layoutShell.className = "world-view-layout has-context";
  layoutShell.style.cssText = "position:relative;width:1280px;height:820px";
  const host = document.createElement("div");
  host.className = "world-view-stage";
  const context = document.createElement("aside");
  context.className = "world-context-rail";
  context.innerHTML =
    '<div class="world-selection-panel">Selected agent</div><div class="world-inspector-portal">Inspector</div>';
  layoutShell.append(host, context);
  document.body.append(layoutShell);
  const root = createRoot(host);
  const world = buildWorldObject(
    [
      connection("local", "Local", "alpha", [
        "working",
        "unknown",
        "blocked",
        "done",
      ]),
      connection("remote", "Remote", "beta", [
        "working",
        "unknown",
        "blocked",
        "idle",
      ]),
    ],
    "local",
  );

  try {
    let selectedAnchor = false;
    root.render(
      <StrictMode>
        <PixelOfficeView
          world={world}
          selectedId={world.leaves[0]?.id ?? null}
          onSelect={() => {}}
          onOpenTerminal={() => {}}
          onSelectedAnchorChange={(anchor) => {
            selectedAnchor = anchor !== null;
          }}
        />
      </StrictMode>,
    );
    await waitFor(
      () => window.__HERDR_WORLD_RENDERER__?.ready === true,
      "Pixel Office renderer did not become ready",
    );
    const diagnostics = window.__HERDR_WORLD_RENDERER__!;
    const layout = diagnostics.publishedLayout;
    const canvas = host.querySelector<HTMLCanvasElement>(
      "canvas[data-office-canvas='true']",
    );

    check(canvas !== null, "Pixel Office canvas was not mounted");
    check(
      diagnostics.lastError === null,
      "Pixel Office renderer reported an error",
    );
    check(
      diagnostics.activeApplications === 1,
      "Pixel Office mounted more than one Pixi application",
    );
    check(
      diagnostics.activeTickers === 1,
      "Pixel Office mounted more than one Pixi ticker",
    );
    check(diagnostics.sceneRenders > 0, "Pixel Office did not render a scene");
    check(layout !== null, "Pixel Office did not publish its layout");
    check((layout?.ceoRect.width ?? 0) > 0, "CEO Office geometry is missing");
    check(
      (layout?.agentBarRect.width ?? 0) > 0,
      "Agent Bar geometry is missing",
    );
    check(
      layout?.ceoBlocks.receptions.length === 2,
      "Host receptions are missing",
    );
    check(layout?.rooms.length === 2, "Work rooms are missing");
    check(
      (canvas?.width ?? 0) > 0 && (canvas?.height ?? 0) > 0,
      "Pixel Office canvas collapsed",
    );
    check(
      Math.round(host.getBoundingClientRect().width) ===
        Math.round(layoutShell.getBoundingClientRect().width),
      "The intent overlay reduced the Office stage width",
    );
    check(
      selectedAnchor,
      "The selected Office entity did not publish an anchor",
    );
  } finally {
    root.unmount();
    await waitFor(
      () => window.__HERDR_WORLD_RENDERER__?.activeApplications === 0,
      "Pixel Office Pixi application did not clean up",
    );
    check(
      window.__HERDR_WORLD_RENDERER__?.activeTickers === 0,
      "Pixel Office ticker did not clean up",
    );
    check(
      document.querySelectorAll("canvas[data-office-canvas='true']").length ===
        0,
      "Pixel Office canvas leaked after unmount",
    );
    layoutShell.remove();
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
