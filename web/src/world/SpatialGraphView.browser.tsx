import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import type { Pane, Tab, Workspace } from "../types";
import SpatialGraphView from "./SpatialGraphView";
import { LatestFrameValue } from "./graph/GraphCanvas";
import { GRAPH_PREFERENCES_KEY } from "./graph/graphPreferences";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject, worldObjectForConnection } from "./worldObject";
import "./world.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(condition: () => boolean, message: string) {
  for (let index = 0; index < 160; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(message);
}

function connection(
  connectionId: string,
  label: string,
  agentStatus: Pane["agent_status"],
): WorldRuntimeConnection {
  const workspace: Workspace = {
    workspace_id: "studio",
    number: 1,
    label: "Platform Studio",
    focused: connectionId === "local",
    pane_count: 2,
    tab_count: 1,
    active_tab_id: "delivery",
    agent_status: agentStatus,
  };
  const tab: Tab = {
    tab_id: "delivery",
    workspace_id: "studio",
    number: 1,
    label: "Delivery",
    focused: true,
    pane_count: 2,
    agent_status: agentStatus,
  };
  const panes: Pane[] = [
    {
      pane_id: "builder",
      terminal_id: "terminal-builder",
      workspace_id: "studio",
      tab_id: "delivery",
      focused: true,
      agent: "Codex",
      agent_status: agentStatus,
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
    generation: 8,
    snapshotGeneration: 8,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs: [tab], panes, agents: [] },
  };
}

function enterSearch(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function graphPrefs() {
  return JSON.parse(
    worldLocalStorage.getItem(GRAPH_PREFERENCES_KEY) ?? "{}",
  ) as {
    cameraMode?: string;
    collapsedIds?: string[];
    positions?: Record<string, { x: number; y: number; pinned: boolean }>;
  };
}

async function pointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 3,
      clientX: x,
      clientY: y,
    }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function run() {
  worldLocalStorage.removeItem(GRAPH_PREFERENCES_KEY);
  document.body.style.margin = "0";
  const host = document.createElement("main");
  host.className = "world-view-stage world-view-graph";
  host.style.cssText = "width:100vw;height:100vh;overflow:hidden";
  document.body.append(host);
  const root = createRoot(host);
  const aggregateWorld = buildWorldObject(
    [
      connection("local", "Forge", "working"),
      connection("remote", "Review host", "blocked"),
    ],
    "local",
  );
  const initialWorld = worldObjectForConnection(aggregateWorld, "local");
  const agent = initialWorld.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "agent",
  )!;
  const terminal = initialWorld.leaves.find(
    (node) => node.connectionId === "local" && node.kind === "terminal",
  )!;
  const inactiveHost = aggregateWorld.hosts.find(
    (node) => node.connectionId === "remote",
  )!;
  const localHost = initialWorld.hosts.find(
    ({ connectionId }) => connectionId === "local",
  )!;
  let terminalOpens = 0;
  let selectedAnchor = false;
  let conversationAnchor = false;
  let lastSelectedId: string | null = agent.id;
  let setAgentStatus: (status: Pane["agent_status"]) => void = () => {};

  function Fixture() {
    const [selectedId, setSelectedId] = useState<string | null>(agent.id);
    const [agentStatus, updateAgentStatus] =
      useState<Pane["agent_status"]>("working");
    setAgentStatus = updateAgentStatus;
    const world = useMemo(() => {
      const aggregate = buildWorldObject(
        [
          connection("local", "Forge", agentStatus),
          connection("remote", "Review host", "blocked"),
        ],
        "local",
      );
      return worldObjectForConnection(aggregate, "local");
    }, [agentStatus]);
    return (
      <SpatialGraphView
        world={world}
        selectedId={selectedId}
        conversationNodeIds={[terminal.id]}
        onSelect={(id) => {
          lastSelectedId = id;
          setSelectedId(id);
        }}
        onOpenTerminal={async () => {
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
    const compact = window.matchMedia("(max-width: 720px)").matches;
    await waitFor(
      () => selectedAnchor && conversationAnchor,
      "Graph did not publish selected and conversation anchors",
    );
    const outline = host.querySelector<HTMLElement>(
      ".world-spatial-graph-outline",
    )!;
    const inactiveBranch = [
      ...outline.querySelectorAll<HTMLElement>("[data-graph-host-id]"),
    ].find((element) => element.dataset.graphHostId === inactiveHost.id);
    check(
      inactiveBranch === undefined,
      "Graph mixed another host into the selected-host presentation",
    );
    check(
      outline.textContent?.includes("Running release checks") === true,
      "Graph omitted the agent task summary",
    );
    const fitButton = host.querySelector<HTMLButtonElement>(
      ".world-spatial-graph-fit",
    )!;
    const arrangeButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Arrange graph"]',
    )!;
    if (!compact) {
      check(
        fitButton.textContent?.trim() === "Fit" &&
          fitButton.getBoundingClientRect().width >= 54 &&
          fitButton.scrollWidth <= fitButton.clientWidth &&
          Number.parseFloat(getComputedStyle(fitButton).gap) >= 6,
        "Graph Fit icon and label are clipped or crowded",
      );
      check(
        arrangeButton?.title === "Arrange graph" &&
          arrangeButton.tagName === "BUTTON" &&
          fitButton.getBoundingClientRect().right <=
            arrangeButton.getBoundingClientRect().left,
        "Graph Arrange is missing or overlaps Fit",
      );
    }
    if (compact) {
      check(
        host.querySelector("canvas[data-graph-canvas=true]") === null,
        "Compact Graph retained a hidden canvas renderer",
      );
      const target = outline.querySelector<HTMLElement>(
        ".world-spatial-graph-select",
      );
      check(
        (target?.getBoundingClientRect().height ?? 0) >= 48,
        "Compact Graph target is smaller than 48px",
      );
    } else {
      await waitFor(
        () =>
          window.__HERDR_GRAPH_RENDERER__?.ready === true &&
          window.__HERDR_GRAPH_RENDERER__.activeAnimationFrames === 0,
        "Graph renderer did not settle",
      );
      check(
        window.__HERDR_GRAPH_RENDERER__?.nodes === 4,
        "Graph renderer did not retain the selected host's qualified nodes",
      );
      check(
        window.__HERDR_GRAPH_RENDERER__?.links === 3,
        "Graph renderer did not retain exact parent-child links",
      );
    }

    outline
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open ${terminal.label} terminal"]`,
      )
      ?.click();
    check(terminalOpens === 1, "Semantic Graph terminal action did not run");
    outline
      .querySelector<HTMLButtonElement>(
        `[aria-label="Collapse ${localHost.label}"]`,
      )
      ?.click();
    await waitFor(
      () => graphPrefs().collapsedIds?.includes(localHost.id) === true,
      "Graph disclosure was not persisted",
    );
    const selectedSemantic = () =>
      [
        ...outline.querySelectorAll<HTMLElement>("[data-graph-node-anchor]"),
      ].find((element) => element.dataset.graphNodeAnchor === agent.id);
    const semanticNode = (id: string) =>
      [
        ...outline.querySelectorAll<HTMLElement>("[data-graph-node-anchor]"),
      ].find((element) => element.dataset.graphNodeAnchor === id);
    check(
      !selectedSemantic(),
      "Collapsed Graph branch remained in the outline",
    );
    if (compact) {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Search Graph"]')
        ?.click();
      await waitFor(
        () =>
          document.querySelector(".world-view-search-overlay input") !== null,
        "Compact Graph search did not open",
      );
    }
    const search = (compact ? document : host).querySelector<HTMLInputElement>(
      "input[type=search]",
    )!;
    enterSearch(search, "release checks");
    await waitFor(
      () => selectedSemantic() !== undefined,
      "Graph search did not restore matching ancestor context",
    );
    enterSearch(search, "");
    await waitFor(
      () => selectedSemantic() === undefined,
      "Clearing Graph search did not restore disclosure",
    );
    outline
      .querySelector<HTMLButtonElement>(
        `[aria-label="Expand ${localHost.label}"]`,
      )
      ?.click();
    await waitFor(
      () => selectedSemantic() !== undefined,
      "Graph branch did not expand",
    );

    if (!compact) {
      host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
      await waitFor(
        () => graphPrefs().cameraMode === "manual",
        "Graph camera was not persisted after zoom",
      );
      const canvas = host.querySelector<HTMLCanvasElement>(
        "canvas[data-graph-canvas=true]",
      )!;
      const rect = canvas.getBoundingClientRect();
      const before = window.__HERDR_GRAPH_RENDERER__!.publishedNodes[agent.id]!;
      await pointer(
        canvas,
        "pointerdown",
        rect.left + before.screenX,
        rect.top + before.screenY,
      );
      await pointer(
        canvas,
        "pointermove",
        rect.left + before.screenX + 42,
        rect.top + before.screenY + 18,
      );
      await pointer(
        canvas,
        "pointerup",
        rect.left + before.screenX + 42,
        rect.top + before.screenY + 18,
      );
      await waitFor(
        () =>
          window.__HERDR_GRAPH_RENDERER__?.publishedNodes[agent.id]?.pinned ===
          true,
        "Graph drag did not pin the node",
      );
      const pinned = window.__HERDR_GRAPH_RENDERER__!.publishedNodes[agent.id]!;
      for (let index = 0; index < 20; index += 1) {
        if (graphPrefs().positions?.[agent.id]?.pinned === true) break;
        await settle();
      }
      if (graphPrefs().positions?.[agent.id]?.pinned !== true) {
        throw new Error(
          `Pinned Graph position was not persisted: ${JSON.stringify(graphPrefs())}`,
        );
      }
      setAgentStatus("done");
      await waitFor(
        () =>
          outline.textContent?.includes("done") === true &&
          window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames === 0,
        "Graph status-only refresh did not settle",
      );
      const refreshed =
        window.__HERDR_GRAPH_RENDERER__!.publishedNodes[agent.id]!;
      check(
        refreshed.x === pinned.x &&
          refreshed.y === pinned.y &&
          refreshed.pinned,
        "Status-only refresh reset the settled Graph node",
      );

      await pointer(canvas, "pointerdown", rect.right - 12, rect.bottom - 12);
      await pointer(
        canvas,
        "pointermove",
        rect.right + rect.width,
        rect.bottom - 12,
      );
      await pointer(
        canvas,
        "pointerup",
        rect.right + rect.width,
        rect.bottom - 12,
      );
      await waitFor(
        () =>
          (window.__HERDR_GRAPH_RENDERER__?.publishedNodes[agent.id]?.screenX ??
            0) > canvas.width,
        "Graph pan did not move the old layout outside the viewport",
      );

      arrangeButton.click();
      await waitFor(() => {
        const nodes = window.__HERDR_GRAPH_RENDERER__?.publishedNodes;
        const moved = nodes?.[agent.id];
        return Boolean(
          moved &&
            (moved.x !== pinned.x || moved.y !== pinned.y) &&
            Object.values(nodes).every(({ pinned }) => pinned),
        );
      }, "Arrange did not replace and stabilize dragged Graph positions");
      const arranged = Object.values(
        window.__HERDR_GRAPH_RENDERER__!.publishedNodes,
      );
      check(
        arranged.every(
          ({ screenX, screenY }) =>
            screenX >= 0 &&
            screenX <= rect.width &&
            screenY >= 0 &&
            screenY <= rect.height,
        ),
        "Arrange did not bring visible Graph nodes back into the canvas",
      );
      for (let left = 0; left < arranged.length; left += 1) {
        for (let right = left + 1; right < arranged.length; right += 1) {
          const a = arranged[left]!;
          const b = arranged[right]!;
          check(
            Math.hypot(a.x - b.x, a.y - b.y) >= 88,
            "Arrange left visible Graph nodes stacked",
          );
        }
      }
      check(
        graphPrefs().cameraMode === "manual",
        "Arrange changed the Graph camera mode",
      );
      fitButton.click();
      await waitFor(
        () => graphPrefs().cameraMode === "fit",
        "Fit did not work independently after Arrange",
      );

      const arrangedAgent =
        window.__HERDR_GRAPH_RENDERER__!.publishedNodes[agent.id]!;
      await pointer(
        canvas,
        "pointerdown",
        rect.left + arrangedAgent.screenX,
        rect.top + arrangedAgent.screenY,
      );
      await pointer(
        canvas,
        "pointermove",
        rect.left + arrangedAgent.screenX + 24,
        rect.top + arrangedAgent.screenY,
      );
      await pointer(
        canvas,
        "pointerup",
        rect.left + arrangedAgent.screenX + 24,
        rect.top + arrangedAgent.screenY,
      );
      await waitFor(
        () =>
          window.__HERDR_GRAPH_RENDERER__?.publishedNodes[agent.id]?.x !==
          arrangedAgent.x,
        "Graph drag stopped working after Arrange",
      );

      const shell =
        window.__HERDR_GRAPH_RENDERER__!.publishedNodes[terminal.id]!;
      await pointer(
        canvas,
        "pointerdown",
        rect.left + shell.screenX,
        rect.top + shell.screenY,
      );
      await pointer(
        canvas,
        "pointerup",
        rect.left + shell.screenX,
        rect.top + shell.screenY,
      );
      if (lastSelectedId !== terminal.id) {
        throw new Error(
          `Canvas selected ${lastSelectedId ?? "nothing"} instead of ${terminal.id}; shell ${JSON.stringify(shell)}; rect ${JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })}`,
        );
      }
      await waitFor(
        () =>
          semanticNode(terminal.id)?.getAttribute("aria-pressed") === "true",
        "Canvas selection did not synchronize the semantic Graph",
      );
      canvas.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          button: 0,
          clientX: rect.left + shell.screenX,
          clientY: rect.top + shell.screenY,
        }),
      );
      check(
        terminalOpens === 2,
        "Canvas double-click did not open the terminal",
      );

      const applied: number[] = [];
      const latest = new LatestFrameValue<number>((value) =>
        applied.push(value),
      );
      for (let index = 0; index < 300; index += 1) latest.push(index);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      check(
        applied.length === 1 && applied[0] === 299,
        "Graph resize work did not coalesce to the latest frame value",
      );
      latest.cancel();

      const positionsBeforeRemount = Object.fromEntries(
        Object.entries(window.__HERDR_GRAPH_RENDERER__!.publishedNodes).map(
          ([id, { x, y }]) => [id, { x, y }],
        ),
      );
      await waitFor(
        () =>
          graphPrefs().positions?.[agent.id]?.x ===
          positionsBeforeRemount[agent.id]?.x,
        "Graph did not persist arranged positions before remount",
      );
      root.render(null);
      await waitFor(
        () => window.__HERDR_GRAPH_RENDERER__?.activeRenderers === 0,
        "Graph renderer did not retire before remount",
      );
      root.render(
        <StrictMode>
          <Fixture />
        </StrictMode>,
      );
      await waitFor(
        () =>
          window.__HERDR_GRAPH_RENDERER__?.ready === true &&
          window.__HERDR_GRAPH_RENDERER__.activeAnimationFrames === 0,
        "Graph renderer did not settle after remount",
      );
      for (const [id, position] of Object.entries(positionsBeforeRemount)) {
        const restored = window.__HERDR_GRAPH_RENDERER__!.publishedNodes[id];
        check(
          restored?.x === position.x &&
            restored.y === position.y &&
            restored.pinned,
          "Graph remount changed an arranged position",
        );
      }
    }
  } finally {
    root.unmount();
    host.remove();
    if (!window.matchMedia("(max-width: 720px)").matches) {
      await waitFor(
        () => window.__HERDR_GRAPH_RENDERER__?.activeRenderers === 0,
        "Graph renderer did not release ownership",
      );
      check(
        window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames === 0 &&
          window.__HERDR_GRAPH_RENDERER__.activeObservers === 0 &&
          window.__HERDR_GRAPH_RENDERER__.activeListeners === 0,
        "Graph renderer leaked frame, observer, or listener ownership",
      );
    }
  }
}

run()
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
