import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient, type TerminalPush } from "../api";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import { __storeTesting, store } from "../store";
import type { Pane, PaneLayout, Tab, Workspace } from "../types";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import WorldFoundationApp from "./WorldFoundationApp";
import { worldRuntimeStore } from "./runtimeStore";

const failures: string[] = [];
const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
async function until(condition: () => unknown, message: string) {
  for (let index = 0; index < 200; index += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error(
    `Timed out: ${message}; selected=${store.get().selectedPaneId}; inspectors=${document.querySelectorAll(".workspace-inspector").length}; rail=${document.querySelector(".world-context-rail")?.className}; text=${document.body.textContent?.slice(-1200)}; calls=${JSON.stringify(calls.slice(-12))}`,
  );
}

const workspaceBase: Workspace = {
  workspace_id: "studio",
  number: 1,
  label: "Studio",
  focused: true,
  pane_count: 2,
  tab_count: 2,
  active_tab_id: "work",
  agent_status: "working",
  cwd: "/repo",
};
const tabs: Tab[] = [
  {
    tab_id: "work",
    workspace_id: workspaceBase.workspace_id,
    number: 1,
    label: "Builder",
    focused: true,
    pane_count: 1,
    agent_status: "working",
  },
  {
    tab_id: "review",
    workspace_id: workspaceBase.workspace_id,
    number: 2,
    label: "Reviewer",
    focused: false,
    pane_count: 1,
    agent_status: "idle",
  },
];
const panes: Pane[] = [
  {
    pane_id: "builder-pane",
    terminal_id: "builder-terminal",
    workspace_id: workspaceBase.workspace_id,
    tab_id: tabs[0]!.tab_id,
    focused: true,
    agent: "builder",
    display_agent: "Builder",
    agent_status: "working",
    revision: 1,
  },
  {
    pane_id: "reviewer-pane",
    terminal_id: "reviewer-terminal",
    workspace_id: workspaceBase.workspace_id,
    tab_id: tabs[1]!.tab_id,
    focused: false,
    agent: "reviewer",
    display_agent: "Reviewer",
    agent_status: "idle",
    revision: 1,
  },
];
let focusedPaneId = panes[0].pane_id;
let focusedTabId = tabs[0]!.tab_id;
let worldRevision = 1;
let runtimeGeneration = 7;
let delayedPaneGet: { paneId: string; promise: Promise<void> } | null = null;
let rejectNextPaneGetId: string | null = null;
let rejectedPaneGets = 0;
let agents: Record<string, unknown>[] = [
  {
    pane_id: "reviewer-pane",
    terminal_id: "reviewer-terminal",
    agent: "reviewer",
    agent_session: { agent: "reviewer", kind: "id", value: "review-a" },
  },
];
const terminalListeners = new Set<(push: TerminalPush) => void>();

function currentPanes() {
  return panes.map((pane) => ({
    ...pane,
    focused: pane.pane_id === focusedPaneId,
  }));
}

function currentTabs() {
  return tabs.map((candidate) => ({
    ...candidate,
    focused: candidate.tab_id === focusedTabId,
  }));
}

function currentWorkspace() {
  return {
    ...workspaceBase,
    pane_count: panes.length,
    tab_count: tabs.length,
    active_tab_id: focusedTabId,
  };
}

function layout(): PaneLayout {
  return {
    workspace_id: workspaceBase.workspace_id,
    tab_id: focusedTabId,
    zoomed: false,
    area: { x: 0, y: 0, width: 160, height: 48 },
    focused_pane_id: focusedPaneId,
    panes: currentPanes()
      .filter((pane) => pane.tab_id === focusedTabId)
      .map((pane, index) => ({
        pane_id: pane.pane_id,
        focused: pane.focused,
        rect: { x: index * 80, y: 0, width: 80, height: 48 },
      })),
    splits: [],
  };
}

const client: ConnectionClient = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 7,
  call: async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "world.snapshot") {
      return {
        revision: worldRevision,
        observed_at: Date.now(),
        truncated_connections: false,
        omitted_connections: 0,
        connections: [
          {
            connection_id: "local",
            label: "Local",
            source: "test",
            is_default: true,
            state: "ready",
            generation: runtimeGeneration,
            snapshot_generation: runtimeGeneration,
            stale: false,
            actionable: true,
            snapshot: {
              workspaces: [currentWorkspace()],
              tabs: currentTabs(),
              panes: currentPanes(),
              agents,
            },
          },
        ],
      };
    }
    if (method === "pane.get") {
      const paneId = String(params.pane_id ?? "");
      if (delayedPaneGet?.paneId === paneId) {
        await delayedPaneGet.promise;
      }
      if (rejectNextPaneGetId === paneId) {
        rejectNextPaneGetId = null;
        rejectedPaneGets += 1;
        throw new Error("Synthetic pane focus rejection");
      }
      const pane = panes.find((candidate) => candidate.pane_id === paneId);
      if (pane) {
        focusedPaneId = pane.pane_id;
        focusedTabId = pane.tab_id;
      }
      return pane ? { pane: { ...pane, focused: true } } : {};
    }
    if (method === "workspace.list") {
      return { navigation_mode: "shared", workspaces: [currentWorkspace()] };
    }
    if (method === "tab.list") return { tabs: currentTabs() };
    if (method === "pane.list") return { panes: currentPanes() };
    if (method === "tab.create") {
      const number = tabs.length + 1;
      const createdTab: Tab = {
        tab_id: `created-tab-${number}`,
        workspace_id: workspaceBase.workspace_id,
        number,
        label: String(number),
        focused: true,
        pane_count: 1,
        agent_status: "idle",
      };
      const createdPane: Pane = {
        pane_id: `created-pane-${number}`,
        terminal_id: `created-terminal-${number}`,
        workspace_id: workspaceBase.workspace_id,
        tab_id: createdTab.tab_id,
        focused: true,
        agent_status: "idle",
        revision: 1,
      };
      tabs.push(createdTab);
      panes.push(createdPane);
      worldRevision += 1;
      focusedTabId = createdTab.tab_id;
      focusedPaneId = createdPane.pane_id;
      rejectNextPaneGetId = createdPane.pane_id;
      return {
        type: "tab_created",
        tab: createdTab,
        root_pane: createdPane,
      };
    }
    if (method === "tab.rename") {
      const renamed = tabs.find(
        (candidate) => candidate.tab_id === String(params.tab_id ?? ""),
      );
      if (renamed) renamed.label = String(params.label ?? renamed.label);
      return {};
    }
    if (method === "tab.focus") {
      const tabId = String(params.tab_id ?? "");
      const targetTab = tabs.find((candidate) => candidate.tab_id === tabId);
      const targetPane =
        panes.find(
          (candidate) =>
            candidate.tab_id === tabId && candidate.pane_id === focusedPaneId,
        ) ?? panes.find((candidate) => candidate.tab_id === tabId);
      if (targetTab && targetPane) {
        focusedTabId = targetTab.tab_id;
        focusedPaneId = targetPane.pane_id;
      }
      return {};
    }
    if (method === "agent.list") return { agents: [] };
    if (method === "pane.layout") return { layout: layout() };
    if (method === "file.list") {
      return {
        workspace_id: workspaceBase.workspace_id,
        root: "/repo",
        checkout_path: "/repo",
        path: "",
        entries: [],
        truncated: false,
      };
    }
    if (method === "git.diff_summary") {
      return {
        workspace_id: workspaceBase.workspace_id,
        entries: [],
        counts: {},
      };
    }
    if (method === "terminal.attach") {
      const terminalId = String(params.terminal_id ?? "");
      for (const listener of terminalListeners) {
        listener({
          connection_id: client.connectionId,
          connection_generation: runtimeGeneration,
          terminal_id: terminalId,
          width: Number(params.cols ?? 96),
          height: Number(params.rows ?? 26),
          full: true,
          bytes: btoa(`${terminalId}\r\n`),
        });
      }
      return {};
    }
    return {};
  },
};

function agentTarget(label: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ].find((button) => button.getAttribute("aria-label")?.includes(label));
}

function graphTarget(label: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".world-spatial-graph-select",
    ),
  ].find((button) => button.querySelector("strong")?.textContent === label);
}

function terminalInput(scope: ParentNode = document) {
  return scope.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
}

function sendKey(input: HTMLTextAreaElement) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      keyCode: 65,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function run() {
  history.replaceState(null, "", "/office");
  document.body.style.margin = "0";
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  store.init = () => {};
  bridge.connection = () => client;
  bridge.call = client.call;
  bridge.onStatus = (listener) => {
    listener("connected");
    return () => {};
  };
  bridge.onControl = () => () => {};
  bridge.onEvent = () => () => {};
  bridge.onTerminal = (listener) => {
    terminalListeners.add(listener);
    return () => terminalListeners.delete(listener);
  };
  bridge.onTerminalClipboard = () => () => {};
  bridge.onTerminalClosed = () => () => {};
  await worldRuntimeStore.refresh();
  __storeTesting.replaceState({
    ...store.get(),
    status: "connected",
    activeConnectionId: client.connectionId,
    defaultConnectionId: client.connectionId,
    connectionGeneration: client.generation,
    serverRuntimeGeneration: client.serverRuntimeGeneration,
    navigationMode: "shared",
    connections: [
      {
        id: client.connectionId,
        label: "Local",
        source: "test",
        is_default: true,
        state: "ready",
        generation: 7,
      },
    ],
    workspaces: [currentWorkspace()],
    tabs: currentTabs(),
    panes: currentPanes(),
    layout: layout(),
    selectedPaneId: focusedPaneId,
    lastRefresh: Date.now(),
  });

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<WorldFoundationApp />));

  await until(
    () => window.__HERDR_WORLD_RENDERER__?.ready === true,
    "Office renderer",
  );
  check(
    document.querySelector(".world-status-header") === null,
    "the retired Visual Control Plane header still consumes Office height",
  );
  check(
    Boolean(document.querySelector(".world-topbar-status")),
    "World status was not moved into the inherited top bar",
  );
  const topbarHost = document.querySelector<HTMLElement>(
    ".connection-switcher",
  );
  const topbarView = document.querySelector<HTMLElement>(
    ".world-primary-view-select",
  );
  const topbarDetails = document.querySelector<HTMLElement>(
    ".world-topbar-status",
  );
  const topbarActions = document.querySelector<HTMLElement>(".command-trigger");
  const topbarMenu = document.querySelector<HTMLElement>(".menu-button");
  const precedes = (left: Element | null, right: Element | null) =>
    Boolean(
      left &&
        right &&
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  check(
    precedes(topbarHost, topbarView) &&
      precedes(topbarView, topbarDetails) &&
      precedes(topbarDetails, topbarActions) &&
      precedes(topbarActions, topbarMenu),
    "top bar did not order host, view, details, Actions and Menu",
  );
  check(
    document
      .querySelector(".world-control-plane")
      ?.closest(".workspace-terminal-surface") !== null,
    "Office did not reuse the Spaces workspace frame",
  );
  check(
    (document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0) >
      100,
    "Office did not retain the Spaces workspace navigator",
  );
  const sharedNavigator = document.querySelector<HTMLElement>(".sidebar");
  const hideNavigatorButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Hide workspace navigator"]',
  );
  check(
    Boolean(hideNavigatorButton),
    "shared workspace navigator did not expose a hide control",
  );
  hideNavigatorButton?.click();
  await until(
    () =>
      sharedNavigator && getComputedStyle(sharedNavigator).display === "none",
    "hidden workspace navigator",
  );
  const showNavigatorButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Show workspace navigator"]',
  );
  check(
    Boolean(showNavigatorButton),
    "hidden workspace navigator did not expose a restore control",
  );
  showNavigatorButton?.click();
  await until(
    () =>
      sharedNavigator && getComputedStyle(sharedNavigator).display !== "none",
    "restored workspace navigator",
  );
  topbarMenu?.click();
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Zen mode"]',
      ),
    "Zen mode setting",
  );
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Zen mode"]')
    ?.click();
  await until(
    () => document.querySelector(".app")?.classList.contains("zen"),
    "Zen mode",
  );
  await settle();
  check(
    Boolean(
      sharedNavigator && getComputedStyle(sharedNavigator).position === "fixed",
    ),
    "Zen mode did not detach the shared workspace navigator as an overlay",
  );
  if (sharedNavigator) sharedNavigator.style.top = "2000px";
  await until(
    () =>
      Boolean(
        sharedNavigator && sharedNavigator.getBoundingClientRect().right <= 8,
      ),
    "collapsed Zen workspace navigator",
  );
  check(
    Boolean(
      sharedNavigator && sharedNavigator.getBoundingClientRect().right <= 8,
    ),
    "Zen mode did not collapse the workspace navigator to its left-edge reveal target",
  );
  check(
    !document.querySelector('button[aria-label="Show workspace navigator"]'),
    "Zen mode exposed the ordinary navigator restore control",
  );
  sharedNavigator?.style.removeProperty("top");
  document.querySelector<HTMLElement>(".workspace-tree-panel")?.focus();
  await until(
    () =>
      Boolean(
        sharedNavigator &&
          sharedNavigator.getBoundingClientRect().left >= -1 &&
          sharedNavigator.getBoundingClientRect().width > 100,
      ),
    "focused Zen workspace navigator",
  );
  check(
    Boolean(
      sharedNavigator &&
        sharedNavigator.getBoundingClientRect().left >= -1 &&
        sharedNavigator.getBoundingClientRect().width > 100,
    ),
    "the Zen workspace navigator did not reveal from the left edge on focus",
  );
  document.body.tabIndex = -1;
  document.body.focus();
  if (sharedNavigator) sharedNavigator.style.top = "2000px";
  await until(
    () =>
      Boolean(
        sharedNavigator && sharedNavigator.getBoundingClientRect().right <= 8,
      ),
    "recollapsed Zen workspace navigator",
  );
  check(
    Boolean(
      sharedNavigator && sharedNavigator.getBoundingClientRect().right <= 8,
    ),
    "the Zen workspace navigator did not collapse after losing focus",
  );
  sharedNavigator?.style.removeProperty("top");
  topbarMenu?.click();
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Zen mode"]',
      ),
    "Zen mode setting while active",
  );
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Zen mode"]')
    ?.click();
  await until(
    () => !document.querySelector(".app")?.classList.contains("zen"),
    "leaving Zen mode",
  );
  check(
    Boolean(
      sharedNavigator && getComputedStyle(sharedNavigator).display !== "none",
    ),
    "leaving Zen mode did not restore the prior navigator state",
  );
  const annotationsButton = [
    ...document.querySelectorAll<HTMLButtonElement>(".tabbar-utilities button"),
  ].find((button) => button.textContent?.includes("Annotations"));
  check(Boolean(annotationsButton), "Office did not retain annotations");
  annotationsButton?.click();
  await until(
    () => document.querySelector('[aria-label="Review annotations"]'),
    "shared annotations panel",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="Review annotations"] button[aria-label="Close review feedback"]',
    )
    ?.click();
  const viewSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="World view"]',
  )!;
  viewSelect.value = "graph";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".world-spatial-graph-shell"),
    "Graph in shared frame",
  );
  check(
    document.querySelector(".sidebar") === sharedNavigator,
    "Graph replaced the shared workspace navigator",
  );
  check(
    getComputedStyle(
      document.querySelector<HTMLElement>(".world-spatial-graph-outline")!,
    ).display === "none",
    "Graph retained a competing desktop hierarchy",
  );
  viewSelect.value = "tree";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".world-connected-tree-shell"),
    "Tree in shared frame",
  );
  check(
    document.querySelector(".sidebar") === sharedNavigator,
    "Tree replaced the shared workspace navigator",
  );
  viewSelect.value = "office";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      window.__HERDR_WORLD_RENDERER__?.ready === true && agentTarget("Builder"),
    "Office after shared-frame navigation",
  );
  const reviewerNavigatorRow = [
    ...document.querySelectorAll<HTMLElement>(".sidebar .agent-row"),
  ].find((row) => row.getAttribute("aria-label")?.startsWith("reviewer pane"));
  check(
    Boolean(reviewerNavigatorRow),
    "shared navigator omitted the Reviewer agent",
  );
  const delayedReviewerFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedReviewerFocus.promise,
  };
  flushSync(() => reviewerNavigatorRow?.click());
  await settle();
  check(
    !document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("Reviewer"),
    "shared navigator admitted Reviewer before its exact focus completed",
  );
  check(
    store.get().selectedPaneId === "builder-pane",
    "shared navigator changed the selected pane before exact focus completed",
  );
  delayedReviewerFocus.resolve();
  delayedPaneGet = null;
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") &&
      store.get().selectedPaneId === "reviewer-pane",
    "shared navigator exact Reviewer focus",
  );
  const builderTopTab = [
    ...document.querySelectorAll<HTMLElement>(".tabbar-tab"),
  ].find((candidate) => candidate.textContent?.includes("Builder"));
  const reviewerTopTab = [
    ...document.querySelectorAll<HTMLElement>(".tabbar-tab"),
  ].find((candidate) => candidate.textContent?.includes("Reviewer"));
  check(
    Boolean(builderTopTab && reviewerTopTab),
    "shared workspace tab strip omitted an agent tab",
  );
  const tabFocusBeforeBuilder = calls.filter(
    ({ method }) => method === "tab.focus",
  ).length;
  builderTopTab?.click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      store.get().selectedPaneId === "builder-pane",
    "top workspace tab exact Builder Inspector",
  );
  check(
    calls.filter(({ method }) => method === "tab.focus").length ===
      tabFocusBeforeBuilder + 1,
    "top workspace tab ran an unqualified focus before World admission",
  );
  const tabFocusBeforeReviewer = calls.filter(
    ({ method }) => method === "tab.focus",
  ).length;
  reviewerTopTab?.click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") &&
      store.get().selectedPaneId === "reviewer-pane",
    "top workspace tab exact Reviewer Inspector",
  );
  check(
    calls.filter(({ method }) => method === "tab.focus").length ===
      tabFocusBeforeReviewer + 1,
    "second top workspace tab ran an unqualified focus before World admission",
  );
  const createSeatButton = document.querySelector<HTMLButtonElement>(
    ".world-new-seat-canvas-action:not(:disabled)",
  );
  check(Boolean(createSeatButton), "Office room omitted its new-seat action");
  createSeatButton?.click();
  await until(
    () => calls.some(({ method }) => method === "tab.create"),
    "Office seat creation",
  );
  await worldRuntimeStore.refresh();
  await until(
    () =>
      store.get().selectedPaneId === "created-pane-3" &&
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("terminal"),
    "created seat exact terminal Inspector after transient focus rejection",
  );
  check(
    rejectedPaneGets === 1 &&
      calls.filter(
        ({ method, params }) =>
          method === "pane.get" && params.pane_id === "created-pane-3",
      ).length === 2,
    `created seat did not exercise its bounded exact-focus retry (${rejectedPaneGets}; pane.get=${calls.filter(({ method, params }) => method === "pane.get" && params.pane_id === "created-pane-3").length})`,
  );
  await until(() => agentTarget("Builder"), "Builder desk target");
  flushSync(() => agentTarget("Builder")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      document.querySelector(
        '.world-context-rail .workspace-inspector[data-view="terminal"] .workspace-inspector-terminal-portal',
      ),
    "Builder Inspector terminal",
  );
  const rejectedBeforeNavigator = rejectedPaneGets;
  rejectNextPaneGetId = "reviewer-pane";
  flushSync(() => reviewerNavigatorRow?.click());
  await until(
    () => rejectedPaneGets === rejectedBeforeNavigator + 1,
    "rejected shared navigator focus",
  );
  await settle();
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("Builder") === true,
    "rejected navigator focus replaced the admitted Builder Inspector",
  );
  check(
    store.get().selectedPaneId === "builder-pane",
    "rejected navigator focus changed the selected pane",
  );
  const dockedRail = document.querySelector<HTMLElement>(
    ".world-context-rail.has-inspector",
  )!;
  const dockedMoveHandle = dockedRail.querySelector<HTMLElement>(
    ".workspace-inspector-agent-identity",
  )!;
  check(
    dockedMoveHandle.closest(
      '.workspace-inspector-head[title="Drag to move docked Inspector"]',
    ) !== null,
    "docked Inspector did not expose its header as a drag surface",
  );
  const dockedBeforeMove = dockedRail.getBoundingClientRect();
  const paneGetsBeforeDockedMove = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  dockedMoveHandle.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 19,
      pointerType: "mouse",
      clientX: dockedBeforeMove.left + 40,
      clientY: dockedBeforeMove.top + 24,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      pointerId: 19,
      pointerType: "mouse",
      clientX: dockedBeforeMove.left,
      clientY: dockedBeforeMove.top + 48,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 19,
      pointerType: "mouse",
      clientX: dockedBeforeMove.left,
      clientY: dockedBeforeMove.top + 48,
    }),
  );
  await until(
    () => dockedRail.getBoundingClientRect().left <= dockedBeforeMove.left - 39,
    "drag-moved docked Inspector",
  );
  check(
    calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeDockedMove,
    "moving the docked Inspector focused its terminal",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail .workspace-inspector button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "Builder floating Inspector",
  );
  await until(
    () =>
      document.querySelectorAll(".world-intent-connector circle").length === 2,
    "Builder Inspector connector",
  );
  await settle();
  const initialBuilderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  const builderAgentBounds = agentTarget("Builder")!.getBoundingClientRect();
  const initialBuilderWindowBounds =
    initialBuilderWindow.getBoundingClientRect();
  const builderConnectorPoints = [
    ...document.querySelectorAll<SVGCircleElement>(
      ".world-intent-connector circle",
    ),
  ].map((circle) => ({
    x: Number(circle.getAttribute("cx")),
    y: Number(circle.getAttribute("cy")),
  }));
  check(
    Math.abs(
      builderConnectorPoints[0].x -
        (builderAgentBounds.left + builderAgentBounds.right) / 2,
    ) <= 2 &&
      Math.abs(
        builderConnectorPoints[0].y -
          (builderAgentBounds.top + builderAgentBounds.bottom) / 2,
      ) <= 3,
    "floating Inspector connector did not start at the agent centre",
  );
  check(
    Math.abs(builderConnectorPoints[1].x - initialBuilderWindowBounds.right) <=
      2 &&
      Math.abs(
        builderConnectorPoints[1].y -
          (initialBuilderWindowBounds.top + initialBuilderWindowBounds.bottom) /
            2,
      ) <= 2,
    "floating Inspector connector did not meet the window on its facing right edge",
  );
  check(
    !document
      .querySelector(".world-context-rail")
      ?.classList.contains("has-inspector"),
    "floating the Inspector left its docked shell visible",
  );
  const builderMoveHandle = initialBuilderWindow.querySelector<HTMLElement>(
    ".workspace-inspector-agent-identity",
  )!;
  check(
    builderMoveHandle.closest<HTMLElement>(
      '.workspace-inspector-head[title="Drag to move Inspector"]',
    ) !== null,
    "floating Inspector did not expose its header as a drag-to-move surface",
  );
  const builderWindowBeforeMove = initialBuilderWindow.getBoundingClientRect();
  const moveDelta = {
    x: builderWindowBeforeMove.right + 32 <= window.innerWidth - 8 ? 32 : -32,
    y: builderWindowBeforeMove.top >= 32 ? -24 : 24,
  };
  builderMoveHandle.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 7,
      pointerType: "mouse",
      clientX: builderWindowBeforeMove.left + 40,
      clientY: builderWindowBeforeMove.top + 24,
    }),
  );
  initialBuilderWindow.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      pointerId: 7,
      pointerType: "mouse",
      clientX: builderWindowBeforeMove.left + 40 + moveDelta.x,
      clientY: builderWindowBeforeMove.top + 24 + moveDelta.y,
    }),
  );
  initialBuilderWindow.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: builderWindowBeforeMove.left + 40 + moveDelta.x,
      clientY: builderWindowBeforeMove.top + 24 + moveDelta.y,
    }),
  );
  await until(() => {
    const moved = initialBuilderWindow.getBoundingClientRect();
    return (
      Math.abs(moved.left - builderWindowBeforeMove.left - moveDelta.x) <= 1 &&
      Math.abs(moved.top - builderWindowBeforeMove.top - moveDelta.y) <= 1
    );
  }, "drag-moved live Builder Inspector");
  const builderResizeGrip = initialBuilderWindow.querySelector<HTMLElement>(
    'button[aria-label="Resize Inspector window"]',
  )!;
  const builderResizeGripBounds = builderResizeGrip.getBoundingClientRect();
  check(
    builderResizeGripBounds.width >= 32 &&
      builderResizeGripBounds.height >= 32 &&
      getComputedStyle(builderResizeGrip).cursor === "nwse-resize" &&
      builderResizeGrip.querySelector("svg") !== null,
    "floating Inspector did not expose a visible drag-to-resize handle",
  );
  const builderWindowBeforeResize =
    initialBuilderWindow.getBoundingClientRect();
  const paneGetsBeforeResize = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const resizeDelta = { x: -40, y: -32 };
  builderResizeGrip.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 6,
      pointerType: "mouse",
      clientX: builderWindowBeforeResize.right - 2,
      clientY: builderWindowBeforeResize.bottom - 2,
    }),
  );
  initialBuilderWindow.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      pointerId: 6,
      pointerType: "mouse",
      clientX: builderWindowBeforeResize.right - 2 + resizeDelta.x,
      clientY: builderWindowBeforeResize.bottom - 2 + resizeDelta.y,
    }),
  );
  initialBuilderWindow.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 6,
      pointerType: "mouse",
      clientX: builderWindowBeforeResize.right - 2 + resizeDelta.x,
      clientY: builderWindowBeforeResize.bottom - 2 + resizeDelta.y,
    }),
  );
  await until(() => {
    const resized = initialBuilderWindow.getBoundingClientRect();
    return (
      resized.width <= builderWindowBeforeResize.width - 39 &&
      resized.height <= builderWindowBeforeResize.height - 31
    );
  }, "drag-resized Builder Inspector");
  check(
    calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeResize,
    "resizing the floating Inspector focused its terminal",
  );

  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer"),
    "Reviewer Inspector",
  );
  const builderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  const builderInspector = builderWindow.querySelector<HTMLElement>(
    ".workspace-inspector",
  )!;
  panes[1]!.agent_status = "done";
  panes[1]!.revision += 1;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () => document.querySelector(".world-completion-notices button"),
    "Reviewer completion for existing Inspector",
  );
  const rejectedBeforeCompletion = rejectedPaneGets;
  rejectNextPaneGetId = "reviewer-pane";
  document
    .querySelector<HTMLButtonElement>(".world-completion-notices button")!
    .click();
  await until(
    () => rejectedPaneGets === rejectedBeforeCompletion + 1,
    "existing Inspector completion focus rejection",
  );
  check(
    document.querySelector(".world-completion-notices button") !== null,
    "failed existing-Inspector activation acknowledged its completion",
  );
  panes[1]!.agent_status = "idle";
  panes[1]!.revision += 1;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () => document.querySelector(".world-completion-notices button") === null,
    "Reviewer completion reset",
  );
  check(
    builderWindow.querySelectorAll(".workspace-inspector-head").length === 1,
    "floating Inspector rendered more than one header",
  );
  check(
    !builderWindow.querySelector(".world-floating-terminal-header"),
    "floating Inspector retained the legacy outer window header",
  );
  check(
    Math.abs(
      builderWindow.getBoundingClientRect().width -
        builderInspector.getBoundingClientRect().width,
    ) <= 2 &&
      Math.abs(
        builderWindow.getBoundingClientRect().height -
          builderInspector.getBoundingClientRect().height,
      ) <= 2,
    `floating Inspector did not fill its single window surface: window=${JSON.stringify(
      builderWindow.getBoundingClientRect().toJSON(),
    )} inspector=${JSON.stringify(
      builderInspector.getBoundingClientRect().toJSON(),
    )}`,
  );
  const builderXterm = builderWindow.querySelector<HTMLElement>(".xterm")!;
  builderXterm.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }),
  );
  await until(
    () => store.get().selectedPaneId === "builder-pane",
    "floating Builder Inspector focus",
  );
  const builderInput = terminalInput(builderWindow)!;
  builderInput.focus();
  sendKey(builderInput);
  await until(
    () =>
      calls.some(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "builder-terminal",
      ),
    "floating Builder Inspector terminal input",
  );

  builderWindow
    .querySelector<HTMLButtonElement>('[role="tab"]:nth-of-type(2)')!
    .click();
  await until(
    () =>
      builderWindow
        .querySelector(".workspace-inspector")
        ?.getAttribute("data-view") === "files",
    "Builder floating Inspector Files view",
  );

  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail .workspace-inspector button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) &&
      !document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector"),
    "Reviewer floating Inspector",
  );
  const reviewerFloatingWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Reviewer Inspector"]',
  )!;
  const builderTerminalTab = builderWindow.querySelector<HTMLButtonElement>(
    '[role="tab"]:first-of-type',
  )!;
  builderTerminalTab.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 4,
      pointerType: "mouse",
    }),
  );
  builderTerminalTab.click();
  await until(
    () =>
      store.get().selectedPaneId === "builder-pane" &&
      builderInspector.getAttribute("data-view") === "terminal",
    "background Builder Inspector control focus",
  );
  const builderFilesTab = builderWindow.querySelector<HTMLButtonElement>(
    '[role="tab"]:nth-of-type(2)',
  )!;
  builderFilesTab.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 5,
      pointerType: "mouse",
    }),
  );
  builderFilesTab.click();
  await until(
    () => builderInspector.getAttribute("data-view") === "files",
    "Builder Files view restoration",
  );
  reviewerFloatingWindow
    .querySelector<HTMLButtonElement>('button[aria-label="Dock Inspector"]')!
    .click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") &&
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "Reviewer redock before Inspector swap",
  );
  await settle();
  const terminalLifecycleBeforeSwap = calls.filter(
    ({ method }) =>
      method === "terminal.attach" || method === "terminal.detach",
  ).length;
  const paneFocusBeforeSwap = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;

  builderWindow
    .querySelector<HTMLButtonElement>('button[aria-label="Dock Inspector"]')!
    .click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      !document.querySelector(
        '[role="dialog"][aria-label="Builder Inspector"]',
      ) &&
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) &&
      document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector") &&
      (document
        .querySelector(".workspace-inspector-body")
        ?.getBoundingClientRect().height ?? 0) > 40 &&
      document.querySelector(
        '.world-context-rail .workspace-inspector[data-view="files"]',
      ),
    "whole Inspector dock swap",
  );
  const inspector = document.querySelector<HTMLElement>(
    '.world-context-rail .workspace-inspector[data-view="files"]',
  );
  check(inspector !== null, "docking did not restore the Inspector");
  check(
    (inspector
      ?.querySelector(".workspace-inspector-body")
      ?.getBoundingClientRect().height ?? 0) > 40,
    "docked Inspector exposed only the agent identity header",
  );
  inspector!
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Dock Inspector at bottom"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector(".world-inspector-stage.inspector-dock-bottom"),
    "bottom-docked Inspector",
  );
  inspector!
    .querySelector<HTMLButtonElement>('button[aria-label="Expand Inspector"]')!
    .click();
  await until(
    () =>
      document.querySelector(".world-inspector-stage.is-inspector-expanded"),
    "expanded Inspector",
  );
  inspector!
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Restore Inspector dock"]',
    )!
    .click();
  inspector!
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Dock Inspector at right"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector(".world-inspector-stage.inspector-dock-right") &&
      !document.querySelector(".world-inspector-stage.is-inspector-expanded"),
    "restored right-docked Inspector",
  );

  const reviewerWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Reviewer Inspector"]',
  )!;
  reviewerWindow.querySelector<HTMLElement>(".xterm")!.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 2,
      pointerType: "mouse",
    }),
  );
  await until(
    () => store.get().selectedPaneId === "reviewer-pane",
    "floating Reviewer Inspector focus",
  );
  await settle();
  const reviewerInput = terminalInput(reviewerWindow)!;
  reviewerInput.focus();
  sendKey(reviewerInput);
  await until(
    () =>
      calls.some(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "reviewer-terminal",
      ),
    "swapped Reviewer Inspector terminal input",
  );
  check(
    calls.filter(
      ({ method }) =>
        method === "terminal.attach" || method === "terminal.detach",
    ).length === terminalLifecycleBeforeSwap,
    "docked Inspector swap recreated a terminal owner",
  );
  check(
    calls.filter(
      ({ method, params }) =>
        method === "pane.get" && params.pane_id === "builder-pane",
    ).length ===
      paneFocusBeforeSwap + 1,
    "docked Inspector swap did not admit its exact pane once",
  );
  reviewerWindow
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close floating Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) &&
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "closing only the floating Reviewer Inspector",
  );

  inspector!
    .querySelector<HTMLButtonElement>('[role="tab"]:first-of-type')!
    .click();
  await until(
    () =>
      inspector?.getAttribute("data-view") === "terminal" &&
      terminalInput(inspector ?? document),
    "Builder docked terminal view",
  );
  inspector!.querySelector<HTMLElement>(".xterm")!.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 3,
      pointerType: "mouse",
    }),
  );
  await until(
    () => store.get().selectedPaneId === "builder-pane",
    "docked Builder Inspector focus",
  );
  await settle();
  const dockedInput = terminalInput(inspector ?? document)!;
  dockedInput.focus();
  const builderInputsBefore = calls.filter(
    ({ method, params }) =>
      method === "terminal.input" && params.terminal_id === "builder-terminal",
  ).length;
  sendKey(dockedInput);
  await until(
    () =>
      calls.filter(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "builder-terminal",
      ).length > builderInputsBefore,
    "docked Builder terminal input",
  );
  check(
    document.activeElement === dockedInput,
    "docked terminal did not retain keyboard focus",
  );

  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer"),
    "Reviewer replacement Inspector",
  );
  check(
    !document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "ordinary A-to-B selection unexpectedly floated the replaced Inspector",
  );
  const replacementReviewerInput = terminalInput(
    document.querySelector(".world-context-rail") ?? document,
  );
  check(
    Boolean(replacementReviewerInput),
    "Reviewer replacement did not expose its docked terminal input",
  );
  if (replacementReviewerInput) {
    const reviewerInputsBefore = calls.filter(
      ({ method, params }) =>
        method === "terminal.input" &&
        params.terminal_id === "reviewer-terminal",
    ).length;
    replacementReviewerInput.focus();
    sendKey(replacementReviewerInput);
    await until(
      () =>
        calls.filter(
          ({ method, params }) =>
            method === "terminal.input" &&
            params.terminal_id === "reviewer-terminal",
        ).length > reviewerInputsBefore,
      "Reviewer replacement terminal identity",
    );
  }

  viewSelect.value = "graph";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".world-spatial-graph-shell"),
    "Graph replacement check",
  );
  await until(() => graphTarget("Builder"), "Builder Graph target");
  flushSync(() => graphTarget("Builder")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      terminalInput(document.querySelector(".world-context-rail") ?? document),
    "Builder Graph Inspector replacement",
  );
  check(
    !document.querySelector('[role="dialog"][aria-label="Reviewer Inspector"]'),
    "Graph A-to-B selection unexpectedly floated the replaced Inspector",
  );
  const graphBuilderInput = terminalInput(
    document.querySelector(".world-context-rail") ?? document,
  )!;
  const graphBuilderInputsBefore = calls.filter(
    ({ method, params }) =>
      method === "terminal.input" && params.terminal_id === "builder-terminal",
  ).length;
  graphBuilderInput.focus();
  sendKey(graphBuilderInput);
  await until(
    () =>
      calls.filter(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "builder-terminal",
      ).length > graphBuilderInputsBefore,
    "Builder Graph terminal identity",
  );

  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail .workspace-inspector button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "Builder floating Inspector before Spaces handoff",
  );
  await until(() => graphTarget("Reviewer"), "Reviewer Graph target");
  flushSync(() => graphTarget("Reviewer")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer"),
    "Reviewer docked Inspector before Spaces handoff",
  );
  await settle();
  const persistentControlPlane = document.querySelector(".world-control-plane");
  const persistentReviewerInspector = document.querySelector(
    ".world-context-rail .workspace-inspector",
  );
  const terminalAttachesBeforeSpaces = calls.filter(
    ({ method }) => method === "terminal.attach",
  ).length;
  const terminalDetachesBeforeSpaces = calls.filter(
    ({ method }) => method === "terminal.detach",
  ).length;
  viewSelect.value = "spaces";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document
        .querySelector(".workspace-surface-owner")
        ?.classList.contains("is-inactive") &&
      document.querySelector(".terminal-empty"),
    "Spaces handoff",
  );
  await settle();
  check(
    document.querySelector(".world-control-plane") === persistentControlPlane &&
      document.querySelector(".world-context-rail .workspace-inspector") ===
        persistentReviewerInspector,
    "Spaces handoff destroyed the live Inspector owner",
  );
  check(
    persistentReviewerInspector?.getBoundingClientRect().height !== 0,
    "Spaces handoff hid the retained Inspector",
  );
  check(
    calls.filter(({ method }) => method === "terminal.attach").length ===
      terminalAttachesBeforeSpaces &&
      calls.filter(({ method }) => method === "terminal.detach").length ===
        terminalDetachesBeforeSpaces,
    "Spaces handoff reattached or detached an Inspector terminal",
  );
  viewSelect.value = "graph";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document.querySelector(".world-spatial-graph-shell") &&
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") &&
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "qualified Inspector conversations after Spaces handoff",
  );
  await settle();
  check(
    document.querySelector(".world-control-plane") === persistentControlPlane &&
      calls.filter(({ method }) => method === "terminal.attach").length ===
        terminalAttachesBeforeSpaces &&
      calls.filter(({ method }) => method === "terminal.detach").length ===
        terminalDetachesBeforeSpaces,
    "returning from Spaces replaced the Inspector terminal owner",
  );
  await until(() => graphTarget("Reviewer"), "Reviewer before retirement");
  flushSync(() => graphTarget("Reviewer")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer"),
    "selected Reviewer before retirement",
  );
  await settle();

  const reviewerInspector = document.querySelector<HTMLElement>(
    ".world-context-rail .workspace-inspector",
  )!;
  reviewerInspector
    .querySelector<HTMLButtonElement>('[role="tab"]:nth-of-type(2)')!
    .click();
  await until(
    () => reviewerInspector.getAttribute("data-view") === "files",
    "Reviewer Files state before session replacement",
  );
  panes[1]!.display_agent = "Reviewer Next";
  agents = [
    {
      pane_id: "reviewer-pane",
      terminal_id: "reviewer-terminal",
      agent: "reviewer",
      display_agent: "Reviewer Next",
      task_summary: "Reviewing the replacement session",
      agent_session: { agent: "reviewer", kind: "id", value: "review-b" },
    },
  ];
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer Next") &&
      document
        .querySelector(".world-context-rail .workspace-inspector")
        ?.getAttribute("data-view") === "terminal",
    "reconciled replacement Reviewer session",
  );
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector")
      ?.textContent?.includes("Reviewing the replacement session") === true,
    "replacement session did not refresh the Inspector context",
  );

  runtimeGeneration += 1;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () =>
      !document.querySelector(".workspace-inspector") &&
      !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "retired Inspector cleanup",
  );
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  check(
    !document.querySelector(".world-selection-panel"),
    "retiring an open Inspector left its stale identity profile selected",
  );

  root.unmount();
}

run()
  .catch((error) =>
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
