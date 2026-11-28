import { afterEach, expect, test } from "bun:test";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import type { RuntimeReader } from "../adapters/runtime-ports";
import { coreWorld } from "../herdr-core/testing/core-world";
import { ENDED_BEFORE_BUS, WorldBinRegistry } from "./bin";
import { worldRuntimeRegistry } from "./runtime-registry";
import { WorldSnapshotService } from "./snapshot";

/**
 * A herdr-core agent held in the bin that ends by itself (killed outside
 * World, or closed by another of World's operations): the service's own
 * snapshot reads of the in-process core take it out of the bin, so it is
 * never held invisibly for a bus that would only find it gone.
 */

const worlds: Array<Awaited<ReturnType<typeof coreWorld>>> = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

async function setup() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  const lead = w.fake.create({
    argv: ["/opt/example/bin/claude"],
    name: "lead",
  });
  const other = w.fake.create({ name: "other" });
  await w.synchronize();
  const committed: string[] = [];
  // Test time: a read begun in the same millisecond as the hold witnesses
  // nothing, so each read moves it on.
  let time = Date.now();
  const bin = new WorldBinRegistry({
    epoch: "run1",
    clock: { now: () => time, monotonic: () => time },
    scheduler: {
      schedule: (run, delay) => {
        const timer = setTimeout(run, delay);
        return { cancel: () => clearTimeout(timer) };
      },
    },
    commit: async (entries) => {
      committed.push(...entries.map((entry) => entry.pane_id));
    },
    publish: () => {},
  });
  const snapshots = new WorldSnapshotService(
    worldRuntimeRegistry(
      // No Herdr (TUI) connection: only the core host is read.
      new ConnectionManager<ConnectionRuntime & { operations: RuntimeReader }>(
        "startup-default",
      ),
      w.core.manager,
    ),
    () => time,
    undefined,
    undefined,
    undefined,
    undefined,
    (...args) => bin.observeComplete(...args),
  );
  const generation = w.lease().generation;
  const id = bin.add({
    connection_id: "box",
    connection_generation: generation,
    runtime: "herdr-core",
    workspace_id: "hc:unplaced",
    tab_id: "hc:unplaced:tab:main",
    pane_id: lead,
    terminal_id: lead,
    confirmation: {
      core_id: "c0ffee",
      terminals: [{ address: lead, pid: 4242, occupant: "claude" }],
    },
    label: "lead",
    view: "town",
  }).entries[0]!.id;
  /** A fresh read of every host, as World's snapshot makes. */
  const read = async () => {
    time += 2;
    snapshots.invalidate("box");
    await snapshots.snapshot();
  };
  return { w, bin, id, lead, other, read, committed };
}

test("a held core agent stays while core still has its terminal", async () => {
  const { bin, id, read } = await setup();
  await read();
  expect(bin.list().entries.map((entry) => entry.id)).toEqual([id]);
  bin.dispose();
});

test("a held core agent that core removed leaves the bin with nothing closed", async () => {
  const { w, bin, id, lead, read, committed } = await setup();
  w.fake.remove(lead);
  await w.synchronize();
  await read();
  const state = bin.list();
  expect(state.entries).toEqual([]);
  expect(state.closing).toEqual([]);
  expect(state.outcomes).toEqual([
    {
      id,
      label: "lead",
      view: "town",
      result: "gone",
      closed_tab: false,
      detail: ENDED_BEFORE_BUS,
    },
  ]);
  expect(committed).toEqual([]);
  bin.dispose();
});
