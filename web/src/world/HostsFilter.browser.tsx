import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { WorktreeOpenDialog } from "../components/WorktreeOpenDialog";
import { initializeLayoutPreferences } from "../layoutPreferences";
import {
  defaultShortcutBindings,
  detectShortcutPlatform,
} from "../shortcutBindings";
import {
  __storeTesting,
  emptyServerSessionState,
  OperationalContext,
  store,
} from "../store";
import { TASK_NOTIFICATION_ACTIVATE_EVENT } from "../taskNotifications";
import type { Pane, Tab, Workspace } from "../types";
import { writeHostsFilter } from "./hostsFilter";
import { worldRuntimeStore } from "./runtimeStore";
import WorldFoundationApp from "./WorldFoundationApp";
import { worldObjectId } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

const failures: string[] = [];
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
let watchAdmissionOld = false;
let downloadPublications = 0;
const downloadRequests: string[] = [];
const operation =
  new URLSearchParams(location.search).get("operation") ?? "filters";
const requestedView =
  new URLSearchParams(location.search).get("view") ?? "tree";
const coldHost =
  operation === "cold-host" ||
  operation === "navigator" ||
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
  pane_count: 1,
  tab_count: 1,
  agent_status: "idle",
};
const pane: Pane = {
  pane_id: "shared",
  terminal_id: "shared",
  workspace_id: "shared",
  tab_id: "shared",
  focused: false,
  agent: "codex",
  agent_status: "idle",
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
  tabs: [tab],
  panes: [pane],
  selectedPaneId: "shared",
  layout,
});
let catalogue = ["alpha", "beta", "offline"];
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
const statusCounts = { working: 0, idle: 1, blocked: 0, done: 0, unknown: 0 };
const coverage = {
  workspaces: 1,
  tabs: 1,
  panes: 1,
  agent_panes: 1,
  status: statusCounts,
  by_workspace: [
    {
      workspace_id: "shared",
      tabs: 1,
      panes: 1,
      agent_panes: 1,
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
              workspaces: [workspace],
              tabs: [tab],
              panes: dense && id === "beta" ? densePanes : [pane],
              agents: [],
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
function waitFor(condition: () => boolean, message: string) {
  if (condition()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (condition()) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `${message}; ${document.body.textContent?.slice(-1000)}; ${JSON.stringify(worldRuntimeStore.get())}`,
        ),
      );
    }, 3000);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function anchors() {
  return new Set(
    [...document.querySelectorAll<HTMLElement>("[data-world-node-anchor]")].map(
      (element) => element.dataset.worldNodeAnchor,
    ),
  );
}
function visibleHost(id: string) {
  return requestedView === "tree"
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
  if (requestedView !== "tree")
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
async function float(id: string) {
  const target = leaf(id);
  if (!target) throw new Error(`Missing admitted ${id} target`);
  if (requestedView === "tree")
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  else {
    target.click();
    await waitFor(
      () => !!namedButton("Float Inspector"),
      "Navigator Inspector has no Dock out",
    );
    namedButton("Float Inspector")!.click();
  }
  await waitFor(
    () =>
      !![
        ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
      ].find((window) => window.textContent?.includes(`Synthetic ${id}`)),
    `The ${id} Inspector did not open`,
  );
  await frame();
}
async function operationalScenario() {
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
    const room = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '.world-semantic-target[data-kind="room"]',
        ),
      ].find(
        (element) =>
          element.dataset.targetKey ===
          worldObjectId("beta", "space", "shared"),
      );
    await waitFor(
      () => !!room() && !room()!.disabled,
      "The Office workspace room did not become interactive",
    );
    room()!.click();
    await waitFor(
      () => calls.includes("attached:beta"),
      "The Office room did not open its owning host's terminal",
    );
    if (window.innerWidth <= 720) {
      await waitFor(
        () =>
          [...document.querySelectorAll(".workspace-inspector")].some(
            (inspector) =>
              inspector.textContent?.includes("Synthetic beta") &&
              !!inspector
                .querySelector(".terminal-main")
                ?.getBoundingClientRect().width,
          ),
        "The mobile Office room left its terminal in a hidden floating Inspector",
      );
    }
    check(
      store.get().activeConnectionId === "alpha",
      "The Office room changed the Spaces owner",
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
        () => calls.includes("attached:beta"),
        "Selecting an unvisited host's workspace did not open its terminal",
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
    await worldRuntimeStore.refresh();
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
      [
        ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
      ].some((element) => element.textContent?.includes("Synthetic alpha")),
      "Entering beta Spaces retired the unrelated alpha conversation",
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
      ].some((header) => header.textContent?.includes("Synthetic alpha")),
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
  if (operation === "notifications") {
    writeHostsFilter(["alpha"]);
    await frame();
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
            element.textContent?.includes("Synthetic beta") &&
            element.textContent?.includes("Outside Hosts filter"),
        ),
      "A qualified out-of-filter notification did not open its own labelled Inspector",
    );
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
    await frame();
    check(
      visibleHost("beta"),
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
      windows.some((window) => window.textContent?.includes("Synthetic beta")),
      "Open all omitted the admitted sibling host",
    );
    check(
      operation === "open-all" ||
        !windows.some((window) =>
          window.textContent?.includes("Synthetic alpha"),
        ),
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
          ].some((element) => element.textContent?.includes("Synthetic alpha")),
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
      ].find((element) => element.textContent?.includes("Synthetic beta"))!;
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
      document.querySelectorAll(".world-floating-terminal").length === 2,
      "Unavailable compact arrangement retired contexts",
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
  history.replaceState(null, "", "/tree");
  initializeLayoutPreferences();
  if (operation === "file-download-error") {
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
      if (method === "world.snapshot") return snapshot();
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
          workspaces: [workspace],
          navigation_mode: coldHost ? "browser-local" : "shared",
        };
      if (method === "pane.list") return { panes: dense ? densePanes : [pane] };
      if (method === "tab.list") return { tabs: [tab] };
      return {};
    },
  };
  bridge.connection = (id = "alpha", generation = 7) => ({
    ...client,
    connectionId: id,
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
      if (method === "file.list") {
        calls.push(`resource:${id}`);
        if (id === "alpha") {
          filesPending = true;
          return files.promise;
        }
        return {
          entries:
            operation === "file-download-error"
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
      if (method === "pane.layout") return { layout };
      if (method === "pane.get") {
        const target = (dense ? densePanes : [pane]).find(
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
    panes: [pane],
    tabs: [tab],
    layout,
    sessionsByConnectionId: {
      alpha: session(),
      beta: coldHost ? emptyServerSessionState(7) : session(),
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
      await new Promise((resolve) => setTimeout(resolve, 150));
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
      () =>
        !!document.querySelector('[aria-label="Connected World hierarchy"]'),
      "Tree did not mount",
    );
    await frame();
    if (requestedView !== "tree") {
      const view = document.querySelector<HTMLSelectElement>(
        'select[aria-label="World view"]',
      )!;
      view.value = requestedView;
      view.dispatchEvent(new Event("change", { bubbles: true }));
      const title = requestedView === "office" ? "Office" : "Graph";
      await waitFor(
        () => !!document.querySelector(`[aria-label="${title} controls"]`),
        `${title} did not mount`,
      );
      await frame();
    }
    if (operation !== "filters") {
      await operationalScenario();
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
          (id === "alpha" ? 1 : 2),
        `Independent ${id} Inspector did not open`,
      );
    }
    await waitFor(
      () => calls.includes("attached:alpha") && calls.includes("attached:beta"),
      "Both qualified terminal contexts did not attach",
    );
    await frame();
    const alphaInspector = document.querySelectorAll<HTMLElement>(
      ".world-floating-terminal",
    )[0]!;
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
      document.querySelectorAll(".world-floating-terminal").length === 2,
      "filter retired an admitted Inspector",
    );
    check(
      /Outside the Hosts filter/.test(alphaInspector.textContent ?? ""),
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
    for (const view of ["tree", "graph", "office"]) {
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
      await frame();
      check(
        document
          .querySelector(".world-topbar-status")
          ?.getAttribute("aria-label")
          ?.includes("40 observed agents") ?? false,
        `${title} counts do not share the beta filter`,
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
      if (view !== "office")
        await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[data-world-node-anchor], [data-graph-node-anchor]",
              ),
            ].some(
              (element) =>
                (element.dataset.worldNodeAnchor ??
                  element.dataset.graphNodeAnchor) === needle &&
                element.getAttribute("aria-pressed") === "true",
            ),
          `${title} did not reveal selected result`,
        );
      await frame();
      if (view !== "office")
        check(
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-world-node-anchor], [data-graph-node-anchor]",
            ),
          ].some(
            (element) =>
              (element.dataset.worldNodeAnchor ??
                element.dataset.graphNodeAnchor) === needle &&
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
      if (view !== "office")
        await waitFor(
          () =>
            [
              ...document.querySelectorAll<HTMLElement>(
                "[data-world-node-anchor], [data-graph-node-anchor]",
              ),
            ].some(
              (element) =>
                (element.dataset.worldNodeAnchor ??
                  element.dataset.graphNodeAnchor) === later &&
                element.getAttribute("aria-pressed") === "true",
            ),
          `${title} did not reveal paged result`,
        );
      await frame();
      if (view !== "office")
        check(
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-world-node-anchor], [data-graph-node-anchor]",
            ),
          ].some(
            (element) =>
              (element.dataset.worldNodeAnchor ??
                element.dataset.graphNodeAnchor) === later &&
              element.getAttribute("aria-pressed") === "true",
          ),
          `${title} did not reveal the later paged match`,
        );
    }
    const viewSelect = document.querySelector<HTMLSelectElement>(
      'select[aria-label="World view"]',
    )!;
    viewSelect.value = "tree";
    viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(
      () => !!document.querySelector('[aria-label="Tree controls"]'),
      "Tree did not return",
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
