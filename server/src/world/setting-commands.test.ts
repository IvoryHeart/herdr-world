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

function commands(write: () => Promise<{ before: unknown; value: unknown }>) {
  const events: string[] = [];
  const records: SettingCommandRecord[] = [];
  const settings = createSettingCommands({
    now: () => 5,
    write,
    publish: () => events.push("publish"),
    async record(record) {
      events.push("record");
      records.push(record);
    },
    log: (line) => events.push(line),
  });
  return { settings, events, records };
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
  expect(events).toEqual(["publish", "record"]);
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
  expect(events).toEqual(["record"]);
  expect(settingCommandSummary(records[0]!)).toBe(
    "Group runtimes by machine → by runtime failed: disk full",
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
