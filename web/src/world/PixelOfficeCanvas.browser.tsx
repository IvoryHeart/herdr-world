window.__HERDR_WORLD_RENDERER_DEBUG__ = true;
import { verifyOfficeRendering } from "./officeRendering.browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "pixi.js";
import { worldLocalStorage } from "../browserStorage";
import type { Pane, Tab, Workspace } from "../types";
import { WORLD_OBSERVABILITY_UPDATED_EVENT } from "../workspaceResource";
import { OfficeCompactTargetChooser } from "./OfficeCompactTargetChooser";
import { OfficeSemanticTargetsOverlay } from "./OfficeRoomActionsOverlay";
import { OFFICE_PREFERENCES_KEY } from "./officePreferences";
import { projectWorldOffice } from "./herdrOfficeProjection";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject, worldObjectForConnection } from "./worldObject";
import PixelOfficeView from "./PixelOfficeView";
import "./world.css";

const failures: string[] = [];
const motionQueries: MediaQueryList[] = [];
const matchMedia = window.matchMedia.bind(window);
window.matchMedia = (query) => {
  const result = matchMedia(query);
  if (query === "(prefers-reduced-motion: reduce)") motionQueries.push(result);
  return result;
};
let maximumTextRasterScale = 0;
const scaleCanvas = CanvasRenderingContext2D.prototype.scale;
CanvasRenderingContext2D.prototype.scale = function (x, y) {
  maximumTextRasterScale = Math.max(maximumTextRasterScale, x, y);
  return scaleCanvas.call(this, x, y);
};
let ordinaryTasksDuringScene = 0;
let officePaints = 0;
const paintOffice = Application.prototype.render;
Application.prototype.render = function () {
  officePaints++;
  if (window.__HERDR_WORLD_RENDERER__?.ready === false)
    setTimeout(() => {
      if (window.__HERDR_WORLD_RENDERER__?.ready === false)
        ordinaryTasksDuringScene++;
    }, 0);
  return paintOffice.call(this);
};
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
    task_summary: agent ? `Working on ${suffix} ${index + 1}` : undefined,
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
  const compact = window.innerWidth <= 720;
  worldLocalStorage.setItem(
    OFFICE_PREFERENCES_KEY,
    JSON.stringify({
      roomAlignment: "right",
      longTitleMode: "compact",
      scrollLeft: compact ? 73 : 0,
      scrollTop: 0,
    }),
  );
  document.body.style.margin = "0";
  const layoutShell = document.createElement("div");
  layoutShell.className = "world-view-layout has-context";
  layoutShell.style.cssText = "position:relative;width:100vw;height:820px";
  const host = document.createElement("div");
  host.className = "world-view-stage";
  const context = document.createElement("aside");
  context.className = "world-context-rail";
  context.innerHTML =
    '<div class="world-selection-panel">Selected agent</div><div class="world-inspector-portal">Inspector</div>';
  layoutShell.append(host, context);
  document.body.append(layoutShell);
  const root = createRoot(host);
  const local = connection("local", "Local", "alpha", [
    "working",
    "unknown",
    "blocked",
    "done",
  ]);
  if (local.snapshot) {
    local.snapshot.panes.push(
      pane("alpha", "working", 2, "working", "Local Researcher"),
      pane("alpha", "working", 3, "working", "Local Tester"),
      pane("alpha", "working", 4, "working", "Local Writer"),
    );
    local.snapshot.tabs[0] = { ...local.snapshot.tabs[0]!, pane_count: 5 };
    local.snapshot.workspaces[0] = {
      ...local.snapshot.workspaces[0]!,
      pane_count: 7,
    };
  }
  const remote = connection("remote", "Remote", "beta", [
    "working",
    "unknown",
    "blocked",
    "idle",
  ]);
  if (remote.snapshot) {
    remote.snapshot.tabs = remote.snapshot.tabs.slice(0, 1);
    remote.snapshot.panes = remote.snapshot.panes.filter(
      ({ tab_id }) => tab_id === "beta-working",
    );
    remote.snapshot.workspaces[0] = {
      ...remote.snapshot.workspaces[0]!,
      pane_count: 2,
      tab_count: 1,
    };
  }
  const stale = {
    ...connection("stale", "Offline", "gamma", [
      "working",
      "unknown",
      "blocked",
      "idle",
    ]),
    state: "error" as const,
    generation: 8,
    snapshotGeneration: 7,
    stale: true,
    actionable: false,
  };
  const aggregateWorld = buildWorldObject([local, remote, stale], "local");
  let world = worldObjectForConnection(aggregateWorld, "local");

  try {
    let selectedAnchor = false;
    let terminalActivationAllowed = false;
    let terminalActivations = 0;
    const terminalTargets: string[] = [];
    function OfficeHarness() {
      return (
        <PixelOfficeView
          world={world}
          selectedId={world.leaves[0]?.id ?? null}
          onSelect={() => {}}
          onOpenTerminal={async (id) => {
            terminalTargets.push(id);
            terminalActivations += 1;
            if (!terminalActivationAllowed) {
              throw new Error("synthetic activation failure");
            }
          }}
          floatingTerminals={[]}
          onSelectedAnchorChange={(anchor) => {
            selectedAnchor = anchor !== null;
          }}
        />
      );
    }
    root.render(
      <StrictMode>
        <OfficeHarness />
      </StrictMode>,
    );
    await waitFor(
      () => window.__HERDR_WORLD_RENDERER__?.ready === true,
      "Pixel Office renderer did not become ready",
    );
    check(
      ordinaryTasksDuringScene > 0,
      "Office completes scene construction and painting without admitting an ordinary task",
    );
    check(
      maximumTextRasterScale >= 1 &&
        maximumTextRasterScale <= Math.min(2, window.devicePixelRatio || 1),
      "Office text textures exceed the canvas device resolution",
    );
    await waitFor(
      () => host.querySelector(".world-semantic-target") !== null,
      "Pixel Office overlays did not become ready",
    );
    check(
      host.querySelector<HTMLButtonElement>(".world-new-seat-canvas-action")
        ?.disabled === false,
      "Initial Office seat creation remained disabled after the scene rendered",
    );
    check(
      host.querySelector<HTMLButtonElement>(".world-new-room-canvas-action")
        ?.disabled === false,
      "Initial Office room creation remained disabled after the scene rendered",
    );
    const diagnostics = window.__HERDR_WORLD_RENDERER__!;
    const officeScroll = host.querySelector<HTMLElement>(
      ".world-stage-scroll",
    )!;
    const officeCanvas = host.querySelector<HTMLCanvasElement>(
      "canvas[data-office-canvas='true']",
    )!;
    check(
      officeCanvas.width <=
        officeScroll.clientWidth * Math.min(2, window.devicePixelRatio || 1),
      "Office allocates an offscreen horizontal canvas beyond its visible viewport",
    );
    const progressHost = document.body.appendChild(
      document.createElement("div"),
    );
    const progressRoot = createRoot(progressHost);
    const progressProjection = projectWorldOffice(
      buildWorldObject(
        Array.from({ length: 9 }, (_, index) =>
          connection(
            `progress-${index}`,
            "Progress",
            `progress-space-${index}`,
            ["working", "working", "working", "working"],
          ),
        ),
      ),
      1,
    );
    const progressLayout = {
      ...diagnostics.publishedLayout!,
      rooms: progressProjection.rooms.map((_, index) => ({
        ...diagnostics.publishedLayout!.rooms[0]!,
        index,
        y: index * 500,
      })),
    };
    const requestFrame = window.requestAnimationFrame;
    const cancelFrame = window.cancelAnimationFrame;
    let heldFrame = 1_000_000;
    const heldFrames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      heldFrames.set(++heldFrame, callback);
      return heldFrame;
    };
    window.cancelAnimationFrame = (id) => {
      if (!heldFrames.delete(id)) cancelFrame(id);
    };
    try {
      progressRoot.render(
        <OfficeSemanticTargetsOverlay
          layout={progressLayout}
          projection={progressProjection}
          renderedRevision={progressLayout.layoutRevision}
          selectedKey={null}
          onSelect={() => {}}
          onActivateAgent={() => {}}
          onActivateDesk={() => {}}
          onActivateRoom={() => {}}
        />,
      );
      await waitFor(
        () =>
          progressHost
            .querySelector('[aria-label="Office scene targets"]')
            ?.getAttribute("aria-busy") === "false",
        "Office target readiness depends on canvas animation frames",
      );
      const beforeRefresh = [
        ...progressHost.querySelectorAll<HTMLButtonElement>(
          ".world-semantic-target",
        ),
      ];
      const focused = beforeRefresh[beforeRefresh.length - 1]!;
      focused.focus();
      let removed = 0;
      const mutations = new MutationObserver((records) => {
        for (const record of records) removed += record.removedNodes.length;
      });
      mutations.observe(progressHost, { childList: true, subtree: true });
      let selectedAfterRefresh = "";
      progressRoot.render(
        <OfficeSemanticTargetsOverlay
          layout={{ ...progressLayout }}
          projection={structuredClone(progressProjection)}
          renderedRevision={progressLayout.layoutRevision}
          selectedKey={null}
          onSelect={(key) => {
            selectedAfterRefresh = key;
          }}
          onActivateAgent={() => {}}
          onActivateDesk={() => {}}
          onActivateRoom={() => {}}
        />,
      );
      await settle();
      await settle();
      check(
        removed === 0,
        "Equivalent Office refresh remounted admitted semantic controls",
      );
      check(
        document.activeElement === focused,
        "Equivalent Office refresh lost keyboard focus",
      );
      focused.click();
      check(
        selectedAfterRefresh === focused.dataset.targetKey,
        "Retained Office control used a stale callback",
      );
      progressRoot.render(
        <OfficeSemanticTargetsOverlay
          layout={progressLayout}
          projection={progressProjection}
          renderedRevision={0}
          selectedKey={null}
          onSelect={() => {
            selectedAfterRefresh = "unready";
          }}
          onActivateAgent={() => {
            selectedAfterRefresh = "unready";
          }}
          onActivateDesk={() => {}}
          onActivateRoom={() => {}}
        />,
      );
      await settle();
      const unready = progressHost.querySelector<HTMLElement>(
        ".world-semantic-targets-overlay",
      )!;
      focused.blur();
      focused.focus();
      focused.click();
      check(
        unready.inert &&
          document.activeElement !== focused &&
          selectedAfterRefresh !== "unready",
        `Unprepared Office controls accept focus or activation: inert=${unready.inert}, focused=${document.activeElement === focused}, callback=${selectedAfterRefresh === "unready"}`,
      );
      mutations.disconnect();
    } finally {
      progressRoot.unmount();
      progressHost.remove();
      window.requestAnimationFrame = requestFrame;
      window.cancelAnimationFrame = cancelFrame;
      for (const callback of heldFrames.values()) callback(performance.now());
    }
    const motion = motionQueries[motionQueries.length - 1]!;
    motion.dispatchEvent(new MediaQueryListEvent("change", { matches: true }));
    const pausedFrames = diagnostics.frames;
    await settle();
    await settle();
    check(
      diagnostics.frames === pausedFrames,
      "Reduced-motion Office keeps an autonomous paint loop running",
    );
    const rendersBeforeObservation = diagnostics.sceneRenders;
    const reusedBeforeObservation = diagnostics.layerReuses;
    await fetch("/release-metrics", { method: "POST" });
    window.dispatchEvent(new Event(WORLD_OBSERVABILITY_UPDATED_EVENT));
    await waitFor(
      () => diagnostics.sceneRenders > rendersBeforeObservation,
      "Office did not apply the service-owned observability snapshot",
    );
    check(
      diagnostics.sceneRenders > rendersBeforeObservation,
      "The Economy board did not redraw after observability arrived",
    );
    await waitFor(
      () => diagnostics.ready,
      "Office metrics scene did not finish",
    );
    check(
      diagnostics.layerReuses > reusedBeforeObservation,
      "Economy update rebuilt unrelated Office layers",
    );
    check(
      diagnostics.frames === pausedFrames,
      "Office state paints restarted reduced-motion animation",
    );
    motion.dispatchEvent(new MediaQueryListEvent("change", { matches: false }));
    await waitFor(
      () => diagnostics.frames > pausedFrames,
      "Office animation did not resume",
    );
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "hidden",
    );
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const hiddenFrames = diagnostics.frames;
    await settle();
    await settle();
    check(
      diagnostics.frames === hiddenFrames,
      "Hidden Office kept rendering animation",
    );
    if (hiddenDescriptor)
      Object.defineProperty(document, "hidden", hiddenDescriptor);
    else delete (document as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(
      () => diagnostics.frames > hiddenFrames,
      "Visible Office animation did not resume",
    );
    const typingTarget = document.createElement("textarea");
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    terminal.appendChild(typingTarget);
    document.body.appendChild(terminal);
    typingTarget.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "z" }),
    );
    const typingFrames = diagnostics.frames;
    await settle();
    typingTarget.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, data: "z" }),
    );
    await settle();
    check(
      diagnostics.interactionPaused && diagnostics.frames === typingFrames,
      "Decorative Office animation competed with terminal input",
    );
    const paintsDuringTyping = officePaints;
    officeScroll.dispatchEvent(new Event("scroll"));
    check(
      officePaints > paintsDuringTyping,
      "Terminal input blocked an Office scroll paint",
    );

    await waitFor(
      () => diagnostics.frames > typingFrames && !diagnostics.interactionPaused,
      "Office animation did not resume after terminal input",
    );
    terminal.remove();
    const layout = diagnostics.publishedLayout;
    const canvas = host.querySelector<HTMLCanvasElement>(
      "canvas[data-office-canvas='true']",
    );

    check(canvas !== null, "Pixel Office canvas was not mounted");
    check(
      canvas?.style.touchAction === "pan-x pan-y",
      "Pixel Office canvas did not allow native two-axis touch panning",
    );
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
      layout?.ceoBlocks.receptions.length === 1,
      "The selected host reception is missing",
    );
    check(layout?.rooms.length === 1, "The selected host work room is missing");
    check(
      host.querySelectorAll(".world-semantic-target").length > 0,
      "Office semantic targets are missing",
    );
    check(
      host.querySelector(".world-compact-target-chooser") !== null,
      "The compact Office target chooser is missing",
    );
    check(
      host.querySelector(".world-canvas-callout-persistent") === null,
      "The selected Office entity retained a duplicate floating badge",
    );
    const completion = host.querySelector<HTMLButtonElement>(
      ".world-completion-notices button",
    );
    check(completion !== null, "The unseen completion notice is missing");
    completion?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    check(
      host.querySelector(".world-completion-notices button") !== null,
      "Failed completion inspection was incorrectly acknowledged",
    );
    terminalActivationAllowed = true;
    completion?.click();
    await waitFor(
      () => host.querySelector(".world-completion-notices button") === null,
      "Successful completion inspection did not acknowledge the marker",
    );
    check(
      terminalActivations === 2,
      "Completion inspection did not preserve explicit activation attempts",
    );
    const devices = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.world-semantic-target[data-kind="pane"]',
      ),
    ];
    check(
      devices.length === 6,
      "Office did not present all six bounded pane devices",
    );
    const chooserHost = document.createElement("div");
    chooserHost.style.cssText = "position:absolute;left:-10000px";
    document.body.append(chooserHost);
    const chooserRoot = createRoot(chooserHost);
    const chooserProjection = projectWorldOffice(world, Date.now());
    const paneTemplate = chooserProjection.paneRoster[0]!;
    chooserProjection.paneRoster = Array.from({ length: 51 }, (_, index) => ({
      ...paneTemplate,
      device: {
        ...paneTemplate.device,
        key: `test-pane-${index}`,
        displayLabel: `Pane ${index + 1}`,
      },
    }));
    let openedPane: string | null = null;
    chooserRoot.render(
      <OfficeCompactTargetChooser
        projection={chooserProjection}
        selectedKey={null}
        onSelect={() => {}}
        onActivateAgent={() => {}}
        onActivateDesk={(key) => {
          openedPane = key;
        }}
      />,
    );
    await waitFor(
      () => chooserHost.querySelector('nav[aria-label="Panes pages"]') !== null,
      "Overflow pane navigation was not rendered",
    );
    check(
      chooserHost.querySelector('[data-target-key="test-pane-50"]') === null,
      "Overflow pane appeared on the first page",
    );
    chooserHost
      .querySelector<HTMLButtonElement>(
        'nav[aria-label="Panes pages"] button:last-child',
      )
      ?.click();
    await waitFor(
      () =>
        chooserHost.querySelector('[data-target-key="test-pane-50"]') !== null,
      "Pane 51 could not be reached through the chooser",
    );
    chooserHost
      .querySelector<HTMLButtonElement>('[aria-label="Open Pane 51 terminal"]')
      ?.click();
    check(openedPane === "test-pane-50", "Pane 51 opened the wrong target");
    chooserRoot.unmount();
    chooserHost.remove();
    check(
      host.querySelectorAll('.world-semantic-target[data-kind="desk"]')
        .length === 2,
      "Occupied desks lost their distinct tab targets",
    );
    devices[1]?.click();
    await settle();
    check(
      terminalTargets[terminalTargets.length - 1] === world.leaves[1]?.id,
      "Pane device did not open its own qualified terminal",
    );
    const doneTarget = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].find((button) => button.getAttribute("aria-label")?.includes(", done,"));
    check(
      doneTarget !== undefined,
      "Done agent disappeared after its completion was inspected",
    );
    check(
      host.querySelectorAll(".world-new-seat-canvas-action").length === 1,
      "The active host room is missing its new-seat control",
    );
    check(
      host.querySelectorAll(".world-room-overlay-action").length === 2,
      "Room management controls are missing",
    );
    check(
      host.querySelectorAll(".world-room-overlay-action:not(:disabled)")
        .length === 2,
      "The selected host room did not expose its mutations",
    );
    check(
      host.querySelector(".world-new-room-canvas-action") !== null,
      "The selected host is missing its new-room control",
    );
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
    // Exercise the second reception row with both statuses; it must render
    // without indexing past the four physical chairs.
    const crowded = connection("local", "Local", "alpha", [
      "working",
      "unknown",
      "blocked",
      "done",
    ]);
    for (let index = 2; index < 8; index += 1) {
      crowded.snapshot!.panes.push(
        pane(
          "alpha",
          "review",
          index,
          index % 2 ? "done" : "blocked",
          `Reception agent ${index}`,
        ),
      );
    }
    world = worldObjectForConnection(
      buildWorldObject([crowded], "local"),
      "local",
    );
    const priorRenders = diagnostics.sceneRenders;
    root.render(
      <StrictMode>
        <OfficeHarness />
      </StrictMode>,
    );
    await waitFor(
      () => diagnostics.sceneRenders > priorRenders,
      "Crowded reception did not render",
    );
    await waitFor(
      () =>
        host.querySelectorAll('.world-semantic-target[data-kind="agent"]')
          .length === 10,
      "Crowded reception lost agent targets",
    );
    check(
      diagnostics.lastError === null,
      "Eight mixed reception agents crashed the renderer",
    );
    const inactiveAgent = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].find((button) => button.getAttribute("aria-label")?.includes("Remote"));
    const staleAgent = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].find((button) => button.getAttribute("aria-label")?.includes(", stale,"));
    check(inactiveAgent === undefined, "Office mixed in another ready host");
    check(staleAgent === undefined, "Office mixed in a stale host");
    const stageScroll = host.querySelector<HTMLElement>(".world-stage-scroll")!;
    check(
      host.querySelector(".world-office-toolbar") === null,
      "Office retained a scene toolbar for settings",
    );
    if (compact) {
      check(
        getComputedStyle(host.querySelector(".world-compact-target-chooser")!)
          .display !== "none",
        "Compact Office chooser is hidden at phone width",
      );
      check(
        stageScroll.scrollWidth > stageScroll.clientWidth,
        "Phone Office lost bounded horizontal scene navigation",
      );
      check(
        Math.abs(stageScroll.scrollLeft - 73) <= 1,
        "Office scroll preference was not restored at phone width",
      );
      stageScroll.scrollLeft = 111;
      stageScroll.dispatchEvent(new Event("scroll"));
      await settle();
      const saved = JSON.parse(
        worldLocalStorage.getItem(OFFICE_PREFERENCES_KEY) ?? "{}",
      ) as { scrollLeft?: number };
      check(
        saved.scrollLeft === 111,
        "Office scroll preference was not persisted",
      );
    }
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
    worldLocalStorage.removeItem(OFFICE_PREFERENCES_KEY);
  }
}

run()
  .then(() => verifyOfficeRendering(check))
  .catch((error: unknown) => {
    const diagnostics = window.__HERDR_WORLD_RENDERER__;
    failures.push(
      `${String(error)}; renderer=${JSON.stringify(
        diagnostics
          ? {
              ready: diagnostics.ready,
              lastError: diagnostics.lastError,
              mounts: diagnostics.mounts,
              destroys: diagnostics.destroys,
              activeApplications: diagnostics.activeApplications,
              activeTickers: diagnostics.activeTickers,
              canvases: diagnostics.canvases,
              frames: diagnostics.frames,
              sceneRenders: diagnostics.sceneRenders,
            }
          : null,
      )}`,
    );
  })
  .finally(() => {
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    });
  });
