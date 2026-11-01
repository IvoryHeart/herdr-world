import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BIN_DEPARTURE_MS,
  type BinTarget,
  type BinView,
} from "../../../shared/bin";
import { WorldBinStore } from "../../../web/src/world/bin/binStore";
import { handleBinRpc } from "../rpc/bin";
import type { BridgeRpcContext } from "../rpc/context";
import { openWorldLedger } from "../storage/world-storage";
import { WorldBinRegistry } from "./bin";
import { createBinCloser, type BinLease } from "./bin-close";

/** Real RPC, browser stores, SQLite and close driver; synthetic native source. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-bin-flow-"));
  const time = {
    clock: { now: () => Date.now(), monotonic: () => performance.now() },
    scheduler: {
      schedule(run: () => void, delay: number) {
        const timer = setTimeout(run, delay);
        return { cancel: () => clearTimeout(timer) };
      },
    },
  };
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    time,
  );
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const commits: Promise<void>[] = [];
  const completed = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<void>>
  >();
  const targets = ["p1", "p2"].map(
    (pane): BinTarget => ({
      connection_id: "studio",
      connection_generation: 1,
      workspace_id: "w1",
      tab_id: `t-${pane}`,
      pane_id: pane,
      terminal_id: `terminal-${pane}`,
    }),
  );
  let panes = [...targets];
  const calls: string[] = [];
  const lease = (): BinLease => ({
    connectionId: "studio",
    generation: 1,
    isCurrent: () => true,
    async call(method, params, _timeout, beforeSend) {
      beforeSend?.();
      if (method === "pane.list") return { panes };
      if (method === "workspace.list")
        return { workspaces: panes.length ? [{ workspace_id: "w1" }] : [] };
      if (method === "workspace.get")
        return { workspace: { workspace_id: "w1" } };
      calls.push(method);
      if (method === "pane.close")
        panes = panes.filter((pane) => pane.pane_id !== params.pane_id);
      else if (method === "workspace.close") panes = [];
      else throw new Error(`unexpected native method ${method}`);
      return {};
    },
  });
  const done = (id: string) => {
    let result = completed.get(id);
    if (!result) completed.set(id, (result = Promise.withResolvers<void>()));
    return result;
  };
  const closer = createBinCloser({
    ledger: () => storage.ledger,
    outbox: () => storage.outbox,
    effects: () => storage.effects,
    incarnation: storage.incarnation,
    ...time,
    hasConnection: (id) => id === "studio",
    lease: (id) => (id === "studio" ? lease() : null),
    settle: (id, outcome) => {
      registry.settle(id, outcome);
      done(id).resolve();
    },
    changed: () => {},
    log: () => {},
  });
  const registry = new WorldBinRegistry({
    epoch: "flow",
    clock: { now: () => now, monotonic: () => now },
    scheduler: {
      schedule(run, delay) {
        const timer = { at: now + delay, run };
        timers.add(timer);
        return { cancel: () => timers.delete(timer) };
      },
    },
    commit: (entries) => {
      const committed = closer.commit(entries);
      commits.push(committed);
      return committed;
    },
    countdown: () => 30,
    publish: () => {},
  });
  const client = {
    async call(method: string, params: Record<string, unknown> = {}) {
      let result: unknown;
      let failure: unknown;
      await handleBinRpc({
        id: "flow-request",
        method,
        params,
        sendReply: (reply: { result: unknown }) => {
          result = reply.result;
          return true;
        },
        sendError: (_context: string, error: unknown) => {
          failure = error;
        },
        services: {
          bin: {
            registry,
            lease: (id: string) => (id === "studio" ? lease() : null),
          },
        },
      } as unknown as BridgeRpcContext);
      if (failure) throw failure;
      return result;
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  };
  const views = Array.from(
    { length: 3 },
    () => new WorldBinStore(client, () => now),
  );
  const refresh = () => Promise.all(views.map((view) => view.refresh()));
  return {
    storage,
    registry,
    views,
    calls,
    refresh,
    add: (index: number, view: BinView, trip?: string) =>
      views[0]!.add({
        ...targets[index]!,
        label: `Example ${index}`,
        view,
        ...(trip ? { join: trip } : {}),
      }),
    async advance(ms: number) {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at))
        if (timer.at <= now) {
          timers.delete(timer);
          timer.run();
        }
      await Promise.all(commits);
      await refresh();
    },
    settled: (id: string) => done(id).promise,
    replace: () => {
      panes = panes.map((pane) => ({ ...pane, terminal_id: "replacement" }));
    },
    async close() {
      registry.dispose();
      await closer.stop();
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const view of ["board", "town", "desk"] as const)
  test(`${view}: no durable intent or native close until the full departure ends`, async () => {
    const f = await fixture();
    try {
      const staged = await f.add(0, view);
      const id = staged!.entries[0]!.id;
      await f.advance(30_000 + BIN_DEPARTURE_MS - 1);
      expect(await f.storage.outbox.forRecord(id)).toEqual([]);
      expect(f.calls).toEqual([]);
      expect(
        f.views.map((store) => store.remaining(store.get().entries[0]!)),
      ).toEqual([1, 1, 1]);
      await f.advance(1);
      await f.settled(id);
      await f.refresh();
      expect(f.calls).toEqual(["pane.close"]);
      expect(
        (await f.storage.outbox.forRecord(id)).map((intent) => intent.state),
      ).toEqual(["delivered"]);
      for (const store of f.views)
        expect(store.get().outcomes[0]).toMatchObject({
          id,
          result: "closed",
          view,
        });
    } finally {
      await f.close();
    }
  });

for (const left of [25_000, 11_000, 1_000, 0])
  test(`boarding with ${left} ms wait left shares a reset only before departure`, async () => {
    const f = await fixture();
    try {
      const first = (await f.add(0, "town"))!.entries[0]!;
      await f.advance(30_000 - left);
      // Board supplies no join hint: the service owns the shared countdown.
      const boarded = (await f.add(1, "board"))!.entries;
      const joins = left > 0;
      expect(boarded[1]!.trip === first.trip).toBe(joins);
      await f.advance(left + BIN_DEPARTURE_MS);
      if (joins) {
        expect(f.calls).toEqual([]);
        expect(await f.storage.outbox.forRecord(first.id)).toEqual([]);
        await f.advance(30_000 - left);
      }
      await f.settled(first.id);
      if (joins) {
        await f.settled(boarded[1]!.id);
        expect(f.calls).toEqual(["pane.close", "workspace.close"]);
      } else {
        expect(f.calls).toEqual(["pane.close"]);
        expect(await f.storage.outbox.forRecord(boarded[1]!.id)).toEqual([]);
        await f.views[0]!.restore(boarded[1]!.id);
      }
    } finally {
      await f.close();
    }
  });

test("holding during departure and putting back leaves no durable close", async () => {
  const f = await fixture();
  try {
    const id = (await f.add(0, "town"))!.entries[0]!.id;
    await f.advance(33_000);
    await f.views[1]!.pause();
    await f.advance(60_000);
    expect(
      f.views.map((store) => store.remaining(store.get().entries[0]!)),
    ).toEqual([3_000, 3_000, 3_000]);
    await f.views[2]!.restore(id);
    await f.advance(60_000);
    expect(await f.storage.outbox.forRecord(id)).toEqual([]);
    expect(f.calls).toEqual([]);
  } finally {
    await f.close();
  }
});

test("a source replacement before departure expiry refuses the close unsent", async () => {
  const f = await fixture();
  try {
    const id = (await f.add(0, "town"))!.entries[0]!.id;
    await f.advance(30_000);
    f.replace();
    await f.advance(BIN_DEPARTURE_MS);
    await f.settled(id);
    expect(f.registry.list().outcomes[0]).toMatchObject({ id, result: "gone" });
    expect(f.calls).toEqual([]);
  } finally {
    await f.close();
  }
});
