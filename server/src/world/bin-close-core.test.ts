import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BinEntry, BinOutcome } from "../../../shared/bin";
import { planCoreKill } from "../herdr-core/operations";
import { coreWorld, until } from "../herdr-core/testing/core-world";
import {
  openWorldLedger,
  type WorldLedgerStorage,
} from "../storage/world-storage";
import { createBinCloser } from "./bin-close";
import { BIN_CORE_CLOSE_VERB } from "./bin-close-core";

/**
 * The bin closing a herdr-core agent: a durable intent in World's SQLite,
 * then a native kill through the real provider, carrying the confirmation
 * of everything that ends with it (M7).
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
const storages: WorldLedgerStorage[] = [];
const closers: { stop(): Promise<void> }[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const closer of closers.splice(0)) await closer.stop();
  for (const storage of storages.splice(0)) await storage.close();
  for (const w of worlds.splice(0)) await w.dispose();
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

async function setup() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  const lead = w.fake.create({
    argv: ["/opt/example/bin/claude"],
    name: "lead",
  });
  const helper = w.fake.create({
    parent: lead,
    die_with_parent: true,
    name: "helper",
  });
  const server = w.fake.create({
    parent: lead,
    die_with_parent: false,
    name: "server",
  });
  await w.settle();
  const root = mkdtempSync(join(tmpdir(), "world-bin-core-"));
  roots.push(root);
  const storage = await openWorldLedger(
    {
      database: join(root, "world.sqlite"),
      ledger: join(root, "ledger.json"),
    },
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
    hasConnection: () => false,
    lease: () => null,
    hasCoreConnection: (id) => id === "box",
    coreLease: (id) =>
      id === "box" ? w.core.manager.readyRuntimeLease(id) : null,
    settle: (id, outcome) => outcomes.push({ id, ...outcome }),
    log: () => {},
    retryDelay: () => 20,
  });
  closers.push(closer);
  const plan = await planCoreKill(w.lease(), [lead]);
  const entry = (confirmed = plan): BinEntry => ({
    id: `bin-core-${Math.random().toString(36).slice(2)}`,
    connection_id: "box",
    connection_generation: w.lease().generation,
    workspace_id: "hc:unplaced",
    tab_id: "hc:unplaced:tab:main",
    pane_id: lead,
    terminal_id: lead,
    runtime: "herdr-core",
    confirmation: {
      core_id: confirmed.core_id,
      terminals: [...confirmed.roots, ...confirmed.descendants].map((t) => ({
        address: t.address,
        pid: t.pid,
        occupant: t.occupant,
      })),
    },
    label: "lead",
    view: "town",
    riding: true,
    preserve_tab: false,
  });
  return { w, storage, closer, outcomes, plan, entry, lead, helper, server };
}

describe("the bin closes core agents by a confirmed native kill", () => {
  test("the confirmation names the child that dies, and only that ends", async () => {
    const { w, closer, outcomes, plan, entry, lead, helper, server } =
      await setup();
    expect(plan.descendants.map((d) => d.label)).toEqual(["helper"]);
    const one = entry();
    await closer.commit([one]);
    await until(() => outcomes.length === 1);
    expect(outcomes).toEqual([
      { id: one.id, result: "closed", closed_tab: true },
    ]);
    expect(
      w.fake.calls
        .filter((c) => c.method === "terminal.kill")
        .map((c) => c.params),
    ).toEqual([{ terminal: lead }]);
    expect(w.fake.terminal(helper)!.state).toBe("finished");
    expect(w.fake.terminal(server)!.state).toBe("live");
  });

  test("a child started while it rode the bus refuses the close", async () => {
    const { w, closer, outcomes, entry, lead, storage } = await setup();
    const one = entry();
    w.fake.create({ parent: lead, die_with_parent: true, name: "late" });
    await w.settle();
    await closer.commit([one]);
    await until(() => outcomes.length === 1);
    expect(outcomes[0]).toMatchObject({ id: one.id, result: "refused" });
    expect(outcomes[0]!.detail).toContain("late would end too");
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
    expect(w.fake.terminal(lead)!.state).toBe("live");
    const effect = (await storage.outbox.forRecord(one.id)).find(
      (item) => item.kind === BIN_CORE_CLOSE_VERB,
    );
    expect(effect?.state).toBe("refused");
  });

  test("an agent that ended before the bus left is gone, not killed", async () => {
    const { w, closer, outcomes, entry, lead } = await setup();
    const one = entry();
    w.fake.finish(lead);
    await w.settle();
    await closer.commit([one]);
    await until(() => outcomes.length === 1);
    expect(outcomes[0]).toMatchObject({ id: one.id, result: "gone" });
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
  });
});
