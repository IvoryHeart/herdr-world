import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient, type TerminalPush } from "../api";
import {
  initializeLayoutPreferences,
  updateLayoutPreferences,
} from "../layoutPreferences";
import {
  initializeShortcutPreferences,
  shortcutLabel,
  updateShortcut,
} from "../shortcutPreferences";
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
function enterSearch(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
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
let navigationMode: "shared" | "browser-local" = "shared";
let zoomedFocusedPaneId: string | null = null;
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
  const tabPanes = currentPanes().filter(
    (pane) => pane.tab_id === focusedTabId,
  );
  return {
    workspace_id: workspaceBase.workspace_id,
    tab_id: focusedTabId,
    zoomed: zoomedFocusedPaneId !== null,
    area: { x: 0, y: 0, width: 160, height: 48 },
    focused_pane_id: zoomedFocusedPaneId ?? focusedPaneId,
    panes: tabPanes.map((pane, index) => ({
      pane_id: pane.pane_id,
      focused: pane.focused,
      rect: { x: index * 80, y: 0, width: 80, height: 48 },
    })),
    splits:
      tabPanes.length > 1
        ? [
            {
              id: `${focusedTabId}-split`,
              direction: "right",
              ratio: 0.5,
              rect: { x: 0, y: 0, width: 160, height: 48 },
            },
          ]
        : [],
  };
}

function currentWorldCoverage() {
  const currentPaneRecords = currentPanes();
  const status = {
    working: 0,
    idle: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };
  let agentPanes = 0;
  for (const pane of currentPaneRecords) {
    if (!pane.agent) continue;
    agentPanes += 1;
    const semantic =
      pane.agent_status === "working" ||
      pane.agent_status === "busy" ||
      pane.agent_status === "running"
        ? "working"
        : pane.agent_status === "idle" || pane.agent_status === "waiting"
          ? "idle"
          : pane.agent_status === "blocked" || pane.agent_status === "error"
            ? "blocked"
            : pane.agent_status === "done" || pane.agent_status === "completed"
              ? "done"
              : "unknown";
    status[semantic] += 1;
  }
  return {
    workspaces: 1,
    tabs: currentTabs().length,
    panes: currentPaneRecords.length,
    agent_panes: agentPanes,
    status,
    by_workspace: [
      {
        workspace_id: workspaceBase.workspace_id,
        tabs: currentTabs().length,
        panes: currentPaneRecords.length,
        agent_panes: agentPanes,
        status,
      },
    ],
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
              coverage: currentWorldCoverage(),
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
      return {
        navigation_mode: navigationMode,
        workspaces: [currentWorkspace()],
      };
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
    if (method === "agent_checkout.get") {
      return {
        available: false,
        reason:
          "Agent checkout unavailable: this session has not reported a valid checkout.",
      };
    }
    if (method === "agent_history.get") {
      return {
        status: "ok",
        agent: "reviewer",
        pane_id: "reviewer-pane",
        workspace_id: workspaceBase.workspace_id,
        tab_id: "review",
        updated_at: "2026-01-01T00:00:00Z",
        path: "/repo/.agent-history/reviewer.jsonl",
        history_version: 2,
        mode: "snapshot",
        window_limit: 200,
        cursor: { epoch: "mobile-inspector", revision: 1 },
        entries: [
          {
            id: "review-message",
            role: "assistant",
            kind: "message",
            text: "Review is ready.",
            sent_at: "2026-01-01T00:00:00Z",
          },
        ],
      };
    }
    if (method === "agent_session.get") {
      return {
        status: "ok",
        agent: "reviewer",
        pane_id: "reviewer-pane",
        path: "/repo/.agent-sessions/reviewer.jsonl",
        updated_at: "2026-01-01T00:00:00Z",
        file: { size: 128 },
        stats: { turns: 1, records: 1, token_usage: null },
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
  ].find(
    (button) =>
      !button.disabled && button.getAttribute("aria-label")?.includes(label),
  );
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
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(".world-new-seat-canvas-action")
        ?.disabled === false &&
      document.querySelector<HTMLButtonElement>(".world-new-room-canvas-action")
        ?.disabled === false,
    "initial Office room and seat actions",
  );
  check(
    !calls.some(
      ({ method }) => method === "tab.create" || method === "workspace.create",
    ),
    "Office required a topology mutation before enabling initial room actions",
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
  const topbarActions = document.querySelector<HTMLElement>(
    ".topbar-actions .command-trigger",
  );
  const setShellActionsOpen = async (open: boolean) => {
    const trigger = () =>
      document.querySelector<HTMLButtonElement>(
        ".topbar-actions .command-trigger",
      );
    await until(trigger, "shell Actions trigger");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (
        (trigger()?.getAttribute("aria-expanded") === "true") === open &&
        Boolean(document.querySelector(".command-popover")) === open
      )
        return;
      trigger()?.focus();
      trigger()?.click();
      await settle();
    }
    await until(
      () =>
        (trigger()?.getAttribute("aria-expanded") === "true") === open &&
        Boolean(document.querySelector(".command-popover")) === open,
      `shell Actions ${open ? "opened" : "closed"}`,
    );
  };
  const topbarMenu = document.querySelector<HTMLElement>(".menu-button");
  const toggleTopbarMenu = () =>
    document.querySelector<HTMLButtonElement>(".menu-button")?.click();
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
  await setShellActionsOpen(true);
  await until(
    () => document.querySelector(".command-popover"),
    "Roamgate shell Actions menu in the visual view",
  );
  const shellActionsMenu =
    document.querySelector<HTMLElement>(".command-popover")!;
  const shellMenuBounds = shellActionsMenu.getBoundingClientRect();
  check(
    !topbarActions?.hasAttribute("disabled") &&
      !document.querySelector(".world-visual-actions-trigger") &&
      !document.querySelector(".world-view-toolbar-actions") &&
      shellActionsMenu.textContent?.includes("Arrange windows") === true &&
      shellActionsMenu.textContent?.includes("Pinned only") === true &&
      shellActionsMenu.textContent?.includes("Create workspace") === true &&
      shellActionsMenu.textContent?.includes("Select a visual entity") ===
        true &&
      shellActionsMenu.textContent.indexOf("Create workspace") <
        shellActionsMenu.textContent.indexOf("Arrange windows: Single") &&
      shellMenuBounds.width > 0 &&
      shellMenuBounds.right <= window.innerWidth,
    "shell Actions was replaced, clipped, or missing its native commands and extensions",
  );
  check(
    (document
      .querySelector<HTMLElement>(".world-view-toolbar-search input")
      ?.getBoundingClientRect().width ?? 0) >= 180 &&
      getComputedStyle(topbarDetails!).opacity !== "1" &&
      topbarDetails?.title.includes("spaces") === true,
    "top-bar extras crowded search or made the host summary prominent",
  );
  await setShellActionsOpen(false);
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
  toggleTopbarMenu();
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
  toggleTopbarMenu();
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
  check(
    document.querySelector(".world-office-toolbar") === null,
    "Office settings still consumed a scene toolbar",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Office Inspector opening"]',
      ),
    "Office settings in common menu",
  );
  const inspectorOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Office Inspector opening"]',
  )!;
  check(
    inspectorOpeningSelect.value === "floating" &&
      Boolean(
        document.querySelector<HTMLSelectElement>(
          'select[aria-label="Office room alignment"]',
        ),
      ) &&
      Boolean(
        document.querySelector<HTMLSelectElement>(
          'select[aria-label="Office long room titles"]',
        ),
      ),
    "Office controls were not menu-owned or did not default to Floating",
  );
  toggleTopbarMenu();
  await until(
    () => !document.querySelector(".config-dropdown"),
    "Office settings closed before shell Actions",
  );
  const floatingPreferenceNavigatorRow = [
    ...document.querySelectorAll<HTMLElement>(".sidebar .agent-row"),
  ].find((row) => row.getAttribute("aria-label")?.startsWith("reviewer pane"));
  flushSync(() => floatingPreferenceNavigatorRow?.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") &&
      !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "shared navigator docked Inspector with Floating Office preference",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail button[aria-label="Close Workspace Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector"),
    "close shared navigator Inspector",
  );
  const officeSearch = document.querySelector<HTMLInputElement>(
    'input[placeholder="Search Office"]',
  )!;
  enterSearch(officeSearch, "Local");
  officeSearch
    .closest("form")!
    .dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
  await until(
    () =>
      document
        .querySelector('.world-selection-panel[data-kind="host"]')
        ?.textContent?.includes("Local") &&
      !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "Office host search selection profile",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-selection-panel button[aria-label="Close profile"]',
    )!
    .click();
  flushSync(() => agentTarget("Builder")!.click());
  await until(
    () =>
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "floating preference Builder Inspector",
  );
  await setShellActionsOpen(true);
  await until(
    () =>
      document
        .querySelector(".command-popover")
        ?.textContent?.includes("Open Terminal") &&
      document
        .querySelector(".command-popover")
        ?.textContent?.includes("Pin selected pane"),
    "qualified visual commands in the original shell Actions",
  );
  check(
    document
      .querySelector(".command-popover")
      ?.textContent?.includes("Go to Spaces") === true &&
      document
        .querySelector(".command-popover")
        ?.textContent?.includes("Create workspace") === true,
    "selected visual commands displaced native shell commands",
  );
  await setShellActionsOpen(false);
  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) &&
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 2,
    "floating preference distinct Reviewer Inspector",
  );
  const preferredFloatingWindows = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-label$=" Inspector"]',
    ),
  ];
  const firstPreferredBounds =
    preferredFloatingWindows[0]?.getBoundingClientRect();
  const secondPreferredBounds =
    preferredFloatingWindows[1]?.getBoundingClientRect();
  check(
    Boolean(
      firstPreferredBounds &&
        secondPreferredBounds &&
        Math.abs(firstPreferredBounds.width - secondPreferredBounds.width) <=
          2 &&
        (firstPreferredBounds.left !== secondPreferredBounds.left ||
          firstPreferredBounds.top !== secondPreferredBounds.top) &&
        !document
          .querySelector(".world-context-rail")
          ?.classList.contains("has-inspector"),
    ),
    "Floating mode did not use equally sized cascaded Inspector windows",
  );
  const arrangeWindows = async (label: string) => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Arrange windows"]')!
      .click();
    const getChoice = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="menu"][aria-label="Arrange windows"] [role="menuitem"]',
        ),
      ].find((button) => button.querySelector("strong")?.textContent === label);
    await until(getChoice, `${label} arrangement choice`);
    const choice = getChoice();
    check(
      Boolean(choice) && choice?.getAttribute("aria-disabled") !== "true",
      `${label} arrangement was unavailable: ${choice?.querySelector("small")?.textContent}`,
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Arrange windows"]',
    );
    const bounds = menu?.getBoundingClientRect();
    const hit = bounds
      ? document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + Math.min(24, bounds.height / 2),
        )
      : null;
    check(
      Boolean(
        menu &&
          bounds &&
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight &&
          hit &&
          menu.contains(hit),
      ),
      `${label} arrangement menu was outside the viewport or obscured: ${JSON.stringify(bounds?.toJSON())}`,
    );
    choice?.click();
  };
  const tabBarBounds = document
    .querySelector<HTMLElement>(".tabbar")!
    .getBoundingClientRect();
  const arrangementTriggerBounds = document
    .querySelector<HTMLButtonElement>('button[aria-label="Arrange windows"]')!
    .getBoundingClientRect();
  check(
    arrangementTriggerBounds.right >= tabBarBounds.right - 20,
    `wide desktop did not align Arrange windows with the tab bar's right edge: ${JSON.stringify({ tabBarRight: tabBarBounds.right, arrangementRight: arrangementTriggerBounds.right })}`,
  );
  check(
    shortcutLabel("arrangement.grid") === "Unassigned",
    "arrangement shortcut changed the original shell defaults",
  );
  updateShortcut("arrangement.grid", ["Ctrl+Alt+Shift+5"]);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "5",
      code: "Digit5",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  const shortcutGrid = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-label$=" Inspector"]',
    ),
  ]
    .map((window) => window.getBoundingClientRect())
    .sort((left, right) => left.left - right.left);
  check(
    shortcutGrid.length === 2 &&
      shortcutGrid[0]!.right <= shortcutGrid[1]!.left,
    "Grid keyboard shortcut did not arrange visual Inspectors",
  );
  document.documentElement.style.zoom = "1.2";
  window.dispatchEvent(new Event("resize"));
  await settle();
  await arrangeWindows("Columns");
  await until(() => {
    const arranged = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ];
    if (arranged.length !== 2) return false;
    const [left, right] = arranged
      .map((window) => window.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);
    return left && right && left.right <= right.left;
  }, "two visual Inspectors in Columns");
  const zoomedStage = document
    .querySelector(".world-view-layout")!
    .getBoundingClientRect();
  check(
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ].every((window) => {
      const bounds = window.getBoundingClientRect();
      return (
        bounds.left >= zoomedStage.left - 2 &&
        bounds.right <= zoomedStage.right + 2 &&
        bounds.top >= zoomedStage.top - 2 &&
        bounds.bottom <= zoomedStage.bottom + 2 &&
        Math.abs(
          bounds.top - zoomedStage.top - (zoomedStage.bottom - bounds.bottom),
        ) <= 3
      );
    }),
    "120% UI scale placed arranged Inspectors outside the visual stage",
  );
  document.documentElement.style.zoom = "";
  window.dispatchEvent(new Event("resize"));
  await settle();
  const desktopInspectorBounds = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ]
      .map((inspector) => ({
        label: inspector.getAttribute("aria-label"),
        bounds: inspector.getBoundingClientRect(),
      }))
      .sort((a, b) => a.label!.localeCompare(b.label!));
  const beforeCompact = desktopInspectorBounds();
  const compactVisualStage =
    document.querySelector<HTMLElement>(".world-view-layout")!;
  compactVisualStage.style.width = "660px";
  compactVisualStage.style.height = "650px";
  updateLayoutPreferences({ mode: "mobile" });
  await until(
    () =>
      document.documentElement.dataset.layout === "mobile" &&
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 1,
    "compact visual presentation showed one Inspector",
  );
  const compactArrangeTrigger = () =>
    document.querySelector<HTMLButtonElement>(
      '.mobile-nav button[aria-label="Arrange windows"]',
    );
  if (!compactArrangeTrigger())
    document
      .querySelector<HTMLButtonElement>(".mobile-controls-toggle")
      ?.click();
  await until(compactArrangeTrigger, "compact arrangement menu trigger");
  compactArrangeTrigger()!.click();
  await until(
    () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="menu"][aria-label="Arrange windows"] [role="menuitem"]',
        ),
      ].some(
        (button) =>
          button.querySelector("strong")?.textContent === "Columns" &&
          button.getAttribute("aria-disabled") === "true",
      ),
    "compact Columns was unavailable",
  );
  const compactColumns = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"][aria-label="Arrange windows"] [role="menuitem"]',
    ),
  ].find((button) => button.querySelector("strong")?.textContent === "Columns");
  compactColumns?.click();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  updateShortcut("arrangement.columns", ["Ctrl+Alt+Shift+3"]);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "3",
      code: "Digit3",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  check(
    document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
      .length === 1,
    "compact menu or shortcut changed the visible Inspector set",
  );
  updateLayoutPreferences({ mode: "desktop" });
  compactVisualStage.style.removeProperty("width");
  compactVisualStage.style.removeProperty("height");
  await until(
    () =>
      document.documentElement.dataset.layout === "desktop" &&
      desktopInspectorBounds().length === 2,
    "desktop Inspectors returned after compact selection",
  );
  await until(
    () =>
      desktopInspectorBounds().every((item, index) => {
        const prior = beforeCompact[index];
        return (
          item.label === prior?.label &&
          ["left", "top", "width", "height"].every(
            (key) =>
              Math.abs(
                (item.bounds[key as keyof DOMRect] as number) -
                  (prior.bounds[key as keyof DOMRect] as number),
              ) <= 2,
          )
        );
      }),
    "desktop Inspector placements survived compact menu and shortcut",
  );
  for (const visualView of ["tree", "graph", "office"] as const) {
    viewSelect.value = visualView;
    viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(
      () =>
        document.querySelector(
          visualView === "tree"
            ? ".world-connected-tree-shell"
            : visualView === "graph"
              ? ".world-spatial-graph-shell"
              : "canvas[data-office-canvas='true']",
        ) &&
        document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
          .length === 2,
      `arranged Inspector continuity in ${visualView}`,
    );
  }
  const attachedBeforeSingle = calls.filter(
    ({ method }) => method === "terminal.detach",
  ).length;
  await arrangeWindows("Single");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 1 &&
      calls.filter(({ method }) => method === "terminal.detach").length >
        attachedBeforeSingle,
    "Single suspended the other visual terminal",
  );
  await arrangeWindows("Restore positions");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 2,
    "Restore reopened both retained visual Inspectors",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Builder Inspector"] button[aria-label="Dock Inspector"]',
    )
    ?.click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") === true &&
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) !== null,
    "occupied Builder dock with floating Reviewer Inspector",
  );

  const paneGetsBeforeClosedTargetFocus = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const delayedClosedTargetFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedClosedTargetFocus.promise,
  };
  flushSync(() => floatingPreferenceNavigatorRow?.click());
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeClosedTargetFocus + 1,
    "delayed existing floating Inspector focus",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] button[aria-label="Close floating Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "close floating target during delayed focus",
  );
  delayedClosedTargetFocus.resolve();
  delayedPaneGet = null;
  await settle();
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("Builder") === true &&
      !document.body.textContent?.includes("Reviewer Inspector"),
    "delayed navigator focus resurrected the closed target Inspector",
  );

  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "restore floating Reviewer Inspector for delayed dock race",
  );
  const paneGetsBeforeDockOutFocus = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const delayedDockOutFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedDockOutFocus.promise,
  };
  flushSync(() => floatingPreferenceNavigatorRow?.click());
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeDockOutFocus + 1,
    "delayed focus before occupied dock-out",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector") &&
      document.querySelector(
        '[role="dialog"][aria-label="Builder Inspector"]',
      ) !== null,
    "float occupied dock during delayed focus",
  );
  delayedDockOutFocus.resolve();
  delayedPaneGet = null;
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") === true,
    "delayed focus admitted Reviewer after Builder dock-out",
  );
  check(
    document.querySelector(
      '[role="dialog"][aria-label="Builder Inspector"]',
    ) !== null,
    "delayed navigator focus deleted the explicitly floated dock occupant",
  );

  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Builder Inspector"] button[aria-label="Dock Inspector"]',
    )!
    .click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") === true &&
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) !== null,
    "restore occupied Builder dock for ordinary navigator admission",
  );

  const paneGetsBeforeClosedDockIn = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const delayedClosedDockIn = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedClosedDockIn.promise,
  };
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] button[aria-label="Dock Inspector"]',
    )!
    .click();
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeClosedDockIn + 1,
    "delayed Reviewer Dock in focus",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] button[aria-label="Close floating Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "close Reviewer during delayed Dock in",
  );
  delayedClosedDockIn.resolve();
  delayedPaneGet = null;
  await settle();
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("Builder") === true &&
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "delayed Dock in admitted an Inspector closed during focus",
  );

  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "restore Reviewer for delayed floating focus",
  );
  const paneGetsBeforeClosedFloatingFocus = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const delayedClosedFloatingFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedClosedFloatingFocus.promise,
  };
  document
    .querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] .workspace-inspector-body',
    )!
    .dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId: 17,
        pointerType: "mouse",
      }),
    );
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeClosedFloatingFocus + 1,
    "delayed floating Reviewer focus",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] button[aria-label="Close floating Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "close Reviewer during delayed floating focus",
  );
  delayedClosedFloatingFocus.resolve();
  delayedPaneGet = null;
  await settle();
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("Builder") === true &&
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "delayed floating focus resurrected the closed Inspector",
  );

  flushSync(() => agentTarget("Reviewer")!.click());
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "restore Reviewer for ordinary navigator admission",
  );
  flushSync(() => floatingPreferenceNavigatorRow?.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer") === true,
    "shared navigator admitted the existing floating Reviewer Inspector",
  );
  check(
    !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "shared navigator admission floated the displaced docked Inspector",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-context-rail button[aria-label="Close Workspace Inspector"]',
    )!
    .click();
  await until(
    () =>
      !document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector") &&
      !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "close preference-check Inspectors",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Office Inspector opening"]',
      ),
    "reopened Office settings",
  );
  const dockedOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Office Inspector opening"]',
  )!;
  dockedOpeningSelect.value = "docked";
  dockedOpeningSelect.dispatchEvent(new Event("change", { bubbles: true }));
  toggleTopbarMenu();
  flushSync(() => agentTarget("Builder")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "docked preference Builder Inspector",
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
  const dockedAfterFirstMove = dockedRail.getBoundingClientRect();
  dockedMoveHandle.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 20,
      pointerType: "mouse",
      clientX: dockedAfterFirstMove.left + 40,
      clientY: dockedAfterFirstMove.top + 24,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      pointerId: 20,
      pointerType: "mouse",
      clientX: 0,
      clientY: dockedAfterFirstMove.top + 24,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 20,
      pointerType: "mouse",
      clientX: 0,
      clientY: dockedAfterFirstMove.top + 24,
    }),
  );
  await until(
    () => dockedRail.getBoundingClientRect().left <= 1,
    "moved docked Inspector across the complete application viewport",
  );
  check(
    calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeDockedMove,
    "moving the docked Inspector focused its terminal",
  );
  dockedRail
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Dock Inspector at bottom"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector(".world-inspector-stage.inspector-dock-bottom"),
    "bottom dock after moving docked Inspector",
  );
  const worldLayoutBounds = document
    .querySelector<HTMLElement>(".world-view-layout")!
    .getBoundingClientRect();
  const movedBottomDockBounds = dockedRail.getBoundingClientRect();
  check(
    movedBottomDockBounds.height > 40 &&
      movedBottomDockBounds.top >= worldLayoutBounds.top - 1 &&
      movedBottomDockBounds.bottom <= worldLayoutBounds.bottom + 1,
    `bottom dock escaped the visible World stage: dock=${JSON.stringify({ top: movedBottomDockBounds.top, bottom: movedBottomDockBounds.bottom, height: movedBottomDockBounds.height })}; stage=${JSON.stringify({ top: worldLayoutBounds.top, bottom: worldLayoutBounds.bottom })}`,
  );
  dockedRail
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Dock Inspector at right"]',
    )!
    .click();
  await until(
    () => document.querySelector(".world-inspector-stage.inspector-dock-right"),
    "restore right dock after moved bottom dock",
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
  const builderResizeBracket = getComputedStyle(builderResizeGrip, "::after");
  check(
    builderResizeGripBounds.width >= 32 &&
      builderResizeGripBounds.height >= 32 &&
      getComputedStyle(builderResizeGrip).cursor === "nwse-resize" &&
      Number.parseFloat(builderResizeBracket.width) <= 16 &&
      builderResizeBracket.borderRightWidth !== "0px" &&
      builderResizeBracket.borderBottomWidth !== "0px",
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

  window.dispatchEvent(new Event("blur"));
  document.body.focus();
  window.dispatchEvent(new Event("focus"));
  await until(
    () => document.activeElement === dockedInput,
    "previously focused docked terminal after browser focus return",
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
    await until(
      () => document.activeElement === replacementReviewerInput,
      "newly selected docked Inspector terminal focus",
    );
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
  await until(
    () =>
      document.querySelectorAll(".world-intent-connector circle").length === 2,
    "Builder Graph Inspector connector",
  );
  const graphBuilderNodeId = graphTarget("Builder")!.dataset.graphNodeAnchor!;
  const graphBuilderPosition =
    window.__HERDR_GRAPH_RENDERER__!.publishedNodes[graphBuilderNodeId]!;
  const graphCanvasBounds = document
    .querySelector<HTMLCanvasElement>("canvas[data-graph-canvas=true]")!
    .getBoundingClientRect();
  const graphConnectorSource = document.querySelector<SVGCircleElement>(
    ".world-intent-connector circle",
  )!;
  check(
    Math.abs(
      Number(graphConnectorSource.getAttribute("cx")) -
        (graphCanvasBounds.left + graphBuilderPosition.screenX),
    ) <= 2 &&
      Math.abs(
        Number(graphConnectorSource.getAttribute("cy")) -
          (graphCanvasBounds.top + graphBuilderPosition.screenY),
      ) <= 2,
    "Graph Inspector connector did not start at the node centre",
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

  viewSelect.value = "tree";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      terminalInput(
        document.querySelector(".world-tree-inline-inspector") ?? document,
      ),
    "Builder inline Tree Inspector",
  );
  check(
    !document
      .querySelector(".world-context-rail")
      ?.classList.contains("has-inspector") &&
      document.querySelector(
        ".world-connected-tree-card-wrap.has-inline-inspector",
      ) !== null,
    "Tree did not replace the detached overlay with the exact expanded leaf",
  );
  const selectTreeNode = (label: string) => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".world-tree-outline-select",
      ),
    ].find((candidate) =>
      candidate.querySelector("strong")?.textContent?.includes(label),
    );
    check(Boolean(button), `Tree omitted ${label} selection`);
    button?.click();
  };
  document
    .querySelector<HTMLButtonElement>(
      '.world-tree-inline-inspector button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "Builder floated before Tree Restore regression",
  );
  selectTreeNode("Reviewer");
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer"),
    "Reviewer inline before Tree Restore regression",
  );
  await arrangeWindows("Columns");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 2,
    "Tree Columns included floating and inline Inspectors",
  );
  document
    .querySelector<HTMLElement>('.tabbar-tab[title="created-tab-3"]')!
    .click();
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("terminal"),
    "later terminal opened inline during Tree arrangement",
  );
  await arrangeWindows("Restore positions");
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("terminal") &&
      !document
        .querySelector(".world-context-rail")
        ?.classList.contains("has-inspector"),
    "Restore retained the later terminal in its Tree leaf",
  );
  selectTreeNode("Builder");
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "Builder inline after Tree Restore regression",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-tree-inline-inspector button[aria-label="Float Inspector"]',
    )!
    .click();
  await until(
    () =>
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    "Tree Inspector dock out",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Builder Inspector"] button[aria-label="Dock Inspector"]',
    )!
    .click();
  await until(
    () =>
      document
        .querySelector(
          ".world-tree-inline-inspector .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      !document.querySelector(
        '[role="dialog"][aria-label="Builder Inspector"]',
      ),
    "Tree Inspector dock in",
  );
  viewSelect.value = "graph";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "Builder Graph Inspector after Tree inline transfer",
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
  const compactRail = document.querySelector<HTMLElement>(
    ".world-context-rail",
  )!;
  compactRail.style.width = "390px";
  updateLayoutPreferences({ mode: "mobile" });
  await until(
    () => document.documentElement.dataset.layout === "mobile",
    "forced compact layout",
  );
  const mobileTabBar = document.querySelector<HTMLElement>(".tabbar");
  const mobileControlsToggle = document.querySelector<HTMLButtonElement>(
    ".mobile-controls-toggle",
  )!;
  mobileControlsToggle.click();
  await until(
    () =>
      !document.querySelector(
        '.mobile-nav button[aria-label="Arrange windows"]',
      ),
    "collapsed mobile controls hid window arrangements",
  );
  mobileControlsToggle.click();
  await until(
    () =>
      document.querySelector(
        '.mobile-nav button[aria-label="Arrange windows"]',
      ),
    "mobile ellipsis revealed window arrangements",
  );
  check(
    !mobileTabBar?.querySelector('button[aria-label="Arrange windows"]') &&
      document
        .querySelector<HTMLElement>(
          '.mobile-nav button[aria-label="Arrange windows"]',
        )!
        .getBoundingClientRect().width > 0,
    "mobile arrangement access created another tab-strip icon",
  );
  const compactReviewerSlot = persistentReviewerInspector?.closest<HTMLElement>(
    ".workspace-inspector-slot",
  );
  check(
    getComputedStyle(compactReviewerSlot!).display !== "none" &&
      compactReviewerSlot!.getBoundingClientRect().height > 0,
    "compact Graph hid the World Inspector behind the Spaces session rule",
  );
  viewSelect.value = "office";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      window.__HERDR_WORLD_RENDERER__?.ready === true &&
      document.querySelector(".world-context-rail .workspace-inspector") ===
        persistentReviewerInspector,
    "compact Office retained Inspector",
  );
  check(
    compactReviewerSlot!.getBoundingClientRect().height > 0,
    "compact Office did not render the retained Inspector",
  );
  const compactBuilderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  check(
    getComputedStyle(compactBuilderWindow).display === "none",
    "compact Office exposed a floating Inspector above the docked Inspector",
  );
  const compactNavigation = document.querySelector<HTMLElement>(
    '.mobile-nav[aria-label="Workspace view switcher"]',
  )!;
  const compactFilesButton = compactNavigation.querySelector<HTMLButtonElement>(
    'button[aria-label="Show workspace files"]',
  )!;
  const compactChangesButton =
    compactNavigation.querySelector<HTMLButtonElement>(
      'button[aria-label="Show workspace changes"]',
    )!;
  const compactHistoryButton =
    compactNavigation.querySelector<HTMLButtonElement>(
      'button[aria-label="Show agent message history"]',
    )!;
  const compactTerminalButton =
    compactNavigation.querySelector<HTMLButtonElement>(
      'button[aria-label="Show terminal session"]',
    )!;
  compactFilesButton.click();
  await until(
    () => persistentReviewerInspector?.getAttribute("data-view") === "files",
    "compact World Inspector Files view",
  );
  const compactFilesResource = persistentReviewerInspector?.querySelector(
    ".inspector-files-resource:not(.is-hidden)",
  );
  check(
    (compactFilesResource?.getBoundingClientRect().height ?? 0) > 0 &&
      (compactFilesResource
        ?.querySelector(".file-explorer-side")
        ?.getBoundingClientRect().height ?? 0) > 0,
    "compact World Inspector Files resource did not render its explorer",
  );
  check(
    compactFilesButton.classList.contains("active"),
    "compact World Inspector Files navigation was not active",
  );
  compactChangesButton.click();
  await until(
    () => persistentReviewerInspector?.getAttribute("data-view") === "changes",
    "compact World Inspector Changes view",
  );
  const compactChangesResource = persistentReviewerInspector?.querySelector(
    ".inspector-changes-resource:not(.is-hidden)",
  );
  await until(
    () =>
      Boolean(compactChangesResource?.querySelector("button:not([disabled])")),
    "compact Agent checkout unavailable state",
  );
  const workspaceChangesChoice = [
    ...compactChangesResource!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Workspace changes");
  check(
    Boolean(workspaceChangesChoice),
    "Agent checkout unavailable state did not offer Workspace changes",
  );
  workspaceChangesChoice?.click();
  await until(
    () => Boolean(compactChangesResource?.querySelector(".diff-viewer-side")),
    "compact Workspace changes choice",
  );
  check(
    (compactChangesResource?.getBoundingClientRect().height ?? 0) > 0 &&
      (compactChangesResource
        ?.querySelector(".diff-viewer-side")
        ?.getBoundingClientRect().height ?? 0) > 0,
    "compact World Inspector Changes resource did not render its file list",
  );
  check(
    compactChangesButton.classList.contains("active"),
    "compact World Inspector Changes navigation was not active",
  );
  compactHistoryButton.click();
  await until(
    () =>
      persistentReviewerInspector?.getAttribute("data-view") === "history" &&
      (persistentReviewerInspector
        ?.querySelector(".inspector-history-resource:not(.is-hidden)")
        ?.getBoundingClientRect().height ?? 0) > 0,
    "compact World Inspector History view",
  );
  check(
    compactHistoryButton.classList.contains("active"),
    "compact World Inspector History navigation was not active",
  );
  compactTerminalButton.click();
  await until(
    () =>
      persistentReviewerInspector?.getAttribute("data-view") === "terminal" &&
      persistentReviewerInspector.querySelector(
        'button[aria-label="Open device keyboard"]',
      ),
    "compact Inspector Terminal view",
  );
  check(
    compactTerminalButton.classList.contains("active"),
    "compact World Inspector Terminal navigation was not active",
  );
  const compactKeyboardButton =
    persistentReviewerInspector!.querySelector<HTMLButtonElement>(
      'button[aria-label="Open device keyboard"]',
    )!;
  const compactShortcutButton =
    persistentReviewerInspector!.querySelector<HTMLButtonElement>(
      'button[aria-label="Show terminal shortcuts"]',
    )!;
  const compactShortcutBounds = compactShortcutButton.getBoundingClientRect();
  const compactTerminalPortalBounds = persistentReviewerInspector!
    .querySelector(".workspace-inspector-terminal-portal")!
    .getBoundingClientRect();
  const compactTerminalShellBounds = persistentReviewerInspector!
    .querySelector(".terminal-shell")!
    .getBoundingClientRect();
  const compactShortcutHitTarget = document.elementFromPoint(
    compactShortcutBounds.left + compactShortcutBounds.width / 2,
    compactShortcutBounds.top + compactShortcutBounds.height / 2,
  );
  check(
    compactKeyboardButton.getBoundingClientRect().width >= 44 &&
      compactTerminalShellBounds.width <= compactTerminalPortalBounds.width &&
      compactShortcutBounds.width > 0 &&
      compactShortcutBounds.left >= compactTerminalPortalBounds.left &&
      compactShortcutBounds.right <= compactTerminalPortalBounds.right &&
      compactShortcutBounds.top >= compactTerminalPortalBounds.top &&
      compactShortcutBounds.bottom <= compactTerminalPortalBounds.bottom &&
      (compactShortcutHitTarget === compactShortcutButton ||
        compactShortcutButton.contains(compactShortcutHitTarget)),
    "compact World Inspector omitted its device keyboard or terminal shortcuts",
  );
  compactKeyboardButton.click();
  await until(
    () =>
      document.activeElement === terminalInput(persistentReviewerInspector!),
    "compact World Inspector device keyboard focus",
  );
  compactFilesButton.click();
  await until(
    () =>
      persistentReviewerInspector?.getAttribute("data-view") === "files" &&
      (compactFilesResource?.getBoundingClientRect().height ?? 0) > 0,
    "compact World Inspector Files view before Spaces",
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
      document.querySelector(
        '.workspace-terminal-surface button[aria-label="Open device keyboard"]',
      ),
    "Spaces handoff",
  );
  document.querySelector<HTMLButtonElement>(".command-trigger")?.click();
  await settle();
  check(
    document
      .querySelector(".command-popover")
      ?.textContent?.includes("Arrange windows") === true,
    "Spaces Actions omitted window arrangements",
  );
  document.querySelector<HTMLButtonElement>(".command-trigger")?.click();
  await settle();
  check(
    document.querySelector(".world-control-plane") === persistentControlPlane &&
      document.querySelector(".world-context-rail .workspace-inspector") ===
        persistentReviewerInspector,
    "Spaces handoff destroyed retained Inspector state",
  );
  check(
    persistentControlPlane?.getBoundingClientRect().height === 0 &&
      persistentReviewerInspector?.getBoundingClientRect().height === 0 &&
      document.querySelector(".terminal-empty") === null,
    "visible Spaces remained obstructed by a visual Inspector presentation",
  );
  const spacesTerminal = document.querySelector<HTMLElement>(
    ".workspace-terminal-surface .terminal-shell",
  );
  check(
    Boolean(
      spacesTerminal &&
        spacesTerminal.getBoundingClientRect().width > 0 &&
        spacesTerminal.getBoundingClientRect().height > 0 &&
        terminalInput(spacesTerminal),
    ),
    "visible Spaces did not present its native selected terminal",
  );
  check(
    calls.filter(({ method }) => method === "terminal.attach").length >
      terminalAttachesBeforeSpaces &&
      calls.filter(({ method }) => method === "terminal.detach").length >
        terminalDetachesBeforeSpaces &&
      calls.some(
        ({ method, params }) =>
          method === "terminal.attach" &&
          params.terminal_id === "reviewer-terminal",
      ),
    "Spaces handoff did not transfer the selected terminal presentation",
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
      persistentReviewerInspector?.getAttribute("data-view") === "files" &&
      (compactFilesResource?.getBoundingClientRect().height ?? 0) > 0 &&
      document.querySelector(
        ".workspace-terminal-surface > .terminal-shell",
      ) === null,
    "returning from Spaces did not restore the retained Inspector state",
  );
  updateLayoutPreferences({ mode: "desktop" });
  compactRail.style.removeProperty("width");
  await until(
    () => document.documentElement.dataset.layout === "desktop",
    "restored desktop layout",
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

  const splitBuilderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  splitBuilderWindow.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 81,
      pointerType: "mouse",
    }),
  );
  await until(
    () => store.get().selectedPaneId === "builder-pane",
    "Builder floating before sibling focus",
  );
  const siblingPane: Pane = {
    ...panes[0]!,
    pane_id: "builder-sibling-pane",
    terminal_id: "builder-sibling-terminal",
    focused: false,
    agent: "builder-sibling",
    display_agent: "Builder Sibling",
  };
  panes.push(siblingPane);
  tabs[0]!.pane_count = 2;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  __storeTesting.replaceState({
    ...store.get(),
    workspaces: [currentWorkspace()],
    tabs: currentTabs(),
    panes: currentPanes(),
    layout: layout(),
    lastRefresh: Date.now(),
  });
  await until(
    () => splitBuilderWindow.querySelectorAll(".pane-layout-cell").length === 2,
    "both panes in one floating Builder Inspector",
  );
  const splitBuilderBounds = splitBuilderWindow.getBoundingClientRect();
  const browserLocalSnapshot = store.get();
  navigationMode = "browser-local";
  __storeTesting.replaceState({
    ...browserLocalSnapshot,
    navigationMode,
    browserNavigation: {
      ...browserLocalSnapshot.browserNavigation,
      revision: browserLocalSnapshot.browserNavigation.revision + 1,
      workspaceId: workspaceBase.workspace_id,
      tabIds: {
        ...browserLocalSnapshot.browserNavigation.tabIds,
        [workspaceBase.workspace_id]: "work",
      },
      paneIds: {
        ...browserLocalSnapshot.browserNavigation.paneIds,
        work: "builder-pane",
      },
    },
  });
  const delayedOldPaneFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "builder-pane",
    promise: delayedOldPaneFocus.promise,
  };
  const oldPaneGetsBeforeSibling = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;
  splitBuilderWindow
    .querySelectorAll<HTMLElement>(".pane-layout-cell")[1]!
    .dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 82,
        pointerType: "mouse",
      }),
    );
  await until(
    () => store.get().selectedPaneId === siblingPane.pane_id,
    "focused sibling inside floating Builder Inspector",
  );
  const oldPaneGetsAfterSibling = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;
  delayedOldPaneFocus.resolve();
  delayedPaneGet = null;
  await settle();
  await settle();
  check(
    oldPaneGetsAfterSibling === oldPaneGetsBeforeSibling &&
      store.get().selectedPaneId === siblingPane.pane_id,
    "browser-local sibling click started an old-pane focus that could finish last",
  );
  updateLayoutPreferences({ mode: "mobile" });
  await until(
    () =>
      splitBuilderWindow.querySelector<HTMLButtonElement>(
        'button[aria-label="Previous pane"]',
      ),
    "mobile switcher in floating split Inspector",
  );
  const delayedMobileOldFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: siblingPane.pane_id,
    promise: delayedMobileOldFocus.promise,
  };
  const oldPaneGetsBeforeMobile = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === siblingPane.pane_id,
  ).length;
  const previousPaneButton =
    splitBuilderWindow.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous pane"]',
    )!;
  previousPaneButton.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 83,
      pointerType: "touch",
    }),
  );
  previousPaneButton.click();
  await until(
    () => store.get().selectedPaneId === "builder-pane",
    "mobile switcher focused previous pane",
  );
  const oldPaneGetsAfterMobile = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === siblingPane.pane_id,
  ).length;
  delayedMobileOldFocus.resolve();
  delayedPaneGet = null;
  await settle();
  check(
    oldPaneGetsAfterMobile === oldPaneGetsBeforeMobile &&
      store.get().selectedPaneId === "builder-pane",
    "mobile switcher started an old-pane focus that could finish last",
  );
  updateLayoutPreferences({ mode: "desktop" });
  await until(
    () => document.documentElement.dataset.layout === "desktop",
    "desktop layout after mobile pane focus",
  );

  zoomedFocusedPaneId = siblingPane.pane_id;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  __storeTesting.replaceState({
    ...store.get(),
    layout: layout(),
    lastRefresh: Date.now(),
  });
  await until(
    () => splitBuilderWindow.querySelector(".pane-layout-single"),
    "zoomed sibling pane in floating Inspector",
  );
  const delayedZoomOldFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "builder-pane",
    promise: delayedZoomOldFocus.promise,
  };
  const oldPaneGetsBeforeZoom = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;
  splitBuilderWindow
    .querySelector<HTMLElement>(".pane-layout-single")!
    .dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 84,
        pointerType: "mouse",
      }),
    );
  await until(
    () => store.get().selectedPaneId === siblingPane.pane_id,
    "zoomed sibling pane received focus",
  );
  const oldPaneGetsAfterZoom = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;
  delayedZoomOldFocus.resolve();
  delayedPaneGet = null;
  await settle();
  check(
    oldPaneGetsAfterZoom === oldPaneGetsBeforeZoom &&
      store.get().selectedPaneId === siblingPane.pane_id,
    "zoomed pane click started an old-pane focus that could finish last",
  );
  zoomedFocusedPaneId = null;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  __storeTesting.replaceState({
    ...store.get(),
    layout: layout(),
    lastRefresh: Date.now(),
  });
  navigationMode = "shared";
  __storeTesting.replaceState({ ...store.get(), navigationMode });
  const afterSiblingBounds = splitBuilderWindow.getBoundingClientRect();
  check(
    splitBuilderWindow.isConnected &&
      splitBuilderWindow
        .getAttribute("aria-label")
        ?.includes("Builder Sibling") === true &&
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Reviewer Next") === true &&
      Math.abs(afterSiblingBounds.left - splitBuilderBounds.left) <= 2 &&
      Math.abs(afterSiblingBounds.top - splitBuilderBounds.top) <= 2,
    "sibling focus moved or docked its floating Inspector",
  );

  await arrangeWindows("Columns");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 2,
    "arranged Builder and Reviewer before opening a later Inspector",
  );
  viewSelect.value = "office";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => window.__HERDR_WORLD_RENDERER__?.ready === true,
    "Office before later Inspector opening",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Office Inspector opening"]',
      ),
    "Office opening preference before Restore regression",
  );
  const laterOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Office Inspector opening"]',
  )!;
  laterOpeningSelect.value = "floating";
  laterOpeningSelect.dispatchEvent(new Event("change", { bubbles: true }));
  toggleTopbarMenu();
  const laterDesk = () =>
    document.querySelector<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"][data-target-key*="created-tab-3"]:not(:disabled)',
    );
  await until(laterDesk, "later terminal desk in Office");
  laterDesk()!.click();
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 3,
    "later floating Inspector outside the arranged set",
  );
  const laterInspector = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-label$=" Inspector"]',
    ),
  ].find(
    (candidate) =>
      !candidate.getAttribute("aria-label")?.includes("Builder") &&
      !candidate.getAttribute("aria-label")?.includes("Reviewer"),
  );
  check(Boolean(laterInspector), "later terminal Inspector was not floating");
  laterInspector
    ?.querySelector<HTMLButtonElement>('button[aria-label="Dock Inspector"]')
    ?.click();
  await until(
    () =>
      document
        .querySelector(
          ".world-context-rail .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("terminal") === true,
    "explicitly docked the later Inspector",
  );
  await arrangeWindows("Restore positions");
  check(
    document
      .querySelector(".world-context-rail .workspace-inspector-agent-identity")
      ?.textContent?.includes("terminal") === true &&
      !laterInspector?.isConnected,
    "Restore moved an Inspector opened and docked after the arrangement",
  );

  const narrowedVisualStage =
    document.querySelector<HTMLElement>(".world-view-layout")!;
  narrowedVisualStage.style.width = "700px";
  narrowedVisualStage.style.height = "740px";
  await until(
    () => Math.abs(narrowedVisualStage.getBoundingClientRect().width - 700) < 2,
    "narrow visual arrangement stage",
  );
  const visualWindowBounds = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ].map((window) => window.getBoundingClientRect());
  const clippedVisualControls = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ].flatMap((window) => {
      const bounds = window.getBoundingClientRect();
      return [
        ...window.querySelectorAll<HTMLButtonElement>(
          ".workspace-inspector-head button",
        ),
      ].flatMap((button) => {
        const control = button.getBoundingClientRect();
        const reachable =
          control.width > 0 &&
          control.height > 0 &&
          control.left >= bounds.left - 1 &&
          control.right <= bounds.right + 1 &&
          control.top >= bounds.top - 1 &&
          control.bottom <= bounds.bottom + 1;
        return reachable
          ? []
          : [
              {
                label: button.ariaLabel ?? button.textContent,
                width: Math.round(bounds.width),
                leftInset: Math.round(control.left - bounds.left),
                rightInset: Math.round(bounds.right - control.right),
                topInset: Math.round(control.top - bounds.top),
                bottomInset: Math.round(bounds.bottom - control.bottom),
              },
            ];
      });
    });
  await arrangeWindows("Columns");
  await until(() => {
    const bounds = visualWindowBounds().sort((a, b) => a.left - b.left);
    return (
      bounds.length === 3 &&
      bounds.every((item) => item.width >= 220) &&
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-label$=" Inspector"] .workspace-inspector',
        ),
      ].every((inspector) => inspector.classList.contains("is-compact")) &&
      bounds.every(
        (item, index) => index === 0 || bounds[index - 1]!.right <= item.left,
      )
    );
  }, "three Inspectors in narrow Columns");
  await settle();
  check(
    clippedVisualControls().length === 0,
    `narrow Columns clipped Inspector controls: ${JSON.stringify(clippedVisualControls())}`,
  );
  narrowedVisualStage.style.height = "512px";
  narrowedVisualStage.style.maxHeight = "512px";
  await until(
    () =>
      Math.abs(narrowedVisualStage.getBoundingClientRect().height - 512) < 2,
    "short visual arrangement stage",
  );
  await arrangeWindows("Rows");
  await until(() => {
    const bounds = visualWindowBounds().sort((a, b) => a.top - b.top);
    return (
      bounds.length === 3 &&
      bounds.every((item) => item.height >= 160) &&
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-label$=" Inspector"] .workspace-inspector',
        ),
      ].every((inspector) => inspector.classList.contains("is-compact")) &&
      bounds.every(
        (item, index) => index === 0 || bounds[index - 1]!.bottom <= item.top,
      )
    );
  }, "three Inspectors in narrow Rows");
  check(
    clippedVisualControls().length === 0,
    `narrow Rows clipped Inspector controls: ${JSON.stringify(clippedVisualControls())}`,
  );
  narrowedVisualStage.style.width = "1000px";
  narrowedVisualStage.style.height = "740px";
  narrowedVisualStage.style.removeProperty("max-height");
  await until(
    () =>
      Math.abs(narrowedVisualStage.getBoundingClientRect().width - 1000) < 2 &&
      narrowedVisualStage.getBoundingClientRect().height >= 650,
    "visual stage before default Cascade",
  );
  await arrangeWindows("Cascade");
  await until(
    () =>
      visualWindowBounds().length === 3 &&
      visualWindowBounds().every(
        (bounds) =>
          Math.abs(bounds.width - 760) <= 2 &&
          Math.abs(bounds.height - 520) <= 2,
      ),
    "Cascade kept the default floating window size",
  );
  narrowedVisualStage.style.removeProperty("width");
  narrowedVisualStage.style.removeProperty("height");

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
