import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { ConnectionManager } from "../connections/manager";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { RpcServices } from "../rpc/context";
import {
  FocusedAcquisition,
  FOCUSED_METHODS,
} from "../world/focused-acquisition";
import { readFocusedLists } from "../world/focused-lists";
import { createRpcDispatcher } from "./rpc-dispatch";
import { createBrowserClients } from "./clients";
import { silentLogger } from "../utils/logger";

test("two browser dispatchers record only delivered focused replies to the shared enriched lists", async () => {
  type Socket = ServerWebSocket<unknown>;
  const one = {} as Socket,
    two = {} as Socket;
  const sent = new Map<Socket, any[]>([
    [one, []],
    [two, []],
  ]);
  const jobs = new Set<() => void>();
  const calls: { id: string; method: string; params: unknown }[] = [];
  let git = 1;
  let acceptingReplies = true;
  const manager = new ConnectionManager<LegacyConnectionRuntime>("alpha");
  for (const id of ["alpha", "beta"]) {
    const identity = { id, label: id, source: "test" };
    manager.register({
      identity,
      createRuntime: () =>
        ({
          identity,
          async startTransport() {},
          startBackground() {},
          async stop() {},
          herdr: {
            async call(method: string, params: unknown) {
              calls.push({ id, method, params });
              if (method === "workspace.list") return { workspaces: [{ id }] };
              if (method === "tab.list") return { tabs: [] };
              if (method === "pane.list") return { panes: [] };
              return { agents: [] };
            },
          },
          worktreeParents: {
            async enrichWorkspaceList(result: object) {
              return { ...result, parents: "synthetic" };
            },
          },
          status: {
            async enrichWorkspacesWithGitStatus(result: object) {
              return { ...result, git };
            },
          },
          terminalBridge: {
            async navigationMode() {
              return "browser";
            },
            async tabMoveSupported() {
              return true;
            },
            endpointAvailability() {
              return { shared: true };
            },
          },
          agentSessions: {
            async listWithActivity(params: unknown) {
              calls.push({ id, method: "agent.list", params });
              return { agents: [{ pane_id: "p", last_activity_at: 42 }] };
            },
          },
        }) as unknown as LegacyConnectionRuntime,
    });
    await manager.start(id);
  }
  const acquisition = new FocusedAcquisition<Socket>({
    scheduler: {
      schedule(callback) {
        jobs.add(callback);
        return { cancel: () => jobs.delete(callback) };
      },
    },
    lease(owner) {
      const lease = manager.readyRuntimeLease(owner.connection_id);
      return lease?.generation === owner.connection_generation
        ? {
            isCurrent: lease.isCurrent,
            read: () => readFocusedLists(lease.runtime),
          }
        : null;
    },
    send(socket, control) {
      sent.get(socket)!.push({ control });
      return true;
    },
  });
  const services = {
    connectionManager: manager,
    focusedAcquisition: acquisition,
    snapshotAdmission: { acknowledge: () => false },
    markRpcError() {},
    safeSend(socket: Socket, payload: string) {
      if (!acceptingReplies) return false;
      sent.get(socket)!.push(JSON.parse(payload));
      return true;
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  let seq = 0;
  const owner = (id = "alpha") => ({
    connection_id: id,
    connection_generation: manager.readyRuntimeLease(id)!.generation,
  });
  const relist = async (socket: Socket, marked = true) => {
    for (const method of FOCUSED_METHODS)
      await dispatch(
        socket,
        JSON.stringify({
          id: `r-${++seq}`,
          method,
          ...owner(),
          params: {},
          focused_observation: marked,
        }),
      );
  };
  const tick = async () => {
    for (const job of [...jobs]) {
      if (jobs.delete(job)) await job();
    }
  };
  try {
    for (const socket of [one, two]) {
      await relist(socket);
      await dispatch(
        socket,
        JSON.stringify({
          id: `r-${++seq}`,
          method: "world.focused.observe",
          params: { owners: [owner()] },
        }),
      );
      expect(
        sent.get(socket)!.find((msg) => msg.result?.workspaces)?.result,
      ).toEqual({
        workspaces: [{ id: "alpha" }],
        parents: "synthetic",
        git: 1,
        navigation_mode: "browser",
        tab_move_supported: true,
        endpoint_availability: { shared: true },
      });
    }
    expect(
      calls.every((call) => JSON.stringify(call.params) === "{}"),
    ).toBeTrue();
    calls.length = 0;
    await tick();
    expect(calls.map((call) => `${call.id}:${call.method}`).sort()).toEqual(
      FOCUSED_METHODS.map((method) => `alpha:${method}`).sort(),
    );
    expect([...sent.values()].flat().filter((msg) => msg.control)).toEqual([]);
    git = 2;
    await relist(one);
    await relist(two, false);
    await tick();
    expect(sent.get(one)!.filter((msg) => msg.control)).toEqual([]);
    expect(sent.get(two)!.filter((msg) => msg.control)).toEqual([
      { control: { type: "world_focused_changed", ...owner() } },
    ]);
    // Failed sends cannot make an unseen focused list become received evidence.
    git = 3;
    acceptingReplies = false;
    await relist(one);
    acceptingReplies = true;
    await tick();
    expect(sent.get(one)!.filter((msg) => msg.control)).toHaveLength(1);
    const before = calls.length;
    await manager.stop("alpha");
    acquisition.reconcile();
    await tick();
    expect(calls).toHaveLength(before);
  } finally {
    acquisition.stop();
    await manager.stopAll();
  }
});

test("socket cleanup releases acquisition once and publishes the changed browser count", () => {
  const released: unknown[] = [],
    counts: number[] = [];
  const browsers = createBrowserClients({
    logger: silentLogger,
    clock: { now: () => 0, monotonic: () => 0 },
    forEachRuntime() {},
    closed: (socket) => released.push(socket),
    countChanged: () => counts.push(browsers.clients.size),
  });
  const one = {} as ServerWebSocket<unknown>,
    two = {} as ServerWebSocket<unknown>;
  browsers.clients.add(one);
  browsers.notifyBrowserClientCount();
  browsers.clients.add(two);
  browsers.notifyBrowserClientCount();
  browsers.notifyBrowserClientCount();
  browsers.webSocketCleanup.cleanup(one);
  browsers.webSocketCleanup.cleanup(one);
  browsers.webSocketCleanup.cleanup(two);
  expect(released).toEqual([one, two]);
  expect(counts).toEqual([1, 2, 1, 0]);
});
