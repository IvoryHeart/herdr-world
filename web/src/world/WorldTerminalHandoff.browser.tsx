import {
  admissionClock,
  nextCreatedOpenerCompletion,
} from "./testing/handoffAdmissionClock";

const resumeGallery = new URLSearchParams(location.search).has(
  "resume-gallery",
);
import { TerminalAttachFrameWatchdog } from "../terminalResize";
import { requestTerminalComposer } from "./terminalComposerRequest";
import {
  readTerminalComposerDraft,
  terminalComposerDraftKey,
} from "../terminalComposer";
import { subscribeCreations } from "../creationRequests";
const creationPhases: string[] = [];
subscribeCreations((event) =>
  creationPhases.push(`${event.id}:${event.phase}`),
);
window.__HERDR_WORLD_RENDERER_DEBUG__ = true;
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  bridge,
  type ConnectionClient,
  type TerminalPush,
  type TerminalClosedPush,
} from "../api";
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
import { TASK_NOTIFICATION_ACTIVATE_EVENT } from "../taskNotifications";
import { worldLocalStorage } from "../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
} from "./officePreferences";
import type { Pane, PaneLayout, Tab, Workspace } from "../types";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import {
  INSPECTOR_TERMINAL_FILE_EVENT,
  type InspectorTerminalFileRequest,
} from "./inspectorTerminalHandoff";
import { worldRuntimeStore } from "./runtimeStore";
import { CREATED_PANE_ADMISSION_TIMEOUT_MS } from "./officeRoomActions";
import { buildWorldObject, worldObjectId } from "./worldObject";
import WorldFoundationApp from "./WorldFoundationApp";
import { runSharedInspectorChecks } from "./testing/sharedInspectorBrowser";
import { worldInspectorWindowId } from "./worldTerminalPresentation";
import type { BoardDocument, BoardOp } from "./board/boardDocument";
import { interestKey } from "../../../shared/interest";
import {
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
} from "../workspaceResource";

const failures: string[] = [];
const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
const boardDocument: BoardDocument = {
  version: 1,
  revision: 0,
  layout: { anchors: {}, offsets: {}, pinned: {}, folded: [], interest: {} },
  notes: [],
  strings: [],
};
let failInterestPatch = false;
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
// ResizeObserver runs after layout. Give its React update a painted frame
// before dispatching another arrangement or saving a geometry baseline.
const settleWindowLayout = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function enterSearch(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
let renderError: unknown = null;
window.addEventListener("error", (event) => {
  if (event.error) renderError = event.error;
});
async function until(
  condition: () => unknown,
  message: string | (() => string),
) {
  for (let index = 0; index < 200; index += 1) {
    if (renderError) throw renderError;
    if (condition()) return;
    await settle();
  }
  throw new Error(
    `Timed out: ${typeof message === "function" ? message() : message}; titles=${JSON.stringify([...document.querySelectorAll(".world-managed-window")].map((e) => [e.getAttribute("aria-label"), e.className, e.querySelector("[data-pane-id]")?.getAttribute("data-pane-id")]))}; phases=${JSON.stringify(creationPhases)}; notice=${JSON.stringify(store.get().notice)}; mode=${store.get().navigationMode}; browser=${JSON.stringify(store.get().browserNavigation)}; selected=${store.get().selectedPaneId}; owners=${document.querySelectorAll(".world-terminal-owner").length}; parking=${document.querySelectorAll(".world-terminal-parking").length}; inspectors=${document.querySelectorAll(".workspace-inspector").length}; rail=${document.querySelector(".world-context-rail")?.className}; text=${document.body.textContent?.slice(-1200)}; calls=${JSON.stringify(calls.slice(-12))}`,
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
  worktree: {
    repo_key: "studio",
    repo_name: "Studio",
    repo_root: "/repo",
    checkout_path: "/repo",
    is_linked_worktree: false,
    git_status: {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: 2,
      unstaged: 3,
      untracked: 2,
      conflicted: 0,
      dirty: true,
    },
  },
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
    // A harness Chat reads, so the Reviewer opens on Chat; the Builder's
    // harness is one Chat cannot read, so it opens its terminal.
    agent: "claude",
    display_agent: "Reviewer",
    agent_status: "idle",
    revision: 1,
  },
];
let notificationSessionId = "reviewer-session";
let replaceNotificationSessionAfterRead = false;
let replaceNotificationSessionOnSnapshot = false;
let omitNextOperationalTabPanes: string | null = null;
let focusedPaneId = panes[0].pane_id;
let focusedTabId = tabs[0]!.tab_id;
const rememberedTabPanes = new Map<string, string>();
let worldRevision = 1;
let runtimeGeneration = 7;
let includeSecondHost = false;
let secondHostGeneration = 3;
let rejectNextWorldSnapshot = false;
let ambiguousAgentWorktrees = false;
let staleNextWorldSnapshot = false;
let omitNextWorldTopology = false;
let siblingObservationGate: Promise<void> | null = null;
let navigationMode: "shared" | "browser-local" = "browser-local";
const initialTerminalAttach = Promise.withResolvers<void>();
let zoomedFocusedPaneId: string | null = null;
let delayedPaneGet: {
  paneId: string;
  promise: Promise<void>;
  entered?: () => void;
} | null = null;
let delayedTabList: { promise: Promise<void>; tabs: Tab[] } | null = null;
let delayedPaneLayout: { promise: Promise<void>; layout: PaneLayout } | null =
  null;
let rejectNextPaneGetId: string | null = null;
let rejectedPaneGets = 0;
let agents: Record<string, unknown>[] = [
  {
    pane_id: "reviewer-pane",
    terminal_id: "reviewer-terminal",
    agent: "claude",
    agent_session: { agent: "claude", kind: "id", value: "review-a" },
  },
];
const terminalListeners = new Set<(push: TerminalPush) => void>();
const terminalClosedListeners = new Set<(push: TerminalClosedPush) => void>();
let suppressFrameFor: string | null = null;

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

let client: ConnectionClient = {
  connectionId: "local",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 7,
  call: async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "world.board.get") return structuredClone(boardDocument);
    if (method === "world.board.patch") {
      if (failInterestPatch) throw new Error("Synthetic Interest save failure");
      for (const op of params.ops as BoardOp[]) {
        if (op.op !== "interest.set") continue;
        if (op.interest) boardDocument.layout.interest![op.key] = op.interest;
        else delete boardDocument.layout.interest![op.key];
      }
      boardDocument.revision += 1;
      return { document: structuredClone(boardDocument) };
    }
    if (method === "agent_session.get" && !params.agent) {
      const value = notificationSessionId;
      if (replaceNotificationSessionAfterRead) {
        notificationSessionId = "replacement-session";
        replaceNotificationSessionAfterRead = false;
      }
      return { session: { value } };
    }
    if (method === "world.snapshot") {
      if (
        siblingObservationGate &&
        panes.some((pane) => pane.pane_id === "builder-sibling-pane")
      )
        await siblingObservationGate;
      if (replaceNotificationSessionOnSnapshot) {
        notificationSessionId = "replacement-session";
        replaceNotificationSessionOnSnapshot = false;
      }
      if (rejectNextWorldSnapshot) {
        rejectNextWorldSnapshot = false;
        throw new Error("Synthetic transient World observation failure");
      }
      const stale = staleNextWorldSnapshot;
      staleNextWorldSnapshot = false;
      const omitTopology = omitNextWorldTopology;
      omitNextWorldTopology = false;
      const observation = {
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
            stale,
            actionable: !stale,
            snapshot: {
              workspaces: [currentWorkspace()],
              tabs: omitTopology ? [] : currentTabs(),
              panes: omitTopology ? [] : currentPanes(),
              agents,
              coverage: currentWorldCoverage(),
            },
          },
        ],
      };
      if (includeSecondHost)
        observation.connections.push({
          ...observation.connections[0]!,
          connection_id: "beta",
          label: "Beta",
          is_default: false,
          generation: secondHostGeneration,
          snapshot_generation: secondHostGeneration,
        });
      return observation;
    }
    if (method === "pane.get") {
      const paneId = String(params.pane_id ?? "");
      if (delayedPaneGet?.paneId === paneId) {
        delayedPaneGet.entered?.();
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
        rememberedTabPanes.set(pane.tab_id, pane.pane_id);
      }
      return pane ? { pane: { ...pane, focused: true } } : {};
    }
    if (method === "workspace.list") {
      return {
        navigation_mode: navigationMode,
        workspaces: [currentWorkspace()],
      };
    }
    if (method === "tab.list") {
      const delayed = delayedTabList;
      const listed = delayed?.tabs ?? currentTabs();
      if (delayed) await delayed.promise;
      return { tabs: listed };
    }
    if (method === "pane.list") {
      const omittedTab = omitNextOperationalTabPanes;
      omitNextOperationalTabPanes = null;
      return {
        panes: currentPanes().filter((pane) => pane.tab_id !== omittedTab),
      };
    }
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
        ) ??
        panes.find(
          (candidate) =>
            candidate.tab_id === tabId &&
            candidate.pane_id === rememberedTabPanes.get(tabId),
        ) ??
        panes.find((candidate) => candidate.tab_id === tabId);
      if (targetTab && targetPane) {
        focusedTabId = targetTab.tab_id;
        focusedPaneId = targetPane.pane_id;
      }
      return {};
    }
    if (method === "agent.list") return { agents: [] };
    if (method === "pane.layout") {
      const delayed = delayedPaneLayout;
      if (delayed) await delayed.promise;
      return { layout: delayed?.layout ?? layout() };
    }
    if (method === "agent_worktree.get") {
      const subject = params.subject as { paneId: string };
      const at = "2026-01-01T00:00:00Z";
      return {
        subject,
        revision: ambiguousAgentWorktrees ? "ambiguous" : "resolved",
        observedAt: at,
        state: ambiguousAgentWorktrees ? "ambiguous" : "resolved",
        selectedCandidateId: ambiguousAgentWorktrees
          ? null
          : `${subject.paneId}-agent`,
        candidates: ["agent", "main"].map((kind) => ({
          candidateId: `${subject.paneId}-${kind}`,
          canonicalRoot:
            kind === "agent"
              ? `/repo/.agents/worktrees/${subject.paneId}`
              : "/repo",
          gitCommonDir: "/repo/.git",
          branch: kind === "agent" ? "agent/review" : "main",
          source: ambiguousAgentWorktrees
            ? "branch_match"
            : kind === "agent"
              ? "foreground_cwd"
              : "worktree_list",
          evidence: {
            sourceRef: "Synthetic worktree observation",
            observedAt: at,
            basis:
              ambiguousAgentWorktrees || kind === "main"
                ? "inferred"
                : "reported",
          },
        })),
      };
    }
    if (method === "file.list") {
      return {
        workspace_id: workspaceBase.workspace_id,
        root: (
          params.agent_worktree as
            | { candidateId?: string; subject?: { paneId?: string } }
            | undefined
        )?.candidateId?.endsWith("-agent")
          ? `/repo/.agents/worktrees/${(params.agent_worktree as { subject: { paneId: string } }).subject.paneId}`
          : "/repo",
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
      if (terminalId === suppressFrameFor) return {};
      if (terminalId === "builder-terminal") {
        await initialTerminalAttach.promise;
      }
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
      return {
        endpoint: {
          methods: ["pane.focus", "tab.create", "workspace.create"],
          capabilities: [],
        },
      };
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
      !button.disabled &&
      !button.closest("[inert]") &&
      button.getAttribute("aria-label")?.includes(label),
  );
}

/** The view an agent opens on: Chat when Chat reads its harness. */
const opensOn = (label: string) =>
  label === "Reviewer" ? "history" : "terminal";

/**
 * Open an agent's terminal from Town as a user does: activating the agent
 * opens its window on Chat when Chat reads its harness (else on its
 * terminal), and the window's Terminal view shows the terminal.
 */
async function openAgent(label: string) {
  const target = agentTarget(label)!;
  flushSync(() => {
    target.click();
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  const window = `[role="dialog"][aria-label="${label} Inspector"]`;
  // The window opens on its first view, even when it was already open.
  await until(
    () =>
      document.querySelector(
        `${window} .workspace-inspector[data-view="${opensOn(label)}"]`,
      ),
    `${label} window on ${opensOn(label) === "history" ? "Chat" : "its terminal"}`,
  );
  flushSync(() =>
    document
      .querySelector<HTMLButtonElement>(
        `${window} [role="tab"][aria-label="Terminal"]`,
      )!
      .click(),
  );
  await until(
    () =>
      document.querySelector(
        `${window} .workspace-inspector[data-view="terminal"]`,
      ),
    `${label} window's Terminal view`,
  );
}

/** Board's card for a single-pane tab, or a split tab's pane row, by name. */
function boardTarget(label: string) {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        ".board-tab[data-world-node-anchor]",
      ),
    ].find(
      (card) => card.querySelector(".board-label")?.textContent === label,
    ) ??
    [
      ...document.querySelectorAll<HTMLElement>(
        ".board-pane[data-world-node-anchor]",
      ),
    ].find(
      (row) => row.querySelector(".board-pane-name")?.textContent === label,
    )
  );
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
  history.replaceState(null, "", "/town");
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
  bridge.onTerminalClosed = (listener) => {
    terminalClosedListeners.add(listener);
    return () => terminalClosedListeners.delete(listener);
  };
  await worldRuntimeStore.refresh();
  __storeTesting.replaceState({
    ...store.get(),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: client.connectionId,
    defaultConnectionId: client.connectionId,
    connectionGeneration: client.generation,
    serverRuntimeGeneration: client.serverRuntimeGeneration,
    navigationMode,
    browserNavigation: {
      revision: 1,
      workspaceId: workspaceBase.workspace_id,
      tabIds: { [workspaceBase.workspace_id]: tabs[0]!.tab_id },
      paneIds: { [tabs[0]!.tab_id]: panes[0]!.pane_id },
    },
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

  const originalWithResolvers = Promise.withResolvers;
  try {
    Object.defineProperty(Promise, "withResolvers", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    await store.refresh();
    check(
      !store.get().error,
      "refresh failed on the declared browser baseline without Promise.withResolvers",
    );
  } finally {
    Promise.withResolvers = originalWithResolvers;
  }

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<WorldFoundationApp />));

  await until(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "Town renderer",
  );
  // World opens full-bleed in Zen, with the views one choice away beside
  // Exit Zen. The rest of this fixture drives the bars, so it leaves Zen the
  // way a user would, which also records World's one Zen choice.
  await until(
    () =>
      document.querySelector(".app")?.classList.contains("zen") === true &&
      document.querySelector(
        '.zen-dock .world-view-picker button[aria-pressed="true"][aria-label="Town"]',
      ) !== null,
    "Town opening in Zen with the view picker",
  );
  check(
    worldLocalStorage.getItem("zenMode.world") === null,
    "World's default Zen was stored as if the user had chosen it",
  );
  document.querySelector<HTMLButtonElement>(".zen-dock .zen-island")?.click();
  await until(
    () => document.querySelector(".app")?.classList.contains("zen") === false,
    "leaving Town's default Zen",
  );
  check(
    worldLocalStorage.getItem("zenMode.world") === "0",
    "leaving Zen did not keep World's Zen choice",
  );
  await until(() => {
    const seat = document.querySelector<HTMLButtonElement>(
      ".world-new-seat-canvas-action",
    );
    const room = document.querySelector<HTMLButtonElement>(
      ".world-new-room-canvas-action",
    );
    const tab = document.querySelector<HTMLButtonElement>(".tabbar-add");
    return (
      seat?.disabled === true &&
      room?.disabled === true &&
      tab?.disabled === true &&
      seat.title.includes("Endpoint availability is loading") &&
      room.title.includes("Endpoint availability is loading") &&
      tab.title.includes("Endpoint availability is loading") &&
      getComputedStyle(seat).cursor === "not-allowed"
    );
  }, "browser-local Town creation controls with shared pending endpoint state");
  initialTerminalAttach.resolve();
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(".world-new-seat-canvas-action")
        ?.disabled === false &&
      document.querySelector<HTMLButtonElement>(".world-new-room-canvas-action")
        ?.disabled === false &&
      document.querySelector<HTMLButtonElement>(".tabbar-add")?.disabled ===
        false,
    "browser-local Town room, seat and tab-strip actions",
  );
  check(
    calls.filter(
      ({ method, params }) =>
        method === "terminal.attach" &&
        params.terminal_id === "builder-terminal",
    ).length === 1 &&
      document.querySelector(
        ".world-managed-window.is-active .workspace-inspector",
      ) === null &&
      getComputedStyle(
        document.querySelector<HTMLButtonElement>(
          ".world-new-seat-canvas-action",
        )!,
      ).cursor === "pointer",
    "Town did not establish one parked creation endpoint without opening an Inspector",
  );
  check(
    !calls.some(
      ({ method }) => method === "tab.create" || method === "workspace.create",
    ),
    "Town required a topology mutation before enabling initial room actions",
  );
  const chooseRoomTerminal = async (before: number) => {
    await until(
      () => document.querySelector(".agent-launcher-card"),
      "Town room launcher",
    );
    check(
      document.querySelector<HTMLSelectElement>(".agent-launcher select")
        ?.value === worldObjectId(client.connectionId, "space", "studio") &&
        calls.filter(({ method }) => method === "tab.create").length === before,
      "Town seat must select its qualified room and wait for a launcher choice",
    );
    const terminalChoice = document.querySelector<HTMLButtonElement>(
      ".agent-launcher-card",
    )!;
    check(
      terminalChoice.textContent?.includes("Terminal"),
      "The first Town launcher choice must be Terminal",
    );
    terminalChoice.click();
  };
  const browserLocalCreateCount = calls.filter(
    ({ method }) => method === "tab.create",
  ).length;
  const browserLocalFocusGate = Promise.withResolvers<void>();
  const browserLocalFocusEntered = Promise.withResolvers<void>();
  const browserLocalOpened = nextCreatedOpenerCompletion(
    worldObjectId(client.connectionId, "terminal", "created-terminal-3"),
  );
  delayedPaneGet = {
    paneId: "created-pane-3",
    promise: browserLocalFocusGate.promise,
    entered: browserLocalFocusEntered.resolve,
  };
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        ".world-new-seat-canvas-action:not(:disabled)",
      ),
    "browser-local enabled seat action before creation",
  );
  document
    .querySelector<HTMLButtonElement>(
      ".world-new-seat-canvas-action:not(:disabled)",
    )!
    .click();
  await chooseRoomTerminal(browserLocalCreateCount);
  await until(
    () =>
      calls.filter(({ method }) => method === "tab.create").length ===
      browserLocalCreateCount + 1,
    "browser-local Town seat creation",
  );
  const browserLocalCreate = [...calls]
    .reverse()
    .find(({ method }) => method === "tab.create")!;
  check(
    browserLocalCreate.params.focus === false &&
      JSON.stringify(browserLocalCreate.params.browser_source) ===
        JSON.stringify({
          workspace_id: "studio",
          tab_id: "work",
          pane_id: "builder-pane",
          terminal_id: "builder-terminal",
        }),
    "browser-local Town seat creation omitted its exact parked source",
  );
  // Rendering/lifecycle: a launcher-created seat owns one real Inspector and
  // terminal renderer. Admission retries are covered headlessly on test time.
  await worldRuntimeStore.refresh();
  await browserLocalFocusEntered.promise;
  await settleWindowLayout();
  check(
    ![...document.querySelectorAll(".workspace-inspector-agent-identity")].some(
      (identity) => identity.getAttribute("data-kind") === "terminal",
    ),
    "pending browser-local focus rendered an unadmitted terminal Inspector",
  );
  browserLocalFocusGate.resolve();
  delayedPaneGet = null;
  await browserLocalOpened;
  await until(
    () =>
      store.get().selectedPaneId === "created-pane-3" &&
      [
        ...document.querySelectorAll(".workspace-inspector-agent-identity"),
      ].some((identity) => identity.getAttribute("data-kind") === "terminal"),
    "browser-local created seat rendered its Inspector",
  );
  check(
    calls.filter(
      ({ method, params }) =>
        method === "terminal.attach" &&
        params.terminal_id === "builder-terminal",
    ).length === 1 &&
      calls.filter(
        ({ method, params }) =>
          method === "terminal.attach" &&
          params.terminal_id === "created-terminal-3",
      ).length === 1,
    "browser-local creation did not hand the parked endpoint to one created Inspector owner",
  );
  for (const close of document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Close Inspector window"]',
  )) {
    close.click();
  }
  document
    .querySelector<HTMLButtonElement>(
      '.world-managed-window.is-active button[aria-label="Close Inspector window"]',
    )
    ?.click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "browser-local creation regression Inspector cleanup",
  );
  focusedTabId = "work";
  focusedPaneId = "builder-pane";
  tabs.splice(
    tabs.findIndex(({ tab_id }) => tab_id === "created-tab-3"),
    1,
  );
  panes.splice(
    panes.findIndex(({ pane_id }) => pane_id === "created-pane-3"),
    1,
  );
  worldRevision += 1;
  await store.refresh();
  await worldRuntimeStore.refresh();
  await until(
    () =>
      store.get().browserNavigation.workspaceId === "studio" &&
      store.get().browserNavigation.tabIds.studio === "work" &&
      store.get().browserNavigation.paneIds.work === "builder-pane",
    "browser-local source restoration after creation regression",
  );
  rejectedPaneGets = 0;
  navigationMode = "shared";
  __storeTesting.replaceState({
    ...store.get(),
    navigationMode,
  });
  await settle();
  check(
    document.querySelector(".world-status-header") === null,
    "the retired Visual Control Plane header still consumes Town height",
  );
  check(
    Boolean(document.querySelector(".world-topbar-status")),
    "World status was not moved into the inherited top bar",
  );
  const topbarHost = document.querySelector<HTMLElement>(
    ".world-hosts-control",
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
    precedes(topbarView, topbarDetails) &&
      precedes(topbarDetails, topbarHost) &&
      precedes(topbarHost, topbarActions) &&
      precedes(topbarActions, topbarMenu),
    "top bar did not order view, details, Hosts, Actions and Menu",
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
      !topbarDetails?.querySelector(
        ".world-selected-host, .world-stale-count",
      ) &&
      topbarDetails?.title.includes("spaces") === true,
    `top-bar summary counts returned or crowded search: ${JSON.stringify({ searchWidth: document.querySelector<HTMLElement>(".world-view-toolbar-search input")?.getBoundingClientRect().width, statusWidth: topbarDetails?.getBoundingClientRect().width, counts: !!topbarDetails?.querySelector(".world-selected-host, .world-stale-count"), title: topbarDetails?.title, viewport: window.innerWidth, controlWidth: topbarDetails?.parentElement?.getBoundingClientRect().width })}`,
  );
  await setShellActionsOpen(false);
  check(
    document
      .querySelector(".world-control-plane")
      ?.closest(".workspace-terminal-surface") !== null,
    "Town did not reuse the Spaces workspace frame",
  );
  check(
    (document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0) >
      100,
    "Town did not retain the Spaces workspace navigator",
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
  document.querySelector<HTMLElement>(".world-navigator")?.focus();
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
  check(Boolean(annotationsButton), "Town did not retain annotations");
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
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="Builder Inspector"] [aria-label="Close Inspector window"]',
    )
    ?.click();
  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector(".board"), "Board in shared frame");
  check(
    document.querySelector(".sidebar") === sharedNavigator,
    "Board replaced the shared workspace navigator",
  );
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      window.__HERDR_TOWN_RENDERER__?.ready === true && agentTarget("Builder"),
    "Town after shared-frame navigation",
  );
  // A minimized panel window (Town summary) comes back from the window list
  // and is raised by the window manager (#346).
  const summaryWindow = () =>
    document.querySelector<HTMLElement>('[aria-label="Town summary window"]');
  document
    .querySelector<HTMLElement>('[aria-label^="Town summary: "]')!
    .click();
  await until(() => summaryWindow(), "Town summary opens as a panel window");
  summaryWindow()!
    .querySelector<HTMLButtonElement>(
      '[aria-label="More actions for Town summary window"]',
    )!
    .click();
  await until(
    () => document.querySelector(".world-window-snap-menu"),
    "Town summary window menu",
  );
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.world-window-snap-menu [role^="menuitem"]',
    ),
  ]
    .find((button) => button.textContent?.trim() === "Minimize")!
    .click();
  await until(
    () =>
      !summaryWindow() || summaryWindow()!.getBoundingClientRect().width === 0,
    "Town summary minimized",
  );
  document
    .querySelector<HTMLButtonElement>('button[aria-label^="Open windows ("]')!
    .click();
  await until(
    () => document.querySelector('[role="menu"][aria-label="Open windows"]'),
    "window list opens",
  );
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"][aria-label="Open windows"] [role="menuitem"]',
    ),
  ]
    .find((button) => button.textContent?.includes("Town summary"))!
    .click();
  await until(() => {
    const restored = summaryWindow();
    return (
      restored &&
      restored.getBoundingClientRect().width > 0 &&
      restored.classList.contains("is-active")
    );
  }, "the window list restores and raises the minimized Town summary");
  summaryWindow()!
    .querySelector<HTMLButtonElement>(
      '[aria-label="Close Town summary window"]',
    )!
    .click();
  await until(() => !summaryWindow(), "Town summary closes again");
  check(
    document.querySelector(".world-office-toolbar") === null,
    "Town settings still consumed a scene toolbar",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Inspector opening"]',
      ),
    "Town settings in common menu",
  );
  check(
    Boolean(
      document
        .querySelector(".config-summary")
        ?.textContent?.includes("Version 9.8.7-test"),
    ),
    "application menu shows the injected build version instead of the manifest placeholder",
  );
  const inspectorOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Inspector opening"]',
  )!;
  check(
    inspectorOpeningSelect.value === "docked" &&
      !document.querySelector('select[aria-label="Office room alignment"]') &&
      !document.querySelector('select[aria-label="Office long room titles"]'),
    "Inspector opening was not menu-owned, did not default to Snap right, or Town-only settings remained",
  );
  // The floating cases below choose Floating, as a user does.
  flushSync(() => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(inspectorOpeningSelect, "floating");
    inspectorOpeningSelect.dispatchEvent(
      new Event("change", { bubbles: true }),
    );
  });
  toggleTopbarMenu();
  await until(
    () => !document.querySelector(".config-dropdown"),
    "Town settings closed before shell Actions",
  );
  function reviewerInspectorActive() {
    const frame = document.querySelector<HTMLElement>(
      ".world-managed-window.is-active",
    );
    return (
      frame?.dataset.windowId ===
        JSON.stringify(["local", 7, "studio", "review"]) &&
      Boolean(frame.querySelector(".workspace-inspector-agent-identity"))
    );
  }
  const floatingPreferenceNavigatorRow = () =>
    [...document.querySelectorAll<HTMLElement>(".sidebar .agent-row")].find(
      (row) => row.getAttribute("aria-label")?.startsWith("claude pane"),
    );
  flushSync(() => floatingPreferenceNavigatorRow()?.click());
  await until(
    () =>
      reviewerInspectorActive() &&
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 1,
    "shared navigator opens a managed Inspector",
  );
  const inspectorPane = () =>
    document.querySelector<HTMLElement>(
      ".world-managed-window.is-active .pane-layout-single[data-pane-id], .world-managed-window.is-active .pane-layout-cell.is-active[data-pane-id]",
    )?.dataset.paneId;
  const shortcut = (action: "next" | "previous" | "create", key: string) => {
    updateShortcut(`tab.${action}`, [`Ctrl+Alt+Shift+${key}`]);
    terminalInput(
      document.querySelector(".world-managed-window.is-active")!,
    )?.focus();
    terminalInput(
      document.querySelector(".world-managed-window.is-active")!,
    )!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: `Digit${key}`,
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  panes.push({
    ...panes[0]!,
    pane_id: "builder-second-pane",
    terminal_id: "builder-second-terminal",
    focused: false,
    agent: undefined,
    display_agent: undefined,
  });
  await store.refresh();
  await store.focusQualifiedTarget({
    connectionId: "local",
    runtimeGeneration: 7,
    workspaceId: "studio",
    paneId: "builder-second-pane",
  });
  await store.focusQualifiedTarget({
    connectionId: "local",
    runtimeGeneration: 7,
    workspaceId: "studio",
    paneId: "reviewer-pane",
  });
  const priorLayout = Promise.withResolvers<void>();
  delayedPaneLayout = { promise: priorLayout.promise, layout: layout() };
  const layoutsBeforeShortcut = calls.filter(
    ({ method }) => method === "pane.layout",
  ).length;
  const priorRefresh = store.refresh();
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.layout").length >
      layoutsBeforeShortcut,
    "pre-existing refresh is waiting on the previous tab layout",
  );
  const focusCallsBeforeShortcut = calls.filter(
    ({ method }) => method === "tab.focus",
  ).length;
  shortcut("next", "8");
  await until(
    () =>
      calls.filter(({ method }) => method === "tab.focus").length >
      focusCallsBeforeShortcut,
    "Next-tab focus dispatched while the prior observation is pending",
  );
  delayedPaneLayout = null;
  priorLayout.resolve();
  await priorRefresh;
  await until(
    () => inspectorPane() === "builder-second-pane",
    "Next-tab presents the remembered second pane instead of list order",
  );
  shortcut("previous", "9");
  await until(
    () => inspectorPane() === "reviewer-pane",
    "Previous-tab presents Reviewer terminal",
  );
  omitNextOperationalTabPanes = "work";
  await store.refresh();
  check(
    !store.get().panes.some((pane) => pane.tab_id === "work"),
    "destination panes must be absent before the cold-tab shortcut",
  );
  shortcut("next", "8");
  await until(
    () => inspectorPane() === "builder-second-pane",
    "Next-tab refreshes an unobserved destination tab and presents its terminal",
  );
  shortcut("previous", "9");
  await until(
    () => inspectorPane() === "reviewer-pane",
    "cold-tab shortcut cleanup",
  );
  panes.splice(
    panes.findIndex(({ pane_id }) => pane_id === "builder-second-pane"),
    1,
  );
  shortcut("create", "7");
  await until(
    () => inspectorPane() === "created-pane-3",
    "Create-tab presents newly created terminal",
  );
  check(
    calls.some(
      ({ method, params }) =>
        method === "tab.rename" && params.tab_id === "created-tab-3",
    ),
    "keyboard-created tab was not numbered",
  );
  for (const close of document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Close Inspector window"]',
  ))
    close.click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "keyboard Inspector cleanup",
  );
  tabs.splice(
    tabs.findIndex(({ tab_id }) => tab_id === "created-tab-3"),
    1,
  );
  panes.splice(
    panes.findIndex(({ pane_id }) => pane_id === "created-pane-3"),
    1,
  );
  focusedTabId = "work";
  focusedPaneId = "builder-pane";
  worldRevision++;
  await store.refresh();
  omitNextWorldTopology = true;
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().connections[0]?.snapshot?.panes.length === 0,
    "notification target omitted from aggregate",
  );
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "reviewer-pane",
        agentSessionId: "reviewer-session",
      },
    }),
  );
  await until(
    () =>
      store.get().selectedPaneId === "reviewer-pane" &&
      Boolean(
        document.querySelector(
          '.world-managed-window.is-active .workspace-inspector[data-view="history"]',
        ),
      ),
    "notification reveals operational pane omitted from overview",
  );
  await until(
    () =>
      document.querySelector(
        '.world-managed-window.is-active .workspace-inspector[data-view="history"]',
      ),
    "notification prefers available Chat",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-managed-window.is-active button[aria-label="Close Inspector window"]',
    )!
    .click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "notification Inspector cleanup",
  );
  const notificationPreferences = readOfficePreferences(worldLocalStorage);
  writeOfficePreferences(worldLocalStorage, {
    ...notificationPreferences,
    townOpens: "terminal",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "reviewer-pane",
        agentSessionId: "reviewer-session",
      },
    }),
  );
  await until(
    () =>
      inspectorPane() === "reviewer-pane" &&
      document.querySelector(
        '.world-managed-window.is-active .workspace-inspector[data-view="terminal"]',
      ),
    "notification follows Agents open Terminal preference",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-managed-window.is-active button[aria-label="Close Inspector window"]',
    )!
    .click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "notification preference cleanup",
  );
  writeOfficePreferences(worldLocalStorage, notificationPreferences);
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "builder-pane",
      },
    }),
  );
  await until(
    () =>
      inspectorPane() === "builder-pane" &&
      document.querySelector(
        '.world-managed-window.is-active .workspace-inspector[data-view="terminal"]',
      ),
    "notification falls back for unsupported Chat harness",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-managed-window.is-active button[aria-label="Close Inspector window"]',
    )!
    .click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "fallback notification cleanup",
  );

  history.pushState({}, "", "/spaces");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await until(
    () => document.querySelector('.world-control-plane[data-active="false"]'),
    "notification Spaces route",
  );
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "reviewer-pane",
        agentSessionId: "reviewer-session",
      },
    }),
  );
  await until(
    () =>
      [
        ...document.querySelectorAll(
          '.workspace-inspector[data-view="history"]',
        ),
      ].some(
        (element) =>
          !element.closest(".world-control-plane") &&
          element.getClientRects().length > 0,
      ),
    "Spaces notification prefers Chat",
  );
  const notificationChat = [
    ...document.querySelectorAll<HTMLElement>(
      '.workspace-inspector[data-view="history"]',
    ),
  ].find(
    (element) =>
      !element.closest(".world-control-plane") &&
      element.getClientRects().length > 0,
  )!;
  store.clearNotice();
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 6,
        workspaceId: "studio",
        paneId: "builder-pane",
      },
    }),
  );
  await until(
    () => store.get().notice?.message === "Notification target is unavailable",
    "Spaces stale-runtime notification refused",
  );
  check(
    notificationChat.isConnected &&
      notificationChat.getClientRects().length > 0,
    "immediate notification refusal preserves the open Chat",
  );
  store.clearNotice();
  replaceNotificationSessionAfterRead = true;
  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "builder-pane",
        agentSessionId: "reviewer-session",
      },
    }),
  );
  await until(
    () =>
      !replaceNotificationSessionAfterRead &&
      store.get().notice?.message === "Notification target is unavailable",
    "Spaces async session turnover notification refused",
  );
  check(
    notificationChat.isConnected &&
      notificationChat.getClientRects().length > 0,
    "async admission refusal restores the same Chat",
  );
  notificationSessionId = "reviewer-session";
  store.clearNotice();

  window.dispatchEvent(
    new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "builder-pane",
      },
    }),
  );
  await until(
    () =>
      ![...document.querySelectorAll(".workspace-inspector")].some(
        (element) => element.getClientRects().length > 0,
      ) && store.get().selectedPaneId === "builder-pane",
    "Spaces terminal fallback closes the prior Chat",
  );
  history.pushState({}, "", "/town");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await until(
    () => Boolean(agentTarget("Builder")),
    "notification return to Town",
  );
  omitNextWorldTopology = true;
  await worldRuntimeStore.refresh();
  await until(
    () => !agentTarget("Reviewer"),
    "omitted notification target committed to the rendered overview",
  );
  replaceNotificationSessionOnSnapshot = true;
  const snapshotsBeforeReplacement = calls.filter(
    ({ method }) => method === "world.snapshot",
  ).length;
  window.dispatchEvent(
    new CustomEvent("herdr-world:visual-notification", {
      detail: {
        connectionId: "local",
        runtimeGeneration: 7,
        workspaceId: "studio",
        paneId: "reviewer-pane",
        agentSessionId: "reviewer-session",
      },
    }),
  );
  await until(
    () =>
      calls.filter(({ method }) => method === "world.snapshot").length >
        snapshotsBeforeReplacement &&
      notificationSessionId === "replacement-session",
    "notification priority refresh replaced agent session",
  );
  await settle();
  check(
    !document.querySelector(".workspace-inspector"),
    "notification opened a replacement agent session",
  );
  notificationSessionId = "reviewer-session";
  flushSync(() => floatingPreferenceNavigatorRow()?.click());
  await until(
    () => inspectorPane() === "reviewer-pane",
    "Reviewer Inspector restored after rejected notification",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-managed-window.is-active button[aria-label="Close Inspector window"]',
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
    'input[placeholder="Search Town"]',
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
    "Town host search selection profile",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.world-selection-panel button[aria-label="Close profile"]',
    )!
    .click();
  await openAgent("Builder");
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
  // The Town master's chat docks in the background: its window opens, but
  // the window on top and the selection stay as they were.
  const selectedBeforeMaster = store.get().selectedPaneId;
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "reviewer",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "Town master chat opened in the background",
  );
  await settle();
  check(
    document
      .querySelector(".world-managed-window.is-active")
      ?.getAttribute("aria-label") === "Builder Inspector" &&
      store.get().selectedPaneId === selectedBeforeMaster,
    "the Town master's background open took the selection or the top",
  );
  writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townMaster: "",
  });
  window.dispatchEvent(new Event(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT));
  await setShellActionsOpen(false);
  await openAgent("Reviewer");
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
  rejectNextWorldSnapshot = true;
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().status === "error",
    "transient World observation failure",
  );
  await settle();
  if (
    document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
      .length !== 2
  ) {
    throw new Error("transient World observation hid open floating Inspectors");
  }
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().status === "ready",
    "World observation recovered with both Inspectors",
  );
  staleNextWorldSnapshot = true;
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().connections[0]?.stale === true,
    "selected World host temporarily stale",
  );
  await settle();
  check(
    document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
      .length === 2,
    "stale aggregate observation hid live floating Inspectors",
  );
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().connections[0]?.actionable === true,
    "selected World host observation recovered",
  );
  omitNextWorldTopology = true;
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().connections[0]?.snapshot?.panes.length === 0,
    "bounded World projection omitted existing tabs",
  );
  await settle();
  check(
    document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
      .length === 2,
    "healthy aggregate observation hid tabs still present in focused Herdr state",
  );
  await worldRuntimeStore.refresh();
  await until(
    () => worldRuntimeStore.get().connections[0]?.snapshot?.panes.length === 2,
    "full World projection recovered",
  );
  const arrangeWindows = async (label: string) => {
    await settleWindowLayout();
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Arrange windows"]',
    )!;
    trigger.click();
    const getChoice = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="menu"][aria-label="Arrange windows"] [role="menuitem"]',
        ),
      ].find((button) => button.querySelector("strong")?.textContent === label);
    await settle();
    await until(() => {
      const choice = getChoice();
      if (choice) return choice;
      if (
        !document.querySelector('[role="menu"][aria-label="Arrange windows"]')
      ) {
        trigger.click();
      }
      return null;
    }, `${label} arrangement choice`);
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
    await settleWindowLayout();
  };
  const arrangementTrigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Arrange windows"]',
  )!;
  const arrangementTriggerBounds = arrangementTrigger.getBoundingClientRect();
  check(
    document.querySelectorAll('button[aria-label="Arrange windows"]').length ===
      1 &&
      !!arrangementTrigger.closest(".topbar-actions") &&
      arrangementTriggerBounds.right <= window.innerWidth,
    "Desktop arrangement control must appear once in the visible top bar",
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
    `120% UI scale placed arranged Inspectors outside the visual stage: stage=${JSON.stringify(zoomedStage.toJSON())}; windows=${JSON.stringify([...document.querySelectorAll(".world-managed-window")].map((el) => el.getBoundingClientRect().toJSON()))}`,
  );
  document.documentElement.style.zoom = "";
  window.dispatchEvent(new Event("resize"));
  await settle();
  await settleWindowLayout();
  await fetch("/capture/desktop", { method: "POST" });
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
  const builderArrangedWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  const builderBeforeMaximize = builderArrangedWindow.getBoundingClientRect();
  const sessionCallsBeforeMaximize = calls.filter(({ method }) =>
    ["terminal.attach", "terminal.detach", "tab.close", "pane.close"].includes(
      method,
    ),
  ).length;
  const arrangedMaximize =
    builderArrangedWindow.querySelector<HTMLButtonElement>(
      '[aria-label="Maximize Inspector window"]',
    );
  if (!arrangedMaximize)
    throw new Error("arranged Inspector maximize control missing");
  arrangedMaximize.click();
  await until(() => {
    const bounds = builderArrangedWindow.getBoundingClientRect();
    const stage = document
      .querySelector(".world-view-layout")!
      .getBoundingClientRect();
    return (
      bounds.width >= stage.width - 18 && bounds.height >= stage.height - 18
    );
  }, "arranged Inspector maximized over the visual stage");
  const arrangedRestore =
    builderArrangedWindow.querySelector<HTMLButtonElement>(
      '[aria-label="Restore Inspector window"]',
    );
  if (!arrangedRestore)
    throw new Error("arranged Inspector restore control missing");
  arrangedRestore.click();
  await until(() => {
    const bounds = builderArrangedWindow.getBoundingClientRect();
    return (
      Math.abs(bounds.left - builderBeforeMaximize.left) < 2 &&
      Math.abs(bounds.top - builderBeforeMaximize.top) < 2 &&
      Math.abs(bounds.width - builderBeforeMaximize.width) < 2 &&
      Math.abs(bounds.height - builderBeforeMaximize.height) < 2
    );
  }, "arranged Inspector restored its tile");
  check(
    calls.filter(({ method }) =>
      [
        "terminal.attach",
        "terminal.detach",
        "tab.close",
        "pane.close",
      ].includes(method),
    ).length === sessionCallsBeforeMaximize,
    "maximizing an Inspector changed terminal ownership",
  );
  const reviewerArrangedWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Reviewer Inspector"]',
  )!;
  builderArrangedWindow
    .querySelector<HTMLButtonElement>('[data-window-resize="se"]')!
    .focus();
  await until(
    () =>
      Number(builderArrangedWindow.style.zIndex) >
      Number(reviewerArrangedWindow.style.zIndex),
    "focused arranged Inspector raised above the other window",
  );
  reviewerArrangedWindow
    .querySelector<HTMLButtonElement>('[data-window-resize="se"]')!
    .focus();
  await until(
    () =>
      Number(reviewerArrangedWindow.style.zIndex) >
      Number(builderArrangedWindow.style.zIndex),
    "later focus changed the top window",
  );
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
  const mobileInspector = [
    ...document.querySelectorAll<HTMLElement>(".workspace-inspector"),
  ].find((inspector) => inspector.getBoundingClientRect().width > 0)!;
  // On a phone, the Chat view shows one composer, Chat's own: no terminal
  // key bar and no terminal composer (those belong to the Terminal view).
  const shown = (element: Element) => element.getClientRects().length > 0;
  const chooseMobileView = async (
    view: "terminal" | "files" | "history" | "changes",
  ) => {
    mobileInspector
      .querySelector<HTMLButtonElement>('[aria-label^="Inspector view:"]')!
      .click();
    await until(
      () => document.querySelector('[aria-label="Inspector views"]'),
      "anchored Inspector views",
    );
    check(
      !mobileInspector.querySelector("select"),
      "mobile views opened a native combo box",
    );
    check(
      [...document.querySelectorAll('[aria-label="Inspector views"] button')]
        .map((button) => button.textContent?.trim())
        .slice(0, 4)
        .join(",") === "Chat,Terminal,Files,Changes",
      "mobile view destinations changed order",
    );
    document
      .querySelector<HTMLButtonElement>(
        `[aria-label="Inspector views"] [data-view="${view}"]`,
      )!
      .click();
    await until(
      () => mobileInspector.getAttribute("data-view") === view,
      `mobile view ${view}`,
    );
  };
  await chooseMobileView("files");
  await chooseMobileView("changes");
  await chooseMobileView("history");
  await until(
    () => mobileInspector.getAttribute("data-view") === "history",
    "phone window Chat view",
  );
  await settle();
  check(
    ![...document.querySelectorAll(".terminal-composer")].some(shown) &&
      ![
        ...document.querySelectorAll(
          ".terminal-composer-shortcuts, .mobile-terminal-shortcuts",
        ),
      ].some(shown),
    "the phone Chat view shows a terminal composer or key bar",
  );
  check(
    [
      ...document.querySelectorAll(
        ".agent-chat-composer textarea, textarea.terminal-composer-input",
      ),
    ].filter(shown).length <= 1,
    "the phone Chat view shows more than one composer",
  );
  await chooseMobileView("terminal");
  await until(
    () => mobileInspector.getAttribute("data-view") === "terminal",
    "phone window back on Terminal",
  );
  await settle();
  const mobileHeader = mobileInspector.querySelector<HTMLElement>(
    ".workspace-inspector-head",
  )!;
  check(
    !mobileHeader.querySelector('[aria-label^="Interest:"]'),
    "attention remained in the mobile header",
  );
  mobileHeader
    .querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    .click();
  await until(
    () => document.querySelector('[aria-label="Window actions"]'),
    "mobile attention menu",
  );
  check(
    document
      .querySelector('[aria-label="Window actions"] [role^="menuitem"]')
      ?.textContent?.trim() === "Pin desk in Town",
    "mobile desk pin is not first in the ellipsis menu",
  );
  const attentionChoices = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Window actions"] [role="menuitemradio"]',
    ),
  ];
  check(
    attentionChoices
      .map((button) => button.querySelector("span")?.textContent)
      .join(",") === "Default (from groups),Watch,Muted,Focused",
    "mobile ellipsis does not contain attention choices separately from views",
  );
  attentionChoices
    .find((button) => button.getAttribute("aria-checked") === "true")!
    .click();
  // On a phone the window looks like the terminal: its own bar (name,
  // status and ⋯) is the only bar, and the app's topbar slides away.
  check(
    mobileHeader.getBoundingClientRect().height > 0 &&
      mobileHeader.getBoundingClientRect().height <= 72 &&
      !mobileInspector
        .querySelector(".workspace-inspector-tabs:not([hidden])")
        ?.getClientRects().length &&
      document.querySelector(".topbar")?.classList.contains("is-zen") === true,
    "the phone terminal window shows one bar of its own and no topbar above it",
  );
  const mobileInput = mobileInspector.querySelector<HTMLTextAreaElement>(
    "textarea.terminal-composer-input",
  );
  check(
    !!mobileInput,
    "mobile Inspector offers the shared terminal input panel",
  );
  mobileInput?.focus({ preventScroll: true });
  mobileInput?.click();
  await until(
    () => !!mobileInspector.querySelector(".terminal-composer"),
    "mobile Inspector opens the same Composer panel as Spaces",
  );
  check(
    !!mobileInspector.querySelector(
      ".terminal-composer textarea.terminal-composer-input",
    ) &&
      !!mobileInspector.querySelector(
        '.terminal-composer button[aria-label="Type directly into the terminal"]',
      ) &&
      !!mobileInspector.querySelector(".terminal-composer textarea"),
    "mobile Inspector panel includes Composer, Direct and the draft editor",
  );
  check(
    !document.querySelector(".mobile-composer-shortcut"),
    "Inspector input does not show a second hidden Spaces launcher",
  );
  const inspectorEditor = mobileInspector.querySelector<HTMLTextAreaElement>(
    ".terminal-composer textarea",
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(inspectorEditor, "Unsent mobile draft");
  inspectorEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  const beforePhoneDisconnect = store.get();
  const phoneClientCurrent = client.isCurrent;
  client.isCurrent = () => false;
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      status: "disconnected",
      catalogueReady: false,
    }),
  );
  await settle();
  const phoneStale = mobileInspector
    .closest(".workspace-inspector-slot")!
    .querySelector<HTMLElement>(".world-inspector-stale")!;
  const staleBounds = phoneStale.getBoundingClientRect();
  const draftBounds = inspectorEditor.getBoundingClientRect();
  check(
    inspectorEditor.value === "Unsent mobile draft" &&
      draftBounds.height > 0 &&
      staleBounds.height > 0 &&
      staleBounds.top >= mobileHeader.getBoundingClientRect().bottom &&
      (staleBounds.bottom <= draftBounds.top ||
        staleBounds.top >= draftBounds.bottom),
    "phone stale indicator covers the retained Message draft",
  );
  client.isCurrent = phoneClientCurrent;
  flushSync(() => __storeTesting.replaceState(beforePhoneDisconnect));
  await settle();
  const uploadInput = mobileInspector.querySelector<HTMLInputElement>(
    '.terminal-composer input[type="file"]',
  )!;
  let pickerOpened = false;
  uploadInput.addEventListener(
    "click",
    (event) => {
      pickerOpened = true;
      event.preventDefault();
    },
    { once: true },
  );
  mobileInspector
    .querySelector<HTMLButtonElement>('button[aria-label="Add a file"]')!
    .click();
  check(pickerOpened, "Town attachment button activates its file picker");
  const uploadFiles = new DataTransfer();
  uploadFiles.items.add(
    new File(["example upload"], "example.txt", { type: "text/plain" }),
  );
  uploadInput.files = uploadFiles.files;
  uploadInput.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => inspectorEditor.value.includes("/tmp/example.txt"),
    "Town attachment uploads and inserts into the retained draft",
  );
  const retainedDraft = inspectorEditor.value;
  check(
    retainedDraft.includes("Unsent mobile draft"),
    "attachment preserves typed text",
  );
  mobileInspector
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close terminal input"]',
    )
    ?.click();
  await until(
    () => !mobileInspector.querySelector(".terminal-composer[data-open]"),
    "mobile Inspector input closes without losing its terminal",
  );
  mobileInspector
    .querySelector<HTMLTextAreaElement>("textarea.terminal-composer-input")!
    .click();
  await until(
    () =>
      mobileInspector.querySelector<HTMLTextAreaElement>(
        ".terminal-composer textarea",
      )?.value === retainedDraft,
    "Town Composer retains text and attachment across close/reopen",
  );
  mobileInspector
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close terminal input"]',
    )!
    .click();
  const compactArrangeTrigger = () =>
    document.querySelector<HTMLButtonElement>(
      '.mobile-nav button[aria-label="Arrange windows"]',
    );
  if (!compactArrangeTrigger())
    document
      .querySelector<HTMLButtonElement>(".mobile-controls-toggle")
      ?.click();
  await until(compactArrangeTrigger, "compact arrangement menu trigger");
  await settle();
  await settle();
  await settleWindowLayout();
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
  check(
    !document.querySelector(".world-managed-window [data-window-resize]"),
    "compact windows exposed desktop resize handles",
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
  for (const visualView of ["board", "town"] as const) {
    viewSelect.value = visualView;
    viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(
      () =>
        (visualView === "board"
          ? document.querySelector(".board")
          : window.__HERDR_TOWN_RENDERER__?.ready === true) &&
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
  const selectSnap = async (label: string, target: string) => {
    document
      .querySelector<HTMLButtonElement>(
        `[aria-label="${label} Inspector"] button[aria-label="More actions for Inspector window"]`,
      )!
      .click();
    await until(
      () => document.querySelector(".world-window-snap-menu"),
      "window menu opens",
    );
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".world-window-snap-menu button",
      ),
    ]
      .find((button) => button.textContent === target)!
      .click();
    await settle();
  };
  // One bar per window: identity, the view selector and the window's
  // actions share a single row, with no repository row or PR card below.
  const builderHead = document.querySelector<HTMLElement>(
    '[aria-label="Builder Inspector"] .workspace-inspector-head',
  )!;
  const rowTop = (selector: string) =>
    builderHead.querySelector(selector)?.getBoundingClientRect();
  const headRows = [
    rowTop(".workspace-inspector-identity"),
    rowTop(".workspace-inspector-tabs"),
    rowTop(".world-window-controls"),
  ];
  check(
    headRows.every(
      (rect) =>
        rect &&
        Math.abs(
          rect.top +
            rect.height / 2 -
            (headRows[0]!.top + headRows[0]!.height / 2),
        ) < 4,
    ) &&
      builderHead.getBoundingClientRect().height <= 72 &&
      !builderHead.querySelector(".workspace-inspector-repository-action") &&
      !document.querySelector(
        '[aria-label="Builder Inspector"] .pull-request-card',
      ),
    `the Inspector's bar was not one row: ${JSON.stringify(headRows)}`,
  );
  // A crowded bar moves its views into ⋯ rather than squeezing the name or
  // pushing a control past the window's edge.
  const checkBarFits = (label: string) => {
    const frame = document.querySelector<HTMLElement>(
      `[aria-label="${label} Inspector"]`,
    )!;
    const head = frame.querySelector<HTMLElement>(".workspace-inspector-head")!;
    const bounds = frame.getBoundingClientRect();
    const name = head
      .querySelector<HTMLElement>(
        ".workspace-inspector-agent-identity, .workspace-inspector-identity",
      )!
      .getBoundingClientRect().width;
    const outside = [...head.querySelectorAll<HTMLElement>("button")]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        );
      })
      .map((button) => button.getAttribute("aria-label"));
    check(
      outside.length === 0 &&
        (name >= 120 || head.hasAttribute("data-views-in-menu")),
      `the ${label} bar overflowed: ${JSON.stringify({ outside, name, width: bounds.width })}`,
    );
  };
  checkBarFits("Builder");
  await selectSnap("Builder", "Left half");
  checkBarFits("Builder");
  const focusedDock = document.querySelector<HTMLElement>(
    '[aria-label="Builder Inspector"]',
  )!;
  const floatingReviewer = document.querySelector<HTMLElement>(
    '[aria-label="Reviewer Inspector"]',
  )!;
  const snappedBounds = focusedDock.getBoundingClientRect();
  focusedDock
    .querySelector<HTMLButtonElement>(
      '[aria-label="Maximize Inspector window"]',
    )!
    .click();
  await until(
    () => focusedDock.querySelector('[aria-label="Restore Inspector window"]'),
    "snapped Inspector maximizes",
  );
  focusedDock
    .querySelector<HTMLButtonElement>(
      '[aria-label="Restore Inspector window"]',
    )!
    .click();
  await until(
    () =>
      Math.abs(
        focusedDock.getBoundingClientRect().width - snappedBounds.width,
      ) < 2,
    "maximize restores the snap",
  );
  floatingReviewer
    .querySelector<HTMLButtonElement>('[data-window-resize="se"]')!
    .focus();
  await until(
    () =>
      Number(floatingReviewer.style.zIndex) > Number(focusedDock.style.zIndex),
    "focusing controls raises only that window",
  );
  check(
    Math.abs(focusedDock.getBoundingClientRect().left - snappedBounds.left) < 2,
    "raising another window moved the snap",
  );

  const paneGetsBeforeClosedTargetFocus = calls.filter(
    ({ method }) => method === "pane.get",
  ).length;
  const delayedClosedTargetFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: "reviewer-pane",
    promise: delayedClosedTargetFocus.promise,
  };
  flushSync(() => floatingPreferenceNavigatorRow()?.click());
  await until(
    () =>
      calls.filter(({ method }) => method === "pane.get").length ===
      paneGetsBeforeClosedTargetFocus + 1,
    "delayed existing floating Inspector focus",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Reviewer Inspector"] button[aria-label="Close Inspector window"]',
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
      .querySelector(
        ".world-managed-window.is-active .workspace-inspector-agent-identity",
      )
      ?.textContent?.includes("Builder") === true &&
      !document.body.textContent?.includes("Reviewer Inspector"),
    "delayed navigator focus resurrected the closed target Inspector",
  );

  await openAgent("Reviewer");
  await until(
    () =>
      document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ),
    "restore floating Reviewer Inspector for delayed dock race",
  );
  const occupiedBounds = focusedDock.getBoundingClientRect();
  const localOnlyCalls = calls.length;
  await selectSnap("Reviewer", "Left half");
  check(
    Math.abs(focusedDock.getBoundingClientRect().left - occupiedBounds.left) <
      2 &&
      Math.abs(
        focusedDock.getBoundingClientRect().width - occupiedBounds.width,
      ) < 2,
    "snapping into an occupied region moved its occupant",
  );
  check(
    !calls
      .slice(localOnlyCalls)
      .some(({ method }) =>
        ["pane.get", "tab.focus", "workspace.focus"].includes(method),
      ),
    "snap changed backend focus",
  );
  flushSync(() => floatingPreferenceNavigatorRow()?.click());
  await until(
    () =>
      document.querySelector(
        '.world-managed-window.is-active[aria-label="Reviewer Inspector"]',
      ),
    "navigator raises the retained window",
  );
  check(
    document.querySelectorAll(".world-managed-window").length === 2,
    "navigator discarded another open Inspector",
  );
  for (const close of document.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Close Inspector window"]',
  ))
    close.click();
  await until(
    () => !document.querySelector(".world-managed-window"),
    "close presentation windows",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Inspector opening"]',
      ),
    "reopened Town settings",
  );
  const dockedOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Inspector opening"]',
  )!;
  dockedOpeningSelect.value = "docked";
  dockedOpeningSelect.dispatchEvent(new Event("change", { bubbles: true }));
  toggleTopbarMenu();
  await openAgent("Builder");
  await until(
    () =>
      document
        .querySelector(
          ".world-managed-window.is-active .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "docked preference Builder Inspector",
  );
  const reviewerNavigatorRow = [
    ...document.querySelectorAll<HTMLElement>(".sidebar .agent-row"),
  ].find((row) => row.getAttribute("aria-label")?.startsWith("claude pane"));
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
    !reviewerInspectorActive(),
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
      reviewerInspectorActive() &&
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
          ".world-managed-window.is-active .workspace-inspector-agent-identity",
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
      reviewerInspectorActive() &&
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
  check(Boolean(createSeatButton), "Town room omitted its new-seat action");
  const seatCreatesBeforeClick = calls.filter(
    ({ method }) => method === "tab.create",
  ).length;
  // Focus/lifecycle: the actual opener must honor the hook's cancellation.
  // The headless consumer covers the full deadline and no-overlap policy.
  const priorInspector = document.querySelector(
    ".world-managed-window.is-active",
  );
  const sharedFocusGate = Promise.withResolvers<void>();
  const sharedFocusEntered = Promise.withResolvers<void>();
  const sharedFocusCompleted = nextCreatedOpenerCompletion(
    worldObjectId(client.connectionId, "terminal", "created-terminal-3"),
  );
  delayedPaneGet = {
    paneId: "created-pane-3",
    promise: sharedFocusGate.promise,
    entered: sharedFocusEntered.resolve,
  };
  createSeatButton?.click();
  await chooseRoomTerminal(seatCreatesBeforeClick);
  await until(
    () =>
      calls.filter(({ method }) => method === "tab.create").length ===
      seatCreatesBeforeClick + 1,
    "Town seat creation",
  );
  await worldRuntimeStore.refresh();
  await sharedFocusEntered.promise;
  await admissionClock.advance(CREATED_PANE_ADMISSION_TIMEOUT_MS);
  check(
    store.get().notice?.message === "Tab created, but Inspector focus failed",
    "hook cancellation reached the actual opener",
  );
  sharedFocusGate.resolve();
  delayedPaneGet = null;
  await sharedFocusCompleted;
  await settleWindowLayout();
  check(
    priorInspector?.isConnected === true &&
      document.querySelector(".world-managed-window.is-active") ===
        priorInspector &&
      reviewerInspectorActive(),
    "late cancelled opener replaced the rendered prior Inspector or took its focus",
  );
  store.clearNotice();
  await settleWindowLayout();
  await until(() => agentTarget("Builder"), "Builder desk target");
  await openAgent("Builder");
  await until(
    () =>
      document
        .querySelector(
          ".world-managed-window.is-active .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      document.querySelector(
        '.world-managed-window.is-active .workspace-inspector[data-view="terminal"] .workspace-inspector-terminal-portal',
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
      .querySelector(
        ".world-managed-window.is-active .workspace-inspector-agent-identity",
      )
      ?.textContent?.includes("Builder") === true,
    "rejected navigator focus replaced the admitted Builder Inspector",
  );
  check(
    store.get().selectedPaneId === "builder-pane",
    "rejected navigator focus changed the selected pane",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="Reviewer Inspector"] [aria-label="Close Inspector window"]',
    )
    ?.click();
  await selectSnap("Builder", "Float window");
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
      builderConnectorPoints[0].y >= builderAgentBounds.top - 3 &&
      builderConnectorPoints[0].y <= builderAgentBounds.bottom + 12,
    "floating Inspector connector did not start at the represented agent",
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
    y: 24,
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
    'button[data-window-resize="se"]',
  )!;
  const builderResizeGripBounds = builderResizeGrip.getBoundingClientRect();
  check(
    builderResizeGripBounds.width >= 12 &&
      builderResizeGripBounds.height >= 12 &&
      getComputedStyle(builderResizeGrip).cursor === "nwse-resize" &&
      initialBuilderWindow.querySelectorAll("[data-window-resize]").length ===
        8,
    "Inspector did not expose all edges and corners for resizing",
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

  await openAgent("Reviewer");
  await until(() => reviewerInspectorActive(), "Reviewer Inspector");
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
  await settle();
  check(
    document.querySelector(
      '[role="dialog"][aria-label="Builder Inspector"]',
    ) !== null,
    "agent completion hid an unrelated floating Inspector",
  );
  panes[1]!.agent_status = "idle";
  panes[1]!.revision += 1;
  worldRevision += 1;
  await worldRuntimeStore.refresh();
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
    )} inspector=${JSON.stringify(builderInspector.getBoundingClientRect().toJSON())}`,
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
    .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Files"]')!
    .click();
  await until(
    () =>
      builderWindow
        .querySelector(".workspace-inspector")
        ?.getAttribute("data-view") === "files",
    "Builder floating Inspector Files view",
  );

  const reviewerFloatingWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Reviewer Inspector"]',
  )!;
  const fileRequest: InspectorTerminalFileRequest = {
    connectionId: client.connectionId,
    connectionGeneration: runtimeGeneration,
    runtimeGeneration,
    workspaceId: "studio",
    paneId: "reviewer-pane",
    path: "src/review.ts",
    windowId: worldInspectorWindowId({
      connectionId: client.connectionId,
      runtimeGeneration,
      workspaceId: "studio",
      tabId: "review",
      nodeId: "reviewer",
    }),
  };
  const terminalFileEvent = new CustomEvent(INSPECTOR_TERMINAL_FILE_EVENT, {
    cancelable: true,
    detail: fileRequest,
  });
  window.dispatchEvent(terminalFileEvent);
  await until(
    () =>
      reviewerFloatingWindow.querySelector(
        '.workspace-inspector[data-view="files"]',
      ) &&
      calls.some(
        ({ method, params }) =>
          method === "file.read" && params.path === "src/review.ts",
      ),
    "terminal file opened in originating Reviewer Inspector",
  );
  check(
    terminalFileEvent.defaultPrevented &&
      builderInspector.getAttribute("data-view") === "files",
    "terminal file changed another Inspector's resource",
  );
  check(
    Number(reviewerFloatingWindow.style.zIndex) >=
      Number(builderWindow.style.zIndex),
    "terminal file did not raise originating Inspector",
  );
  for (const stale of [
    { runtimeGeneration: runtimeGeneration - 1 },
    { paneId: "closed-pane" },
    { windowId: "closed-window" },
  ]) {
    const staleEvent = new CustomEvent(INSPECTOR_TERMINAL_FILE_EVENT, {
      cancelable: true,
      detail: { ...fileRequest, ...stale, path: "src/stale.ts" },
    });
    window.dispatchEvent(staleEvent);
    check(
      !staleEvent.defaultPrevented,
      "retired terminal file request was admitted",
    );
  }
  reviewerFloatingWindow
    .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Terminal"]')!
    .click();
  await until(
    () =>
      reviewerFloatingWindow.querySelector(
        '.workspace-inspector[data-view="terminal"]',
      ),
    "Reviewer Terminal after file handoff",
  );
  const builderTerminalTab = builderWindow.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-label="Terminal"]',
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
    () => builderInspector.getAttribute("data-view") === "terminal",
    "background Builder Inspector control focus",
  );
  const builderFilesTab = builderWindow.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-label="Files"]',
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
  const terminalLifecycleBeforeSwap = calls.filter(
    ({ method }) =>
      method === "terminal.attach" || method === "terminal.detach",
  ).length;
  const paneFocusBeforeSwap = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === "builder-pane",
  ).length;
  await selectSnap("Reviewer", "Right half");
  await selectSnap("Builder", "Bottom half");
  const inspector = builderInspector;
  check(
    inspector.getAttribute("data-view") === "files",
    "snapping lost the selected resource",
  );
  builderWindow
    .querySelector<HTMLButtonElement>(
      '[aria-label="Maximize Inspector window"]',
    )!
    .click();
  await until(
    () =>
      builderWindow.querySelector('[aria-label="Restore Inspector window"]'),
    "resource window maximizes",
  );
  builderWindow
    .querySelector<HTMLButtonElement>(
      '[aria-label="Restore Inspector window"]',
    )!
    .click();
  await selectSnap("Builder", "Right half");
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
    ).length === paneFocusBeforeSwap,
    "window placement changed qualified pane focus",
  );
  reviewerWindow
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close Inspector window"]',
    )!
    .click();
  await until(
    () =>
      !document.querySelector(
        '[role="dialog"][aria-label="Reviewer Inspector"]',
      ) &&
      document
        .querySelector(
          ".world-managed-window.is-active .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder"),
    "closing only the floating Reviewer Inspector",
  );

  inspector!
    .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Terminal"]')!
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

  await openAgent("Reviewer");
  await until(
    () => reviewerInspectorActive(),
    "Reviewer replacement Inspector",
  );
  check(
    Boolean(
      document.querySelector('[role="dialog"][aria-label="Builder Inspector"]'),
    ),
    "selecting B discarded the retained A Inspector",
  );
  const replacementReviewerInput = terminalInput(
    document.querySelector(".world-managed-window.is-active") ?? document,
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

  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".board"),
    "Board replacement check",
  );
  await until(() => boardTarget("Builder"), "Builder Board target");
  flushSync(() => boardTarget("Builder")!.click());
  await until(
    () =>
      document
        .querySelector(
          ".world-managed-window.is-active .workspace-inspector-agent-identity",
        )
        ?.textContent?.includes("Builder") &&
      terminalInput(
        document.querySelector(".world-managed-window.is-active") ?? document,
      ),
    "Builder Board Inspector replacement",
  );
  // Chat cannot read the Builder's harness, so Board opens its terminal.
  check(
    document
      .querySelector(".world-managed-window.is-active .workspace-inspector")
      ?.getAttribute("data-view") === "terminal",
    "Board opens an agent whose harness Chat cannot read on its terminal",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="Reviewer Inspector"] [aria-label="Close Inspector window"]',
    )
    ?.click();
  await until(
    () =>
      document.querySelectorAll(".world-intent-connector circle").length === 2,
    "Builder Board Inspector connector",
  );
  // Board anchors the line at the card's right edge, halfway down.
  const boardBuilderCard = boardTarget("Builder")!.getBoundingClientRect();
  const boardConnectorSource = document.querySelector<SVGCircleElement>(
    ".world-intent-connector circle",
  )!;
  check(
    Math.abs(
      Number(boardConnectorSource.getAttribute("cx")) - boardBuilderCard.right,
    ) <= 3 &&
      Math.abs(
        Number(boardConnectorSource.getAttribute("cy")) -
          (boardBuilderCard.top + boardBuilderCard.height / 2),
      ) <= 3,
    "Board Inspector connector did not start at the card's edge",
  );
  check(
    !document.querySelector('[role="dialog"][aria-label="Reviewer Inspector"]'),
    "Board A-to-B selection unexpectedly floated the replaced Inspector",
  );
  const graphBuilderInput = terminalInput(
    document.querySelector(".world-managed-window.is-active") ?? document,
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
    "Builder Board terminal identity",
  );

  const retainedBuilder = document.querySelector<HTMLElement>(
    '[aria-label="Builder Inspector"]',
  )!;
  const treeEntryBounds = retainedBuilder.getBoundingClientRect();
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      window.__HERDR_TOWN_RENDERER__?.ready === true &&
      document.querySelector('[aria-label="Builder Inspector"]'),
    "Town shares the retained Inspector",
  );
  check(
    Math.abs(
      retainedBuilder.getBoundingClientRect().left - treeEntryBounds.left,
    ) < 2,
    "view transition moved the Inspector",
  );
  await until(() => agentTarget("Reviewer"), "Reviewer Town target");
  await openAgent("Reviewer");
  await until(
    () => document.querySelector('[aria-label="Reviewer Inspector"]'),
    "Town opens the second managed Inspector",
  );
  await arrangeWindows("Columns");
  const arrangedBuilder = retainedBuilder.getBoundingClientRect();
  document
    .querySelector<HTMLElement>('.tabbar-tab[data-tab-id="created-tab-3"]')!
    .click();
  await until(
    () => document.querySelectorAll(".world-managed-window").length === 3,
    "later tab opens during arrangement",
  );
  check(
    Math.abs(
      retainedBuilder.getBoundingClientRect().width - arrangedBuilder.width,
    ) < 2,
    "later admission retiled an existing window",
  );
  const laterWindow = document.querySelector<HTMLElement>(
    ".world-managed-window.is-active",
  )!;
  const laterBounds = laterWindow.getBoundingClientRect();
  await arrangeWindows("Restore positions");
  check(
    Math.abs(laterWindow.getBoundingClientRect().left - laterBounds.left) < 2,
    "Restore moved a later admitted window",
  );
  laterWindow
    .querySelector<HTMLButtonElement>('[aria-label="Close Inspector window"]')!
    .click();
  await openAgent("Builder");
  await until(
    () =>
      document.querySelector(
        '.world-managed-window.is-active[aria-label="Builder Inspector"]',
      ),
    "Town selects retained Builder",
  );
  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector(".board"), "Board after Town");
  await until(() => boardTarget("Reviewer"), "Reviewer Board target");
  flushSync(() => boardTarget("Reviewer")!.click());
  await until(
    () => reviewerInspectorActive(),
    "Reviewer docked Inspector before Spaces handoff",
  );
  // Chat reads the Reviewer's harness, so Board opens it on Chat.
  await until(
    () =>
      document
        .querySelector(".world-managed-window.is-active .workspace-inspector")
        ?.getAttribute("data-view") === "history",
    "Board opens an agent Chat reads on Chat",
  );
  // The compact checks below read its terminal, as a user switching views.
  flushSync(() =>
    document
      .querySelector<HTMLButtonElement>(
        '.world-managed-window.is-active [role="tab"][aria-label="Terminal"]',
      )!
      .click(),
  );
  await until(
    () =>
      document
        .querySelector(".world-managed-window.is-active .workspace-inspector")
        ?.getAttribute("data-view") === "terminal",
    "Reviewer's Terminal view before Spaces handoff",
  );
  await settle();
  const persistentControlPlane = document.querySelector(".world-control-plane");
  const persistentReviewerInspector = document.querySelector(
    ".world-managed-window.is-active .workspace-inspector",
  );
  const compactRail =
    document.querySelector<HTMLElement>(".world-view-layout")!;
  const beforeCompactFitCalls = calls.length;
  compactRail.style.width = "390px";
  updateLayoutPreferences({ mode: "mobile" });
  await until(
    () => document.documentElement.dataset.layout === "mobile",
    "forced compact layout",
  );
  await settle();
  await settle();
  await settle();
  await fetch("/capture/mobile", { method: "POST" });
  const visibleTerminalRows = () =>
    document.querySelector(".world-managed-window .xterm-rows")
      ?.childElementCount;
  // A historical resize request can precede the compact layout's final fit.
  // Confirm that the service has the visible terminal's current row count
  // before comparing it with the keyboard-induced fit.
  await settleWindowLayout();
  await until(() => {
    const rows = visibleTerminalRows();
    const latest = calls
      .slice(beforeCompactFitCalls)
      .filter(
        ({ method, params }) =>
          method === "terminal.resize" &&
          params.terminal_id === "reviewer-terminal",
      )
      .slice(-1)[0];
    return rows && latest?.params.rows === rows;
  }, "compact terminal fit reached the service before keyboard input");
  const viewport = window.visualViewport!;
  const viewportHeight = Object.getOwnPropertyDescriptor(viewport, "height");
  const heightBeforeKeyboard = document
    .querySelector(".world-managed-window")!
    .getBoundingClientRect().height;
  const rowsBeforeKeyboard = visibleTerminalRows()!;
  const beforeKeyboardCalls = calls.length;
  Object.defineProperty(viewport, "height", {
    configurable: true,
    get: () => window.innerHeight - 280,
  });
  viewport.dispatchEvent(new Event("resize"));
  await until(
    () =>
      document.querySelector(".world-managed-window")!.getBoundingClientRect()
        .height <
      heightBeforeKeyboard - 270,
    "World applies keyboard inset once to the work area",
  );
  await until(
    () =>
      calls
        .slice(beforeKeyboardCalls)
        .some(
          ({ method, params }) =>
            method === "terminal.resize" &&
            params.terminal_id === "reviewer-terminal" &&
            Number(params.rows) < rowsBeforeKeyboard,
        ),
    "visible terminal refits its rows above the keyboard",
  );
  if (viewportHeight) Object.defineProperty(viewport, "height", viewportHeight);
  else Reflect.deleteProperty(viewport, "height");
  viewport.dispatchEvent(new Event("resize"));
  await until(
    () =>
      Math.abs(
        document.querySelector(".world-managed-window")!.getBoundingClientRect()
          .height - heightBeforeKeyboard,
      ) < 2,
    "World restores the work area after keyboard dismissal",
  );
  const mobileTabBar = document.querySelector<HTMLElement>(".tabbar");
  check(
    getComputedStyle(document.querySelector(".mobile-terminal-controls")!)
      .position === "fixed",
    "mobile ellipsis controls stopped floating",
  );
  check(
    !mobileTabBar || getComputedStyle(mobileTabBar).display === "none",
    "mobile retained the redundant tab strip",
  );
  check(
    !document.querySelector(".mobile-nav .world-window-switcher-trigger"),
    "mobile has a duplicate tab/window list icon in the third row",
  );
  check(
    !!document.querySelector('.mobile-terminal-tools [aria-label="Show tabs"]'),
    "mobile removed the second-row Tabs menu",
  );
  check(
    !!document.querySelector(
      '.mobile-terminal-tools [aria-label="Arrange windows"]',
    ),
    "mobile arrangement must share the second row with Tabs",
  );
  check(
    !document.querySelector(
      '.mobile-nav[aria-label="Workspace view switcher"] [aria-label="Arrange windows"]',
    ),
    "mobile resource row retained the window arranger",
  );
  // Beside a terminal the islands wait in the app bar's ⋮ menu.
  document.querySelector<HTMLButtonElement>(".mobile-more-button")!.click();
  await until(
    () =>
      getComputedStyle(document.querySelector(".mobile-controls-stack")!)
        .display !== "none",
    "mobile ⋮ menu shows the floating controls",
  );
  // Tabs and the collapse toggle stay in the app bar, hidden in the menu.
  const secondRowButtons = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".mobile-terminal-controls button",
    ),
  ].filter((button) => button.getBoundingClientRect().width > 0);
  check(secondRowButtons.length > 0, "mobile ⋮ menu has no terminal controls");
  secondRowButtons.forEach((button, index) => {
    const bounds = button.getBoundingClientRect();
    const previous = secondRowButtons[index - 1]?.getBoundingClientRect();
    check(
      !previous || bounds.top >= previous.bottom,
      "mobile ⋮ menu rows overlap",
    );
    check(
      button.contains(
        document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ),
      ),
      "mobile second-row control is obscured",
    );
  });
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
  // The collapse toggle sits inside the menu, so its tap closed it.
  if (!document.querySelector(".app[data-mobile-more]"))
    document.querySelector<HTMLButtonElement>(".mobile-more-button")!.click();
  await settle();
  check(
    !mobileTabBar?.querySelector('button[aria-label="Arrange windows"]') &&
      document
        .querySelector<HTMLElement>(
          '.mobile-nav button[aria-label="Arrange windows"]',
        )!
        .getBoundingClientRect().width > 0,
    "mobile arrangement access created another tab-strip icon",
  );
  document.querySelector<HTMLButtonElement>(".mobile-more-button")!.click();
  await until(
    () => !document.querySelector(".app[data-mobile-more]"),
    "mobile ⋮ menu closes",
  );
  const compactReviewerSlot = persistentReviewerInspector?.closest<HTMLElement>(
    ".world-managed-window",
  );
  check(
    getComputedStyle(compactReviewerSlot!).display !== "none" &&
      compactReviewerSlot!.getBoundingClientRect().height > 0,
    "compact Board hid the World Inspector behind the Spaces session rule",
  );
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      window.__HERDR_TOWN_RENDERER__?.ready === true &&
      document.querySelector(
        ".world-managed-window.is-active .workspace-inspector",
      ) === persistentReviewerInspector,
    "compact Town retained Inspector",
  );
  check(
    compactReviewerSlot!.getBoundingClientRect().height > 0,
    "compact Town did not render the retained Inspector",
  );
  const compactBuilderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  check(
    compactBuilderWindow === null,
    "compact Town exposed a floating Inspector above the docked Inspector",
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
  // Selecting Files commits data-view before the effect drills into the
  // retained file. Wait for its back action so a missing button cannot silently
  // skip returning to the explorer on a slow renderer.
  const compactFilesBack = () =>
    persistentReviewerInspector?.querySelector<HTMLButtonElement>(
      'button[aria-label="Files"]:not([role="tab"])',
    );
  await until(compactFilesBack, "compact Files retained-file back action");
  compactFilesBack()!.click();
  const compactFilesResource = persistentReviewerInspector?.querySelector(
    ".inspector-files-resource:not(.is-hidden)",
  );
  await until(
    () =>
      !persistentReviewerInspector?.classList.contains("has-detail") &&
      (compactFilesResource?.getBoundingClientRect().height ?? 0) > 0 &&
      (compactFilesResource
        ?.querySelector(".file-explorer-side")
        ?.getBoundingClientRect().height ?? 0) > 0,
    "compact Files explorer layout after the back action",
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
    () => Boolean(compactChangesResource?.querySelector(".diff-viewer-side")),
    "compact agent worktree Changes",
  );
  const selectedTreeBadge = () =>
    persistentReviewerInspector?.querySelector(
      '[role="tab"][aria-label="Changes"] .workspace-inspector-count',
    );
  check(
    !selectedTreeBadge(),
    "A clean agent worktree must not display the dirty launch checkout's count",
  );
  // The same location popover supplies explicit choices when evidence is ambiguous.
  ambiguousAgentWorktrees = true;
  persistentReviewerInspector!
    .querySelector<HTMLButtonElement>(".workspace-inspector-location")!
    .click();
  await until(
    () => Boolean(document.querySelector(".agent-worktree-picker")),
    "agent worktree location popover",
  );
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".agent-worktree-picker button",
    ),
  ]
    .find((button) => button.textContent === "Refresh")!
    .click();
  await until(
    () =>
      Boolean(
        compactChangesResource?.querySelector(
          ".workspace-inspector-unavailable",
        ),
      ),
    "ambiguous worktree empty state",
  );
  check(
    !compactChangesResource?.querySelector(".diff-viewer-side"),
    "Ambiguous worktree evidence must not mount workspace Changes as fallback",
  );
  persistentReviewerInspector!
    .querySelector<HTMLButtonElement>(".workspace-inspector-location")!
    .click();
  [...compactChangesResource!.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Choose a worktree")!
    .click();
  await until(
    () => Boolean(document.querySelector(".agent-worktree-picker")),
    "Choose a worktree reopens the same location popover",
  );
  const worktreeChoices = document.querySelectorAll<HTMLInputElement>(
    '.agent-worktree-picker input[type="radio"]',
  );
  check(
    worktreeChoices.length === 2 &&
      [...worktreeChoices].every((radio) => !radio.checked),
    "Ambiguous worktrees must offer two unselected native radio choices",
  );
  if (document.documentElement.dataset.layout === "mobile")
    check(
      Boolean(
        document.querySelector(
          '.workspace-inspector-location-sheet[aria-modal="true"] .mobile-sheet-handle',
        ),
      ),
      "The phone location chooser must use the shared dialog/handle sheet pattern",
    );
  check(
    !selectedTreeBadge(),
    "An ambiguous agent worktree must not inherit the launch checkout's count",
  );
  const worktreeRequestsStart = calls.length;
  (worktreeChoices[0] as HTMLInputElement).click();
  await until(
    () => Boolean(compactChangesResource?.querySelector(".diff-viewer-side")),
    "explicit agent worktree choice",
  );
  await until(
    () =>
      ["file.list", "git.diff_summary"].every((method) =>
        calls
          .slice(worktreeRequestsStart)
          .some(
            (call) =>
              call.method === method &&
              (
                call.params.agent_worktree as
                  | { candidateId?: string }
                  | undefined
              )?.candidateId === "reviewer-pane-agent",
          ),
      ),
    "same chosen root for Files and Changes",
  );
  check(
    persistentReviewerInspector!
      .querySelector(".workspace-inspector-location")
      ?.textContent?.includes("reviewer-pane") === true,
    "Location line must identify the selected worktree, not the launch checkout",
  );
  const alternateChoiceStart = calls.length;
  document
    .querySelectorAll<HTMLInputElement>(
      '.agent-worktree-picker input[type="radio"]',
    )[1]!
    .click();
  await until(
    () =>
      calls
        .slice(alternateChoiceStart)
        .some(
          (call) =>
            call.method === "git.diff_summary" &&
            (call.params.agent_worktree as { candidateId?: string } | undefined)
              ?.candidateId === "reviewer-pane-main",
        ),
    "alternate selected worktree Changes status",
  );
  check(
    !selectedTreeBadge(),
    "Changing the selected worktree must not restore the launch-workspace count",
  );
  document
    .querySelectorAll<HTMLInputElement>(
      '.agent-worktree-picker input[type="radio"]',
    )[0]!
    .click();
  await until(
    () =>
      persistentReviewerInspector!
        .querySelector(".workspace-inspector-location")
        ?.textContent?.includes("reviewer-pane"),
    "restore selected agent worktree",
  );
  persistentReviewerInspector!
    .querySelector<HTMLButtonElement>(".workspace-inspector-location")!
    .click();
  ambiguousAgentWorktrees = false;
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
        "textarea.terminal-composer-input",
      ),
    "compact Inspector Terminal view",
  );
  check(
    compactTerminalButton.classList.contains("active"),
    "compact World Inspector Terminal navigation was not active",
  );
  const compactKeyboardButton =
    persistentReviewerInspector!.querySelector<HTMLTextAreaElement>(
      "textarea.terminal-composer-input",
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
  compactKeyboardButton.focus({ preventScroll: true });
  compactKeyboardButton.click();
  // On phones the Message bar raises the keyboard in Composer's editor.
  await until(
    () =>
      persistentReviewerInspector?.querySelector(".terminal-composer-input") ===
      document.activeElement,
    "compact World Inspector opens Composer with its editor focused",
  );
  compactFilesButton.click();
  await until(
    () =>
      persistentReviewerInspector?.getAttribute("data-view") === "files" &&
      (compactFilesResource?.getBoundingClientRect().height ?? 0) > 0,
    "compact World Inspector Files view before Spaces",
  );
  const terminalAttachesBeforeSpaces = calls.filter(
    ({ method, params }) =>
      method === "terminal.attach" &&
      params.terminal_id === "reviewer-terminal",
  ).length;
  const terminalDetachesBeforeSpaces = calls.filter(
    ({ method, params }) =>
      method === "terminal.detach" &&
      params.terminal_id === "reviewer-terminal",
  ).length;
  const reviewerWasAttached =
    terminalAttachesBeforeSpaces > terminalDetachesBeforeSpaces;
  viewSelect.value = "spaces";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document
        .querySelector(".workspace-surface-owner")
        ?.classList.contains("is-inactive") &&
      document.querySelector(
        ".workspace-terminal-surface textarea.terminal-composer-input",
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
      document.querySelector(
        ".world-managed-window.is-active .workspace-inspector",
      ) === persistentReviewerInspector,
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
    calls.filter(
      ({ method, params }) =>
        method === "terminal.attach" &&
        params.terminal_id === "reviewer-terminal",
    ).length ===
      terminalAttachesBeforeSpaces + (reviewerWasAttached ? 0 : 1) &&
      calls.filter(
        ({ method, params }) =>
          method === "terminal.detach" &&
          params.terminal_id === "reviewer-terminal",
      ).length === terminalDetachesBeforeSpaces &&
      calls.some(
        ({ method, params }) =>
          method === "terminal.attach" &&
          params.terminal_id === "reviewer-terminal",
      ),
    "Spaces handoff did not reuse a live source or attach an absent source exactly once",
  );
  // Exercise App's actual Spaces Inspector, separate from the retained World
  // Inspector. Both must read and save the terminal's same Interest choice.
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_INSPECTOR_REQUEST_EVENT, {
      cancelable: true,
      detail: {
        connectionId: "local",
        generation: client.generation,
        workspaceId: "studio",
        originPaneId: "reviewer-pane",
        view: "history",
      },
    }),
  );
  const spacesInspector = () =>
    document.querySelector<HTMLElement>(
      ".workspace-inspector-slot .workspace-inspector",
    );
  const attentionChoicesFor = async (inspector: Element) => {
    const trigger =
      inspector.querySelector<HTMLButtonElement>('[aria-label^="Interest:"]') ??
      inspector.querySelector<HTMLButtonElement>(
        '[aria-label="More actions for Inspector window"]',
      );
    if (!trigger) throw new Error("Inspector has no attention control");
    trigger.click();
    await until(
      () =>
        document.querySelector(
          ".interest-choices, [aria-label='Window actions']",
        ),
      "Inspector attention choices",
    );
    const choices = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".interest-choice, [aria-label='Window actions'] [role='menuitemradio']",
      ),
    ];
    return {
      trigger,
      choice: (label: string) =>
        choices.find((button) => button.textContent?.startsWith(label))!,
    };
  };
  await until(
    () =>
      spacesInspector()?.querySelector(
        '[aria-label^="Interest:"], [aria-label="More actions for Inspector window"]',
      ),
    "Spaces Inspector attention control",
  );
  (await attentionChoicesFor(spacesInspector()!)).choice("Muted").click();
  await until(
    () =>
      boardDocument.layout.interest?.[
        interestKey("local", "reviewer-terminal")
      ] === "muted",
    "Spaces Interest saves the owning terminal",
  );
  const worldAttention = await attentionChoicesFor(
    persistentReviewerInspector!,
  );
  check(
    worldAttention.choice("Muted").getAttribute("aria-checked") === "true" ||
      worldAttention.choice("Muted").getAttribute("aria-pressed") === "true",
    "World Inspector shares Spaces Interest",
  );
  worldAttention.trigger.click();
  failInterestPatch = true;
  (await attentionChoicesFor(spacesInspector()!)).choice("Focused").click();
  await until(
    () => store.get().notice?.message === "Agent interest could not be saved",
    "Interest save failure notice",
  );
  check(
    store.get().notice?.detail === "Synthetic Interest save failure" &&
      boardDocument.layout.interest?.[
        interestKey("local", "reviewer-terminal")
      ] === "muted",
    "failed Interest save explains the error and keeps the saved policy",
  );
  failInterestPatch = false;
  window.dispatchEvent(new CustomEvent(WORKSPACE_INSPECTOR_CLOSE_EVENT));
  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".board") && reviewerInspectorActive(),
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
  await until(() => boardTarget("Reviewer"), "Reviewer before retirement");
  flushSync(() => boardTarget("Reviewer")!.click());
  await until(
    () => reviewerInspectorActive(),
    "selected Reviewer before retirement",
  );
  await settle();

  const reviewerInspector = document.querySelector<HTMLElement>(
    ".world-managed-window.is-active .workspace-inspector",
  )!;
  reviewerInspector
    .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Files"]')!
    .click();
  await until(
    () => reviewerInspector.getAttribute("data-view") === "files",
    "Reviewer Files state before session replacement",
  );
  const worktreeBeforeReplacement = calls.length;
  const replacementSession = {
    source: "herdr:claude",
    agent: "claude",
    kind: "id",
    value: "review-b",
  };
  Object.assign(panes[1]!, { agent_session: replacementSession });
  panes[1]!.display_agent = "Reviewer Next";
  agents = [
    {
      pane_id: "reviewer-pane",
      terminal_id: "reviewer-terminal",
      agent: "claude",
      display_agent: "Reviewer Next",
      task_summary: "Reviewing the replacement session",
      agent_session: replacementSession,
    },
  ];
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () =>
      document
        // The replacement agent keeps the native tab name in its header.
        .querySelector(
          '[aria-label="Reviewer Next Inspector"] .workspace-inspector-checkout',
        )
        ?.getAttribute("title")
        ?.startsWith(`${tabs[1]!.label} · `) &&
      document
        .querySelector(".world-managed-window.is-active .workspace-inspector")
        ?.getAttribute("data-view") === "terminal",
    "reconciled replacement Reviewer session",
  );
  check(
    calls.slice(worktreeBeforeReplacement).some(({ method, params }) => {
      const subject = params.subject as
        | { paneId?: string; sessionFingerprint?: string | null }
        | undefined;
      return (
        method === "agent_worktree.get" &&
        subject?.paneId === "reviewer-pane" &&
        typeof subject.sessionFingerprint === "string" &&
        /^[a-f0-9]{64}$/u.test(subject.sessionFingerprint)
      );
    }),
    "replacement session did not refresh its qualified worktree context",
  );

  const splitBuilderWindow = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Builder Inspector"]',
  )!;
  splitBuilderWindow.querySelector<HTMLElement>(".xterm")!.dispatchEvent(
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
  // Reproduce a coalesced refresh: the first response predates the new pane,
  // while the successor stays pending until the focused terminal renders it.
  const siblingObservation = Promise.withResolvers<void>();
  siblingObservationGate = siblingObservation.promise;
  void worldRuntimeStore.refresh();
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
  await until(
    () => splitBuilderWindow.querySelectorAll(".xterm").length === 2,
    "both split renderers before disconnect",
  );
  // The title's pane map (#444) draws the same split and marks the shown pane.
  const paneMapGlyph = () =>
    splitBuilderWindow.querySelector<HTMLButtonElement>(
      ".workspace-inspector-head .inspector-pane-map-glyph",
    );
  const paneMapSelected = () =>
    [...(paneMapGlyph()?.querySelectorAll("i") ?? [])].findIndex((cell) =>
      cell.classList.contains("is-selected"),
    );
  await until(
    () =>
      paneMapGlyph()?.querySelectorAll("i").length === 2 &&
      paneMapSelected() === 0,
    "split window title shows its pane map",
  );
  const retainedWindows = [
    ...document.querySelectorAll(".world-managed-window .workspace-inspector"),
  ];
  const retainedRenderers = [...splitBuilderWindow.querySelectorAll(".xterm")];
  const retainedCells = [
    ...splitBuilderWindow.querySelectorAll<HTMLElement>(".pane-layout-cell"),
  ];
  const retainedRects = retainedCells.map((cell) => cell.getAttribute("style"));
  requestTerminalComposer({
    connectionId: "local",
    generation: runtimeGeneration,
    paneId: "builder-pane",
  });
  await until(
    () =>
      splitBuilderWindow.querySelector(
        '[data-pane-id="builder-pane"] .terminal-composer-input',
      ),
    "Message editor before resume",
  );
  const resumeEditor = splitBuilderWindow.querySelector<HTMLTextAreaElement>(
    '[data-pane-id="builder-pane"] .terminal-composer-input',
  )!;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(resumeEditor, "Unsent resume draft");
    resumeEditor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  const resumeDraftKey = terminalComposerDraftKey(
    "local",
    runtimeGeneration,
    "builder-pane",
  );
  check(
    readTerminalComposerDraft(resumeDraftKey) === "Unsent resume draft",
    "Message editor wrote its admitted runtime draft",
  );
  const beforeOutage = store.get();
  const outageUrl = location.href;
  const inputsBeforeOutage = calls.filter((call) =>
    ["terminal.input", "pane.send_input"].includes(call.method),
  ).length;
  client.isCurrent = () => false;
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      status: "disconnected",
      catalogueReady: false,
      connectionGeneration: 2,
      lastTopologyObservationStartedAt: 0,
      endpointAvailability: {},
      connections: [],
    }),
  );
  await settle();
  check(
    resumeEditor.value === "Unsent resume draft" &&
      readTerminalComposerDraft(resumeDraftKey) === resumeEditor.value,
    "transport disconnect lost the unsent Message draft",
  );
  check(
    resumeEditor.closest(".workspace-inspector-body")?.hasAttribute("inert") ===
      true,
    "offline Message cannot dispatch",
  );
  check(
    retainedWindows.every((window) => window.isConnected),
    "browser outage closed a retained Inspector",
  );
  check(
    retainedRenderers.length === 2 &&
      retainedRenderers.every((renderer) => renderer.isConnected),
    "browser outage replaced a split terminal renderer",
  );
  check(
    retainedCells.every(
      (cell, index) =>
        cell.isConnected && cell.getAttribute("style") === retainedRects[index],
    ),
    "browser outage changed split geometry",
  );
  check(
    !!splitBuilderWindow.querySelector('[data-stale="true"]'),
    "offline Inspector lacks a stale indicator",
  );
  flushSync(() =>
    __storeTesting.replaceState({ ...store.get(), status: "connected" }),
  );
  await settle();
  check(
    retainedWindows.every((window) => window.isConnected),
    "socket-open before catalogue closed an Inspector",
  );
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      catalogueReady: true,
      connections: beforeOutage.connections.map((owner) => ({
        ...owner,
        state: "error",
      })),
    }),
  );
  await settle();
  check(
    retainedRenderers.every((renderer) => renderer.isConnected),
    "same-generation unavailable owner destroyed its renderer",
  );
  const retiredClient = client;
  client = { ...retiredClient, generation: 3, isCurrent: () => true };
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      connections: beforeOutage.connections,
      terminalAttachEpoch: beforeOutage.terminalAttachEpoch + 1,
    }),
  );
  await settle();
  check(
    retainedRenderers.every((renderer) => renderer.isConnected),
    "same-runtime reconnect replaced a renderer",
  );
  check(
    retainedWindows.every((window) => window.isConnected),
    "same-runtime reconnect replaced an Inspector",
  );
  check(
    resumeEditor.value === "Unsent resume draft",
    "same-runtime reconnect lost its Message draft",
  );
  splitBuilderWindow
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close terminal input"]',
    )
    ?.click();
  check(location.href === outageUrl, "browser outage navigated the app");
  check(
    calls.filter((call) =>
      ["terminal.input", "pane.send_input"].includes(call.method),
    ).length === inputsBeforeOutage,
    "reconnect replayed terminal input",
  );
  check(
    !worldRuntimeStore
      .get()
      .connections[0]?.snapshot?.panes.some(
        (pane) => pane.pane_id === siblingPane.pane_id,
      ),
    "held aggregate observation must lag the newly rendered local sibling",
  );
  siblingObservation.resolve();
  await until(
    () =>
      worldRuntimeStore
        .get()
        .connections[0]?.snapshot?.panes.some(
          (pane) => pane.pane_id === siblingPane.pane_id,
        ) && boardTarget("Builder Sibling"),
    "aggregate observation and rendered graph admitted the new sibling",
  );
  siblingObservationGate = null;
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
    .querySelector<HTMLElement>(
      '.pane-layout-cell[data-pane-id="builder-sibling-pane"]',
    )!
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
  const siblingInput = splitBuilderWindow.querySelector<HTMLTextAreaElement>(
    '[data-pane-id="builder-sibling-pane"] .xterm-helper-textarea',
  )!;
  await until(
    () => document.activeElement === siblingInput,
    "split sibling acquired input without terminal click",
  );
  const originalInputsBefore = calls.filter(
    ({ method, params }) =>
      method === "terminal.input" && params.terminal_id === "builder-terminal",
  ).length;
  const siblingInputsBefore = calls.filter(
    ({ method, params }) =>
      method === "terminal.input" &&
      params.terminal_id === "builder-sibling-terminal",
  ).length;
  sendKey(document.activeElement as HTMLTextAreaElement);
  await until(
    () =>
      calls.filter(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "builder-sibling-terminal",
      ).length ===
      siblingInputsBefore + 1,
    "split selected sibling received input",
  );
  check(
    calls.filter(
      ({ method, params }) =>
        method === "terminal.input" &&
        params.terminal_id === "builder-terminal",
    ).length === originalInputsBefore,
    "split input reached original pane",
  );
  splitBuilderWindow.focus();
  splitBuilderWindow.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await until(
    () => document.activeElement === siblingInput,
    "keyboard activated window focused selected sibling",
  );
  check(paneMapSelected() === 1, "title map did not follow the clicked pane");
  // Switching from the title map shows the other pane, World-only.
  const switchFromPaneMap = async (paneId: string) => {
    paneMapGlyph()!.click();
    await until(
      () =>
        document.querySelector(
          `[aria-label="Panes in this tab"] [data-map-pane-id="${paneId}"]`,
        ),
      `title map opened for ${paneId}`,
    );
    document
      .querySelector<HTMLButtonElement>(
        `[aria-label="Panes in this tab"] [data-map-pane-id="${paneId}"]`,
      )!
      .click();
    await until(
      () =>
        store.get().selectedPaneId === paneId &&
        splitBuilderWindow
          .querySelector(".pane-layout-cell.is-active")
          ?.getAttribute("data-pane-id") === paneId &&
        !document.querySelector('[aria-label="Panes in this tab"]'),
      `title map switched to ${paneId}`,
    );
  };
  const paneMoves = calls.filter(({ method }) =>
    ["pane.focus_direction", "pane.zoom", "pane.swap"].includes(method),
  ).length;
  await switchFromPaneMap("builder-pane");
  check(paneMapSelected() === 0, "title map did not mark its own switch");
  await switchFromPaneMap(siblingPane.pane_id);
  check(
    calls.filter(({ method }) =>
      ["pane.focus_direction", "pane.zoom", "pane.swap"].includes(method),
    ).length === paneMoves,
    "title map changed Herdr's panes",
  );
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "Town split-pane input check",
  );
  splitBuilderWindow.focus();
  splitBuilderWindow.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await until(
    () =>
      document.activeElement === siblingInput &&
      store.get().selectedPaneId === siblingPane.pane_id,
    "Town preserved selected sibling after visual view change",
  );
  const officeSiblingInputsBefore = calls.filter(
    ({ method, params }) =>
      method === "terminal.input" &&
      params.terminal_id === "builder-sibling-terminal",
  ).length;
  sendKey(document.activeElement as HTMLTextAreaElement);
  await until(
    () =>
      calls.filter(
        ({ method, params }) =>
          method === "terminal.input" &&
          params.terminal_id === "builder-sibling-terminal",
      ).length ===
      officeSiblingInputsBefore + 1,
    "Town selected sibling received input",
  );
  check(
    calls.filter(
      ({ method, params }) =>
        method === "terminal.input" &&
        params.terminal_id === "builder-terminal",
    ).length === originalInputsBefore,
    "Town sibling input reached original pane",
  );
  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector(".board"),
    "Board after Town split-pane check",
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
          '[aria-label="Reviewer Next Inspector"] .workspace-inspector-checkout',
        )
        ?.getAttribute("title")
        ?.startsWith(`${tabs[1]!.label} · `) === true &&
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
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "Town before later Inspector opening",
  );
  toggleTopbarMenu();
  await until(
    () =>
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Inspector opening"]',
      ),
    "Town opening preference before Restore regression",
  );
  const laterOpeningSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Inspector opening"]',
  )!;
  laterOpeningSelect.value = "floating";
  laterOpeningSelect.dispatchEvent(new Event("change", { bubbles: true }));
  toggleTopbarMenu();
  const laterDesk = () =>
    document.querySelector<HTMLButtonElement>(
      '.world-semantic-target[data-kind="desk"][data-target-key*="created-tab-3"]:not(:disabled)',
    );
  await until(laterDesk, "later terminal desk in Town");
  // World can expose a new tab while the focused list still predates it.
  const staleFocusedTabs = store
    .get()
    .tabs.filter((tab) => tab.tab_id !== "created-tab-3");
  __storeTesting.replaceState({ ...store.get(), tabs: staleFocusedTabs });
  const delayedOpeningList = Promise.withResolvers<void>();
  delayedTabList = {
    promise: delayedOpeningList.promise,
    tabs: staleFocusedTabs,
  };
  const tabListsBeforeOpening = calls.filter(
    ({ method }) => method === "tab.list",
  ).length;
  laterDesk()!.click();
  await until(
    () =>
      calls.filter(({ method }) => method === "tab.list").length >
      tabListsBeforeOpening,
    "focused tab list delayed during Inspector opening",
  );
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 3,
    "later floating Inspector outside the arranged set",
  );
  await settle();
  check(
    document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
      .length === 3,
    "pre-admission focused list retired a newly opened Inspector",
  );
  delayedTabList = null;
  delayedOpeningList.resolve();
  await store.refresh();
  await until(
    () => store.get().tabs.some((tab) => tab.tab_id === "created-tab-3"),
    "focused tab list caught up after opening",
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
  const laterPlacement = laterInspector!.getBoundingClientRect();
  await arrangeWindows("Restore positions");
  check(
    Boolean(laterInspector?.isConnected) &&
      Math.abs(
        laterInspector!.getBoundingClientRect().left - laterPlacement.left,
      ) < 2,
    "Restore moved a later Inspector",
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
  const narrowLayoutDiagnostic = () =>
    JSON.stringify({
      stage: narrowedVisualStage.getBoundingClientRect().toJSON(),
      windows: [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-label$=" Inspector"]',
        ),
      ].map((window) => ({
        bounds: window.getBoundingClientRect().toJSON(),
        compact: window
          .querySelector(".workspace-inspector")
          ?.classList.contains("is-compact"),
      })),
    });
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
        // In the narrowest window the inactive views are hidden on purpose;
        // they are under ⋯ (checked below).
        if (button.getClientRects().length === 0) return [];
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
  await until(
    () => {
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
    },
    () => `three Inspectors in narrow Columns: ${narrowLayoutDiagnostic()}`,
  );
  await settle();
  // Every view stays one tap away: as a tab, or, in the narrowest window,
  // under the window's one ⋯ menu beside its actions.
  check(
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-label$=" Inspector"]',
      ),
    ].every(
      (window) =>
        [
          ...window.querySelectorAll<HTMLElement>(
            '.workspace-inspector-tabs [role="tab"]',
          ),
        ].every((tab) => tab.getClientRects().length > 0) ||
        (window
          .querySelector<HTMLElement>(
            'button[aria-label="More actions for Inspector window"]',
          )
          ?.getClientRects().length ?? 0) > 0,
    ),
    "a narrow Inspector hid views without offering More views",
  );
  check(
    clippedVisualControls().length === 0,
    `narrow Columns clipped Inspector controls: ${JSON.stringify(clippedVisualControls())}`,
  );
  narrowedVisualStage.style.width = "520px";
  await arrangeWindows("Columns");
  const scrollingLayer = document.querySelector<HTMLElement>(
    ".world-window-layer",
  )!;
  await until(
    () => scrollingLayer.scrollWidth > scrollingLayer.clientWidth,
    "Columns expose native horizontal scrolling",
  );
  scrollingLayer.scrollLeft = scrollingLayer.scrollWidth;
  scrollingLayer.dispatchEvent(new Event("scroll"));
  await until(
    () => scrollingLayer.scrollLeft > 0,
    "Columns can reach the final tile",
  );
  check(
    clippedVisualControls().length === 0,
    `narrow Columns clipped title controls: ${JSON.stringify({ clipped: clippedVisualControls(), scrollLeft: scrollingLayer.scrollLeft, scrollWidth: scrollingLayer.scrollWidth, clientWidth: scrollingLayer.clientWidth })}`,
  );
  narrowedVisualStage.style.width = "700px";
  narrowedVisualStage.style.height = "420px";
  narrowedVisualStage.style.maxHeight = "420px";
  await settle();
  await arrangeWindows("Rows");
  await until(
    () => scrollingLayer.scrollHeight > scrollingLayer.clientHeight,
    "Rows expose native vertical scrolling",
  );
  scrollingLayer.scrollTop = scrollingLayer.scrollHeight;
  scrollingLayer.dispatchEvent(new Event("scroll"));
  await until(
    () => scrollingLayer.scrollTop > 0,
    "Rows can reach the final tile",
  );
  check(
    visualWindowBounds().every((bounds) => bounds.height >= 159),
    "Rows shrank below the usable minimum",
  );
  narrowedVisualStage.style.height = "340px";
  narrowedVisualStage.style.maxHeight = "340px";
  await settle();
  await arrangeWindows("Cascade");
  await until(
    () => scrollingLayer.scrollHeight > scrollingLayer.clientHeight,
    "Cascade exposes native scrolling",
  );
  scrollingLayer.scrollTop = scrollingLayer.scrollHeight;
  scrollingLayer.dispatchEvent(new Event("scroll"));
  await until(
    () => scrollingLayer.scrollTop > 0,
    "Cascade reaches the final group",
  );
  await arrangeWindows("Columns");
  await until(
    () =>
      visualWindowBounds().some(
        (bounds) =>
          bounds.top >= scrollingLayer.getBoundingClientRect().top - 2 &&
          bounds.top < scrollingLayer.getBoundingClientRect().bottom,
      ),
    "changing from scrolled Cascade reveals Columns",
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
  await until(
    () =>
      visualWindowBounds().length === 3 &&
      visualWindowBounds().every((bounds) => bounds.width > 300),
    "Columns expanded with the visual stage",
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
  const maximizedBeforeRestore = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label$=" Inspector"]',
  )!;
  const cascadeMaximize =
    maximizedBeforeRestore.querySelector<HTMLButtonElement>(
      '[aria-label="Maximize Inspector window"]',
    );
  if (!cascadeMaximize)
    throw new Error("Cascade Inspector maximize control missing");
  cascadeMaximize.click();
  await until(
    () =>
      Boolean(
        maximizedBeforeRestore.querySelector(
          '[aria-label="Restore Inspector window"]',
        ),
      ),
    "Cascade participant maximized",
  );
  await arrangeWindows("Restore positions");
  await until(
    () =>
      !maximizedBeforeRestore.querySelector(
        '[aria-label="Restore Inspector window"]',
      ),
    "Restore positions cleared the superseded maximize snapshot",
  );
  await arrangeWindows("Cascade");
  narrowedVisualStage.style.removeProperty("width");
  narrowedVisualStage.style.removeProperty("height");

  focusedTabId = tabs[0]!.tab_id;
  focusedPaneId = "builder-pane";
  tabs.splice(
    tabs.findIndex((tab) => tab.tab_id === "created-tab-3"),
    1,
  );
  panes.splice(
    panes.findIndex((pane) => pane.pane_id === "created-pane-3"),
    1,
  );
  worldRevision += 1;
  await store.refresh();
  await worldRuntimeStore.refresh();
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 2,
    "focused Herdr tab closure retired its Inspector",
  );
  const closeRpcBefore = calls.filter(({ method }) =>
    ["tab.close", "pane.close", "terminal.kill"].includes(method),
  ).length;
  await arrangeWindows("Single");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === 1,
    "Single retained one visible Inspector before Close all",
  );
  await arrangeWindows("Close all terminal windows");
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "arrangement Close all dismissed visual Inspectors",
  );
  check(
    calls.filter(({ method }) =>
      ["tab.close", "pane.close", "terminal.kill"].includes(method),
    ).length === closeRpcBefore,
    "Close all terminated a Herdr tab, pane, or session",
  );
  window.dispatchEvent(new Event("resize"));
  await settle();
  check(
    !document.querySelector(".workspace-inspector"),
    "closed Inspector reappeared through an arrangement",
  );
  await openAgent("Builder");
  await until(
    () => Boolean(document.querySelector(".workspace-inspector")),
    "visual Inspector reopened after Close all",
  );
  await setShellActionsOpen(true);
  const closeAllAction = [
    ...document.querySelectorAll<HTMLElement>(".command-popover [cmdk-item]"),
  ].find(
    (item) =>
      item.querySelector(".command-item-title")?.textContent ===
      "Close all terminal windows",
  );
  check(Boolean(closeAllAction), "Actions omitted Close all terminal windows");
  closeAllAction?.click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "Actions Close all dismissed reopened Inspector",
  );
  await arrangeWindows("Open all terminal windows");
  await until(
    () =>
      document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]')
        .length === tabs.length,
    "Open all presented every terminal tab on the selected host",
  );
  check(
    calls.filter(({ method }) =>
      ["tab.close", "pane.close", "terminal.kill"].includes(method),
    ).length === closeRpcBefore,
    "Open all changed a Herdr tab, pane, or session",
  );

  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  updateLayoutPreferences({ mode: "mobile" });
  await until(
    () => document.documentElement.dataset.layout === "mobile",
    "mobile Town before return navigation",
  );
  document
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Hide mobile controls"]',
    )
    ?.click();
  await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Back to Town"]',
      ),
    "mobile Town has a visible return button outside the ellipsis menu",
  );
  const backToOffice = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Back to Town"]',
  )!;
  check(
    backToOffice.getBoundingClientRect().width >= 44 &&
      backToOffice.getBoundingClientRect().height >= 44,
    "Back to Town has a visible touch target while mobile controls are collapsed",
  );
  const mobileViewBounds = viewSelect.getBoundingClientRect();
  const mobileBackBounds = backToOffice.getBoundingClientRect();
  // Phones switch scenes from the bottom bar; a detail screen shows only Back.
  check(
    mobileViewBounds.width === 0 &&
      mobileBackBounds.left < 60 &&
      !document.querySelector(".world-mobile-nav"),
    "mobile Inspector screen shows Back at the left without scene switchers",
  );
  viewSelect.value = "board";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () =>
      document.querySelector('button[aria-label="Back to Board"]') &&
      document.querySelector(".board"),
    "mobile view switcher changes scenes while retaining the Back action",
  );
  viewSelect.value = "town";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector('button[aria-label="Back to Town"]'),
    "mobile view switcher returns to Town before dismissing Inspectors",
  );
  // The on-screen Back returns to the view in one tap even with Composer
  // open; only the phone's own Back closes Composer first. Open Composer in
  // the visible Inspector (never a parked terminal owner): focus its pane so
  // it is the active pane, then open and find Composer inside that window.
  const visibleInspector = () =>
    [...document.querySelectorAll<HTMLElement>(".world-managed-window")].find(
      (window) =>
        window.getBoundingClientRect().width > 0 &&
        !window.closest(".world-terminal-parking"),
    );
  // The pane cell that holds the visible window's live terminal.
  const visiblePane = () =>
    [
      ...(visibleInspector()?.querySelectorAll<HTMLElement>("[data-pane-id]") ??
        []),
    ].find((pane) => pane.querySelector(".xterm"));
  const visiblePaneId = () => visiblePane()?.dataset.paneId;
  await until(
    () => terminalInput(visiblePane() ?? document.createElement("div")),
    "visible Inspector terminal before Back to Town",
  );
  // Select the pane the way a tap does: panes and windows activate on
  // pointerdown, not on focus.
  const visibleTerminal = visiblePane()!.querySelector<HTMLElement>(".xterm")!;
  const terminalBox = visibleTerminal.getBoundingClientRect();
  for (const type of ["pointerdown", "pointerup"])
    visibleTerminal.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
        pointerId: 9,
        pointerType: "touch",
        clientX: terminalBox.left + terminalBox.width / 2,
        clientY: terminalBox.top + terminalBox.height / 2,
      }),
    );
  terminalInput(visiblePane()!)!.focus();
  await until(
    () =>
      !!visiblePaneId() &&
      store.get().selectedPaneId === visiblePaneId() &&
      !!visibleInspector()?.querySelector("textarea.terminal-composer-input"),
    () =>
      `visible Inspector pane ${visiblePaneId()} active before Back to Town`,
  );
  // With the pane active, the terminal names itself in the app bar. Its title
  // opens the workspace list over the terminal. Back closes that list first
  // and shows the terminal again; it used to close the terminal beneath and
  // leave the list over the scene.
  const terminalTitle = () =>
    document.querySelector<HTMLButtonElement>(".mobile-terminal-title");
  await until(terminalTitle, "mobile terminal title before the workspace list");
  terminalTitle()!.click();
  await until(
    () => terminalTitle()?.getAttribute("aria-expanded") === "true",
    "terminal title opens the workspace list",
  );
  backToOffice.click();
  await until(
    () => terminalTitle()?.getAttribute("aria-expanded") === "false",
    "Back closes the workspace list before the terminal",
  );
  check(
    window.location.pathname === "/town" &&
      !!document.querySelector(".workspace-inspector") &&
      !!document.querySelector('button[aria-label="Back to Town"]'),
    "Back with the workspace list open closed the terminal beneath it",
  );
  visibleInspector()!
    .querySelector<HTMLTextAreaElement>("textarea.terminal-composer-input")!
    .click();
  await until(
    () => !!visibleInspector()?.querySelector(".terminal-composer"),
    "Composer opens in the visible Inspector before Back to Town",
  );
  backToOffice.click();
  await until(
    () => !document.querySelector(".workspace-inspector"),
    "Back to Town dismisses all mobile Inspector presentations",
  );
  check(
    window.location.pathname === "/town" &&
      !!document.querySelector(".world-office-shell"),
    "Back to Town reveals the Town scene without changing route",
  );
  check(
    calls.filter(({ method }) =>
      ["tab.close", "pane.close", "terminal.kill"].includes(method),
    ).length === closeRpcBefore,
    "Back to Town leaves Herdr tabs, panes and sessions running",
  );
  check(
    !document.querySelector('button[aria-label="Back to Town"]'),
    "return action disappears when no Inspector is open",
  );
  // The closed terminal leaves no history entry: one system Back leaves
  // Town for the scene shown before it.
  await settle();
  check(
    !(
      typeof history.state === "object" &&
      history.state !== null &&
      "herdrBack" in history.state
    ),
    "Back to Town left a closed layer's history entry",
  );
  history.back();
  await until(
    () =>
      window.location.pathname === "/board" && document.querySelector(".board"),
    "system Back after Back to Town reaches Board in one press",
  );
  viewSelect.value = "spaces";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector('button[aria-label="Back to Board"]'),
    "mobile Spaces offers Back to Board",
  );
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Back to Board"]')!
    .click();
  await until(
    () => window.location.pathname === "/board",
    "Back to Board leaves Spaces",
  );
  history.back();
  await until(
    () => window.location.pathname !== "/board",
    "system Back after Back to Board moves on",
  );
  check(
    window.location.pathname === "/town",
    `system Back after Back to Board reached ${window.location.pathname}, not Town`,
  );
  // Spaces opened directly has no in-app route to return through; its Back
  // still closes an open menu first.
  viewSelect.value = "spaces";
  viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
  await until(
    () => document.querySelector('button[aria-label="Back to Town"]'),
    "mobile Spaces offers Back to Town",
  );
  history.replaceState({}, "", window.location.href);
  const spacesMore = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="More options"]',
      ),
    ].find((button) => button.getBoundingClientRect().width > 0);
  spacesMore()?.click();
  await until(
    () => spacesMore()?.getAttribute("aria-expanded") === "true",
    "direct Spaces opens More",
  );
  await settle();
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Back to Town"]')!
    .click();
  await until(
    () => spacesMore()?.getAttribute("aria-expanded") === "false",
    "direct Spaces Back closes More first",
  );
  check(
    window.location.pathname === "/spaces",
    `direct Spaces Back left for ${window.location.pathname} while More was open`,
  );
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Back to Town"]')!
    .click();
  await until(
    () => window.location.pathname === "/town",
    "direct Spaces Back replaces Spaces with Town",
  );
  updateLayoutPreferences({ mode: "desktop" });
  await arrangeWindows("Open all terminal windows");

  // Desk: previewing the next agent in the docked reading pane must keep
  // keyboard focus in the queue, so triage keys never reach a terminal.
  const deskViewSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="World view"]',
  );
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set?.call(deskViewSelect, "desk");
  deskViewSelect?.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => Boolean(document.querySelector(".desk")), "Desk view");
  // Earlier steps leave every terminal window open and arranged; close them
  // so the reading pane docks instead of joining the arrangement.
  await arrangeWindows("Close all terminal windows");
  [...document.querySelectorAll<HTMLButtonElement>(".desk-modes button")]
    .find((button) => button.textContent?.startsWith("Agents"))
    ?.click();
  const deskRows = () => [
    ...document.querySelectorAll<HTMLButtonElement>(".desk-row"),
  ];
  await until(() => deskRows().length >= 2, "Desk Agents rows");
  deskRows()[0]?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 1500));
  check(
    Boolean(document.querySelector(".desk.has-reading")),
    `Desk reading pane did not open: rail=${Boolean(document.querySelector(".world-context-rail.has-inspector"))} layoutContext=${Boolean(document.querySelector(".world-view-layout.has-context"))} floating=${document.querySelectorAll('[role="dialog"][aria-label$=" Inspector"]').length} inspector=${document.querySelectorAll(".workspace-inspector").length} rows=${deskRows().length} error=${document.querySelector(".desk-error")?.textContent ?? ""} width=${window.innerWidth}`,
  );
  const firstRow = deskRows()[0]!;
  firstRow.focus();
  await settle();
  firstRow.dispatchEvent(
    new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => window.setTimeout(resolve, 900));
  const readingRow = document.querySelector<HTMLElement>(
    ".desk-row.is-reading",
  );
  check(
    Boolean(readingRow) &&
      readingRow?.dataset.deskCard !== firstRow.dataset.deskCard,
    "Desk preview did not show the next agent in the reading pane",
  );
  // Returning to the agent opened first, whose pane is Herdr's selected pane,
  // must not focus its terminal either.
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => window.setTimeout(resolve, 900));
  const deskActive = document.activeElement;
  check(
    Boolean(deskActive?.closest(".desk")) && !deskActive?.closest(".xterm"),
    `Desk preview moved keyboard focus out of the queue (active: ${deskActive?.tagName}.${deskActive?.className})`,
  );

  const officeViewSelect = document.querySelector<HTMLSelectElement>(
    'select[aria-label="World view"]',
  );
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set?.call(officeViewSelect, "town");
  officeViewSelect?.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();

  // Reuse a shell's tab window for a readable agent while its focus request
  // is pending. The target's views determine what opens, not the shell's.
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set?.call(officeViewSelect, "board");
  officeViewSelect?.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector(".board"), "Board for tab reuse");
  await arrangeWindows("Close all terminal windows");
  const reuseTab: Tab = {
    ...tabs[0]!,
    tab_id: "open-rule-tab",
    number: 90,
    label: "Open Rule Shell",
    focused: false,
    pane_count: 1,
  };
  const reuseShell: Pane = {
    ...panes[0]!,
    pane_id: "open-rule-shell",
    terminal_id: "open-rule-shell-terminal",
    tab_id: reuseTab.tab_id,
    focused: false,
    agent: undefined,
    agent_session: undefined,
    agent_name: undefined,
    display_agent: undefined,
    agent_status: "unknown",
  };
  tabs.push(reuseTab);
  panes.push(reuseShell);
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(() => boardTarget(reuseTab.label), "new shell tab on Board");
  boardTarget(reuseTab.label)!.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true }),
  );
  await until(
    () =>
      document.querySelector(
        '.world-managed-window.is-active .workspace-inspector[data-view="terminal"] [data-pane-id="open-rule-shell"]',
      ),
    "shell tab opened in its floating terminal window",
  );
  const reuseWindow = document.querySelector<HTMLElement>(
    ".world-managed-window.is-active",
  )!;
  check(
    !reuseWindow.querySelector('[role="tab"][aria-label="Chat"]'),
    "shell window unexpectedly offers Chat before the agent appears",
  );
  const reuseAgent: Pane = {
    ...reuseShell,
    pane_id: "open-rule-agent",
    terminal_id: "open-rule-agent-terminal",
    agent: "claude",
    agent_name: "Open Rule Agent",
    display_agent: "Open Rule Agent",
    agent_status: "idle",
    agent_session: { value: "open-rule-session" },
  };
  panes.push(reuseAgent);
  reuseTab.pane_count = 2;
  agents.push({
    ...reuseAgent,
    agent_session: { agent: "claude", kind: "id", value: "open-rule-session" },
  });
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(
    () => boardTarget("Open Rule Agent"),
    "readable sibling on Board",
  );
  const pendingAgentFocus = Promise.withResolvers<void>();
  delayedPaneGet = {
    paneId: reuseAgent.pane_id,
    promise: pendingAgentFocus.promise,
  };
  const priorAgentGets = calls.filter(
    ({ method, params }) =>
      method === "pane.get" && params.pane_id === reuseAgent.pane_id,
  ).length;
  boardTarget("Open Rule Agent")!.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true }),
  );
  await until(
    () =>
      calls.filter(
        ({ method, params }) =>
          method === "pane.get" && params.pane_id === reuseAgent.pane_id,
      ).length > priorAgentGets,
    "reused window waits for the readable agent focus reply",
  );
  pendingAgentFocus.resolve();
  delayedPaneGet = null;
  await until(
    () =>
      reuseWindow.querySelector('.workspace-inspector[data-view="history"]'),
    "shell window reused on the readable agent's requested Chat view",
  );
  check(
    reuseWindow.isConnected &&
      document.querySelectorAll(".world-managed-window .workspace-inspector")
        .length === 1,
    "opening the readable sibling replaced or duplicated its tab window",
  );

  // Two real World Inspector owners may use the same native resource IDs.
  includeSecondHost = true;
  const alphaClient = client;
  let betaClient: ConnectionClient = {
    ...alphaClient,
    connectionId: "beta",
    serverRuntimeGeneration: secondHostGeneration,
    acceptsServerGeneration: (value) => value === secondHostGeneration,
    call: async (method, params) => {
      const result = await alphaClient.call(method, params);
      return method === "agent_worktree.get" ? undefined : result;
    },
  };
  bridge.connection = (connectionId) =>
    connectionId === "beta" ? betaClient : client;
  const alphaOwners = store.get().connections;
  __storeTesting.applyCatalog(
    [
      ...alphaOwners,
      {
        id: "beta",
        label: "Beta",
        source: "test",
        is_default: false,
        state: "ready",
        generation: secondHostGeneration,
      },
    ],
    "local",
  );
  await worldRuntimeStore.refresh();
  // A refresh already in flight can queue this catalog's observation, so
  // wait for both its qualified node and its rendered target.
  const betaTarget = () => {
    const betaNode = buildWorldObject(
      worldRuntimeStore.get().connections,
      "local",
    ).leaves.find(
      (node) =>
        node.connectionId === "beta" && node.nativeId === reuseAgent.pane_id,
    );
    if (!betaNode) return undefined;
    return [
      ...document.querySelectorAll<HTMLElement>("[data-world-node-anchor]"),
    ].find(
      (element) =>
        element.getAttribute("data-world-node-anchor") === betaNode.id,
    );
  };
  await until(betaTarget, "second host's qualified Board target");
  betaTarget()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await until(
    () =>
      document.querySelectorAll(".world-managed-window .workspace-inspector")
        .length === 2,
    "same-ID resources on two independent host Inspectors",
  );
  const betaWindow = [
    ...document.querySelectorAll<HTMLElement>(".world-managed-window"),
  ].find(
    (window) =>
      window !== reuseWindow && window.querySelector(".workspace-inspector"),
  )!;
  betaWindow
    .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Terminal"]')!
    .click();
  await until(
    () => betaWindow.querySelector(".xterm"),
    "second host terminal renderer",
  );
  const betaRenderer = betaWindow.querySelector(".xterm");
  const twoHostOwners = store.get().connections;
  client.isCurrent = () => false;
  betaClient.isCurrent = () => false;
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      status: "disconnected",
      catalogueReady: false,
      connections: [],
      lastTopologyObservationStartedAt: 0,
    }),
  );
  await settle();
  check(
    reuseWindow.isConnected &&
      betaWindow.isConnected &&
      betaRenderer?.isConnected === true,
    "transport disconnect retired one of two independent host presentations",
  );
  client = { ...client, generation: 4, isCurrent: () => true };
  betaClient = { ...betaClient, generation: 4, isCurrent: () => true };
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      status: "connected",
      catalogueReady: true,
      connections: twoHostOwners,
      terminalAttachEpoch: store.get().terminalAttachEpoch + 1,
    }),
  );
  await settle();
  check(
    reuseWindow.isConnected && betaRenderer?.isConnected === true,
    "same-runtime reconnect replaced a cross-host presentation",
  );
  check(
    readTerminalComposerDraft(resumeDraftKey) === "Unsent resume draft",
    "another host's draft was retired by an incomplete catalogue",
  );
  secondHostGeneration += 1;
  __storeTesting.applyCatalog(
    store.get().connections.map((owner) =>
      owner.id === "beta"
        ? {
            ...owner,
            generation: secondHostGeneration,
          }
        : owner,
    ),
    "local",
  );
  worldRevision += 1;
  await worldRuntimeStore.refresh();
  await until(() => !betaWindow.isConnected, "only the replaced host retires");
  check(
    reuseWindow.isConnected,
    "replacing Beta also retired Alpha's Inspector",
  );
  includeSecondHost = false;
  __storeTesting.applyCatalog(alphaOwners, "local");
  await worldRuntimeStore.refresh();

  runtimeGeneration += 1;
  worldRevision += 1;
  __storeTesting.applyCatalog(
    store.get().connections.map((connection) => ({
      ...connection,
      generation: runtimeGeneration,
    })),
    client.connectionId,
  );
  await worldRuntimeStore.refresh();
  await until(
    () =>
      !document.querySelector(".workspace-inspector") &&
      !document.querySelector('[role="dialog"][aria-label$=" Inspector"]'),
    "retired Inspector cleanup",
  );
  check(
    readTerminalComposerDraft(resumeDraftKey) === "",
    "runtime replacement did not retire the old Message draft",
  );
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  check(
    !document.querySelector(".world-selection-panel"),
    "retiring an open Inspector left its stale identity profile selected",
  );

  if (resumeGallery) {
    // A separate scene follows functional assertions, so viewport changes cannot
    // change the identities/geometry used by the disconnect regression above.
    runtimeGeneration += 1;
    client = {
      ...client,
      generation: client.generation + 1,
      serverRuntimeGeneration: runtimeGeneration,
      isCurrent: () => true,
      acceptsServerGeneration: (generation) => generation === runtimeGeneration,
    };
    __storeTesting.applyCatalog(
      store.get().connections.map((owner) => ({
        ...owner,
        generation: runtimeGeneration,
      })),
      "local",
    );
    await worldRuntimeStore.refresh();
    updateLayoutPreferences({ mode: "auto" });
    await until(() => boardTarget("Reviewer"), "synthetic gallery target");
    boardTarget("Reviewer")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await until(
      () =>
        document.querySelector(
          ".world-managed-window.is-active .workspace-inspector",
        ),
      "gallery Inspector",
    );
    const galleryWindow = document.querySelector<HTMLElement>(
      ".world-managed-window.is-active",
    )!;
    galleryWindow
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Terminal"]')!
      .click();
    await until(
      () => galleryWindow.querySelector(".xterm"),
      "gallery terminal",
    );
    requestTerminalComposer({
      connectionId: "local",
      generation: runtimeGeneration,
      paneId: "reviewer-pane",
    });
    await until(
      () => galleryWindow.querySelector(".terminal-composer-input"),
      "gallery Message draft",
    );
    const editor = galleryWindow.querySelector<HTMLTextAreaElement>(
      ".terminal-composer-input",
    )!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(editor, "Unsent synthetic Message");
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    client.isCurrent = () => false;
    flushSync(() =>
      __storeTesting.replaceState({
        ...store.get(),
        status: "disconnected",
        catalogueReady: false,
      }),
    );
    await settle();
    if (!(await fetch("/capture/resume-disconnected")).ok)
      throw new Error("Disconnected gallery capture failed");
    client = {
      ...client,
      generation: client.generation + 1,
      isCurrent: () => true,
    };
    flushSync(() =>
      __storeTesting.replaceState({
        ...store.get(),
        status: "connected",
        catalogueReady: true,
        terminalAttachEpoch: store.get().terminalAttachEpoch + 1,
      }),
    );
    await settle();
    const arm = TerminalAttachFrameWatchdog.prototype.arm;
    try {
      suppressFrameFor = "reviewer-terminal";
      TerminalAttachFrameWatchdog.prototype.arm = function (
        attempt,
        _ms,
        timeout,
      ) {
        return arm.call(this, attempt, 1, timeout);
      };
      for (const listener of terminalClosedListeners)
        listener({
          connection_id: "local",
          connection_generation: runtimeGeneration,
          terminal_id: "reviewer-terminal",
          reason: "terminal_configuration_changed",
        });
      await until(
        () =>
          galleryWindow
            .querySelector('[role="alert"]')
            ?.textContent?.includes("Retry terminal"),
        "gallery no-frame recovery controls",
      );
      if (!(await fetch("/capture/resume-recovery")).ok)
        throw new Error("Recovery gallery capture failed");
    } finally {
      suppressFrameFor = null;
      TerminalAttachFrameWatchdog.prototype.arm = arm;
    }
    galleryWindow
      .querySelector<HTMLButtonElement>('[role="alert"] button')
      ?.click();
    await settle();
  }
  root.unmount();
  await runSharedInspectorChecks(check);
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
