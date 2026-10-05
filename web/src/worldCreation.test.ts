import { afterEach, expect, test } from "bun:test";
import { bridge, UncertainRequestError, type ConnectionClient } from "./api";
import {
  creationSources,
  subscribeCreationSources,
  subscribeCreations,
  creationFailureMessage,
} from "./creationRequests";
import {
  __storeTesting,
  store,
  emptyServerSessionState,
  connectionSnapshot,
  endpointCreationReason,
} from "./store";

const previous = store.get();
const originalConnection = bridge.connection;
afterEach(() => {
  bridge.connection = originalConnection;
  __storeTesting.replaceState(previous);
});

test("workspace creation dispatches from its explicit source rather than remembered Spaces focus", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const panes = ["a", "b"].map((id) => ({
    workspace_id: id,
    tab_id: `${id}-tab`,
    pane_id: `${id}-pane`,
    terminal_id: `${id}-terminal`,
    focused: id === "a",
    agent_status: "idle",
    revision: 1,
  }));
  __storeTesting.replaceState({
    ...previous,
    status: "connected",
    connectionPaused: false,
    activeConnectionId: "alpha",
    serverRuntimeGeneration: 7,
    connections: [
      {
        id: "alpha",
        label: "Alpha",
        source: "test",
        state: "ready",
        is_default: true,
        generation: 7,
      },
    ],
    navigationMode: "browser-local",
    workspaces: ["a", "b"].map((id) => ({
      workspace_id: id,
      label: id,
      number: 1,
      focused: id === "a",
      active_tab_id: `${id}-tab`,
      pane_count: 1,
      tab_count: 1,
      agent_status: "idle",
    })),
    panes,
    browserNavigation: {
      revision: 1,
      workspaceId: "a",
      tabIds: { a: "a-tab", b: "b-tab" },
      paneIds: { "a-tab": "a-pane", "b-tab": "b-pane" },
    },
    endpointAvailability: Object.fromEntries(
      panes.map((pane) => [
        pane.terminal_id,
        { methods: ["pane.focus", "workspace.create"], capabilities: [] },
      ]),
    ),
    lastRefresh: Date.now(),
  });
  bridge.connection = ((connectionId: string) => ({
    connectionId,
    generation: 7,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return {};
    },
  })) as typeof bridge.connection;
  const client = bridge.connection("alpha", 7);
  const attempt = store.beginTerminalAttachment(client, "b-terminal");
  store.completeTerminalAttachment(client, "b-terminal", attempt, {
    methods: ["pane.focus", "workspace.create"],
    capabilities: [],
  });
  await Reflect.apply(store.createQualifiedWorkspace, store, [
    { connectionId: "alpha", runtimeGeneration: 7 },
    "New",
    undefined,
    { sourceWorkspaceId: "b" },
  ]);
  expect(
    calls.find(({ method }) => method === "workspace.create")?.params
      .browser_source,
  ).toEqual({
    workspace_id: "b",
    tab_id: "b-tab",
    pane_id: "b-pane",
    terminal_id: "b-terminal",
  });
  expect(store.get().browserNavigation.workspaceId).toBe("a");
});

const owner = { connectionId: "alpha", runtimeGeneration: 7 };
const advertisement = {
  methods: ["pane.focus", "tab.create", "workspace.create"],
  capabilities: [],
};
function fixture(mode: "shared" | "browser-local" = "browser-local") {
  const panes = ["a", "b"].map((id) => ({
    workspace_id: id,
    tab_id: `${id}-tab`,
    pane_id: `${id}-pane`,
    terminal_id: `${id}-terminal`,
    focused: id === "a",
    agent_status: "idle",
    revision: 1,
  }));
  const session = {
    ...emptyServerSessionState(7),
    navigationMode: mode,
    lastRefresh: 1,
    workspaces: panes.map((pane, index) => ({
      workspace_id: pane.workspace_id,
      label: pane.workspace_id,
      number: index + 1,
      focused: index === 0,
      active_tab_id: pane.tab_id,
      pane_count: 1,
      tab_count: 1,
      agent_status: "idle",
    })),
    tabs: panes.map((pane, index) => ({
      tab_id: pane.tab_id,
      workspace_id: pane.workspace_id,
      label: pane.workspace_id,
      number: index + 1,
      focused: index === 0,
      pane_count: 1,
      agent_status: "idle",
    })),
    panes,
    selectedPaneId: "a-pane",
    browserNavigation: {
      revision: 1,
      workspaceId: "a",
      tabIds: { a: "a-tab", b: "b-tab" },
      paneIds: { "a-tab": "a-pane", "b-tab": "b-pane" },
    },
    endpointAvailability: Object.fromEntries(
      panes.map((pane) => [pane.terminal_id, advertisement]),
    ),
  };
  const calls: Array<{
    method: string;
    params: Record<string, unknown>;
    host: string;
  }> = [];
  let respond: (
    method: string,
    params: Record<string, unknown>,
    host: string,
  ) => Promise<unknown> = async () => ({});
  const clients = new Map<string, ConnectionClient>();
  bridge.connection = ((connectionId: string, serverRuntimeGeneration = 7) => {
    let client = clients.get(connectionId);
    if (!client) {
      client = {
        connectionId,
        generation: 1,
        serverRuntimeGeneration,
        isCurrent: () =>
          store
            .get()
            .connections.some(
              (connection) =>
                connection.id === connectionId &&
                connection.generation === serverRuntimeGeneration &&
                connection.state === "ready",
            ),
        acceptsServerGeneration: (generation) =>
          generation === serverRuntimeGeneration,
        call: async (method, params = {}) => {
          calls.push({ method, params, host: connectionId });
          return respond(method, params, connectionId);
        },
      };
      clients.set(connectionId, client);
    }
    return client;
  }) as typeof bridge.connection;
  __storeTesting.replaceState({
    ...previous,
    ...session,
    status: "connected",
    connectionPaused: false,
    activeConnectionId: "alpha",
    connectionGeneration: 1,
    catalogueReady: true,
    connections: ["alpha", "beta"].map((id, index) => ({
      id,
      label: id,
      generation: 7,
      state: "ready",
      source: "test",
      is_default: index === 0,
    })),
    sessionsByConnectionId: { beta: session },
  });
  return {
    calls,
    session,
    respond: (handler: typeof respond) => {
      respond = handler;
    },
    attach: (
      host = "alpha",
      terminal = "b-terminal",
      methods = advertisement.methods,
    ) => {
      const client = bridge.connection(host, 7);
      const attempt = store.beginTerminalAttachment(client, terminal);
      store.completeTerminalAttachment(client, terminal, attempt, {
        methods,
        capabilities: [],
      });
      return { client, attempt };
    },
  };
}
function demandedSource() {
  const result = Promise.withResolvers<void>();
  const off = subscribeCreationSources(() => {
    if (creationSources().length) {
      off();
      result.resolve();
    }
  });
  return result.promise;
}

test("cached endpoint advertisements prepare a browser-owned source before a single coalesced mutation", async () => {
  const { calls, attach } = fixture();
  expect(endpointCreationReason(store.get(), "tab.create", "b")).toBeNull();
  const demanded = demandedSource();
  const first = store.createQualifiedTab(owner, "b");
  const second = store.createQualifiedTab(owner, "b");
  expect(second).toBe(first);
  await demanded;
  expect(creationSources()).toHaveLength(1);
  expect(calls).toEqual([]);
  const { client, attempt } = attach();
  await first;
  expect(calls.filter((call) => call.method === "tab.create")).toEqual([
    {
      host: "alpha",
      method: "tab.create",
      params: {
        workspace_id: "b",
        focus: false,
        browser_source: {
          workspace_id: "b",
          tab_id: "b-tab",
          pane_id: "b-pane",
          terminal_id: "b-terminal",
        },
      },
    },
  ]);
  expect(creationSources()).toEqual([]);
  store.revokeTerminalAttachment(client, "b-terminal", attempt);
  expect(store.get().endpointAvailability["b-terminal"]).toBeNull();
  expect(store.get().terminalAttachments["b-terminal"]).toBeUndefined();
});

test("late attach acknowledgement and obsolete cleanup cannot replace current ownership", () => {
  const { attach } = fixture();
  const { client, attempt } = attach();
  const replacement = store.beginTerminalAttachment(client, "b-terminal");
  store.completeTerminalAttachment(
    client,
    "b-terminal",
    attempt,
    advertisement,
  );
  expect(store.get().terminalAttachments["b-terminal"].ready).toBe(false);
  expect(store.revokeTerminalAttachment(client, "b-terminal", attempt)).toBe(
    false,
  );
  store.completeTerminalAttachment(
    client,
    "b-terminal",
    replacement,
    advertisement,
  );
  expect(store.get().terminalAttachments["b-terminal"]).toMatchObject({
    attempt: replacement,
    ready: true,
  });
});

test("unknown inactive host navigation is loaded without changing the active host", async () => {
  const { calls, session, respond, attach } = fixture();
  __storeTesting.replaceState({ ...store.get(), sessionsByConnectionId: {} });
  respond(async (method) =>
    method === "workspace.list"
      ? { navigation_mode: "browser-local", workspaces: session.workspaces }
      : method === "tab.list"
        ? { tabs: session.tabs }
        : method === "pane.list"
          ? { panes: session.panes }
          : {},
  );
  const demanded = demandedSource();
  const pending = store.createQualifiedTab(
    { connectionId: "beta", runtimeGeneration: 7 },
    "b",
  );
  await demanded;
  expect(calls.some((call) => call.method === "tab.create")).toBe(false);
  expect(calls.every((call) => call.host === "beta")).toBe(true);
  expect(store.get().activeConnectionId).toBe("alpha");
  attach("beta");
  await pending;
  expect(
    calls.find((call) => call.method === "tab.create")?.params,
  ).toMatchObject({ focus: false, browser_source: { workspace_id: "b" } });
  expect(connectionSnapshot(store.get(), "beta").navigationMode).toBe(
    "browser-local",
  );
});

test("only an authoritative empty browser-local host bootstraps without a source", async () => {
  const { calls, respond } = fixture();
  __storeTesting.replaceState({ ...store.get(), sessionsByConnectionId: {} });
  respond(async (method) =>
    method === "workspace.list"
      ? { navigation_mode: "browser-local", workspaces: [] }
      : {},
  );
  await store.createQualifiedWorkspace(
    { connectionId: "beta", runtimeGeneration: 7 },
    "First",
  );
  expect(
    calls.find((call) => call.method === "workspace.create")?.params,
  ).toEqual({
    label: "First",
    cwd: undefined,
    focus: false,
    browser_source: null,
  });
  expect(creationSources()).toEqual([]);
  fixture();
  __storeTesting.replaceState({ ...store.get(), sessionsByConnectionId: {} });
  bridge.connection = (() => ({
    connectionId: "beta",
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async () => {
      throw new Error("Synthetic unavailable host");
    },
  })) as typeof bridge.connection;
  await expect(
    store.createQualifiedWorkspace(
      { connectionId: "beta", runtimeGeneration: 7 },
      "First",
    ),
  ).rejects.toThrow();
  expect(creationSources()).toEqual([]);
});

test("a missing source in a nonempty host never uses empty-host bootstrap", async () => {
  const { calls } = fixture();
  __storeTesting.replaceState({ ...store.get(), panes: [] });
  await expect(store.createQualifiedWorkspace(owner, "New")).rejects.toThrow(
    "No current source",
  );
  expect(calls).toEqual([]);
});

test("source closure or runtime replacement cancels preparation and releases demand", async () => {
  for (const retire of [false, true]) {
    const { calls } = fixture();
    const demanded = demandedSource();
    const pending = store.createQualifiedTab(owner, "b");
    void pending.catch(() => {});
    await demanded;
    __storeTesting.replaceState(
      retire
        ? {
            ...store.get(),
            connections: store.get().connections.map((connection) => ({
              ...connection,
              generation: 8,
            })),
          }
        : {
            ...store.get(),
            panes: store
              .get()
              .panes.filter((pane) => pane.workspace_id !== "b"),
          },
    );
    await expect(pending).rejects.toThrow(
      retire ? "destination host changed" : "source terminal moved",
    );
    expect(calls).toEqual([]);
    expect(creationSources()).toEqual([]);
  }
});

test("explicit selected pane takes precedence over another remembered tab in that workspace", async () => {
  const { calls, attach } = fixture();
  const sibling = {
    ...store.get().panes[1]!,
    tab_id: "b-other-tab",
    pane_id: "b-other-pane",
    terminal_id: "b-other-terminal",
  };
  __storeTesting.replaceState({
    ...store.get(),
    panes: [...store.get().panes, sibling],
  });
  attach("alpha", sibling.terminal_id);
  await store.createQualifiedTab(owner, "b", { sourcePaneId: sibling.pane_id });
  expect(
    calls.find((call) => call.method === "tab.create")?.params.browser_source,
  ).toEqual({
    workspace_id: "b",
    tab_id: sibling.tab_id,
    pane_id: sibling.pane_id,
    terminal_id: sibling.terminal_id,
  });
});

test("unsupported ownership is rejected and uncertain dispatch is never replayed", async () => {
  const { calls, attach, respond } = fixture();
  attach("alpha", "b-terminal", ["pane.focus"]);
  await expect(store.createQualifiedTab(owner, "b")).rejects.toThrow(
    "tab.create",
  );
  expect(calls).toEqual([]);
  attach();
  respond(async () => {
    throw new Error("Synthetic uncertain dispatch");
  });
  await expect(store.createQualifiedTab(owner, "b")).rejects.toThrow(
    "uncertain dispatch",
  );
  expect(calls.filter((call) => call.method === "tab.create")).toHaveLength(1);
  expect(creationSources()).toEqual([]);
});

test("shared mode creates without terminal preparation and naming failure preserves successful creation", async () => {
  const { calls, respond } = fixture("shared");
  const result = {
    type: "tab_created",
    tab: { tab_id: "new-tab", number: 3 },
    root_pane: { pane_id: "new-pane" },
  };
  respond(async (method) => {
    if (method === "tab.rename") throw new Error("Synthetic rename failure");
    return result;
  });
  const events: string[] = [];
  const off = subscribeCreations((event) => events.push(event.phase));
  try {
    expect(
      await store.createQualifiedTab(owner, "b", { numberedLabel: true }),
    ).toEqual(result);
  } finally {
    off();
  }
  expect(calls[0].params).toEqual({ workspace_id: "b", focus: true });
  expect(store.get().notice?.message).toBe("Tab created, but naming failed");
  expect(events).toEqual(["started", "dispatching", "created"]);
  expect(creationSources()).toEqual([]);
});

test("failed cached topology is refreshed before choosing shared mode or empty bootstrap", async () => {
  for (const staleEmpty of [false, true]) {
    const { calls, session, respond, attach } = fixture(
      staleEmpty ? "browser-local" : "shared",
    );
    __storeTesting.replaceState({
      ...store.get(),
      error: "Synthetic failed observation",
      ...(staleEmpty ? { workspaces: [], panes: [] } : {}),
    });
    respond(async (method) =>
      method === "workspace.list"
        ? { navigation_mode: "browser-local", workspaces: session.workspaces }
        : method === "tab.list"
          ? { tabs: session.tabs }
          : method === "pane.list"
            ? { panes: session.panes }
            : {},
    );
    const demanded = demandedSource();
    const pending = store.createQualifiedWorkspace(owner, "New", undefined, {
      sourceWorkspaceId: "b",
    });
    await demanded;
    expect(calls.some((call) => call.method === "workspace.create")).toBe(
      false,
    );
    attach();
    await pending;
    expect(
      calls.find((call) => call.method === "workspace.create")?.params,
    ).toMatchObject({ focus: false, browser_source: { workspace_id: "b" } });
  }
});

test("an uncertain creation retains its destination, reports possible creation and is never replayed", async () => {
  const { calls, attach, respond } = fixture();
  attach();
  respond(async () => {
    throw new UncertainRequestError(
      "tab.create",
      "Synthetic transport retirement",
    );
  });
  let failure: unknown;
  try {
    await store.createQualifiedTab(owner, "b");
  } catch (error) {
    failure = error;
  }
  expect(creationFailureMessage(failure, "Tab")).toContain(
    "may have been created",
  );
  expect(String(failure)).toContain("Destination alpha (runtime 7)");
  expect(calls.filter((call) => call.method === "tab.create")).toHaveLength(1);
  expect(creationSources()).toEqual([]);
});

test("acknowledged creation survives runtime retirement without publishing into its replacement", async () => {
  const { attach, respond } = fixture();
  attach();
  const result = { root_pane: { pane_id: "new-pane" } };
  respond(async () => {
    __storeTesting.replaceState({
      ...store.get(),
      connections: store
        .get()
        .connections.map((connection) => ({ ...connection, generation: 8 })),
    });
    return result;
  });
  expect(await store.createQualifiedTab(owner, "b")).toEqual(result);
  expect(store.get().selectedPaneId).toBe("a-pane");
});

test("unacknowledged preparation has a finite deadline and releases its owner demand", async () => {
  fixture();
  await expect(store.createQualifiedTab(owner, "b")).rejects.toThrow(
    "preparation timed out; nothing was created",
  );
  expect(creationSources()).toEqual([]);
}, 30_000);

test("source revocation between preparation acknowledgement and dispatch does not send a mutation", async () => {
  const { calls, attach } = fixture();
  const demanded = demandedSource();
  const pending = store.createQualifiedTab(owner, "b");
  await demanded;
  const { client, attempt } = attach();
  store.revokeTerminalAttachment(client, "b-terminal", attempt);
  await expect(pending).rejects.toThrow(
    "prepared source changed before dispatch",
  );
  expect(calls).toEqual([]);
  expect(creationSources()).toEqual([]);
});
