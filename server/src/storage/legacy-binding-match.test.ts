import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger, type WorldLedgerStorage } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import type { LegacyBindingCapture } from "./legacy-bindings";

const roots: string[] = [],
  stores: WorldLedgerStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const cases = (["appearance", "tab-colour"] as const).flatMap((policy) =>
  [false, true].flatMap((reverse) =>
    [0, 63].map((padding) => [policy, reverse, padding] as const),
  ),
);
for (const [policy, reverse, padding] of cases)
  test(`a multi-witness ${policy} split inherits neither old identity; reverse=${reverse} padding=${padding}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "binding-split-"));
    roots.push(root);
    const store = await openWorldLedger(
      {
        database: join(root, "world.sqlite"),
        ledger: join(root, "legacy.json"),
      },
      { clock: systemClock, scheduler: systemScheduler },
    );
    stores.push(store);
    const capture = (
      key: string,
      terminals: string[],
    ): LegacyBindingCapture => ({
      key,
      input: {
        adapter: "synthetic",
        instance: "studio",
        kind: "tab",
        native_id: key,
        slot: policy,
        policy,
        evidence: { terminals },
      },
    });
    await store.bindings.captureLegacy([
      capture("old-tab", ["terminal-a", "terminal-b"]),
    ]);
    const [old] = await store.bindings.list();
    const split = [
      capture("new-tab-a", ["terminal-a"]),
      capture("new-tab-b", ["terminal-b"]),
    ];
    if (reverse) split.reverse();
    await store.bindings.captureLegacy([
      ...Array.from({ length: padding }, (_, index) =>
        capture(`filler-tab-${index}`, [`filler-terminal-${index}`]),
      ),
      ...split,
    ]);
    const targets = (await store.bindings.list()).filter((row) =>
      row.native_id.startsWith("new-tab-"),
    );
    expect(targets).toHaveLength(2);
    expect(
      targets.every(
        (row) => row.id !== old!.id && row.record_id !== old!.record_id,
      ),
    ).toBe(true);
    expect(await store.bindings.get(old!.id)).toBeNull();
  });

test("one-to-one legacy moves retain both IDs across pages and either capture order", async () => {
  const root = mkdtempSync(join(tmpdir(), "binding-unique-move-"));
  roots.push(root);
  const store = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "legacy.json") },
    { clock: systemClock, scheduler: systemScheduler },
  );
  stores.push(store);
  const capture = (key: string, terminal: string): LegacyBindingCapture => ({
    key,
    input: {
      adapter: "synthetic",
      instance: "studio",
      kind: "tab",
      native_id: key,
      slot: "appearance",
      policy: "appearance",
      evidence: { terminals: [terminal] },
    },
  });
  await store.bindings.captureLegacy([
    capture("old-a", "terminal-a"),
    capture("old-b", "terminal-b"),
  ]);
  const before = await store.bindings.list();
  const fillers = Array.from({ length: 63 }, (_, index) =>
    capture(`filler-${index}`, `terminal-filler-${index}`),
  );
  for (const reverse of [false, true]) {
    const moved = [
      capture(`move-a-${reverse}`, "terminal-a"),
      capture(`move-b-${reverse}`, "terminal-b"),
    ];
    if (reverse) moved.reverse();
    await store.bindings.captureLegacy([...fillers, ...moved]);
    const current = await store.bindings.list();
    for (const old of before)
      expect(
        current.find(
          (row) => row.evidence.terminals[0] === old.evidence.terminals[0],
        ),
      ).toMatchObject({ id: old.id, record_id: old.record_id });
  }
});
