import { publishedHostGrouping } from "../../../shared/hostGrouping";
import { herdrRuntimeFixture } from "../../../server/src/adapters/testing/runtime";
import { parseObservationBase } from "../../../server/src/world/observation-v1";
import {
  SNAPSHOT_RESPONSE_DEADLINE_MS,
  WorldSnapshotService,
} from "../../../server/src/world/snapshot";
import {
  type Scheduler,
  systemScheduler,
} from "../../../server/src/service/clock";

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
  // The stalled refresh's response deadline runs in test time: it expires as
  // soon as every host but the stalled ones has been observed, instead of
  // after 20 real seconds. `expiredDeadlines` records each expired delay.
  let stalling = false;
  const entered = new Set<string>();
  const observing = new Set<string>();
  const heldDeadlines = new Set<() => void>();
  const expiredDeadlines: number[] = [];
  const expireWhenOnlyStalledRemain = () => {
    if (
      !stalling ||
      observing.size > 0 ||
      stalledIds.some((id) => !entered.has(id))
    )
      return;
    // A macrotask later, so the last observed host's reply is gathered first.
    systemScheduler.schedule(() => {
      for (const expire of [...heldDeadlines]) expire();
    }, 0);
  };
  const scheduler: Scheduler = {
    schedule(callback, delayMs) {
      if (!stalling || delayMs !== SNAPSHOT_RESPONSE_DEADLINE_MS)
        return systemScheduler.schedule(callback, delayMs);
      const expire = () => {
        heldDeadlines.delete(expire);
        expiredDeadlines.push(delayMs);
        callback();
      };
      heldDeadlines.add(expire);
      expireWhenOnlyStalledRemain();
      return { cancel: () => heldDeadlines.delete(expire) };
    },
  };
  const service = new WorldSnapshotService(
    {
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
          ...herdrRuntimeFixture({
            async call(method: string) {
              const stall = stalls.get(connectionId);
              if (stall) {
                entered.add(connectionId);
                expireWhenOnlyStalledRemain();
                await stall.promise;
              } else if (stalling && method === "workspace.list")
                observing.add(connectionId);
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
          }),
        },
      }),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    (connectionId) => {
      if (!observing.delete(connectionId)) return;
      expireWhenOnlyStalledRemain();
    },
    undefined,
    undefined,
    scheduler,
  );
  // The service publishes the grouping of the hosts it holds.
  service.publishWith({
    values: () => ({}),
    derive: (_published, connections) => ({
      host_grouping: publishedHostGrouping(
        { connections: ids.map((id) => ({ id, label: id })), core: [] },
        "machine",
        connections,
      ),
    }),
  });
  return {
    service,
    hostCount: ids.length,
    async snapshot(params?: unknown) {
      const base = parseObservationBase(params);
      return service.observation.reply(await service.snapshot(params), base);
    },
    startStalledAttentionRefresh() {
      attention = true;
      stalling = true;
      service.invalidate("alpha");
      for (const id of stalledIds) {
        stalls.set(id, Promise.withResolvers<void>());
        service.invalidate(id);
      }
    },
    release() {
      // Released hosts answer, so no deadline is expired for them.
      stalling = false;
      for (const stall of stalls.values()) stall.resolve();
    },
    stalledIds,
    /** The response deadlines that expired while the stalled hosts held. */
    expiredDeadlines,
  };
}

export async function denseSnapshot() {
  return JSON.stringify(await createDenseSnapshotFixture().service.snapshot());
}
