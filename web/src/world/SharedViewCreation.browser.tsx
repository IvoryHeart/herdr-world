import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge, type ConnectionClient, type TerminalPush } from "../api";
import {
  __storeTesting,
  connectionSnapshot,
  emptyServerSessionState,
  store,
} from "../store";
import { creationSources } from "../creationRequests";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import type { Pane, Tab, Workspace } from "../types";
import { buildWorldObject, taskSummarySessionFingerprint } from "./worldObject";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { worldRuntimeStore } from "./runtimeStore";
import WorldFoundationApp from "./WorldFoundationApp";
import { WorldLoader, WORLD_LOADER_LONGER_MS } from "./WorldLoader";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";

const failures: string[] = [];
window.addEventListener("error", (event) =>
  failures.push(`Render error: ${String(event.error?.stack ?? event.message)}`),
);
window.addEventListener("unhandledrejection", (event) =>
  failures.push(`Unhandled: ${String(event.reason)}`),
);
function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
async function until(condition: () => unknown, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await settle();
  }
  throw new Error(
    `Timed out: ${message}; navigation=${JSON.stringify(store.get().browserNavigation)}; selected=${store.get().selectedPaneId}; notice=${JSON.stringify(store.get().notice)}; body=${document.body.innerText.slice(0, 1400)}; panes=${JSON.stringify([...document.querySelectorAll("[data-pane-id]")].map((e) => [e.getAttribute("data-pane-id"), e.getBoundingClientRect().height, e.closest(".world-terminal-parking") !== null]))}; labels=${JSON.stringify([...document.querySelectorAll(".world-new-seat-canvas-action")].map((e) => e.getAttribute("aria-label")))}`,
  );
}
const methods = ["pane.focus", "tab.create", "workspace.create"];
const hosts = ["alpha", "beta"];
const runtime = new Map(
  hosts.map((host) => [
    host,
    {
      workspaces: [] as Workspace[],
      tabs: [] as Tab[],
      panes: [] as Pane[],
      attached: new Set<string>(),
      selectedPaneId: "",
    },
  ]),
);
const calls: Array<{
  host: string;
  method: string;
  params: Record<string, unknown>;
}> = [];
const terminalListeners = new Set<(push: TerminalPush) => void>();
let revision = 1;
let created = 0;
let heldMutation: Promise<void> | null = null;
let heldAttachment: { terminalId: string; promise: Promise<void> } | null =
  null;
let zoomedTabId: string | null = null;
let lastCreated: Pane | null = null;
function addTab(host: string, workspaceId: string, id: string) {
  const r = runtime.get(host)!;
  const number =
    r.tabs.filter((tab) => tab.workspace_id === workspaceId).length + 1;
  const tab: Tab = {
    workspace_id: workspaceId,
    tab_id: `${id}-tab`,
    label: `${id} tab`,
    number,
    focused: false,
    pane_count: 1,
    agent_status: "idle",
  };
  const pane: Pane = {
    workspace_id: workspaceId,
    tab_id: tab.tab_id,
    pane_id: `${id}-pane`,
    terminal_id: `${id}-terminal`,
    focused: false,
    revision: 1,
    agent_status: "idle",
  };
  r.tabs.push(tab);
  r.panes.push(pane);
  return { tab, pane };
}
function addWorkspace(host: string, id: string, count = 1) {
  const r = runtime.get(host)!;
  const workspace: Workspace = {
    workspace_id: id,
    label: `${host} ${id}`,
    number: r.workspaces.length + 1,
    focused: false,
    pane_count: count,
    tab_count: count,
    agent_status: "idle",
  };
  r.workspaces.push(workspace);
  let root: ReturnType<typeof addTab> | undefined;
  for (let n = 1; n <= count; n++) {
    const item = addTab(host, id, `${id}-${n}`);
    root ??= item;
  }
  workspace.active_tab_id = root!.tab.tab_id;
  return { workspace, ...root! };
}
addWorkspace("alpha", "a");
addWorkspace("alpha", "b", 8);
addWorkspace("beta", "a");
const syntheticSession = {
  source: "herdr:claude",
  agent: "claude",
  kind: "id" as const,
  value: "synthetic-session",
};
let sessionArrived = false;
let chatUnavailable = "";
let conversationReads = 0;
let completedConversationReads = 0;
let conversationBarrier: Promise<void> | null = null;
const conversationControls = new Set<Parameters<typeof bridge.onControl>[0]>();
// One agent starts without a session, so Town initially opens Terminal.
runtime.get("beta")!.panes[0]!.agent = "claude";
function workspaces(host: string) {
  const r = runtime.get(host)!;
  return r.workspaces.map((workspace) => ({
    ...workspace,
    tab_count: r.tabs.filter(
      (tab) => tab.workspace_id === workspace.workspace_id,
    ).length,
    pane_count: r.panes.filter(
      (pane) => pane.workspace_id === workspace.workspace_id,
    ).length,
  }));
}
function coverage(host: string) {
  const r = runtime.get(host)!;
  const status = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
  return {
    workspaces: r.workspaces.length,
    tabs: r.tabs.length,
    panes: r.panes.length,
    agent_panes: 0,
    status,
    by_workspace: r.workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      tabs: r.tabs.filter((tab) => tab.workspace_id === workspace.workspace_id)
        .length,
      panes: r.panes.filter(
        (pane) => pane.workspace_id === workspace.workspace_id,
      ).length,
      agent_panes: 0,
      status,
    })),
  };
}
function worldSnapshot() {
  return {
    revision: ++revision,
    observed_at: Date.now(),
    connections: hosts.map((host) => ({
      connection_id: host,
      label: host,
      source: "test",
      is_default: host === "alpha",
      state: "ready",
      generation: 7,
      snapshot_generation: 7,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: workspaces(host),
        tabs: runtime.get(host)!.tabs,
        panes: runtime.get(host)!.panes,
        agents: [],
        coverage: coverage(host),
      },
    })),
  };
}
const clients = new Map<string, ConnectionClient>();
for (const host of hosts) {
  const r = runtime.get(host)!;
  clients.set(host, {
    connectionId: host,
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: (value) => value === 7,
    call: async (method, params = {}) => {
      calls.push({ host, method, params });
      if (method === "agent_conversation.latest") {
        conversationReads++;
        await conversationBarrier;
        completedConversationReads++;
        // A new Codex pane's title can bind it before naming a thread: the
        // service reads "ok" with no fingerprint and no conversation.
        const unboundTitle = chatUnavailable === "unbound_title";
        const readable = sessionArrived && (!chatUnavailable || unboundTitle);
        return {
          conversation_version: 1,
          pane_id: params.pane_id,
          agent: "claude",
          agent_status: "idle",
          status: readable ? "ok" : "unavailable",
          session_binding: unboundTitle
            ? "title"
            : sessionArrived
              ? "reported"
              : null,
          session_fingerprint:
            sessionArrived && !unboundTitle
              ? taskSummarySessionFingerprint(syntheticSession)
              : null,
          session_label: sessionArrived ? "Synthetic session" : null,
          unavailable: readable
            ? null
            : {
                reason: chatUnavailable || "no_session",
                detail: chatUnavailable
                  ? `Synthetic ${chatUnavailable}. Open Terminal.`
                  : "Claude is starting. Check Terminal.",
              },
          messages: [],
          latest: null,
        };
      }
      if (method === "agent_history.get")
        return {
          history_version: 2,
          mode: "snapshot",
          cursor: { epoch: "synthetic", revision: 1 },
          window_limit: 200,
          agent: "claude",
          pane_id: params.pane_id,
          workspace_id: "a",
          tab_id: "a-1-tab",
          updated_at: "2026-11-01T09:00:00Z",
          path: "",
          entries: [],
        };
      if (method === "agent_conversation.steps") return { steps: [] };
      if (method === "workspace.list")
        return {
          navigation_mode: "browser-local",
          workspaces: workspaces(host),
          endpoint_availability: Object.fromEntries(
            r.panes.map((pane) => [
              pane.terminal_id,
              { methods, capabilities: [] },
            ]),
          ),
        };
      if (method === "tab.list") return { tabs: r.tabs };
      if (method === "pane.list") return { panes: r.panes };
      if (method === "file.list")
        return {
          workspace_id: params.workspace_id,
          root: "/synthetic",
          checkout_path: "/synthetic",
          path: "",
          entries: [],
          truncated: false,
        };
      if (method === "git.diff_summary")
        return { workspace_id: params.workspace_id, entries: [], counts: {} };
      if (method === "pane.get") {
        const pane = r.panes.find((pane) => pane.pane_id === params.pane_id);
        r.selectedPaneId = pane?.pane_id ?? "";
        return { pane };
      }
      if (method === "pane.layout") {
        const pane =
          r.panes.find((pane) => pane.pane_id === params.pane_id) ??
          r.panes.find((pane) => pane.pane_id === r.selectedPaneId) ??
          r.panes[0]!;
        return {
          layout: {
            workspace_id: pane.workspace_id,
            tab_id: pane.tab_id,
            zoomed: pane.tab_id === zoomedTabId,
            area: { x: 0, y: 0, width: 100, height: 30 },
            focused_pane_id: pane.pane_id,
            panes: r.panes
              .filter((item) => item.tab_id === pane.tab_id)
              .map((item) => ({
                pane_id: item.pane_id,
                focused: item.pane_id === pane.pane_id,
                rect: { x: 0, y: 0, width: 100, height: 30 },
              })),
            splits: [],
          },
        };
      }
      if (method === "terminal.attach") {
        const id = String(params.terminal_id);
        check(!r.attached.has(id), `Duplicate owner ${host}/${id}`);
        r.attached.add(id);
        for (const listener of terminalListeners)
          listener({
            connection_id: host,
            connection_generation: 7,
            terminal_id: id,
            width: Number(params.cols),
            height: Number(params.rows),
            full: true,
            bytes: btoa(`${id}\r\n`),
          });
        if (heldAttachment?.terminalId === id) await heldAttachment.promise;
        return { endpoint: { methods, capabilities: [] } };
      }
      if (method === "terminal.detach") {
        r.attached.delete(String(params.terminal_id));
        return {};
      }
      if (method === "tab.create" || method === "workspace.create") {
        const source = params.browser_source as
          | {
              workspace_id: string;
              tab_id: string;
              pane_id: string;
              terminal_id: string;
            }
          | undefined;
        const pane = r.panes.find(
          (pane) =>
            pane.pane_id === source?.pane_id &&
            pane.terminal_id === source.terminal_id &&
            pane.tab_id === source.tab_id &&
            pane.workspace_id === source.workspace_id,
        );
        if (!source || !pane || !r.attached.has(source.terminal_id))
          throw new Error("Source is not owned by this browser");
        check(
          params.focus === false,
          "Browser-local create dispatched shared focus",
        );
        if (method === "tab.create")
          check(
            source.workspace_id === params.workspace_id,
            "Tab creation crossed workspace source",
          );
        if (heldMutation) await heldMutation;
        if (!r.attached.has(source.terminal_id))
          throw new Error("Creation source detached while the RPC was pending");
        const id = `new-${++created}`;
        const result =
          method === "workspace.create"
            ? addWorkspace(host, id)
            : addTab(host, String(params.workspace_id), id);
        lastCreated = result.pane;
        return {
          type: method === "tab.create" ? "tab_created" : "workspace_created",
          ...("workspace" in result ? { workspace: result.workspace } : {}),
          tab: result.tab,
          root_pane: result.pane,
        };
      }
      return {};
    },
  });
}
function view(name: string) {
  const select = document.querySelector<HTMLSelectElement>(
    '[aria-label="World view"]',
  )!;
  select.value = name;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
function visiblePane(paneId: string) {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `.world-terminal-owner [data-pane-id="${paneId}"]`,
    ),
  ].find(
    (element) =>
      element.tagName !== "BUTTON" &&
      !element.closest(".world-terminal-parking") &&
      element.getBoundingClientRect().height > 0,
  );
}

async function createdInspector(count: number) {
  await until(
    () => created === count && lastCreated && visiblePane(lastCreated.pane_id),
    `created Inspector ${count}`,
  );
}
async function action(title: string) {
  const trigger = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (button) =>
      button.textContent?.trim() === "Actions" ||
      button.getAttribute("aria-label") === "Actions",
  );
  check(Boolean(trigger), "Actions trigger missing");
  trigger!.click();
  await until(
    () => document.querySelector(".command-item-title"),
    "Actions entries",
  );
  const entry = [
    ...document.querySelectorAll<HTMLElement>(".command-item-title"),
  ].find((item) => item.textContent === title);
  check(Boolean(entry), `Missing shared ${title} action`);
  const button = entry!.closest<HTMLElement>('[role="option"], [cmdk-item]')!;
  check(
    button.getAttribute("aria-disabled") !== "true",
    `${title} unexpectedly disabled: ${button.textContent}`,
  );
  button.click();
}
async function run() {
  const width = Number(await (await fetch("/viewport-ready")).text());
  check(
    window.innerWidth === width,
    `Incorrect viewport ${window.innerWidth}/${width}`,
  );
  history.replaceState(null, "", "/");
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  store.init = () => {};
  bridge.connection = ((host = "alpha") =>
    clients.get(host)!) as typeof bridge.connection;
  bridge.call = async () => worldSnapshot();
  bridge.onStatus = (listener) => {
    listener("connected");
    return () => {};
  };
  bridge.onEvent = () => () => {};
  bridge.onControl = (listener) => {
    conversationControls.add(listener);
    return () => {
      conversationControls.delete(listener);
    };
  };
  bridge.onTerminal = (listener) => {
    terminalListeners.add(listener);
    return () => {
      terminalListeners.delete(listener);
    };
  };
  bridge.onTerminalClipboard = bridge.onTerminalClosed = () => () => {};
  const alpha = runtime.get("alpha")!;
  __storeTesting.replaceState({
    ...store.get(),
    ...emptyServerSessionState(7),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: "alpha",
    defaultConnectionId: "alpha",
    connectionGeneration: 1,
    navigationMode: "browser-local",
    workspaces: workspaces("alpha"),
    tabs: alpha.tabs,
    panes: alpha.panes,
    selectedPaneId: "a-1-pane",
    lastRefresh: Date.now(),
    browserNavigation: {
      revision: 1,
      workspaceId: "a",
      tabIds: { a: "a-1-tab", b: "b-1-tab" },
      paneIds: { "a-1-tab": "a-1-pane", "b-1-tab": "b-1-pane" },
    },
    connections: hosts.map((host) => ({
      id: host,
      label: host,
      source: "test",
      state: "ready",
      generation: 7,
      is_default: host === "alpha",
    })),
  });
  await worldRuntimeStore.refresh();
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  root.render(<WorldFoundationApp />);
  // The root opens Town; this case exercises Office's creation controls.
  await until(
    () =>
      document.querySelector<HTMLSelectElement>('[aria-label="World view"]')
        ?.value === "town",
    "Root did not default to Town",
  );
  // A reported session is not proof that its conversation is readable.
  const betaPane = runtime.get("beta")!.panes[0]!;
  sessionArrived = true;
  betaPane.agent_session = syntheticSession;
  chatUnavailable = "missing_integration";
  await worldRuntimeStore.refresh();
  const openAgent = async (unavailable = true) => {
    const selector =
      '.town-view-shell .world-semantic-target[data-kind="agent"]';
    await until(() => document.querySelector(selector), "Town agent target");
    document.querySelector<HTMLButtonElement>(selector)!.click();
    await until(
      () =>
        document.querySelector(
          unavailable
            ? '.workspace-inspector[data-view="terminal"]'
            : ".workspace-inspector",
        ),
      "Unreadable Chat must open on Terminal even with a reported session",
    );
  };
  const chooseView = async (view: "history" | "terminal") => {
    const trigger = document.querySelector<HTMLButtonElement>(
      '.workspace-inspector button[aria-label^="Inspector view:"]',
    );
    if (trigger) trigger.click();
    const selector = trigger
      ? `[aria-label="Inspector views"] [data-view="${view}"]`
      : `.workspace-inspector [role="tab"][aria-label="${view === "history" ? "Chat" : "Terminal"}"]`;
    await until(() => document.querySelector(selector), `Choose ${view}`);
    document.querySelector<HTMLButtonElement>(selector)!.click();
  };
  const conversationChanged = () => {
    for (const listener of conversationControls)
      listener({
        type: "agent_conversation_changed",
        connection_id: "beta",
        connection_generation: 7,
        pane_id: betaPane.pane_id,
      });
  };
  const closeAgent = async () => {
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Close Inspector window"]',
      )!
      .click();
    await until(
      () => !document.querySelector(".workspace-inspector"),
      "Return to Town",
    );
  };
  // While the opening waits on Terminal for Chat it says so; Stay on
  // Terminal is a manual view choice, so a later readable Chat keeps it.
  const waitLine = () =>
    document.querySelector<HTMLElement>(
      ".workspace-inspector .world-inspector-chat-wait",
    );
  // Cross the real timer boundary and retain the same announcer throughout.
  const timedHost = document.createElement("div");
  document.body.append(timedHost);
  const timedRoot = createRoot(timedHost);
  flushSync(() =>
    timedRoot.render(
      <WorldLoader
        since={Date.now() - WORLD_LOADER_LONGER_MS + 1000}
        label="Waiting for Chat"
        longerLabel="Still waiting for Chat"
      />,
    ),
  );
  const timedStatus = timedHost.querySelector('[role="status"]')!;
  check(
    timedStatus.textContent === "Waiting for Chat" &&
      !timedStatus.closest('[aria-busy="true"]'),
    "The initial live announcement is outside busy content",
  );
  await until(
    () => timedStatus.textContent === "Still waiting for Chat",
    "The elapsed wait updates its live announcement",
  );
  check(
    timedHost.querySelector('[role="status"]') === timedStatus &&
      !timedStatus.closest('[aria-busy="true"]'),
    "The longer-wait announcement retains a live region outside busy content",
  );
  timedRoot.unmount();
  timedHost.remove();
  await openAgent();
  await until(waitLine, "The opening window says it is waiting for Chat");
  check(
    !!waitLine()?.textContent?.includes("Chat is not available yet") &&
      !!waitLine()?.querySelector('[role="status"]') &&
      !waitLine()!
        .querySelector('[role="status"]')!
        .closest('[aria-busy="true"]') &&
      !waitLine()!.closest(".workspace-inspector-body"),
    "The Chat-availability status is outside busy content and the Terminal body",
  );
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const rowBounds = waitLine()!.getBoundingClientRect();
  const actionBounds = waitLine()!
    .querySelector("button")!
    .getBoundingClientRect();
  check(
    rowBounds.left >= 0 &&
      rowBounds.right <= innerWidth &&
      actionBounds.left >= rowBounds.left &&
      actionBounds.right <= rowBounds.right &&
      (innerWidth > 640 || actionBounds.height >= 44),
    "The waiting row and Terminal action fit desktop and phone with a phone touch target",
  );
  check(
    matchMedia("(prefers-reduced-motion: reduce)").matches &&
      getComputedStyle(waitLine()!.querySelector("svg")!).animationName ===
        "none",
    "Reduced motion stops the waiting icon",
  );
  const stay = Array.from(waitLine()!.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Stay on Terminal"),
  );
  stay!.click();
  await until(() => !waitLine(), "Stay on Terminal ends the wait line");
  chatUnavailable = "";
  conversationChanged();
  await worldRuntimeStore.refresh();
  await settle();
  check(
    !!document.querySelector('.workspace-inspector[data-view="terminal"]'),
    "After Stay on Terminal a readable Chat does not switch the window",
  );
  chatUnavailable = "missing_integration";
  await closeAgent();
  await openAgent();
  for (const reason of [
    "no_session",
    "missing_integration",
    "unsupported_agent",
    "read_failed",
    "unbound_title",
  ]) {
    chatUnavailable = reason;
    const before = conversationReads;
    conversationChanged();
    await until(() => conversationReads > before, `Recheck ${reason}`);
    await settle();
    check(
      !!document.querySelector('.workspace-inspector[data-view="terminal"]') &&
        !document.querySelector(".agent-chat-unavailable"),
      `${reason} stays on Terminal without an automatic error page`,
    );
    check(
      betaPane.agent_status === "idle" &&
        !!betaPane.agent_session &&
        !!waitLine()?.textContent?.includes("Chat is not available yet") &&
        !/starting|answer/i.test(waitLine()?.textContent ?? ""),
      `${reason} with an existing idle session describes Chat availability without claiming startup or an unanswered request`,
    );
  }
  const manualReply = Promise.withResolvers<void>();
  conversationBarrier = manualReply.promise;
  chatUnavailable = "";
  const manualRead = conversationReads;
  conversationChanged();
  await until(
    () => conversationReads > manualRead,
    "Delayed availability read",
  );
  await chooseView("terminal");
  const manualCompleted = completedConversationReads;
  conversationBarrier = null;
  manualReply.resolve();
  await until(
    () => completedConversationReads > manualCompleted,
    "Late availability reply",
  );
  await settle();
  check(
    !!document.querySelector('.workspace-inspector[data-view="terminal"]') &&
      !waitLine(),
    "A late available reply cannot override a manual view choice",
  );
  chatUnavailable = "read_failed";
  await chooseView("history");
  await until(
    () =>
      document
        .querySelector(".agent-chat-unavailable")
        ?.textContent?.includes("Synthetic read_failed"),
    "Manual Chat retains the bound record error",
  );
  const openTerminal = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".agent-chat-unavailable button",
    ),
  ).find((button) => button.textContent?.includes("Open Terminal"));
  check(!!openTerminal, "Manual unavailable Chat offers Open Terminal");
  openTerminal!.click();
  await until(
    () => document.querySelector('.workspace-inspector[data-view="terminal"]'),
    "Open Terminal leaves unavailable Chat",
  );
  chatUnavailable = "";
  conversationChanged();
  await worldRuntimeStore.refresh();
  check(
    !!document.querySelector('.workspace-inspector[data-view="terminal"]'),
    "Recovery cannot override a manual Terminal choice",
  );
  await closeAgent();
  await openAgent(false);
  await until(
    () => document.querySelector('.workspace-inspector[data-view="history"]'),
    "An untouched window follows actual Chat availability",
  );
  await closeAgent();
  // Focused terminal/harness replacement retires the opening before aggregate
  // reconciliation; even restoration cannot let its delayed reply switch views.
  const focusedPane = (patch: Partial<Pane>) => {
    const state = store.get(),
      snapshot = connectionSnapshot(state, "beta");
    const panes = snapshot.panes.map((pane) =>
      pane.pane_id === betaPane.pane_id ? { ...pane, ...patch } : pane,
    );
    __storeTesting.replaceState({
      ...state,
      ...(state.activeConnectionId === "beta" ? { panes } : {}),
      sessionsByConnectionId: {
        ...state.sessionsByConnectionId,
        beta: { ...snapshot, panes },
      },
    });
  };
  for (const replacement of [
    { terminal_id: "replacement-terminal" },
    { agent: "replacement-harness" },
  ]) {
    chatUnavailable = "read_failed";
    await openAgent();
    const reply = Promise.withResolvers<void>();
    conversationBarrier = reply.promise;
    chatUnavailable = "";
    const before = conversationReads;
    conversationChanged();
    await until(() => conversationReads > before, "Captured availability read");
    focusedPane(replacement);
    await settle();
    focusedPane({ terminal_id: betaPane.terminal_id, agent: betaPane.agent });
    await settle();
    const completed = completedConversationReads;
    conversationBarrier = null;
    reply.resolve();
    await until(
      () => completedConversationReads > completed,
      "Replaced availability reply",
    );
    await settle();
    check(
      !!document.querySelector('.workspace-inspector[data-view="terminal"]'),
      "Replacement/restoration cannot revive an automatic Chat switch",
    );
    await closeAgent();
  }
  sessionArrived = false;
  delete betaPane.agent_session;
  await worldRuntimeStore.refresh();
  // On the phone, a terminal opened from a Town agent's card takes two
  // Backs to leave: the first closes Composer, the second returns to Town.
  if (window.innerWidth < 640) {
    const townPath = window.location.pathname;
    await until(
      () =>
        document.querySelector(
          '.town-view-shell .world-semantic-target[data-kind="agent"]',
        ),
      "Town agent target",
    );
    document
      .querySelector<HTMLButtonElement>(
        '.town-view-shell .world-semantic-target[data-kind="agent"]',
      )!
      .click();
    // A phone's anchored header control switches views; ⋯ holds attention.
    const viewTrigger = () =>
      document.querySelector<HTMLButtonElement>(
        '.workspace-inspector button[aria-label^="Inspector view:"]',
      );
    await until(
      () =>
        document.querySelector('.workspace-inspector[data-view="terminal"]') &&
        viewTrigger(),
      "Town pre-session agent window on Terminal",
    );
    sessionArrived = true;
    Object.assign(runtime.get("beta")!.panes[0]!, {
      agent_session: syntheticSession,
    });
    await worldRuntimeStore.refresh();
    await until(
      () =>
        document.querySelector('.workspace-inspector[data-view="history"]') &&
        viewTrigger(),
      "Town agent window on Chat after session arrival",
    );
    viewTrigger()!.click();
    const terminalItem = () =>
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Inspector views"] [data-view="terminal"]',
      );
    await until(terminalItem, "Terminal in the anchored view selector");
    terminalItem()!.click();
    await until(
      () =>
        document.querySelector(
          ".workspace-inspector textarea.terminal-composer-input",
        ),
      "Town opened the agent's terminal",
    );
    await worldRuntimeStore.refresh();
    check(
      Boolean(
        document.querySelector('.workspace-inspector[data-view="terminal"]'),
      ),
      "A refresh replaced the manual Terminal choice",
    );
    document
      .querySelector<HTMLTextAreaElement>(
        ".workspace-inspector textarea.terminal-composer-input",
      )!
      .click();
    await until(
      () => document.querySelector(".workspace-inspector .terminal-composer"),
      "Composer opened in the terminal",
    );
    history.back();
    await until(
      () =>
        !document.querySelector(
          ".workspace-inspector .terminal-composer[data-open]",
        ),
      "the first Back did not close Composer",
    );
    check(
      !!document.querySelector(".workspace-inspector"),
      "the first Back closed the terminal too",
    );
    history.back();
    await until(
      () => !document.querySelector(".workspace-inspector"),
      "the second Back did not return to Town",
    );
    await settle();
    check(
      window.location.pathname === townPath &&
        !!document.querySelector(".town-view-shell"),
      `the second Back left Town for ${window.location.pathname}`,
    );
  }
  const rootViewSelect = document.querySelector<HTMLSelectElement>(
    '[aria-label="World view"]',
  )!;
  rootViewSelect.value = "town";
  rootViewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document.querySelector(
        '.world-office-shell .world-new-seat-canvas-action[aria-label*="alpha b"]',
      ),
    "second room control",
  );
  check(
    !document.querySelector(".workspace-inspector"),
    "Fresh Office unexpectedly has Inspector",
  );
  const fullRoom = document.querySelector<HTMLButtonElement>(
    '.world-new-seat-canvas-action[aria-label*="alpha b"]',
  )!;
  await until(
    () => !fullRoom.disabled,
    "full room creation admitted after scene render",
  );
  check(!fullRoom.disabled, "Eight displayed desks disabled creation");
  check(
    !alpha.attached.has("b-1-terminal"),
    "Second room was eagerly attached",
  );
  const chooseTerminal = async (
    connectionId: string,
    workspaceId: string,
    repeat = false,
  ) => {
    await until(
      () => document.querySelector(".agent-launcher-card"),
      "room launcher Terminal choice",
    );
    const expected = buildWorldObject(
      worldRuntimeStore.get().connections,
      "alpha",
    ).spaces.find(
      (space) =>
        space.connectionId === connectionId && space.nativeId === workspaceId,
    );
    check(
      document.querySelector<HTMLSelectElement>(".agent-launcher select")
        ?.value === expected?.id,
      "Room launcher changed the seat's qualified destination",
    );
    const terminal = document.querySelector<HTMLButtonElement>(
      ".agent-launcher-card",
    )!;
    check(
      terminal.textContent?.includes("Terminal"),
      "The first room launcher choice must be Terminal",
    );
    terminal.click();
    if (repeat) terminal.click();
  };
  const gate = Promise.withResolvers<void>();
  heldMutation = gate.promise;
  fullRoom.click();
  fullRoom.click();
  await chooseTerminal("alpha", "b", true);
  await until(
    () => calls.some((call) => call.method === "tab.create"),
    "second-room prepared dispatch",
  );
  check(
    alpha.attached.has("b-1-terminal"),
    "Second-room source was not prepared",
  );
  await until(() => fullRoom.disabled, "visible creating state");
  check(
    calls.filter((call) => call.method === "tab.create").length === 1,
    "Repeated plus duplicated mutation",
  );
  heldMutation = null;
  gate.resolve();
  await createdInspector(1);
  check(
    alpha.tabs.filter((tab) => tab.workspace_id === "b").length === 9,
    "Ninth tab was not created",
  );
  const projection = projectWorldOffice(
    buildWorldObject(worldRuntimeStore.get().connections, "alpha"),
    Date.now(),
  );
  check(
    projection.rooms.find(
      (room) =>
        room.workspaceRef.connectionId === "alpha" &&
        room.workspaceRef.nativeId === "b",
    )?.desks.length === 8,
    "Office exceeded eight displayed desks",
  );
  const betaRoom = document.querySelector<HTMLButtonElement>(
    '.world-new-seat-canvas-action[aria-label*="beta a"]',
  )!;
  await until(
    () => !betaRoom.disabled,
    "cold inactive host control after scene render",
  );
  check(!betaRoom.disabled, "Cold inactive host was not preparable");
  betaRoom.click();
  await chooseTerminal("beta", "a");
  await createdInspector(2);
  check(
    store.get().activeConnectionId === "alpha",
    "Inactive host creation changed Spaces host",
  );
  check(
    [...calls].reverse().find((call) => call.method === "tab.create")?.host ===
      "beta",
    "Inactive host dispatch fell back to alpha",
  );
  const roomButton = document.querySelector<HTMLButtonElement>(
    ".world-new-room-canvas-action",
  )!;
  await until(() => !roomButton.disabled, "room-specific workspace control");
  roomButton.click();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        '[aria-label="Destination host"]',
      )?.value === "beta",
    "New room retains selected host",
  );
  document
    .querySelector<HTMLFormElement>(
      '[role="dialog"][aria-label="Create workspace"]',
    )!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await createdInspector(3);
  const roomCreate = [...calls]
    .reverse()
    .find((call) => call.method === "workspace.create")!;
  check(
    roomCreate.host === "beta" &&
      (roomCreate.params.browser_source as { workspace_id: string })
        .workspace_id === "a",
    "New room used another host or source workspace",
  );
  for (const name of ["town", "desk", "board"]) {
    view(name);
    await settle();
    const beforeTab = created;
    await action("New tab");
    await createdInspector(beforeTab + 1);
    check(
      location.pathname === `/${name}`,
      `${name} tab creation switched view`,
    );
    const count = created;
    await action("New workspace");
    await until(
      () =>
        document.querySelector(
          '[role="dialog"][aria-label="Create workspace"]',
        ),
      `${name} workspace confirmation`,
    );
    const destination = document.querySelector<HTMLSelectElement>(
      '[aria-label="Destination host"]',
    )!;
    await until(
      () => destination.value === "beta",
      `${name} selected destination effect`,
    );
    check(
      destination.value === "beta",
      `${name} workspace destination lost selected host`,
    );
    document
      .querySelector<HTMLFormElement>(
        '[role="dialog"][aria-label="Create workspace"]',
      )!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await createdInspector(count + 1);
    check(
      location.pathname === `/${name}`,
      `${name} workspace creation switched view`,
    );
  }
  const viewChangeCount = created;
  const viewGate = Promise.withResolvers<void>();
  heldMutation = viewGate.promise;
  await action("New tab");
  await until(
    () =>
      calls.filter(
        (call) =>
          call.method === "tab.create" || call.method === "workspace.create",
      ).length ===
      viewChangeCount + 1,
    "held creation dispatched before view change",
  );
  view("board");
  await settle();
  heldMutation = null;
  viewGate.resolve();
  await createdInspector(viewChangeCount + 1);
  check(
    location.pathname === "/board",
    "Pending creation lost the current visual view",
  );
  // Stale-observation admission is covered by useWorldCreatedTerminal.test.ts.
  // Retain the real Close-button intent wiring and rendered-Inspector check.
  const supersededCount = created;
  const supersededGate = Promise.withResolvers<void>();
  heldMutation = supersededGate.promise;
  await action("New tab");
  await until(
    () =>
      calls.filter(
        (call) =>
          call.method === "tab.create" || call.method === "workspace.create",
      ).length ===
      supersededCount + 1,
    "held creation before explicit Inspector close",
  );
  const close = document.querySelector<HTMLButtonElement>(
    '.world-managed-window.is-active [aria-label="Close Inspector window"]',
  );
  check(Boolean(close), "Current Inspector close action missing");
  close!.click();
  heldMutation = null;
  supersededGate.resolve();
  await until(
    () =>
      created === supersededCount + 1 &&
      store.get().notice?.detail?.includes("superseded"),
    "newer Inspector close supersedes automatic focus",
  );
  check(
    lastCreated && !visiblePane(lastCreated.pane_id),
    "Late creation reopened an Inspector after explicit close",
  );
  view("spaces");
  await settle();
  const count = created;
  await store.createTab("a");
  await until(
    () =>
      created === count + 1 && lastCreated && visiblePane(lastCreated.pane_id),
    "Spaces native created terminal",
  );
  check(location.pathname === "/spaces", "Spaces creation switched view");
  check(
    calls.filter(
      (call) =>
        call.method === "tab.create" || call.method === "workspace.create",
    ).length === created,
    "Creation dispatch/result counts differ",
  );
  // Completion follows the current view in both directions, for both operations.
  for (const [from, to] of [
    ["spaces", "town"],
    ["town", "spaces"],
  ] as const) {
    for (const kind of ["tab", "workspace"] as const) {
      view(from);
      await settle();
      await store.focusWorkspace("a");
      const gate = Promise.withResolvers<void>();
      heldMutation = gate.promise;
      const before = created;
      const method = `${kind}.create`;
      const beforeCalls = calls.filter((call) => call.method === method).length;
      const pending =
        kind === "tab"
          ? store.createTab("a")
          : store.createWorkspace("View handoff");
      await until(
        () =>
          calls.filter((call) => call.method === method).length > beforeCalls,
        `${from} ${kind} pending dispatch`,
      );
      view(to);
      await settle();
      const inspectorsBeforeCompletion = document.querySelectorAll(
        ".world-managed-window",
      ).length;
      heldMutation = null;
      gate.resolve();
      await pending;
      await store.refresh();
      await worldRuntimeStore.refresh();
      await createdInspector(before + 1);
      check(
        location.pathname === `/${to}`,
        `${from}-to-${to} ${kind} completion changed the view`,
      );
      if (to === "spaces")
        check(
          document.querySelectorAll(".world-managed-window").length ===
            inspectorsBeforeCompletion,
          "Spaces completion opened a hidden visual Inspector",
        );
    }
  }

  view("spaces");
  await settle();
  const first = alpha.panes.find((pane) => pane.pane_id === "a-1-pane")!;
  const sibling = {
    ...first,
    pane_id: "a-sibling-pane",
    terminal_id: "a-sibling-terminal",
  };
  alpha.panes.push(sibling);
  await store.refresh();
  await store.focusPane(first.pane_id);
  await until(
    () => alpha.attached.has(first.terminal_id),
    "split source pane attached",
  );
  // Start with the source hidden: its new attachment must wait for the ACK,
  // independently of the selected mobile/zoomed pane.
  await store.focusPane(sibling.pane_id);
  zoomedTabId = first.tab_id;
  await store.refresh();
  await until(
    () =>
      !alpha.attached.has(first.terminal_id) && visiblePane(sibling.pane_id),
    "zoomed sibling visible before source preparation",
  );
  const attachmentGate = Promise.withResolvers<void>();
  heldAttachment = {
    terminalId: first.terminal_id,
    promise: attachmentGate.promise,
  };
  const retainGate = Promise.withResolvers<void>();
  heldMutation = retainGate.promise;
  const beforeRetainCalls = calls.filter(
    (call) => call.method === "tab.create",
  ).length;
  const retained = store.createQualifiedTab(
    { connectionId: "alpha", runtimeGeneration: 7 },
    "a",
    { sourcePaneId: first.pane_id },
  );
  await until(
    () =>
      alpha.attached.has(first.terminal_id) &&
      store.get().terminalAttachments[first.terminal_id]?.ready === false,
    "demanded source awaiting attachment ACK",
  );
  const sourceAttaches = calls.filter(
    (call) =>
      call.method === "terminal.attach" &&
      call.params.terminal_id === first.terminal_id,
  ).length;
  zoomedTabId = null;
  await store.refresh();
  await store.focusPane(first.pane_id);
  await until(() => visiblePane(first.pane_id), "preparing source visible");
  await store.focusPane(sibling.pane_id);
  await until(
    () =>
      visiblePane(sibling.pane_id) && alpha.attached.has(sibling.terminal_id),
    "preparation switched to split sibling",
  );
  check(
    alpha.attached.has(first.terminal_id),
    "Pane selection detached the source before its attachment ACK",
  );
  check(
    calls.filter((call) => call.method === "tab.create").length ===
      beforeRetainCalls,
    "Creation dispatched before its source attachment ACK",
  );
  heldAttachment = null;
  attachmentGate.resolve();
  await until(
    () =>
      calls.filter((call) => call.method === "tab.create").length >
      beforeRetainCalls,
    "split pending dispatch",
  );
  check(
    alpha.attached.has(first.terminal_id),
    "Changing split pane detached the pending creation source",
  );
  if (width === 390)
    check(
      !visiblePane(first.pane_id),
      "Retained source displaced the visible mobile split pane",
    );
  zoomedTabId = first.tab_id;
  await store.refresh();
  await settle();
  check(
    alpha.attached.has(first.terminal_id),
    "Zooming the sibling detached the pending creation source",
  );
  check(
    !visiblePane(first.pane_id) && visiblePane(sibling.pane_id),
    "Zoom did not retain the source independently of visibility",
  );
  check(
    calls.filter(
      (call) =>
        call.method === "terminal.attach" &&
        call.params.terminal_id === first.terminal_id,
    ).length === sourceAttaches,
    "Retained source was remounted during preparation, pane selection or zoom",
  );
  heldMutation = null;
  retainGate.resolve();
  await retained;
  check(
    Boolean(visiblePane(sibling.pane_id)),
    "Creation overrode the newer split-pane selection",
  );
  check(
    calls.filter((call) => call.method === "tab.create").length ===
      beforeRetainCalls + 1,
    "Prepared source did not dispatch exactly once",
  );
  check(
    creationSources().length === 0,
    "Creation did not release its retained source demand",
  );
  check(
    calls.filter(
      (call) =>
        call.method === "tab.create" || call.method === "workspace.create",
    ).length === created,
    "Handoff creation dispatch/result counts differ",
  );
  root.unmount();
  await settle();
  check(
    [...runtime.values()].every((r) => r.attached.size === 0),
    "Unmount leaked terminal owners",
  );
}
run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    }),
  );
