import { expect, test } from "bun:test";
import type { BinState } from "../../../shared/bin";
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
    /** Other panes of the workspace. */
    others: [] as Record<string, string>[],
    reads: 0,
  };
  const registry = new WorldBinRegistry({
    epoch: "run",
    clock: { now: () => 0, monotonic: () => 0 },
    scheduler: { schedule: () => ({ cancel() {} }) },
    commit: async () => {},
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
            return { panes: [host.pane, ...host.others] };
          },
        }
      : null;
  const replies: unknown[] = [];
  const errors: string[] = [];
  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    handleBinRpc({
      id: "request",
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
        bin: { registry, lease },
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
  return { host, registry, replies, errors, rpc, add };
}

test("adding stages the agent only while its pane holds the same terminal", async () => {
  const f = fixture();
  await f.add();
  expect(f.errors).toEqual([]);
  expect((f.replies[0] as BinState).entries[0]).toMatchObject({
    pane_id: "p1",
    label: "Example agent",
    view: "town",
    riding: false,
    preserve_tab: false,
  });
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

test("put back acts only on the held agent", async () => {
  const f = fixture();
  await f.add();
  const id = f.registry.list().entries[0]!.id;
  await f.rpc("world.bin.restore", { id });
  expect(f.registry.list().entries).toEqual([]);
  await f.rpc("world.bin.pause");
  await f.rpc("world.bin.countdown.set", { countdown_s: 10 });
  expect(f.errors).toEqual(["unknown bin operation", "unknown bin operation"]);
});

test("a pinned tab's last agent is refused; one with another pane is held", async () => {
  const f = fixture();
  await f.add({ preserve_tab: true });
  expect(f.errors).toEqual([
    "A pinned tab keeps its last agent; unpin its desk first",
  ]);
  // A pane in another tab does not keep this tab.
  f.host.others = [
    { pane_id: "p9", tab_id: "t2", terminal_id: "t9", workspace_id: "w1" },
  ];
  await f.add({ preserve_tab: true });
  expect(f.errors).toHaveLength(2);
  f.host.others.push({
    pane_id: "p2",
    tab_id: "t1",
    terminal_id: "term-2",
    workspace_id: "w1",
  });
  await f.add({ preserve_tab: true });
  expect(f.errors).toHaveLength(2);
  expect(f.registry.list().entries[0]!.preserve_tab).toBe(true);
  // With p1 held, p2 is now the tab's last pane.
  await f.add({ pane_id: "p2", terminal_id: "term-2", preserve_tab: true });
  expect(f.errors).toHaveLength(3);
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
