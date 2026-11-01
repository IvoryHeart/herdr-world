import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BinEntry, BinOutcome } from "../../../shared/bin";
import {
  openWorldLedger,
  type WorldLedgerStorage,
} from "../storage/world-storage";
import { BIN_CLOSE_VERB, createBinCloser, type BinLease } from "./bin-close";

type Pane = {
  pane_id: string;
  tab_id: string;
  terminal_id: string;
  workspace_id: string;
};

/** Something the test can hold, then let go of. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/**
 * Event barriers instead of sleeps: `until` re-checks only when the closer
 * reports a durable change or an outcome, registering before each check so
 * no event between a check and the wait is missed.
 */
function signals() {
  let waiters: (() => void)[] = [];
  return {
    fire() {
      const ready = waiters;
      waiters = [];
      for (const wake of ready) wake();
    },
    async until(condition: () => boolean | Promise<boolean>) {
      for (;;) {
        const next = new Promise<void>((resolve) => waiters.push(resolve));
        if (await condition()) return;
        await next;
      }
    },
  };
}

/** A scripted Herdr for one connection: panes, workspaces and a call log. */
function fakeHerdr(connectionId: string, panes: Pane[]) {
  const host = {
    generation: 1,
    current: true,
    panes: [...panes],
    worktreeRoots: new Set<string>(),
    calls: [] as string[],
    /** Apply the next close, then lose its reply. */
    loseReply: false,
    /** Hold closes until the test releases them (a stalled host). */
    stall: null as ReturnType<typeof gate> | null,
    /** Lose the reply AND leave the pane: the outcome cannot be known. */
    ghostClose: false,
    /** Hold pane reads until released; `reading` opens when one starts. */
    listGate: null as ReturnType<typeof gate> | null,
    reading: gate(),
    /** Called after each pane read with its index (1-based). */
    afterList: null as ((count: number) => void) | null,
    lists: 0,
    replyDelay: 0,
  };
  const workspaces = () => [...new Set(host.panes.map((p) => p.workspace_id))];
  const lease = (): BinLease | null =>
    host.current
      ? {
          connectionId,
          generation: host.generation,
          isCurrent: () => host.current,
          async call(method, params, _timeout, beforeSend) {
            beforeSend?.();
            if (host.replyDelay) await Bun.sleep(host.replyDelay);
            if (method === "pane.list") {
              host.reading.open();
              if (host.listGate) await host.listGate.opened;
              const panes = host.panes.filter(
                (p) => p.workspace_id === params.workspace_id,
              );
              host.lists += 1;
              host.afterList?.(host.lists);
              return { panes };
            }
            if (method === "workspace.list")
              return {
                workspaces: workspaces().map((workspace_id) => ({
                  workspace_id,
                })),
              };
            if (method === "workspace.get")
              return {
                workspace: {
                  workspace_id: params.workspace_id,
                  ...(host.worktreeRoots.has(String(params.workspace_id))
                    ? { worktree: { is_linked_worktree: false } }
                    : {}),
                },
              };
            host.calls.push(`${method} ${JSON.stringify(params)}`);
            if (host.stall) {
              await host.stall.opened;
              throw new Error(`timeout: ${method}`);
            }
            if (host.ghostClose) throw new Error(`timeout: ${method}`);
            if (method === "pane.close")
              host.panes = host.panes.filter(
                (p) => p.pane_id !== params.pane_id,
              );
            else if (method === "workspace.close")
              host.panes = host.panes.filter(
                (p) => p.workspace_id !== params.workspace_id,
              );
            else throw new Error(`unexpected ${method}`);
            if (host.loseReply) throw new Error("timeout: " + method);
            return {};
          },
        }
      : null;
  return { host, lease };
}

const roots: string[] = [];
const storages: WorldLedgerStorage[] = [];
const closers: { stop(): Promise<void> }[] = [];
const stalls: ReturnType<typeof gate>[] = [];
afterEach(async () => {
  for (const stall of stalls.splice(0)) stall.open();
  for (const closer of closers.splice(0)) await closer.stop();
  for (const storage of storages.splice(0)) await storage.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const realTime = {
  clock: { now: () => Date.now(), monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};

type Hosts = Record<string, ReturnType<typeof fakeHerdr>>;

function storagePaths() {
  const root = mkdtempSync(join(tmpdir(), "world-bin-close-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
}

async function fixture(
  hosts: Hosts,
  paths = storagePaths(),
  ledger?: (storage: WorldLedgerStorage) => WorldLedgerStorage["ledger"],
  options: {
    retryDelay?: number;
    outbox?: (storage: WorldLedgerStorage) => WorldLedgerStorage["outbox"];
  } = {},
) {
  const storage = await openWorldLedger(paths, realTime);
  storages.push(storage);
  const outcomes: Omit<BinOutcome, "label" | "view">[] = [];
  const events = signals();
  const closer = createBinCloser({
    ledger: () => ledger?.(storage) ?? storage.ledger,
    outbox: () => options.outbox?.(storage) ?? storage.outbox,
    effects: () => storage.effects,
    incarnation: storage.incarnation,
    ...realTime,
    hasConnection: (id) => id in hosts,
    lease: (id) => hosts[id]?.lease() ?? null,
    settle: (id, outcome) => {
      outcomes.push({ id, ...outcome });
      events.fire();
    },
    changed: () => events.fire(),
    log: () => {},
    retryDelay: () => options.retryDelay ?? 20,
  });
  closers.push(closer);
  const settled = async (count: number) => {
    await events.until(() => outcomes.length >= count);
    return outcomes;
  };
  const state = async (id: string) =>
    (await storage.outbox.forRecord(id)).find(
      (item) => item.kind === BIN_CLOSE_VERB,
    )?.state;
  return { storage, closer, outcomes, settled, events, state };
}

let ids = 0;
const entry = (
  connection_id: string,
  pane: Pane,
  generation = 1,
): BinEntry => ({
  id: `bin-test-${++ids}`,
  connection_id,
  connection_generation: generation,
  ...pane,
  label: pane.pane_id,
  view: "board",
  duration_ms: 30_000,
  departure_ms: 6_000,
  remaining_ms: 0,
  trip: "trip",
});

const pane = (id: string, tab = "t1", workspace = "w1"): Pane => ({
  pane_id: id,
  tab_id: tab,
  terminal_id: `term-${id}`,
  workspace_id: workspace,
});

test("closes a pane that shares its workspace with pane.close", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2", "t2")]);
  const { closer, settled } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  expect(await settled(1)).toEqual([
    { id: one.id, result: "closed", closed_tab: true },
  ]);
  expect(studio.host.calls).toEqual(['pane.close {"pane_id":"p1"}']);
});

test("two panes of one workspace close as pane.close then workspace.close", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.replyDelay = 1;
  const { closer, settled } = await fixture({ studio });
  const [a, b] = [entry("studio", pane("p1")), entry("studio", pane("p2"))];
  await closer.commit([a!, b!]);
  const outcomes = await settled(2);
  // Whichever closes first sees two panes; the second is the workspace's last.
  expect(outcomes.map((o) => [o.result, o.closed_tab])).toEqual([
    ["closed", false],
    ["closed", true],
  ]);
  expect(new Set(outcomes.map((o) => o.id))).toEqual(new Set([a!.id, b!.id]));
  expect(studio.host.calls).toHaveLength(2);
  expect(studio.host.calls[0]).toStartWith("pane.close ");
  expect(studio.host.calls[1]).toBe('workspace.close {"workspace_id":"w1"}');
});

test("a new runtime generation or a changed occupant sends nothing", async () => {
  const studio = fakeHerdr("studio", [
    pane("p1"),
    { ...pane("p2"), terminal_id: "someone-else" },
    pane("p4"),
  ]);
  const { closer, settled } = await fixture({ studio });
  const restarted = entry("studio", pane("p1"), 0);
  const moved = entry("studio", pane("p2"));
  await closer.commit([restarted, moved]);
  const results = Object.fromEntries(
    (await settled(2)).map((o) => [o.id, [o.result, o.detail]]),
  );
  expect(results[restarted.id]).toEqual([
    "gone",
    "Its host restarted, so it was not closed.",
  ]);
  expect(results[moved.id]).toEqual([
    "gone",
    "It had already closed or moved, so nothing was sent.",
  ]);
  expect(studio.host.calls).toEqual([]);
});

test("a worktree root's pane is not closed while its workspace has others", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.worktreeRoots.add("w1");
  const { closer, settled } = await fixture({ studio });
  await closer.commit([entry("studio", pane("p1"))]);
  expect((await settled(1))[0]!.result).toBe("refused");
  expect(studio.host.calls).toEqual([]);
});

test("a lost reply is read back and recorded as closed", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.loseReply = true;
  const { closer, settled } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  expect(await settled(1)).toEqual([
    { id: one.id, result: "closed", closed_tab: false },
  ]);
  expect(studio.host.calls).toHaveLength(1);
});

test("a stalled host never holds back another host's close", async () => {
  const stalled = fakeHerdr("stalled", [pane("s1"), pane("s2")]);
  const stall = gate();
  stalls.push(stall);
  stalled.host.stall = stall;
  const local = fakeHerdr("local", [pane("l1"), pane("l2")]);
  const { closer, settled } = await fixture({ stalled, local });
  const waiting = entry("stalled", pane("s1"));
  const ready = entry("local", pane("l1"));
  await closer.commit([waiting, ready]);
  // The local close completes while the stalled host still holds its send.
  expect(await settled(1)).toEqual([
    { id: ready.id, result: "closed", closed_tab: false },
  ]);
  expect(local.host.calls).toEqual(['pane.close {"pane_id":"l1"}']);
  expect(stalled.host.calls).toEqual(['pane.close {"pane_id":"s1"}']);
});

test("an offline host's close waits, then runs when the same runtime returns", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.current = false;
  const { closer, settled, storage, events } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  // Its first attempt finishes as waiting, without sending.
  await events.until(async () => {
    const [item] = await storage.outbox.forRecord(one.id);
    return item?.state === "pending" && item.attempt > 0;
  });
  expect(studio.host.calls).toEqual([]);
  studio.host.current = true;
  await closer.wake("studio");
  expect((await settled(1))[0]).toEqual({
    id: one.id,
    result: "closed",
    closed_tab: false,
  });
});

test("after a World restart, a reused generation and IDs never get a recorded close", async () => {
  // The replacement runtime counts from generation 1 again and reuses the
  // native IDs: nothing recorded before the restart may reach it.
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2"), pane("p3")]);
  const paths = storagePaths();
  let held: ReturnType<typeof gate> | null = null;
  const first = await fixture({ studio }, paths, (s) => ({
    ...s.ledger,
    update: async (change, effects) => {
      if (held) await held.opened;
      return s.ledger.update(change, effects);
    },
  }));
  // A close is sent and its outcome is lost (the pane stays): uncertain.
  studio.host.ghostClose = true;
  const maybe = entry("studio", pane("p2"));
  await first.closer.commit([maybe]);
  await first.events.until(
    async () => (await first.state(maybe.id)) === "uncertain",
  );
  // Another is recorded but never attempted: its commit overlaps the stop.
  held = gate();
  const unsent = entry("studio", pane("p1"));
  const committing = first.closer.commit([unsent]);
  const stopping = first.closer.stop();
  held.open();
  await committing;
  await stopping;
  await first.storage.close();
  storages.splice(storages.indexOf(first.storage), 1);
  const sentBefore = [...studio.host.calls];
  studio.host.ghostClose = false;
  studio.host.lists = 0;

  const second = await fixture({ studio }, paths);
  await second.closer.wake();
  await second.events.until(
    async () =>
      (await second.state(unsent.id)) === "refused" &&
      (await second.state(maybe.id)) === "uncertain" &&
      (await second.storage.outbox.forRecord(maybe.id))[0]!.evidence?.reason ===
        "World restarted before it was sent, so it was not closed.",
  );
  // Unsent ends not sent; possibly sent stays uncertain; nothing is sent
  // to, or read from, the replacement runtime.
  expect(studio.host.calls).toEqual(sentBefore);
  expect(studio.host.lists).toBe(0);
});

test("a ready host's close is sent while an offline host holds 100 older closes", async () => {
  const far = fakeHerdr(
    "far",
    Array.from({ length: 100 }, (_, i) => pane(`f${i}`, "tf", "wf")),
  );
  far.host.current = false;
  const near = fakeHerdr("near", [pane("n1"), pane("n2")]);
  const { closer, events, state } = await fixture({ far, near });
  // The offline host's closes are recorded first, so they come first by deadline.
  const backlog = far.host.panes.map((p) => entry("far", p));
  await closer.commit(backlog);
  const waiting = entry("near", pane("n1"));
  await closer.commit([waiting]);
  await events.until(async () => (await state(waiting.id)) === "delivered");
  expect(near.host.calls).toEqual(['pane.close {"pane_id":"n1"}']);
  expect(far.host.calls).toEqual([]);
  expect(await state(backlog[0]!.id)).toBe("pending");
});

test("after a restart, discovery reaches a host past the first 100 closes and ends it unsent", async () => {
  const far = fakeHerdr(
    "far",
    Array.from({ length: 100 }, (_, i) => pane(`f${i}`, "tf", "wf")),
  );
  far.host.current = false;
  const near = fakeHerdr("near", [pane("n1"), pane("n2")]);
  near.host.current = false;
  const paths = storagePaths();
  const first = await fixture({ far, near }, paths, undefined, {
    retryDelay: 0,
  });
  const backlog = far.host.panes.map((p) => entry("far", p));
  await first.closer.commit(backlog);
  const waiting = entry("near", pane("n1"));
  await first.closer.commit([waiting]);
  await first.closer.stop();
  await first.storage.close();
  storages.splice(storages.indexOf(first.storage), 1);

  near.host.current = true;
  const second = await fixture({ far, near }, paths);
  await second.closer.wake();
  await second.events.until(
    async () => (await second.state(waiting.id)) === "refused",
  );
  expect(near.host.calls).toEqual([]);
  expect(far.host.calls).toEqual([]);
});

test("a stop during a held commit sends nothing and keeps the recorded close", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  const hold = gate();
  const { closer, state } = await fixture({ studio }, storagePaths(), (s) => ({
    ...s.ledger,
    update: async (change, effects) => {
      await hold.opened;
      return s.ledger.update(change, effects);
    },
  }));
  const one = entry("studio", pane("p1"));
  const committing = closer.commit([one]);
  const stopping = closer.stop();
  hold.open();
  // The commit resolves: the close is recorded, not reported as unrecorded.
  await committing;
  await stopping;
  expect(studio.host.calls).toEqual([]);
  expect(await state(one.id)).toBe("pending");
  await expect(closer.commit([entry("studio", pane("p2"))])).rejects.toThrow(
    "World is stopping",
  );
});

test("a sibling that appears in the final read turns a workspace close into a pane close", async () => {
  // Planned as the workspace's last pane; the read just before sending
  // finds a new pane, so closing the workspace would take it too.
  const studio = fakeHerdr("studio", [pane("p1")]);
  studio.host.afterList = (count) => {
    if (count === 1) studio.host.panes.push(pane("p9"));
  };
  const { closer, settled } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  expect(await settled(1)).toEqual([
    { id: one.id, result: "closed", closed_tab: false },
  ]);
  expect(studio.host.calls).toEqual(['pane.close {"pane_id":"p1"}']);
  expect(studio.host.panes.map((p) => p.pane_id)).toEqual(["p9"]);
});

test("stop revokes a lane that is mid-read while another commit is held", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2"), pane("p3")]);
  studio.host.listGate = gate();
  let updates = 0;
  const hold = gate();
  const { closer, state } = await fixture({ studio }, storagePaths(), (s) => ({
    ...s.ledger,
    update: async (change, effects) => {
      if (++updates === 2) await hold.opened;
      return s.ledger.update(change, effects);
    },
  }));
  const first = entry("studio", pane("p1"));
  await closer.commit([first]);
  // The existing lane is now inside its pane read.
  await studio.host.reading.opened;
  const second = closer.commit([entry("studio", pane("p2"))]);
  const stopping = closer.stop();
  studio.host.listGate.open();
  hold.open();
  await second;
  await stopping;
  expect(studio.host.calls).toEqual([]);
  expect(await state(first.id)).toBe("pending");
});

test("discovery pages past 256 removed hosts with uncertain closes to a ready host", async () => {
  // 260 hosts each lose a close's reply with the pane left in place, so
  // their closes stay uncertain; then they are removed from World.
  const hosts: Hosts = {};
  const removed = Array.from(
    { length: 260 },
    (_, i) => `gone-${String(i).padStart(3, "0")}`,
  );
  for (const id of removed) {
    hosts[id] = fakeHerdr(id, [pane("x1"), pane("x2")]);
    hosts[id]!.host.ghostClose = true;
  }
  const late = fakeHerdr("zz-ready", [pane("r1"), pane("r2")]);
  late.host.current = false;
  hosts["zz-ready"] = late;
  const paths = storagePaths();
  let held: ReturnType<typeof gate> | null = null;
  // A long retry keeps each uncertain close idle once it is uncertain.
  const first = await fixture(
    hosts,
    paths,
    (s) => ({
      ...s.ledger,
      update: async (change, effects) => {
        if (held) await held.opened;
        return s.ledger.update(change, effects);
      },
    }),
    { retryDelay: 600_000 },
  );
  const lost = removed.map((id) => entry(id, pane("x1")));
  for (let i = 0; i < lost.length; i += 20) {
    const batch = lost.slice(i, i + 20);
    await first.closer.commit(batch);
    await first.events.until(async () => {
      for (const item of batch)
        if ((await first.state(item.id)) !== "uncertain") return false;
      return true;
    });
  }
  // The ready host's close is recorded across the stop, never attempted.
  held = gate();
  const waiting = entry("zz-ready", pane("r1"));
  const committing = first.closer.commit([waiting]);
  const stopping = first.closer.stop();
  held.open();
  await committing;
  await stopping;
  await first.storage.close();
  storages.splice(storages.indexOf(first.storage), 1);

  for (const id of removed) delete hosts[id];
  late.host.current = true;
  const second = await fixture(hosts, paths);
  await second.closer.wake();
  // The ready host sorts after every removed one: only paging reaches it.
  await second.events.until(
    async () => (await second.state(waiting.id)) === "refused",
  );
  expect(late.host.calls).toEqual([]);
  expect(await second.state(lost[0]!.id)).toBe("uncertain");
});

test("a close recorded but not looked up at once is still tracked, never reported unrecorded", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  let fail = true;
  const { closer, settled } = await fixture(
    { studio },
    storagePaths(),
    undefined,
    {
      outbox: (s) => ({
        ...s.outbox,
        forRecord: async (id) => {
          if (fail) {
            fail = false;
            throw new Error("lookup failed once");
          }
          return s.outbox.forRecord(id);
        },
      }),
    },
  );
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  expect(await settled(1)).toEqual([
    { id: one.id, result: "closed", closed_tab: false },
  ]);
});

test("an unconfirmed write that did commit is tracked; a refused write is not recorded", async () => {
  const { StorageWriteRejected } = await import("../storage/world-protocol");
  const { BinCloseNotRecorded } = await import("./bin");
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2"), pane("p3")]);
  let mode: "lost-ack" | "refused" = "lost-ack";
  const { closer, settled } = await fixture(
    { studio },
    storagePaths(),
    (s) => ({
      ...s.ledger,
      update: async (change, effects) => {
        if (mode === "refused")
          throw new StorageWriteRejected("World storage is closing");
        await s.ledger.update(change, effects);
        throw new Error("worker reply lost");
      },
    }),
  );
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  expect(await settled(1)).toEqual([
    { id: one.id, result: "closed", closed_tab: false },
  ]);
  mode = "refused";
  await expect(closer.commit([entry("studio", pane("p2"))])).rejects.toThrow(
    BinCloseNotRecorded,
  );
  expect(studio.host.calls).toEqual(['pane.close {"pane_id":"p1"}']);
});
