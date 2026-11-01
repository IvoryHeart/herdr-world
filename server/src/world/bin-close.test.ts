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

/** A scripted Herdr for one connection: panes, workspaces and a call log. */
function fakeHerdr(connectionId: string, panes: Pane[]) {
  const host = {
    generation: 1,
    current: true,
    panes: [...panes],
    worktreeRoots: new Set<string>(),
    calls: [] as string[],
    /** Throw this from the next close, after applying it (a lost reply). */
    loseReply: false,
    /** Never answer closes (a stalled host). */
    stalled: false,
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
            if (method === "pane.list")
              return {
                panes: host.panes.filter(
                  (p) => p.workspace_id === params.workspace_id,
                ),
              };
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
            if (host.stalled)
              return new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`timeout: ${method}`)), 1500),
              );
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
afterEach(async () => {
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

async function fixture(
  hosts: Record<string, ReturnType<typeof fakeHerdr>>,
  pins: string[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), "world-bin-close-"));
  roots.push(root);
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    realTime,
  );
  storages.push(storage);
  const outcomes: Omit<BinOutcome, "label" | "view">[] = [];
  const closer = createBinCloser({
    ledger: () => storage.ledger,
    outbox: () => storage.outbox,
    effects: () => storage.effects,
    incarnation: storage.incarnation,
    ...realTime,
    hasConnection: (id) => id in hosts,
    lease: (id) => hosts[id]?.lease() ?? null,
    pinned: (connectionId, tabId) => pins.includes(`${connectionId}:${tabId}`),
    settle: (id, outcome) => outcomes.push({ id, ...outcome }),
    log: () => {},
    retryDelay: () => 20,
  });
  closers.push(closer);
  const settled = async (count: number) => {
    for (let i = 0; i < 400 && outcomes.length < count; i++) await Bun.sleep(5);
    return outcomes;
  };
  return { storage, closer, outcomes, settled };
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

test("a new runtime generation, a changed occupant or a pin sends nothing", async () => {
  const studio = fakeHerdr("studio", [
    pane("p1"),
    { ...pane("p2"), terminal_id: "someone-else" },
    pane("p3", "pinned-tab"),
    pane("p4"),
  ]);
  const { closer, settled } = await fixture({ studio }, ["studio:pinned-tab"]);
  const restarted = entry("studio", pane("p1"), 0);
  const moved = entry("studio", pane("p2"));
  const pinned = entry("studio", pane("p3", "pinned-tab"));
  await closer.commit([restarted, moved, pinned]);
  const results = Object.fromEntries(
    (await settled(3)).map((o) => [o.id, [o.result, o.detail]]),
  );
  expect(results[restarted.id]).toEqual([
    "gone",
    "Its host restarted, so it was not closed.",
  ]);
  expect(results[moved.id]).toEqual([
    "gone",
    "It had already closed or moved, so nothing was sent.",
  ]);
  expect(results[pinned.id]).toEqual([
    "refused",
    "Unpin this tab before closing it.",
  ]);
  expect(studio.host.calls).toEqual([]);
});

test("a worktree root's pane is not closed while its workspace has others", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.worktreeRoots.add("w1");
  const { closer, settled } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
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
  stalled.host.stalled = true;
  const local = fakeHerdr("local", [pane("l1"), pane("l2")]);
  const { closer, settled } = await fixture({ stalled, local });
  const waiting = entry("stalled", pane("s1"));
  const ready = entry("local", pane("l1"));
  await closer.commit([waiting, ready]);
  expect(await settled(1)).toEqual([
    { id: ready.id, result: "closed", closed_tab: false },
  ]);
  expect(local.host.calls).toEqual(['pane.close {"pane_id":"l1"}']);
});

test("an offline host's close waits, then runs when the same runtime returns", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2")]);
  studio.host.current = false;
  const { closer, settled, storage } = await fixture({ studio });
  const one = entry("studio", pane("p1"));
  await closer.commit([one]);
  await Bun.sleep(100);
  const [pending] = await storage.outbox.forRecord(one.id);
  expect(pending?.kind).toBe(BIN_CLOSE_VERB);
  expect(pending?.state).toBe("pending");
  expect(studio.host.calls).toEqual([]);
  studio.host.current = true;
  await closer.wake("studio");
  expect((await settled(1))[0]).toEqual({
    id: one.id,
    result: "closed",
    closed_tab: false,
  });
});

test("an intent left by a stopped World resumes after restart, fenced by its runtime", async () => {
  const studio = fakeHerdr("studio", [pane("p1"), pane("p2"), pane("p3")]);
  studio.host.current = false;
  const root = mkdtempSync(join(tmpdir(), "world-bin-restart-"));
  roots.push(root);
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
  const open = async () => {
    const storage = await openWorldLedger(paths, realTime);
    const outcomes: string[] = [];
    const closer = createBinCloser({
      ledger: () => storage.ledger,
      outbox: () => storage.outbox,
      effects: () => storage.effects,
      incarnation: storage.incarnation,
      ...realTime,
      hasConnection: (id) => id === "studio",
      lease: () => studio.lease(),
      pinned: () => false,
      settle: (id, outcome) => outcomes.push(`${id} ${outcome.result}`),
      log: () => {},
      retryDelay: () => 20,
    });
    return { storage, closer, outcomes };
  };
  const first = await open();
  const same = entry("studio", pane("p1"));
  const replaced = entry("studio", pane("p2"), 7);
  await first.closer.commit([same, replaced]);
  await first.closer.stop();
  await first.storage.close();
  expect(studio.host.calls).toEqual([]);

  studio.host.current = true;
  const second = await open();
  storages.push(second.storage);
  closers.push(second.closer);
  await second.closer.wake();
  for (let i = 0; i < 100 && !studio.host.calls.length; i++)
    await Bun.sleep(10);
  await Bun.sleep(50);
  // Only the intent captured on the current runtime generation is sent.
  expect(studio.host.calls).toEqual(['pane.close {"pane_id":"p1"}']);
  const states = Object.fromEntries(
    await Promise.all(
      [same, replaced].map(async (e) => [
        e.pane_id,
        (await second.storage.outbox.forRecord(e.id))[0]?.state,
      ]),
    ),
  );
  expect(states).toEqual({ p1: "delivered", p2: "refused" });
});
