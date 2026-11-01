import { expect, test } from "bun:test";
import { bridge, type ConnectionClient } from "../api";
import { __storeTesting, emptyServerSessionState, store } from "../store";
import { refreshNow } from "./refresh";
import type { Workspace } from "../types";
import { gitStatus } from "./testing/syntheticHosts";

test("git status pushes retain inactive-host ownership and win over an overlapping older catalogue", async () => {
  const previous = store.get();
  const original = bridge.connection;
  const workspace = {
    workspace_id: "shared",
    worktree: {
      checkout_path: "/synthetic/repository",
      git_status: gitStatus("main"),
    },
  } as Workspace;
  const session = { ...emptyServerSessionState(7), workspaces: [workspace] };
  __storeTesting.replaceState({
    ...previous,
    ...session,
    status: "connected",
    connectionPaused: false,
    catalogueReady: true,
    activeConnectionId: "alpha",
    connectionGeneration: 7,
    connections: ["alpha", "beta"].map((id) => ({
      id,
      label: id,
      source: "test",
      is_default: id === "alpha",
      state: "ready",
      generation: 7,
    })),
    sessionsByConnectionId: { alpha: session, beta: session },
  });
  const listed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  bridge.connection = ((connectionId: string, generation = 7) =>
    ({
      connectionId,
      generation,
      serverRuntimeGeneration: generation,
      isCurrent: () => true,
      acceptsServerGeneration: (value: unknown) => value === generation,
      call: async (method: string) => {
        if (method === "workspace.list") {
          listed.resolve();
          await release.promise;
          return { workspaces: [workspace] };
        }
        if (method === "tab.list") return { tabs: [] };
        if (method === "pane.list") return { panes: [] };
        return { agents: [] };
      },
    }) as ConnectionClient) as typeof bridge.connection;
  const event = (generation: number, branch: string) =>
    __storeTesting.handleHerdrEvent({
      connection_id: "beta",
      connection_generation: generation,
      event: "workspace.git_status",
      data: {
        statuses: [
          {
            checkout_path: "/synthetic/repository",
            git_status: gitStatus(branch),
          },
        ],
      },
    });
  try {
    const refreshing = refreshNow({
      connectionId: "beta",
      generation: 7,
      client: bridge.connection("beta", 7),
    });
    await listed.promise;
    event(7, "updated");
    event(6, "retired");
    expect(store.get().workspaces[0].worktree?.git_status?.branch).toBe("main");
    expect(
      store.get().sessionsByConnectionId.beta?.workspaces[0].worktree
        ?.git_status?.branch,
    ).toBe("updated");
    release.resolve();
    await refreshing;
    expect(
      store.get().sessionsByConnectionId.beta?.workspaces[0].worktree
        ?.git_status?.branch,
    ).toBe("updated");
    expect(store.get().workspaces[0].worktree?.git_status?.branch).toBe("main");
  } finally {
    release.resolve();
    bridge.connection = original;
    __storeTesting.replaceState(previous);
  }
});
