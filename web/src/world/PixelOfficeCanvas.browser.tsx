import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { worldLocalStorage } from "../browserStorage";
import type { Pane, Tab, Workspace } from "../types";
import { WORLD_OBSERVABILITY_UPDATED_EVENT } from "../workspaceResource";
import { OFFICE_PREFERENCES_KEY } from "./officePreferences";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject } from "./worldObject";
import PixelOfficeView from "./PixelOfficeView";
import { OfficeObservabilityDialog } from "./OfficeObservabilityDialog";
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

function enterText(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
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
  const world = buildWorldObject([local, remote, stale], "local");

  try {
    let selectedAnchor = false;
    let terminalActivationAllowed = false;
    let terminalActivations = 0;
    function OfficeHarness() {
      const [settingsOpen, setSettingsOpen] = useState(false);
      return (
        <>
          <PixelOfficeView
            world={world}
            selectedId={world.leaves[0]?.id ?? null}
            onSelect={() => {}}
            onOpenTerminal={async () => {
              terminalActivations += 1;
              if (!terminalActivationAllowed) {
                throw new Error("synthetic activation failure");
              }
            }}
            floatingTerminals={[]}
            onSelectedAnchorChange={(anchor) => {
              selectedAnchor = anchor !== null;
            }}
            onOpenObservabilitySettings={() => setSettingsOpen(true)}
          />
          {settingsOpen ? (
            <OfficeObservabilityDialog
              onClose={() => setSettingsOpen(false)}
              onSaved={() =>
                window.dispatchEvent(
                  new Event(WORLD_OBSERVABILITY_UPDATED_EVENT),
                )
              }
            />
          ) : null}
        </>
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
    await waitFor(
      () => host.querySelector(".world-semantic-target") !== null,
      "Pixel Office overlays did not become ready",
    );
    const diagnostics = window.__HERDR_WORLD_RENDERER__!;
    const rendersBeforeObservation = diagnostics.sceneRenders;
    await fetch("/release-metrics", { method: "POST" });
    window.dispatchEvent(new Event(WORLD_OBSERVABILITY_UPDATED_EVENT));
    await waitFor(
      () =>
        host
          .querySelector(".world-office-metrics-button")
          ?.getAttribute("data-status") === "available",
      "Office did not apply the service-owned observability snapshot",
    );
    check(
      diagnostics.sceneRenders > rendersBeforeObservation,
      "The Economy board did not redraw after observability arrived",
    );
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
      layout?.ceoBlocks.receptions.length === 3,
      "Host receptions are missing",
    );
    check(
      layout?.rooms.length === 3,
      "Unequal multi-host work rooms are missing",
    );
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
      host.querySelectorAll(".world-new-seat-canvas-action").length === 1,
      "The active host room is missing its new-seat control",
    );
    check(
      host.querySelectorAll(".world-room-overlay-action").length === 6,
      "Room management controls are missing",
    );
    check(
      host.querySelectorAll(".world-room-overlay-action:not(:disabled)")
        .length === 2,
      "Inactive or stale hosts exposed room mutations",
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
    check(
      inactiveAgent !== undefined,
      "Ready-inactive host agents are missing",
    );
    check(staleAgent !== undefined, "Stale host agents are missing");
    const activationsBeforeReadOnly = terminalActivations;
    inactiveAgent?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    staleAgent?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    check(
      terminalActivations === activationsBeforeReadOnly,
      "A read-only host opened a terminal",
    );

    const stageScroll = host.querySelector<HTMLElement>(".world-stage-scroll")!;
    const alignment = host.querySelector<HTMLSelectElement>(
      ".world-office-toolbar select",
    );
    const titleMode = host.querySelectorAll<HTMLSelectElement>(
      ".world-office-toolbar select",
    )[1];
    check(
      alignment?.value === "right" && titleMode?.value === "compact",
      "Office layout preferences were not restored",
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

    const metricsButton = host.querySelector<HTMLButtonElement>(
      ".world-office-metrics-button",
    );
    metricsButton?.click();
    await waitFor(
      () =>
        document.querySelector(
          '[role="dialog"][aria-label="Office metrics settings"]',
        ) !== null,
      "Office metrics settings did not open",
    );
    const metricsDialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Office metrics settings"]',
    )!;
    const prometheusInput =
      metricsDialog.querySelector<HTMLInputElement>('input[type="url"]')!;
    await waitFor(
      () => !prometheusInput.disabled,
      "Office metrics settings did not finish loading",
    );
    check(
      prometheusInput.value === "http://metrics.example.test/",
      "Office metrics settings did not show the service configuration",
    );
    enterText(prometheusInput, "http://replacement.example.test");
    if (metricsDialog instanceof HTMLFormElement) metricsDialog.requestSubmit();
    await waitFor(
      () =>
        metricsDialog.textContent?.includes("Prometheus provider saved.") ===
        true,
      "Office metrics settings did not save through the World service",
    );
    metricsDialog
      .querySelector<HTMLButtonElement>(".world-observability-actions .ghost")
      ?.click();
    await waitFor(
      () =>
        metricsDialog.textContent?.includes(
          "Not configured; Economy shows no provider data.",
        ) === true,
      "Office metrics settings did not disable the provider",
    );
    check(
      host.querySelector("canvas[data-office-canvas='true']") !== null &&
        host.querySelector(".world-semantic-target") !== null,
      "Disabling optional observability disrupted the Office topology",
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
    worldLocalStorage.removeItem(OFFICE_PREFERENCES_KEY);
  }
}

run()
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
