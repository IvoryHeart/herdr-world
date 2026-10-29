import { WorldSnapshotService } from "../../../server/src/world/snapshot";

export class InputDriver {
  private id = 0;
  private pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  constructor(private socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error)
        request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
  }
  async call(method: string, params: Record<string, unknown>) {
    const id = ++this.id;
    const result = Promise.withResolvers<unknown>();
    this.pending.set(id, result);
    this.socket.send(JSON.stringify({ id, method, params }));
    return result.promise;
  }
  close() {
    this.socket.close();
  }
}

export function createDenseSnapshotFixture({
  workingInitially = false,
  maximumScale = false,
} = {}) {
  const ids = maximumScale
    ? ["alpha", "beta", "synthetic-0"]
    : [
        "alpha",
        "beta",
        ...Array.from({ length: 62 }, (_, index) => `synthetic-${index}`),
      ];
  const workspaces = Array.from(
    { length: maximumScale ? 8 : 2014 },
    (_, index) => ({
      workspace_id: `w${index}`,
      label: `Synthetic space ${index}`,
    }),
  );
  const tabsPerWorkspace = maximumScale ? 15 : 1;
  const tabs = workspaces.flatMap(({ workspace_id }) =>
    Array.from({ length: tabsPerWorkspace }, (_, index) => ({
      workspace_id,
      tab_id: `${workspace_id}:t${index + 1}`,
      label: "Synthetic tab",
    })),
  );
  const panes = tabs.flatMap(({ workspace_id, tab_id }, tabIndex) =>
    Array.from({ length: 17 }, (_, index) => ({
      workspace_id,
      tab_id,
      pane_id: `${workspace_id}:p${(tabIndex % tabsPerWorkspace) * 17 + index}`,
      terminal_id: `${workspace_id}:p${(tabIndex % tabsPerWorkspace) * 17 + index}`,
      agent: "codex",
      agent_status: workingInitially ? "working" : "idle",
    })),
  );
  const stalls = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<void>>
  >();
  let attention = false;
  const stalledIds = maximumScale ? ids.slice(1) : ids.slice(-3);
  const service = new WorldSnapshotService({
    list: () =>
      ids.map((id) => ({
        id,
        label: id,
        source: "fixture",
        is_default: id === ids[0],
        state: "ready" as const,
        generation: 7,
      })),
    readyRuntimeLease: (connectionId) => ({
      connectionId,
      generation: 7,
      isCurrent: () => true,
      runtime: {
        herdr: {
          async call(method: string) {
            await stalls.get(connectionId)?.promise;
            if (method === "workspace.list") return { workspaces };
            if (method === "tab.list") return { tabs };
            if (method === "pane.list")
              return {
                panes:
                  attention && connectionId === "alpha"
                    ? panes.map((pane) => ({
                        ...pane,
                        agent_status: "working",
                      }))
                    : panes,
              };
            return { agents: [] };
          },
        },
      },
    }),
  });
  return {
    service,
    hostCount: ids.length,
    startStalledAttentionRefresh() {
      attention = true;
      service.invalidate("alpha");
      for (const id of stalledIds) {
        stalls.set(id, Promise.withResolvers<void>());
        service.invalidate(id);
      }
    },
    release() {
      for (const stall of stalls.values()) stall.resolve();
    },
    stalledIds,
  };
}

export async function denseSnapshot() {
  return JSON.stringify(await createDenseSnapshotFixture().service.snapshot());
}
