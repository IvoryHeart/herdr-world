// First: the page runs on test time (see testing/testClock.ts).
import { clock } from "./testing/installHostsFilterClock";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "../api";
import { worldLocalStorage } from "../browserStorage";
import {
  DEFAULT_OFFICE_PREFERENCES,
  readOfficePreferences,
  writeOfficePreferences,
} from "./officePreferences";
import { WorktreeLifecycleDialog } from "../components/WorktreeLifecycleDialog";
import { ContextMenu } from "../components/ContextMenu";
import { WorktreeOpenDialog } from "../components/WorktreeOpenDialog";
import {
  initializeLayoutPreferences,
  updateLayoutPreferences,
} from "../layoutPreferences";
import {
  defaultShortcutBindings,
  detectShortcutPlatform,
} from "../shortcutBindings";
import {
  __storeTesting,
  emptyServerSessionState,
  OperationalContext,
  operationalStore,
  store,
} from "../store";
import {
  WORKSPACE_INSPECTOR_ADMISSION_TIMEOUT_MS,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  requestWorkspaceInspector,
  type WorkspaceInspectorRequest,
} from "../workspaceResource";
import { TASK_NOTIFICATION_ACTIVATE_EVENT } from "../taskNotifications";
import type { Pane, Tab, Workspace } from "../types";
import { writeHostsFilter } from "./hostsFilter";
import { worldRuntimeStore } from "./runtimeStore";
import WorldFoundationApp from "./WorldFoundationApp";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import { worldObjectId } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

const failures: string[] = [];
window.addEventListener("error", (event) => {
  failures.push(
    `Uncaught browser error: ${event.error?.stack ?? event.message}`,
  );
});
const check = (value: boolean, message: string) => {
  if (!value) failures.push(message);
};
const calls: string[] = [];
const globals: Array<{ method: string; params: Record<string, unknown> }> = [];
const watches: Array<{
  connection_id: string;
  connection_generation: number;
  terminal_id: string;
  label: string;
}> = [];
const creation = Promise.withResolvers<unknown>();
const gitPull = Promise.withResolvers<unknown>();
const lifecycleOpen = Promise.withResolvers<unknown>();
const resourceFocus = Promise.withResolvers<boolean>();
let rejectResourceFocus = true;
let observedPendingWorkspace = false;
let watchAdmissionOld = false;
let downloadPublications = 0;
let syntheticFileDeleted = false;
const retiredMutation = Promise.withResolvers<Response>();
let mutationRequests = 0;
let uploadRequests = 0;
const downloadRequests: string[] = [];
const operation =
  new URLSearchParams(location.search).get("operation") ?? "filters";
const requestedView =
  new URLSearchParams(location.search).get("view") ?? "board";
const coldMaster = operation === "cold-master";
const coldHost =
  operation === "cold-host" ||
  coldMaster ||
  operation === "cold-master-connect" ||
  operation === "navigator" ||
  operation === "spaces-navigator" ||
  operation === "bare-navigator" ||
  operation === "room";
const dispatches: Array<{
  connectionId: string;
  generation: number | null;
  method: string;
  params: Record<string, unknown>;
}> = [];
const workspace: Workspace = {
  workspace_id: "shared",
  number: 1,
  label: "Synthetic Studio",
  focused: operation === "focus-tab",
  pane_count: operation === "spaces-navigator" ? 2 : 1,
  tab_count: operation === "spaces-navigator" ? 2 : 1,
  agent_status: "idle",
};
const coldObservation = Promise.withResolvers<unknown>();
let resourceWorkspaceOpen = false;
let resourceValidationFailure = false;
const separateResourceWorkspace =
  operation.startsWith("worktree-resource-closed") ||
  operation === "worktree-resource-validation-failure" ||
  operation === "worktree-resource-cold";
const resourceWorkspace: Workspace = {
  ...workspace,
  workspace_id: "opened-checkout",
  focused: false,
  pane_count: 0,
  tab_count: 0,
  worktree: {
    repo_key: "/synthetic/repo/.git",
    repo_name: "Synthetic repo",
    repo_root: "/synthetic/repo",
    checkout_path: "/synthetic/feature",
    is_linked_worktree: true,
  },
};
const pane: Pane = {
  pane_id: "shared",
  terminal_id: "shared",
  workspace_id: "shared",
  tab_id: "shared",
  focused: false,
  ...(operation === "bare-navigator" ? {} : { agent: "codex" }),
  // Needs you lists blocked agents: every host's agent is blocked there.
  agent_status: operation === "needs-you" ? "blocked" : "idle",
  revision: 1,
};
const tab: Tab = {
  tab_id: "shared",
  workspace_id: "shared",
  number: 1,
  label: "Synthetic tab",
  focused: operation === "focus-tab",
  pane_count: 1,
  agent_status: "idle",
};
const fixturePanes =
  operation === "spaces-navigator"
    ? [
        pane,
        { ...pane, pane_id: "second", terminal_id: "second", tab_id: "second" },
      ]
    : [pane];
const fixtureTabs =
  operation === "spaces-navigator"
    ? [
        tab,
        { ...tab, tab_id: "second", number: 2, label: "Second synthetic tab" },
      ]
    : [tab];
const files = Promise.withResolvers<unknown>();
let filesPending = false;
const layout = {
  workspace_id: "shared",
  tab_id: "shared",
  zoomed: false,
  area: { x: 0, y: 0, width: 80, height: 24 },
  focused_pane_id: "shared",
  panes: [
    {
      pane_id: "shared",
      focused: true,
      rect: { x: 0, y: 0, width: 80, height: 24 },
    },
  ],
  splits: [],
};
const session = () => ({
  ...emptyServerSessionState(7),
  navigationMode: coldHost ? ("browser-local" as const) : ("shared" as const),
  workspaces: [workspace],
  tabs: fixtureTabs,
  panes: fixturePanes,
  selectedPaneId: "shared",
  layout,
});
let catalogue =
  operation === "spaces-notifications"
    ? ["alpha", "beta", "gamma", "offline"]
    : ["alpha", "beta", "offline"];
let heldNotificationGet: {
  host: string;
  started(): void;
  wait: Promise<void>;
} | null = null;
let offline = false;
let dense = false;
const densePanes: Pane[] = Array.from({ length: 40 }, (_, index) => ({
  ...pane,
  pane_id: index === 0 ? "shared" : `shared-${index}`,
  terminal_id: index === 0 ? "shared" : `shared-${index}`,
  display_agent:
    index === 19 ? "Needle beyond bounds" : "Repeated synthetic agent",
}));
let revision = 0;
const statusCounts = {
  working: 0,
  idle: fixturePanes.filter((value) => value.agent_status === "idle").length,
  blocked: fixturePanes.filter((value) => value.agent_status === "blocked")
    .length,
  done: 0,
  unknown: 0,
};
const coverage = {
  workspaces: 1,
  tabs: fixtureTabs.length,
  panes: fixturePanes.length,
  agent_panes: fixturePanes.filter((value) => value.agent).length,
  status: statusCounts,
  by_workspace: [
    {
      workspace_id: "shared",
      tabs: fixtureTabs.length,
      panes: fixturePanes.length,
      agent_panes: fixturePanes.filter((value) => value.agent).length,
      status: statusCounts,
    },
  ],
};
function snapshot() {
  return {
    revision: ++revision,
    observed_at: Date.now(),
    connections: catalogue.map((id) => ({
      connection_id: id,
      label: `Synthetic ${id}`,
      source: "saved-profile",
      is_default: id === "alpha",
      state: id === "offline" || offline ? "disconnected" : "ready",
      generation: 7,
      snapshot_generation: id === "offline" ? null : 7,
      stale: offline && id !== "offline",
      actionable: !offline && id !== "offline",
      snapshot:
        id === "offline"
          ? null
          : {
              workspaces: [
                workspace,
                ...(id === "beta" && resourceWorkspaceOpen
                  ? [resourceWorkspace]
                  : []),
              ],
              tabs: fixtureTabs,
              panes: dense && id === "beta" ? densePanes : fixturePanes,
              // Beta's agent is the Town master, by its Herdr name.
              agents:
                coldMaster && id === "beta"
                  ? [
                      {
                        pane_id: "shared",
                        terminal_id: "shared",
                        agent: "codex",
                        name: "betamaster",
                      },
                    ]
                  : [],
              ...(operation === "watch-unavailable"
                ? {
                    watch_admission: {
                      revision: watches.length - (watchAdmissionOld ? 1 : 0),
                      registered: 1,
                      missing: 0,
                      unresolved: 0,
                      matched: 1,
                      admitted: 1,
                      admission_failed: 0,
                    },
                  }
                : {}),
              coverage:
                dense && id === "beta"
                  ? {
                      ...coverage,
                      panes: densePanes.length,
                      agent_panes: densePanes.length,
                      status: { ...statusCounts, idle: densePanes.length },
                      by_workspace: [
                        {
                          ...coverage.by_workspace[0],
                          panes: densePanes.length,
                          agent_panes: densePanes.length,
                          status: { ...statusCounts, idle: densePanes.length },
                        },
                      ],
                    }
                  : coverage,
            },
    })),
  };
}
/** Advance test time until the condition holds, for at most `timeoutMs`. */
async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 3000,
) {
  try {
    await clock.until(condition, message, timeoutMs);
  } catch {
    throw new Error(
      `${message}; notice=${JSON.stringify(store.get().notice)}; error=${store.get().error}; recentDispatches=${JSON.stringify(dispatches.slice(-3))}; ${document.body.textContent?.slice(-500)}`,
    );
  }
}
/** Two frames of test time. */
const frame = () => clock.frame();
function anchors() {
  return new Set(
    [...document.querySelectorAll<HTMLElement>("[data-world-node-anchor]")].map(
      (element) => element.dataset.worldNodeAnchor,
    ),
  );
}
function visibleHost(id: string) {
  return requestedView === "board"
    ? anchors().has(worldObjectId(id, "host", id))
    : [
        ...document.querySelectorAll<HTMLElement>(
          "[data-world-navigator-host]",
        ),
      ].some((element) => element.dataset.worldNavigatorHost === id);
}
function namedButton(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() ===
      name,
  );
}
async function retainedWindowCount() {
  if (document.documentElement.dataset.layout !== "mobile")
    return Number(
      document.querySelector(".world-window-switcher-trigger span")
        ?.textContent ?? 0,
    );
  namedButton("Show tabs")!.click();
  await frame();
  const count = Number(
    document.querySelector<HTMLElement>(".mobile-tab-sheet")?.dataset
      .windowCount ?? 0,
  );
  namedButton("Close tab switcher")!.click();
  await frame();
  return count;
}
function hostCheckbox(id: string) {
  return [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) =>
    (
      input.getAttribute("aria-label") ??
      input.closest("label")?.textContent ??
      ""
    ).includes(`Synthetic ${id}`),
  );
}
async function shellCommands() {
  const trigger = document.querySelector<HTMLButtonElement>(
    ".topbar-actions .command-trigger",
  );
  if (!trigger) throw new Error("The common shell has no Actions entry point");
  if (trigger.getAttribute("aria-expanded") !== "true") {
    trigger.focus();
    trigger.click();
  }
  await waitFor(
    () => !!document.querySelector(".command-popover"),
    "Actions did not open",
  );
  await frame();
}
function command(key: string) {
  return [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
    (item) => item.dataset.value?.includes(key),
  );
}
async function invokeCommand(key: string) {
  await shellCommands();
  const item = command(key);
  if (!item) throw new Error(`Missing qualified command ${key}`);
  if (
    item.getAttribute("aria-disabled") === "true" ||
    item.dataset.disabled === "true"
  )
    throw new Error(
      `Command ${key} rejected its admitted destination: ${item.textContent}`,
    );
  item.click();
  await frame();
}
function leaf(id: string) {
  if (requestedView !== "board")
    return document.querySelector<HTMLElement>(
      `[data-world-navigator-host="${id}"] .agent-row[data-pane-id="shared"]`,
    );
  return [
    ...document.querySelectorAll<HTMLElement>("[data-world-node-anchor]"),
  ].find(
    (element) =>
      element.dataset.worldNodeAnchor ===
      worldObjectId(id, "terminal", "shared"),
  );
}
function inspectorForHost(element: Element | null, id: string) {
  const value =
    element?.closest<HTMLElement>("[data-window-id]")?.dataset.windowId;
  if (!value) return false;
  const identity = JSON.parse(value) as unknown[];
  return identity[0] === id && identity[1] === 7;
}
async function float(id: string) {
  const target = leaf(id);
  if (!target) throw new Error(`Missing admitted ${id} target`);
  if (requestedView === "board")
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  else {
    target.click();
  }
  await waitFor(
    () =>
      !![
        ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
      ].find((window) => inspectorForHost(window, id)),
    `The ${id} Inspector did not open`,
  );
  await frame();
}
async function operationalScenario(unmount: () => void) {
  if (operation.startsWith("pending-inspector-")) {
    const client = bridge.connection("alpha", 7);
    const request = {
      connectionId: "alpha",
      generation: client.generation,
      workspaceId: "unobserved",
      view: "files" as const,
    };
    const admission = Promise.withResolvers<boolean>();
    const pending =
      operation === "pending-inspector-timeout"
        ? requestWorkspaceInspector(request)
        : admission.promise;
    if (operation !== "pending-inspector-timeout") {
      window.dispatchEvent(
        new CustomEvent<WorkspaceInspectorRequest>(
          WORKSPACE_INSPECTOR_REQUEST_EVENT,
          {
            cancelable: true,
            detail: { ...request, onAdmission: admission.resolve },
          },
        ),
      );
    }
    await frame();
    const observeWorkspace = () =>
      flushSync(() => {
        observedPendingWorkspace = true;
        const state = store.get();
        const workspaces = [
          ...state.workspaces,
          { ...workspace, workspace_id: "unobserved", focused: false },
        ];
        __storeTesting.replaceState({
          ...state,
          workspaces,
          sessionsByConnectionId: {
            ...state.sessionsByConnectionId,
            alpha: { ...state.sessionsByConnectionId.alpha!, workspaces },
          },
        });
      });
    if (operation === "pending-inspector-unmount") unmount();
    else if (operation === "pending-inspector-scope")
      flushSync(() => {
        const state = store.get();
        __storeTesting.replaceState({
          ...state,
          activeConnectionId: "beta",
          connectionGeneration: state.connectionGeneration + 1,
        });
      });
    else if (operation === "pending-inspector-delayed") observeWorkspace();
    // Test time passes until the admission settles, or the limit does.
    let settled: boolean | null = null;
    void pending.then((value) => {
      settled = value;
    });
    await clock
      .until(
        () => settled !== null,
        "admission still pending",
        operation === "pending-inspector-timeout"
          ? WORKSPACE_INSPECTOR_ADMISSION_TIMEOUT_MS + 2000
          : 1000,
      )
      .catch(() => {});
    const result: boolean | "pending" =
      (settled as boolean | null) ?? "pending";
    check(
      result === (operation === "pending-inspector-delayed"),
      "pending Inspector admission did not settle with its expected outcome",
    );
    if (operation === "pending-inspector-delayed") {
      await waitFor(
        () =>
          dispatches.some(
            (call) =>
              call.method === "file.list" &&
              call.params.workspace_id === "unobserved",
          ),
        "observed pending workspace did not open Files",
      );
    } else {
      if (operation === "pending-inspector-timeout") observeWorkspace();
      await frame();
      check(
        !dispatches.some(
          (call) =>
            call.method === "file.list" &&
            call.params.workspace_id === "unobserved",
        ),
        "discarded pending Inspector opened a resource later",
      );
    }
    return;
  }
  if (operation === "spaces-navigator" || operation === "bare-navigator") {
    if (window.innerWidth <= 720) {
      namedButton("Show workspaces")!.click();
      await frame();
    }
    if (operation === "bare-navigator") {
      await waitFor(
        () =>
          !!document.querySelector(
            '[data-world-navigator-host="beta"] .tree-row[role="treeitem"]',
          ),
        "The shell-only host's workspace did not become available",
      );
      const host = document.querySelector<HTMLElement>(
        '[data-world-navigator-host="beta"]',
      )!;
      const toggle = host.querySelector<HTMLButtonElement>(
        ".workspace-group-toggle",
      );
      if (!toggle)
        throw new Error(
          "A workspace with bare terminals has no expansion control",
        );
      check(!!leaf("beta"), "Expanded workspace omitted its bare terminal");
      toggle.click();
      await frame();
      check(!leaf("beta"), "Collapsing a workspace retained its terminal rows");
      toggle.click();
      await frame();
      check(
        !!leaf("beta"),
        "Expanding a workspace did not restore its terminal rows",
      );
      leaf("beta")!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true }),
      );
      await frame();
      check(
        !document.body.textContent?.includes("View agent history") &&
          !document.body.textContent?.includes("Export session"),
        "A bare terminal advertised agent session actions",
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await frame();
      leaf("beta")!.click();
      await waitFor(
        () => calls.includes("attached:beta"),
        "The bare terminal did not attach to its owning host",
      );
      check(
        store.get().activeConnectionId === "alpha",
        "Visual navigation changed the Spaces owner",
      );
      return;
    }
    const hostOrder = () =>
      [...document.querySelectorAll<HTMLElement>("[data-world-navigator-host]")]
        .map((element) => element.dataset.worldNavigatorHost)
        .join(",");
    const initialHostOrder = hostOrder();
    const paneOrder = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-world-navigator-host="beta"] .agent-row',
        ),
      ]
        .map((element) => element.dataset.paneId)
        .join(",");
    const initialPaneOrder = paneOrder();
    for (const id of ["beta", "alpha", "alpha", "beta"]) {
      if (
        window.innerWidth <= 720 &&
        !document.querySelector(".body.mobile-view-workspaces")
      ) {
        namedButton("Show workspaces")!.click();
        await frame();
      }
      leaf(id)!.click();
      await waitFor(
        () =>
          store.get().activeConnectionId === id &&
          calls.includes(`attached:${id}`) &&
          [
            ...document.querySelectorAll<HTMLElement>(
              ".main [data-terminal-owner]",
            ),
          ].some(
            (element) =>
              element.dataset.terminalOwner === id &&
              element.getBoundingClientRect().width > 0,
          ),
        `Spaces did not display the selected ${id} host's terminal`,
      );
      await frame();
      check(
        hostOrder() === initialHostOrder,
        "Spaces moved the selected host to the top of the navigator",
      );
      check(
        !document.querySelector(".body.mobile-view-workspaces"),
        "Spaces selection left its terminal behind the mobile navigator",
      );
      check(
        !document.querySelector(".world-floating-terminal"),
        "Spaces selection opened a visual Inspector instead of its terminal surface",
      );
    }
    check(
      store.get().sessionsByConnectionId.alpha?.workspaces.length === 1,
      "Switching hosts discarded the previous host's session",
    );
    if (window.innerWidth <= 720) {
      namedButton("Show workspaces")!.click();
      await frame();
    }
    document
      .querySelector<HTMLElement>(
        '[data-world-navigator-host="beta"] .tree-row[role="treeitem"]',
      )!
      .click();
    await waitFor(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.workspace-inspector[data-view="files"]',
          ),
        ].some((element) => element.getBoundingClientRect().width > 0) &&
        calls.includes("resource:beta"),
      "Spaces workspace selection did not open Files",
    );
    if (window.innerWidth <= 720) {
      namedButton("Show workspaces")!.click();
      await frame();
    }
    document
      .querySelector<HTMLElement>(
        '[data-world-navigator-host="beta"] [data-pane-id="second"]',
      )!
      .click();
    await waitFor(
      () =>
        ![
          ...document.querySelectorAll<HTMLElement>(
            '.workspace-inspector[data-view="files"]',
          ),
        ].some((element) => element.getBoundingClientRect().width > 0) &&
        !!document.querySelector('.main [data-terminal-owner="beta"]') &&
        store.get().selectedPaneId === "second" &&
        store.get().browserNavigation.tabIds.shared === "second",
      "Spaces terminal selection did not close Files and restore the clicked tab and pane",
    );
    check(
      paneOrder() === initialPaneOrder,
      "Spaces moved the focused tab to the top of its workspace list",
    );
    return;
  }
  if (operation === "room") {
    if (window.innerWidth <= 720) {
      namedButton("Show workspaces")!.click();
      await frame();
      document
        .querySelector<HTMLElement>(
          '[data-world-navigator-host="alpha"] .tree-row[role="treeitem"]',
        )!
        .click();
      await waitFor(
        () => !!document.querySelector(".body.mobile-view-session"),
        "The initial host's terminal did not enter the mobile session view",
      );
    }
    const spaceId = worldObjectId("beta", "space", "shared");
    const room = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          requestedView === "town"
            ? '.world-semantic-target[data-kind="room"]'
            : "[data-world-node-anchor]",
        ),
      ].find(
        (element) =>
          (element.dataset.targetKey ?? element.dataset.worldNodeAnchor) ===
          spaceId,
      );
    const filesVisible = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.workspace-inspector[data-view="files"]',
        ),
      ].some(
        (inspector) =>
          inspectorForHost(inspector, "beta") &&
          !!inspector.getBoundingClientRect().width,
      );
    await waitFor(
      () => !!room() && !room()!.disabled && !room()!.closest("[inert]"),
      "The workspace did not become interactive",
    );
    room()!.click();
    await waitFor(
      () => filesVisible() && calls.includes("resource:beta"),
      "The workspace did not open its owning host's Files Inspector",
    );
    check(
      !calls.includes("attached:beta"),
      "Clicking a workspace unexpectedly attached its first terminal",
    );
    leaf("beta")!.click();
    await waitFor(
      () => calls.includes("attached:beta"),
      "Clicking the workspace's agent did not open its terminal",
    );
    await frame();
    await waitFor(
      () => !!room() && !room()!.disabled && !room()!.closest("[inert]"),
      "The workspace controls did not finish rendering after terminal selection",
    );
    room()!.click();
    await waitFor(
      filesVisible,
      "Returning to the workspace did not restore its Files Inspector",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "The Office room changed the Spaces owner",
    );
    return;
  }
  if (operation === "cold-master-connect") {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let binds = 0;
    flushSync(() => {
      __storeTesting.replaceState({ ...store.get(), status: "disconnected" });
      root.render(
        <WorldInspectorConversationView
          conversation={{
            nodeId: worldObjectId("beta", "terminal", "shared"),
            connectionId: "beta",
            runtimeGeneration: 7,
            resourceIdentity: "shared",
            workspaceId: "shared",
            tabId: "shared",
            paneId: "shared",
            label: "Synthetic master",
            hostLabel: "Synthetic beta",
            spaceLabel: "Synthetic Studio",
            context: {
              kind: "agent",
              label: "Synthetic master",
              agent: "codex",
              stateLabel: "Idle",
              locationLabel: "Synthetic Studio · Synthetic beta",
            },
            availableViews: ["history", "terminal"],
            view: "history",
            dock: "right",
            expanded: false,
            size: 420,
          }}
          target={target}
          floating
          terminalActive={false}
          onChange={() => {}}
          onClose={() => {}}
          onResourceFocus={() => {}}
          onTerminalPortalChange={() => {}}
          onBind={() => {
            binds++;
            void store.loadConnectionSession("beta");
          }}
        />,
      );
    });
    try {
      await waitFor(
        () => !!target.querySelector(".world-inspector-loading"),
        "The restored master's window did not mount before connecting",
      );
      check(
        binds === 0,
        "The disconnected window requested its host too early",
      );
      flushSync(() =>
        __storeTesting.replaceState({ ...store.get(), status: "connected" }),
      );
      await waitFor(
        () => !!target.querySelector(".workspace-inspector-head"),
        "The docked master's window stayed empty after connecting",
      );
      check(
        binds === 1,
        "Connecting must bind the restored window exactly once",
      );
      check(
        store.get().activeConnectionId === "alpha",
        "Binding the restored window changed the Spaces owner",
      );
    } finally {
      flushSync(() => root.unmount());
      target.remove();
    }
    return;
  }
  if (coldMaster) {
    // On load, Town docks its master's window without focusing it. That
    // host's session has not loaded yet; the window must fill in by itself,
    // never stay an empty frame until the agent is clicked.
    await waitFor(
      () =>
        !![
          ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
        ].find((window) => window.querySelector(".workspace-inspector-head")),
      `The docked master's window stayed empty: ${
        document.querySelector(".world-floating-terminal")?.textContent ??
        "no window"
      }`,
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Filling in the docked master's window changed the Spaces owner",
    );
    return;
  }
  if (operation === "cold-host") {
    check(
      store.get().sessionsByConnectionId.beta?.workspaces.length === 0,
      "The inactive host must start without a focused session cache",
    );
    await float("beta");
    await waitFor(
      () => calls.includes("attached:beta"),
      "Opening an unvisited host did not attach its terminal",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Opening an unvisited host changed the Spaces owner",
    );
    return;
  }
  if (operation === "navigator") {
    const host = document.querySelector<HTMLElement>(
      '[data-world-navigator-host="beta"]',
    )!;
    check(
      !!host.querySelector('.workspace-tree-panel .tree-row[role="treeitem"]'),
      "The host level must preserve the existing workspace tree",
    );
    check(
      !!host.querySelector(".workspace-agent-layout-control"),
      "The host tree lost the existing agent layout controls",
    );
    const row = host.querySelector<HTMLElement>('.tree-row[role="treeitem"]');
    if (row) {
      if (window.innerWidth <= 720) {
        namedButton("Show workspaces")!.click();
        await frame();
      }
      row.click();
      await waitFor(
        () =>
          calls.includes("resource:beta") &&
          !!document.querySelector('.workspace-inspector[data-view="files"]'),
        "Selecting an unvisited host's workspace did not open Files",
      );
      await frame();
      check(
        !document.querySelector(".body.mobile-view-workspaces"),
        "Selecting a workspace left its admitted terminal behind the mobile navigator",
      );
      // The existing compact layout hides a strip with only one tab.
      if (window.innerWidth > 720) {
        const tab = document.querySelector<HTMLElement>(".main .tabbar-tab");
        check(
          !!tab,
          "The selected host's admitted tabs are missing from the visible tab strip",
        );
        if (tab) {
          const beforeTab = dispatches.length;
          tab.click();
          await frame();
          const tabFocus = dispatches
            .slice(beforeTab)
            .filter((call) => call.method === "pane.get");
          check(
            tabFocus.length > 0 &&
              tabFocus.every(
                (call) => call.connectionId === "beta" && call.generation === 7,
              ),
            "The visible tab strip opened the original Spaces host instead of its Inspector's host",
          );
        }
      } else {
        namedButton("Show tabs")!.click();
        await frame();
        const tab = document.querySelector<HTMLElement>(
          ".mobile-tab-sheet .mobile-tab-sheet-focus",
        );
        check(!!tab, "The mobile tab sheet omitted the selected host's tabs");
        if (tab) {
          const beforeTab = dispatches.length;
          tab.click();
          await frame();
          const tabFocus = dispatches
            .slice(beforeTab)
            .filter((call) => call.method === "pane.get");
          check(
            tabFocus.length > 0 &&
              tabFocus.every(
                (call) => call.connectionId === "beta" && call.generation === 7,
              ),
            "The mobile tab sheet opened the original Spaces host instead of its Inspector's host",
          );
        }
      }
    }
    namedButton("Hosts")!.click();
    await frame();
    const menu = document.querySelector<HTMLElement>(".world-hosts-menu")!;
    const box = menu.getBoundingClientRect();
    check(
      menu.contains(document.elementFromPoint(box.left + 12, box.top + 12)),
      "The host menu is clipped or covered by the top bar",
    );
    namedButton("Manage connections")!.click();
    await waitFor(
      () => !!document.querySelector(".connection-manager-modal"),
      "The host menu did not expose connection management",
    );
    return;
  }
  if (
    operation === "file-delete-retirement" ||
    operation === "file-upload-retirement"
  ) {
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-files");
    await waitFor(
      () => !!document.querySelector('button[aria-label="File actions"]'),
      "retiring mutation file actions",
    );
    if (operation === "file-delete-retirement") {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="File actions"]')!
        .click();
      await waitFor(() => !!namedButton("Delete file"), "retiring delete menu");
      namedButton("Delete file")!.click();
      await waitFor(
        () => !!namedButton("Delete"),
        "retiring delete confirmation",
      );
      namedButton("Delete")!.click();
    } else {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["synthetic"], "synthetic.txt"));
      document.querySelector(".file-tree")!.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }
    await frame();
    check(
      mutationRequests === 1,
      "retiring mutation was not submitted exactly once",
    );
    flushSync(() => {
      const state = store.get();
      __storeTesting.replaceState({
        ...state,
        connections: state.connections.map((connection) =>
          connection.id === "beta"
            ? { ...connection, generation: 8 }
            : connection,
        ),
      });
    });
    await frame();
    const readsBefore = dispatches.filter(
      (call) => call.method === "file.list",
    ).length;
    retiredMutation.resolve(
      Response.json(
        { error: "The owning runtime retired" },
        {
          status: 409,
          headers: {
            "X-Herdr-Connection-Id": "beta",
            "X-Herdr-Connection-Generation": "7",
            "X-Herdr-Request-Outcome": "uncertain",
          },
        },
      ),
    );
    await waitFor(
      () =>
        store.get().notice?.message ===
        (operation === "file-delete-retirement"
          ? "Delete outcome is uncertain"
          : "Upload outcome is uncertain"),
      "retired mutation lost its uncertainty notice",
    );
    check(
      store
        .get()
        .notice?.detail?.includes(
          "A file change on Synthetic beta may have completed",
        ) === true,
      "retired mutation notice lost the owning host",
    );
    await frame();
    check(
      mutationRequests === 1 &&
        dispatches.filter((call) => call.method === "file.list").length ===
          readsBefore,
      "retired mutation replayed or refreshed a replacement context",
    );
    return;
  }
  if (operation === "file-mutation-interruption") {
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-files");
    await waitFor(
      () => !!document.querySelector('button[aria-label="File actions"]'),
      "file mutation actions",
    );
    const listsBefore = dispatches.filter(
      (call) => call.connectionId === "beta" && call.method === "file.list",
    ).length;
    document
      .querySelector<HTMLButtonElement>('button[aria-label="File actions"]')!
      .click();
    await waitFor(() => !!namedButton("Delete file"), "delete file menu");
    namedButton("Delete file")!.click();
    await waitFor(() => !!namedButton("Delete"), "delete confirmation");
    namedButton("Delete")!.click();
    await waitFor(
      () => store.get().notice?.message === "Delete outcome is uncertain",
      "interrupted deletion reports uncertainty",
    );
    check(
      dispatches.filter(
        (call) => call.connectionId === "beta" && call.method === "file.list",
      ).length > listsBefore,
      "interrupted deletion did not refresh owning directory",
    );
    await waitFor(
      () => !document.querySelector('button[aria-label="File actions"]'),
      "interrupted deletion clears the stale cached entry",
    );
    check(mutationRequests === 1, "interrupted deletion was replayed");
    const listsBeforeUpload = dispatches.filter(
      (call) => call.connectionId === "beta" && call.method === "file.list",
    ).length;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["definite"], "rejected.txt"));
    transfer.items.add(new File(["uncertain"], "synthetic.txt"));
    document.querySelector(".file-tree")!.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    await waitFor(
      () => store.get().notice?.message === "Upload outcome is uncertain",
      "mixed upload results preserve uncertainty",
    );
    check(
      dispatches.filter(
        (call) => call.connectionId === "beta" && call.method === "file.list",
      ).length > listsBeforeUpload,
      "mixed upload results skipped owning directory refresh",
    );
    await waitFor(
      () => !!document.querySelector('button[aria-label="File actions"]'),
      "interrupted upload refresh reveals the completed file",
    );
    check(uploadRequests === 2, "mixed upload results replayed a mutation");
    return;
  }
  if (operation === "file-download-error") {
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-files");
    await waitFor(
      () => !!document.querySelector('button[aria-label="File actions"]'),
      "The admitted file has no download actions",
    );
    document
      .querySelector<HTMLButtonElement>('button[aria-label="File actions"]')!
      .click();
    await waitFor(
      () => !!namedButton("Download file"),
      "File download menu did not open",
    );
    namedButton("Download file")!.click();
    await waitFor(
      () => store.get().notice?.message === "Download failed",
      "A failed native-share file download has no visible error notice",
    );
    check(
      store.get().notice?.detail?.includes("404") === true,
      "Download failure lost its HTTP status",
    );
    check(
      downloadRequests.length === 1 &&
        new URL(downloadRequests[0]!).pathname.includes("/beta/file/download"),
      "The failed download lost its captured host or was retried",
    );
    check(
      downloadPublications === 0,
      "A failed admitted download reopened or published its resource",
    );
    return;
  }
  if (operation === "focus-tab") {
    const selectView = async (next: string) => {
      const view = document.querySelector<HTMLSelectElement>(
        'select[aria-label="World view"]',
      )!;
      view.value = next;
      view.dispatchEvent(new Event("change", { bubbles: true }));
      await frame();
    };
    await selectView("spaces");
    await invokeCommand("arrangement-close-all");
    await selectView(requestedView);
    await float("beta");
    await shellCommands();
    await waitFor(
      () => !!command("focus-tab-shared"),
      "Captured beta tab commands did not load",
    );
    const before = dispatches.length;
    await invokeCommand("focus-tab-shared");
    const focused = dispatches
      .slice(before)
      .filter((call) => /^(workspace|tab)\.focus$/.test(call.method));
    check(
      focused.length === 2 &&
        focused.every(
          (call) => call.connectionId === "beta" && call.generation === 7,
        ),
      `Visual Focus tab must use captured beta rather than hidden alpha: ${JSON.stringify(focused)}`,
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Visual Focus tab changed the Spaces owner",
    );
    check(
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="World view"]',
      )?.value === requestedView,
      "Visual Focus tab navigated into hidden Spaces",
    );
    await selectView("spaces");
    await shellCommands();
    check(
      command("arrangement-close-all")?.getAttribute("aria-disabled") ===
        "true",
      "Visual Focus tab resumed the hidden Spaces arrangement",
    );
    await invokeCommand("focus-tab-shared");
    await shellCommands();
    check(
      command("arrangement-close-all")?.getAttribute("aria-disabled") !==
        "true",
      "An explicit Spaces tab command failed to resume its own arrangement",
    );
    return;
  }
  if (operation === "nonempty-filter") {
    namedButton("Hosts")!.click();
    await frame();
    for (const id of ["alpha", "beta", "offline"]) {
      const checkbox = hostCheckbox(id)!;
      if (checkbox.checked) {
        checkbox.click();
        await frame();
      }
    }
    check(
      anchors().size > 0,
      "Hosts permits an empty explicit filter, contrary to the nonempty selection contract",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Host filter changes operational ownership",
    );
    return;
  }
  if (operation === "watch-unavailable") {
    await shellCommands();
    await waitFor(
      () =>
        document.body.textContent?.includes(
          "2 pinned in filter · 2 admitted",
        ) === true,
      "An unavailable host masked healthy-host watch counts",
    );
    check(
      document.body.textContent?.includes("1 host unavailable") === true,
      "Watch counts omitted the unavailable host explanation",
    );
    watchAdmissionOld = true;
    const observedRevision = worldRuntimeStore.get().revision;
    await worldRuntimeStore.refresh();
    await waitFor(
      () =>
        worldRuntimeStore.get().revision > observedRevision &&
        worldRuntimeStore
          .get()
          .connections.some(
            (connection) =>
              connection.snapshot?.watchAdmission?.revision ===
              watches.length - 1,
          ),
      "The queued refresh did not observe the older watch admission revision",
      10_000,
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await frame();
    await shellCommands();
    await waitFor(
      () =>
        document.body.textContent?.includes(
          "Watch availability pending for filtered hosts",
        ) === true,
      "An observed host with an older watch revision stopped reporting pending",
    );
    writeHostsFilter(["offline"]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await frame();
    await shellCommands();
    await waitFor(
      () =>
        document.body.textContent?.includes(
          "0 pinned in filter · 0 admitted",
        ) === true,
      "An unavailable-only filter remained pending instead of showing its empty observed coverage",
    );
    return;
  }
  if (operation === "watches") {
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-pin");
    await waitFor(
      () => globals.some((call) => call.method === "world.watchlist.pin"),
      "The sibling host watch was not registered",
    );
    const pins = globals.filter(
      (call) => call.method === "world.watchlist.pin",
    );
    check(
      pins.length === 1 &&
        pins[0]!.params.connection_id === "beta" &&
        pins[0]!.params.connection_generation === 7 &&
        pins[0]!.params.terminal_id === "shared",
      "A watch with colliding native terminal IDs lost its owner",
    );
    writeHostsFilter(["alpha"]);
    await frame();
    check(
      watches.some((watch) => watch.connection_id === "beta"),
      "Filtering removed a sibling host watch",
    );
    check(
      !globals.some((call) => call.method === "world.watchlist.unpin"),
      "Filtering dispatched an operational watch mutation",
    );
    return;
  }
  if (operation === "spaces") {
    await float("alpha");
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-spaces");
    await waitFor(
      () =>
        document.querySelector<HTMLSelectElement>(
          'select[aria-label="World view"]',
        )?.value === "spaces",
      "Go to Spaces did not navigate the admitted sibling host",
    );
    check(
      store.get().activeConnectionId === "beta",
      "Spaces did not select the exact qualified beta workspace",
    );
    const view = document.querySelector<HTMLSelectElement>(
      'select[aria-label="World view"]',
    )!;
    view.value = requestedView;
    view.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
    check(
      (await retainedWindowCount()) === 2,
      "Entering beta Spaces retired an Inspector context",
    );
    leaf("alpha")!.click();
    await waitFor(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
        ].some((element) => inspectorForHost(element, "alpha")),
      "Returning from Spaces lost the retained alpha Inspector",
    );
    return;
  }
  if (operation === "hidden-selection") {
    leaf("alpha")!.click();
    await frame();
    await shellCommands();
    check(
      !!command("visual-files"),
      "Admitted alpha selection did not capture Visual Actions",
    );
    const before = dispatches.length;
    writeHostsFilter(["beta"]);
    await frame();
    check(
      !document.querySelector(".command-popover"),
      "Filtering did not clear the open visual Actions capture",
    );
    check(
      [
        ...document.querySelectorAll<HTMLElement>(".workspace-inspector-head"),
      ].some((header) => inspectorForHost(header, "alpha")),
      "Filtering retired the selected Inspector rather than its visual menu capture",
    );
    check(
      !dispatches
        .slice(before)
        .some((call) => /^(workspace|tab|pane)\.focus$/.test(call.method)),
      "Filter clearing retargeted focus into hidden Spaces",
    );
    await shellCommands();
    check(
      !command("visual-files"),
      "Filtered-out selection still grants Visual Actions",
    );
    return;
  }
  if (operation === "context-menu-pull-failure") {
    const element = document.createElement("div");
    document.body.append(element);
    const menu = createRoot(element);
    try {
      flushSync(() =>
        menu.render(
          <OperationalContext.Provider
            value={{ connectionId: "beta", runtimeGeneration: 7 }}
          >
            <ContextMenu
              state={{ x: 20, y: 60, workspace }}
              pinnedWorkspaceKeys={new Set()}
              onPinnedChange={() => {}}
              onClose={() => {}}
            />
          </OperationalContext.Provider>,
        ),
      );
      await waitFor(
        () => !!namedButton("Pull from Git"),
        "context menu pull action",
      );
      namedButton("Pull from Git")!.click();
      await waitFor(
        () => document.body.textContent?.includes("Running git pull") === true,
        "visible pull progress",
      );
      check(
        dispatches
          .filter((call) => call.method === "git.pull")
          .every(
            (call) => call.connectionId === "beta" && call.generation === 7,
          ),
        "context menu pull lost owning host",
      );
      gitPull.reject(new Error("Synthetic pull conflict"));
      await waitFor(
        () =>
          document.body.textContent?.includes("Git pull failed") === true &&
          document.body.textContent.includes("Synthetic pull conflict"),
        "visible context-menu pull failure",
      );
      check(
        store.get().activeConnectionId === "alpha",
        "failed pull changed another host's focus",
      );
      check(
        store.get().sessionsByConnectionId.beta?.error ===
          "Synthetic pull conflict",
        "failed pull omitted owning-host error",
      );
    } finally {
      menu.unmount();
      element.remove();
    }
    return;
  }
  if (
    operation === "worktree-files" ||
    operation === "worktree-changes" ||
    operation === "worktree-resource-retirement" ||
    operation === "worktree-resource-disposal" ||
    operation === "worktree-resource-rejection" ||
    operation === "worktree-resource-timeout" ||
    separateResourceWorkspace
  ) {
    const element = document.createElement("div");
    document.body.append(element);
    const dialog = createRoot(element);
    let closed = false;
    try {
      flushSync(() =>
        dialog.render(
          <OperationalContext.Provider
            value={{ connectionId: "beta", runtimeGeneration: 7 }}
          >
            <WorktreeLifecycleDialog
              open
              workspaceId="shared"
              onClose={() => {
                closed = true;
              }}
            />
          </OperationalContext.Provider>,
        ),
      );
      const button = operation === "worktree-changes" ? "Changes" : "Files";
      await waitFor(() => !!namedButton(button), "lifecycle resource button");
      namedButton(button)!.click();
      if (
        operation === "worktree-resource-retirement" ||
        operation === "worktree-resource-disposal"
      ) {
        await frame();
        check(
          dispatches.some(
            (call) =>
              call.connectionId === "beta" && call.method === "worktree.open",
          ),
          "retirement resource did not submit its open",
        );
        if (operation === "worktree-resource-disposal")
          flushSync(() => dialog.render(null));
        else
          flushSync(() => {
            const state = store.get();
            __storeTesting.replaceState({
              ...state,
              connections: state.connections.map((connection) =>
                connection.id === "beta"
                  ? { ...connection, generation: 8 }
                  : connection,
              ),
            });
          });
        lifecycleOpen.resolve({ workspace: { workspace_id: "shared" } });
        await frame();
        await frame();
        check(
          dispatches.filter((call) => call.method === "worktree.open")
            .length === 1,
          "retired worktree open was replayed",
        );
        check(
          !dispatches.some(
            (call) =>
              call.connectionId === "beta" && call.method === "file.list",
          ),
          "retired worktree opened a replacement resource",
        );
        check(!closed, "retired worktree resource falsely reported success");
        return;
      }

      if (operation === "worktree-resource-cold") {
        await clock.advance(10_500);
        check(
          !closed &&
            !!document.querySelector(".lifecycle-operation.is-running"),
          "cold-host admission gave up before its observation budget",
        );
        await clock.advance(7500);
        coldObservation.resolve(snapshot());
        await waitFor(
          () =>
            dispatches.some(
              (call) =>
                call.connectionId === "beta" &&
                call.method === "file.list" &&
                call.params.workspace_id === "opened-checkout",
            ),
          "cold-host observation did not admit Files for the new checkout",
        );
        await waitFor(
          () => closed,
          "cold-host admission did not open Files within observation budget",
        );
        check(
          dispatches.filter((call) => call.method === "worktree.open")
            .length === 1,
          "cold-host admission reopened the checkout",
        );
        return;
      }
      if (
        operation === "worktree-resource-rejection" ||
        separateResourceWorkspace ||
        operation === "worktree-resource-timeout"
      ) {
        await waitFor(
          () => !!document.querySelector(".lifecycle-operation.is-failed"),
          "rejected resource admission reports lifecycle failure",
          operation === "worktree-resource-timeout"
            ? WORKSPACE_INSPECTOR_ADMISSION_TIMEOUT_MS + 2000
            : 3000,
        );
        check(
          dispatches.some(
            (call) =>
              call.connectionId === "beta" && call.method === "worktree.open",
          ),
          "resource rejection did not follow a successful worktree open",
        );
        check(
          calls.includes("focus:beta"),
          "resource rejection did not attempt qualified focus",
        );
        check(!closed, "rejected resource admission closed its dialog");
        check(
          !dispatches.some(
            (call) =>
              call.connectionId === "beta" && call.method === "file.list",
          ),
          "rejected resource admission opened Files",
        );
        check(
          store.get().activeConnectionId === "alpha",
          "rejected resource admission changed unrelated focus",
        );
        check(
          document.querySelector(".lifecycle-open-state.is-open")
            ?.textContent === "Open",
          "successful checkout opening was still shown as closed",
        );
        check(
          document
            .querySelector(".lifecycle-operation.is-failed")
            ?.textContent?.includes("checkout is open") === true,
          "resource failure did not explain successful checkout opening",
        );
        if (operation.startsWith("worktree-resource-closed")) {
          await operationalStore({
            connectionId: "beta",
            runtimeGeneration: 7,
          }).closeWorkspace("opened-checkout");
          if (operation === "worktree-resource-closed-refresh") {
            namedButton("Refresh lifecycle status")!.click();
            await waitFor(
              () =>
                document.querySelector(".lifecycle-open-state")?.textContent ===
                "Closed",
              "refreshed row retained a closed workspace target",
            );
          }
        }
        if (operation === "worktree-resource-validation-failure") {
          resourceValidationFailure = true;
          namedButton("Files")!.click();
          await waitFor(
            () =>
              document
                .querySelector(".lifecycle-operation.is-failed")
                ?.textContent?.includes(
                  "Synthetic workspace validation failed",
                ) === true,
            "cached target validation did not surface failure",
          );
          check(
            dispatches.filter((call) => call.method === "worktree.open")
              .length === 1,
            "failed target validation replayed the opened hook",
          );
          return;
        }
        rejectResourceFocus = false;
        if (operation === "worktree-resource-timeout") {
          resourceFocus.resolve(true);
          await frame();
          check(
            !dispatches.some(
              (call) =>
                call.connectionId === "beta" && call.method === "file.list",
            ),
            "timed-out visual admission opened Files after focus completed",
          );
          check(!closed, "timed-out visual admission closed the dialog late");
        }
        namedButton("Files")!.click();
        await waitFor(() => closed, "Inspector-only retry did not succeed");
        check(
          dispatches.filter((call) => call.method === "worktree.open")
            .length ===
            (operation.startsWith("worktree-resource-closed") ? 2 : 1),
          "Inspector retry did not preserve live targets or reopen a confirmed closed checkout",
        );
        return;
      }
      const method =
        operation === "worktree-files" ? "file.list" : "git.diff_summary";
      await waitFor(
        () =>
          dispatches.some(
            (call) => call.connectionId === "beta" && call.method === method,
          ),
        "worktree resource opens owning visual Inspector",
      );
      check(
        dispatches
          .filter(
            (call) => call.method === "worktree.open" || call.method === method,
          )
          .every(
            (call) => call.connectionId === "beta" && call.generation === 7,
          ),
        "lifecycle resource lost owning runtime",
      );
      check(
        store.get().activeConnectionId === "alpha",
        "lifecycle resource changed unrelated Spaces focus",
      );
      await frame();
      check(closed, "admitted lifecycle resource did not close its dialog");
    } finally {
      dialog.unmount();
      element.remove();
    }
    return;
  }
  if (operation === "worktree") {
    const element = document.createElement("div");
    document.body.append(element);
    const resources = createRoot(element);
    try {
      flushSync(() =>
        resources.render(
          <OperationalContext.Provider
            value={{ connectionId: "beta", runtimeGeneration: 7 }}
          >
            <WorktreeOpenDialog
              open
              workspaceId="shared"
              sourceWorkspaceId="shared"
              onClose={() => {}}
            />
          </OperationalContext.Provider>,
        ),
      );
      await waitFor(
        () =>
          !!element.querySelector<HTMLInputElement>(
            'input[placeholder="feature/my-branch or /repo/worktree"]',
          ) &&
          !element.querySelector<HTMLInputElement>(
            'input[placeholder="feature/my-branch or /repo/worktree"]',
          )!.disabled,
        "The scoped worktree list did not admit its source",
      );
      const input = element.querySelector<HTMLInputElement>(
        'input[placeholder="feature/my-branch or /repo/worktree"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "synthetic-feature");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await frame();
      element
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click();
      await frame();
      const mutations = dispatches.filter(
        (call) => call.method === "worktree.open",
      );
      check(
        mutations.length === 1 &&
          mutations[0]?.connectionId === "beta" &&
          mutations[0]?.generation === 7,
        `Beta-scoped worktree opening must retain beta generation 7; received ${JSON.stringify(mutations)}`,
      );
      check(
        store.get().activeConnectionId === "alpha",
        "Worktree opening changes unrelated operational focus",
      );
    } finally {
      resources.unmount();
      element.remove();
    }
    return;
  }
  if (operation === "needs-you") {
    // Needs you lists, counts and opens agents of the admitted hosts only.
    writeHostsFilter(["alpha"]);
    await frame();
    document.querySelector<HTMLButtonElement>(".needs-you-counter")!.click();
    await waitFor(
      () => document.querySelectorAll(".needs-you-item.is-needs").length === 1,
      "Needs you did not list exactly the admitted host's blocked agent",
    );
    const item = document.querySelector<HTMLElement>(".needs-you-item")!;
    check(
      item.textContent!.includes("Synthetic alpha") &&
        !document
          .querySelector(".needs-you")!
          .textContent!.includes("Synthetic beta"),
      "Needs you showed an agent of a filtered-out host",
    );
    check(
      document.querySelector(".needs-you-counter b")?.textContent === "1",
      "the Needs you counter and window disagree under the Hosts filter",
    );
    item.querySelector<HTMLButtonElement>(".needs-you-open")!.click();
    await waitFor(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
        ].some((element) => inspectorForHost(element, "alpha")),
      "Open agent in Needs you did not open the admitted host's agent",
    );
    return;
  }
  if (operation === "actions") {
    leaf("beta")!.click();
    await frame();
    await invokeCommand("visual-files");
    await waitFor(
      () =>
        dispatches.some(
          (call) => call.connectionId === "beta" && call.method === "file.list",
        ),
      "Visual Files did not use its beta owner",
    );
    check(
      !dispatches.some(
        (call) => call.connectionId === "alpha" && call.method === "file.list",
      ),
      "Visual Files used hidden Spaces ownership",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Visual Actions activated beta globally",
    );
    return;
  }
  if (operation === "hidden-spaces") {
    await shellCommands();
    check(
      !command("current-file-explorer") &&
        !command("current-diff-viewer") &&
        !command("rename-workspace") &&
        !command("focus-agent-"),
      "Hidden Spaces supplies ambient resource or mutation targets to an unselected visual Actions menu",
    );
    check(
      !!command("create-workspace"),
      "Global creation disappeared instead of requesting a destination",
    );
    return;
  }
  if (
    operation === "global-creation" ||
    operation === "global-creation-retry" ||
    operation === "global-creation-retirement"
  ) {
    await invokeCommand("create-workspace");
    await waitFor(
      () =>
        !!document.querySelector(
          '[role="dialog"][aria-label="Create workspace"]',
        ),
      "Global creation dialog did not open",
    );
    const destination = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Destination host"]',
    );
    if (!destination)
      throw new Error(
        "All-hosts global creation has no visible confirmed destination",
      );
    destination.value = "beta";
    destination.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
    const dialog = document.querySelector<HTMLFormElement>(
      '[role="dialog"][aria-label="Create workspace"]',
    )!;
    check(
      dialog.textContent?.includes("Synthetic beta") ?? false,
      "Creation does not identify its chosen host",
    );
    if (operation === "global-creation-retirement") {
      flushSync(() => {
        const before = store.get();
        __storeTesting.replaceState({
          ...before,
          connections: before.connections.map((connection) =>
            connection.id === "beta"
              ? { ...connection, generation: 8, state: "disconnected" }
              : connection,
          ),
        });
        store.clearNotice();
      });
      await frame();
      dialog.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await frame();
      check(
        !dispatches.some((call) => call.method === "workspace.create"),
        "A retired displayed creation destination fell back to another host or its replacement",
      );
      check(
        !!document.querySelector('[role="status"]') ||
          dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled === true,
        "Unavailable creation destination has no explanation",
      );
      return;
    }
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    if (operation === "global-creation")
      dialog.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    await waitFor(
      () => dispatches.some((call) => call.method === "workspace.create"),
      "Confirmed destination did not receive creation",
    );
    check(
      dispatches.filter((call) => call.method === "workspace.create").length ===
        1,
      "Repeated submission created duplicate workspaces",
    );
    check(
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled === true,
      "Workspace creation remains enabled while its request is pending",
    );
    if (operation === "global-creation-retry") {
      creation.reject(new Error("Synthetic creation failure"));
      await waitFor(
        () =>
          dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled === false &&
          store.get().notice?.message === "Workspace creation failed",
        "Failed creation did not release submission for retry",
      );
      dialog.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await waitFor(
        () =>
          dispatches.filter((call) => call.method === "workspace.create")
            .length === 2,
        "Creation could not be retried after a definite failure",
      );
    } else creation.resolve({});
    await waitFor(
      () =>
        !document.querySelector(
          '[role="dialog"][aria-label="Create workspace"]',
        ),
      "Successful creation did not close the dialog",
    );
    check(
      dispatches
        .filter((call) => call.method === "workspace.create")
        .every((call) => call.connectionId === "beta" && call.generation === 7),
      "Global creation fell back or broadcast",
    );
    return;
  }
  if (operation === "spaces-notifications") {
    check(
      store.get().activeConnectionId === "alpha",
      "Spaces notification starts on Alpha",
    );
    const before = dispatches.length;
    window.dispatchEvent(
      new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
        detail: {
          connectionId: "beta",
          runtimeGeneration: 7,
          workspaceId: "shared",
          paneId: "shared",
        },
      }),
    );
    await waitFor(
      () =>
        store.get().activeConnectionId === "beta" &&
        [
          ...document.querySelectorAll(
            '.workspace-inspector[data-view="history"]',
          ),
        ].some((element) => element.getBoundingClientRect().width > 0) &&
        dispatches
          .slice(before)
          .some(
            (call) =>
              call.connectionId === "beta" &&
              call.method === "agent_conversation.latest",
          ),
      "Spaces sibling-host notification opens Beta Chat using Beta client",
    );
    check(
      !dispatches
        .slice(before)
        .some(
          (call) =>
            call.connectionId === "alpha" &&
            call.method === "agent_conversation.latest",
        ),
      "Beta notification never opens Alpha's colliding Chat",
    );
    check(
      store
        .get()
        .sessionsByConnectionId.alpha?.panes.some(
          (pane) => pane.pane_id === "shared",
        ) === true,
      "Spaces notification retains Alpha's session",
    );
    const notifyHost = (connectionId: string) =>
      window.dispatchEvent(
        new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
          detail: {
            connectionId,
            runtimeGeneration: 7,
            workspaceId: "shared",
            paneId: "shared",
          },
        }),
      );
    notifyHost("alpha");
    await waitFor(
      () =>
        store.get().activeConnectionId === "alpha" &&
        dispatches.some(
          (call) =>
            call.connectionId === "alpha" &&
            call.method === "agent_conversation.latest",
        ),
      "race starts from Alpha Chat",
    );
    const olderStarted = Promise.withResolvers<void>();
    const olderRelease = Promise.withResolvers<void>();
    const olderFinished = Promise.withResolvers<unknown>();
    heldNotificationGet = {
      host: "beta",
      started: () => olderStarted.resolve(),
      wait: olderRelease.promise,
    };
    const focus = store.focusTaskNotificationTarget;
    store.focusTaskNotificationTarget = async (target, options) => {
      const result = await focus(target, options);
      if (target.connectionId === "beta") olderFinished.resolve(result);
      return result;
    };
    try {
      notifyHost("beta");
      await olderStarted.promise;
      notifyHost("gamma");
      await waitFor(
        () =>
          store.get().activeConnectionId === "gamma" &&
          dispatches.some(
            (call) =>
              call.connectionId === "gamma" &&
              call.method === "agent_conversation.latest",
          ),
        "newer Gamma notification completes while Beta lookup is delayed",
      );
      const gammaChat = [
        ...document.querySelectorAll<HTMLElement>(
          '.workspace-inspector[data-view="history"]',
        ),
      ].find((element) => element.getBoundingClientRect().width > 0)!;
      const mutations = dispatches.length;
      olderRelease.resolve();
      check(
        (await olderFinished.promise) === false,
        "superseded delayed Beta notification is refused",
      );
      await frame();
      check(
        store.get().activeConnectionId === "gamma" &&
          gammaChat.isConnected &&
          gammaChat.getBoundingClientRect().width > 0,
        "obsolete Beta leaves the newer Gamma Chat visible",
      );
      check(
        !dispatches
          .slice(mutations)
          .some(
            (call) =>
              call.connectionId === "beta" &&
              ["workspace.focus", "tab.focus"].includes(call.method),
          ),
        "obsolete Beta dispatches no native focus after Gamma",
      );
    } finally {
      olderRelease.resolve();
      store.focusTaskNotificationTarget = focus;
      heldNotificationGet = null;
    }
    return;
  }
  if (operation === "notifications") {
    writeHostsFilter(["alpha"]);
    // Board renders topology changes at low priority, a few frames later:
    // the filter must be in effect before the notification can change it.
    await waitFor(
      () => !visibleHost("beta"),
      "The Hosts filter did not hide the other host",
    );
    window.dispatchEvent(
      new CustomEvent(TASK_NOTIFICATION_ACTIVATE_EVENT, {
        detail: {
          connectionId: "beta",
          runtimeGeneration: 7,
          workspaceId: "shared",
          paneId: "shared",
        },
      }),
    );
    await waitFor(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[role="dialog"], .world-context-rail',
          ),
        ].some(
          (element) =>
            inspectorForHost(element, "beta") &&
            element.textContent?.includes("Outside Hosts filter"),
        ),
      "A qualified out-of-filter notification did not open its own labelled Inspector",
    );
    // A filter change would also show only a few frames later: give a wrong
    // one time to appear before checking that none did.
    for (let i = 0; i < 10; i++) await frame();
    check(
      !visibleHost("beta"),
      "Notification silently changed the Hosts filter",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Notification activated another global host",
    );
    const reveal = namedButton("Reveal in Hosts");
    if (!reveal)
      throw new Error(
        "Out-of-filter notification has no explicit reveal action",
      );
    reveal.click();
    // Board renders topology changes at low priority, a few frames later.
    await waitFor(
      () => visibleHost("beta"),
      "Explicit reveal did not expand the filter to the qualified host",
    );
    return;
  }
  if (operation === "open-all" || operation === "filtered-open-all") {
    if (operation === "filtered-open-all") {
      writeHostsFilter(["beta"]);
      await frame();
    }
    await invokeCommand("arrangement-open-all");
    await waitFor(
      () => document.querySelectorAll(".world-floating-terminal").length > 0,
      "Open all did not present a usable window",
    );
    await frame();
    const windows = [
      ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
    ];
    check(
      windows.length ===
        (operation === "open-all" && window.innerWidth > 720 ? 2 : 1),
      "Open all did not cover every filtered qualified tab exactly once",
    );
    check(
      windows.some((window) => inspectorForHost(window, "beta")),
      "Open all omitted the admitted sibling host",
    );
    check(
      operation === "open-all" ||
        !windows.some((window) => inspectorForHost(window, "alpha")),
      "Filtered Open all used the ambient host",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "Open all changed operational focus",
    );
    await shellCommands();
    const reopen = command("arrangement-open-all");
    check(
      reopen?.getAttribute("aria-disabled") === "true",
      "Open all failed to retain every filtered tab context",
    );
    if (window.innerWidth <= 720 && operation === "open-all") {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      leaf("alpha")!.click();
      await waitFor(
        () =>
          [
            ...document.querySelectorAll<HTMLElement>(
              ".world-floating-terminal",
            ),
          ].some((element) => inspectorForHost(element, "alpha")),
        "Compact Open all did not preserve independently selectable alpha",
      );
      check(
        document.querySelectorAll(".world-floating-terminal").length === 1,
        "Compact Open all mounted competing usable windows",
      );
    }
    return;
  }
  await float("alpha");
  await float("beta");
  if (operation === "shortcut") {
    const currentBetaWindow = () =>
      [
        ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
      ].find((element) => inspectorForHost(element, "beta"))!;
    currentBetaWindow().focus();
    await frame();
    const keys = defaultShortcutBindings(detectShortcutPlatform())[
      "tab.create"
    ][0]!.split("+");
    currentBetaWindow().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: keys[keys.length - 1]!,
        ctrlKey: keys.includes("Ctrl"),
        altKey: keys.includes("Alt"),
        shiftKey: keys.includes("Shift"),
        metaKey: keys.includes("Meta"),
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    check(
      dispatches.filter((call) => call.method === "tab.create").length === 1 &&
        dispatches.find((call) => call.method === "tab.create")
          ?.connectionId === "beta",
      `Focused Inspector shortcut must create exactly one beta tab; received ${JSON.stringify(dispatches.filter((call) => call.method === "tab.create"))}`,
    );
    for (const [shortcut, method] of [
      ["pane.splitRight", "pane.split"],
      ["pane.zoom", "pane.zoom"],
    ] as const) {
      const binding = defaultShortcutBindings(detectShortcutPlatform())[
        shortcut
      ][0]!.split("+");
      await waitFor(
        () => !!currentBetaWindow(),
        "Beta Inspector disappeared after a shortcut",
      );
      currentBetaWindow().focus();
      currentBetaWindow().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: binding[binding.length - 1]!,
          ctrlKey: binding.includes("Ctrl"),
          altKey: binding.includes("Alt"),
          shiftKey: binding.includes("Shift"),
          metaKey: binding.includes("Meta"),
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
      const calls = dispatches.filter((call) => call.method === method);
      check(
        calls.length === 1 && calls[0]?.connectionId === "beta",
        `Focused Inspector ${shortcut} must dispatch exactly once to beta; received ${JSON.stringify(calls)}`,
      );
    }
    const closeKeys = defaultShortcutBindings(detectShortcutPlatform())[
      "tab.close"
    ][0]!.split("+");
    await waitFor(
      () => !!currentBetaWindow(),
      "Beta Inspector disappeared before close",
    );
    currentBetaWindow().focus();
    currentBetaWindow().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: closeKeys[closeKeys.length - 1]!,
        ctrlKey: closeKeys.includes("Ctrl"),
        altKey: closeKeys.includes("Alt"),
        shiftKey: closeKeys.includes("Shift"),
        metaKey: closeKeys.includes("Meta"),
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    const confirmation = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Close Inspector tab"]',
    );
    check(
      !!confirmation && confirmation.textContent!.includes("Synthetic beta"),
      "Focused Inspector close must visibly confirm the captured beta owner",
    );
    if (confirmation) {
      [...confirmation.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Close")!
        .click();
      await frame();
      const calls = dispatches.filter((call) => call.method === "tab.close");
      check(
        calls.length === 1 && calls[0]?.connectionId === "beta",
        `Inspector close confirmation must dispatch once to beta; received ${JSON.stringify(calls)}`,
      );
    }
    return;
  }
  if (operation === "close-all") {
    writeHostsFilter(["beta"]);
    await frame();
    await invokeCommand("arrangement-close-all");
    await frame();
    check(
      document.querySelectorAll(".world-floating-terminal").length === 0,
      "Close all retained an excluded-host conversation",
    );
    check(
      !dispatches.some((call) =>
        /^(pane|tab|workspace)\.close$/.test(call.method),
      ),
      "Close all stopped Herdr work",
    );
    return;
  }
  if (window.innerWidth <= 720) {
    await shellCommands();
    const columns = command("arrangement-columns");
    check(
      columns?.getAttribute("aria-disabled") === "true",
      "Compact layout advertised unusable Columns",
    );
    check(
      document.querySelectorAll(".world-floating-terminal").length === 1 &&
        (await retainedWindowCount()) === 2,
      "Compact arrangement failed to retain both contexts with one usable window",
    );
    return;
  }
  await invokeCommand("arrangement-columns");
  writeHostsFilter(["beta"]);
  await frame();
  await shellCommands();
  check(
    command("arrangement-restore")?.getAttribute("aria-disabled") !== "true",
    "Filtering retired the arrangement restore snapshot",
  );
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await frame();
  flushSync(() => {
    const before = store.get();
    if (operation === "arrangement-focus")
      __storeTesting.replaceState({
        ...before,
        activeConnectionId: "beta",
        connectionGeneration: before.connectionGeneration + 1,
        ...before.sessionsByConnectionId.beta,
      });
    else
      __storeTesting.replaceState({
        ...before,
        serverRuntimeGeneration: 8,
        connections: before.connections.map((connection) =>
          connection.id === "alpha"
            ? { ...connection, generation: 8 }
            : connection,
        ),
      });
    store.clearNotice();
  });
  await frame();
  await shellCommands();
  const restore = command("arrangement-restore");
  check(
    !!restore && restore.getAttribute("aria-disabled") !== "true",
    operation === "arrangement-focus"
      ? "Another host's focus discarded the view-wide arrangement and restore baseline"
      : "Alpha retirement discarded beta's arrangement restore baseline",
  );
}
async function run() {
  localStorage.clear();
  // The legacy operational preference must not become an overview filter.
  worldLocalStorage.setItem("worldSelectedConnection", "beta");
  // These cases check which host owns a terminal, so opening an agent opens
  // its terminal, as Agents open set to Terminal does.
  writeOfficePreferences(worldLocalStorage, {
    ...DEFAULT_OFFICE_PREFERENCES,
    townOpens: operation === "spaces-notifications" ? "chat" : "terminal",
  });
  if (coldMaster)
    writeOfficePreferences(worldLocalStorage, {
      ...readOfficePreferences(worldLocalStorage),
      townMaster: "betamaster",
    });
  history.replaceState(null, "", "/board");
  initializeLayoutPreferences();
  if (
    operation === "file-delete-retirement" ||
    operation === "file-upload-retirement"
  ) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        if (
          url.pathname.endsWith("/file/delete") ||
          url.pathname.endsWith("/file/upload")
        ) {
          mutationRequests++;
          check(
            url.pathname.includes("/beta/file/") &&
              url.searchParams.get("connection_generation") === "7",
            "retiring mutation lost its qualified owner",
          );
          return retiredMutation.promise;
        }
        return originalFetch(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
  }
  if (operation === "file-mutation-interruption") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        if (url.pathname.endsWith("/file/upload")) {
          uploadRequests++;
          const headers = {
            "X-Herdr-Connection-Id": "beta",
            "X-Herdr-Connection-Generation": "7",
          };
          if (uploadRequests === 1)
            return Promise.resolve(
              Response.json(
                { error: "Synthetic definite rejection" },
                { status: 400, headers },
              ),
            );
          syntheticFileDeleted = false;
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(
                    new TypeError("Synthetic interrupted upload body"),
                  );
                },
              }),
              { headers },
            ),
          );
        }
        if (url.pathname.endsWith("/file/delete")) {
          mutationRequests++;
          check(
            url.pathname.includes("/beta/file/delete") &&
              url.searchParams.get("connection_generation") === "7",
            "interrupted mutation lost its owner",
          );
          syntheticFileDeleted = true;
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(
                    new TypeError("Synthetic interrupted mutation body"),
                  );
                },
              }),
              {
                headers: {
                  "X-Herdr-Connection-Id": "beta",
                  "X-Herdr-Connection-Generation": "7",
                },
              },
            ),
          );
        }
        return originalFetch(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
  }
  if (operation === "file-download-error") {
    // Native iOS sharing follows the explicit mobile layout policy.
    updateLayoutPreferences({ mode: "mobile" });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        downloadPublications++;
      },
    });
    window.open = () => {
      downloadPublications++;
      return null;
    };
    const fetchResource = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        if (url.pathname.endsWith("/file/download")) {
          downloadRequests.push(url.href);
          return Promise.resolve(
            Response.json(
              { error: "Synthetic file missing" },
              {
                status: 404,
                headers: {
                  "X-Herdr-Connection-Id": "beta",
                  "X-Herdr-Connection-Generation": "7",
                },
              },
            ),
          );
        }
        return fetchResource(input, init);
      },
      { preconnect: fetchResource.preconnect },
    );
  }
  if (operation === "watch-unavailable")
    watches.push(
      ...["alpha", "beta"].map((id) => ({
        connection_id: id,
        connection_generation: 7,
        terminal_id: "shared",
        label: `Synthetic ${id}`,
      })),
    );
  store.init = () => {};
  if (operation !== "spaces-navigator")
    store.selectConnection = (id) => {
      calls.push(`select:${id}`);
      return true;
    };
  bridge.onStatus = (listener) => {
    listener("connected");
    return () => {};
  };
  bridge.onControl = () => () => {};
  bridge.onEvent = () => () => {};
  bridge.onTerminal = () => () => {};
  bridge.onTerminalClipboard = () => () => {};
  bridge.onTerminalClosed = () => () => {};
  const client: ConnectionClient = {
    connectionId: "alpha",
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: (value) => value === 7,
    call: async (method, params = {}) => {
      calls.push(method);
      globals.push({ method, params });
      if (method === "world.snapshot")
        return operation === "worktree-resource-cold" && resourceWorkspaceOpen
          ? coldObservation.promise
          : snapshot();
      if (method === "world.watchlist.list")
        return { revision: watches.length, records: watches };
      if (method === "world.watchlist.pin") {
        watches.push({
          connection_id: String(params.connection_id),
          connection_generation: Number(params.connection_generation),
          terminal_id: String(params.terminal_id),
          label: String(params.label),
        });
        return { revision: watches.length, records: watches };
      }
      if (method === "workspace.list")
        return {
          workspaces: [
            workspace,
            ...(observedPendingWorkspace
              ? [{ ...workspace, workspace_id: "unobserved", focused: false }]
              : []),
          ],
          navigation_mode: coldHost ? "browser-local" : "shared",
        };
      if (method === "pane.list")
        return { panes: dense ? densePanes : fixturePanes };
      if (method === "tab.list") return { tabs: fixtureTabs };
      return {};
    },
  };
  bridge.connection = (
    id = store.get().activeConnectionId,
    generation = 7,
  ) => ({
    ...client,
    connectionId: id,
    generation: bridge.clientGeneration,
    serverRuntimeGeneration: generation,
    isCurrent: () =>
      catalogue.includes(id) &&
      id !== "offline" &&
      !offline &&
      generation === 7 &&
      store
        .get()
        .connections.some(
          (connection) =>
            connection.id === id &&
            connection.state === "ready" &&
            connection.generation === generation,
        ),
    call: async (method, params = {}) => {
      calls.push(method);
      dispatches.push({ connectionId: id, generation, method, params });
      if (
        method === "workspace.create" &&
        (operation === "global-creation" ||
          operation === "global-creation-retry") &&
        dispatches.filter((call) => call.method === "workspace.create")
          .length === 1
      )
        return creation.promise;
      if (method === "workspace.create" && operation === "global-creation")
        return creation.promise;
      if (method === "workspace.list") {
        if (resourceValidationFailure && id === "beta")
          throw new Error("Synthetic workspace validation failed");
        if (separateResourceWorkspace && id === "beta")
          return {
            workspaces: [
              workspace,
              ...(resourceWorkspaceOpen ? [resourceWorkspace] : []),
            ],
          };
      }
      if (
        method === "workspace.close" &&
        separateResourceWorkspace &&
        id === "beta" &&
        params.workspace_id === "opened-checkout"
      ) {
        resourceWorkspaceOpen = false;
        return {};
      }
      if (method === "worktree.list" && operation.startsWith("worktree-"))
        return {
          source: {
            repo_key: "/synthetic/repo/.git",
            repo_name: "Synthetic repo",
            repo_root: "/synthetic/repo",
            source_checkout_path: "/synthetic/repo",
            source_workspace_id: "shared",
          },
          worktrees: [
            {
              path: "/synthetic/feature",
              branch: "synthetic-feature",
              is_bare: false,
              is_detached: false,
              is_prunable: false,
              is_linked_worktree: true,
            },
          ],
        };
      if (
        method === "worktree.open" &&
        (operation === "worktree-resource-retirement" ||
          operation === "worktree-resource-disposal")
      )
        return lifecycleOpen.promise;
      if (method === "worktree.open" && separateResourceWorkspace) {
        resourceWorkspaceOpen = true;
        return { workspace: resourceWorkspace };
      }
      if (method === "worktree.open" && operation.startsWith("worktree-"))
        return {
          workspace: { workspace_id: "shared" },
          root_pane: {
            workspace_id: "shared",
            pane_id: "shared",
            tab_id: "shared",
          },
        };
      if (method === "git.pull" && operation === "context-menu-pull-failure")
        return gitPull.promise;
      if (method === "agent_worktree.get")
        return {
          subject: params.subject,
          revision: `synthetic-${id}-${generation}`,
          observedAt: "2026-01-01T00:00:00Z",
          state: "resolved",
          selectedCandidateId: "synthetic-root",
          candidates: [
            {
              candidateId: "synthetic-root",
              canonicalRoot: "/synthetic",
              gitCommonDir: "/synthetic/.git",
              branch: "main",
              source: "foreground_cwd",
              evidence: {
                sourceRef: "Synthetic pane foreground_cwd",
                observedAt: "2026-01-01T00:00:00Z",
                basis: "reported",
              },
            },
          ],
        };
      if (method === "file.list") {
        calls.push(`resource:${id}`);
        if (id === "alpha") {
          filesPending = true;
          return files.promise;
        }
        return {
          entries:
            operation === "file-download-error" ||
            operation === "file-delete-retirement" ||
            operation === "file-upload-retirement" ||
            (operation === "file-mutation-interruption" &&
              !syntheticFileDeleted)
              ? [
                  {
                    name: "synthetic.txt",
                    path: "synthetic.txt",
                    type: "file",
                    size: 1,
                  },
                ]
              : [],
          path: "",
          root: "/synthetic",
        };
      }
      if (method === "pane.layout")
        return {
          layout:
            params.tab_id === "second" || params.pane_id === "second"
              ? {
                  ...layout,
                  tab_id: "second",
                  focused_pane_id: "second",
                  panes: [{ ...layout.panes[0], pane_id: "second" }],
                }
              : layout,
        };
      if (method === "pane.get") {
        if (heldNotificationGet?.host === id) {
          const held = heldNotificationGet;
          heldNotificationGet = null;
          held.started();
          await held.wait;
        }
        const target = (dense ? densePanes : fixturePanes).find(
          (value) => value.pane_id === params.pane_id,
        );
        if (!target) throw new Error("Synthetic pane is unavailable");
        return { pane: target };
      }
      if (method === "worktree.list")
        return {
          source: {
            source_workspace_id: "shared",
            repo_root: "/synthetic",
            repo_key: "synthetic-repository",
          },
          worktrees: [],
        };
      if (method === "terminal.attach") {
        calls.push(`attached:${id}`);
        return {
          endpoint: {
            methods: [
              "pane.focus",
              "pane.scroll",
              "tab.create",
              "workspace.create",
            ],
            capabilities: [],
          },
        };
      }
      if (method === "git.diff_summary")
        return { workspace_id: "shared", entries: [], counts: {} };
      return client.call(method, params);
    },
  });
  const focusQualifiedTarget = store.focusQualifiedTarget;
  store.focusQualifiedTarget = async (target) => {
    calls.push(`focus:${target.connectionId}`);
    if (
      operation === "worktree-resource-timeout" &&
      target.connectionId === "beta" &&
      rejectResourceFocus
    )
      return resourceFocus.promise;
    if (
      (operation === "worktree-resource-rejection" ||
        (separateResourceWorkspace &&
          operation !== "worktree-resource-cold")) &&
      target.connectionId === "beta" &&
      rejectResourceFocus
    )
      return false;
    return focusQualifiedTarget(target);
  };
  bridge.call = client.call;
  __storeTesting.replaceState({
    ...store.get(),
    status: "connected",
    navigationMode: coldHost ? "browser-local" : "shared",
    catalogueReady: true,
    activeConnectionId: "alpha",
    defaultConnectionId: "alpha",
    connectionGeneration: 1,
    serverRuntimeGeneration: 7,
    connections: catalogue.map((id) => ({
      id,
      label: `Synthetic ${id}`,
      source: "test",
      is_default: id === "alpha",
      state: id === "offline" ? "disconnected" : "ready",
      generation: 7,
    })),
    workspaces: [workspace],
    panes: fixturePanes,
    tabs: fixtureTabs,
    layout,
    sessionsByConnectionId: {
      alpha: session(),
      beta: coldHost ? emptyServerSessionState(7) : session(),
      ...(operation === "spaces-notifications" ? { gamma: session() } : {}),
    },
  });
  await worldRuntimeStore.refresh();
  const admissionScenario =
    operation === "delayed-catalogue" || operation === "empty-catalogue";
  const admittedState = store.get();
  if (admissionScenario) {
    writeHostsFilter(["beta"]);
    __storeTesting.replaceState({
      ...admittedState,
      connections: [],
      catalogueReady: false,
    });
  }
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  flushSync(() => root.render(<WorldFoundationApp />));
  try {
    if (admissionScenario) {
      await clock.advance(150);
      check(
        worldLocalStorage.getItem("worldHostsFilter.v1") === '["beta"]',
        "unadmitted empty catalogue erased saved beta",
      );
      const previousCall = bridge.call;
      bridge.call = (async () => ({
        connections:
          operation === "empty-catalogue" ? [] : admittedState.connections,
      })) as typeof bridge.call;
      await store.refreshConnections();
      bridge.call = previousCall;
      await frame();
      const expected = operation === "empty-catalogue" ? "null" : '["beta"]';
      check(
        worldLocalStorage.getItem("worldHostsFilter.v1") === expected,
        "successful current catalogue did not reconcile saved filter",
      );
      check(
        store.get().catalogueReady,
        "successful empty/initial catalogue not published as ready",
      );
      check(
        document.body.textContent!.includes(
          "selected host profiles were removed",
        ) ===
          (operation === "empty-catalogue"),
        "incorrect removed-profile explanation",
      );
      return;
    }
    await waitFor(
      () => !!document.querySelector('[aria-label="Board controls"]'),
      "Board did not mount",
    );
    await frame();
    if (operation === "filters") {
      const launcher = document.querySelector<HTMLElement>(
        ".mobile-workspace-shortcut",
      )!;
      const mobile = document.documentElement.dataset.layout === "mobile";
      const launcherDisplay = getComputedStyle(launcher).display;
      check(
        mobile ? launcherDisplay !== "none" : launcherDisplay === "none",
        `Workspace navigator visibility does not match the selected layout (${launcherDisplay})`,
      );
      if (mobile) {
        check(
          getComputedStyle(launcher).position === "fixed",
          "Mobile workspace navigator consumes a row instead of floating",
        );
        const app = launcher.closest<HTMLElement>(".app")!;
        app.classList.add("mobile-controls-left");
        check(
          launcher.getBoundingClientRect().left < innerWidth / 2,
          "Workspace navigator ignores left-side control placement",
        );
        app.classList.remove("mobile-controls-left");
        app.setAttribute("data-mobile-controls-compact", "");
        check(
          getComputedStyle(launcher).position === "static" &&
            launcher.parentElement?.classList.contains(
              "mobile-controls-stack",
            ) === true,
          "Workspace navigator stays outside the compact controls dock",
        );
        app.removeAttribute("data-mobile-controls-compact");
      }
    }
    if (requestedView !== "board") {
      const view = document.querySelector<HTMLSelectElement>(
        'select[aria-label="World view"]',
      )!;
      view.value = requestedView;
      view.dispatchEvent(new Event("change", { bubbles: true }));
      if (requestedView !== "spaces") {
        const title = "Town";
        await waitFor(
          () => !!document.querySelector(`[aria-label="${title} controls"]`),
          `${title} did not mount`,
        );
      }
      await frame();
    }
    if (operation !== "filters") {
      await operationalScenario(() => flushSync(() => root.unmount()));
      return;
    }
    for (const id of catalogue)
      check(
        anchors().has(worldObjectId(id, "host", id)),
        `initial All hosts omits ${id}; legacy selection must not filter overview`,
      );
    const hosts = namedButton("Hosts");
    check(
      document.querySelectorAll(
        "#workspace-navigator [data-world-navigator-host]",
      ).length === 3,
      "common navigator must group the complete Hosts scope",
    );
    check(!!hosts, "common shell lacks the named Hosts filter");
    if (!hosts) return;
    check(
      hosts.getBoundingClientRect().right <= window.innerWidth &&
        hosts.getBoundingClientRect().width > 0,
      "Hosts control is outside the visible viewport",
    );
    const mobileTopbar = document.documentElement.dataset.layout === "mobile";
    const hostLabel = hosts.querySelector<HTMLElement>(
      ".connection-switcher-label",
    )!;
    const hostCount = hosts.querySelector<HTMLElement>(".world-hosts-count")!;
    const viewIcon = document.querySelector<HTMLElement>(
      ".world-primary-view-icon",
    )!;
    const menuIcon = document.querySelector<HTMLElement>(".menu-button-icon")!;
    const menuLabel =
      document.querySelector<HTMLElement>(".menu-button-label")!;
    check(
      (getComputedStyle(hostLabel).display === "none") === mobileTopbar,
      "Hosts label does not follow mobile layout",
    );
    check(
      (getComputedStyle(viewIcon).display !== "none") === mobileTopbar,
      "World view icon does not follow mobile layout",
    );
    check(
      (getComputedStyle(menuIcon).display !== "none") === mobileTopbar &&
        (getComputedStyle(menuLabel).display === "none") === mobileTopbar,
      "Menu icon and label do not follow mobile layout",
    );
    check(
      hostCount.textContent === String(catalogue.length) &&
        (getComputedStyle(hostCount).display !== "none") === mobileTopbar,
      "Hosts icon does not show the catalogue count on mobile",
    );
    const topbarStatus = document.querySelector<HTMLElement>(
      ".world-topbar-status",
    )!;
    check(
      (getComputedStyle(topbarStatus).display === "none") === mobileTopbar,
      "Aggregate status text must be hidden only in the mobile top bar",
    );
    for (const id of ["alpha", "beta"]) {
      const node = [
        ...document.querySelectorAll<HTMLElement>("[data-world-node-anchor]"),
      ].find(
        (element) =>
          element.dataset.worldNodeAnchor ===
          worldObjectId(id, "terminal", "shared"),
      );
      if (!node) throw new Error(`Missing synthetic ${id} leaf`);
      node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(
        () =>
          document.querySelectorAll(".world-floating-terminal").length ===
            (window.innerWidth <= 720 || id === "alpha" ? 1 : 2) &&
          [
            ...document.querySelectorAll<HTMLElement>(
              ".world-floating-terminal",
            ),
          ].some((element) => inspectorForHost(element, id)),
        `Independent ${id} Inspector did not open`,
      );
    }
    await waitFor(
      () => calls.includes("attached:alpha") && calls.includes("attached:beta"),
      "Both qualified terminal contexts did not attach",
    );
    await frame();
    if (window.innerWidth <= 720) {
      document
        .querySelector<HTMLElement>(
          `[data-world-node-anchor="${CSS.escape(worldObjectId("alpha", "terminal", "shared"))}"]`,
        )!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await waitFor(
        () =>
          inspectorForHost(
            document.querySelector(".world-floating-terminal"),
            "alpha",
          ),
        "Compact switch back to the retained alpha Inspector",
      );
    }
    const alphaInspector = [
      ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
    ].find((element) => inspectorForHost(element, "alpha"))!;
    await waitFor(
      () =>
        !![
          ...alphaInspector.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        ].find((button) => button.textContent?.includes("Files")),
      "Files control did not mount",
    );
    [...alphaInspector.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes("Files"))!
      .click();
    await waitFor(() => filesPending, "Alpha Files request did not start");
    await frame();
    const start = calls.length;
    hosts.click();
    await frame();
    const beta = hostCheckbox("beta");
    const alpha = hostCheckbox("alpha");
    const absent = hostCheckbox("offline");
    if (!beta || !alpha || !absent)
      throw new Error(
        "Hosts must expose independently labelled managed-host selections",
      );
    if (!beta.checked) beta.click();
    if (alpha.checked) alpha.click();
    if (absent.checked) absent.click();
    await frame();
    check(
      anchors().has(worldObjectId("beta", "host", "beta")) &&
        !anchors().has(worldObjectId("alpha", "host", "alpha")),
      "explicit beta filter must affect overview only",
    );
    check(
      store.get().activeConnectionId === "alpha",
      "filter changed operational owner",
    );
    check(
      document.querySelectorAll(
        "#workspace-navigator [data-world-navigator-host]",
      ).length === 1 &&
        !!document.querySelector(
          '#workspace-navigator [data-world-navigator-host="beta"]',
        ),
      "common navigator must intersect the explicit Hosts filter",
    );
    check(
      !calls
        .slice(start)
        .some((method) =>
          /^(select:|connection\.(connect|disconnect)|terminal\.(attach|detach)|pane\.focus)/.test(
            method,
          ),
        ),
      `filter dispatched lifecycle or terminal operations: ${calls
        .slice(start)
        .filter((method) =>
          /^(select:|connection\.(connect|disconnect)|terminal\.(attach|detach)|pane\.focus)/.test(
            method,
          ),
        )
        .join(", ")}`,
    );
    check(
      document.querySelectorAll(".world-floating-terminal").length ===
        (window.innerWidth <= 720 ? 1 : 2) &&
        (await retainedWindowCount()) === 2,
      "filter retired an admitted Inspector",
    );
    check(
      /Outside Hosts filter/.test(alphaInspector.textContent ?? ""),
      "filtered-out Inspector lacks an honest scope label",
    );
    files.resolve({
      entries: [
        {
          name: "alpha-delayed.txt",
          path: "alpha-delayed.txt",
          kind: "file",
          size: 1,
        },
      ],
      path: "",
      root: "/synthetic",
    });
    await waitFor(
      () => alphaInspector.textContent?.includes("alpha-delayed.txt") ?? false,
      "pending resource did not remain with its filtered-out owner",
    );
    check(
      !calls.slice(start).some((method) => method === "resource:beta"),
      "filter retargeted alpha Files to beta",
    );
    dense = true;
    const beforeDense = store.get();
    __storeTesting.replaceState({
      ...beforeDense,
      sessionsByConnectionId: {
        ...beforeDense.sessionsByConnectionId,
        beta: { ...session(), panes: densePanes },
      },
    });
    await worldRuntimeStore.refresh();
    const needle = worldObjectId("beta", "terminal", "shared-19");
    for (const view of ["board", "town"]) {
      const viewSelect = document.querySelector<HTMLSelectElement>(
        'select[aria-label="World view"]',
      )!;
      viewSelect.value = view;
      viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const title = view[0]!.toUpperCase() + view.slice(1);
      await waitFor(
        () => !!document.querySelector(`[aria-label="${title} controls"]`),
        `${title} controls did not mount`,
      );
      // The status follows the mounted view's presented world; wait for it
      // rather than sampling a single frame on a loaded runner.
      await waitFor(
        () =>
          document
            .querySelector(".world-topbar-status")
            ?.getAttribute("aria-label")
            ?.includes("40 observed agents") ?? false,
        `${title} counts do not share the beta filter`,
      ).catch(() =>
        check(false, `${title} counts do not share the beta filter`),
      );
      check(
        document.querySelectorAll(
          "#workspace-navigator [data-world-navigator-host]",
        ).length === 1,
        `${title} navigator lost the filter`,
      );
      namedButton(`Search ${title}`)?.click();
      await frame();
      const input = document.querySelector<HTMLInputElement>(
        `input[placeholder="Search ${title}"]`,
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Needle beyond bounds");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await waitFor(
        () =>
          !![
            ...document.querySelectorAll<HTMLElement>(
              "[data-world-search-result]",
            ),
          ].find((element) => element.dataset.worldSearchResult === needle),
        `${title} cannot find an observed omitted leaf`,
      );
      const result = [
        ...document.querySelectorAll<HTMLElement>("[data-world-search-result]"),
      ].find((element) => element.dataset.worldSearchResult === needle)!;
      check(
        result.textContent?.includes("Synthetic beta") ?? false,
        `${title} search result is not qualified`,
      );
      const focusedBefore = calls.filter(
        (method) => method === "focus:beta",
      ).length;
      result.click();
      await waitFor(
        () =>
          calls.filter((method) => method === "focus:beta").length >
          focusedBefore,
        `${title} did not select the qualified search result`,
      );
      if (view !== "town")
        await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[data-world-node-anchor]",
              ),
            ].some(
              (element) =>
                element.dataset.worldNodeAnchor === needle &&
                element.getAttribute("aria-pressed") === "true",
            ),
          `${title} did not reveal selected result`,
        );
      await frame();
      if (view !== "town")
        check(
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-world-node-anchor]",
            ),
          ].some(
            (element) =>
              element.dataset.worldNodeAnchor === needle &&
              element.getAttribute("aria-pressed") === "true",
          ),
          `${title} selected omitted result was not revealed`,
        );
      check(
        store.get().activeConnectionId === "alpha",
        `${title} selection replaced another operational context`,
      );
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Repeated synthetic agent");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await frame();
      const later = worldObjectId("beta", "terminal", "shared-39");
      check(
        document.querySelectorAll("[data-world-search-result]").length <= 32,
        `${title} search DOM is unbounded`,
      );
      const next = namedButton("Next search results");
      if (!next)
        throw new Error(
          `${title} has no path to matching observations beyond the first 32`,
        );
      next.click();
      await frame();
      const laterResult = [
        ...document.querySelectorAll<HTMLElement>("[data-world-search-result]"),
      ].find((element) => element.dataset.worldSearchResult === later);
      if (!laterResult)
        throw new Error(
          `${title} paging lost the later qualified match with colliding labels`,
        );
      laterResult.click();
      if (view !== "town")
        await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[data-world-node-anchor]",
              ),
            ].some(
              (element) =>
                element.dataset.worldNodeAnchor === later &&
                element.getAttribute("aria-pressed") === "true",
            ),
          `${title} did not reveal paged result`,
        );
      await frame();
      if (view !== "town")
        check(
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-world-node-anchor]",
            ),
          ].some(
            (element) =>
              element.dataset.worldNodeAnchor === later &&
              element.getAttribute("aria-pressed") === "true",
          ),
          `${title} did not reveal the later paged match`,
        );
    }
    const viewSelect = document.querySelector<HTMLSelectElement>(
      'select[aria-label="World view"]',
    )!;
    viewSelect.value = "board";
    viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(
      () => !!document.querySelector('[aria-label="Board controls"]'),
      "Board did not return",
    );
    flushSync(() => root.unmount());
    const restoredState = store.get();
    __storeTesting.replaceState({
      ...restoredState,
      status: "connecting",
      connections: [],
    });
    root = createRoot(host);
    flushSync(() => root.render(<WorldFoundationApp />));
    await frame();
    check(
      worldLocalStorage.getItem("worldHostsFilter.v1") === '["beta"]',
      "saved filter was pruned before catalogue admission",
    );
    __storeTesting.replaceState(restoredState);
    await frame();
    await waitFor(
      () => anchors().has(worldObjectId("beta", "host", "beta")),
      "saved beta filter did not restore",
    );
    check(
      !anchors().has(worldObjectId("alpha", "host", "alpha")),
      "reload lost explicit host filter",
    );
    catalogue = ["alpha", "offline"];
    __storeTesting.applyCatalog(
      catalogue.map((id) => ({
        id,
        label: `Synthetic ${id}`,
        source: "test",
        is_default: id === "alpha",
        state:
          id === "offline" ? ("disconnected" as const) : ("ready" as const),
        generation: 7,
      })),
      "alpha",
    );
    await worldRuntimeStore.refresh();
    await frame();
    check(
      anchors().has(worldObjectId("alpha", "host", "alpha")) &&
        anchors().has(worldObjectId("offline", "host", "offline")),
      "removed saved filter must restore All hosts",
    );
    check(
      /removed|no longer|unavailable/i.test(document.body.textContent ?? ""),
      "filter migration lacks an explanation",
    );
    offline = true;
    __storeTesting.applyCatalog(
      catalogue.map((id) => ({
        id,
        label: `Synthetic ${id}`,
        source: "test",
        is_default: id === "alpha",
        state: "disconnected" as const,
        generation: 7,
      })),
      "alpha",
    );
    await worldRuntimeStore.refresh();
    await frame();
    check(
      anchors().has(worldObjectId("alpha", "host", "alpha")),
      "offline catalogue must keep overview roots",
    );
    check(
      /stale|offline|disconnected/i.test(document.body.textContent ?? ""),
      "offline observations lack health labels",
    );
    check(
      document
        .querySelector(".world-topbar-status")
        ?.getAttribute("aria-label")
        ?.includes("counts unknown") ?? false,
      "an unobserved offline host was reported as zero agents",
    );
    catalogue = [];
    __storeTesting.applyCatalog([], "");
    await worldRuntimeStore.refresh();
    await frame();
    check(anchors().size === 0, "empty catalogue invented qualified entities");
    check(
      /add|connect|profile/i.test(document.body.textContent ?? ""),
      "empty catalogue lacks onboarding",
    );
  } finally {
    root.unmount();
    worldRuntimeStore.stop();
    host.remove();
  }
}
void run()
  .catch((error) => failures.push(String(error)))
  .finally(async () => {
    await fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures),
      headers: { "Content-Type": "application/json" },
    });
  });
