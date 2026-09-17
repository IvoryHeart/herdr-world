import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "../api";
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

const workspace: Workspace = {
  workspace_id: "studio",
  number: 1,
  label: "Studio",
  focused: true,
  pane_count: 2,
  tab_count: 1,
  active_tab_id: "work",
  agent_status: "working",
  cwd: "/repo",
};
const tab: Tab = {
  tab_id: "work",
  workspace_id: workspace.workspace_id,
  number: 1,
  label: "Work",
  focused: true,
  pane_count: 2,
  agent_status: "working",
};
const panes: Pane[] = [
  {
    pane_id: "builder-pane",
    terminal_id: "builder-terminal",
    workspace_id: workspace.workspace_id,
    tab_id: tab.tab_id,
    focused: true,
    agent: "builder",
    display_agent: "Builder",
    agent_status: "working",
    revision: 1,
  },
  {
    pane_id: "reviewer-pane",
    terminal_id: "reviewer-terminal",
    workspace_id: workspace.workspace_id,
    tab_id: tab.tab_id,
    focused: false,
    agent: "reviewer",
    display_agent: "Reviewer",
    agent_status: "idle",
    revision: 1,
  },
];
let focusedPaneId = panes[0].pane_id;
let delayedPaneGet: { paneId: string; promise: Promise<void> } | null = null;
let rejectNextPaneGetId: string | null = null;
let rejectedPaneGets = 0;

function currentPanes() {
  return panes.map((pane) => ({
    ...pane,
    focused: pane.pane_id === focusedPaneId,
  }));
}

function layout(): PaneLayout {
  return {
    workspace_id: workspace.workspace_id,
    tab_id: tab.tab_id,
    zoomed: false,
    area: { x: 0, y: 0, width: 160, height: 48 },
    focused_pane_id: focusedPaneId,
    panes: currentPanes().map((pane, index) => ({
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
        revision: 1,
        observed_at: Date.now(),
        truncated_connections: false,
        connections: [
          {
            connection_id: "local",
            label: "Local",
            source: "test",
            is_default: true,
            state: "ready",
            generation: 7,
            snapshot_generation: 7,
            stale: false,
            actionable: true,
            snapshot: {
              workspaces: [workspace],
              tabs: [tab],
              panes: currentPanes(),
              agents: [],
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
      if (pane) focusedPaneId = pane.pane_id;
      return pane ? { pane: { ...pane, focused: true } } : {};
    }
    if (method === "workspace.list") {
      return { navigation_mode: "shared", workspaces: [workspace] };
    }
    if (method === "tab.list") return { tabs: [tab] };
    if (method === "pane.list") return { panes: currentPanes() };
    if (method === "agent.list") return { agents: [] };
    if (method === "pane.layout") return { layout: layout() };
    if (method === "file.list") {
      return {
        workspace_id: workspace.workspace_id,
        root: "/repo",
        checkout_path: "/repo",
        path: "",
        entries: [],
        truncated: false,
      };
    }
    if (method === "git.diff_summary") {
      return { workspace_id: workspace.workspace_id, entries: [], counts: {} };
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
  bridge.onTerminal = () => () => {};
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
    workspaces: [workspace],
    tabs: [tab],
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
  check(
    document
      .querySelector(".world-control-plane")
      ?.parentElement?.classList.contains("workspace-terminal-surface") ===
      true,
    "Office did not reuse the Spaces workspace frame",
  );
  check(
    (document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0) >
      100,
    "Office did not retain the Spaces workspace navigator",
  );
  const sharedNavigator = document.querySelector(".sidebar");
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
  rejectNextPaneGetId = "reviewer-pane";
  flushSync(() => reviewerNavigatorRow?.click());
  await until(() => rejectedPaneGets === 1, "rejected shared navigator focus");
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
  await settle();
  check(
    !document
      .querySelector(".world-context-rail")
      ?.classList.contains("has-inspector"),
    "floating the Inspector left its docked shell visible",
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
  viewSelect.value = "spaces";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => !document.querySelector(".world-control-plane"),
    "Spaces handoff",
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
