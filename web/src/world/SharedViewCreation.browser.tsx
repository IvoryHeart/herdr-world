import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient, type TerminalPush } from "../api";
import { __storeTesting, emptyServerSessionState, store } from "../store";
import { creationSources } from "../creationRequests";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import type { Pane, Tab, Workspace } from "../types";
import { buildWorldObject } from "./worldObject";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { worldRuntimeStore } from "./runtimeStore";
import WorldFoundationApp from "./WorldFoundationApp";
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
  bridge.onControl = bridge.onEvent = () => () => {};
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
  await until(
    () =>
      document.querySelector(
        '.world-new-seat-canvas-action[aria-label*="alpha b"]',
      ),
    "second room control",
  );
  check(
    document.querySelector<HTMLSelectElement>('[aria-label="World view"]')
      ?.value === "office",
    "Root did not default to Office",
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
  const gate = Promise.withResolvers<void>();
  heldMutation = gate.promise;
  fullRoom.click();
  fullRoom.click();
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
  for (const name of ["office", "desk", "tree", "graph"]) {
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
  view("tree");
  await settle();
  heldMutation = null;
  viewGate.resolve();
  await createdInspector(viewChangeCount + 1);
  check(
    location.pathname === "/tree",
    "Pending creation lost the current visual view",
  );
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
    ["spaces", "office"],
    ["office", "spaces"],
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
