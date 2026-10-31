import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger, type WorldLedgerStorage } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import type { BindingInput, BindingFence } from "../world/binding-types";
import { openWorldWriter } from "./world-writer";

const rejection = async (pending: Promise<unknown>) => {
  try {
    await pending;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected a rejected binding operation");
};
const roots: string[] = [];
const stores: WorldLedgerStorage[] = [];
const input: BindingInput = {
  record_id: "legacy-string",
  slot: "to",
  policy: "board-string",
  adapter: "synthetic",
  instance: "studio",
  kind: "pane",
  native_id: "pane-a",
  evidence: { terminals: ["terminal-a"] },
};
const fence: BindingFence = {
  adapter: "synthetic",
  instance: "studio",
  service_incarnation: "service-a",
  generation: 1,
};
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "world-bindings-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
};
const open = async (paths = fixture()) => {
  const store = await openWorldLedger(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  stores.push(store);
  return store;
};
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("bindings persist with store IDs and must resolve again after reopening", async () => {
  const paths = fixture();
  const first = await open(paths);
  const saved = await first.bindings.create(input);
  expect(saved.id).toMatch(/^b-[0-9a-z]{8}$/);
  const result = await first.bindings.resolve(
    saved.id,
    {
      type: "listing",
      fence,
      complete: true,
      entities: [{ native_id: "pane-a", terminals: ["terminal-a"] }],
    },
    fence,
    saved!.revision,
  );
  expect(result?.target?.native_id).toBe("pane-a");
  await first.close();
  const second = await open(paths);
  expect(await second.bindings.get(saved.id)).toMatchObject({
    ...input,
    id: saved.id,
    state: "unresolved",
  });
  expect(
    (
      await second.bindings.resolve(
        saved.id,
        {
          type: "listing",
          fence: { ...fence, service_incarnation: "service-b" },
          complete: true,
          entities: [{ native_id: "pane-a", terminals: ["terminal-a"] }],
        },
        { ...fence, service_incarnation: "service-b" },
        result!.binding.revision,
      )
    )?.binding.state,
  ).toBe("attached");
});

test("record slots are unique, list pages are bounded and deletion does not recycle identity", async () => {
  const store = await open();
  const saved = await store.bindings.create(input);
  expect(await rejection(store.bindings.create(input))).toMatch(/slot|UNIQUE/);
  const other = await store.bindings.create({ ...input, slot: "from" });
  const page = await store.bindings.list({
    record_id: input.record_id,
    limit: 1,
  });
  expect(page).toHaveLength(1);
  expect(
    await store.bindings.list({
      record_id: input.record_id,
      after: page[0]!.id,
      limit: 1,
    }),
  ).toHaveLength(1);
  await store.bindings.remove(saved.id);
  expect(await store.bindings.get(saved.id)).toBeNull();
  expect((await store.bindings.create(input)).id).not.toBe(saved.id);
  expect((await store.bindings.get(other.id))?.slot).toBe("from");
});

test("binding storage refuses fences in identity, invalid policies, malformed observations and writes after close", async () => {
  const store = await open();
  expect(
    await rejection(
      store.bindings.create({ ...input, generation: 1 } as BindingInput),
    ),
  ).toMatch(/identity|binding/);
  expect(
    await rejection(
      store.bindings.create({
        ...input,
        policy: "layout",
      } as unknown as BindingInput),
    ),
  ).toMatch(/binding/);
  const saved = await store.bindings.create(input);
  expect(
    await rejection(
      store.bindings.resolve(
        saved.id,
        { type: "listing", fence, complete: true, entities: [null] } as never,
        fence,
        saved.revision,
      ),
    ),
  ).toMatch(/binding/);
  expect(await store.bindings.get(saved.id)).toMatchObject({
    state: "unresolved",
    native_id: "pane-a",
  });
  await store.close();
  expect(
    await rejection(store.bindings.create({ ...input, slot: "other" })),
  ).toMatch(/clos/i);
});

test("an interrupted legacy import cannot authorize a saved target before its owner reconciles", async () => {
  const paths = fixture();
  const writer = openWorldWriter(paths.database, paths.ledger, 1000);
  const legacy = (
    operation: import("./legacy-bindings").LegacyBindingOperation,
  ) => {
    const reply = writer.batch(
      [
        {
          ticket: 1,
          request: {
            type: "binding",
            operation: { type: "legacy", operation },
          },
        },
      ],
      1000,
    )[0]!;
    if (reply.error) throw new Error(reply.error);
  };
  legacy({ type: "begin" });
  legacy({ type: "put", captures: [{ key: "legacy-key", input }] });
  legacy({ type: "finish" });
  legacy({ type: "begin" }); // The process stops before the complete record listing finishes.
  writer.close();
  const store = await open(paths);
  const [saved] = await store.bindings.list();
  const result = await store.bindings.resolve(
    saved!.id,
    {
      type: "listing",
      fence,
      complete: true,
      entities: [{ native_id: "pane-a", terminals: ["terminal-a"] }],
    },
    fence,
    saved!.revision,
  );
  expect(result?.binding.state).toBe("unresolved");
  expect(result?.target).toBeNull();
  await store.bindings.captureLegacy([]);
  expect(await store.bindings.list()).toEqual([]);
});

test("an ambiguous legacy rename never chooses which new record inherits the old identity", async () => {
  const store = await open();
  const appearance = {
    ...input,
    policy: "appearance" as const,
    record_id: undefined,
  };
  await store.bindings.captureLegacy([{ key: "old-look", input: appearance }]);
  const [old] = await store.bindings.list();
  await store.bindings.captureLegacy([
    { key: "new-look-a", input: { ...appearance, native_id: "pane-b" } },
    { key: "new-look-b", input: { ...appearance, native_id: "pane-c" } },
  ]);
  const rows = await store.bindings.list();
  expect(rows).toHaveLength(2);
  expect(
    rows.every((row) => row.id !== old!.id && row.record_id !== old!.record_id),
  ).toBe(true);
  for (const row of rows) {
    const resolved = await store.bindings.resolve(
      row.id,
      {
        type: "listing",
        fence,
        complete: true,
        entities: [
          { native_id: "pane-b", terminals: ["terminal-a"] },
          { native_id: "pane-c", terminals: ["terminal-a"] },
        ],
      },
      fence,
      row.revision,
    );
    expect(resolved?.binding.state).toBe("unresolved");
    expect(resolved?.target).toBeNull();
  }
});
