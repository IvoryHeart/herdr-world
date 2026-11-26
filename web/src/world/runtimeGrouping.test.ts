import { expect, test } from "bun:test";
import { OFFICE_PREFERENCES_KEY } from "./officePreferences";
import type { RuntimeGrouping } from "../../../shared/hostGrouping";
import {
  createRuntimeGroupingMigration,
  provideRuntimeGroupingControl,
  runtimeGroupingControl,
} from "./runtimeGrouping";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
const legacy = (townBuildings: string) =>
  storage({ [OFFICE_PREFERENCES_KEY]: JSON.stringify({ townBuildings }) });

test("a browser's old Town buildings choice is offered once per connection, only while the service has none", async () => {
  const migration = createRuntimeGroupingMigration(legacy("runtime"));
  const sent: unknown[] = [];
  // Not connected: nothing to send through.
  migration.adopt(undefined);
  migration.connect(async (value) => void sent.push(value));
  // The service has a value: it wins, nothing is sent.
  migration.adopt("machine");
  expect(sent).toEqual([]);
  // The service has none: the old choice goes up, once.
  migration.adopt(null);
  migration.adopt(undefined);
  migration.adopt("sideways");
  expect(sent).toEqual(["runtime"]);
  // A new connection offers it again while the service still has none.
  migration.connect(null);
  migration.connect(async (value) => void sent.push(value));
  migration.adopt(null);
  expect(sent).toEqual(["runtime", "runtime"]);
});

test("a browser with the default or no old choice offers nothing", () => {
  for (const each of [legacy("machine"), storage()]) {
    const migration = createRuntimeGroupingMigration(each);
    const sent: unknown[] = [];
    migration.connect(async (value) => void sent.push(value));
    migration.adopt(null);
    expect(sent).toEqual([]);
  }
});

test("a refused offer is swallowed; the next connection tries again", async () => {
  const migration = createRuntimeGroupingMigration(legacy("runtime"));
  let tries = 0;
  migration.connect(async () => {
    tries += 1;
    throw new Error("refused");
  });
  migration.adopt(null);
  await Promise.resolve();
  migration.adopt(null);
  expect(tries).toBe(1);
  migration.connect(async () => void (tries += 1));
  migration.adopt(null);
  expect(tries).toBe(2);
});

test("the Settings control shows and changes World's published grouping, holding none of its own", () => {
  // Before the World app hands over the replica: the default, and a change
  // goes nowhere.
  expect(runtimeGroupingControl.get()).toBe("machine");
  runtimeGroupingControl.set("runtime");
  let published: RuntimeGrouping = "machine";
  const replicaListeners = new Set<() => void>();
  const commands: RuntimeGrouping[] = [];
  let shown = 0;
  const off = runtimeGroupingControl.subscribe(() => void (shown += 1));
  provideRuntimeGroupingControl({
    get: () => published,
    subscribe: (listener) => {
      replicaListeners.add(listener);
      return () => void replicaListeners.delete(listener);
    },
    set: (value) => void commands.push(value),
  });
  // A change is a World command; the control keeps the published value.
  runtimeGroupingControl.set("runtime");
  expect(commands).toEqual(["runtime"]);
  expect(runtimeGroupingControl.get()).toBe("machine");
  // World publishes it: the control follows.
  const before = shown;
  published = "runtime";
  for (const listener of replicaListeners) listener();
  expect(shown).toBe(before + 1);
  expect(runtimeGroupingControl.get()).toBe("runtime");
  off();
});
