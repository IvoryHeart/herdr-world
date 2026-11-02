import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinState } from "../../../shared/bin";
import { WorldBinRegistry } from "../world/bin";
import type { BinLease } from "../world/bin-close";
import { handleBinRpc } from "./bin";
import type { BridgeRpcContext } from "./context";

function fixture() {
  const host = {
    generation: 3,
    current: true,
    pane: {
      pane_id: "p1",
      tab_id: "t1",
      terminal_id: "term-1",
      workspace_id: "w1",
    },
    reads: 0,
    siblings: [] as Record<string, unknown>[],
  };
  const registry = new WorldBinRegistry({
    epoch: "run",
    clock: { now: () => 0, monotonic: () => 0 },
    scheduler: { schedule: () => ({ cancel() {} }) },
    commit: async () => {},
    countdown: () => 30,
    publish: () => {},
  });
  const lease = (id: string): BinLease | null =>
    id === "studio" && host.current
      ? {
          connectionId: "studio",
          generation: host.generation,
          isCurrent: () => host.current,
          call: async () => {
            host.reads += 1;
            return { panes: [host.pane, ...host.siblings] };
          },
        }
      : null;
  const replies: unknown[] = [];
  const errors: string[] = [];
  const socket = {};
  const clients = new Set([socket]);
  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    handleBinRpc({
      id: "request",
      ws: socket,
      method,
      params,
      sendReply: (reply: Record<string, unknown>) => {
        replies.push(reply.result);
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      services: {
        clients,
        bin: {
          registry,
          lease,
          setCountdown: async () => {},
        },
      },
    } as unknown as BridgeRpcContext);
  const add = (extra: Record<string, unknown> = {}) =>
    rpc("world.bin.add", {
      connection_id: "studio",
      connection_generation: 3,
      workspace_id: "w1",
      tab_id: "t1",
      pane_id: "p1",
      terminal_id: "term-1",
      label: "Example agent",
      view: "town",
      ...extra,
    });
  return { host, registry, replies, errors, rpc, add, socket, clients };
}

test("a tray RPC is scoped to the browser socket and its disconnect releases the hold", async () => {
  const f = fixture();
  await f.add();
  await f.rpc("world.bin.pause");
  expect(f.registry.list().paused).toBe(true);
  f.registry.release(f.socket);
  expect(f.registry.list().paused).toBe(false);
  expect(f.registry.list().entries).toHaveLength(1);
  f.clients.delete(f.socket);
  await f.rpc("world.bin.pause");
  expect(f.registry.list().paused).toBe(false);
  expect(f.errors.at(-1)).toContain("window has closed");
});

test("adding stages the agent only while its pane holds the same terminal", async () => {
  const f = fixture();
  await f.add();
  expect(f.errors).toEqual([]);
  expect((f.replies[0] as BinState).entries[0]).toMatchObject({
    pane_id: "p1",
    label: "Example agent",
    view: "town",
    duration_ms: 30_000,
    departure_ms: BIN_DEPARTURE_MS,
    remaining_ms: 30_000 + BIN_DEPARTURE_MS,
  });
});

test("I1/R5: live pin admission keeps a sibling reserved through closing and uncertainty", async () => {
  const f = fixture();
  const first = { ...f.host.pane };
  const second = { ...first, pane_id: "p2", terminal_id: "term-2" };
  f.host.siblings = [second];
  await f.add({ preserve_tab: true });
  const id = f.registry.list().entries[0]!.id;
  f.registry.closeNow([id]);
  f.host.pane = second;
  f.host.siblings = [first];
  await f.add({ pane_id: "p2", terminal_id: "term-2", preserve_tab: true });
  expect(f.errors.at(-1)).toContain("pinned tab");
  expect(f.registry.list().entries).toEqual([]);
  f.registry.settle(id, { result: "uncertain", closed_tab: false });
  await f.add({ pane_id: "p2", terminal_id: "term-2", preserve_tab: true });
  expect(f.errors.at(-1)).toContain("pinned tab");
  // A decisive native absence releases the old reservation, but p2 is still
  // the pinned tab's sole pane and cannot close against a stale browser view.
  f.host.siblings = [];
  await f.add({ pane_id: "p2", terminal_id: "term-2", preserve_tab: true });
  expect(f.registry.list().reservations).toEqual([]);
  expect(f.registry.list().entries).toEqual([]);
  expect(f.errors.at(-1)).toContain("pinned tab");
});

test("I1/R5: concurrent native admissions cannot stage both panes of a pinned tab", async () => {
  const f = fixture();
  f.host.siblings = [{ ...f.host.pane, pane_id: "p2", terminal_id: "term-2" }];
  await Promise.all([
    f.add({ preserve_tab: true }),
    f.add({ pane_id: "p2", terminal_id: "term-2", preserve_tab: true }),
  ]);
  expect(f.registry.list().entries).toHaveLength(1);
  expect(f.errors).toHaveLength(1);
  expect(f.errors[0]).toContain("pinned tab");
});

test("an old runtime, an absent host or a new occupant is refused", async () => {
  const f = fixture();
  await f.add({ connection_generation: 2 });
  await f.add({ connection_id: "elsewhere" });
  f.host.pane = { ...f.host.pane, terminal_id: "someone-else" };
  await f.add();
  expect(f.errors).toEqual([
    "That agent's host is unavailable",
    "That agent's host is unavailable",
    "That agent has already closed or moved",
  ]);
  expect(f.registry.list().entries).toEqual([]);
});

test("put back, pause and close now act only on the staged countdown", async () => {
  const f = fixture();
  await f.add();
  const id = f.registry.list().entries[0]!.id;
  await f.rpc("world.bin.pause");
  expect(f.registry.list().paused).toBe(true);
  await f.rpc("world.bin.restore", { id });
  expect(f.registry.list().entries).toEqual([]);
  await f.rpc("world.bin.unknown");
  expect(f.errors).toEqual(["unknown bin operation"]);
});

test("every bridge-global verb, the bin's included, is admitted for the browser as dispatch routes it", async () => {
  const { VERBS, registeredVerb } = await import("../verbs/registry");
  const { admitVerb } = await import("../verbs/admission");
  const { isBridgeGlobalMethod } = await import("../connections/protocol");
  const { routeCapabilities } = await import("../service/rpc-dispatch");
  const bridge = routeCapabilities("bridge");
  const missing = VERBS.filter(
    (verb) =>
      verb.channel === "rpc" &&
      isBridgeGlobalMethod(verb.name) &&
      verb.policy.browser !== "deny" &&
      verb.capabilities.some((capability) => !bridge.has(capability)),
  ).map((verb) => verb.name);
  expect(missing).toEqual([]);
  expect(() =>
    admitVerb(
      registeredVerb("rpc", "world.bin.add"),
      {
        connection_id: "studio",
        connection_generation: 3,
        workspace_id: "w1",
        tab_id: "t1",
        pane_id: "p1",
        terminal_id: "term-1",
        label: "Example agent",
        view: "town",
      },
      {
        actor: "browser",
        authorized: () => true,
        capabilities: () => bridge,
        preconditions: () => true,
      },
    ),
  ).not.toThrow();
});

test("close now admits only an explicit list of entries, never an unscoped all", async () => {
  const { registeredVerb } = await import("../verbs/registry");
  const { admitVerb } = await import("../verbs/admission");
  const { routeCapabilities } = await import("../service/rpc-dispatch");
  const admission = {
    actor: "browser" as const,
    authorized: () => true,
    capabilities: () => routeCapabilities("bridge"),
    preconditions: () => true,
  };
  const verb = registeredVerb("rpc", "world.bin.close_now");
  for (const params of [{ id: "all" }, { ids: [] }, { ids: "all" }])
    expect(() => admitVerb(verb, params, admission)).toThrow();
  expect(() =>
    admitVerb(verb, { ids: ["bin-run-1", "bin-run-2"] }, admission),
  ).not.toThrow();
});
