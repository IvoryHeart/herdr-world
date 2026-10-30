import { expect, test } from "bun:test";
import { AdapterSession } from "./session";
import { SyntheticSource, syntheticAdapter } from "./testing/synthetic";
import type { AdapterPage } from "./types";

function setup() {
  const source = new SyntheticSource(97);
  let now = 0;
  const definition = {
    ...syntheticAdapter,
    descriptor: structuredClone(syntheticAdapter.descriptor),
  };
  const session = new AdapterSession(
    definition,
    source,
    { instanceId: "example", isCurrent: () => true, monotonic: () => now },
    true,
  );
  return {
    source,
    definition,
    session,
    tick: () => {
      now += 1000;
    },
  };
}

test("seeded source is deterministic, terminal-less, and actually paginates", async () => {
  const { source, session } = setup();
  expect(await source.list({ limit: 2 })).toEqual(
    await new SyntheticSource(97).list({ limit: 2 }),
  );
  const rows = Array.from({ length: 5 }, (_, i) => source.row("Case/:" + i));
  source.set(rows);
  const before = source.requests;
  const result = await session.refresh();
  expect(result).toHaveLength(5);
  expect(source.requests - before).toBe(3);
  expect(syntheticAdapter.descriptor.kinds.item.terminal).toBe(false);
  for (const row of result) {
    expect(row.payload).not.toHaveProperty("pane_id");
    expect(row.payload).not.toHaveProperty("terminal_id");
    expect(session.resolve(row)).toBe("attached");
    expect(session.claims(row).some((claim) => claim.field === "status")).toBe(
      true,
    );
  }
  await expect(session.dispatch("terminal.send", {})).rejects.toThrow(
    "undeclared",
  );
  expect(source.dispatches).toBe(0);
  session.retire();
});

test("real event order never changes published rows until a reread", async () => {
  const { source, session } = setup();
  const [old] = await session.refresh();
  source.emit({ type: "delete", id: old.nativeId });
  source.emit({ type: "create", id: "not-yet-listed" });
  source.emit({ type: "delete", id: old.nativeId });
  expect(session.entities()[0]).toEqual(old);
  source.set([source.row("listed")]);
  expect((await session.refresh()).map((row) => row.nativeId)).toEqual([
    "listed",
  ]);
  session.retire();
});

test("concurrency and rate refusals happen before dispatch; time advances the rate window", async () => {
  const { source, definition, session, tick } = setup();
  let release!: () => void;
  source.beforeRead = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const reading = session.refresh();
  await expect(session.dispatch("inspect", {})).rejects.toThrow("concurrency");
  expect(source.dispatches).toBe(0);
  release();
  await reading;
  definition.descriptor.limits.requestsPerSecond = 1;
  await expect(session.dispatch("inspect", {})).rejects.toThrow("rate");
  tick();
  expect(await session.dispatch("inspect", {})).toEqual({ ok: true });
  session.retire();
});

for (const fault of [
  "pages",
  "cursor",
  "epoch",
  "revision",
  "payload",
] as const) {
  test(
    "malformed " + fault + " does not publish part of a listing",
    async () => {
      const { source, definition, session } = setup();
      source.set(Array.from({ length: 5 }, (_, i) => source.row(String(i))));
      let page = 0;
      if (fault === "pages") definition.descriptor.limits.pages = 1;
      source.transform = (value): AdapterPage => {
        page++;
        if (fault === "cursor") return { ...value, cursor: "0" };
        if (fault === "epoch" && page === 2)
          return { ...value, epoch: "reset" };
        if (fault === "revision" && page === 2)
          return { ...value, revision: "changed" };
        if (fault === "payload")
          return { ...value, rows: [{ kind: "item", payload: { id: 12 } }] };
        return value;
      };
      await expect(session.refresh()).rejects.toThrow();
      expect(session.entities()).toEqual([]);
      session.retire();
    },
  );
}

test("partial accumulation is bounded and a rejected merge preserves prior state", async () => {
  const { source, definition, session } = setup();
  definition.descriptor.limits.entities = 2;
  await session.refresh();
  const previous = session.entities();
  source.set([source.row("another")], { complete: false });
  await expect(session.refresh()).rejects.toThrow("retained entity limit");
  expect(session.entities()).toEqual(previous);
  session.retire();
});

test("undeclared capability never makes a claimed complete page authoritative", async () => {
  const { source, definition, session } = setup();
  definition.descriptor.capabilities.completeListings = false;
  const before = await session.refresh();
  source.set([]);
  expect(await session.refresh()).toEqual(before);
  session.retire();
});

test("configuration and verb schemas are checked before source acquisition", async () => {
  const { source, definition } = setup();
  let opened = 0;
  const guarded = {
    ...definition,
    open(context: SyntheticSource) {
      opened++;
      return definition.open(context);
    },
  };
  const owner = {
    instanceId: "example",
    isCurrent: () => true,
    monotonic: () => 0,
  };
  const session = new AdapterSession(guarded, source, owner, true, undefined, {
    password: "synthetic-secret",
  });
  await expect(session.refresh()).rejects.toThrow("configuration");
  await expect(session.dispatch("inspect", { extra: true })).rejects.toThrow(
    "input",
  );
  expect(opened).toBe(0);
});

test.todo(
  "v2 gate: synthetic terminal-less rows cross World subscription; reset ends lifetimes, ID reuse starts new lifetime, partial listing emits no deletes",
);
