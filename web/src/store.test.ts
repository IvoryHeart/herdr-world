import { describe, expect, test } from "bun:test";
import { bridge, type ConnectionClient, UncertainRequestError } from "./api";
import {
  __storeTesting,
  operationalStore,
  activateConnectionState,
  automaticUpdateChecksEnabledFromStorage,
  bindTaskNotificationActivation,
  connectionEventIsActive,
  DEFAULT_NOTICE_AUTO_DISMISS_MS,
  emptyServerSessionState,
  healthMatchesUpdateVersion,
  herdrTaskNotificationsActive,
  isTaskNotificationTarget,
  mergeConnectionCatalog,
  nextRecentPaneIds,
  noticeAutoDismissDelay,
  numberedCreatedTabRename,
  parseHerdrTaskNotification,
  reconcileConnectionCatalogSessions,
  stabilizeRefreshPatch,
  type ServerSessionState,
  type State,
  store,
  summarizeDirectHookResult,
  TaskCompletionTracker,
  taskNotificationTag,
  taskNotificationTarget,
  taskNotificationTargetFromNotice,
  taskNotificationTargetIsCurrent,
  worktreeRemovalCompletionNotice,
} from "./store";
import type { Pane } from "./types";
import { removeTemporaryWorkspaceSafely } from "./worktreeLifecycle";
import { registerTerminalConnectionDisposer } from "./terminalConnection";

describe("current transport catalogue admission", () => {
  test("a failed or duplicate-ID refresh preserves the admitted catalogue", async () => {
    const previous = store.get();
    const call = bridge.call;
    try {
      __storeTesting.replaceState(partitionState());
      bridge.call = (async () => {
        throw Error("synthetic unavailable list");
      }) as typeof bridge.call;
      expect(await store.refreshConnections()).toBe(false);
      expect(store.get().catalogueReady).toBe(true);
      bridge.call = (async () => ({
        connections: [
          partitionState().connections[0],
          partitionState().connections[0],
        ],
      })) as typeof bridge.call;
      expect(await store.refreshConnections()).toBe(false);
      expect(
        store.get().connections.map((connection) => connection.id),
      ).toEqual(["alpha", "beta"]);
      expect(store.get().catalogueReady).toBe(true);
    } finally {
      bridge.call = call;
      __storeTesting.replaceState(previous);
    }
  });
  test("an old transport reply cannot admit or replace the new catalogue", async () => {
    const previous = store.get();
    const call = bridge.call;
    let epoch = bridge.connectionEpoch;
    Object.defineProperty(bridge, "connectionEpoch", {
      configurable: true,
      get: () => epoch,
    });
    const old = Promise.withResolvers<any>();
    const current = Promise.withResolvers<any>();
    let n = 0;
    bridge.call = (() =>
      ++n === 1 ? old.promise : current.promise) as typeof bridge.call;
    try {
      __storeTesting.replaceState({
        ...partitionState(),
        connections: [],
        catalogueReady: false,
      });
      const a = store.refreshConnections();
      epoch++;
      const b = store.refreshConnections();
      old.resolve({ connections: partitionState().connections });
      expect(await a).toBe(false);
      expect(store.get().catalogueReady).toBe(false);
      expect(store.get().connections).toEqual([]);
      current.resolve({ connections: [] });
      expect(await b).toBe(true);
      expect(store.get().catalogueReady).toBe(true);
      expect(store.get().connections).toEqual([]);
    } finally {
      delete (bridge as any).connectionEpoch;
      bridge.call = call;
      __storeTesting.replaceState(previous);
    }
  });
  test("reversed same-transport catalogues preserve the newest valid admission", async () => {
    const previous = store.get();
    const call = bridge.call;
    const old = Promise.withResolvers<any>();
    const current = Promise.withResolvers<any>();
    let n = 0;
    bridge.call = (() =>
      ++n === 1 ? old.promise : current.promise) as typeof bridge.call;
    try {
      __storeTesting.replaceState({
        ...partitionState(),
        catalogueReady: false,
      });
      const a = store.refreshConnections();
      const b = store.refreshConnections();
      current.resolve({ connections: partitionState().connections.slice(1) });
      await b;
      old.resolve({ connections: partitionState().connections });
      await a;
      expect(store.get().connections.map((c) => c.id)).toEqual(["beta"]);
      expect(store.get().catalogueReady).toBe(true);
    } finally {
      bridge.call = call;
      __storeTesting.replaceState(previous);
    }
  });
  test("a delayed initial catalogue stays unready until a successful empty admission", async () => {
    const previous = store.get();
    const call = bridge.call;
    const held = Promise.withResolvers<any>();
    bridge.call = (() => held.promise) as typeof bridge.call;
    try {
      __storeTesting.replaceState({ ...partitionState(), connections: [] });
      __storeTesting.markTerminalReattachPending();
      const request = __storeTesting.refreshBridgeStatus();
      expect((store.get() as any).catalogueReady).toBe(false);
      let publications = 0;
      const unsubscribe = store.subscribe(() => publications++);
      held.resolve({ connections: [], clients: 0, terminals: [] });
      await request;
      unsubscribe();
      expect((store.get() as any).catalogueReady).toBe(true);
      expect(publications).toBeGreaterThan(0);
    } finally {
      bridge.call = call;
      __storeTesting.replaceState(previous);
    }
  });
  test("malformed newer replies cannot suppress a valid earlier catalogue", async () => {
    const previous = store.get();
    const call = bridge.call;
    const first = Promise.withResolvers<any>();
    const second = Promise.withResolvers<any>();
    let n = 0;
    bridge.call = (() =>
      ++n === 1 ? first.promise : second.promise) as typeof bridge.call;
    try {
      __storeTesting.replaceState({ ...partitionState(), connections: [] });
      __storeTesting.markTerminalReattachPending();
      const a = __storeTesting.refreshBridgeStatus();
      const b = __storeTesting.refreshBridgeStatus();
      second.resolve({ connections: [{ id: "invalid" }] });
      await b;
      expect((store.get() as any).catalogueReady).toBe(false);
      first.resolve({ connections: partitionState().connections });
      await a;
      expect(store.get().connections.map((c) => c.id)).toEqual([
        "alpha",
        "beta",
      ]);
      expect((store.get() as any).catalogueReady).toBe(true);
    } finally {
      bridge.call = call;
      __storeTesting.replaceState(previous);
    }
  });
});

describe("automatic update check preference", () => {
  test("defaults to enabled and honors an explicit disabled value", () => {
    expect(automaticUpdateChecksEnabledFromStorage(undefined)).toBe(true);
    expect(
      automaticUpdateChecksEnabledFromStorage({
        getItem: () => "false",
      }),
    ).toBe(false);
    expect(
      automaticUpdateChecksEnabledFromStorage({
        getItem: () => "true",
      }),
    ).toBe(true);
  });

  test("falls back to enabled when browser storage is unavailable", () => {
    expect(
      automaticUpdateChecksEnabledFromStorage({
        getItem: () => {
          throw new Error("storage denied");
        },
      }),
    ).toBe(true);
  });

  test("cancels polling and ignores an in-flight automatic result when disabled", async () => {
    const previousState = store.get();
    const previousFetch = globalThis.fetch;
    const previousLocalStorage = globalThis.localStorage;
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: () => undefined },
    });
    try {
      __storeTesting.replaceState(partitionState());
      const automaticCheck = __storeTesting.startUpdatePolling();
      expect(__storeTesting.updatePollingActive()).toBe(true);

      store.setAutomaticUpdateChecksEnabled(false);
      expect(__storeTesting.updatePollingActive()).toBe(false);
      expect(store.get().automaticUpdateChecksEnabled).toBe(false);

      resolveFetch(
        Response.json({
          current_version: "0.4.5",
          latest_version: "0.5.0",
          update_available: true,
          can_auto_update: true,
          platform: "darwin-arm64",
        }),
      );
      await automaticCheck;
      expect(store.get().updateInfo).toBeNull();
    } finally {
      __storeTesting.replaceState(previousState);
      globalThis.fetch = previousFetch;
      if (previousLocalStorage === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  });

  test("restarts polling when enabled while manual checks bypass the preference", async () => {
    const previousState = store.get();
    const previousFetch = globalThis.fetch;
    const previousLocalStorage = globalThis.localStorage;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({
        current_version: "0.4.5",
        latest_version: "0.4.5",
        update_available: false,
        can_auto_update: true,
        platform: "darwin-arm64",
      });
    }) as unknown as typeof fetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: () => undefined },
    });
    try {
      __storeTesting.replaceState({
        ...partitionState(),
        automaticUpdateChecksEnabled: false,
      });

      store.setAutomaticUpdateChecksEnabled(true);
      expect(fetchCalls).toBe(1);
      expect(__storeTesting.updatePollingActive()).toBe(true);
      store.setAutomaticUpdateChecksEnabled(false);
      expect(__storeTesting.updatePollingActive()).toBe(false);

      await store.checkForUpdate();
      expect(fetchCalls).toBe(2);
      expect(store.get().notice?.message).toBe("Herdr World is up to date");
    } finally {
      __storeTesting.replaceState(previousState);
      globalThis.fetch = previousFetch;
      if (previousLocalStorage === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  });
});

describe("task notification activation", () => {
  test("notification creation and notice activation retain the original agent session", () => {
    const source = {
      ...pane("beta", "done"),
      agent_session: { value: "synthetic-original" },
    };
    const target = taskNotificationTarget("beta", 1, source);
    expect(target).toMatchObject({ agentSessionId: "synthetic-original" });
    const notice = {
      actionConnectionId: "beta",
      actionRuntimeGeneration: 1,
      actionWorkspaceId: source.workspace_id,
      actionPaneId: source.pane_id,
      actionAgentSessionId: "synthetic-original",
    };
    expect(taskNotificationTargetFromNotice(notice)).toMatchObject({
      agentSessionId: "synthetic-original",
    });
  });
  test("closes the system notification, focuses the window, and dispatches its pane target", () => {
    const calls: string[] = [];
    const targets: Array<{
      connectionId: string;
      runtimeGeneration: number;
      workspaceId: string;
      paneId: string;
    }> = [];
    const notification = {
      onclick: null as ((event: Event) => void) | null,
      close: () => calls.push("close"),
    };

    bindTaskNotificationActivation(
      notification,
      {
        connectionId: "alpha",
        runtimeGeneration: 1,
        workspaceId: "w1",
        paneId: "p2",
      },
      (target) => {
        calls.push("activate");
        targets.push(target);
      },
      () => calls.push("focus"),
    );
    notification.onclick?.(new Event("click"));

    expect(calls).toEqual(["close", "focus", "activate"]);
    expect(targets).toEqual([
      {
        connectionId: "alpha",
        runtimeGeneration: 1,
        workspaceId: "w1",
        paneId: "p2",
      },
    ]);
  });

  test("still dispatches navigation when browser window focus is denied", () => {
    let activated = false;
    const notification = {
      onclick: null as ((event: Event) => void) | null,
      close: () => undefined,
    };

    bindTaskNotificationActivation(
      notification,
      {
        connectionId: "alpha",
        runtimeGeneration: 1,
        workspaceId: "w1",
        paneId: "p2",
      },
      () => {
        activated = true;
      },
      () => {
        throw new Error("focus denied");
      },
    );

    expect(() => notification.onclick?.(new Event("click"))).not.toThrow();
    expect(activated).toBe(true);
  });

  test("rejects malformed notification targets", () => {
    expect(isTaskNotificationTarget(null)).toBe(false);
    expect(isTaskNotificationTarget({ workspaceId: "w1" })).toBe(false);
    expect(isTaskNotificationTarget({ workspaceId: "", paneId: "p2" })).toBe(
      false,
    );
    expect(
      isTaskNotificationTarget({
        connectionId: "alpha",
        runtimeGeneration: 1,
        workspaceId: "w1",
        paneId: "p2",
      }),
    ).toBe(true);
  });
});

function pane(connectionLabel: string, status: string): Pane {
  return {
    pane_id: "same-pane",
    terminal_id: "same-terminal",
    workspace_id: "same-workspace",
    tab_id: "same-tab",
    focused: false,
    agent: connectionLabel,
    agent_status: status,
    revision: 1,
  };
}

function session(
  label: string,
  runtimeGeneration = 1,
  overrides: Partial<ServerSessionState> = {},
): ServerSessionState {
  return {
    ...emptyServerSessionState(runtimeGeneration),
    workspaces: [
      {
        workspace_id: "same-workspace",
        number: 1,
        label,
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "same-tab",
        agent_status: "idle",
      },
    ],
    tabs: [
      {
        tab_id: "same-tab",
        workspace_id: "same-workspace",
        number: 1,
        label,
        focused: true,
        pane_count: 1,
        agent_status: "idle",
      },
    ],
    panes: [pane(label, "idle")],
    selectedPaneId: "same-pane",
    recentPaneIds: [`${label}-recent`, "same-pane"],
    pendingFocusWorkspaceId: `${label}-pending`,
    ...overrides,
  };
}

function partitionState(): State {
  const alpha = session("alpha");
  const beta = session("beta");
  return {
    ...alpha,
    status: "connected",
    catalogueReady: true,
    connectionPaused: false,
    bridgeStatus: null,
    connections: [
      {
        id: "alpha",
        label: "Alpha",
        source: "test",
        is_default: true,
        state: "ready",
        generation: 1,
      },
      {
        id: "beta",
        label: "Beta",
        source: "test",
        is_default: false,
        state: "ready",
        generation: 1,
      },
    ],
    defaultConnectionId: "alpha",
    activeConnectionId: "alpha",
    connectionGeneration: 10,
    sessionsByConnectionId: { alpha, beta },
    notice: null,
    taskNotificationsEnabled: false,
    taskNotificationPreferences: { completed: true, blocked: true },
    taskNotificationTransport: "local",
    taskNotificationBusy: false,
    taskNotificationPermission: "unsupported",
    automaticUpdateChecksEnabled: true,
    updateInfo: null,
    updateInstalling: false,
    pendingRestartVersion: null,
    dismissedUpdateVersion: null,
  };
}

describe("independent qualified operational sessions", () => {
  async function withIndependentClients(
    run: (
      calls: Array<{ host: string; method: string }>,
      held: ReturnType<typeof Promise.withResolvers<unknown>>,
    ) => Promise<void>,
  ) {
    const previous = store.get();
    const originalConnection = bridge.connection;
    const calls: Array<{ host: string; method: string }> = [];
    const held = Promise.withResolvers<unknown>();
    const jobs: Promise<unknown>[] = [];
    bridge.connection = ((connectionId = "alpha", runtimeGeneration = 1) => ({
      connectionId,
      generation: store.get().connectionGeneration,
      serverRuntimeGeneration: runtimeGeneration,
      isCurrent: () =>
        store
          .get()
          .connections.some(
            (entry) =>
              entry.id === connectionId &&
              entry.state === "ready" &&
              entry.generation === runtimeGeneration,
          ),
      acceptsServerGeneration: (value: unknown) => value === runtimeGeneration,
      call: async (method: string) => {
        calls.push({ host: connectionId, method });
        if (method === "workspace.focus") {
          const job = held.promise;
          jobs.push(job);
          return job;
        }
        if (method === "pane.get") return { pane: pane(connectionId, "idle") };
        if (method === "agent_session.get")
          return {
            status: "ok",
            pane_id: "same-pane",
            agent: connectionId,
            session: { value: "synthetic-replacement-session" },
            path: "/synthetic/session",
          };
        if (method === "workspace.list")
          return { workspaces: session(connectionId).workspaces };
        if (method === "tab.list") return { tabs: session(connectionId).tabs };
        if (method === "pane.list")
          return { panes: session(connectionId).panes };
        return {};
      },
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(partitionState());
      await run(calls, held);
    } finally {
      held.resolve({});
      await Promise.allSettled(jobs);
      bridge.connection = originalConnection;
      __storeTesting.replaceState(previous);
    }
  }

  test.each(
    ["create", "open", "open-from-cwd"].flatMap((operation) =>
      [false, true].map((superseded) => ({ operation, superseded })),
    ),
  )(
    "worktree navigation survives metadata refresh without overriding newer selection: %j",
    async ({ operation, superseded }) => {
      await withIndependentClients(async (_calls, held) => {
        const snapshot = store.get();
        const navigation = {
          revision: 10,
          workspaceId: "same-workspace",
          tabIds: { "same-workspace": "same-tab" },
          paneIds: { "same-tab": "same-pane" },
        };
        __storeTesting.replaceState({
          ...snapshot,
          sessionsByConnectionId: {
            ...snapshot.sessionsByConnectionId,
            beta: {
              ...snapshot.sessionsByConnectionId.beta!,
              navigationMode: "browser-local",
              browserNavigation: navigation,
            },
          },
        });
        const connection = bridge.connection;
        bridge.connection = ((id, generation) => {
          const client = connection(id, generation);
          return {
            ...client,
            call: async (method: string, params: Record<string, unknown>) => {
              const result = await client.call(method, params);
              if (method === "worktree.create" || method === "worktree.open")
                return held.promise;
              if (method === "workspace.list")
                return {
                  navigation_mode: "browser-local",
                  workspaces: [
                    ...session("beta").workspaces,
                    {
                      ...session("beta").workspaces[0]!,
                      workspace_id: "created-workspace",
                      active_tab_id: "created-tab",
                    },
                  ],
                };
              if (method === "tab.list")
                return {
                  tabs: [
                    ...session("beta").tabs,
                    {
                      ...session("beta").tabs[0]!,
                      workspace_id: "created-workspace",
                      tab_id: "created-tab",
                    },
                  ],
                };
              if (method === "pane.list")
                return {
                  panes: [
                    ...session("beta").panes,
                    {
                      ...pane("beta", "idle"),
                      workspace_id: "created-workspace",
                      tab_id: "created-tab",
                      pane_id: "created-pane",
                      terminal_id: "created-terminal",
                    },
                  ],
                };
              return result;
            },
          };
        }) as typeof bridge.connection;
        const owned = operationalStore({
          connectionId: "beta",
          runtimeGeneration: 1,
        });
        const pending =
          operation === "create"
            ? owned.createWorktree("same-workspace", "synthetic-branch")
            : operation === "open"
              ? owned.openWorktree("same-workspace", "synthetic-branch")
              : owned.openWorktreeFromCwd(
                  "/synthetic/repository",
                  "synthetic-branch",
                );
        void pending.catch(() => {});
        await owned.refresh();
        expect(owned.get().browserNavigation).not.toBe(navigation);
        expect(owned.get().browserNavigation.revision).toBe(10);
        if (superseded) {
          const current = store.get();
          __storeTesting.replaceState({
            ...current,
            sessionsByConnectionId: {
              ...current.sessionsByConnectionId,
              beta: {
                ...current.sessionsByConnectionId.beta!,
                browserNavigation: {
                  ...owned.get().browserNavigation,
                  revision: 11,
                },
              },
            },
          });
        }
        held.resolve({
          root_pane: {
            workspace_id: "created-workspace",
            tab_id: "created-tab",
            pane_id: "created-pane",
          },
        });
        await pending;
        expect(owned.get().browserNavigation.workspaceId).toBe(
          superseded ? "same-workspace" : "created-workspace",
        );
        expect(store.get().activeConnectionId).toBe("alpha");
      });
    },
  );

  test("a worktree reply from a retired owner cannot report successful completion or replay", async () => {
    await withIndependentClients(async (calls, held) => {
      const connection = bridge.connection;
      bridge.connection = ((id, generation) => {
        const client = connection(id, generation);
        return {
          ...client,
          call: async (method: string, ...args: unknown[]) => {
            const result = await client.call(
              method,
              ...(args as [Record<string, unknown>]),
            );
            return method === "worktree.open" ? held.promise : result;
          },
        };
      }) as typeof bridge.connection;
      const owned = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      const pending = owned.openWorktree(
        "same-workspace",
        "/synthetic/checkout",
      );
      const snapshot = store.get();
      __storeTesting.replaceState({
        ...snapshot,
        connections: snapshot.connections.map((owner) =>
          owner.id === "beta" ? { ...owner, generation: 2 } : owner,
        ),
      });
      held.resolve({ workspace_id: "same-workspace" });
      await expect(pending).rejects.toThrow();
      expect(calls.filter((call) => call.method === "worktree.open")).toEqual([
        { host: "beta", method: "worktree.open" },
      ]);
      expect(store.get().activeConnectionId).toBe("alpha");
    });
  });

  test.each(["single", "batch", "repo"])(
    "retired %s Git mutations preserve owning-host uncertainty without replay",
    async (kind) => {
      await withIndependentClients(async (calls, held) => {
        const connection = bridge.connection;
        const sent = Promise.withResolvers<void>();
        let submitted = 0;
        bridge.connection = ((id, generation) => {
          const client = connection(id, generation);
          return {
            ...client,
            call: async (method: string, params?: Record<string, unknown>) => {
              if (
                method === "git.file_action" ||
                method === "git.repo_action"
              ) {
                calls.push({ host: id!, method });
                if (kind === "batch" && ++submitted === 1) return {};
                sent.resolve();
                return held.promise;
              }
              return client.call(method, params);
            },
          };
        }) as typeof bridge.connection;
        const owned = operationalStore({
          connectionId: "beta",
          runtimeGeneration: 1,
        });
        const entry = { path: "synthetic.txt", size: 1, mtime_ms: 1 };
        const pending =
          kind === "single"
            ? owned.runGitFileAction("same-workspace", "stage", entry)
            : kind === "batch"
              ? owned.runGitFileActionBatch("same-workspace", "stage", [
                  entry,
                  { ...entry, path: "second.txt" },
                  { ...entry, path: "third.txt" },
                ])
              : owned.runGitRepoAction(
                  "same-workspace",
                  "discard_all_unstaged",
                );
        await sent.promise;
        const before = store.get();
        __storeTesting.replaceState({
          ...before,
          connections: before.connections.map((owner) =>
            owner.id === "beta"
              ? { ...owner, generation: 2, label: "Replacement" }
              : owner,
          ),
        });
        const count = calls.length;
        held.reject(
          new UncertainRequestError(
            "git mutation",
            "Synthetic runtime retired",
          ),
        );
        expect(await pending).toBeUndefined();
        expect(store.get().notice?.message).toBe("Action outcome is uncertain");
        expect(store.get().notice?.detail).toContain(
          "A change on Beta may have completed",
        );
        expect(store.get().notice?.detail).not.toContain("Replacement");
        if (kind === "batch")
          expect(store.get().notice?.detail).toContain(
            "1 of 3 files completed",
          );
        expect(calls.length).toBe(count);
        expect(store.get().activeConnectionId).toBe("alpha");
        expect(store.get().error).toBeNull();
      });
    },
  );

  test.each(["definite", "uncertain"])(
    "%s workspace focus failure stops the popup command chain",
    async (kind) => {
      await withIndependentClients(async (calls) => {
        const connection = bridge.connection;
        bridge.connection = ((id, generation) => ({
          ...connection(id, generation),
          call: async (method: string) => {
            calls.push({ host: id!, method });
            if (method === "popup.close") throw new Error("popup_not_open");
            if (method === "workspace.focus")
              throw kind === "uncertain"
                ? new UncertainRequestError(method, "Synthetic focus failure")
                : new Error("Synthetic focus failure");
            return {};
          },
        })) as typeof bridge.connection;
        const owned = operationalStore({
          connectionId: "beta",
          runtimeGeneration: 1,
        });
        expect(
          await owned.togglePluginPopup(
            "synthetic-plugin",
            "synthetic-action",
            { workspace_id: "same-workspace" },
          ),
        ).toBeUndefined();
        expect(calls.map((call) => call.method)).toEqual([
          "popup.close",
          "workspace.focus",
        ]);
        expect(store.get().notice?.message).toBe(
          kind === "uncertain"
            ? "Action outcome is uncertain"
            : "Plugin action failed",
        );
        expect(store.get().notice?.detail).toContain("Beta");
      });
    },
  );

  test.each(["skipped", "incomplete"])(
    "temporary workspace %s removal retains qualified cleanup failures",
    async (kind) => {
      await withIndependentClients(async (calls) => {
        const connection = bridge.connection;
        bridge.connection = ((id, generation) => ({
          ...connection(id, generation),
          call: async (method: string) => {
            calls.push({ host: id!, method });
            throw new Error("Synthetic temporary workspace close failure");
          },
        })) as typeof bridge.connection;
        const owned = operationalStore({
          connectionId: "beta",
          runtimeGeneration: 1,
        });
        await expect(
          removeTemporaryWorkspaceSafely({
            workspaceId: "temporary",
            temporary: true,
            remove: async () =>
              kind === "skipped" ? { skipped_remove: true } : undefined,
            close: async (id) => {
              await owned.closeWorkspaceOrThrow(id);
            },
          }),
        ).rejects.toThrow("Synthetic temporary workspace close failure");
        expect(calls).toEqual([{ host: "beta", method: "workspace.close" }]);
        expect(store.get().activeConnectionId).toBe("alpha");
      });
    },
  );

  test("qualified fire-and-forget commands handle failures with owning-host feedback", async () => {
    await withIndependentClients(async () => {
      const connection = bridge.connection;
      bridge.connection = ((id, generation) => ({
        ...connection(id, generation),
        call: async () => {
          throw new Error("Synthetic workspace command failed");
        },
      })) as typeof bridge.connection;
      const owned = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      for (const pending of [
        () => owned.renameWorkspace("same-workspace", "Synthetic name"),
        () => owned.closeWorkspace("same-workspace"),
      ]) {
        expect(await pending()).toBeUndefined();
        expect(owned.get().error).toBe("Synthetic workspace command failed");
        expect(store.get().notice).toMatchObject({
          kind: "error",
          message: "Command failed",
          detail: "Beta: Synthetic workspace command failed",
        });
        expect(store.get().error).toBeNull();
      }
    });
  });

  test("qualified pull retains progress, output and handled failure feedback", async () => {
    await withIndependentClients(async (_calls, held) => {
      const connection = bridge.connection;
      bridge.connection = ((id, generation) => {
        const client = connection(id, generation);
        return {
          ...client,
          call: async (method: string, params?: Record<string, unknown>) =>
            method === "git.pull" ? held.promise : client.call(method, params),
        };
      }) as typeof bridge.connection;
      const owned = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      const pending = owned.gitPullWorkspace("same-workspace");
      expect(store.get().notice?.message).toBe("Running git pull");
      expect(store.get().notice?.loading).toBe(true);
      held.resolve({ stdout: "Synthetic pull output", stderr: "" });
      await pending;
      expect(store.get().notice).toMatchObject({
        kind: "success",
        message: "Git pull completed",
        detail: "Synthetic pull output",
      });
      bridge.connection = ((id, generation) => ({
        ...connection(id, generation),
        call: async () => {
          throw new Error("Synthetic pull conflict");
        },
      })) as typeof bridge.connection;
      const failed = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      expect(await failed.gitPullWorkspace("same-workspace")).toBeUndefined();
      expect(store.get().notice).toMatchObject({
        kind: "error",
        message: "Git pull failed",
      });
      expect(store.get().notice?.detail).toContain("Synthetic pull conflict");
      expect(failed.get().error).toBe("Synthetic pull conflict");
      expect(store.get().activeConnectionId).toBe("alpha");
    });
  });

  test("captured worktree and destructive commands stay on beta and reject its replacement without replay", async () => {
    await withIndependentClients(async (calls) => {
      const owned = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      await owned.openWorktree("same-workspace", "/synthetic/checkout");
      await owned.renameWorkspace("same-workspace", "Synthetic renamed");
      await owned.closeTab("same-tab");
      expect(
        calls
          .filter((call) =>
            ["worktree.open", "workspace.rename", "tab.close"].includes(
              call.method,
            ),
          )
          .map((call) => call.host),
      ).toEqual(["beta", "beta", "beta"]);
      expect(store.get().activeConnectionId).toBe("alpha");
      const snapshot = store.get();
      __storeTesting.replaceState({
        ...snapshot,
        connections: snapshot.connections.map((owner) =>
          owner.id === "beta" ? { ...owner, generation: 2 } : owner,
        ),
      });
      const count = calls.length;
      await expect(
        owned.openWorktree("same-workspace", "/synthetic/checkout"),
      ).rejects.toThrow();
      await expect(
        owned.renameWorkspace("same-workspace", "Replacement must stay intact"),
      ).resolves.toBeUndefined();
      await expect(owned.closeTab("same-tab")).resolves.toBeUndefined();
      expect(calls.length).toBe(count);
      expect(store.get().activeConnectionId).toBe("alpha");
    });
  });

  test("opening a cold host waits for its already running topology refresh", async () => {
    await withIndependentClients(async (_calls, held) => {
      held.resolve({});
      const connection = bridge.connection;
      const topology = Promise.withResolvers<unknown>();
      let first = true;
      bridge.connection = ((...args: Parameters<typeof bridge.connection>) => {
        const client = connection(...args);
        return {
          ...client,
          call: async (method: string, params = {}) => {
            if (method === "workspace.list" && first) {
              first = false;
              return topology.promise;
            }
            return client.call(method, params);
          },
        };
      }) as typeof bridge.connection;
      const snapshot = partitionState();
      __storeTesting.replaceState({
        ...snapshot,
        sessionsByConnectionId: {
          ...snapshot.sessionsByConnectionId,
          beta: emptyServerSessionState(1),
        },
      });
      const owned = operationalStore({
        connectionId: "beta",
        runtimeGeneration: 1,
      });
      const refresh = owned.refresh();
      const focused = store.focusQualifiedTarget({
        connectionId: "beta",
        runtimeGeneration: 1,
        workspaceId: "same-workspace",
        paneId: "same-pane",
      });
      try {
        topology.resolve({
          workspaces: snapshot.sessionsByConnectionId.beta.workspaces,
          navigation_mode: "browser-local",
        });
        expect(await focused).toBe(true);
        expect(owned.get().selectedPaneId).toBe("same-pane");
        expect(store.get().activeConnectionId).toBe("alpha");
      } finally {
        topology.resolve({ workspaces: [] });
        await refresh;
        bridge.connection = connection;
      }
    });
  });

  test("focuses a ready sibling host's colliding pane without replacing another session", async () => {
    await withIndependentClients(async (calls, held) => {
      const snapshot = partitionState();
      const beta = {
        ...snapshot.sessionsByConnectionId.beta,
        navigationMode: "browser-local" as const,
      };
      __storeTesting.replaceState({
        ...snapshot,
        sessionsByConnectionId: { ...snapshot.sessionsByConnectionId, beta },
      });
      const alphaBefore = structuredClone(
        store.get().sessionsByConnectionId.alpha,
      );
      held.resolve({});
      expect(
        await store.focusQualifiedTarget({
          connectionId: "beta",
          runtimeGeneration: 1,
          workspaceId: "same-workspace",
          paneId: "same-pane",
        }),
      ).toBe(true);
      expect(
        calls.some(
          (call) => call.host === "beta" && call.method === "pane.get",
        ),
      ).toBe(true);
      expect(calls.some((call) => call.host === "alpha")).toBe(false);
      expect(store.get().sessionsByConnectionId.alpha).toEqual(alphaBefore);
      expect(store.get().sessionsByConnectionId.beta.selectedPaneId).toBe(
        "same-pane",
      );
    });
  });
  test("notification navigation retains a sibling owner's context without activating it globally", async () => {
    await withIndependentClients(async (calls, held) => {
      held.resolve({});
      const before = structuredClone(store.get().sessionsByConnectionId.alpha);
      const target = taskNotificationTarget("beta", 1, pane("beta", "done"));
      await store.focusTaskNotificationTarget(target);
      expect(
        calls.some(
          (call) => call.host === "beta" && call.method === "pane.get",
        ),
      ).toBe(true);
      expect(calls.some((call) => call.host === "alpha")).toBe(false);
      expect(store.get().activeConnectionId).toBe("alpha");
      expect(store.get().sessionsByConnectionId.alpha).toEqual(before);
    });
  });
  test("a queued notification cannot focus a replacement session after its original lookup was admitted", async () => {
    await withIndependentClients(async (calls, held) => {
      const connection = bridge.connection;
      const focusStarted = Promise.withResolvers<void>();
      const sessionRead = Promise.withResolvers<void>();
      let identity = "synthetic-original";
      bridge.connection = ((id, generation) => {
        const client = connection(id, generation);
        return {
          ...client,
          call: async (method: string, params?: Record<string, unknown>) => {
            if (method === "workspace.focus") focusStarted.resolve();
            if (method === "agent_session.get") {
              const captured = identity;
              sessionRead.resolve();
              return { session: { value: captured } };
            }
            const result = await client.call(method, params);
            return method === "pane.get"
              ? {
                  ...result,
                  pane: { ...result.pane, agent_session: { value: identity } },
                }
              : result;
          },
        };
      }) as typeof bridge.connection;
      const first = store.focusQualifiedTarget({
        connectionId: "beta",
        runtimeGeneration: 1,
        workspaceId: "same-workspace",
        paneId: null,
      });
      await focusStarted.promise;
      const notification = store.focusTaskNotificationTarget({
        connectionId: "beta",
        runtimeGeneration: 1,
        workspaceId: "same-workspace",
        paneId: "same-pane",
        agentSessionId: identity,
      });
      await sessionRead.promise;
      identity = "synthetic-replacement";
      held.resolve({});
      await first;
      expect(await notification).toBe(false);
      expect(calls.filter((call) => call.method === "workspace.focus")).toEqual(
        [{ host: "beta", method: "workspace.focus" }],
      );
      expect(calls.some((call) => call.method === "tab.focus")).toBe(false);
      expect(store.get().notice?.message).toBe(
        "Notification target is unavailable",
      );
    });
  });
  test("browser-observed completion without an original session remains visible without a replacement target", async () => {
    await withIndependentClients(async () => {
      const connection = bridge.connection;
      let status = "working";
      bridge.connection = ((id, generation) => {
        const client = connection(id, generation);
        return {
          ...client,
          call: async (method: string, params?: Record<string, unknown>) =>
            method === "pane.list"
              ? { panes: [pane("alpha", status)] }
              : client.call(method, params),
        };
      }) as typeof bridge.connection;
      __storeTesting.replaceState({
        ...store.get(),
        taskNotificationsEnabled: true,
        taskNotificationTransport: "push",
      });
      await store.refresh();
      status = "done";
      await store.refresh();
      expect(store.get().notice?.message).toBe("Task completed");
      expect(store.get().notice?.actionPaneId).toBeUndefined();
      expect(store.get().notice?.detail).toContain(
        "session identity is unavailable",
      );
    });
  });
  test("a missing creation capability on beta does not block an independently admitted alpha creation", async () => {
    await withIndependentClients(async (calls, held) => {
      held.resolve({});
      const before = store.get();
      const beta = {
        ...before.sessionsByConnectionId.beta,
        navigationMode: "browser-local" as const,
        browserNavigation: {
          revision: 1,
          workspaceId: "same-workspace",
          tabIds: { "same-workspace": "same-tab" },
          paneIds: { "same-tab": "same-pane" },
        },
        endpointAvailability: {
          "same-terminal": { methods: ["pane.focus"], capabilities: [] },
        },
      };
      __storeTesting.replaceState({
        ...before,
        sessionsByConnectionId: { ...before.sessionsByConnectionId, beta },
      });
      await expect(
        store.createQualifiedTab(
          { connectionId: "beta", runtimeGeneration: 1 },
          "same-workspace",
        ),
      ).rejects.toThrow("tab.create");
      expect(
        calls.some(
          (call) => call.host === "beta" && call.method === "tab.create",
        ),
      ).toBe(false);
      await store.createQualifiedTab(
        { connectionId: "alpha", runtimeGeneration: 1 },
        "same-workspace",
      );
      expect(calls.filter((call) => call.method === "tab.create")).toEqual([
        { host: "alpha", method: "tab.create" },
      ]);
    });
  });
  test("a notification cannot navigate to a reused pane in a different workspace", async () => {
    await withIndependentClients(async (calls, held) => {
      held.resolve({});
      const target = taskNotificationTarget("beta", 1, {
        ...pane("beta", "done"),
        workspace_id: "retired-workspace",
      });
      await store.focusTaskNotificationTarget(target);
      expect(
        calls.filter(
          (call) =>
            call.method === "workspace.focus" || call.method === "tab.focus",
        ),
      ).toEqual([]);
      expect(store.get().activeConnectionId).toBe("alpha");
      expect(store.get().notice?.kind === "error" || !!store.get().error).toBe(
        true,
      );
    });
  });
  test("a session-qualified notification cannot open a replacement agent session in the same pane", async () => {
    await withIndependentClients(async (calls, held) => {
      held.resolve({});
      // Additive target identity; the wire spelling may evolve with the
      // producer, but losing the captured session must never admit its successor.
      const target = {
        ...taskNotificationTarget("beta", 1, pane("beta", "done")),
        agentSessionId: "synthetic-original-session",
      };
      await store.focusTaskNotificationTarget(target);
      expect(
        calls.some(
          (call) =>
            call.method === "workspace.focus" || call.method === "tab.focus",
        ),
      ).toBe(false);
      expect(store.get().activeConnectionId).toBe("alpha");
      expect(store.get().notice?.kind === "error" || !!store.get().error).toBe(
        true,
      );
    });
  });
  test.each(["disconnected", "error"] as const)(
    "notification admission rejects a %s owner even when its generation is unchanged",
    (state) => {
      const snapshot = partitionState();
      const target = taskNotificationTarget("beta", 1, pane("beta", "done"));
      expect(
        taskNotificationTargetIsCurrent(
          {
            connections: snapshot.connections.map((connection) =>
              connection.id === "beta" ? { ...connection, state } : connection,
            ),
          },
          target,
        ),
      ).toBe(false);
    },
  );

  test("a stalled focus on alpha does not serialize independent beta focus behind it", async () => {
    await withIndependentClients(async (calls, held) => {
      const alpha = store.focusQualifiedTarget({
        connectionId: "alpha",
        runtimeGeneration: 1,
        workspaceId: "same-workspace",
        paneId: null,
      });
      const beta = store.focusQualifiedTarget({
        connectionId: "beta",
        runtimeGeneration: 1,
        workspaceId: "same-workspace",
        paneId: null,
      });
      try {
        // Flush the existing async focus dispatch chain, without a timeout or status loop.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(
          calls
            .filter((call) => call.method === "workspace.focus")
            .map((call) => call.host)
            .sort(),
        ).toEqual(["alpha", "beta"]);
      } finally {
        held.resolve({});
        await Promise.allSettled([alpha, beta]);
      }
    });
  });

  test("captured operational commands and endpoint publication stay on alpha after beta focus", async () => {
    await withIndependentClients(async (calls) => {
      const alpha = operationalStore({
        connectionId: "alpha",
        runtimeGeneration: 1,
      });
      __storeTesting.replaceState(
        activateConnectionState(store.get(), "beta", 11),
      );
      await alpha.zoomPane("same-pane");
      expect(calls.filter((call) => call.method === "pane.zoom")).toEqual([
        { host: "alpha", method: "pane.zoom" },
      ]);
      const client = bridge.connection("alpha", 1);
      store.setTerminalEndpoint(client, "same-terminal", {
        methods: ["pane.focus"],
        capabilities: [],
      });
      expect(
        alpha.get().endpointAvailability["same-terminal"]?.methods,
      ).toContain("pane.focus");
      expect(store.get().endpointAvailability["same-terminal"]).toBeUndefined();
      const current = store.get();
      __storeTesting.replaceState({
        ...current,
        connections: current.connections.map((connection) =>
          connection.id === "alpha"
            ? { ...connection, generation: 2 }
            : connection,
        ),
      });
      const before = calls.length;
      await expect(alpha.zoomPane("same-pane")).resolves.toBeUndefined();
      expect(calls).toHaveLength(before);
    });
  });

  test.each(["replacement", "removal"] as const)(
    "catalogue %s retires beta terminal presenters without detaching alpha",
    async (transition) => {
      const previous = store.get();
      const disposals: Array<{ host: string; remote: boolean }> = [];
      const releaseAlpha = registerTerminalConnectionDisposer(
        { connectionId: "alpha", generation: 1 },
        (remote) => disposals.push({ host: "alpha", remote }),
      );
      const releaseBeta = registerTerminalConnectionDisposer(
        { connectionId: "beta", generation: 1 },
        (remote) => disposals.push({ host: "beta", remote }),
      );
      try {
        const snapshot = partitionState();
        __storeTesting.replaceState(snapshot);
        __storeTesting.applyCatalog(
          transition === "removal"
            ? snapshot.connections.filter((entry) => entry.id !== "beta")
            : snapshot.connections.map((entry) =>
                entry.id === "beta" ? { ...entry, generation: 2 } : entry,
              ),
          "alpha",
        );
        expect(disposals).toEqual([{ host: "beta", remote: false }]);
        expect(store.get().sessionsByConnectionId.alpha.panes).toEqual(
          snapshot.sessionsByConnectionId.alpha.panes,
        );
        if (transition === "removal")
          expect(store.get().sessionsByConnectionId.beta).toBeUndefined();
        else expect(store.get().sessionsByConnectionId.beta.panes).toEqual([]);
      } finally {
        releaseAlpha();
        releaseBeta();
        __storeTesting.replaceState(previous);
      }
    },
  );
});

describe("Git folder actions", () => {
  test.each([
    ["stage", -1],
    ["unstage", 0],
    ["discard_unstaged", 1],
    ["delete_untracked", 2],
  ] as const)(
    "%s reports progress and refreshes after failure at %d",
    async (gitAction, failAt) => {
      const previousState = store.get();
      const originalConnection = bridge.connection;
      const entries = ["one.ts", "two.ts", "three.ts"].map((path) => ({
        path,
        old_path: `old/${path}`,
        mtime_ms: 123,
        size: 456,
      }));
      const mutations: Record<string, unknown>[] = [];
      const refreshCalls: string[] = [];
      bridge.connection = () => ({
        connectionId: "alpha",
        generation: 10,
        serverRuntimeGeneration: 1,
        isCurrent: () => true,
        acceptsServerGeneration: (generation) => generation === 1,
        call: async (method, params) => {
          if (method === "git.file_action") {
            mutations.push(params!);
            if (mutations.length - 1 === failAt)
              throw new Error("File changed");
            return {};
          }
          refreshCalls.push(method);
          return {};
        },
      });
      try {
        __storeTesting.replaceState(partitionState());
        const result = await store.runGitFileActionBatch(
          "same-workspace",
          gitAction,
          entries,
        );
        const completed = failAt < 0 ? entries.length : failAt;
        expect(result).toBe(failAt < 0 ? completed : undefined);
        expect(mutations).toEqual(
          entries
            .slice(0, failAt < 0 ? entries.length : failAt + 1)
            .map((entry) => ({
              workspace_id: "same-workspace",
              action: gitAction,
              ...entry,
            })),
        );
        expect(refreshCalls).toEqual(
          completed
            ? ["workspace.list", "tab.list", "pane.list", "agent.list"]
            : [],
        );
        expect(store.get().notice?.kind).toBe(failAt < 0 ? "success" : "error");
        if (failAt >= 0) {
          expect(store.get().notice?.detail).toBe(
            `${completed} of 3 files completed. File changed`,
          );
        }
      } finally {
        bridge.connection = originalConnection;
        __storeTesting.replaceState(previousState);
      }
    },
  );
});

describe("connection-partitioned store state", () => {
  test("keeps the store generation aligned when pausing an already-disconnected bridge", () => {
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: () => undefined },
    });
    try {
      const before = bridge.clientGeneration;
      expect(bridge.status).toBe("disconnected");
      store.pauseConnection();
      expect(bridge.clientGeneration).toBe(before + 1);
      expect(store.get().connectionGeneration).toBe(bridge.clientGeneration);
    } finally {
      if (previousLocalStorage === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  });

  test("uses distinct notices for reconnecting and resuming browser sync", () => {
    const previousState = store.get();
    const previousLocalStorage = globalThis.localStorage;
    const originalConnect = bridge.connect;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: () => undefined },
    });
    bridge.connect = () => undefined;
    try {
      __storeTesting.replaceState({
        ...partitionState(),
        status: "disconnected",
        automaticUpdateChecksEnabled: false,
      });
      store.resumeConnection();
      expect(store.get().notice?.message).toBe("Reconnecting browser");

      __storeTesting.replaceState({
        ...partitionState(),
        status: "disconnected",
        connectionPaused: true,
        automaticUpdateChecksEnabled: false,
      });
      store.resumeConnection();
      expect(store.get().notice?.message).toBe("Resuming browser sync");
    } finally {
      bridge.connect = originalConnect;
      __storeTesting.replaceState(previousState);
      if (previousLocalStorage === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  });

  test("rearms terminal attachment when status polling recovers a failed catalog", async () => {
    const previousState = store.get();
    const originalCall = bridge.call;
    const snapshot = {
      ...partitionState(),
      terminalAttachEpoch: 7,
    };
    bridge.call = (async (method: string) => {
      expect(method).toBe("bridge.status");
      return {
        clients: 2,
        terminals: [],
        connections: snapshot.connections,
        default_connection_id: snapshot.defaultConnectionId,
      };
    }) as typeof bridge.call;
    try {
      __storeTesting.replaceState(snapshot);
      __storeTesting.markTerminalReattachPending();

      await __storeTesting.refreshBridgeStatus();

      expect(store.get().terminalAttachEpoch).toBe(8);
      expect(store.get().bridgeStatus?.clients).toBe(2);
      expect(__storeTesting.rearmTerminalAttachmentsAfterCatalog(true)).toBe(
        false,
      );
    } finally {
      bridge.call = originalCall;
      __storeTesting.replaceState(previousState);
    }
  });

  test("preserves profile DTO fields across transition bridge-status catalogs", () => {
    const previous = [
      {
        ...partitionState().connections[0],
        type: "local" as const,
        read_only: false,
        auto_connect: true,
        control_socket_path: "/tmp/alpha.sock",
        client_socket_path: "/tmp/alpha-client.sock",
      },
    ];
    const merged = mergeConnectionCatalog(previous, [
      {
        id: "alpha",
        label: "Alpha renamed",
        source: "local-profile",
        is_default: true,
        state: "connecting",
        generation: 2,
      },
    ]);
    expect(merged[0]).toMatchObject({
      label: "Alpha renamed",
      state: "connecting",
      generation: 2,
      type: "local",
      read_only: false,
      auto_connect: true,
      control_socket_path: "/tmp/alpha.sock",
      client_socket_path: "/tmp/alpha-client.sock",
    });
  });

  test("preserves SSH profile DTO fields across transition status catalogs", () => {
    const previous = [
      {
        ...partitionState().connections[0],
        source: "ssh-profile",
        type: "ssh" as const,
        read_only: false,
        auto_connect: true,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr-client.sock",
      },
    ];
    const merged = mergeConnectionCatalog(previous, [
      {
        id: "alpha",
        label: "Remote renamed",
        source: "ssh-profile",
        is_default: true,
        state: "connecting",
        generation: 2,
      },
    ]);
    expect(merged[0]).toMatchObject({
      label: "Remote renamed",
      type: "ssh",
      ssh_destination: "operator@dev-box",
      remote_control_socket_path: "/remote/herdr.sock",
      remote_client_socket_path: "/remote/herdr-client.sock",
    });
  });

  test("drops opposite transport fields when a profile changes type", () => {
    const previous = [
      {
        ...partitionState().connections[0],
        type: "local" as const,
        read_only: false,
        auto_connect: false,
        control_socket_path: "/tmp/old-control.sock",
        client_socket_path: "/tmp/old-render.sock",
      },
    ];
    const [changed] = mergeConnectionCatalog(previous, [
      {
        id: "alpha",
        label: "Remote Alpha",
        source: "ssh-profile",
        is_default: true,
        state: "disconnected",
        generation: 2,
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr-client.sock",
      },
    ]);
    expect(changed.type).toBe("ssh");
    expect(changed.control_socket_path).toBeUndefined();
    expect(changed.client_socket_path).toBeUndefined();
    expect(changed.ssh_destination).toBe("operator@dev-box");
  });

  test("restores sessions whose server resource IDs deliberately collide", () => {
    const alpha = partitionState();
    const beta = activateConnectionState(alpha, "beta", 11);

    expect(beta.activeConnectionId).toBe("beta");
    expect(beta.workspaces[0]?.label).toBe("beta");
    expect(beta.pendingFocusWorkspaceId).toBe("beta-pending");
    expect(beta.recentPaneIds).toEqual(["beta-recent", "same-pane"]);

    const restoredAlpha = activateConnectionState(beta, "alpha", 12);
    expect(restoredAlpha.workspaces[0]?.label).toBe("alpha");
    expect(restoredAlpha.pendingFocusWorkspaceId).toBe("alpha-pending");
    expect(restoredAlpha.recentPaneIds).toEqual(["alpha-recent", "same-pane"]);
  });

  test("empties active resources on a runtime replacement", () => {
    const snapshot = partitionState();
    const connections = snapshot.connections.map((connection) =>
      connection.id === "alpha" ? { ...connection, generation: 2 } : connection,
    );
    const reconciliation = reconcileConnectionCatalogSessions(
      snapshot,
      connections,
    );

    expect(reconciliation.activeRuntimeChanged).toBe(true);
    expect(reconciliation.activeSession).toMatchObject({
      serverRuntimeGeneration: 2,
      workspaces: [],
      tabs: [],
      panes: [],
      layout: null,
      selectedPaneId: null,
      pendingFocusWorkspaceId: null,
    });
    expect(reconciliation.activeSession?.panes).not.toContainEqual(
      expect.objectContaining({ terminal_id: "same-terminal" }),
    );
  });

  test("falls back to the default when the active profile is removed", () => {
    const originalSetActiveConnection = bridge.setActiveConnection;
    bridge.setActiveConnection = (() =>
      22) as typeof bridge.setActiveConnection;
    try {
      const snapshot = activateConnectionState(partitionState(), "beta", 11);
      __storeTesting.replaceState(snapshot);
      __storeTesting.applyCatalog(
        snapshot.connections.filter((connection) => connection.id === "alpha"),
        "alpha",
      );
      expect(store.get().activeConnectionId).toBe("alpha");
      expect(store.get().connectionGeneration).toBe(22);
      expect(store.get().workspaces[0]?.label).toBe("alpha");
    } finally {
      bridge.setActiveConnection = originalSetActiveConnection;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("publishes an empty active session before replacement refresh", () => {
    const originalAdvanceGeneration = bridge.advanceActiveConnectionGeneration;
    bridge.advanceActiveConnectionGeneration = (() =>
      99) as typeof bridge.advanceActiveConnectionGeneration;
    try {
      const snapshot = partitionState();
      __storeTesting.replaceState(snapshot);
      __storeTesting.applyCatalog(
        snapshot.connections.map((connection) =>
          connection.id === "alpha"
            ? { ...connection, generation: 2 }
            : connection,
        ),
        "alpha",
      );
      expect(store.get()).toMatchObject({
        activeConnectionId: "alpha",
        connectionGeneration: 99,
        serverRuntimeGeneration: 2,
        workspaces: [],
        tabs: [],
        panes: [],
        layout: null,
        selectedPaneId: null,
      });
    } finally {
      bridge.advanceActiveConnectionGeneration = originalAdvanceGeneration;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("invalidates an inactive replacement before it can be restored", () => {
    const snapshot = partitionState();
    const connections = snapshot.connections.map((connection) =>
      connection.id === "beta" ? { ...connection, generation: 2 } : connection,
    );
    const reconciliation = reconcileConnectionCatalogSessions(
      snapshot,
      connections,
    );
    const reconciled: State = {
      ...snapshot,
      ...(reconciliation.activeSession ?? {}),
      connections,
      sessionsByConnectionId: reconciliation.sessionsByConnectionId,
    };
    const beta = activateConnectionState(reconciled, "beta", 11);

    expect(beta.serverRuntimeGeneration).toBe(2);
    expect(beta.workspaces).toEqual([]);
    expect(beta.tabs).toEqual([]);
    expect(beta.panes).toEqual([]);
    expect(beta.selectedPaneId).toBeNull();
    expect(beta.sessionsByConnectionId.beta?.panes).toEqual([]);
  });

  test("drives real refresh and action paths without stale publication after a switch", async () => {
    const originalConnection = bridge.connection;
    const originalSetActiveConnection = bridge.setActiveConnection;
    let activeConnectionId = "alpha";
    let browserGeneration = 10;
    let mode: "refresh" | "action" = "refresh";
    let startedRefreshCalls = 0;
    let signalRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefreshStarted = resolve;
    });
    let resolveWorkspaces!: (value: unknown) => void;
    let resolveTabs!: (value: unknown) => void;
    let resolvePanes!: (value: unknown) => void;
    let resolveAction!: (value: unknown) => void;
    const workspaceResult = new Promise((resolve) => {
      resolveWorkspaces = resolve;
    });
    const tabResult = new Promise((resolve) => {
      resolveTabs = resolve;
    });
    const paneResult = new Promise((resolve) => {
      resolvePanes = resolve;
    });
    const actionResult = new Promise((resolve) => {
      resolveAction = resolve;
    });
    const callsFor = ((method: string) => {
      if (mode === "action") return actionResult;
      startedRefreshCalls += 1;
      if (startedRefreshCalls === 3) signalRefreshStarted();
      if (method === "workspace.list") return workspaceResult;
      if (method === "tab.list") return tabResult;
      if (method === "pane.list") return paneResult;
      return Promise.reject(new Error(`unexpected method: ${method}`));
    }) as ConnectionClient["call"];

    bridge.connection = ((
      connectionId = activeConnectionId,
      serverRuntimeGeneration: number | null = 1,
    ) => {
      const generation = browserGeneration;
      return {
        connectionId,
        generation,
        serverRuntimeGeneration,
        call: callsFor,
        isCurrent: () =>
          activeConnectionId === connectionId &&
          browserGeneration === generation,
        acceptsServerGeneration: (value: unknown) =>
          value === serverRuntimeGeneration,
      };
    }) as typeof bridge.connection;
    bridge.setActiveConnection = ((connectionId: string) => {
      if (connectionId !== activeConnectionId) {
        activeConnectionId = connectionId;
        browserGeneration += 1;
      }
      return browserGeneration;
    }) as typeof bridge.setActiveConnection;

    try {
      __storeTesting.replaceState(partitionState());
      const refresh = store.refresh();
      await refreshStarted;
      expect(store.selectConnection("beta")).toBe(true);
      resolveWorkspaces({ workspaces: session("stale-refresh").workspaces });
      resolveTabs({ tabs: session("stale-refresh").tabs });
      resolvePanes({ panes: session("stale-refresh").panes });
      await refresh;
      expect(store.get().activeConnectionId).toBe("beta");
      expect(store.get().workspaces[0]?.label).toBe("beta");
      expect(store.get().error).toBeNull();
      expect(store.get().notice).toBeNull();

      activeConnectionId = "alpha";
      browserGeneration = 20;
      mode = "action";
      __storeTesting.replaceState({
        ...partitionState(),
        connectionGeneration: browserGeneration,
      });
      const action = store.createWorkspace("stale-action");
      expect(store.selectConnection("beta")).toBe(true);
      resolveAction({ workspace: { workspace_id: "same-workspace" } });
      await action;
      expect(store.get().activeConnectionId).toBe("beta");
      expect(store.get().workspaces[0]?.label).toBe("beta");
      expect(store.get().error).toBeNull();
      expect(store.get().notice).toBeNull();
    } finally {
      bridge.connection = originalConnection;
      bridge.setActiveConnection = originalSetActiveConnection;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("filters inactive events and keeps task transitions partitioned", () => {
    const snapshot = activateConnectionState(partitionState(), "beta", 11);
    expect(connectionEventIsActive(snapshot, "alpha")).toBe(false);
    expect(connectionEventIsActive(snapshot, "beta")).toBe(true);
    expect(connectionEventIsActive(snapshot, "beta", 0, true)).toBe(false);
    expect(connectionEventIsActive(snapshot, "beta", 1, true)).toBe(true);

    const tracker = new TaskCompletionTracker();
    expect(tracker.update("alpha", [pane("alpha", "working")])).toEqual([]);
    expect(tracker.update("beta", [pane("beta", "done")])).toEqual([]);
    expect(tracker.update("alpha", [pane("alpha", "done")])).toEqual([
      pane("alpha", "done"),
    ]);
    expect(tracker.update("beta", [pane("beta", "working")])).toEqual([]);
    expect(tracker.update("beta", [pane("beta", "idle")])).toEqual([
      pane("beta", "idle"),
    ]);
    tracker.reset("alpha");
    expect(tracker.update("alpha", [pane("alpha", "done")])).toEqual([]);
  });

  test("fences every Office room mutation before dispatch and after completion", async () => {
    const previousState = store.get();
    const originalConnection = bridge.connection;
    const target = { connectionId: "alpha", runtimeGeneration: 1 };
    const mutations: Array<{
      method: string;
      run: () => Promise<unknown>;
    }> = [
      {
        method: "tab.create",
        run: () => store.createQualifiedTab(target, "same-workspace"),
      },
      {
        method: "workspace.create",
        run: () => store.createQualifiedWorkspace(target, "New room"),
      },
      {
        method: "workspace.rename",
        run: () =>
          store.renameQualifiedWorkspace(target, "same-workspace", "Renamed"),
      },
      {
        method: "workspace.close",
        run: () => store.closeQualifiedWorkspace(target, "same-workspace"),
      },
    ];

    try {
      const preDispatchCalls: string[] = [];
      bridge.connection = (() => ({
        connectionId: "beta",
        generation: 11,
        serverRuntimeGeneration: 1,
        call: async (method: string) => {
          preDispatchCalls.push(method);
          return {};
        },
        isCurrent: () => true,
        acceptsServerGeneration: (generation: unknown) => generation === 1,
      })) as typeof bridge.connection;
      __storeTesting.replaceState(
        activateConnectionState(partitionState(), "beta", 11),
      );
      for (const mutation of mutations) {
        await expect(mutation.run()).rejects.toThrow("selected host changed");
      }
      expect(preDispatchCalls).toEqual([]);

      for (const mutation of mutations) {
        __storeTesting.replaceState(partitionState());
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        const calls: Array<{ connectionId: string; method: string }> = [];
        bridge.connection = ((connectionId = "alpha") => ({
          connectionId,
          generation: 10,
          serverRuntimeGeneration: 1,
          call: async (method: string) => {
            calls.push({ connectionId, method });
            started.resolve();
            await gate.promise;
            return {};
          },
          isCurrent: () => true,
          acceptsServerGeneration: (generation: unknown) => generation === 1,
        })) as typeof bridge.connection;

        const pending = mutation.run();
        await started.promise;
        const replaced = partitionState();
        __storeTesting.replaceState({
          ...replaced,
          connections: replaced.connections.map((connection) =>
            connection.id === "alpha"
              ? { ...connection, generation: 2 }
              : connection,
          ),
        });
        gate.resolve();

        await expect(pending).rejects.toThrow("selected host changed");
        expect(calls).toEqual([
          { connectionId: "alpha", method: mutation.method },
        ]);
      }
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(previousState);
    }
  });

  test("carries runtime identity in browser and toast activation targets", () => {
    const target = {
      connectionId: "alpha",
      runtimeGeneration: 1,
      workspaceId: "same-workspace",
      paneId: "same-pane",
    };
    expect(taskNotificationTarget("alpha", 1, pane("alpha", "done"))).toEqual(
      target,
    );
    expect(
      taskNotificationTargetFromNotice({
        actionConnectionId: "alpha",
        actionRuntimeGeneration: 1,
        actionWorkspaceId: "same-workspace",
        actionPaneId: "same-pane",
      }),
    ).toEqual(target);
    expect(
      taskNotificationTargetFromNotice({
        actionConnectionId: "alpha",
        actionWorkspaceId: "same-workspace",
        actionPaneId: "same-pane",
      }),
    ).toBeNull();
    expect(taskNotificationTargetIsCurrent(partitionState(), target)).toBe(
      true,
    );
    expect(
      taskNotificationTargetIsCurrent(
        {
          connections: partitionState().connections.map((connection) =>
            connection.id === "alpha"
              ? { ...connection, generation: 2 }
              : connection,
          ),
        },
        target,
      ),
    ).toBe(false);
    expect(taskNotificationTag(target)).not.toBe(
      taskNotificationTag({
        ...target,
        connectionId: "alpha-1",
        paneId: "same-pane",
      }),
    );
    expect(taskNotificationTag(target)).not.toBe(
      taskNotificationTag({ ...target, runtimeGeneration: 2 }),
    );
  });

  test("rejects disconnected and replaced notification owners without selecting a host", async () => {
    const originalConnection = bridge.connection;
    const originalSetActiveConnection = bridge.setActiveConnection;
    let activeConnectionId = "beta";
    let browserGeneration = 11;
    const calls: string[] = [];
    bridge.connection = ((connectionId = activeConnectionId) => {
      const generation = browserGeneration;
      return {
        connectionId,
        generation,
        isCurrent: () =>
          activeConnectionId === connectionId &&
          browserGeneration === generation,
        call: (async (method: string) => {
          calls.push(`${connectionId}:${method}`);
          if (method === "pane.get") return { pane: pane("alpha", "idle") };
          return {};
        }) as ConnectionClient["call"],
      };
    }) as typeof bridge.connection;
    bridge.setActiveConnection = ((connectionId: string) => {
      if (connectionId !== activeConnectionId) {
        activeConnectionId = connectionId;
        browserGeneration += 1;
      }
      return browserGeneration;
    }) as typeof bridge.setActiveConnection;

    const target = taskNotificationTarget("alpha", 1, pane("alpha", "done"));
    try {
      __storeTesting.replaceState({
        ...activateConnectionState(partitionState(), "beta", 11),
        status: "disconnected",
      });
      await store.focusTaskNotificationTarget(target);
      expect(store.get().activeConnectionId).toBe("beta");
      expect(calls).toEqual([]);

      calls.length = 0;
      activeConnectionId = "beta";
      browserGeneration = 20;
      const beta = activateConnectionState(partitionState(), "beta", 20);
      __storeTesting.replaceState({
        ...beta,
        status: "disconnected",
        connections: beta.connections.map((connection) =>
          connection.id === "alpha"
            ? { ...connection, generation: 2 }
            : connection,
        ),
      });
      await store.focusTaskNotificationTarget(target);
      expect(store.get().activeConnectionId).toBe("beta");
      expect(calls).toEqual([]);
    } finally {
      bridge.connection = originalConnection;
      bridge.setActiveConnection = originalSetActiveConnection;
      __storeTesting.replaceState(partitionState());
    }
  });
});

describe("stabilizeRefreshPatch", () => {
  test("returns null when a refresh reproduces the current state", () => {
    const snapshot = partitionState();
    expect(
      stabilizeRefreshPatch(snapshot, {
        workspaces: structuredClone(snapshot.workspaces),
        tabs: structuredClone(snapshot.tabs),
        panes: structuredClone(snapshot.panes),
        layout: structuredClone(snapshot.layout),
        error: null,
        lastRefresh: Date.now(),
      }),
    ).toBeNull();
  });

  test("keeps unchanged slice references and adopts changed ones", () => {
    const snapshot = partitionState();
    const panes = [pane("alpha", "working")];
    const patch = stabilizeRefreshPatch(snapshot, {
      workspaces: structuredClone(snapshot.workspaces),
      tabs: structuredClone(snapshot.tabs),
      panes,
      layout: null,
      error: null,
      lastRefresh: 123,
    });

    expect(patch?.workspaces).toBe(snapshot.workspaces);
    expect(patch?.tabs).toBe(snapshot.tabs);
    expect(patch?.layout).toBe(snapshot.layout);
    expect(patch?.panes).toBe(panes);
    expect(patch?.lastRefresh).toBe(123);
    expect(patch).not.toHaveProperty("error");
  });

  test("publishes scalar-only transitions like selection or error moves", () => {
    const snapshot = partitionState();
    const cleared = stabilizeRefreshPatch(snapshot, {
      selectedPaneId: null,
      error: null,
      lastRefresh: 5,
    });
    expect(cleared).toMatchObject({ selectedPaneId: null, lastRefresh: 5 });

    const failed = stabilizeRefreshPatch(snapshot, {
      error: "boom",
      lastRefresh: 6,
    });
    expect(failed).toMatchObject({ error: "boom", lastRefresh: 6 });
    expect(failed).not.toHaveProperty("selectedPaneId");
  });

  test("returns null when scalar values already match", () => {
    const snapshot = partitionState();
    expect(
      stabilizeRefreshPatch(snapshot, {
        selectedPaneId: snapshot.selectedPaneId,
        error: snapshot.error,
        lastRefresh: Date.now(),
      }),
    ).toBeNull();
  });

  test("publishes a focused-list observation without replacing unchanged topology", async () => {
    const originalConnection = bridge.connection;
    const snapshot = partitionState();
    bridge.connection = (() => ({
      connectionId: "alpha",
      generation: 10,
      isCurrent: () => true,
      call: (async (method: string) => {
        if (method === "workspace.list") {
          return { workspaces: structuredClone(snapshot.workspaces) };
        }
        if (method === "tab.list") {
          return { tabs: structuredClone(snapshot.tabs) };
        }
        if (method === "pane.list") {
          return { panes: structuredClone(snapshot.panes) };
        }
        if (method === "pane.layout") return { layout: null };
        return {};
      }) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(snapshot);
      let emissions = 0;
      const unsubscribe = store.subscribe(() => {
        emissions += 1;
      });
      try {
        const before = store.get();
        await store.refresh();
        const after = store.get();
        expect(after.workspaces).toBe(before.workspaces);
        expect(after.tabs).toBe(before.tabs);
        expect(after.panes).toBe(before.panes);
        expect(after.layout).toBe(before.layout);
        expect(after.lastRefresh).toBe(before.lastRefresh);
        expect(after.lastTopologyObservationStartedAt).toBeGreaterThan(
          before.lastTopologyObservationStartedAt,
        );
        expect(emissions).toBe(1);
      } finally {
        unsubscribe();
      }
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(partitionState());
    }
  });
});

describe("worktree hook notices", () => {
  test("dismisses successful hook output after a short actionable window", () => {
    expect(
      summarizeDirectHookResult({
        event: "worktree.created",
        status: "succeeded",
        stdout: "configured checkout",
      }),
    ).toMatchObject({
      kind: "success",
      autoDismissMs: 15_000,
    });
  });

  test("leaves failed hooks on the shared default timeout", () => {
    const notice = summarizeDirectHookResult({
      event: "worktree.before_remove",
      status: "failed",
      exit_code: 1,
      stderr: "cleanup failed",
    });
    expect(notice).toMatchObject({ kind: "error" });
    expect(notice?.autoDismissMs).toBeUndefined();
  });
});

describe("notice dismissal policy", () => {
  test("uses 15 seconds for an ordinary toast", () => {
    expect(DEFAULT_NOTICE_AUTO_DISMISS_MS).toBe(15_000);
    expect(noticeAutoDismissDelay({ kind: "info", message: "Saved" })).toBe(
      15_000,
    );
  });

  test("honors explicit durations and keeps loading notices visible", () => {
    expect(
      noticeAutoDismissDelay({
        kind: "success",
        message: "Copied",
        autoDismissMs: 5_000,
      }),
    ).toBe(5_000);
    expect(
      noticeAutoDismissDelay({
        kind: "info",
        message: "Working",
        loading: true,
      }),
    ).toBeNull();
  });
});

describe("recent pane history", () => {
  const panes = Array.from({ length: 14 }, (_, index) => ({
    pane_id: `pane-${index + 1}`,
  }));

  test("moves the selected pane to the front without duplicates", () => {
    expect(
      nextRecentPaneIds("pane-2", ["pane-1", "pane-2", "pane-3"], panes),
    ).toEqual(["pane-2", "pane-1", "pane-3"]);
  });

  test("prunes missing panes and keeps the history bounded", () => {
    expect(
      nextRecentPaneIds(
        "pane-14",
        ["missing", ...panes.map((pane) => pane.pane_id)],
        panes,
      ),
    ).toEqual([
      "pane-14",
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
      "pane-7",
      "pane-8",
      "pane-9",
      "pane-10",
      "pane-11",
    ]);
  });

  test("does not add a pane that is no longer live", () => {
    expect(nextRecentPaneIds("missing", ["pane-1", "missing"], panes)).toEqual([
      "pane-1",
    ]);
  });
});

describe("update restart verification", () => {
  test("matches only the expected running server version", () => {
    expect(healthMatchesUpdateVersion({ version: "0.3.0" }, "0.3.0")).toBe(
      true,
    );
    expect(healthMatchesUpdateVersion({ version: "0.2.9" }, "0.3.0")).toBe(
      false,
    );
    expect(healthMatchesUpdateVersion({ ok: true }, "0.3.0")).toBe(false);
  });
});

describe("numbered tab creation", () => {
  test("uses the authoritative number returned by Herdr", () => {
    expect(
      numberedCreatedTabRename({
        type: "tab_created",
        tab: { tab_id: "w1:t7", number: 7, label: "7" },
      }),
    ).toEqual({ tabId: "w1:t7", label: "Tab 7" });
  });

  test("rejects malformed or unrelated responses", () => {
    expect(numberedCreatedTabRename(null)).toBeNull();
    expect(
      numberedCreatedTabRename({
        type: "tab_info",
        tab: { tab_id: "w1:t2", number: 2 },
      }),
    ).toBeNull();
    expect(
      numberedCreatedTabRename({
        type: "tab_created",
        tab: { tab_id: "w1:t2" },
      }),
    ).toBeNull();
    expect(
      numberedCreatedTabRename({
        type: "tab_created",
        tab: { tab_id: "w1:t2", number: 0 },
      }),
    ).toBeNull();
  });
});

describe("worktree removal notices", () => {
  test("keeps a removed-hook failure visible after stale checkout recovery", () => {
    expect(
      worktreeRemovalCompletionNotice(
        {
          recovered_stale_checkout: true,
          terminated_processes: 2,
          preserved_path: "/work/repo.recovered",
        },
        {
          kind: "error",
          message: "Worktree removed hook failed (exit 1)",
          detail: "cleanup failed",
          detailMode: "output",
          detailTitle: "Worktree removed hook output",
        },
      ),
    ).toEqual({
      kind: "error",
      message: "Worktree removed hook failed (exit 1)",
      detail:
        "cleanup failed\nStopped 2 processes still using the checkout.\nStale files were preserved at /work/repo.recovered.",
      detailMode: "output",
      detailTitle: "Worktree removal details",
    });
  });

  test("summarizes recovery when no removed hook ran", () => {
    expect(
      worktreeRemovalCompletionNotice(
        {
          recovered_stale_checkout: true,
          terminated_processes: 0,
        },
        null,
      ),
    ).toEqual({
      kind: "success",
      message: "Worktree removed",
      detail:
        "The checkout was already absent; stale Herdr state was reconciled.",
    });
  });

  test("reports a successful Herdr remove with incomplete local cleanup", () => {
    expect(
      worktreeRemovalCompletionNotice(
        {
          terminated_processes: 0,
          warning: "process 42 survived",
        },
        {
          kind: "success",
          message: "Worktree removed hook completed",
        },
      ),
    ).toEqual({
      kind: "error",
      message: "Worktree removed with cleanup warning",
      detail: "Worktree removed hook completed\nprocess 42 survived",
      detailTitle: "Worktree removal details",
    });
  });
});

describe("pending workspace focus settlement", () => {
  function mockFocusConnection(workspacesFocused: () => unknown[]) {
    const originalConnection = bridge.connection;
    const focusDeferreds: Array<{
      resolve: (value: unknown) => void;
      promise: Promise<unknown>;
    }> = [];
    bridge.connection = ((connectionId = "alpha", generation = 10) => ({
      connectionId,
      generation,
      isCurrent: () => true,
      call: (async (method: string) => {
        if (method === "workspace.focus") {
          const deferred = Promise.withResolvers<unknown>();
          focusDeferreds.push(deferred);
          return deferred.promise;
        }
        if (method === "workspace.list") {
          return { workspaces: workspacesFocused() };
        }
        if (method === "tab.list") return { tabs: [] };
        if (method === "pane.list") return { panes: [] };
        if (method === "pane.layout") return { layout: null };
        return {};
      }) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    return {
      focusDeferreds,
      async resolveFocus(index: number, value: unknown = {}) {
        while (!focusDeferreds[index]) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        focusDeferreds[index].resolve(value);
      },
      restore() {
        bridge.connection = originalConnection;
      },
    };
  }

  function unfocusedWorkspaces(): unknown[] {
    return structuredClone(partitionState().workspaces);
  }

  test("does not retry a qualified workspace focus on a newly selected host", async () => {
    const originalConnection = bridge.connection;
    const originalSetActiveConnection = bridge.setActiveConnection;
    const firstAttempt = Promise.withResolvers<unknown>();
    const calls: string[] = [];
    let activeConnectionId = "alpha";
    let browserGeneration = 10;
    bridge.connection = ((connectionId = activeConnectionId) => {
      const generation = browserGeneration;
      return {
        connectionId,
        generation,
        isCurrent: () =>
          connectionId === activeConnectionId &&
          generation === browserGeneration,
        call: (async (method: string) => {
          if (method !== "workspace.focus") return {};
          calls.push(connectionId);
          return connectionId === "alpha" ? firstAttempt.promise : {};
        }) as ConnectionClient["call"],
      };
    }) as typeof bridge.connection;
    bridge.setActiveConnection = ((connectionId: string) => {
      activeConnectionId = connectionId;
      browserGeneration += 1;
      return browserGeneration;
    }) as typeof bridge.setActiveConnection;
    try {
      __storeTesting.replaceState(partitionState());
      const focusing = store.focusWorkspace("same-workspace", {
        retryOnReconnect: false,
      });
      while (!calls.length) await Bun.sleep(0);
      expect(store.selectConnection("beta")).toBe(true);
      firstAttempt.reject(new Error("connection changed during request"));
      await focusing;
      expect(calls).toEqual(["alpha"]);
    } finally {
      firstAttempt.resolve({});
      bridge.connection = originalConnection;
      bridge.setActiveConnection = originalSetActiveConnection;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("releases a settled pending focus that a fresh observation still misses", async () => {
    const mock = mockFocusConnection(unfocusedWorkspaces);
    try {
      __storeTesting.replaceState(partitionState());
      const action = store.focusWorkspace("other-workspace");
      await mock.resolveFocus(0);
      await action;
      await store.refresh();
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
      expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
    } finally {
      mock.restore();
      __storeTesting.replaceState(partitionState());
    }
  });

  test("keeps an unsettled pending focus across mid-flight refreshes", async () => {
    const mock = mockFocusConnection(unfocusedWorkspaces);
    try {
      __storeTesting.replaceState(partitionState());
      const action = store.focusWorkspace("other-workspace");
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBe("other-workspace");
      expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
      await mock.resolveFocus(0);
      await action;
      await store.refresh();
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
    } finally {
      mock.restore();
      __storeTesting.replaceState(partitionState());
    }
  });

  test("never lets a first same-id attempt settle or clear the second", async () => {
    const mock = mockFocusConnection(unfocusedWorkspaces);
    try {
      __storeTesting.replaceState(partitionState());
      const first = store.focusWorkspace("other-workspace");
      const second = store.focusWorkspace("other-workspace");
      await mock.resolveFocus(0);
      await first;
      expect(store.get().pendingFocusWorkspaceId).toBe("other-workspace");
      expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBe("other-workspace");
      await mock.resolveFocus(1);
      await second;
      await store.refresh();
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
    } finally {
      mock.restore();
      __storeTesting.replaceState(partitionState());
    }
  });

  test("clears the pending focus as soon as the workspace is observed focused", async () => {
    const mock = mockFocusConnection(() => [
      { ...partitionState().workspaces[0], focused: false },
      {
        ...partitionState().workspaces[0],
        workspace_id: "other-workspace",
        focused: true,
      },
    ]);
    try {
      __storeTesting.replaceState(partitionState());
      const action = store.focusWorkspace("other-workspace");
      await mock.resolveFocus(0);
      await action;
      await store.refresh();
      await store.refresh();
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
    } finally {
      mock.restore();
      __storeTesting.replaceState(partitionState());
    }
  });

  for (const observedFocused of [false, true]) {
    for (const sameWorkspace of [false, true]) {
      test(`layout publication preserves a newer ${sameWorkspace ? "same-id" : "different-id"} focus after a ${observedFocused ? "positive" : "negative"} observation`, async () => {
        const originalConnection = bridge.connection;
        const layoutEntered = Promise.withResolvers<void>();
        const layoutResult = Promise.withResolvers<unknown>();
        const focusResult = Promise.withResolvers<unknown>();
        const snapshot = partitionState();
        const oldTarget = observedFocused ? "same-workspace" : "old-target";
        const newTarget = sameWorkspace ? oldTarget : "new-target";
        const workspaces = snapshot.workspaces.map((workspace) => ({
          ...workspace,
          label: "fresh observation",
        }));
        let focus: Promise<unknown> | undefined;
        let refresh: Promise<unknown> | undefined;
        bridge.connection = ((connectionId = "alpha", generation = 10) => ({
          connectionId,
          generation,
          isCurrent: () => true,
          call: (async (method: string) => {
            if (method === "workspace.list") return { workspaces };
            if (method === "tab.list") return { tabs: snapshot.tabs };
            if (method === "pane.list") return { panes: snapshot.panes };
            if (method === "pane.layout") {
              layoutEntered.resolve();
              return layoutResult.promise;
            }
            if (method === "workspace.focus") return focusResult.promise;
            return {};
          }) as ConnectionClient["call"],
        })) as typeof bridge.connection;
        try {
          __storeTesting.replaceState({
            ...snapshot,
            pendingFocusWorkspaceId: oldTarget,
            pendingFocusWorkspaceSeq: -1,
            pendingFocusWorkspaceSettledAt: 1,
          });
          refresh = store.refresh();
          await layoutEntered.promise;
          focus = store.focusWorkspace(newTarget);
          const newSeq = store.get().pendingFocusWorkspaceSeq;
          expect(newSeq).not.toBe(-1);
          layoutResult.resolve({ layout: null });
          await refresh;
          expect(store.get().pendingFocusWorkspaceId).toBe(newTarget);
          expect(store.get().pendingFocusWorkspaceSeq).toBe(newSeq);
          expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
          expect(store.get().workspaces).toEqual(workspaces);
        } finally {
          layoutResult.resolve({ layout: null });
          focusResult.resolve({});
          await refresh;
          await focus;
          await store.refresh();
          bridge.connection = originalConnection;
          __storeTesting.replaceState(partitionState());
        }
      });
    }
  }

  test("restores pending focus deterministically and preserves settled tokens", () => {
    for (const settledAt of [null, 0, 123]) {
      const withPending: State = {
        ...partitionState(),
        lastRefresh: 42,
        pendingFocusWorkspaceId: "alpha-pending",
        pendingFocusWorkspaceSeq: 7,
        pendingFocusWorkspaceSettledAt: settledAt,
      };
      const beta = activateConnectionState(withPending, "beta", 11);
      const restored = activateConnectionState(beta, "alpha", 12);
      expect(restored.pendingFocusWorkspaceId).toBe("alpha-pending");
      expect(restored.pendingFocusWorkspaceSettledAt).toBe(settledAt ?? 42);
      expect(activateConnectionState(beta, "alpha", 12)).toEqual(restored);
    }
  });

  test("clears a failed focus attempt even when the lease is already dead", async () => {
    const originalConnection = bridge.connection;
    bridge.connection = ((connectionId = "alpha", generation = 10) => ({
      connectionId,
      generation,
      isCurrent: () => false,
      call: (async (method: string) => {
        if (method === "workspace.focus") {
          throw new Error("socket gone");
        }
        return {};
      }) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(partitionState());
      await store.focusWorkspace("other-workspace");
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
      expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("releases a stamped marker when the connection is paused", async () => {
    const originalConnection = bridge.connection;
    bridge.connection = ((connectionId = "alpha", generation = 10) => ({
      connectionId,
      generation,
      isCurrent: () => true,
      call: (async () => ({})) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState({
        ...partitionState(),
        connectionPaused: true,
      });
      await store.focusWorkspace("other-workspace");
      expect(store.get().pendingFocusWorkspaceId).toBeNull();
      expect(store.get().pendingFocusWorkspaceSettledAt).toBeNull();
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(partitionState());
    }
  });

  test("marks a completed focus attempt settled even when the lease is dead", async () => {
    const originalConnection = bridge.connection;
    bridge.connection = ((connectionId = "alpha", generation = 10) => ({
      connectionId,
      generation,
      isCurrent: () => false,
      call: (async () => ({})) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(partitionState());
      await store.focusWorkspace("other-workspace");
      expect(store.get().pendingFocusWorkspaceId).toBe("other-workspace");
      expect(store.get().pendingFocusWorkspaceSettledAt).not.toBeNull();
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(partitionState());
    }
  });
});

describe("basic Herdr 0.9 compatibility", () => {
  test("safe workspace close reports grouped-close refusal without closing the group", async () => {
    const previousState = store.get();
    const originalConnection = bridge.connection;
    const calls: unknown[] = [];
    bridge.connection = (() => ({
      connectionId: "alpha",
      generation: 10,
      isCurrent: () => true,
      call: (async (method, params) => {
        calls.push({ method, params });
        throw new Error(
          "workspace_group_close_required: workspace has linked worktrees",
        );
      }) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(partitionState());
      await store.closeWorkspace("workspace_1");
      expect(calls).toEqual([
        { method: "workspace.close", params: { workspace_id: "workspace_1" } },
      ]);
      expect(store.get().notice).toMatchObject({
        kind: "error",
        message: "Workspace belongs to a group",
        detail: expect.stringContaining("Herdr CLI with --group"),
      });
      expect(store.get().workspaces).toEqual(partitionState().workspaces);
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(previousState);
    }
  });

  for (const event of ["layout_updated", "session.resync_required"]) {
    test(`${event} uses generic refresh and queues reconciliation during an in-flight snapshot`, async () => {
      const previousState = store.get();
      const originalConnection = bridge.connection;
      const snapshot = partitionState();
      const refreshedWorkspaces = snapshot.workspaces.map((workspace) => ({
        ...workspace,
        label: "after-layout-event",
      }));
      let lists = 0;
      let published!: () => void;
      let publicationTimer!: ReturnType<typeof setTimeout>;
      const publication = new Promise<void>((resolve, reject) => {
        published = resolve;
        publicationTimer = setTimeout(
          () => reject(new Error("follow-up snapshot was not published")),
          2_000,
        );
      });
      const unsubscribe = store.subscribe(() => {
        if (store.get().workspaces[0]?.label === "after-layout-event") {
          published();
        }
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      bridge.connection = (() => ({
        connectionId: "alpha",
        generation: 10,
        isCurrent: () => true,
        call: (async (method) => {
          if (method === "workspace.list") {
            lists += 1;
            if (lists === 1) await gate;
            return {
              workspaces:
                lists === 1 ? snapshot.workspaces : refreshedWorkspaces,
            };
          }
          if (method === "tab.list") return { tabs: snapshot.tabs };
          if (method === "pane.list") return { panes: snapshot.panes };
          if (method === "pane.layout") return { layout: null };
          return {};
        }) as ConnectionClient["call"],
      })) as typeof bridge.connection;
      try {
        __storeTesting.replaceState(snapshot);
        const refreshing = store.refresh();
        __storeTesting.handleHerdrEvent({
          event,
          connection_id: "alpha",
          connection_generation: 1,
          data: {},
        });
        await Bun.sleep(100); // The production 80ms event debounce fires while busy.
        expect(lists).toBe(1);
        release();
        await refreshing;
        await publication;
        expect(lists).toBe(2); // No five-second metadata poll needed.
      } finally {
        clearTimeout(publicationTimer);
        unsubscribe();
        release();
        bridge.connection = originalConnection;
        __storeTesting.replaceState(previousState);
      }
    });
  }
});

describe("agent activity refresh", () => {
  test("reloads server recency and tolerates unavailable agent metadata", async () => {
    const originalConnection = bridge.connection;
    const snapshot = partitionState();
    let sequence = 42;
    let activity = 1234;
    let unavailable = false;
    bridge.connection = (() => ({
      connectionId: "alpha",
      generation: 10,
      isCurrent: () => true,
      call: (async (method) => {
        if (method === "workspace.list")
          return { workspaces: structuredClone(snapshot.workspaces) };
        if (method === "tab.list")
          return { tabs: structuredClone(snapshot.tabs) };
        if (method === "pane.list")
          return { panes: structuredClone(snapshot.panes) };
        if (method === "agent.list") {
          if (unavailable) throw new Error("Unsupported method");
          return {
            agents: snapshot.panes.map((pane) => ({
              ...pane,
              state_change_seq: sequence,
              last_activity_at: activity,
            })),
          };
        }
        if (method === "pane.layout") return { layout: null };
        return {};
      }) as ConnectionClient["call"],
    })) as typeof bridge.connection;
    try {
      __storeTesting.replaceState(snapshot);
      await store.refresh();
      expect(store.get().panes[0]?.state_change_seq).toBe(42);
      expect(store.get().panes[0]?.last_activity_at).toBe(1234);
      __storeTesting.replaceState(snapshot); // Fresh browser snapshot has no activity history.
      await store.refresh();
      expect(store.get().panes[0]?.state_change_seq).toBe(42);
      expect(store.get().panes[0]?.last_activity_at).toBe(1234);
      sequence = 2; // Herdr restarted: accept its new sequence rather than a cached maximum.
      await store.refresh();
      expect(store.get().panes[0]?.state_change_seq).toBe(2);
      expect(store.get().panes[0]?.last_activity_at).toBe(1234);
      activity = 2345;
      await store.refresh();
      expect(store.get().panes[0]?.last_activity_at).toBe(2345);
      unavailable = true;
      await store.refresh();
      expect(store.get().error).toBeNull();
      expect(store.get().panes).toEqual(snapshot.panes);
    } finally {
      bridge.connection = originalConnection;
      __storeTesting.replaceState(partitionState());
    }
  });
});

describe("Herdr task notifications", () => {
  test("browser completion observation does not invent a transition across reused workspace or session identities", () => {
    const tracker = new TaskCompletionTracker();
    const original = {
      ...pane("beta", "working"),
      agent_session: { value: "synthetic-original" },
    };
    expect(tracker.update("beta", [original])).toEqual([]);
    expect(
      tracker.update("beta", [
        {
          ...original,
          workspace_id: "replacement-workspace",
          agent_status: "done",
        },
      ]),
    ).toEqual([]);
    tracker.reset("beta");
    tracker.update("beta", [original]);
    expect(
      tracker.update("beta", [
        {
          ...original,
          agent_status: "done",
          agent_session: { value: "synthetic-replacement" },
        },
      ]),
    ).toEqual([]);
  });
  const herdrEvent = (data: Record<string, unknown>, connection = "alpha") => ({
    connection_id: connection,
    connection_generation: 1,
    event: "herdr-world.task_notification",
    data: { type: "herdr-world.task_notification", ...data },
  });

  function enabledState(overrides: Partial<State> = {}): State {
    return {
      ...partitionState(),
      taskNotificationsEnabled: true,
      // Push transport keeps the browser Notification API out of unit tests.
      taskNotificationTransport: "push",
      ...overrides,
    };
  }

  test("parses relayed events and rejects malformed ones", () => {
    expect(
      parseHerdrTaskNotification({
        kind: "blocked",
        agent: "claude",
        title: "claude needs attention",
        body: "",
        workspace_id: "w1",
        pane_id: "w1:p2",
        agent_session_id: "synthetic-session-original",
      }),
    ).toEqual({
      kind: "blocked",
      agent: "claude",
      title: "claude needs attention",
      body: null,
      workspaceId: "w1",
      paneId: "w1:p2",
      agentSessionId: "synthetic-session-original",
    });
    expect(parseHerdrTaskNotification({ kind: "update", title: "x" })).toBe(
      null,
    );
    expect(parseHerdrTaskNotification({ kind: "completed" })).toBeNull();
  });

  test("reads the bridge capability", () => {
    expect(herdrTaskNotificationsActive(null)).toBe(false);
    expect(
      herdrTaskNotificationsActive({
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: "alpha",
        capabilities: { herdr_task_notifications: true },
      }),
    ).toBe(true);
  });
  test("a relayed notification with unknown original session stays visible without a replacement action", () => {
    try {
      __storeTesting.replaceState(enabledState());
      __storeTesting.handleHerdrEvent(
        herdrEvent({
          kind: "completed",
          title: "Synthetic task finished",
          workspace_id: "w1",
          pane_id: "w1:p9",
          session_identity_unavailable: true,
        }),
      );
      expect(store.get().notice?.message).toBe("Synthetic task finished");
      expect(store.get().notice?.actionPaneId).toBeUndefined();
      expect(store.get().notice?.detail).toContain(
        "session identity is unavailable",
      );
    } finally {
      __storeTesting.replaceState(partitionState());
    }
  });

  test("shows Herdr's text with a pane action, or none for pane-less alerts", () => {
    try {
      __storeTesting.replaceState(enabledState());
      __storeTesting.handleHerdrEvent(
        herdrEvent({
          kind: "completed",
          agent: "claude",
          title: "claude finished",
          body: "cvision",
          workspace_id: "w1",
          pane_id: "w1:p9",
        }),
      );
      expect(store.get().notice).toMatchObject({
        kind: "success",
        message: "claude finished",
        detail: "cvision",
        actionLabel: "Open agent",
        actionConnectionId: "alpha",
        actionRuntimeGeneration: 1,
        actionWorkspaceId: "w1",
        actionPaneId: "w1:p9",
      });

      __storeTesting.handleHerdrEvent(
        herdrEvent({ kind: "blocked", title: "codex needs input" }),
      );
      const notice = store.get().notice;
      expect(notice).toMatchObject({
        kind: "info",
        message: "codex needs input",
        detail: "Agent",
      });
      expect(notice?.actionPaneId).toBeUndefined();
    } finally {
      __storeTesting.replaceState(partitionState());
    }
  });

  test("respects preferences and retains a sibling notification's owning runtime", () => {
    const event = herdrEvent({
      kind: "blocked",
      title: "claude needs attention",
      workspace_id: "w1",
      pane_id: "w1:p9",
    });
    try {
      for (const snapshot of [
        enabledState({ taskNotificationsEnabled: false }),
        enabledState({
          taskNotificationPreferences: { completed: true, blocked: false },
        }),
      ]) {
        __storeTesting.replaceState(snapshot);
        __storeTesting.handleHerdrEvent(event);
        expect(store.get().notice).toBeNull();
      }
      __storeTesting.replaceState(enabledState());
      __storeTesting.handleHerdrEvent({ ...event, connection_id: "beta" });
      expect(store.get().notice).toMatchObject({
        actionConnectionId: "beta",
        actionRuntimeGeneration: 1,
      });
    } finally {
      __storeTesting.replaceState(partitionState());
    }
  });
});
