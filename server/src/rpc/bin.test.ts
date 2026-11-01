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
    reads: 0,
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
            return { panes: [host.pane] };
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
    remaining_ms: 30_000,
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
