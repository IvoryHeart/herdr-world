import { expect, test } from "bun:test";
import { handleBridgeRpc } from "../rpc/bridge";
import type { BridgeRpcContext } from "../rpc/context";
import {
  createSettingCommands,
  parseSettingCommand,
  settingCommandSummary,
  type SettingCommandRecord,
} from "./setting-commands";

const change = {
  id: "cmd-1",
  entity: { kind: "setting", key: "runtimeGrouping" },
  field: "value",
  expected: "machine",
  value: "runtime",
} as const;

function commands(
  write: (
    value: unknown,
    held: unknown,
  ) => Promise<{ before: unknown; value: unknown }>,
  options: {
    held?: unknown;
    /** Fail the record writes at these (0-based) calls. */
    failRecords?: number[];
    history?: SettingCommandRecord[];
  } = {},
) {
  const events: string[] = [];
  const records: SettingCommandRecord[] = options.history ?? [];
  let held: unknown = options.held ?? "machine";
  let recordCalls = 0;
  const settings = createSettingCommands({
    now: () => 5,
    read: async () => held,
    async write(_key, value) {
      events.push("write");
      const written = await write(value, held);
      held = written.value;
      return written;
    },
    publish: () => events.push("publish"),
    async record(record) {
      if (options.failRecords?.includes(recordCalls++))
        throw new Error("ledger unavailable");
      events.push(`record ${record.state}`);
      const index = records.findIndex(({ id }) => id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
    },
    unsettled: () => records.filter(({ state }) => state === "accepted"),
    log: (line) => events.push(line),
  });
  return { settings, events, records, held: () => held };
}

test("a setting command names the setting; a room command is not one", () => {
  expect(parseSettingCommand(change)).toEqual(change);
  expect(parseSettingCommand({ ...change, expected: null })?.expected).toBe(
    null,
  );
  expect(
    parseSettingCommand({ ...change, entity: { kind: "room" } }),
  ).toBeNull();
  for (const wrong of [
    { ...change, value: "galaxy" },
    { ...change, expected: "galaxy" },
    { ...change, field: "label" },
    { ...change, entity: { kind: "setting", key: "theme" } },
    { ...change, id: "" },
  ])
    expect(() => parseSettingCommand(wrong)).toThrow(
      "invalid World setting command",
    );
});

test("a stored change publishes once, then leaves one record with before and after", async () => {
  const { settings, events, records } = commands(async () => ({
    before: "machine",
    value: "runtime",
  }));
  const record = await settings.submit(parseSettingCommand(change)!);
  expect(record).toEqual({
    ...change,
    state: "stored",
    before: "machine",
    observed: "runtime",
    at: 5,
  });
  expect(events).toEqual([
    "record accepted",
    "write",
    "publish",
    "record stored",
  ]);
  expect(records).toEqual([record]);
  expect(settingCommandSummary(record)).toBe(
    "Group runtimes by machine → by runtime",
  );
});

test("a failed write publishes nothing and records the failure", async () => {
  const { settings, events, records } = commands(async () => {
    throw new Error("disk full");
  });
  const record = await settings.submit(parseSettingCommand(change)!);
  expect(record).toMatchObject({
    state: "failed",
    before: "machine",
    detail: "disk full",
  });
  expect(record).not.toHaveProperty("observed");
  expect(events).toEqual(["record accepted", "write", "record failed"]);
  expect(settingCommandSummary(records[0]!)).toBe(
    "Group runtimes by machine → by runtime failed: disk full",
  );
});

test("a command whose acceptance cannot be recorded changes nothing", async () => {
  const { settings, events, records, held } = commands(
    async () => ({ before: "machine", value: "runtime" }),
    { failRecords: [0] },
  );
  const record = await settings.submit(parseSettingCommand(change)!);
  expect(record).toMatchObject({ state: "failed", before: "machine" });
  expect(events).toEqual([
    "World setting history not recorded: Error: ledger unavailable",
  ]);
  expect(records).toEqual([]);
  expect(held()).toBe("machine");
});

test("an outcome that cannot be recorded settles before the next command", async () => {
  const { settings, events, records } = commands(
    async (value, held) => ({ before: held, value }),
    { failRecords: [1] },
  );
  const record = await settings.submit(parseSettingCommand(change)!);
  expect(record.state).toBe("stored");
  // The setting is written and published; its record still says accepted.
  expect(records).toEqual([
    { ...change, state: "accepted", before: "machine", at: 5 },
  ]);
  expect(events).toContain("publish");
  await settings.submit(
    parseSettingCommand({ ...change, id: "cmd-2", value: "machine" })!,
  );
  expect(
    records.map(({ id, state, before, observed }) => [
      id,
      state,
      before,
      observed,
    ]),
  ).toEqual([
    ["cmd-1", "stored", "machine", "runtime"],
    ["cmd-2", "stored", "runtime", "machine"],
  ]);
});

test("after a restart, a record left accepted settles from the value held", async () => {
  const accepted = (id: string, value: "machine" | "runtime") => ({
    ...parseSettingCommand({ ...change, id, value })!,
    state: "accepted" as const,
    before: "machine",
    at: 1,
  });
  const history = [accepted("cmd-1", "runtime")];
  const written = commands(async () => ({ before: null, value: null }), {
    held: "runtime",
    history,
  });
  await written.settings.recover();
  expect(history[0]).toMatchObject({ state: "stored", observed: "runtime" });
  expect(settingCommandSummary(history[0]!)).toBe(
    "Group runtimes by machine → by runtime",
  );
  const lost = [accepted("cmd-2", "runtime")];
  const unwritten = commands(async () => ({ before: null, value: null }), {
    held: "machine",
    history: lost,
  });
  await unwritten.settings.recover();
  expect(lost[0]).toMatchObject({ state: "uncertain", observed: "machine" });
  expect(settingCommandSummary(lost[0]!)).toBe(
    "Group runtimes by machine → by runtime uncertain: World stopped before the change settled",
  );
});

test("an explicit Group runtimes write through the bridge is refused; the legacy offer passes", async () => {
  const writes: unknown[] = [];
  const errors: string[] = [];
  let published = 0;
  const call = (params: Record<string, unknown>) =>
    handleBridgeRpc({
      id: "request",
      method: "bridge.ui_settings.update",
      params,
      sendReply: () => true,
      sendError: (_context: string, error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      services: {
        uiSettings: async (_method: string, update: unknown) => {
          writes.push(update);
          return {};
        },
        publishWorld: () => (published += 1),
      },
    } as unknown as BridgeRpcContext);
  await call({ key: "runtimeGrouping", value: "runtime" });
  expect(errors).toEqual(["Group runtimes changes through world.command"]);
  expect(writes).toEqual([]);
  await call({
    key: "runtimeGrouping",
    value: "runtime",
    only_if_absent: true,
  });
  await call({ key: "theme", value: "dark" });
  expect(writes).toHaveLength(2);
  expect(published).toBe(2);
  expect(errors).toHaveLength(1);
});
